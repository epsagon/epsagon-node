const os = require('os');
const fs = require('fs');
const utils = require('../utils');
const eventIterface = require('../event');

let k8sHostname = null;
let k8sContainerId = null;

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

    if (!k8sContainerId) {
        try {
            const data = fs.readFileSync('/proc/self/cgroup');
            const firstLineParts = data.toString('utf-8').split('\n')[0].split('/');
            k8sContainerId = firstLineParts[firstLineParts.length - 1];
        } catch (err) {
            utils.debugLog('Error reading cgroup file', err);
        }
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
    eventIterface.addToMetadata(runner, {
        is_k8s: true,
        k8s_pod_name: k8sHostname,
        k8s_container_id: k8sContainerId,
    });
};
