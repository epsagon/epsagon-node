# Epsagon Tracing for Node.js
[![Build Status](https://travis-ci.com/epsagon/epsagon-node.svg?token=wsveVqcNtBtmq6jpZfSf&branch=master)](https://travis-ci.com/epsagon/epsagon-node)
[![npm version](https://badge.fury.io/js/epsagon.svg)](https://badge.fury.io/js/epsagon)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)

![Epsagon](https://cdn2.hubspot.net/hubfs/4636301/Positive%20RGB_Logo%20Horizontal%20-01.svg "Epsagon")

This package provides tracing to Node.js applications for collection of distributed tracing and performance metrics in [Epsagon](https://dashboard.epsagon.com/?utm_source=github).

## Contents

- [Installation](#installation)
- [Usage](#usage)
  - [Auto-tracing](#auto-tracing)
  - [Calling the SDK](#calling-the-sdk)
  - [Tagging Traces](#tagging-traces)
  - [Custom Errors](#custom-errors)
  - [Filter Sensitive Data](#filter-sensitive-data)
- [Frameworks](#frameworks)
- [Integrations](#integrations)
- [Configuration](#configuration)
- [Getting Help](#getting-help)
- [Opening Issues](#opening-issues)
- [License](#license)


## Installation

To install Epsagon, simply run:
```sh
npm install epsagon
```

## Usage

### Auto-tracing

The simplest way to get started in some frameworks is to install `epsagon-frameworks`:
```sh
npm install epsagon-frameworks
```

And run your node command:
```sh
NODE_OPTIONS='-r epsagon-frameworks' <command>
```

For example:
```sh
NODE_OPTIONS='-r epsagon-frameworks' node app.js
```

You can see the list of auto-tracing [supported frameworks](#frameworks)

### Calling the SDK

Another simple alternative is to copy the snippet into your code:
```javascript
const epsagon = require('epsagon-frameworks');

epsagon.init({
    token: 'epsagon-token',
    appName: 'app-name-stage',
    metadataOnly: false,
});
```

To run on your framework please refer to [supported frameworks](#frameworks)


### Tagging Traces

You can add custom tags to your traces, for easier filtering and aggregations.

Add the following call inside your code:
```javascript
epsagon.label('key', 'value');
epsagon.label('userId', userId);
```

In some [frameworks](#frameworks) tagging can be done in different ways.

### Custom Errors

You can set a trace as an error (although handled correctly) to get an alert or just follow it on the dashboard.

Add the following call inside your code:
```javascript
try {
  // something bad happens
} catch (err) {
  epsagon.setError(err);
}

// Or manually specify Error object
epsagon.setError(Error('My custom error'));
```

In some [frameworks](#frameworks) custom errors can be done in different ways.

### Filter Sensitive Data

You can pass a list of sensitive properties and hostnames and they will be filtered out from the traces:

```javascript
epsagon.init({
    token: 'epsagon-token',
    appName: 'app-name-stage',
    metadataOnly: false,
    ignoredKeys: ['password', /.*_token$/],
    urlPatternsToIgnore: ['example.com', 'auth.com'],
});
```

The `ignoredKeys` property can contain strings (will perform a lose match, so that `First Name` also matches `first_name`), regular expressions, and predicate functions.
Also you can set `urlPatternsToIgnore` to ignore HTTP calls to specific domains.


## Frameworks

The following frameworks are supported with Epsagon.
Some require installing also [`epsagon-frameworks`](https://github.com/epsagon/epsagon-node-frameworks)

|Framework          |Supported Version          |Epsagon Library                                    |Auto-tracing Supported                              |
|-------------------|---------------------------|---------------------------------------------------|----------------------------------------------------|
|AWS Lambda         |All                        |`epsagon`                                          |<ul><li>- [x] (Through the dashboard only)</li></ul>|
|Step Functions     |All                        |`epsagon`                                          |<ul><li>- [ ] </li></ul>                             |
|OpenWhisk Action   |All                        |`epsagon`                                          |<ul><li>- [ ] </li></ul>                             |
|AWS Batch          |All                        |`epsagon`                                          |<ul><li>- [ ] </li></ul>                             |
|Generic            |All                        |`epsagon`                                          |<ul><li>- [ ] </li></ul>                             |
|Express            |`>=3.0.0`                  |`epsagon-frameworks`                               |<ul><li>- [x] </li></ul>                             |
|Hapi               |`>=17.0.0`                 |`epsagon-frameworks`                               |<ul><li>- [x] </li></ul>                             |
|Koa                |`>=1.1.0`                  |`epsagon-frameworks`                               |<ul><li>- [x] </li></ul>                             |
|KafkaJS            |`>=1.2.0`                  |`epsagon-frameworks`                               |<ul><li>- [x] </li></ul>                             |
|PubSub             |`>=1.1.0`                  |`epsagon-frameworks`                               |<ul><li>- [x] </li></ul>                             |
|SQS Consumer       |`>=4.0.0`                  |`epsagon-frameworks`                               |<ul><li>- [x] </li></ul>                             |
|NATS               |`>=1.4.0`                  |`epsagon-frameworks`                               |<ul><li>- [x] </li></ul>                             |


### AWS Lambda

list plugins

### Step Functions

### OpenWhisk Action

### AWS Batch

### Express

### Hapi

### Koa

### KafkaJS

### PubSub

### SQS Consumer

### NATS

### Generic

## Integrations

Epsagon provides out-of-the-box instrumentation (tracing) for many popular frameworks and libraries.

|Library             |Supported Version          |
|--------------------|---------------------------|
|http                |Fully supported            |
|https               |Fully supported            |
|http2               |Fully supported            |
|dns                 |Fully supported            |
|aws-sdk             |`>=2.2.0`                  |
|amazon-dax-client   |`>=1.0.2`                  |
|@google-cloud       |`>=2.0.0`                  |
|@google-cloud/pubsub|`>=1.1.0`                  |
|mysql               |`>=2`                      |
|mysql2              |`>=1`                      |
|pg                  |`>=4`                      |
|mongodb             |`>=3.0.0`                  |
|kafkajs             |`>=1.2.0`                  |
|redis               |`>=0.12.1`                 |
|mqtt                |`>=2.13.1`                 |
|nats                |`>=1.4.0`                  |
|openwhisk           |`>=3.0.0`                  |


## Configuration

Advanced options can be configured as a parameter to the init() method or as environment variables.

|Parameter          |Environment Variable       |Type   |Default      |Description                                                                        |
|-------------------|---------------------------|-------|-------------|-----------------------------------------------------------------------------------|
|token              |EPSAGON_TOKEN              |String |-            |Epsagon account token                                                              |
|appName            |EPSAGON_APP_NAME           |String |`Application`|Application name that will be set for traces                                       |
|metadataOnly       |EPSAGON_METADATA           |Boolean|`true`       |Whether to send only the metadata (`true`) or also the payloads (`false`)          |
|useSSL             |EPSAGON_SSL                |Boolean|`true`       |Whether to send the traces over HTTPS SSL or not                                   |
|traceCollectorURL  |-                          |String |-            |The address of the trace collector to send trace to                                |
|isEpsagonDisabled  |DISABLE_EPSAGON            |Boolean|`false`      |A flag to completely disable Epsagon (can be used for tests or locally)            |
|ignoredKeys        |EPSAGON_IGNORED_KEYS       |Array  |-            |Array of keys names (can be string or regex) to be removed from the trace
|urlPatternsToIgnore|EPSAGON_URLS_TO_IGNORE     |Array  |`[]`         |Array of URL patterns to ignore the calls                                          |
|sendTimeout        |EPSAGON_SEND_TIMEOUT_SEC   |Float  |`0.2`        |The timeout duration in seconds to send the traces to the trace collector          |
|decodeHTTP         |EPSAGON_DECODE_HTTP        |Boolean|`true`       |Whether to decode and decompress HTTP responses into the payload                   |
|httpErrorStatusCode|EPSAGON_HTTP_ERR_CODE      |Integer|`400`        |The minimum number of an HTTP response status code to treat as an error            |
|-                  |DISABLE_EPSAGON_PATCH      |Boolean|`false`      |Disable the library patching (instrumentation)                                     |
|-                  |EPSAGON_DEBUG              |Boolean|`false`      |Enable debug prints for troubleshooting                                            |
|-                  |EPSAGON_PROPAGATE_NATS_ID  |Boolean|`false`      |Whether to propagate a correlation ID in NATS.io calls for distributed tracing     |
|-                  |EPSAGON_ADD_NODE_PATH      |String |-            |List of folders to looks for node_modules when patching libraries. Separated by `:`|
|-                  |EPSAGON_DNS_INSTRUMENTATION|Boolean|`false`      |Whether to capture `dns` calls into the trace                                      |


## Getting Help

If you have any issue around using the library or the product, please don't hesitate to:

* Use the [documentation](https://docs.epsagon.com).
* Use the help widget inside the product.
* Open an issue in GitHub.


## Opening Issues

If you encounter a bug with the Epsagon library for Node.js, we want to hear about it.

When opening a new issue, please provide as much information about the environment:
* Library version, Node.js runtime version, dependencies, etc.
* Snippet of the usage.
* A reproducible example can really help.

The GitHub issues are intended for bug reports and feature requests.
For help and questions about Epsagon, use the help widget inside the product.

## License

Provided under the MIT license. See LICENSE for details.

Copyright 2020, Epsagon
