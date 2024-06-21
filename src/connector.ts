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

import {Server, Socket, createServer} from 'node:net';
import tls from 'node:tls';
import {promisify} from 'node:util';
import {AuthClient, GoogleAuth} from 'google-auth-library';
import {CloudSQLInstance} from './cloud-sql-instance';
import {getSocket} from './socket';
import {IpAddressTypes} from './ip-addresses';
import {AuthTypes} from './auth-types';
import {SQLAdminFetcher} from './sqladmin-fetcher';
import {CloudSQLConnectorError} from './errors';

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
}

export declare interface SocketConnectionOptions extends ConnectionOptions {
  listenOptions: UnixSocketOptions;
}

interface StreamFunction {
  (): tls.TLSSocket;
}

interface PromisedStreamFunction {
  (): Promise<tls.TLSSocket>;
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

// Internal mapping of the CloudSQLInstances that
// adds extra logic to async initialize items.
class CloudSQLInstanceMap extends Map {
  async loadInstance({
    ipType,
    authType,
    instanceConnectionName,
    sqlAdminFetcher,
  }: {
    ipType: IpAddressTypes;
    authType: AuthTypes;
    instanceConnectionName: string;
    sqlAdminFetcher: SQLAdminFetcher;
  }): Promise<void> {
    // in case an instance to that connection name has already
    // been setup there's no need to set it up again
    if (this.has(instanceConnectionName)) {
      const instance = this.get(instanceConnectionName);
      if (instance.authType && instance.authType !== authType) {
        throw new CloudSQLConnectorError({
          message:
            `getOptions called for instance ${instanceConnectionName} with authType ${authType}, ` +
            `but was previously called with authType ${instance.authType}. ` +
            'If you require both for your use case, please use a new connector object.',
          code: 'EMISMATCHAUTHTYPE',
        });
      }
      return;
    }
    const connectionInstance = await CloudSQLInstance.getCloudSQLInstance({
      ipType,
      authType,
      instanceConnectionName,
      sqlAdminFetcher: sqlAdminFetcher,
    });
    this.set(instanceConnectionName, connectionInstance);
  }

  getInstance({
    instanceConnectionName,
    authType,
  }: {
    instanceConnectionName: string;
    authType: AuthTypes;
  }): CloudSQLInstance {
    const connectionInstance = this.get(instanceConnectionName);
    if (!connectionInstance) {
      throw new CloudSQLConnectorError({
        message: `Cannot find info for instance: ${instanceConnectionName}`,
        code: 'ENOINSTANCEINFO',
      });
    } else if (
      connectionInstance.authType &&
      connectionInstance.authType !== authType
    ) {
      throw new CloudSQLConnectorError({
        message:
          `getOptions called for instance ${instanceConnectionName} with authType ${authType}, ` +
          `but was previously called with authType ${connectionInstance.authType}. ` +
          'If you require both for your use case, please use a new connector object.',
        code: 'EMISMATCHAUTHTYPE',
      });
    }
    return connectionInstance;
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
}

// The Connector class is the main public API to interact
// with the Cloud SQL Node.js Connector.
export class Connector {
  private readonly instances: CloudSQLInstanceMap;
  private readonly sqlAdminFetcher: SQLAdminFetcher;
  private readonly localProxies: Set<Server>;
  private readonly sockets: Set<Socket>;

  constructor(opts: ConnectorOptions = {}) {
    this.instances = new CloudSQLInstanceMap();
    this.sqlAdminFetcher = new SQLAdminFetcher({
      loginAuth: opts.auth,
      sqlAdminAPIEndpoint: opts.sqlAdminAPIEndpoint,
      universeDomain: opts.universeDomain,
    });
    this.localProxies = new Set();
    this.sockets = new Set();
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
  async getOptions({
    authType = AuthTypes.PASSWORD,
    ipType = IpAddressTypes.PUBLIC,
    instanceConnectionName,
  }: ConnectionOptions): Promise<DriverOptions> {
    const {instances} = this;
    await instances.loadInstance({
      ipType,
      authType,
      instanceConnectionName,
      sqlAdminFetcher: this.sqlAdminFetcher,
    });

    return {
      stream() {
        const cloudSqlInstance = instances.getInstance({
          instanceConnectionName,
          authType,
        });
        const {
          instanceInfo,
          ephemeralCert,
          host,
          port,
          privateKey,
          serverCaCert,
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
          });
          tlsSocket.once('error', async () => {
            await cloudSqlInstance.forceRefresh();
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
      instance.cancelRefresh();
    }
    for (const server of this.localProxies) {
      server.close();
    }
    for (const socket of this.sockets) {
      socket.destroy();
    }
  }
}
