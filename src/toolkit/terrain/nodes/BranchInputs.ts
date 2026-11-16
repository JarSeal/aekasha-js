// What a terrain branch (a TSL `If` inside a `Fn`: the slope gate's projection, the far surface's
// near one) reads from outside it: each a var assigned before the branch. Three declares a var
// that's only read where it's first used, which for a branch's input is inside the branch (the sky
// box trap, `src/_engine/features/skybox/CLAUDE.md`), and a derivative or an implicit-gradient
// sample there is in non-uniform control flow (WGSL's uniformity rule): so each input is a zero var
// with an explicit assignment, which keeps its place in the statements.
import { float, int, vec2, vec3 } from 'three/tsl';

/**
 * A node as a var declared where this is called: in a `Fn`, before what follows.
 * @internal
 */
export const toVar = <T>(node: T): T => (node as unknown as { toVar: () => T }).toVar();

/** The zero a declared input of each type starts from */
const ZEROS = {
  float: () => float(0),
  int: () => int(0),
  vec2: () => vec2(0),
  vec3: () => vec3(0),
};

/** The types a branch input takes */
export type BranchInputType = keyof typeof ZEROS;

/**
 * A node as a var assigned where this is called (in a `Fn`, before a branch that reads it): a zero
 * var with an explicit assignment, so the declaration and the value's build keep their place.
 * @internal
 * @param node the value the branch reads
 * @param type its type
 */
export const declareBranchInput = <T>(node: T, type: BranchInputType): T => {
  const variable = (ZEROS[type]() as unknown as { toVar: () => unknown }).toVar() as {
    assign: (value: unknown) => void;
  };
  variable.assign(node);
  return variable as unknown as T;
};
