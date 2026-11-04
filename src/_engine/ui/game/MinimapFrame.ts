import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { swallowNextKeyUp } from '../overlays/OverlayStack';
import { DIRECTION_NAMES, RAD_TO_DEG, getDirectionIndex, wrapDegrees } from './Directions';
import './MinimapFrame.scss';
import '../styles/kit.scss';

/** The words a {@link MinimapFrame} shows and says: replace them for another language. */
export type MinimapFrameTexts = {
  /** The zoom in button's name (default 'Zoom in'). */
  zoomIn?: string;
  /** The zoom out button's name (default 'Zoom out'). */
  zoomOut?: string;
  /** The north mark (default 'N'). */
  north?: string;
  /** The eight directions spoken, from north clockwise (default 'north', 'north-east', …). */
  names?: readonly string[];
  /** The player's heading for assistive tech (default `Facing ${name}`). */
  facing?: (name: string) => string;
};

/** What {@link createMinimapFrame} draws. */
export type MinimapFrameProps = {
  /** Its name for assistive tech (default 'Map'). */
  label?: string;
  /** The player's heading in radians, clockwise from north (default 0). */
  playerHeading?: number;
  /** The bearing at the map's top in radians (default 0: north up; the player's heading for a
   * map that turns with them). */
  mapHeading?: number;
  /** Shows the north mark (default true). */
  showNorth?: boolean;
  /** Shows zoom in and zoom out buttons, which call it with 1 (in) or -1 (out): the app moves its
   * viewport's camera. Default none: no buttons. */
  onZoom?: (direction: 1 | -1) => void;
  /** Its words (the language). */
  texts?: MinimapFrameTexts;
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A minimap frame {@link createMinimapFrame} made: its CMP and its setters, each writing it in
 * place. */
export type MinimapFrame = {
  /** Its element (`.aekMinimapFrame`): append it into the viewport's slot
   * (`viewport.slotElem`), which places it over the map. */
  cmp: CMPHandle;
  /** Turns the player's arrow to a heading in radians, clockwise from north. Writes nothing when
   * the arrow's rounded degree is unchanged, so a heading set every frame is fine. */
  setPlayerHeading: (heading: number) => void;
  /** Sets the bearing at the map's top in radians (a map turning with the player gets the
   * player's heading every frame): the north mark goes round the edge, the arrow turns against
   * it. Writes nothing when unchanged to the degree. */
  setMapHeading: (heading: number) => void;
  /** Disables a zoom button at its limit (`aria-disabled`: it keeps the focus and is read as
   * unavailable; a click does nothing). */
  setZoomEnabled: (enabled: { zoomIn?: boolean; zoomOut?: boolean }) => void;
  /** Changes its name for assistive tech. */
  setLabel: (label: string) => void;
};

const createPart = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string) => {
  const elem = document.createElement(tag);
  elem.className = className;
  return elem;
};

/**
 * Creates a minimap frame (p808 D7): the frame round a viewport that shows the map (the
 * `viewports()` feature's `createViewport`, a top-down camera), with a north mark, the player's
 * arrow at its centre and optional zoom buttons. The app appends it into the viewport's slot,
 * which places it over the rendered map; the map itself is the viewport's. Square: the viewport
 * renders into the canvas, which the DOM can't clip to a circle, so the corners outside its
 * rounded border are filled with the border's colour.
 * - Parts: `.aekMinimapFrame` (a `role="group"` named by `label`), `.aekMinimapFrame__border`,
 *   `.aekMinimapFrame__ring` with `.aekMinimapFrame__north`, `.aekMinimapFrame__player`,
 *   `.aekMinimapFrame__zoom` with its two `.aekMinimapFrame__zoomButton`s (`data-zoom="in" |
 *   "out"`), `.aekMinimapFrame__spoken`.
 * - Custom properties (read on any ancestor): `--aek-minimap-border-color` (default
 *   `--aek-border-strong`), `--aek-minimap-border-width` (default 3 px), `--aek-minimap-radius`
 *   (default `--aek-radius-lg`), `--aek-minimap-player-color` (default the accent),
 *   `--aek-minimap-player-size` (default `--aek-space-5`), `--aek-minimap-north-color` (default
 *   `--aek-text`); `--aek-minimap-player-angle` is the setters'.
 * - Keys: the zoom buttons are native buttons (Enter and Space click them, stopped before the
 *   action maps); the frame binds no other key (a game's map binds zoom to its own keys and calls
 *   its own zoom).
 * - Assistive tech: the frame is a group named by `label`; the map, the north mark and the arrow
 *   are pictures it can't read (p808 D4: the arrow and the mark `aria-hidden`), so a visually
 *   hidden text says the player's heading ('Facing north-east'), written when the nearest of the
 *   eight directions changes, not live. The frame lets the pointer through to the canvas but for
 *   its buttons.
 * - Motion: none; the arrow follows the heading.
 * @example
 * ```ts
 * import { createMinimapFrame } from 'aekasha/ui';
 *
 * let zoom = 1;
 * const frame = createMinimapFrame({
 *   label: 'Map of the arena',
 *   onZoom: (direction) => {
 *     zoom = Math.min(4, Math.max(1, zoom + direction));
 *     frame.setZoomEnabled({ zoomIn: zoom < 4, zoomOut: zoom > 1 });
 *     // the app's viewport camera: its zoom or height
 *   },
 * });
 * // viewport.slotElem.append(frame.cmp.elem) for the viewports feature's minimap viewport
 * frame.setPlayerHeading(Math.PI / 2); // each frame: the player's heading
 * ```
 */
export const createMinimapFrame = (props: MinimapFrameProps = {}): MinimapFrame => {
  const texts = props.texts ?? {};
  const names = texts.names ?? DIRECTION_NAMES;
  const facing = texts.facing ?? ((name: string) => `Facing ${name}`);
  let playerHeading = 0;
  let mapHeading = 0;
  let shownArrow = NaN;
  let shownNorth = NaN;
  let shownDirection = -1;

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekMinimapFrame', props.class),
    attr: { ...props.attr, role: 'group', 'aria-label': props.label ?? 'Map' },
    onRemoveCmp: () => {
      elem.removeEventListener('click', onClick);
      elem.removeEventListener('keydown', onKeyDown);
    },
  });
  const elem = cmp.elem;

  const border = createPart('span', 'aekMinimapFrame__border');
  border.setAttribute('aria-hidden', 'true');
  const ring = createPart('span', 'aekMinimapFrame__ring');
  ring.setAttribute('aria-hidden', 'true');
  const north = createPart('span', 'aekMinimapFrame__north');
  north.textContent = texts.north ?? 'N';
  north.hidden = props.showNorth === false;
  ring.append(north);
  const player = createPart('span', 'aekMinimapFrame__player');
  player.setAttribute('aria-hidden', 'true');
  const spoken = createPart('span', 'aekMinimapFrame__spoken aekVisuallyHidden');
  elem.append(border, ring, player);

  const onZoom = props.onZoom;
  const zoomButtons: HTMLButtonElement[] = [];
  if (onZoom) {
    const zoom = createPart('span', 'aekMinimapFrame__zoom');
    for (const [direction, label] of [
      ['in', texts.zoomIn ?? 'Zoom in'],
      ['out', texts.zoomOut ?? 'Zoom out'],
    ] as const) {
      const button = createPart('button', 'aekMinimapFrame__zoomButton');
      button.type = 'button';
      button.setAttribute('data-zoom', direction);
      button.setAttribute('aria-label', label);
      button.textContent = direction === 'in' ? '+' : '−';
      zoom.append(button);
      zoomButtons.push(button);
    }
    elem.append(zoom);
  }
  elem.append(spoken);

  const onClick = (e: Event) => {
    const button = (e.target as Element).closest?.('.aekMinimapFrame__zoomButton');
    if (!button || button.getAttribute('aria-disabled') === 'true') return;
    onZoom?.(button.getAttribute('data-zoom') === 'in' ? 1 : -1);
  };

  /** Enter and Space click a button themselves: kept from the action maps only */
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if ((e.target as Element).tagName !== 'BUTTON') return;
    e.stopPropagation();
    swallowNextKeyUp(e.key);
  };

  if (onZoom) {
    elem.addEventListener('click', onClick);
    elem.addEventListener('keydown', onKeyDown);
  }

  const write = () => {
    const arrow = Math.round(wrapDegrees(playerHeading - mapHeading));
    if (arrow !== shownArrow) {
      shownArrow = arrow;
      player.style.setProperty('--aek-minimap-player-angle', `${arrow}deg`);
    }
    const northAngle = Math.round(wrapDegrees(-mapHeading));
    if (northAngle !== shownNorth) {
      shownNorth = northAngle;
      // Onto the ring's square edge along north's direction from the centre
      const radians = northAngle / RAD_TO_DEG;
      const dx = Math.sin(radians);
      const dy = -Math.cos(radians);
      const scale = 0.5 / Math.max(Math.abs(dx), Math.abs(dy));
      north.style.left = `${Math.round((50 + dx * scale * 100) * 100) / 100}%`;
      north.style.top = `${Math.round((50 + dy * scale * 100) * 100) / 100}%`;
    }
    const direction = getDirectionIndex(playerHeading);
    if (direction !== shownDirection) {
      shownDirection = direction;
      spoken.textContent = facing(names[direction] ?? '');
    }
  };

  const toDegrees = (radians: number) =>
    wrapDegrees(Number.isFinite(radians) ? radians * RAD_TO_DEG : 0);
  playerHeading = toDegrees(props.playerHeading ?? 0);
  mapHeading = toDegrees(props.mapHeading ?? 0);
  write();

  return {
    cmp,
    setPlayerHeading: (heading) => {
      playerHeading = toDegrees(heading);
      write();
    },
    setMapHeading: (heading) => {
      mapHeading = toDegrees(heading);
      write();
    },
    setZoomEnabled: (enabled) => {
      const [zoomIn, zoomOut] = zoomButtons;
      if (zoomIn && enabled.zoomIn !== undefined) {
        if (enabled.zoomIn) zoomIn.removeAttribute('aria-disabled');
        else zoomIn.setAttribute('aria-disabled', 'true');
      }
      if (zoomOut && enabled.zoomOut !== undefined) {
        if (enabled.zoomOut) zoomOut.removeAttribute('aria-disabled');
        else zoomOut.setAttribute('aria-disabled', 'true');
      }
    },
    setLabel: (label) => {
      elem.setAttribute('aria-label', label);
    },
  };
};
