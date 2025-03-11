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
import {
  parseInstanceConnectionName,
  isValidDomainName,
  isInstanceConnectionName,
  isSameInstance,
} from '../src/parse-instance-connection-name';

import {CloudSQLConnectorError} from '../src/errors';

t.test('parseInstanceConnectionname', async t => {
  t.throws(
    () => parseInstanceConnectionName(undefined),
    {code: 'ENOCONNECTIONNAME'},
    'should throw type error if no instance connection name provided'
  );

  t.throws(
    () => parseInstanceConnectionName(''),
    {code: 'ENOCONNECTIONNAME'},
    'should throw type error if empty instance connection name provided'
  );

  t.throws(
    () => parseInstanceConnectionName('my-project:my-instance'),
    {
      code: 'EBADCONNECTIONNAME',
    },
    'should throw type error if malformed instance connection name provided'
  );

  t.throws(
    () => parseInstanceConnectionName(':region-1:my-instance'),
    {code: 'EBADCONNECTIONNAME'},
    'should throw type error if missing project id'
  );

  t.throws(
    () => parseInstanceConnectionName('my-project::my-instance'),
    {code: 'EBADCONNECTIONNAME'},
    'should throw type error if missing region id'
  );

  t.throws(
    () => parseInstanceConnectionName('my-project:region-1:'),
    {code: 'EBADCONNECTIONNAME'},
    'should throw type error if missing instance id'
  );

  t.throws(
    () =>
      parseInstanceConnectionName(
        'google.com:PROJECT:region-02:my-instance:extra-item'
      ),
    {code: 'EBADCONNECTIONNAME'},
    'should throw type error if an extra item is provided'
  );

  t.same(
    parseInstanceConnectionName('my-project:region-1:my-instance'),
    {
      projectId: 'my-project',
      regionId: 'region-1',
      instanceId: 'my-instance',
      domainName: undefined,
    },
    'should be able to parse standard data'
  );

  t.same(
    parseInstanceConnectionName('google.com:PROJECT:region-02:my-instance'),
    {
      projectId: 'google.com:PROJECT',
      regionId: 'region-02',
      instanceId: 'my-instance',
      domainName: undefined,
    },
    'should support legacy domain scoped project id'
  );
});

t.test('isValidDomainName', async t => {
  const tcs = [
    {
      domain: 'prod-db.mycompany.example.com',
      want: true,
    },
    {
      domain: 'example.com.', // trailing dot
      want: true,
    },
    {
      domain: '-example.com', // leading hyphen
      want: false,
    },
    {
      domain: 'example', // missing TLD
      want: false,
    },
    {
      domain: '127.0.0.1', // IPv4 address
      want: false,
    },
    {
      domain: '0:0:0:0:0:0:0:1', // IPv6 address
      want: false,
    },
  ];
  for (const tc of tcs) {
    t.same(
      isValidDomainName(tc.domain),
      tc.want,
      'validate domain ' + tc.domain
    );
  }
});

t.test('isInstanceConnectionName', async t => {
  t.same(
    isInstanceConnectionName('my-project:region-1:my-instance'),
    true,
    'invalid domain name'
  );

  t.same(
    isInstanceConnectionName('project.example.com'),
    false,
    'should validate domain name'
  );
});

t.test('resolveDomainName Mock DNS', async t => {
  // mocks crypto module so that it can return a deterministic result
  // and set a standard, fast static value for cert refresh interval
  const {resolveDomainName} = t.mockRequire(
    '../src/parse-instance-connection-name',
    {
      '../src/dns-lookup': {
        resolveTxtRecord: async name => {
          switch (name) {
            case 'db.example.com':
              return 'my-project:region-1:my-instance';
            case 'bad.example.com':
              return 'bad-instance-name';
            default:
              throw new CloudSQLConnectorError({
                code: 'EDOMAINNAMELOOKUPERROR',
                message: 'Error looking up TXT record for domain ' + name,
              });
          }
        },
      },
    }
  );

  t.same(
    await resolveDomainName('db.example.com'),
    {
      projectId: 'my-project',
      regionId: 'region-1',
      instanceId: 'my-instance',
      domainName: 'db.example.com',
    },
    'should validate domain name'
  );

  await t.rejects(
    async () => await resolveDomainName('bad.example.com'),
    {code: 'EBADDOMAINCONNECTIONNAME'},
    'should throw type error if an extra item is provided'
  );

  await t.rejects(
    async () => await resolveDomainName('no-record.example.com'),
    {code: 'EDOMAINNAMELOOKUPERROR'},
    'should throw type error if an extra item is provided'
  );
});

t.test('resolveInstanceName Mock DNS', async t => {
  // mocks crypto module so that it can return a deterministic result
  // and set a standard, fast static value for cert refresh interval
  const {resolveInstanceName} = t.mockRequire(
    '../src/parse-instance-connection-name',
    {
      '../src/dns-lookup': {
        resolveTxtRecord: async name => {
          switch (name) {
            case 'db.example.com':
              return 'my-project:region-1:my-instance';
            case 'bad.example.com':
              return 'bad-instance-name';
            default:
              throw new CloudSQLConnectorError({
                code: 'EDOMAINNAMELOOKUPERROR',
                message: 'Error looking up TXT record for domain ' + name,
              });
          }
        },
      },
    }
  );

  t.same(
    await resolveInstanceName(undefined, 'db.example.com'),
    {
      projectId: 'my-project',
      regionId: 'region-1',
      instanceId: 'my-instance',
      domainName: 'db.example.com',
    },
    'should use domain name'
  );

  t.same(
    await resolveInstanceName('my-project:region-1:my-instance'),
    {
      projectId: 'my-project',
      regionId: 'region-1',
      instanceId: 'my-instance',
      domainName: undefined,
    },
    'should use instance name'
  );

  await t.rejects(
    resolveInstanceName(undefined, 'bad.example.com'),
    {code: 'EBADDOMAINCONNECTIONNAME'},
    'should throw type error if an extra item is provided'
  );

  await t.rejects(
    resolveInstanceName(undefined, 'no-record.example.com'),
    {code: 'EDOMAINNAMELOOKUPERROR'},
    'should throw type error if an extra item is provided'
  );

  await t.rejects(
    resolveInstanceName(undefined, ''),
    {code: 'ENOCONNECTIONNAME'},
    'should throw type error if the connection name is empty'
  );

  await t.rejects(
    resolveInstanceName(undefined, 'bad-name'),
    {code: 'EBADCONNECTIONNAME'},
    'should throw type error if the connection name is empty'
  );
});

t.test('isSameInstance', async t => {
  const tcs = [
    {
      a: {
        instanceId: 'inst',
        regionId: 'region1',
        projectId: 'project1',
        domainName: 'db1.example.com',
      },
      b: {
        instanceId: 'inst',
        regionId: 'region1',
        projectId: 'project1',
        domainName: 'db1.example.com',
      },
      want: true,
    },
    {
      a: {
        instanceId: 'inst',
        regionId: 'region1',
        projectId: 'project1',
      },
      b: {
        instanceId: 'inst',
        regionId: 'region1',
        projectId: 'project1',
      },
      want: true,
    },
    {
      a: {
        instanceId: 'inst',
        regionId: 'region1',
        projectId: 'project1',
      },
      b: {
        instanceId: 'inst2',
        regionId: 'region1',
        projectId: 'project1',
      },
      want: false,
    },
    {
      a: {
        instanceId: 'inst',
        regionId: 'region1',
        projectId: 'project1',
      },
      b: {
        instanceId: 'inst',
        regionId: 'region2',
        projectId: 'project1',
      },
      want: false,
    },
    {
      a: {
        instanceId: 'inst',
        regionId: 'region1',
        projectId: 'project1',
      },
      b: {
        instanceId: 'inst',
        regionId: 'region1',
        projectId: 'project2',
      },
      want: false,
    },
    {
      a: {
        instanceId: 'inst',
        regionId: 'region1',
        projectId: 'project1',
        domainName: 'db1.example.com',
      },
      b: {
        instanceId: 'inst',
        regionId: 'region1',
        projectId: 'project1',
      },
      want: false,
    },
    {
      a: {
        instanceId: 'inst',
        regionId: 'region1',
        projectId: 'project1',
        domainName: 'db1.example.com',
      },
      b: {
        instanceId: 'inst',
        regionId: 'region1',
        projectId: 'project1',
        domainName: 'db2.example.com',
      },
      want: false,
    },
  ];
  for (const tc of tcs) {
    t.same(
      isSameInstance(tc.a, tc.b),
      tc.want,
      'is same instance ' + JSON.stringify(tc.a) + ' == ' + JSON.stringify(tc.b)
    );
  }
});
