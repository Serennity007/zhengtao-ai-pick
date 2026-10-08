// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// obsidian 是纯类型包，运行时拿不到任何东西，所以把 channel-picker 用到的部分补齐。
vi.mock('obsidian', () => ({
  Component: class {
    load() { (this as unknown as { onload?: () => void }).onload?.(); }
    unload() {}
    register() {}
    registerDomEvent() {}
    addChild() {}
  },
  Platform: { isMobileApp: false, isMobile: false },
  setIcon: vi.fn(),
  Notice: class {},
  getLanguage: () => 'zh-CN',
}));

import { ChannelPicker, type ChannelChoice } from '../src/channel-picker';

Object.assign(HTMLElement.prototype, {
  addClass(name: string) { this.classList.add(name); },
  empty() { this.replaceChildren(); },
  setText(text: string) { this.textContent = text; },
  createEl(tag: string, options: { cls?: string; text?: string; type?: string; attr?: Record<string, string> } = {}) {
    const el = document.createElement(tag);
    if (options.cls) el.className = options.cls;
    if (options.text) el.textContent = options.text;
    if (options.type) el.setAttribute('type', options.type);
    for (const [key, value] of Object.entries(options.attr ?? {})) el.setAttribute(key, String(value));
    this.append(el);
    return el;
  },
  createDiv(options: string | { cls?: string; text?: string; attr?: Record<string, string> }) {
    return this.createEl('div', typeof options === 'string' ? { cls: options } : options);
  },
  createSpan(options: string | { cls?: string; text?: string }) {
    return this.createEl('span', typeof options === 'string' ? { cls: options } : options);
  },
  setCssProps(props: Record<string, string>) {
    for (const [key, value] of Object.entries(props)) this.style.setProperty(key, value);
  },
});
Element.prototype.scrollIntoView = function scrollIntoView() {};

const choice = (partial: Partial<ChannelChoice> & { id: string; name: string; section: ChannelChoice['section'] }): ChannelChoice =>
  ({ subtitle: '', ...partial });

/** 形状照抄 view.ts 的 channelChoices()：id '' 是「乔木精选」下的全部行，@local 是「我的订阅」下的全部行。
 *  注意非搜索态渲染的是 `short || name`，所以断言里 @local 那行显示的是「所有订阅」而不是「全部订阅」。 */
const choices = (): ChannelChoice[] => [
  choice({ id: '', name: '乔木精选', short: '全部', section: '聚合' }),
  choice({ id: '@local', name: '全部订阅', short: '所有订阅', section: '聚合' }),
  choice({ id: '@group:zhengtao', name: '正涛精选', section: '订阅分组', icon: 'folder' }),
  choice({ id: '@group:gzh', name: '公众号', section: '订阅分组', icon: 'folder' }),
  choice({ id: 'community-a', name: '读者社区源', section: '读者社区' }),
  choice({ id: 'local:1', name: 'Simon Willison', section: '我的订阅源', group: 'zhengtao' }),
  choice({ id: 'local:2', name: '向阳乔木推荐看', section: '我的订阅源', group: 'gzh' }),
];

function open(pinnedGroups: string[]) {
  const anchor = document.createElement('button');
  document.body.append(anchor);
  const picker = new ChannelPicker(anchor, choices(), '', () => {}, () => {}, undefined, undefined, undefined, pinnedGroups);
  picker.load();
  const rows = document.querySelector<HTMLElement>('.qrs-channel-picker .qrs-channel-options')!;
  const sections = [...rows.children].filter(el => el.classList.contains('qrs-channel-section')).map(el => el.textContent);
  const order = [...rows.children].map(el =>
    el.classList.contains('qrs-channel-section') ? `§ ${el.textContent}` : `  · ${el.querySelector('.qrs-channel-name')?.textContent ?? ''}`
  );
  return { rows, sections, order, search(value: string) { const input = document.querySelector<HTMLInputElement>('.qrs-channel-top input')!; input.value = value; input.oninput!(); } };
}

beforeEach(() => { document.body.replaceChildren(); });

describe('channel picker pinned groups', () => {
  it('renders a pinned group as its own section between 读者社区 and 我的订阅', () => {
    const { sections, order } = open(['zhengtao']);
    expect(sections).toEqual(['乔木精选', '读者社区', '正涛精选', '我的订阅']);
    expect(order).toEqual([
      '§ 乔木精选', '  · 全部',
      '§ 读者社区', '  · 读者社区源',
      '§ 正涛精选', '  · 正涛精选',
      '§ 我的订阅', '  · 所有订阅', '  · 公众号',
    ]);
  });

  it('shows the pinned group exactly once, not also under 我的订阅', () => {
    const { rows } = open(['zhengtao']);
    const names = [...rows.querySelectorAll('.qrs-channel-name')].map(el => el.textContent);
    expect(names.filter(name => name === '正涛精选')).toHaveLength(1);
  });

  it('leaves the upstream order untouched when nothing is pinned', () => {
    const { sections, order } = open([]);
    expect(sections).toEqual(['乔木精选', '读者社区', '我的订阅']);
    expect(order).toEqual([
      '§ 乔木精选', '  · 全部',
      '§ 读者社区', '  · 读者社区源',
      '§ 我的订阅', '  · 所有订阅', '  · 正涛精选', '  · 公众号',
    ]);
  });

  it('labels a pinned group with its own name and an unpinned one with 我的订阅', () => {
    const picker = open(['zhengtao']);
    picker.search('正涛精选');
    const pinnedRow = [...document.querySelectorAll<HTMLElement>('.qrs-channel-option-wrap')]
      .find(el => el.querySelector('.qrs-channel-name')?.textContent === '正涛精选')!;
    expect(pinnedRow.querySelector('.qrs-channel-subtitle')?.textContent).toBe('正涛精选');

    picker.search('公众号');
    const unpinnedRow = [...document.querySelectorAll<HTMLElement>('.qrs-channel-option-wrap')]
      .find(el => el.querySelector('.qrs-channel-name')?.textContent === '公众号')!;
    expect(unpinnedRow.querySelector('.qrs-channel-subtitle')?.textContent).toBe('我的订阅');
  });

  it('ignores a pinned id whose group no longer exists', () => {
    const { sections, order } = open(['deleted-group-id']);
    expect(sections).toEqual(['乔木精选', '读者社区', '我的订阅']);
    expect(order.filter(line => line.includes('正涛精选'))).toHaveLength(1);
  });
});
