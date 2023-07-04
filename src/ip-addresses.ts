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

import {sqladmin_v1beta4} from '@googleapis/sqladmin';
import {CloudSQLConnectorError} from './errors';

export enum IpAddressTypes {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
  PSC = 'PSC',
}

export declare interface IpAddresses {
  public?: string;
  private?: string;
  psc?: string;
}

const getPublicIpAddress = (ipAddresses: IpAddresses) => {
  if (!ipAddresses.public) {
    throw new CloudSQLConnectorError({
      message: 'Cannot connect to instance, public Ip address not found',
      code: 'ENOPUBLICSQLADMINIPADDRESS',
    });
  }
  return ipAddresses.public;
};

const getPrivateIpAddress = (ipAddresses: IpAddresses) => {
  if (!ipAddresses.private) {
    throw new CloudSQLConnectorError({
      message: 'Cannot connect to instance, private Ip address not found',
      code: 'ENOPRIVATESQLADMINIPADDRESS',
    });
  }
  return ipAddresses.private;
};

const getPSCIpAddress = (ipAddresses: IpAddresses) => {
  if (!ipAddresses.psc) {
    throw new CloudSQLConnectorError({
      message: 'Cannot connect to instance, PSC address not found',
      code: 'ENOPSCSQLADMINIPADDRESS',
    });
  }
  return ipAddresses.psc;
};

export function parseIpAddresses(
  ipResponse: sqladmin_v1beta4.Schema$IpMapping[] | undefined,
  dnsName: string | null | undefined
): IpAddresses {
  const ipAddresses: IpAddresses = {};
  if (ipResponse) {
    for (const ip of ipResponse) {
      if (ip.type === 'PRIMARY' && ip.ipAddress) {
        ipAddresses.public = ip.ipAddress;
      }
      if (ip.type === 'PRIVATE' && ip.ipAddress) {
        ipAddresses.private = ip.ipAddress;
      }
    }
  }

  if (dnsName) {
    ipAddresses.psc = dnsName;
  }

  if (!ipAddresses.public && !ipAddresses.private && !ipAddresses.psc) {
    throw new CloudSQLConnectorError({
      message: 'Cannot connect to instance, it has no supported IP addresses',
      code: 'ENOSQLADMINIPADDRESS',
    });
  }

  return ipAddresses;
}

export function selectIpAddress(
  ipAddresses: IpAddresses,
  type: IpAddressTypes | unknown
): string {
  switch (type) {
    case IpAddressTypes.PUBLIC:
      return getPublicIpAddress(ipAddresses);
    case IpAddressTypes.PRIVATE:
      return getPrivateIpAddress(ipAddresses);
    case IpAddressTypes.PSC:
      return getPSCIpAddress(ipAddresses);
    default:
      throw new CloudSQLConnectorError({
        message: 'Cannot connect to instance, it has no supported IP addresses',
        code: 'ENOSQLADMINIPADDRESS',
      });
  }
}
