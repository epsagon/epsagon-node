const axios = require('axios');
const utils = require('../utils');
const eventIterface = require('../event');

let currentAzureLabels = null;

const AZURE_CHECK_HOST = process.env.AZURE_HOST || 'http://169.254.169.254';
const PATH = process.env.AZURE_PATH || '/metadata/instance?api-version=2019-06-01';
const URL = `${AZURE_CHECK_HOST}${PATH}`;

/**
 * Load Azure metadata and store it
 * @param {Object} cb callback that fired when load is finished.
 * @returns {Promise} when resolved will contain the Azure metadata
 */
module.exports.loadAzureMetadata = function loadAzureMetadata(cb) {
    if (currentAzureLabels) return Promise.resolve(currentAzureLabels);

    utils.debugLog(`loading azure metadata, url: (${URL})`);
    const options = {
        headers: {
            Metadata: 'True',
        },
    };

    return axios.get(URL, options).then((response) => {
        utils.debugLog(`Received response: ${response}`);
        if (response.status === 200) {
            const {
                location,
                subscriptionId,
                tags,
                publisher,
            } = response.data.compute;

            currentAzureLabels = {
                'azure.location': location,
                'azure.subscription_id': subscriptionId,
                'azure.tags': tags,
                'azure.publisher': publisher,
            };

            if (cb) {
                cb({
                    traceCollectorURL: `http://${location}.atc.epsagon.com`,
                });
            }

            utils.debugLog(`Received metadata: ${currentAzureLabels}`);
        }
    }).catch((error) => {
        utils.debugLog(error);
    });
};

/**
 * If the current process is running in azure cloud,
 * it will add metadata to trace
 *
 * @param {Object} runner  runner object to add the metadata
 */
module.exports.addAzureMetadata = function addAzureMetadata(runner) {
    if (!runner || !currentAzureLabels) return;
    eventIterface.addToMetadata(runner, Object.assign({}, currentAzureLabels));
};
