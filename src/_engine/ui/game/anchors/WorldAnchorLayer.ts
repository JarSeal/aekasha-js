import type { CMPAttr, CMPHandle } from '../../core/CMPTypes';
import { CMP, classes } from '../../core/CMP';
import { PROJECTED_CLAMPED, PROJECTED_HIDDEN, projectWorldPoint } from './AnchorProjection';
import type { AnchorPoint, WorldAnchorView } from './AnchorProjection';
import './WorldAnchorLayer.scss';
import '../../styles/kit.scss';

/** What an anchor does off the screen or behind the camera: hides, or stays on the screen's edge
 * with an arrow turned toward its point (a waypoint). */
export type WorldAnchorOffScreen = 'hide' | 'clamp';

/** Where an anchor's content sits on its point: centred on it, above it (its bottom on the point:
 * a nameplate over a head) or below it. */
export type WorldAnchorAlign = 'center' | 'above' | 'below';

/** Whether an anchor shows, as its last update found it. */
export type WorldAnchorState = 'shown' | 'clamped' | 'hidden';

/** What {@link createWorldAnchorLayer} draws. */
export type WorldAnchorLayerProps = {
  /** Hides every anchor farther than this from the camera, in world units (default `Infinity`);
   * an anchor's `maxDistance` takes its place. */
  cullDistance?: number;
  /** A clamped anchor's distance from the edge, in CSS px (default 32): room for its content. */
  edgePadding?: number;
  /** Gives a nearer anchor a higher `z-index`, written only when the order changes (default
   * false: the anchors stack in the order they were added). */
  depthSort?: boolean;
  /** `'hud'` (default): fixed over the HUD's bounds, the canvas. `'inline'`: absolute over its
   * positioned container (a panel's box). */
  placement?: 'hud' | 'inline';
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** An anchor {@link WorldAnchorLayer.addAnchor} adds. */
export type WorldAnchorProps = {
  /** What it shows: a text (a nameplate's name) or a CMP (removed with the anchor). */
  content?: CMPHandle | string | null;
  /** Its world position until `setPosition` (default none: hidden until one is set). */
  position?: { x: number; y: number; z: number };
  /** Moves the content from its point on the screen, in CSS px (default none). Not applied while
   * clamped. */
  offset?: { x: number; y: number };
  /** Where the content sits on its point (default `'center'`; a clamped anchor is centred). */
  align?: WorldAnchorAlign;
  /** Off the screen or behind the camera (default `'hide'`). */
  offScreen?: WorldAnchorOffScreen;
  /** Hidden farther than this from the camera, in world units (default the layer's
   * `cullDistance`; `Infinity` for a waypoint seen from anywhere). */
  maxDistance?: number;
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** An anchor in a {@link WorldAnchorLayer}: its CMP and its setters. */
export type WorldAnchor = {
  /** Its element (`.aekWorldAnchor`), in the layer. */
  cmp: CMPHandle;
  /** Sets its world position, read by the layer's next `update`. Only stores the numbers, so a
   * position set every frame is fine. */
  setPosition: (x: number, y: number, z: number) => void;
  /** Replaces what it shows; a CMP shown before is removed. */
  setContent: (content: CMPHandle | string | null) => void;
  /** Hides it whatever the camera sees (an enemy behind a wall), or lets the update decide. */
  setVisible: (visible: boolean) => void;
  /** Whether the last update showed it, clamped it to the edge or hid it. */
  getState: () => WorldAnchorState;
  /** Its distance from the camera at the last update, in world units (`NaN` before one): a
   * waypoint's '120 m' text, which the app writes when the rounded number changes. */
  getDistance: () => number;
  /** Removes it from the layer (its `cmp.remove()`). */
  remove: () => void;
};

/** A world anchor layer {@link createWorldAnchorLayer} made: its CMP, its anchors and its
 * per-frame update. */
export type WorldAnchorLayer = {
  /** Its element (`.aekWorldAnchorLayer`): add it to the HUD root (or, `'inline'`, to a
   * positioned box). */
  cmp: CMPHandle;
  /** Adds an anchor. */
  addAnchor: (props?: WorldAnchorProps) => WorldAnchor;
  /** Projects every anchor with the camera and moves each whose rounded pixel position changed:
   * call it once a frame, after the camera moved (the toolkit's `registerWorldAnchorSync` does).
   * Allocates nothing; writes nothing for an anchor that didn't move. */
  update: (view: WorldAnchorView) => void;
  /** Removes every anchor (a scene's exit). */
  clear: () => void;
  /** How many anchors it holds. */
  getAnchorCount: () => number;
};

/** An anchor's own state, read and written by the update (one shape: the loop stays monomorphic) */
type AnchorRecord = AnchorPoint & {
  cmp: CMPHandle;
  elem: HTMLElement;
  hasPosition: boolean;
  isVisible: boolean;
  offsetX: number;
  offsetY: number;
  /** The state written, `PROJECTED_*` (-1: none yet) */
  state: number;
  /** The rounded position written */
  shownX: number;
  shownY: number;
  /** The rounded arrow angle written, in degrees */
  shownAngle: number;
  distance: number;
  /** The depth order's key: the distance, `Infinity` while hidden (to the back) */
  depth: number;
  /** The z-index written (-1: none) */
  shownZ: number;
};

const STATE_NAMES: readonly WorldAnchorState[] = ['shown', 'clamped', 'hidden'];

const createPart = (className: string) => {
  const span = document.createElement('span');
  span.className = className;
  return span;
};

const setBodyContent = (body: CMPHandle, content: CMPHandle | string | null | undefined) => {
  body.removeChildren();
  body.elem.textContent = '';
  if (typeof content === 'string') body.elem.textContent = content;
  else if (content) body.add(content);
};

/**
 * Creates a world anchor layer (p808 D7): HUD content that follows points in the 3D world,
 * nameplates over characters, a waypoint, a damage number. The app (or the toolkit's
 * `registerWorldAnchorSync`, from entities) sets each anchor's world position, and `update`
 * projects them all with the camera once a frame: an anchor behind the camera or off the screen
 * hides, or with `offScreen: 'clamp'` stays on the screen's edge with an arrow toward its point;
 * one past its distance hides.
 * - Parts: `.aekWorldAnchorLayer` (`data-placement`), `.aekWorldAnchor` (`data-state="shown" |
 *   "clamped" | "hidden"`, `data-align`), its `.aekWorldAnchor__body` (the content) and
 *   `.aekWorldAnchor__arrow` (shown while clamped).
 * - Custom properties (read on any ancestor): `--aek-world-anchor-color` (the content's text,
 *   default `--aek-text`), `--aek-world-anchor-halo` (the text's outline over the scene, default
 *   `--aek-bg`), `--aek-world-anchor-arrow-color` (default `--aek-accent`),
 *   `--aek-world-anchor-arrow-distance` (from the content's centre, default 20 px),
 *   `--aek-world-anchor-layer-z` (the layer's `z-index`, default `auto`: under the HUD's other
 *   pieces added after it); `--aek-world-anchor-angle` is the update's.
 * - Per frame (p808 D4): an anchor's `transform` is written only when its rounded pixel position
 *   changed, its state and arrow only when they changed, nothing is allocated but those strings,
 *   and nothing is sorted unless `depthSort` (an insertion sort in place, nearly sorted from the
 *   frame before, and a `z-index` written only where an anchor's place changed). The layer has
 *   `contain: strict`, so its anchors' moves lay out nothing outside it.
 * - Assistive tech: the content is the app's and is read as it is (a nameplate's name), a hidden
 *   anchor is `display: none`; the arrow is `aria-hidden` (p808 D4: the direction to a waypoint
 *   the game also gives otherwise, the compass's marker, the tracker's text). The layer takes no
 *   pointer events.
 * - Motion: none; an anchor moves with the camera.
 * @example
 * ```ts
 * import { createWorldAnchorLayer, getHUDRootCMP } from 'aekasha/ui';
 * import type { WorldAnchorView } from 'aekasha/ui';
 *
 * const layer = createWorldAnchorLayer({ cullDistance: 40 });
 * getHUDRootCMP().add(layer.cmp);
 * const nameplate = layer.addAnchor({ content: 'Mara', align: 'above' });
 * const waypoint = layer.addAnchor({ content: '◆', offScreen: 'clamp', maxDistance: Infinity });
 * waypoint.setPosition(12, 0, -30);
 *
 * // Each frame (one kept object, so nothing is allocated)
 * const view: WorldAnchorView = {
 *   viewProjection: new Float64Array(16),
 *   width: 0,
 *   height: 0,
 *   cameraPosition: { x: 0, y: 0, z: 0 },
 * };
 * const onFrame = (npc: { x: number; y: number; z: number }) => {
 *   nameplate.setPosition(npc.x, npc.y + 2, npc.z);
 *   // view.viewProjection = the camera's matrix, view.width / height = getCanvasSize()
 *   layer.update(view);
 * };
 * ```
 */
export const createWorldAnchorLayer = (props: WorldAnchorLayerProps = {}): WorldAnchorLayer => {
  const cullDistance = props.cullDistance ?? Infinity;
  const edgePadding = props.edgePadding ?? 32;
  const depthSort = props.depthSort ?? false;
  const records: AnchorRecord[] = [];
  // The depth order, nearest first (depthSort only)
  const order: AnchorRecord[] = [];
  const out = new Float64Array(4);

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekWorldAnchorLayer', props.class),
    attr: { ...props.attr, 'data-placement': props.placement ?? 'hud' },
    onRemoveCmp: () => {
      records.length = 0;
      order.length = 0;
    },
  });

  const forget = (record: AnchorRecord) => {
    const index = records.indexOf(record);
    if (index !== -1) records.splice(index, 1);
    const orderIndex = order.indexOf(record);
    if (orderIndex !== -1) order.splice(orderIndex, 1);
  };

  const writeState = (record: AnchorRecord, state: number) => {
    if (state === record.state) return;
    record.state = state;
    record.elem.setAttribute('data-state', STATE_NAMES[state]);
  };

  const place = (record: AnchorRecord, state: number) => {
    const x = Math.round(state === PROJECTED_CLAMPED ? out[0] : out[0] + record.offsetX);
    const y = Math.round(state === PROJECTED_CLAMPED ? out[1] : out[1] + record.offsetY);
    if (x !== record.shownX || y !== record.shownY) {
      record.shownX = x;
      record.shownY = y;
      record.elem.style.transform = `translate(${x}px, ${y}px)`;
    }
    if (state === PROJECTED_CLAMPED) {
      const angle = Math.round((out[2] * 180) / Math.PI);
      if (angle !== record.shownAngle) {
        record.shownAngle = angle;
        record.elem.style.setProperty('--aek-world-anchor-angle', `${angle}deg`);
      }
    }
    writeState(record, state);
  };

  // Nearest first, in place: nearly sorted from the frame before, so about one pass
  const sortByDepth = () => {
    for (let i = 1; i < order.length; i++) {
      const record = order[i];
      let j = i - 1;
      while (j >= 0 && order[j].depth > record.depth) {
        order[j + 1] = order[j];
        j--;
      }
      order[j + 1] = record;
    }
    const count = order.length;
    for (let i = 0; i < count; i++) {
      const record = order[i];
      const z = count - i;
      if (z !== record.shownZ) {
        record.shownZ = z;
        record.elem.style.zIndex = String(z);
      }
    }
  };

  const update = (view: WorldAnchorView) => {
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      if (!record.hasPosition || !record.isVisible) {
        record.depth = Infinity;
        writeState(record, PROJECTED_HIDDEN);
        continue;
      }
      const state = projectWorldPoint(view, record, edgePadding, out);
      record.distance = out[3];
      if (state === PROJECTED_HIDDEN) {
        record.depth = Infinity;
        writeState(record, PROJECTED_HIDDEN);
        continue;
      }
      record.depth = out[3];
      place(record, state);
    }
    if (depthSort) sortByDepth();
  };

  const addAnchor = (anchorProps: WorldAnchorProps = {}): WorldAnchor => {
    let record: AnchorRecord | null = null;
    const anchorCmp = CMP({
      id: anchorProps.id,
      idAttr: anchorProps.id !== undefined,
      class: classes('aekWorldAnchor', anchorProps.class),
      attr: {
        ...anchorProps.attr,
        'data-state': 'hidden',
        'data-align': anchorProps.align ?? 'center',
      },
      onRemoveCmp: () => {
        if (record) forget(record);
      },
    });
    const body = anchorCmp.add({ class: 'aekWorldAnchor__body' });
    const arrow = createPart('aekWorldAnchor__arrow');
    arrow.setAttribute('aria-hidden', 'true');
    anchorCmp.elem.append(arrow);
    setBodyContent(body, anchorProps.content);

    const position = anchorProps.position;
    const created: AnchorRecord = {
      x: position?.x ?? 0,
      y: position?.y ?? 0,
      z: position?.z ?? 0,
      clamp: anchorProps.offScreen === 'clamp',
      maxDistance: anchorProps.maxDistance ?? cullDistance,
      cmp: anchorCmp,
      elem: anchorCmp.elem,
      hasPosition: position !== undefined,
      isVisible: true,
      offsetX: anchorProps.offset?.x ?? 0,
      offsetY: anchorProps.offset?.y ?? 0,
      state: PROJECTED_HIDDEN,
      shownX: NaN,
      shownY: NaN,
      shownAngle: NaN,
      distance: NaN,
      depth: Infinity,
      shownZ: -1,
    };
    record = created;
    records.push(created);
    if (depthSort) order.push(created);
    cmp.add(anchorCmp);

    return {
      cmp: anchorCmp,
      setPosition: (x, y, z) => {
        created.x = x;
        created.y = y;
        created.z = z;
        created.hasPosition = true;
      },
      setContent: (content) => setBodyContent(body, content),
      setVisible: (visible) => {
        created.isVisible = visible;
        if (!visible) writeState(created, PROJECTED_HIDDEN);
      },
      getState: () => STATE_NAMES[created.state],
      getDistance: () => created.distance,
      remove: () => {
        anchorCmp.remove();
      },
    };
  };

  return {
    cmp,
    addAnchor,
    update,
    clear: () => {
      // Each removal forgets its record
      for (let i = records.length - 1; i >= 0; i--) records[i].cmp.remove();
    },
    getAnchorCount: () => records.length,
  };
};
