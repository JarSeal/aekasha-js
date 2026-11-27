// p392 D1: the text handle. It owns a text's options and transform; its setters write in place
// and only mark what changed (`dirtyFlags`) and queue the text, so a setter costs no layout and
// no allocation. The feature's per-frame system (p392 Phase 2) lays out a queued text once,
// writes its batch's row and moves it between batches.
import * as THREE from 'three/webgpu';
import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import { getECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { existsOrThrow } from '../../utils/Assert';
import { lerror, lwarn } from '../../utils/Logger';
import { getFont, type FontData } from './Fonts';
import { layoutText, type TextLayoutBuffer, type TextLayoutParams } from './TextLayout';
import { releaseTextEntity, type TextEntityBinding } from './TextEntity';
import { queueTextUpdate, unregisterText } from './TextRegistry';
import type {
  TextAlign,
  TextAnchor,
  TextAttachment,
  TextBlend,
  TextLocalTransform,
  TextOrientation,
  TextProps,
  TextSizing,
} from './TextTypes';

/**
 * The text's glyphs need a new layout (its string, font, size or layout options changed).
 * @internal
 */
export const TEXT_DIRTY_LAYOUT = 1;
/**
 * The text's row in its batch's table needs a write (its transform, attachment, colour, opacity
 * or visibility changed).
 * @internal
 */
export const TEXT_DIRTY_ROW = 2;
/**
 * The text belongs in another batch (its font, sizing, orientation, blend, depth test or render
 * order changed).
 * @internal
 */
export const TEXT_DIRTY_BATCH = 4;
const TEXT_DIRTY_ALL = TEXT_DIRTY_LAYOUT | TEXT_DIRTY_ROW | TEXT_DIRTY_BATCH;

/** The default size by sizing: a metre, 16 CSS pixels */
const DEFAULT_SIZES: Record<TextSizing, number> = { WORLD: 1, SCREEN: 16 };

/**
 * A text's attachment with its world resolved: the stored form.
 * @internal
 */
export type ResolvedTextAttachment =
  | Exclude<TextAttachment, { to: 'ENTITY' }>
  | {
      to: 'ENTITY';
      entityId: number;
      world: NonNullable<Extract<TextAttachment, { to: 'ENTITY' }>['world']>;
    };

/** The code points warned about, by font id: once per character per font (debug env) */
const warnedMissing = new Map<string, Set<number>>();

const warnMissingGlyph = (font: FontData, codePoint: number) => {
  if (!IS_DEBUG_ENV) return;
  let warned = warnedMissing.get(font.id);
  if (!warned) {
    warned = new Set();
    warnedMissing.set(font.id, warned);
  }
  if (warned.has(codePoint)) return;
  warned.add(codePoint);
  const hex = codePoint.toString(16).toUpperCase().padStart(4, '0');
  lwarn(
    `[Text] The font "${font.id}" has no "${String.fromCodePoint(codePoint)}" (U+${hex}): its fallback glyph is drawn. Add it to the font's charset (its *.font.json) and run \`yarn assets --only ${font.id}\` (warned once per character).`
  );
};

/**
 * The loaded font `id`, or a throw naming the fix.
 * @internal
 */
export const requireLoadedFont = (id: string, caller: string) => {
  const font = getFont(id);
  if (font) return font;
  const msg = `${caller}: the font "${id}" isn't loaded. List it in the scene's \`fonts\`, or await \`loadFontAsync('${id}')\` first.`;
  lerror(msg);
  throw new Error(msg);
};

const scratchEuler = new THREE.Euler();

/**
 * A text in the 3D world: a handle usable from any code, no ECS world involved. Create one with
 * `createText` (or `createTextEntity`, which gives it an entity).
 *
 * Its setters write in place and only mark the text changed: the layout runs once per changed
 * text in the feature's system, before the frame renders, however many setters ran. A colour,
 * opacity, transform or visibility change rewrites one row of its batch's table, not its glyphs.
 */
export class TextObject {
  /** The text's id: `TextProps.id`, or a generated `text_<n>` (`getText` finds it). */
  readonly id: string;
  /** A name for debugging: `TextProps.name`, or the id. */
  readonly name: string;
  /** Kept on scene switches (see `TextProps.persistent`). */
  readonly persistent: boolean;

  /**
   * What changed since the system last handled the text (`TEXT_DIRTY_*` bits).
   * @internal
   */
  dirtyFlags = TEXT_DIRTY_ALL;
  /**
   * In the registry's update queue.
   * @internal
   */
  isQueued = false;
  /**
   * Set by Texts.ts (`createTextEntity`, `bindTextToEntity`) while an entity owns this text.
   * @internal
   */
  entityBinding: TextEntityBinding | null = null;

  private _text: string;
  private _font: FontData;
  private _sizing: TextSizing;
  private _orientation: TextOrientation;
  private readonly _color = new THREE.Color();
  private _opacity: number;
  private _lineHeight: number | undefined;
  private _depthTest: boolean;
  private _renderOrder: number;
  private _blend: TextBlend;
  private _visible: boolean;
  private _attachment: ResolvedTextAttachment = { to: 'WORLD' };
  private readonly _position = new THREE.Vector3();
  private readonly _quaternion = new THREE.Quaternion();
  private readonly _scale = new THREE.Vector3(1, 1, 1);
  /** The layout's inputs; `lineHeight` resolved from the font at each layout */
  private readonly layoutParams: TextLayoutParams;
  private _glyphCount = 0;
  private _lineCount = 0;
  private readonly _bounds = new THREE.Box3();
  private disposed = false;

  /**
   * Use `createText`.
   * @internal
   */
  constructor(id: string, props: TextProps) {
    this.id = id;
    this.name = props.name ?? id;
    this.persistent = props.persistent ?? false;
    this._font = requireLoadedFont(props.font, 'createText');
    this._text = props.text ?? '';
    this._sizing = props.sizing ?? 'WORLD';
    this._orientation = props.orientation ?? 'PLANE';
    this._color.set(props.color ?? 0xffffff);
    this._opacity = clampOpacity(props.opacity ?? 1);
    this._lineHeight = props.lineHeight;
    this._depthTest = props.depthTest ?? true;
    this._renderOrder = props.renderOrder ?? 0;
    this._blend = props.blend ?? 'AUTO';
    this._visible = props.visible ?? true;
    this.layoutParams = {
      size: DEFAULT_SIZES[this._sizing],
      maxWidth: props.maxWidth ?? Infinity,
      lineHeight: this._font.metrics.lineHeight,
      letterSpacing: props.letterSpacing ?? 0,
      align: props.align ?? 'CENTER',
      anchor: props.anchor ?? 'MIDDLE_CENTER',
    };
    if (props.size !== undefined) this.writeSize(props.size);
    this.writeLocalTransform(props);
    if (props.attach) this.attach(props.attach);
    queueTextUpdate(this);
  }

  // --------------------------------------------------------------------------
  // Reading
  // --------------------------------------------------------------------------

  /** The string drawn. */
  get text() {
    return this._text;
  }
  /** The font, loaded (`getFont`'s). */
  get font(): FontData {
    return this._font;
  }
  /** The em's size, in `sizing`'s unit. */
  get size() {
    return this.layoutParams.size;
  }
  /** What `size` measures. */
  get sizing() {
    return this._sizing;
  }
  /** How the text faces. */
  get orientation() {
    return this._orientation;
  }
  /** The fill colour: read it, change it with `setColor`. */
  get color(): Readonly<THREE.Color> {
    return this._color;
  }
  /** 0..1. */
  get opacity() {
    return this._opacity;
  }
  /** Each line's place in the box. */
  get align() {
    return this.layoutParams.align;
  }
  /** The box's point at the origin. */
  get anchor() {
    return this.layoutParams.anchor;
  }
  /** The widest line before wrapping, in `size`'s unit (`Infinity`: none). */
  get maxWidth() {
    return this.layoutParams.maxWidth;
  }
  /** Baseline to baseline in em: the option, or the font's own when it has none. */
  get lineHeight() {
    return this._lineHeight ?? this._font.metrics.lineHeight;
  }
  /** Between the glyphs of a line, in em. */
  get letterSpacing() {
    return this.layoutParams.letterSpacing;
  }
  /** False draws the text over what would hide it. */
  get depthTest() {
    return this._depthTest;
  }
  /** The draw order among transparent objects. */
  get renderOrder() {
    return this._renderOrder;
  }
  /** How the edge meets what's behind it. */
  get blend() {
    return this._blend;
  }
  /** Whether the text draws. */
  get visible() {
    return this._visible;
  }
  /** What the transform is relative to. */
  get attachment(): Readonly<TextAttachment> {
    return this._attachment;
  }
  /** The position relative to the attachment: read it, change it with `setLocalTransform`. */
  get position(): Readonly<THREE.Vector3> {
    return this._position;
  }
  /** The rotation relative to the attachment: read it, change it with `setLocalTransform`. */
  get quaternion(): Readonly<THREE.Quaternion> {
    return this._quaternion;
  }
  /** The scale on top of `size`: read it, change it with `setLocalTransform`. */
  get scale(): Readonly<THREE.Vector3> {
    return this._scale;
  }
  /** The glyphs drawn (inked ones: a space draws nothing), as of the last layout. */
  get glyphCount() {
    return this._glyphCount;
  }
  /** The lines, as of the last layout. */
  get lineCount() {
    return this._lineCount;
  }
  /** The text box in its own space (`size`'s unit, before its scale; z 0), as of the last
   * layout: read it, never change it. */
  get bounds(): Readonly<THREE.Box3> {
    return this._bounds;
  }
  /** Whether the layout is behind the options (the feature's system lays it out before the
   * frame renders). */
  get isLayoutDirty() {
    return (this.dirtyFlags & TEXT_DIRTY_LAYOUT) !== 0;
  }
  /** Whether `dispose()` ran (by the app, its entity or a scene exit): the text draws no more. */
  get isDisposed() {
    return this.disposed;
  }

  // --------------------------------------------------------------------------
  // Setters: in place, marking what changed
  // --------------------------------------------------------------------------

  /** Replaces the string; lays out only this text's glyphs again. */
  setText(text: string) {
    if (text === this._text) return;
    this._text = text;
    this.markDirty(TEXT_DIRTY_LAYOUT);
  }

  /** Switches to another loaded font (moving the text to that font's batch). Throws when the
   * font isn't loaded. */
  setFont(id: string) {
    if (id === this._font.id && getFont(id) === this._font) return;
    this._font = requireLoadedFont(id, `setFont on text "${this.id}"`);
    this.markDirty(TEXT_DIRTY_LAYOUT | TEXT_DIRTY_BATCH);
  }

  /** The em's size in `sizing`'s unit; above 0 (another value is ignored with a warning). */
  setSize(size: number) {
    if (size === this.layoutParams.size) return;
    if (this.writeSize(size)) this.markDirty(TEXT_DIRTY_LAYOUT);
  }

  /** Switches between metres and CSS pixels; `size` keeps its number. */
  setSizing(sizing: TextSizing) {
    if (sizing === this._sizing) return;
    this._sizing = sizing;
    this.markDirty(TEXT_DIRTY_BATCH);
  }

  /** Turns the text to lie in its plane, face the camera or turn about Y. */
  setOrientation(orientation: TextOrientation) {
    if (orientation === this._orientation) return;
    this._orientation = orientation;
    this.markDirty(TEXT_DIRTY_BATCH);
  }

  /** The fill colour, and the opacity (0..1) when given: a row write. */
  setColor(color: THREE.ColorRepresentation, opacity?: number) {
    this._color.set(color);
    if (opacity !== undefined) this._opacity = clampOpacity(opacity);
    this.markDirty(TEXT_DIRTY_ROW);
  }

  /** 0..1: a row write. */
  setOpacity(opacity: number) {
    const clamped = clampOpacity(opacity);
    if (clamped === this._opacity) return;
    this._opacity = clamped;
    this.markDirty(TEXT_DIRTY_ROW);
  }

  /** Each line's place in the box. */
  setAlign(align: TextAlign) {
    if (align === this.layoutParams.align) return;
    this.layoutParams.align = align;
    this.markDirty(TEXT_DIRTY_LAYOUT);
  }

  /** The box's point at the origin. */
  setAnchor(anchor: TextAnchor) {
    if (anchor === this.layoutParams.anchor) return;
    this.layoutParams.anchor = anchor;
    this.markDirty(TEXT_DIRTY_LAYOUT);
  }

  /** The widest line before wrapping, in `size`'s unit; `Infinity` for none. */
  setMaxWidth(maxWidth: number) {
    if (maxWidth === this.layoutParams.maxWidth) return;
    this.layoutParams.maxWidth = maxWidth;
    this.markDirty(TEXT_DIRTY_LAYOUT);
  }

  /** Baseline to baseline in em; `undefined` for the font's own. */
  setLineHeight(lineHeight: number | undefined) {
    if (lineHeight === this._lineHeight) return;
    this._lineHeight = lineHeight;
    this.markDirty(TEXT_DIRTY_LAYOUT);
  }

  /** Between the glyphs of a line, in em (negative tightens). */
  setLetterSpacing(letterSpacing: number) {
    if (letterSpacing === this.layoutParams.letterSpacing) return;
    this.layoutParams.letterSpacing = letterSpacing;
    this.markDirty(TEXT_DIRTY_LAYOUT);
  }

  /** False draws the text over whatever would hide it (another batch). */
  setDepthTest(depthTest: boolean) {
    if (depthTest === this._depthTest) return;
    this._depthTest = depthTest;
    this.markDirty(TEXT_DIRTY_BATCH);
  }

  /** The draw order among transparent objects (another batch). */
  setRenderOrder(renderOrder: number) {
    if (renderOrder === this._renderOrder) return;
    this._renderOrder = renderOrder;
    this.markDirty(TEXT_DIRTY_BATCH);
  }

  /** How the edge meets what's behind it (another batch). */
  setBlend(blend: TextBlend) {
    if (blend === this._blend) return;
    this._blend = blend;
    this.markDirty(TEXT_DIRTY_BATCH);
  }

  /** Shows or hides the text: a row write. */
  setVisible(visible: boolean) {
    if (visible === this._visible) return;
    this._visible = visible;
    this.markDirty(TEXT_DIRTY_ROW);
  }

  // --------------------------------------------------------------------------
  // Placement
  // --------------------------------------------------------------------------

  /**
   * The text's transform relative to what it's attached to; the parts left out are kept. A row
   * write. On a text entity (`createTextEntity`) the entity's transform places it: use
   * `setTransform`.
   */
  setLocalTransform(transform: TextLocalTransform) {
    this.writeLocalTransform(transform);
    this.markDirty(TEXT_DIRTY_ROW);
  }

  /**
   * What the transform is relative to: world space, an entity's Object3D or any Object3D, whose
   * world matrix the text follows as it moves. Placement only: `bindTextToEntity` ties the
   * text's life to an entity.
   * @param attachment the target; an entity must have an Object3D
   */
  attach(attachment: TextAttachment) {
    if (attachment.to === 'ENTITY') {
      const world = attachment.world ?? getECSWorld();
      existsOrThrow(
        world.getComponent(attachment.entityId, ComponentType.OBJECT3D)?.value,
        `Entity ${attachment.entityId} has no Object3D to attach text "${this.id}" to.`
      );
      this._attachment = { to: 'ENTITY', entityId: attachment.entityId, world };
    } else {
      this._attachment = attachment;
    }
    this.markDirty(TEXT_DIRTY_ROW);
  }

  /** Removes the text and frees its glyphs. Idempotent. A text entity (`createTextEntity`) is
   * deleted with it; a bound entity (`bindTextToEntity`) loses its `TEXT` component. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const binding = this.entityBinding;
    this.entityBinding = null;
    unregisterText(this.id);
    // Queued, so the system frees its glyphs' range in its batch
    queueTextUpdate(this);
    if (binding) releaseTextEntity(binding);
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  /**
   * Lays the text out into `out` (the feature's system's shared buffer) and keeps its glyph
   * count, line count and bounds; clears the layout bit.
   * @internal
   */
  updateLayout(out: TextLayoutBuffer) {
    const params = this.layoutParams;
    params.lineHeight = this.lineHeight;
    layoutText(this._font, this._text, params, out, warnMissingGlyph);
    this._glyphCount = out.glyphCount;
    this._lineCount = out.lineCount;
    this._bounds.min.set(out.minX, out.minY, 0);
    this._bounds.max.set(out.maxX, out.maxY, 0);
    this.dirtyFlags &= ~TEXT_DIRTY_LAYOUT;
    return out.glyphCount;
  }

  private markDirty(flags: number) {
    if (this.disposed) return;
    this.dirtyFlags |= flags;
    queueTextUpdate(this);
  }

  /** Writes a valid size; warns and returns false for another */
  private writeSize(size: number) {
    if (size > 0 && Number.isFinite(size)) {
      this.layoutParams.size = size;
      return true;
    }
    lwarn(`[Text] Text "${this.id}": size ${size} isn't above 0. Kept ${this.layoutParams.size}.`);
    return false;
  }

  private writeLocalTransform(transform: TextLocalTransform) {
    if (transform.position) this._position.copy(transform.position);
    if (transform.quaternion) {
      this._quaternion.copy(transform.quaternion);
    } else if (transform.rotation) {
      const { x, y, z } = transform.rotation;
      this._quaternion.setFromEuler(scratchEuler.set(x, y, z));
    }
    if (transform.scale) this._scale.copy(transform.scale);
  }
}

const clampOpacity = (opacity: number) => Math.min(1, Math.max(0, opacity));
