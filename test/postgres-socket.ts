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

import t from 'tap';
import {
  PostgresSocket,
  attachPostgresSocket,
  buildPostgresStartupPacket,
  buildTerminatePacket,
  parsePostgresStartupPacket,
} from '../src/postgres-socket';

t.test('PostgresSocket unit tests', async t => {
  t.test('parsePostgresStartupPacket helper', async t => {
    t.same(
      parsePostgresStartupPacket(Buffer.from([0, 0])),
      {user: '', database: '', complete: false},
      'returns incomplete on < 8 bytes'
    );
    const pkt = buildPostgresStartupPacket('user1', 'db1');
    t.same(
      parsePostgresStartupPacket(pkt),
      {user: 'user1', database: 'db1', complete: true},
      'returns parsed pair on complete packet'
    );
  });
  t.test(
    'parses full PostgreSQL v3 StartupMessage in a single write',
    async t => {
      let capturedUser = '';
      let capturedDb = '';
      const written: Buffer[] = [];

      const fakeSocket = {
        write: (chunk: Buffer) => {
          written.push(Buffer.from(chunk));
          return true;
        },
        destroy: () => {},
        once: () => {},
      };

      const ps = new PostgresSocket(fakeSocket, (user, db) => {
        capturedUser = user;
        capturedDb = db;
      });

      const packet = buildPostgresStartupPacket('alice@example.com', 'mydb');
      fakeSocket.write(packet);

      t.equal(capturedUser, 'alice@example.com');
      t.equal(capturedDb, 'mydb');
      t.ok(ps.startupMessageSent, 'startupMessageSent should be true');
      t.equal(written.length, 1);
      t.same(written[0], packet);
    }
  );

  t.test('handles chunked writes split into 1 byte then remainder', async t => {
    let calls = 0;
    let capturedUser = '';
    let capturedDb = '';
    const written: Buffer[] = [];

    const fakeSocket = {
      write: (chunk: Buffer) => {
        written.push(Buffer.from(chunk));
        return true;
      },
      destroy: () => {},
      once: () => {},
    };

    const ps = new PostgresSocket(fakeSocket, (user, db) => {
      calls++;
      capturedUser = user;
      capturedDb = db;
    });

    const packet = buildPostgresStartupPacket('bob@example.com', 'testdb');

    // First write: single 1-byte chunk
    fakeSocket.write(packet.subarray(0, 1));
    t.equal(calls, 0, 'should not emit onStartup after first byte');
    t.notOk(ps.startupMessageSent, 'startupMessageSent should still be false');

    // Second write: remainder
    fakeSocket.write(packet.subarray(1));
    t.equal(calls, 1, 'should emit onStartup after complete packet');
    t.equal(capturedUser, 'bob@example.com');
    t.equal(capturedDb, 'testdb');
    t.ok(ps.startupMessageSent, 'startupMessageSent should be true');
  });

  t.test('handles fine-grained byte-by-byte streaming', async t => {
    let calls = 0;
    let capturedUser = '';
    let capturedDb = '';

    const fakeSocket = {
      write: () => true,
      destroy: () => {},
      once: () => {},
    };

    const ps = new PostgresSocket(fakeSocket, (user, db) => {
      calls++;
      capturedUser = user;
      capturedDb = db;
    });

    const packet = buildPostgresStartupPacket(
      'streamer@example.com',
      'streamdb'
    );

    // Feed 1 byte at a time up to len - 1
    for (let i = 0; i < packet.length - 1; i++) {
      fakeSocket.write(packet.subarray(i, i + 1));
      t.equal(calls, 0, `should not emit onStartup before byte ${i + 1}`);
      t.notOk(ps.startupMessageSent);
    }

    // Final byte
    fakeSocket.write(packet.subarray(packet.length - 1));
    t.equal(calls, 1, 'should emit onStartup on final byte');
    t.equal(capturedUser, 'streamer@example.com');
    t.equal(capturedDb, 'streamdb');
    t.ok(ps.startupMessageSent);
  });

  t.test(
    'handles prepended SSLRequest split across chunks followed by StartupMessage',
    async t => {
      let calls = 0;
      let capturedUser = '';
      let capturedDb = '';

      const fakeSocket = {
        write: () => true,
        destroy: () => {},
        once: () => {},
      };

      attachPostgresSocket(fakeSocket, (user, db) => {
        calls++;
        capturedUser = user;
        capturedDb = db;
      });

      const sslReq = Buffer.from([0, 0, 0, 8, 0x04, 0xd2, 0x16, 0x2f]);
      // Split SSLRequest into two 4-byte chunks
      fakeSocket.write(sslReq.subarray(0, 4));
      t.equal(calls, 0);
      fakeSocket.write(sslReq.subarray(4));
      t.equal(calls, 0);

      // Now send StartupMessage
      const startup = buildPostgresStartupPacket(
        'ssl-user@example.com',
        'ssldb'
      );
      fakeSocket.write(startup);

      t.equal(calls, 1);
      t.equal(capturedUser, 'ssl-user@example.com');
      t.equal(capturedDb, 'ssldb');
    }
  );

  t.test('zero-overhead pass-through on subsequent writes', async t => {
    let calls = 0;
    const written: Buffer[] = [];

    const fakeSocket = {
      write: (chunk: Buffer) => {
        written.push(Buffer.from(chunk));
        return true;
      },
      destroy: () => {},
      once: () => {},
    };

    const ps = new PostgresSocket(fakeSocket, () => {
      calls++;
    });

    const startup = buildPostgresStartupPacket('fast@example.com', 'fastdb');
    fakeSocket.write(startup);
    t.equal(calls, 1);
    t.ok(ps.startupMessageSent);

    // Subsequent application query writes
    const query1 = Buffer.from('QSELECT 1;\x00');
    fakeSocket.write(query1);
    const query2 = Buffer.from('QSELECT 2;\x00');
    fakeSocket.write(query2);

    t.equal(calls, 1, 'onStartup must not be called again');
    t.equal(written.length, 3);
    t.same(written[1], query1);
    t.same(written[2], query2);
  });

  t.test('passes through non-PostgreSQL protocol data cleanly', async t => {
    let calls = 0;
    const written: Buffer[] = [];

    const fakeSocket = {
      write: (chunk: Buffer) => {
        written.push(Buffer.from(chunk));
        return true;
      },
      destroy: () => {},
      once: () => {},
    };

    const ps = new PostgresSocket(fakeSocket, () => {
      calls++;
    });

    // Simulate MySQL handshake or arbitrary non-Postgres protocol bytes
    const mysqlHandshake = Buffer.from([
      0x01, 0x00, 0x00, 0x01, 0x85, 0xa6, 0x03, 0x00,
    ]);
    fakeSocket.write(mysqlHandshake);

    t.equal(calls, 0, 'must not trigger onStartup for non-Postgres data');
    t.ok(ps.startupMessageSent, 'marks complete to cease inspection');
    t.equal(written.length, 1);
    t.same(written[0], mysqlHandshake);
  });

  t.test('buildTerminatePacket returns correct byte sequence', async t => {
    const term = buildTerminatePacket();
    t.same(term, Buffer.from([0x58, 0x00, 0x00, 0x00, 0x04]));
  });

  t.test(
    'preserves write overloads (2-arg callback, encoding + callback, boolean backpressure return)',
    async t => {
      const recordedCalls: Array<{
        argCount: number;
        chunk: Uint8Array | string;
        encodingOrCb?: unknown;
        cb?: unknown;
      }> = [];
      let nextReturn = false;

      const fakeSocket = {
        write(
          chunk: Uint8Array | string,
          encodingOrCb?: unknown,
          cb?: unknown
        ) {
          recordedCalls.push({
            argCount: arguments.length,
            chunk,
            encodingOrCb,
            cb,
          });
          if (typeof encodingOrCb === 'function') {
            (encodingOrCb as () => void)();
          } else if (typeof cb === 'function') {
            (cb as () => void)();
          }
          return nextReturn;
        },
      };

      let capturedUser = '';
      let capturedDb = '';
      const ps = new PostgresSocket(fakeSocket, (user, db) => {
        capturedUser = user;
        capturedDb = db;
      });

      const startup = buildPostgresStartupPacket('cbuser@example.com', 'cbdb');
      const hexStartup = startup.toString('hex');

      // 3-arg string + encoding + callback
      let cb1Called = false;
      nextReturn = false;
      const ret1 = fakeSocket.write(
        hexStartup.slice(0, 10),
        'hex' as BufferEncoding,
        () => {
          cb1Called = true;
        }
      );
      t.equal(ret1, false, 'should preserve false backpressure return value');
      t.ok(cb1Called, '3-arg write callback should be invoked');
      t.equal(recordedCalls[0].argCount, 3);
      t.equal(recordedCalls[0].encodingOrCb, 'hex');

      // 2-arg chunk + callback (completes packet)
      let cb2Called = false;
      nextReturn = true;
      const ret2 = fakeSocket.write(
        Buffer.from(hexStartup.slice(10), 'hex'),
        () => {
          cb2Called = true;
        }
      );
      t.equal(ret2, true);
      t.ok(cb2Called, '2-arg write callback should be invoked');
      t.equal(recordedCalls[1].argCount, 2);
      t.equal(typeof recordedCalls[1].encodingOrCb, 'function');
      t.equal(capturedUser, 'cbuser@example.com');
      t.equal(capturedDb, 'cbdb');
      t.ok(ps.startupMessageSent);

      // Post-unbind 1-arg write
      const ret3 = fakeSocket.write('QSELECT 1;\x00');
      t.equal(ret3, true);
      t.equal(recordedCalls[2].argCount, 1);
    }
  );

  t.test('handles Uint8Array views with non-zero byteOffset', async t => {
    let capturedUser = '';
    let capturedDb = '';
    const fakeSocket = {
      write: () => true,
    };

    new PostgresSocket(fakeSocket, (user, db) => {
      capturedUser = user;
      capturedDb = db;
    });

    const packet = buildPostgresStartupPacket('viewuser', 'viewdb');
    const backing = Buffer.alloc(packet.length + 10, 0xff);
    packet.copy(backing, 5);
    const view = new Uint8Array(
      backing.buffer,
      backing.byteOffset + 5,
      packet.length
    );

    fakeSocket.write(view);
    t.equal(capturedUser, 'viewuser');
    t.equal(capturedDb, 'viewdb');
  });

  t.test(
    'unbind restores own-property write and prototype-inherited write cleanly',
    async t => {
      // 1. Own-property write restoration
      const origOwnWrite = () => true;
      const ownSocket = {write: origOwnWrite};
      new PostgresSocket(ownSocket, () => {});
      t.not(ownSocket.write, origOwnWrite, 'wrapped before startup');
      (ownSocket.write as (chunk: Uint8Array | string) => boolean)(
        buildPostgresStartupPacket('u', 'd')
      );
      t.equal(
        ownSocket.write,
        origOwnWrite,
        'exact original own write restored after unbind'
      );

      // 2. Prototype-inherited write restoration (matches TLSSocket/net.Socket)
      class ProtoSocket {
        write(chunk: Uint8Array | string): boolean {
          return chunk.length >= 0;
        }
      }
      const protoSock = new ProtoSocket();
      t.notOk(
        Object.prototype.hasOwnProperty.call(protoSock, 'write'),
        'write initially on prototype'
      );
      new PostgresSocket(protoSock, () => {});
      t.ok(
        Object.prototype.hasOwnProperty.call(protoSock, 'write'),
        'wrapped as own property during inspection'
      );
      protoSock.write(buildPostgresStartupPacket('u2', 'd2'));
      t.notOk(
        Object.prototype.hasOwnProperty.call(protoSock, 'write'),
        'own property deleted on unbind'
      );
      t.equal(
        protoSock.write,
        ProtoSocket.prototype.write,
        'prototype method restored on unbind'
      );
    }
  );

  t.test(
    'handles GSSENCRequest + SSLRequest + StartupMessage with default database',
    async t => {
      let capturedUser = '';
      let capturedDb = '';
      const fakeSocket = {write: () => true};

      const ps = new PostgresSocket(fakeSocket, (user, db) => {
        capturedUser = user;
        capturedDb = db;
      });

      const gssReq = Buffer.from([0, 0, 0, 8, 0x04, 0xd2, 0x16, 0x30]);
      const sslReq = Buffer.from([0, 0, 0, 8, 0x04, 0xd2, 0x16, 0x2f]);
      // StartupMessage with user only (no database key)
      const body = Buffer.from('user\0pguser\0\0', 'utf8');
      const header = Buffer.alloc(8);
      header.writeUInt32BE(8 + body.length, 0);
      header.writeUInt32BE(196608, 4);
      const startupUserOnly = Buffer.concat([header, body]);

      (fakeSocket.write as (c: Uint8Array) => boolean)(gssReq);
      t.notOk(ps.startupMessageSent);
      (fakeSocket.write as (c: Uint8Array) => boolean)(sslReq);
      t.notOk(ps.startupMessageSent);
      (fakeSocket.write as (c: Uint8Array) => boolean)(startupUserOnly);

      t.ok(ps.startupMessageSent);
      t.equal(capturedUser, 'pguser');
      t.equal(capturedDb, 'pguser', 'database defaults to user when omitted');
    }
  );

  t.test(
    'unbinds on oversized StartupMessage, CancelRequest, and bounded SSLRequest flood',
    async t => {
      // Oversized StartupMessage (pktLen > MAX_PG_STARTUP_PACKET_LEN)
      let calls = 0;
      const sock1 = {write: () => true};
      const ps1 = new PostgresSocket(sock1, () => calls++);
      const oversizedHeader = Buffer.alloc(8);
      oversizedHeader.writeUInt32BE(10001, 0);
      oversizedHeader.writeUInt32BE(196608, 4);
      (sock1.write as (c: Uint8Array) => boolean)(oversizedHeader);
      t.ok(ps1.startupMessageSent, 'unbinds immediately on oversized packet');
      t.equal(calls, 0);

      // CancelRequest (len 16, code 80877102)
      const sock2 = {write: () => true};
      const ps2 = new PostgresSocket(sock2, () => calls++);
      const cancelPkt = Buffer.alloc(16);
      cancelPkt.writeUInt32BE(16, 0);
      cancelPkt.writeUInt32BE(80877102, 4);
      (sock2.write as (c: Uint8Array) => boolean)(cancelPkt);
      t.ok(ps2.startupMessageSent, 'unbinds on CancelRequest');
      t.equal(calls, 0);

      // Bounded buffer guard on repeated SSLRequest packets exceeding 10016 bytes
      const sock3 = {write: () => true};
      const ps3 = new PostgresSocket(sock3, () => calls++);
      const sslReq = Buffer.from([0, 0, 0, 8, 0x04, 0xd2, 0x16, 0x2f]);
      const flood = Buffer.concat(Array(1260).fill(sslReq)); // 10080 bytes > 10016
      (sock3.write as (c: Uint8Array) => boolean)(flood);
      t.ok(
        ps3.startupMessageSent,
        'bounded guard unbinds on excessive pre-startup bytes'
      );
      t.equal(calls, 0);
    }
  );
});
