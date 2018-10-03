/**
 * @fileoverview Patcher for all the libraries we are instumenting
 * IMPORTANT: when requiring this module, all of the libraries will be automatically patched!
 */
const awsSDKPatcher = require('./events/aws_sdk.js');
const httpPatcher = require('./events/http.js');
const config = require('./config.js');

if (!config.config.isEpsagonPatchDisabled) {
    [awsSDKPatcher, httpPatcher].forEach((patcher) => {
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
