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

import {createServer} from 'node:https';
import {CA_CERT, SERVER_CERT, SERVER_KEY} from './certs';

export async function setupTLSServer(
  t: Tap.Test,
  port?: number
): Promise<void> {
  const server = createServer(
    {
      ca: CA_CERT,
      key: SERVER_KEY,
      cert: SERVER_CERT,
      minVersion: 'TLSv1.3',
    },
    (req, res) => {
      res.writeHead(200);
      res.end('ok');
    }
  );
  await new Promise((res): void => {
    server.listen(port || 3307, () => {
      res(null);
    });
  });
  t.teardown(() => {
    server.close();
  });
}
