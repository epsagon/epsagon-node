const axios = require('axios');
const utils = require('../utils');
const eventIterface = require('../event');

let currentECSLabels = null;


/**
 * Check if the current process is running inside
 * an ECS container, if so return the ECS_CONTAINER_METADATA_URI
 * @returns {string | boolean}  ECS_CONTAINER_METADATA_URI if in ECS else false
 */
module.exports.hasECSMetadata = function hasECSMetadata() {
    return process.env.ECS_CONTAINER_METADATA_URI || false;
};

/**
 * Load ECS metadata and store it
 * @param {string} uri  metadata uri to load, @see {@link hasECSMetadata} to get the uri
 * @returns {Promise}   when resolved will contain the ECS metadata
 */
module.exports.loadECSMetadata = function loadECSMetadata(uri) {
    if (currentECSLabels) return Promise.resolve(currentECSLabels);

    utils.debugLog(`loading ecs meta, url: (${uri})`);
    return axios.get(uri).then(res => res.data).then((metadata) => {
        utils.debugLog(`Received metadata: ${JSON.stringify(metadata)}`);
        currentECSLabels = metadata && metadata.Labels;
        return currentECSLabels;
    });
};

/**
 * If the current process is running under an ECS container,
 * it will add the task-arn of the current task to the metadata field
 * of the trace, if its not running under ECS the trace will return unchanged
 *
 * @param {Object} runner  runner object to add the metadata
 */
module.exports.addECSMetadata = function addECSMetadata(runner) {
    if (!runner || !currentECSLabels) return;
    eventIterface.addToMetadata(runner, { ECS: currentECSLabels });
};
