// Copyright 2025 Google LLC
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

import {ConnectionOptions, Connector} from './connector';
import stream from 'node:stream';
import tls from 'node:tls';
import {CloudSQLConnectorError} from './errors';

// SocketWrapperOptions The configuration for the SocketWrapper
export class SocketWrapperOptions {
  connector: Connector;
  connectionConfig: ConnectionOptions;
  host: string | undefined;

  startConnection: boolean;

  constructor({
    connector,
    host,
    connectionConfig,
    startConnection,
  }: SocketWrapperOptions) {
    this.connector = connector;
    this.connectionConfig = connectionConfig;
    this.host = host;
    this.startConnection = startConnection;
  }
}

type SocketConfigFunction = (socket: tls.TLSSocket) => void;

// SocketWrapper allows the refresh and connect to the database to be
// delayed until the database driver calls Socket.connect(). This will allow
// users to configure their drivers using DNS names. It will also enable the
// implementation of lazy refresh.
export class SocketWrapper extends stream.Duplex {
  // The connector
  connector: Connector;
  // The configuration for this connection, including the
  // optional instanceConnectionName
  connectionConfig: ConnectionOptions;
  // The real TLSSocket to the database.
  socket: tls.TLSSocket | undefined;

  // Pending configuration from the driver to be applied
  // to the socket after it is created.
  applyCalls: Array<SocketConfigFunction> = [];
  authorized: boolean | undefined;

  // Driver options passed to stream() by the driver.
  host: string | undefined;

  constructor({
    connector,
    host,
    startConnection,
    connectionConfig,
  }: SocketWrapperOptions) {
    super();
    this.connector = connector;
    this.connectionConfig = connectionConfig;
    this.host = host;
    this.cork();
    this.pause();
    if (startConnection) {
      this.connect(3307, this.host);
    }
  }

  // Implementation of net.Socket.connect(), used by the driver to start
  // a connection.
  connect(port: number, host: string | undefined): this {
    // If the wrapper was configured with an InstanceConnectionName, then use
    // it. Otherwise, use the hostname from the driver.

    let instanceConnectionName: string;
    if (this.connectionConfig.instanceConnectionName) {
      instanceConnectionName = this.connectionConfig.instanceConnectionName;
    } else if (host) {
      instanceConnectionName = host;
    } else {
      throw new CloudSQLConnectorError({
        code: 'ENODOMAINNAME',
        message: 'Expected a domain name to the database, but it was empty.',
      });
    }

    this.connector
      .connect({
        authType: this.connectionConfig.authType,
        ipType: this.connectionConfig.ipType,
        instanceConnectionName,
      })
      .then(s => this.setSocket(s))
      .catch(e => this.connectFailed(e));

    return this;
  }

  // Implementation of Duplex, instruct the real socket to read data.
  _read(size: number) {
    this.socket?.read(size);
  }

  // Implementation of Duplex, writes a chunk of data to the socket.
  _write(
    //eslint-disable-next-line   @typescript-eslint/no-explicit-any
    chunk: any,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ) {
    this.socket?.write(chunk, encoding, callback);
  }

  // Implementation of Duplex, called to close the socket.
  _final(callback: (error?: Error | null) => void) {
    this.socket?.end(() => {
      callback(this.errored);
    });
  }

  // Implementation of Duplex, called when the socket is being forcibly closed.
  _destroy(error: Error | null, callback: (error?: Error | null) => void) {
    this.socket?.destroy(error || undefined);
    if (callback) {
      callback(error);
    }
  }

  // Implement some tls.Socket and net.Socket functions
  // for the benefit of the drivers. Delay calls until after the
  // socket is created.
  private setSocket(socket: tls.TLSSocket) {
    this.socket = socket;
    // Apply socket configuration from driver
    for (const fn of this.applyCalls) {
      fn(this.socket);
    }

    // When socket gets data, forward it to the driver's reader.
    this.socket.on('data', buffer => {
      this.push(buffer);
    });

    // Handle socket error and close events
    this.socket.once('error', err => {
      this.destroy(err);
      this.emit('error', err || this.errored || null);
    });
    this.socket.once('abort', err => {
      this.destroy(err);
      this.emit('abort', err || this.errored || null);
    });
    this.socket.once('end', err => {
      this.emit('end', err || this.errored || null);
      this.end(err);
    });
    this.socket.on('close', err => {
      this.emit('close', err || this.errored || null);
    });

    // When connection is complete and secure, emit "connect" event.
    this.socket.on('secureConnect', () => {
      this.authorized = this.socket?.authorized;
      this.uncork();
      this.resume();
      this.emit('connect');
      this.emit('secureConnect');
    });
  }

  // Handle failure loading the connection details

  private connectFailed(
    //eslint-disable-next-line   @typescript-eslint/no-explicit-any
    e: any
  ) {
    this.emit('error', e);
    this.destroy(e);
  }

  // Add methods from net.Socket used by the drivers.
  setNoDelay(b = true) {
    if (this.socket) {
      this.socket?.setNoDelay(b);
    } else {
      this.applyCalls.push(s => {
        s.setNoDelay(b);
      });
    }
  }

  setKeepAlive(b = true, d = 0) {
    if (this.socket) {
      this.socket?.setKeepAlive(b, d);
    } else {
      this.applyCalls.push(s => {
        s.setKeepAlive(b, d);
      });
    }
  }
  setTimeout(t = 0, cb: () => void) {
    if (this.socket) {
      this.socket?.setTimeout(t);
    } else {
      this.applyCalls.push(s => {
        s.setTimeout(t, cb);
      });
    }
  }

  ref() {
    if (this.socket) {
      this.socket?.ref();
    } else {
      this.applyCalls.push(s => {
        s.ref();
      });
    }
  }

  unref() {
    if (this.socket) {
      this.socket?.unref();
    } else {
      this.applyCalls.push(s => {
        s.unref();
      });
    }
  }
}
