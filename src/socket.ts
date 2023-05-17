// Copyright 2023 Google LLC
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

import tls from 'node:tls';
import {InstanceConnectionInfo} from './instance-connection-info';
import {SslCert} from './ssl-cert';
import {CloudSQLConnectorError} from './errors';

const DEFAULT_KEEP_ALIVE_DELAY_MS = 30 * 1000;

interface SocketOptions {
  ephemeralCert: SslCert;
  host: string;
  port: number;
  instanceInfo: InstanceConnectionInfo;
  privateKey: string;
  serverCaCert: SslCert;
}

export function validateCertificate(instanceInfo: InstanceConnectionInfo) {
  return (hostname: string, cert: tls.PeerCertificate): Error | undefined => {
    if (!cert || !cert.subject) {
      return new CloudSQLConnectorError({
        message: 'No certificate to verify',
        code: 'ENOSQLADMINVERIFYCERT',
      });
    }
    const expectedCN = `${instanceInfo.projectId}:${instanceInfo.instanceId}`;
    if (cert.subject.CN !== expectedCN) {
      return new CloudSQLConnectorError({
        message: `Certificate had CN ${cert.subject.CN}, expected ${expectedCN}`,
        code: 'EBADSQLADMINVERIFYCERT',
      });
    }
    return undefined;
  };
}

export function getSocket({
  ephemeralCert,
  host,
  port,
  instanceInfo,
  privateKey,
  serverCaCert,
}: SocketOptions): tls.TLSSocket {
  const socketOpts = {
    host,
    port,
    secureContext: tls.createSecureContext({
      ca: serverCaCert.cert,
      cert: ephemeralCert.cert,
      key: privateKey,
      minVersion: 'TLSv1.3',
    }),
    checkServerIdentity: validateCertificate(instanceInfo),
  };
  const tlsSocket = tls.connect(socketOpts);
  tlsSocket.setKeepAlive(true, DEFAULT_KEEP_ALIVE_DELAY_MS);
  // overrides the stream.connect method since the stream is already
  // connected and some drivers might try to call it internally
  tlsSocket.connect = () => tlsSocket;
  return tlsSocket;
}
