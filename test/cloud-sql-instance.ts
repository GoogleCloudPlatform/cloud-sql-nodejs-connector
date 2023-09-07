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
    },
    getEphemeralCertificate() {
      return Promise.resolve({
        cert: CLIENT_CERT,
        expirationTime: '2033-01-06T10:00:00.232Z',
      });
    },
  };

  // mocks generateKeys module so that it can return a deterministic result
  const {CloudSQLInstance} = t.mock('../src/cloud-sql-instance', {
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
    },
  });

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

  t.test('refresh', t => {
    t.plan(4);
    const start = Date.now();
    let refreshCount = 0;
    const instance = new CloudSQLInstance({
      ipType: IpAddressTypes.PUBLIC,
      authType: AuthTypes.PASSWORD,
      instanceConnectionName: 'my-project:us-east1:my-instance',
      sqlAdminFetcher: fetcher,
    });
    const refreshFn = instance.refresh;
    instance.refresh = () => {
      if (refreshCount === 3) {
        instance.cancelRefresh();
        const end = Date.now();
        const duration = end - start;
        t.ok(
          duration >= 150,
          `should respect refresh delay time, ${duration}ms elapsed`
        );
        instance.refresh = refreshFn;
        return t.end();
      }
      refreshCount++;
      t.ok(refreshCount, `should refresh ${refreshCount} times`);
      refreshFn.call(instance);
    };
    // starts out refresh logic
    instance.refresh();
  });

  t.test('forceRefresh', async t => {
    const instance = new CloudSQLInstance({
      ipType: IpAddressTypes.PUBLIC,
      authType: AuthTypes.PASSWORD,
      instanceConnectionName: 'my-project:us-east1:my-instance',
      sqlAdminFetcher: fetcher,
    });

    await instance.refresh();

    let cancelRefreshCalled = false;
    let refreshCalled = false;

    const cancelRefreshFn = instance.cancelRefresh;
    instance.cancelRefresh = () => {
      cancelRefreshCalled = true;
      cancelRefreshFn.call(instance);
      instance.cancelRefresh = cancelRefreshFn;
    };

    const refreshFn = instance.refresh;
    instance.refresh = async () => {
      refreshCalled = true;
      await refreshFn.call(instance);
      instance.refresh = refreshFn;
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
    });

    let cancelRefreshCalled = false;
    let refreshCalled = false;

    const refreshPromise = instance.refresh();

    const cancelRefreshFn = instance.cancelRefresh;
    instance.cancelRefresh = () => {
      cancelRefreshCalled = true;
      cancelRefreshFn.call(instance);
      instance.cancelRefresh = cancelRefreshFn;
    };

    const refreshFn = instance.refresh;
    instance.refresh = async () => {
      refreshCalled = true;
      await refreshFn.call(instance);
      instance.refresh = refreshFn;
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

    instance.cancelRefresh();
  });

  t.test('refresh post-forceRefresh', async t => {
    t.plan(4);
    const start = Date.now();
    let refreshCount = 0;
    const instance = new CloudSQLInstance({
      ipType: IpAddressTypes.PUBLIC,
      authType: AuthTypes.PASSWORD,
      instanceConnectionName: 'my-project:us-east1:my-instance',
      sqlAdminFetcher: fetcher,
    });

    // starts regular refresh cycle
    await instance.refresh();

    const refreshFn = instance.refresh;
    instance.refresh = () => {
      if (refreshCount === 3) {
        instance.cancelRefresh();
        const end = Date.now();
        const duration = end - start;
        t.ok(
          duration >= 150,
          `should respect refresh delay time, ${duration}ms elapsed`
        );
        instance.refresh = refreshFn;
        return t.end();
      }
      refreshCount++;
      t.ok(refreshCount, `should refresh ${refreshCount} times`);
      refreshFn.call(instance);
    };

    await instance.forceRefresh();
    await new Promise((res): void => {
      setTimeout(res, 200);
    });
  });
});
