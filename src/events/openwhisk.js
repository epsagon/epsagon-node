const uuid4 = require('uuid4');
const utils = require('../utils.js');
const tracer = require('../tracer.js');
const serverlessEvent = require('../proto/event_pb.js');
const eventInterface = require('../event.js');
const errorCode = require('../proto/error_code_pb.js');
const moduleUtils = require('./module_utils.js');

/**
 * Wraps the openwhisk module.
 * @param {Function} wrappedFunction The openwhisk module
 * @returns {Function} The wrapped function
 */
function openWhiskWrapper(wrappedFunction) {
    return function internalOWWrapper(options, callback) {
        const { name } = options;
        const fullName = `/${process.env['__OW_NAMESPACE']}/${name || options}`; // eslint-disable-line dot-notation
        const resource = new serverlessEvent.Resource([
            fullName,
            'openwhisk_action',
            'invoke',
        ]);
        const startTime = Date.now();
        const invokeEvent = new serverlessEvent.Event([
            `openwhisk-${uuid4()}`,
            utils.createTimestampFromTime(startTime),
            null,
            'openwhisk',
            0,
            errorCode.ErrorCode.OK,
        ]);

        invokeEvent.setResource(resource);
        eventInterface.addToMetadata(invokeEvent, {
            params: options.params,
        });
        let request;
        let response;
        if (options.result) {
            // action.invoke would return directly `response.result` so we would loose some
            // of the information from the response.
            const opts = {
                ...options,
                result: false,
            };
            request = wrappedFunction.apply(this, [opts, callback]);
            // ensure we return the originally requested form
            response = request.then(res => res.response.result);
        } else {
            request = wrappedFunction.apply(this, [options, callback]);
            response = request;
        }

        const responsePromise = new Promise((resolve) => {
            request.then((res) => {
                let resp = res.response;
                if (resp && resp.result && resp.result.body && resp.result.body.length > 100) {
                    // create copy so we can trim the long response body
                    resp = Object.assign({}, resp);
                    resp.result = Object.assign({}, resp.result);
                    resp.result.body = `${resp.result.body.substring(0, 100)}...(truncated)`;
                }
                const brief = {
                    activation_id: res.activationId,
                    status: resp.status,
                    result_statusCode: resp.result && resp.result.statusCode,
                };
                eventInterface.addToMetadata(
                    invokeEvent,
                    brief,
                    {
                        activation_id: res.activationId,
                        response: resp,
                    }
                );
                invokeEvent.setDuration(utils.createDurationTimestamp(startTime));
            }).catch((err) => {
                eventInterface.setException(invokeEvent, err);
            }).finally(() => {
                resolve();
            });
        });

        tracer.addEvent(invokeEvent, responsePromise);
        return response;
    };
}

module.exports = {
    /**
     * Initializes the openwhisk tracer
     */
    init() {
        moduleUtils.patchModule(
            'openwhisk/lib/actions.js',
            'invoke',
            openWhiskWrapper,
            actions => actions.prototype
        );
    },
};
