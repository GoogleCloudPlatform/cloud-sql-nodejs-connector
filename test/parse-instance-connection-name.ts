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

import t from 'tap';
import {parseInstanceConnectionName} from '../src/parse-instance-connection-name';

t.throws(
  () => parseInstanceConnectionName(undefined),
  {code: 'ENOCONNECTIONNAME'},
  'should throw type error if no instance connection name provided'
);

t.throws(
  () => parseInstanceConnectionName(''),
  {code: 'ENOCONNECTIONNAME'},
  'should throw type error if empty instance connection name provided'
);

t.throws(
  () => parseInstanceConnectionName('my-project:my-instance'),
  {
    code: 'EBADCONNECTIONNAME',
    message:
      'Malformed instance connection name provided: expected format ' +
      'of "PROJECT:REGION:INSTANCE", got my-project:my-instance',
  },
  'should throw type error if malformed instance connection name provided'
);

t.throws(
  () => parseInstanceConnectionName(':region-1:my-instance'),
  {code: 'EBADCONNECTIONNAME'},
  'should throw type error if missing project id'
);

t.throws(
  () => parseInstanceConnectionName('my-project::my-instance'),
  {code: 'EBADCONNECTIONNAME'},
  'should throw type error if missing region id'
);

t.throws(
  () => parseInstanceConnectionName('my-project:region-1:'),
  {code: 'EBADCONNECTIONNAME'},
  'should throw type error if missing instance id'
);

t.throws(
  () =>
    parseInstanceConnectionName(
      'google.com:PROJECT:region-02:my-instance:extra-item'
    ),
  {code: 'EBADCONNECTIONNAME'},
  'should throw type error if an extra item is provided'
);

t.same(
  parseInstanceConnectionName('my-project:region-1:my-instance'),
  {
    projectId: 'my-project',
    regionId: 'region-1',
    instanceId: 'my-instance',
  },
  'should be able to parse standard data'
);

t.same(
  parseInstanceConnectionName('google.com:PROJECT:region-02:my-instance'),
  {
    projectId: 'google.com:PROJECT',
    regionId: 'region-02',
    instanceId: 'my-instance',
  },
  'should support legacy domain scoped project id'
);
