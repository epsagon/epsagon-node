/**
 * @fileoverview Patcher for all the libraries we are instrumenting
 * IMPORTANT: when requiring this module, all of the libraries will be automatically patched!
 */
const config = require('./config.js');
const awsSDKPatcher = require('./events/aws_sdk.js');
const httpPatcher = require('./events/http.js');
const pgPatcher = require('./events/pg.js');


if (!config.getConfig().isEpsagonPatchDisabled) {
    [awsSDKPatcher, httpPatcher, pgPatcher].forEach((patcher) => {
        try {
            patcher.init();
        } catch (error) {
            if ((process.env.EPSAGON_DEBUG || '').toUpperCase() === 'TRUE') {
                // eslint-disable-next-line no-console
                console.log(error);
            }
        }
    });
}
