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
  parseInstanceDNSName,
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
  const {resolveDomainName} = t.mockRequire(
    '../src/parse-instance-connection-name',
    {
      '../src/dns-lookup': {
        resolveTxtRecord: async name => {
          switch (name) {
            case 'db.example.com':
              return ['my-project:region-1:my-instance'];
            case 'bad.example.com':
              return ['bad-instance-name'];
            default:
              throw new CloudSQLConnectorError({
                code: 'EDOMAINNAMELOOKUPERROR',
                message: 'Error looking up TXT record for domain ' + name,
              });
          }
        },
        resolveCnameRecord: async name => {
          throw new Error('CNAME not found for ' + name);
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
    {code: 'EDOMAINNAMELOOKUPFAILED'},
    'should throw error if TXT is invalid and CNAME fails'
  );

  await t.rejects(
    async () => await resolveDomainName('no-record.example.com'),
    {code: 'EDOMAINNAMELOOKUPFAILED'},
    'should throw error if TXT fails and CNAME fails'
  );
});

t.test('resolveInstanceName Mock DNS', async t => {
  const {resolveInstanceName} = t.mockRequire(
    '../src/parse-instance-connection-name',
    {
      '../src/dns-lookup': {
        resolveTxtRecord: async name => {
          switch (name) {
            case 'db.example.com':
              return ['my-project:region-1:my-instance'];
            case 'bad.example.com':
              return ['bad-instance-name'];
            default:
              throw new CloudSQLConnectorError({
                code: 'EDOMAINNAMELOOKUPERROR',
                message: 'Error looking up TXT record for domain ' + name,
              });
          }
        },
        resolveCnameRecord: async name => {
          throw new Error('CNAME not found for ' + name);
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
    await resolveInstanceName('db.example.com'),
    {
      projectId: 'my-project',
      regionId: 'region-1',
      instanceId: 'my-instance',
      domainName: 'db.example.com',
    },
    'should use domain name passed as instanceConnectionName'
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
    {code: 'EDOMAINNAMELOOKUPFAILED'},
    'should throw error if TXT is invalid and CNAME fails'
  );

  await t.rejects(
    resolveInstanceName(undefined, 'no-record.example.com'),
    {code: 'EDOMAINNAMELOOKUPFAILED'},
    'should throw error if TXT fails and CNAME fails'
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

t.test('parseInstanceDNSName', async t => {
  const tcs = [
    {
      dns: '0123456789ab.fedcba9876543.us-central1.sql-psc.goog',
      want: {
        instanceLabel: '0123456789ab',
        projectLabel: 'fedcba9876543',
        region: 'us-central1',
        suffix: 'sql-psc.goog',
        ok: true,
      },
    },
    {
      dns: '0123456789ab.fedcba9876543.us-central1.sql-psc.goog.',
      want: {
        instanceLabel: '0123456789ab',
        projectLabel: 'fedcba9876543',
        region: 'us-central1',
        suffix: 'sql-psc.goog',
        ok: true,
      },
    },
    {
      dns: 'not-hex-label.fedcba9876543.us-central1.sql-psc.goog',
      want: {
        instanceLabel: 'not-hex-label',
        projectLabel: 'fedcba9876543',
        region: 'us-central1',
        suffix: 'sql-psc.goog',
        ok: true,
      },
    },
    {
      dns: 'abc.def.uscentral.sql-psc.goog',
      want: {
        instanceLabel: 'abc',
        projectLabel: 'def',
        region: 'uscentral',
        suffix: 'sql-psc.goog',
        ok: true,
      },
    },
    {
      dns: '0123456789ab.fedcba9876543.global.sql-psc.goog',
      want: {
        instanceLabel: '',
        projectLabel: '',
        region: '',
        suffix: '',
        ok: false,
      },
    },
    {
      dns: '0123456789ab.fedcba9876543.us-central1.invalid-suffix.goog',
      want: {
        instanceLabel: '',
        projectLabel: '',
        region: '',
        suffix: '',
        ok: false,
      },
    },
    {
      dns: '-starts-with-hyphen.proj.region.sql.goog',
      want: {
        instanceLabel: '',
        projectLabel: '',
        region: '',
        suffix: '',
        ok: false,
      },
    },
    {
      dns: 'ends-with-hyphen-.proj.region.sql.goog',
      want: {
        instanceLabel: '',
        projectLabel: '',
        region: '',
        suffix: '',
        ok: false,
      },
    },
    {
      dns: 'empty..region.sql.goog',
      want: {
        instanceLabel: '',
        projectLabel: '',
        region: '',
        suffix: '',
        ok: false,
      },
    },
  ];
  for (const tc of tcs) {
    t.same(parseInstanceDNSName(tc.dns), tc.want, 'parse DNS: ' + tc.dns);
  }
});

t.test('resolveDomainName with PSC DNS and CNAME', async t => {
  const {resolveDomainName} = t.mockRequire(
    '../src/parse-instance-connection-name',
    {
      '../src/dns-lookup': {
        resolveTxtRecord: async (name: string) => {
          switch (name) {
            case 'txt-direct.example.com':
              return ['my-project:region-1:my-instance'];
            case 'global.sql-psc.goog':
              throw new Error('TXT not found');
            case 'cname-to-txt.example.com':
              throw new Error('TXT not found');
            default:
              throw new Error('TXT not found');
          }
        },
        resolveCnameRecord: async (name: string) => {
          switch (name) {
            case 'cname-to-txt.example.com':
              return 'txt-direct.example.com';
            case 'cname-to-psc.example.com':
              return '0123456789ab.fedcba9876543.us-central1.sql-psc.goog';
            case 'cname-loop.example.com':
              return 'cname-loop.example.com';
            case 'cname-loop-1.example.com':
              return 'cname-loop-2.example.com';
            case 'cname-loop-2.example.com':
              return 'cname-loop-1.example.com';
            default:
              throw new Error('CNAME not found');
          }
        },
      },
    }
  );

  const mockFetcher = {
    resolveConnectSettings: async (region: string, dnsName: string) => {
      t.equal(region, 'us-central1');
      t.equal(dnsName, '0123456789ab.fedcba9876543.us-central1.sql-psc.goog');
      return 'my-project:us-central1:my-instance';
    },
  };

  const info1 = await resolveDomainName(
    '0123456789ab.fedcba9876543.us-central1.sql-psc.goog',
    mockFetcher
  );
  t.same(info1, {
    projectId: 'my-project',
    regionId: 'us-central1',
    instanceId: 'my-instance',
    domainName: '0123456789ab.fedcba9876543.us-central1.sql-psc.goog',
  });

  await t.rejects(
    resolveDomainName('0123456789ab.fedcba9876543.us-central1.sql-psc.goog'),
    {code: 'EDNSRESOLVERNOTINITIALIZED'}
  );

  const info2 = await resolveDomainName('txt-direct.example.com', mockFetcher);
  t.same(info2, {
    projectId: 'my-project',
    regionId: 'region-1',
    instanceId: 'my-instance',
    domainName: 'txt-direct.example.com',
  });

  const info3 = await resolveDomainName(
    'cname-to-txt.example.com',
    mockFetcher
  );
  t.same(info3, {
    projectId: 'my-project',
    regionId: 'region-1',
    instanceId: 'my-instance',
    domainName: 'cname-to-txt.example.com',
  });

  const info4 = await resolveDomainName(
    'cname-to-psc.example.com',
    mockFetcher
  );
  t.same(info4, {
    projectId: 'my-project',
    regionId: 'us-central1',
    instanceId: 'my-instance',
    domainName: 'cname-to-psc.example.com',
  });

  await t.rejects(resolveDomainName('cname-loop.example.com', mockFetcher), {
    code: 'EDOMAINNAMELOOKUPFAILED',
    message: /CNAME record loop detected or record not found/,
  });

  await t.rejects(resolveDomainName('cname-loop-1.example.com', mockFetcher), {
    code: 'ECNAMELOOPLIMITEXCEEDED',
    message: /CNAME lookup limit exceeded/,
  });
});
