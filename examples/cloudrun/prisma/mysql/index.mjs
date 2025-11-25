// Copyright 2025 Google LLC
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

import express from 'express';
import {resolve} from 'node:path';
import {Connector, IpAddressTypes} from '@google-cloud/cloud-sql-connector';
import {PrismaClient} from '@prisma/client';

const app = express();

// Connector and connection pools are initialized as null to allow for lazy instantiation.
// Lazy instantiation is a best practice for Cloud Run applications because it allows
// the application to start faster and only initialize connections when they are needed.
// This is especially important in serverless environments where applications may be
// started and stopped frequently.
let connector = null;
let passwordClient = null;
let iamClient = null;
let passwordCleanup = null;
let iamCleanup = null;

// Helper to get the IP type enum from string
function getIpType(ipTypeStr) {
  const ipType = ipTypeStr || 'PUBLIC';
  if (ipType === 'PRIVATE') {
    return IpAddressTypes.PRIVATE;
  } else if (ipType === 'PSC') {
    return IpAddressTypes.PSC;
  } else {
    return IpAddressTypes.PUBLIC;
  }
}

// Function to create a database connection pool using IAM authentication
async function getIamConnection() {
  const instanceConnectionName = process.env.INSTANCE_CONNECTION_NAME;
  // IAM service account email
  const dbUser = process.env.DB_IAM_USER;
  const dbName = process.env.DB_NAME;
  const ipType = getIpType(process.env.IP_TYPE);

  // Creates a new connector object.
  if (!connector) {
    connector = new Connector();
  }

  // Creates a randomly named unix socket path for the local proxy.
  const path = resolve('/tmp', `mysql-iam-${Date.now()}.socket`);

  // The startLocalProxy method starts a local proxy that listens on the
  // specified unix socket path. This allows the application to connect to
  // the database using a standard database driver.
  await connector.startLocalProxy({
    instanceConnectionName,
    ipType: ipType,
    authType: 'IAM',
    listenOptions: {path},
  });

  // URL encode the user for IAM service accounts
  const datasourceUrl = `mysql://${encodeURIComponent(dbUser)}@localhost/${dbName}?socket=${path}`;
  const prisma = new PrismaClient({datasourceUrl});

  // Returns the prisma client and a cleanup function to close the connection.
  return {
    prisma,
    async close() {
      await prisma.$disconnect();
    },
  };
}

// Function to create a database connection pool using password authentication
async function getPasswordConnection() {
  const instanceConnectionName = process.env.INSTANCE_CONNECTION_NAME;
  // Database username
  const dbUser = process.env.DB_USER;
  const dbName = process.env.DB_NAME;
  const dbPassword = process.env.DB_PASSWORD;
  const ipType = getIpType(process.env.IP_TYPE);

  if (!connector) {
    connector = new Connector();
  }

  // Creates a randomly named unix socket path for the local proxy.
  const path = resolve('/tmp', `mysql-pw-${Date.now()}.socket`);

  // The startLocalProxy method starts a local proxy that listens on the
  // specified unix socket path. This allows the application to connect to
  // the database using a standard database driver.
  await connector.startLocalProxy({
    instanceConnectionName,
    ipType: ipType,
    listenOptions: {path},
  });

  // The datasourceUrl is the connection string for the database. It is
  // constructed using the database user, password, and the unix socket path.
  const datasourceUrl = `mysql://${dbUser}:${dbPassword}@localhost/${dbName}?socket=${path}`;
  const prisma = new PrismaClient({datasourceUrl});

  // Returns the prisma client and a cleanup function to close the connection.
  return {
    prisma,
    async close() {
      await prisma.$disconnect();
    },
  };
}

// Helper to get or create the password pool
async function getConnectionSettings() {
  if (!passwordClient) {
    const { prisma, close } = await getPasswordConnection();
    passwordClient = prisma;
    passwordCleanup = close;
  }
  return passwordClient;
}

// Helper to get or create the IAM pool
async function getIamConnectionSettings() {
  if (!iamClient) {
    const { prisma, close } = await getIamConnection();
    iamClient = prisma;
    iamCleanup = close;
  }
  return iamClient;
}

app.get('/', async (req, res) => {
  try {
    const prisma = await getConnectionSettings();
    const result = await prisma.$queryRaw`SELECT 1`;
    const serialized = JSON.stringify(result, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
    );
    res.send(`Database connection successful (password authentication), result: ${serialized}`);
  } catch (err) {
    console.error(err);
    res.status(500).send(`Error connecting to the database (password authentication): ${err.message}`);
  }
});

app.get('/iam', async (req, res) => {
  try {
    const prisma = await getIamConnectionSettings();
    const result = await prisma.$queryRaw`SELECT 1`;
    const serialized = JSON.stringify(result, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
    );
    res.send(`Database connection successful (IAM authentication), result: ${serialized}`);
  } catch (err) {
    console.error(err);
    res.status(500).send(`Error connecting to the database (IAM authentication): ${err.message}`);
  }
});

const port = parseInt(process.env.PORT) || 8080;
const server = app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(async () => {
    console.log('HTTP server closed');
    if (passwordCleanup) await passwordCleanup();
    if (iamCleanup) await iamCleanup();
    if (connector) connector.close();
  });
});
