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

export const PG_SSL_REQUEST_CODE = 80877103; // 0x04d2162f
export const PG_GSS_ENC_REQUEST_CODE = 80877104; // 0x04d21630
export const PG_PROTOCOL_VERSION_30 = 196608; // 0x00030000
export const MAX_PG_STARTUP_PACKET_LEN = 10000;

export interface WritableSocket {
  write?: (
    chunk: string | Uint8Array,
    encodingOrCb?: unknown,
    cb?: unknown
  ) => boolean;
}

/**
 * Wraps a socket and inspects the initial bytes written by the client driver to extract
 * the PostgreSQL v3 StartupMessage (user, database) pair for Auto-IAM refresh probes.
 *
 * Handles chunked streaming where the StartupMessage is split across multiple write() calls.
 * Once the startup message is detected or determined not to be a PostgreSQL v3 packet,
 * startupMessageSent is set to true, the buffer is cleared, and original write behavior is
 * restored with zero overhead on steady-state writes.
 */
export class PostgresSocket {
  private readonly socket: WritableSocket;
  private readonly onStartup: (user: string, database: string) => void;
  private readonly origWrite: (
    chunk: string | Uint8Array,
    encodingOrCb?: unknown,
    cb?: unknown
  ) => boolean;
  private buf: Buffer = Buffer.alloc(0);
  public startupMessageSent = false;

  constructor(
    socket: WritableSocket,
    onStartup: (user: string, database: string) => void
  ) {
    this.socket = socket;
    this.onStartup = onStartup;

    if (typeof socket.write !== 'function') {
      this.startupMessageSent = true;
      this.origWrite = () => false;
      return;
    }

    const boundWrite = socket.write.bind(socket);
    this.origWrite = boundWrite;
    socket.write = (
      chunk: string | Uint8Array,
      encodingOrCb?: unknown,
      cb?: unknown
    ): boolean => this.write(chunk, encodingOrCb, cb);
  }

  private unbind(): void {
    this.startupMessageSent = true;
    this.buf = Buffer.alloc(0);
    this.socket.write = this.origWrite;
  }

  public write(
    chunk: string | Uint8Array,
    encodingOrCb?: unknown,
    cb?: unknown
  ): boolean {
    if (this.startupMessageSent) {
      return this.origWrite(chunk, encodingOrCb, cb);
    }

    const chunkBuf: Buffer = Buffer.isBuffer(chunk)
      ? chunk
      : typeof chunk === 'string'
        ? Buffer.from(chunk)
        : Buffer.from(chunk);

    if (chunkBuf.length > 0) {
      this.buf = Buffer.concat([this.buf, chunkBuf]);
      const parsed = parsePostgresStartupPacket(this.buf);
      if (parsed.complete) {
        this.unbind();
        if (parsed.user) {
          this.onStartup(parsed.user, parsed.database);
        }
      } else if (this.buf.length > MAX_PG_STARTUP_PACKET_LEN + 8) {
        this.unbind();
      }
    }

    return this.origWrite(chunk, encodingOrCb, cb);
  }
}

export function attachPostgresSocket(
  socket: WritableSocket,
  onStartup: (user: string, database: string) => void
): PostgresSocket {
  return new PostgresSocket(socket, onStartup);
}

/**
 * Parses a buffer to extract the PostgreSQL v3 StartupMessage user and database parameters.
 * Accounts for prepended SSLRequest (80877103) or GSSENCRequest (80877104) packets.
 */
export function parsePostgresStartupPacket(buf: Buffer): {
  user: string;
  database: string;
  complete: boolean;
} {
  let slice = buf;
  // Step 1: Skip SSLRequest or GSSENCRequest if prepended (can occur in succession).
  while (
    slice.length >= 8 &&
    slice.readUInt32BE(0) === 8 &&
    (slice.readUInt32BE(4) === PG_SSL_REQUEST_CODE ||
      slice.readUInt32BE(4) === PG_GSS_ENC_REQUEST_CODE)
  ) {
    slice = slice.subarray(8);
  }

  // Step 2: Wait for at least 8 bytes (4-byte packet length + 4-byte protocol code).
  if (slice.length < 8) {
    return {user: '', database: '', complete: false};
  }

  const pktLen = slice.readUInt32BE(0);
  const code = slice.readUInt32BE(4);

  // Step 3: Validate protocol version (v3.0) and packet length bounds.
  if (
    code !== PG_PROTOCOL_VERSION_30 ||
    pktLen < 8 ||
    pktLen > MAX_PG_STARTUP_PACKET_LEN
  ) {
    return {user: '', database: '', complete: true};
  }

  // Step 4: Wait until the complete packet body has arrived.
  if (slice.length < pktLen) {
    return {user: '', database: '', complete: false};
  }

  // Step 5: Decode null-terminated key-value pairs (user, database) from StartupMessage.
  let payload = slice.subarray(8, pktLen);
  let user = '';
  let database = '';
  while (payload.length > 0 && payload[0] !== 0) {
    const kEnd = payload.indexOf(0);
    if (kEnd < 0) {
      break;
    }
    const key = payload.subarray(0, kEnd).toString('utf8');
    payload = payload.subarray(kEnd + 1);
    const vEnd = payload.indexOf(0);
    if (vEnd < 0) {
      break;
    }
    const val = payload.subarray(0, vEnd).toString('utf8');
    payload = payload.subarray(vEnd + 1);
    if (key === 'user') {
      user = val;
    } else if (key === 'database') {
      database = val;
    }
  }

  if (user && !database) {
    database = user;
  }
  return {user, database, complete: true};
}

/**
 * Builds a PostgreSQL v3.0 StartupMessage for (user, database).
 */
export function buildPostgresStartupPacket(
  user: string,
  database: string
): Buffer {
  const db = database || user;
  const body = Buffer.from(`user\0${user}\0database\0${db}\0\0`, 'utf8');
  const totalLen = 8 + body.length;
  const header = Buffer.alloc(8);
  header.writeUInt32BE(totalLen, 0);
  header.writeUInt32BE(PG_PROTOCOL_VERSION_30, 4);
  return Buffer.concat([header, body]);
}

/**
 * Builds a PostgreSQL Terminate packet ('X' followed by int32 length 4).
 */
export function buildTerminatePacket(): Buffer {
  return Buffer.from([0x58, 0x00, 0x00, 0x00, 0x04]);
}
