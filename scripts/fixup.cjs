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

// This script adds the expected module system type info to
// a package.json file defining each of the module targets.
// Ref: https://nodejs.org/dist/latest-v18.x/docs/api/packages.html#determining-module-system
const {resolve} = require('node:path')
const {writeFile} = require('node:fs/promises')

async function main() {
  await writeFile(
    resolve(__dirname, '../dist/cjs/package.json'),
    JSON.stringify({ type: 'commonjs' })
  )

  await writeFile(
    resolve(__dirname, '../dist/mjs/package.json'),
    JSON.stringify({ type: 'module' })
  )
}

main()
