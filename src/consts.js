module.exports.VERSION = require('../package.json').version;

const DEFAULT_REGION = 'us-east-1';
let REGION = process.env.AWS_REGION;

// Check that we got region from env.
if (REGION === undefined) {
    REGION = DEFAULT_REGION;
}

module.exports.REGION = REGION;

module.exports.TRACE_COLLECTOR_URL = `http://${REGION}.tc.epsagon.com`;

module.exports.COLD_START = true;

/**
 * The identifier of the injected step data in the step machine result dict
 */
module.exports.STEP_ID_NAME = 'Epsagon';

module.exports.MAX_LABEL_SIZE = 100 * 1024;

module.exports.MAX_TRACE_SIZE_BYTES = 64 * 1024;

// User-defined HTTP minimum status code to be treated as an error.
module.exports.HTTP_ERR_CODE = parseInt(process.env.EPSAGON_HTTP_ERR_CODE, 10) || 400;
