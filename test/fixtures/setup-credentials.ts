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

import {resolve} from 'node:path';
import nock from 'nock';

export function setupCredentials(test: Tap.Test): void {
  const path = test.testdir({
    credentials: JSON.stringify({
      client_secret: 'privatekey',
      client_id: 'client123',
      refresh_token: 'refreshtoken',
      type: 'authorized_user',
    }),
  });
  const creds = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  process.env.GOOGLE_APPLICATION_CREDENTIALS = resolve(path, 'credentials');
  test.teardown(() => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = creds;
  });

  nock('https://oauth2.googleapis.com')
    .persist()
    .post('/token')
    .reply(200, {access_token: 'abc123', expires_in: 1});

  nock('https://oauth2.googleapis.com').post('/tokeninfo').reply(200, {
    expires_in: 3600,
    scope: 'https://www.googleapis.com/auth/sqlservice.login',
  });
}
