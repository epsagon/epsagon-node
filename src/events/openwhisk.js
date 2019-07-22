const uuid4 = require('uuid4');
const shimmer = require('shimmer');
const utils = require('../utils.js');
const tracer = require('../tracer.js');
const serverlessEvent = require('../proto/event_pb.js');
const eventInterface = require('../event.js');
const errorCode = require('../proto/error_code_pb.js');

// Try to load the Actions class from openwhisk. Using `tryRequire()` would hide the dependency
// from webpack and will never be able to load the class.
let actions;
try {
    // eslint-disable-next-line global-require,import/no-unresolved
    actions = require('openwhisk/lib/actions.js');
} catch (e) {
    // ignore
}

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

        const request = wrappedFunction.apply(this, [options, callback]);
        const responsePromise = new Promise((resolve) => {
            request.then((res) => {
                eventInterface.addToMetadata(
                    invokeEvent,
                    {
                        activation_id: res.activationId,
                        response: res.response,
                    }
                );
                invokeEvent.setDuration(utils.createDurationTimestamp(startTime));
                resolve();
            });
        });

        tracer.addEvent(invokeEvent, responsePromise);
        return request;
    };
}

module.exports = {
    /**
     * Initializes the openwhisk tracer
     */
    init() {
        if (actions) shimmer.wrap(actions.prototype, 'invoke', openWhiskWrapper);
    },
};
