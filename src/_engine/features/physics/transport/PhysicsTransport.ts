/**
 * The channel between the physics facade and the simulation it drives (p604 §4.5, p614 D5): the
 * physics worker today (`createWorkerTransport` on the main thread, `createWorkerScopeTransport`
 * in the worker), a network peer's channel later (p511). Nothing in physics calls `postMessage`
 * but the two implementations.
 *
 * The contract every implementation keeps:
 * - Messages are plain data: no class instances (a `THREE.Quaternion` arrives without its
 *   fields), no functions. `transfer` hands buffers over where the channel can; one that can't
 *   copies them.
 * - Messages are delivered in the order they were sent, each to every listener in the order the
 *   listeners were added.
 * - A receiver handles one message to the end before the next. The worker's handler is `async`,
 *   and only `INIT_PHYSICS` awaits real work, which the facade awaits before it sends anything
 *   else (p614 W4).
 * - After `close()` nothing is sent or delivered, and the channel can't be opened again.
 *
 * Requests ride on it as messages with a `requestId`: the reply carrying that id settles the
 * request, and so does an `ERROR` carrying it (rejected). Who sent the requests rejects the ones
 * still pending when it closes the channel (the facade's `stopPhysics`), as the assets API does
 * when its worker stops.
 * @template Out the messages this side sends
 * @template In the messages this side receives
 * @internal
 */
export type PhysicsTransport<Out, In> = {
  /** Sends a message (plain data), handing `transfer`'s buffers over where the channel can. A
   * no-op after `close()`. */
  send(message: Out, transfer?: Transferable[]): void;
  /** Adds a listener for every message received from now on. Returns its remover. */
  onMessage(fn: (message: In) => void): () => void;
  /** Ends the channel: removes the listeners, and stops the other side where this side owns it
   * (the main thread terminates the worker). */
  close(): void;
};
