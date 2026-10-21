import type { HubSearchExtraDoc } from '../search';
import { firstSentence, partsToMarkdown } from './comments';
import { getOwnMembers, Kind, type DeclarationReflection } from './model';
import type { PublicApi } from './publicApi';
import { kindLabel, MEMBER_KIND_LABELS, symbolSummary, toPlainText } from './renderSymbol';

/**
 * The search's API documents (p619 R4, from `render.ts`): one per entry's page, public name and
 * class or interface member, built once per model. Internal exports have no page, so no document.
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
 * The search's API documents (§2.4): each entry, public name and class or interface member, found
 * by its name, with its kind and its summary's first sentence for the result (stored, not indexed,
 * and clipped: the index stays under p552's 1 MB). Empty values are left out, not stored. A second
 * entry's re-export has none: the name finds its first entry's.
 */
const createSearchDocs = (api: PublicApi): HubSearchExtraDoc[] => {
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
  for (const page of api.pages) {
    if (page.kind === 'entry') docs.push(doc(page.pagePath, '', page.title, 'entry', ''));
  }
  for (const { name, reflection, target, isReexport } of api.symbols) {
    if (isReexport) continue;
    docs.push(
      doc(target.pagePath, target.anchor, name, kindLabel(reflection), sentence(reflection))
    );
    if (reflection.kind !== Kind.Class && reflection.kind !== Kind.Interface) continue;
    for (const member of getOwnMembers(reflection)) {
      const memberTarget = api.targets.get(member.id);
      if (!memberTarget || member.flags.isPrivate) continue;
      const memberName = member.kind === Kind.Constructor ? 'constructor' : member.name;
      const kind = MEMBER_KIND_LABELS[member.kind] ?? 'property';
      docs.push(
        doc(
          memberTarget.pagePath,
          memberTarget.anchor,
          `${name}.${memberName}`,
          kind,
          sentence(member)
        )
      );
    }
  }
  return docs;
};

const searchDocs = new WeakMap<PublicApi, HubSearchExtraDoc[]>();

export const getSearchDocs = (api: PublicApi) => {
  let docs = searchDocs.get(api);
  if (!docs) searchDocs.set(api, (docs = createSearchDocs(api)));
  return docs;
};
