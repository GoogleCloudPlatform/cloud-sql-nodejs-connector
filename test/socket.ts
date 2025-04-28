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

import tls from 'node:tls';
import t from 'tap';
import {getSocket, validateCertificate} from '../src/socket';
import {CA_CERT, CLIENT_CERT, CLIENT_KEY} from './fixtures/certs';
import {setupTLSServer} from './fixtures/setup-tls-server';
import {parseInstanceConnectionName} from '../src/parse-instance-connection-name';

t.test('getSocket', async t => {
  // the mock tls server for this test will use a custom port in order
  // to avoid conflicting ports with the integration tests
  await setupTLSServer(t, 3001);

  await new Promise((res, rej): void => {
    const socket = getSocket({
      instanceInfo: {
        projectId: 'my-project',
        regionId: 'region-id',
        instanceId: 'my-instance',
      },
      ephemeralCert: {
        cert: CLIENT_CERT,
        expirationTime: '2033-01-06T10:00:00.232Z',
      },
      host: '127.0.0.1',
      port: 3001, // using port 3001 here to avoid EADDRINUSE errors
      privateKey: CLIENT_KEY,
      serverCaCert: {
        cert: CA_CERT,
        expirationTime: '2033-01-06T10:00:00.232Z',
      },
      serverCaMode: 'GOOGLE_MANAGED_INTERNAL_CA',
      dnsName: 'abcde.12345.us-central1.sql.goog',
    });

    socket.on('secureConnect', () => {
      t.ok(socket.authorized, 'socket connected');
      t.same(
        socket.connect(1234), // bogus port to avoid any connection
        socket,
        'socket.connect should be noop returning its own value'
      );
      socket.end();
      res(null);
    });
    socket.on('error', err => {
      rej(err);
    });
  });
});

t.test('validateCertificate no cert', async t => {
  t.match(
    validateCertificate(
      {
        projectId: 'my-project',
        regionId: 'region-id',
        instanceId: 'my-instance',
      },
      null,
      'abcde.12345.us-central1.sql.goog'
    )('hostname', {} as tls.PeerCertificate),
    {
      code: 'ENOSQLADMINVERIFYCERT',
    },
    'should return a missing cert to verify error'
  );
});

t.test('validateCertificate mismatch', async t => {
  const cert = {
    subject: {
      CN: 'other-project:other-instance',
    },
  } as tls.PeerCertificate;
  t.match(
    validateCertificate(
      {
        projectId: 'my-project',
        regionId: 'region-id',
        instanceId: 'my-instance',
      },
      null,
      'abcde.12345.us-central1.sql.goog'
    )('hostname', cert),
    {
      code: 'EBADSQLADMINVERIFYCERT',
    },
    'should return a missing cert to verify error'
  );
});

t.test('validateCertificate mismatch CAS CA', async t => {
  const cert = {
    subjectaltname: 'DNS:abcde.12345.us-central1.sql.goog',
  } as tls.PeerCertificate;
  t.match(
    validateCertificate(
      {
        projectId: 'my-project',
        regionId: 'region-id',
        instanceId: 'my-instance',
      },
      'GOOGLE_MANAGED_CAS_CA',
      'bad.dns.us-central1.sql.goog'
    )('hostname', cert),
    {
      message:
        "Hostname/IP does not match certificate's altnames: Host: bad.dns.us-central1.sql.goog. is not in the cert's altnames: DNS:abcde.12345.us-central1.sql.goog",
      code: 'ERR_TLS_CERT_ALTNAME_INVALID',
    },
    'should return an invalid altname error'
  );
});

t.test('validateCertificate valid CAS CA', async t => {
  const cert = {
    subjectaltname: 'DNS:abcde.12345.us-central1.sql.goog',
  } as tls.PeerCertificate;
  t.match(
    validateCertificate(
      {
        projectId: 'my-project',
        regionId: 'region-id',
        instanceId: 'my-instance',
      },
      'GOOGLE_MANAGED_CAS_CA',
      'abcde.12345.us-central1.sql.goog'
    )('hostname', cert),
    undefined,
    'DNS name matches SAN in cert'
  );
});

t.test('validateCertificate cases', async t => {
  const tcs = [
    {
      desc: 'cn match',
      icn: 'myProject:myRegion:myInstance',
      cn: 'myProject:myInstance',
      valid: true,
    },
    {
      desc: 'cn no match',
      icn: 'myProject:myRegion:badInstance',
      cn: 'myProject:myInstance',
      valid: false,
    },
    {
      desc: 'cn empty',
      icn: 'myProject:myRegion:myInstance',
      san: 'db.example.com',
      valid: false,
    },
    {
      desc: 'san match',
      serverName: 'db.example.com',
      icn: 'myProject:myRegion:myInstance',
      san: 'db.example.com',
      valid: true,
    },
    {
      desc: 'san no match',
      serverName: 'bad.example.com',
      icn: 'myProject:myRegion:myInstance',
      san: 'db.example.com',
      valid: false,
    },
    {
      desc: 'san empty match',
      serverName: 'empty.example.com',
      icn: 'myProject:myRegion:myInstance',
      cn: '',
      valid: false,
    },
    {
      desc: 'san match with cn present',
      serverName: 'db.example.com',
      icn: 'myProject:myRegion:myInstance',
      san: 'db.example.com',
      cn: 'myProject:myInstance',
      valid: true,
    },
    {
      desc: 'san no match fallback to cn',
      serverName: 'db.example.com',
      icn: 'myProject:myRegion:myInstance',
      san: 'other.example.com',
      cn: 'myProject:myInstance',
      valid: true,
    },
    {
      desc: 'san empty match fallback to cn',
      serverName: 'db.example.com',
      icn: 'myProject:myRegion:myInstance',
      cn: 'myProject:myInstance',
      valid: true,
    },
    {
      desc: 'san no match fallback to cn and fail',
      serverName: 'db.example.com',
      icn: 'myProject:myRegion:badInstance',
      san: 'other.example.com',
      cn: 'myProject:myInstance',
      valid: false,
    },
  ];

  await Promise.all(
    tcs.map(tc =>
      t.test(tc.desc + ' cas', async t => {
        runCertificateNameTest(t, tc);
      })
    )
  );
});

function runCertificateNameTest(t, tc) {
  const cert = {
    subject: {CN: tc.cn},
    subjectaltname: tc.san ? 'DNS:' + tc.san : undefined,
  } as tls.PeerCertificate;

  const instanceInfo = parseInstanceConnectionName(tc.icn);
  instanceInfo.domainName = tc.san;

  const err = validateCertificate(
    instanceInfo,
    tc.san,
    tc.serverName
  )(tc.serverName, cert);

  if (tc.valid) {
    t.match(err, undefined, 'want no error');
  } else {
    if (!err) {
      t.fail('want error, got no error');
    }
  }
}
