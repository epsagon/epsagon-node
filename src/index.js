const lambdaWrapper = require('./wrappers/lambda.js');
const lambdaEnvWrapper = require('./wrappers/lambda_env');
const nodeWrapper = require('./wrappers/node.js');
const batchWrapper = require('./wrappers/batch.js');
const tracer = require('./tracer.js');
const config = require('./config.js');
const utils = require('./utils.js');
const eventInterface = require('./event.js');
const event = require('./proto/event_pb.js');
const tryRequire = require('./try_require.js');
const errorCode = require('./proto/error_code_pb.js');

// Requiring patcher to instrument modules
const patcher = require('./patcher.js'); // eslint-disable-line no-unused-vars

module.exports = {
    lambdaWrapper: f => f,
    stepLambdaWrapper: f => f,
    nodeWrapper: f => f,
    wrapBatchJob: f => f,
    label: f => f,
    setError: f => f,
    tracer,
    config,
    utils,
    eventInterface,
    event,
    tryRequire,
    errorCode,
};

if (!config.getConfig().isEpsagonDisabled) {
    module.exports.lambdaWrapper = lambdaWrapper.lambdaWrapper;
    module.exports.stepLambdaWrapper = lambdaWrapper.stepLambdaWrapper;
    module.exports.nodeWrapper = nodeWrapper.nodeWrapper;
    module.exports.wrapBatchJob = batchWrapper.wrapBatchJob;
    module.exports.label = tracer.label;
    module.exports.setError = tracer.setError;
}

module.exports.wrapper = lambdaEnvWrapper.wrapper;

module.exports.init = tracer.initTrace;
