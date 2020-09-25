const shimmer = require('shimmer');
const fs = require('fs');
const path = require('path');
const tryRequire = require('../try_require');
const utils = require('../utils');

let autoNodePaths;
/**
 * finds recursively all node_modules sub folders.
 * @param {String} dirPath the root folder to start searching.
 * @param {Array} arrayOfNodeModulesPaths array of the founded node_modules paths.
 * @return {Array} an array of all the founded node_modules sub folders paths
 */
const getAllNodeModulesPaths = (dirPath, arrayOfNodeModulesPaths = []) => {
    let arrayOfNodeModulesPathsCopied = arrayOfNodeModulesPaths;
    const files = fs.readdirSync(dirPath);
    files.forEach((file) => {
        if (fs.statSync(`${dirPath}/${file}`).isDirectory()) {
            if (file === 'node_modules') {
                arrayOfNodeModulesPathsCopied.push(path.join(dirPath, file));
            } else {
                arrayOfNodeModulesPathsCopied = getAllNodeModulesPaths(`${dirPath}/${file}`, arrayOfNodeModulesPathsCopied);
            }
        }
    });
    return arrayOfNodeModulesPathsCopied;
};

/**
 * finds all the instances of a module in the NODE_PATH
 * @param {String} id the id of the module to load
 * @return {Array} an array of all the module instances in the PATH
 */
module.exports.getModules = function getModules(id) {
    const modules = [];
    if (typeof require.resolve.paths !== 'function') {
        // running in a bundler that doesn't support require.resolve.paths(). e.g. webpack.
        const module = tryRequire(id);
        if (module) {
            modules.push(module);
        }
        return modules;
    }

    const searchPaths = require.resolve.paths(id);
    if (process.env.EPSAGON_ADD_NODE_PATH) {
        searchPaths.push(...process.env.EPSAGON_ADD_NODE_PATH.split(':').map(item => item.trim()));
    }
    if (process.env.EPSAGON_AUTO_ADD_NODE_PATHS &&
        process.env.EPSAGON_AUTO_ADD_NODE_PATHS.toUpperCase() === 'TRUE'
    ) {
        const rootFolder = path.dirname(require.main.filename);
        if (!autoNodePaths) {
            autoNodePaths = getAllNodeModulesPaths(rootFolder);
        }
        autoNodePaths.forEach((nodePath) => {
            if (!searchPaths.includes(nodePath)) {
                searchPaths.push(nodePath);
            }
        });
    }
    searchPaths.forEach((searchPath) => {
        const module = tryRequire(`${searchPath}/${id}`);
        if (module) {
            modules.push(module);
        }
    });
    return modules;
};

/**
 * Patches all instances of a module
 * @param {String} id The module id
 * @param {String} methodName the method name
 * @param {Function} wrapper The wrapper function
 * @param {Function} memberExtractor Extracts the wrapped member from the module
 */
module.exports.patchModule = function patchModule(
    id,
    methodName,
    wrapper,
    memberExtractor = (mod => mod)
) {
    utils.debugLog('patching module:', id);
    const modules = module.exports.getModules(id);
    utils.debugLog('found module copies:', modules.length);
    modules.forEach((module) => {
        shimmer.wrap(
            memberExtractor(module),
            methodName,
            wrapper
        );
    });
    utils.debugLog('done patching module:', id);
};
