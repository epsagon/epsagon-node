const lambdaWrapper = require('./wrappers/lambda.js');
const nodeWrapper = require('./wrappers/node.js');
const batchWrapper = require('./wrappers/batch.js');
const tracer = require('./tracer.js');
const config = require('./config.js');

// Requiring patcher to instrument modules
const patcher = require('./patcher.js'); // eslint-disable-line no-unused-vars

module.exports = {
    lambdaWrapper: f => f,
    stepLambdaWrapper: f => f,
    nodeWrapper: f => f,
    wrapBatchJob: f => f,
};

if (!config.config.isEpsagonDisabled) {
    module.exports.lambdaWrapper = lambdaWrapper.lambdaWrapper;
    module.exports.stepLambdaWrapper = lambdaWrapper.stepLambdaWrapper;
    module.exports.nodeWrapper = nodeWrapper.nodeWrapper;
    module.exports.wrapBatchJob = batchWrapper.wrapBatchJob;
}

module.exports.init = tracer.initTrace;
