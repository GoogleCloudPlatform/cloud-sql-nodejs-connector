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
  private ongoingRefreshPromise?: Promise<void>;
  private scheduledRefreshID?: ReturnType<typeof setTimeout>;
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
    this.ongoingRefreshPromise = this.throttle
      ? this.throttle(this._refresh).call(this)
      : this._refresh();
    await this.ongoingRefreshPromise;
    this.ongoingRefreshPromise = undefined;

    // Initializing the rate limiter at the end of the function so that the
    // first refresh cycle is never rate-limited, ensuring there are 2 calls
    // allowed prior to start waiting a throttle interval.
    await this.initializeRateLimiter();
  }

  private async _refresh(): Promise<void> {
    const rsaKeys: RSAKeys = await generateKeys();
    const metadata: InstanceMetadata =
      await this.sqlAdminFetcher.getInstanceMetadata(this.instanceInfo);

    this.ephemeralCert = await this.sqlAdminFetcher.getEphemeralCertificate(
      this.instanceInfo,
      rsaKeys.publicKey,
      this.authType
    );
    this.host = selectIpAddress(metadata.ipAddresses, this.ipType);
    this.privateKey = rsaKeys.privateKey;
    this.serverCaCert = metadata.serverCaCert;

    this.scheduledRefreshID = setTimeout(() => {
      this.refresh();
    }, getRefreshInterval(this.ephemeralCert.expirationTime));
  }

  cancelRefresh(): void {
    if (this.scheduledRefreshID) {
      clearTimeout(this.scheduledRefreshID);
    }
  }
}
