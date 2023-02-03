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

const missingInstanceConnectionNameError = () =>
  Object.assign(
    new TypeError(
      'Missing instance connection name, expected: "PROJECT:REGION:INSTANCE"'
    ),
    {code: 'ENOCONNECTIONNAME'}
  );

const malformedInstanceConnnectionNameError = (
  instanceConnectionName: string
) =>
  Object.assign(
    new TypeError(
      'Malformed instance connection name provided: expected format ' +
        `of "PROJECT:REGION:INSTANCE", got ${instanceConnectionName}`
    ),
    {code: 'EBADCONNECTIONNAME'}
  );

export function parseInstanceConnectionName(
  instanceConnectionName: string | undefined
): InstanceConnectionInfo {
  if (!instanceConnectionName) {
    throw missingInstanceConnectionNameError();
  }

  const connectionNameRegex =
    /(?<projectId>[^:]+(:[^:]+)?):(?<regionId>[^:]+):(?<instanceId>[^:]+)/;
  const matches = String(instanceConnectionName).match(connectionNameRegex);
  if (!matches) {
    throw malformedInstanceConnnectionNameError(instanceConnectionName);
  }

  const unmatchedItems = matches[0] !== matches.input;
  if (unmatchedItems || !matches.groups) {
    throw malformedInstanceConnnectionNameError(instanceConnectionName);
  }

  return {
    projectId: matches.groups.projectId,
    regionId: matches.groups.regionId,
    instanceId: matches.groups.instanceId,
  };
}
