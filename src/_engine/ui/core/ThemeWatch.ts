// The theme signal a canvas needs (p805 D9): CSS follows the theme by itself, a canvas that reads
// the tokens doesn't. One `prefers-color-scheme` listener and one `MutationObserver` on the
// document for `data-aek-theme` and `data-aek-density`, shared by every subscriber, started by the
// first and stopped by the last. Nothing at load, never a style read here.

type Subscriber = { elem: Element; fn: () => void };

const WATCHED_ATTRS = ['data-aek-theme', 'data-aek-density'];

const subscribers = new Set<Subscriber>();
let observer: MutationObserver | null = null;
let media: MediaQueryList | null = null;

const callAll = () => {
  for (const subscriber of [...subscribers]) subscriber.fn();
};

/** Each subscriber under a changed element, once per batch of mutations */
const onMutations = (records: MutationRecord[]) => {
  const called = new Set<Subscriber>();
  for (const record of records) {
    const target = record.target as Element;
    for (const subscriber of subscribers) {
      if (called.has(subscriber) || !target.contains(subscriber.elem)) continue;
      called.add(subscriber);
      subscriber.fn();
    }
  }
};

const start = () => {
  if (typeof MutationObserver === 'function') {
    observer = new MutationObserver(onMutations);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: WATCHED_ATTRS,
      subtree: true,
    });
  }
  media = window.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
  media?.addEventListener('change', callAll);
};

const stop = () => {
  observer?.disconnect();
  observer = null;
  media?.removeEventListener('change', callAll);
  media = null;
};

/**
 * Calls `fn` when the kit's theme or density may have changed for `elem`: the system's colour
 * scheme, or `data-aek-theme` / `data-aek-density` written on `elem` or an element around it (the
 * page, a kit root, the library's switches). `fn` reads the tokens again (a canvas' colours, a
 * measured row height); it's called after the change, once per batch of attribute writes.
 * @internal
 * @returns the remover (the shared listeners stop with the last one)
 */
export const onKitThemeChange = (elem: Element, fn: () => void) => {
  const subscriber: Subscriber = { elem, fn };
  subscribers.add(subscriber);
  if (subscribers.size === 1) start();
  return () => {
    if (!subscribers.delete(subscriber)) return;
    if (subscribers.size === 0) stop();
  };
};
