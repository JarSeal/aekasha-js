import fs from 'node:fs';
import path from 'node:path';
import type MarkdownIt from 'markdown-it';
import { listSourceFiles } from '../../files';
import { ROOT, SRC_DIR } from '../../paths';
import { renderMarkdownText, type HubMarkdownEnv } from '../markdown';
import type { HubGeneratedSection } from './section';

/**
 * The component library's "Used by" lists (p802 D9), on the dev page
 * `project/aekasha/components/`: for each UI kit piece, the files outside the kit that call its
 * functions, read from `src/` when the Hub builds, so the page never lists a user by hand. The
 * pieces' states, notes and demos are the page's Markdown and `hub/_assets/ts/_components.ts`.
 *
 * The dev plugin watches the files found, so an edit to a user rebuilds the page; a new user in
 * another file shows on the next rebuild (watching all of `src/` would rebuild the Hub on every
 * engine save).
 */

export const COMPONENTS_SECTION_PATH = 'project/aekasha/components/';

const KIT_DIR = path.join(SRC_DIR, '_engine', 'ui');
const GENERATED_DIR = path.join(SRC_DIR, 'generated');

/** Each piece's slot and the kit functions that use it */
export const COMPONENT_USES = [
  {
    slot: 'generated-components-window',
    calls: [
      'openDraggableWindow',
      'toggleDraggableWindow',
      'registerDraggableWindow',
      'registerDraggableWindowKind',
    ],
  },
  { slot: 'generated-components-dialog', calls: ['openDialog'] },
  { slot: 'generated-components-drop-down', calls: ['createDropDown'] },
  { slot: 'generated-components-select-field', calls: ['createSelectField'] },
  { slot: 'generated-components-number-field', calls: ['createNumberField'] },
  { slot: 'generated-components-slider', calls: ['createSlider'] },
  { slot: 'generated-components-range-slider', calls: ['createRangeSlider'] },
  {
    slot: 'generated-components-radio-group',
    calls: ['createRadioGroup', 'createSegmentedControl'],
  },
  { slot: 'generated-components-text-field', calls: ['createTextField'] },
  { slot: 'generated-components-checkbox', calls: ['createCheckbox', 'createSwitch'] },
  {
    slot: 'generated-components-color-field',
    calls: ['createColorField', 'setRecentColors', 'getRecentColors', 'onRecentColorsChange'],
  },
  { slot: 'generated-components-monitor', calls: ['createMonitor'] },
  { slot: 'generated-components-folder', calls: ['createFolder'] },
  { slot: 'generated-components-fieldset', calls: ['createFieldset'] },
  { slot: 'generated-components-property-grid', calls: ['createPropertyGrid'] },
  { slot: 'generated-components-form', calls: ['createForm'] },
  { slot: 'generated-components-tooltip', calls: ['createTooltip'] },
  { slot: 'generated-components-popover', calls: ['createPopover'] },
  { slot: 'generated-components-toaster', calls: ['createToaster', 'addToast'] },
  { slot: 'generated-components-icons', calls: ['getSvgIcon', 'registerIcon'] },
  { slot: 'generated-components-button', calls: ['createButton'] },
  { slot: 'generated-components-button-group', calls: ['createButtonGroup'] },
  { slot: 'generated-components-link', calls: ['createLink'] },
  { slot: 'generated-components-menu', calls: ['createMenu', 'createSplitButton'] },
  { slot: 'generated-components-badge', calls: ['createBadge'] },
  { slot: 'generated-components-tag', calls: ['createTag'] },
  { slot: 'generated-components-spinner', calls: ['createSpinner'] },
  { slot: 'generated-components-progress-bar', calls: ['createProgressBar'] },
  { slot: 'generated-components-skeleton', calls: ['createSkeleton'] },
  { slot: 'generated-components-divider', calls: ['createDivider'] },
  { slot: 'generated-components-empty-state', calls: ['createEmptyState'] },
  { slot: 'generated-components-loading-overlay', calls: ['createLoadingOverlay'] },
  { slot: 'generated-components-kbd', calls: ['createKbd'] },
  { slot: 'generated-components-input-glyph', calls: ['createInputGlyph'] },
] as const;

/** Where a user is, in the order the lists show them */
const GROUPS = ['Debug tools', 'Engine', 'Toolkit', 'App'] as const;
type UserGroup = (typeof GROUPS)[number];

/** A user's group, by its path from the repo root */
export const getUserGroup = (file: string): UserGroup => {
  if (!file.startsWith('src/_engine/')) return file.startsWith('src/toolkit/') ? 'Toolkit' : 'App';
  return /\/debug\/|\/_dbg__/.test(file) ? 'Debug tools' : 'Engine';
};

/** Each piece's users: the files (from the repo root) whose code calls one of its functions */
export const findComponentUsers = (readFile: (file: string) => string = readSource) => {
  const files = listSourceFiles(SRC_DIR)
    .map((file) => path.join(SRC_DIR, file))
    .filter(
      (file) =>
        file.endsWith('.ts') &&
        !file.endsWith('.test.ts') &&
        !file.startsWith(KIT_DIR + path.sep) &&
        !file.startsWith(GENERATED_DIR + path.sep)
    );
  const sources = files.map((file) => ({
    file: path.relative(ROOT, file).split(path.sep).join('/'),
    source: readFile(file),
  }));
  return new Map(
    COMPONENT_USES.map(({ slot, calls }) => {
      const regex = new RegExp(`\\b(?:${calls.join('|')})\\(`);
      return [slot, sources.filter(({ source }) => regex.test(source)).map(({ file }) => file)];
    })
  );
};

const readSource = (file: string) => fs.readFileSync(file, 'utf8');

/** A piece's "Used by" list, each user a checked `repo:` link under its group */
const renderUsers = (users: string[], md: MarkdownIt, env: HubMarkdownEnv) => {
  const lines = GROUPS.flatMap((group) => {
    const inGroup = users.filter((file) => getUserGroup(file) === group).sort();
    if (!inGroup.length) return [];
    const links = inGroup.map((file) => `[\`${path.basename(file)}\`](repo:${file})`);
    return [`- **${group}:** ${links.join(', ')}`];
  });
  const text = lines.length
    ? `**Used by** (read from \`src/\` when the Hub builds):\n\n${lines.join('\n')}\n`
    : '**Used by:** nothing outside the kit yet.\n';
  return renderMarkdownText(md, text, path.join(KIT_DIR, 'index.ts'), env);
};

/** The component library's section: each piece's users */
export const createComponentsSection = (): HubGeneratedSection => {
  const users = findComponentUsers();
  return {
    path: COMPONENTS_SECTION_PATH,
    slots: Object.fromEntries(
      COMPONENT_USES.map(({ slot }) => [
        slot,
        (md: MarkdownIt, env: HubMarkdownEnv) => renderUsers(users.get(slot) ?? [], md, env),
      ])
    ),
    pages: [],
    files: [...new Set([...users.values()].flat())].map((file) => path.join(ROOT, file)),
    dirs: [],
  };
};
