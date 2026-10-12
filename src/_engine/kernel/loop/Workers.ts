/**
 * Initializes and returns a new worker with a validated handshake. The handshake
 * is expecting a top-level message from the worker on script initialization:
 *
 * `self.postMessage({ status: 'INIT_READY' });` or `self.postMessage('INIT_READY');`
 *
 * The default status message is 'INIT_READY', but it can be overwritten with
 * `statusReadyString` in the initWorker call. Make sure the worker top-level message
 * then matches the `statusReadyString`.
 *
 * Instead of the `statusReadyString`, an options object can be given:
 * - `statusReadyString`: same as above.
 * - `onReady`: receives the handshake message's data (eg. an object-style message can carry
 *   the worker's capabilities along with its `status`).
 * - `timeoutMs`: rejects (and terminates the worker) if the handshake doesn't arrive in time.
 *
 * On a failed or timed out handshake, the worker is terminated.
 */
export const initWorker = async <T>(
  WorkerClass: new (options?: { name?: string }) => Worker,
  name: string,
  onMessage: (event: MessageEvent<T>) => void,
  onError: (err: ErrorEvent) => void,
  statusReadyStringOrOpts:
    | string
    | {
        statusReadyString?: string;
        onReady?: (data: unknown) => void;
        timeoutMs?: number;
      } = 'INIT_READY'
): Promise<Worker> => {
  const opts =
    typeof statusReadyStringOrOpts === 'string'
      ? { statusReadyString: statusReadyStringOrOpts }
      : statusReadyStringOrOpts;
  const statusReadyString = opts.statusReadyString || 'INIT_READY';
  const worker = new WorkerClass({ name });
  return new Promise((resolve, reject) => {
    const timeoutId =
      opts.timeoutMs && opts.timeoutMs > 0
        ? setTimeout(() => {
            worker.terminate();
            reject(new Error(`[${name}] Setup Error: no handshake in ${opts.timeoutMs}ms.`));
          }, opts.timeoutMs)
        : undefined;
    // Setup temporary error handler for boot-up failures
    worker.onerror = (err) => {
      clearTimeout(timeoutId);
      worker.terminate();
      reject(new Error(`[${name}] Setup Error: ${err.message}`));
    };
    // Setup temporary message handler for the handshake
    worker.onmessage = (event: MessageEvent<string | { status: string }>) => {
      // Check for both object-style and string-style messages for flexibility
      const status = typeof event.data === 'string' ? event.data : event.data.status;
      if (status === statusReadyString) {
        clearTimeout(timeoutId);
        opts.onReady?.(event.data);
        // Setup long-term message and error handlers
        worker.onmessage = onMessage;
        worker.onerror = onError;
        resolve(worker);
      }
    };
  });
};

/**
 * Checks whether the current function is running in the main thread or in a worker.
 * There is also a faster (simpler) version for this check: {@link isMainThreadSimple}().
 * @returns boolean
 */
export const isMainThread = () =>
  typeof window === 'object' && typeof document === 'object' && window.document === document;

/**
 * Checks whether the current function is running in the main thread or in a worker.
 * This is the faster (simpler version for this check). There is also a more
 * comprehensive version for this check: {@link isMainThread}().
 * @returns boolean
 */
export const isMainThreadSimple = () => typeof window !== 'undefined';
