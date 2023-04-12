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
import {generateKeys} from './crypto';
import {RSAKeys} from './rsa-keys';
import {SslCert} from './ssl-cert';
import {getRefreshInterval} from './time';

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
  ipType: IpAdressesTypes;
  instanceConnectionName: string;
  sqlAdminFetcher: Fetcher;
}

export class CloudSQLInstance {
  static async getCloudSQLInstance(
    options: CloudSQLInstanceOptions
  ): Promise<CloudSQLInstance> {
    const instance = new CloudSQLInstance(options);
    await instance.refresh();
    return instance;
  }

  private readonly ipType: IpAdressesTypes;
  private readonly sqlAdminFetcher: Fetcher;
  private refreshTimeoutID?: ReturnType<typeof setTimeout>;
  private closed = false;
  public readonly instanceInfo: InstanceConnectionInfo;
  public ephemeralCert?: SslCert;
  public host?: string;
  public privateKey?: string;
  public serverCaCert?: SslCert;

  constructor({
    ipType,
    instanceConnectionName,
    sqlAdminFetcher,
  }: CloudSQLInstanceOptions) {
    this.ipType = ipType;
    this.instanceInfo = parseInstanceConnectionName(instanceConnectionName);
    this.sqlAdminFetcher = sqlAdminFetcher;
  }

  async refresh(): Promise<void> {
    const rsaKeys: RSAKeys = await generateKeys();
    const metadata: InstanceMetadata =
      await this.sqlAdminFetcher.getInstanceMetadata(this.instanceInfo);

    this.ephemeralCert = await this.sqlAdminFetcher.getEphemeralCertificate(
      this.instanceInfo,
      rsaKeys.publicKey
    );
    this.host = selectIpAddress(metadata.ipAddresses, this.ipType);
    this.privateKey = rsaKeys.privateKey;
    this.serverCaCert = metadata.serverCaCert;

    if (!this.closed) {
      this.refreshTimeoutID = setTimeout(() => {
        this.refresh();
      }, getRefreshInterval(this.ephemeralCert.expirationTime));
    }
  }

  close(): void {
    if (this.refreshTimeoutID) {
      clearTimeout(this.refreshTimeoutID);
    }
    this.closed = true;
  }
}
