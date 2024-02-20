// Copyright 2024 Google LLC
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

const {resolve} = require('node:path');
const {Connector} = require('@google-cloud/cloud-sql-connector');
const {PrismaClient} = require('@prisma/client');

async function connect({ instanceConnectionName, user, password, database }) {
  const host = 'localhost';
  const port = 3001;
  const connector = new Connector();
  await connector.startLocalProxy({
    instanceConnectionName,
    ipType: 'PUBLIC',
    listenOptions: {
      host,
      port,
    },
  });

  const datasourceUrl =
   `sqlserver://${host}:${port};user=${user};password=${password};database=${database};encrypt=false;trustServerCertificate=true`;
  const prisma = new PrismaClient({ datasourceUrl });

  return {
    prisma,
    async close() {
      await prisma.$disconnect();
      connector.close();
    }
  };
};

module.exports = {
  connect,
};
