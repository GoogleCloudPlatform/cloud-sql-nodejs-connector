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

import {createServer, Server} from 'node:net';
import tls from 'node:tls';
import {promisify} from 'node:util';
import {AuthClient, GoogleAuth} from 'google-auth-library';
import {CloudSQLInstance} from './cloud-sql-instance';
import {getSocket} from './socket';
import {IpAddressTypes} from './ip-addresses';
import {AuthTypes} from './auth-types';
import {SQLAdminFetcher} from './sqladmin-fetcher';
import {CloudSQLConnectorError} from './errors';
import {SocketWrapper, SocketWrapperOptions} from './socket-wrapper';
import stream from 'node:stream';
import {resolveInstanceName} from './parse-instance-connection-name';
import {InstanceConnectionInfo} from './instance-connection-info';

// These Socket types are subsets from nodejs definitely typed repo, ref:
// https://github.com/DefinitelyTyped/DefinitelyTyped/blob/ae0fe42ff0e6e820e8ae324acf4f8e944aa1b2b7/types/node/v18/net.d.ts#L437
export declare interface UnixSocketOptions {
  path: string | undefined;
  readableAll?: boolean | undefined;
  writableAll?: boolean | undefined;
}

// ConnectionOptions are the arguments that the user can provide
// to the Connector.getOptions method when calling it, e.g:
// const connector = new Connector()
// const connectionOptions:ConnectionOptions = {
//   ipType: 'PUBLIC',
//   instanceConnectionName: 'PROJECT:REGION:INSTANCE',
// };
// await connector.getOptions(connectionOptions);
export declare interface ConnectionOptions {
  authType?: AuthTypes;
  ipType?: IpAddressTypes;
  instanceConnectionName: string;
  domainName?: string;
  checkDomainInterval?: number;
  limitRateInterval?: number;
}

export declare interface SocketConnectionOptions extends ConnectionOptions {
  listenOptions: UnixSocketOptions;
}

interface StreamFunction {
  //eslint-disable-next-line   @typescript-eslint/no-explicit-any
  (...opts: any | undefined): stream.Duplex;
}

interface PromisedStreamFunction {
  //eslint-disable-next-line   @typescript-eslint/no-explicit-any
  (...opts: any | undefined): Promise<stream.Duplex>;
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

  private async cacheKey(
    instanceName: InstanceConnectionInfo,
    opts: ConnectionOptions
  ): Promise<string> {
    let key: Array<string>;
    if (instanceName.domainName) {
      key = [instanceName.domainName];
    } else {
      key = [
        instanceName.projectId,
        instanceName.regionId,
        instanceName.instanceId,
      ];
    }
    key.push(String(opts.authType));
    key.push(String(opts.ipType));

    return key.join('-');
  }

  async loadInstance(opts: ConnectionOptions): Promise<CloudSQLInstance> {
    // in case an instance to that connection name has already
    // been setup there's no need to set it up again
    const instanceName = await resolveInstanceName(
      opts.instanceConnectionName,
      opts.domainName
    );
    const key = await this.cacheKey(instanceName, opts);
    const entry = this.get(key);
    if (entry) {
      if (entry.isResolved()) {
        await entry.instance?.checkDomainChanged();
        if (!entry.instance?.isClosed()) {
          // The instance is open and the domain has not changed.
          // use the cached instance.
          return entry.promise;
        }
      } else if (entry.isError()) {
        // The instance failed it's initial refresh. Remove it from the
        // cache and throw the error.
        this.delete(key);
        throw entry.err;
      } else {
        // The instance initial refresh is in progress.
        return entry.promise;
      }
    }

    // Start the refresh and add a cache entry.
    const instanceOpts = {
      instanceConnectionName: opts.instanceConnectionName,
      domainName: opts.domainName,
      authType: opts.authType || AuthTypes.PASSWORD,
      ipType: opts.ipType || IpAddressTypes.PUBLIC,
      limitRateInterval: opts.limitRateInterval || 30 * 1000, // 30 sec
      sqlAdminFetcher: this.sqlAdminFetcher,
      checkDomainInterval: opts.checkDomainInterval,
    };
    const promise = CloudSQLInstance.getCloudSQLInstance(
      instanceName,
      instanceOpts
    );
    this.set(key, new CacheEntry(promise));

    // Wait for the cache entry to resolve.
    return promise;
  }
}

interface ConnectorOptions {
  auth?: GoogleAuth<AuthClient> | AuthClient;
  sqlAdminAPIEndpoint?: string;
  /**
   * The Trusted Partner Cloud (TPC) Domain DNS of the service used to make requests.
   * Defaults to `googleapis.com`.
   */
  universeDomain?: string;
  userAgent?: string;
}

// The Connector class is the main public API to interact
// with the Cloud SQL Node.js Connector.
export class Connector {
  private readonly instances: CloudSQLInstanceMap;
  private readonly sqlAdminFetcher: SQLAdminFetcher;
  private readonly localProxies: Set<Server>;
  private readonly sockets: Set<stream.Duplex>;

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
  }

  async connect(opts: ConnectionOptions): Promise<tls.TLSSocket> {
    const cloudSqlInstance = await this.instances.loadInstance(opts);

    const {
      instanceInfo,
      ephemeralCert,
      host,
      port,
      privateKey,
      serverCaCert,
      serverCaMode,
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
        serverCaMode,
        dnsName: instanceInfo.domainName || dnsName, // use the configured domain name, or the instance dnsName.
      });
      tlsSocket.once('error', () => {
        cloudSqlInstance.forceRefresh();
      });
      tlsSocket.once('secureConnect', async () => {
        cloudSqlInstance.setEstablishedConnection();
      });
      return tlsSocket;
    }
    throw new CloudSQLConnectorError({
      message: 'Invalid Cloud SQL Instance info',
      code: 'EBADINSTANCEINFO',
    });
  }

  getOptions({
    authType = AuthTypes.PASSWORD,
    ipType = IpAddressTypes.PUBLIC,
    instanceConnectionName,
  }: ConnectionOptions): DriverOptions {
    // bring 'this' into a closure-scope variable.
    //eslint-disable-next-line   @typescript-eslint/no-this-alias
    const connector = this;
    return {
      stream(opts) {
        let host;
        let startConnection = false;
        if (opts) {
          if (opts?.config?.host) {
            // Mysql driver passes the host in the options, and expects
            // this to start the connection.
            host = opts?.config?.host;
            startConnection = true;
          }
          if (opts?.host) {
            // Sql Server (Tedious) driver passes host in the options
            // this to start the connection.
            host = opts?.host;
            startConnection = true;
          }
        } else {
          // Postgres driver does not pass options.
          // Postgres will call Socket.connect(port,host).
          startConnection = false;
        }

        return new SocketWrapper(
          new SocketWrapperOptions({
            connector,
            host,
            startConnection,
            connectionConfig: {
              authType,
              ipType,
              instanceConnectionName,
            },
          })
        );
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
      async connector(opts) {
        return driverOptions.stream(opts);
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

    // When a connection is established, pipe data from the
    // local proxy server to the secure TCP Socket and vice-versa.
    server.on('connection', c => {
      const s = stream();
      this.sockets.add(s);
      this.sockets.add(c);
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
  }
}
