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
import {Connector, cooldownBackoff} from '../src/connector';
import {setupCredentials} from './fixtures/setup-credentials';
import {IpAddressTypes} from '../src/ip-addresses';
import {CA_CERT, CLIENT_CERT, CLIENT_KEY} from './fixtures/certs';
import {AuthTypes} from '../src/auth-types';
import {SQLAdminFetcherOptions} from '../src/sqladmin-fetcher';
import {SqlDataClientOptions} from '../src/sql-data-client';

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

t.test(
  'Connector getOptions with SQL_DATA does not mutate caller options',
  async t => {
    setupCredentials(t);
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
        },
      },
      '../src/sql-data-client': {
        SqlDataClient: class {
          start() {
            return Promise.resolve(54321);
          }
          close() {
            return Promise.resolve();
          }
        },
      },
    });

    const connector = new Connector();
    const inputOpts = {
      ipType: IpAddressTypes.SQL_DATA,
      instanceConnectionName: 'my-project:us-east1:my-instance',
    };

    const opts = await connector.getOptions(inputOpts);
    t.same(typeof opts.stream, 'function', 'should return stream function');
    t.same(
      inputOpts.ipType,
      IpAddressTypes.SQL_DATA,
      'should not mutate inputOpts.ipType'
    );

    connector.close();
  }
);

t.test(
  'Connector getOptions fallback selects private IP when public is not available',
  async t => {
    setupCredentials(t);
    let capturedFallbackOpts: SqlDataClientOptions | undefined;
    const {Connector} = t.mockRequire('../src/connector', {
      '../src/sqladmin-fetcher': {
        SQLAdminFetcher: class {
          getInstanceMetadata() {
            return Promise.resolve({
              ipAddresses: {
                private: '10.0.0.1',
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
      '../src/sql-data-client': {
        SqlDataClient: class {
          private readonly opts: SqlDataClientOptions;
          constructor(opts: SqlDataClientOptions) {
            this.opts = opts;
            capturedFallbackOpts = opts;
          }
          start() {
            return Promise.resolve(54321);
          }
          close() {
            return Promise.resolve();
          }
        },
      },
    });

    const connector = new Connector();
    await connector.getOptions({
      ipType: IpAddressTypes.SQL_DATA,
      instanceConnectionName: 'my-project:us-east1:my-instance',
      sqlDataKeepAliveTimeMs: 45000,
      sqlDataKeepAliveTimeoutMs: 15000,
    });

    t.same(
      capturedFallbackOpts?.keepAliveTimeMs,
      45000,
      'should pass keepAliveTimeMs'
    );
    t.same(
      capturedFallbackOpts?.keepAliveTimeoutMs,
      15000,
      'should pass keepAliveTimeoutMs'
    );

    // Invoke getDirectSocket to test fallback resolution
    const directSocket = await capturedFallbackOpts?.getDirectSocket?.();
    t.ok(directSocket, 'should return direct TLS socket');

    connector.close();
  }
);

t.test(
  'Connector getOptions fallback prefers PRIVATE over PSC and PUBLIC',
  async t => {
    setupCredentials(t);
    let capturedFallbackOpts: SqlDataClientOptions | undefined;
    const {Connector} = t.mockRequire('../src/connector', {
      '../src/sqladmin-fetcher': {
        SQLAdminFetcher: class {
          getInstanceMetadata() {
            return Promise.resolve({
              ipAddresses: {
                public: '127.0.0.1',
                private: '10.0.0.1',
                psc: 'abcde.12345.us-central1.sql.goog',
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
      '../src/sql-data-client': {
        SqlDataClient: class {
          constructor(opts: SqlDataClientOptions) {
            capturedFallbackOpts = opts;
          }
          start() {
            return Promise.resolve(54321);
          }
          close() {
            return Promise.resolve();
          }
        },
      },
    });

    const connector = new Connector();
    await connector.getOptions({
      ipType: IpAddressTypes.SQL_DATA,
      instanceConnectionName: 'my-project:us-east1:my-instance',
    });

    // Invoke getDirectSocket and verify fallback IP is PRIVATE
    const directSocket = await capturedFallbackOpts?.getDirectSocket?.();
    t.ok(directSocket, 'should return direct TLS socket');
    t.same(
      connector['sqlDataFallbackIpTypes'].get(
        'my-project:us-east1:my-instance'
      ),
      IpAddressTypes.PRIVATE,
      'should select PRIVATE as highest fallback priority'
    );

    connector.close();
  }
);

t.test(
  'Connector getOptions fallback prefers PSC over PUBLIC when PRIVATE is missing',
  async t => {
    setupCredentials(t);
    let capturedFallbackOpts: SqlDataClientOptions | undefined;
    const {Connector} = t.mockRequire('../src/connector', {
      '../src/sqladmin-fetcher': {
        SQLAdminFetcher: class {
          getInstanceMetadata() {
            return Promise.resolve({
              ipAddresses: {
                public: '127.0.0.1',
                psc: 'abcde.12345.us-central1.sql.goog',
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
      '../src/sql-data-client': {
        SqlDataClient: class {
          constructor(opts: SqlDataClientOptions) {
            capturedFallbackOpts = opts;
          }
          start() {
            return Promise.resolve(54321);
          }
          close() {
            return Promise.resolve();
          }
        },
      },
    });

    const connector = new Connector();
    await connector.getOptions({
      ipType: IpAddressTypes.SQL_DATA,
      instanceConnectionName: 'my-project:us-east1:my-instance',
    });

    // Invoke getDirectSocket and verify fallback IP is PSC
    const directSocket = await capturedFallbackOpts?.getDirectSocket?.();
    t.ok(directSocket, 'should return direct TLS socket');
    t.same(
      connector['sqlDataFallbackIpTypes'].get(
        'my-project:us-east1:my-instance'
      ),
      IpAddressTypes.PSC,
      'should select PSC over PUBLIC when PRIVATE is missing'
    );

    connector.close();
  }
);

t.test('cooldownBackoff calculates expected backoff with jitter', async t => {
  const base = 500; // 500ms

  // Attempt 1: exp in [0, 1) -> 500 * [1, 1.618) = [500, 809]
  for (let i = 0; i < 20; i++) {
    const b1 = cooldownBackoff(base, 1);
    t.ok(
      b1 >= 500 && b1 <= 809,
      `attempt 1 backoff ${b1} should be in [500, 809]`
    );
  }

  // Attempt 2: exp in [1, 2) -> 500 * [1.618, 2.618) = [809, 1309]
  for (let i = 0; i < 20; i++) {
    const b2 = cooldownBackoff(base, 2);
    t.ok(
      b2 >= 809 && b2 <= 1309,
      `attempt 2 backoff ${b2} should be in [809, 1309]`
    );
  }

  // Attempt 3: exp in [2, 3) -> 500 * [2.618, 4.236) = [1309, 2118]
  for (let i = 0; i < 20; i++) {
    const b3 = cooldownBackoff(base, 3);
    t.ok(
      b3 >= 1309 && b3 <= 2118,
      `attempt 3 backoff ${b3} should be in [1309, 2118]`
    );
  }
});

t.test('Connector handles ResourceExhausted cooldown and reset', async t => {
  setupCredentials(t);
  let capturedOpts: SqlDataClientOptions | undefined;
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
    '../src/sql-data-client': {
      SqlDataClient: class {
        constructor(opts: SqlDataClientOptions) {
          capturedOpts = opts;
        }
        start() {
          return Promise.resolve(54321);
        }
        close() {
          return Promise.resolve();
        }
      },
    },
  });

  const cooldownPeriod = 500; // 500ms
  const connector = new Connector({
    resourceExhaustedCooldownPeriod: cooldownPeriod,
  });

  const driverOptions = await connector.getOptions({
    ipType: IpAddressTypes.SQL_DATA,
    instanceConnectionName: 'my-project:us-east1:my-instance',
  });

  t.ok(capturedOpts, 'SqlDataClientOptions should be captured');

  // 1. Initial State: no cooldown
  // Calling stream() should succeed (connects to tunnel)
  const sock1 = driverOptions.stream();
  t.ok(sock1, 'stream should return socket');
  sock1.destroy();

  // 2. First failure (ResourceExhausted)
  const dummyErr = new Error('Resource busy');
  capturedOpts?.onResourceExhausted?.(dummyErr);

  // 3. Second call during active cooldown should fail immediately
  await t.rejects(
    async () => {
      await connector.getOptions({
        ipType: IpAddressTypes.SQL_DATA,
        instanceConnectionName: 'my-project:us-east1:my-instance',
      });
    },
    {
      name: 'CloudSQLConnectorError',
      code: 'ERESOURCEEXHAUSTED',
    },
    'getOptions should throw ERESOURCEEXHAUSTED during cooldown'
  );

  t.throws(
    () => {
      driverOptions.stream();
    },
    {
      name: 'CloudSQLConnectorError',
      code: 'ERESOURCEEXHAUSTED',
    },
    'stream should throw ERESOURCEEXHAUSTED during cooldown'
  );

  // Wait for first cooldown to expire (~500ms to 809ms)
  await new Promise(resolve => setTimeout(resolve, 900));

  // Now getOptions and stream() should succeed again
  const driverOptions2 = await connector.getOptions({
    ipType: IpAddressTypes.SQL_DATA,
    instanceConnectionName: 'my-project:us-east1:my-instance',
  });
  const sock2 = driverOptions2.stream();
  t.ok(sock2, 'stream should return socket after cooldown expires');
  sock2.destroy();

  // 4. Second failure increments backoff counter to 2
  capturedOpts?.onResourceExhausted?.(dummyErr);

  t.throws(
    () => {
      driverOptions2.stream();
    },
    {
      name: 'CloudSQLConnectorError',
      code: 'ERESOURCEEXHAUSTED',
    },
    'stream should throw ERESOURCEEXHAUSTED after second failure'
  );

  // Wait for second cooldown to expire (~809ms to 1309ms)
  await new Promise(resolve => setTimeout(resolve, 1400));

  // 5. Success resets backoff counter and clears cooldown
  capturedOpts?.onSuccess?.();

  const driverOptions3 = await connector.getOptions({
    ipType: IpAddressTypes.SQL_DATA,
    instanceConnectionName: 'my-project:us-east1:my-instance',
  });
  const sock3 = driverOptions3.stream();
  t.ok(sock3, 'stream should return socket after success reset');
  sock3.destroy();

  connector.close();
});
