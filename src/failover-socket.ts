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

import * as net from 'net';

export class FailoverSocket extends net.Socket {
  private hosts: string[];
  private port: number;
  private currentHostIndex = 0;
  public actualSocket?: net.Socket;
  private writeBuffer: Array<{
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    chunk: any;
    encoding: BufferEncoding;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    callback: (err?: Error | null) => void;
  }> = [];

  constructor(hosts: string[], port: number) {
    super();
    this.hosts = hosts;
    this.port = port;
  }

  startConnect() {
    this.connectNext();
  }

  private connectNext() {
    if (this.currentHostIndex >= this.hosts.length) {
      this.emit('error', new Error('Failed to connect to any target'));
      return;
    }
    const host = this.hosts[this.currentHostIndex++];
    const socket = new net.Socket();

    socket.once('error', () => {
      socket.removeAllListeners();
      socket.destroy();
      this.connectNext();
    });

    socket.once('connect', () => {
      socket.removeAllListeners('error');
      this.setSocket(socket);
      this.emit('connect');
    });

    socket.connect(this.port, host);
  }

  private setSocket(socket: net.Socket) {
    this.actualSocket = socket;

    socket.on('data', chunk => {
      this.push(chunk);
    });

    socket.on('end', () => {
      this.push(null);
    });

    socket.on('error', err => {
      this.emit('error', err);
    });

    socket.on('close', hadError => {
      this.emit('close', hadError);
    });

    // Flush buffer
    while (this.writeBuffer.length > 0) {
      const {chunk, encoding, callback} = this.writeBuffer.shift()!;
      socket.write(chunk, encoding, callback);
    }
  }

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  override _write(
    chunk: any, // eslint-disable-line @typescript-eslint/no-explicit-any
    encoding: BufferEncoding,
    callback: (err?: Error | null) => void
  ): void {
    if (this.actualSocket) {
      this.actualSocket.write(chunk, encoding, callback);
    } else {
      this.writeBuffer.push({chunk, encoding, callback});
    }
  }

  override _read(): void {
    // Reading is handled by forwarding 'data' event
  }

  override setKeepAlive(enable?: boolean, initialDelay?: number): this {
    if (this.actualSocket) {
      this.actualSocket.setKeepAlive(enable, initialDelay);
    }
    return this;
  }

  override setNoDelay(noDelay?: boolean): this {
    if (this.actualSocket) {
      this.actualSocket.setNoDelay(noDelay);
    }
    return this;
  }

  override end(cb?: () => void): this;
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  override end(chunk: any, cb?: () => void): this;
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  override end(chunk: any, encoding: BufferEncoding, cb?: () => void): this;
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  override end(chunk?: any, encoding?: any, cb?: any): this {
    if (this.actualSocket) {
      this.actualSocket.end(chunk, encoding, cb);
    } else {
      this.destroy();
      if (cb) cb();
    }
    return this;
  }

  override destroy(err?: Error): this {
    if (this.actualSocket) {
      this.actualSocket.destroy(err);
    }
    super.destroy(err);
    return this;
  }
}
