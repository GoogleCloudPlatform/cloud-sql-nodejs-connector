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

const t = require('tap');
const {connect} = require('../connect.cjs');

t.test('pg sequelize cjs', async t => {
  const {database, close} = await connect({
    instanceConnectionName: process.env.POSTGRES_IAM_CONNECTION_NAME,
    username: process.env.POSTGRES_IAM_USER,
    databaseName: process.env.POSTGRES_DB,
  });
  const [[{now}]] = await database.query('SELECT NOW() AS now');
  t.strictSame(
    now.slice(0, 10),
    new Date(now).toJSON().slice(0, 10),
    'should have valid returned date object'
  );
  await close();
});
