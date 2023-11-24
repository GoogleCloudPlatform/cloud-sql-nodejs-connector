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

import {Connector} from '@google-cloud/cloud-sql-connector';
import knex from 'knex';

export async function connect({ instanceConnectionName, user, password, databaseName }) {
  const connector = new Connector();
  const clientOpts = await connector.getTediousOptions({
    instanceConnectionName,
    ipType: 'PUBLIC',
    authType: 'PASSWORD',
  });

  const database = knex({
    client: 'mssql',
    connection: {
      // `server` property is not used when connector is provided, but it is a required property
      // due to a bug in the tedious driver (ref: https://github.com/tediousjs/tedious/issues/1541).
      // There is a pending fix (ref: https://github.com/tediousjs/tedious/pull/1542), but until
      // it is released, we need to provide a dummy value.
      server: '0.0.0.0',
      user,
      password,
      database: databaseName,
      options: {
        ...clientOpts,
      },
    },
  });

  return {
    database,
    async close() {
      await database.destroy();
      connector.close();
    }
  };
};
