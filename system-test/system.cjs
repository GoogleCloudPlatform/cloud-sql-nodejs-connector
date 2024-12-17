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

const t = require('tap');
const pg = require('pg');
const mysql = require('mysql2/promise');
const tedious = require('tedious');

const connector = require('@google-cloud/cloud-sql-connector');
const {pgTests} = require("../dist-test/cjs/pg-tests.js");
const {mysqlTests} = require("../dist-test/cjs/mysql-tests.js");
const {tediousTests} = require("../dist-test/cjs/tedious-tests.js");

pgTests(t, connector, pg)
mysqlTests(t, connector, mysql)
tediousTests(t, connector, tedious)
