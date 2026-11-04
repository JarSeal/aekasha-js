import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { getMotionFactor } from '../core/Motion';
import './Crosshair.scss';
import '../styles/kit.scss';

/** A crosshair's shape. */
export type CrosshairShape = 'cross' | 'dot' | 'circle' | 'chevron';

/** What the crosshair is over: a target (a ring), something it can't act on (a slash), or
 * nothing. */
export type CrosshairState = 'default' | 'target' | 'blocked';

/** A hit marker's kind: each a larger, heavier X (never colour alone). */
export type HitMarkerKind = 'hit' | 'critical' | 'kill';

/** What {@link createCrosshair} draws. */
export type CrosshairProps = {
  /** Its shape (default `'cross'`). */
  shape?: CrosshairShape;
  /** The gap from the centre to each arm, in px (default `--aek-crosshair-gap`, 4 px). */
  gap?: number;
  /** Each arm's length, in px (default `--aek-crosshair-length`, 8 px). */
  length?: number;
  /** The arms' and the ring's thickness, in px (default `--aek-crosshair-thickness`, 2 px). */
  thickness?: number;
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A crosshair {@link createCrosshair} made: its CMP and its setters, each writing it in place. */
export type Crosshair = {
  /** Its element (`.aekCrosshair`): add it to the HUD root. It's fixed at the centre of the
   * HUD's bounds (the window, or a mounted engine's container). */
  cmp: CMPHandle;
  /** Spreads the arms out from the gap by `px` (a weapon's bloom). Writes nothing when it's
   * unchanged, so a spread set every frame is fine. */
  setSpread: (px: number) => void;
  /** Shows what it's over: a ring for a target, a slash for blocked. */
  setState: (state: CrosshairState) => void;
  /** Changes its shape. */
  setShape: (shape: CrosshairShape) => void;
  /** Flashes a hit marker, an X at the centre (again from the start when one shows). */
  showHitMarker: (kind?: HitMarkerKind) => void;
};

const ARMS = ['up', 'down', 'left', 'right'];

const createPart = (className: string) => {
  const span = document.createElement('span');
  span.className = className;
  return span;
};

/**
 * Creates a crosshair (p808 D6): a reticle at the centre of the screen, its arms spread by a
 * weapon's bloom, a ring over a target and a slash over something blocked, and a hit marker that
 * flashes on a hit. Drawn with CSS on tokens, no images.
 * - Parts: `.aekCrosshair` (`data-shape`, `data-state`), `.aekCrosshair__arm` (`data-arm="up" |
 *   "down" | "left" | "right"`), `.aekCrosshair__dot`, `.aekCrosshair__ring`,
 *   `.aekCrosshair__slash`, `.aekCrosshair__hit` (`data-kind`) with its four
 *   `.aekCrosshair__hitArm`s.
 * - Custom properties (read on any ancestor): `--aek-crosshair-color` (default `--aek-text`),
 *   `--aek-crosshair-outline` (a 1 px edge so it shows on any scene, default `--aek-bg`),
 *   `--aek-crosshair-target-color` (the ring, default the accent), `--aek-crosshair-hit-color`
 *   (default `--aek-text`), `--aek-crosshair-gap`, `--aek-crosshair-length`,
 *   `--aek-crosshair-thickness`; `--aek-crosshair-spread` is the setter's.
 * - Assistive tech: `aria-hidden` (p808 D4): an aim point for the pointer, which the game says
 *   otherwise (its sounds, its feed) for a player who doesn't see it.
 * - Motion: the spread eases over `--aek-motion-fast`; a hit marker pops and fades in 250 ms.
 *   Under reduced motion the spread jumps and a hit marker shows still for the same time.
 * @example
 * ```ts
 * import { createCrosshair, getHUDRootCMP } from 'aekasha/ui';
 *
 * const crosshair = createCrosshair({ shape: 'cross', gap: 5 });
 * getHUDRootCMP().add(crosshair.cmp);
 * crosshair.setSpread(6); // moving: the bloom
 * crosshair.setState('target');
 * crosshair.showHitMarker('critical');
 * ```
 */
export const createCrosshair = (props: CrosshairProps = {}): Crosshair => {
  let shape = props.shape ?? 'cross';
  let state: CrosshairState = 'default';
  let spread = 0;
  let hitRun = 0;

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekCrosshair', props.class),
    attr: { ...props.attr, 'aria-hidden': 'true', 'data-shape': shape, 'data-state': state },
  });
  const elem = cmp.elem;
  if (props.gap !== undefined) elem.style.setProperty('--aek-crosshair-gap', `${props.gap}px`);
  if (props.length !== undefined) {
    elem.style.setProperty('--aek-crosshair-length', `${props.length}px`);
  }
  if (props.thickness !== undefined) {
    elem.style.setProperty('--aek-crosshair-thickness', `${props.thickness}px`);
  }

  for (const arm of ARMS) {
    const armElem = createPart('aekCrosshair__arm');
    armElem.setAttribute('data-arm', arm);
    elem.append(armElem);
  }
  const hit = createPart('aekCrosshair__hit');
  for (let i = 0; i < 4; i++) hit.append(createPart('aekCrosshair__hitArm'));
  elem.append(
    createPart('aekCrosshair__dot'),
    createPart('aekCrosshair__ring'),
    createPart('aekCrosshair__slash'),
    hit
  );

  return {
    cmp,
    setSpread: (px) => {
      const next = Math.max(0, px);
      if (next === spread) return;
      spread = next;
      elem.style.setProperty('--aek-crosshair-spread', `${next}px`);
    },
    setState: (next) => {
      if (next === state) return;
      state = next;
      elem.setAttribute('data-state', next);
    },
    setShape: (next) => {
      if (next === shape) return;
      shape = next;
      elem.setAttribute('data-shape', next);
    },
    showHitMarker: (kind = 'hit') => {
      hit.setAttribute('data-kind', kind);
      // Still under reduced motion: shown, not popped (the hit is information)
      if (getMotionFactor(elem) === 0) hit.setAttribute('data-still', '');
      else hit.removeAttribute('data-still');
      // The other name restarts the animation
      hitRun = hitRun === 1 ? 2 : 1;
      hit.setAttribute('data-run', String(hitRun));
    },
  };
};
