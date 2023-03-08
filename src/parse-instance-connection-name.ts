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

  const connectionNameRegex =
    /(?<projectId>[^:]+(:[^:]+)?):(?<regionId>[^:]+):(?<instanceId>[^:]+)/;
  const matches = String(instanceConnectionName).match(connectionNameRegex);
  if (!matches) {
    throw new CloudSQLConnectorError({
      message:
        'Malformed instance connection name provided: expected format ' +
        `of "PROJECT:REGION:INSTANCE", got ${instanceConnectionName}`,
      code: 'EBADCONNECTIONNAME',
    });
  }

  const unmatchedItems = matches[0] !== matches.input;
  if (unmatchedItems || !matches.groups) {
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
  };
}
