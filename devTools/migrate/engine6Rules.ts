/**
 * The engine 6.0.0 codemod's rules as data (p622 D10): `engine6.ts` applies them, and each names
 * the plan decision it comes from and the migration page's anchor
 * (`hub/pages/documentation/migration/engine-6.md`, under `documentation/migration/`).
 */

/** An entry alias (`aekasha`, `aekasha/ui`, …) and a name it exports */
export type EntryName = { entry: string; name: string };

/**
 * D10 kinds 1-2: a name a module imports from an entry becomes another name on the same entry (a
 * rename) or the same name on another entry (a move), in the import and every reference.
 */
export type ImportRule = {
  kind: 'import';
  /** Unique: the tests key each rule's fixture by it */
  id: string;
  /** The entry and the name engine 5 exported */
  from: EntryName;
  /** What replaces it in engine 6 */
  to: EntryName;
  /** The plan decision it comes from */
  decision: string;
  /** The migration page's heading, as its slug */
  anchor: string;
};

/**
 * D10 kind 4, by import: a name the entry no longer exports, with nothing to put in its place
 * mechanically. Each import of it (and each `ns.Name` through a namespace import) is reported.
 */
export type RemovedImportRule = {
  kind: 'removedImport';
  id: string;
  entry: string;
  /** Each removed name → what to do instead */
  names: Readonly<Record<string, string>>;
  decision: string;
  anchor: string;
};

/**
 * D10 kind 4, by the checker: members the entry's types no longer have. Reported where code
 * reads one (`x.member`, a destructuring) on a value of one of `types`, and where an object
 * literal whose contextual type is one of them writes it.
 */
export type RemovedMemberRule = {
  kind: 'removedMember';
  id: string;
  /** The types (each an entry's export) that lost the members */
  types: readonly EntryName[];
  /** Each removed member → what to do instead */
  members: Readonly<Record<string, string>>;
  /** Only an object literal's string value is reported (a property that changed its type) */
  onlyString?: boolean;
  decision: string;
  anchor: string;
};

/**
 * D10 kind 3 or 4 on a call of an entry's function: its argument at `index`. With `literal`, a
 * string literal argument of that text is rewritten to `rewrite` (a renamed option value) or
 * reported; with `members`, an object literal argument's properties of those names are reported;
 * with neither, any argument there is.
 */
export type CallArgRule = {
  kind: 'callArg';
  id: string;
  callee: EntryName;
  index: number;
  literal?: string;
  rewrite?: string;
  members?: readonly string[];
  /** What to do instead (a report's text) */
  advice: string;
  decision: string;
  anchor: string;
};

export type Engine6Rule = ImportRule | RemovedImportRule | RemovedMemberRule | CallArgRule;

const rename = (
  entry: string,
  from: string,
  to: string,
  decision: string,
  anchor: string
): ImportRule => ({
  kind: 'import',
  id: `rename:${from}`,
  from: { entry, name: from },
  to: { entry, name: to },
  decision,
  anchor,
});

const REMOVED = 'removed-deprecations';
const UI_KIT = 'the-ui-kit-s-names';
const DEBUG = 'the-debug-entry-s-names';
const TOOLKIT = 'toolkit-3-0-0';

/** Each name → the same advice */
const each = (names: readonly string[], advice: string) =>
  Object.fromEntries(names.map((name) => [name, advice]));

const type = (entry: string, ...names: string[]) => names.map((name) => ({ entry, name }));

const BRAIN = 'give the character a brain (`brain: { kind, params: { bindings } }`)';
const CONTROLLER_DATA = "read the controller's `state`, `config.values` and `internal`";
const DEV_FILES =
  "now internal (the dev server's protocol): use `writeDevFiles`, `readDevFile` and `onDevDataGathered`";

// The UI kit's `T`-prefixed aliases (p803 D3), each → its `CMP` name
const CMP_ALIASES = [
  ['TCMP', 'CMPHandle'],
  ['TProps', 'CMPProps'],
  ['TSettings', 'CMPSettings'],
  ['TListener', 'CMPListener'],
  ['TListenerCache', 'CMPListenerCache'],
  ['TListenerCreator', 'CMPListenerCreator'],
  ['TStyle', 'CMPStyle'],
  ['TAttr', 'CMPAttr'],
  ['TClassAction', 'CMPClassAction'],
  ['TAnimChain', 'CMPAnimChain'],
  ['TAnimState', 'CMPAnimState'],
] as const;

export const ENGINE6_RULES: readonly Engine6Rule[] = [
  rename('aekasha', 'CoreComponentType', 'ComponentType', 'p612', REMOVED),
  rename('aekasha', 'registerOnAllSceneEnterings', 'registerOnAllSceneEnters', 'p613', REMOVED),
  rename('aekasha/character', 'CharacterInputHoldMode', 'PlayerBrainHoldMode', 'p610 D5', REMOVED),
  ...CMP_ALIASES.map(([from, to]) => rename('aekasha/ui', from, to, 'p803 D3', UI_KIT)),
  rename('aekasha/ui', 'TDropDown', 'DropDown', 'p803', UI_KIT),
  rename('aekasha/toolkit/ecs', 'PhysicsParams', 'MovingPlatformPhysicsParams', 'p620 D5', TOOLKIT),

  // Phase 2 section 1: the kernel and physics
  {
    kind: 'removedImport',
    id: 'removed:textureSync',
    entry: 'aekasha',
    names: {
      loadTexture: 'load it with `await loadTextureAsync({ … })` (the asset pipeline’s output)',
      loadTextures: '`await Promise.all` over `loadTextureAsync` calls',
    },
    decision: 'p613 D12',
    anchor: REMOVED,
  },
  {
    kind: 'removedMember',
    id: 'removed:kernelMembers',
    types: [
      ...type('aekasha', 'SceneHooks', 'LoadSceneProps', 'AppConfig'),
      ...type('aekasha/physics', 'PhysicsState'),
    ],
    members: {
      sceneDeleted: 'never called: delete the hook',
      updateLoaderStatusFn: 'never read: give the loader its own in `createSceneLoader`',
      draggableWindows:
        'register the content with `registerDraggableWindow` or `registerDraggableWindowKind` (aekasha/ui)',
      ...each(
        ['pausedTime', 'pauseDurationTotal'],
        'gone with `getPhysGameTime`: count fixed steps (`getPhysicsSubStepIndex()`)'
      ),
    },
    decision: 'p612, p613, p617',
    anchor: REMOVED,
  },
  {
    kind: 'callArg',
    id: 'removed:groupDeleteFlags',
    callee: { entry: 'aekasha', name: 'removeFromGroupEntity' },
    index: 2,
    members: ['deleteGeometries', 'deleteMaterials', 'deleteTextures'],
    advice: "never read: `deleteMeshes` releases a mesh entity's geometry, materials and textures",
    decision: 'p613',
    anchor: REMOVED,
  },
  // Phase 2 section 2: the characters
  {
    kind: 'removedImport',
    id: 'removed:characterInput',
    entry: 'aekasha/character',
    names: {
      ...each(
        [
          'CharacterInputOpts',
          'CharacterInputCommonOpts',
          'CharacterActionMappings',
          'TankInputMappings',
          'WorldFixedInputMappings',
          'CameraRelativeInputMappings',
        ],
        `gone with \`createDynamicCharacter\`'s \`input\`: ${BRAIN}`
      ),
      CharacterData: `the flat data view is gone: ${CONTROLLER_DATA}`,
    },
    decision: 'p610 D5',
    anchor: REMOVED,
  },
  {
    kind: 'removedMember',
    id: 'removed:characterMembers',
    types: type(
      'aekasha/character',
      'CharacterObject',
      'CreateCharacterOpts',
      'DynamicCharacterOpts',
      'DynamicCharacterParams',
      'DynamicCharacter',
      'CharacterCastRecord',
      'CharacterBodyPlan',
      'CharacterBodyKindField'
    ),
    members: {
      input: BRAIN,
      controls: BRAIN,
      charData: '`config` (its keys without the `_`)',
      data: CONTROLLER_DATA,
      kind: '`bodyKind`',
      ...each(['keyBindingIds', 'mouseBindingIds'], `gone with \`controls\`: ${BRAIN}`),
      initialConfig: "the controller's `config.initial` (its keys without the `_`)",
      resolvedAt: '`resolvedAtStep` (a step index)',
    },
    decision: 'p610 D5',
    anchor: REMOVED,
  },
  // Phase 2 section 3: the sky box's pre-3.0 shape
  {
    kind: 'removedImport',
    id: 'removed:legacySkyBox',
    entry: 'aekasha/skybox',
    names: each(
      ['LegacySkyBoxProps', 'isLegacySkyBoxProps', 'LEGACY_SKYBOX_WARNING'],
      'gone with the pre-3.0 `{ type, params }` sky box: write a layered definition (`base`, `env`)'
    ),
    decision: 'p615',
    anchor: REMOVED,
  },
  {
    kind: 'callArg',
    id: 'removed:legacySkyBoxShape',
    callee: { entry: 'aekasha/skybox', name: 'createSkyBox' },
    index: 0,
    members: ['type', 'params'],
    advice:
      'the pre-3.0 `{ type, params }` shape is gone: a layered definition (`base`, `env`; an equirect’s old look is `rotate: π`, a cube’s `flipY: true`)',
    decision: 'p615',
    anchor: REMOVED,
  },
  // Phase 2 section 4: the debug entry and the UI kit
  {
    kind: 'removedImport',
    id: 'removed:debugEntry',
    entry: 'aekasha/debug',
    names: {
      ...each(
        [
          'DEV_FILES_ROUTE_BASE',
          'DEV_FILES_TOKEN_HEADER',
          'DEV_FILES_TOKEN_META',
          'DEV_FILES_HASH_HEADER',
          'AEK_GATHER_EVENT',
          'DevFilesStageBody',
          'DevFilesSaveDataWrite',
          'DevFilesErrorBody',
        ],
        DEV_FILES
      ),
      ...each(
        ['TestBridgeProbeResult', 'TestBridgeSceneReady', 'TestBridgeSnapshot'],
        "now internal (the scene runner's): no replacement"
      ),
      DebugGUIOpts: "gone: the drawer's button stays in the middle (move it with CSS)",
    },
    decision: 'p618 D3',
    anchor: DEBUG,
  },
  {
    kind: 'callArg',
    id: 'removed:debuggerTabOpts',
    callee: { entry: 'aekasha/debug', name: 'createDebuggerTab' },
    index: 1,
    advice: "`createDebuggerTab(def)` takes no options: the drawer's button stays in the middle",
    decision: 'p618',
    anchor: DEBUG,
  },
  {
    kind: 'removedMember',
    id: 'removed:uiKitMembers',
    types: type('aekasha/ui', 'AddToastResponse', 'CMPSettings'),
    members: {
      timeout: '`removeToast` removes a toast early',
      doCheckIsInDom: 'never read: delete it',
    },
    decision: 'p617, p803',
    anchor: UI_KIT,
  },
  {
    kind: 'removedMember',
    id: 'removed:stringKbd',
    types: type(
      'aekasha/ui',
      'ButtonProps',
      'SplitButtonProps',
      'MenuActionItem',
      'MenuCheckboxItem'
    ),
    members: {
      kbd: "a string is gone: `createKbd({ keys: '…' })` (the owner removes it with itself)",
    },
    onlyString: true,
    decision: 'p804 D13',
    anchor: UI_KIT,
  },
  {
    kind: 'callArg',
    id: 'rewrite:svgIconSmall',
    callee: { entry: 'aekasha/ui', name: 'getSvgIcon' },
    index: 1,
    literal: 'small',
    rewrite: 'sm',
    advice: "`'sm'`",
    decision: 'p803 D5',
    anchor: UI_KIT,
  },
  {
    kind: 'import',
    id: 'move:createSeededRandom',
    from: { entry: 'aekasha/toolkit/geometry', name: 'createSeededRandom' },
    to: { entry: 'aekasha', name: 'createSeededRandom' },
    decision: 'p620 D5',
    anchor: TOOLKIT,
  },
];
