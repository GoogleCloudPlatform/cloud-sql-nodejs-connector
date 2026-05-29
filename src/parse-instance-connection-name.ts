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

import {InstanceConnectionInfo} from './instance-connection-info';
import {CloudSQLConnectorError} from './errors';
import {resolveTxtRecord, resolveCnameRecord} from './dns-lookup';

export interface Fetcher {
  resolveConnectSettings(dnsName: string, location: string): Promise<string>;
}

export function isSameInstance(
  a: InstanceConnectionInfo,
  b: InstanceConnectionInfo
): boolean {
  return (
    a.instanceId === b.instanceId &&
    a.regionId === b.regionId &&
    a.projectId === b.projectId &&
    a.domainName === b.domainName
  );
}

export async function resolveInstanceName(
  instanceConnectionName?: string,
  domainName?: string,
  client?: Fetcher
): Promise<InstanceConnectionInfo> {
  if (!instanceConnectionName && !domainName) {
    throw new CloudSQLConnectorError({
      message:
        'Missing instance connection name, expected: "PROJECT:REGION:INSTANCE" or a valid domain name.',
      code: 'ENOCONNECTIONNAME',
    });
  } else if (
    instanceConnectionName &&
    isInstanceConnectionName(instanceConnectionName)
  ) {
    return parseInstanceConnectionName(instanceConnectionName);
  } else if (domainName && isValidDomainName(domainName)) {
    return await resolveDomainName(domainName, client);
  } else {
    throw new CloudSQLConnectorError({
      message:
        'Malformed Instance connection name, expected an instance connection name in the form "PROJECT:REGION:INSTANCE" or a valid domain name',
      code: 'EBADCONNECTIONNAME',
    });
  }
}

const connectionNameRegex =
  /^(?<projectId>[^:]+(:[^:]+)?):(?<regionId>[^:]+):(?<instanceId>[^:]+)$/;

const domainNameRegex =
  /^(?:[_a-z0-9](?:[_a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?)?$/;

const pscDnsRegex =
  /^([a-f0-9]{12})\.([^.]+)\.([a-z0-9]+-[a-z0-9]+)\.(sql|sql-psa|sql-psc)\.goog\.?$/;

export function isValidDomainName(name: string): boolean {
  const matches = String(name).match(domainNameRegex);
  return Boolean(matches);
}

export function isInstanceConnectionName(name: string): boolean {
  const matches = String(name).match(connectionNameRegex);
  return Boolean(matches);
}

export async function resolveDomainName(
  name: string,
  client?: Fetcher
): Promise<InstanceConnectionInfo> {
  let current = name;
  const visited = new Set<string>([current]);

  for (let i = 0; i < 10; i++) {
    if (isInstanceConnectionName(current)) {
      const info = parseInstanceConnectionName(current);
      info.domainName = current !== name ? name : undefined;
      return info;
    }

    const dnsNormalized = current.endsWith('.')
      ? current.slice(0, -1)
      : current;
    const match = dnsNormalized.toLowerCase().match(pscDnsRegex);
    if (match) {
      const region = match[3];
      if (!client) {
        throw new CloudSQLConnectorError({
          message: 'SQLAdmin client is not configured in the resolver.',
          code: 'ENOSQLADMINCLIENTCONFIG',
        });
      }

      const dnsNameWithDot = dnsNormalized + '.';
      const resolvedConnName = await client.resolveConnectSettings(
        dnsNameWithDot,
        region
      );
      const info = parseInstanceConnectionName(resolvedConnName);
      info.domainName = name;
      return info;
    }

    if (!isValidDomainName(current)) {
      throw new CloudSQLConnectorError({
        message: `Malformed domain name: ${current}`,
        code: 'EBADDOMAINNAME',
      });
    }

    let cnameFound = false;
    let cname = '';
    try {
      cname = await resolveCnameRecord(current);
      cnameFound = true;
    } catch (err) {
      // No CNAME found
    }

    if (cnameFound) {
      if (visited.has(cname)) {
        throw new CloudSQLConnectorError({
          message: `CNAME loop detected for domain: ${name}`,
          code: 'ECNAMELOOPDETECTED',
        });
      }
      visited.add(cname);
      current = cname;
      continue;
    }

    let txtRecord = '';
    try {
      txtRecord = await resolveTxtRecord(current);
    } catch (err) {
      throw new CloudSQLConnectorError({
        message: `Unable to resolve TXT record for domain ${name}`,
        code: 'EDOMAINNAMELOOKUPERROR',
        errors: [err as Error],
      });
    }

    if (!isInstanceConnectionName(txtRecord)) {
      throw new CloudSQLConnectorError({
        message: `Malformed instance connection name returned for domain ${current} : ${txtRecord}`,
        code: 'EBADDOMAINCONNECTIONNAME',
      });
    }

    const info = parseInstanceConnectionName(txtRecord);
    info.domainName = name;
    return info;
  }

  throw new CloudSQLConnectorError({
    message: `CNAME loop detected or max resolution depth reached for domain: ${name}`,
    code: 'ECNAMELOOPDETECTED',
  });
}

export function parseInstanceConnectionName(
  instanceConnectionName: string | undefined
): InstanceConnectionInfo {
  if (!instanceConnectionName) {
    throw new CloudSQLConnectorError({
      message:
        'Missing instance connection name, expected: "PROJECT:REGION:INSTANCE"',
      code: 'ENOCONNECTIONNAME',
    });
  }

  const matches = String(instanceConnectionName).match(connectionNameRegex);
  if (!matches || !matches.groups) {
    throw new CloudSQLConnectorError({
      message:
        'Malformed instance connection name provided: expected format ' +
        `of "PROJECT:REGION:INSTANCE", got ${instanceConnectionName}`,
      code: 'EBADCONNECTIONNAME',
    });
  }

  return {
    projectId: matches.groups.projectId,
    regionId: matches.groups.regionId,
    instanceId: matches.groups.instanceId,
    domainName: undefined,
  };
}
