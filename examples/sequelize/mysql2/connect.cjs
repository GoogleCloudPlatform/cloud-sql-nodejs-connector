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

async function connect({ instanceConnectionName, username, databaseName }) {
  const connector = new Connector();
  const clientOpts = await connector.getOptions({
    instanceConnectionName,
    ipType: 'PUBLIC',
    authType: 'IAM',
  });

  const database = new Sequelize({
    dialect: 'mysql',
    username,
    database: databaseName,
    dialectOptions: {
      ...clientOpts,
    },
  });

  await database.authenticate();

  return {
    database,
    async close() {
      await database.close();
      connector.close();
    }
  };
};

module.exports = {
  connect,
};
