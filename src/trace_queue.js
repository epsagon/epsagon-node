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
const session = axios.create({
    headers: { Authorization: `Bearer ${config.getConfig().token}` },
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
    const cancelTokenSource = axios.CancelToken.source();
    const handle = setTimeout(() => {
        cancelTokenSource.cancel('Timeout sending batch!');
    }, config.getConfig().sendTimeout);

    return session.post(
        config.getConfig().traceCollectorURL,
        batchObject,
        {
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
        this.initQueue();
    }

    // TODO: case where sending batch exceedes batch byte size limit
    /**
   * Batch release interval
   */
    initReleaseInterval() {
        this.releaseInterval = setInterval(() => {
            if (this.currentSize > 0) this.emit('releaseRequest');
        }, this.maxTraceWait);
    }

    /**
   * Update the queue config
   */
    updateConfig() {
        this.maxTraceWait = config.getConfig().maxTraceWait;
        this.maxBatchSizeBytes = config.getConfig().maxBatchSizeBytes;
        this.batchSize = config.getConfig().batchSize;
        this.maxQueueSizeBytes = config.getConfig().maxQueueSizeBytes;
        clearInterval(this.releaseInterval);
    }

    /**
   * Init queue event listners
   */
    initQueue() {
        this.updateConfig();
        this.removeAllListeners();
        this.flush();
        this.initReleaseInterval();
        this.on('traceQueued', () => {
            if (this.byteSizeLimitReached()) {
                utils.debugLog(`[QUEUE] Queue Byte size reached ${this.currentByteSize} Bytes, releasing batch...`);
                this.emit('releaseRequest', Math.max(this.currentSize - 1, 1));
            } else if (this.batchSizeReached()) {
                utils.debugLog(`[QUEUE] Queue size reached ${this.currentSize}, releasing batch... `);
                this.emit('releaseRequest');
            }
            return this;
        });

        this.on('releaseRequest', (count = this.batchSize) => {
            try {
                const batch = this.queue.splice(0, count);
                utils.debugLog('[QUEUE] Releasing batch...');
                this.subtractFromCurrentByteSize(batch);
                this.emit('batchReleased', batch);
            } catch (err) {
                utils.debugLog('[QUEUE] Failed releasing batch!');
                utils.debugLog(`[QUEUE] ${err}`);
            }
            return this;
        });

        this.on('batchReleased', (batch) => {
            utils.debugLog('[QUEUE] Sending batch...');
            const batchJSON = batch.map(trace => trace.traceJSON);
            this.batchSender(batchJSON);
            this.emit('batchSent', batch);
        });
        process.on('exit', () => this.emit('releaseRequest'));
    }

    /**
     * Push trace to queue, emit event, and check if queue max queue length reached,
     * if it does, send batch.
     * @param {object} traceJson Trace JSON
     * @returns {TraceQueue} This trace queue
     */
    push(traceJson) {
        try {
            if (this.currentByteSize >= this.maxQueueSizeBytes) {
                utils.debugLog(`[QUEUE] Discardig trace, queue size reached max size of ${this.currentByteSize} Bytes`);
                return this;
            }
            const timestamp = Date.now();
            const json = traceJson;
            const string = JSON.stringify(json);
            const byteLength = string.length;
            // eslint-disable-next-line object-curly-newline
            const trace = { json, string, byteLength, timestamp };
            this.queue.push(trace);
            this.addToCurrentByteSize([trace]);
            utils.debugLog(`[QUEUE] Trace size ${byteLength} Bytes pushed to queue: ${string}`);
            utils.debugLog(`[QUEUE] Queue size: ${this.currentSize} traces, total size of ${this.currentByteSize} Bytes`);
            this.emit('traceQueued', trace);
        } catch (err) {
            utils.debugLog(`[QUEUE] Failed pushing trace to queue: ${err}`);
        }
        return this;
    }

    /**
    * add given trace byte size to total byte size
    * @param {Array} traces  Trace object array
    */
    addToCurrentByteSize(traces) {
        traces.forEach((trace) => {
            this.currentByteSize += trace.byteLength;
        });
    }

    /**
    * subtract given trace byte size to total byte size
    * @param {Array} traces Trace object array
    */
    subtractFromCurrentByteSize(traces) {
        traces.forEach((trace) => {
            this.currentByteSize -= trace.byteLength;
            this.currentByteSize = Math.max(this.currentByteSize, 0);
        });
    }

    /**
   * Queue size getter
   * @returns {Number} Queue length
   */
    get currentSize() {
        return this.queue.length;
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
   * Flush queue
   */
    flush() {
        this.queue = [];
        this.currentByteSize = 0;
    }
}


module.exports.getInstance = () => new TraceQueue();
