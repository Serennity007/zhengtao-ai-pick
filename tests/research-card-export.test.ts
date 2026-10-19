// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { TFolder, type App } from 'obsidian';
import { saveArticleToVault } from '../src/vault-export';
import type { ResearchCardOptions } from '../src/research-card';
import type { LocalImages } from '../src/images';
import type { Bundle } from '../src/model';
import { t } from '../src/i18n';

const article: Bundle = {
  entry: { id: 'a', sourceId: 's', title: 'Research', content: '<p>Visible original text.</p><img src="https://example.org/figure.png" alt="figure">', link: 'https://example.org/article' },
  rewrite: { body: '## Selected rewrite\n\nRewritten reading material.' }, translation: null, fetchedAt: 1,
};
const options: ResearchCardOptions = {
  sourceName: 'Research source', createdAt: Date.UTC(2026, 9, 19), topics: ['Memory'],
  backlink: 'obsidian://zhengtao-ai-pick?vault=Research&article=local%7Ca&mode=original', vaultName: 'Research',
};
function host() {
  const files = new Map<string, unknown>(), contents = new Map<string, string>();
  const create = vi.fn(async (path: string, content: string) => {
    if (files.has(path)) throw new Error('File already exists');
    const file = { path }; files.set(path, file); contents.set(path, content); return file;
  });
  const createBinary = vi.fn(async (path: string) => { const file = { path }; files.set(path, file); return file; });
  const trashFile = vi.fn(async (file: { path: string }) => { files.delete(file.path); });
  const load = vi.fn(async () => ({ type: 'image/png', arrayBuffer: async () => new ArrayBuffer(2) }));
  const app = { vault: {
    getAbstractFileByPath: (path: string) => files.get(path),
    createFolder: async (path: string) => { files.set(path, new TFolder(path)); }, create, createBinary,
  }, fileManager: {
    getAvailablePathForAttachment: async (name: string) => `Attachments/${name}`,
    generateMarkdownLink: (file: { path: string }) => `[[${file.path}]]`, trashFile,
  } } as unknown as App;
  return { app, images: { load } as unknown as LocalImages, files, contents, create, createBinary, trashFile, load };
}

describe('research card vault export', () => {
  it('keeps the original export unchanged and uses a separate filename without overwriting an existing card', async () => {
    const h = host();
    const original = await saveArticleToVault(h.app, article, 'original', document, h.images, false, 'Research');
    const card = await saveArticleToVault(h.app, article, 'original', document, h.images, false, 'Research', options);
    const second = await saveArticleToVault(h.app, article, 'original', document, h.images, false, 'Research', options);
    expect(original.file.path).toBe('Research/Research - 原文.md');
    expect(card.file.path).toBe(`Research/${t('card.filePrefix')} - Research - 原文.md`);
    expect(second.file.path).toBe(`Research/${t('card.filePrefix')} - Research - 原文 (2).md`);
    expect(h.contents.get(original.file.path)).toMatch(/^# Research\n/);
    expect(h.contents.get(original.file.path)).not.toContain('to-review');
    expect(h.contents.get(card.file.path)).toMatch(/^---\n/);
    expect(h.contents.get(card.file.path)).toBe(h.contents.get(second.file.path));
    expect(h.load).not.toHaveBeenCalled();
  });

  it('saves attachments through the existing host flow and wraps the selected reading version', async () => {
    const h = host();
    const result = await saveArticleToVault(h.app, article, 'original', document, h.images, true, '', options);
    const markdown = h.contents.get(result.file.path)!;
    expect(result.missingImages).toBe(0);
    expect(h.load).toHaveBeenCalledWith('https://example.org/figure.png');
    expect(h.createBinary).toHaveBeenCalledOnce();
    expect(markdown).toContain(`![[Attachments/${t('card.filePrefix')} - Research - 原文-1.png]]`);
    expect(markdown).not.toContain('qrs-asset-');
    expect(markdown).toContain('Visible original text.');
    expect(h.trashFile).not.toHaveBeenCalled();

    const rewritten = await saveArticleToVault(h.app, article, 'rewrite', document, h.images, false, '', options);
    expect(h.contents.get(rewritten.file.path)).toContain('Rewritten reading material.');
    expect(h.contents.get(rewritten.file.path)).not.toContain('Visible original text.');
    expect(h.contents.get(rewritten.file.path)).toContain('reading_mode: "rewrite"');
  });

  it('counts a missing image but still saves the research card', async () => {
    const h = host();
    h.load.mockRejectedValueOnce(new Error('Image unavailable'));
    const result = await saveArticleToVault(h.app, article, 'original', document, h.images, true, '', options);
    expect(result.missingImages).toBe(1);
    expect(h.contents.get(result.file.path)).toContain('Visible original text.');
    expect(h.createBinary).not.toHaveBeenCalled();
  });

  it('cleans up new attachments when note creation fails', async () => {
    const h = host();
    h.create.mockRejectedValueOnce(new Error('Cannot create note'));
    await expect(saveArticleToVault(h.app, article, 'original', document, h.images, true, '', options)).rejects.toThrow('Cannot create note');
    expect(h.createBinary).toHaveBeenCalledOnce();
    expect(h.trashFile).toHaveBeenCalledOnce();
    expect(h.contents.size).toBe(0);
    expect(h.files.size).toBe(0);
  });

  it('preserves existing vault Markdown for normal saves and strips its old metadata only in the card copy', async () => {
    const h = host();
    const source = { ...article, entry: { ...article.entry, origin: 'vault' as const, markdownPath: 'Source.md', markdown: '---\ntitle: Source metadata\n---\n\nOriginal Markdown.\n' } };
    const normal = await saveArticleToVault(h.app, source, 'original', document, h.images, false, '');
    const card = await saveArticleToVault(h.app, source, 'original', document, h.images, false, '', options);
    expect(h.contents.get(normal.file.path)).toBe(source.entry.markdown);
    expect(h.contents.get(card.file.path)).not.toContain('title: Source metadata');
    expect(h.contents.get(card.file.path)).toContain('Original Markdown.');
    expect(source.entry.markdown).toContain('title: Source metadata');
  });
});
