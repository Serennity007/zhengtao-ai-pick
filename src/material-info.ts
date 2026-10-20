import { t } from './i18n';
import { materialStatusText, paperReadingLinks, sourceArticleUrl } from './material-status';
import { safeUrl, type Bundle, type Mode } from './model';
import { wechatArticleKey } from './wechat-articles';

/** Describes the current reading material and exposes existing source links without loading them. */
export function renderMaterialInfo(article: HTMLElement, bundle: Bundle, mode: Mode, loading = false): void {
  if (loading) return;
  const panel = article.createDiv('qrs-material-info');
  panel.createSpan({ cls: 'qrs-material-label', text: t('material.label') });
  panel.createSpan({ cls: 'qrs-material-scope', text: materialStatusText(bundle, mode) });

  const paperLinks = paperReadingLinks(bundle.entry).flatMap(link => {
    const url = safeUrl(link.url);
    return url ? [{ kind: link.kind, url }] : [];
  });
  const originalUrl = sourceArticleUrl(bundle.entry);
  const original = originalUrl ? safeUrl(originalUrl) : null;
  const links = [
    ...(original && !paperLinks.some(link => link.url === original) ? [{ url: original, text: t('material.openOriginal') }] : []),
    ...paperLinks.map(link => ({ url: link.url, text: t(link.kind === 'paper' ? 'material.paper' : 'material.pdf') })),
  ].filter((link, index, all) => all.findIndex(other => other.url === link.url) === index).slice(0, 3);

  if (links.length) {
    const actions = panel.createDiv('qrs-material-links');
    for (const link of links) actions.createEl('a', {
      text: link.text,
      attr: { href: link.url, target: '_blank', rel: 'noopener noreferrer' },
    });
  }
  if (original && wechatArticleKey(original)) panel.createSpan({ cls: 'qrs-material-copyright', text: t('reader.wechatNotice') });
}
