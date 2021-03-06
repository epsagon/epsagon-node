const zlib = require('zlib');
const uuid4 = require('uuid4');
const uuidParse = require('uuid-parse');
const config = require('../config.js');
const eventInterface = require('../event.js');
const utils = require('../utils.js');
const { MAX_HTTP_VALUE_SIZE } = require('../consts.js');

const URL_BLACKLIST = {
    'tc.epsagon.com': 'endsWith',
    'oauth2.googleapis.com': 'endsWith',
    'amazonaws.com':
        (url, pattern) => (url.endsWith(pattern) || url.endsWith(`${pattern}:443`)) &&
            (url.indexOf('.execute-api.') === -1) &&
            (url.indexOf('.es.') === -1) &&
            (url.indexOf('.elb.') === -1) &&
            (url.indexOf('.appsync-api.') === -1),
    'blob.core.windows.net': 'endsWith',
    'myqcloud.com': 'endsWith',
    'documents.azure.com': 'endsWith',
    '127.0.0.1': (url, pattern, path) => (url === pattern) && path.startsWith('/2018-06-01/runtime/invocation/'),
    '169.254.169.254': 'startsWith', // EC2 document ip. Have better filtering in the future
};


// Brotli decompression exists since Node v10
const ENCODING_FUNCTIONS = {
    br: zlib.brotliDecompressSync,
    brotli: zlib.brotliDecompressSync,
    gzip: zlib.gunzipSync,
    deflate: zlib.deflateSync,
};

const USER_AGENTS_BLACKLIST = ['openwhisk-client-js'];

/**
 * Checks if a URL is in the user-defined blacklist.
 * @param {string} url The URL to check
 * @returns {boolean} True if it is in the user-defined blacklist, False otherwise.
 */
function isURLIgnoredByUser(url) {
    return config.getConfig().urlPatternsToIgnore.some(pattern => url.includes(pattern));
}


/**
 * Set the duration of the event, and resolves the promise using the given function.
 * @param {object} httpEvent The current event
 * @param {Function} resolveFunction Function that will be used to resolve the promise
 * @param {integer} startTime The time the event started at
 */
function resolveHttpPromise(httpEvent, resolveFunction, startTime) {
    httpEvent.setDuration(utils.createDurationTimestamp(startTime));
    resolveFunction();
}


/**
 * Attempts to json parse the data and set it at key on the event's metadata.
 * @param {object} httpEvent The current event
 * @param {string} key name in metadata
 * @param {string} data data to jsonify
 * @param {string} encoding data encoding from the headers
 */
function setJsonPayload(httpEvent, key, data, encoding) {
    try {
        let decodedData = data;
        if (config.getConfig().decodeHTTP && ENCODING_FUNCTIONS[encoding]) {
            try {
                decodedData = ENCODING_FUNCTIONS[encoding](data);
            } catch (err) {
                utils.debugLog(`Could decode ${key} with ${encoding} in http`);
            }
        }
        const jsonData = decodedData;
        try {
            JSON.parse(jsonData);
            eventInterface.addToMetadata(httpEvent, {}, {
                [key]: jsonData.toString(),
            });
        } catch (err) {
            utils.debugLog(`Could not parse JSON ${key} in http`);
            eventInterface.addToMetadata(httpEvent, {}, {
                [key]: decodedData.toString('utf-8'),
            });
        }
    } catch (err) {
        utils.debugLog(`Could not decode data and parse JSON ${key} in http`);
        eventInterface.addToMetadata(httpEvent, {}, {
            [key]: data,
        });
    }
}


/**
 * Return UUID in hex string.
 * @param {string} uuid uuid object.
 * @returns {string} UUID in hex.
 */
function UUIDToHex(uuid) {
    const uuidBuffer = Buffer.alloc(16);
    uuidParse.parse(uuid, uuidBuffer);
    return uuidBuffer.toString('hex');
}


/**
 * Return an Epsagon trace ID to put in the request headers.
 * @returns {string} Epsagon trace id.
 */
function generateEpsagonTraceId() {
    const hexTraceId = UUIDToHex(uuid4());
    const spanId = UUIDToHex(uuid4()).slice(16);
    const parentSpanId = UUIDToHex(uuid4()).slice(16);

    return `${hexTraceId}:${spanId}:${parentSpanId}:1`;
}


/**
 * Checks if API Gateway details appear in the headers, and update event accordingly
 * @param {object} headers data
 * @param {Event} httpEvent object
 */
function updateAPIGateway(headers, httpEvent) {
    if (headers && 'x-amzn-requestid' in headers) {
        // This is a request to AWS API Gateway
        httpEvent.getResource().setType('api_gateway');
        eventInterface.addToMetadata(httpEvent, {
            request_trace_id: headers['x-amzn-requestid'],
        });
    }
}


/**
 * Adding HTTP response chunks into the array, according to the constraints
 * @param {Object} chunk the part in String or Buffer
 * @param {Array} chunks array of chunks
 */
function addChunk(chunk, chunks) {
    if (chunk) {
        const totalSize = chunks.reduce((total, item) => item.length + total, 0);
        if (totalSize + chunk.length <= MAX_HTTP_VALUE_SIZE) {
            chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        }
    }
}

module.exports = {
    isURLIgnoredByUser,
    resolveHttpPromise,
    USER_AGENTS_BLACKLIST,
    URL_BLACKLIST,
    generateEpsagonTraceId,
    updateAPIGateway,
    setJsonPayload,
    addChunk,
};
