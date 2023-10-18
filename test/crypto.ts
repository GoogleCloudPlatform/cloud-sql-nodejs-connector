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

import t from 'tap';
import {CLIENT_CERT} from './fixtures/certs';
import {parseCert, generateKeys} from '../src/crypto';

t.test('generateKeys', async t => {
  const {privateKey, publicKey} = await generateKeys();
  t.ok(
    privateKey.startsWith('-----BEGIN RSA PRIVATE KEY-----'),
    'should return a private key string'
  );
  t.ok(
    publicKey.startsWith('-----BEGIN PUBLIC KEY-----'),
    'should return a public key string'
  );
});

t.test('parseCert', async t => {
  const {cert, expirationTime} = await parseCert(CLIENT_CERT);
  t.same(cert, CLIENT_CERT, 'should return original cert in response');
  t.same(
    expirationTime,
    'Jul 22 17:53:09 3022 GMT',
    'should return expiration time'
  );
});

t.test('parseCert failure', async t => {
  return t.rejects(
    parseCert('-----BEGIN PUBLIC KEY-----'),
    {
      code: 'EPARSESQLADMINEPH',
    },
    'should throw parse ephemeral cert error'
  );
});

t.test('parseCert missing expiration time', async t => {
  const {parseCert} = t.mockRequire('../src/crypto', {
    '../src/node-crypto': {
      async cryptoModule() {
        return {
          X509Certificate: class {},
        };
      },
    },
  });
  return t.rejects(
    parseCert(CLIENT_CERT),
    {
      code: 'EPARSESQLADMINEPH',
    },
    'should throw parse ephemeral cert error'
  );
});

t.test('parseCert no x509 parser fallback', async t => {
  const {cryptoModule} = t.mockRequire('../src/node-crypto', {});
  const {parseCert} = t.mockRequire('../src/crypto', {
    '../src/node-crypto': {
      async cryptoModule() {
        const mod = cryptoModule();
        return {
          ...mod,
          X509Certificate: undefined,
        };
      },
    },
  });
  const {cert, expirationTime} = await parseCert(CLIENT_CERT);
  t.same(cert, CLIENT_CERT, 'should return original cert in response');
  t.same(
    expirationTime,
    'Jul 22 17:53:09 3022 GMT',
    'should return expiration time'
  );
});

t.test('parseCert no x509 parser fallback failure', async t => {
  const {cryptoModule} = t.mockRequire('../src/node-crypto', {});
  const {parseCert} = t.mockRequire('../src/crypto', {
    '../src/node-crypto': {
      async cryptoModule() {
        const mod = cryptoModule();
        return {
          ...mod,
          X509Certificate: undefined,
        };
      },
    },
  });
  return t.rejects(
    parseCert('-----BEGIN PUBLIC KEY-----'),
    {
      code: 'EPARSESQLADMINEPH',
    },
    'should throw parse ephemeral cert error'
  );
});
