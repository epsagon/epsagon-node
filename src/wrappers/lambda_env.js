const tryRequire = require('../try_require.js');
const lambda = require('./lambda.js');
const config = require('../config.js');

/**
 * @return {Function} the user's handler, or an error handler if an
 *     error occurred.
 */
function getUserHandler() {
    const createErrorHandler = err => ((event, context) => {
        context.fail(err);
    });

    const createErrorHandlerWithMessage = (message, err) => ((event, context) => {
        console.log(message); // eslint-disable-line no-console
        context.fail(err);
    });

    const handlerString = process.env.EPSAGON_HANDLER;
    if (!handlerString) {
        return createErrorHandler(new Error(`invalid EPSAGON_HANDLER ${handlerString}`));
    }

    const appParts = handlerString.split('.');
    if (appParts.length !== 2) {
        return createErrorHandler(new Error(`Bad handler ${handlerString}`));
    }

    const modulePath = appParts[0];
    const handlerName = appParts[1];
    try {
        const lambdaTaskRoot = process.env.LAMBDA_TASK_ROOT;
        const moduleFullPath = `${lambdaTaskRoot}/${modulePath}`;
        const app = tryRequire(moduleFullPath);
        const userHandler = app[handlerName];

        if (!userHandler) {
            return createErrorHandler(
                new Error(`Handler '${handlerName}' missing on module '${modulePath}'`)
            );
        }

        return userHandler;
    } catch (e) {
        if (e.code === 'MODULE_NOT_FOUND') {
            return createErrorHandlerWithMessage(
                `Unable to import module '${modulePath}'`,
                e
            );
        }
        if (e instanceof SyntaxError) {
            return createErrorHandlerWithMessage(
                `Syntax error in module '${modulePath}'`,
                e
            );
        }
        return createErrorHandlerWithMessage(
            'module initialization error',
            e
        );
    }
}
const userHandler = getUserHandler();
module.exports.wrapper = config.getConfig().isEpsagonDisabled ? userHandler :
    lambda.lambdaWrapper(userHandler);
