// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const previews = vi.hoisted(() => ({ opened: [] as HTMLElement[] }));
vi.mock('obsidian', async original => ({
  ...await original<object>(),
  Component: class { addChild(child: unknown) { return child; } },
  Modal: class {
    modalEl = document.createElement('div'); contentEl = document.createElement('div');
    onOpen() {} close() {}
    open() { previews.opened.push(this.contentEl); this.onOpen(); }
  },
  FuzzySuggestModal: class {},
  Notice: vi.fn(class {}),
}));
vi.mock('../src/source-icons', () => ({ SourceIcons: class { clear() {} render() {} } }));

import { DiscoveryPanel } from '../src/discovery-view';
import type ZhengtaoPicksPlugin from '../src/main';
import { initialState } from '../src/model';
import { domesticWechatSources } from '../src/domestic-wechat';
import { t } from '../src/i18n';

beforeAll(() => {
  Object.assign(HTMLElement.prototype, {
    addClass(name: string) { this.classList.add(name); },
    addClasses(names: string[]) { this.classList.add(...names); },
    toggleClass(name: string, value: boolean) { this.classList.toggle(name, value); },
    empty() { this.replaceChildren(); },
    setText(text: string) { this.textContent = text; },
    createEl(tag: string, options: { cls?: string; text?: string; type?: string; value?: string; attr?: Record<string, string> } = {}) {
      const child = document.createElement(tag);
      if (options.cls) child.className = options.cls;
      if (options.text) child.textContent = options.text;
      for (const key of ['type', 'value'] as const) if (options[key]) child.setAttribute(key, options[key]);
      for (const [key, value] of Object.entries(options.attr ?? {})) child.setAttribute(key, value);
      this.append(child); return child;
    },
    createDiv(options?: string | { cls?: string; text?: string; attr?: Record<string, string> }) {
      return this.createEl('div', typeof options === 'string' ? { cls: options } : options);
    },
    createSpan(options?: { cls?: string; text?: string }) { return this.createEl('span', options); },
  });
});
afterEach(() => { previews.opened = []; vi.clearAllMocks(); });

function discovery(state = initialState({ settings: { remoteImages: false } })) {
  const plugin = {
    state, app: { vault: { configDir: '.obsidian', adapter: { read: vi.fn(async () => { throw new Error('No optional cache'); }) } } },
    manifest: { id: 'zhengtao-ai-pick' }, addChild: vi.fn(), removeChild: vi.fn(),
    addDomesticWechat: vi.fn(async () => domesticWechatSources.length),
    openPersonalSource: vi.fn(async () => {}),
    subscriptions: { fetch: vi.fn(async () => ({ name: 'Account', entries: [] })), add: vi.fn() },
  };
  const content = document.createElement('div');
  const panel = new DiscoveryPanel(content, plugin as unknown as ZhengtaoPicksPlugin); panel.onload();
  const button = [...content.querySelectorAll('button')].find(item => item.textContent === t('domestic.add'))!;
  return { panel, plugin, content, button };
}

describe('domestic subscription entry points', () => {
  it('offers offline batch addition and prevents duplicate clicks while saving', async () => {
    const { panel, plugin, content, button } = discovery();
    let finish!: (count: number) => void;
    plugin.addDomesticWechat.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    button.click(); button.click();
    expect(plugin.addDomesticWechat).toHaveBeenCalledOnce(); expect(button.disabled).toBe(true);
    finish(domesticWechatSources.length);
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(content.textContent).toContain(t('domestic.added', { n: domesticWechatSources.length }));
    panel.onunload();
  });

  it('keeps the button usable after a failed save and displays retry guidance', async () => {
    const { panel, plugin, content, button } = discovery();
    plugin.addDomesticWechat.mockRejectedValueOnce(new Error('Disk unavailable'));
    button.click();
    await vi.waitFor(() => { expect(button.disabled).toBe(false); expect(content.textContent).toContain(t('common.saveFailedRetry')); });
    button.click();
    await vi.waitFor(() => expect(plugin.addDomesticWechat).toHaveBeenCalledTimes(2));
    panel.onunload();
  });

  it('recognizes an existing alias in both the card and source preview and opens its original source ID', async () => {
    const source = domesticWechatSources.find(item => item.aliases.length)!;
    const state = initialState({ settings: { remoteImages: false }, subscriptions: [{ id: 'local:my-account', url: source.aliases[0], name: 'Personal title', group: 'My group' }] });
    const { panel, plugin, content } = discovery(state);
    Object.assign(panel, { collection: 'wechat' }); panel.refresh();
    const card = content.querySelector<HTMLElement>(`[data-feed="${source.id}"]`)!;
    expect(card.textContent).toContain(t('discovery.subscribed'));
    [...card.querySelectorAll('button')].find(item => item.textContent === t('common.read'))!.click();
    expect(plugin.openPersonalSource).toHaveBeenCalledWith('local:my-account');
    card.querySelector<HTMLButtonElement>('.qrs-source-name')!.click();
    const preview = previews.opened.at(-1)!;
    const read = [...preview.querySelectorAll('button')].find(item => item.textContent === t('common.read'))!;
    await vi.waitFor(() => expect(read.disabled).toBe(false)); read.click();
    expect(plugin.openPersonalSource).toHaveBeenLastCalledWith('local:my-account');
    expect(plugin.subscriptions.add).not.toHaveBeenCalled(); panel.onunload();
  });
});
