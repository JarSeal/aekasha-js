// The Character state window's read-only rows (p806 D10, D11): the State and Internal memory
// groups' values, and the Properties values no editor takes, as the kit's monitors read on the
// window's refresh only. A row's shape (its kind) is fixed at its build: the window rebuilds the
// groups when a value changes it.
import { createFlash } from '../../../ui/forms/binding/BindingScheduler';
import type { PropertyGridFieldItem } from '../../../ui/forms/PropertyGridItems';
import { getPhysicsState } from '../../physics/PhysicsState';
import { getPhysicsSnapshotStepIndex } from '../../physics/PhysicsStepping';
import {
  getShownSource,
  RAD_TO_DEG,
  type GroupId,
  type StateRow,
  type StateWindowInstance,
} from './_dbg__CharacterStateWindowState';
import styles from './CharacterStateWindow.module.scss';

type RowKind = 'BOOL' | 'NUMBER' | 'STRING' | 'VECTOR' | 'NUM_ARRAY' | 'OTHER';
/** A known number key's display: a physics step stamp (-1 = unset), or an angle in radians */
export type NumberFormat = 'STEP_AGO' | 'RAD_DEG';

const ARRAY_MAX_ITEMS = 8;
const OTHER_MAX_CHARS = 120;

/** Readable displays for known keys (any other key gets its type's display) */
export const NUMBER_FORMATS: Record<string, NumberFormat> = {
  jumpStep: 'STEP_AGO',
  isFallingStartStep: 'STEP_AGO',
  isTumblingStartStep: 'STEP_AGO',
  isGettingUpStartStep: 'STEP_AGO',
  locomotionStateStartStep: 'STEP_AGO',
  charRotation: 'RAD_DEG',
  maxWalkableAngle: 'RAD_DEG',
};

/** Values written by an async physics query, so they can trail the other values by a step */
export const LATE_VALUE_NOTE = 'Set by an async physics query: can be a physics step behind.';
const LATE_KEYS = new Set([
  'groundNormal',
  'groundIsWalkable',
  'isNearWall',
  'touchingWallColliders',
]);

const VECTOR_AXES = ['x', 'y', 'z', 'w'];

/** A vector-like value's axes, consecutive from x (at least two), and whether a `length` follows
 * them (velocities carry theirs). Null for anything else. */
const getVectorShape = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  const hasLength = keys.includes('length') && typeof obj.length === 'number';
  const axisCount = keys.length - (hasLength ? 1 : 0);
  if (axisCount < 2 || axisCount > 4) return null;
  for (let i = 0; i < axisCount; i++) {
    if (typeof obj[VECTOR_AXES[i]] !== 'number') return null;
  }
  // A length in place of a missing w (the monitor's axes are x to w)
  return { axes: VECTOR_AXES.slice(0, axisCount), hasLength: hasLength && axisCount < 4 };
};

const getRowKind = (value: unknown): RowKind => {
  if (typeof value === 'boolean') return 'BOOL';
  if (typeof value === 'number') return 'NUMBER';
  if (typeof value === 'string') return 'STRING';
  if (Array.isArray(value)) {
    return value.every((v) => typeof v === 'number') ? 'NUM_ARRAY' : 'OTHER';
  }
  return getVectorShape(value) ? 'VECTOR' : 'OTHER';
};

/** Vectors and State numbers change almost every frame, so they never flash. Everything else
 * changes on an event worth seeing (eg. a one-frame `isGrounded` flip, a stamped timestamp). */
const rowFlashes = (groupId: GroupId, kind: RowKind) =>
  groupId === 'props' || (kind !== 'VECTOR' && !(groupId === 'state' && kind === 'NUMBER'));

/** A cheap per-update check that a row's value still has the shape the row was built for. */
const matchesRowKind = (kind: RowKind, value: unknown) => {
  switch (kind) {
    case 'BOOL':
      return typeof value === 'boolean';
    case 'NUMBER':
      return typeof value === 'number';
    case 'STRING':
      return typeof value === 'string';
    case 'VECTOR':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'NUM_ARRAY':
      return Array.isArray(value);
    default:
      return true;
  }
};

/** `!==`, except that NaN equals NaN (otherwise a NaN value would flash on every update). */
const hasChanged = (prev: unknown, next: unknown) =>
  prev !== next && (prev === prev || next === next);

const formatNumber = (value: unknown) =>
  typeof value === 'number' ? value.toFixed(3) : String(value);

export const formatRadians = (value: unknown) =>
  typeof value === 'number'
    ? `${value.toFixed(3)} rad (${(value * RAD_TO_DEG).toFixed(1)}°)`
    : String(value);

const formatStepAgo = (steps: unknown) => {
  if (typeof steps !== 'number' || steps < 0) return '—';
  const ms = Math.round(steps * getPhysicsState().timestepRatio * 1000);
  return `${steps} steps (${ms} ms) ago`;
};

const formatNumArray = (arr: unknown[]) => {
  const shown = arr.length > ARRAY_MAX_ITEMS ? arr.slice(0, ARRAY_MAX_ITEMS) : arr;
  const more = arr.length - shown.length;
  return `(${arr.length}) ${shown.join(', ')}${more > 0 ? ` … +${more}` : ''}`;
};

const stringifyOther = (value: unknown) => {
  try {
    const str = JSON.stringify(value);
    return str === undefined ? String(value) : str;
  } catch {
    return String(value);
  }
};

const truncate = (str: string, max: number) => (str.length > max ? `${str.slice(0, max)}…` : str);

/** The read's value per kind: the monitor's binding reads it, and it flashes the row (`noteChange`)
 * when the raw value changed. No allocation for the primitives and the vectors. */
const getRowReader = (
  kind: RowKind,
  format: NumberFormat | null,
  read: () => unknown,
  noteChange: (changed: boolean) => void,
  firstValue: unknown
): Pick<PropertyGridFieldItem, 'format' | 'precision' | 'onText' | 'offText'> & {
  get: () => unknown;
} => {
  let last: unknown = undefined;
  switch (kind) {
    case 'NUMBER':
      if (format === 'STEP_AGO') {
        // Its age grows with the steps: the read is the age, the flash the stamp's change
        return {
          get: () => {
            const stamp = read();
            noteChange(hasChanged(last, stamp));
            last = stamp;
            if (typeof stamp !== 'number' || stamp < 0) return -1;
            return Math.max(0, getPhysicsSnapshotStepIndex() - 1 - stamp);
          },
          format: formatStepAgo,
        };
      }
      return {
        get: () => {
          const value = read();
          noteChange(hasChanged(last, value));
          last = value;
          return value;
        },
        ...(format === 'RAD_DEG' ? { format: formatRadians } : { precision: 3 }),
      };
    case 'VECTOR': {
      // A scratch of the axes (a length as `w`), so the monitor compares them all: the object
      // is mutated in place, so its reference never changes
      const shape = getVectorShape(firstValue)!;
      const scratch: Record<string, number> = {};
      const slots = shape.hasLength ? [...shape.axes, 'w'] : shape.axes;
      const sources = shape.hasLength ? [...shape.axes, 'length'] : shape.axes;
      const names = shape.hasLength ? [...shape.axes, 'len'] : shape.axes;
      for (const slot of slots) scratch[slot] = 0;
      return {
        get: () => {
          const obj = read() as Record<string, number> | null;
          if (!obj || typeof obj !== 'object') return scratch;
          for (let i = 0; i < slots.length; i++) scratch[slots[i]] = obj[sources[i]];
          return scratch;
        },
        format: (value) => {
          const vector = value as Record<string, number>;
          return slots.map((slot, i) => `${names[i]} ${formatNumber(vector[slot])}`).join('  ');
        },
      };
    }
    case 'NUM_ARRAY': {
      // The text made only when an element changed
      const lastItems: unknown[] = [];
      let text = '';
      return {
        get: () => {
          const arr = read();
          if (!Array.isArray(arr)) return text;
          let changed = arr.length !== lastItems.length;
          for (let i = 0; !changed && i < arr.length; i++)
            changed = hasChanged(lastItems[i], arr[i]);
          if (changed) {
            noteChange(true);
            lastItems.length = arr.length;
            for (let i = 0; i < arr.length; i++) lastItems[i] = arr[i];
            text = formatNumArray(arr);
          }
          return text;
        },
      };
    }
    case 'OTHER': {
      let text = '';
      return {
        get: () => {
          const next = stringifyOther(read());
          if (next !== last) {
            noteChange(true);
            last = next;
            text = truncate(next, OTHER_MAX_CHARS);
          }
          return text;
        },
      };
    }
    default:
      return {
        get: () => {
          const value = read();
          noteChange(hasChanged(last, value));
          last = value;
          return value;
        },
        ...(kind === 'BOOL' ? { onText: 'true', offText: 'false' } : {}),
      };
  }
};

/**
 * A read-only row: the value of `groupId`'s object at `key` as a monitor read by the window's
 * refresh only (`interval: 'refresh'`; while frozen, the freeze's copy). A row that flashes
 * (`rowFlashes`) sets the kit's `data-flash` on its field (`createFlash`, drawn by the window's
 * stylesheet) when the window's refresh reads a changed value, with the window's Flash setting on.
 * @param value the value at the build: the row's kind
 */
export const getReadonlyRowItem = (
  inst: StateWindowInstance,
  groupId: GroupId,
  key: string,
  value: unknown
): { item: PropertyGridFieldItem; row: StateRow } => {
  const kind = getRowKind(value);
  const format = (kind === 'NUMBER' && NUMBER_FORMATS[key]) || null;
  const flashes = rowFlashes(groupId, kind);
  let flash: (() => void) | null = null;
  const noteChange = (changed: boolean) => {
    if (changed && flash && inst.isRefreshing && inst.settings.flash) flash();
  };
  const read = () => getShownSource(inst, groupId)[key];
  const reader = getRowReader(kind, format, read, noteChange, value);
  const item: PropertyGridFieldItem = {
    ...reader,
    label: key,
    kind: 'monitor',
    readonly: true,
    interval: 'refresh',
    ...(inst.settings.notes && LATE_KEYS.has(key) ? { hint: LATE_VALUE_NOTE } : {}),
    ...(flashes
      ? {
          class: styles.flashRow,
          onCreate: (field) => {
            const rowFlash = createFlash(field.cmp.elem);
            flash = rowFlash.flash;
            inst.flashDisposers.push(rowFlash.dispose);
          },
        }
      : {}),
  };
  return { item, row: { key, groupId, matches: (next) => matchesRowKind(kind, next) } };
};
