const fs = require('fs');
const tracer = require('../tracer.js');
const moduleUtils = require('./module_utils');
const eventInterface = require('../event.js');

/**
 * Calling to the fs writeFileSync function without callback, And record the error if thrown.
 * @param {Function} original The node fs function.
 * @param {number} startTime Event start time.
 * @param {serverlessEvent.Event} fsEvent FS event.
 * @param {Array} args Array of function arguments.
 * @returns {Object} original function response.
 */
function handleFunctionWithoutCallback(original, startTime, fsEvent, args) {
    try {
        tracer.addEvent(fsEvent);
        return original.apply(this, args);
    } catch (err) {
        eventInterface.finalizeEvent(fsEvent, startTime, err);
        throw err;
    }
}

/**
 * Wrap node fs requset.
 * @param {Function} original The node fs function.
 * @param {Function} originalName The node fs function name.
 * @returns {Function} The wrapped function
 */
function wrapFsWriteFileFunction(original, originalName) {
    return function internalWrapFsWriteFileFunction(file, data, options, callback) {
        const fileName = typeof file === 'object' ? file.toString() : file;
        const fsCallback = typeof (callback || options) === 'function' && (callback || options);
        const { slsEvent: fsEvent, startTime } = eventInterface.initializeEvent('file_system', fileName, originalName, 'file_system');

        eventInterface.addToMetadata(fsEvent, { 'fs.file': fileName });
        if (!!options && typeof options === 'object') {
            eventInterface.addToMetadata(fsEvent, { options });
        }
        if (!fsCallback) {
            return handleFunctionWithoutCallback(original, startTime, fsEvent, [
                fileName,
                data,
                options,
            ]);
        }
        let patchedCallback;
        let clientRequest;
        let clientRequestHasBeenCalled;
        try {
            const responsePromise = new Promise((resolve) => {
                patchedCallback = (err) => {
                    eventInterface.finalizeEvent(fsEvent, startTime, err);
                    resolve();
                    fsCallback(err);
                };
            });
            if (typeof callback === 'function') {
                clientRequestHasBeenCalled = true;
                clientRequest = original.apply(this, [file, data, options, patchedCallback]);
            } else if (typeof options === 'function') {
                clientRequestHasBeenCalled = true;
                clientRequest = original.apply(this, [file, data, patchedCallback]);
            }
            tracer.addEvent(fsEvent, responsePromise);
        } catch (err) {
            tracer.addException(err);
        }

        return clientRequest || clientRequestHasBeenCalled ?
            clientRequest :
            original.apply(this, [file, data, options, callback]);
    };
}

module.exports = {
    /**
     * Patch Node fs methods.
     * process.env.EPSAGON_FS_INSTRUMENTATION=true is requird.
     */
    init() {
        if ((process.env.EPSAGON_FS_INSTRUMENTATION || '').toUpperCase() === 'TRUE') {
            moduleUtils.patchSingle(fs, 'writeFile', () => wrapFsWriteFileFunction(fs.writeFile, 'writeFile'));
            moduleUtils.patchSingle(fs, 'writeFileSync', () => wrapFsWriteFileFunction(fs.writeFileSync, 'writeFileSync'));
        }
    },
};
