const shimmer = require('shimmer');
const fs = require('fs');
const path = require('path');
const tryRequire = require('../try_require');
const utils = require('../utils');
const { LAMBDA_DEFAULT_NODE_MODULES_PATH } = require('../consts');

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
        utils.debugLog('require.resolve.paths is not a function');
        // running in a bundler that doesn't support require.resolve.paths(). e.g. webpack.
        const module = tryRequire(id);
        if (module) {
            modules.push(module);
        }
        return modules;
    }

    const searchPaths = require.resolve.paths(id);
    if (process.env.EPSAGON_ADD_NODE_PATH) {
        searchPaths.push(...process.env.EPSAGON_ADD_NODE_PATH.split(':').map(
            item => path.resolve(item.trim())
        ));
    }
    if (process.env.EPSAGON_AUTO_ADD_NODE_PATHS &&
        process.env.EPSAGON_AUTO_ADD_NODE_PATHS.toUpperCase() === 'TRUE'
    ) {
        const rootFolder = path.dirname(require.main.filename);
        if (!autoNodePaths) {
            autoNodePaths = getAllNodeModulesPaths(rootFolder);
        }
        utils.debugLog('Found the following paths', autoNodePaths);
        autoNodePaths.forEach((nodePath) => {
            if (!searchPaths.includes(nodePath)) {
                searchPaths.push(nodePath);
            }
        });
    }
    if (utils.isLambdaEnv && !searchPaths.includes(LAMBDA_DEFAULT_NODE_MODULES_PATH)) {
        searchPaths.push(LAMBDA_DEFAULT_NODE_MODULES_PATH);
    }

    utils.distinct(searchPaths).forEach((searchPath) => {
        const modulePath = path.resolve(`${searchPath}/${id}`);
        const module = tryRequire(modulePath);

        if (module) {
            utils.debugLog('Loaded module', id, searchPath);
            modules.push(module);
        }
    });
    return modules;
};

const shimmerPatches = [];

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
        const extracted = memberExtractor(module);
        shimmerPatches.push({ id, methodName, module: extracted });
        shimmer.wrap(extracted, methodName, wrapper);
    });
    utils.debugLog('done patching module:', id);
};

/**
 * Patch single module
 * @param {any} module   the module
 * @param {String} methodName    the method to patch
 * @param {Function} wrapper     the wrapper to apply
 */
module.exports.patchSingle = function patchSingle(module, methodName, wrapper) {
    shimmerPatches.push({ id: methodName, methodName, module });
    shimmer.wrap(module, methodName, wrapper);
};

/** Unpatch all modules */
module.exports.unpatchModules = function unpatchModules() {
    console.log('unpatching all modules');

    shimmerPatches.forEach((patch) => {
        console.log(`unpatching ${patch.methodName} from ${patch.id}`);
        shimmer.unwrap(patch.module, patch.methodName);
    });

    console.log('finished unpatching');
};
