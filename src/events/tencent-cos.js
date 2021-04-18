const utils = require('../utils.js');
const tracer = require('../tracer.js');
const eventInterface = require('../event.js');
const moduleUtils = require('./module_utils.js');

/**
 * Wraps the Tencent COS module.
 * @param {Function} wrappedFunction original functions
 * @returns {Function} The wrapped function
 */
function tencentCOSWrapper(wrappedFunction) {
    return function internalTencentCOSWrapper(cos) {
        const result = wrappedFunction.apply(this, [cos]);
        // eslint-disable-next-line no-underscore-dangle
        const originalAddTask = cos._addTask;
        // eslint-disable-next-line no-underscore-dangle, no-param-reassign
        cos._addTask = (api, params, callback, ignoreAddEvent) => {
            const { slsEvent, startTime } = eventInterface.initializeEvent(
                'cos',
                params.Bucket,
                api,
                'tencent-cos'
            );
            eventInterface.addToMetadata(slsEvent, {
                'tencent.region': params.Region,
                'tencent.cos.object_key': params.Key,
                'tencent.cos.object_path': params.FilePath,
            });
            let patchedCallback = callback;
            const responsePromise = new Promise((resolve) => {
                patchedCallback = (err, data) => {
                    slsEvent.setDuration(utils.createDurationTimestamp(startTime));
                    eventInterface.addToMetadata(slsEvent, {
                        'tencent.cos.request_id': data.headers['x-cos-request-id'],
                        'tencent.status_code': data.statusCode,
                    });
                    if (err) {
                        eventInterface.setException(slsEvent, err);
                    }
                    resolve();
                    return callback(err, data);
                };
            });
            tracer.addEvent(slsEvent, responsePromise);
            return originalAddTask(api, params, patchedCallback, ignoreAddEvent);
        };
        return result;
    };
}

module.exports = {
    /**
     * Initializes the Tencent COS tracer
     */
    init() {
        moduleUtils.patchModule(
            'cos-nodejs-sdk-v5/sdk/task.js',
            'init',
            tencentCOSWrapper
        );
    },
};
