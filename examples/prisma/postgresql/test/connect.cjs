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

const {execSync} = require('node:child_process');
const {resolve} = require('node:path');
const t = require('tap');

function generatePrismaClient() {
  const schemaPath = resolve(__dirname, '../schema.prisma');

  execSync(`npx prisma generate --schema=${schemaPath}`);
}

t.test('pg prisma cjs', async t => {
  // prisma client generation should normally be part of a regular Prisma
  // setup on user end but in order to tests in many different databases
  // we run the generation step at runtime for each variation
  generatePrismaClient();

  const {connect} = require('../connect.cjs');
  const {prisma, close} = await connect({
    instanceConnectionName: process.env.POSTGRES_IAM_CONNECTION_NAME,
    user: process.env.POSTGRES_IAM_USER,
    database: process.env.POSTGRES_DB,
  });
  const [{now}] = await prisma.$queryRaw`SELECT NOW() as now`;
  t.ok(now.getTime(), 'should have valid returned date object');
  await close();
});
