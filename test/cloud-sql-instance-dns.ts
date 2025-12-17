// Copyright 2025 Google LLC
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

t.test('CloudSQLInstance DNS Lookup', async t => {
  setupCredentials(t);

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

  let resolveARecordMock = async (): Promise<string[]> => {
    return [];
  };
  let resolveTXTRecordMock = async (): Promise<string[]> => {
    return [];
  };

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
      isExpirationTimeValid() {
        return true;
      },
    },
    '../src/dns-lookup': {
      resolveARecord: async (name: string) => resolveARecordMock(name),
      resolveTxtRecord: async (name: string) => resolveTXTRecordMock(name),
    },
  });

  t.test('should use resolved IP when domainName is present', async t => {
    const expectedIp = '10.0.0.1';
    const expectInstanceName = 'my-project:us-east1:my-instance';
    resolveARecordMock = async (name: string) => {
      t.equal(name, 'example.com');
      return [expectedIp];
    };
    resolveTXTRecordMock = async (name: string) => {
      t.equal(name, 'example.com');
      return [expectInstanceName];
    };

    const instance = await CloudSQLInstance.getCloudSQLInstance({
      ipType: IpAddressTypes.PUBLIC,
      authType: AuthTypes.PASSWORD,
      domainName: 'example.com',
      sqlAdminFetcher: fetcher,
    });
    t.after(() => instance.close());

    t.equal(instance.host, expectedIp, 'Host should match resolved IP');
  });

  t.test('should fallback to metadata IP when resolution fails', async t => {
    resolveARecordMock = async () => {
      throw new Error('DNS Error');
    };
    const expectInstanceName = 'my-project:us-east1:my-instance';
    resolveTXTRecordMock = async (name: string) => {
      t.equal(name, 'example.com');
      return [expectInstanceName];
    };

    const instance = await CloudSQLInstance.getCloudSQLInstance({
      ipType: IpAddressTypes.PUBLIC,
      authType: AuthTypes.PASSWORD,
      domainName: 'example.com',
      sqlAdminFetcher: fetcher,
    });
    t.after(() => instance.close());

    t.equal(instance.host, '127.0.0.1', 'Host should fallback to metadata IP');
  });

  t.test(
    'should fallback to metadata IP when resolution returns empty',
    async t => {
      resolveARecordMock = async () => {
        return [];
      };
      const expectInstanceName = 'my-project:us-east1:my-instance';
      resolveTXTRecordMock = async (name: string) => {
        t.equal(name, 'example.com');
        return [expectInstanceName];
      };

      const instance = await CloudSQLInstance.getCloudSQLInstance({
        ipType: IpAddressTypes.PUBLIC,
        authType: AuthTypes.PASSWORD,
        domainName: 'example.com',
        sqlAdminFetcher: fetcher,
      });
      t.after(() => instance.close());

      t.equal(
        instance.host,
        '127.0.0.1',
        'Host should fallback to metadata IP'
      );
    }
  );

  t.test('should use metadata IP when domainName is not present', async t => {
    // resolveARecord should not be called, but if it is, ensure it doesn't return the expected IP
    resolveARecordMock = async () => {
      t.fail('Should not attempt to resolve DNS');
      return ['10.0.0.1'];
    };

    const instance = await CloudSQLInstance.getCloudSQLInstance({
      ipType: IpAddressTypes.PUBLIC,
      authType: AuthTypes.PASSWORD,
      instanceConnectionName: 'my-project:us-east1:my-instance',
      sqlAdminFetcher: fetcher,
    });
    t.after(() => instance.close());

    t.equal(instance.host, '127.0.0.1', 'Host should use metadata IP');
  });
});
