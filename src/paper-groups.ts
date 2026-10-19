import type { Entry } from './model';

export type PaperReference = {
  key: `arxiv:${string}` | `doi:${string}`;
  kind: 'arxiv' | 'doi';
  id: string;
  url: string;
};

export type PaperRow =
  | { kind: 'article'; entry: Entry }
  | { kind: 'paper'; paper: PaperReference; entries: Entry[] };

const MAX_TEXT_BYTES = 80_000;
const MAX_LINKS = 100;
const MAX_URL_LENGTH = 8_000;
const ARXIV_HOSTS = new Set(['arxiv.org', 'www.arxiv.org', 'export.arxiv.org']);
const DOI_HOSTS = new Set(['doi.org', 'dx.doi.org']);

function arxivId(value: string): string | null {
  const match = /^(\d{2}(?:0[1-9]|1[0-2])\.\d{4,5}|[a-z][a-z0-9.-]*\/\d{7})(?:v[1-9]\d*)?$/i.exec(value);
  return match?.[1].toLowerCase() || null;
}

function arxivReference(id: string): PaperReference {
  return { kind: 'arxiv', id, key: `arxiv:${id}`, url: `https://arxiv.org/abs/${id}` };
}

function paperFromUrl(value: string): PaperReference | null {
  if (value.length > MAX_URL_LENGTH || !/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.port) return null;
    const path = decodeURIComponent(url.pathname);
    if (ARXIV_HOSTS.has(url.hostname)) {
      const match = /^\/(?:abs|pdf|html)\/(.+?)\/?$/.exec(path);
      const id = match && arxivId(match[1].replace(/\.pdf$/i, ''));
      return id ? arxivReference(id) : null;
    }
    if (!DOI_HOSTS.has(url.hostname)) return null;
    const id = path.slice(1).toLowerCase();
    if (!/^10\.\d{4,9}\/[^\s<>"]+$/.test(id) || [...id].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null;
    const arxivAlias = /^10\.48550\/arxiv\.(.+)$/.exec(id);
    if (arxivAlias) {
      const normalized = arxivId(arxivAlias[1]);
      return normalized ? arxivReference(normalized) : null;
    }
    const encoded = id.split('/').map(part => encodeURIComponent(part)).join('/');
    return { kind: 'doi', id, key: `doi:${id}`, url: `https://doi.org/${encoded}` };
  } catch { return null; }
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', colon: ':', sol: '/' };
  return value.replace(/&(#x[\da-f]{1,6}|#\d{1,7}|amp|quot|apos|lt|gt|colon|sol);/gi, (whole, entity: string) => {
    if (!entity.startsWith('#')) return named[entity.toLowerCase()] || whole;
    const hex = entity[1].toLowerCase() === 'x';
    const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole;
  });
}

/** Account for UTF-8 without allocating or scanning an unbounded article. */
function textBytes(value: string, budget: number): number | null {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes++;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4; index++;
    } else bytes += 3;
    if (bytes > budget) return null;
  }
  return bytes;
}

/** Remove prose/Markdown delimiters while retaining balanced punctuation inside DOI suffixes. */
function plainUrl(value: string): string {
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const counts: Record<string, number> = {};
  for (const char of value) if ('()[]{}'.includes(char)) counts[char] = (counts[char] || 0) + 1;
  let end = value.length;
  while (end) {
    const char = value[end - 1];
    if (/[.,;:!?，。；：！？]/u.test(char)) { end--; continue; }
    if (pairs[char] && (counts[char] || 0) > (counts[pairs[char]] || 0)) { counts[char]--; end--; continue; }
    break;
  }
  return value.slice(0, end);
}

function anchorHref(attributes: string): string | null {
  // Consume whole quoted attributes so a title containing "href=..." is never treated as a link.
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const attribute of attributes.matchAll(pattern)) {
    if (attribute[1].toLowerCase() === 'href') return attribute[2] ?? attribute[3] ?? attribute[4] ?? null;
  }
  return null;
}

/** Visit anchor hrefs and visible plain-text URLs, never image src or other tag attributes. */
function visitLinks(value: string, visit: (url: string) => boolean): boolean {
  const textLinks = (text: string) => {
    for (const match of decodeEntities(text).matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
      if (!visit(plainUrl(match[0]))) return false;
    }
    return true;
  };
  let index = 0;
  while (index < value.length) {
    const start = value.indexOf('<', index);
    if (start < 0) return textLinks(value.slice(index));
    if (!textLinks(value.slice(index, start))) return false;
    if (value.startsWith('<!--', start)) {
      const end = value.indexOf('-->', start + 4);
      if (end < 0) return true;
      index = end + 3; continue;
    }
    let quote = '', end = start + 1;
    for (; end < value.length; end++) {
      const char = value[end];
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (end === value.length) return true;
    const tag = value.slice(start + 1, end);
    if (/^https?:\/\/[^\s<>]+$/i.test(tag)) {
      if (!visit(decodeEntities(tag))) return false;
    } else {
      const name = /^\s*([a-z][a-z\d:-]*)\b/i.exec(tag);
      if (name?.[1].toLowerCase() === 'a') {
        const href = anchorHref(tag.slice(name[0].length));
        if (href !== null && !visit(decodeEntities(href.trim()))) return false;
      }
      if (name && /^(?:script|style|template|noscript)$/i.test(name[1])) {
        const closing = new RegExp(`</${name[1]}\\s*>`, 'gi');
        closing.lastIndex = end + 1;
        const match = closing.exec(value);
        if (!match) return true;
        index = closing.lastIndex; continue;
      }
    }
    index = end + 1;
  }
  return true;
}

/** Explicit paper links only. Incomplete scans fail closed rather than merging a multi-paper article. */
export function extractPaperReferences(entry: Entry): PaperReference[] {
  const content = entry.content || '', summary = entry.summary || '';
  const contentBytes = textBytes(content, MAX_TEXT_BYTES);
  if (contentBytes === null || textBytes(summary, MAX_TEXT_BYTES - contentBytes) === null) return [];
  const references = new Map<string, PaperReference>();
  let links = 0;
  const visit = (value: string) => {
    if (++links > MAX_LINKS) return false;
    const paper = paperFromUrl(value);
    if (paper) references.set(paper.key, paper);
    return true;
  };
  if (entry.link && !visit(entry.link.trim())) return [];
  if (!visitLinks(content, visit) || !visitLinks(summary, visit)) return [];
  return [...references.values()];
}

/** Keep each original entry; a group occupies its first member's position and preserves member order. */
export function groupPaperEntries(entries: readonly Entry[]): PaperRow[] {
  const rows: PaperRow[] = [];
  const positions = new Map<string, number>();
  for (const entry of entries) {
    const references = extractPaperReferences(entry);
    if (references.length !== 1) { rows.push({ kind: 'article', entry }); continue; }
    const paper = references[0], position = positions.get(paper.key);
    if (position === undefined) { positions.set(paper.key, rows.length); rows.push({ kind: 'article', entry }); continue; }
    const previous = rows[position];
    if (previous.kind === 'paper') previous.entries.push(entry);
    else rows[position] = { kind: 'paper', paper, entries: [previous.entry, entry] };
  }
  return rows;
}
