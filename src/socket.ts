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
  instanceDnsName: string;
  serverName: string;
}

/**
 * validateCertificate implements custom TLS verification logic to gracefully and securely
 * handle deviations from standard TLS hostname verification in existing Cloud SQL instance server
 * certificates.
 *
 *
 * @param instanceInfo the instance connection name
 * @param instanceDnsName the instance's DNS name according to instance metadata
 * @param serverName the dns name from the connector configuration.
 *
 * This is run AFTER the NodeJS TLS library has validated the CA for the
 * server certificate.
 *
 * <p>This is the verification algorithm:
 *
 * <ol>
 *   <li>Verify the server cert CA, using the CA certs from the instance metadata. Reject the
 *       certificate if the CA is invalid.
 *   <li>Check that the server cert contains a SubjectAlternativeName matching the DNS name in the
 *       connector configuration OR the DNS Name from the instance metadata
 *   <li>If the SubjectAlternativeName does not match, and if the server cert Subject.CN field is
 *       not empty, check that the Subject.CN field contains the instance name. Reject the
 *       certificate if both the #2 SAN check and #3 CN checks fail.
 * </ol>
 *
 * <p>To summarize the deviations from standard TLS hostname verification:
 *
 * <p>Historically, Cloud SQL creates server certificates with the instance name in the Subject.CN
 * field in the format "my-project:my-instance". The connector is expected to check that the
 * instance name that the connector was configured to dial matches the server certificate Subject.CN
 * field. Thus, the Subject.CN field for most Cloud SQL instances does not contain a well-formed DNS
 * Name. This breaks standard TLS hostname verification.
 *
 * <p>Also, there are times when the instance metadata reports that an instance has a DNS name, but
 * that DNS name does not yet appear in the SAN records of the server certificate. The client should
 * fall back to validating the hostname using the instance name in the Subject.CN field.
 */
export function validateCertificate(
  instanceInfo: InstanceConnectionInfo,
  instanceDnsName: string,
  serverName: string
) {
  return (hostname: string, cert: tls.PeerCertificate): Error | undefined => {
    if (!cert) {
      return new CloudSQLConnectorError({
        message: 'Certificate missing',
        code: 'ENOSQLADMINVERIFYCERT',
      });
    }

    if (!instanceDnsName) {
      return checkCn(instanceInfo, cert);
    } else {
      const err = tls.checkServerIdentity(serverName, cert);
      if (err) {
        const cnErr = checkCn(instanceInfo, cert);
        if (cnErr) {
          return err;
        }
      }
    }

    return undefined;
  };
}

function checkCn(
  instanceInfo: InstanceConnectionInfo,
  cert: tls.PeerCertificate
) {
  const expectedCN = `${instanceInfo.projectId}:${instanceInfo.instanceId}`;
  if (!cert.subject || !cert.subject.CN) {
    return new CloudSQLConnectorError({
      message: `Certificate missing CN, expected ${expectedCN}`,
      code: 'ENOSQLADMINVERIFYCERT',
    });
  }
  if (cert.subject.CN && cert.subject.CN !== expectedCN) {
    return new CloudSQLConnectorError({
      message: `Certificate had CN ${cert.subject.CN}, expected ${expectedCN}`,
      code: 'EBADSQLADMINVERIFYCERT',
    });
  }
  return undefined;
}

export function getSocket({
  ephemeralCert,
  host,
  port,
  instanceInfo,
  privateKey,
  serverCaCert,
  instanceDnsName,
  serverName,
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
    // This checks the provided serverName against the server certificate. It
    // is called after the TLS CA chain of is validated.
    checkServerIdentity: validateCertificate(
      instanceInfo,
      instanceDnsName,
      serverName
    ),
  };
  const tlsSocket = tls.connect(socketOpts);
  tlsSocket.setKeepAlive(true, DEFAULT_KEEP_ALIVE_DELAY_MS);
  // overrides the stream.connect method since the stream is already
  // connected and some drivers might try to call it internally
  tlsSocket.connect = () => tlsSocket;
  return tlsSocket;
}
