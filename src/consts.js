const fs = require('fs');
const path = require('path');

const pjsonPath = path.resolve(__dirname, '../package.json');
module.exports.VERSION = JSON.parse(fs.readFileSync(pjsonPath)).version;

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
