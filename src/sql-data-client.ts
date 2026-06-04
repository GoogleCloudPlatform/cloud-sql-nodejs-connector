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
import * as grpc from '@grpc/grpc-js';
import {AuthClient, GoogleAuth} from 'google-auth-library';
import {SqlDataServiceClient} from '@google-cloud/sql';
import {CloudSQLConnectorError} from './errors';

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
    return new Promise((resolvePromise, rejectPromise) => {
      let client: SqlDataServiceClient | undefined;
      let stream: any | undefined;

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
            client.close().catch(() => {});
          } catch (e) {
            // ignore error
          }
        }
      };

      try {
        let target = opts.endpoint || 'sqladmin.googleapis.com';
        let servicePath = target;
        let port: number | undefined = undefined;
        if (target.includes(':')) {
          const parts = target.split(':');
          servicePath = parts[0];
          port = parseInt(parts[1], 10);
        }

        const clientInstance = new SqlDataServiceClient({
          auth: opts.auth as any,
          servicePath,
          port,
          sslCreds: opts.channelCredentials,
        });
        client = clientInstance;

        const parts = opts.instanceConnectionName.split(':');
        const projectId = parts[0];
        const regionId = parts[1];
        const instanceId = parts[2];
        const instanceResource = `projects/${projectId}/instances/${instanceId}`;
        const locationResource = `locations/${regionId}`;

        const s = clientInstance.streamSqlData({
          otherArgs: {
            headers: {
              'x-goog-request-params': `instance_id=${instanceResource}&location_id=${locationResource}`,
            },
          },
        });
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
          startSession: {
            locationId: locationResource,
            instanceId: instanceResource,
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
    let servicePath = this.endpoint;
    let port: number | undefined = undefined;
    if (this.endpoint.includes(':')) {
      const parts = this.endpoint.split(':');
      servicePath = parts[0];
      port = parseInt(parts[1], 10);
    }

    const client = new SqlDataServiceClient({
      auth: this.auth as any,
      servicePath,
      port,
      sslCreds: this.channelCredentials,
    });
    this.client = client;

    const instanceResource = `projects/${this.projectId}/instances/${this.instanceId}`;
    const locationResource = `locations/${this.regionId}`;

    const stream = client.streamSqlData({
      otherArgs: {
        headers: {
          'x-goog-request-params': `instance_id=${instanceResource}&location_id=${locationResource}`,
        },
      },
    });

    stream.on('data', (response: any) => {
      if (response.data && response.data.data) {
        socket.write(response.data.data);
      }
      if (response.terminateSession) {
        const status = response.terminateSession.status;
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

    const startSessionMsg = {
      startSession: {
        locationId: locationResource,
        instanceId: instanceResource,
      },
    };

    stream.write(startSessionMsg);

    socket.on('data', chunk => {
      const dataPacketMsg = {
        data: {
          firstByteOffset: 0,
          data: chunk,
        },
      };
      stream.write(dataPacketMsg);
    });

    socket.on('end', () => {
      const terminateSessionMsg = {
        terminateSession: {
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
