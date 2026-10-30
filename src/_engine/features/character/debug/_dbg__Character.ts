// The Characters tab and its tools: the list (its rows open the edit window, toggle the state
// window and pin the gizmos), the character edit window on the UI kit's property grid (p806 D10) and
// the saved config's clear button.
import {
  addDebugToast,
  createDebuggerTab,
  debuggerListCMP,
  updateDebuggerTab,
  type DebuggerListItem,
} from '../../../debug/DebuggerGUI';
import { CMP } from '../../../ui/core/CMP';
import type { PropertyGridItem } from '../../../ui/forms/PropertyGridItems';
import {
  createDebugWindowGrid,
  getEntityInfoItems,
  getInfoRowItem,
} from '../../../debug/_dbg__DebugWindowGrid';
import { getBodyPoseItems } from '../../physics/debug/_dbg__BodyPoseItems';
import { IS_DEBUG_ENV } from '../../../kernel/config/Config';
import {
  closeDraggableWindow,
  getDraggableWindowsOfKind,
  getKindWindowId,
  registerDraggableWindowKind,
  toggleDraggableWindow,
  updateDraggableWindowsOfKind,
} from '../../../ui/overlays/windows/DraggableWindow';
import { llog, lwarn } from '../../../utils/Logger';
import { deleteCharacter, getCharacterById, getCharacters } from '../Character';
import { getECSWorld } from '../../../kernel/ecs/ECS';
import { ComponentType } from '../../../kernel/ecs/ECSCoreComponents';
import { registerEntityWindowOpener } from '../../../debug/Profiler';
import { confirmClearScope, createClearListLSButton } from '../../../debug/_dbg__ClearLSButtons';
import {
  CHAR_CONFIG_LS_KEY,
  clearSavedConfigScenes,
  getSceneIdsWithSavedConfig,
} from './_dbg__CharacterConfigOverrides';
import { getCurrentSceneId } from '../../../kernel/scene/Scene';
import {
  _recordUndoRedoAction,
  _registerUndoRedoActionHandler,
} from '../../../debug/_dbg__UndoRedo';
import {
  _openCharacterStateWindow,
  _toggleCharacterStateWindow,
  CHAR_STATE_WIN_ID,
  getCharacterStateWindowId,
  isCharacterStateWindowOpen,
  onCharacterStateWindowsChange,
} from './_dbg__CharacterStateWindow';
import {
  isCharacterGizmosPinned,
  onCharacterGizmoPinsChange,
  setCharacterGizmosPinned,
  syncCharacterGizmoPins,
} from './_dbg__CharacterGizmos';

export { _applySavedCharacterConfig } from './_dbg__CharacterConfigOverrides';

const CHARACTERS_TAB_ID = 'charactersControls';
/** The edit windows' kind: one window per character, keyed by its id */
const CHAR_EDIT_WIN_ID = 'characterEditorWindow';

const getEditWindowId = (charId: string) => getKindWindowId(CHAR_EDIT_WIN_ID, charId);
/** The list's selection follows the edit windows' open states. */
const refreshCharactersList = () => updateDebuggerTab(CHARACTERS_TAB_ID);
// The rows' toggles follow the state windows' open states and pin buttons
onCharacterStateWindowsChange(refreshCharactersList);
onCharacterGizmoPinsChange(refreshCharactersList);

// Undo/redo

/** Character poses set from the edit window, recorded to the scene's history. Character ids
 * are always app-supplied, so they're stable across reloads. */
type CharVec3 = { x: number; y: number; z: number };
type CharQuat = { x: number; y: number; z: number; w: number };
type CharacterUndoPayload<T> = { characterId: string; prev: T; next: T };

/** Finds the character's rigid body by character id at undo/redo time (never a captured
 * reference). */
const resolveCharacterRigidBody = (characterId: string) => {
  const character = getCharacterById(characterId);
  const rigidBody = character ? getECSWorld().getRigidBody(character.entityId) : undefined;
  if (!rigidBody) lwarn(`Undo/redo: character "${characterId}" no longer exists, skipping.`);
  return rigidBody;
};

// Only the pose is restored: the body keeps simulating (and its controls keep driving it),
// so its velocity isn't rolled back.
_registerUndoRedoActionHandler<CharacterUndoPayload<CharVec3>>('character.position', {
  undo: ({ characterId, prev }) =>
    resolveCharacterRigidBody(characterId)?.setTranslation(prev, true),
  redo: ({ characterId, next }) =>
    resolveCharacterRigidBody(characterId)?.setTranslation(next, true),
});
_registerUndoRedoActionHandler<CharacterUndoPayload<CharQuat>>('character.rotation', {
  undo: ({ characterId, prev }) => resolveCharacterRigidBody(characterId)?.setRotation(prev, true),
  redo: ({ characterId, next }) => resolveCharacterRigidBody(characterId)?.setRotation(next, true),
});

type CharacterObject = NonNullable<ReturnType<typeof getCharacterById>>;

/** The character's info rows: its ids, kinds and (deprecated) binding ids, as text */
const getCharacterInfoItems = (character: CharacterObject): PropertyGridItem[] => {
  const world = getECSWorld();
  const debugData = world.getComponent(character.entityId, ComponentType.DEBUG_DATA);
  return [
    ...getEntityInfoItems({
      entityId: character.entityId,
      appId: world.getComponent(character.entityId, ComponentType.APP_ID)?.id,
      type: 'Character',
      name: character.name || debugData?.name,
      description: debugData?.description,
    }),
    getInfoRowItem('Character ID', character.id),
    getInfoRowItem('Body kind', character.bodyKind),
    getInfoRowItem('Controller', character.controller?.kind ?? '-'),
    getInfoRowItem('Brain', character.brain?.kind ?? '- (code)'),
    getInfoRowItem('Control mode', character.controlMode),
    getInfoRowItem('Visual ID', String(character.visualId)),
    ...(character.keyBindingIds.length
      ? [getInfoRowItem('Key binding IDs', character.keyBindingIds.join(', '))]
      : []),
    ...(character.mouseBindingIds.length
      ? [getInfoRowItem('Mouse binding IDs', character.mouseBindingIds.join(', '))]
      : []),
  ];
};

/** Content for the character's edit window (p806 D10): its pose rows when it has a body (a copy
 * the Set buttons apply, recorded for undo), its buttons and its info rows */
export const createEditCharacterContent = (data?: { [key: string]: unknown }) => {
  const d = data as { id: string };
  const character = getCharacterById(d.id);
  if (!character) {
    // We want to close the window when no character is found,
    // but we have to return first, so wait one iteration.
    setTimeout(() => {
      closeDraggableWindow(getEditWindowId(d.id));
    }, 0);
    return CMP();
  }

  // The content is built before the window state is open: refresh the list selection after it
  queueMicrotask(refreshCharactersList);

  let refreshGrid = () => {};
  const rigidBody = getECSWorld().getRigidBody(character.entityId);
  const items: PropertyGridItem[] = rigidBody
    ? [
        ...getBodyPoseItems({
          rigidBody,
          refresh: () => refreshGrid(),
          onSet: ({ field, prev, next }) => {
            if (JSON.stringify(prev) === JSON.stringify(next)) return;
            _recordUndoRedoAction<CharacterUndoPayload<typeof next>>(
              `character.${field}`,
              `Character ${character.id}: ${field}`,
              { characterId: character.id, prev, next }
            );
          },
        }),
        { type: 'separator' },
      ]
    : [];
  items.push(
    {
      type: 'button',
      title: 'Open character state window',
      onClick: () => _openCharacterStateWindow(character),
    },
    // The character holds references to its mesh, body and controls: logged, not copied
    {
      type: 'button',
      title: 'Log to the console',
      onClick: () => llog('CHARACTER:***************', character, '**********************'),
    },
    {
      type: 'button',
      // Only for this page load: the scene creates it again
      title: 'Remove character (this page load only)',
      variant: 'danger',
      onClick: () => {
        closeDraggableWindow(getEditWindowId(d.id));
        closeDraggableWindow(getCharacterStateWindowId(d.id));
        deleteCharacter(character.id);
      },
    },
    ...getCharacterInfoItems(character)
  );

  const { cmp, grid } = createDebugWindowGrid({ items });
  refreshGrid = grid.refresh;
  return cmp;
};

const getCharactersListData = (): DebuggerListItem[] =>
  getCharacters().map((character) => ({
    itemId: character.id,
    title: character.name || `[${character.id}]`,
    subTitle: `[${character.id}]`,
    toggleValues: [isCharacterStateWindowOpen(character.id), isCharacterGizmosPinned(character.id)],
  }));

/** Row toggle: the open / front / close rule of a row click, for the character's state window. */
const toggleCharacterStateWindow = (charId: string) => {
  const character = getCharacterById(charId);
  if (character) _toggleCharacterStateWindow(character);
};

registerDraggableWindowKind(CHAR_EDIT_WIN_ID, {
  content: createEditCharacterContent,
  onClose: refreshCharactersList,
  // Kept open on a scene change when the next scene has a character with the same id
  sceneTargetResolver: (data) => Boolean(getCharacterById(String(data?.id))),
});

/** List row click: opens the character's window, brings it to the front, or closes it when on
 * top. */
const toggleEditCharacterWindow = (charId: string) => {
  const character = getCharacterById(charId);
  if (!character) return;
  toggleDraggableWindow({
    id: getEditWindowId(character.id),
    kind: CHAR_EDIT_WIN_ID,
    position: { x: 110, y: 60 },
    size: { w: 400, h: 400 },
    saveToLS: true,
    title: `Edit character: ${character.name || `[${character.id}]`}`,
    isDebugWindow: true,
    data: { id: character.id },
    closeOnSceneChange: true,
  });
};

// The profiler's heaviest objects open a character's window (before the physics entity one)
registerEntityWindowOpener({
  id: 'character',
  label: 'Edit character',
  priority: 10,
  canOpen: (world, entityId) => Boolean(world.getComponent(entityId, ComponentType.CHARACTER)),
  toggle: (world, entityId) => {
    const character = world.getComponent(entityId, ComponentType.CHARACTER);
    if (character) toggleEditCharacterWindow(character.id);
  },
});

// Clear LS

const CLEARED_NOTE =
  'The live values stay as they are: the code values return the next time each character is created.';

/** Clears the characters' saved config values (the state windows' edits). With more than one
 * scene's, asks which. */
const createClearSavedConfigButton = () =>
  createClearListLSButton({
    hasData: () => getSceneIdsWithSavedConfig().length > 0,
    watchKey: CHAR_CONFIG_LS_KEY,
    onClear: () => {
      const sceneIds = getSceneIdsWithSavedConfig();
      const clear = (ids: string[]) => {
        clearSavedConfigScenes(ids);
        addDebugToast({ title: 'Saved character values cleared', message: CLEARED_NOTE });
      };
      if (sceneIds.length > 1) {
        confirmClearScope({
          onClearAllScenes: () => clear(sceneIds),
          onClearThisScene: () => {
            const sceneId = getCurrentSceneId();
            if (sceneId) clear([sceneId]);
          },
          note: CLEARED_NOTE,
        });
      } else {
        clear(sceneIds);
      }
    },
  });

export const _createCharactersDebuggerGUI = () => {
  if (!IS_DEBUG_ENV) return;
  createDebuggerTab({
    id: CHARACTERS_TAB_ID,
    title: 'Character controls',
    icon: 'personArmsUp',
    // A refresh re-reads what it shows: kept open on a scene change (p806 D5)
    keepOnSceneChange: true,
    // The tab has no data of its own (its button stays disabled, kept for consistency); the
    // list's button clears the characters' saved config values (scene-scoped, module-owned)
    clearLSButton: true,
    headerButtons: () => [createClearSavedConfigButton()],
    content: () => [
      debuggerListCMP({
        id: 'characters',
        label: 'Characters',
        emptyText: 'No characters registered to this scene..',
        data: getCharactersListData,
        selectedItemId: () =>
          getDraggableWindowsOfKind(CHAR_EDIT_WIN_ID).map((win) => String(win.data?.id)),
        perItemConfig: {
          onClick: toggleEditCharacterWindow,
          toggles: [
            {
              icon: 'personArmsUp',
              title: 'Character state window (open / bring to front / close)',
              fn: toggleCharacterStateWindow,
            },
            {
              icon: 'pin',
              title:
                "Pin the character's debug gizmos: they stay after its state window closes (session only)",
              fn: setCharacterGizmosPinned,
            },
          ],
        },
      }),
    ],
  });

  setTimeout(() => {
    _updateCharactersDebuggerGUI();
  }, 0);
};

export const _updateCharactersDebuggerGUI = (only?: 'LIST' | 'WINDOW') => {
  if (!IS_DEBUG_ENV) return;
  // A character created under a pinned id (eg. a respawn) gets its gizmos back
  syncCharacterGizmoPins();
  if (only !== 'WINDOW') refreshCharactersList();
  if (only === 'LIST') return;
  // An edit window whose character is gone closes itself; a state window stays (a character
  // created again under its id, eg. a respawn, shows up in it)
  updateDraggableWindowsOfKind(CHAR_EDIT_WIN_ID);
  updateDraggableWindowsOfKind(CHAR_STATE_WIN_ID);
};
