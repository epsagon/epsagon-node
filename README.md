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
    callback(null, 'It worked!')
}

handler = epsagon.lambdaWrapper(handler)
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

## Express application

If you're running express.js application on any non Lambda environment, you can still use Epsagon!
Note: Only Express 4 and above is supported
You can accomplish that with the following example:

```node
const express = require('express');
const epsagon = require('epsagon');

epsagon.init({
    token: 'my-secret-token',
    appName: 'my-app-name',
    metadataOnly: false,
});

const app = express()

app.get('/', (req, res) => res.send('Hello World!'))

app.listen(3000)
```

## Hapi application

If you're running Hapi.js application on any non Lambda environment, you can still use Epsagon!
Note: Only Hapi 17 and above is supported
You can accomplish that with the following example:

```node
const express = require('express');
const epsagon = require('epsagon');

epsagon.init({
    token: 'my-secret-token',
    appName: 'my-app-name',
    metadataOnly: false,
});

const app = express()

app.get('/', (req, res) => res.send('Hello World!'))

app.listen(3000)
```


## Copyright

Provided under the MIT license. See LICENSE for details.

Copyright 2018, Epsagon
