let lastError = null;

const tryRequire = (id) => {
    try {
        // eslint-disable-next-line global-require,import/no-dynamic-require
        return require(id);
    } catch (e) {
        lastError = e;
    }

    return undefined;
};

tryRequire.lastError = () => lastError;

module.exports = tryRequire;
