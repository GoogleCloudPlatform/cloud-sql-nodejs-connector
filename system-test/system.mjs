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

import t from 'tap';
import pg from 'pg';
import mysql from 'mysql2/promise';
import {Connection, Request} from 'tedious';

import {Connector, AuthTypes, IpAddressTypes} from '@google-cloud/cloud-sql-connector';

import {pgTests} from "../dist-test/mjs/pg-tests.js";
import {mysqlTests} from "../dist-test/mjs/mysql-tests.js";
import {tediousTests} from "../dist-test/mjs/tedious-tests.js";

const connectorModule = {Connector, AuthTypes, IpAddressTypes}

pgTests(t, connectorModule, pg)
mysqlTests(t, connectorModule, mysql)
tediousTests(t, connectorModule, {Connection, Request})
