# Node.js Samples for Cloud Run

This directory contains samples demonstrating how to connect to Cloud SQL from Cloud Run using various Node.js ORMs and the [Cloud SQL Node.js Connector](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector).

## Available Samples

*   [Knex.js](./knex)
*   [Prisma](./prisma)
*   [Sequelize](./sequelize)
*   [TypeORM](./typeorm)

Each ORM directory contains subdirectories for supported databases (MySQL, PostgreSQL, SQL Server), and each example includes implementations in:
*   CommonJS (`.cjs`)
*   ES Modules (`.mjs`)
*   TypeScript (`.ts`)

## Prerequisites

1.  A Google Cloud Project with billing enabled.
2.  A Cloud SQL instance.
3.  A Cloud Run service account with the `Cloud SQL Client` IAM role.
4.  For IAM Authentication, the service account must be added as a database user.

## Deployment

Refer to the `README.md` in each ORM directory for specific deployment instructions.
