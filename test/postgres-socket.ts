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
});
