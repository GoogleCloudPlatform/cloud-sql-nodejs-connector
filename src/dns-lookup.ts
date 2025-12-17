// Copyright 2025 Google LLC
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

import dns from 'node:dns';
import {CloudSQLConnectorError} from './errors';

export async function resolveTxtRecord(name: string): Promise<string> {
  return new Promise((resolve, reject) => {
    dns.resolveTxt(name, (err, addresses) => {
      if (err) {
        reject(
          new CloudSQLConnectorError({
            code: 'EDOMAINNAMELOOKUPERROR',
            message: 'Error looking up TXT record for domain ' + name,
            errors: [err],
          })
        );
        return;
      }

      if (!addresses || addresses.length === 0) {
        reject(
          new CloudSQLConnectorError({
            code: 'EDOMAINNAMELOOKUPFAILED',
            message: 'No records returned for domain ' + name,
          })
        );
        return;
      }

      // Each result may be split into multiple strings. Join the strings.
      const joinedAddresses = addresses.map(strs => strs.join(''));
      // Sort the results alphabetically for consistency,
      joinedAddresses.sort((a, b) => a.localeCompare(b));
      // Return the first result.
      resolve(joinedAddresses[0]);
    });
  });
}

export async function resolveARecord(name: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    dns.resolve4(name, (err, addresses) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(addresses);
    });
  });
}
