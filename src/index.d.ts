// epsagon.d.ts
declare module 'epsagon' {
  import 'aws-lambda'

  export function init(options: {
    token: string
    appName: string
    metadataOnly?: boolean
    useSSL?: boolean
    traceCollectorURL?: string
    isEpsagonDisabled?: boolean
    urlPatternsToIgnore?: string[]
    ignoredKeys?: string[]
    labels?: string[][]
    sendOnlyErrors?: boolean
    sendTimeout?: number
    decodeHTTP?: boolean
    disableHttpResponseBodyCapture?: boolean
    loggingTracingEnabled?: boolean
    sendBatch?: boolean
    maxTraceWait?: number
    batchSize?: number
    maxBatchSizeBytes?: number
  }): void
  export function label(key: string, value: string): void
  export function unpatch(): void
  export function setError(error: Error): void
  export function setWarning(error: Error): void
  export function getTraceUrl(): string
  export function lambdaWrapper<T extends Function>(f: T): T
  export function stepLambdaWrapper<T extends Function>(f: T): T
  export function openWhiskWrapper<T extends Function>(f: T): T
  export function nodeWrapper<T extends Function>(f: T): T
  export function wrapBatchJob(): void
  export function enable(): void
  export function disable(): void
}
