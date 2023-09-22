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
import {parseInstanceConnectionName} from './parse-instance-connection-name';
import {InstanceMetadata} from './sqladmin-fetcher';
import {generateKeys} from './crypto';
import {RSAKeys} from './rsa-keys';
import {SslCert} from './ssl-cert';
import {getRefreshInterval} from './time';
import {AuthTypes} from './auth-types';

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
  ipType: IpAddressTypes;
  limitRateInterval?: number;
  sqlAdminFetcher: Fetcher;
}

interface RefreshableValues {
  ephemeralCert: SslCert;
  host: string;
  privateKey: string;
  serverCaCert: SslCert;
}

export class CloudSQLInstance {
  static async getCloudSQLInstance(
    options: CloudSQLInstanceOptions
  ): Promise<CloudSQLInstance> {
    const instance = new CloudSQLInstance(options);
    await instance.refresh();
    return instance;
  }

  private readonly ipType: IpAddressTypes;
  private readonly authType: AuthTypes;
  private readonly sqlAdminFetcher: Fetcher;
  private readonly limitRateInterval: number;
  private activeConnection: boolean = false;
  private ongoingRefreshPromise?: Promise<RefreshableValues>;
  private scheduledRefreshID?: ReturnType<typeof setTimeout> | null = undefined;
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  private throttle?: any;
  public readonly instanceInfo: InstanceConnectionInfo;
  public ephemeralCert?: SslCert;
  public host?: string;
  public port = 3307;
  public privateKey?: string;
  public serverCaCert?: SslCert;

  constructor({
    ipType,
    authType,
    instanceConnectionName,
    sqlAdminFetcher,
    limitRateInterval = 30 * 1000, // 30s default
  }: CloudSQLInstanceOptions) {
    this.authType = authType;
    this.instanceInfo = parseInstanceConnectionName(instanceConnectionName);
    this.ipType = ipType;
    this.limitRateInterval = limitRateInterval;
    this.sqlAdminFetcher = sqlAdminFetcher;
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

  async forceRefresh(): Promise<void> {
    // if a refresh is already ongoing, just await for its promise to fulfill
    // so that a new instance info is available before reconnecting
    if (this.ongoingRefreshPromise) {
      await this.ongoingRefreshPromise;
      return;
    }
    this.cancelRefresh();
    return this.refresh();
  }

  async refresh(): Promise<void> {
    const currentRefreshId = this.scheduledRefreshID;

    // Since forceRefresh might be invoked during an ongoing refresh
    // we keep track of the ongoing promise in order to be able to await
    // for it in the forceRefresh method.
    // In case the throttle mechanism is already initialized, we add the
    // extra wait time `limitRateInterval` in order to limit the rate of
    // requests to Cloud SQL Admin APIs.
    this.ongoingRefreshPromise = (
      this.throttle && this.scheduledRefreshID
        ? this.throttle(this.refreshValues).call(this)
        : this.refreshValues()
    )
      // These needs to be part of the chain of promise referenced in
      // ongoingRefreshPromise in order to avoid race conditions
      .then((nextValues: RefreshableValues) => {
        // in case the id at the moment of starting this refresh cycle has
        // changed, that means that it has been canceled
        if (currentRefreshId !== this.scheduledRefreshID) {
          return nextValues;
        }

        // In case the refreshValues method succeeded
        // then we go ahead and update values
        this.updateValues(nextValues);

        this.scheduleRefresh();

        // This is the end of the successful refresh chain, so now
        // we release the reference to the ongoingRefreshPromise
        this.ongoingRefreshPromise = undefined;

        return nextValues;
      })
      .catch((err: unknown) => {
        // In case there's already an active connection we won't throw
        // refresh errors to the final user, scheduling a new refresh instead.
        if (this.activeConnection) {
          if (currentRefreshId === this.scheduledRefreshID) {
            this.scheduleRefresh();
          }
        } else {
          throw err as Error;
        }

        // This refresh cycle has failed, releases ref to ongoingRefreshPromise
        this.ongoingRefreshPromise = undefined;
      });

    // The rate limiter needs to be initialized _after_ assigning a ref
    // to ongoingRefreshPromise in order to avoid race conditions with
    // the forceRefresh check that ensures a refresh cycle is not ongoing
    await this.initializeRateLimiter();

    await this.ongoingRefreshPromise;
  }

  // The refreshValues method will perform all the necessary async steps
  // in order to get a new set of values for an instance that can then be
  // used to create new connections to a Cloud SQL instance. It throws in
  // case any of the internal steps fails.
  private async refreshValues(): Promise<RefreshableValues> {
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

    return {
      ephemeralCert,
      host,
      privateKey,
      serverCaCert,
    };
  }

  private updateValues(nextValues: RefreshableValues): void {
    const {ephemeralCert, host, privateKey, serverCaCert} = nextValues;

    this.ephemeralCert = ephemeralCert;
    this.host = host;
    this.privateKey = privateKey;
    this.serverCaCert = serverCaCert;
  }

  private scheduleRefresh(): void {
    const refreshInterval = getRefreshInterval(
      /* c8 ignore next */
      String(this.ephemeralCert?.expirationTime)
    );

    this.scheduledRefreshID = setTimeout(() => this.refresh(), refreshInterval);
  }

  cancelRefresh(): void {
    if (this.scheduledRefreshID) {
      clearTimeout(this.scheduledRefreshID);
    }
    this.scheduledRefreshID = null;
  }

  // Mark this instance as having an active connection. This is important to
  // ensure any possible errors thrown during a future refresh cycle should
  // not be thrown to the final user.
  setActiveConnection(): void {
    this.activeConnection = true;
  }
}
