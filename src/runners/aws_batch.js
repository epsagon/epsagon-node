/**
 * @fileoverview Runner for AWS Batch environment
 */
const axios = require('axios');
const serverlessEvent = require('../proto/event_pb.js');
const eventInterface = require('../event.js');
const errorCode = require('../proto/error_code_pb.js');
const tracer = require('../tracer.js');
const utils = require('../utils.js');

/**
 * Creates an Event representing the running function (runner)
 * @return {Object} The runner representing the lambda, and a promise
 *     That resolved when all it's required fields are filled
 */
function createRunner() {
    const runnerResource = new serverlessEvent.Resource([
        process.env.AWS_BATCH_JOB_ID,
        'batch',
        'invoke',
        {},
    ]);

    const runner = new serverlessEvent.Event([
        process.env.AWS_BATCH_JOB_ID,
        0,
        null,
        'runner',
        0,
        errorCode.ErrorCode.OK,
    ]);

    runner.setResource(runnerResource);
    eventInterface.addToMetadata(runner, {
        'Job ID': process.env.AWS_BATCH_JOB_ID,
        'Job Queue Name': process.env.AWS_BATCH_JQ_NAME,
        'Compute Environment Name': process.env.AWS_BATCH_CE_NAME,
        'Job Attempt': process.env.AWS_BATCH_JOB_ATTEMPT,
    }, {
        Hostname: process.env.HOSTNAME,
        Home: process.env.HOME,
        Path: process.env.PATH,
        Arguments: JSON.stringify(process.argv),
    });
    eventInterface.createTraceIdMetadata(runner);

    // Getting region
    const runnerPromise = axios.get(
        'http://169.254.169.254/latest/dynamic/instance-identity/document',
        { timeout: 100 }
    ).then(
        (response) => {
            utils.debugLog(`Got Batch response ${response.data}`);
            try {
                const parsedBatchData = JSON.parse(response.data);
                eventInterface.addToMetadata(runner, {
                    Region: parsedBatchData.region,
                });
            } catch (err) {
                utils.debugLog(`Could not parse Batch env data ${err.toString()}`);
            }
        }
    )
        .catch((err) => {
            tracer.addException(err);
            throw err;
        });

    return {
        runner,
        runnerPromise,
    };
}

module.exports.createRunner = createRunner;
