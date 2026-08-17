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
            checkDomainChanged() {},
            isClosed() {
              return false;
            },
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

t.test(
  'Connector with mismatching auth type creates separate instances',
  async t => {
    setupCredentials(t);
    let instancesCreated = 0;
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
            instancesCreated++;
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
      authType: 'IAM',
      instanceConnectionName: 'foo:bar:baz',
    });

    t.same(
      instancesCreated,
      2,
      'An instance created for each different configuration'
    );
  }
);

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

t.test('Connector, custom userAgent', async t => {
  const expectedUserAgent = 'custom-agent';
  let actualUserAgent: string | undefined;
  // mocks sql admin fetcher to check that the custom
  // userAgent is correctly passed into it
  const {Connector} = t.mockRequire('../src/connector', {
    '../src/sqladmin-fetcher': {
      SQLAdminFetcher: class {
        constructor({userAgent}: SQLAdminFetcherOptions) {
          actualUserAgent = userAgent;
        }
      },
    },
  });

  new Connector({userAgent: expectedUserAgent});

  t.same(actualUserAgent, expectedUserAgent);
});

function setupConnectorModule(t) {
  setupCredentials(t);
  const response = {
    instancesCreated: 0,
    resolveTxtResponse: 'project:region1:instance',
    Connector: null,
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
    '../src/cloud-sql-instance': t.mockRequire('../src/cloud-sql-instance', {
      '../src/crypto': {
        generateKeys: async () => ({
          publicKey: '-----BEGIN PUBLIC KEY-----',
          privateKey: CLIENT_KEY,
        }),
      },
      '../src/dns-lookup': {
        async resolveTxtRecord(): Promise<string[]> {
          return [response.resolveTxtResponse];
        },
        async resolveCnameRecord(): Promise<string> {
          throw new Error('CNAME not mocked');
        },
      },
    }),
    '../src/dns-lookup': {
      async resolveTxtRecord(): Promise<string[]> {
        return [response.resolveTxtResponse];
      },
      async resolveCnameRecord(): Promise<string> {
        throw new Error('CNAME not mocked');
      },
    },
  });
  response.Connector = Connector;

  return response;
}

t.test('Connector by domain resolves and creates instance', async t => {
  const th = setupConnectorModule(t);
  const connector = new th.Connector();
  t.after(() => {
    connector.close();
  });

  // Get options twice
  await connector.getOptions({
    ipType: 'PUBLIC',
    authType: 'PASSWORD',
    domainName: 'db.example.com',
  });

  await connector.getOptions({
    ipType: 'PUBLIC',
    authType: 'PASSWORD',
    domainName: 'db.example.com',
  });

  // Ensure there is only one entry.
  t.same(connector.instances.size, 1);
  const oldInstance = connector.instances.get(
    'db.example.com-PASSWORD-PUBLIC'
  ).instance;
  t.same(oldInstance.instanceInfo.domainName, 'db.example.com');
  t.same(oldInstance.instanceInfo.instanceId, 'instance');
});

t.test(
  'Connector by domain resolves new instance after domain changes',
  async t => {
    const th = setupConnectorModule(t);
    const connector = new th.Connector();
    t.after(() => {
      connector.close();
    });

    // Get options loads the instance
    await connector.getOptions({
      ipType: 'PUBLIC',
      authType: 'PASSWORD',
      domainName: 'db.example.com',
    });

    // Ensure there is only one entry.
    t.same(connector.instances.size, 1);
    const oldInstance = connector.instances.get(
      'db.example.com-PASSWORD-PUBLIC'
    ).instance;
    t.same(oldInstance.instanceInfo.domainName, 'db.example.com');
    t.same(oldInstance.instanceInfo.instanceId, 'instance');

    // getOptions after DNS response changes closes the old instance
    // and loads a new one.
    th.resolveTxtResponse = 'project:region2:instance2';
    await connector.getOptions({
      ipType: 'PUBLIC',
      authType: 'PASSWORD',
      domainName: 'db.example.com',
    });
    t.same(connector.instances.size, 1);
    const newInstance = connector.instances.get(
      'db.example.com-PASSWORD-PUBLIC'
    ).instance;
    t.same(newInstance.instanceInfo.domainName, 'db.example.com');
    t.same(newInstance.instanceInfo.instanceId, 'instance2');
    t.same(oldInstance.isClosed(), true, 'old instance is closed');

    connector.close();
  }
);

t.test(
  'Connector checks if name changes in background and closes connector',
  async t => {
    const th = setupConnectorModule(t);
    const connector = new th.Connector();
    t.after(() => {
      connector.close();
    });

    // Get options loads the instance
    await connector.getOptions({
      ipType: 'PUBLIC',
      authType: 'PASSWORD',
      domainName: 'db.example.com',
      failoverPeriod: 10, // 10ms for testing
    });

    // Ensure there is only one entry.
    t.same(connector.instances.size, 1);
    const oldInstance = connector.instances.get(
      'db.example.com-PASSWORD-PUBLIC'
    ).instance;
    t.same(oldInstance.instanceInfo.domainName, 'db.example.com');
    t.same(oldInstance.instanceInfo.instanceId, 'instance');

    // add a mock socket to the old instance
    const mockSocket = {
      destroyed: false,
      once() {},
      destroy() {
        this.destroyed = true;
      },
    };
    oldInstance.addSocket(mockSocket);

    // getOptions after DNS response changes closes the old instance
    // and loads a new one.
    th.resolveTxtResponse = 'project:region2:instance2';
    await new Promise(res => {
      setTimeout(res, 50);
    });

    t.same(oldInstance.isClosed(), true, 'old instance is closed');
    t.same(mockSocket.destroyed, true, 'old instance closed its sockets');
  }
);

t.test('Connector startLocalProxy manages and cleans up sockets', async t => {
  setupCredentials(t);

  class MockSocket extends EventEmitter {
    destroyed = false;
    pipedTo: unknown = null;
    pipe(dest: unknown) {
      this.pipedTo = dest;
      return dest;
    }
    destroy() {
      this.destroyed = true;
      this.emit('close');
      return this;
    }
  }

  let serverListenOptions: unknown = null;
  let serverClosed = false;
  let mockServer: EventEmitter & {listen: Function; close: Function};

  const {Connector} = t.mockRequire('../src/connector', {
    'node:net': {
      createServer() {
        mockServer = Object.assign(new EventEmitter(), {
          listen(opts: unknown, cb: Function) {
            serverListenOptions = opts;
            if (cb) cb();
          },
          close(cb?: Function) {
            serverClosed = true;
            mockServer.emit('close');
            if (cb) cb();
          },
        });
        return mockServer;
      },
    },
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

  interface ConnectorWithInternals {
    localProxies: Set<unknown>;
    sockets: Set<unknown>;
    startLocalProxy(opts: unknown): Promise<void>;
    close(): void;
    getOptions: (opts: unknown) => Promise<{stream: () => unknown}>;
  }

  const connector = new Connector() as unknown as ConnectorWithInternals;
  const mockStreamSockets: MockSocket[] = [];

  // Mock getOptions to return mock stream sockets
  connector.getOptions = async () => {
    return {
      stream() {
        const s = new MockSocket();
        mockStreamSockets.push(s);
        return s;
      },
    };
  };

  await connector.startLocalProxy({
    ipType: 'PUBLIC',
    instanceConnectionName: 'my-project:us-east1:my-instance',
    listenOptions: {path: '/tmp/test.sock'},
  });

  t.same(
    serverListenOptions,
    {path: '/tmp/test.sock', readableAll: undefined, writableAll: undefined},
    'server should listen with options'
  );
  t.equal(
    connector.localProxies.size,
    1,
    'server should be tracked in localProxies'
  );

  // Simulate a client connecting
  const clientSocket1 = new MockSocket();
  mockServer.emit('connection', clientSocket1);

  t.equal(mockStreamSockets.length, 1, 'stream() should have been called');
  const streamSocket1 = mockStreamSockets[0];

  t.equal(
    clientSocket1.pipedTo,
    streamSocket1,
    'client socket piped to stream socket'
  );
  t.equal(
    streamSocket1.pipedTo,
    clientSocket1,
    'stream socket piped to client socket'
  );
  t.equal(connector.sockets.size, 2, 'both client and stream sockets tracked');

  // Emit close on stream socket
  streamSocket1.emit('close');
  t.equal(connector.sockets.size, 1, 'stream socket removed on close');
  t.ok(connector.sockets.has(clientSocket1), 'client socket still tracked');

  // Emit close on client socket
  clientSocket1.emit('close');
  t.equal(connector.sockets.size, 0, 'client socket removed on close');

  // Simulate another connection
  const clientSocket2 = new MockSocket();
  mockServer.emit('connection', clientSocket2);
  t.equal(connector.sockets.size, 2, 'second connection pair tracked');

  // Close connector
  connector.close();
  t.equal(serverClosed, true, 'server should be closed');
  t.equal(
    connector.localProxies.size,
    0,
    'server removed from localProxies on close'
  );
  t.equal(clientSocket2.destroyed, true, 'remaining client socket destroyed');
  t.equal(
    mockStreamSockets[1].destroyed,
    true,
    'remaining stream socket destroyed'
  );
});
