import { markdownText } from './daily-note';
import { t } from './i18n';
import { safeUrl, titleOf, type Bundle, type Mode } from './model';
import { extractPaperReferences } from './paper-groups';

export interface ResearchCardOptions {
  sourceName: string;
  createdAt: number;
  topics: readonly string[];
  backlink: string;
  vaultName: string;
}

/** JSON strings/arrays are YAML flow values; escape Unicode breaks to preserve their exact text. */
function yamlValue(value: string | readonly string[]): string {
  return JSON.stringify(value).replace(/\u0085/g, '\\u0085').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function withoutFrontmatter(markdown: string): string {
  return markdown.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').trimStart();
}

/** Only the caller's persisted reader snapshot is a valid local article backlink. */
function readerBacklink(value: string): string | null {
  if ([...value].some(char => char.charCodeAt(0) <= 32 || char === '<' || char === '>')) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'obsidian:' && url.hostname === 'zhengtao-ai-pick' && !url.username && !url.password && !url.port &&
      (!url.pathname || url.pathname === '/') && !url.hash && !!url.searchParams.get('article') ? url.href : null;
  } catch { return null; }
}

/** Creates a research worksheet from observed fields; conclusions remain explicitly unfilled. */
export function researchCardMarkdown(bundle: Bundle, mode: Mode, readingMarkdown: string, options: ResearchCardOptions): string {
  const entry = bundle.entry, title = titleOf(entry);
  const original = (entry.link ? safeUrl(entry.link) : null) || (entry.origin === 'vault' && entry.markdownPath && options.vaultName
    ? `obsidian://open?vault=${encodeURIComponent(options.vaultName)}&file=${encodeURIComponent(entry.markdownPath)}` : '');
  const paperEntry = entry.origin === 'vault' && entry.markdown != null ? { ...entry, content: withoutFrontmatter(entry.markdown) } : entry;
  const papers = extractPaperReferences(paperEntry);
  const properties: Record<string, string | readonly string[]> = {
    title, source: options.sourceName.trim() || entry.sourceName?.trim() || '', url: original,
    created: new Date(options.createdAt).toISOString(), published: entry.published?.trim() || '',
    arxiv: papers.filter(paper => paper.kind === 'arxiv').map(paper => paper.id),
    doi: papers.filter(paper => paper.kind === 'doi').map(paper => paper.id),
    status: 'to-review', topics: [...new Set(options.topics.map(topic => topic.trim()).filter(Boolean))], reading_mode: mode,
  };
  const frontmatter = Object.entries(properties).map(([key, value]) => `${key}: ${yamlValue(value)}`).join('\n');
  const backlink = readerBacklink(options.backlink);
  const links = [backlink ? `[${t('card.backlink')}](<${backlink}>)` : '', original ? `[${t('export.originalLink')}](<${original}>)` : ''].filter(Boolean);
  const sections = (['card.question', 'card.method', 'card.findings', 'card.limitations', 'card.implications'] as const)
    .map(key => `## ${t(key)}\n\n${t('card.placeholder')}`).join('\n\n');
  const material = entry.origin === 'vault' ? withoutFrontmatter(readingMarkdown) : readingMarkdown;
  return `---\n${frontmatter}\n---\n\n# ${markdownText(title.replace(/\s+/g, ' ').trim())}\n\n` +
    `${links.length ? `${links.join(' · ')}\n\n` : ''}> ${t('card.scope')}\n\n${sections}\n\n## ${t('card.material')}\n\n${material.trimEnd()}\n`;
}
