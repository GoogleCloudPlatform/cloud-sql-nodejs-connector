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
import {DataSource} from 'typeorm';

const app = express();

// Connector and connection pools are initialized as null to allow for lazy instantiation.
// Lazy instantiation is a best practice for Cloud Run applications because it allows
// the application to start faster and only initialize connections when they are needed.
// This is especially important in serverless environments where applications may be
// started and stopped frequently.
let connector: Connector | null = null;
let passwordPool: DataSource | null = null;

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

  // Creates a new connector object.
  if (!connector) {
    connector = new Connector();
  }

  // Get the connection options for the Cloud SQL instance.
  const clientOpts = await connector.getTediousOptions({
    instanceConnectionName,
    ipType: ipType,
  });

  // Create a new TypeORM data source.
  return new DataSource({
    type: 'mssql',
    username: dbUser,
    password: dbPassword,
    database: dbName,
    extra: {
      server: '127.0.0.1', // address doesn't matter, connector hijacks it
      options: {
        ...clientOpts,
        port: 1433,
      },
    },
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

app.get('/', async (req, res) => {
  try {
    const db = await getConnectionSettings();
    const result = await db.query('SELECT 1');
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

const port = parseInt(process.env.PORT || '8080');
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

process.on('SIGTERM', async () => {
  if (passwordPool) {
    await passwordPool.destroy();
  }
  if (connector) {
    connector.close();
  }
});
