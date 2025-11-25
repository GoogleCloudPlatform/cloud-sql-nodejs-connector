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
import {
  AuthTypes,
  Connector,
  IpAddressTypes,
} from '@google-cloud/cloud-sql-connector';
import knex, {Knex} from 'knex';

const app = express();

// set up rate limiter: maximum of five requests per minute
var RateLimit = require('express-rate-limit');
var limiter = RateLimit({
  // 15 minutes
  windowMs: 15 * 60 * 1000,
  // max 100 requests per windowMs
  max: 100,
});

// apply rate limiter to all requests
app.use(limiter);

// Connector and connection pools are initialized as null to allow for lazy instantiation.
// Lazy instantiation is a best practice for Cloud Run applications because it allows
// the application to start faster and only initialize connections when they are needed.
// This is especially important in serverless environments where applications may be
// started and stopped frequently.
let connector: Connector | null = null;
let passwordPool: Knex | null = null;

// Helper to get the IP type enum from string
function getIpType(ipTypeStr: string | undefined) {
  const ipType = ipTypeStr || 'PUBLIC';
  if (ipType === 'PRIVATE') {
    return IpAddressTypes.PRIVATE;
  } else if (ipType === 'PSC') {
    return IpAddressTypes.PSC;
  } else {
    return IpAddressTypes.PUBLIC;
  }
}

// Function to create a database connection pool using password authentication
async function getPasswordConnection() {
  const instanceConnectionName = process.env.INSTANCE_CONNECTION_NAME || '';
  // Database username
  const dbUser = process.env.DB_USER || '';
  const dbName = process.env.DB_NAME || '';
  const dbPassword = process.env.DB_PASSWORD || '';
  const ipType = getIpType(process.env.IP_TYPE);

  if (!connector) {
    connector = new Connector();
  }

  // Get the connection options for the Cloud SQL instance.
  const clientOpts = await connector.getTediousOptions({
    instanceConnectionName,
    ipType: ipType,
    authType: AuthTypes.PASSWORD,
  });

  // Create a new knex connection pool.
  return knex({
    client: 'mssql',
    connection: {
      server: '127.0.0.1', // address doesn't matter, connector hijacks it
      user: dbUser,
      password: dbPassword,
      database: dbName,
      options: {
        ...clientOpts,
        // tedious driver-specific connector options
        encrypt: true,
        trustServerCertificate: true,
      },
    },
    // Set min/max pool size, and other pool options
    pool: {min: 1, max: 5},
  });
}

// Helper to get or create the password pool
async function getConnectionSettings() {
  if (!passwordPool) {
    passwordPool = await getPasswordConnection();
  }
  return passwordPool;
}

app.get('/', async (req, res) => {
  try {
    const db = await getConnectionSettings();
    const result = await db.raw('SELECT 1');
    res.send(
      'Database connection successful (password authentication), result: ' +
        `${JSON.stringify(result)}`
    );
  } catch (err: unknown) {
    console.error(err);
    res
      .status(500)
      .send(
        'Error connecting to the database (password authentication): ' +
          `${(err as Error).message}`
      );
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
