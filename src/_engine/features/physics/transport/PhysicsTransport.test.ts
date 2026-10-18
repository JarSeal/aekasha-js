import { describe, expect, it } from 'vitest';
import { createWorkerScopeTransport } from './WorkerScopeTransport';
import { createWorkerTransport } from './WorkerTransport';

type Listener = (event: MessageEvent) => void;

/** A `Worker` or a worker's `self`: records what's posted, delivers what `receive` is given. */
const createEndpoint = () => {
  let listeners: Listener[] = [];
  const posted: { message: unknown; transfer?: Transferable[] }[] = [];
  const endpoint = {
    posted,
    terminated: false,
    listenerCount: () => listeners.length,
    receive: (data: unknown) => {
      for (const fn of listeners) fn({ data } as MessageEvent);
    },
    addEventListener: (_type: 'message', fn: Listener) => listeners.push(fn),
    removeEventListener: (_type: 'message', fn: Listener) => {
      listeners = listeners.filter((listener) => listener !== fn);
    },
    postMessage: (message: unknown, transfer?: Transferable[]) => {
      posted.push(transfer ? { message, transfer } : { message });
    },
    terminate: () => {
      endpoint.terminated = true;
    },
  };
  return endpoint;
};

const IMPLEMENTATIONS = [
  {
    name: 'createWorkerTransport (main thread)',
    create: (endpoint: ReturnType<typeof createEndpoint>) =>
      createWorkerTransport<unknown, unknown>(endpoint as unknown as Worker),
    closeTerminates: true,
  },
  {
    name: 'createWorkerScopeTransport (worker)',
    create: (endpoint: ReturnType<typeof createEndpoint>) =>
      createWorkerScopeTransport<unknown, unknown>(endpoint),
    closeTerminates: false,
  },
];

describe.each(IMPLEMENTATIONS)('$name', ({ create, closeTerminates }) => {
  it('sends, with the transfer list only when given', () => {
    const endpoint = createEndpoint();
    const transport = create(endpoint);
    const buffer = new ArrayBuffer(8);
    transport.send({ a: 1 });
    transport.send({ b: 2 }, [buffer]);
    expect(endpoint.posted).toEqual([
      { message: { a: 1 } },
      { message: { b: 2 }, transfer: [buffer] },
    ]);
  });

  it('delivers in order to every listener, in the order they were added', () => {
    const endpoint = createEndpoint();
    const transport = create(endpoint);
    const received: string[] = [];
    transport.onMessage((message) => received.push(`first ${String(message)}`));
    transport.onMessage((message) => received.push(`second ${String(message)}`));
    endpoint.receive(1);
    endpoint.receive(2);
    expect(received).toEqual(['first 1', 'second 1', 'first 2', 'second 2']);
  });

  it('removes a listener, also one of two that are the same function', () => {
    const endpoint = createEndpoint();
    const transport = create(endpoint);
    const received: unknown[] = [];
    const fn = (message: unknown) => received.push(message);
    const remove = transport.onMessage(fn);
    transport.onMessage(fn);
    endpoint.receive('both');
    remove();
    endpoint.receive('one');
    expect(received).toEqual(['both', 'both', 'one']);
  });

  it('sends and delivers nothing after close()', () => {
    const endpoint = createEndpoint();
    const transport = create(endpoint);
    const received: unknown[] = [];
    transport.onMessage((message) => received.push(message));
    transport.close();
    transport.close();
    transport.send('late');
    transport.onMessage((message) => received.push(message));
    endpoint.receive('late');
    expect(endpoint.posted).toEqual([]);
    expect(received).toEqual([]);
    expect(endpoint.listenerCount()).toBe(0);
    expect(endpoint.terminated).toBe(closeTerminates);
  });
});
