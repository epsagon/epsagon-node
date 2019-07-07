const axios = require('axios');

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
    return axios.get(uri).then(res => res.data).then((metadata) => {
        currentECSLabels = metadata && metadata.Labels;
        return metadata;
    });
};

/**
 * If the current process is running under an ECS container,
 * it will add the task-arn of the current task to the metadata field
 * of the trace, if its not running under ECS the trace will return unchanged
 *
 * @param {Object} traceObject  trace object to add the metadata
 * @returns {Object}  the new trace object
 */
module.exports.addECSMetadata = function addECSMetadata(traceObject) {
    if (!traceObject || !currentECSLabels) return traceObject;

    const updatedTrace = Object.assign({}, traceObject);
    updatedTrace.resource = updatedTrace.resource || {};
    updatedTrace.resource.metadata = updatedTrace.resource.metadata || {};
    updatedTrace.resource.metadata.ecsLabels = currentECSLabels;

    return updatedTrace;
};
