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
import {v1beta4, protos} from '@google-cloud/sql';
import {CloudSQLConnectorError} from './errors';

export interface SqlDataClientOptions {
  instanceConnectionName: string;
  auth: GoogleAuth<AuthClient>;
  endpoint?: string;
  streamTimeout?: number;
  keepAliveTimeMs?: number;
  keepAliveTimeoutMs?: number;
  channelCredentials?: grpc.ChannelCredentials;
  getDirectSocket?: () => Promise<net.Socket> | net.Socket;
  onUnsupported?: () => void;
}

export class SqlDataClient {
  private readonly instanceConnectionName: string;
  private readonly auth: GoogleAuth<AuthClient>;
  private readonly endpoint: string;
  private readonly streamTimeout: number;
  private readonly keepAliveTimeMs: number;
  private readonly keepAliveTimeoutMs: number;
  private readonly projectId: string;
  private readonly regionId: string;
  private readonly instanceId: string;
  private readonly channelCredentials?: grpc.ChannelCredentials;
  private readonly getDirectSocket?: () => Promise<net.Socket> | net.Socket;
  private readonly onUnsupported?: () => void;
  private readonly activeSockets = new Set<net.Socket>();
  private server?: net.Server;
  private client?: v1beta4.SqlDataServiceClient;
  private port?: number;

  constructor(opts: SqlDataClientOptions) {
    this.instanceConnectionName = opts.instanceConnectionName;
    this.auth = opts.auth;
    this.endpoint = opts.endpoint || 'sqladmin.googleapis.com';
    this.streamTimeout = opts.streamTimeout || 2 * 60 * 60 * 1000; // 2 hours
    this.keepAliveTimeMs = opts.keepAliveTimeMs ?? 30 * 1000; // 30 seconds
    this.keepAliveTimeoutMs = opts.keepAliveTimeoutMs ?? 10 * 1000; // 10 seconds
    this.channelCredentials = opts.channelCredentials;
    this.getDirectSocket = opts.getDirectSocket;
    this.onUnsupported = opts.onUnsupported;

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

  private getClient(): v1beta4.SqlDataServiceClient {
    if (this.client) {
      return this.client;
    }

    let servicePath = this.endpoint.replace(/^https?:\/\//, '');
    let port = 443;
    if (servicePath.includes(':')) {
      const parts = servicePath.split(':');
      servicePath = parts[0];
      port = parseInt(parts[1], 10);
    }

    const clientOptions = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      auth: this.auth as any,
      servicePath,
      sslCreds: this.channelCredentials,
      port,
      'grpc.keepalive_time_ms': this.keepAliveTimeMs,
      'grpc.keepalive_timeout_ms': this.keepAliveTimeoutMs,
      'grpc.keepalive_permit_without_calls': 1,
    };

    this.client = new v1beta4.SqlDataServiceClient(clientOptions);
    return this.client;
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
    for (const socket of this.activeSockets) {
      socket.destroy();
    }
    this.activeSockets.clear();

    if (this.client) {
      try {
        await this.client.close();
      } catch {
        // ignore
      }
      this.client = undefined;
    }
    if (this.server) {
      return new Promise(resolvePromise => {
        this.server?.close(() => {
          resolvePromise();
        });
      });
    }
  }

  private async handleConnection(socket: net.Socket): Promise<void> {
    this.activeSockets.add(socket);
    socket.once('close', () => {
      this.activeSockets.delete(socket);
    });

    let isFallback = false;
    let isEstablished = false;
    let isClosed = false;
    const clientBuffer: Buffer[] = [];
    let directSocket: net.Socket | undefined;

    const client = this.getClient();

    const instanceResource = `projects/${this.projectId}/instances/${this.instanceId}`;
    const locationResource = `locations/${this.regionId}`;

    const stream = client.streamSqlData({
      otherArgs: {
        headers: {
          'x-goog-request-params': `instance_id=${instanceResource}&location_id=${locationResource}`,
        },
        timeout: this.streamTimeout,
      },
    });

    const startSessionMsg = {
      startSession: {
        locationId: locationResource,
        instanceId: instanceResource,
      },
    };
    stream.write(startSessionMsg);

    stream.on(
      'data',
      (response: protos.google.cloud.sql.v1beta4.IStreamSqlDataResponse) => {
        if (isFallback || isClosed) {
          return;
        }
        if (!isEstablished) {
          isEstablished = true;
          clientBuffer.length = 0;
        }
        if (response.data && response.data.data) {
          const ok = socket.write(response.data.data);
          if (!ok) {
            stream.pause();
          }
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
      }
    );

    socket.on('drain', () => {
      if (!isFallback && !isClosed) {
        stream.resume();
      }
    });

    stream.on('drain', () => {
      if (!isFallback && !isClosed) {
        socket.resume();
      }
    });

    stream.on('error', async (err: grpc.ServiceError) => {
      if (isFallback || isClosed) {
        return;
      }
      if (err.code === 9 && !isEstablished && this.getDirectSocket) {
        // FAILED_PRECONDITION: Instance does not support SQL_DATA.
        isFallback = true;
        this.onUnsupported?.();
        try {
          stream.destroy();
        } catch {
          // ignore
        }
        try {
          directSocket = await this.getDirectSocket();
          while (clientBuffer.length > 0) {
            const chunk = clientBuffer.shift();
            if (chunk) {
              directSocket.write(chunk);
            }
          }
          socket.pipe(directSocket);
          directSocket.pipe(socket);

          directSocket.on('error', directErr => {
            socket.destroy(directErr);
          });
          directSocket.on('close', () => {
            socket.end();
          });
        } catch (directErr) {
          socket.destroy(directErr as Error);
        }
        return;
      }
      socket.destroy(err);
    });

    stream.on('end', () => {
      if (isFallback || isClosed) {
        return;
      }
      socket.end();
    });

    socket.on('data', chunk => {
      if (isFallback) {
        // Handled by pipe(directSocket)
        return;
      }
      if (!isEstablished) {
        clientBuffer.push(chunk);
      }
      const ok = stream.write({
        data: {
          firstByteOffset: 0,
          data: chunk,
        },
      });
      if (!ok) {
        socket.pause();
      }
    });

    socket.on('end', () => {
      isClosed = true;
      if (isFallback) {
        // Handled by pipe(directSocket)
        return;
      }
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
      isClosed = true;
      if (isFallback) {
        if (directSocket) {
          directSocket.destroy(err);
        }
      } else {
        stream.destroy(err);
      }
    });
  }
}
