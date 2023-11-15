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
import {InstanceConnectionInfo} from '../src/instance-connection-info';
import {CLIENT_CERT} from './fixtures/certs';
import {AuthTypes} from '../src/auth-types';

// Mocks the @googleapis/sqladmin interface
interface SQLAdminOptions {
  rootUrl: string;
}
interface IpAddress {
  type?: string | null;
  ipAddress?: string | null;
}
interface SQLAdminClientGetResponse {
  dnsName?: string;
  ipAddresses?: IpAddress[];
  region?: string;
  serverCaCert?: {} | ReturnType<typeof serverCaCertResponse>;
}
interface SQLAdminClientGenerateEphemeralCertResponse {
  ephemeralCert: void | {cert?: string};
}
interface SQLAdminClient {
  get: ({
    requestBody,
  }: {
    requestBody?: unknown;
  }) => void | {data?: void | SQLAdminClientGetResponse};
  generateEphemeralCert: ({
    requestBody,
  }: {
    requestBody?: unknown;
  }) => void | {data?: void | SQLAdminClientGenerateEphemeralCertResponse};
}
let sqlAdminOptions: SQLAdminOptions;
const sqlAdminClient: SQLAdminClient = {
  get() {},
  generateEphemeralCert() {},
};

class Sqladmin {
  public connect;
  constructor(opts: SQLAdminOptions) {
    this.connect = sqlAdminClient;
    sqlAdminOptions = opts;
  }
}

const {SQLAdminFetcher} = t.mockRequire('../src/sqladmin-fetcher', {
  'google-auth-library': {
    GoogleAuth: class {},
  },
  '@googleapis/sqladmin': {
    sqladmin_v1beta4: {Sqladmin},
  },
});

const serverCaCertResponse = (instance: string) => ({
  kind: 'sql#sslCert',
  certSerialNumber: '0',
  cert: '-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----',
  commonName:
    'C=US,O=Google\\, Inc,CN=Google Cloud SQL Server CA,dnQualifier=1234',
  sha1Fingerprint: '004fe8623f02cb953bb5addbd0309f3b8f136c00',
  instance,
  createTime: '2023-01-01T10:00:00.232Z',
  expirationTime: '2033-01-06T10:00:00.232Z',
});

const ephCertResponse = {
  cert: CLIENT_CERT,
};

const mockEmptySQLAdminGetInstanceMetadata = (): void => {
  sqlAdminClient.get = () => ({});
};

const mockSQLAdminGetInstanceMetadata = (
  instanceInfo: InstanceConnectionInfo,
  overrides?: SQLAdminClientGetResponse
): void => {
  const {regionId, instanceId} = instanceInfo;

  sqlAdminClient.get = () => ({
    data: {
      ipAddresses: [
        {
          type: 'PRIMARY',
          ipAddress: '0.0.0.0',
        },
        {
          type: 'OUTGOING',
          ipAddress: '0.0.0.1',
        },
      ],
      region: regionId,
      serverCaCert: serverCaCertResponse(instanceId),
      ...overrides,
    },
  });
};

const mockEmptySQLAdminGenerateEphemeralCert = (): void => {
  sqlAdminClient.generateEphemeralCert = () => ({});
};

const mockSQLAdminGenerateEphemeralCert = (
  instanceInfo: InstanceConnectionInfo,
  overrides?: SQLAdminClientGenerateEphemeralCertResponse
): void => {
  sqlAdminClient.generateEphemeralCert = () => ({
    data: {
      ephemeralCert: ephCertResponse,
      ...overrides,
    },
  });
};

t.afterEach(() => {
  sqlAdminClient.get = () => {};
  sqlAdminClient.generateEphemeralCert = () => {};
});

t.test('constructor loginAuth using GoogleAuth instance', async t => {
  class GoogleAuth {}
  const {SQLAdminFetcher} = t.mockRequire('../src/sqladmin-fetcher', {
    'google-auth-library': {
      GoogleAuth,
    },
    '@googleapis/sqladmin': {
      sqladmin_v1beta4: {Sqladmin},
    },
  });
  await t.test('should support GoogleAuth for `loginAuth`', async t => {
    const auth = new GoogleAuth();
    t.ok(new SQLAdminFetcher({loginAuth: auth}));
  });
});

t.test('constructor loginAuth using non-GoogleAuth instance', async t => {
  await t.test('should support `AuthClient` for `loginAuth`', async t => {
    const authClient = {};
    t.ok(new SQLAdminFetcher({loginAuth: authClient}));
  });
});

t.test('getInstanceMetadata', async t => {
  const instanceConnectionInfo: InstanceConnectionInfo = {
    projectId: 'my-project',
    regionId: 'us-east1',
    instanceId: 'my-instance',
  };
  mockSQLAdminGetInstanceMetadata(instanceConnectionInfo);

  const fetcher = new SQLAdminFetcher();
  const instanceMetadata = await fetcher.getInstanceMetadata(
    instanceConnectionInfo
  );
  t.same(
    instanceMetadata,
    {
      ipAddresses: {
        public: '0.0.0.0',
      },
      serverCaCert: {
        cert: '-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----',
        expirationTime: '2033-01-06T10:00:00.232Z',
      },
    },
    'should return expected instance metadata object'
  );
});

t.test('getInstanceMetadata custom SQL Admin API endpoint', async t => {
  const sqlAdminAPIEndpoint = 'https://sqladmin.mydomain.com';
  new SQLAdminFetcher({sqlAdminAPIEndpoint});
  t.strictSame(
    sqlAdminOptions.rootUrl,
    sqlAdminAPIEndpoint,
    'should pass on the sql admin endpoint to the sqladmin lib'
  );
});

t.test('getInstanceMetadata private ip', async t => {
  const instanceConnectionInfo: InstanceConnectionInfo = {
    projectId: 'private-ip-project',
    regionId: 'us-east1',
    instanceId: 'private-ip-instance',
  };
  mockSQLAdminGetInstanceMetadata(instanceConnectionInfo, {
    ipAddresses: [
      {
        type: 'PRIVATE',
        ipAddress: '0.0.0.0',
      },
    ],
  });

  const fetcher = new SQLAdminFetcher();
  const instanceMetadata = await fetcher.getInstanceMetadata(
    instanceConnectionInfo
  );
  t.match(
    instanceMetadata,
    {
      ipAddresses: {
        private: '0.0.0.0',
      },
    },
    'should return expected instance metadata containing private ip'
  );
});

t.test('getInstanceMetadata no valid cert', async t => {
  const instanceConnectionInfo: InstanceConnectionInfo = {
    projectId: 'no-cert-project',
    regionId: 'us-east1',
    instanceId: 'no-cert-instance',
  };
  mockSQLAdminGetInstanceMetadata(instanceConnectionInfo, {
    serverCaCert: {},
  });

  const fetcher = new SQLAdminFetcher();
  t.rejects(
    fetcher.getInstanceMetadata(instanceConnectionInfo),
    {
      code: 'ENOSQLADMINCERT',
    },
    'should throw no cert error'
  );
});

t.test('getInstanceMetadata no response data', async t => {
  const instanceConnectionInfo: InstanceConnectionInfo = {
    projectId: 'no-response-data-project',
    regionId: 'us-east1',
    instanceId: 'no-response-data-instance',
  };
  mockEmptySQLAdminGetInstanceMetadata();

  const fetcher = new SQLAdminFetcher();
  t.rejects(
    fetcher.getInstanceMetadata(instanceConnectionInfo),
    {
      message:
        'Failed to find metadata on project id: no-response-data-project and instance id: no-response-data-instance. Ensure network connectivity and validate the provided `instanceConnectionName` config value',
      code: 'ENOSQLADMIN',
    },
    'should throw no response data error'
  );
});

t.test('getInstanceMetadata no valid region', async t => {
  const instanceConnectionInfo: InstanceConnectionInfo = {
    projectId: 'no-region-project',
    regionId: 'us-east1',
    instanceId: 'no-region-instance',
  };
  mockSQLAdminGetInstanceMetadata(instanceConnectionInfo, {
    region: undefined,
  });

  const fetcher = new SQLAdminFetcher();
  t.rejects(
    fetcher.getInstanceMetadata(instanceConnectionInfo),
    {
      code: 'ENOSQLADMINREGION',
    },
    'should throw no region found error'
  );
});

t.test('getInstanceMetadata invalid region', async t => {
  const instanceConnectionInfo: InstanceConnectionInfo = {
    projectId: 'invalid-region-project',
    regionId: 'us-east1',
    instanceId: 'invalid-region-instance',
  };
  mockSQLAdminGetInstanceMetadata(instanceConnectionInfo, {
    region: 'something-else',
  });

  const fetcher = new SQLAdminFetcher();
  t.rejects(
    fetcher.getInstanceMetadata(instanceConnectionInfo),
    {
      message:
        'Provided region was mismatched. Got something-else, want us-east1',
      code: 'EBADSQLADMINREGION',
    },
    'should throw invalid region error'
  );
});

t.test('getEphemeralCertificate', async t => {
  const instanceConnectionInfo: InstanceConnectionInfo = {
    projectId: 'my-project',
    regionId: 'us-east1',
    instanceId: 'my-instance',
  };
  mockSQLAdminGenerateEphemeralCert(instanceConnectionInfo);

  const fetcher = new SQLAdminFetcher();
  const ephemeralCert = await fetcher.getEphemeralCertificate(
    instanceConnectionInfo,
    'key',
    AuthTypes.PASSWORD
  );
  t.same(
    ephemeralCert,
    {
      cert: CLIENT_CERT,
      expirationTime: '3022-07-22T17:53:09.000Z',
    },
    'should return expected ssl cert'
  );
});

t.test('getEphemeralCertificate no resulting certificate', async t => {
  const instanceConnectionInfo: InstanceConnectionInfo = {
    projectId: 'no-cert-project',
    regionId: 'us-east1',
    instanceId: 'no-cert-instance',
  };
  mockSQLAdminGenerateEphemeralCert(instanceConnectionInfo, {
    ephemeralCert: undefined,
  });

  const fetcher = new SQLAdminFetcher();
  t.rejects(
    fetcher.getEphemeralCertificate(
      instanceConnectionInfo,
      'key',
      AuthTypes.PASSWORD
    ),
    {
      code: 'ENOSQLADMINEPH',
    },
    'should throw no response data error on no ephemeral cert response data'
  );
});

t.test('getEphemeralCertificate no response data', async t => {
  const instanceConnectionInfo: InstanceConnectionInfo = {
    projectId: 'no-response-data-project',
    regionId: 'us-east1',
    instanceId: 'no-response-data-instance',
  };
  mockEmptySQLAdminGenerateEphemeralCert();

  const fetcher = new SQLAdminFetcher();
  t.rejects(
    fetcher.getEphemeralCertificate(
      instanceConnectionInfo,
      'key',
      AuthTypes.PASSWORD
    ),
    {
      message:
        'Failed to find metadata on project id: no-response-data-project and instance id: no-response-data-instance. Ensure network connectivity and validate the provided `instanceConnectionName` config value',
      code: 'ENOSQLADMIN',
    },
    'should throw no response data error on no ephemeral cert response data'
  );
});

t.test('getEphemeralCertificate no access token', async t => {
  const instanceConnectionInfo: InstanceConnectionInfo = {
    projectId: 'my-project',
    regionId: 'us-east1',
    instanceId: 'my-instance',
  };
  const {SQLAdminFetcher} = t.mockRequire('../src/sqladmin-fetcher', {
    'google-auth-library': {
      GoogleAuth: class {
        async getAccessToken() {
          return '';
        }
        async getClient() {
          return {};
        }
      },
    },
    '@googleapis/sqladmin': {
      sqladmin_v1beta4: {Sqladmin},
    },
  });
  mockSQLAdminGenerateEphemeralCert(instanceConnectionInfo);

  const loginAuth = {};
  const fetcher = new SQLAdminFetcher({loginAuth});

  t.rejects(
    fetcher.getEphemeralCertificate(
      instanceConnectionInfo,
      'key',
      AuthTypes.IAM
    ),
    {
      message: 'Failed to get access token for automatic IAM authentication.',
      code: 'ENOACCESSTOKEN',
    },
    'should throw no access token error'
  );
});

t.test('getEphemeralCertificate sets access token on IAM', async t => {
  const instanceConnectionInfo: InstanceConnectionInfo = {
    projectId: 'my-project',
    regionId: 'us-east1',
    instanceId: 'my-instance',
  };
  const {SQLAdminFetcher} = t.mockRequire('../src/sqladmin-fetcher', {
    'google-auth-library': {
      GoogleAuth: class {
        async getAccessToken() {
          return 'token';
        }
        async getClient() {
          return {
            credentials: {
              expire_date: '2033-01-06T10:00:00.232Z',
            },
          };
        }
      },
    },
    '@googleapis/sqladmin': {
      sqladmin_v1beta4: {Sqladmin},
    },
  });
  const loginAuth = {};

  sqlAdminClient.generateEphemeralCert = ({requestBody}) => {
    t.hasProp(
      requestBody,
      'access_token',
      'should have access_token in request body'
    );
    return {
      data: {
        ephemeralCert: ephCertResponse,
      },
    };
  };

  const fetcher = new SQLAdminFetcher({loginAuth});
  const ephemeralCert = await fetcher.getEphemeralCertificate(
    instanceConnectionInfo,
    'key',
    AuthTypes.IAM
  );

  t.same(ephemeralCert.cert, CLIENT_CERT, 'should return expected ssl cert');
});
