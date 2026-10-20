import { t } from './i18n';
import { safeUrl, type Bundle, type Entry, type Mode } from './model';
import { extractPaperReferences } from './paper-groups';

export interface MaterialStatus {
  kind: 'feed-content' | 'feed-description' | 'feed-summary' | 'empty' | 'unknown' | 'vault' | 'rewrite' | 'translation';
  truncated: boolean;
}

/** Describe the material actually selected by the renderer, without inferring completeness. */
export function materialStatus(bundle: Bundle, mode: Mode): MaterialStatus {
  const entry = bundle.entry;
  if (entry.origin === 'vault' && entry.markdown != null) return { kind: 'vault', truncated: false };
  if (mode === 'rewrite') return { kind: bundle.rewrite?.body.trim() ? 'rewrite' : 'empty', truncated: false };
  if (mode === 'translation') {
    const available = bundle.translation?.content?.some(pair => pair.target?.trim() || pair.targetHtml?.trim());
    return { kind: available ? 'translation' : 'empty', truncated: false };
  }
  const provenance = entry.contentProvenance;
  const truncated = provenance?.truncated === true;
  if (provenance?.source === 'empty' || !entry.content?.trim()) return { kind: 'empty', truncated };
  const kind = provenance?.source === 'rss-content' || provenance?.source === 'atom-content' ? 'feed-content'
    : provenance?.source === 'rss-description' ? 'feed-description'
    : provenance?.source === 'atom-summary' ? 'feed-summary' : 'unknown';
  return { kind, truncated };
}

export function materialStatusText(bundle: Bundle, mode: Mode): string {
  const status = materialStatus(bundle, mode);
  return `${t(`material.${status.kind}`)}${status.truncated ? ` · ${t('material.truncated')}` : ''}`;
}

/** A feed URL fallback is not a link to the original article. */
export function sourceArticleUrl(entry: Entry): string | null {
  if (entry.origin === 'local' && entry.contentProvenance?.originalLink === false) return null;
  return entry.link ? safeUrl(entry.link) : null;
}

/** Offer canonical reading destinations only when exactly one explicit paper is identified. */
export function paperReadingLinks(entry: Entry): { kind: 'paper' | 'pdf'; url: string }[] {
  const papers = extractPaperReferences(entry);
  if (papers.length !== 1) return [];
  const paper = papers[0];
  return paper.kind === 'arxiv'
    ? [{ kind: 'paper', url: paper.url }, { kind: 'pdf', url: `https://arxiv.org/pdf/${paper.id}` }]
    : [{ kind: 'paper', url: paper.url }];
}
