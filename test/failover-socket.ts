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
import * as net from 'node:net';
import {FailoverSocket} from '../src/failover-socket';

t.test('FailoverSocket failover success', async t => {
  const port = 3005;

  const server = net.createServer(socket => {
    socket.write('hello');
    socket.end();
  });

  await new Promise<void>(resolve => {
    server.listen(port, '127.0.0.1', () => {
      resolve();
    });
  });

  t.teardown(() => {
    server.close();
  });

  // 127.0.0.2 should fail (refused), 127.0.0.1 should succeed
  const hosts = ['127.0.0.2', '127.0.0.1'];
  const failoverSocket = new FailoverSocket(hosts, port);
  failoverSocket.startConnect();

  await new Promise<void>((resolve, reject) => {
    failoverSocket.on('connect', () => {
      t.pass('connected successfully');
      failoverSocket.end();
      resolve();
    });

    failoverSocket.on('error', err => {
      reject(err);
    });
  });
});

t.test('FailoverSocket all hosts fail', async t => {
  const port = 3006;

  const hosts = ['127.0.0.2', '127.0.0.3'];
  const failoverSocket = new FailoverSocket(hosts, port);
  failoverSocket.startConnect();

  await new Promise<void>((resolve, reject) => {
    failoverSocket.on('connect', () => {
      t.fail('should not connect');
      failoverSocket.end();
      reject(new Error('should not connect'));
    });

    failoverSocket.on('error', err => {
      t.match(
        err.message,
        'Failed to connect to any target',
        'should report failure'
      );
      resolve();
    });
  });
});
