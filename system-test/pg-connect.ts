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
import {
  Connector,
  AuthTypes,
  IpAddressTypes,
} from '@google-cloud/cloud-sql-connector';
const {Client} = pg;

t.test('open connection and retrieves standard pg tables', async t => {
  const connector = new Connector();
  const clientOpts = await connector.getOptions({
    instanceConnectionName: String(process.env.POSTGRES_CONNECTION_NAME),
    ipType: process.env.IP_TYPE || IpAddressTypes.PUBLIC,
  });
  const client = new Client({
    ...clientOpts,
    user: String(process.env.POSTGRES_USER),
    password: String(process.env.POSTGRES_PASS),
    database: String(process.env.POSTGRES_DB),
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

t.test('open IAM connection and retrieves standard pg tables', async t => {
  const connector = new Connector();
  const clientOpts = await connector.getOptions({
    instanceConnectionName: String(process.env.POSTGRES_CONNECTION_NAME),
    ipType: process.env.IP_TYPE || IpAddressTypes.PUBLIC,
    authType: AuthTypes.IAM,
  });
  const client = new Client({
    ...clientOpts,
    user: String(process.env.POSTGRES_IAM_USER),
    database: String(process.env.POSTGRES_DB),
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

t.test(
  'open connection to CAS-based CA instance and retrieves standard pg tables',
  async t => {
    const connector = new Connector();
    const clientOpts = await connector.getOptions({
      instanceConnectionName: String(process.env.POSTGRES_CAS_CONNECTION_NAME),
      ipType: process.env.IP_TYPE || IpAddressTypes.PUBLIC,
    });
    const client = new Client({
      ...clientOpts,
      user: String(process.env.POSTGRES_USER),
      password: String(process.env.POSTGRES_CAS_PASS),
      database: String(process.env.POSTGRES_DB),
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
  }
);

t.test(
  'open connection to Customer Private CAS-based CA instance and retrieves standard pg tables',
  async t => {
    const connector = new Connector();
    const clientOpts = await connector.getOptions({
      instanceConnectionName: String(
        process.env.POSTGRES_CUSTOMER_CAS_CONNECTION_NAME
      ),
      ipType: process.env.IP_TYPE || IpAddressTypes.PUBLIC,
    });
    const client = new Client({
      ...clientOpts,
      user: String(process.env.POSTGRES_USER),
      password: String(process.env.POSTGRES_CUSTOMER_CAS_PASS),
      database: String(process.env.POSTGRES_DB),
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
  }
);

t.test(
  'open connection to Domain Name instance retrieves standard pg tables',
  async t => {
    const connector = new Connector();
    const clientOpts = await connector.getOptions({
      domainName: String(process.env.POSTGRES_CUSTOMER_CAS_DOMAIN_NAME),
      ipType: process.env.IP_TYPE || IpAddressTypes.PUBLIC,
    });
    const client = new Client({
      ...clientOpts,
      user: String(process.env.POSTGRES_USER),
      password: String(process.env.POSTGRES_CUSTOMER_CAS_PASS),
      database: String(process.env.POSTGRES_DB),
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
  }
);

t.test(
  'open connection to Domain Name invalid domain name rejects connection',
  async t => {
    const connector = new Connector();
    const clientOpts = await connector.getOptions({
      domainName: String(process.env.POSTGRES_CUSTOMER_CAS_INVALID_DOMAIN_NAME),
      ipType: process.env.IP_TYPE || IpAddressTypes.PUBLIC,
    });
    const client = new Client({
      ...clientOpts,
      user: String(process.env.POSTGRES_USER),
      password: String(process.env.POSTGRES_CUSTOMER_CAS_PASS),
      database: String(process.env.POSTGRES_DB),
    });
    t.after(async () => {
      console.log('Ending...');
      try {
        await client.end();
      } finally {
        connector.close();
        console.log('Ended...');
      }
    });
    try {
      await client.connect();
      t.fail('Should throw exception');
    } catch (e) {
      t.same(e.code, 'ERR_TLS_CERT_ALTNAME_INVALID');
    } finally {
      t.end();
    }
  }
);

t.test(
  'open connection to MCP instance retrieves standard pg tables',
  async t => {
    const connector = new Connector();
    const clientOpts = await connector.getOptions({
      instanceConnectionName: String(process.env.POSTGRES_MCP_CONNECTION_NAME),
      ipType: process.env.IP_TYPE || IpAddressTypes.PUBLIC,
    });
    const client = new Client({
      ...clientOpts,
      user: String(process.env.POSTGRES_USER),
      password: String(process.env.POSTGRES_MCP_PASS),
      database: String(process.env.POSTGRES_DB),
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
  }
);
