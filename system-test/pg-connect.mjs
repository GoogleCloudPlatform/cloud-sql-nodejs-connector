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
import pg from 'pg';
import {Connector} from '@google-cloud/cloud-sql-connector';
const {Client} = pg;

t.test('open connection and retrieves standard pg tables', async t => {
  const connector = new Connector();
  const clientOpts = await connector.getOptions({
    instanceConnectionName: process.env.POSTGRES_CONNECTION_NAME,
    ipType: 'PUBLIC',
  });
  const client = new Client({
    ...clientOpts,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASS,
    database: process.env.POSTGRES_DB,
  });
  client.connect();
  const result = await client.query('SELECT * FROM pg_catalog.pg_tables;');

  t.same(result.command, 'SELECT', 'should list correct command in response');
  t.ok(result.rowCount > 0, 'should be able to retrieve list of tables');

  await client.end();
  connector.close();
});
