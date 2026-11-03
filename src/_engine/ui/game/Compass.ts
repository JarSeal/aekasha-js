import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import type { SvgIconKey } from '../core/icons/SvgIcon';
import { CMP, classes } from '../core/CMP';
import { getSvgIcon } from '../core/icons/SvgIcon';
import './Compass.scss';
import '../styles/kit.scss';

/** A marker on a {@link Compass}: a waypoint, a quest giver, a sound's direction. */
export type CompassMarker = {
  /** Its bearing in radians, clockwise from north (the compass's heading's unit). */
  bearing: number;
  /** A short text under its icon ('Camp', '120 m'); none by default. */
  label?: string;
  /** A registered icon's name (`registerIcon`); a diamond by default. */
  icon?: SvgIconKey;
  /** Its colour (`--aek-compass-marker-color`, default the accent); its icon or label tells it
   * apart too (never colour alone). */
  color?: string;
  /** Outside the compass's field: stays on the nearer end with an arrow out (`'clamp'`, the
   * default: turn this way) or hides. */
  offScreen?: 'clamp' | 'hide';
};

/** The words a {@link Compass} shows and says: replace them for another language. */
export type CompassTexts = {
  /** The eight directions shown on the strip, from north clockwise (default `N`, `NE`, `E`, …). */
  labels?: readonly string[];
  /** The eight directions spoken, from north clockwise (default 'north', 'north-east', …). */
  names?: readonly string[];
  /** The heading's text for assistive tech (default `Facing ${name}`). */
  facing?: (name: string) => string;
};

/** What {@link createCompass} draws. */
export type CompassProps = {
  /** The heading it starts at, in radians clockwise from north (default 0). */
  heading?: number;
  /** How much of the circle it shows, in radians (default `2π / 3`, 120°). */
  fov?: number;
  /** Markers by id. */
  markers?: Record<string, CompassMarker>;
  /** `'top'` (default): fixed at the top centre of the HUD's bounds. `'inline'`: in the flow of
   * what it's added to (a panel). */
  placement?: 'top' | 'inline';
  /** Its words (the language). */
  texts?: CompassTexts;
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A compass {@link createCompass} made: its CMP and its setters, each writing it in place. */
export type Compass = {
  /** Its element (`.aekCompass`): add it to the HUD root. */
  cmp: CMPHandle;
  /** Turns it to a heading in radians, clockwise from north (the toolkit's
   * `registerWorldAnchorSync` gives the camera's with its `compass` option). Writes nothing when
   * the heading moved less than a tenth of a degree, so a heading set every frame is fine. */
  setHeading: (heading: number) => void;
  /** Its heading in radians, clockwise from north, in [0, 2π). */
  getHeading: () => number;
  /** Adds a marker, or changes the one with the id (only what changed is written). */
  setMarker: (id: string, marker: CompassMarker) => void;
  /** Moves a marker (a waypoint's bearing from the player, every frame): allocates nothing. */
  setMarkerBearing: (id: string, bearing: number) => void;
  /** Removes a marker. */
  removeMarker: (id: string) => void;
  /** Whether it has a marker with the id. */
  hasMarker: (id: string) => boolean;
};

const DEFAULT_LABELS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const DEFAULT_NAMES = [
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
];
const DEG = 180 / Math.PI;

/** The strip's span in degrees: two turns from -180, so any field fits in it */
const STRIP_START = -180;
const STRIP_SPAN = 720;

type MarkerRecord = {
  id: string;
  elem: HTMLElement;
  icon: HTMLElement;
  label: HTMLElement;
  /** In degrees, [0, 360) */
  bearing: number;
  iconName: SvgIconKey | undefined;
  labelText: string;
  color: string;
  clamp: boolean;
  /** The written place: its offset from the centre in tenths of a degree, or an end's (±Infinity;
   * NaN: none) */
  shownOffset: number;
  /** The written edge: '' inside the field, 'start', 'end', 'hidden' */
  shownEdge: string;
};

const createPart = (className: string) => {
  const span = document.createElement('span');
  span.className = className;
  return span;
};

/** Degrees in [0, 360) */
const wrapDegrees = (degrees: number) => {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
};

/**
 * Creates a compass (p808 D7): a strip of the directions and their ticks that scrolls as the
 * player turns, and markers at bearings (a waypoint, a quest giver) that stay on its nearer end
 * when they're outside its field. The app gives the heading (a camera's yaw as a bearing:
 * clockwise from north) and the markers' bearings.
 * - Parts: `.aekCompass` (`data-placement`), `.aekCompass__window` (the visible field),
 *   `.aekCompass__track` (its clip, the ends faded) with `.aekCompass__strip` (two turns of ticks
 *   and `.aekCompass__label`s, `data-kind="cardinal" | "intercardinal"`), `.aekCompass__needle`
 *   (the centre), `.aekCompass__markers` with each `.aekCompass__marker` (`data-edge="start" |
 *   "end"` at an end, with an arrow out; `data-hidden`), its `__markerIcon` (`data-default`: the
 *   diamond) and `__markerLabel`, and `.aekCompass__spoken`.
 * - Custom properties (read on any ancestor): `--aek-compass-width` (default 10 × `--aek-space-7`),
 *   `--aek-compass-height` (the strip's, default `--aek-space-7`), `--aek-compass-bg`,
 *   `--aek-compass-color` (the labels and ticks, default `--aek-text`), `--aek-compass-needle-color`
 *   (default the accent), `--aek-compass-marker-color` (default the accent; a marker's `color`
 *   sets it on the marker), `--aek-compass-inset` (from the top, default `--aek-space-5`),
 *   `--aek-compass-z`.
 * - Per frame (p808 D4): the strip moves by a `transform` written when the heading moved a tenth
 *   of a degree; a marker's place when its offset from the heading did; nothing else is written,
 *   the strip's labels and ticks are made once.
 * - Assistive tech: the strip and the markers are `aria-hidden` (p808 D4: a moving picture of the
 *   heading); a visually hidden text says it in words ('Facing north-east'), written when the
 *   nearest of the eight directions changes, not per frame, and not live (a turn isn't
 *   announced). The markers are the game's to say otherwise (the objective tracker).
 * - Motion: none; it follows the heading.
 * @example
 * ```ts
 * import { createCompass, getHUDRootCMP } from 'aekasha/ui';
 *
 * const compass = createCompass({
 *   markers: { camp: { bearing: Math.PI / 2, label: 'Camp' } },
 * });
 * getHUDRootCMP().add(compass.cmp);
 * // Each frame: the camera's yaw as a bearing, and the waypoint's from the player
 * compass.setHeading(Math.PI / 4);
 * compass.setMarkerBearing('camp', 1.2);
 * ```
 */
export const createCompass = (props: CompassProps = {}): Compass => {
  // Rounded: 2π / 3 is 120.00000000000001°
  const fovDegrees =
    Math.round(Math.min(360, Math.max(1, (props.fov ?? (Math.PI * 2) / 3) * DEG)) * 1e6) / 1e6;
  const labels = props.texts?.labels ?? DEFAULT_LABELS;
  const names = props.texts?.names ?? DEFAULT_NAMES;
  const facing = props.texts?.facing ?? ((name: string) => `Facing ${name}`);
  const records: MarkerRecord[] = [];
  const byId = new Map<string, MarkerRecord>();

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekCompass', props.class),
    attr: { ...props.attr, 'data-placement': props.placement ?? 'top' },
    onRemoveCmp: () => {
      records.length = 0;
      byId.clear();
    },
  });
  const elem = cmp.elem;

  const windowElem = createPart('aekCompass__window');
  windowElem.setAttribute('aria-hidden', 'true');
  // The strip's clip (its ends faded); the markers are over it, not clipped
  const track = createPart('aekCompass__track');
  const strip = createPart('aekCompass__strip');
  // Two turns wide, in the field's units: the field is fovDegrees of it
  strip.style.width = `${(STRIP_SPAN / fovDegrees) * 100}%`;
  strip.style.setProperty('--aek-compass-ticks', String(STRIP_SPAN / 15));
  for (let bearing = STRIP_START; bearing < STRIP_START + STRIP_SPAN; bearing += 45) {
    const index = wrapDegrees(bearing) / 45;
    const label = createPart('aekCompass__label');
    label.setAttribute('data-kind', index % 2 === 0 ? 'cardinal' : 'intercardinal');
    label.style.left = `${((bearing - STRIP_START) / STRIP_SPAN) * 100}%`;
    label.textContent = labels[index] ?? '';
    strip.append(label);
  }
  const markersElem = createPart('aekCompass__markers');
  track.append(strip);
  windowElem.append(track, createPart('aekCompass__needle'), markersElem);
  const spoken = createPart('aekCompass__spoken aekVisuallyHidden');
  elem.append(windowElem, spoken);

  let heading = NaN;
  let shownHeading = NaN;
  let shownDirection = -1;

  const placeMarker = (record: MarkerRecord) => {
    // Its offset from the heading in (-180, 180], in tenths of a degree
    let offset = wrapDegrees(record.bearing - heading);
    if (offset > 180) offset -= 360;
    const tenths = Math.round(offset * 10);
    const half = fovDegrees / 2;
    const edge =
      Math.abs(offset) <= half ? '' : !record.clamp ? 'hidden' : offset < 0 ? 'start' : 'end';
    if (edge !== record.shownEdge) {
      record.shownEdge = edge;
      if (edge === 'hidden') record.elem.setAttribute('data-hidden', '');
      else record.elem.removeAttribute('data-hidden');
      if (edge === 'start' || edge === 'end') record.elem.setAttribute('data-edge', edge);
      else record.elem.removeAttribute('data-edge');
    }
    if (edge === 'hidden') return;
    const place = edge === 'start' ? -Infinity : edge === 'end' ? Infinity : tenths;
    if (place === record.shownOffset) return;
    record.shownOffset = place;
    record.elem.style.left =
      edge === 'start'
        ? '0%'
        : edge === 'end'
          ? '100%'
          : `${50 + (tenths / 10 / fovDegrees) * 100}%`;
  };

  const writeHeading = () => {
    const tenths = Math.round(heading * 10);
    if (tenths !== shownHeading) {
      shownHeading = tenths;
      // The heading's place on the strip at the field's centre
      const shift = (fovDegrees / 2 - (tenths / 10 - STRIP_START)) / STRIP_SPAN;
      strip.style.transform = `translateX(${shift * 100}%)`;
    }
    const direction = Math.round(heading / 45) % 8;
    if (direction !== shownDirection) {
      shownDirection = direction;
      spoken.textContent = facing(names[direction] ?? '');
    }
    for (let i = 0; i < records.length; i++) placeMarker(records[i]);
  };

  const setHeading = (radians: number) => {
    const next = wrapDegrees(Number.isFinite(radians) ? radians * DEG : 0);
    if (Math.round(next * 10) === shownHeading) return;
    heading = next;
    writeHeading();
  };

  const setMarker = (id: string, marker: CompassMarker) => {
    let record = byId.get(id);
    if (!record) {
      const markerElem = createPart('aekCompass__marker');
      const icon = createPart('aekCompass__markerIcon');
      const label = createPart('aekCompass__markerLabel');
      markerElem.append(icon, label);
      markersElem.append(markerElem);
      record = {
        id,
        elem: markerElem,
        icon,
        label,
        bearing: 0,
        iconName: undefined,
        labelText: '',
        color: '',
        clamp: true,
        shownOffset: NaN,
        shownEdge: '',
      };
      // Drawn on the first pass below
      icon.setAttribute('data-default', '');
      label.hidden = true;
      records.push(record);
      byId.set(id, record);
    }
    if (marker.icon !== record.iconName) {
      record.iconName = marker.icon;
      record.icon.innerHTML = marker.icon ? getSvgIcon(marker.icon) : '';
      if (marker.icon) record.icon.removeAttribute('data-default');
      else record.icon.setAttribute('data-default', '');
    }
    const labelText = marker.label ?? '';
    if (labelText !== record.labelText) {
      record.labelText = labelText;
      record.label.textContent = labelText;
      record.label.hidden = labelText === '';
    }
    const color = marker.color ?? '';
    if (color !== record.color) {
      record.color = color;
      if (color) record.elem.style.setProperty('--aek-compass-marker-color', color);
      else record.elem.style.removeProperty('--aek-compass-marker-color');
    }
    record.clamp = marker.offScreen !== 'hide';
    record.bearing = wrapDegrees(marker.bearing * DEG);
    placeMarker(record);
  };

  const removeMarker = (id: string) => {
    const record = byId.get(id);
    if (!record) return;
    byId.delete(id);
    records.splice(records.indexOf(record), 1);
    record.elem.remove();
  };

  heading = wrapDegrees((props.heading ?? 0) * DEG);
  writeHeading();
  if (props.markers) {
    for (const id of Object.keys(props.markers)) setMarker(id, props.markers[id]);
  }

  return {
    cmp,
    setHeading,
    getHeading: () => heading / DEG,
    setMarker,
    setMarkerBearing: (id, bearing) => {
      const record = byId.get(id);
      if (!record) return;
      record.bearing = wrapDegrees(bearing * DEG);
      placeMarker(record);
    },
    removeMarker,
    hasMarker: (id) => byId.has(id),
  };
};
