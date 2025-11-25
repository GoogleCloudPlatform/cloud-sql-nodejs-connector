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
import {Connector, IpAddressTypes} from '@google-cloud/cloud-sql-connector';
import {Sequelize} from '@sequelize/core';

const app = express();

// set up rate limiter: maximum of five requests per minute
const RateLimit = require('express-rate-limit');
const limiter = RateLimit({
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
let connector = null;
let passwordPool = null;

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

// Function to create a database connection pool using password authentication
async function getPasswordConnection() {
  const instanceConnectionName = process.env.INSTANCE_CONNECTION_NAME;
  // Database username
  const dbUser = process.env.DB_USER;
  const dbName = process.env.DB_NAME;
  const dbPassword = process.env.DB_PASSWORD;
  const ipType = getIpType(process.env.IP_TYPE);

  // Creates a new connector object.
  if (!connector) {
    connector = new Connector();
  }

  // Get the connection options for the Cloud SQL instance.
  const clientOpts = await connector.getTediousOptions({
    instanceConnectionName,
    ipType: ipType,
  });

  // Create a new Sequelize connection pool.
  return new Sequelize({
    dialect: 'mssql',
    server: 'localhost',
    database: dbName,
    authentication: {
      type: "default",
      options: {
        userName: dbUser,
        password: dbPassword,
      }
    },
    ...clientOpts.options,
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
    await db.authenticate();
    const [results, metadata] = await db.query('SELECT 1');
    res.send(`Database connection successful (password authentication), result: ${JSON.stringify(results)}`);
  } catch (err) {
    console.error(err);
    res.status(500).send(`Error connecting to the database (password authentication): ${err.message}`);
  }
});

const port = parseInt(process.env.PORT) || 8080;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
