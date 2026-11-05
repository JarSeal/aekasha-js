/**
 * The engine 6 codemod's call reshapes (D10 kind 3, `ReshapeRule`; p622 Phases 3, 5 and 6): a
 * call of an entry's function (or an entry type's method) in its old shape gets the new one, its
 * arguments' comments with them, an omitted world filled (`defaults`) and a dropped one left out.
 * The argument list is written last (`ModuleState.reshapes`), with the other edits inside it
 * applied, so a renamed name or a reshaped call in an argument is no overlap. Arguments that
 * change places are checked first (`engine6Calls.ts`' `isPure`), so the evaluation order stays.
 */
import ts from 'typescript';
import type { ModuleState, Slice } from './engine6';
import { calleeOf, isLiteral, isPure, isUndefined } from './engine6Calls';
import type { EntryName, ReshapeRule } from './engine6Rules';

export type ReshapeRuleTargets = {
  rule: ReshapeRule;
  target: ts.Symbol;
  /** The rule's `defaults`, each with its function's symbol */
  defaults: ReadonlyMap<string, { name: EntryName; target: ts.Symbol }>;
};

/** A piece of a reshaped call: a new argument or an object's property, with the comments of the
 * old argument it holds */
type Piece = { text: string; leading: string[]; trailing: string[] };

// The spread arguments written without parentheses
const BARE_SPREADS = new Set([
  ts.SyntaxKind.Identifier,
  ts.SyntaxKind.PropertyAccessExpression,
  ts.SyntaxKind.ElementAccessExpression,
  ts.SyntaxKind.CallExpression,
  ts.SyntaxKind.ParenthesizedExpression,
  ts.SyntaxKind.NonNullExpression,
  ts.SyntaxKind.ThisKeyword,
]);

const renderPiece = (p: Piece) =>
  `${p.leading.map((c) => `${c}\n`).join('')}${p.text},${p.trailing.map((c) => ` ${c}`).join('')}\n`;

const hasComments = (pieces: readonly Piece[]) =>
  pieces.some((p) => p.leading.length || p.trailing.length);

/** Each argument's comments: the ones before it (from the line after the comma before it, or
 * right after the `(`) and the ones after it on its line (after its comma too); the last one's
 * also the lines below it, up to the `)` */
const argumentComments = (sf: ts.SourceFile, list: readonly ts.Node[]) => {
  const { text } = sf;
  const read = (ranges: ts.CommentRange[] | undefined) =>
    (ranges ?? []).map((r) => text.slice(r.pos, r.end));
  const args = list.filter((n) => n.kind !== ts.SyntaxKind.CommaToken);
  return args.map((arg, i) => {
    const after = list[list.indexOf(arg) + 1];
    const comma = after?.kind === ts.SyntaxKind.CommaToken ? after : undefined;
    const leading = [
      ...(i === 0 ? read(ts.getTrailingCommentRanges(text, arg.pos)) : []),
      ...read(ts.getLeadingCommentRanges(text, arg.pos)),
    ];
    const trailing = [
      ...read(ts.getTrailingCommentRanges(text, arg.end)),
      ...(comma ? read(ts.getTrailingCommentRanges(text, comma.end)) : []),
      ...(i === args.length - 1
        ? read(ts.getLeadingCommentRanges(text, comma?.end ?? arg.end))
        : []),
    ];
    return { leading, trailing };
  });
};

/** An old argument of a reshaped call, with its comments */
type OldArg = { node: ts.Expression; leading: string[]; trailing: string[] };

/** Whether the old shape's argument at `index` is of the rule's `oldType` (`undefined` aside); null
 * when it's `any` */
const isOfOldType = (
  checker: ts.TypeChecker,
  arg: ts.Expression,
  oldType: NonNullable<ReshapeRule['oldType']>
) => {
  const type = checker.getTypeAtLocation(arg);
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return null;
  const flags = oldType.type === 'boolean' ? ts.TypeFlags.BooleanLike : ts.TypeFlags.NumberLike;
  const empty = ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void;
  const types = (type.isUnion() ? type.types : [type]).filter((t) => !(t.flags & empty));
  return types.length > 0 && types.every((t) => t.flags & flags);
};

/** Reshapes a call of the rule's callee when it's in the old shape */
const reshapeCall = (
  m: ModuleState,
  { rule, defaults }: ReshapeRuleTargets,
  call: ts.CallExpression,
  pure: ReadonlySet<ts.Symbol>
) => {
  const { checker, sf } = m;
  const { callee } = rule;
  const name = `\`${callee.member === undefined ? callee.name : `${callee.name}.${callee.member}`}\``;
  const args = call.arguments;
  const reportAny = (arg: ts.Node) =>
    m.report(
      arg,
      `${name}: an argument of type \`any\` hides the call's shape: reshape it by hand if it's the old one`,
      rule.anchor
    );
  let isOld = args.length > rule.newArgCount;
  if (!isOld && rule.newHas) {
    const arg = args[rule.newHas.index];
    if (!arg) return;
    const type = checker.getTypeAtLocation(arg);
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return reportAny(arg);
    isOld = !checker.getPropertyOfType(type, rule.newHas.member);
  }
  if (!isOld && rule.oldHas) {
    const arg = args[rule.oldHas.index];
    if (!arg) return;
    const type = checker.getTypeAtLocation(arg);
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return reportAny(arg);
    isOld = !!checker.getPropertyOfType(type, rule.oldHas.member);
  }
  if (!isOld && rule.oldType) {
    const arg = args[rule.oldType.index];
    if (!arg) return;
    const is = isOfOldType(checker, arg, rule.oldType);
    if (is === null) return reportAny(arg);
    isOld = is;
  }
  if (!isOld) return;
  if (args.some(ts.isSpreadElement)) {
    m.report(call, `${name}: a spread argument: reshape the call by hand`, rule.anchor);
    return;
  }
  if (args.length > rule.params.length) {
    m.error(call, `${name}: more arguments than its old parameters`);
    return;
  }
  const children = call.getChildren(sf);
  const open = children.findIndex((c) => c.kind === ts.SyntaxKind.OpenParenToken);
  const list = children[open + 1].getChildren(sf);
  const close = children[children.length - 1];
  const comments = argumentComments(sf, list);

  // The old arguments by parameter. A dropped one (`undefined`, or an empty object literal to
  // spread) carries its comments to the next one kept (the previous one when none is)
  const spreads = new Set(
    rule.args
      .flatMap((a) => ('props' in a ? a.props : []))
      .flatMap((p) => ('spread' in p ? [p.spread] : []))
  );
  const values = new Map<string, OldArg>();
  let carried: string[] = [];
  let last: OldArg | undefined;
  for (const [i, node] of args.entries()) {
    const c = comments[i];
    // A dropped argument's evaluation goes with it: only one without side effects is dropped
    if (rule.drop?.includes(rule.params[i])) {
      if (!isPure(checker, pure, node)) {
        m.report(
          node,
          `${name}: the argument it no longer takes has side effects: reshape the call by hand`,
          rule.anchor
        );
        return;
      }
      carried.push(...c.leading, ...c.trailing);
      continue;
    }
    const isEmptySpread =
      spreads.has(rule.params[i]) && ts.isObjectLiteralExpression(node) && !node.properties.length;
    if (isUndefined(node) || isEmptySpread) {
      carried.push(...c.leading, ...c.trailing);
      continue;
    }
    last = { node, leading: [...carried, ...c.leading], trailing: c.trailing };
    values.set(rule.params[i], last);
    carried = [];
  }
  if (carried.length) {
    if (last) last.trailing.push(...carried);
    else m.error(call, `${name}: a comment on an argument the reshape drops`);
  }

  // Two kept arguments that change places must commute: both without side effects, or one a
  // literal. Else the evaluation order would change: the call is left for a person
  const order = rule.args
    .flatMap((a) =>
      'param' in a ? [a.param] : a.props.map((p) => ('key' in p ? p.param : p.spread))
    )
    .flatMap((param) => {
      const v = values.get(param);
      return v ? [{ index: rule.params.indexOf(param), node: v.node }] : [];
    });
  const commutes = (a: ts.Expression, b: ts.Expression) =>
    isLiteral(a) || isLiteral(b) || (isPure(checker, pure, a) && isPure(checker, pure, b));
  for (const [i, a] of order.entries()) {
    for (const b of order.slice(i + 1)) {
      if (a.index > b.index && !commutes(a.node, b.node)) {
        m.report(
          call,
          `${name}: its arguments change places and one has side effects: reshape the call by hand`,
          rule.anchor
        );
        return;
      }
    }
  }

  // An omitted argument with a default: its function's call, through the module's import of it
  const filled = new Map<string, string>();
  for (const arg of rule.args) {
    const fill = 'param' in arg && !values.has(arg.param) && defaults.get(arg.param);
    if (!fill) continue;
    const local = m.useImport(fill.name, fill.target, call);
    if (local === null) return;
    filled.set(arg.param, `${local}()`);
  }

  const render = (slice: Slice) => {
    const textOf = (node: ts.Node) => slice(node.getStart(sf), node.getEnd());
    const newArgs = rule.args.map((arg): Piece | null => {
      if ('param' in arg) {
        const v = values.get(arg.param);
        const fill = filled.get(arg.param);
        if (fill) return { text: fill, leading: [], trailing: [] };
        return v ? { ...v, text: textOf(v.node) } : null;
      }
      const pieces: (Piece & { whole?: string })[] = [];
      for (const prop of arg.props) {
        const v = values.get('key' in prop ? prop.param : prop.spread);
        if (!v) continue;
        const { node } = v;
        if ('key' in prop) {
          const isShorthand = ts.isIdentifier(node) && node.text === prop.key;
          pieces.push({ ...v, text: isShorthand ? prop.key : `${prop.key}: ${textOf(node)}` });
        } else if (ts.isObjectLiteralExpression(node)) {
          const { properties: ps } = node;
          const text = slice(ps[0].getStart(sf), ps[ps.length - 1].getEnd());
          pieces.push({ ...v, text, whole: textOf(node) });
        } else {
          const whole = textOf(node);
          const text = BARE_SPREADS.has(node.kind) ? `...${whole}` : `...(${whole})`;
          pieces.push({ ...v, text, whole });
        }
      }
      if (!pieces.length) return null;
      // An object of one spread is that argument as it was
      if (pieces.length === 1 && pieces[0].whole !== undefined) {
        return { ...pieces[0], text: pieces[0].whole };
      }
      const text = hasComments(pieces)
        ? `{\n${pieces.map(renderPiece).join('')}}`
        : `{ ${pieces.map((p) => p.text).join(', ')} }`;
      return { text, leading: [], trailing: [] };
    });
    while (newArgs.length && !newArgs[newArgs.length - 1]) newArgs.pop();
    const pieces = newArgs.map(
      (p, i): Piece =>
        p ?? { text: 'param' in rule.args[i] ? 'undefined' : '{}', leading: [], trailing: [] }
    );
    return hasComments(pieces)
      ? `\n${pieces.map(renderPiece).join('')}`
      : pieces.map((p) => p.text).join(', ');
  };
  m.reshapes.push({ start: children[open].getEnd(), end: close.getStart(sf), render });
};

/** The reshape rules on each call of their entry functions */
export const applyReshapeRules = (
  m: ModuleState,
  rules: readonly ReshapeRuleTargets[],
  pure: ReadonlySet<ts.Symbol>
) => {
  if (!rules.length) return;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const resolved = calleeOf(m.checker, node);
      for (const r of rules) if (resolved === r.target) reshapeCall(m, r, node, pure);
    }
    ts.forEachChild(node, visit);
  };
  visit(m.sf);
};
