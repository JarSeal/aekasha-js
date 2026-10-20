// A CMP's animation chain (TAnimChain): timers that step through phases of classes and styles,
// kept in the CMP's `timers`. CMP.ts starts and clears it; it writes the CMP only through the
// CMP's own methods (updateClass, updateStyle), so it imports no CMP code (only its types).
import type { TAnimChain, TAnimState, TCMP } from './CMP';

type SetTimeout = ReturnType<typeof setTimeout>;

const removeAnim = (cmp: TCMP, animKey: string) => {
  const timerData = cmp.timers[animKey];
  if (timerData) {
    clearTimeout(timerData.fn as SetTimeout);
    // Explicitly nullify the animState to break closure bonds
    if (timerData.animState) {
      timerData.animState.state = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (timerData as any).animState = null;
    }
  }
  delete cmp.timers[animKey];
};

/**
 * Clears every timer of a CMP (its animation chain and its scroll timer): its removal.
 * @internal
 */
export const removeAnims = (cmp: TCMP) => {
  const timerKeys = Object.keys(cmp.timers);
  for (let i = 0; i < timerKeys.length; i++) {
    removeAnim(cmp, timerKeys[i]);
  }
};

/**
 * Starts the chain of a CMP's `anim` prop, if it has one: CMP.ts runs it when the CMP is mounted.
 * @internal
 */
export const runAnims = (cmp: TCMP) => {
  if (cmp.props?.anim) updateCmpAnim(cmp, cmp.props?.anim);
};

/**
 * Starts a CMP's animation chain (`TCMP.updateAnim`, and the `anim` prop when the CMP is mounted),
 * replacing the one it runs: each phase applies its class and style, then waits its duration.
 * @internal
 */
export const updateCmpAnim = (cmp: TCMP, animChain: TAnimChain[]) => {
  removeAnim(cmp, 'cmpAnim');

  if (!animChain?.length) {
    delete cmp.timers.cmpAnim;
    return cmp;
  }

  const animState: TAnimState = {
    setState: (key, value) => (animState.state[key] = value),
    removeState: (key) => delete animState.state[key],
    state: {},
  };

  cmp.timers.cmpAnim = { fn: null, curIndex: 0, animState };

  const timerFn = () => {
    const curIndex = cmp.timers.cmpAnim.curIndex || 0;
    const curAnim = animChain[curIndex];

    let nextIndex: null | number = null;

    // Check previous anim phaseEndFn
    const prevAnim = animChain[curIndex - 1];
    if (prevAnim?.phaseEndFn) {
      const phaseEndResult = cmp.timers.cmpAnim.animState
        ? prevAnim.phaseEndFn(cmp, cmp.timers.cmpAnim.animState)
        : null;
      nextIndex = typeof phaseEndResult === 'number' ? phaseEndResult : null;
      if (nextIndex !== null) {
        // The jump runs the phase it names, which sets the next timer: this one ends here
        cmp.timers.cmpAnim.curIndex = nextIndex;
        timerFn();
        return;
      }
    }

    // Check if we are at the end of the chain
    if (curIndex >= animChain.length) {
      return;
    }

    // Check current anim phaseStartFn
    if (curAnim?.phaseStartFn) {
      const phaseStartResult = cmp.timers.cmpAnim.animState
        ? curAnim.phaseStartFn(cmp, cmp.timers.cmpAnim.animState)
        : null;
      nextIndex = typeof phaseStartResult === 'number' ? phaseStartResult : null;
    }

    if (curAnim.class) {
      cmp.updateClass(curAnim.class, curAnim.classAction);
    }

    if (curAnim.style) {
      cmp.updateStyle(curAnim.style);
    }

    cmp.timers.cmpAnim.fn = setTimeout(timerFn, curAnim.duration);

    if (curAnim.gotoIndex !== undefined) {
      cmp.timers.cmpAnim.curIndex =
        typeof curAnim.gotoIndex === 'number'
          ? curAnim.gotoIndex
          : curAnim.gotoIndex(cmp, cmp.timers.cmpAnim.animState);
      return;
    }
    cmp.timers.cmpAnim.curIndex =
      nextIndex !== null ? nextIndex : (cmp.timers.cmpAnim.curIndex || 0) + 1;
  };
  timerFn();

  return cmp;
};
