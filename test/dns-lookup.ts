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
  const {resolveTxtRecord} = t.mockRequire('../src/dns-lookup.ts', {
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
    },
  });

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
});

t.test('lookup dns with real responses', async t => {
  const {resolveTxtRecord} = t.mockRequire('../src/dns-lookup.ts', {});
  t.same(
    await resolveTxtRecord('valid-san-test.csqlconnectortest.com'),
    'cloud-sql-connector-testing:us-central1:postgres-customer-cas-test',
    'valid domain name'
  );
});
