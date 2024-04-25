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

import {EventEmitter} from 'node:events';
import t from 'tap';
import {Connector} from '../src/connector';
import {setupCredentials} from './fixtures/setup-credentials';
import {IpAddressTypes} from '../src/ip-addresses';
import {CA_CERT, CLIENT_CERT, CLIENT_KEY} from './fixtures/certs';
import {AuthTypes} from '../src/auth-types';
import {SQLAdminFetcherOptions} from '../src/sqladmin-fetcher';

t.test('Connector', async t => {
  setupCredentials(t); // setup google-auth credentials mocks

  // mocks sql admin fetcher and generateKeys modules
  // so that they can return a deterministic result
  const {Connector} = t.mockRequire('../src/connector', {
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
    '../src/cloud-sql-instance': t.mockRequire('../src/cloud-sql-instance', {
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
  t.same(
    typeof opts.stream,
    'function',
    'should return expected factory method'
  );
  connector.close();
});

t.test('Connector missing instance info error', async t => {
  setupCredentials(t); // setup google-auth credentials mocks

  // mocks sql admin fetcher and generateKeys modules
  // so that they can return a deterministic result
  const {Connector} = t.mockRequire('../src/connector', {
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
    authType: 'PASSWORD',
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
  const {Connector} = t.mockRequire('../src/connector', {
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
          return {
            ipType: 'PUBLIC',
          };
        },
      },
    },
  });

  const connector = new Connector();
  const opts = await connector.getOptions({
    ipType: 'PUBLIC',
    authType: 'PASSWORD',
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
  const {Connector} = t.mockRequire('../src/connector', {
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
            ipType: IpAddressTypes.PUBLIC,
            authType: AuthTypes.PASSWORD,
          };
        },
      },
    },
  });

  const connector = new Connector();
  await connector.getOptions({
    ipType: 'PUBLIC',
    authType: 'PASSWORD',
    instanceConnectionName: 'foo:bar:baz',
  });
  await connector.getOptions({
    ipType: 'PUBLIC',
    authType: 'PASSWORD',
    instanceConnectionName: 'foo:bar:baz',
  });
});

t.test('Connector reusing instance on mismatching auth type', async t => {
  setupCredentials(t);

  // mocks sql admin fetcher and generateKeys modules
  // so that they can return a deterministic result
  const {Connector} = t.mockRequire('../src/connector', {
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
          return {
            ipType: IpAddressTypes.PUBLIC,
            authType: AuthTypes.PASSWORD,
          };
        },
      },
    },
  });

  const connector = new Connector();
  await connector.getOptions({
    ipType: 'PUBLIC',
    authType: 'PASSWORD',
    instanceConnectionName: 'foo:bar:baz',
  });

  return t.rejects(
    connector.getOptions({
      ipType: 'PUBLIC',
      authType: 'IAM',
      instanceConnectionName: 'foo:bar:baz',
    }),
    {
      message:
        'getOptions called for instance foo:bar:baz' +
        ' with authType IAM, but was previously called with authType PASSWORD.' +
        ' If you require both for your use case, please use a new connector object.',
      code: 'EMISMATCHAUTHTYPE',
    },
    'should throw error'
  );
});

t.test('Connector factory method mismatch auth type', async t => {
  setupCredentials(t); // setup google-auth credentials mocks

  // mocks sql admin fetcher and generateKeys modules
  // so that they can return a deterministic result
  const {Connector} = t.mockRequire('../src/connector', {
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
          return {
            authType: 'IAM',
            ipType: 'PUBLIC',
          };
        },
      },
    },
  });

  const connector = new Connector();
  const opts = await connector.getOptions({
    authType: 'PASSWORD',
    ipType: 'PUBLIC',
    instanceConnectionName: 'foo:bar:baz',
  });
  t.throws(
    () => {
      opts.stream(); // calls factory method that returns new socket
    },
    {
      code: 'EMISMATCHAUTHTYPE',
    },
    'should throw a mismatching auth type error'
  );
});

t.test('Connector, supporting Tedious driver', async t => {
  setupCredentials(t); // setup google-auth credentials mocks

  // mocks sql admin fetcher and generateKeys modules
  // so that they can return a deterministic result
  const {Connector} = t.mockRequire('../src/connector', {
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
    '../src/cloud-sql-instance': t.mockRequire('../src/cloud-sql-instance', {
      '../src/crypto': {
        generateKeys: async () => ({
          publicKey: '-----BEGIN PUBLIC KEY-----',
          privateKey: CLIENT_KEY,
        }),
      },
    }),
  });

  // mocks internal getOptions, asserts the stream factory method is called
  const getOptions = Connector.prototype.getOptions;
  Connector.prototype.getOptions = () => ({
    stream: () => 'TLSSocket',
  });
  t.teardown(() => {
    Connector.prototype.getOptions = getOptions; // restore original method
  });

  const connector = new Connector();
  const opts = await connector.getTediousOptions({
    ipType: 'PUBLIC',
    instanceConnectionName: 'my-project:us-east1:my-instance',
  });
  t.same(
    await opts.connector(),
    'TLSSocket', // assert a TLSSocket string as mocked before initialization
    'should define factory method option'
  );
  t.same(opts.encrypt, false, 'should not use driver ssl option');
  connector.close();
});

t.test('Connector using IAM with Tedious driver', async t => {
  setupCredentials(t); // setup google-auth credentials mocks

  const connector = new Connector();
  t.rejects(
    connector.getTediousOptions({
      authType: AuthTypes.IAM,
      ipType: IpAddressTypes.PUBLIC,
      instanceConnectionName: 'my-project:us-east1:my-instance',
    }),
    {
      message: 'Tedious does not support Auto IAM DB Authentication',
      code: 'ENOIAM',
    },
    'should throw a missing iam support error'
  );
});

t.test('Connector force refresh on socket connection error', async t => {
  setupCredentials(t); // setup google-auth credentials mocks

  // Mocks CloudSQLInstance to spy on forceRefresh calls
  let forceRefresh = false;
  const {CloudSQLInstance} = t.mockRequire('../src/cloud-sql-instance', {
    '../src/crypto': {
      generateKeys: async () => ({
        publicKey: '-----BEGIN PUBLIC KEY-----',
        privateKey: CLIENT_KEY,
      }),
    },
  });
  CloudSQLInstance.prototype.forceRefresh = async () => {
    forceRefresh = true;
  };

  // mocks sql admin fetcher and generateKeys modules
  // so that they can return a deterministic result
  const {Connector} = t.mockRequire('../src/connector', {
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
      CloudSQLInstance,
    },
    '../src/socket': {
      getSocket() {
        const mockSocket = new EventEmitter();
        setTimeout(() => {
          mockSocket.emit('error');
        }, 1);
        return mockSocket;
      },
    },
  });

  const connector = new Connector();
  const opts = await connector.getOptions({
    ipType: 'PUBLIC',
    instanceConnectionName: 'my-project:us-east1:my-instance',
  });
  const socket = opts.stream();
  await new Promise((res): void => {
    socket.on('error', () => {
      setTimeout(() => {
        t.ok(forceRefresh, 'should call CloudSQLInstance.forceRefresh');
        res(null);
      }, 1);
    });
  });
  connector.close();
});

t.test('Connector, custom sqlAdminAPIEndpoint', async t => {
  const expectedsqlAdminAPIEndpoint = 'https://sqladmin.mydomain.com';
  let actualsqlAdminAPIEndpoint: string | undefined;
  // mocks sql admin fetcher to check that the custom
  // sqlAdminAPIEndpoint is correctly passed into it
  const {Connector} = t.mockRequire('../src/connector', {
    '../src/sqladmin-fetcher': {
      SQLAdminFetcher: class {
        constructor({sqlAdminAPIEndpoint}: SQLAdminFetcherOptions) {
          actualsqlAdminAPIEndpoint = sqlAdminAPIEndpoint;
        }
      },
    },
  });

  new Connector({sqlAdminAPIEndpoint: expectedsqlAdminAPIEndpoint});

  t.same(actualsqlAdminAPIEndpoint, expectedsqlAdminAPIEndpoint);
});

t.test('Connector, custom universeDomain', async t => {
  const expectedUniverseDomain = 'mydomain.com';
  let actualUniverseDomain: string | undefined;
  // mocks sql admin fetcher to check that the custom
  // universeDomain is correctly passed into it
  const {Connector} = t.mockRequire('../src/connector', {
    '../src/sqladmin-fetcher': {
      SQLAdminFetcher: class {
        constructor({universeDomain}: SQLAdminFetcherOptions) {
          actualUniverseDomain = universeDomain;
        }
      },
    },
  });

  new Connector({universeDomain: expectedUniverseDomain});

  t.same(actualUniverseDomain, expectedUniverseDomain);
});
