// The ray tester windows (three's and physics' rays): their content on the UI kit (p806 D10), the
// results a list per ray. The state, the fire, the pick and the pane's items are their own modules
// (D11).
import { CMP } from '../../../ui/core/CMP';
import type { CMPHandle } from '../../../ui/core/CMPTypes';
import { getSvgIcon } from '../../../ui/core/icons/SvgIcon';
import { createButton } from '../../../ui/components/Button';
import { createList } from '../../../ui/data/List';
import { createFieldContextMenu } from '../../../ui/forms/FieldContextMenu';
import {
  DEBUG_TOASTER_ID,
  type DebuggerPaneItem,
  type DebuggerPaneSection,
} from '../../../debug/DebuggerGUI';
import {
  _buildDebuggerPane,
  type BuiltDebuggerPane,
} from '../../../debug/_dbg__DebuggerPaneBuilder';
import {
  registerDraggableWindow,
  toggleDraggableWindow,
  updateDraggableWindow,
} from '../../../ui/overlays/windows/DraggableWindow';
import { addToast } from '../../../ui/overlays/Toaster';
import { getCurrentSceneId, registerOnAllSceneEnters } from '../../scene/Scene';
import { createClearLSButton } from '../../../debug/_dbg__ClearLSButtons';
import { getRayHelperSettings } from './_dbg__RayHelpers';
import { _setRayHelpersShown } from './_dbg__Raycast';
import {
  dropPhysicsFiresInFlight,
  fireThreeRays,
  firePhysicsRaysAsync,
} from './_dbg__RayTesterFire';
import {
  getPhysicsRayItems,
  getThreeRayItems,
  persistOnCommit,
  type RayTesterItemsCtx,
} from './_dbg__RayTesterItems';
import {
  cancelPick,
  cancelPickFor,
  getArmedPickField,
  setPickChangeListener,
  type PickField,
} from './_dbg__RayTesterPick';
import {
  clearTesterLSWithConfirm,
  getPhysicsState,
  getScenesWithData,
  getThreeState,
  persistTesterState,
  RAY_TESTER_LS_KEY,
  testerResults,
  WINDOW_IDS,
  WINDOW_TITLES,
  type AimedRay,
  type HitEntityInfo,
  type PhysicsHitRow,
  type RayTesterKind,
  type RayTesterResult,
  type ThreeHitRow,
  type Vec3,
} from './_dbg__RayTesterState';
import styles from './RayDebug.module.scss';

/**
 * Ray tester windows (p143), opened from the Ray cast controls tab: configure a ray, fire it
 * into the current scene through the same code paths gameplay uses, see it as a debug helper
 * and read the hits. One window per ray kind: Three.js rays (Raycast.ts) and physics rays (the
 * WorldAPI queries, in either workerTarget mode).
 *
 * The state holds a list of rays and Fire casts all of them (results per ray), but the window
 * edits and shows only `rays[activeIndex]`, so multi-ray patterns are a UI-only addition later.
 *
 * Tester rays are never counted in the ray statistics: Three.js rays pass `countInStats: false`,
 * and physics queries are skipped by their helper id prefix (RAY_TESTER_ID_PREFIX).
 *
 * The params are saved per scene (RAY_TESTER_LS_KEY, on every committed change) and each window
 * shows the current scene's. The results are not saved: a scene enter clears them.
 *
 * The origin and the target point can be picked with a click on the scene (a one-shot mouse
 * binding, Esc or a second press cancels it).
 */

type AnyState = Record<string, unknown>;

/** The most hits a ray's list shows (an intersectionsWithRay through a forest finds hundreds) */
const MAX_LISTED_HITS = 20;

/** The mounted window's parts a later change writes, cleared when its content is removed (a
 * closed window's removed CMPs can't be written to) */
type MountedTester = {
  results: CMPHandle;
  notice: CMPHandle;
  pickStatus: CMPHandle;
  refreshPane: () => void;
};
const mounted: Partial<Record<RayTesterKind, MountedTester>> = {};

// ----------------------------------------------------------------------------
// Windows
// ----------------------------------------------------------------------------

/** Opens the kind's tester window, brings it to the front when it is open under another window,
 * or closes it when it is on top. */
export const _toggleRayTesterWindow = (kind: RayTesterKind) => {
  toggleDraggableWindow({
    id: WINDOW_IDS[kind],
    title: WINDOW_TITLES[kind],
    isDebugWindow: true,
    saveToLS: true,
    position: kind === 'THREE' ? { x: 120, y: 80 } : { x: 160, y: 110 },
    size: { w: 380, h: 640 },
  });
};

/** Shows or hides the "helpers are off" notices of the mounted tester windows. The Ray cast
 * controls tab calls it whenever a kind's helper settings change. */
export const _refreshRayTesterHelperNotices = () => {
  syncHelperNotice('THREE');
  syncHelperNotice('PHYSICS');
};

const syncHelperNotice = (kind: RayTesterKind) => {
  const notice = mounted[kind]?.notice;
  if (!notice) return;
  if (getRayHelperSettings(kind).show) notice.updateAttr({ hidden: '' });
  else notice.removeAttr('hidden');
};

/** A tester ray is only drawn while its kind's helpers are shown (the tab's "Show helpers"). */
const createHelperNotice = (kind: RayTesterKind) => {
  const kindName = kind === 'THREE' ? 'Three.js' : 'Physics';
  const notice = CMP({ class: styles.notice });
  notice.add({ tag: 'p', text: `${kindName} ray helpers are off, so fired rays aren't drawn.` });
  notice.add(
    createButton({
      label: 'Show helpers',
      size: 'sm',
      onClick: () => _setRayHelpersShown(kind, true),
    }).cmp
  );
  return notice;
};

const PICK_STATUS_TEXTS: Record<PickField, string> = {
  ORIGIN: 'Click the scene to pick the origin (Esc cancels)',
  TARGET: 'Click the scene to pick the target point (Esc cancels)',
};

/** Shows what the armed pick waits for, in its window only (a status line, empty without a pick:
 * kept in the document, so a pick armed is read). */
const syncPickStatus = (kind: RayTesterKind) => {
  const field = getArmedPickField(kind);
  mounted[kind]?.pickStatus.updateText(field ? PICK_STATUS_TEXTS[field] : '');
};

/** The window's top row: which scene's params are shown, and the clear-LS button. */
const createToolbar = (kind: RayTesterKind) => {
  const toolbar = CMP({ class: styles.toolbar });
  const sceneId = getCurrentSceneId();
  toolbar.add({
    tag: 'span',
    text: sceneId ? `Saved per scene (${sceneId})` : 'No scene: not saved',
  });
  toolbar.add(
    createClearLSButton({
      icon: 'eraser',
      title: `Clear the ${WINDOW_TITLES[kind].toLowerCase()}'s saved params`,
      hasData: () => getScenesWithData([kind]).length > 0,
      watchKey: RAY_TESTER_LS_KEY,
      onClear: () => clearTesterLSWithConfirm([kind]),
    })
  );
  return toolbar;
};

/** A tester window's content: the toolbar, the helper notice, the pick status, the ray's pane
 * (with the fields' context menu) and the results. Every committed pane change saves the kind's
 * state. */
const createTesterContent = <P extends AimedRay>(
  kind: RayTesterKind,
  ray: P,
  getItems: (ctx: RayTesterItemsCtx) => DebuggerPaneItem<P>[],
  fire: () => void
) => {
  let built: BuiltDebuggerPane | null = null;
  const parts: MountedTester = {
    results: CMP({ class: styles.results }),
    notice: createHelperNotice(kind),
    pickStatus: CMP({ tag: 'p', class: styles.pickStatus, attr: { role: 'status' }, text: '' }),
    refreshPane: () => built?.refresh(),
  };
  const container = CMP({
    class: styles.window,
    // Only this content's parts, never ones a newer content of the kind has set
    onRemoveCmp: () => {
      if (mounted[kind] === parts) delete mounted[kind];
      menu.cmp.remove();
    },
  });
  // A pick armed for the previous content would write into a replaced params object
  cancelPickFor(kind);
  mounted[kind] = parts;
  container.add(createToolbar(kind));
  container.add(parts.notice);
  container.add(parts.pickStatus);
  syncHelperNotice(kind);
  syncPickStatus(kind);

  const section: DebuggerPaneSection<P> = {
    pane: true,
    content: persistOnCommit(getItems({ refreshPane: parts.refreshPane, fire }), () =>
      persistTesterState(kind)
    ),
  };
  built = _buildDebuggerPane(
    { id: WINDOW_IDS[kind], state: ray as unknown as AnyState },
    section as unknown as DebuggerPaneSection<AnyState>
  );
  container.add(built.cmp);
  const menu = createFieldContextMenu({ container: built.cmp.elem });

  container.add(parts.results);
  renderKindResults(kind);
  return container;
};

const createThreeTesterContent = () => {
  const state = getThreeState();
  const ray = state.rays[state.activeIndex];
  return createTesterContent(
    'THREE',
    ray,
    (ctx) => getThreeRayItems(ray, ctx),
    () => {
      fireThreeRays();
      renderKindResults('THREE');
    }
  );
};

const createPhysicsTesterContent = () => {
  const state = getPhysicsState();
  const ray = state.rays[state.activeIndex];
  return createTesterContent(
    'PHYSICS',
    ray,
    (ctx) => getPhysicsRayItems(ray, ctx),
    () =>
      void firePhysicsRaysAsync(() => {
        mounted.PHYSICS?.refreshPane();
        renderKindResults('PHYSICS');
      })
  );
};

// ----------------------------------------------------------------------------
// Results
// ----------------------------------------------------------------------------

/** A hit as the list shows it: its heading, its fields, and the data copied as JSON */
type HitListItem = { id: string; title: string; fields: [string, string][]; data: unknown };

const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(3) : String(n));
const fmtVec = (v: Vec3) => `(${fmt(v.x)}, ${fmt(v.y)}, ${fmt(v.z)})`;

const getEntityFields = (info: HitEntityInfo): [string, string][] => [
  ['Entity', info.entityId === null ? '—' : String(info.entityId)],
  ['App id', info.appId === null ? '—' : `${info.appId}${info.appIdIsFixed ? '' : ' (generated)'}`],
];

const toThreeListItem = (hit: ThreeHitRow, index: number): HitListItem => {
  const instance = hit.instanceId === null ? '' : ` · instance ${hit.instanceId}`;
  return {
    id: String(index),
    title: `#${index + 1} · distance ${fmt(hit.distance)}`,
    fields: [
      ['Point', fmtVec(hit.point)],
      ['Normal', hit.normal ? fmtVec(hit.normal) : '—'],
      ['Object', `${hit.objectName || '(unnamed)'} · ${hit.objectType}${instance}`],
      ...getEntityFields(hit),
    ],
    data: hit,
  };
};

const toPhysicsListItem = (hit: PhysicsHitRow, index: number): HitListItem => ({
  id: String(index),
  title: `#${index + 1} · toi ${fmt(hit.toi)}`,
  fields: [
    ['Point', fmtVec(hit.point)],
    ['Normal', hit.normal ? fmtVec(hit.normal) : '—'],
    ['Collider', `${hit.colliderId} · ${hit.bodyId === null ? 'no body' : `body ${hit.bodyId}`}`],
    ...getEntityFields(hit),
  ],
  data: hit,
});

/** Label and value pairs as a description list (values set as text: object names aren't HTML). */
const addFields = (parent: CMPHandle, fields: [string, string][]) => {
  const list = parent.add({ tag: 'dl', class: styles.fields });
  for (const [label, value] of fields) {
    list.add({ tag: 'dt', text: label });
    list.add({ tag: 'dd', text: value });
  }
};

const renderHit = (item: HitListItem) => {
  const cmp = CMP({ class: styles.hit });
  cmp.add({ tag: 'span', class: styles.hitTitle, text: item.title });
  addFields(cmp, item.fields);
  return cmp;
};

const COPY_ACTION = {
  key: 'copy',
  label: 'Copy this hit as JSON',
  icon: getSvgIcon('fileCode', 'sm'),
  onPress: (item: HitListItem) => copyAsJson(item.data),
};

const renderKindResults = (kind: RayTesterKind) => {
  if (kind === 'THREE') renderResults('THREE', testerResults.three, false, toThreeListItem);
  else
    renderResults(
      'PHYSICS',
      testerResults.physics,
      testerResults.isPhysicsFiring,
      toPhysicsListItem
    );
};

/** Writes a kind's results into its mounted window: per ray, the ray, then its hits as a list
 * (each with its copy button) or its error. */
const renderResults = <H>(
  kind: RayTesterKind,
  results: RayTesterResult<H>[] | null,
  isPending: boolean,
  toItem: (hit: H, index: number) => HitListItem
) => {
  const root = mounted[kind]?.results;
  if (!root) return;
  root.removeChildren();
  if (isPending || !results) {
    const text = isPending ? 'Waiting for the physics results…' : 'Fire to see the hits.';
    root.add({ tag: 'p', class: styles.muted, text });
    return;
  }
  const isMulti = results.length > 1;
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (isMulti) root.add({ tag: 'h4', class: styles.rayHeading, text: `Ray #${i + 1}` });
    if (result.ray) {
      addFields(root, [['Ray', `${fmtVec(result.ray.origin)} → dir ${fmtVec(result.ray.dir)}`]]);
    }
    if (result.error) {
      root.add({ tag: 'p', class: styles.error, text: result.error });
      continue;
    }
    const listed = result.hits.slice(0, MAX_LISTED_HITS).map(toItem);
    const list = createList<HitListItem>({
      items: listed,
      title: (item) => item.title,
      render: renderHit,
      actions: [COPY_ACTION],
      heading: 'Hits',
      headingLevel: isMulti ? 5 : 4,
      empty: 'No hits',
      class: styles.hits,
    });
    root.add(list.cmp);
    const more = result.hits.length - listed.length;
    if (more > 0) {
      root.add({ tag: 'p', class: styles.muted, text: `+${more} more hits not listed` });
    }
  }
};

const copyAsJson = (data: unknown) => {
  navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(
    () => addToast({ title: 'Copied', message: 'Hit copied as JSON', toasterId: DEBUG_TOASTER_ID }),
    () =>
      addToast({
        type: 'warning',
        title: 'Copy failed',
        message: 'The clipboard is not available',
        toasterId: DEBUG_TOASTER_ID,
      })
  );
};

// ----------------------------------------------------------------------------
// The clear button, the scene enter and the registration
// ----------------------------------------------------------------------------

/**
 * The Ray cast controls tab's clear button for both testers' saved params (the scope is asked
 * when more than one scene has some).
 * @returns (CMPHandle) the button
 */
export const _createClearRayTestersLSButton = () =>
  createClearLSButton({
    icon: 'databaseX',
    title: "Clear the ray testers' saved params",
    hasData: () => getScenesWithData(['THREE', 'PHYSICS']).length > 0,
    watchKey: RAY_TESTER_LS_KEY,
    onClear: () => clearTesterLSWithConfirm(['THREE', 'PHYSICS']),
  });

/** On every scene enter: the results belong to the previous scene, and the open windows show
 * the new scene's params (the state reloads them). */
const onSceneEnter = () => {
  cancelPick();
  testerResults.three = null;
  testerResults.physics = null;
  dropPhysicsFiresInFlight();
  updateDraggableWindow(WINDOW_IDS.THREE);
  updateDraggableWindow(WINDOW_IDS.PHYSICS);
};

const CONTENT_FNS: Record<RayTesterKind, () => CMPHandle> = {
  THREE: createThreeTesterContent,
  PHYSICS: createPhysicsTesterContent,
};

// Registered at module load (before the saved windows are restored), so a tester window that
// was open before a reload gets its content and its onClose (closing it drops an armed pick)
for (const kind of Object.keys(WINDOW_IDS) as RayTesterKind[]) {
  registerDraggableWindow(WINDOW_IDS[kind], {
    content: CONTENT_FNS[kind],
    onClose: () => cancelPickFor(kind),
  });
}
registerOnAllSceneEnters('rayTester', onSceneEnter);
setPickChangeListener(syncPickStatus);
