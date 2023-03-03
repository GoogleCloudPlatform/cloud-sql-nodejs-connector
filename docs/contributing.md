# How to Contribute

We'd love to accept your patches and contributions to this project.

## Before you begin

### Sign our Contributor License Agreement

Contributions to this project must be accompanied by a
[Contributor License Agreement](https://cla.developers.google.com/about) (CLA).
You (or your employer) retain the copyright to your contribution; this simply
gives us permission to use and redistribute your contributions as part of the
project.

If you or your current employer have already signed the Google CLA (even if it
was for a different project), you probably don't need to do it again.

Visit <https://cla.developers.google.com/> to see your current agreements or to
sign a new one.

### Review our Community Guidelines

This project follows [Google's Open Source Community
Guidelines](https://opensource.google/conduct/).

## Contribution process

### Code Reviews

All submissions, including submissions by project members, require review. We
use GitHub pull requests for this purpose. Consult
[GitHub Help](https://help.github.com/articles/about-pull-requests/) for more
information on using pull requests.

## Project Setup

Here's how to setup a development environment to work on the Cloud SQL Node.js
Connector.

Start by clonning this repo to your local file system. Once that's ready, from
the command line, navigate to the cloned repo folder and run `npm install`
in order to install all the project's dependencies. e.g:

```sh
cd <path-to-cloned-repo>
npm install
```

### Running Tests

Make sure you have all dependencies installed as outlined in the **Project
Setup**.

To run tests, run `npm test`, e.g:

```sh
npm test
```

It's also possible to run a single test file with no need for a test runner.
Here's an example of how to run the connector integration tests directly:

```sh
node --loader ts-node/esm test/serial/connector-integration.ts
```
