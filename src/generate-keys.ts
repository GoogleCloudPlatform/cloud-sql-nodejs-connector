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

import {promisify} from 'node:util';

export interface RSAKeys {
  privateKey: string;
  publicKey: string;
}

/* c8 ignore next 4 */
const noCryptoModuleError = () =>
  Object.assign(new Error('Support to node crypto module is required'), {
    code: 'ENOCRYPTOMODULE',
  });

export async function generateKeys(): Promise<RSAKeys> {
  // check for availability of crypto module and throws an error otherwise
  // ref: https://nodejs.org/dist/latest-v18.x/docs/api/crypto.html#determining-if-crypto-support-is-unavailable
  let crypto;
  try {
    crypto = await import('node:crypto');
    /* c8 ignore next 3 */
  } catch (err) {
    throw noCryptoModuleError();
  }
  const keygen = promisify(crypto.generateKeyPair);

  const {privateKey, publicKey} = await keygen('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: {
      type: 'pkcs1',
      format: 'pem',
    },
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
  });

  return {
    privateKey,
    publicKey,
  };
}
