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
    labels?: string[]
    sendOnlyErrors?: boolean
    sendTimeout?: number
    decodeHTTP?: boolean
    disableHttpResponseBodyCapture?: boolean
    loggingTracingEnabled?: boolean
  }): void
  export function label(key: string, value: string): void
  export function setError(error: Error): void
  export function getTraceUrl(): string
  export function lambdaWrapper<T extends Function>(f: T): T
  export function stepLambdaWrapper<T extends Function>(f: T): T
  export function openWhiskWrapper<T extends Function>(f: T): T
  export function nodeWrapper<T extends Function>(f: T): T
  export function wrapBatchJob<T extends Function>(f: T): T
}
