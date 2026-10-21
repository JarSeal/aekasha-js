import type MarkdownIt from 'markdown-it';
import type { Highlighter } from 'shiki';
import type { JSONOutput } from 'typedoc';
import { escapeHtml } from '../html';
import { renderMarkdownText, uniqueId, type HubMarkdownEnv } from '../markdown';
import {
  firstSentence,
  getBlockTags,
  hasBlockTag,
  hasModifierTag,
  partsToMarkdown,
  tagLabel,
  toInlineCode,
  type CommentLinkResolver,
  type CommentParts,
  type InlineTagPart,
} from './comments';
import type { ApiLinks } from './links';
import type { PublicApi, PublicSymbol } from './publicApi';
import {
  getOwnMembers,
  isDocumented,
  Kind,
  type ApiIndex,
  type ApiModule,
  type ApiTarget,
  type Comment,
  type Coverage,
  type DeclarationReflection,
  type SignatureReflection,
  type SomeType,
} from './model';
import {
  CodeWriter,
  getObjectMembers,
  getTabledMembers,
  getTabledVariants,
  MEMBER_POSITION_PREFIX,
  printHeritage,
  printSignature,
  printTypeAlias,
  printTypeOnly,
  printVariable,
  renderCodeBlock,
  renderInlineCode,
  type TargetHref,
} from './signature';

/**
 * One export of the API pages (p619 R4, from `render.ts`): its heading and anchor, its signature
 * highlighted by shiki with its types linked, its comment through markdown-it, tables for its
 * parameters, properties and members, and its source link. With what the pages and the search
 * share: the render context (`Ctx`), the links from the page being rendered, the coverage bar
 * and the summaries.
 */

/** A comment's own headings (`# Usage`) start at h4: under the symbol, out of the TOC */
const COMMENT_HEADING_OFFSET = 3;
/** Object literal types are shown as nested rows (`props.mesh.castShadow`) this deep */
const MAX_ROW_DEPTH = 3;

// --- Render context ---

export type SourceLink = (source: JSONOutput.SourceReference) => string;

export type Ctx = {
  index: ApiIndex;
  api: PublicApi;
  links: ApiLinks;
  highlighter: Highlighter;
  md: MarkdownIt;
  env: HubMarkdownEnv;
  /** The file the comments being rendered are from (their diagnostics) */
  file: string;
  sourceLink: SourceLink;
};

/** The shortest relative URL between two site paths: `../physics/`, `aekasha/scene/` */
const relativeUrl = (from: string, to: string) => {
  const fromParts = from.split('/').filter(Boolean);
  const toParts = to.split('/').filter(Boolean);
  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common] === toParts[common]
  ) {
    common++;
  }
  const up = '../'.repeat(fromParts.length - common);
  return (
    up +
      toParts
        .slice(common)
        .map((part) => `${part}/`)
        .join('') || './'
  );
};

/** A page of the section from the page being rendered, `#anchor` on the page itself */
export const href = (ctx: Ctx, pagePath: string, anchor = '') => {
  if (pagePath === ctx.env.page.path) return `#${anchor}`;
  return `${relativeUrl(ctx.env.page.path, pagePath)}${anchor ? `#${anchor}` : ''}`;
};

const targetHref = (ctx: Ctx, target: ApiTarget) => href(ctx, target.pagePath, target.anchor);

/** A type in a signature or a table links its symbol (or its nearest owner with an anchor) */
const typeHref =
  (ctx: Ctx): TargetHref =>
  (id) => {
    const target = ctx.links.resolveId(id);
    return target && targetHref(ctx, target);
  };

/** Another package's symbol (three's), which stays text */
export const isForeignTarget = (index: ApiIndex, part: InlineTagPart) =>
  typeof part.target === 'object' && part.target.packageName !== index.project.packageName;

/**
 * A `{@link}`'s target: the reflection TypeDoc resolved it to, or a name in this package it
 * found no reflection for (not exported, or another file's), looked up like an `api:` link
 */
export const resolveCommentLink = (index: ApiIndex, links: ApiLinks, part: InlineTagPart) => {
  const { target } = part;
  if (typeof target === 'number') return links.resolveId(target);
  if (typeof target !== 'object' || isForeignTarget(index, part)) return undefined;
  const result = links.resolveName(target.qualifiedName);
  return result.isOk ? result.target : undefined;
};

export const commentLinks =
  (ctx: Ctx): CommentLinkResolver =>
  (part) => {
    if (typeof part.target === 'string') return part.target; // `{@link https://…}`
    const target = resolveCommentLink(ctx.index, ctx.links, part);
    return target && targetHref(ctx, target);
  };

/** A comment's parts as Markdown, its `{@link}`s linked from the page being rendered */
const commentMarkdown = (ctx: Ctx, parts: CommentParts) =>
  partsToMarkdown(parts, commentLinks(ctx));

/** JSDoc is text, not markup: `Array<Mesh>` in a comment is no tag */
const withoutHtml = <T>(md: MarkdownIt, fn: () => T) => {
  const html = md.options.html;
  md.set({ html: false });
  try {
    return fn();
  } finally {
    md.set({ html });
  }
};

/**
 * Comment Markdown as blocks. `line` (the symbol's) offsets it, so a diagnostic points near the
 * comment in its source file.
 */
const renderBlock = (ctx: Ctx, markdown: string, line = 1) => {
  if (!markdown.trim()) return '';
  const text = '\n'.repeat(Math.max(0, line - 1)) + markdown;
  return withoutHtml(ctx.md, () =>
    renderMarkdownText(ctx.md, text, ctx.file, ctx.env, COMMENT_HEADING_OFFSET)
  );
};

export const renderInline = (ctx: Ctx, markdown: string) => {
  if (!markdown.trim()) return '';
  ctx.env.file = ctx.file;
  return withoutHtml(ctx.md, () => ctx.md.renderInline(markdown, ctx.env));
};

export const heading = (
  ctx: Ctx,
  level: number,
  id: string,
  text: string,
  inner = escapeHtml(text)
) => {
  ctx.env.headings.push({ level, id, text });
  return `<h${level} id="${escapeHtml(id)}">${inner} <a class="hubAnchor" href="#${escapeHtml(id)}" aria-label="Link to this section">#</a></h${level}>\n`;
};

/** A heading with an id the model gave (a symbol's or a member's anchor) */
const anchorHeading = (ctx: Ctx, level: number, anchor: string, text: string, inner: string) => {
  ctx.env.ids.add(anchor);
  return heading(ctx, level, anchor, text, inner);
};

export const sectionHeading = (ctx: Ctx, title: string, id: string) =>
  heading(ctx, 2, uniqueId(ctx.env, id), title);

const inlineType = (ctx: Ctx, type: SomeType | undefined, collapseObjects = false) =>
  renderInlineCode(ctx.highlighter, printTypeOnly(type, { collapseObjects }), typeHref(ctx));

const codeBlock = (ctx: Ctx, w: CodeWriter, prefix?: string) =>
  renderCodeBlock(ctx.highlighter, w, typeHref(ctx), prefix);

// --- Coverage and summaries ---

const percent = ({ documented, total }: Coverage) =>
  total ? Math.round((documented / total) * 100) : 100;

export const renderCoverage = (coverage: Coverage) => {
  const value = percent(coverage);
  const label = `${value}% documented: ${coverage.documented} of ${coverage.total} exports`;
  return `<span class="hubApiCoverage" title="${label}"><span class="hubApiCoverageBar" style="--hub-api-coverage: ${value}%" aria-hidden="true"></span><span class="hubApiCoverageText">${coverage.documented}/${coverage.total}</span><span class="hubVisuallyHidden"> exports documented</span></span>`;
};

export const symbolSummary = (symbol: DeclarationReflection) =>
  symbol.comment?.summary.length
    ? symbol.comment.summary
    : symbol.signatures?.find((signature) => signature.comment?.summary.length)?.comment?.summary;

/** Functions and classes say what a module is for; its types and constants describe them */
const SUMMARY_KINDS: number[] = [Kind.Function, Kind.Class];

/**
 * A module's one line: its `@module` comment's first sentence, else its first documented function
 * or class's (by source line), else its first documented export's, of `symbols` (its public
 * ones). Its `{@link}`s are code unless `resolveLink` links them.
 */
export const getModuleSummary = (
  module: ApiModule,
  symbols: DeclarationReflection[],
  resolveLink?: CommentLinkResolver
) => {
  if (module.reflection.comment?.summary.length) {
    return firstSentence(partsToMarkdown(module.reflection.comment.summary, resolveLink));
  }
  const documented = symbols
    .filter((symbol) => symbolSummary(symbol))
    .sort((a, b) => (a.sources?.[0]?.line ?? 0) - (b.sources?.[0]?.line ?? 0));
  const first = documented.find((symbol) => SUMMARY_KINDS.includes(symbol.kind)) ?? documented[0];
  return first ? firstSentence(partsToMarkdown(symbolSummary(first), resolveLink)) : '';
};

/** Markdown to plain text, for `<meta name="description">` and the search's snippets */
export const toPlainText = (markdown: string) =>
  markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

// --- Comments ---

/** Tags shown in their own place, not in the list of other tags */
const PLACED_TAGS = ['@returns', '@example', '@see', '@remarks', '@deprecated', '@param'];
const DEFAULT_TAGS = ['@default', '@defaultValue'];

/** A public type's member that isn't public API: shown, with a badge (p619 R2 skips it) */
const isInternal = (member: DeclarationReflection) =>
  hasModifierTag(member.comment, '@internal') ||
  !!member.signatures?.some((signature) => hasModifierTag(signature.comment, '@internal'));

const isDeprecated = (symbol: DeclarationReflection) =>
  hasBlockTag(symbol.comment, '@deprecated') ||
  !!symbol.signatures?.some((signature) => hasBlockTag(signature.comment, '@deprecated'));

/** `Default: \`5\``, from `@default` / `@defaultValue` or a parameter's default value */
const renderDefault = (ctx: Ctx, comment: Comment | undefined, defaultValue?: string) => {
  const tag = (comment?.blockTags ?? []).find((block) => DEFAULT_TAGS.includes(block.tag));
  const value = tag
    ? commentMarkdown(ctx, tag.content).trim()
    : defaultValue && defaultValue !== '...'
      ? toInlineCode(defaultValue)
      : '';
  return value
    ? `<p class="hubApiDefault"><span class="hubApiLabel">Default</span> ${renderInline(ctx, value)}</p>`
    : '';
};

/** A comment's text: the deprecation, the summary and `@remarks` */
const renderCommentHead = (ctx: Ctx, comment: Comment | undefined, line?: number) => {
  if (!comment) return '';
  let html = '';
  for (const tag of getBlockTags(comment, '@deprecated')) {
    const note = commentMarkdown(ctx, tag.content);
    html += `<aside class="hubCallout hubCallout_warning"><p class="hubCalloutTitle">Deprecated</p>${renderBlock(ctx, note, line)}</aside>\n`;
  }
  html += renderBlock(ctx, commentMarkdown(ctx, comment.summary), line);
  for (const tag of getBlockTags(comment, '@remarks')) {
    html += renderBlock(ctx, commentMarkdown(ctx, tag.content), line);
  }
  return html;
};

/** The rest of a comment: its other tags, then examples and `@see` */
const renderCommentTail = (ctx: Ctx, comment: Comment | undefined, line?: number) => {
  if (!comment) return '';
  let html = '';
  for (const tag of comment.blockTags ?? []) {
    if (PLACED_TAGS.includes(tag.tag) || DEFAULT_TAGS.includes(tag.tag)) continue;
    html += `<div class="hubApiTag"><p class="hubApiLabel">${escapeHtml(tagLabel(tag.tag))}</p>${renderBlock(ctx, commentMarkdown(ctx, tag.content), line)}</div>\n`;
  }
  for (const tag of getBlockTags(comment, '@example')) {
    html += `<div class="hubApiTag"><p class="hubApiLabel">Example</p>${renderBlock(ctx, commentMarkdown(ctx, tag.content), line)}</div>\n`;
  }
  const sees = getBlockTags(comment, '@see');
  if (sees.length) {
    const items = sees.map(
      (tag) => `<li>${renderInline(ctx, commentMarkdown(ctx, tag.content).trim())}</li>`
    );
    html += `<div class="hubApiTag"><p class="hubApiLabel">See</p><ul>${items.join('')}</ul></div>\n`;
  }
  return html;
};

/** The comment in a table cell: its summary, `@remarks`, default and deprecation */
const renderCellComment = (ctx: Ctx, comment: Comment | undefined, defaultValue?: string) => {
  const html = renderCommentHead(ctx, comment) + renderDefault(ctx, comment, defaultValue);
  return html || '<span class="hubApiNone" aria-label="No description">—</span>';
};

// --- Tables ---

type Row = { name: string; badges: string[]; type: string; description: string };

const badge = (text: string, kind = '') =>
  `<span class="hubApiBadge${kind ? ` hubApiBadge_${kind}` : ''}">${escapeHtml(text)}</span>`;

const renderTable = (first: string, rows: Row[], label: string) => {
  if (!rows.length) return '';
  const body = rows.map(
    (row) =>
      `<tr><td><code class="hubApiMember">${escapeHtml(row.name)}</code>${row.badges.join('')}</td><td>${row.type}</td><td>${row.description}</td></tr>`
  );
  return `<p class="hubApiLabel">${escapeHtml(label)}</p>
<div class="hubTable hubApiTable"><table><thead><tr><th scope="col">${first}</th><th scope="col">Type</th><th scope="col">Description</th></tr></thead><tbody>${body.join('')}</tbody></table></div>\n`;
};

/** An object literal type's members, or an array of one's (`items[].id`) */
const nestedMembers = (type: SomeType | undefined, name: string) => {
  const members = getObjectMembers(type);
  if (members.length) return { members, prefix: `${name}.` };
  if (type?.type === 'array') {
    const items = getObjectMembers(type.elementType);
    if (items.length) return { members: items, prefix: `${name}[].` };
  }
  return null;
};

/** A member's type: a method's as a function type, an accessor's from its signatures */
const memberType = (member: DeclarationReflection): SomeType | undefined => {
  if (member.signatures?.length) {
    return { type: 'reflection', declaration: { ...member, children: undefined } };
  }
  if (member.kind === Kind.Accessor) {
    return member.getSignature?.type ?? member.setSignature?.parameters?.[0]?.type;
  }
  return member.type;
};

/** Rows for members, with an object literal's members as nested rows (`props.mesh`) */
const memberRows = (ctx: Ctx, members: DeclarationReflection[], prefix = '', depth = 1): Row[] =>
  members.flatMap((member) => {
    const type = memberType(member);
    const name = `${prefix}${member.name}`;
    const nested = depth < MAX_ROW_DEPTH ? nestedMembers(type, name) : null;
    const badges = [
      member.flags.isOptional && badge('optional'),
      member.flags.isReadonly && badge('readonly'),
      member.flags.isStatic && badge('static'),
      member.getSignature && badge('get'),
      member.setSignature && badge('set'),
      member.flags.isProtected && badge('protected'),
      isDeprecated(member) && badge('deprecated', 'deprecated'),
      isInternal(member) && badge('internal'),
    ].filter((b): b is string => !!b);
    const comment =
      member.comment ??
      member.signatures?.[0]?.comment ??
      member.getSignature?.comment ??
      member.setSignature?.comment;
    const row: Row = {
      name,
      badges,
      type: inlineType(ctx, type, !!nested),
      description: renderCellComment(ctx, comment, member.defaultValue),
    };
    return [row, ...(nested ? memberRows(ctx, nested.members, nested.prefix, depth + 1) : [])];
  });

const indexRows = (ctx: Ctx, declaration: DeclarationReflection): Row[] =>
  (declaration.indexSignatures ?? []).map((index) => {
    const [key] = index.parameters ?? [];
    const keyType = printTypeOnly(key?.type).text;
    return {
      name: `[${key?.name ?? 'key'}: ${keyType}]`,
      badges: [],
      type: inlineType(ctx, index.type),
      description: renderCellComment(ctx, index.comment),
    };
  });

const parameterRows = (ctx: Ctx, parameters: JSONOutput.ParameterReflection[]): Row[] =>
  parameters.flatMap((parameter) => {
    const name = `${parameter.flags.isRest ? '...' : ''}${parameter.name}`;
    const nested = nestedMembers(parameter.type, parameter.name);
    const row: Row = {
      name,
      badges: [
        (parameter.flags.isOptional || parameter.defaultValue !== undefined) && badge('optional'),
      ].filter((b): b is string => !!b),
      type: inlineType(ctx, parameter.type, !!nested),
      description: renderCellComment(ctx, parameter.comment, parameter.defaultValue),
    };
    return [row, ...(nested ? memberRows(ctx, nested.members, nested.prefix, 2) : [])];
  });

const typeParameterRows = (
  ctx: Ctx,
  typeParameters: JSONOutput.TypeParameterReflection[] | undefined
): Row[] =>
  (typeParameters ?? []).some((tp) => tp.comment)
    ? (typeParameters ?? []).map((tp) => ({
        name: tp.name,
        badges: [],
        type: tp.type ? inlineType(ctx, tp.type) : '',
        description: renderCellComment(ctx, tp.comment),
      }))
    : [];

/** `Promise<T>`'s `T`, for the rows of a returned object literal */
const unwrapPromise = (type: SomeType | undefined) =>
  type?.type === 'reference' && type.name === 'Promise' && type.typeArguments?.length === 1
    ? type.typeArguments[0]
    : type;

const renderReturns = (ctx: Ctx, signature: SignatureReflection, line?: number) => {
  const tags = getBlockTags(signature.comment, '@returns');
  const type = signature.type;
  const isVoid = type?.type === 'intrinsic' && type.name === 'void';
  if (!type || (isVoid && !tags.length)) return '';
  const members = getObjectMembers(unwrapPromise(type));
  const text = tags.map((tag) => commentMarkdown(ctx, tag.content)).join('\n\n');
  return `<div class="hubApiReturns"><p class="hubApiLabel">Returns</p><p>${inlineType(ctx, type)}</p>${renderBlock(ctx, text, line)}</div>\n${renderTable('Property', memberRows(ctx, members), 'Returned object')}`;
};

// --- Symbols ---

const KIND_LABELS: Record<number, string> = {
  [Kind.Function]: 'function',
  [Kind.Class]: 'class',
  [Kind.Interface]: 'interface',
  [Kind.TypeAlias]: 'type',
  [Kind.Enum]: 'enum',
  [Kind.Variable]: 'const',
  [Kind.Namespace]: 'namespace',
  [Kind.Module]: 'module',
};

export const MEMBER_KIND_LABELS: Record<number, string> = {
  [Kind.Constructor]: 'constructor',
  [Kind.Method]: 'method',
  [Kind.Accessor]: 'property',
  [Kind.Property]: 'property',
};

export const kindLabel = (symbol: DeclarationReflection) =>
  symbol.kind === Kind.Variable && !symbol.flags.isConst
    ? 'let'
    : KIND_LABELS[symbol.kind] ?? 'export';

const renderSource = (ctx: Ctx, reflection: { sources?: JSONOutput.SourceReference[] }) => {
  const source = reflection.sources?.[0];
  return source ? `<p class="hubApiSource">${ctx.sourceLink(source)}</p>\n` : '';
};

/** A call signature's docs: its comment, parameters, return value and tags */
const renderSignatureDocs = (ctx: Ctx, signature: SignatureReflection, hasReturns = true) => {
  const line = signature.sources?.[0]?.line;
  return (
    renderCommentHead(ctx, signature.comment, line) +
    renderTable(
      'Type parameter',
      typeParameterRows(ctx, signature.typeParameters),
      'Type parameters'
    ) +
    renderTable('Parameter', parameterRows(ctx, signature.parameters ?? []), 'Parameters') +
    (hasReturns ? renderReturns(ctx, signature, line) : '') +
    renderCommentTail(ctx, signature.comment, line)
  );
};

/** A class's or an interface's method, or a class's constructor, under its symbol (h4) */
const renderMember = (ctx: Ctx, member: DeclarationReflection) => {
  const target = ctx.api.targets.get(member.id);
  if (!target) return '';
  const isConstructor = member.kind === Kind.Constructor;
  const name = isConstructor ? 'constructor' : member.name;
  const inner = `<code>${escapeHtml(`${name}()`)}</code>${
    member.flags.isStatic ? badge('static') : ''
  }${isDeprecated(member) ? badge('deprecated', 'deprecated') : ''}${
    isInternal(member) ? badge('internal') : ''
  }`;
  let html = anchorHeading(ctx, 4, target.anchor, name, inner);
  for (const signature of member.signatures ?? []) {
    const w = printSignature(name, signature, {
      prefix: member.flags.isStatic ? 'static ' : '',
      returns: !isConstructor,
    });
    html +=
      codeBlock(ctx, w, MEMBER_POSITION_PREFIX) +
      renderSignatureDocs(ctx, signature, !isConstructor);
  }
  return `<div class="hubApiMemberBlock">${html}${renderSource(ctx, member)}</div>\n`;
};

/** A class's or an interface's own members: a table of properties, then each method */
const renderMembers = (ctx: Ctx, symbol: DeclarationReflection) => {
  const members = getOwnMembers(symbol).filter((member) => !member.flags.isPrivate);
  const constructors = members.filter((m) => m.kind === Kind.Constructor);
  const properties = members.filter((m) => m.kind === Kind.Property || m.kind === Kind.Accessor);
  const methods = members.filter((m) => m.kind === Kind.Method);
  return (
    constructors.map((member) => renderMember(ctx, member)).join('') +
    renderTable(
      'Property',
      [...indexRows(ctx, symbol), ...memberRows(ctx, properties)],
      'Properties'
    ) +
    methods.map((member) => renderMember(ctx, member)).join('')
  );
};

/** A function type's parameters and return value (a type alias's or a variable's type) */
const renderFunctionType = (ctx: Ctx, type: SomeType | undefined) => {
  const signature = type?.type === 'reflection' ? type.declaration.signatures?.[0] : undefined;
  if (!signature) return '';
  return (
    renderTable('Parameter', parameterRows(ctx, signature.parameters ?? []), 'Parameters') +
    renderReturns(ctx, signature)
  );
};

/** A second entry's name for a declaration the first entry documents: a link to it */
const renderReexport = (ctx: Ctx, symbol: PublicSymbol) => {
  const home = ctx.api.symbols.find(
    (other) => other.reflection.id === symbol.reflection.id && !other.isReexport
  )!;
  return `<p>Re-exports <a href="${escapeHtml(href(ctx, symbol.target.pagePath, symbol.target.anchor))}"><code>${escapeHtml(symbol.reflection.name)}</code></a> from <code>${escapeHtml(home.entry)}</code>.</p>\n`;
};

/**
 * A name of the page's entry: its heading and anchor, then the declaration's docs, or for a
 * second entry's re-export a link to the first's
 */
export const renderSymbol = (ctx: Ctx, publicSymbol: PublicSymbol) => {
  const { reflection: symbol, name, anchor } = publicSymbol;
  const kind = publicSymbol.isReexport ? 're-export' : kindLabel(symbol);
  const badges = [isDeprecated(symbol) && badge('deprecated', 'deprecated')].filter(Boolean);
  const inner = `<span class="hubApiKind hubApiKind_${kind.replace(/\W/g, '')}">${escapeHtml(kind)}</span><code>${escapeHtml(name)}</code>${badges.join('')}`;
  let html = anchorHeading(ctx, 3, anchor, name, inner);
  if (publicSymbol.isReexport) {
    return `<section class="hubApiSymbol">\n${html}${renderReexport(ctx, publicSymbol)}</section>\n`;
  }
  const line = symbol.sources?.[0]?.line;
  if (!isDocumented(symbol)) html += '<p class="hubApiMissing">No description</p>\n';

  switch (symbol.kind) {
    case Kind.Function:
      for (const signature of symbol.signatures ?? []) {
        html += codeBlock(ctx, printSignature(symbol.name, signature, { prefix: 'function ' }));
        html += renderSignatureDocs(ctx, signature);
      }
      break;
    case Kind.Class:
    case Kind.Interface:
      html += codeBlock(
        ctx,
        printHeritage(symbol.kind === Kind.Class ? 'class' : 'interface', symbol)
      );
      html += renderCommentHead(ctx, symbol.comment, line);
      html += renderMembers(ctx, symbol);
      html += renderCommentTail(ctx, symbol.comment, line);
      break;
    case Kind.TypeAlias:
      html += codeBlock(ctx, printTypeAlias(symbol));
      html += renderCommentHead(ctx, symbol.comment, line);
      html += renderTable(
        'Type parameter',
        typeParameterRows(ctx, symbol.typeParameters),
        'Type parameters'
      );
      html += renderTable(
        'Property',
        [...indexRows(ctx, symbol), ...memberRows(ctx, getTabledMembers(symbol))],
        'Properties'
      );
      for (const variant of getTabledVariants(symbol)) {
        html += renderTable(
          'Property',
          memberRows(ctx, variant.members),
          `Properties (${variant.label})`
        );
      }
      html += renderFunctionType(ctx, symbol.type);
      html += renderCommentTail(ctx, symbol.comment, line);
      break;
    case Kind.Enum:
      html += codeBlock(ctx, new CodeWriter().write(`enum ${symbol.name}`));
      html += renderCommentHead(ctx, symbol.comment, line);
      html += renderTable(
        'Member',
        (symbol.children ?? []).map((member) => ({
          name: member.name,
          badges: [],
          type: inlineType(ctx, member.type),
          description: renderCellComment(ctx, member.comment),
        })),
        'Members'
      );
      html += renderCommentTail(ctx, symbol.comment, line);
      break;
    case Kind.Variable:
      html += codeBlock(ctx, printVariable(symbol));
      html += renderCommentHead(ctx, symbol.comment, line);
      html += renderTable('Property', memberRows(ctx, getObjectMembers(symbol.type)), 'Properties');
      html += renderFunctionType(ctx, symbol.type);
      html += renderCommentTail(ctx, symbol.comment, line);
      break;
    default:
      html += codeBlock(
        ctx,
        new CodeWriter().write(
          symbol.kind === Kind.Module
            ? `declare module '${symbol.name}'`
            : `namespace ${symbol.name}`
        )
      );
      html += renderCommentHead(ctx, symbol.comment, line);
      html += renderCommentTail(ctx, symbol.comment, line);
  }
  return `<section class="hubApiSymbol">\n${html}${renderSource(ctx, symbol)}</section>\n`;
};
