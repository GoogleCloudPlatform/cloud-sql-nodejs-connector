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
import {connect} from '../connect';

t.test('pg knex ts', async t => {
  const {database, close} = await connect({
    instanceConnectionName: String(process.env.POSTGRES_IAM_CONNECTION_NAME),
    user: String(process.env.POSTGRES_IAM_USER),
    databaseName: String(process.env.POSTGRES_DB),
  });
  const {now} = await database.first(database.raw('NOW() AS now'));
  t.ok(now.getTime(), 'should have valid returned date object');
  await close();
});
