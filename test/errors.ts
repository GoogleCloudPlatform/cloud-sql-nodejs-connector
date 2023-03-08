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
import {CloudSQLConnectorError} from '../src/errors';

const base = new Error('Some error');

const cloudSqlErr = new CloudSQLConnectorError({
  message: 'An error',
  code: 'ERR',
});

try {
  throw cloudSqlErr;
} catch (err) {
  t.ok(
    (err as Error).stack?.startsWith('CloudSQLConnectorError'),
    'should have a stack'
  );
}

const aggregate = new CloudSQLConnectorError({
  message: 'Aggregate error',
  code: 'AGGERR',
  errors: [base, cloudSqlErr],
});

try {
  throw aggregate;
} catch (err) {
  t.same(
    (err as CloudSQLConnectorError).errors,
    [base, cloudSqlErr],
    'should have errors'
  );
  t.ok(
    (err as Error).stack?.startsWith('CloudSQLConnectorError: Aggregate error'),
    'should have a stack'
  );
}
