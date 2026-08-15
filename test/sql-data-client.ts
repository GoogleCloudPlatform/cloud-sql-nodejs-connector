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
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as net from 'node:net';
import {resolve} from 'node:path';
import {SqlDataClient} from '../src/sql-data-client';
import {AuthClient} from 'google-auth-library';

const protoPath = resolve(
  __dirname,
  '../node_modules/@google-cloud/sql/build/protos/google/cloud/sql/v1beta4/cloud_sql_data.proto'
);
const packageDefinition = protoLoader.loadSync(protoPath, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [
    resolve(__dirname, '../node_modules/@google-cloud/sql/build/protos'),
    resolve(__dirname, '../node_modules/google-gax/build/protos'),
  ],
});
const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
const googleProto = protoDescriptor.google as grpc.GrpcObject;
const cloudProto = googleProto.cloud as grpc.GrpcObject;
const sqlProto = cloudProto.sql as grpc.GrpcObject;
const v1beta4 = sqlProto.v1beta4 as grpc.GrpcObject;
interface StreamSqlDataRequest {
  start_session?: {
    location_id: string;
    instance_id: string;
    session_id?: string;
  };
  data?: {
    first_byte_offset: number;
    data: Buffer;
  };
}

// Prevent grpc-js from routing localhost test connections through corporate proxies
process.env.NO_PROXY = '127.0.0.1,localhost,::1';
process.env.no_proxy = '127.0.0.1,localhost,::1';

const SqlDataServiceClientClass =
  v1beta4.SqlDataService as grpc.ServiceClientConstructor;

const mockAuth = {
  getRequestHeaders: async () => ({
    authorization: 'Bearer fake-token',
  }),
  getUniverseDomain: async () => 'googleapis.com',
} as unknown as AuthClient;

// Helper to start fake gRPC server
function startFakeServer(
  handler: (
    call: grpc.ServerDuplexStream<StreamSqlDataRequest, unknown>
  ) => void
): Promise<{server: grpc.Server; port: number}> {
  const server = new grpc.Server();
  server.addService(SqlDataServiceClientClass.service, {
    StreamSqlData: handler,
  });
  return new Promise((res, rej) => {
    server.bindAsync(
      '127.0.0.1:0',
      grpc.ServerCredentials.createInsecure(),
      (err, port) => {
        if (err) {
          rej(err);
        } else {
          res({server, port});
        }
      }
    );
  });
}

t.test('SqlDataClient socket tunnel', async t => {
  t.test('should transfer data bidirectionally', async t => {
    let serverReceivedStartSession = false;
    let serverReceivedClientData = false;
    let serverReceivedEnd = false;
    let clientReceivedServerData = false;

    let resolveServerEnded: () => void;
    const serverEnded = new Promise<void>(res => {
      resolveServerEnded = res;
    });

    const testClientData = Buffer.from('client hello');
    const testServerData = Buffer.from('server hello');

    const {server, port} = await startFakeServer(call => {
      call.on('data', request => {
        if (request.start_session) {
          serverReceivedStartSession = true;
          // Send SessionMetadata as handshake response
          call.write({
            session_metadata: {
              supported_features: ['SQL_DATA_FEATURE_UNSPECIFIED'],
            },
          });
        } else if (request.data) {
          const dataBuf = request.data.data;
          if (dataBuf.equals(testClientData)) {
            serverReceivedClientData = true;
            // Respond back with server data
            call.write({
              data: {
                first_byte_offset: 0,
                data: testServerData,
              },
            });
          }
        }
      });
      call.on('end', () => {
        serverReceivedEnd = true;
        call.end();
        resolveServerEnded();
      });
    });

    t.teardown(() => {
      server.forceShutdown();
    });

    const client = new SqlDataClient({
      instanceConnectionName: 'proj:reg:inst',
      auth: mockAuth,
      endpoint: `127.0.0.1:${port}`,
      channelCredentials: grpc.credentials.createInsecure(),
    });

    const localPort = await client.start();
    t.ok(localPort > 0, 'should start local server and return a port');

    // Create a local socket connection
    const socket = net.connect({port: localPort, host: '127.0.0.1'});

    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => {
        socket.write(testClientData);
      });

      socket.on('data', data => {
        if (data.equals(testServerData)) {
          clientReceivedServerData = true;
          socket.end(); // close socket
        }
      });

      socket.on('end', () => {
        resolve();
      });

      socket.on('error', err => {
        reject(err);
      });
    });

    await client.close();
    await serverEnded; // Wait for the gRPC stream on server to finish

    // Verify all assertions
    t.ok(
      serverReceivedStartSession,
      'server should have received start_session'
    );
    t.ok(serverReceivedClientData, 'server should have received client data');
    t.ok(clientReceivedServerData, 'client should have received server data');
    t.ok(serverReceivedEnd, 'server should have received end stream signal');
  });

  t.test(
    'should fallback to async direct socket when server returns FAILED_PRECONDITION (9)',
    async t => {
      let unsupportedCalled = false;
      const testClientData = Buffer.from('client hello');
      const testDirectResponse = Buffer.from('direct response');

      // Start a mock direct backend server
      const directServer = net.createServer(directConn => {
        directConn.on('data', data => {
          if (data.equals(testClientData)) {
            directConn.write(testDirectResponse);
          }
        });
      });
      const directPort = await new Promise<number>(res => {
        directServer.listen(0, '127.0.0.1', () => {
          res((directServer.address() as net.AddressInfo).port);
        });
      });

      t.teardown(() => {
        directServer.close();
      });

      // Start a mock gRPC server returning FAILED_PRECONDITION
      const {server, port} = await startFakeServer(call => {
        call.on('data', request => {
          if (request.start_session) {
            const err = {
              code: grpc.status.FAILED_PRECONDITION,
              details: 'SQL_DATA is not supported for this instance',
            };
            call.emit('error', err);
          }
        });
      });

      t.teardown(() => {
        server.forceShutdown();
      });

      const client = new SqlDataClient({
        instanceConnectionName: 'proj:reg:inst',
        auth: mockAuth,
        endpoint: `127.0.0.1:${port}`,
        channelCredentials: grpc.credentials.createInsecure(),
        getDirectSocket: async () =>
          net.connect({port: directPort, host: '127.0.0.1'}),
        onUnsupported: () => {
          unsupportedCalled = true;
        },
      });

      const localPort = await client.start();
      const socket = net.connect({port: localPort, host: '127.0.0.1'});

      let receivedData = Buffer.alloc(0);
      await new Promise<void>((resolve, reject) => {
        socket.on('connect', () => {
          socket.write(testClientData);
        });
        socket.on('data', chunk => {
          receivedData = Buffer.concat([receivedData, chunk]);
          if (receivedData.equals(testDirectResponse)) {
            socket.end();
          }
        });
        socket.on('end', () => {
          resolve();
        });
        socket.on('error', err => {
          reject(err);
        });
      });

      await client.close();

      t.ok(unsupportedCalled, 'onUnsupported callback should have been called');
      t.same(
        receivedData,
        testDirectResponse,
        'client should receive direct response via fallback'
      );
    }
  );

  t.test(
    'should destroy client socket on non-FAILED_PRECONDITION error',
    async t => {
      const {server, port} = await startFakeServer(call => {
        call.on('data', request => {
          if (request.start_session) {
            const err = {
              code: grpc.status.UNAVAILABLE,
              details: 'Service unavailable',
            };
            call.emit('error', err);
          }
        });
      });

      t.teardown(() => {
        server.forceShutdown();
      });

      const client = new SqlDataClient({
        instanceConnectionName: 'proj:reg:inst',
        auth: mockAuth,
        endpoint: `127.0.0.1:${port}`,
        channelCredentials: grpc.credentials.createInsecure(),
      });

      const localPort = await client.start();
      const socket = net.connect({port: localPort, host: '127.0.0.1'});

      let socketClosed = false;
      await new Promise<void>(resolve => {
        socket.on('connect', () => {
          socket.write(Buffer.from('hello'));
        });
        socket.on('error', () => {
          socketClosed = true;
          resolve();
        });
        socket.on('close', () => {
          socketClosed = true;
          resolve();
        });
      });

      await client.close();

      t.ok(socketClosed, 'client socket should be closed on server error');
    }
  );

  t.test('should handle server terminateSession response', async t => {
    const {server, port} = await startFakeServer(call => {
      call.on('data', request => {
        if (request.start_session) {
          call.write({
            session_metadata: {
              supported_features: ['SQL_DATA_FEATURE_UNSPECIFIED'],
            },
          });
          call.write({
            terminate_session: {
              status: {
                code: 10, // ABORTED
                message: 'Session aborted by server',
              },
            },
          });
        }
      });
    });

    t.teardown(() => {
      server.forceShutdown();
    });

    const client = new SqlDataClient({
      instanceConnectionName: 'proj:reg:inst',
      auth: mockAuth,
      endpoint: `https://127.0.0.1:${port}`,
      channelCredentials: grpc.credentials.createInsecure(),
    });

    const localPort = await client.start();
    const socket = net.connect({port: localPort, host: '127.0.0.1'});

    let socketClosed = false;
    await new Promise<void>(resolve => {
      socket.on('connect', () => {
        socket.write(Buffer.from('hello'));
      });
      socket.on('error', () => {
        socketClosed = true;
        resolve();
      });
      socket.on('close', () => {
        socketClosed = true;
        resolve();
      });
    });

    await client.close();

    t.ok(socketClosed, 'client socket should be closed on terminateSession');
  });

  t.test(
    'should destroy active sockets when client.close() is called',
    async t => {
      const {server, port} = await startFakeServer(call => {
        call.on('data', request => {
          if (request.start_session) {
            call.write({
              session_metadata: {
                supported_features: ['SQL_DATA_FEATURE_UNSPECIFIED'],
              },
            });
          }
        });
      });

      t.teardown(() => {
        server.forceShutdown();
      });

      const client = new SqlDataClient({
        instanceConnectionName: 'proj:reg:inst',
        auth: mockAuth,
        endpoint: `127.0.0.1:${port}`,
        channelCredentials: grpc.credentials.createInsecure(),
      });

      const localPort = await client.start();
      const socket = net.connect({port: localPort, host: '127.0.0.1'});

      let socketClosed = false;
      await new Promise<void>(resolve => {
        socket.on('connect', async () => {
          socket.on('error', () => {
            socketClosed = true;
            resolve();
          });
          socket.on('close', () => {
            socketClosed = true;
            resolve();
          });
          await client.close();
        });
      });

      t.ok(socketClosed, 'socket should be closed when client closes');
    }
  );

  t.test(
    'should call onResourceExhausted when server emits RESOURCE_EXHAUSTED error',
    async t => {
      const {server, port} = await startFakeServer(call => {
        call.on('data', request => {
          if (request.start_session) {
            call.emit('error', {
              code: grpc.status.RESOURCE_EXHAUSTED,
              details: 'Resource busy',
            });
          }
        });
      });

      t.teardown(() => {
        server.forceShutdown();
      });

      let resourceExhaustedCalled = false;
      let errorReceived: Error | undefined;

      const client = new SqlDataClient({
        instanceConnectionName: 'proj:reg:inst',
        auth: mockAuth,
        endpoint: `127.0.0.1:${port}`,
        channelCredentials: grpc.credentials.createInsecure(),
        onResourceExhausted: err => {
          resourceExhaustedCalled = true;
          errorReceived = err;
        },
      });

      const localPort = await client.start();
      t.teardown(async () => {
        await client.close();
      });

      const socket = net.connect({port: localPort, host: '127.0.0.1'});
      await new Promise<void>(resolve => {
        socket.on('connect', () => {
          socket.write(Buffer.from('hello'));
        });
        socket.on('error', () => {
          resolve();
        });
        socket.on('close', () => {
          resolve();
        });
      });

      t.ok(
        resourceExhaustedCalled,
        'onResourceExhausted should be called on RESOURCE_EXHAUSTED error'
      );
      t.ok(errorReceived, 'should receive the error');
    }
  );

  t.test(
    'should call onResourceExhausted when server sends terminateSession with RESOURCE_EXHAUSTED',
    async t => {
      const {server, port} = await startFakeServer(call => {
        call.on('data', request => {
          if (request.start_session) {
            call.write({
              terminate_session: {
                status: {
                  code: grpc.status.RESOURCE_EXHAUSTED,
                  message: 'Server resource exhausted',
                },
              },
            });
          }
        });
      });

      t.teardown(() => {
        server.forceShutdown();
      });

      let resourceExhaustedCalled = false;

      const client = new SqlDataClient({
        instanceConnectionName: 'proj:reg:inst',
        auth: mockAuth,
        endpoint: `127.0.0.1:${port}`,
        channelCredentials: grpc.credentials.createInsecure(),
        onResourceExhausted: () => {
          resourceExhaustedCalled = true;
        },
      });

      const localPort = await client.start();
      t.teardown(async () => {
        await client.close();
      });

      const socket = net.connect({port: localPort, host: '127.0.0.1'});
      await new Promise<void>(resolve => {
        socket.on('connect', () => {
          socket.write(Buffer.from('hello'));
        });
        socket.on('error', () => {
          resolve();
        });
        socket.on('close', () => {
          resolve();
        });
      });

      t.ok(
        resourceExhaustedCalled,
        'onResourceExhausted should be called on terminateSession with RESOURCE_EXHAUSTED'
      );
    }
  );

  t.test('should call onSuccess on first server data packet', async t => {
    const {server, port} = await startFakeServer(call => {
      call.on('data', request => {
        if (request.start_session) {
          call.write({
            data: {
              data: Buffer.from('hello from server'),
            },
          });
        }
      });
    });

    t.teardown(() => {
      server.forceShutdown();
    });

    let successCalled = false;

    const client = new SqlDataClient({
      instanceConnectionName: 'proj:reg:inst',
      auth: mockAuth,
      endpoint: `127.0.0.1:${port}`,
      channelCredentials: grpc.credentials.createInsecure(),
      onSuccess: () => {
        successCalled = true;
      },
    });

    const localPort = await client.start();
    t.teardown(async () => {
      await client.close();
    });

    const socket = net.connect({port: localPort, host: '127.0.0.1'});
    await new Promise<void>(resolve => {
      socket.on('data', () => {
        socket.end();
        resolve();
      });
    });

    t.ok(successCalled, 'onSuccess should be called when data packet arrives');
  });
});
