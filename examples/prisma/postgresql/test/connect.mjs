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

import { spawnSync} from 'node:child_process';
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import t from 'tap';

const __dirname = dirname(fileURLToPath(import.meta.url));

function generatePrismaClient() {
    const schemaPath = resolve(__dirname, '../schema.prisma');
    const prismaPath = resolve(
        __dirname,
        '../../../../node_modules/.bin/prisma'
    );

    spawnSync(prismaPath, ['generate', `--schema=${schemaPath}`], {
        stdio: 'inherit',
    });
}

t.test('pg prisma mjs', async t => {
    // prisma client generation should normally be part of a regular Prisma
    // setup on user end but in order to tests in many different databases
    // we run the generation step at runtime for each variation
    generatePrismaClient();

    const { connect } = await import('../connect.mjs');
    const { prisma, close } = await connect({
        instanceConnectionName: process.env.POSTGRES_CONNECTION_NAME,
        user: process.env.POSTGRES_IAM_USER,
        database: process.env.POSTGRES_DB,
    });
    const [{ now }] = await prisma.$queryRaw`SELECT NOW() as now`
    t.ok(now.getTime(), 'should have valid returned date object');
    await close();
});