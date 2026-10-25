// The draggable windows' configs: their resolution from the open props and the stored config,
// the LS format (`AEK_popupWindows`, read once and written on finished changes) and the kinds'
// geometries. No DOM: DraggableWindow.ts mounts what it resolves.
import type { StorageValue } from '../../../utils/LocalAndSessionStorage';
import { lsGetItem, lsSetItem } from '../../../utils/LocalAndSessionStorage';
import type {
  DraggableWindowConfig,
  DraggableWindowRuntime,
  DraggableWindowUnits,
  KindGeometry,
  OpenDraggableWindowProps,
  StoredWindow,
  WindowEntry,
} from './DraggableWindowTypes';

const LS_KEY = 'AEK_popupWindows';

/** The kinds' geometries, in the same LS object as the windows */
const LS_KIND_GEOMETRY_KEY = '__kindGeometry';

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 320;
const DEFAULT_MIN_WIDTH = 100;
const DEFAULT_MIN_HEIGHT = 120;

/**
 * Where each kind's next window starts (`KindGeometry`), saved with the windows in LS.
 * @internal
 */
export const kindGeometry: { [kind: string]: KindGeometry } = {};

/**
 * A window's live part before it is mounted.
 * @internal
 */
export const createRuntime = (): DraggableWindowRuntime => ({ session: null, zIndex: -1 });

/** A full config from partial values: lists every persisted key, so nothing else (runtime
 * objects, pre-p094 keys) ends up in LS. */
const createConfig = (
  id: string,
  v: Partial<DraggableWindowConfig> & Pick<DraggableWindowConfig, 'geometry'>
): DraggableWindowConfig => ({
  id,
  ...(v.kind ? { kind: v.kind } : {}),
  title: v.title || '',
  ...(v.icon ? { icon: v.icon } : {}),
  ...(v.data !== undefined ? { data: v.data } : {}),
  geometry: v.geometry,
  minSize: v.minSize || { w: DEFAULT_MIN_WIDTH, h: DEFAULT_MIN_HEIGHT },
  ...(v.maxSize ? { maxSize: v.maxSize } : {}),
  ...(v.units && Object.keys(v.units).length ? { units: v.units } : {}),
  orderNr: v.orderNr ?? 0,
  isOpen: Boolean(v.isOpen),
  isCollapsed: Boolean(v.isCollapsed),
  saveToLS: Boolean(v.saveToLS),
  isDebugWindow: Boolean(v.isDebugWindow),
  showInProdTest: Boolean(v.showInProdTest),
  disableVertResize: Boolean(v.disableVertResize),
  disableHoriResize: Boolean(v.disableHoriResize),
  disableDragging: Boolean(v.disableDragging),
  disableCollapseBtn: Boolean(v.disableCollapseBtn),
  disableCloseBtn: Boolean(v.disableCloseBtn),
  closeOnSceneChange: Boolean(v.closeOnSceneChange),
  removeOnSceneChange: Boolean(v.removeOnSceneChange),
  removeOnClose: Boolean(v.removeOnClose),
  ...(v.customZIndex !== undefined ? { customZIndex: v.customZIndex } : {}),
  hasBackDrop: Boolean(v.hasBackDrop),
  backDropClickClosesWindow: Boolean(v.backDropClickClosesWindow),
  ...(v.windowClass !== undefined ? { windowClass: v.windowClass } : {}),
  ...(v.backDropClass !== undefined ? { backDropClass: v.backDropClass } : {}),
});

/**
 * Resolves a window's config from the open props and its stored config (live, closed or from
 * LS). One rule set:
 * - Behaviour flags, min/max size and classes: a passed prop wins, then the stored value, then
 *   the default.
 * - Geometry and the collapsed state (the user's layout): the stored value wins, unless
 *   `resetPosition`/`resetSize` is set. Then the prop wins, and the default (centred) comes last.
 *   A new window of a kind takes the kind's geometry as its stored geometry.
 * - Units go with their value: a stored position or size keeps its stored units, a passed one
 *   takes the passed units.
 * - Title and `data`: the passed value wins.
 * @internal
 */
export const resolveWindowConfig = (
  props: OpenDraggableWindowProps,
  stored?: DraggableWindowConfig,
  storedKindGeometry?: KindGeometry
): DraggableWindowConfig => {
  const layout = stored ?? storedKindGeometry;
  const units: DraggableWindowUnits = {};
  const setUnits = <K extends keyof DraggableWindowUnits>(key: K, u?: DraggableWindowUnits[K]) => {
    if (u) units[key] = u;
  };

  let size: { w: number; h: number };
  if (layout && !props.resetSize) {
    size = { w: layout.geometry.w, h: layout.geometry.h };
    setUnits('size', layout.units?.size);
  } else {
    size = props.size || { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT };
    if (props.size) setUnits('size', props.units?.size);
  }

  let position: { x: number; y: number };
  if (layout && !props.resetPosition) {
    position = { x: layout.geometry.x, y: layout.geometry.y };
    setUnits('position', layout.units?.position);
  } else if (props.position) {
    position = props.position;
    setUnits('position', props.units?.position);
  } else {
    // The viewport's centre (converted to px at mount when the window is draggable)
    position = { x: 50, y: 50 };
    setUnits('position', { x: '%', y: '%' });
  }

  const minSize = props.minSize ?? stored?.minSize;
  setUnits('minSize', props.minSize ? props.units?.minSize : stored?.units?.minSize);
  const maxSize = props.maxSize ?? stored?.maxSize;
  // Always stored with its units: LS tells a pre-p094 viewport snapshot apart by the missing units
  if (maxSize) {
    const maxUnits = props.maxSize ? props.units?.maxSize : stored?.units?.maxSize;
    setUnits('maxSize', { w: 'px', h: 'px', ...maxUnits });
  }

  const flag = <K extends keyof OpenDraggableWindowProps & keyof DraggableWindowConfig>(key: K) =>
    props[key] !== undefined ? props[key] : stored?.[key];

  return createConfig(props.id, {
    kind: props.kind ?? stored?.kind,
    title: props.title ?? stored?.title,
    icon: props.icon ?? stored?.icon,
    data: props.data ?? stored?.data,
    geometry: { ...position, ...size },
    minSize,
    maxSize,
    units,
    orderNr: stored?.orderNr,
    isOpen: true,
    isCollapsed: stored ? stored.isCollapsed : props.isCollapsed,
    saveToLS: flag('saveToLS'),
    isDebugWindow: flag('isDebugWindow'),
    showInProdTest: flag('showInProdTest'),
    disableVertResize: flag('disableVertResize'),
    disableHoriResize: flag('disableHoriResize'),
    disableDragging: flag('disableDragging'),
    disableCollapseBtn: flag('disableCollapseBtn'),
    disableCloseBtn: flag('disableCloseBtn'),
    closeOnSceneChange: flag('closeOnSceneChange'),
    removeOnSceneChange: flag('removeOnSceneChange'),
    removeOnClose: flag('removeOnClose'),
    customZIndex: flag('customZIndex'),
    hasBackDrop: flag('hasBackDrop'),
    backDropClickClosesWindow: flag('backDropClickClosesWindow'),
    windowClass: flag('windowClass'),
    backDropClass: flag('backDropClass'),
  });
};

/**
 * Reads LS once. The entries go into the map in their saved stack order, so restoring them in
 * map order rebuilds the stacks.
 * @internal
 */
export const hydrateFromLS = (map: Map<string, WindowEntry>) => {
  const { [LS_KIND_GEOMETRY_KEY]: storedKindGeometry, ...stored } = (lsGetItem(LS_KEY, {}) ||
    {}) as { [id: string]: StoredWindow } & { [LS_KIND_GEOMETRY_KEY]?: typeof kindGeometry };
  if (storedKindGeometry && typeof storedKindGeometry === 'object') {
    Object.assign(kindGeometry, storedKindGeometry);
  }
  // A pre-p094 state flags its last clicked window instead of saving the stack: restore it last
  const order = (s: StoredWindow) => (s.isActive ? Infinity : s.orderNr ?? 9999);
  const ids = Object.keys(stored).sort((a, b) => order(stored[a]) - order(stored[b]));
  for (let i = 0; i < ids.length; i++) {
    const s = stored[ids[i]];
    if (!s || typeof s !== 'object') continue;
    // Closing a kind window removes it, so a closed one is a leftover
    if (s.kind && !s.isOpen) continue;
    const geometry = s.geometry || {
      x: s.position?.x ?? 0,
      y: s.position?.y ?? 0,
      w: s.size?.w ?? DEFAULT_WIDTH,
      h: s.size?.h ?? DEFAULT_HEIGHT,
    };
    // A maxSize without units is the viewport snapshot pre-p094 windows took at open: dropped,
    // so the window gets the default (the current viewport)
    const maxSize = s.units?.maxSize ? s.maxSize : undefined;
    map.set(ids[i], {
      config: createConfig(ids[i], { ...s, geometry, maxSize }),
      runtime: createRuntime(),
    });
  }
};

/**
 * Writes every `saveToLS` window's config, and the kinds' geometries. Called on finished changes
 * only.
 * @internal
 */
export const writeWindowStatesToLS = (windows: Map<string, WindowEntry>) => {
  const saved: { [id: string]: unknown } = {};
  for (const { config } of windows.values()) {
    if (config.saveToLS) saved[config.id] = config;
  }
  const kinds = Object.keys(kindGeometry).filter((kind) => kindGeometry[kind].saveToLS);
  if (kinds.length) {
    saved[LS_KIND_GEOMETRY_KEY] = Object.fromEntries(kinds.map((k) => [k, kindGeometry[k]]));
  }
  lsSetItem(LS_KEY, saved as unknown as StorageValue);
};

/**
 * Stores a kind window's geometry as where the kind's next window starts.
 * @internal
 */
export const recordKindGeometry = ({ config }: WindowEntry) => {
  if (!config.kind) return;
  const units: KindGeometry['units'] = {};
  if (config.units?.position) units.position = config.units.position;
  if (config.units?.size) units.size = config.units.size;
  kindGeometry[config.kind] = {
    geometry: { ...config.geometry },
    ...(Object.keys(units).length ? { units } : {}),
    saveToLS: config.saveToLS,
  };
};
