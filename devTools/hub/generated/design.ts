import fs from 'node:fs';
import path from 'node:path';
import type MarkdownIt from 'markdown-it';
import {
  CONTRAST_CONTROLS,
  CONTRAST_SERIES,
  CONTRAST_SERIES_SURFACES,
  CONTRAST_SOFTS,
  CONTRAST_SURFACES,
  CONTRAST_TEXTS,
  CONTRAST_UNCHECKED,
  findTokenRules,
  listContrastPairs,
  parseTokenColor,
  parseTokenSheet,
  type ContrastPair,
  type TokenColor,
} from '../../../src/_engine/ui/styles/TokenSheet';
import { SRC_DIR } from '../../paths';
import type { HubDiagnostics } from '../diagnostics';
import { escapeHtml } from '../html';
import { toInlineSvg } from '../icons';
import { renderMarkdownText, type HubMarkdownEnv } from '../markdown';
import type { HubGeneratedSection } from './section';

/**
 * Ækasha's design document's tables (p802 D8), on the dev page `project/aekasha/design/`: read
 * from the UI kit's `tokens.css` (and `fonts.css`' opt-in), never written by hand, so the page
 * shows what the kit ships. Each colour role's swatch and value in both themes, the contrast of
 * every pair `Tokens.test.ts` checks (the same computation, `TokenSheet.ts`), the type, space,
 * radius, shadow, layer, motion and focus tokens with the compact density's values beside the
 * defaults, and the built-in icons (`BuiltInIcons.ts`). The prose around them is the page's
 * Markdown. A token in no table warns, so a new one can't go missing from the page.
 */

export const DESIGN_SECTION_PATH = 'project/aekasha/design/';

const STYLES_DIR = path.join(SRC_DIR, '_engine', 'ui', 'styles');
const TOKENS_FILE = path.join(STYLES_DIR, 'tokens.css');
const FONTS_FILE = path.join(SRC_DIR, '_engine', 'ui', 'fonts', 'fonts.css');
const ICONS_DIR = path.join(SRC_DIR, '_engine', 'ui', 'core', 'icons');
const BUILT_IN_ICONS_FILE = path.join(ICONS_DIR, 'BuiltInIcons.ts');

/** The page's generated slots, by the table group they show */
const SLOTS = {
  colours: 'generated-design-colours',
  type: 'generated-design-type',
  space: 'generated-design-space',
  elevation: 'generated-design-elevation',
  motion: 'generated-design-motion',
  icons: 'generated-design-icons',
  focus: 'generated-design-focus',
} as const;

/** `export { default as gearIcon } from './svg/gear-fill.svg?raw';` */
const ICON_EXPORT_REGEX =
  /^export \{ default as (\w+)Icon \} from '\.\/svg\/([\w-]+\.svg)\?raw';$/gm;

type Decls = Map<string, string>;

/** The tokens read once per build, or the reason they couldn't be */
export type DesignTokens = {
  root: Decls;
  /** `@supports`' computed units (`--aek-base`, `--aek-rem`) */
  computed: Decls;
  compact: Decls;
  dark: Decls;
  light: Decls;
  /** `fonts.css`' opt-in: the font tokens with IBM Plex in front */
  fonts: Decls;
};

type BuiltInIcon = { name: string; file: string; svg: string };

const toLine = (text: string, needle: string) => {
  const index = text.split('\n').findIndex((line) => line.includes(needle));
  return index < 0 ? undefined : index + 1;
};

const readTokens = (diag: HubDiagnostics): DesignTokens | null => {
  try {
    const text = fs.readFileSync(TOKENS_FILE, 'utf8');
    const sheet = parseTokenSheet(text);
    const rules = findTokenRules(sheet);
    const computed = sheet.rules.find(
      (rule) =>
        rule.selector === ':where(.aekUi)' && rule.context.some((c) => c.startsWith('@supports'))
    );
    const fontsSheet = parseTokenSheet(fs.readFileSync(FONTS_FILE, 'utf8'));
    const tokens: DesignTokens = {
      root: rules.kitRoot.decls,
      computed: computed?.decls ?? new Map(),
      compact: rules.compact.decls,
      dark: rules.dark.decls,
      light: rules.lightSystem.decls,
      fonts: fontsSheet.rules.find((rule) => rule.selector === '.aekUi')?.decls ?? new Map(),
    };
    for (const name of findUnshownTokens(tokens)) {
      diag.warn(
        TOKENS_FILE,
        toLine(text, `${name}:`),
        `${name} is in no table of the design document: give its prefix a group in devTools/hub/generated/design.ts`
      );
    }
    return tokens;
  } catch (error) {
    diag.error(TOKENS_FILE, undefined, `The design document can't read it: ${String(error)}`);
    return null;
  }
};

const readIcons = (diag: HubDiagnostics): BuiltInIcon[] => {
  const source = fs.readFileSync(BUILT_IN_ICONS_FILE, 'utf8');
  return [...source.matchAll(ICON_EXPORT_REGEX)].flatMap(([line, name, file]) => {
    const svgFile = path.join(ICONS_DIR, 'svg', file);
    const svg = fs.existsSync(svgFile)
      ? toInlineSvg(`aek-${name}`, fs.readFileSync(svgFile, 'utf8'))
      : null;
    if (!svg) {
      diag.warn(BUILT_IN_ICONS_FILE, toLine(source, line), `No <svg> in svg/${file}`);
      return [];
    }
    return [{ name, file, svg }];
  });
};

// The groups: each token's table, by its name (`--aek-` left out)
const TYPE_PREFIXES = ['font-', 'line-height-', 'numeric-', 'icon-size-'];
/** A delay (`--aek-tooltip-delay`): in the motion section, but not scaled by `--aek-motion` */
const isDelay = (role: string) => role.endsWith('-delay');
const isFocusSize = (role: string) => role === 'focus-ring-width' || role === 'focus-ring-offset';
const ROOT_GROUPS: [string, (role: string) => boolean][] = [
  ['type', (role) => TYPE_PREFIXES.some((prefix) => role.startsWith(prefix))],
  ['space', (role) => role.startsWith('space-') || role === 'base' || role === 'rem'],
  ['elevation', (role) => role.startsWith('radius-') || role.startsWith('z-')],
  ['motion', (role) => role.startsWith('motion-') || role.startsWith('ease-') || isDelay(role)],
  ['focus', isFocusSize],
];

const roleOf = (name: string) => name.slice('--aek-'.length);
const customProps = (decls: Decls) => [...decls.keys()].filter((name) => name.startsWith('--aek-'));

/** The tokens no table shows: a kit root token in no group (every theme token is shown) */
export const findUnshownTokens = (tokens: DesignTokens) =>
  customProps(tokens.root).filter(
    (name) => !ROOT_GROUPS.some(([, isInGroup]) => isInGroup(roleOf(name)))
  );

/** A token's px at the defaults: `calc(var(--aek-base) * 12 / 14)` → 12, `var(--aek-base)` → 14 */
const toBasePx = (value: string | undefined) => {
  if (value === 'var(--aek-base)') return 14;
  const match = value?.match(/^calc\(var\(--aek-base\) \* (\d+(?:\.\d+)?) \/ 14\)$/);
  return match ? Number(match[1]) : null;
};

/** `calc(120ms * var(--aek-motion, 1))` → 120 */
const toMotionMs = (value: string | undefined) =>
  Number(value?.match(/^calc\((\d+)ms \* var\(--aek-motion, 1\)\)$/)?.[1] ?? NaN);

const code = (text: string) => `<code>${escapeHtml(text)}</code>`;
const px = (n: number | null) => (n === null ? '—' : `${n} px`);
const formatRgba = ([r, g, b, a]: TokenColor) =>
  `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)}${a < 1 ? ` / ${Math.round(a * 100)}%` : ''})`;

/** A theme token's colour as CSS (a `var()` resolved), or null for a value that isn't one */
const toCssColor = (value: string, decls: Decls) => {
  try {
    return value.startsWith('var(') ? formatRgba(parseTokenColor(value, decls)) : value;
  } catch {
    return null;
  }
};

/** A table in the Hub's frame: a caption, the header row's labels, the body's rows of cells */
const renderTable = (opts: {
  caption?: string;
  className?: string;
  head: string[];
  rows: string[][];
}) => `<div class="hubTable">
<table class="hubDesignTable${opts.className ? ` ${opts.className}` : ''}">
${opts.caption ? `<caption>${opts.caption}</caption>\n` : ''}<thead><tr>${opts.head.map((label) => `<th scope="col">${label}</th>`).join('')}</tr></thead>
<tbody>${opts.rows.map(([first, ...cells]) => `<tr><th scope="row">${first}</th>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('\n')}</tbody>
</table>
</div>
`;

const heading = (md: MarkdownIt, env: HubMarkdownEnv, text: string) =>
  renderMarkdownText(md, `### ${text}\n`, TOKENS_FILE, env);

const UNREAD = '<p>The tokens couldn&rsquo;t be read: see the build&rsquo;s errors.</p>\n';

// Colours

/** What the contrast rule says about a theme role */
const describeRule = (role: string) => {
  if (CONTRAST_SURFACES.includes(role)) return 'A surface';
  if (CONTRAST_TEXTS.includes(role)) return 'Text, 4.5:1 on every surface';
  if (CONTRAST_CONTROLS.includes(role)) return 'A control’s edge, 3:1 on every surface';
  if (CONTRAST_SERIES.includes(role)) {
    return `A chart series, 3:1 on ${CONTRAST_SERIES_SURFACES.map(code).join(' and ')}`;
  }
  if (role === 'on-accent') return 'Text on the accent, 4.5:1';
  const soft = role.match(/^(.+)-soft$/)?.[1];
  if (soft && CONTRAST_SOFTS.includes(soft)) {
    return `A tint: <code>text</code> and <code>${soft}</code> on it, 4.5:1`;
  }
  return CONTRAST_UNCHECKED[role] ? `Not checked: ${CONTRAST_UNCHECKED[role]}` : '—';
};

/** A swatch over its theme's surface (so a tint shows as it's used) and the value */
const renderSwatch = (value: string, decls: Decls) => {
  const color = toCssColor(value, decls);
  const surface = decls.get('--aek-surface') ?? 'transparent';
  const swatch = color
    ? `<span class="hubSwatch" style="--hub-swatch: ${escapeHtml(color)}; --hub-swatch-bg: ${escapeHtml(surface)}"></span>`
    : '';
  return `<span class="hubSwatchCell">${swatch}${code(value)}</span>`;
};

/** A pair's sample: text in its colour, a control's edge, or a series' bar */
const getSampleKind = (role: string) =>
  CONTRAST_CONTROLS.includes(role) ? 'control' : CONTRAST_SERIES.includes(role) ? 'series' : null;

const renderContrastCell = (pair: ContrastPair | undefined, fg: string, bg: string) => {
  if (!pair) return '—';
  const kind = getSampleKind(pair.fg);
  const style =
    kind === 'control'
      ? `border-color: ${fg}; background: ${bg}`
      : kind === 'series'
        ? `--hub-series: ${fg}; background: ${bg}`
        : `color: ${fg}; background: ${bg}`;
  const isLow = pair.ratio < pair.min;
  return `<span class="hubContrast${isLow ? ' hubContrast_low' : ''}"><span class="hubContrastSample${kind ? ` hubContrastSample_${kind}` : ''}" style="${escapeHtml(style)}" aria-hidden="true">${kind ? '' : 'Aa'}</span>${pair.ratio.toFixed(2)}${isLow ? ` <span class="hubStatus hubStatus_open">under ${pair.min}</span>` : ''}</span>`;
};

/** The pair's minimum ratio, under its name */
const renderMinimum = (min: number) => `<span class="hubContrastMin">at least ${min}:1</span>`;

const renderContrastTable = (theme: string, decls: Decls) => {
  const pairs = listContrastPairs(decls);
  const color = (role: string) => toCssColor(decls.get(`--aek-${role}`) ?? '', decls) ?? '';
  const find = (fg: string, bg: string) => pairs.find((p) => p.fg === fg && p.bg === bg);
  const rows = [...CONTRAST_TEXTS, ...CONTRAST_CONTROLS].map((fg) => [
    `${code(fg)}${renderMinimum(CONTRAST_CONTROLS.includes(fg) ? 3 : 4.5)}`,
    ...CONTRAST_SURFACES.map((bg) => renderContrastCell(find(fg, bg), color(fg), color(bg))),
  ]);
  return renderTable({
    caption: `${theme} theme`,
    className: 'hubContrastTable',
    head: ['Role', ...CONTRAST_SURFACES.map(code)],
    rows,
  });
};

/** `on-accent` on `accent`, and `text` and each status colour on its tint over `surface` */
const renderTintTable = (tokens: DesignTokens) => {
  const themes = [tokens.dark, tokens.light].map((decls) => ({
    decls,
    pairs: listContrastPairs(decls).filter(
      (pair) => pair.bg === 'accent' || pair.bg.endsWith('-soft over surface')
    ),
  }));
  const cell = (decls: Decls, pair: ContrastPair) => {
    const fg = toCssColor(decls.get(`--aek-${pair.fg}`) ?? '', decls) ?? '';
    const bgRole = pair.bg.replace(/ over surface$/, '');
    const bg = toCssColor(decls.get(`--aek-${bgRole}`) ?? '', decls) ?? '';
    // A tint is painted over the surface, as the pair computes it
    const surface = decls.get('--aek-surface') ?? '';
    const layered = bgRole.endsWith('-soft') ? `linear-gradient(${bg}, ${bg}), ${surface}` : bg;
    return renderContrastCell(pair, fg, layered);
  };
  const rows = themes[0].pairs.map((pair, i) => [
    `${code(pair.fg)} on ${code(pair.bg.replace(/ over surface$/, ''))}${renderMinimum(pair.min)}`,
    cell(themes[0].decls, pair),
    cell(themes[1].decls, themes[1].pairs[i]),
  ]);
  return renderTable({
    className: 'hubContrastTable',
    head: ['Pair', 'Dark', 'Light'],
    rows,
  });
};

/** Each chart series on the surfaces it's checked on, in both themes, in the series' order */
const renderSeriesTable = (tokens: DesignTokens) => {
  const themes = [tokens.dark, tokens.light].map((decls) => ({
    decls,
    pairs: listContrastPairs(decls).filter((pair) => CONTRAST_SERIES.includes(pair.fg)),
  }));
  const color = (decls: Decls, role: string) =>
    toCssColor(decls.get(`--aek-${role}`) ?? '', decls) ?? '';
  const rows = CONTRAST_SERIES.map((fg) => [
    `${code(fg)}${renderMinimum(3)}`,
    ...themes.flatMap(({ decls, pairs }) =>
      CONTRAST_SERIES_SURFACES.map((bg) =>
        renderContrastCell(
          pairs.find((pair) => pair.fg === fg && pair.bg === bg),
          color(decls, fg),
          color(decls, bg)
        )
      )
    ),
  ]);
  return renderTable({
    className: 'hubContrastTable',
    head: [
      'Series',
      ...['Dark', 'Light'].flatMap((theme) =>
        CONTRAST_SERIES_SURFACES.map((bg) => `${theme}, ${code(bg)}`)
      ),
    ],
    rows,
  });
};

const renderColours = (tokens: DesignTokens | null, md: MarkdownIt, env: HubMarkdownEnv) => {
  env.file = TOKENS_FILE;
  if (!tokens) return UNREAD;
  const roles = customProps(tokens.dark).filter((name) => !roleOf(name).startsWith('shadow-'));
  const rows = roles.map((name) => [
    code(name),
    renderSwatch(tokens.dark.get(name) ?? '', tokens.dark),
    renderSwatch(tokens.light.get(name) ?? '', tokens.light),
    describeRule(roleOf(name)),
  ]);
  return [
    heading(md, env, 'Roles'),
    renderTable({ className: 'hubColourTable', head: ['Token', 'Dark', 'Light', 'Rule'], rows }),
    heading(md, env, 'Contrast'),
    renderContrastTable('Dark', tokens.dark),
    renderContrastTable('Light', tokens.light),
    heading(md, env, 'On the accent and the tints'),
    renderTintTable(tokens),
    heading(md, env, 'Chart series'),
    renderSeriesTable(tokens),
  ].join('');
};

// Type, space, elevation, motion, focus

const rootTokens = (tokens: DesignTokens, isInGroup: (role: string) => boolean) =>
  customProps(tokens.root).filter((name) => isInGroup(roleOf(name)));

const renderType = (tokens: DesignTokens | null, md: MarkdownIt, env: HubMarkdownEnv) => {
  env.file = TOKENS_FILE;
  if (!tokens) return UNREAD;
  const families = rootTokens(
    tokens,
    (role) => role.startsWith('font-') && !/-(size|weight)-/.test(role)
  );
  const sizes = rootTokens(tokens, (role) => role.startsWith('font-size-'));
  const others = rootTokens(tokens, (role) => /^(font-weight|line-height|numeric)-/.test(role));
  const iconSizes = rootTokens(tokens, (role) => role.startsWith('icon-size-'));
  const sample = (style: string, text = 'Ækasha 0O 1lI 2468') =>
    `<span class="hubTypeSample" style="${escapeHtml(style)}">${text}</span>`;
  return [
    heading(md, env, 'Families'),
    renderTable({
      className: 'hubWrapTable',
      head: ['Token', 'Value', 'Sample'],
      rows: families.map((name) => [
        code(name),
        `${code(tokens.root.get(name) ?? '')}${
          tokens.fonts.has(name)
            ? `<span class="hubDesignNote">With <code>aekasha/ui/fonts</code>:</span>${code(tokens.fonts.get(name) ?? '')}`
            : ''
        }`,
        sample(`font-family: var(${name})`),
      ]),
    }),
    heading(md, env, 'Sizes'),
    renderTable({
      head: ['Token', 'Default', 'Compact', 'Sample'],
      rows: sizes.map((name) => {
        const size = toBasePx(tokens.root.get(name));
        return [
          code(name),
          px(size),
          px(toBasePx(tokens.compact.get(name))),
          size === null ? '—' : sample(`font-size: ${size}px`, 'The quick brown fox, 1234.5'),
        ];
      }),
    }),
    heading(md, env, 'Icon sizes'),
    renderTable({
      head: ['Token', 'Default', 'Compact', 'Sample'],
      rows: iconSizes.map((name) => {
        const size = toBasePx(tokens.root.get(name));
        return [
          code(name),
          px(size),
          px(toBasePx(tokens.compact.get(name))),
          size === null
            ? '—'
            : `<span class="hubIconSizeSample" style="width: ${size}px; height: ${size}px"></span>`,
        ];
      }),
    }),
    heading(md, env, 'Weights, line heights and figures'),
    renderTable({
      head: ['Token', 'Value', 'Sample'],
      rows: others.map((name) => {
        const value = tokens.root.get(name) ?? '';
        const role = roleOf(name);
        const style = role.startsWith('font-weight-')
          ? `font-weight: ${value}`
          : role.startsWith('numeric-')
            ? `font-variant-numeric: ${value}`
            : null;
        return [code(name), code(value), style ? sample(style, '1111.11 8888.88') : '—'];
      }),
    }),
  ].join('');
};

const renderSpace = (tokens: DesignTokens | null, md: MarkdownIt, env: HubMarkdownEnv) => {
  env.file = TOKENS_FILE;
  if (!tokens) return UNREAD;
  const units = rootTokens(tokens, (role) => role === 'base' || role === 'rem');
  const space = rootTokens(tokens, (role) => role.startsWith('space-'));
  const bar = (n: number | null) =>
    n === null ? '' : `<span class="hubSpaceBar" style="width: ${n}px"></span>`;
  return [
    heading(md, env, 'Units'),
    renderTable({
      className: 'hubWrapTable',
      head: ['Token', 'Without <code>@property</code>', 'Computed', 'Default'],
      rows: units.map((name) => [
        `${code(name)}${roleOf(name) === 'rem' ? ' <span class="hubStatus hubStatus_other">internal</span>' : ''}`,
        code(tokens.root.get(name) ?? ''),
        code(tokens.computed.get(name) ?? '—'),
        roleOf(name) === 'base' ? '14 px' : '10 px',
      ]),
    }),
    heading(md, env, 'Space'),
    renderTable({
      className: 'hubSpaceTable',
      head: ['Token', 'Default', 'Compact', ''],
      rows: space.map((name) => {
        const size = toBasePx(tokens.root.get(name));
        const compact = toBasePx(tokens.compact.get(name));
        return [code(name), px(size), px(compact), `${bar(size)}${bar(compact)}`];
      }),
    }),
  ].join('');
};

const renderElevation = (tokens: DesignTokens | null, md: MarkdownIt, env: HubMarkdownEnv) => {
  env.file = TOKENS_FILE;
  if (!tokens) return UNREAD;
  const radii = rootTokens(tokens, (role) => role.startsWith('radius-'));
  const layers = rootTokens(tokens, (role) => role.startsWith('z-'));
  const shadows = customProps(tokens.dark).filter((name) => roleOf(name).startsWith('shadow-'));
  // On its theme's background, the value beside it in the page's colours
  const shadowCell = (name: string, decls: Decls) => {
    const value = decls.get(name) ?? '';
    const stage = `background: ${decls.get('--aek-bg')}`;
    const sample = `box-shadow: ${value}; background: ${decls.get('--aek-surface-raised')}`;
    return `<span class="hubShadowCell"><span class="hubShadowStage" style="${escapeHtml(stage)}"><span class="hubShadowSample" style="${escapeHtml(sample)}"></span></span>${code(value)}</span>`;
  };
  return [
    heading(md, env, 'Radii'),
    renderTable({
      head: ['Token', 'Value', 'Sample'],
      rows: radii.map((name) => [
        code(name),
        code(tokens.root.get(name) ?? ''),
        `<span class="hubRadiusSample" style="border-radius: var(${name})"></span>`,
      ]),
    }),
    heading(md, env, 'Shadows'),
    renderTable({
      head: ['Token', 'Dark', 'Light'],
      rows: shadows.map((name) => [
        code(name),
        shadowCell(name, tokens.dark),
        shadowCell(name, tokens.light),
      ]),
    }),
    heading(md, env, 'Layers'),
    renderTable({
      head: ['Token', 'z-index'],
      rows: layers.map((name) => [code(name), code(tokens.root.get(name) ?? '')]),
    }),
  ].join('');
};

const renderMotion = (tokens: DesignTokens | null, md: MarkdownIt, env: HubMarkdownEnv) => {
  env.file = TOKENS_FILE;
  if (!tokens) return UNREAD;
  const durations = rootTokens(tokens, (role) => role.startsWith('motion-'));
  const easings = rootTokens(tokens, (role) => role.startsWith('ease-'));
  const delays = rootTokens(tokens, isDelay);
  // Hover or focus the row to play it: the token's own duration, so reduced motion stops it too
  const demo = (style: string) =>
    `<span class="hubMotionDemo" style="${escapeHtml(style)}" tabindex="0" role="img" aria-label="A dot that moves on hover or focus"><span></span></span>`;
  return [
    heading(md, env, 'Durations'),
    renderTable({
      className: 'hubMotionTable',
      head: ['Token', 'Default', 'Value', 'Hover to play'],
      rows: durations.map((name) => [
        code(name),
        `${toMotionMs(tokens.root.get(name))} ms`,
        code(tokens.root.get(name) ?? ''),
        demo(`--hub-motion-duration: var(${name}); --hub-motion-ease: var(--aek-ease-standard)`),
      ]),
    }),
    heading(md, env, 'Easings'),
    renderTable({
      className: 'hubMotionTable',
      head: ['Token', 'Value', 'Hover to play'],
      rows: easings.map((name) => [
        code(name),
        code(tokens.root.get(name) ?? ''),
        demo(`--hub-motion-duration: var(--aek-motion-slow); --hub-motion-ease: var(${name})`),
      ]),
    }),
    heading(md, env, 'Delays'),
    '<p>Waits before a piece shows, not motion: reduced motion keeps them.</p>\n',
    renderTable({
      className: 'hubMotionTable',
      head: ['Token', 'Value'],
      rows: delays.map((name) => [code(name), code(tokens.root.get(name) ?? '')]),
    }),
  ].join('');
};

const renderFocus = (tokens: DesignTokens | null, md: MarkdownIt, env: HubMarkdownEnv) => {
  env.file = TOKENS_FILE;
  if (!tokens) return UNREAD;
  const sizes = rootTokens(tokens, isFocusSize);
  return [
    heading(md, env, 'The focus ring'),
    renderTable({
      head: ['Token', 'Value'],
      rows: [
        ...sizes.map((name) => [code(name), code(tokens.root.get(name) ?? '')]),
        [
          code('--aek-focus-ring-color'),
          `${code(tokens.dark.get('--aek-focus-ring-color') ?? '')} (each theme's, in Colours)`,
        ],
      ],
    }),
    // Each in its theme (the attribute re-declares the tokens on the sample), the ring drawn as on focus
    '<p class="hubFocusSamples"><span class="hubFocusSample" data-aek-theme="dark">Dark</span><span class="hubFocusSample" data-aek-theme="light">Light</span></p>\n',
  ].join('');
};

const renderIcons = (icons: BuiltInIcon[], md: MarkdownIt, env: HubMarkdownEnv) => {
  env.file = BUILT_IN_ICONS_FILE;
  const items = icons.map(
    ({ name, file, svg }) =>
      `<li>${svg}<code>${escapeHtml(name)}</code><span class="hubIconFile">${escapeHtml(file)}</span></li>`
  );
  return `${renderMarkdownText(md, `### Built-in icons\n\n${icons.length} icons, by the name \`getSvgIcon\` takes, each with its file in \`src/_engine/ui/core/icons/svg/\`.\n`, BUILT_IN_ICONS_FILE, env)}<ul class="hubIconGrid">${items.join('')}</ul>\n`;
};

/** The design document's section: its tables from `tokens.css`, `fonts.css` and the icons */
export const createDesignSection = (diag: HubDiagnostics): HubGeneratedSection => {
  const tokens = readTokens(diag);
  const icons = readIcons(diag);
  const iconFiles = icons.map(({ file }) => path.join(ICONS_DIR, 'svg', file));
  return {
    path: DESIGN_SECTION_PATH,
    slots: {
      [SLOTS.colours]: (md, env) => renderColours(tokens, md, env),
      [SLOTS.type]: (md, env) => renderType(tokens, md, env),
      [SLOTS.space]: (md, env) => renderSpace(tokens, md, env),
      [SLOTS.elevation]: (md, env) => renderElevation(tokens, md, env),
      [SLOTS.motion]: (md, env) => renderMotion(tokens, md, env),
      [SLOTS.focus]: (md, env) => renderFocus(tokens, md, env),
      [SLOTS.icons]: (md, env) => renderIcons(icons, md, env),
    },
    pages: [],
    files: [TOKENS_FILE, FONTS_FILE, BUILT_IN_ICONS_FILE, ...iconFiles],
    dirs: [path.join(ICONS_DIR, 'svg')],
  };
};
