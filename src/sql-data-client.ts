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

import * as net from 'node:net';
import {resolve} from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import {AuthClient, GoogleAuth} from 'google-auth-library';
import {CloudSQLConnectorError} from './errors';

function normalizeHeaders(
  headers:
    | Record<string, string | string[]>
    | {entries(): IterableIterator<[string, string]>}
    | undefined
    | null
): Record<string, string> {
  if (
    headers &&
    'entries' in headers &&
    typeof headers.entries === 'function'
  ) {
    return Object.fromEntries(headers.entries());
  }
  return (headers as unknown as Record<string, string>) || {};
}

// Load proto
const protoPath = resolve(__dirname, './proto/sql_data_service.proto');
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

interface SqlDataServiceClient extends grpc.Client {
  StreamSqlData(
    metadata?: grpc.Metadata,
    options?: grpc.CallOptions
  ): grpc.ClientDuplexStream<unknown, unknown>;
}

type SqlDataServiceClientConstructor = new (
  address: string,
  credentials: grpc.ChannelCredentials
) => SqlDataServiceClient;

const SqlDataServiceClientClass =
  v1beta4.SqlDataService as unknown as SqlDataServiceClientConstructor;

export interface SqlDataClientOptions {
  instanceConnectionName: string;
  auth: GoogleAuth<AuthClient>;
  endpoint?: string;
  streamTimeout?: number;
  channelCredentials?: grpc.ChannelCredentials;
}

export class SqlDataClient {
  private readonly instanceConnectionName: string;
  private readonly auth: GoogleAuth<AuthClient>;
  private readonly endpoint: string;
  private readonly streamTimeout: number;
  private readonly projectId: string;
  private readonly regionId: string;
  private readonly instanceId: string;
  private readonly channelCredentials?: grpc.ChannelCredentials;
  private server?: net.Server;
  private client?: SqlDataServiceClient;
  private port?: number;

  constructor(opts: SqlDataClientOptions) {
    this.instanceConnectionName = opts.instanceConnectionName;
    this.auth = opts.auth;
    this.endpoint = opts.endpoint || 'sqladmin.googleapis.com';
    this.streamTimeout = opts.streamTimeout || 2 * 60 * 60 * 1000; // 2 hours
    this.channelCredentials = opts.channelCredentials;

    const parts = this.instanceConnectionName.split(':');
    if (parts.length !== 3) {
      throw new CloudSQLConnectorError({
        message: `Invalid instance connection name: ${this.instanceConnectionName}`,
        code: 'EBADINSTANCECONNECTIONNAME',
      });
    }
    this.projectId = parts[0];
    this.regionId = parts[1];
    this.instanceId = parts[2];
  }

  static async verifySupport(opts: SqlDataClientOptions): Promise<boolean> {
    const authHeaders = await opts.auth.getRequestHeaders();
    console.log('DEBUG verifySupport authHeaders:', authHeaders);
    return new Promise((resolvePromise, rejectPromise) => {
      let client: grpc.Client | undefined;
      let stream: grpc.ClientDuplexStream<unknown, unknown> | undefined;

      const timeoutId = setTimeout(() => {
        cleanup();
        rejectPromise(new Error('Timeout waiting for SQL Data Service probe'));
      }, 5000);

      const cleanup = () => {
        clearTimeout(timeoutId);
        if (stream) {
          try {
            stream.end();
          } catch (e) {
            // ignore error
          }
        }
        if (client) {
          try {
            client.close();
          } catch (e) {
            // ignore error
          }
        }
      };

      try {
        let target = opts.endpoint || 'sqladmin.googleapis.com';
        if (!target.includes(':')) {
          target += ':443';
        }

        const clientInstance = new SqlDataServiceClientClass(
          target,
          opts.channelCredentials || grpc.credentials.createSsl()
        );
        client = clientInstance;

        const parts = opts.instanceConnectionName.split(':');
        const projectId = parts[0];
        const regionId = parts[1];
        const instanceId = parts[2];
        const instanceResource = `projects/${projectId}/instances/${instanceId}`;
        const locationResource = `locations/${regionId}`;

        const metadata = new grpc.Metadata();
        const headers = normalizeHeaders(authHeaders);
        for (const [key, value] of Object.entries(headers)) {
          metadata.add(key, value);
        }
        metadata.add(
          'x-goog-request-params',
          `instance_id=${instanceResource}&location_id=${locationResource}`
        );

        const s = clientInstance.StreamSqlData(metadata);
        stream = s;

        s.on('data', () => {
          cleanup();
          resolvePromise(true);
        });

        s.on('error', (err: grpc.ServiceError) => {
          cleanup();
          if (err.code === 9) {
            // FAILED_PRECONDITION
            resolvePromise(false);
          } else {
            rejectPromise(err);
          }
        });

        const startSessionMsg = {
          start_session: {
            location_id: locationResource,
            instance_id: instanceResource,
          },
        };
        s.write(startSessionMsg);
      } catch (err) {
        cleanup();
        rejectPromise(err);
      }
    });
  }

  async start(): Promise<number> {
    if (this.port !== undefined) {
      return this.port;
    }
    return new Promise((resolvePromise, rejectPromise) => {
      this.server = net.createServer(async socket => {
        try {
          await this.handleConnection(socket);
        } catch (err: unknown) {
          socket.destroy(err as Error);
        }
      });

      this.server.on('error', err => {
        rejectPromise(err);
      });

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server?.address() as net.AddressInfo;
        this.port = addr.port;
        resolvePromise(this.port);
      });
    });
  }

  async close(): Promise<void> {
    if (this.server) {
      return new Promise(resolvePromise => {
        this.server?.close(() => {
          resolvePromise();
        });
      });
    }
  }

  private async handleConnection(socket: net.Socket): Promise<void> {
    const authHeaders = await this.auth.getRequestHeaders();
    console.log('DEBUG handleConnection authHeaders:', authHeaders);
    const metadata = new grpc.Metadata();
    const headers = normalizeHeaders(authHeaders);
    for (const [key, value] of Object.entries(headers)) {
      metadata.add(key, value);
    }

    let target = this.endpoint;
    if (!target.includes(':')) {
      target += ':443';
    }

    const client = new SqlDataServiceClientClass(
      target,
      this.channelCredentials || grpc.credentials.createSsl()
    );
    this.client = client;

    const stream = client.StreamSqlData(
      metadata
    ) as unknown as grpc.ClientDuplexStream<unknown, unknown>;

    interface StreamSqlDataResponse {
      data?: {
        data?: Buffer;
      };
      terminate_session?: {
        status?: {
          code: number;
          message: string;
        };
      };
    }

    stream.on('data', (response: StreamSqlDataResponse) => {
      if (response.data && response.data.data) {
        socket.write(response.data.data);
      }
      if (response.terminate_session) {
        const status = response.terminate_session.status;
        const code = status ? status.code : 'UNKNOWN';
        const msg = status ? status.message : 'Session terminated by server';
        socket.destroy(
          new Error(
            `gRPC Stream terminated by server: Code ${code}, Message: ${msg}`
          )
        );
      }
    });

    stream.on('error', (err: grpc.ServiceError) => {
      socket.destroy(err);
    });

    stream.on('end', () => {
      socket.end();
    });

    const location = `locations/${this.regionId}`;
    const instance = `projects/${this.projectId}/instances/${this.instanceId}`;

    const startSessionMsg = {
      start_session: {
        location_id: location,
        instance_id: instance,
      },
    };

    stream.write(startSessionMsg);

    socket.on('data', chunk => {
      const dataPacketMsg = {
        data: {
          first_byte_offset: 0,
          data: chunk,
        },
      };
      stream.write(dataPacketMsg);
    });

    socket.on('end', () => {
      const terminateSessionMsg = {
        terminate_session: {
          status: {
            code: 0,
            message: 'Client closed connection',
          },
        },
      };
      stream.write(terminateSessionMsg);
      stream.end();
    });

    socket.on('error', err => {
      stream.destroy(err);
    });
  }
}
