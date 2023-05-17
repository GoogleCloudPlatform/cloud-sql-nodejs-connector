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
const mysql = require('mysql2/promise');
const {Connector} = require('@google-cloud/cloud-sql-connector');

t.test('open connection and run basic mysql commands', async t => {
  const connector = new Connector();
  const clientOpts = await connector.getOptions({
    instanceConnectionName: process.env.MYSQL_CONNECTION_NAME,
    ipType: 'PUBLIC',
    authType: 'PASSWORD',
  });
  const conn = await mysql.createConnection({
    ...clientOpts,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASS,
    database: process.env.MYSQL_DB,
  });

  const [[result]] = await conn.query('SELECT NOW();');
  const returnedDate = result['NOW()'];
  t.ok(returnedDate.getTime(), 'should have valid returned date object');

  await conn.end();
  connector.close();
});

t.test('open IAM connection and run basic mysql commands', async t => {
  const connector = new Connector();
  const clientOpts = await connector.getOptions({
    instanceConnectionName: process.env.MYSQL_IAM_CONNECTION_NAME,
    ipType: 'PUBLIC',
    authType: 'IAM',
  });
  const conn = await mysql.createConnection({
    ...clientOpts,
    user: process.env.MYSQL_IAM_USER,
    database: process.env.MYSQL_DB,
  });

  const [[result]] = await conn.query('SELECT NOW();');
  const returnedDate = result['NOW()'];
  t.ok(returnedDate.getTime(), 'should have valid returned date object');

  await conn.end();
  connector.close();
});
