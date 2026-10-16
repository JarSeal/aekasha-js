import type { PhysicsTransport } from './PhysicsTransport';

/**
 * The main thread's side of the physics worker's channel ({@link PhysicsTransport}), around a
 * started `Worker` (`initWorker`'s, after the handshake). `close()` terminates the worker.
 * @template Out the messages sent to the worker
 * @template In the messages the worker sends
 * @internal
 */
export const createWorkerTransport = <Out, In>(worker: Worker): PhysicsTransport<Out, In> => {
  const listeners = new Set<(message: In) => void>();
  let isClosed = false;
  const onWorkerMessage = (event: MessageEvent<In>) => {
    for (const fn of listeners) fn(event.data);
  };
  worker.addEventListener('message', onWorkerMessage);
  return {
    send: (message, transfer) => {
      if (isClosed) return;
      if (transfer) worker.postMessage(message, transfer);
      else worker.postMessage(message);
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
      worker.removeEventListener('message', onWorkerMessage);
      worker.terminate();
    },
  };
};
