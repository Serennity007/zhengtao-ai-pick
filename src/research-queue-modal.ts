import { Modal, Notice } from 'obsidian';
import type ZhengtaoPicksPlugin from './main';
import { titleOf, type Bundle, type Entry } from './model';
import { researchTopics, type QueuePreferences } from './research-queue';
import { t } from './i18n';
import { groupPaperEntries } from './paper-groups';

export class ResearchQueueModal extends Modal {
  private closed = true;
  private generation = 0;
  private busy = false;
  private paperGroupsOpen = new Set<string>();
  private tab: 'today' | 'later' = 'today';
  private rules!: HTMLFormElement;
  private list!: HTMLElement;
  private status!: HTMLElement;
  private today!: HTMLButtonElement;
  private later!: HTMLButtonElement;
  private refresh!: HTMLButtonElement;

  constructor(private plugin: ZhengtaoPicksPlugin) { super(plugin.app); }

  onOpen() {
    this.closed = false; this.busy = false; this.generation++;
    this.contentEl.empty(); this.modalEl.addClass('qrs-modal', 'qrs-research-modal');
    this.contentEl.addClass('qrs-research'); this.setTitle(t('queue.title'));
    this.contentEl.createEl('p', { cls: 'qrs-research-description', text: t('queue.description') });
    const tabs = this.contentEl.createDiv({ cls: 'qrs-research-tabs', attr: { role: 'tablist', 'aria-label': t('queue.title') } });
    this.today = tabs.createEl('button', { text: t('queue.today'), attr: { type: 'button', role: 'tab' } });
    this.later = tabs.createEl('button', { text: t('queue.later'), attr: { type: 'button', role: 'tab' } });
    this.today.onclick = () => { if (!this.busy) { this.tab = 'today'; this.renderList(); } };
    this.later.onclick = () => { if (!this.busy) { this.tab = 'later'; this.renderList(); } };
    this.createRules();
    this.status = this.contentEl.createDiv({ cls: 'qrs-research-status', attr: { role: 'status', 'aria-live': 'polite' } });
    this.list = this.contentEl.createDiv({ cls: 'qrs-research-list', attr: { role: 'tabpanel' } });
    this.refresh = this.contentEl.createEl('button', { text: t('queue.refresh'), cls: 'qrs-research-refresh', attr: { type: 'button' } });
    this.refresh.onclick = () => { void this.run(async () => {
      await this.plugin.refreshResearchQueue(this.contentEl.ownerDocument);
    }, '', t('discovery.readFailed')); };
    this.renderList();
  }

  private createRules() {
    const preferences = this.plugin.state.researchQueue;
    this.rules = this.contentEl.createEl('form', { cls: 'qrs-research-rules' });
    const topicLabel = this.rules.createEl('label', { cls: 'qrs-research-field' });
    topicLabel.createSpan({ text: t('queue.topic') });
    const topics = topicLabel.createEl('select', { attr: { name: 'topic' } });
    for (const topic of researchTopics) topics.createEl('option', { text: topic.name, value: topic.id });
    topics.createEl('option', { text: t('queue.custom'), value: 'custom' });
    topics.value = researchTopics.find(topic => topic.keywords === preferences.keywords)?.id || 'custom';
    const keywords = this.textField('keywords', t('queue.keywords'), preferences.keywords);
    const exclude = this.textField('exclude', t('queue.exclude'), preferences.exclude);
    topics.onchange = () => {
      const preset = researchTopics.find(topic => topic.id === topics.value);
      if (preset) keywords.value = preset.keywords;
    };
    keywords.oninput = () => { topics.value = researchTopics.find(topic => topic.keywords === keywords.value)?.id || 'custom'; };
    const numbers = this.rules.createDiv('qrs-research-numbers');
    const number = (name: string, label: string, value: number, max: number) => {
      const field = numbers.createEl('label', { cls: 'qrs-research-field' });
      field.createSpan({ text: label });
      const input = field.createEl('input', { type: 'number', attr: { name, min: '1', max: String(max), step: '1', required: true } });
      input.value = String(value); return input;
    };
    const days = number('days', t('queue.days'), preferences.days, 90);
    const limit = number('limit', t('queue.limit'), preferences.limit, 50);
    const perSource = number('perSource', t('queue.perSource'), preferences.perSource, 5);
    this.rules.createEl('button', { text: t('queue.save'), cls: 'mod-cta', attr: { type: 'submit' } });
    this.rules.onsubmit = event => {
      event.preventDefault();
      if (this.busy || !this.rules.reportValidity()) return;
      const draft: QueuePreferences = {
        keywords: keywords.value, exclude: exclude.value,
        days: Number(days.value), limit: Number(limit.value), perSource: Number(perSource.value),
      };
      void this.run(() => this.plugin.setResearchQueue(draft), t('queue.rulesSaved'));
    };
  }

  private textField(name: string, label: string, value: string) {
    const field = this.rules.createEl('label', { cls: 'qrs-research-field' });
    field.createSpan({ text: label });
    const input = field.createEl('textarea', { attr: { name, rows: '2', maxlength: '4000' } });
    input.value = value; return input;
  }

  private renderList() {
    if (this.closed) return;
    const later = this.tab === 'later';
    this.today.setAttribute('aria-selected', String(!later));
    this.later.setAttribute('aria-selected', String(later));
    this.rules.hidden = later; this.refresh.hidden = later;
    this.list.setAttribute('aria-label', t(later ? 'queue.later' : 'queue.today'));
    this.list.empty();
    if (later) {
      const items = Object.entries(this.plugin.state.readLater).sort(([, a], [, b]) => b.savedAt - a.savedAt);
      for (const [key, saved] of items) this.renderCard(saved.bundle.entry, [], key, saved.bundle);
      if (!items.length) this.list.createEl('p', { cls: 'qrs-research-empty', text: t('queue.emptyLater') });
    } else {
      const items = this.plugin.getResearchQueue();
      const matched = new Map(items.map(item => [item.entry.id, item.matched]));
      for (const group of groupPaperEntries(items.map(item => item.entry))) {
        if (group.kind === 'article') this.renderCard(group.entry, matched.get(group.entry.id) || []);
        else {
          const details = this.list.createEl('details', { cls: 'qrs-paper-group', attr: { 'data-paper-key': group.paper.key } });
          details.open = this.paperGroupsOpen.has(group.paper.key);
          details.createEl('summary', { text: `${t('paper.same', { n: group.entries.length })} · ${group.paper.id}` });
          details.ontoggle = () => { if (details.open) this.paperGroupsOpen.add(group.paper.key); else this.paperGroupsOpen.delete(group.paper.key); };
          for (const entry of group.entries) this.renderCard(entry, matched.get(entry.id) || [], undefined, undefined, details);
        }
      }
      if (!items.length) this.list.createEl('p', { cls: 'qrs-research-empty', text: t('queue.empty') });
    }
  }

  private renderCard(entry: Entry, matched: string[], savedKey?: string, savedBundle?: Bundle, parent = this.list) {
    const card = parent.createEl('article', { cls: 'qrs-research-card' });
    card.createEl('h3', { text: titleOf(entry) });
    const source = this.plugin.state.subscriptions.find(feed => feed.id === entry.sourceId)?.name || entry.sourceName || entry.sourceId;
    const date = entry.publishedTs && Number.isFinite(entry.publishedTs)
      ? new Date(entry.publishedTs).toLocaleDateString() : '';
    card.createDiv({ cls: 'qrs-research-meta', text: [source, date].filter(Boolean).join(' · ') });
    if (matched.length) card.createDiv({ cls: 'qrs-research-reason', text: t('queue.reason', { words: matched.join('、') }) });
    const actions = card.createDiv('qrs-research-actions');
    actions.createEl('button', { text: t('common.read'), attr: { type: 'button' } }).onclick = () => {
      if (this.busy) return;
      this.close();
      void this.plugin.openResearchArticle(entry, savedBundle).catch(() => new Notice(t('discovery.readFailed')));
    };
    if (savedKey !== undefined) {
      actions.createEl('button', { text: t('queue.remove'), attr: { type: 'button' } }).onclick = () => {
        void this.run(() => this.plugin.removeReadLater(savedKey));
      };
    } else {
      const alreadySaved = !!this.plugin.state.readLater[this.plugin.readLaterKey(entry)];
      const save = actions.createEl('button', { text: t(alreadySaved ? 'queue.saved' : 'queue.later'), attr: { type: 'button' } });
      save.disabled = alreadySaved;
      save.onclick = () => { void this.run(async () => { await this.plugin.addReadLater(entry); }, t('queue.saved')); };
    }
  }

  private async run(operation: () => Promise<void>, success = '', failure = t('common.saveFailedRetry')) {
    if (this.closed || this.busy) return;
    this.busy = true;
    const generation = this.generation;
    const controls = [...this.contentEl.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('button,input,textarea,select')]
      .map(control => ({ control, disabled: control.disabled }));
    for (const { control } of controls) control.disabled = true;
    this.status.setText(t('common.loading'));
    try {
      await operation();
      if (this.closed || this.generation !== generation) return;
      this.status.setText(success); this.renderList();
    } catch {
      if (!this.closed && this.generation === generation) this.status.setText(failure);
    } finally {
      if (!this.closed && this.generation === generation) {
        this.busy = false;
        for (const { control, disabled } of controls) control.disabled = disabled;
      }
    }
  }

  onClose() { this.closed = true; this.generation++; this.contentEl.empty(); }
}
