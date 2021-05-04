/**
 * @fileoverview Epsagon's Google Cloud Function wrapper.
 */
const tracer = require('../tracer.js');
const traceObject = require('../trace_object.js');
const utils = require('../utils.js');
const consts = require('../consts');
const eventInterface = require('../event.js');


/**
 * Creates an Event representing the running function (runner)
 * @param {express.Request} req incoming http request
 * @return {proto.event_pb.Event} The runner representing the gcp function
 */
function createRunner(req) {
    const { slsEvent, startTime } = eventInterface.initializeEvent(
        'google_cloud_function',
        process.env.K_SERVICE,
        'execute',
        'runner'
    );
    eventInterface.addToMetadata(slsEvent, {
        'gcp.function.name': process.env.K_SERVICE,
        'gcp.function.revision': process.env.K_REVISION,
        'gcp.function.runtime': process.env.GAE_RUNTIME,
        'gcp.function.execution_id': req.headers['function-execution-id'],
        'gcp.function.cold_start': consts.COLD_START,
    });
    eventInterface.createTraceIdMetadata(slsEvent);

    consts.COLD_START = false;
    return { slsEvent, startTime };
}


/**
 * Creates an Event representing the trigger function
 * @param {express.Request} req incoming http request
 * @param {express.Response} res outgoing http response
 * @return {proto.event_pb.Event} The runner representing the trigger
 */
function createHTTPTrigger(req, res) {
    const { slsEvent } = eventInterface.initializeEvent(
        'http',
        req.hostname,
        req.method,
        'trigger'
    );
    eventInterface.addToMetadata(slsEvent, {
        'http.status_code': res.statusCode,
        'http.request.path': req.path,
    }, {
        'http.request.path_params': req.params,
        'http.request.headers': req.headers,
        'http.response.headers': res.getHeaders(),
    });
    if (req.body) {
        eventInterface.addToMetadata(slsEvent, {}, {
            'http.request.body': req.body,
        });
    }
    if (req.query) {
        eventInterface.addToMetadata(slsEvent, {}, {
            'http.request.query_params': req.query,
        });
    }
    return slsEvent;
}


/**
 * Epsagon's node function wrapper, wrap a gcp function function with it to trace it
 * @param {function} functionToWrap The function to wrap and trace
 * @return {function} The original function, wrapped by our tracer
 */
module.exports.googleCloudFunctionWrapper = function googleCloudFunctionWrapper(functionToWrap) {
    tracer.getTrace = traceObject.get;
    return (req, res) => {
        tracer.restart();
        let runner;
        let eventStartTime;

        try {
            const { slsEvent, startTime } = createRunner(req);
            runner = slsEvent;
            eventStartTime = startTime;
            tracer.addRunner(runner);
        } catch (err) {
            console.log(err); // eslint-disable-line no-console
            // If we failed, call the user's function anyway
            return functionToWrap(req, res);
        }

        res.on('finish', () => {
            runner.setDuration(utils.createDurationTimestamp(eventStartTime));
            try {
                const trigger = createHTTPTrigger(req, res);
                trigger.setDuration(utils.createDurationTimestamp(eventStartTime));
                tracer.addEvent(trigger);
            } catch (err) {
                utils.debugLog(`Error parsing trigger: ${err.stack}`);
            }
            tracer.sendTrace(() => {});
        });
        return functionToWrap(req, res);
    };
};
