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

export type Engine6Rule = ImportRule;

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
const TOOLKIT = 'toolkit-3-0-0';

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
  {
    kind: 'import',
    id: 'move:createSeededRandom',
    from: { entry: 'aekasha/toolkit/geometry', name: 'createSeededRandom' },
    to: { entry: 'aekasha', name: 'createSeededRandom' },
    decision: 'p620 D5',
    anchor: TOOLKIT,
  },
];
