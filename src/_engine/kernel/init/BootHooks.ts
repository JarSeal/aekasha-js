// The boot's after-start step for modules the boot doesn't import (p613 D5): a module adds its
// part on its first use, so a build without it neither ships it nor calls it (the draggable
// windows' restore from LS).

const afterStartHooks: (() => void)[] = [];
let hasAfterStartRun = false;

/**
 * Adds a function the boot runs once, after the app's `start` and the debug steps that follow it
 * (where the draggable windows restore last session's open windows). A hook added once the boot
 * is past that step never runs.
 * @internal
 * @param hook runs once, in the order added
 * @returns whether the hook was added (false once the step has run)
 */
export const addBootAfterStartHook = (hook: () => void) => {
  if (hasAfterStartRun) return false;
  afterStartHooks.push(hook);
  return true;
};

/**
 * Runs the after-start hooks: the boot calls it once, after `start`.
 * @internal
 */
export const runBootAfterStartHooks = () => {
  hasAfterStartRun = true;
  const hooks = afterStartHooks.splice(0);
  for (let i = 0; i < hooks.length; i++) hooks[i]();
};
