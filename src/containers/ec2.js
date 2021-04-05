const axios = require('axios');
const utils = require('../utils');
const eventIterface = require('../event');

let currentEC2Labels = null;

const URL = 'http://169.254.169.254/latest/meta-data/';
const RESPONSE_LEN_THRESHOLD = 100;
const attributeToGet = ['instance-id', 'instance-type', 'local-ipv4', 'public-hostname', 'public-ipv4'];
const EPSAGON_EC2_REQUEST_TIMEOUT = process.env.EPSAGON_EC2_REQUEST_TIMEOUT || 3000;


/**
 * Load EC2 metadata and store it
 * @returns {Promise} when resolved will contain the EC2 metadata
 */
module.exports.loadEC2Metadata = function loadEC2Metadata() {
    if (currentEC2Labels) return Promise.resolve(currentEC2Labels);

    const promises = [];
    utils.debugLog('Loading EC2 metadata');
    attributeToGet.forEach((attribute) => {
        const source = axios.CancelToken.source();
        setTimeout(() => {
            source.cancel();
        }, EPSAGON_EC2_REQUEST_TIMEOUT);
        promises.push(axios.get(URL + attribute, {
            timeout: EPSAGON_EC2_REQUEST_TIMEOUT,
            cancelToken: source.token,
        }).then((response) => {
            utils.debugLog(`Received response for ${attribute}`);
            // In some cases a long, irrelevant HTML response is being returned
            if (response.status === 200 && response.data.length < RESPONSE_LEN_THRESHOLD) {
                const attributeKey = attribute.replace('-', '_');
                const attributeData = response.data;
                if (!currentEC2Labels) currentEC2Labels = {};
                currentEC2Labels[`aws.ec2.${attributeKey}`] = attributeData;
                utils.debugLog(`${attributeKey} stored with: ${attributeData}`);
            }
            return attribute;
        })
            .catch(() => {
                utils.debugLog(`Could not load EC2 metadata for ${attribute}`);
            }));
    });

    return Promise.all(promises);
};
/**
 * If the current process is running in EC2 cloud,
 * it will add metadata to trace
 *
 * @param {Object} runner  runner object to add the metadata
 */
module.exports.addEC2Metadata = function addEC2Metadata(runner) {
    if (!runner || !currentEC2Labels) return;
    eventIterface.addToMetadata(runner, Object.assign({}, currentEC2Labels));
};
