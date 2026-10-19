import type { Vault } from 'obsidian';
import { createIntegratedState } from './legacy-import';
import { domesticWechatSourcesToAdd } from './domestic-wechat';
import { Subscriptions } from './subscriptions';

/** Read predecessor data once; their files and historical note links remain owned by them. */
export async function firstRunState(vault: Pick<Vault, 'configDir' | 'adapter'>) {
  const read = async (id: string): Promise<unknown> => {
    const path = `${vault.configDir}/plugins/${id}/data.json`;
    return await vault.adapter.exists(path) ? JSON.parse(await vault.adapter.read(path)) as unknown : null;
  };
  return createFirstRunState(await read('qiaomu-ai-rss'), await read('zhengtao-picks'));
}

/** Shared by Obsidian startup and the offline installer; no network or disk writes. */
export async function createFirstRunState(upstreamData: unknown, legacyData: unknown) {
  const state = await createIntegratedState(upstreamData, legacyData);
  await new Subscriptions(() => state, async () => {}).import(domesticWechatSourcesToAdd(state.subscriptions));
  return state;
}
