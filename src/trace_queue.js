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
    utils.debugLog(`[QUEUE] Posting batch to ${config.getConfig().traceCollectorURL}...`);
    utils.debugLog(`[QUEUE] Batch: ${JSON.stringify(batchObject, null, 2)}`);

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
        utils.debugLog('[QUEUE] Batch posted!');
        return res;
    }).catch((err) => {
        clearTimeout(handle);
        if (err.config && err.config.data) {
            utils.debugLog(`[QUEUE] Error sending trace. Batch size: ${err.config.data.length}`);
        } else {
            utils.debugLog(`[QUEUE] Error sending trace. Error: ${err}`);
        }
        utils.debugLog(`[QUEUE] ${err ? err.stack : err}`);
        return err;
    });
}


class TraceQueue extends EventEmitter {
    constructor() {
        super();
        this.batchSender = postBatch;
        this.traces = [];
        this.updateConfig();
        this.initQueue();
    }

    updateConfig() {
        this.maxTraceWait = config.getConfig().maxTraceWait;
        this.maxBatchSizeBytes = config.getConfig().maxBatchSizeBytes;
        this.batchSize = config.getConfig().batchSize;
    }

    /**
   * Init queue event listners
   */
    initQueue() {
        this.removeAllListeners();
        this.currentByteSize = 0;
        this.flush();
        this.on('traceQueued', () => {
            if (this.byteSizeLimitReached()) {
                utils.debugLog(`[QUEUE] Queue Byte size reached ${this.currentByteSize} Bytes, releasing batch...`);
                this.releaseBatch(this.currentSize - 1);
            } else if (this.batchSizeReached()) {
                utils.debugLog(`[QUEUE] Queue size reached ${this.currentSize}, releasing batch... `);
                this.releaseBatch();
            }
        });

        this.on('batchReleased', (batch) => {
            utils.debugLog(`[QUEUE] Queue Byte size reached ${this.currentByteSize} Bytes, releasing batch...`);
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
        return this.currentByteSize >= this.maxBatchSizeBytes;
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
        try {
            const timestamp = new Date();
            this.traces.push({ trace, timestamp });
            utils.debugLog('[QUEUE] Trace pushed to queue!');
            this.addToCurrentByteSize(trace);
            utils.debugLog(`[QUEUE] Queue size: ${this.currentSize} traces, total size of ${this.currentByteSize} Bytes`);
            this.emit('traceQueued', trace);
        } catch (err) {
            utils.debugLog(`[QUEUE] Failed pushing trace to queue: ${JSON.stringify(trace)}`);
            this.emit('QueueFailed', trace);
            utils.debugLog(`[QUEUE] ${err}`);
        }
        return this;
    }


    /**
   * Release batch of traces
   * @returns {TraceQueue}
   */
    releaseBatch(count = this.batchSize) {
        try {
            const batch = [];
            utils.debugLog(`[QUEUE] Releasing batch - (${count} traces)...`);
            while (batch.length < count && !!this.traces.length) {
                const shiftedTrace = this.traces.shift().trace;
                batch.push(shiftedTrace);
                this.subtractFromCurrentByteSize(shiftedTrace);
            }
            this.emit('batchReleased', batch);
        } catch (err) {
            utils.debugLog('[QUEUE] Failed releasing batch!');
            this.emit('ReleaseFailed');
            utils.debugLog(`[QUEUE] ${err}`);
        }
        return this;
    }
}


module.exports.getInstance = () => new TraceQueue();
