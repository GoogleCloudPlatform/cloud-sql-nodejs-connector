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

export interface IpAdresses {
  public?: string;
  private?: string;
}

export const noIpAddressError = () =>
  Object.assign(
    new Error('Cannot connect to instance, it has no supported IP addresses'),
    {
      code: 'ENOSQLADMINIPADDRESS',
    }
  );

export function parseIpAddresses(
  ipResponse: sqladmin_v1beta4.Schema$IpMapping[] | undefined
): IpAdresses {
  if (!ipResponse) {
    throw noIpAddressError();
  }

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
}
