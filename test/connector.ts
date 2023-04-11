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
import {Connector} from '../src/connector';
import {setupCredentials} from './fixtures/setup-credentials';
import {IpAdressesTypes} from '../src/ip-addresses';
import {CA_CERT, CLIENT_CERT, CLIENT_KEY} from './fixtures/certs';

t.test('Connector', async t => {
  setupCredentials(t); // setup google-auth credentials mocks

  // mocks sql admin fetcher and generateKeys modules
  // so that they can return a deterministic result
  const {Connector} = t.mock('../src/connector', {
    '../src/sqladmin-fetcher': {
      SQLAdminFetcher: class {
        getInstanceMetadata() {
          return Promise.resolve({
            ipAddresses: {
              public: '127.0.0.1',
            },
            serverCaCert: {
              cert: CA_CERT,
              expirationTime: '2033-01-06T10:00:00.232Z',
            },
          });
        }
        getEphemeralCertificate() {
          return Promise.resolve({
            cert: CLIENT_CERT,
            expirationTime: '2033-01-06T10:00:00.232Z',
          });
        }
      },
    },
    '../src/cloud-sql-instance': t.mock('../src/cloud-sql-instance', {
      '../src/crypto': {
        generateKeys: async () => ({
          publicKey: '-----BEGIN PUBLIC KEY-----',
          privateKey: CLIENT_KEY,
        }),
      },
    }),
  });

  const connector = new Connector();
  const opts = await connector.getOptions({
    ipType: 'PUBLIC',
    instanceConnectionName: 'my-project:us-east1:my-instance',
  });
  t.same(opts.ssl, false, 'should not use driver ssl options');
  connector.close();
});

t.test('Connector invalid type error', async t => {
  setupCredentials(t); // setup google-auth credentials mocks

  const connector = new Connector();
  t.rejects(
    connector.getOptions({
      ipType: 'foo' as IpAdressesTypes,
      instanceConnectionName: 'my-project:us-east1:my-instance',
    }),
    {
      message: 'Invalid IP type: foo, expected PUBLIC or PRIVATE',
      code: 'EBADCONNIPTYPE',
    },
    'should throw a invalid type error'
  );
});

t.test('Connector missing instance info error', async t => {
  setupCredentials(t); // setup google-auth credentials mocks

  // mocks sql admin fetcher and generateKeys modules
  // so that they can return a deterministic result
  const {Connector} = t.mock('../src/connector', {
    '../src/sqladmin-fetcher': {
      SQLAdminFetcher: class {
        getInstanceMetadata() {
          return Promise.resolve({
            ipAddresses: {
              public: '127.0.0.1',
            },
            serverCaCert: {
              cert: CA_CERT,
              expirationTime: '2033-01-06T10:00:00.232Z',
            },
          });
        }
        getEphemeralCertificate() {
          return Promise.resolve({
            cert: CLIENT_CERT,
            expirationTime: '2033-01-06T10:00:00.232Z',
          });
        }
      },
    },
    '../src/cloud-sql-instance': {
      CloudSQLInstance: {
        async getCloudSQLInstance() {
          return null;
        },
      },
    },
  });

  const connector = new Connector();
  const opts = await connector.getOptions({
    ipType: 'PUBLIC',
    instanceConnectionName: 'foo:bar:baz',
  });
  t.throws(
    () => {
      opts.stream(); // calls factory method that returns new socket
    },
    {
      message: 'Cannot find info for instance: foo:bar:baz',
      code: 'ENOINSTANCEINFO',
    },
    'should throw a missing instance info error'
  );
});

t.test('Connector bad instance info error', async t => {
  setupCredentials(t); // setup google-auth credentials mocks

  // mocks sql admin fetcher and generateKeys modules
  // so that they can return a deterministic result
  const {Connector} = t.mock('../src/connector', {
    '../src/sqladmin-fetcher': {
      SQLAdminFetcher: class {
        getInstanceMetadata() {
          return Promise.resolve({
            ipAddresses: {
              public: '127.0.0.1',
            },
            serverCaCert: {
              cert: CA_CERT,
              expirationTime: '2033-01-06T10:00:00.232Z',
            },
          });
        }
        getEphemeralCertificate() {
          return Promise.resolve({
            cert: CLIENT_CERT,
            expirationTime: '2033-01-06T10:00:00.232Z',
          });
        }
      },
    },
    '../src/cloud-sql-instance': {
      CloudSQLInstance: {
        async getCloudSQLInstance() {
          return {};
        },
      },
    },
  });

  const connector = new Connector();
  const opts = await connector.getOptions({
    ipType: 'PUBLIC',
    instanceConnectionName: 'foo:bar:baz',
  });
  t.throws(
    () => {
      opts.stream(); // calls factory method that returns new socket
    },
    {
      code: 'EBADINSTANCEINFO',
    },
    'should throw a invalid instance info error'
  );
});

t.test('start only a single instance info per connection name', async t => {
  setupCredentials(t); // setup google-auth credentials mocks
  let hasInstance = false;

  // mocks sql admin fetcher and generateKeys modules
  // so that they can return a deterministic result
  const {Connector} = t.mock('../src/connector', {
    '../src/sqladmin-fetcher': {
      SQLAdminFetcher: class {
        getInstanceMetadata() {
          return Promise.resolve({
            ipAddresses: {
              public: '127.0.0.1',
            },
            serverCaCert: {
              cert: CA_CERT,
              expirationTime: '2033-01-06T10:00:00.232Z',
            },
          });
        }
        getEphemeralCertificate() {
          return Promise.resolve({
            cert: CLIENT_CERT,
            expirationTime: '2033-01-06T10:00:00.232Z',
          });
        }
      },
    },
    '../src/cloud-sql-instance': {
      CloudSQLInstance: {
        async getCloudSQLInstance() {
          if (hasInstance) {
            throw new Error('should only initialize once');
          }
          hasInstance = true;
          return {
            connectionType: 'PUBLIC'
          }
        },
      },
    },
  });

  const connector = new Connector();
  await connector.getOptions({
    ipType: 'PUBLIC',
    instanceConnectionName: 'foo:bar:baz',
  });
  await connector.getOptions({
    ipType: 'PUBLIC',
    instanceConnectionName: 'foo:bar:baz',
  });
});
