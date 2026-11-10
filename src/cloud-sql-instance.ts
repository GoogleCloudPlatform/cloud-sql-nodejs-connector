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

import tls from 'node:tls';
import {IpAddressTypes, selectIpAddress} from './ip-addresses';
import {InstanceConnectionInfo} from './instance-connection-info';
import {
  isSameInstance,
  resolveInstanceName,
  isInstanceDNSName,
  parseInstanceConnectionName,
} from './parse-instance-connection-name';
import {resolveARecord} from './dns-lookup';
import {InstanceMetadata} from './sqladmin-fetcher';
import {generateKeys} from './crypto';
import {RSAKeys} from './rsa-keys';
import {SslCert} from './ssl-cert';
import {getRefreshInterval, isExpirationTimeValid} from './time';
import {AuthTypes} from './auth-types';
import {CloudSQLConnectorError} from './errors';
import {SocketOptions, getSocket} from './socket';
import {
  attachPostgresSocket,
  buildPostgresStartupPacket,
  buildTerminatePacket,
  parsePostgresStartupPacket,
  PostgresSocket,
  WritableSocket,
} from './postgres-socket';

export {
  attachPostgresSocket,
  buildPostgresStartupPacket,
  buildTerminatePacket,
  parsePostgresStartupPacket,
  PostgresSocket,
};

export const DEFAULT_SERVER_PROXY_PORT = 3307;
export const DEFAULT_CONNECT_TIMEOUT_MS = 30 * 1000;

// Private types that describe exactly the methods
// needed from tls.Socket to be able to close
// sockets when the DNS Name changes.
type EventFn = () => void;
type DestroyableSocket = WritableSocket & {
  destroy: (error?: Error) => void;
  once: (name: string, handler: EventFn) => void;
};
type IamPrincipal = {user: string; database: string};

function destroySocketQuietly(socket: tls.TLSSocket): void {
  try {
    socket.removeAllListeners('error');
    socket.on('error', () => {});
    socket.destroy();
  } catch {
    // ignore destroy errors
  }
}

function sendStartupProbe(
  socket: tls.TLSSocket,
  principal: IamPrincipal,
  isSettled: () => boolean,
  onFinish: (err?: Error) => void,
  onEofTimer: (timer: ReturnType<typeof setTimeout>) => void
): void {
  try {
    socket.once('data', () => {
      if (isSettled()) {
        return;
      }
      try {
        socket.write(buildTerminatePacket(), () => {
          if (isSettled()) {
            return;
          }
          socket.end();
          // Wait for server EOF/close before destroying socket to prevent TCP RST
          const eofTimer = setTimeout(() => onFinish(), 500);
          if (typeof eofTimer.unref === 'function') {
            eofTimer.unref();
          }
          onEofTimer(eofTimer);
        });
      } catch {
        onFinish();
      }
    });
    socket.once('end', () => {
      onFinish();
    });
    socket.once('close', () => {
      onFinish();
    });
    socket.write(
      buildPostgresStartupPacket(principal.user, principal.database)
    );
  } catch (err) {
    onFinish(err as Error);
  }
}

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
  resolveConnectSettings(region: string, dnsName: string): Promise<string>;
}

interface CloudSQLInstanceOptions {
  authType: AuthTypes;
  instanceConnectionName?: string;
  domainName?: string;
  ipType: IpAddressTypes;
  limitRateInterval?: number;
  sqlAdminFetcher: Fetcher;
  failoverPeriod?: number;
  dialFunc?: (
    opts: SocketOptions,
    onSecureConnect?: () => void
  ) => tls.TLSSocket | Promise<tls.TLSSocket>;
}

interface RefreshResult {
  ephemeralCert?: SslCert;
  host: string;
  privateKey?: string;
  serverCaCert?: SslCert;
}

export class CloudSQLInstance {
  static async getCloudSQLInstance(
    options: CloudSQLInstanceOptions
  ): Promise<CloudSQLInstance> {
    const instanceInfo = await resolveInstanceName(
      options.instanceConnectionName,
      options.domainName,
      options.sqlAdminFetcher
    );
    const instance = new CloudSQLInstance({
      options: options,
      instanceInfo,
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
  private iamPrincipals = new Map<string, {user: string; database: string}>();
  private readonly activeProbeAborts = new Set<() => void>();
  private readonly dialFunc?: (
    opts: SocketOptions,
    onSecureConnect?: () => void
  ) => tls.TLSSocket | Promise<tls.TLSSocket>;
  public databaseVersion?: string;

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
    instanceInfo?: InstanceConnectionInfo;
  }) {
    this.authType = options.authType || AuthTypes.PASSWORD;
    this.ipType = options.ipType || IpAddressTypes.PUBLIC;
    this.limitRateInterval = options.limitRateInterval || 30 * 1000; // 30 seconds
    this.sqlAdminFetcher = options.sqlAdminFetcher;
    this.failoverPeriod = options.failoverPeriod || 30 * 1000; // 30 seconds
    this.dialFunc = options.dialFunc;

    if (instanceInfo) {
      this.instanceInfo = instanceInfo;
    } else if (options.instanceConnectionName) {
      this.instanceInfo = parseInstanceConnectionName(
        options.instanceConnectionName
      );
    } else if (options.domainName) {
      this.instanceInfo = {
        projectId: '',
        regionId: '',
        instanceId: '',
        domainName: options.domainName,
      };
    } else {
      throw new CloudSQLConnectorError({
        message:
          'instanceInfo or instanceConnectionName/domainName is required',
        code: 'ENOCONNECTIONNAME',
      });
    }
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
    const isInstanceDNS = isInstanceDNSName(
      this.instanceInfo?.domainName || ''
    );
    if (
      this?.instanceInfo?.domainName &&
      !isInstanceDNS &&
      !this.checkDomainID &&
      this.failoverPeriod > 0
    ) {
      this.checkDomainID = setInterval(() => {
        this.checkDomainChanged().catch(() => {
          // ignore unhandled rejections
        });
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
        if (currentRefreshId !== this.scheduledRefreshID || this.closed) {
          if (this.closed) {
            this.next = undefined;
          }
          return;
        }

        // In case the performRefresh method succeeded
        // then we go ahead and update values
        this.updateValues(nextValues);

        let refreshInterval = 3600000; // 1 hour default
        if (this.ephemeralCert) {
          refreshInterval = getRefreshInterval(
            this.ephemeralCert.expirationTime
          );
        }
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

    const metadata: InstanceMetadata =
      await this.sqlAdminFetcher.getInstanceMetadata(this.instanceInfo);

    let host = '';
    let ephemeralCert;
    let privateKey;
    let probeTargets: string[] = [];

    if (this.ipType !== IpAddressTypes.SQL_DATA) {
      const rsaKeys: RSAKeys = await generateKeys();
      ephemeralCert = await this.sqlAdminFetcher.getEphemeralCertificate(
        this.instanceInfo,
        rsaKeys.publicKey,
        this.authType
      );
      privateKey = rsaKeys.privateKey;

      probeTargets = await this.resolveHostTargets(metadata);
      host = probeTargets[0] || '';
    }

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

    if (metadata.databaseVersion) {
      this.databaseVersion = metadata.databaseVersion;
    }

    if (this.authType === AuthTypes.IAM) {
      await this.probeConnection(nextValues, metadata, probeTargets);
    }

    // In the rather odd case that the current ephemeral certificate is still
    // valid while we get an invalid result from the API calls, then preserve
    // the current metadata.
    if (this.isValid(currentValues) && !this.isValid(nextValues)) {
      return currentValues as RefreshResult;
    }

    return nextValues;
  }

  /**
   * Resolves ordered, deduplicated host IP targets from domainName A-records
   * with fallback to the metadata IP selected for this instance's ipType.
   */
  private async resolveHostTargets(
    metadata: InstanceMetadata
  ): Promise<string[]> {
    const targets: string[] = [];
    if (this.instanceInfo && this.instanceInfo.domainName) {
      try {
        const ips = await resolveARecord(this.instanceInfo.domainName);
        if (ips && ips.length > 0) {
          for (const ip of ips) {
            if (ip && !targets.includes(ip)) {
              targets.push(ip);
            }
          }
        }
      } catch {
        // ignore error, fallback to metadata IP
      }
    }
    try {
      const selectedIp = selectIpAddress(metadata.ipAddresses, this.ipType);
      if (selectedIp && !targets.includes(selectedIp)) {
        targets.push(selectedIp);
      }
    } catch (err) {
      if (targets.length === 0) {
        throw err;
      }
    }
    return targets;
  }

  recordIamPrincipal(user: string, database: string): void {
    if (!user) {
      return;
    }
    const db = database || user;
    this.iamPrincipals.set(`${user}\0${db}`, {user, database: db});
  }

  private async resolveProbeTargets(
    metadata: InstanceMetadata,
    resolvedTargets?: string[]
  ): Promise<string[]> {
    if (resolvedTargets && resolvedTargets.length > 0) {
      return resolvedTargets;
    }
    try {
      return await this.resolveHostTargets(metadata);
    } catch {
      // If the configured IP type is not available in metadata, skip probe
      return [];
    }
  }

  private probeTarget(
    socketOpts: SocketOptions,
    principal: IamPrincipal,
    timeoutMs: number
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let socket: tls.TLSSocket | null = null;
      let connectStarted = false;
      let connectedEventFired = false;
      let eofTimer: ReturnType<typeof setTimeout> | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;

      const abortProbe = () => {
        cleanup(new Error('Probe aborted: instance closed'));
      };

      const cleanup = (err?: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        this.activeProbeAborts.delete(abortProbe);
        if (timeout) {
          clearTimeout(timeout);
          timeout = undefined;
        }
        if (eofTimer) {
          clearTimeout(eofTimer);
          eofTimer = undefined;
        }
        if (socket) {
          destroySocketQuietly(socket);
        }
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      };

      this.activeProbeAborts.add(abortProbe);

      timeout = setTimeout(() => {
        cleanup(new Error('Probe timeout'));
      }, timeoutMs);
      if (typeof timeout.unref === 'function') {
        timeout.unref();
      }

      const startProbe = () => {
        if (settled || connectStarted || !socket) {
          return;
        }
        connectStarted = true;
        sendStartupProbe(
          socket,
          principal,
          () => settled,
          cleanup,
          timer => {
            eofTimer = timer;
          }
        );
      };

      const onConnect = () => {
        connectedEventFired = true;
        startProbe();
      };

      const setupSocket = (s: tls.TLSSocket) => {
        if (settled) {
          destroySocketQuietly(s);
          return;
        }
        socket = s;
        socket.on('error', err => {
          cleanup(err);
        });
        if (connectedEventFired) {
          startProbe();
        }
      };

      try {
        const dialResult = this.dialFunc
          ? this.dialFunc(socketOpts, onConnect)
          : getSocket(socketOpts, onConnect);
        if (dialResult instanceof Promise) {
          dialResult
            .then(s => {
              setupSocket(s);
            })
            .catch(err => cleanup(err));
        } else {
          setupSocket(dialResult);
        }
      } catch (err) {
        cleanup(err as Error);
      }
    });
  }

  private async probePrincipal(
    principal: IamPrincipal,
    targets: string[],
    baseOpts: Omit<SocketOptions, 'host'>,
    deadline: number
  ): Promise<void> {
    for (const target of targets) {
      const remainingMs = deadline - Date.now();
      if (this.closed || remainingMs <= 0) {
        break;
      }
      try {
        await this.probeTarget(
          {...baseOpts, host: target},
          principal,
          remainingMs
        );
        break;
      } catch {
        // Ignore probe error across single target and try next target
      }
    }
  }

  private async probeConnection(
    refreshResult: RefreshResult,
    metadata: InstanceMetadata,
    resolvedTargets?: string[]
  ): Promise<void> {
    if (this.closed) {
      return;
    }
    if (this.databaseVersion && !this.databaseVersion.startsWith('POSTGRES')) {
      return;
    }
    if (this.iamPrincipals.size === 0) {
      return;
    }

    const {ephemeralCert, privateKey, serverCaCert} = refreshResult;
    if (!ephemeralCert || !privateKey || !serverCaCert) {
      return;
    }

    const targets = await this.resolveProbeTargets(metadata, resolvedTargets);
    if (targets.length === 0) {
      return;
    }

    const deadline = Date.now() + DEFAULT_CONNECT_TIMEOUT_MS;
    const baseOpts: Omit<SocketOptions, 'host'> = {
      port: this.port || DEFAULT_SERVER_PROXY_PORT,
      instanceInfo: this.instanceInfo,
      serverName: this.instanceInfo.domainName || metadata.dnsName || '',
      instanceDnsName: metadata.dnsName || '',
      ephemeralCert,
      privateKey,
      serverCaCert,
    };

    for (const principal of Array.from(this.iamPrincipals.values())) {
      if (this.closed || Date.now() >= deadline) {
        break;
      }
      await this.probePrincipal(principal, targets, baseOpts, deadline);
    }
  }

  private isValid({
    ephemeralCert,
    host,
    privateKey,
    serverCaCert,
  }: Partial<RefreshResult>): boolean {
    if (this.ipType === IpAddressTypes.SQL_DATA) {
      return true;
    }
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
    for (const abortProbe of Array.from(this.activeProbeAborts)) {
      abortProbe();
    }
    this.activeProbeAborts.clear();
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

    try {
      const newInfo = await resolveInstanceName(
        undefined,
        this.instanceInfo.domainName,
        this.sqlAdminFetcher
      );
      if (!isSameInstance(this.instanceInfo, newInfo)) {
        // Domain name changed. Close and remove, then create a new map entry.
        this.close();
      }
    } catch (err) {
      if (this.isNonTransient(err)) {
        this.close();
      }
    }
  }

  private isNonTransient(err: unknown): boolean {
    if (err instanceof CloudSQLConnectorError) {
      if (
        err.code === 'ECNAMELOOPLIMITEXCEEDED' ||
        err.code === 'EDNSRESOLVERNOTINITIALIZED' ||
        err.code === 'EBADCONNECTIONNAME'
      ) {
        return true;
      }
      if (err.code === 'ENOSQLADMINRESOLVE') {
        for (const nestedErr of err.errors) {
          /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
          const response = (nestedErr as any).response;
          if (
            response &&
            (response.status === 403 || response.status === 404)
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }
  addSocket(socket: DestroyableSocket) {
    if (
      this.authType === AuthTypes.IAM &&
      (!this.databaseVersion || this.databaseVersion.startsWith('POSTGRES'))
    ) {
      attachPostgresSocket(socket, (user, database) => {
        this.recordIamPrincipal(user, database);
      });
    }
    if (!this.instanceInfo.domainName) {
      // This was not connected by domain name. Ignore all sockets.
      return;
    }

    // Add the socket to the list
    this.sockets.add(socket);
    // When the socket is closed, remove it.
    socket.once('close', () => {
      this.sockets.delete(socket);
    });
  }
}
