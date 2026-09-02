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

import {createServer, Server, Socket} from 'node:net';
import {TLSSocket} from 'node:tls';

import {promisify} from 'node:util';
import {AuthClient, GoogleAuth} from 'google-auth-library';
import {CloudSQLInstance} from './cloud-sql-instance';
import {getSocket} from './socket';
import {IpAddressTypes} from './ip-addresses';
import {AuthTypes} from './auth-types';
import {SQLAdminFetcher} from './sqladmin-fetcher';
import {CloudSQLConnectorError} from './errors';
import {resolveInstanceName} from './parse-instance-connection-name';
import {SqlDataClient} from './sql-data-client';
import {InstanceConnectionInfo} from './instance-connection-info';

// These Socket types are subsets from nodejs definitely typed repo, ref:
// https://github.com/DefinitelyTyped/DefinitelyTyped/blob/ae0fe42ff0e6e820e8ae324acf4f8e944aa1b2b7/types/node/v18/net.d.ts#L437
export declare interface UnixSocketOptions {
  path: string | undefined;
  readableAll?: boolean | undefined;
  writableAll?: boolean | undefined;
}

export function cooldownBackoff(base: number, attempt: number): number {
  const multi = 1.618;
  const exp = attempt - 1 + Math.random();
  return Math.floor(base * Math.pow(multi, exp));
}

// Connector.getOptions accepts a ConnectionOptions object to configure how
// the connector will connect to the Cloud SQL instance.
//
// const connector = new Connector()
// const connectionOptions:ConnectionOptions = {
//   ipType: 'PUBLIC',
//   instanceConnectionName: 'PROJECT:REGION:INSTANCE',
// };
export declare interface ConnectionOptions {
  authType?: AuthTypes;
  ipType?: IpAddressTypes;
  instanceConnectionName?: string;
  domainName?: string;
  failoverPeriod?: number;
  limitRateInterval?: number;
  sqlDataEndpoint?: string;
  sqlDataStreamTimeout?: number;
  sqlDataKeepAliveTimeMs?: number;
  sqlDataKeepAliveTimeoutMs?: number;
  resourceExhaustedCooldownPeriod?: number;
}

export declare interface SocketConnectionOptions extends ConnectionOptions {
  listenOptions: UnixSocketOptions;
}

interface StreamFunction {
  (): Socket;
}

interface PromisedStreamFunction {
  (): Promise<Socket>;
}

// DriverOptions is the interface describing the object returned by
// the Connector.getOptions method, e.g:
// const connector = new Connector()
// const driverOptions:DriverOptions = await connector.getOptions({
//   ipType: 'PUBLIC',
//   instanceConnectionName: 'PROJECT:REGION:INSTANCE',
// });
export declare interface DriverOptions {
  stream: StreamFunction;
}

export declare interface TediousDriverOptions {
  connector: PromisedStreamFunction;
  encrypt: boolean;
}
// CacheEntry holds the promise and resolved instance metadata for
// the connector's instances. The instance field will be set when
// the promise resolves.
class CacheEntry {
  promise: Promise<CloudSQLInstance>;
  instance?: CloudSQLInstance;
  err?: Error;

  constructor(promise: Promise<CloudSQLInstance>) {
    this.promise = promise;
    this.promise
      .then(inst => (this.instance = inst))
      .catch(err => (this.err = err));
  }

  isResolved(): boolean {
    return Boolean(this.instance);
  }
  isError(): boolean {
    return Boolean(this.err);
  }
}

// Internal mapping of the CloudSQLInstances that
// adds extra logic to async initialize items.
class CloudSQLInstanceMap extends Map<string, CacheEntry> {
  private readonly sqlAdminFetcher: SQLAdminFetcher;

  constructor(sqlAdminFetcher: SQLAdminFetcher) {
    super();
    this.sqlAdminFetcher = sqlAdminFetcher;
  }

  private cacheKey(opts: ConnectionOptions): string {
    //TODO: for now, the cache key function must be synchronous.
    //  When we implement the async connection info from
    //  https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/pull/426
    //  then the cache key should contain both the domain name
    //  and the resolved instance name.
    return (
      (opts.instanceConnectionName || opts.domainName) +
      '-' +
      opts.authType +
      '-' +
      opts.ipType
    );
  }

  async loadInstance(opts: ConnectionOptions): Promise<void> {
    // in case an instance to that connection name has already
    // been setup there's no need to set it up again
    const key = this.cacheKey(opts);
    const entry = this.get(key);
    if (entry) {
      if (entry.isResolved()) {
        await entry.instance?.checkDomainChanged();
        if (!entry.instance?.isClosed()) {
          // The instance is open and the domain has not changed.
          // use the cached instance.
          return;
        }
      } else if (entry.isError()) {
        // The instance failed it's initial refresh. Remove it from the
        // cache and throw the error.
        this.delete(key);
        throw entry.err;
      } else {
        // The instance initial refresh is in progress.
        await entry.promise;
        return;
      }
    }

    // Start the refresh and add a cache entry.
    const promise = CloudSQLInstance.getCloudSQLInstance({
      instanceConnectionName: opts.instanceConnectionName,
      domainName: opts.domainName,
      authType: opts.authType || AuthTypes.PASSWORD,
      ipType: opts.ipType || IpAddressTypes.PUBLIC,
      limitRateInterval: opts.limitRateInterval || 30 * 1000, // 30 sec
      sqlAdminFetcher: this.sqlAdminFetcher,
      failoverPeriod: opts.failoverPeriod,
    });
    this.set(key, new CacheEntry(promise));

    // Wait for the cache entry to resolve.
    await promise;
  }

  getInstance(opts: ConnectionOptions): CloudSQLInstance {
    const connectionInstance = this.get(this.cacheKey(opts));
    if (!connectionInstance || !connectionInstance.instance) {
      throw new CloudSQLConnectorError({
        message: `Cannot find info for instance: ${
          opts.instanceConnectionName || opts.domainName
        }`,
        code: 'ENOINSTANCEINFO',
      });
    }
    return connectionInstance.instance;
  }
}

export interface SqlDataState {
  allowed: boolean;
  cooldownUntil: number;
  lastErr?: Error;
  backoffCounter: number;
}

export interface ConnectorOptions {
  auth?: GoogleAuth<AuthClient> | AuthClient;
  sqlAdminAPIEndpoint?: string;
  /**
   * The Trusted Partner Cloud (TPC) Domain DNS of the service used to make requests.
   * Defaults to `googleapis.com`.
   */
  universeDomain?: string;
  userAgent?: string;
  sqlDataEndpoint?: string;
  sqlDataStreamTimeout?: number;
  sqlDataKeepAliveTimeMs?: number;
  sqlDataKeepAliveTimeoutMs?: number;
  resourceExhaustedCooldownPeriod?: number;
}

// The Connector class is the main public API to interact
// with the Cloud SQL Node.js Connector.
export class Connector {
  private readonly instances: CloudSQLInstanceMap;
  private readonly sqlAdminFetcher: SQLAdminFetcher;
  private readonly localProxies: Set<Server>;
  private readonly sockets: Set<Socket>;
  private readonly sqlDataEndpoint?: string;
  private readonly sqlDataStreamTimeout?: number;
  private readonly sqlDataKeepAliveTimeMs?: number;
  private readonly sqlDataKeepAliveTimeoutMs?: number;
  private readonly resourceExhaustedCooldownPeriod: number;
  private readonly sqlDataTunnels = new Map<string, SqlDataClient>();
  private readonly sqlDataStates = new Map<string, SqlDataState>();
  private readonly sqlDataFallbackIpTypes = new Map<string, IpAddressTypes>();

  constructor(opts: ConnectorOptions = {}) {
    this.sqlAdminFetcher = new SQLAdminFetcher({
      loginAuth: opts.auth,
      sqlAdminAPIEndpoint: opts.sqlAdminAPIEndpoint,
      universeDomain: opts.universeDomain,
      userAgent: opts.userAgent,
    });
    this.instances = new CloudSQLInstanceMap(this.sqlAdminFetcher);
    this.localProxies = new Set();
    this.sockets = new Set();
    this.sqlDataEndpoint = opts.sqlDataEndpoint;
    this.sqlDataStreamTimeout = opts.sqlDataStreamTimeout;
    this.sqlDataKeepAliveTimeMs = opts.sqlDataKeepAliveTimeMs;
    this.sqlDataKeepAliveTimeoutMs = opts.sqlDataKeepAliveTimeoutMs;
    this.resourceExhaustedCooldownPeriod =
      opts.resourceExhaustedCooldownPeriod ?? 5000;
  }

  private getSqlDataState(connectionName: string): SqlDataState {
    let state = this.sqlDataStates.get(connectionName);
    if (!state) {
      state = {
        allowed: true,
        cooldownUntil: 0,
        backoffCounter: 0,
      };
      this.sqlDataStates.set(connectionName, state);
    }
    return state;
  }

  // Connector.getOptions is a method that accepts a Cloud SQL instance
  // connection name along with the connection type and returns an object
  // that can be used to configure a driver to be used with Cloud SQL. e.g:
  //
  // const connector = new Connector()
  // const opts = await connector.getOptions({
  //   ipType: 'PUBLIC',
  //   instanceConnectionName: 'PROJECT:REGION:INSTANCE',
  // });
  // const pool = new Pool(opts)
  // const res = await pool.query('SELECT * FROM pg_catalog.pg_tables;')
  async getOptions(opts: ConnectionOptions): Promise<DriverOptions> {
    const {instances} = this;

    const instanceInfo = await resolveInstanceName(
      opts.instanceConnectionName,
      opts.domainName,
      this.sqlAdminFetcher
    );
    const connectionName = `${instanceInfo.projectId}:${instanceInfo.regionId}:${instanceInfo.instanceId}`;

    let ipType = opts.ipType || IpAddressTypes.PUBLIC;

    const state = this.getSqlDataState(connectionName);

    if (ipType === IpAddressTypes.SQL_DATA) {
      if (!state.allowed) {
        ipType =
          this.sqlDataFallbackIpTypes.get(connectionName) ||
          (await this.getFallbackIpType(instanceInfo));
      } else if (state.cooldownUntil && Date.now() < state.cooldownUntil) {
        throw new CloudSQLConnectorError({
          message: `Resource exhausted: cooldown active for ${connectionName}`,
          code: 'ERESOURCEEXHAUSTED',
          errors: state.lastErr ? [state.lastErr] : [],
        });
      }
    }

    const resolvedOpts: ConnectionOptions = {
      ...opts,
      ipType,
    };

    await instances.loadInstance(resolvedOpts);

    if (ipType === IpAddressTypes.SQL_DATA) {
      return await this.developerEditionOptions(
        connectionName,
        instances,
        resolvedOpts,
        instanceInfo
      );
    }

    return {
      stream: () => this.createDirectSocket(instances, resolvedOpts),
    };
  }

  private async getFallbackIpType(
    instanceInfo: InstanceConnectionInfo
  ): Promise<IpAddressTypes> {
    const metadata =
      await this.sqlAdminFetcher.getInstanceMetadata(instanceInfo);
    if (metadata.ipAddresses.private) {
      return IpAddressTypes.PRIVATE;
    }
    if (metadata.ipAddresses.psc) {
      return IpAddressTypes.PSC;
    }
    if (metadata.ipAddresses.public) {
      return IpAddressTypes.PUBLIC;
    }
    return IpAddressTypes.PUBLIC;
  }

  private createDirectSocket(
    instances: CloudSQLInstanceMap,
    opts: ConnectionOptions
  ): TLSSocket {
    const cloudSqlInstance = instances.getInstance(opts);
    const {
      instanceInfo,
      ephemeralCert,
      host,
      port,
      privateKey,
      serverCaCert,
      dnsName,
    } = cloudSqlInstance;

    if (
      instanceInfo &&
      ephemeralCert &&
      host &&
      port &&
      privateKey &&
      serverCaCert
    ) {
      const tlsSocket = getSocket({
        instanceInfo,
        ephemeralCert,
        host,
        port,
        privateKey,
        serverCaCert,
        instanceDnsName: dnsName,
        serverName: instanceInfo.domainName || dnsName, // use the configured domain name, or the instance dnsName.
      });
      tlsSocket.once('error', () => {
        cloudSqlInstance.forceRefresh();
      });
      tlsSocket.once('secureConnect', async () => {
        cloudSqlInstance.setEstablishedConnection();
      });

      cloudSqlInstance.addSocket(tlsSocket);

      return tlsSocket;
    }

    throw new CloudSQLConnectorError({
      message: 'Invalid Cloud SQL Instance info',
      code: 'EBADINSTANCEINFO',
    });
  }

  private async developerEditionOptions(
    connectionName: string,
    instances: CloudSQLInstanceMap,
    opts: ConnectionOptions,
    instanceInfo: InstanceConnectionInfo
  ): Promise<DriverOptions> {
    const state = this.getSqlDataState(connectionName);
    const cooldownPeriod =
      opts.resourceExhaustedCooldownPeriod ??
      this.resourceExhaustedCooldownPeriod;

    let tunnel = this.sqlDataTunnels.get(connectionName);
    if (!tunnel) {
      const getDirectSocket = async () => {
        const fallbackIpType = await this.getFallbackIpType(instanceInfo);
        this.sqlDataFallbackIpTypes.set(connectionName, fallbackIpType);
        const fallbackOpts: ConnectionOptions = {
          ...opts,
          ipType: fallbackIpType,
        };
        await instances.loadInstance(fallbackOpts);
        return this.createDirectSocket(instances, fallbackOpts);
      };

      tunnel = new SqlDataClient({
        instanceConnectionName: connectionName,
        auth: this.sqlAdminFetcher.adminAuth,
        endpoint: opts.sqlDataEndpoint || this.sqlDataEndpoint,
        streamTimeout: opts.sqlDataStreamTimeout || this.sqlDataStreamTimeout,
        keepAliveTimeMs:
          opts.sqlDataKeepAliveTimeMs || this.sqlDataKeepAliveTimeMs,
        keepAliveTimeoutMs:
          opts.sqlDataKeepAliveTimeoutMs || this.sqlDataKeepAliveTimeoutMs,
        getDirectSocket,
        onUnsupported: () => {
          state.allowed = false;
        },
        onResourceExhausted: (err: Error) => {
          if (state.backoffCounter < 5) {
            state.backoffCounter++;
          }
          const backoff = cooldownBackoff(cooldownPeriod, state.backoffCounter);
          state.cooldownUntil = Date.now() + backoff;
          state.lastErr = err;
        },
        onSuccess: () => {
          state.backoffCounter = 0;
          state.cooldownUntil = 0;
          state.lastErr = undefined;
        },
      });
      this.sqlDataTunnels.set(connectionName, tunnel);
    }

    const tunnelPort = await tunnel.start();

    return {
      stream: () => {
        if (!state.allowed) {
          const fallbackIpType =
            this.sqlDataFallbackIpTypes.get(connectionName) ||
            IpAddressTypes.PUBLIC;
          const fallbackOpts: ConnectionOptions = {
            ...opts,
            ipType: fallbackIpType,
          };
          return this.createDirectSocket(instances, fallbackOpts);
        }

        if (state.cooldownUntil && Date.now() < state.cooldownUntil) {
          throw new CloudSQLConnectorError({
            message: `Resource exhausted: cooldown active for ${connectionName}`,
            code: 'ERESOURCEEXHAUSTED',
            errors: state.lastErr ? [state.lastErr] : [],
          });
        }

        const socket = new Socket();
        socket.connect(tunnelPort, '127.0.0.1');
        socket.setKeepAlive(true, 30 * 1000);

        const cloudSqlInstance = instances.getInstance(opts);
        socket.once('connect', () => {
          cloudSqlInstance.setEstablishedConnection();
        });
        socket.once('error', () => {
          cloudSqlInstance.forceRefresh();
        });

        cloudSqlInstance.addSocket(socket);

        socket.connect = () => socket;

        return socket;
      },
    };
  }

  async getTediousOptions({
    authType,
    ipType,
    instanceConnectionName,
  }: ConnectionOptions): Promise<TediousDriverOptions> {
    if (authType === AuthTypes.IAM) {
      throw new CloudSQLConnectorError({
        message: 'Tedious does not support Auto IAM DB Authentication',
        code: 'ENOIAM',
      });
    }
    const driverOptions = await this.getOptions({
      authType,
      ipType,
      instanceConnectionName,
    });
    return {
      async connector() {
        return driverOptions.stream();
      },
      // note: the connector handles a secured encrypted connection
      // with that in mind, the driver encryption is disabled here
      encrypt: false,
    };
  }

  // Connector.startLocalProxy is an alternative to Connector.getOptions that
  // creates a local Unix domain socket to listen and proxy data to and from a
  // Cloud SQL instance. Can be used alongside a database driver or ORM e.g:
  //
  // const path = resolve('.s.PGSQL.5432'); // postgres-required socket filename
  // const connector = new Connector();
  // await connector.startLocalProxy({
  //   instanceConnectionName,
  //   ipType: 'PUBLIC',
  //   listenOptions: {path},
  // });
  // const datasourceUrl =
  //  `postgresql://${user}@localhost/${database}?host=${process.cwd()}`;
  // const prisma = new PrismaClient({ datasourceUrl });
  async startLocalProxy({
    authType,
    ipType,
    instanceConnectionName,
    listenOptions,
  }: SocketConnectionOptions): Promise<void> {
    const {stream} = await this.getOptions({
      authType,
      ipType,
      instanceConnectionName,
    });

    // Opens a local server that listens
    // to the location defined by `listenOptions`
    const server = createServer();
    this.localProxies.add(server);

    /* c8 ignore next 3 */
    server.once('error', err => {
      console.error(err);
    });

    server.once('close', () => {
      this.localProxies.delete(server);
    });

    // When a connection is established, pipe data from the
    // local proxy server to the secure TCP Socket and vice-versa.
    server.on('connection', c => {
      const s = stream();
      this.sockets.add(s);
      this.sockets.add(c);
      s.once('close', () => {
        this.sockets.delete(s);
      });
      c.once('close', () => {
        this.sockets.delete(c);
      });
      c.pipe(s);
      s.pipe(c);
    });

    const listen = promisify(server.listen) as Function;
    await listen.call(server, {
      path: listenOptions.path,
      readableAll: listenOptions.readableAll,
      writableAll: listenOptions.writableAll,
    });
  }

  // Clear up the event loop from the internal cloud sql
  // instances timeout callbacks that refreshs instance info.
  //
  // Also clear up any local proxy servers and socket connections.
  close(): void {
    for (const instance of this.instances.values()) {
      instance.promise.then(inst => inst.close());
    }
    for (const server of this.localProxies) {
      server.close();
    }
    for (const socket of this.sockets) {
      socket.destroy();
    }
    for (const tunnel of this.sqlDataTunnels.values()) {
      tunnel.close();
    }
  }
}
