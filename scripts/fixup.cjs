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
const {resolve} = require('node:path');
const {readdir, readFile, writeFile} = require('node:fs/promises');

const cjsDistFolder = resolve(__dirname, '../dist/cjs');
const mjsDistFolder = resolve(__dirname, '../dist/mjs');

async function addModuleSystemTypeFile() {
  await writeFile(
    resolve(cjsDistFolder, 'package.json'),
    JSON.stringify({ type: 'commonjs' })
  );

  await writeFile(
    resolve(mjsDistFolder, 'package.json'),
    JSON.stringify({ type: 'module' })
  );
}

async function fixupImportFileExtensions() {
  const mjsFilePaths = [];

  const replaceExtension = source =>
    source.replace(/(^import.*from '\.\/.*)(';)$/gm, '$1.js$2');

  const recursiveReadDir = async path => {
    const dirResults = await readdir(mjsDistFolder, {withFileTypes: true});
    for (const entry of dirResults) {
      const path = resolve(mjsDistFolder, entry.name);
      if (entry.isDirectory()) {
        recursiveReadDir(path);
      } else if (path.endsWith('.js') || path.endsWith('.d.ts')) {
        mjsFilePaths.push(path);
      }
    }
  };
  await recursiveReadDir(mjsDistFolder);

  for (const filepath of mjsFilePaths) {
    const contents = await readFile(filepath, { encoding: 'utf8' });
    await writeFile(filepath, replaceExtension(contents));
  }
}

async function updateVersion() {
  const versionReplacementFilePaths = [
    resolve(__dirname, '../dist/cjs/sqladmin-fetcher.js'),
    resolve(__dirname, '../dist/mjs/sqladmin-fetcher.js')
  ];
  const {version} = require('../package.json');

  const replaceVersion = source =>
    source.replace(/LIBRARY_SEMVER_VERSION/gm, version);

  for (const filepath of versionReplacementFilePaths) {
    const contents = await readFile(filepath, { encoding: 'utf8' });
    await writeFile(filepath, replaceVersion(contents));
  }
}

async function main() {
  await addModuleSystemTypeFile();
  await fixupImportFileExtensions();
  await updateVersion();
}

main();
