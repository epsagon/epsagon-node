/**
 * @fileoverview Patcher for all the libraries we are instumenting
 * IMPORTANT: when requiring this module, all of the libraries will be automatically patched!
 */
const tryRequire = require('try-require');
const config = require('./config.js');
const awsSDKPatcher = require('./events/aws_sdk.js');
const httpPatcher = require('./events/http.js');

const pgPatcher = tryRequire('./events/pg.js') || { init: () => {} };

if (!config.getConfig().isEpsagonPatchDisabled) {
    [awsSDKPatcher, httpPatcher, pgPatcher].forEach((patcher) => {
        try {
            patcher.init();
        } catch (error) {
            if (process.env.EPSAGON_DEBUG === 'TRUE') {
                // eslint-disable-next-line no-console
                console.log(error);
            }
        }
    });
}
