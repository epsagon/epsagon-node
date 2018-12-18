/**
 * @fileoverview Epsagon's batch wrapper, for tracing Batch Jobs
 */
const shimmer = require('shimmer');
const tracer = require('../tracer.js');
const utils = require('../utils.js');
const eventInterface = require('../event.js');
const batchRunner = require('../runners/aws_batch.js');

/**
 * Epsagon's batch Job wrapper, sets tracing on a batch job
 */
module.exports.wrapBatchJob = function wrapBatchJob() {
    tracer.restart();
    try {
        const { runner, runnerPromise } = batchRunner.createRunner();
        tracer.addEvent(runner, runnerPromise);
        const startTime = Date.now();

        const runnerSendUpdateHandler = (() => {
            runner.setDuration(utils.createDurationTimestamp(startTime));
            runner.setLabels();
        });

        runner.setStartTime(utils.createTimestampFromTime(startTime));
        process.on('uncaughtException', (err) => {
            eventInterface.setException(runner, err);
        });
        process.once('beforeExit', () => {
            tracer.sendTrace(runnerSendUpdateHandler);
        });

        const processExitWrapper = (
            wrappedFunction => function internalProcessExitWrapper(errorCode) {
                runnerSendUpdateHandler();
                tracer.sendTraceSync();
                wrappedFunction.apply(this, [errorCode]);
            }
        );

        shimmer.wrap(process, 'exit', processExitWrapper);
    } catch (err) {
        utils.debugLog(
            'failed to create Batch runner',
            err
        );
        tracer.addException(err);
    }
};
