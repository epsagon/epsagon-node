const os = require('os');
const eventIterface = require('../event');

let k8sHostname = null;

/**
 * @returns {boolean} true if the current process is running inside
 * a K8S container, false otherwise
 */
module.exports.hasK8sMetadata = function hasK8sMetadata() {
    return !!(process.env.KUBERNETES_SERVICE_HOST);
};

/**
 * Load K8S metadata and store it
 */
module.exports.loadK8sMetadata = function loadK8sMetadata() {
    if (!k8sHostname) {
        k8sHostname = os.hostname();
    }
};

/**
 * If the current process is running under an ECS container,
 * it will add the task-arn of the current task to the metadata field
 * of the trace, if its not running under ECS the trace will return unchanged
 *
 * @param {Object} runner  runner object to add the metadata
 */
module.exports.addK8sMetadata = function addK8sMetadata(runner) {
    if (!runner || !k8sHostname) return;
    eventIterface.addToMetadata(runner, { k8s_pod_name: k8sHostname });
};
