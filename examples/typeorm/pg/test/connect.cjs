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
const connector = require('../connect.cjs');

t.test('pg typeorm cjs', async t => {
  const { dataSource, close } = await connector.connect({
    instanceConnectionName: process.env.POSTGRES_IAM_CONNECTION_NAME,
    username: process.env.POSTGRES_IAM_USER,
    database: process.env.POSTGRES_DB,
  });
  const [{ now }] = await dataSource.manager.query('SELECT NOW() as now')
  t.ok(now.getTime(), 'should have valid returned date object');
  await close();
});
