// Copyright 2023 Google LLC
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
import {getRefreshInterval} from '../src/time';

const datenow = Date.now;
Date.now = () => 1672567200000; // 2023-01-01T10:00:00.000Z

// expired cert
t.same(
  getRefreshInterval('2023-01-01T09:00:00.000Z'),
  0,
  'should return zero interval on expired cert'
);

// cert matches current time
t.same(
  getRefreshInterval('2023-01-01T00:00:00.000Z'),
  0,
  'should return zero interval on exact same time cert'
);

// extremely long-lived cert (10years)
t.same(
  getRefreshInterval('2033-01-01T10:00:00.000Z'),
  2147483647,
  'should return max 32-bit timeout interval to avoid overflow'
);

// short-lived cert (less than 4min)
t.same(
  getRefreshInterval('2023-01-01T10:03:59.000Z'),
  0,
  'should return zero interval on less than 4min cert'
);

// short-lived cert (less than 1min)
t.same(
  getRefreshInterval('2023-01-01T10:00:59.000Z'),
  0,
  'should return zero interval on less than 1min cert'
);

// less than 1h cert expiration
t.same(
  getRefreshInterval('2023-01-01T10:59:59.000Z'),
  3359000,
  'should return duration minus 4min on less than 1h cert'
);

// exactly 1h cert expiration
t.same(
  getRefreshInterval('2023-01-01T11:00:00.000Z'),
  1800000,
  'should return 30min interval on 1h cert'
);

// just over 1h cert expiration
t.same(
  getRefreshInterval('2023-01-01T11:01:00.000Z'),
  1830000,
  'should return 30.5min interval on 1h01 cert'
);

// 2h cert expiration
t.same(
  getRefreshInterval('2023-01-01T12:00:00.000Z'),
  3600000,
  'should return 1h interval on 2h cert'
);

// 4h cert expiration
t.same(
  getRefreshInterval('2023-01-01T14:00:00.000Z'),
  7200000,
  'should return 2h interval on 4h cert'
);

// 8h cert expiration
t.same(
  getRefreshInterval('2023-01-01T18:00:00.000Z'),
  14400000,
  'should return 4h interval on 8h cert'
);

Date.now = datenow;
