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

import {resolve} from 'node:path';
import t from 'tap';
import nock from 'nock';
import {GoogleAuth} from 'google-auth-library';
import {sqladmin_v1beta4} from '@googleapis/sqladmin';
import {SQLAdminFetcher} from '../src/sqladmin-fetcher';
import {InstanceConnectionInfo} from '../src/instance-connection-info';
import {setupCredentials} from './fixtures/setup-credentials';
import {CLIENT_CERT} from './fixtures/certs';
import {AuthTypes} from '../src/auth-types';

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

const mockRequest = (
  instanceInfo: InstanceConnectionInfo,
  overrides?: sqladmin_v1beta4.Schema$ConnectSettings,
  sqlAdminRootUrl?: string
): void => {
  const {projectId, regionId, instanceId} = instanceInfo;

  nock(sqlAdminRootUrl ?? 'https://sqladmin.googleapis.com')
    .get(
      `/sql/v1beta4/projects/${projectId}/instances/${instanceId}/connectSettings`
    )
    .reply(200, {
      kind: 'sql#connectSettings',
      serverCaCert: serverCaCertResponse(instanceId),
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
      databaseVersion: 'POSTGRES_14',
      backendType: 'SECOND_GEN',
      // overrides any properties from the base mock
      ...overrides,
    });
};

t.test('getInstanceMetadata', async t => {
  setupCredentials(t);
  const instanceConnectionInfo: InstanceConnectionInfo = {
    projectId: 'my-project',
    regionId: 'us-east1',
    instanceId: 'my-instance',
  };
  mockRequest(instanceConnectionInfo);

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
  setupCredentials(t);
  const sqlAdminRootUrl = 'https://sqladmin.mydomain.com';
  const instanceConnectionInfo: InstanceConnectionInfo = {
    projectId: 'my-project',
    regionId: 'us-east1',
    instanceId: 'my-instance',
  };
  mockRequest(instanceConnectionInfo, {}, sqlAdminRootUrl);

  const fetcher = new SQLAdminFetcher({sqlAdminRootUrl});
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

t.test('getInstanceMetadata private ip', async t => {
  setupCredentials(t);
  const instanceConnectionInfo: InstanceConnectionInfo = {
    projectId: 'private-ip-project',
    regionId: 'us-east1',
    instanceId: 'private-ip-instance',
  };
  mockRequest(instanceConnectionInfo, {
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
  setupCredentials(t);
  const instanceConnectionInfo: InstanceConnectionInfo = {
    projectId: 'no-cert-project',
    regionId: 'us-east1',
    instanceId: 'no-cert-instance',
  };
  mockRequest(instanceConnectionInfo, {
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
  setupCredentials(t);
  const instanceConnectionInfo: InstanceConnectionInfo = {
    projectId: 'no-response-data-project',
    regionId: 'us-east1',
    instanceId: 'no-response-data-instance',
  };
  nock('https://sqladmin.googleapis.com/sql/v1beta4/projects')
    .get(
      '/no-response-data-project/instances/no-response-data-instance/connectSettings'
    )
    .reply(200, '');

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
  setupCredentials(t);
  const instanceConnectionInfo: InstanceConnectionInfo = {
    projectId: 'no-region-project',
    regionId: 'us-east1',
    instanceId: 'no-region-instance',
  };
  mockRequest(instanceConnectionInfo, {
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
  setupCredentials(t);
  const instanceConnectionInfo: InstanceConnectionInfo = {
    projectId: 'invalid-region-project',
    regionId: 'us-east1',
    instanceId: 'invalid-region-instance',
  };
  mockRequest(instanceConnectionInfo, {
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

const mockGenerateEphemeralCertRequest = (
  instanceInfo: InstanceConnectionInfo,
  overrides?: sqladmin_v1beta4.Schema$GenerateEphemeralCertResponse,
  sqlAdminRootUrl?: string
): void => {
  const {projectId, instanceId} = instanceInfo;

  nock(sqlAdminRootUrl ?? 'https://sqladmin.googleapis.com')
    .post(
      `/sql/v1beta4/projects/${projectId}/instances/${instanceId}:generateEphemeralCert`
    )
    .reply(200, {
      ephemeralCert: ephCertResponse,
      // overrides any properties from the base mock
      ...overrides,
    });
};

t.test('getEphemeralCertificate', async t => {
  setupCredentials(t);
  const instanceConnectionInfo: InstanceConnectionInfo = {
    projectId: 'my-project',
    regionId: 'us-east1',
    instanceId: 'my-instance',
  };
  mockGenerateEphemeralCertRequest(instanceConnectionInfo);

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

t.test('getEphemeralCertificate custom SQL Admin API endpoint', async t => {
  setupCredentials(t);
  const sqlAdminRootUrl = 'https://sqladmin.mydomain.com';
  const instanceConnectionInfo: InstanceConnectionInfo = {
    projectId: 'my-project',
    regionId: 'us-east1',
    instanceId: 'my-instance',
  };
  mockGenerateEphemeralCertRequest(instanceConnectionInfo, {}, sqlAdminRootUrl);

  const fetcher = new SQLAdminFetcher({sqlAdminRootUrl});
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

t.test('getEphemeralCertificate no certificate', async t => {
  setupCredentials(t);
  const instanceConnectionInfo: InstanceConnectionInfo = {
    projectId: 'no-cert-project',
    regionId: 'us-east1',
    instanceId: 'no-cert-instance',
  };
  mockGenerateEphemeralCertRequest(instanceConnectionInfo, {
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
  setupCredentials(t);
  const instanceConnectionInfo: InstanceConnectionInfo = {
    projectId: 'no-response-data-project',
    regionId: 'us-east1',
    instanceId: 'no-response-data-instance',
  };
  nock('https://sqladmin.googleapis.com/sql/v1beta4/projects')
    .post(
      '/no-response-data-project/instances/no-response-data-instance:generateEphemeralCert'
    )
    .reply(200, '');

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
  setupCredentials(t);
  const instanceConnectionInfo: InstanceConnectionInfo = {
    projectId: 'my-project',
    regionId: 'us-east1',
    instanceId: 'my-instance',
  };
  mockGenerateEphemeralCertRequest(instanceConnectionInfo);

  const loginAuth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/sqlservice.login'],
  });
  loginAuth.getAccessToken = async () => null;

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

t.test('getEphemeralCertificate sets access token', async t => {
  setupCredentials(t);
  const instanceConnectionInfo: InstanceConnectionInfo = {
    projectId: 'my-project',
    regionId: 'us-east1',
    instanceId: 'my-instance',
  };
  const {projectId, instanceId} = instanceConnectionInfo;

  nock('https://sqladmin.googleapis.com/sql/v1beta4/projects')
    .post(`/${projectId}/instances/${instanceId}:generateEphemeralCert`)
    .reply((uri, reqBody) => {
      // check that token is sent in the ephemeral cert request
      t.hasProp(
        reqBody,
        'access_token',
        'should have access_token in request body'
      );
      return [
        200,
        {
          ephemeralCert: ephCertResponse,
        },
      ];
    });

  const fetcher = new SQLAdminFetcher();
  const ephemeralCert = await fetcher.getEphemeralCertificate(
    instanceConnectionInfo,
    'key',
    AuthTypes.IAM
  );

  t.same(ephemeralCert.cert, CLIENT_CERT, 'should return expected ssl cert');
  // check that it is using the earlier expiration time for the token
  t.notMatch(
    ephemeralCert.expirationTime,
    '3022-07-22T17:53:09.000Z',
    'should return earlier token expiration time'
  );
});

t.test('generateAccessToken endpoint should retry', async t => {
  const path = t.testdir({
    credentials: JSON.stringify({
      delegates: [],
      service_account_impersonation_url:
        'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/foo@dev.org:generateAccessToken',
      source_credentials: {
        client_id:
          'b5bb9d8014a0f9b1d61e21e796d78dccdf1352f23cd32812f4850b878ae4944c',
        client_secret:
          '7d865e959b2466918c9863afca942d0fb89d7c9ac0c99bafc3749504ded97730',
        refresh_token:
          'bf07a7fbb825fc0aae7bf4a1177b2b31fcf8a3feeaf7092761e18c859ee52a9c',
        type: 'authorized_user',
      },
      type: 'impersonated_service_account',
    }),
  });
  const creds = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  process.env.GOOGLE_APPLICATION_CREDENTIALS = resolve(path, 'credentials');
  t.teardown(() => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = creds;
  });

  nock('https://oauth2.googleapis.com')
    .persist()
    .post('/token')
    .reply(200, {access_token: 'abc123', expires_in: 1});

  nock('https://oauth2.googleapis.com').post('/tokeninfo').reply(200, {
    expires_in: 3600,
    scope: 'https://www.googleapis.com/auth/sqlservice.login',
  });

  nock('https://iamcredentials.googleapis.com/v1')
    .post('/projects/-/serviceAccounts/foo@dev.org:generateAccessToken')
    .replyWithError({code: 'ECONNRESET'});

  nock('https://iamcredentials.googleapis.com/v1')
    .post('/projects/-/serviceAccounts/foo@dev.org:generateAccessToken')
    .reply(200, {
      accessToken:
        'b5bb9d8014a0f9b1d61e21e796d78dccdf1352f23cd32812f4850b878ae4944c',
      expireTime: new Date(Date.now() + 3600).toISOString(),
    });

  const instanceConnectionInfo: InstanceConnectionInfo = {
    projectId: 'my-project',
    regionId: 'us-east1',
    instanceId: 'my-instance',
  };

  // Second try should succeed
  mockRequest(instanceConnectionInfo);

  const fetcher = new SQLAdminFetcher();
  const instanceMetadata = await fetcher.getInstanceMetadata(
    instanceConnectionInfo
  );
  t.ok(instanceMetadata, 'should return expected instance metadata object');
});
