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

t.test('lookup dns with mock responses', async t => {
  const {resolveTxtRecord, resolveARecord, resolveCnameRecord} = t.mockRequire(
    '../src/dns-lookup.ts',
    {
      'node:dns': {
        resolveTxt: (name, callback) => {
          switch (name) {
            case 'db.example.com':
              callback(null, [['my-project:region-1:instance']]);
              return;
            case 'multiple.example.com':
              callback(null, [
                ['my-project:region-1:instance'],
                ['another-project:region-1:instance'],
              ]);
              return;
            case 'split.example.com':
              callback(null, [['my-project:', 'region-1:instance']]);
              return;
            case 'empty.example.com':
              callback(null, []);
              return;
            default:
              callback(new Error('not found'), null);
              return;
          }
        },
        resolve4: (name, callback) => {
          if (name === 'example.com') {
            callback(null, ['10.0.0.1']);
          } else if (name === 'empty.example.com') {
            callback(null, []);
          } else {
            callback(new Error('not found'));
          }
        },
        resolveCname: (name, callback) => {
          if (name === 'cname.example.com') {
            callback(null, ['target.example.com']);
          } else if (name === 'empty.example.com') {
            callback(null, []);
          } else {
            callback(new Error('not found'));
          }
        },
      },
    }
  );

  t.same(
    await resolveTxtRecord('db.example.com'),
    'my-project:region-1:instance',
    'valid domain name'
  );
  t.same(
    await resolveTxtRecord('split.example.com'),
    'my-project:region-1:instance',
    'valid domain name'
  );
  t.same(
    await resolveTxtRecord('multiple.example.com'),
    'another-project:region-1:instance',
    'valid domain name'
  );
  t.rejects(
    async () => await resolveTxtRecord('not-found.example.com'),
    {code: 'EDOMAINNAMELOOKUPERROR'},
    'should throw type error if an extra item is provided'
  );
  t.rejects(
    async () => await resolveTxtRecord('empty.example.com'),
    {code: 'EDOMAINNAMELOOKUPFAILED'},
    'should throw type error if an extra item is provided'
  );

  // resolveARecord tests
  t.same(
    await resolveARecord('example.com'),
    ['10.0.0.1'],
    'should resolve A record'
  );
  t.same(
    await resolveARecord('empty.example.com'),
    [],
    'should return empty array'
  );
  t.rejects(
    async () => await resolveARecord('not-found'),
    /not found/,
    'should reject on error'
  );

  // resolveCnameRecord tests
  t.same(
    await resolveCnameRecord('cname.example.com'),
    'target.example.com',
    'should resolve CNAME record'
  );
  t.rejects(
    async () => await resolveCnameRecord('empty.example.com'),
    {code: 'EDOMAINNAMELOOKUPFAILED'},
    'should throw type error if empty cname results returned'
  );
  t.rejects(
    async () => await resolveCnameRecord('not-found'),
    {code: 'EDOMAINNAMELOOKUPERROR'},
    'should reject on CNAME lookup error'
  );
});

t.test('lookup dns with real responses', async t => {
  const {resolveTxtRecord} = t.mockRequire('../src/dns-lookup.ts', {});
  t.same(
    await resolveTxtRecord('valid-san-test.csqlconnectortest.com'),
    'cloud-sql-connector-testing:us-central1:postgres-customer-cas-test',
    'valid domain name'
  );
});
