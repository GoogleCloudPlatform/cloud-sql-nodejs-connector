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
import {CloudSQLInstance} from './cloud-sql-instance';
import {getSocket} from './socket';
import {IpAdressesTypes} from './ip-addresses';
import {SQLAdminFetcher} from './sqladmin-fetcher';
import {CloudSQLConnectorError} from './errors';

// ConnectionOptions are the arguments that the user can provide
// to the Connector.getOptions method when calling it, e.g:
// const connector = new Connector()
// const connectionOptions:ConnectionOptions = {
//   type: 'PUBLIC',
//   instanceConnectionName: 'PROJECT:REGION:INSTANCE',
// };
// await connector.getOptions(connectionOptions);
export declare interface ConnectionOptions {
  ipType: IpAdressesTypes;
  instanceConnectionName: string;
}

interface StreamFunction {
  (): tls.TLSSocket;
}

// DriverOptions is the interface describing the object returned by
// the Connector.getOptions method, e.g:
// const connector = new Connector()
// const driverOptions:DriverOptions = await connector.getOptions({
//   type: 'PUBLIC',
//   instanceConnectionName: 'PROJECT:REGION:INSTANCE',
// });
export declare interface DriverOptions {
  ssl: boolean;
  stream: StreamFunction;
}

// Internal mapping of the CloudSQLInstances that
// adds extra logic to async initialize items.
class CloudSQLInstanceMap extends Map {
  async loadInstance({
    ipType,
    instanceConnectionName,
    sqlAdminFetcher,
  }: {
    ipType: IpAdressesTypes;
    instanceConnectionName: string;
    sqlAdminFetcher: SQLAdminFetcher;
  }): Promise<void> {
    // in case an instance to that connection name has already
    // been setup there's no need to set it up again
    if (this.has(instanceConnectionName)) {
      return;
    }
    const connectionInstance = await CloudSQLInstance.getCloudSQLInstance({
      connectionType: ipType,
      instanceConnectionName,
      sqlAdminFetcher: sqlAdminFetcher,
    });
    this.set(instanceConnectionName, connectionInstance);
  }

  getInstance(instanceConnectionName: string): CloudSQLInstance {
    const connectionInstance = this.get(instanceConnectionName);
    if (!connectionInstance) {
      throw new CloudSQLConnectorError({
        message: `Cannot find info for instance: ${instanceConnectionName}`,
        code: 'ENOINSTANCEINFO',
      });
    }
    return connectionInstance;
  }
}

const getIpAddressType = (type: IpAdressesTypes): IpAdressesTypes | undefined =>
  Object.values(IpAdressesTypes).find(x => x === type);

// The Connector class is the main public API to interact
// with the Cloud SQL Node.js Connector.
export class Connector {
  private readonly instances: CloudSQLInstanceMap;
  private readonly sqlAdminFetcher: SQLAdminFetcher;

  constructor() {
    this.instances = new CloudSQLInstanceMap();
    this.sqlAdminFetcher = new SQLAdminFetcher();
  }

  // Connector.getOptions is a method that accepts a Cloud SQL instance
  // connection name along with the connection type and returns an object
  // that can be used to configure a driver to be used with Cloud SQL. e.g:
  //
  // const connector = new Connector()
  // const opts = await connector.getOptions({
  //   type: 'PUBLIC',
  //   instanceConnectionName: 'PROJECT:REGION:INSTANCE',
  // });
  // const pool = new Pool(opts)
  // const res = await pool.query('SELECT * FROM pg_catalog.pg_tables;')
  async getOptions({
    ipType: rawType,
    instanceConnectionName,
  }: ConnectionOptions): Promise<DriverOptions> {
    const ipType = getIpAddressType(rawType);
    if (!ipType) {
      throw new CloudSQLConnectorError({
        message: `Invalid IP type: ${String(
          rawType
        )}, expected PUBLIC or PRIVATE`,
        code: 'EBADCONNTYPE',
      });
    }

    const {instances} = this;
    await instances.loadInstance({
      ipType,
      instanceConnectionName,
      sqlAdminFetcher: this.sqlAdminFetcher,
    });

    return {
      stream() {
        const {instanceInfo, ephemeralCert, host, privateKey, serverCaCert} =
          instances.getInstance(instanceConnectionName);

        if (
          instanceInfo &&
          ephemeralCert &&
          host &&
          privateKey &&
          serverCaCert
        ) {
          return getSocket({
            instanceInfo,
            ephemeralCert,
            host,
            privateKey,
            serverCaCert,
          });
        }

        throw new CloudSQLConnectorError({
          message: 'Invalid Cloud SQL Instance info',
          code: 'EBADINSTANCEINFO',
        });
      },
      ssl: false,
    };
  }

  // clear up the event loop from the internal cloud sql
  // instances timeout callbacks that refresh instance info
  close(): void {
    for (const instance of this.instances.values()) {
      instance.close();
    }
  }
}
