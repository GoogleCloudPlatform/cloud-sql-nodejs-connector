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

const {Connector} = require('@google-cloud/cloud-sql-connector');
const {Sequelize} = require('@sequelize/core');

const main = async () => {
  const connector = new Connector();
  const clientOpts = await connector.getTediousOptions({
    instanceConnectionName: 'my-project:region:my-instance',
    ipType: 'PUBLIC',
    authType: 'PASSWORD',
  });

  const database = new Sequelize({
    dialect: 'mssql',
    username: 'my-user',
    password: 'my-password',
    database: 'my-database',
    dialectOptions: {
      options: {
        ...clientOpts,
      },
    },
  });

  await database.authenticate();
  console.log('Successfully connected to database.');

  await database.close();
  connector.close();
};

main();
