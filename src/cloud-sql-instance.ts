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

import {IpAdressesTypes, selectIpAddress} from './ip-addresses';
import {InstanceConnectionInfo} from './instance-connection-info';
import {parseInstanceConnectionName} from './parse-instance-connection-name';
import {InstanceMetadata} from './sqladmin-fetcher';
import {generateKeys, RSAKeys} from './generate-keys';
import {SslCert} from './ssl-cert';

interface Fetcher {
  getInstanceMetadata({
    projectId,
    regionId,
    instanceId,
  }: InstanceConnectionInfo): Promise<InstanceMetadata>;
  getEphemeralCertificate(
    instanceConnectionInfo: InstanceConnectionInfo,
    publicKey: string
  ): Promise<SslCert>;
}

interface CloudSQLInstanceOptions {
  connectionType: IpAdressesTypes;
  instanceConnectionName: string;
  sqlAdminFetcher: Fetcher;
}

export class CloudSQLInstance {
  static async getCloudSQLInstance(
    options: CloudSQLInstanceOptions
  ): Promise<CloudSQLInstance> {
    const instance = new CloudSQLInstance(options);
    await instance.init();
    return instance;
  }

  private readonly connectionType: IpAdressesTypes;
  private readonly sqlAdminFetcher: Fetcher;
  public readonly connectionInfo: InstanceConnectionInfo;
  public ephemeralCert?: SslCert;
  public host?: string;
  public privateKey?: string;
  public serverCaCert?: SslCert;

  constructor({
    connectionType,
    instanceConnectionName,
    sqlAdminFetcher,
  }: CloudSQLInstanceOptions) {
    this.connectionType = connectionType;
    this.connectionInfo = parseInstanceConnectionName(instanceConnectionName);
    this.sqlAdminFetcher = sqlAdminFetcher;
  }

  async init(): Promise<void> {
    const rsaKeys: RSAKeys = await generateKeys();
    const metadata: InstanceMetadata =
      await this.sqlAdminFetcher.getInstanceMetadata(this.connectionInfo);
    this.ephemeralCert = await this.sqlAdminFetcher.getEphemeralCertificate(
      this.connectionInfo,
      rsaKeys.publicKey
    );
    this.host = selectIpAddress(metadata.ipAddresses, this.connectionType);
    this.privateKey = rsaKeys.privateKey;
    this.serverCaCert = metadata.serverCaCert;
  }
}
