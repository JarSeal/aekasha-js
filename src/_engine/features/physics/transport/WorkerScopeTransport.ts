import type { PhysicsTransport } from './PhysicsTransport';

/**
 * What the worker's side needs of its global scope (a dedicated worker's `self`): a test hands a
 * stand-in.
 * @internal
 */
export type WorkerScope = {
  /** Sends to the main thread, handing `transfer`'s buffers over. */
  postMessage(message: unknown, transfer?: Transferable[]): void;
  /** Listens to the main thread's messages. */
  addEventListener(type: 'message', fn: (event: MessageEvent) => void): void;
  /** Stops listening (`close()`). */
  removeEventListener(type: 'message', fn: (event: MessageEvent) => void): void;
};

/**
 * The physics worker's side of its channel ({@link PhysicsTransport}), around the worker's
 * global scope (`self` by default, read when called, never at load). `close()` stops this side
 * only: the main thread owns the worker and terminates it.
 * @template Out the messages sent to the main thread
 * @template In the messages the main thread sends
 * @internal
 */
export const createWorkerScopeTransport = <Out, In>(
  scope: WorkerScope = self as unknown as WorkerScope
): PhysicsTransport<Out, In> => {
  const listeners = new Set<(message: In) => void>();
  let isClosed = false;
  const onScopeMessage = (event: MessageEvent<In>) => {
    for (const fn of listeners) fn(event.data);
  };
  scope.addEventListener('message', onScopeMessage);
  return {
    send: (message, transfer) => {
      if (isClosed) return;
      if (transfer) scope.postMessage(message, transfer);
      else scope.postMessage(message);
    },
    onMessage: (fn) => {
      // A Set dedupes, so wrap: the same function added twice is two listeners, each removable
      const listener = (message: In) => fn(message);
      if (!isClosed) listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => {
      if (isClosed) return;
      isClosed = true;
      listeners.clear();
      scope.removeEventListener('message', onScopeMessage);
    },
  };
};
