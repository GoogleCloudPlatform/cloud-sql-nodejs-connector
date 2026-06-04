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

const protoPath = resolve(__dirname, '../src/proto/sql_data_service.proto');
const packageDefinition = protoLoader.loadSync(protoPath, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
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
          server.start();
          res({server, port});
        }
      }
    );
  });
}

t.test('SqlDataClient.verifySupport', async t => {
  t.test('should resolve true when server sends SessionMetadata', async t => {
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
      call.on('end', () => call.end());
    });

    t.teardown(() => {
      server.forceShutdown();
    });

    const supported = await SqlDataClient.verifySupport({
      instanceConnectionName: 'proj:reg:inst',
      auth: mockAuth,
      endpoint: `127.0.0.1:${port}`,
      channelCredentials: grpc.credentials.createInsecure(),
    });

    t.ok(supported, 'should support SQL_DATA');
  });

  t.test(
    'should resolve false when server returns FAILED_PRECONDITION (9)',
    async t => {
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

      const supported = await SqlDataClient.verifySupport({
        instanceConnectionName: 'proj:reg:inst',
        auth: mockAuth,
        endpoint: `127.0.0.1:${port}`,
        channelCredentials: grpc.credentials.createInsecure(),
      });

      t.notOk(supported, 'should not support SQL_DATA');
    }
  );

  t.test('should throw on unexpected gRPC error', async t => {
    const {server, port} = await startFakeServer(call => {
      call.on('data', request => {
        if (request.start_session) {
          const err = {
            code: grpc.status.UNAVAILABLE,
            details: 'Service is down',
          };
          call.emit('error', err);
        }
      });
    });

    t.teardown(() => {
      server.forceShutdown();
    });

    await t.rejects(
      SqlDataClient.verifySupport({
        instanceConnectionName: 'proj:reg:inst',
        auth: mockAuth,
        endpoint: `127.0.0.1:${port}`,
        channelCredentials: grpc.credentials.createInsecure(),
      }),
      /UNAVAILABLE: Service is down/,
      'should propagate unexpected gRPC error'
    );
  });
});

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
});
