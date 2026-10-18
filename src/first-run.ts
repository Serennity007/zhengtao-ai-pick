import type { Vault } from 'obsidian';
import { createIntegratedState } from './legacy-import';

/** Read predecessor data once; their files and historical note links remain owned by them. */
export async function firstRunState(vault: Pick<Vault, 'configDir' | 'adapter'>) {
  const read = async (id: string): Promise<unknown> => {
    const path = `${vault.configDir}/plugins/${id}/data.json`;
    return await vault.adapter.exists(path) ? JSON.parse(await vault.adapter.read(path)) as unknown : null;
  };
  return createIntegratedState(await read('qiaomu-ai-rss'), await read('zhengtao-picks'));
}
