// The draggable windows' types: the public ones (on `aekasha/ui`) and the internal ones the
// window modules share (DraggableWindow.ts, its store, geometry and drag modules).
import type { TCMP } from './CMP';
import type { SvgIconKey } from './icons/SvgIcon';

/** The CSS unit of a window's position or size value. */
export type DraggableWindowUnit = 'px' | '%' | 'vw' | 'vh';

export type DraggableWindowData = { [key: string]: unknown };

export type DraggableWindowContent = TCMP | ((data?: DraggableWindowData) => TCMP);

export type DraggableWindowUnits = {
  // Default is 'px'
  /** A non-px position is the window's centre. A draggable window converts it to px (its
   * left/top) when it mounts; a non-draggable one (eg. a dialog) stays CSS-centred. */
  position?: { x?: DraggableWindowUnit; y?: DraggableWindowUnit };
  size?: { w?: DraggableWindowUnit; h?: DraggableWindowUnit };
  maxSize?: { w?: DraggableWindowUnit; h?: DraggableWindowUnit };
  minSize?: { w?: DraggableWindowUnit; h?: DraggableWindowUnit };
};

/** The persisted part of a window (LS): serializable values only. */
export type DraggableWindowConfig = {
  id: string;
  /** The window's kind (see {@link OpenDraggableWindowProps.kind}). Without one, the window's
   * kind is its id. */
  kind?: string;
  title: string;
  /** An icon before the title in the header */
  icon?: SvgIconKey;
  data?: DraggableWindowData;
  /** Position (left/top) and size, in `units` (px by default). A draggable window's position is
   * always px. */
  geometry: { x: number; y: number; w: number; h: number };
  minSize: { w: number; h: number };
  /** Without one, the window is at most the viewport's size (100vw × 100vh) */
  maxSize?: { w: number; h: number };
  units?: DraggableWindowUnits;
  /** The window's index in its layer's stack (0 = bottom) */
  orderNr: number;
  isOpen: boolean;
  isCollapsed: boolean;
  saveToLS: boolean;
  isDebugWindow: boolean;
  /** Shows this debug window (`isDebugWindow`) in prodTest mode too (default false, debug
   * windows are debug mode only). The window's content module must then be loaded in prodTest
   * mode as well, ie. with `loadDebugModuleAsync(importer, true)` / `useDebug(ref, true)`,
   * otherwise the window opens without content. */
  showInProdTest: boolean;
  disableVertResize: boolean;
  disableHoriResize: boolean;
  disableDragging: boolean;
  disableCollapseBtn: boolean;
  disableCloseBtn: boolean;
  closeOnSceneChange: boolean;
  removeOnSceneChange: boolean;
  removeOnClose: boolean;
  customZIndex?: number;
  hasBackDrop: boolean;
  backDropClickClosesWindow: boolean;
  windowClass?: string | string[];
  backDropClass?: string | string[];
};

/** A window as seen from outside this module: its config plus its live objects. */
export type DraggableWindow = DraggableWindowConfig & {
  /** Whether the window is on top of its layer (app or debug windows) */
  isActive: boolean;
  /** Only a mounted window has one (not a closed one, or one suspended over a scene change) */
  windowCMP?: TCMP;
  backDropCMP?: TCMP;
  content?: DraggableWindowContent;
  onClose?: () => void;
};

export type OpenDraggableWindowProps = {
  id: string;
  /**
   * Makes this one of several windows of a kind (eg. one edit window per entity), with the id
   * `getKindWindowId(kind, key)`. The content function and scene target resolver registered for
   * the kind cover each of its windows. A new window of the kind starts from where the kind's
   * last window was dragged, resized or closed, cascaded by the kind's open windows. Closing it
   * removes it. Without a kind, the window's kind is its id.
   */
  kind?: string;
  content?: DraggableWindowContent;
  data?: DraggableWindowData;
  isCollapsed?: boolean;
  position?: { x: number; y: number };
  size?: { w: number; h: number };
  maxSize?: { w: number; h: number };
  minSize?: { w: number; h: number };
  units?: DraggableWindowUnits;
  resetPosition?: boolean;
  resetSize?: boolean;
  closeIfOpen?: boolean;
  saveToLS?: boolean;
  title?: string;
  /** An icon before the title in the header */
  icon?: SvgIconKey;
  isDebugWindow?: boolean;
  /** Shows this debug window (`isDebugWindow`) in prodTest mode too (default false, debug
   * windows are debug mode only). The window's content module must then be loaded in prodTest
   * mode as well, ie. with `loadDebugModuleAsync(importer, true)` / `useDebug(ref, true)`,
   * otherwise the window opens without content. */
  showInProdTest?: boolean;
  disableVertResize?: boolean;
  disableHoriResize?: boolean;
  disableDragging?: boolean;
  disableCollapseBtn?: boolean;
  disableCloseBtn?: boolean;
  closeOnSceneChange?: boolean;
  removeOnSceneChange?: boolean;
  removeOnClose?: boolean;
  customZIndex?: number;
  hasBackDrop?: boolean;
  backDropClickClosesWindow?: boolean;
  windowClass?: string | string[];
  backDropClass?: string | string[];
  onClose?: () => void;
  /** Focuses the first focusable element of the window (its content first, then its header
   * buttons) when it opens. Default true. The engine's own reopens (restoring from LS, rebuilding
   * after a scene change or an update) pass false, so they never steal the focus. */
  focusFirstElement?: boolean;
};

/** What every window of a kind (or every open of a single window) shares: the functions LS can't
 * hold. */
export type DraggableWindowKindOpts = {
  /** Builds a window's content from its `data`, for the opens without `content` (eg. the restore
   * from LS after a reload) */
  content?: (data?: DraggableWindowData) => TCMP;
  /** Runs after a window of the kind closes (or is removed), unless the window has its own */
  onClose?: (id: string) => void;
  /** For a window flagged `closeOnSceneChange`: on a scene change the window stays open (rebuilt
   * for the next scene) when it returns true for the window's `data`, and closes otherwise. Also
   * checked when the window is restored on a reload. */
  sceneTargetResolver?: SceneTargetResolver;
  /** Keeps the kind's windows visible in editor views (Views.ts), which hide the other
   * windows with the rest of the suspended scene's HUD. Debug dialogs (`isDebugWindow` with a
   * backdrop) are always kept. */
  keepInViews?: boolean;
};

/** Checks whether a window's target (eg. an entity, by the window's `data`) exists in the
 * current scene. Not persisted (functions can't go into LS), so registered next to each window's
 * content function. */
export type SceneTargetResolver = (data?: DraggableWindowData) => boolean;

/**
 * What a pointer drag of a window does: move it, or resize it on one axis or both.
 * @internal
 */
export type DragMode = 'MOVE' | 'RESIZE_H' | 'RESIZE_V' | 'RESIZE_HV';

/**
 * The part of the header that can be grabbed (the title, without the buttons), relative to the
 * window's left edge, and the header's height.
 * @internal
 */
export type GrabArea = { left: number; width: number; headerH: number };

/**
 * One pointer drag of a window's header (move) or of one of its resize handles.
 * @internal
 */
export type DragSession = {
  mode: DragMode;
  pointerId: number;
  /** The element that holds the pointer capture */
  target: HTMLElement;
  startPointer: { x: number; y: number };
  startGeometry: { x: number; y: number; w: number; h: number };
  /** MOVE only: the header's title area, which clampToGrabbable keeps on screen */
  grabArea: GrabArea | null;
  /** The latest pointer position, applied at most once per animation frame */
  pointer: { x: number; y: number };
  /** The geometry last written to the DOM */
  geometry: { x: number; y: number; w: number; h: number };
  rafId: number | null;
  /** The animation frame's callback, made once per session (not per frame) */
  apply: () => void;
};

/**
 * The live part of a window: never persisted.
 * @internal
 */
export type DraggableWindowRuntime = {
  content?: DraggableWindowContent;
  onClose?: () => void;
  windowCMP?: TCMP;
  backDropCMP?: TCMP;
  headerCMP?: TCMP;
  titleCMP?: TCMP;
  contentWrapperCMP?: TCMP;
  session: DragSession | null;
  /** The z-index last written, so a restack only writes the windows whose index changed */
  zIndex: number;
};

/**
 * A window: its persisted config and its live part (the windows' map holds these).
 * @internal
 */
export type WindowEntry = { config: DraggableWindowConfig; runtime: DraggableWindowRuntime };

/**
 * What a window stored in LS can carry: the config, or a pre-p094 state.
 * @internal
 */
export type StoredWindow = Partial<DraggableWindowConfig> & {
  position?: { x: number; y: number };
  size?: { w: number; h: number };
  isActive?: boolean;
};

/**
 * Where a kind's next window starts: the last geometry of one of its windows.
 * @internal
 */
export type KindGeometry = {
  geometry: DraggableWindowConfig['geometry'];
  units?: Pick<DraggableWindowUnits, 'position' | 'size'>;
  saveToLS: boolean;
};
