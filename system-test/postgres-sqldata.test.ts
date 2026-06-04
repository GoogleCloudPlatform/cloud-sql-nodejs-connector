// Copyright 2026 Google LLC
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
import {Connector, IpAddressTypes} from '@google-cloud/cloud-sql-connector';
const {Client} = pg;

t.test('open SQL_DATA connection and retrieves standard pg tables', async t => {
  const pass = process.env.POSTGRES_CUSTOMER_CAS_PASS;
  if (!pass) {
    t.skip('POSTGRES_CUSTOMER_CAS_PASS env var not set, skipping');
    return;
  }

  const connector = new Connector({
    sqlAdminAPIEndpoint:
      'https://coreltest-sqladmin.mtls.sandbox.googleapis.com',
    sqlDataEndpoint: 'coreltest-sqladmin.mtls.sandbox.googleapis.com:443',
    userProject: 'speckle-connector-quotaproject',
  });

  const clientOpts = await connector.getOptions({
    instanceConnectionName:
      'hessjc-playground-01:us-central1:aide-poc-instance-1',
    ipType: IpAddressTypes.SQL_DATA,
    sqlDataEndpoint: 'coreltest-sqladmin.mtls.sandbox.googleapis.com:443',
  });

  const client = new Client({
    ...clientOpts,
    user: 'postgres',
    password: pass,
    database: 'postgres',
  });

  t.after(async () => {
    try {
      await client.end();
    } finally {
      connector.close();
    }
  });

  await client.connect();

  const {
    rows: [result],
  } = await client.query('SELECT NOW();');
  const returnedDate = result['now'];
  t.ok(returnedDate.getTime(), 'should have valid returned date object');
});
