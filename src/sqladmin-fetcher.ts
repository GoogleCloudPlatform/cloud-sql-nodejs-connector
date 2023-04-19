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

import {GoogleAuth} from 'google-auth-library';
import {sqladmin_v1beta4} from '@googleapis/sqladmin';
const {Sqladmin} = sqladmin_v1beta4;
import {InstanceConnectionInfo} from './instance-connection-info';
import {SslCert} from './ssl-cert';
import {parseCert} from './crypto';
import {IpAddresses, parseIpAddresses} from './ip-addresses';
import {CloudSQLConnectorError} from './errors';
import {getNearestExpiration} from './time';
import {AuthTypes} from './auth-types';

export interface InstanceMetadata {
  ipAddresses: IpAddresses;
  serverCaCert: SslCert;
}

interface RequestBody {
  public_key: string;
  access_token?: string;
}

export class SQLAdminFetcher {
  private readonly client: sqladmin_v1beta4.Sqladmin;
  private readonly auth: GoogleAuth;

  constructor(loginAuth?: GoogleAuth) {
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/sqlservice.admin'],
    });
    this.client = new Sqladmin({
      auth,
      userAgentDirectives: [
        {
          product: 'cloud-sql-nodejs-connector',
          version: '0.1.0',
        },
      ],
    });

    this.auth =
      loginAuth ||
      new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/sqlservice.login'],
      });
  }

  async getInstanceMetadata({
    projectId,
    regionId,
    instanceId,
  }: InstanceConnectionInfo): Promise<InstanceMetadata> {
    const res = await this.client.connect.get({
      project: projectId,
      instance: instanceId,
    });

    if (!res.data) {
      throw new CloudSQLConnectorError({
        message:
          `Failed to find metadata on project id: ${projectId} ` +
          `and instance id: ${instanceId}. Ensure network connectivity and ` +
          'validate the provided `instanceConnectionName` config value',
        code: 'ENOSQLADMIN',
      });
    }

    const ipAddresses = parseIpAddresses(res.data.ipAddresses);

    const {serverCaCert} = res.data;
    if (!serverCaCert || !serverCaCert.cert || !serverCaCert.expirationTime) {
      throw new CloudSQLConnectorError({
        message: 'Cannot connect to instance, no valid CA certificate found',
        code: 'ENOSQLADMINCERT',
      });
    }

    const {region} = res.data;
    if (!region) {
      throw new CloudSQLConnectorError({
        message: 'Cannot connect to instance, no valid region found',
        code: 'ENOSQLADMINREGION',
      });
    }
    if (region !== regionId) {
      throw new CloudSQLConnectorError({
        message: `Provided region was mismatched. Got ${region}, want ${regionId}`,
        code: 'EBADSQLADMINREGION',
      });
    }

    return {
      ipAddresses,
      serverCaCert: {
        cert: serverCaCert.cert,
        expirationTime: serverCaCert.expirationTime,
      },
    };
  }

  async getEphemeralCertificate(
    {projectId, instanceId}: InstanceConnectionInfo,
    publicKey: string,
    authType: AuthTypes
  ): Promise<SslCert> {
    const requestBody: RequestBody = {
      public_key: publicKey,
    };

    let tokenExpiration;
    if (authType === AuthTypes.IAM) {
      const access_token = await this.auth.getAccessToken();
      const client = await this.auth.getClient();
      if (access_token && 'getTokenInfo' in client) {
        const info = await client.getTokenInfo(access_token);
        tokenExpiration = info.expiry_date;
        requestBody.access_token = access_token;
      } else {
        throw new CloudSQLConnectorError({
          message:
            'Failed to get access token for automatic IAM authentication.',
          code: 'ENOACCESSTOKEN',
        });
      }
    }
    const res = await this.client.connect.generateEphemeralCert({
      project: projectId,
      instance: instanceId,
      requestBody,
    });

    if (!res.data) {
      throw new CloudSQLConnectorError({
        message:
          `Failed to find metadata on project id: ${projectId} ` +
          `and instance id: ${instanceId}. Ensure network connectivity and ` +
          'validate the provided `instanceConnectionName` config value',
        code: 'ENOSQLADMIN',
      });
    }

    const {ephemeralCert} = res.data;
    if (!ephemeralCert || !ephemeralCert.cert) {
      throw new CloudSQLConnectorError({
        message:
          'Cannot connect to instance, failed to retrieve an ephemeral certificate',
        code: 'ENOSQLADMINEPH',
      });
    }

    // NOTE: If the SQL Admin generateEphemeralCert API starts returning
    // the expirationTime info, this certificate parsing is no longer needed
    const {cert, expirationTime} = await parseCert(ephemeralCert.cert);

    const nearestExpiration = getNearestExpiration(
      Date.parse(expirationTime),
      tokenExpiration
    );

    return {
      cert,
      expirationTime: nearestExpiration,
    };
  }
}
