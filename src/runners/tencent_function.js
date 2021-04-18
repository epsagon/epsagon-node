/**
 * @fileoverview runners for the Tencent Serverless Cloud Function environment
 */

const consts = require('../consts.js');
const serverlessEvent = require('../proto/event_pb.js');
const eventInterface = require('../event.js');
const errorCode = require('../proto/error_code_pb.js');

/**
 * Creates an Event representing the running Serverless Cloud Function (runner)
 * @param {object} originalContext The context the Serverless Cloud Function was triggered with
 * @return {proto.event_pb.Event} The runner representing the Serverless Cloud Function
 */
function createRunner(originalContext) {
    const runnerResource = new serverlessEvent.Resource([
        originalContext.function_name,
        'tencent_function',
        'invoke',
        {},
    ]);

    const runner = new serverlessEvent.Event([
        originalContext.request_id,
        0,
        null,
        'runner',
        0,
        errorCode.ErrorCode.OK,
    ]);

    runner.setResource(runnerResource);

    eventInterface.addToMetadata(runner, {
        'tencent.scf.version': originalContext.function_version,
        'tencent.scf.memory': originalContext.memory_limit_in_mb,
        'tencent.scf.cold_start': consts.COLD_START,
        'tencent.namespace': originalContext.namespace,
        'tencent.uin': originalContext.tencentcloud_uin,
        'tencent.app_id': originalContext.tencentcloud_appid,
        'tencent.region': originalContext.tencentcloud_region,
    });

    consts.COLD_START = false;
    return runner;
}

module.exports.createRunner = createRunner;
