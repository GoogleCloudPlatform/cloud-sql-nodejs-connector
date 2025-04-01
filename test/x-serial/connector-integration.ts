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
import nock from 'nock';
import {CA_CERT, CLIENT_CERT, CLIENT_KEY} from '../fixtures/certs';
import {setupCredentials} from '../fixtures/setup-credentials';
import {setupTLSServer} from '../fixtures/setup-tls-server';

// test that reaches out for both Google Auth & SQL Admin APIs,
// then use retrieved keys and certs to stablish an actual
// socket connection to a mock TLS server
t.test('Connector integration test', async t => {
  setupCredentials(t); // setup google-auth credentials mocks
  await setupTLSServer(t);

  nock('https://sqladmin.googleapis.com/sql/v1beta4/projects')
    .get('/my-project/instances/my-instance/connectSettings')
    .reply(200, {
      kind: 'sql#connectSettings',
      serverCaCert: {
        kind: 'sql#sslCert',
        certSerialNumber: '0',
        cert: CA_CERT,
        commonName:
          'C=US,O=Google\\, Inc,CN=Google Cloud SQL Server CA,dnQualifier=1234',
        sha1Fingerprint: '004fe8623f02cb953bb5addbd0309f3b8f136c00',
        instance: 'my-instance',
        createTime: '2023-01-01T10:00:00.232Z',
        expirationTime: '2033-01-06T10:00:00.232Z',
      },
      ipAddresses: [
        {
          type: 'PRIMARY',
          ipAddress: '127.0.0.1',
        },
      ],
      region: 'us-east1',
      databaseVersion: 'POSTGRES_14',
      backendType: 'SECOND_GEN',
    });

  nock('https://sqladmin.googleapis.com/sql/v1beta4/projects')
    .post('/my-project/instances/my-instance:generateEphemeralCert')
    .reply(200, {
      ephemeralCert: {
        kind: 'sql#sslCert',
        certSerialNumber: '0',
        cert: CLIENT_CERT,
        commonName:
          'C=US,O=Google\\, Inc,CN=Google Cloud SQL Server CA,dnQualifier=1234',
        sha1Fingerprint: '004fe8623f02cb953bb5addbd0309f3b8f136c00',
        instance: 'my-instance',
        createTime: '2023-01-01T10:00:00.232Z',
        expirationTime: '2033-01-06T10:00:00.232Z',
      },
    });

  // mocks generateKeys module so that it can return a deterministic result
  const {Connector} = t.mockRequire('../../src/connector', {
    '../../src/cloud-sql-instance': t.mockRequire(
      '../../src/cloud-sql-instance',
      {
        '../../src/crypto': {
          generateKeys: async () => ({
            publicKey: '-----BEGIN PUBLIC KEY-----',
            privateKey: CLIENT_KEY,
          }),
        },
      }
    ),
  });

  const connector = new Connector();
  const opts = await connector.getOptions({
    ipType: 'PUBLIC',
    authType: 'PASSWORD',
    instanceConnectionName: 'my-project:us-east1:my-instance',
  });

  await new Promise((res, rej): void => {
    // driver factory method to retrieve a new socket
    const tlsSocket = opts.stream();
    tlsSocket.on('secureConnect', () => {
      t.ok(tlsSocket.authorized, 'socket connected');
      tlsSocket.end();
      connector.close();
      res(null);
    });
    tlsSocket.on('error', (err: Error) => {
      rej(err);
    });
  });
});
