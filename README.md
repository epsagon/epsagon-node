# Epsagon Instrumentation for Node.js
[![Build Status](https://travis-ci.com/epsagon/epsagon-node.svg?token=wsveVqcNtBtmq6jpZfSf&branch=master)](https://travis-ci.com/epsagon/epsagon-node)
[![npm version](https://badge.fury.io/js/epsagon.svg)](https://badge.fury.io/js/epsagon)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)

This package provides an instrumentation to Node.js code running on functions for collection of distributed tracing and performance monitoring.

## Installation

From your project directory:

```sh
npm install --save epsagon
```

## Getting started (AWS Lambda)

Simply use the wrapper to send traces from your code:

```node
const epsagon = require('epsagon');
epsagon.init({
    token: 'my-secret-token',
    appName: 'my-app-name',
    metadataOnly: false, // Optional, send more trace data
});

function handler(event, context, callback) {
    callback(null, 'It worked!')
}

handler = epsagon.lambdaWrapper(handler)
```

## Getting started (Apache OpenWhisk)

You should pass the Epsagon token to your action as a default parameter, so that you don't
have to expose important credentials in your code. The name of the parameter can be configured using `token_param`, in this example we use `EPSAGON_TOKEN`

```javascript
const epsagon = require('epsagon');

function main(params) {
    // your main function
}

module.exports.main = epsagon.openWhiskWrapper(main, {
    token_param: 'EPSAGON_TOKEN', // name of the action parameter to take the token from
    appName: 'my-app-name'
    metadataOnly: false // Optional, send more trace data
});
```

You can then pass the `EPSAGON_TOKEN` as a default parameter into your action using the `wsk` command line client:

```bash
$ wsk action update <myaction> --parameter EPSAGON_TOKEN <your-epsagon-token>
```

## Custom labels

You can add custom labels to your traces. Filters can later be used for filtering
traces that contains specific labels:
```node
function handler(event, context, callback) {
    epsagon.label('myCustomLabel', 'labelValue');
    callback(null, 'It worked!')
}
```

## Custom errors

You can set a trace as an error (although handled correctly) by catching an error:
```node
function handler(event, context, callback) {
    try {
        // something bad happens
    } catch (err) {
        epsagon.setError(err);
    }

    callback(null, 'It worked!')
}
```

Or manually specify Error object:
```node
function handler(event, context, callback) {
    epsagon.setError(Error('My custom error'));
    callback(null, 'It worked!')
}
```

## Filter sensitive data

You can pass a list of sensitive properties and they will be filtered out:

```node
epsagon.init({
    token: 'my-secret-token',
    appName: 'my-app-name',
    metadataOnly: false, // Optional, send more trace data
    ignoredKeys: ['password', ...]
});
```

Alternatively you can pass a comma-separated list of sensitive keys using 
the `EPSAGON_IGNORED_KEYS` environment variable to get the same effect.

## Web frameworks

Support for Express, Hapi, and other frameworks is done through [epsagon-frameworks](https://github.com/epsagon/epsagon-node-frameworks)


## Copyright

Provided under the MIT license. See LICENSE for details.

Copyright 2019, Epsagon
