let lastError = null;

const tryRequire = (id, req) => {
    let path;
    const currentRequire = req || require;

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
