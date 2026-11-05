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
 * mechanically, or one that needs a feature the project doesn't list (`withoutFeature`). Each
 * import of it (and each `ns.Name` through a namespace import) is reported.
 */
export type RemovedImportRule = {
  kind: 'removedImport';
  id: string;
  entry: string;
  /** Each removed name → what to do instead */
  names: Readonly<Record<string, string>>;
  /** A feature's factory: the names stay on the entry but need that feature, so they're reported
   * only in a project none of whose modules (tests aside) calls it (`physicsTiers()`, p622 D8) */
  withoutFeature?: EntryName;
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
  /** Reported only in a project none of whose modules calls this feature's factory, as
   * `RemovedImportRule.withoutFeature` */
  withoutFeature?: EntryName;
  decision: string;
  anchor: string;
};

/**
 * D10 kind 3, by the checker: a member an entry's type renamed. Where code reads it (`x.member`,
 * a call of it included) on a value of one of `types`, it gets its new name.
 */
export type RenamedMemberRule = {
  kind: 'renamedMember';
  id: string;
  /** The types (each an entry's export) whose members were renamed */
  types: readonly EntryName[];
  /** Each old member → its new name */
  members: Readonly<Record<string, string>>;
  decision: string;
  anchor: string;
};

/** One of a reshaped call's new arguments: an old argument as it was, or an object of them */
export type ReshapeArg = { param: string } | { props: readonly ReshapeProp[] };

/** A property of a new object argument: an old argument under a key, or spread into it (an
 * object literal's properties are merged in place) */
export type ReshapeProp = { key: string; param: string } | { spread: string };

/**
 * D10 kind 3, by the callee's declaration: a call of an entry's function in its old shape gets
 * the new one. An old argument that's left out or `undefined` is dropped, a trailing new
 * argument left empty too; an object of a single spread is that argument as it was. New
 * arguments that name the old ones out of their order (the world moved first) are checked per
 * call: two arguments that change places must both be free of side effects (`PURE_CALLS` aside,
 * no call), or one of them a literal, else the call is reported.
 */
export type ReshapeRule = {
  kind: 'reshape';
  id: string;
  callee: EntryName;
  /** The old parameters' names, in order */
  params: readonly string[];
  /** The new arguments */
  args: readonly ReshapeArg[];
  /** A call with more arguments than this is in the old shape */
  newArgCount: number;
  /** A call whose argument at `index` has no `member` is in the old shape too (the new props
   * have it); one of type `any` is reported */
  newHas?: { index: number; member: string };
  /** A call whose argument at `index` is of this type (`undefined` aside) is in the old shape
   * too: an old flag or index where the options object goes now; one of type `any` is reported */
  oldType?: { index: number; type: 'boolean' | 'number' };
  decision: string;
  anchor: string;
};

/** Entry functions whose call has no side effects (a read), so a reshape may move it past the
 * other arguments */
export const PURE_CALLS: readonly EntryName[] = [{ entry: 'aekasha', name: 'getECSWorld' }];

export type Engine6Rule =
  | ImportRule
  | RemovedImportRule
  | RemovedMemberRule
  | CallArgRule
  | ReshapeRule
  | RenamedMemberRule;

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
const CREATORS = 'the-entity-creators-and-createphysicsentity';
const SCENES = 'the-scene-functions';
const LIGHTS = 'the-light-setters';
const PHYSICS = 'the-physics-leftovers';
const TIERS = 'physicstiers';

/** Each name → the same advice */
const each = (names: readonly string[], advice: string) =>
  Object.fromEntries(names.map((name) => [name, advice]));

const type = (entry: string, ...names: string[]) => names.map((name) => ({ entry, name }));

// The entity creators' last two optional parameters, the entity's options and its world, as one
// object (p622 D2-D4): an object literal merged in place, anything else spread
const OPTS_WITH_WORLD: ReshapeArg = {
  props: [{ spread: 'opts' }, { key: 'world', param: 'world' }],
};

/** An entity creator `(props, entityOpts?, world?)` → `(props, { ...entityOpts, world })` */
const creator = (entry: string, name: string): ReshapeRule => ({
  kind: 'reshape',
  id: `reshape:${name}`,
  callee: { entry, name },
  params: ['props', 'opts', 'world'],
  args: [{ param: 'props' }, OPTS_WITH_WORLD],
  newArgCount: 2,
  decision: 'p622 D4',
  anchor: CREATORS,
});

const BRAIN = 'give the character a brain (`brain: { kind, params: { bindings } }`)';
const CONTROLLER_DATA = "read the controller's `state`, `config.values` and `internal`";
const TIERS_FEATURE = { entry: 'aekasha/physics', name: 'physicsTiers' };
const ADD_TIERS =
  "add `physicsTiers()` (aekasha/physics) to `InitEngine`'s `features`, right after `physics()`";
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
  // Phase 3: physics
  {
    kind: 'reshape',
    id: 'reshape:createPhysicsEntity',
    callee: { entry: 'aekasha/physics', name: 'createPhysicsEntity' },
    params: ['colliders', 'body', 'target', 'opts', 'world'],
    args: [
      {
        props: [
          { key: 'colliders', param: 'colliders' },
          { key: 'body', param: 'body' },
          { key: 'target', param: 'target' },
        ],
      },
      OPTS_WITH_WORLD,
    ],
    newArgCount: 2,
    newHas: { index: 0, member: 'colliders' },
    decision: 'p622 D3',
    anchor: CREATORS,
  },
  {
    kind: 'renamedMember',
    id: 'rename:setMaxCcdSubstepsSync',
    types: type('aekasha/physics', 'WorldAPI'),
    members: { setMaxCcdSubstepsSync: 'setMaxCcdSubsteps' },
    decision: 'p622 D7',
    anchor: PHYSICS,
  },
  {
    kind: 'removedImport',
    id: 'removed:physicsHooks',
    entry: 'aekasha/physics',
    names: {
      PhysicsHooks:
        'gone, with `WorldAPI.step`’s `hooks`: no collider could ask for them (no `ColliderParams` field set its active hooks), so they never ran',
      SolverFlags: 'gone with `PhysicsHooks`: it was a contact filter’s answer',
    },
    decision: 'p622 D7',
    anchor: PHYSICS,
  },
  // Phase 4: the tiers, a feature of their own (no module of the project calls `physicsTiers()`)
  {
    kind: 'removedImport',
    id: 'requires:physicsTiers',
    entry: 'aekasha/physics',
    names: each(
      ['requestPhysicsTier', 'setPhysicsTierPolicy', 'setPhysicsTierPolicyMember'],
      `throws without the \`physicsTiers()\` feature: ${ADD_TIERS}`
    ),
    withoutFeature: TIERS_FEATURE,
    decision: 'p622 D8',
    anchor: TIERS,
  },
  {
    kind: 'callArg',
    id: 'requires:physicsTiersOption',
    callee: { entry: 'aekasha/physics', name: 'createPhysicsEntity' },
    index: 1,
    members: ['tierPolicy'],
    advice: `ignored without the \`physicsTiers()\` feature: ${ADD_TIERS}`,
    withoutFeature: TIERS_FEATURE,
    decision: 'p622 D8',
    anchor: TIERS,
  },
  // Phase 5: the kernel's reshapes
  ...['createMeshEntity', 'createCameraEntity', 'createGroupEntity', 'createLightEntity'].map(
    (name) => creator('aekasha', name)
  ),
  creator('aekasha/lines', 'createLineEntity'),
  {
    kind: 'reshape',
    id: 'reshape:createEntity',
    callee: { entry: 'aekasha', name: 'createEntity' },
    params: ['opts', 'world'],
    args: [OPTS_WITH_WORLD],
    newArgCount: 1,
    decision: 'p622 D4',
    anchor: CREATORS,
  },
  {
    kind: 'reshape',
    id: 'reshape:getScene',
    callee: { entry: 'aekasha', name: 'getScene' },
    params: ['id', 'silent', 'throwOnError'],
    args: [
      { param: 'id' },
      {
        props: [
          { key: 'silent', param: 'silent' },
          { key: 'throwOnError', param: 'throwOnError' },
        ],
      },
    ],
    newArgCount: 2,
    oldType: { index: 1, type: 'boolean' },
    decision: 'p622 D4',
    anchor: SCENES,
  },
  {
    kind: 'reshape',
    id: 'reshape:createSceneLoader',
    callee: { entry: 'aekasha', name: 'createSceneLoader' },
    params: ['sceneLoader', 'isCurrent'],
    args: [{ param: 'sceneLoader' }, { props: [{ key: 'isCurrent', param: 'isCurrent' }] }],
    newArgCount: 2,
    oldType: { index: 1, type: 'boolean' },
    decision: 'p622 D4',
    anchor: SCENES,
  },
  {
    kind: 'reshape',
    id: 'reshape:setLightEnabled',
    callee: { entry: 'aekasha', name: 'setLightEnabled' },
    params: ['lightId', 'enabled', 'world'],
    args: [{ param: 'world' }, { param: 'lightId' }, { param: 'enabled' }],
    newArgCount: 3,
    // The world's type has it, the light's id doesn't
    newHas: { index: 0, member: 'addComponent' },
    decision: 'p622 D4',
    anchor: LIGHTS,
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
