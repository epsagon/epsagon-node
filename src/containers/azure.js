const axios = require('axios');
const utils = require('../utils');
const eventIterface = require('../event');

let currentAzureLabels = null;

const AZURE_CHECK_HOST = process.env.AZURE_HOST || 'http://169.254.169.254';
const PATH = process.env.AZURE_PATH || '/metadata/instance?api-version=2019-06-01';
const URL = `${AZURE_CHECK_HOST}${PATH}`;
const AZURE_REQUEST_TIMEOUT = process.env.AZURE_REQUEST_TIMEOUT || 3000;

const parseAzureTags = (tags) => {
    const splittedTags = tags.split(';');
    const parsedTags = splittedTags.reduce((result, currentTag) => {
        const [key, value] = currentTag.split(':');
        return (key) ?
            {
                ...result,
                [key]: value,
            } : result;
    }, {});

    return parsedTags;
};

/**
 * Load Azure metadata and store it
 * @param {Object} cb callback that fired when load is finished.
 * @returns {Promise} when resolved will contain the Azure metadata
 */
module.exports.loadAzureMetadata = function loadAzureMetadata(cb) {
    if (currentAzureLabels) return Promise.resolve(currentAzureLabels);

    utils.debugLog(`loading azure metadata, url: (${URL})`);
    const source = axios.CancelToken.source();
    setTimeout(() => {
      source.cancel();
      // Timeout Logic
    }, AZURE_REQUEST_TIMEOUT);

    const options = {
        headers: {
            Metadata: 'True',
        },
        timeout: AZURE_REQUEST_TIMEOUT,
        cancelToken: source.token
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
                'azure.tags': parseAzureTags(tags),
                'azure.publisher': publisher,
            };

            if (cb) {
                cb({
                    traceCollectorURL: `http://${location}.atc.epsagon.com`,
                });
            }

            utils.debugLog(`Received metadata: ${currentAzureLabels}`);
        }
    }).catch(() => {
        utils.debugLog('Could not load azure metadata');
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
