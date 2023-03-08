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
import {RSAKeys} from './rsa-keys';
import {SslCert} from './ssl-cert';
import {cryptoModule} from './node-crypto';
import {CloudSQLConnectorError} from './errors';

// The following is a fallback certificate parser for node14 to work around
// its lack of support to the X509Certificate class parser, this block of code
// can be safely removed once node14 is no longer supported, along with any
// `node14ParseCert` call and its unit tests.
// --- node@14 cert parse fallback start
import net from 'node:net';
import tls from 'node:tls';

const node14ParseCert = (cert: string): SslCert => {
  const isPeerCertificate = (
    obj: object | tls.PeerCertificate
  ): obj is tls.PeerCertificate =>
    (obj as tls.PeerCertificate).valid_to !== undefined;

  let socket;
  let parsed;
  try {
    socket = new tls.TLSSocket(new net.Socket(), {
      secureContext: tls.createSecureContext({cert}),
    });
    parsed = socket.getCertificate();
  } catch (err: unknown) {
    throw new CloudSQLConnectorError({
      message: 'Failed to parse as X.509 certificate.',
      code: 'EPARSESQLADMINEPH',
      errors: [err as Error],
    });
  }

  if (parsed && isPeerCertificate(parsed)) {
    const expirationTime = parsed.valid_to;
    socket.destroy();
    socket = undefined;
    parsed = undefined;

    return {
      cert,
      expirationTime,
    };
  }
  /* c8 ignore next 5 */
  throw new CloudSQLConnectorError({
    message: 'Could not read ephemeral certificate.',
    code: 'EPARSESQLADMINEPH',
  });
};
// --- node@14 cert parse fallback end

export async function generateKeys(): Promise<RSAKeys> {
  const crypto = await cryptoModule();
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

export async function parseCert(cert: string): Promise<SslCert> {
  const {X509Certificate} = await cryptoModule();
  if (X509Certificate) {
    try {
      const parsed = new X509Certificate(cert);
      if (parsed && parsed.validTo) {
        return {
          cert,
          expirationTime: parsed.validTo,
        };
      }

      throw new CloudSQLConnectorError({
        message: 'Could not read ephemeral certificate.',
        code: 'EPARSESQLADMINEPH',
      });
    } catch (err: unknown) {
      throw new CloudSQLConnectorError({
        message: 'Failed to parse as X.509 certificate.',
        code: 'EPARSESQLADMINEPH',
        errors: [err as Error],
      });
    }
  }
  return node14ParseCert(cert);
}
