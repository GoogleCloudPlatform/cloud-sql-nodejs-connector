#!/bin/bash

# Copyright 2023 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

set -eo pipefail

export NPM_CONFIG_PREFIX=${HOME}/.npm-global

# Start the releasetool reporter
python3 -m pip install gcp-releasetool
python3 -m releasetool publish-reporter-script > /tmp/publisher-script; source /tmp/publisher-script

cd $(dirname $0)/..

NPM_TOKEN=$(cat $KOKORO_KEYSTORE_DIR/73713_google-cloud-npm-token-1)
echo "//wombat-dressing-room.appspot.com/:_authToken=${NPM_TOKEN}" > ~/.npmrc

npm install

# First, pack this project as a tarball

TARBALL_BASENAME=$(npm pack)

# Second, publish the tarball that was just created

TARBALL="$(pwd)/$TARBALL_BASENAME"
npm publish --access=public --registry=https://wombat-dressing-room.appspot.com "$TARBALL"

# Third, clean up all package-lock.json and *.tgz from the node_modules directory
# to simplify artifact reporting.

# Kokoro collects *.tgz and package-lock.json files and stores them in Placer
# so we can generate SBOMs and attestations.
# However, we *don't* want Kokoro to collect package-lock.json and *.tgz files
# that happened to be installed with dependencies.
find node_modules -name package-lock.json -o -name "*.tgz" | xargs rm -f
