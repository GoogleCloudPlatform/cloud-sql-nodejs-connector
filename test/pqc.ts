// Copyright 2026 Google LLC
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

import net from 'node:net';
import tls from 'node:tls';
import t from 'tap';
import {getSocket} from '../src/socket';
import {
  CA_CERT,
  CLIENT_CERT,
  CLIENT_KEY,
  SERVER_CERT,
  SERVER_KEY,
} from './fixtures/certs';
import {setupCredentials} from './fixtures/setup-credentials';

function hasOpenSSL35Plus(): boolean {
  const raw = process.versions.openssl || '';
  const match = raw.match(/^(\d+)\.(\d+)/);
  if (!match) {
    return false;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 3 || (major === 3 && minor >= 5);
}

function nodeBundlesOpenSSL35Plus(): boolean {
  const [major, minor] = process.versions.node.split('.').map(v => Number(v));
  return (
    major >= 25 || (major === 24 && minor >= 5) || (major === 22 && minor >= 20)
  );
}

interface HandshakeResult {
  authorized: boolean;
  protocol: string | null;
  ephemeralKeyInfo: ReturnType<tls.TLSSocket['getEphemeralKeyInfo']>;
  echoed: string;
}

async function startMockTLS13Server(
  ecdhCurve?: string
): Promise<{server: tls.Server; port: number}> {
  const server = tls.createServer(
    {
      ca: CA_CERT,
      key: SERVER_KEY,
      cert: SERVER_CERT,
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.3',
      ...(ecdhCurve ? {ecdhCurve} : {}),
    },
    socket => {
      socket.on('data', chunk => {
        socket.write(chunk);
      });
    }
  );

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const {port} = server.address() as net.AddressInfo;
  return {server, port};
}

function connectAndEcho(socket: tls.TLSSocket): Promise<HandshakeResult> {
  return new Promise((resolve, reject) => {
    socket.setTimeout(10_000, () => {
      socket.destroy(new Error('TLS test socket timed out'));
    });
    socket.once('error', reject);
    socket.once('secureConnect', () => {
      const authorized = socket.authorized;
      const protocol = socket.getProtocol();
      const ephemeralKeyInfo = socket.getEphemeralKeyInfo();
      socket.once('data', data => {
        socket.setTimeout(0);
        socket.end();
        resolve({
          authorized,
          protocol,
          ephemeralKeyInfo,
          echoed: data.toString('utf8'),
        });
      });
      socket.write('pqc-ping');
    });
  });
}

function createTestSocket(port: number): tls.TLSSocket {
  return getSocket({
    instanceInfo: {
      projectId: 'my-project',
      regionId: 'region-id',
      instanceId: 'my-instance',
    },
    ephemeralCert: {
      cert: CLIENT_CERT,
      expirationTime: '3022-07-22T17:53:09Z',
    },
    host: '127.0.0.1',
    port,
    privateKey: CLIENT_KEY,
    serverCaCert: {
      cert: CA_CERT,
      expirationTime: '3022-07-22T17:53:09Z',
    },
    instanceDnsName: '',
    serverName: '',
  });
}

const pqcSupported = hasOpenSSL35Plus();

t.test('PQC TLS 1.3 key exchange and classical fallback', async t => {
  if (process.env.GITHUB_ACTIONS === 'true' && nodeBundlesOpenSSL35Plus()) {
    t.ok(
      pqcSupported,
      `Expected OpenSSL >= 3.5 on Node ${process.version}, got ${process.versions.openssl}`
    );
  }

  await t.test(
    'negotiates X25519MLKEM768 by default on OpenSSL 3.5+',
    {
      skip: !pqcSupported
        ? `Requires OpenSSL >= 3.5 (found ${process.versions.openssl})`
        : false,
    },
    async t => {
      // 1. Default TLS 1.3 server (offers both hybrid and classical groups)
      const defaultSrv = await startMockTLS13Server();
      t.teardown(() => defaultSrv.server.close());

      const defaultRes = await connectAndEcho(
        createTestSocket(defaultSrv.port)
      );
      t.ok(defaultRes.authorized, 'mTLS socket should be authorized');
      t.equal(defaultRes.protocol, 'TLSv1.3', 'should negotiate TLSv1.3');
      t.equal(
        defaultRes.echoed,
        'pqc-ping',
        'should exchange application data'
      );

      const keyInfo = (defaultRes.ephemeralKeyInfo || {}) as {
        type?: string;
        name?: string;
      };
      if (keyInfo.name !== undefined) {
        // Node 24+ populates TLSGroup name via SSL_get0_group_name
        t.equal(
          keyInfo.name,
          'X25519MLKEM768',
          'should report X25519MLKEM768 ephemeral group on Node 24+'
        );
      } else {
        // Node 22 returns {} for hybrid KEM groups (whereas classical ECDH returns {type: 'ECDH', name: 'X25519'})
        t.same(
          keyInfo,
          {},
          'should not negotiate classical ECDH against a PQC-capable server'
        );
      }

      // 2. Strict X25519MLKEM768-only TLS 1.3 server proves X25519MLKEM768 was negotiated on all Node versions
      const pqcOnlySrv = await startMockTLS13Server('X25519MLKEM768');
      t.teardown(() => pqcOnlySrv.server.close());

      const pqcOnlyRes = await connectAndEcho(
        createTestSocket(pqcOnlySrv.port)
      );
      t.ok(
        pqcOnlyRes.authorized,
        'mTLS socket should complete handshake with X25519MLKEM768-only server'
      );
      t.equal(pqcOnlyRes.protocol, 'TLSv1.3', 'should negotiate TLSv1.3');
      t.equal(
        pqcOnlyRes.echoed,
        'pqc-ping',
        'should exchange application data'
      );
    }
  );

  await t.test(
    'Connector.getOptions stream negotiates X25519MLKEM768 on OpenSSL 3.5+',
    {
      skip: !pqcSupported
        ? `Requires OpenSSL >= 3.5 (found ${process.versions.openssl})`
        : false,
    },
    async t => {
      setupCredentials(t);
      const pqcOnlySrv = await startMockTLS13Server('X25519MLKEM768');
      t.teardown(() => pqcOnlySrv.server.close());

      const {Connector} = t.mockRequire('../src/connector', {
        '../src/socket': {
          getSocket: (opts: Parameters<typeof getSocket>[0]) =>
            getSocket({...opts, port: pqcOnlySrv.port}),
        },
        '../src/sqladmin-fetcher': {
          SQLAdminFetcher: class {
            getInstanceMetadata() {
              return Promise.resolve({
                ipAddresses: {public: '127.0.0.1'},
                serverCaCert: {
                  cert: CA_CERT,
                  expirationTime: '3022-07-22T17:53:09Z',
                },
                serverCaMode: 'GOOGLE_MANAGED_INTERNAL_CA',
                dnsName: '',
              });
            }
            getEphemeralCertificate() {
              return Promise.resolve({
                cert: CLIENT_CERT,
                expirationTime: '3022-07-22T17:53:09Z',
              });
            }
          },
        },
        '../src/cloud-sql-instance': t.mockRequire(
          '../src/cloud-sql-instance',
          {
            '../src/crypto': {
              generateKeys: async () => ({
                publicKey: '-----BEGIN PUBLIC KEY-----',
                privateKey: CLIENT_KEY,
              }),
            },
          }
        ),
      });

      const connector = new Connector();
      t.teardown(() => connector.close());

      const driverOpts = await connector.getOptions({
        ipType: 'PUBLIC',
        instanceConnectionName: 'my-project:region-id:my-instance',
      });
      const tlsSocket = driverOpts.stream() as tls.TLSSocket;
      const res = await connectAndEcho(tlsSocket);
      t.ok(
        res.authorized,
        'Connector stream should authorize over PQC TLS 1.3'
      );
      t.equal(res.protocol, 'TLSv1.3', 'should negotiate TLSv1.3');
      t.equal(
        res.echoed,
        'pqc-ping',
        'should echo payload over Connector stream'
      );
    }
  );

  await t.test(
    'falls back cleanly to classical X25519 when server only supports X25519',
    async t => {
      const x25519Srv = await startMockTLS13Server('X25519');
      t.teardown(() => x25519Srv.server.close());

      const res = await connectAndEcho(createTestSocket(x25519Srv.port));
      t.ok(
        res.authorized,
        'mTLS socket should be authorized on X25519 fallback'
      );
      t.equal(res.protocol, 'TLSv1.3', 'should negotiate TLSv1.3');
      t.match(
        res.ephemeralKeyInfo,
        {type: 'ECDH', name: 'X25519'},
        'should negotiate classical X25519'
      );
      t.equal(res.echoed, 'pqc-ping', 'should exchange application data');
    }
  );

  await t.test(
    'falls back cleanly to classical P-256 (prime256v1) when server only supports P-256',
    async t => {
      const p256Srv = await startMockTLS13Server('prime256v1');
      t.teardown(() => p256Srv.server.close());

      const res = await connectAndEcho(createTestSocket(p256Srv.port));
      t.ok(
        res.authorized,
        'mTLS socket should be authorized on P-256 fallback'
      );
      t.equal(res.protocol, 'TLSv1.3', 'should negotiate TLSv1.3');
      t.match(
        res.ephemeralKeyInfo,
        {type: 'ECDH', name: 'prime256v1', size: 256},
        'should negotiate classical prime256v1 (P-256)'
      );
      t.equal(res.echoed, 'pqc-ping', 'should exchange application data');
    }
  );

  await t.test(
    'supports client-side opt-out via tls.DEFAULT_ECDH_CURVE',
    async t => {
      const prevDefaultCurve = tls.DEFAULT_ECDH_CURVE;
      tls.DEFAULT_ECDH_CURVE = 'X25519:prime256v1:secp384r1';
      t.teardown(() => {
        tls.DEFAULT_ECDH_CURVE = prevDefaultCurve;
      });

      const defaultSrv = await startMockTLS13Server();
      t.teardown(() => defaultSrv.server.close());

      const res = await connectAndEcho(createTestSocket(defaultSrv.port));
      t.ok(res.authorized, 'mTLS socket should connect with classical opt-out');
      t.equal(res.protocol, 'TLSv1.3', 'should negotiate TLSv1.3');
      t.match(
        res.ephemeralKeyInfo,
        {type: 'ECDH', name: 'X25519'},
        'should negotiate classical X25519 even when server supports PQC'
      );
      t.equal(res.echoed, 'pqc-ping', 'should exchange application data');

      if (pqcSupported) {
        const pqcOnlySrv = await startMockTLS13Server('X25519MLKEM768');
        let serverTlsError: Error | undefined;
        let resolveServerTlsError!: (err: Error) => void;
        const serverTlsErrorPromise = new Promise<Error>((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(
              new Error('Timed out waiting for server tlsClientError event')
            );
          }, 10_000);
          timer.unref();
          resolveServerTlsError = err => {
            clearTimeout(timer);
            resolve(err);
          };
        });
        pqcOnlySrv.server.on('tlsClientError', err => {
          serverTlsError = err;
          resolveServerTlsError(err);
        });
        t.teardown(() => pqcOnlySrv.server.close());

        await t.rejects(
          connectAndEcho(createTestSocket(pqcOnlySrv.port)),
          /handshake failure|alert number 40|ERR_SSL_|ECONNRESET/i,
          'opted-out client should not advertise X25519MLKEM768'
        );
        const observedServerErr =
          serverTlsError ?? (await serverTlsErrorPromise);
        t.ok(
          observedServerErr instanceof Error,
          'server should emit tlsClientError on rejected handshake'
        );
      }
    }
  );
});
