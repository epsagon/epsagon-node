module.exports.VERSION = require('../package.json').version;

const DEFAULT_REGION = 'us-east-1';
let REGION = process.env.AWS_REGION;

// Check that we got region from env.
if (REGION === undefined) {
    REGION = DEFAULT_REGION;
}

module.exports.REGION = REGION;
module.exports.LOCAL_URL = 'http://localhost:3000';
module.exports.TRACE_COLLECTOR_URL = `https://${REGION}.tc.epsagon.com`;

module.exports.COLD_START = true;

/**
 * The identifier of the injected step data in the step machine result dict
 */
module.exports.STEP_ID_NAME = 'Epsagon';

module.exports.EPSAGON_EVENT_ID_KEY = '_epsagon_event_id';

module.exports.MAX_VALUE_CHARS = 3 * 1024;

module.exports.MAX_LABEL_SIZE = 10 * 1024;

module.exports.MAX_HTTP_VALUE_SIZE = 10 * 1024;

module.exports.MAX_TRACE_SIZE_BYTES = 64 * 1024;

module.exports.DEFAULT_SAMPLE_RATE = 1;

// Key name to inject epsagon correlation ID
module.exports.EPSAGON_HEADER = 'epsagon-trace-id';

// In some cases we manually add the Lambda node_modules path, where it is not found by default
module.exports.LAMBDA_DEFAULT_NODE_MODULES_PATH = '/var/task/node_modules';

module.exports.STRONG_ID_KEYS = [
    'key',
    'request_id',
    'requestid',
    'request-id',
    'steps_dict',
    'message_id',
    'etag',
    'item_hash',
    'sequence_number',
    'trace_id',
    'job_id',
    'activation_id',
    'http_trace_id',
    'id',
    'aws.sqs.message_id',
    'x-amz-request-id',
    'object_key',
    'object_etag',
    'aws.requestId',
    'aws.s3.key',
    'aws.s3.etag',
    'aws.kinesis.sequence_number',
    'request_trace_id',
    'logging_tracing_enabled',
    'CLOUDWATCH_LOG_GROUP_NAME',
    'CLOUDWATCH_LOG_STREAM_NAME',
    'log_stream_name',
    'log_group_name',
    'function_version',
    'memory',
    'aws_account',
    'cold_start',
    'region',
    'status_code',

];

module.exports.traceUrl = (id, requestTime) => `https://app.epsagon.com/trace/${id}?timestamp=${requestTime}`;
module.exports.lambdaTraceUrl = (awsAccount, region, functionName, requestId, requestTime) => `https://app.epsagon.com/functions/${awsAccount}/${region}/${functionName}?requestId=${requestId}&requestTime=${requestTime}`;
