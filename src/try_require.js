let lastError = null;

const tryRequire = (id) => {
    let path;
    // for webpack we only support requiring external packages
    const currentRequire = (
        typeof __webpack_require__ === 'function' ? // eslint-disable-line camelcase
            __non_webpack_require__ : require // eslint-disable-line no-undef, camelcase
    );

    try {
        path = currentRequire.resolve(id);

        lastError = null;
    } catch (e) {
        lastError = e;
    }

    if (path) {
        try {
            return currentRequire(path);
        } catch (e) {
            lastError = e;
        }
    }

    return undefined;
};

tryRequire.lastError = () => lastError;

module.exports = tryRequire;
