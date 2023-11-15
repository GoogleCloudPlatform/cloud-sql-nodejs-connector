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

// Test adapter used to bridge test files to tap16-compatible
// APIs in order to enable running tests in node@14
// This file (and its usage in .github/tests.yml) can be safely
// removed once node14 is no longer supported
const originalJsHandler = require.extensions['.js']
require.extensions['.js'] = function(module, filename) {
  const compile = module._compile
  module._compile = function (code, filename) {
    const source = code.replace(/t\.mockRequire/g, 't.mock')
    return compile.call(module, source, filename)
  }
  originalJsHandler(module, filename)
}
