/**
 * @fileoverview Patcher for all the libraries we are instrumenting
 * IMPORTANT: when requiring this module, all of the libraries will be automatically patched!
 */
const config = require('./config.js');
const utils = require('./utils.js');
const tryRequire = require('./try_require.js');
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

/**
 * Try to require a patcher module, otherwise return an empty init.
 * @param {String} modulePath patcher module path
 * @returns {Object} module
 */
function tryRequirePatch(modulePath) {
    let patchModule = tryRequire(modulePath);
    if (!patchModule) {
        patchModule = { init: () => {} };
    }
    return patchModule;
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
        const expressPatcher = tryRequirePatch('./wrappers/express.js');
        const hapiPatcher = tryRequirePatch('./wrappers/hapi.js');

        [
            expressPatcher,
            hapiPatcher,
        ].forEach(patch);
    }
}
