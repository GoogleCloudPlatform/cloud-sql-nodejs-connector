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
import {IpAddressTypes} from '../src/ip-addresses';
import {AuthTypes} from '../src/auth-types';
import {CA_CERT, CLIENT_CERT, CLIENT_KEY} from './fixtures/certs';
import {setupCredentials} from './fixtures/setup-credentials';

t.test('CloudSQLInstance', async t => {
  setupCredentials(t); // setup google-auth credentials mocks

  const fetcher = {
    async getInstanceMetadata() {
      return {
        ipAddresses: {
          public: '127.0.0.1',
        },
        serverCaCert: {
          cert: CA_CERT,
          expirationTime: '2033-01-06T10:00:00.232Z',
        },
      };
    },
    async getEphemeralCertificate() {
      return {
        cert: CLIENT_CERT,
        expirationTime: '2033-01-06T10:00:00.232Z',
      };
    },
  };

  // mocks crypto module so that it can return a deterministic result
  // and set a standard, fast static value for cert refresh interval
  const {CloudSQLInstance} = t.mockRequire('../src/cloud-sql-instance', {
    '../src/crypto': {
      generateKeys: async () => ({
        publicKey: '-----BEGIN PUBLIC KEY-----',
        privateKey: CLIENT_KEY,
      }),
    },
    '../src/time': {
      getRefreshInterval() {
        return 50; // defaults to 50ms in unit tests
      },
      isExpirationTimeValid() {
        return true;
      },
    },
  });

  t.test('assert basic instance usage and API', async t => {
    const instance = await CloudSQLInstance.getCloudSQLInstance({
      ipType: IpAddressTypes.PUBLIC,
      authType: AuthTypes.PASSWORD,
      instanceConnectionName: 'my-project:us-east1:my-instance',
      sqlAdminFetcher: fetcher,
    });
    t.after(() => instance.close());

    t.same(
      instance.ephemeralCert.cert,
      CLIENT_CERT,
      'should have expected privateKey'
    );

    t.same(
      instance.instanceInfo,
      {
        projectId: 'my-project',
        regionId: 'us-east1',
        instanceId: 'my-instance',
        domainName: undefined,
      },
      'should have expected connection info'
    );

    t.same(instance.privateKey, CLIENT_KEY, 'should have expected privateKey');

    t.same(instance.host, '127.0.0.1', 'should have expected host');
    t.same(instance.port, 3307, 'should have expected port');

    t.same(
      instance.serverCaCert.cert,
      CA_CERT,
      'should have expected serverCaCert'
    );

    instance.cancelRefresh();
  });

  t.test('initial refresh error should throw errors', async t => {
    const failedFetcher = {
      ...fetcher,
      async getInstanceMetadata() {
        throw new Error('ERR');
      },
    };
    const instance = new CloudSQLInstance({
      options: {
        ipType: IpAddressTypes.PUBLIC,
        authType: AuthTypes.PASSWORD,
        instanceConnectionName: 'my-project:us-east1:my-instance',
        sqlAdminFetcher: failedFetcher,
        limitRateInterval: 50,
      },
    });
    t.after(() => instance.close());

    await t.rejects(
      instance.refresh(),
      /ERR/,
      'should raise the specific error to the end user'
    );
  });

  t.test('refresh', t => {
    const start = Date.now();
    let refreshCount = 0;
    const instance = new CloudSQLInstance({
      options: {
        ipType: IpAddressTypes.PUBLIC,
        authType: AuthTypes.PASSWORD,
        instanceConnectionName: 'my-project:us-east1:my-instance',
        sqlAdminFetcher: fetcher,
        limitRateInterval: 50,
      },
    });
    t.after(() => instance.close());
    instance.refresh = () => {
      if (refreshCount === 2) {
        const end = Date.now();
        const duration = end - start;
        t.ok(
          duration >= 100,
          `should respect refresh delay time, ${duration}ms elapsed`
        );
        instance.cancelRefresh();
        return t.end();
      }
      refreshCount++;
      t.ok(refreshCount, `should refresh ${refreshCount} times`);
      CloudSQLInstance.prototype.refresh.call(instance);
    };
    // starts out refresh logic
    instance.refresh();
  });

  t.test(
    'refresh error should not throw any errors on established connection',
    async t => {
      let metadataCount = 0;
      const failedFetcher = {
        ...fetcher,
        async getInstanceMetadata() {
          if (metadataCount === 1) {
            throw new Error('ERR');
          }
          metadataCount++;
          return fetcher.getInstanceMetadata();
        },
      };
      const instance = new CloudSQLInstance({
        options: {
          ipType: IpAddressTypes.PUBLIC,
          authType: AuthTypes.PASSWORD,
          instanceConnectionName: 'my-project:us-east1:my-instance',
          sqlAdminFetcher: failedFetcher,
          limitRateInterval: 50,
        },
      });
      t.after(() => instance.close());
      await (() =>
        new Promise((res): void => {
          let refreshCount = 0;
          instance.refresh = function mockRefresh() {
            if (refreshCount === 3) {
              t.ok('done refreshing 3 times');
              instance.cancelRefresh();
              return res(null);
            }
            refreshCount++;
            t.ok(refreshCount, `should refresh ${refreshCount} times`);
            return CloudSQLInstance.prototype.refresh.call(instance);
          };
          // starts out refresh logic
          instance.refresh();
          instance.setEstablishedConnection();
        }))();
    }
  );

  t.test(
    'refresh error with expired cert should not throw any errors on established connection',
    async t => {
      const {CloudSQLInstance} = t.mockRequire('../src/cloud-sql-instance', {
        '../src/crypto': {
          generateKeys: async () => ({
            publicKey: '-----BEGIN PUBLIC KEY-----',
            privateKey: CLIENT_KEY,
          }),
        },
        '../src/time': {
          getRefreshInterval() {
            return 0; // an expired cert will want to reload right away
          },
        },
      });
      let metadataCount = 0;
      const failedFetcher = {
        ...fetcher,
        async getInstanceMetadata() {
          if (metadataCount === 1) {
            throw new Error('ERR');
          }
          metadataCount++;
          return fetcher.getInstanceMetadata();
        },
      };
      const instance = new CloudSQLInstance({
        options: {
          ipType: IpAddressTypes.PUBLIC,
          authType: AuthTypes.PASSWORD,
          instanceConnectionName: 'my-project:us-east1:my-instance',
          sqlAdminFetcher: failedFetcher,
          limitRateInterval: 50,
        },
      });
      t.after(() => instance.close());
      await (() =>
        new Promise((res): void => {
          let refreshCount = 0;
          instance.refresh = function mockRefresh() {
            if (refreshCount === 3) {
              t.ok('done refreshing 3 times');
              instance.cancelRefresh();
              return res(null);
            }
            refreshCount++;
            t.ok(refreshCount, `should refresh ${refreshCount} times`);
            return CloudSQLInstance.prototype.refresh.call(instance);
          };
          // starts out refresh logic
          instance.refresh();
          instance.setEstablishedConnection();
        }))();
    }
  );

  t.test('forceRefresh', async t => {
    const instance = new CloudSQLInstance({
      options: {
        ipType: IpAddressTypes.PUBLIC,
        authType: AuthTypes.PASSWORD,
        instanceConnectionName: 'my-project:us-east1:my-instance',
        sqlAdminFetcher: fetcher,
        limitRateInterval: 50,
      },
    });
    t.after(() => instance.close());

    await instance.refresh();

    let cancelRefreshCalled = false;
    let refreshCalled = false;

    instance.cancelRefresh = () => {
      cancelRefreshCalled = true;
      CloudSQLInstance.prototype.cancelRefresh.call(instance);
      instance.cancelRefresh = CloudSQLInstance.prototype.cancelRefresh;
    };

    instance.refresh = async () => {
      refreshCalled = true;
      await CloudSQLInstance.prototype.refresh.call(instance);
      instance.refresh = CloudSQLInstance.prototype.refresh;
    };

    await instance.forceRefresh();

    t.ok(
      cancelRefreshCalled,
      'should cancelRefresh current refresh cycle on force refresh'
    );
    t.ok(refreshCalled, 'should refresh instance info on force refresh');
    instance.cancelRefresh();
  });

  t.test('forceRefresh ongoing cycle', async t => {
    const instance = new CloudSQLInstance({
      options: {
        ipType: IpAddressTypes.PUBLIC,
        authType: AuthTypes.PASSWORD,
        instanceConnectionName: 'my-project:us-east1:my-instance',
        sqlAdminFetcher: fetcher,
        limitRateInterval: 50,
      },
    });
    t.after(() => instance.close());

    let cancelRefreshCalled = false;
    let refreshCalled = false;

    instance.refresh();

    instance.cancelRefresh = () => {
      cancelRefreshCalled = true;
      return CloudSQLInstance.prototype.cancelRefresh.call(instance);
    };

    instance.refresh = () => {
      refreshCalled = true;
      return CloudSQLInstance.prototype.refresh.call(instance);
    };

    await instance.forceRefresh();

    t.ok(
      !cancelRefreshCalled,
      'should not call cancelRefresh if refresh already happening'
    );
    t.ok(!refreshCalled, 'should not refresh if already happening');

    CloudSQLInstance.prototype.cancelRefresh.call(instance);
  });

  t.test('refresh post-forceRefresh', async t => {
    const instance = new CloudSQLInstance({
      options: {
        authType: AuthTypes.PASSWORD,
        instanceConnectionName: 'my-project:us-east1:my-instance',
        ipType: IpAddressTypes.PUBLIC,
        limitRateInterval: 0,
        sqlAdminFetcher: fetcher,
      },
    });
    t.after(() => instance.close());

    const start = Date.now();
    // starts regular refresh cycle
    let refreshCount = 1;
    await instance.refresh();

    await (() =>
      new Promise((res): void => {
        instance.refresh = () => {
          if (refreshCount === 3) {
            const end = Date.now();
            const duration = end - start;
            t.ok(
              duration >= 100,
              `should respect refresh delay time, ${duration}ms elapsed`
            );
            instance.cancelRefresh();
            return res(null);
          }
          refreshCount++;
          t.ok(refreshCount, `should refresh ${refreshCount} times`);
          CloudSQLInstance.prototype.refresh.call(instance);
        };
        instance.forceRefresh();
      }))();

    t.strictSame(refreshCount, 3, 'should have refreshed');
  });

  t.test('refresh rate limit', async t => {
    const instance = new CloudSQLInstance({
      options: {
        ipType: IpAddressTypes.PUBLIC,
        authType: AuthTypes.PASSWORD,
        instanceConnectionName: 'my-project:us-east1:my-instance',
        limitRateInterval: 50,
        sqlAdminFetcher: fetcher,
      },
    });
    t.after(() => instance.close());
    const start = Date.now();
    // starts out refresh logic
    let refreshCount = 1;
    await instance.refresh();

    await (() =>
      new Promise((res): void => {
        instance.refresh = () => {
          if (refreshCount === 3) {
            const end = Date.now();
            const duration = end - start;
            t.ok(
              duration >= 150,
              `should respect refresh delay time + rate limit, ${duration}ms elapsed`
            );
            instance.cancelRefresh();
            return res(null);
          }
          refreshCount++;
          t.ok(refreshCount, `should refresh ${refreshCount} times`);
          CloudSQLInstance.prototype.refresh.call(instance);
        };
      }))();
    t.strictSame(refreshCount, 3, 'should have refreshed');
  });

  // The cancelRefresh methods should never hang, given the async and timer
  // dependent nature of the refresh cycles, it's possible to get into really
  // hard to debug race conditions. The set of cancelRefresh tests below just
  // ensure that the tests runs and terminates as expected.
  t.test('cancelRefresh first cycle', async t => {
    const slowFetcher = {
      ...fetcher,
      async getInstanceMetadata() {
        await (() => new Promise(res => setTimeout(res, 50)))();
        return fetcher.getInstanceMetadata();
      },
    };
    const instance = new CloudSQLInstance({
      options: {
        ipType: IpAddressTypes.PUBLIC,
        authType: AuthTypes.PASSWORD,
        instanceConnectionName: 'my-project:us-east1:my-instance',
        sqlAdminFetcher: slowFetcher,
        limitRateInterval: 50,
      },
    });
    t.after(() => instance.close());

    // starts a new refresh cycle but do not await on it
    instance.refresh();

    // cancel refresh before the ongoing promise fulfills
    instance.cancelRefresh();

    t.ok('should not leave hanging setTimeout');
  });

  t.test('cancelRefresh ongoing cycle', async t => {
    const slowFetcher = {
      ...fetcher,
      async getInstanceMetadata() {
        await (() => new Promise(res => setTimeout(res, 50)))();
        return fetcher.getInstanceMetadata();
      },
    };
    const instance = new CloudSQLInstance({
      options: {
        ipType: IpAddressTypes.PUBLIC,
        authType: AuthTypes.PASSWORD,
        instanceConnectionName: 'my-project:us-east1:my-instance',
        sqlAdminFetcher: slowFetcher,
        limitRateInterval: 50,
      },
    });
    t.after(() => instance.close());

    // simulates an ongoing instance, already has data
    await instance.refresh();

    // starts a new refresh cycle but do not await on it
    instance.refresh();

    instance.cancelRefresh();

    t.ok('should not leave hanging setTimeout');
  });

  t.test(
    'cancelRefresh on established connection and ongoing failed cycle',
    async t => {
      let metadataCount = 0;
      const failAndSlowFetcher = {
        ...fetcher,
        async getInstanceMetadata() {
          await (() => new Promise(res => setTimeout(res, 50)))();
          if (metadataCount === 1) {
            throw new Error('ERR');
          }
          metadataCount++;
          return fetcher.getInstanceMetadata();
        },
      };
      const instance = new CloudSQLInstance({
        options: {
          ipType: IpAddressTypes.PUBLIC,
          authType: AuthTypes.PASSWORD,
          instanceConnectionName: 'my-project:us-east1:my-instance',
          sqlAdminFetcher: failAndSlowFetcher,
          limitRateInterval: 50,
        },
      });
      t.after(() => instance.close());

      await instance.refresh();
      instance.setEstablishedConnection();

      // starts a new refresh cycle but do not await on it
      instance.refresh();

      instance.cancelRefresh();

      t.ok('should not leave hanging setTimeout');
    }
  );

  t.test(
    'close on established connection and ongoing failed cycle',
    async t => {
      let metadataCount = 0;
      const failAndSlowFetcher = {
        ...fetcher,
        async getInstanceMetadata() {
          await (() => new Promise(res => setTimeout(res, 50)))();
          metadataCount++;
          return fetcher.getInstanceMetadata();
        },
      };

      const instance = new CloudSQLInstance({
        options: {
          ipType: IpAddressTypes.PUBLIC,
          authType: AuthTypes.PASSWORD,
          instanceConnectionName: 'my-project:us-east1:my-instance',
          sqlAdminFetcher: failAndSlowFetcher,
          limitRateInterval: 50,
        },
      });
      t.after(() => instance.close());

      await instance.refresh();
      instance.setEstablishedConnection();

      // starts a new refresh cycle but do not await on it
      instance.close();
      await instance.forceRefresh();
      t.equal(metadataCount, 1, 'No refresh after close');

      await t.rejects(
        instance.refresh(),
        'closed',
        'Refresh after close rejected.'
      );
    }
  );

  t.test(
    'get invalid certificate data while having a current valid',
    async t => {
      let checkedExpirationTimeCount = 0;
      const {CloudSQLInstance} = t.mockRequire('../src/cloud-sql-instance', {
        '../src/crypto': {
          generateKeys: async () => ({
            publicKey: '-----BEGIN PUBLIC KEY-----',
            privateKey: CLIENT_KEY,
          }),
        },
        '../src/time': {
          getRefreshInterval() {
            return 50;
          },
          // succeds first time and fails for next calls
          isExpirationTimeValid() {
            checkedExpirationTimeCount++;
            return checkedExpirationTimeCount < 2;
          },
        },
      });

      // A fetcher mock that will return a new ip on every refresh
      let metadataCount = 0;
      const updateFetcher = {
        ...fetcher,
        async getInstanceMetadata() {
          const instanceMetadata = await fetcher.getInstanceMetadata();
          const ips = ['127.0.0.1', '127.0.0.2'];
          const ipAddresses = {
            public: ips[metadataCount],
          };
          metadataCount++;
          return {
            ...instanceMetadata,
            ipAddresses,
          };
        },
      };

      const instance = new CloudSQLInstance({
        options: {
          ipType: IpAddressTypes.PUBLIC,
          authType: AuthTypes.PASSWORD,
          instanceConnectionName: 'my-project:us-east1:my-instance',
          sqlAdminFetcher: updateFetcher,
          limitRateInterval: 0,
        },
      });
      t.after(() => instance.close());
      await (() =>
        new Promise((res): void => {
          let refreshCount = 0;
          instance.refresh = function mockRefresh() {
            if (refreshCount === 2) {
              t.ok('done refreshing 2 times');
              // instance.host value will be 127.0.0.2 if
              // isExpirationTimeValid does not work as expected
              t.strictSame(
                instance.host,
                '127.0.0.1',
                'should not have updated values'
              );
              instance.cancelRefresh();
              return res(null);
            }
            refreshCount++;
            return CloudSQLInstance.prototype.refresh.call(instance);
          };
          // starts out refresh logic
          instance.refresh();
          instance.setEstablishedConnection();
        }))();
    }
  );

  t.test('addSocket manages and cleans up sockets on close event', async t => {
    const {EventEmitter} = await import('node:events');
    interface InstanceWithInternals {
      sockets: Set<unknown>;
      addSocket(socket: unknown): void;
      close(): void;
    }
    const instance = new CloudSQLInstance({
      options: {
        ipType: IpAddressTypes.PUBLIC,
        authType: AuthTypes.PASSWORD,
        domainName: 'db.example.com',
        sqlAdminFetcher: fetcher,
      },
    }) as unknown as InstanceWithInternals;
    t.after(() => instance.close());

    class MockSocket extends EventEmitter {
      destroyed = false;
      destroy() {
        this.destroyed = true;
        this.emit('close');
      }
    }

    const socket1 = new MockSocket();
    const socket2 = new MockSocket();

    instance.addSocket(socket1);
    instance.addSocket(socket2);

    t.equal(instance.sockets.size, 2, 'both sockets added');

    // Close socket1
    socket1.emit('close');
    t.equal(instance.sockets.size, 1, 'socket1 removed on close');
    t.ok(instance.sockets.has(socket2), 'socket2 still tracked');

    // close instance destroys remaining sockets
    instance.close();
    t.equal(
      socket2.destroyed,
      true,
      'remaining socket destroyed on instance close'
    );
  });

  t.test('addSocket ignores sockets when domainName is not set', async t => {
    const {EventEmitter} = await import('node:events');
    interface InstanceWithInternals {
      sockets: Set<unknown>;
      addSocket(socket: unknown): void;
      close(): void;
    }
    const instance = new CloudSQLInstance({
      options: {
        ipType: IpAddressTypes.PUBLIC,
        authType: AuthTypes.PASSWORD,
        instanceConnectionName: 'my-project:us-east1:my-instance',
        sqlAdminFetcher: fetcher,
      },
    }) as unknown as InstanceWithInternals;
    t.after(() => instance.close());

    const socket = new EventEmitter();
    Object.assign(socket, {destroy: () => {}});

    instance.addSocket(socket);
    t.equal(
      instance.sockets.size,
      0,
      'socket not added when domainName not set'
    );
  });

  t.test(
    'probeConnection sends PostgreSQL v3 StartupMessage and Terminate when IAM principal is recorded',
    async t => {
      const {EventEmitter} = await import('node:events');
      const writtenPackets: Buffer[] = [];
      let ended = false;
      let destroyed = false;

      const fakeDial = (_opts: unknown, onSecureConnect?: () => void) => {
        const fakeSocket = new EventEmitter() as EventEmitter & {
          write: (buf: Buffer, cb?: () => void) => boolean;
          end: () => void;
          destroy: () => void;
        };
        fakeSocket.write = (buf: Buffer, cb?: () => void) => {
          writtenPackets.push(Buffer.from(buf));
          if (cb) {
            setImmediate(cb);
          }
          if (writtenPackets.length === 1) {
            setImmediate(() => {
              fakeSocket.emit(
                'data',
                Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0])
              );
            });
          }
          return true;
        };
        fakeSocket.end = () => {
          ended = true;
          setImmediate(() => {
            fakeSocket.emit('end');
          });
        };
        fakeSocket.destroy = () => {
          destroyed = true;
          setImmediate(() => {
            fakeSocket.emit('close');
          });
        };
        if (onSecureConnect) {
          setImmediate(onSecureConnect);
        }
        return fakeSocket as unknown as import('node:tls').TLSSocket;
      };

      const {CloudSQLInstance: MockedInstance, buildPostgresStartupPacket} =
        t.mockRequire('../src/cloud-sql-instance', {
          '../src/crypto': {
            generateKeys: async () => ({
              publicKey: '-----BEGIN PUBLIC KEY-----',
              privateKey: CLIENT_KEY,
            }),
          },
          '../src/time': {
            getRefreshInterval() {
              return 50;
            },
            isExpirationTimeValid() {
              return true;
            },
          },
        });

      const instance = new MockedInstance({
        options: {
          ipType: IpAddressTypes.PUBLIC,
          authType: AuthTypes.IAM,
          instanceConnectionName: 'my-project:us-east1:my-instance',
          sqlAdminFetcher: fetcher,
          limitRateInterval: 50,
          dialFunc: fakeDial,
        },
      });
      t.after(() => instance.close());

      // Simulate an application socket capturing (user, database) via addSocket
      const clientSocket = {
        write: (chunk: Buffer) => chunk.length >= 0,
        destroy: () => {},
        once: () => {},
      };
      instance.addSocket(clientSocket);
      const sslReq = Buffer.from([0, 0, 0, 8, 0x04, 0xd2, 0x16, 0x2f]);
      clientSocket.write(sslReq);
      const startup = buildPostgresStartupPacket(
        'iam-user@example.com',
        'mydb'
      );
      clientSocket.write(startup);

      await instance.refresh();
      instance.cancelRefresh();

      t.same(
        writtenPackets,
        [startup, Buffer.from([0x58, 0x00, 0x00, 0x00, 0x04])],
        'should write PostgreSQL StartupMessage and Terminate on probe'
      );
      t.ok(ended, 'should end probe socket after Terminate');
      t.ok(destroyed, 'should destroy probe socket after Terminate');
    }
  );

  t.test(
    'probeConnection does NOT probe if databaseVersion is MySQL',
    async t => {
      let probeCalled = false;
      const {CloudSQLInstance: MockedInstance} = t.mockRequire(
        '../src/cloud-sql-instance',
        {
          '../src/crypto': {
            generateKeys: async () => ({
              publicKey: '-----BEGIN PUBLIC KEY-----',
              privateKey: CLIENT_KEY,
            }),
          },
          '../src/time': {
            getRefreshInterval() {
              return 50;
            },
            isExpirationTimeValid() {
              return true;
            },
          },
          '../src/socket': {
            getSocket: () => {
              probeCalled = true;
              throw new Error('should not be called');
            },
          },
        }
      );

      const mysqlFetcher = {
        async getInstanceMetadata() {
          return {
            ipAddresses: {public: '127.0.0.1'},
            serverCaMode: '',
            dnsName: '',
            databaseVersion: 'MYSQL_8_0',
            serverCaCert: {
              cert: CA_CERT,
              expirationTime: '2033-01-06T10:00:00.232Z',
            },
          };
        },
        async getEphemeralCertificate() {
          return {
            cert: CLIENT_CERT,
            expirationTime: '2033-01-06T10:00:00.232Z',
          };
        },
        resolveConnectSettings: async () => '',
      };

      const instance = new MockedInstance({
        options: {
          ipType: IpAddressTypes.PUBLIC,
          authType: AuthTypes.IAM,
          instanceConnectionName: 'my-project:us-east1:my-instance',
          sqlAdminFetcher: mysqlFetcher,
          limitRateInterval: 50,
        },
      });
      t.after(() => instance.close());

      instance.recordIamPrincipal('iam-user@example.com', 'mydb');
      await instance.refresh();
      instance.cancelRefresh();

      t.notOk(probeCalled, 'should not probe non-Postgres instance');
    }
  );

  t.test(
    'probeConnection does NOT probe if no IAM principals are recorded',
    async t => {
      let probeCalled = false;
      const {CloudSQLInstance: MockedInstance} = t.mockRequire(
        '../src/cloud-sql-instance',
        {
          '../src/crypto': {
            generateKeys: async () => ({
              publicKey: '-----BEGIN PUBLIC KEY-----',
              privateKey: CLIENT_KEY,
            }),
          },
          '../src/time': {
            getRefreshInterval() {
              return 50;
            },
            isExpirationTimeValid() {
              return true;
            },
          },
          '../src/socket': {
            getSocket: () => {
              probeCalled = true;
              throw new Error('should not be called');
            },
          },
        }
      );

      const instance = new MockedInstance({
        options: {
          ipType: IpAddressTypes.PUBLIC,
          authType: AuthTypes.IAM,
          instanceConnectionName: 'my-project:us-east1:my-instance',
          sqlAdminFetcher: fetcher,
          limitRateInterval: 50,
        },
      });
      t.after(() => instance.close());

      // Do NOT record any IAM principal
      await instance.refresh();
      instance.cancelRefresh();

      t.notOk(probeCalled, 'should not probe when principals set is empty');
    }
  );

  t.test(
    'probeConnection probes when databaseVersion is POSTGRES and skips SQLSERVER and PASSWORD',
    async t => {
      const {EventEmitter} = await import('node:events');
      let probeTargets: string[] = [];

      const makeDial = () => {
        return (opts: {host: string}, onSecureConnect?: () => void) => {
          probeTargets.push(opts.host);
          const fakeSocket = new EventEmitter() as EventEmitter & {
            write: (buf: Buffer, cb?: () => void) => boolean;
            end: () => void;
            destroy: () => void;
          };
          let writes = 0;
          fakeSocket.write = (_buf: Buffer, cb?: () => void) => {
            writes++;
            if (cb) {
              setImmediate(cb);
            }
            if (writes === 1) {
              setImmediate(() => {
                fakeSocket.emit(
                  'data',
                  Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0])
                );
              });
            }
            return true;
          };
          fakeSocket.end = () => {
            setImmediate(() => fakeSocket.emit('end'));
          };
          fakeSocket.destroy = () => {
            setImmediate(() => fakeSocket.emit('close'));
          };
          if (onSecureConnect) {
            setImmediate(onSecureConnect);
          }
          return fakeSocket as unknown as import('node:tls').TLSSocket;
        };
      };

      const {CloudSQLInstance: MockedInstance} = t.mockRequire(
        '../src/cloud-sql-instance',
        {
          '../src/crypto': {
            generateKeys: async () => ({
              publicKey: '-----BEGIN PUBLIC KEY-----',
              privateKey: CLIENT_KEY,
            }),
          },
          '../src/time': {
            getRefreshInterval: () => 50,
            isExpirationTimeValid: () => true,
          },
        }
      );

      // 1. POSTGRES_15 + AuthTypes.IAM -> probes
      probeTargets = [];
      const pgFetcher = {
        ...fetcher,
        async getInstanceMetadata() {
          return {
            ...(await fetcher.getInstanceMetadata()),
            databaseVersion: 'POSTGRES_15',
          };
        },
      };
      const pgInst = new MockedInstance({
        options: {
          ipType: IpAddressTypes.PUBLIC,
          authType: AuthTypes.IAM,
          instanceConnectionName: 'my-project:us-east1:my-instance',
          sqlAdminFetcher: pgFetcher,
          limitRateInterval: 50,
          dialFunc: makeDial(),
        },
      });
      t.after(() => pgInst.close());
      pgInst.recordIamPrincipal('pg-user@example.com', 'pgdb');
      await pgInst.refresh();
      pgInst.cancelRefresh();
      t.same(
        probeTargets,
        ['127.0.0.1'],
        'should probe POSTGRES_15 IAM instance'
      );

      // 2. SQLSERVER_2019_STANDARD + AuthTypes.IAM -> skips probe & addSocket wrapper
      probeTargets = [];
      const sqlServerFetcher = {
        ...fetcher,
        async getInstanceMetadata() {
          return {
            ...(await fetcher.getInstanceMetadata()),
            databaseVersion: 'SQLSERVER_2019_STANDARD',
          };
        },
      };
      const sqlInst = new MockedInstance({
        options: {
          ipType: IpAddressTypes.PUBLIC,
          authType: AuthTypes.IAM,
          instanceConnectionName: 'my-project:us-east1:my-instance',
          sqlAdminFetcher: sqlServerFetcher,
          limitRateInterval: 50,
          dialFunc: makeDial(),
        },
      });
      t.after(() => sqlInst.close());
      sqlInst.recordIamPrincipal('sa', 'master');
      await sqlInst.refresh();
      sqlInst.cancelRefresh();
      t.same(probeTargets, [], 'should skip SQLSERVER instance');

      // 3. POSTGRES_15 + AuthTypes.PASSWORD -> does not attach PostgresSocket or probe
      probeTargets = [];
      const pwdInst = new MockedInstance({
        options: {
          ipType: IpAddressTypes.PUBLIC,
          authType: AuthTypes.PASSWORD,
          instanceConnectionName: 'my-project:us-east1:my-instance',
          sqlAdminFetcher: pgFetcher,
          limitRateInterval: 50,
          dialFunc: makeDial(),
        },
      });
      t.after(() => pwdInst.close());
      const origWrite = (buf: Uint8Array | string) => buf.length >= 0;
      const pwdSock = {write: origWrite, destroy: () => {}, once: () => {}};
      pwdInst.addSocket(pwdSock);
      t.equal(
        pwdSock.write,
        origWrite,
        'should not wrap socket for AuthTypes.PASSWORD'
      );
      await pwdInst.refresh();
      pwdInst.cancelRefresh();
      t.same(probeTargets, [], 'should not probe AuthTypes.PASSWORD');
    }
  );

  t.test(
    'probeConnection aligns domainName target resolution with resolveARecord and selectIpAddress fallback',
    async t => {
      const {EventEmitter} = await import('node:events');
      let resolveARecordImpl: (
        name: string
      ) => Promise<string[]> = async () => ['10.20.30.40'];
      const dialed: Array<{host: string; serverName: string}> = [];
      let failTarget: string | null = null;

      const makeDial = () => {
        return (
          opts: {host: string; serverName: string},
          onSecureConnect?: () => void
        ) => {
          dialed.push({host: opts.host, serverName: opts.serverName});
          const fakeSocket = new EventEmitter() as EventEmitter & {
            write: (buf: Buffer, cb?: () => void) => boolean;
            end: () => void;
            destroy: () => void;
          };
          if (opts.host === failTarget) {
            setImmediate(() =>
              fakeSocket.emit('error', new Error('ECONNREFUSED'))
            );
            return fakeSocket as unknown as import('node:tls').TLSSocket;
          }
          let writes = 0;
          fakeSocket.write = (_buf: Buffer, cb?: () => void) => {
            writes++;
            if (cb) {
              setImmediate(cb);
            }
            if (writes === 1) {
              setImmediate(() => {
                fakeSocket.emit(
                  'data',
                  Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0])
                );
              });
            }
            return true;
          };
          fakeSocket.end = () => setImmediate(() => fakeSocket.emit('end'));
          fakeSocket.destroy = () =>
            setImmediate(() => fakeSocket.emit('close'));
          if (onSecureConnect) {
            setImmediate(onSecureConnect);
          }
          return fakeSocket as unknown as import('node:tls').TLSSocket;
        };
      };

      const {CloudSQLInstance: MockedInstance} = t.mockRequire(
        '../src/cloud-sql-instance',
        {
          '../src/crypto': {
            generateKeys: async () => ({
              publicKey: '-----BEGIN PUBLIC KEY-----',
              privateKey: CLIENT_KEY,
            }),
          },
          '../src/time': {
            getRefreshInterval: () => 50,
            isExpirationTimeValid: () => true,
          },
          '../src/dns-lookup': {
            resolveARecord: async (name: string) => resolveARecordImpl(name),
            resolveTxtRecord: async () => ['my-project:us-east1:my-instance'],
            resolveCnameRecord: async () => {
              throw new Error('no cname');
            },
          },
        }
      );

      const pgFetcher = {
        ...fetcher,
        async getInstanceMetadata() {
          return {
            ...(await fetcher.getInstanceMetadata()),
            databaseVersion: 'POSTGRES_15',
            dnsName: 'instance.dns.goog',
          };
        },
        resolveConnectSettings: async () => 'my-project:us-east1:my-instance',
      };

      // Case 1: domainName resolves via resolveARecord -> probes resolved IP with domainName as SNI
      dialed.length = 0;
      const inst1 = new MockedInstance({
        options: {
          ipType: IpAddressTypes.PUBLIC,
          authType: AuthTypes.IAM,
          domainName: 'db.example.com',
          sqlAdminFetcher: pgFetcher,
          limitRateInterval: 50,
          dialFunc: makeDial(),
        },
      });
      t.after(() => inst1.close());
      inst1.recordIamPrincipal('u@example.com', 'db');
      await inst1.refresh();
      inst1.cancelRefresh();
      t.same(
        dialed,
        [{host: '10.20.30.40', serverName: 'db.example.com'}],
        'should probe resolved A-record IP instead of raw domainName'
      );

      // Case 2: domainName DNS A-record fails -> falls back to metadata IP (127.0.0.1)
      dialed.length = 0;
      resolveARecordImpl = async () => {
        throw new Error('ENODATA');
      };
      const inst2 = new MockedInstance({
        options: {
          ipType: IpAddressTypes.PUBLIC,
          authType: AuthTypes.IAM,
          domainName: 'txt-only.example.com',
          sqlAdminFetcher: pgFetcher,
          limitRateInterval: 50,
          dialFunc: makeDial(),
        },
      });
      t.after(() => inst2.close());
      inst2.recordIamPrincipal('u@example.com', 'db');
      await inst2.refresh();
      inst2.cancelRefresh();
      t.same(
        dialed,
        [{host: '127.0.0.1', serverName: 'txt-only.example.com'}],
        'should fallback to metadata IP when resolveARecord fails'
      );

      // Case 3: primary A-record IP fails TCP connect -> falls back to metadata IP
      dialed.length = 0;
      resolveARecordImpl = async () => ['10.20.30.40'];
      failTarget = '10.20.30.40';
      const inst3 = new MockedInstance({
        options: {
          ipType: IpAddressTypes.PUBLIC,
          authType: AuthTypes.IAM,
          domainName: 'db.example.com',
          sqlAdminFetcher: pgFetcher,
          limitRateInterval: 50,
          dialFunc: makeDial(),
        },
      });
      t.after(() => inst3.close());
      inst3.recordIamPrincipal('u@example.com', 'db');
      await inst3.refresh();
      inst3.cancelRefresh();
      t.same(
        dialed,
        [
          {host: '10.20.30.40', serverName: 'db.example.com'},
          {host: '127.0.0.1', serverName: 'db.example.com'},
        ],
        'should fall back to metadata IP when primary A-record probe fails'
      );
    }
  );

  t.test(
    'probeConnection handles sync onConnect, async Promise dialFunc, and sync/async dial errors safely',
    async t => {
      const {EventEmitter} = await import('node:events');
      const {CloudSQLInstance: MockedInstance} = t.mockRequire(
        '../src/cloud-sql-instance',
        {
          '../src/crypto': {
            generateKeys: async () => ({
              publicKey: '-----BEGIN PUBLIC KEY-----',
              privateKey: CLIENT_KEY,
            }),
          },
          '../src/time': {
            getRefreshInterval: () => 50,
            isExpirationTimeValid: () => true,
          },
        }
      );

      // 1. Sync dialFunc invoking onConnect synchronously before returning socket
      const written: Buffer[] = [];
      const syncDial = (_opts: unknown, onSecureConnect?: () => void) => {
        const fakeSocket = new EventEmitter() as EventEmitter & {
          write: (buf: Buffer, cb?: () => void) => boolean;
          end: () => void;
          destroy: () => void;
        };
        fakeSocket.write = (buf: Buffer, cb?: () => void) => {
          written.push(Buffer.from(buf));
          if (cb) setImmediate(cb);
          if (written.length === 1) {
            setImmediate(() =>
              fakeSocket.emit(
                'data',
                Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0])
              )
            );
          }
          return true;
        };
        fakeSocket.end = () => setImmediate(() => fakeSocket.emit('end'));
        fakeSocket.destroy = () => setImmediate(() => fakeSocket.emit('close'));
        if (onSecureConnect) {
          onSecureConnect(); // synchronous!
        }
        return fakeSocket as unknown as import('node:tls').TLSSocket;
      };

      const inst1 = new MockedInstance({
        options: {
          ipType: IpAddressTypes.PUBLIC,
          authType: AuthTypes.IAM,
          instanceConnectionName: 'my-project:us-east1:my-instance',
          sqlAdminFetcher: fetcher,
          limitRateInterval: 50,
          dialFunc: syncDial,
        },
      });
      t.after(() => inst1.close());
      inst1.recordIamPrincipal('sync-user@example.com', 'syncdb');
      await inst1.refresh();
      inst1.cancelRefresh();
      t.equal(
        written.length,
        2,
        'should write Startup and Terminate even with sync onConnect'
      );

      // 2. Async rejecting dialFunc must not abort refresh()
      const inst2 = new MockedInstance({
        options: {
          ipType: IpAddressTypes.PUBLIC,
          authType: AuthTypes.IAM,
          instanceConnectionName: 'my-project:us-east1:my-instance',
          sqlAdminFetcher: fetcher,
          limitRateInterval: 50,
          dialFunc: async () => {
            throw new Error('async dial error');
          },
        },
      });
      t.after(() => inst2.close());
      inst2.recordIamPrincipal('u@example.com', 'db');
      await inst2.refresh();
      inst2.cancelRefresh();
      t.equal(
        inst2.host,
        '127.0.0.1',
        'refresh succeeds despite async dial error'
      );

      // 3. Sync throwing dialFunc must not abort refresh()
      const inst3 = new MockedInstance({
        options: {
          ipType: IpAddressTypes.PUBLIC,
          authType: AuthTypes.IAM,
          instanceConnectionName: 'my-project:us-east1:my-instance',
          sqlAdminFetcher: fetcher,
          limitRateInterval: 50,
          dialFunc: () => {
            throw new Error('sync dial error');
          },
        },
      });
      t.after(() => inst3.close());
      inst3.recordIamPrincipal('u@example.com', 'db');
      await inst3.refresh();
      inst3.cancelRefresh();
      t.equal(
        inst3.host,
        '127.0.0.1',
        'refresh succeeds despite sync dial error'
      );
    }
  );

  t.test(
    'probeConnection caps multiple principals and targets under one shared DEFAULT_CONNECT_TIMEOUT_MS budget',
    async t => {
      const {EventEmitter} = await import('node:events');
      let dialCount = 0;
      const scheduledTimeouts: number[] = [];
      let virtualNow = 1000000;

      const origNow = Date.now;
      const origSetTimeout = global.setTimeout;
      t.teardown(() => {
        Date.now = origNow;
        global.setTimeout = origSetTimeout;
      });

      Date.now = () => virtualNow;
      global.setTimeout = ((
        fn: (...args: unknown[]) => void,
        delay?: number,
        ...args: unknown[]
      ) => {
        if (typeof delay === 'number' && delay >= 1000) {
          scheduledTimeouts.push(delay);
          return origSetTimeout(() => {
            virtualNow += delay;
            fn(...args);
          }, 5);
        }
        return origSetTimeout(fn, delay, ...args);
      }) as typeof setTimeout;

      const {CloudSQLInstance: MockedInstance} = t.mockRequire(
        '../src/cloud-sql-instance',
        {
          '../src/crypto': {
            generateKeys: async () => ({
              publicKey: '-----BEGIN PUBLIC KEY-----',
              privateKey: CLIENT_KEY,
            }),
          },
          '../src/time': {
            getRefreshInterval: () => 50,
            isExpirationTimeValid: () => true,
          },
          '../src/dns-lookup': {
            resolveARecord: async () => ['10.0.0.1'],
            resolveTxtRecord: async () => ['my-project:us-east1:my-instance'],
            resolveCnameRecord: async () => {
              throw new Error('no cname');
            },
          },
        }
      );

      const pgFetcher = {
        ...fetcher,
        async getInstanceMetadata() {
          return {
            ...(await fetcher.getInstanceMetadata()),
            databaseVersion: 'POSTGRES_15',
          };
        },
        resolveConnectSettings: async () => 'my-project:us-east1:my-instance',
      };

      const stallingDial = () => {
        dialCount++;
        const fakeSocket = new EventEmitter() as EventEmitter & {
          destroy: () => void;
        };
        fakeSocket.destroy = () => {
          setImmediate(() => fakeSocket.emit('close'));
        };
        return fakeSocket as unknown as import('node:tls').TLSSocket;
      };

      const inst = new MockedInstance({
        options: {
          ipType: IpAddressTypes.PUBLIC,
          authType: AuthTypes.IAM,
          domainName: 'stalling.example.com',
          sqlAdminFetcher: pgFetcher,
          limitRateInterval: 50,
          dialFunc: stallingDial,
        },
      });
      t.after(() => inst.close());

      // Record 4 principals across 2 targets (10.0.0.1 + 127.0.0.1)
      for (let i = 1; i <= 4; i++) {
        inst.recordIamPrincipal(`user${i}@example.com`, 'mydb');
      }

      await inst.refresh();
      inst.cancelRefresh();

      t.equal(
        dialCount,
        1,
        'should stop after shared 30s budget expires on first stalling target instead of 4*2=8 dials'
      );
      t.same(
        scheduledTimeouts,
        [30000],
        'should schedule only one 30000ms timeout across all principals and targets'
      );
    }
  );

  t.test(
    'close() immediately aborts active stalling probe and skips updateValues',
    async t => {
      const {EventEmitter} = await import('node:events');
      let socketDestroyed = false;
      let certCalls = 0;

      const {CloudSQLInstance: MockedInstance} = t.mockRequire(
        '../src/cloud-sql-instance',
        {
          '../src/crypto': {
            generateKeys: async () => ({
              publicKey: '-----BEGIN PUBLIC KEY-----',
              privateKey: CLIENT_KEY,
            }),
          },
          '../src/time': {
            getRefreshInterval: () => 50,
            isExpirationTimeValid: () => true,
          },
        }
      );

      const versionedFetcher = {
        ...fetcher,
        async getInstanceMetadata() {
          return {
            ...(await fetcher.getInstanceMetadata()),
            databaseVersion: 'POSTGRES_15',
          };
        },
        async getEphemeralCertificate() {
          certCalls++;
          return {
            cert: certCalls === 1 ? CLIENT_CERT : `${CLIENT_CERT}\n#gen2`,
            expirationTime: '2033-01-06T10:00:00.232Z',
          };
        },
      };

      let dialStartedResolve: (() => void) | undefined;
      const dialStarted = new Promise<void>(res => {
        dialStartedResolve = res;
      });

      const stallingDial = () => {
        const fakeSocket = new EventEmitter() as EventEmitter & {
          destroy: () => void;
        };
        fakeSocket.destroy = () => {
          socketDestroyed = true;
          setImmediate(() => fakeSocket.emit('close'));
        };
        dialStartedResolve?.();
        return fakeSocket as unknown as import('node:tls').TLSSocket;
      };

      const inst = new MockedInstance({
        options: {
          ipType: IpAddressTypes.PUBLIC,
          authType: AuthTypes.IAM,
          instanceConnectionName: 'my-project:us-east1:my-instance',
          sqlAdminFetcher: versionedFetcher,
          limitRateInterval: 50,
          dialFunc: stallingDial,
        },
      });
      t.after(() => inst.close());

      // Initial refresh succeeds before principals are recorded
      await inst.refresh();
      inst.cancelRefresh();
      t.equal(inst.ephemeralCert?.cert, CLIENT_CERT);

      inst.recordIamPrincipal('user1@example.com', 'mydb');

      const startMs = Date.now();
      const refreshPromise = inst.refresh();
      await dialStarted;

      inst.close();
      await refreshPromise;
      const elapsedMs = Date.now() - startMs;

      t.ok(socketDestroyed, 'close() should destroy active probe socket');
      t.ok(
        elapsedMs < 2000,
        `close() should unblock refresh immediately without waiting 30s (took ${elapsedMs}ms)`
      );
      t.equal(
        inst.ephemeralCert?.cert,
        CLIENT_CERT,
        'should not update ephemeralCert after close()'
      );
    }
  );
});
