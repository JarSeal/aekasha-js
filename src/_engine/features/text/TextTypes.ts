// p392 D1, D3: a text's options. The value lists are `as const` arrays so the scene JSON's schema
// (p392 Phase 3) and the debug tab read the same values.
import type * as THREE from 'three/webgpu';
import type { ECSWorld } from '../../kernel/ecs/ECS';

/** What a text's `size` measures: `WORLD` metres, `SCREEN` CSS pixels at any distance. */
export const TEXT_SIZINGS = ['WORLD', 'SCREEN'] as const;
/** What a text's `size` measures: `WORLD` metres, `SCREEN` CSS pixels at any distance. */
export type TextSizing = (typeof TEXT_SIZINGS)[number];

/**
 * How a text faces: `PLANE` lies in its own transform's XY plane (signs, floor markings),
 * `BILLBOARD` faces the camera, `BILLBOARD_Y` turns about world Y only (nameplates).
 */
export const TEXT_ORIENTATIONS = ['PLANE', 'BILLBOARD', 'BILLBOARD_Y'] as const;
/**
 * How a text faces: `PLANE` lies in its own transform's XY plane (signs, floor markings),
 * `BILLBOARD` faces the camera, `BILLBOARD_Y` turns about world Y only (nameplates).
 */
export type TextOrientation = (typeof TEXT_ORIENTATIONS)[number];

/** Each line's place in the text's box: its left edge, its centre or its right edge. */
export const TEXT_ALIGNS = ['LEFT', 'CENTER', 'RIGHT'] as const;
/** Each line's place in the text's box: its left edge, its centre or its right edge. */
export type TextAlign = (typeof TEXT_ALIGNS)[number];

/**
 * The text box's point that sits at the text's origin: a row (`TOP` the first line's ascender,
 * `MIDDLE` the box's centre, `BASELINE` the first line's baseline, `BOTTOM` the last line's
 * descender) and a column (`LEFT`, `CENTER`, `RIGHT` of the widest line).
 */
export const TEXT_ANCHORS = [
  'TOP_LEFT',
  'TOP_CENTER',
  'TOP_RIGHT',
  'MIDDLE_LEFT',
  'MIDDLE_CENTER',
  'MIDDLE_RIGHT',
  'BASELINE_LEFT',
  'BASELINE_CENTER',
  'BASELINE_RIGHT',
  'BOTTOM_LEFT',
  'BOTTOM_CENTER',
  'BOTTOM_RIGHT',
] as const;
/**
 * The text box's point that sits at the text's origin: a row (`TOP` the first line's ascender,
 * `MIDDLE` the box's centre, `BASELINE` the first line's baseline, `BOTTOM` the last line's
 * descender) and a column (`LEFT`, `CENTER`, `RIGHT` of the widest line).
 */
export type TextAnchor = (typeof TEXT_ANCHORS)[number];

/**
 * How a text's edge meets what's behind it: `ALPHA_TO_COVERAGE` (no sorting; needs MSAA, else
 * an alpha test), `BLEND` (blended, no depth write) or `AUTO` (alpha to coverage for a plain fill,
 * blend when soft effects or a fade need it).
 */
export const TEXT_BLENDS = ['AUTO', 'ALPHA_TO_COVERAGE', 'BLEND'] as const;
/**
 * How a text's edge meets what's behind it: `ALPHA_TO_COVERAGE` (no sorting; needs MSAA, else
 * an alpha test), `BLEND` (blended, no depth write) or `AUTO` (alpha to coverage for a plain fill,
 * blend when soft effects or a fade need it).
 */
export type TextBlend = (typeof TEXT_BLENDS)[number];

/**
 * What a text's transform is relative to. `WORLD`: world space. `ENTITY`: an entity's Object3D,
 * followed as it moves (placement only: `bindTextToEntity` ties the lifetimes). `OBJECT3D`: any
 * Object3D (a camera, a bone). A text is in no scene graph: it follows its target's world matrix.
 */
export type TextAttachment =
  | { to: 'WORLD' }
  | { to: 'ENTITY'; entityId: number; world?: ECSWorld }
  | { to: 'OBJECT3D'; object3D: THREE.Object3D };

/** A text's transform relative to what it's attached to. Each part given replaces the text's own. */
export type TextLocalTransform = {
  /** Where the text's origin (its `anchor`) is. */
  position?: THREE.Vector3Like;
  /** Euler angles in radians (XYZ order). */
  rotation?: THREE.Vector3Like;
  /** Over `rotation`. */
  quaternion?: THREE.QuaternionLike;
  /** A factor per axis on top of `size`. */
  scale?: THREE.Vector3Like;
};

/**
 * What `createText` and `createTextEntity` take: the string, its font and size, its look, its
 * layout and its place. Only `font` is required.
 */
export type TextProps = TextLocalTransform & {
  /** Registry id. Generated (`text_<n>`) when left out; unique among live texts. */
  id?: string;
  /** A name for debugging. Defaults to the id. */
  name?: string;
  /** The string drawn. `\n` breaks a line. Default `''`. */
  text?: string;
  /** A loaded font's id (`loadFontAsync`, or the scene's `fonts`). */
  font: string;
  /** The em's size: metres (`WORLD`) or CSS pixels (`SCREEN`). Default 1 (`WORLD`), 16
   * (`SCREEN`). */
  size?: number;
  /** Default `'WORLD'`. */
  sizing?: TextSizing;
  /** Default `'PLANE'`. */
  orientation?: TextOrientation;
  /** Default `'#ffffff'`. */
  color?: THREE.ColorRepresentation;
  /** 0..1, default 1. */
  opacity?: number;
  /** Default `'CENTER'`. */
  align?: TextAlign;
  /** Default `'MIDDLE_CENTER'`. */
  anchor?: TextAnchor;
  /** The widest a line gets before it wraps at a space or after a hyphen (a word longer than that
   * breaks between glyphs), in `size`'s unit. Default `Infinity`: no wrapping. */
  maxWidth?: number;
  /** Baseline to baseline, in em. Default: the font's own. */
  lineHeight?: number;
  /** Added between the glyphs of a line, in em (negative tightens). Default 0. */
  letterSpacing?: number;
  /** Default true. False draws the text over whatever would hide it. */
  depthTest?: boolean;
  /** Draw order among transparent objects. Default 0. */
  renderOrder?: number;
  /** Default `'AUTO'`. */
  blend?: TextBlend;
  /** Default true. */
  visible?: boolean;
  /** Default `{ to: 'WORLD' }`. */
  attach?: TextAttachment;
  /** Kept on scene switches, which dispose every other text not bound to an entity. Default
   * false. A text bound to an entity follows its entity instead. */
  persistent?: boolean;
};

/**
 * What `createTextEntity` takes: `createText`'s props without `attach` (the entity places the
 * text) and `persistent` (the entity's options' `persistent` keeps both).
 */
export type TextEntityProps = Omit<TextProps, 'attach' | 'persistent'>;
