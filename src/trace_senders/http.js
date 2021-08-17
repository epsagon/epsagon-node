/**
 * @fileoverview Send traces to the epsagon backend using http
 */

const axios = require('axios-minified');
const http = require('http');
const https = require('https');
const utils = require('../utils.js');
const config = require('../config.js');

/**
 * Session for the post requests to the collector
 */
const session = axios.create({
    timeout: config.getConfig().sendTimeout,
    httpAgent: new http.Agent({ keepAlive: true }),
    httpsAgent: new https.Agent({ keepAlive: true }),
});

module.exports.sendTrace = function sendTrace(traceObject) {
    utils.debugLog(`Posting trace to ${config.getConfig().traceCollectorURL}`);

    if ((process.env.EPSAGON_DEBUG || '').toUpperCase() === 'TRUE') {
        utils.debugLog(`trace: ${JSON.stringify(traceObject, null, 2)}`);
    }

    // based on https://github.com/axios/axios/issues/647#issuecomment-322209906
    // axios timeout is only after the connection is made, not the address resolution itself
    const cancelTokenSource = axios.CancelToken.source();
    const handle = setTimeout(() => {
        cancelTokenSource.cancel('timeout sending trace');
    }, config.getConfig().sendTimeout);

    return session.post(
        config.getConfig().traceCollectorURL,
        traceObject,
        {
            headers: { Authorization: `Bearer ${config.getConfig().token}` },
            timeout: config.getConfig().sendTimeout,
            cancelToken: cancelTokenSource.token,
        }
    ).then((res) => {
        clearTimeout(handle);
        utils.debugLog('Trace posted!');
        return res;
    }).catch((err) => {
        clearTimeout(handle);
        if (err.config && err.config.data) {
            utils.debugLog(`Error sending trace. Trace size: ${err.config.data.length}`);
        } else {
            utils.debugLog(`Error sending trace. Error: ${err}`);
        }
        utils.debugLog(`${err ? err.stack : err}`);
        return err;
    }); // Always resolve.
};
