// A scheduler pass's ancestor reads (p806 Phase 6, D13): whether a field is under a `[hidden]`
// element or a disabled `<fieldset>`, each a `closest()` walk to the document root. A pass (a
// refresh, a tick, a reveal) reads every field, and the fields of one folder share their parent, so
// the last parent's answers are kept for the pass: the character state window's 100 rows walked
// 200 times a frame, a walk per folder now. A kit write that can change an answer mid-pass (a
// folder's or a field's `hidden`, a fieldset's `disabled`) clears them; outside a pass every read
// walks. One slot per kind, no allocation; the element is dropped at the pass's end.

/** The current pass's id, 0 outside one */
let pass = 0;
let passCount = 0;

let hiddenParent: Element | null = null;
let hiddenPass = 0;
let isHiddenAnswer = false;

let fieldsetParent: Element | null = null;
let fieldsetPass = 0;
let isFieldsetAnswer = false;

/**
 * Starts a pass (a nested one is its own); give the result to `endAncestorPass`
 * @internal
 * @returns the pass it interrupts
 */
export const beginAncestorPass = () => {
  const outer = pass;
  pass = ++passCount;
  return outer;
};

/**
 * Ends the pass `beginAncestorPass` started, back to the one it interrupted
 * @internal
 */
export const endAncestorPass = (outer: number) => {
  pass = outer;
  clearAncestorReads();
};

/**
 * Forgets the kept answers: a write that may change them (a `hidden` or a fieldset's `disabled`)
 * @internal
 */
export const clearAncestorReads = () => {
  hiddenParent = null;
  fieldsetParent = null;
};

/**
 * Whether an ancestor of `elem` (not `elem` itself) is `[hidden]`
 * @internal
 */
export const isInHiddenAncestor = (elem: Element) => {
  const parent = elem.parentElement;
  if (!parent) return false;
  if (!pass) return parent.closest('[hidden]') !== null;
  if (parent !== hiddenParent || hiddenPass !== pass) {
    hiddenParent = parent;
    hiddenPass = pass;
    isHiddenAnswer = parent.closest('[hidden]') !== null;
  }
  return isHiddenAnswer;
};

/**
 * Whether an ancestor of `elem` is a disabled `<fieldset>` (its `disabled` attribute)
 * @internal
 */
export const isInDisabledFieldset = (elem: Element) => {
  const parent = elem.parentElement;
  if (!parent) return false;
  if (!pass) return parent.closest('fieldset[disabled]') !== null;
  if (parent !== fieldsetParent || fieldsetPass !== pass) {
    fieldsetParent = parent;
    fieldsetPass = pass;
    isFieldsetAnswer = parent.closest('fieldset[disabled]') !== null;
  }
  return isFieldsetAnswer;
};
