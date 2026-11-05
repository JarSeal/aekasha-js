/**
 * What the engine 6 codemod's rules know about a call (p622 D10): its callee, through imports and
 * namespaces, and whether an argument is a literal or free of side effects (the reshapes that
 * reorder arguments, `engine6Reshape.ts`).
 */
import ts from 'typescript';

export const resolveAlias = (checker: ts.TypeChecker, symbol: ts.Symbol) =>
  symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;

/** The declaration a call's callee resolves to, through imports and namespaces */
export const calleeOf = (checker: ts.TypeChecker, call: ts.CallExpression) => {
  const callee = ts.isPropertyAccessExpression(call.expression)
    ? call.expression.name
    : call.expression;
  const symbol = checker.getSymbolAtLocation(callee);
  return symbol && resolveAlias(checker, symbol);
};

export const isUndefined = (node: ts.Node) => ts.isIdentifier(node) && node.text === 'undefined';

const LITERALS = new Set([
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.BigIntLiteral,
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TrueKeyword,
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.NullKeyword,
]);

/** The expression inside parentheses and type-only wrappers */
const unwrap = (node: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(node) ||
  ts.isAsExpression(node) ||
  ts.isSatisfiesExpression(node) ||
  ts.isNonNullExpression(node) ||
  ts.isTypeAssertionExpression(node)
    ? unwrap(node.expression)
    : node;

/** A literal: it reads nothing and does nothing, so it may change places with anything */
export const isLiteral = (node: ts.Expression) => {
  const n = unwrap(node);
  return (
    LITERALS.has(n.kind) ||
    isUndefined(n) ||
    (ts.isPrefixUnaryExpression(n) && ts.isNumericLiteral(n.operand))
  );
};

const PURE_PREFIX = new Set([
  ts.SyntaxKind.ExclamationToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.TildeToken,
]);

/** An expression without side effects (it may read): no assignment, no `++` / `--`, no call but
 * of `pure` (`PURE_CALLS`), no `new`, `await` or `yield`. A getter is taken for a read. */
export const isPure = (
  checker: ts.TypeChecker,
  pure: ReadonlySet<ts.Symbol>,
  node: ts.Node
): boolean => {
  const all = (nodes: readonly ts.Node[]) => nodes.every((n) => isPure(checker, pure, n));
  if (ts.isExpression(node)) {
    if (isLiteral(node)) return true;
    const inner = unwrap(node);
    if (inner !== node) return isPure(checker, pure, inner);
  }
  if (ts.isIdentifier(node) || node.kind === ts.SyntaxKind.ThisKeyword) return true;
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return true;
  if (ts.isPropertyAccessExpression(node)) return isPure(checker, pure, node.expression);
  if (ts.isElementAccessExpression(node)) return all([node.expression, node.argumentExpression]);
  if (ts.isPrefixUnaryExpression(node)) {
    return PURE_PREFIX.has(node.operator) && isPure(checker, pure, node.operand);
  }
  if (ts.isTypeOfExpression(node) || ts.isVoidExpression(node)) {
    return isPure(checker, pure, node.expression);
  }
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    const isAssignment = op >= ts.SyntaxKind.FirstAssignment && op <= ts.SyntaxKind.LastAssignment;
    return !isAssignment && all([node.left, node.right]);
  }
  if (ts.isConditionalExpression(node)) return all([node.condition, node.whenTrue, node.whenFalse]);
  if (ts.isTemplateExpression(node)) return all(node.templateSpans.map((t) => t.expression));
  if (ts.isArrayLiteralExpression(node)) return all(node.elements);
  if (ts.isSpreadElement(node)) return isPure(checker, pure, node.expression);
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.every((p) => {
      if (ts.isSpreadAssignment(p)) return isPure(checker, pure, p.expression);
      if (!ts.isPropertyAssignment(p)) return true; // a shorthand, a method, an accessor
      const key = ts.isComputedPropertyName(p.name) ? [p.name.expression] : [];
      return all([...key, p.initializer]);
    });
  }
  if (ts.isCallExpression(node)) {
    const callee = calleeOf(checker, node);
    return !!callee && pure.has(callee) && all(node.arguments);
  }
  return false;
};
