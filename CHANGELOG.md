# Changelog

## [1.5.0](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/compare/v1.4.0...v1.5.0) (2024-12-11)


### Features

* update minimum supported Node version to 18 ([#403](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/403)) ([19d99a7](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/19d99a71af311c6dd63965dff2fbe023efa6cc35))

## [1.4.0](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/compare/v1.3.4...v1.4.0) (2024-09-30)


### Features

* support Cloud SQL CAS-based instances ([#390](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/390)) ([5d2c02f](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/5d2c02fb564b029490598d17bca82eefda0f659f))


### Bug Fixes

* only add PSC ipType if PSC is enabled ([#388](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/388)) ([28905c9](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/28905c9e65de325973c48b55626cd8f37f55888c))

## [1.3.4](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/compare/v1.3.3...v1.3.4) (2024-08-02)


### Bug Fixes

* only retry 5xx Cloud SQL Admin API errors ([#375](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/375)) ([67bff82](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/67bff82f331a1fff1e22c759be6bfdcd33101f7e))

## [1.3.3](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/compare/v1.3.2...v1.3.3) (2024-07-09)


### Bug Fixes

* bump dependencies to latest versions ([#373](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/373)) ([ece7251](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/ece7251a7854217b236205a40d860a61f447f2d8))

## [1.3.2](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/compare/v1.3.1...v1.3.2) (2024-06-21)


### Bug Fixes

* allow multiple connections via `.startLocalProxy` socket ([#366](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/366)) ([cce7aad](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/cce7aad09cfcae601e40e57df9d89831b86f645b))

## [1.3.1](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/compare/v1.3.0...v1.3.1) (2024-06-11)


### Bug Fixes

* bump dependencies to latest versions ([#358](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/358)) ([d3ab6a0](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/d3ab6a0eb45cccba1177def40da58766bad7c4d4))

## [1.3.0](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/compare/v1.2.4...v1.3.0) (2024-04-30)


### Features

* add `universeDomain` option to Connector ([#331](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/331)) ([651634d](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/651634d7000ea34cc65bd651a2f4796ecbbb2579))
* add local Unix domain socket support ([#336](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/336)) ([72575ba](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/72575baeaa191f3fbce17b76002751b0e0bcce91))


### Bug Fixes

* enable IP type switching ([#338](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/338)) ([450f2f5](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/450f2f5c7733cd4dd5c6fa1be14a889e94bea2a2))

## [1.2.4](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/compare/v1.2.3...v1.2.4) (2024-03-12)


### Bug Fixes

* update dependencies to latest versions ([#314](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/314)) ([0f9d40b](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/0f9d40b5cde9e8b893d2ef5e88245f333a264c1a))

## [1.2.3](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/compare/v1.2.2...v1.2.3) (2024-02-13)


### Bug Fixes

* update dependencies to latest versions ([#300](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/300)) ([4b025f4](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/4b025f4d405092c45fedca115a20c5984b844c37))

## [1.2.2](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/compare/v1.2.1...v1.2.2) (2024-01-17)


### Miscellaneous Chores

* release 1.2.2 ([#288](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/288)) ([ea21251](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/ea212514f4696fa04c8abdce60f6c9c22862b679))

## [1.2.1](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/compare/v1.2.0...v1.2.1) (2023-12-12)


### Bug Fixes

* **SQLAdminFetcher:** Use `loginAuth` for `auth` ([#275](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/275)) ([c403d0a](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/c403d0a3d83428ff4ce2864dcc8390d02b69cbda))

## [1.2.0](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/compare/v1.1.0...v1.2.0) (2023-11-15)


### Features

* Add support to an auth config ([#238](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/238)) ([e1a50a5](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/e1a50a5e3847aeefdeeedf8af4e5e1a5c36fc809))


### Bug Fixes

* cloud-sql-instance promise chaining ([#245](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/245)) ([5fde5b3](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/5fde5b303e2b6cdd99d1c8653fbcd98853f88fba))

## [1.1.0](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/compare/v1.0.0...v1.1.0) (2023-10-10)


### Features

* support custom SQL Admin API endpoint ([#210](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/210)) ([290d741](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/290d741b00545bb801431d8711b1de4285da17d0))

## [1.0.0](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/compare/v0.5.1...v1.0.0) (2023-09-27)


### Features

* add force refresh on connection errors ([#195](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/195)) ([993d5d8](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/993d5d893454d2768d138a3edca714f4468a443d))


### Bug Fixes

* add .js ext. for mjs imports in .d.ts files ([#215](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/215)) ([a998db6](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/a998db6c740e72591738a86a27deae4f4c20af09))
* https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/134 ([8988b45](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/8988b45e2652c51700cf87435362836c15131125))
* https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/146 ([8988b45](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/8988b45e2652c51700cf87435362836c15131125))
* retry failed google-auth-library requests ([#181](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/181)) ([8988b45](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/8988b45e2652c51700cf87435362836c15131125))
* silent refresh errors on active connection ([#219](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/219)) ([41a8e79](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/41a8e799915f815d73f0b75e488c149301ed2431))


### Miscellaneous Chores

* set release version to v1.0.0 ([#221](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/221)) ([c24482c](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/c24482c1d09bd322afa267b7b220174acf0ffdd7))

## [0.5.1](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/compare/v0.5.0...v0.5.1) (2023-08-08)


### Bug Fixes

* release v0.5.1 ([#178](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/178)) ([151ff55](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/151ff553a162c85662659ebb1e9b2bafbea3ba65))

## [0.5.0](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/compare/v0.4.0...v0.5.0) (2023-07-11)


### Features

* add support to PSC ip type ([#150](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/150)) ([d3929cd](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/d3929cd2e8f6d62d7b2eeff5277d9f81f3a42eae))

## [0.4.0](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/compare/v0.3.0...v0.4.0) (2023-06-13)


### ⚠ BREAKING CHANGES

* remove returned ssl property

### Features

* add sqlserver support ([ab3dc67](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/ab3dc6768dfdf526df9b1b2bcb1307d1cfef34be))


### Bug Fixes

* auth type should be optional in typescript ([bed3424](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/bed3424e4c1b8cc185a74deedaa6f4a6531fc131))
* make ipType optional ([0f3f75e](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/0f3f75e13aeba53201044c4ebdf38e213ad1ac84))


### Code Refactoring

* remove returned ssl property ([c0c4572](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/c0c4572f8eedfad13f87d9e2841a1f951f96600a))


### Miscellaneous Chores

* release 0.4.0 ([#145](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/145)) ([9561694](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/9561694b7c1d20847e8d9b34803163e47bc33e66))

## [0.3.0](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/compare/v0.2.0...v0.3.0) (2023-05-09)


### ⚠ BREAKING CHANGES

* update `IpAdressesTypes` to `IpAddressTypes` ([#94](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/94))
* rename type to ipType ([#83](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/83))

### Features

* support automatic IAM authentication ([#78](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/78)) ([ad95065](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/ad95065b8260d81fcc7642adfcac4074e789a43e))


### Bug Fixes

* throw error when conflicting connection settings for same instance ([#84](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/84)) ([1c7b3d1](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/1c7b3d120265323ae7d1cf3ad0e45fdc709a9889))
* user-agent version number ([511ccd8](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/511ccd8ea48d830977a1fdb4584e6e4d24640164))


### Code Refactoring

* rename type to ipType ([#83](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/83)) ([fcf66fa](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/fcf66fa41ae4fefcffc490b445dd9bb14c456be5))
* update `IpAdressesTypes` to `IpAddressTypes` ([#94](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/94)) ([e38d392](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/e38d392add7fb90f76cc25915d3591af9c705ba1))


### Miscellaneous Chores

* release 0.3.0 ([#109](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/109)) ([72ccb47](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/72ccb478d9bb613f1b12d6789b6b74ae6b3c333e))

## [0.2.0](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/compare/v0.1.3...v0.2.0) (2023-04-11)


### Features

* add mysql support ([9316804](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/93168049995520bc290368b0530fd768d052db38))


### Bug Fixes

* add default keep-alive delay ([c3eb3c9](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/c3eb3c96aa2452be5d64a125080d05308fd1a27f))

## [0.1.3](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/compare/v0.1.2...v0.1.3) (2023-03-22)


### Bug Fixes

* esm dist target ([8320dec](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/8320decd8ae4926f70527c4ff7933b4e0e3589f1))

## [0.1.2](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/compare/v0.1.1...v0.1.2) (2023-03-15)


### Bug Fixes

* publishing build system ([1819179](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/1819179195fb4a84a1ce878e092d8070c3defc3d))

## [0.1.1](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/compare/v0.1.0...v0.1.1) (2023-03-14)


### Bug Fixes

* **docs:** update install instruction ([#48](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/48)) ([ecaede2](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/ecaede2b6c041c2e0f006d73e27578c3586790fd))

## 0.1.0 (2023-03-14)


### Features

* add Connector.getOptions method ([7bb9456](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/7bb94564cc95d5e6a64b0006d53c66de752184c2))


### Bug Fixes

* **deps:** update dependency @googleapis/sqladmin to v7 ([a31beaf](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/a31beafa030f05cfd01c761ca71a4eadddf06975))


### Miscellaneous Chores

* release 0.1.0 ([#35](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/issues/35)) ([6fa46ac](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector/commit/6fa46ac014bbdc84fd09d8097aebbab76f08dbd7))
