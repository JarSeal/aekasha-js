import path from 'node:path';
import type { HubSearchExtraDoc } from '../search';
import { firstSentence, partsToMarkdown } from './comments';
import { getOwnMembers, Kind, type ApiIndex, type DeclarationReflection } from './model';
import {
  getModuleSummary,
  kindLabel,
  MEMBER_KIND_LABELS,
  symbolSummary,
  toPlainText,
} from './renderSymbol';

/**
 * The search's API documents (p619 R4, from `render.ts`): one per module, export and class or
 * interface member, built once per model.
 */

/**
 * A stored summary's length (p605 Phase 5): the result shows a line or two, and the summaries are
 * the index's largest stored field. Cut at a word, with an ellipsis.
 */
const SEARCH_SUMMARY_MAX_LENGTH = 120;

const clipSearchSummary = (text: string) => {
  if (text.length <= SEARCH_SUMMARY_MAX_LENGTH) return text;
  const cut = text.slice(0, SEARCH_SUMMARY_MAX_LENGTH + 1);
  const space = cut.lastIndexOf(' ');
  return `${cut.slice(0, space > 0 ? space : SEARCH_SUMMARY_MAX_LENGTH).replace(/[\s,;:.(]+$/, '')}…`;
};

/**
 * The search's API documents (§2.4): each module, symbol and class or interface member, found by
 * its name, with its kind and its summary's first sentence for the result (stored, not indexed,
 * and clipped: the index stays under p552's 1 MB). Empty values are left out, not stored.
 */
const createSearchDocs = (index: ApiIndex): HubSearchExtraDoc[] => {
  const doc = (
    pagePath: string,
    anchor: string,
    symbol: string,
    kind: string,
    summary: string
  ): HubSearchExtraDoc => {
    const text = clipSearchSummary(toPlainText(summary));
    return {
      path: pagePath,
      ...(anchor && { anchor }),
      symbol,
      kind,
      ...(text && { summary: text }),
    };
  };
  const sentence = (reflection: DeclarationReflection) => {
    const summary =
      symbolSummary(reflection) ??
      reflection.getSignature?.comment?.summary ??
      reflection.setSignature?.comment?.summary;
    return summary ? firstSentence(partsToMarkdown(summary)) : '';
  };
  const docs: HubSearchExtraDoc[] = [];
  for (const module of index.modules) {
    const name = path.posix.basename(module.relPath);
    docs.push(doc(module.pagePath, '', name, 'module', getModuleSummary(module)));
    for (const symbol of module.symbols) {
      if (symbol.kind === Kind.Reference) continue;
      const target = index.targets.get(symbol.id);
      if (!target) continue;
      docs.push(
        doc(module.pagePath, target.anchor, symbol.name, kindLabel(symbol), sentence(symbol))
      );
      if (symbol.kind !== Kind.Class && symbol.kind !== Kind.Interface) continue;
      for (const member of getOwnMembers(symbol)) {
        const memberTarget = index.targets.get(member.id);
        if (!memberTarget || member.flags.isPrivate) continue;
        const memberName = member.kind === Kind.Constructor ? 'constructor' : member.name;
        const kind = MEMBER_KIND_LABELS[member.kind] ?? 'property';
        docs.push(
          doc(
            module.pagePath,
            memberTarget.anchor,
            `${symbol.name}.${memberName}`,
            kind,
            sentence(member)
          )
        );
      }
    }
  }
  return docs;
};

const searchDocs = new WeakMap<ApiIndex, HubSearchExtraDoc[]>();

export const getSearchDocs = (index: ApiIndex) => {
  let docs = searchDocs.get(index);
  if (!docs) searchDocs.set(index, (docs = createSearchDocs(index)));
  return docs;
};
