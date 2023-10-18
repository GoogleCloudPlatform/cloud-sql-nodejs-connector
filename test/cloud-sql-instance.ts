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
      ipType: IpAddressTypes.PUBLIC,
      authType: AuthTypes.PASSWORD,
      instanceConnectionName: 'my-project:us-east1:my-instance',
      sqlAdminFetcher: failedFetcher,
      limitRateInterval: 50,
    });

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
      ipType: IpAddressTypes.PUBLIC,
      authType: AuthTypes.PASSWORD,
      instanceConnectionName: 'my-project:us-east1:my-instance',
      sqlAdminFetcher: fetcher,
      limitRateInterval: 50,
    });
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
        ipType: IpAddressTypes.PUBLIC,
        authType: AuthTypes.PASSWORD,
        instanceConnectionName: 'my-project:us-east1:my-instance',
        sqlAdminFetcher: failedFetcher,
        limitRateInterval: 50,
      });
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
        ipType: IpAddressTypes.PUBLIC,
        authType: AuthTypes.PASSWORD,
        instanceConnectionName: 'my-project:us-east1:my-instance',
        sqlAdminFetcher: failedFetcher,
        limitRateInterval: 50,
      });
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
      ipType: IpAddressTypes.PUBLIC,
      authType: AuthTypes.PASSWORD,
      instanceConnectionName: 'my-project:us-east1:my-instance',
      sqlAdminFetcher: fetcher,
      limitRateInterval: 50,
    });

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
      ipType: IpAddressTypes.PUBLIC,
      authType: AuthTypes.PASSWORD,
      instanceConnectionName: 'my-project:us-east1:my-instance',
      sqlAdminFetcher: fetcher,
      limitRateInterval: 50,
    });

    let cancelRefreshCalled = false;
    let refreshCalled = false;

    const refreshPromise = instance.refresh();

    instance.cancelRefresh = () => {
      cancelRefreshCalled = true;
      return CloudSQLInstance.prototype.cancelRefresh.call(instance);
    };

    instance.refresh = () => {
      refreshCalled = true;
      return CloudSQLInstance.prototype.refresh.call(instance);
    };

    const forceRefreshPromise = instance.forceRefresh();
    t.strictSame(
      refreshPromise,
      forceRefreshPromise,
      'forceRefresh should return same promise ref from initial refresh call'
    );
    await forceRefreshPromise;

    t.ok(
      !cancelRefreshCalled,
      'should not call cancelRefresh if refresh already happening'
    );
    t.ok(!refreshCalled, 'should not refresh if already happening');

    CloudSQLInstance.prototype.cancelRefresh.call(instance);
  });

  t.test('refresh post-forceRefresh', async t => {
    const instance = new CloudSQLInstance({
      authType: AuthTypes.PASSWORD,
      instanceConnectionName: 'my-project:us-east1:my-instance',
      ipType: IpAddressTypes.PUBLIC,
      limitRateInterval: 0,
      sqlAdminFetcher: fetcher,
    });

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
      ipType: IpAddressTypes.PUBLIC,
      authType: AuthTypes.PASSWORD,
      instanceConnectionName: 'my-project:us-east1:my-instance',
      limitRateInterval: 50,
      sqlAdminFetcher: fetcher,
    });
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
      ipType: IpAddressTypes.PUBLIC,
      authType: AuthTypes.PASSWORD,
      instanceConnectionName: 'my-project:us-east1:my-instance',
      sqlAdminFetcher: slowFetcher,
      limitRateInterval: 50,
    });

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
      ipType: IpAddressTypes.PUBLIC,
      authType: AuthTypes.PASSWORD,
      instanceConnectionName: 'my-project:us-east1:my-instance',
      sqlAdminFetcher: slowFetcher,
      limitRateInterval: 50,
    });

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
        ipType: IpAddressTypes.PUBLIC,
        authType: AuthTypes.PASSWORD,
        instanceConnectionName: 'my-project:us-east1:my-instance',
        sqlAdminFetcher: failAndSlowFetcher,
        limitRateInterval: 50,
      });

      await instance.refresh();
      instance.setEstablishedConnection();

      // starts a new refresh cycle but do not await on it
      instance.refresh();

      instance.cancelRefresh();

      t.ok('should not leave hanging setTimeout');
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
        ipType: IpAddressTypes.PUBLIC,
        authType: AuthTypes.PASSWORD,
        instanceConnectionName: 'my-project:us-east1:my-instance',
        sqlAdminFetcher: updateFetcher,
        limitRateInterval: 0,
      });
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
});
