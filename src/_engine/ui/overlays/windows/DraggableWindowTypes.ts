// The draggable windows' types: the public ones (on `aekasha/ui`) and the internal ones the
// window modules share (DraggableWindow.ts, its store, geometry and drag modules).
import type { CMPHandle } from '../../core/CMPTypes';
import type { SvgIconKey } from '../../core/icons/SvgIcon';
import type { Tooltip } from '../Tooltip';

/**
 * The CSS unit of a window's position or size value. `'%'` is of the HUD's bounds: the viewport, or
 * a mounted engine's container (`mountAekasha`). `'vw'` and `'vh'` are always the browser window's,
 * as in CSS: in an embed, use `'%'`.
 */
export type DraggableWindowUnit = 'px' | '%' | 'vw' | 'vh';

/** What a window is for (eg. `{ entityId }`): serializable, since a `saveToLS` window keeps it,
 * and handed to its content function. */
export type DraggableWindowData = { [key: string]: unknown };

/** A window's content: a CMP (kept over closes: detached, not removed, so a reopen shows it
 * again), or a function that builds it from the window's `data` on every mount. */
export type DraggableWindowContent = CMPHandle | ((data?: DraggableWindowData) => CMPHandle);

/** The units of a window's position and sizes, per axis (default 'px'). */
export type DraggableWindowUnits = {
  /** A non-px position is the window's centre. A draggable window converts it to px (its
   * left/top) when it mounts; a non-draggable one (eg. a dialog) stays CSS-centred. */
  position?: { x?: DraggableWindowUnit; y?: DraggableWindowUnit };
  /** The size's units. A resize stores the resized axis in px. */
  size?: { w?: DraggableWindowUnit; h?: DraggableWindowUnit };
  /** The max size's units */
  maxSize?: { w?: DraggableWindowUnit; h?: DraggableWindowUnit };
  /** The min size's units */
  minSize?: { w?: DraggableWindowUnit; h?: DraggableWindowUnit };
};

/** The persisted part of a window (LS): serializable values only. */
export type DraggableWindowConfig = {
  /** The window's id */
  id: string;
  /** The window's kind (see {@link OpenDraggableWindowProps.kind}). Without one, the window's
   * kind is its id. */
  kind?: string;
  /** The header's title */
  title: string;
  /** See {@link OpenDraggableWindowProps.ariaLabel} */
  ariaLabel?: string;
  /** An icon before the title in the header */
  icon?: SvgIconKey;
  /** What the window is for (see {@link DraggableWindowData}) */
  data?: DraggableWindowData;
  /** Position (left/top) and size, in `units` (px by default). A draggable window's position is
   * always px. */
  geometry: { x: number; y: number; w: number; h: number };
  /** The smallest size a resize leaves (default 100 × 120 px) */
  minSize: { w: number; h: number };
  /** Without one, the window is at most its bounds' size (100 % × 100 %: the viewport, or a
   * mounted engine's container) */
  maxSize?: { w: number; h: number };
  /** The units of `geometry`, `minSize` and `maxSize` */
  units?: DraggableWindowUnits;
  /** The window's index in its layer's stack (0 = bottom) */
  orderNr: number;
  /** Whether it's open (a window suspended over a scene load is open, without its DOM) */
  isOpen: boolean;
  /** Whether only its header shows */
  isCollapsed: boolean;
  /** See {@link OpenDraggableWindowProps.saveToLS} */
  saveToLS: boolean;
  /** See {@link OpenDraggableWindowProps.isDebugWindow} */
  isDebugWindow: boolean;
  /** Shows this debug window (`isDebugWindow`) in prodTest mode too (default false, debug
   * windows are debug mode only). The window's content module must then be loaded in prodTest
   * mode as well, ie. with `loadDebugModuleAsync(importer, true)` / `useDebug(ref, true)`,
   * otherwise the window opens without content. */
  showInProdTest: boolean;
  /** See {@link OpenDraggableWindowProps.disableVertResize} */
  disableVertResize: boolean;
  /** See {@link OpenDraggableWindowProps.disableHoriResize} */
  disableHoriResize: boolean;
  /** See {@link OpenDraggableWindowProps.disableDragging} */
  disableDragging: boolean;
  /** See {@link OpenDraggableWindowProps.disableCollapseBtn} */
  disableCollapseBtn: boolean;
  /** See {@link OpenDraggableWindowProps.disableCloseBtn} */
  disableCloseBtn: boolean;
  /** See {@link OpenDraggableWindowProps.closeOnSceneChange} */
  closeOnSceneChange: boolean;
  /** See {@link OpenDraggableWindowProps.removeOnSceneChange} */
  removeOnSceneChange: boolean;
  /** See {@link OpenDraggableWindowProps.removeOnClose} */
  removeOnClose: boolean;
  /** See {@link OpenDraggableWindowProps.customZIndex} */
  customZIndex?: number;
  /** See {@link OpenDraggableWindowProps.hasBackDrop} */
  hasBackDrop: boolean;
  /** See {@link OpenDraggableWindowProps.backDropClickClosesWindow} */
  backDropClickClosesWindow: boolean;
  /** Extra classes for the window's element */
  windowClass?: string | string[];
  /** Extra classes for the backdrop's element */
  backDropClass?: string | string[];
};

/** A window as seen from outside this module: its config plus its live objects. */
export type DraggableWindow = DraggableWindowConfig & {
  /** Whether the window is on top of its layer (app or debug windows) */
  isActive: boolean;
  /** Only a mounted window has one (not a closed one, or one suspended over a scene change) */
  windowCMP?: CMPHandle;
  /** The backdrop's CMP, while it's mounted with one */
  backDropCMP?: CMPHandle;
  /** The content its last open passed */
  content?: DraggableWindowContent;
  /** The `onClose` its last open passed */
  onClose?: () => void;
};

/**
 * What {@link _engine/ui/overlays/windows/DraggableWindow!openDraggableWindow} opens a window with. A reopen keeps
 * the user's layout (position, size, collapsed) unless `resetPosition` / `resetSize`; for the other
 * flags, a passed value wins over the stored one, and a default comes last.
 */
export type OpenDraggableWindowProps = {
  /** The window's id: opening an id again reopens (or updates) that window. */
  id: string;
  /**
   * Makes this one of several windows of a kind (eg. one edit window per entity), with the id
   * `getKindWindowId(kind, key)`. The content function and scene target resolver registered for
   * the kind cover each of its windows. A new window of the kind starts from where the kind's
   * last window was dragged, resized or closed, cascaded by the kind's open windows. Closing it
   * removes it. Without a kind, the window's kind is its id.
   */
  kind?: string;
  /** The content; without, the content function registered for the window's kind builds it
   * (`registerDraggableWindowKind`, `registerDraggableWindow`) */
  content?: DraggableWindowContent;
  /** What the window is for, handed to its content function. A reopen with other data rebuilds
   * the content. */
  data?: DraggableWindowData;
  /** Opens a new window collapsed (a stored window keeps its own state) */
  isCollapsed?: boolean;
  /** Where it opens, in `units.position` (default: the screen's centre) */
  position?: { x: number; y: number };
  /** Its size, in `units.size` (default 320 × 320 px) */
  size?: { w: number; h: number };
  /** The largest size a resize leaves, in `units.maxSize` (default the viewport's) */
  maxSize?: { w: number; h: number };
  /** The smallest size a resize leaves, in `units.minSize` (default 100 × 120 px) */
  minSize?: { w: number; h: number };
  /** The units of the position and the sizes (default px) */
  units?: DraggableWindowUnits;
  /** Opens it at `position` (or the default), not where the user left it */
  resetPosition?: boolean;
  /** Opens it at `size` (or the default), not the user's size */
  resetSize?: boolean;
  /** Closes the window instead when it's open: the open is a toggle */
  closeIfOpen?: boolean;
  /** Keeps the window's state in LS (`AEK_popupWindows`): open after a reload, with its layout
   * (default false). Its content then comes from its kind's registered content function. */
  saveToLS?: boolean;
  /** The header's title, which also names the window for assistive tech */
  title?: string;
  /** The window's name for assistive tech when it has no `title` (its `aria-label`; default
   * 'Window'). With a title, the title names it. */
  ariaLabel?: string;
  /** An icon before the title in the header */
  icon?: SvgIconKey;
  /** A debug tool's window: above the app's windows, and shown only in the debug env (default
   * false) */
  isDebugWindow?: boolean;
  /** Shows this debug window (`isDebugWindow`) in prodTest mode too (default false, debug
   * windows are debug mode only). The window's content module must then be loaded in prodTest
   * mode as well, ie. with `loadDebugModuleAsync(importer, true)` / `useDebug(ref, true)`,
   * otherwise the window opens without content. */
  showInProdTest?: boolean;
  /** No vertical resize handle */
  disableVertResize?: boolean;
  /** No horizontal resize handle */
  disableHoriResize?: boolean;
  /** The header doesn't move the window */
  disableDragging?: boolean;
  /** No collapse button */
  disableCollapseBtn?: boolean;
  /** No close button */
  disableCloseBtn?: boolean;
  /** Closes the window when a scene load starts, unless its kind's scene target resolver finds
   * its target in the next scene: then it's rebuilt there */
  closeOnSceneChange?: boolean;
  /** Removes the window (its state too) when a scene load starts */
  removeOnSceneChange?: boolean;
  /** Closing removes the window and its state (a kind's window always is) */
  removeOnClose?: boolean;
  /** A z-index of its own, instead of its place in its layer's stack (a debug window's gets 100
   * added) */
  customZIndex?: number;
  /** A backdrop behind the window that covers the screen (and takes its clicks) */
  hasBackDrop?: boolean;
  /** A click on the backdrop closes the window */
  backDropClickClosesWindow?: boolean;
  /** Extra classes for the window's element */
  windowClass?: string | string[];
  /** Extra classes for the backdrop's element */
  backDropClass?: string | string[];
  /** Runs after the window closes or is removed, instead of its kind's `onClose` */
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
  content?: (data?: DraggableWindowData) => CMPHandle;
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
  windowCMP?: CMPHandle;
  backDropCMP?: CMPHandle;
  headerCMP?: CMPHandle;
  titleCMP?: CMPHandle;
  contentWrapperCMP?: CMPHandle;
  collapseBtnCMP?: CMPHandle;
  /** The collapse button's tooltip ("Collapse" / "Expand"), set on a toggle */
  collapseTooltip?: Tooltip;
  /** The cut title's tooltip (its whole text) */
  titleTooltip?: Tooltip;
  /** The header's tooltips (its buttons', the title's), disposed with the window's DOM */
  tooltips?: Tooltip[];
  session: DragSession | null;
  /** The z-index last written, so a restack only writes the windows whose index changed */
  zIndex: number;
  /** Runs once when the mounted window's DOM goes, before it's removed (a dialog's overlay
   * stack entry: `onDraggableWindowUnmount`) */
  onUnmount?: () => void;
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
