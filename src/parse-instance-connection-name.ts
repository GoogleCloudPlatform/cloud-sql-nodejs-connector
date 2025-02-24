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
import {resolveTxtRecord} from './dns-lookup';

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
  domainName?: string
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
    return await resolveDomainName(domainName);
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
  name: string
): Promise<InstanceConnectionInfo> {
  const icn = await resolveTxtRecord(name);
  if (!isInstanceConnectionName(icn)) {
    throw new CloudSQLConnectorError({
      message:
        'Malformed instance connection name returned for domain ' +
        name +
        ' : ' +
        icn,
      code: 'EBADDOMAINCONNECTIONNAME',
    });
  }

  const info = parseInstanceConnectionName(icn);
  info.domainName = name;
  return info;
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
