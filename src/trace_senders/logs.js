/**
 * @fileoverview Send traces to the epsagon backend by printing it to the logs
 */

const { Buffer } = require('buffer');
const utils = require('../utils.js');

module.exports.sendTrace = function sendTrace(traceObject) {
    utils.debugLog('posting trace to logs');
    utils.debugLog(`trace: ${JSON.stringify(traceObject, null, 2)}`);

    return new Promise((resolve) => {
        try {
            const encodedTrace = Buffer.from(JSON.stringify(traceObject)).toString('base64');
            console.log(`EPSAGON_TRACE: ${encodedTrace}`);
            utils.debugLog('Trace posted!');
        } catch (err) {
            utils.debugLog(`Error sending trace. Error: ${err}`);
        } finally {
            resolve();
        }
    });
};
