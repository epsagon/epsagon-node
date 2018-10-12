/**
 * @fileoverview runners for the AWS Lambda environment
 */

const consts = require('../consts.js');
const serverlessEvent = require('../proto/event_pb.js');
const eventInterface = require('../event.js');
const errorCode = require('../proto/error_code_pb.js');

/**
 * Creates an Event representing the running lambda (runner)
 * @param {object} originalContext The context the lambda was triggered with
 * @param {string} [resourceType='lambda'] The resource type to use for the runner
 * @return {proto.event_pb.Event} The runner representing the lambda
 */
function createRunner(originalContext, resourceType = 'lambda') {
    const runnerResource = new serverlessEvent.Resource([
        originalContext.functionName,
        resourceType,
        'invoke',
        {},
    ]);

    const runner = new serverlessEvent.Event([
        originalContext.awsRequestId,
        0,
        null,
        'runner',
        0,
        errorCode.ErrorCode.OK,
    ]);

    runner.setResource(runnerResource);
    const invokedFunctionArn = (originalContext.invokedFunctionArn) ?
        originalContext.invokedFunctionArn.split(':')[4] : '';

    eventInterface.addToMetadata(runner, {
        log_stream_name: `${originalContext.logStreamName}`,
        log_group_name: `${originalContext.logGroupName}`,
        function_version: `${originalContext.functionVersion}`,
        aws_account: `${invokedFunctionArn}`,
        cold_start: `${consts.COLD_START}`,
        memory: `${originalContext.memoryLimitInMB}`,
        region: consts.REGION,
    });

    consts.COLD_START = false;
    return runner;
}

module.exports.createRunner = createRunner;
