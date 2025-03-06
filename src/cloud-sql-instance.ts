// Copyright 2023 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {IpAddressTypes, selectIpAddress} from './ip-addresses';
import {InstanceConnectionInfo} from './instance-connection-info';
import {
  isSameInstance,
  resolveInstanceName,
} from './parse-instance-connection-name';
import {InstanceMetadata} from './sqladmin-fetcher';
import {generateKeys} from './crypto';
import {RSAKeys} from './rsa-keys';
import {SslCert} from './ssl-cert';
import {getRefreshInterval, isExpirationTimeValid} from './time';
import {AuthTypes} from './auth-types';
import {CloudSQLConnectorError} from './errors';

// Private types that describe exactly the methods
// needed from tls.Socket to be able to close
// sockets when the DNS Name changes.
type EventFn = () => void;
type DestroyableSocket = {
  destroy: (error?: Error) => void;
  once: (name: string, handler: EventFn) => void;
};

interface Fetcher {
  getInstanceMetadata({
    projectId,
    regionId,
    instanceId,
  }: InstanceConnectionInfo): Promise<InstanceMetadata>;
  getEphemeralCertificate(
    instanceConnectionInfo: InstanceConnectionInfo,
    publicKey: string,
    authType: AuthTypes
  ): Promise<SslCert>;
}

interface CloudSQLInstanceOptions {
  authType: AuthTypes;
  instanceConnectionName: string;
  domainName?: string;
  ipType: IpAddressTypes;
  limitRateInterval?: number;
  sqlAdminFetcher: Fetcher;
  failoverPeriod?: number;
}

interface RefreshResult {
  ephemeralCert: SslCert;
  host: string;
  privateKey: string;
  serverCaCert: SslCert;
}

export class CloudSQLInstance {
  static async getCloudSQLInstance(
    options: CloudSQLInstanceOptions
  ): Promise<CloudSQLInstance> {
    const instance = new CloudSQLInstance({
      options: options,
      instanceInfo: await resolveInstanceName(
        options.instanceConnectionName,
        options.domainName
      ),
    });
    await instance.refresh();
    return instance;
  }

  private readonly ipType: IpAddressTypes;
  private readonly authType: AuthTypes;
  private readonly sqlAdminFetcher: Fetcher;
  private readonly limitRateInterval: number;
  private establishedConnection: boolean = false;
  // The ongoing refresh promise is referenced by the `next` property
  private next?: Promise<RefreshResult>;
  private scheduledRefreshID?: ReturnType<typeof setTimeout> | null = undefined;
  private checkDomainID?: ReturnType<typeof setInterval> | null = undefined;
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  private throttle?: any;
  private closed = false;
  private failoverPeriod: number;
  private sockets = new Set<DestroyableSocket>();

  public readonly instanceInfo: InstanceConnectionInfo;
  public ephemeralCert?: SslCert;
  public host?: string;
  public port = 3307;
  public privateKey?: string;
  public serverCaCert?: SslCert;
  public serverCaMode = '';
  public dnsName = '';

  constructor({
    options,
    instanceInfo,
  }: {
    options: CloudSQLInstanceOptions;
    instanceInfo: InstanceConnectionInfo;
  }) {
    this.instanceInfo = instanceInfo;
    this.authType = options.authType || AuthTypes.PASSWORD;
    this.ipType = options.ipType || IpAddressTypes.PUBLIC;
    this.limitRateInterval = options.limitRateInterval || 30 * 1000; // 30 seconds
    this.sqlAdminFetcher = options.sqlAdminFetcher;
    this.failoverPeriod = options.failoverPeriod || 30 * 1000; // 30 seconds
  }

  // p-throttle library has to be initialized in an async scope in order to
  // use dynamic import so that it's also compatible with CommonJS
  private async initializeRateLimiter() {
    if (this.throttle) {
      return;
    }
    const pThrottle = (await import('p-throttle')).default;
    this.throttle = pThrottle({
      limit: 1,
      interval: this.limitRateInterval,
      strict: true,
    }) as ReturnType<typeof pThrottle>;
  }

  forceRefresh(): Promise<void> {
    // if a refresh is already ongoing, just await for its promise to fulfill
    // so that a new instance info is available before reconnecting
    if (this.next) {
      return new Promise(resolve => {
        if (this.next) {
          this.next.finally(resolve);
        } else {
          resolve();
        }
      });
    }

    this.cancelRefresh();
    this.scheduleRefresh(0);

    return new Promise(resolve => {
      // setTimeout() to yield execution to allow other refresh background
      // task to start.
      setTimeout(() => {
        if (this.next) {
          // If there is a refresh promise in progress, resolve this promise
          // when the refresh is complete.
          this.next.finally(resolve);
        } else {
          // Else resolve immediately.
          resolve();
        }
      }, 0);
    });
  }

  refresh(): Promise<RefreshResult> {
    if (this.closed) {
      this.scheduledRefreshID = undefined;
      this.next = undefined;
      return Promise.reject('closed');
    }

    // Lazy instantiation of the checkDomain interval on the first refresh
    // This avoids issues with test cases that instantiate a CloudSqlInstance.
    // If failoverPeriod is 0 (or negative) don't check for DNS updates.
    if (
      this?.instanceInfo?.domainName &&
      !this.checkDomainID &&
      this.failoverPeriod > 0
    ) {
      this.checkDomainID = setInterval(() => {
        this.checkDomainChanged();
      }, this.failoverPeriod);
    }

    const currentRefreshId = this.scheduledRefreshID;

    // Since forceRefresh might be invoked during an ongoing refresh
    // we keep track of the ongoing promise in order to be able to await
    // for it in the forceRefresh method.
    // In case the throttle mechanism is already initialized, we add the
    // extra wait time `limitRateInterval` in order to limit the rate of
    // requests to Cloud SQL Admin APIs.
    this.next = (
      this.throttle && this.scheduledRefreshID
        ? this.throttle(this.performRefresh).call(this)
        : this.performRefresh()
    )
      // These needs to be part of the chain of promise referenced in
      // next in order to avoid race conditions
      .then((nextValues: RefreshResult) => {
        // in case the id at the moment of starting this refresh cycle has
        // changed, that means that it has been canceled
        if (currentRefreshId !== this.scheduledRefreshID) {
          return;
        }

        // In case the performRefresh method succeeded
        // then we go ahead and update values
        this.updateValues(nextValues);

        const refreshInterval = getRefreshInterval(
          /* c8 ignore next */
          String(this.ephemeralCert?.expirationTime)
        );
        this.scheduleRefresh(refreshInterval);

        // This is the end of the successful refresh chain, so now
        // we release the reference to the next
        this.next = undefined;
      })
      .catch((err: unknown) => {
        // In case there's already an active connection we won't throw
        // refresh errors to the final user, scheduling a new
        // immediate refresh instead.
        if (this.establishedConnection) {
          if (currentRefreshId === this.scheduledRefreshID) {
            this.scheduleRefresh(0);
          }
        } else {
          throw err as Error;
        }

        // This refresh cycle has failed, releases ref to next
        this.next = undefined;
      })
      // The rate limiter needs to be initialized _after_ assigning a ref
      // to next in order to avoid race conditions with
      // the forceRefresh check that ensures a refresh cycle is not ongoing
      .then(() => {
        this.initializeRateLimiter();
      });

    return this.next as Promise<RefreshResult>;
  }

  // The performRefresh method will perform all the necessary async steps
  // in order to get a new set of values for an instance that can then be
  // used to create new connections to a Cloud SQL instance. It throws in
  // case any of the internal steps fails.
  private async performRefresh(): Promise<RefreshResult> {
    if (this.closed) {
      // The connector may be closed while the rate limiter delayed
      // a call to performRefresh() so check this.closed before continuing.
      return Promise.reject('closed');
    }

    const rsaKeys: RSAKeys = await generateKeys();
    const metadata: InstanceMetadata =
      await this.sqlAdminFetcher.getInstanceMetadata(this.instanceInfo);

    const ephemeralCert = await this.sqlAdminFetcher.getEphemeralCertificate(
      this.instanceInfo,
      rsaKeys.publicKey,
      this.authType
    );
    const host = selectIpAddress(metadata.ipAddresses, this.ipType);
    const privateKey = rsaKeys.privateKey;
    const serverCaCert = metadata.serverCaCert;
    this.serverCaMode = metadata.serverCaMode;
    this.dnsName = metadata.dnsName;

    const currentValues = {
      ephemeralCert: this.ephemeralCert,
      host: this.host,
      privateKey: this.privateKey,
      serverCaCert: this.serverCaCert,
    };

    const nextValues = {
      ephemeralCert,
      host,
      privateKey,
      serverCaCert,
    };

    // In the rather odd case that the current ephemeral certificate is still
    // valid while we get an invalid result from the API calls, then preserve
    // the current metadata.
    if (this.isValid(currentValues) && !this.isValid(nextValues)) {
      return currentValues as RefreshResult;
    }

    return nextValues;
  }

  private isValid({
    ephemeralCert,
    host,
    privateKey,
    serverCaCert,
  }: Partial<RefreshResult>): boolean {
    if (!ephemeralCert || !host || !privateKey || !serverCaCert) {
      return false;
    }
    return isExpirationTimeValid(ephemeralCert.expirationTime);
  }

  private updateValues(nextValues: RefreshResult): void {
    const {ephemeralCert, host, privateKey, serverCaCert} = nextValues;

    this.ephemeralCert = ephemeralCert;
    this.host = host;
    this.privateKey = privateKey;
    this.serverCaCert = serverCaCert;
  }

  private scheduleRefresh(delay: number): void {
    if (this.closed) {
      return;
    }
    this.scheduledRefreshID = setTimeout(() => this.refresh(), delay);
  }

  cancelRefresh(): void {
    // If refresh has not yet started, then cancel the setTimeout
    if (this.scheduledRefreshID) {
      clearTimeout(this.scheduledRefreshID);
    }
    this.scheduledRefreshID = null;
  }

  // Mark this instance as having an active connection. This is important to
  // ensure any possible errors thrown during a future refresh cycle should
  // not be thrown to the final user.
  setEstablishedConnection(): void {
    this.establishedConnection = true;
  }

  // close stops any refresh process in progress and prevents future refresh
  // connections.
  close(): void {
    this.closed = true;
    this.cancelRefresh();
    if (this.checkDomainID) {
      clearInterval(this.checkDomainID);
      this.checkDomainID = null;
    }
    for (const socket of this.sockets) {
      socket.destroy(
        new CloudSQLConnectorError({
          code: 'ERRCLOSED',
          message: 'The connector was closed.',
        })
      );
    }
  }

  isClosed(): boolean {
    return this.closed;
  }
  async checkDomainChanged() {
    if (!this.instanceInfo.domainName) {
      return;
    }

    const newInfo = await resolveInstanceName(
      undefined,
      this.instanceInfo.domainName
    );
    if (!isSameInstance(this.instanceInfo, newInfo)) {
      // Domain name changed. Close and remove, then create a new map entry.
      this.close();
    }
  }
  addSocket(socket: DestroyableSocket) {
    if (!this.instanceInfo.domainName) {
      // This was not connected by domain name. Ignore all sockets.
      return;
    }

    // Add the socket to the list
    this.sockets.add(socket);
    // When the socket is closed, remove it.
    socket.once('closed', () => {
      this.sockets.delete(socket);
    });
  }
}
