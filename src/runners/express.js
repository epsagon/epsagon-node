/**
 * @fileoverview Runner for Express application
 */
const uuid4 = require('uuid4');
const utils = require('../utils.js');
const serverlessEvent = require('../proto/event_pb.js');
const eventInterface = require('../event.js');
const errorCode = require('../proto/error_code_pb.js');

/**
 * Creates an Event representing the running Express (runner)
 * @param {Request} req The Express's request data
 * @param {Int} startTime Runner start time
 * @return {Object} The runner event
 */
function createRunner(req, startTime) {
    const expressEvent = new serverlessEvent.Event([
        `express-${uuid4()}`,
        utils.createTimestampFromTime(startTime),
        null,
        'runner',
        0,
        errorCode.ErrorCode.OK,
    ]);

    const resource = new serverlessEvent.Resource([
        req.path,
        'express',
        req.method,
    ]);

    expressEvent.setResource(resource);

    return expressEvent;
}


/**
 * Terminates the running Express (runner)
 * @param {Object} expressEvent runner's express event
 * @param {Response} res response data
 * @param {Request} req The Express's request data
 * @param {Int} startTime Runner start time
 */
function finishRunner(expressEvent, res, req, startTime) {
    expressEvent.getResource().setName(req.route.path);
    eventInterface.addToMetadata(expressEvent, {
        url: `${req.protocol}://${req.hostname}${req.path}`,
        query: req.query,
        status_code: res.statusCode,
    }, {
        request_headers: req.headers,
        params: req.params,
        response_headers: res.getHeaders(),
    });

    if (res.statusCode >= 500) {
        expressEvent.setErrorCode(errorCode.ErrorCode.EXCEPTION);
    }

    expressEvent.setDuration(utils.createDurationTimestamp(startTime));
}

module.exports.createRunner = createRunner;
module.exports.finishRunner = finishRunner;
