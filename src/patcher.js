/**
 * @fileoverview Patcher for all the libraries we are instrumenting
 * IMPORTANT: when requiring this module, all of the libraries will be automatically patched!
 */
const config = require('./config.js');
const utils = require('./utils.js');
const awsSDKPatcher = require('./events/aws_sdk.js');
const httpPatcher = require('./events/http.js');
const pgPatcher = require('./events/pg.js');
const mysqlPatcher = require('./events/mysql.js');
const redisPatcher = require('./events/redis.js');
const mongoPatcher = require('./events/mongodb.js');


/**
 * Patches a module
 * @param {Object} patcher module
 */
function patch(patcher) {
    try {
        patcher.init();
    } catch (error) {
        if ((process.env.EPSAGON_DEBUG || '').toUpperCase() === 'TRUE') {
            utils.debugLog(error);
        }
    }
}

if (!config.getConfig().isEpsagonPatchDisabled) {
    [
        awsSDKPatcher,
        httpPatcher,
        pgPatcher,
        mysqlPatcher,
        redisPatcher,
        mongoPatcher,
    ].forEach(patch);

    // Conditional patching that depends on the environment
    if (!utils.isLambdaEnv()) {
        // eslint-disable-next-line global-require
        const expressPatcher = require('./wrappers/express.js');
        [
            expressPatcher,
        ].forEach(patch);
    }
}
