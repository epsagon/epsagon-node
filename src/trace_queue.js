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
const consts = require('./consts.js');


class TraceQueue extends EventEmitter {
    constructor(batchSender) {
        super();
        this.batchSize = config.getConfig().batchSize;
        this.batchBytesLimit = consts.batchBytesLimit;
        this.traces = [];
        this.batchQueueTime = config.getConfig().batchQueueTime;
        this.batchSender = batchSender;
        this.currentByteSize = 0;
        this.initQueue();
    }

    /**
   * Init queue event listners
   */
    initQueue() {
        this.removeAllListeners();
        this.currentByteSize = 0;
        this.flush();
        //  check if queue reached batch size
        this.on('traceQueued', () => {
            if (this.batchSizeReached()) {
                utils.debugLog(`Queue size reached ${this.currentSize}, batch ready! Releasing... `);
                this.releaseBatch();
            }
        });

        // update queue size in bytes + check if limit reached
        this.on('traceQueued', (trace) => {
            this.addToCurrentByteSize(trace);
            if (this.byteSizeLimitReached()) {
                utils.debugLog(`Queue byte size reached ${this.currentByteSize} Bytes, releasing batch... `);
                this.releaseBatch(this.batchSize - 1);
            }
        });

        this.on('batchReleased', (batch) => {
            this.batchSender(batch);
            this.emit('batchSent', batch);
        });
    }

    /**
   * Queue size getter
   * @returns {Number}
   */
    get currentSize() {
        return this.traces.length;
    }


    /**
   * Checks if queue size reached batch size
   * @returns {Boolean}
   */
    batchSizeReached() {
        return this.currentSize === this.batchSize;
    }

    /**
   * Checks if queue byte size reached its limit
   * @returns {Boolean}
   */
    byteSizeLimitReached() {
        return this.currentByteSize >= this.batchBytesLimit;
    }

    /**
   * add given trace byte size to total byte size
   * @returns {Number}
   */
    addToCurrentByteSize(trace) {
        this.currentByteSize += JSON.stringify(trace).length;
    }

    /**
   * subtract given trace byte size to total byte size
   * @returns {Number}
   */
    subtractFromCurrentByteSize(trace) {
        this.currentByteSize -= JSON.stringify(trace).length;
        this.currentByteSize = Math.max(this.currentByteSize, 0);
    }

    /**
   * Flush queue
   */
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
        return this;
    }


    /**
   * Release batch of traces
   * @returns {TraceQueue}
   */
    releaseBatch(count = this.batchSize) {
        const batch = [];
        utils.debugLog(`Releasing batch size ${count}...`);
        while (batch.length < count && !!this.traces.length) {
            const shiftedTrace = this.traces.shift().trace;
            batch.push(shiftedTrace);
            this.subtractFromCurrentByteSize(shiftedTrace);
        }
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
    });
}

const queue = new TraceQueue(postBatch);


module.exports.getInstance = () => queue;
