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
import { AuthTypes } from '../src/auth-types';
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

  t.same(
    instance.serverCaCert.cert,
    CA_CERT,
    'should have expected serverCaCert'
  );

  instance.close();

  await new Promise(res => {
    const start = Date.now();
    let refreshCount = 0;
    const refreshInstance = new CloudSQLInstance({
      ipType: IpAddressTypes.PUBLIC,
      authType: AuthTypes.PASSWORD,
      instanceConnectionName: 'my-project:us-east1:my-instance',
      sqlAdminFetcher: fetcher,
    });
    refreshInstance._refresh = refreshInstance.refresh;
    refreshInstance.refresh = () => {
      if (refreshCount === 3) {
        refreshInstance.close();
        const end = Date.now();
        const duration = end - start;
        t.ok(
          duration >= 150,
          `should respect refresh delay time, ${duration}ms elapsed`
        );
        return res(undefined);
      }
      refreshCount++;
      t.ok(refreshCount, `should refresh ${refreshCount} times`);
      refreshInstance._refresh();
    };
    // starts out refresh logic
    refreshInstance.refresh();
  });
});
