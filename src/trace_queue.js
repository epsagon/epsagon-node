/* eslint-disable prefer-destructuring */
/* eslint-disable no-console */
/* eslint-disable valid-jsdoc */
/* eslint-disable require-jsdoc */
const EventEmitter = require('events').EventEmitter;
const axios = require('axios');
const https = require('https');
const http = require('http');
const utils = require('../src/utils.js');
const config = require('./config.js');

class TraceQueue extends EventEmitter {
    constructor(batchSender) {
        super();
        this.batchSize = config.getConfig().batchSize;
        this.traces = [];
        this.batchQueueTime = config.getConfig().batchQueueTime;
        this.batchSender = batchSender;
    }


    /**
   * Checks if max number of traces was reached
   * @returns {Boolean}
   */
    batchSizeReached() {
        return this.traces.length === this.batchSize;
    }

    get currentSize() {
        return this.traces.length;
    }

    flush() {
        this.traces = [];
    }

    /**
   * Push trace to queue, emit event, and check if queue max queue length reached,
   * if it does, send batch.
   * @param {String} trace
   * @returns {TraceQueue}
   */
    push(trace) {
        const timestamp = new Date();
        this.traces.push({ trace, timestamp });
        utils.debugLog(`Trace ${trace} pushed to queue`);
        this.emit('traceQueued', trace);
        if (this.batchSizeReached()) {
            utils.debugLog(`Queue size reached ${this.currentSize}, batch ready! `);
            this.releaseBatch();
        }
        return this;
    }


    /**
   * Release batch of traces
   * @returns {TraceQueue}
   */
    releaseBatch() {
        const batch = [];
        while (batch.length < this.batchSize && !!this.traces.length) {
            batch.push(this.traces.shift().trace);
        }
        utils.debugLog(`Releasing batch size ${batch.length}...`);
        this.emit('batchReleased', batch);
        return this;
    }
}


/**
 * Session for the post requests to the collector
 */
const session = axios.create({
    timeout: config.getConfig().sendTimeout,
    httpAgent: new http.Agent({ keepAlive: true }),
    httpsAgent: new https.Agent({ keepAlive: true }),
});

/**
 * Post given batch to epsagon's infrastructure.
 * @param {*} batchObject The batch data to send.
 * @returns {Promise} a promise that is resolved after the batch is posted.
 */
function postBatch(batchObject) {
    utils.debugLog(`Posting batch to ${config.getConfig().traceCollectorURL}...`);
    utils.debugLog(`Batch: ${JSON.stringify(batchObject, null, 2)}`);

    const cancelTokenSource = axios.CancelToken.source();
    const handle = setTimeout(() => {
        cancelTokenSource.cancel('Timeout sending batch!');
    }, config.getConfig().sendTimeout);

    return session.post(
        config.getConfig().traceCollectorURL,
        batchObject,
        {
            headers: { Authorization: `Bearer ${config.getConfig().token}` },
            timeout: config.getConfig().sendTimeout,
            cancelToken: cancelTokenSource.token,
        }
    ).then((res) => {
        clearTimeout(handle);
        utils.debugLog('Batch posted!');
        return res;
    }).catch((err) => {
        clearTimeout(handle);
        if (err.config && err.config.data) {
            utils.debugLog(`Error sending trace. Batch size: ${err.config.data.length}`);
        } else {
            utils.debugLog(`Error sending trace. Error: ${err}`);
        }
        utils.debugLog(`${err ? err.stack : err}`);
        return err;
    }); // Always resolve.
}

const queue = new TraceQueue(postBatch);


queue.on('batchReleased', (batch) => {
    queue.batchSender(batch);
});


module.exports.getInstance = () => queue;
