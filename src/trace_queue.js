/**
 * @fileoverview The traces queue, cunsume traces and sends in batches
 */
const EventEmitter = require('events');
const axios = require('axios');
const https = require('https');
const http = require('http');
const utils = require('../src/utils.js');
const config = require('./config.js');


/**
 * Session for the post requests to the collector
 */
// TODO: add token on header
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

/**
 * The trace queue class
 * @param {function} batchSender function to send batch traces
 */
class TraceQueue extends EventEmitter.EventEmitter {
    /**
     * EventEmitter class
     */
    constructor() {
        super();
        this.batchSender = postBatch;
        this.traces = [];
        this.updateConfig();
        this.initQueue();
    }

    /**
   * Update the queue config
   */
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
                this.releaseBatch(Math.max(this.currentSize - 1, 1));
            } else if (this.batchSizeReached()) {
                utils.debugLog(`[QUEUE] Queue size reached ${this.currentSize}, releasing batch... `);
                this.releaseBatch();
            }
        });

        this.on('batchReleased', (batch) => {
            utils.debugLog('[QUEUE] Sending batch...');
            this.batchSender(batch);
            this.emit('batchSent', batch);
        });
    }

    /**
   * Queue size getter
   * @returns {Number} Queue length
   */
    get currentSize() {
        return this.traces.length;
    }


    /**
   * Checks if queue size reached batch size
   * @returns {Boolean} Indicator for if current queue size is larger than batch size definition
   */
    batchSizeReached() {
        return this.currentSize >= this.batchSize;
    }

    /**
   * Checks if queue byte size reached its limit
   * @returns {Boolean} Indicator for if current queue byte size is larger than byte size definition
   */
    byteSizeLimitReached() {
        return this.currentByteSize >= this.maxBatchSizeBytes;
    }

    /**
   * add given trace byte size to total byte size
   * @param {object} trace Trace object
   */
    addToCurrentByteSize(trace) {
        this.currentByteSize += JSON.stringify(trace).length;
    }

    /**
   * subtract given trace byte size to total byte size
   * @param {object} trace Trace object
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
   * @param {object} trace Trace object
   * @returns {TraceQueue} This trace queue
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
   * @param {Number} count amount of traces to release from queue
   * @returns {TraceQueue} This trace queue
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
