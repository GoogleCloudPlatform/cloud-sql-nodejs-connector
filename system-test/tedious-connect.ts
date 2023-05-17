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
import semver from 'semver';
import {Connector, IpAddressTypes} from '@google-cloud/cloud-sql-connector';

t.test(
  'open connection and run basic sqlserver commands',
  // the connector-supported versions of tedious do not support node14
  {skip: semver.lt(process.versions.node, '16.0.0')},
  async t => {
    // dynamically load tedious in order to allow for skipping node14
    const {Connection, Request} = await import('tedious');
    const connector = new Connector();
    const clientOpts = await connector.getTediousOptions({
      instanceConnectionName: String(process.env.SQLSERVER_CONNECTION_NAME),
      ipType: IpAddressTypes.PUBLIC,
    });
    const connection = new Connection({
      server: '0.0.0.0',
      authentication: {
        type: 'default',
        options: {
          userName: String(process.env.SQLSERVER_USER),
          password: String(process.env.SQLSERVER_PASS),
        },
      },
      options: {
        ...clientOpts,
        port: 9999,
        database: String(process.env.SQLSERVER_DB),
      },
    });

    await new Promise((res, rej) => {
      connection.connect(err => {
        if (err) {
          return rej(err);
        }
        res(null);
      });
    });

    type ColumnValue = import('tedious').ColumnValue;
    const res: ColumnValue[] = await new Promise((res, rej) => {
      let result: ColumnValue[];
      const req = new Request('SELECT GETUTCDATE()', err => {
        if (err) {
          throw err;
        }
      });
      req.on('error', err => {
        rej(err);
      });
      req.on('row', columns => {
        result = columns;
      });
      req.on('requestCompleted', () => {
        res(result);
      });
      connection.execSql(req);
    });

    const [{value: utcDateResult}] = res;
    t.ok(utcDateResult.getTime(), 'should have valid returned date object');

    connection.close();
    connector.close();
  }
);
