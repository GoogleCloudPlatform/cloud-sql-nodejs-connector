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
import {Sequelize} from '@sequelize/core';

const main = async () => {
  const connector = new Connector();
  const clientOpts = await connector.getOptions({
    instanceConnectionName: 'my-project:region:my-instance',
    ipType: 'PUBLIC',
    authType: 'IAM',
  });

  const database = new Sequelize({
    dialect: 'postgres',
    username: 'my-service-account',
    database: 'my-database',
    dialectOptions: {
      ...clientOpts,
    },
  });

  await database.authenticate();
  console.log('Successfully connected to database.');

  await database.close();
  connector.close();
};

main();
