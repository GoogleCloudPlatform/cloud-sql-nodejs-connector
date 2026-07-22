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

export interface DNSFetcher {
  resolveConnectSettings(region: string, dnsName: string): Promise<string>;
}

export function parseInstanceDNSName(dnsName: string): {
  instanceLabel: string;
  projectLabel: string;
  region: string;
  suffix: string;
  ok: boolean;
} {
  let name = dnsName.toLowerCase();
  if (name.endsWith('.')) {
    name = name.slice(0, -1);
  }

  const parts = name.split('.');
  if (parts.length !== 5) {
    return {
      instanceLabel: '',
      projectLabel: '',
      region: '',
      suffix: '',
      ok: false,
    };
  }

  if (parts[4] !== 'goog') {
    return {
      instanceLabel: '',
      projectLabel: '',
      region: '',
      suffix: '',
      ok: false,
    };
  }

  const suffixType = parts[3];
  if (
    suffixType !== 'sql' &&
    suffixType !== 'sql-psa' &&
    suffixType !== 'sql-psc'
  ) {
    return {
      instanceLabel: '',
      projectLabel: '',
      region: '',
      suffix: '',
      ok: false,
    };
  }

  const instanceLabel = parts[0];
  const projectLabel = parts[1];
  const region = parts[2];
  const suffix = suffixType + '.goog';

  if (region === 'global') {
    return {
      instanceLabel: '',
      projectLabel: '',
      region: '',
      suffix: '',
      ok: false,
    };
  }

  if (instanceLabel.length !== 12) {
    return {
      instanceLabel: '',
      projectLabel: '',
      region: '',
      suffix: '',
      ok: false,
    };
  }

  // Validate instanceLabel is hex
  if (!/^[0-9a-f]{12}$/.test(instanceLabel)) {
    return {
      instanceLabel: '',
      projectLabel: '',
      region: '',
      suffix: '',
      ok: false,
    };
  }

  if (!region.includes('-')) {
    return {
      instanceLabel: '',
      projectLabel: '',
      region: '',
      suffix: '',
      ok: false,
    };
  }

  return {instanceLabel, projectLabel, region, suffix, ok: true};
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
  fetcher?: DNSFetcher
): Promise<InstanceConnectionInfo> {
  let resolvedDomain = domainName;
  if (
    !resolvedDomain &&
    instanceConnectionName &&
    isValidDomainName(instanceConnectionName)
  ) {
    resolvedDomain = instanceConnectionName;
  }

  if (!instanceConnectionName && !resolvedDomain) {
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
  } else if (resolvedDomain && isValidDomainName(resolvedDomain)) {
    return await resolveDomainName(resolvedDomain, fetcher);
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

// The domain name pattern in accordance with RFC 1035, RFC 1123 and RFC 2181.
// From Go Connector:
const domainNameRegex =
  /^(?:[_a-z0-9](?:[_a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?)?$/;

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
  fetcher?: DNSFetcher
): Promise<InstanceConnectionInfo> {
  let current = name;
  let txtErr: Error | undefined;

  for (let depth = 0; depth < 10; depth++) {
    const dnsInfo = parseInstanceDNSName(current);
    if (dnsInfo.ok) {
      if (!fetcher) {
        throw new CloudSQLConnectorError({
          message: 'DNS resolver SQL Admin API client is not initialized',
          code: 'EDNSRESOLVERNOTINITIALIZED',
        });
      }
      const resolvedName = await fetcher.resolveConnectSettings(
        dnsInfo.region,
        current
      );
      const info = parseInstanceConnectionName(resolvedName);
      info.domainName = name;
      return info;
    }

    try {
      const records = await resolveTxtRecord(current);
      for (const record of records) {
        if (isInstanceConnectionName(record)) {
          const info = parseInstanceConnectionName(record);
          info.domainName = name;
          return info;
        }
      }
      txtErr = new CloudSQLConnectorError({
        message: `No valid TXT records found for ${current}`,
        code: 'ENOPPSCVALIDTXT',
      });
    } catch (e) {
      txtErr = e as Error;
    }

    try {
      let cnameVal = await resolveCnameRecord(current);
      if (cnameVal.endsWith('.')) {
        cnameVal = cnameVal.slice(0, -1);
      }
      if (cnameVal === current) {
        throw new Error('CNAME record loop detected or record not found');
      }
      if (!isValidDomainName(cnameVal)) {
        throw new Error(`Invalid format for CNAME record: ${cnameVal}`);
      }
      current = cnameVal;
    } catch (cnameErr) {
      throw new CloudSQLConnectorError({
        message: `No DNS record found for ${name}, lookup of ${current}. Lookup TXT error: ${txtErr?.message} Lookup CNAME error: ${(cnameErr as Error).message}`,
        code: 'EDOMAINNAMELOOKUPFAILED',
        errors: [txtErr!, cnameErr as Error],
      });
    }
  }

  throw new CloudSQLConnectorError({
    message: `CNAME lookup limit exceeded (max 10) for ${name}`,
    code: 'ECNAMELOOPLIMITEXCEEDED',
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
