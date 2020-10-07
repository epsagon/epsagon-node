/* eslint-disable prefer-destructuring */
/* eslint-disable no-console */
/* eslint-disable valid-jsdoc */
/* eslint-disable require-jsdoc */
const EventEmitter = require('events').EventEmitter;

class TraceQueue extends EventEmitter {
    constructor() {
        super();
        this.batchSize = 5;
        this.traces = [];
        this.timeToRelease = 5000;
    }

    /**
   * Checks if max number of traces was reached
   * @returns {Boolean}
   */
    batchSizeReached() {
        return this.traces.length === this.batchSize;
    }

    get length() {
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
        // console.log(`Queue before push: [${this.traces}]`);
        const timestamp = new Date();
        this.traces.push({ trace, timestamp });
        console.log(`Trace ${trace} pushed to queue`);
        this.emit('traceQueued', trace);
        if (this.batchSizeReached()) {
            console.log(`Queue size reached ${this.traces.length}, Batch ready! `);
            this.emit('batchReady');
            this.sendBatch();
        }

        return this;
    }


    /**
   * Release batch of traces for sending to trace collector
   * @returns {TraceQueue}
   */
    sendBatch() {
        const batch = [];
        while (batch.length < this.batchSize && !!this.traces.length) {
            batch.push(this.traces.shift().trace);
        }
        console.log(`Sending batch : [${batch}]`);
        this.emit('sendingBatch', batch);

        setTimeout(() => {
            console.log(`Batch sent successfully: [${batch}]`);
            this.emit('batchSent', batch);
        }, 3000);


        return this;
    }
}


module.exports = new TraceQueue();
