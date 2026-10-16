/**
 * {@link initWorker}'s options.
 * @template T the worker's message data
 * @internal
 */
export type InitWorkerOptions<T> = {
  /** The worker's constructor (a Vite `?worker` import's default). */
  WorkerClass: new (options?: { name?: string }) => Worker;
  /** The worker's name (devtools, the error messages). */
  name: string;
  /** The worker's messages after the handshake. Leave it out when the caller listens itself once
   * this resolves (a transport's `addEventListener`, eg. physics'). */
  onMessage?: (event: MessageEvent<T>) => void;
  /** The worker's errors after the handshake. */
  onError: (err: ErrorEvent) => void;
  /** The handshake's status. Default `'INIT_READY'`. */
  statusReadyString?: string;
  /** Called with the handshake message's data (an object-style message can carry the worker's
   * capabilities along with its `status`). */
  onReady?: (data: unknown) => void;
  /** Rejects (and terminates the worker) when the handshake doesn't arrive in time. Default: no
   * limit. */
  timeoutMs?: number;
};

/**
 * Starts a worker and resolves with it once its handshake arrives: the worker's top-level code
 * posts `{ status: 'INIT_READY' }` (or the string itself; `statusReadyString` changes it). Until
 * then a worker error rejects, and after it `onMessage` and `onError` take over. A failed or
 * timed out handshake terminates the worker.
 * @template T the worker's message data
 * @internal
 */
export const initWorker = async <T>({
  WorkerClass,
  name,
  onMessage,
  onError,
  statusReadyString = 'INIT_READY',
  onReady,
  timeoutMs,
}: InitWorkerOptions<T>): Promise<Worker> => {
  const worker = new WorkerClass({ name });
  return new Promise((resolve, reject) => {
    const timeoutId =
      timeoutMs && timeoutMs > 0
        ? setTimeout(() => {
            worker.terminate();
            reject(new Error(`[${name}] Setup Error: no handshake in ${timeoutMs}ms.`));
          }, timeoutMs)
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
        onReady?.(event.data);
        // Setup long-term message and error handlers
        worker.onmessage = onMessage ?? null;
        worker.onerror = onError;
        resolve(worker);
      }
    };
  });
};
