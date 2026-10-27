// The binding (p804 D3): where a field's value lives, how it's written, and the events a write
// fires. Every field holds one; the scheduler (BindingScheduler.ts) decides when it's read.

/**
 * Where a field's value lives (p804 D3), one of three:
 * - `{ target, key }` reads `target[key]` and writes it in place (Tweakpane's model): an object
 *   value (a vector, a colour, a rotation) is written field by field into the object that's
 *   there, so a `THREE.Vector3` stays the same instance;
 * - `{ get, set }`: any source (an ECS component, a setter with side effects, a store); `set` gets
 *   a value of its own, which it may keep;
 * - `{ value }`: unbound, the field holds the value (a form's fields); read it with `getValue()`.
 * @template T the value's type
 */
export type BindingSource<T> =
  | {
      /** The object holding the value. */
      target: object;
      /** The value's key on `target`. */
      key: string;
      get?: never;
      set?: never;
      value?: never;
    }
  | {
      /** Reads the value: on creation, on every refresh, and on the tick for a live field. */
      get: () => T;
      /** Writes a value the user or `setValue` gave. */
      set: (value: T) => void;
      target?: never;
      key?: never;
      value?: never;
    }
  | {
      /** The first value of a field that holds its own. */
      value: T;
      target?: never;
      key?: never;
      get?: never;
      set?: never;
    };

/**
 * A source that is only read (p804 D3's `{ get, set }` without the `set`): a monitor's, or a field
 * with `readonly: true`. A `setValue` draws its value until the next read.
 * @template T the value's type
 */
export type ReadonlyBindingSource<T> = {
  /** Reads the value: on creation, on every refresh, and on the tick. */
  get: () => T;
  set?: never;
  target?: never;
  key?: never;
  value?: never;
};

/**
 * What a field's `onChange` gets with the value (p804 D3). It fires on every write: each step of
 * a drag or a held key with `last: false`, then once with `last: true` on the release, Enter, a
 * blur or the key's keyup; a click (a checkbox, a pick) writes once with `last: true`. A refresh
 * from the bound value never fires it.
 * @template T the value's type
 */
export type BindingChange<T> = {
  /** The value before this step, or with `last: true` before the gesture's first step. */
  prev: T;
  /** Whether the gesture ended: the write to commit, record or persist. */
  last: boolean;
  /** `'user'` for the user's input (a reset included), `'api'` for `setValue`. */
  source: 'user' | 'api';
};

/**
 * How a binding compares and copies its value type: a primitive is compared with `===` and
 * replaced; an object (`createObjectValueKind`) component by component, copied into the object
 * that's there.
 * @internal
 */
export type BindingValueKind<T> = {
  /** Whether two values are the same */
  equals: (a: T, b: T) => boolean;
  /** `from` copied into `into` (returned), or into a new value without one; a primitive is itself */
  copy: (from: T, into?: T) => T;
};

/** `===`, with NaN equal to itself (a bound NaN would read as a change on every refresh) */
const isSameValue = (a: unknown, b: unknown) => a === b || (a !== a && b !== b);

const PRIMITIVE_KIND: BindingValueKind<unknown> = {
  equals: isSameValue,
  copy: (from) => from,
};

/**
 * The value kind of a number, a string, a boolean or any value replaced as a whole.
 * @internal
 */
export const getPrimitiveValueKind = <T>() => PRIMITIVE_KIND as BindingValueKind<T>;

/**
 * The value kind of an object read and written by its `keys` (`['x', 'y', 'z']`): compared and
 * copied component by component, a copy a plain object, or what `create` makes (an array, for a
 * number array's indices) (a `THREE.Euler`'s accessors read and write the same way). No
 * allocation when copying into a value.
 * @internal
 */
export const createObjectValueKind = <T extends object>(
  keys: readonly string[],
  create: () => object = () => ({})
): BindingValueKind<T> => ({
  equals: (a, b) => {
    const x = a as Record<string, unknown>;
    const y = b as Record<string, unknown>;
    for (let i = 0; i < keys.length; i++) if (!isSameValue(x[keys[i]], y[keys[i]])) return false;
    return true;
  },
  copy: (from, into) => {
    const source = from as Record<string, unknown>;
    const out = (into ?? create()) as Record<string, unknown>;
    for (let i = 0; i < keys.length; i++) out[keys[i]] = source[keys[i]];
    return out as T;
  },
});

/** What {@link createBinding} binds. */
type BindingProps<T> = (BindingSource<T> | ReadonlyBindingSource<T>) & {
  kind: BindingValueKind<T>;
  /** Every write's event (D3) */
  onChange?: (value: T, change: BindingChange<T>) => void;
};

/**
 * A field's binding: the value it last read or wrote (its own copy), the writes and their events.
 * @internal
 */
export type Binding<T> = {
  /** The value as last read or written: the binding's own copy, which a caller never keeps or
   * changes (a field draws from it) */
  peek: () => T;
  /** The bound value, read now, as a copy */
  getValue: () => T;
  /** Reads the bound value into the kept copy (no allocation for an object); whether it changed */
  sync: () => boolean;
  /** A gesture's step (a drag move, a key's keydown): writes and fires `last: false`; an equal
   * value starts the gesture and writes nothing */
  step: (value: T) => void;
  /** Ends the gesture: `last: true` with the last value and the gesture's first `prev`, even when
   * the last step changed nothing; nothing without a gesture */
  commit: () => void;
  /** One write that is its own gesture (a click, a pick, Enter, a reset): `last: true`; an equal
   * value writes nothing. Ends an open gesture with it. */
  change: (value: T) => void;
  /** Writes from code: `source: 'api'`, or no event with `silent` (an undo handler's); a value
   * equal to the bound one (read first) writes nothing */
  setValue: (value: T, options?: { silent?: boolean }) => void;
  /** Whether a gesture is open */
  isInGesture: () => boolean;
};

/**
 * Binds a value (p804 D3): `{ target, key }`, `{ get, set }` or `{ value }`, compared and copied
 * by `kind`. The events are D3's order: each `step` fires `last: false`, `commit` fires `last:
 * true` with the gesture's first `prev`, `change` one `last: true`; the handler gets copies (it
 * may keep them), after the value is written and kept, so a refresh from inside it reads no
 * change.
 * @internal
 */
export const createBinding = <T>(props: BindingProps<T>): Binding<T> => {
  const { kind, onChange } = props;
  const target = props.target as Record<string, unknown> | undefined;
  const key = props.key;
  const getter = props.get;
  const setter = props.set;
  let held: T = getter || target ? (undefined as T) : kind.copy(props.value as T);

  const read = (): T => {
    if (target && key !== undefined) return target[key] as T;
    if (getter) return getter();
    return held;
  };

  const write = (value: T) => {
    if (target && key !== undefined) {
      const current = target[key];
      // An object is written in place (D3): the instance there stays
      if (typeof current === 'object' && current !== null) kind.copy(value, current as T);
      else target[key] = kind.copy(value);
    } else if (setter) {
      setter(kind.copy(value));
    } else if (!getter) {
      held = kind.copy(value, held);
    }
  };

  let kept = kind.copy(read());
  let gestureStart: { prev: T } | null = null;

  /** Writes, keeps, and fires the event: the handler sees the kept value already */
  const writeAndFire = (value: T, last: boolean, prev: T, source: 'user' | 'api') => {
    write(value);
    kept = kind.copy(value, kept);
    onChange?.(kind.copy(kept), { prev, last, source });
  };

  const step = (value: T) => {
    if (!gestureStart) gestureStart = { prev: kind.copy(kept) };
    if (kind.equals(value, kept)) return;
    writeAndFire(value, false, kind.copy(kept), 'user');
  };

  const commit = () => {
    const start = gestureStart;
    if (!start) return;
    gestureStart = null;
    onChange?.(kind.copy(kept), { prev: start.prev, last: true, source: 'user' });
  };

  const sync = () => {
    if (!target && !getter) return false;
    const current = read();
    if (kind.equals(current, kept)) return false;
    kept = kind.copy(current, kept);
    return true;
  };

  return {
    peek: () => kept,
    getValue: () => kind.copy(read()),
    sync,
    step,
    commit,
    change: (value) => {
      if (gestureStart) {
        step(value);
        commit();
        return;
      }
      if (kind.equals(value, kept)) return;
      writeAndFire(value, true, kind.copy(kept), 'user');
    },
    setValue: (value, options) => {
      // Against the bound value, which may have changed since the last read
      sync();
      if (kind.equals(value, kept)) return;
      if (options?.silent) {
        write(value);
        kept = kind.copy(value, kept);
        return;
      }
      writeAndFire(value, true, kind.copy(kept), 'api');
    },
    isInGesture: () => gestureStart !== null,
  };
};
