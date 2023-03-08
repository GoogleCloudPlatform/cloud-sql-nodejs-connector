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

import {CloudSQLConnectorError} from './errors';

type Crypto = typeof import('node:crypto');
export async function cryptoModule(): Promise<Crypto> {
  // check for availability of crypto module and throws an error otherwise
  // ref: https://nodejs.org/dist/latest-v18.x/docs/api/crypto.html#determining-if-crypto-support-is-unavailable
  let crypto;
  try {
    crypto = await import('node:crypto');
    /* c8 ignore next 6 */
  } catch (err) {
    throw new CloudSQLConnectorError({
      message: 'Support to node crypto module is required',
      code: 'ENOCRYPTOMODULE',
    });
  }
  return crypto;
}
