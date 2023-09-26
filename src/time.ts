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

const ONE_HOUR = 3600000;
const FOUR_MINUTES = 240000;
const MAX_INTERVAL = 2147483647;

export function getRefreshInterval(isoTime: string): number {
  const expiration = Date.parse(isoTime);
  const now = Date.now();
  const duration = expiration - now;

  let interval = duration / 2;

  if (duration < ONE_HOUR) {
    if (duration < FOUR_MINUTES) {
      interval = 0;
    } else {
      interval = duration - FOUR_MINUTES;
    }
  }

  return interval < MAX_INTERVAL ? interval : MAX_INTERVAL;
}

export function getNearestExpiration(
  certExp: number,
  tokenExp: number | null | undefined
) {
  if (tokenExp) {
    return new Date(Math.min(certExp, tokenExp)).toISOString();
  }
  return new Date(certExp).toISOString();
}

export function isExpirationTimeValid(isoTime: string): boolean {
  const expirationTime = Date.parse(isoTime);
  return Date.now() < expirationTime;
}
