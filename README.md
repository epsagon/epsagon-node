# Epsagon Agent for Node.js
[![Build Status](https://travis-ci.com/epsagon/epsagon-node.svg?token=wsveVqcNtBtmq6jpZfSf&branch=master)](https://travis-ci.com/epsagon/epsagon-node)
[![npm version](https://badge.fury.io/js/epsagon.svg)](https://badge.fury.io/js/epsagon)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)

This package provides an instrumentation to Node.js code running on functions for collection of distributed tracing and performance monitoring.

## Installation

From your project directory:

```sh
npm install --save epsagon
```

## Getting started

Simply use the wrapper to send traces from your code:

```node
const epsagon = require('epsagon');
epsagon.init({
    token: 'my-secret-token',
    appName: 'my-app-name',
    metadataOnly: false, // Optional, send more trace data
});

function handler(event, context, callback) {
    callback(null, 'It worked!'
}

handler = epsagon.lambdaWrapper(handler)
```

## Copyright

Provided under the MIT license.
See LICENSE for details.

Copyright 2018, Epsagon
