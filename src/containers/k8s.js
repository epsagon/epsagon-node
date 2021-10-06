const os = require('os');
const fs = require('fs');
const utils = require('../utils');
const eventIterface = require('../event');

let k8sHostname = null;
let k8sContainerId = null;

/**
* log invocations of functions
* @param {Function} fn  the function to log
* @returns {Any} the result of the function
*/
function logInvocation(fn) {
    return (...args) => {
        utils.debugLog(`[K8S-LOGS] invoking function: ${fn && fn.name}, time: ${new Date().toUTCString()}`);
        const returnValue = fn.apply(this, args);

        utils.debugLog(`[K8S-LOGS] function: ${fn && fn.name} finished execution, result: ${returnValue}, time: ${new Date().toUTCString()}`);
        return returnValue;
    };
}


/**
 * @returns {boolean} true if the current process is running inside
 * a K8S container, false otherwise
 */
/* eslint-disable-next-line prefer-arrow-callback */
module.exports.hasK8sMetadata = logInvocation(function hasK8sMetadata() {
    utils.debugLog(`[K8S-LOGS] process.env.KUBERNETES_SERVICE_HOST: ${process.env.KUBERNETES_SERVICE_HOST}`);
    return !!(process.env.KUBERNETES_SERVICE_HOST);
});

/**
 * Load K8S metadata and store it
 */
/* eslint-disable-next-line prefer-arrow-callback */
module.exports.loadK8sMetadata = logInvocation(function loadK8sMetadata() {
    if (!k8sHostname) {
        k8sHostname = os.hostname();
    }

    if (!k8sContainerId) {
        try {
            utils.debugLog('[K8S-LOGS] calling readFile on /proc/self/cgroup');

            const data = fs.readFileSync('/proc/self/cgroup');
            const firstLineParts = data.toString('utf-8').split('\n')[0].split('/');

            k8sContainerId = firstLineParts[firstLineParts.length - 1];

            utils.debugLog('[K8S-LOGS] finished loading K8s metadata');
        } catch (err) {
            utils.debugLog('Error loading k8s container id - cannot read cgroup file', err);
        }
    }
});

/**
 * If the current process is running under an ECS container,
 * it will add the task-arn of the current task to the metadata field
 * of the trace, if its not running under ECS the trace will return unchanged
 *
 * @param {Object} runner  runner object to add the metadata
 */
/* eslint-disable-next-line prefer-arrow-callback */
module.exports.addK8sMetadata = logInvocation(function addK8sMetadata(runner) {
    if (!runner || !k8sHostname) return;
    const payload = {
        is_k8s: true,
        k8s_pod_name: k8sHostname,
    };
    if (k8sContainerId) {
        payload.k8s_container_id = k8sContainerId;
    }

    utils.debugLog('[K8S-LOGS] adding K8s metadata to trace');
    eventIterface.addToMetadata(runner, payload);
    utils.debugLog('[K8S-LOGS] finished adding K8s metadata to trace');
});
