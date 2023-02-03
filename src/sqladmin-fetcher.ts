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

import {GoogleAuth} from 'google-auth-library';
import {sqladmin_v1beta4} from '@googleapis/sqladmin';
const {Sqladmin} = sqladmin_v1beta4;
import {InstanceConnectionInfo} from './instance-connection-info';

interface IpAdresses {
  public?: string;
  private?: string;
}

type SslCert = Pick<sqladmin_v1beta4.Schema$SslCert, 'cert' | 'expirationTime'>;

interface InstanceMetadata {
  ipAddresses: IpAdresses;
  serverCaCert: SslCert;
}

const noResponseDataError = (projectId: string, instanceId: string) =>
  Object.assign(
    new Error(
      `Failed to find metadata on project id: ${projectId} ` +
        `and instance id: ${instanceId}. Ensure network connectivity and ` +
        'validate the provided `instanceConnectionName` config value'
    ),
    {code: 'ENOSQLADMIN'}
  );

const noCertError = () =>
  Object.assign(
    new Error('Cannot connect to instance, no valid CA certificate found'),
    {
      code: 'ENOSQLADMINCERT',
    }
  );

const noIpAddressError = () =>
  Object.assign(
    new Error('Cannot connect to instance, it has no supported IP addresses'),
    {
      code: 'ENOSQLADMINIPADDRESS',
    }
  );

const noRegionError = () =>
  Object.assign(
    new Error('Cannot connect to instance, no valid region found'),
    {
      code: 'ENOSQLADMINREGION',
    }
  );

const regionMismatchError = (regionResult: string, regionId: string) =>
  Object.assign(
    new Error(
      `Provided region was mismatched. Got ${regionResult}, want ${regionId}`
    ),
    {
      code: 'EBADSQLADMINREGION',
    }
  );

const parseIpAddresses = (
  ipResponse: sqladmin_v1beta4.Schema$IpMapping[]
): IpAdresses => {
  const ipAddresses: IpAdresses = {};
  for (const ip of ipResponse) {
    if (ip.type === 'PRIMARY' && ip.ipAddress) {
      ipAddresses.public = ip.ipAddress;
    }
    if (ip.type === 'PRIVATE' && ip.ipAddress) {
      ipAddresses.private = ip.ipAddress;
    }
  }

  if (!ipAddresses.public && !ipAddresses.private) {
    throw noIpAddressError();
  }

  return ipAddresses;
};

export class SQLAdminFetcher {
  private readonly client: sqladmin_v1beta4.Sqladmin;

  constructor() {
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/sqlservice.admin'],
    });
    this.client = new Sqladmin({auth});
  }

  async getInstanceMetadata({
    projectId,
    regionId,
    instanceId,
  }: InstanceConnectionInfo): Promise<InstanceMetadata> {
    const res = await this.client.connect.get({
      project: projectId,
      instance: instanceId,
    });

    if (!res.data) {
      throw noResponseDataError(projectId, instanceId);
    }

    if (!res.data.ipAddresses) {
      throw noIpAddressError();
    }
    const ipAddresses = parseIpAddresses(res.data.ipAddresses);

    const {serverCaCert} = res.data;
    if (!serverCaCert || !serverCaCert.cert) {
      throw noCertError();
    }

    const {region} = res.data;
    if (!region) {
      throw noRegionError();
    }
    if (region !== regionId) {
      throw regionMismatchError(region, regionId);
    }

    return {
      ipAddresses,
      serverCaCert: {
        cert: serverCaCert.cert,
        expirationTime: serverCaCert.expirationTime,
      },
    };
  }
}
