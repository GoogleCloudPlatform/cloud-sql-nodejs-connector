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

import {resolve} from 'node:path';
import {
  AuthTypes,
  Connector,
  IpAddressTypes,
} from '@google-cloud/cloud-sql-connector';
import {PrismaClient} from '@prisma/client';

export async function connect({instanceConnectionName, user, database}) {
  const path = resolve('.s.PGSQL.5432'); // postgres-required socket filename
  const connector = new Connector();
  await connector.startLocalProxy({
    instanceConnectionName,
    ipType: IpAddressTypes.PUBLIC,
    authType: AuthTypes.IAM,
    listenOptions: {path},
  });

  // note that the host parameter needs to point to the parent folder of
  // the socket provided in the `path` Connector option, in this example
  // that is going to be the current working directory
  const datasourceUrl = `postgresql://${user}@localhost/${database}?host=${process.cwd()}`;
  const prisma = new PrismaClient({datasourceUrl});

  // Return PrismaClient and close() function. Call close() when you are
  // done using the PrismaClient to ensure client gracefully disconnects and
  // local Unix socket file created by the Connector is deleted.
  return {
    prisma,
    async close() {
      await prisma.$disconnect();
      connector.close();
    },
  };
}
