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

const express = require('express');
const {Connector, IpAddressTypes} = require('@google-cloud/cloud-sql-connector');
const typeorm = require('typeorm');

const app = express();

// Connector and connection pools are initialized as null to allow for lazy instantiation.
// Lazy instantiation is a best practice for Cloud Run applications because it allows
// the application to start faster and only initialize connections when they are needed.
// This is especially important in serverless environments where applications may be
// started and stopped frequently.
let connector = null;
let passwordPool = null;
let iamPool = null;

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

  // Get the connection options for the Cloud SQL instance.
  const clientOpts = await connector.getOptions({
    instanceConnectionName,
    ipType: ipType,
    authType: 'IAM',
  });

  // Create a new TypeORM data source.
  return new typeorm.DataSource({
    type: 'mysql',
    username: dbUser,
    database: dbName,
    extra: clientOpts,
  });
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
  const clientOpts = await connector.getOptions({
    instanceConnectionName,
    ipType: ipType,
  });

  // Create a new TypeORM data source.
  return new typeorm.DataSource({
    type: 'mysql',
    username: dbUser,
    password: dbPassword,
    database: dbName,
    extra: clientOpts,
  });
}

// Helper to get or create the password pool
async function getConnectionSettings() {
  if (!passwordPool) {
    passwordPool = await getPasswordConnection();
    await passwordPool.initialize();
  }
  return passwordPool;
}

// Helper to get or create the IAM pool
async function getIamConnectionSettings() {
  if (!iamPool) {
    iamPool = await getIamConnection();
    await iamPool.initialize();
  }
  return iamPool;
}

app.get('/', async (req, res) => {
  try {
    const db = await getConnectionSettings();
    const result = await db.query('SELECT 1');
    res.send(`Database connection successful (password authentication), result: ${JSON.stringify(result)}`);
  } catch (err) {
    console.error(err);
    res.status(500).send(`Error connecting to the database (password authentication): ${err.message}`);
  }
});

app.get('/iam', async (req, res) => {
  try {
    const db = await getIamConnectionSettings();
    const result = await db.query('SELECT 1');
    res.send(`Database connection successful (IAM authentication), result: ${JSON.stringify(result)}`);
  } catch (err) {
    console.error(err);
    res.status(500).send(`Error connecting to the database (IAM authentication): ${err.message}`);
  }
});

const port = parseInt(process.env.PORT) || 8080;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
