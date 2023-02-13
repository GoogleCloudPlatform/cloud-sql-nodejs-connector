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
import {generateKeys} from '../src/generate-keys';

t.test('generateKeys', async t => {
  const {privateKey, publicKey} = await generateKeys();
  t.ok(
    privateKey.startsWith('-----BEGIN RSA PRIVATE KEY-----'),
    'should return a private key string'
  );
  t.ok(
    publicKey.startsWith('-----BEGIN PUBLIC KEY-----'),
    'should return a public key string'
  );
});
