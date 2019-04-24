/**
 * @fileoverview Runner for Express application
 */
const uuid4 = require('uuid4');
const utils = require('../utils.js');
const event = require('../proto/event_pb.js');
const eventInterface = require('../event.js');
const errorCode = require('../proto/error_code_pb.js');

/**
 * Creates an Event representing the running Express (runner)
 * @param {Request} req The Express's request data
 * @param {Int} startTime Runner start time
 * @return {Object} The runner event
 */
function createRunner(req, startTime) {
    const hapiEvent = new event.Event([
        `hapi-${uuid4()}`,
        utils.createTimestampFromTime(startTime),
        null,
        'runner',
        0,
        errorCode.ErrorCode.OK,
    ]);
    const resource = new event.Resource([
        req.url.host,
        'hapi',
        req.method,
    ]);

    hapiEvent.setResource(resource);

    return hapiEvent;
}


/**
 * Terminates the running Express (runner)
 * @param {Object} expressEvent runner's express event
 * @param {Response} res response data
 * @param {Request} req The Express's request data
 * @param {Int} startTime Runner start time
 */
function finishRunner(hapiEvent, req, res, startTime) {
    hapiEvent.setDuration(utils.createDurationTimestamp(startTime));
    eventInterface.addToMetadata(hapiEvent, {
        url: req.url.href,
        route: req.route.path,
        query: req.url.search,
        status_code: res.statusCode,
    }, {
        request_headers: req.headers,
        params: req.params,
        response_headers: res.headers,
    });

    if (res.statusCode >= 500) {
        hapiEvent.setErrorCode(errorCode.ErrorCode.EXCEPTION);
    }

}

module.exports.createRunner = createRunner;
module.exports.finishRunner = finishRunner;
