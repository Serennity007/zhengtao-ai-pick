#!/usr/bin/env node
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { randomUUID, webcrypto } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ID = 'zhengtao-ai-pick';
const PREDECESSORS = ['qiaomu-ai-rss', 'zhengtao-picks'];
const PROGRAM_FILES = ['main.js', 'manifest.json', 'styles.css', 'LICENSE', 'THIRD_PARTY_NOTICES.md'];
class InstallError extends Error {}
const stop = message => { throw new InstallError(message); };

function argumentsFor(argv) {
  const options = { apply: false, help: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--vault' || arg === '--backup') {
      const key = arg.slice(2), value = argv[++index];
      if (!value || value.startsWith('--') || options[key]) stop(`Provide ${arg} once with an absolute path.`);
      options[key] = value;
    } else stop('Unknown argument. Run with --help for usage.');
  }
  if (!options.help && (!options.vault || !options.backup || !isAbsolute(options.vault) || !isAbsolute(options.backup))) {
    stop('--vault and --backup must both be absolute paths.');
  }
  return options;
}

async function info(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function within(parent, child) {
  const rest = relative(parent, child);
  return rest === '' || (!isAbsolute(rest) && rest !== '..' && !rest.startsWith(`..${sep}`));
}
async function prospectivePath(path) {
  const missing = [];
  let ancestor = resolve(path);
  while (!(await info(ancestor))) {
    missing.unshift(ancestor.slice(dirname(ancestor).length + (dirname(ancestor).endsWith(sep) ? 0 : 1)));
    const next = dirname(ancestor);
    if (next === ancestor) stop('The backup path has no accessible parent.');
    ancestor = next;
  }
  return join(await realpath(ancestor), ...missing);
}
async function regularFile(path, label, optional = false) {
  const stat = await info(path);
  if (!stat && optional) return null;
  if (!stat?.isFile() || stat.isSymbolicLink()) stop(`${label} must be a regular file.`);
  return readFile(path);
}
function json(bytes, label) {
  try { return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); }
  catch { stop(`${label} contains invalid JSON; no data was printed.`); }
}
async function directory(path, label, optional = false) {
  const stat = await info(path);
  if (!stat && optional) return false;
  if (!stat?.isDirectory() || stat.isSymbolicLink()) stop(`${label} must be a directory without a symbolic link or junction.`);
  return true;
}
async function copyChecked(from, to) {
  await cp(from, to, {
    recursive: true, force: false, errorOnExist: false, dereference: false, preserveTimestamps: true,
    filter: async source => {
      if ((await lstat(source)).isSymbolicLink()) stop('A plugin backup contains a symbolic link or junction; installation stopped.');
      return true;
    },
  });
}
async function atomicWrite(path, bytes) {
  const temporary = join(dirname(path), `.zhengtao-install-${randomUUID()}.tmp`);
  try { await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 }); await rename(temporary, path); }
  finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

function obsidianClosed() {
  try {
    if (process.platform === 'win32') {
      const result = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[bool](Get-Process -Name Obsidian -ErrorAction SilentlyContinue)'], {
        encoding: 'utf8', windowsHide: true, timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'],
      }).trim().toLowerCase();
      if (result !== 'true' && result !== 'false') stop('Could not verify that Obsidian is closed.');
      return result === 'false';
    }
    execFileSync('pgrep', ['-ix', 'obsidian'], { timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
    return false;
  } catch (error) {
    if (error instanceof InstallError) throw error;
    if (process.platform !== 'win32' && error.status === 1) return true;
    stop('Could not verify that Obsidian is closed.');
  }
}

async function migrationTools(sourceRoot) {
  const compiled = await build({
    absWorkingDir: sourceRoot,
    stdin: { contents: 'export { createIntegratedState } from "./src/legacy-import.ts"; export { initialState } from "./src/model.ts";', resolveDir: sourceRoot, sourcefile: 'install-migration-entry.ts', loader: 'ts' },
    bundle: true, format: 'cjs', platform: 'node', target: 'node20', write: false, logLevel: 'silent',
    plugins: [{ name: 'offline-obsidian-language', setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'installer-mock' }));
      builder.onLoad({ filter: /.*/, namespace: 'installer-mock' }, () => ({ contents: 'export function getLanguage() { return "zh"; }', loader: 'js' }));
    } }],
  });
  const module = { exports: {} };
  const evaluate = new Function('module', 'exports', 'require', 'window', 'crypto', compiled.outputFiles[0].text);
  evaluate(module, module.exports, createRequire(import.meta.url), { crypto: webcrypto }, webcrypto);
  return module.exports;
}
function counts(state) {
  return {
    subscriptions: state.subscriptions.length, groups: state.subscriptionGroups.length,
    pinnedGroups: state.settings.pinnedGroupIds.length, readIds: state.readIds.length,
    favorites: Object.keys(state.favorites).length, savedArticles: Object.keys(state.savedArticles).length,
    cachedArticles: Object.keys(state.cache).length, savedNoteLinks: Object.keys(state.articleNotes).length,
    feedArticles: state.subscriptions.reduce((total, feed) => total + feed.entries.length, 0),
  };
}

/** Change only the predecessor's exact view type; note paths and other views stay intact. */
export function migrateWorkspaceViews(value) {
  let changed = 0;
  const visit = node => {
    if (Array.isArray(node)) { for (const item of node) visit(item); }
    else if (node !== null && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        if (key === 'type' && child === 'zhengtao-picks-view') { node[key] = 'zhengtao-ai-pick-reader'; changed++; }
        else visit(child);
      }
    }
  };
  visit(value); return changed;
}

async function main() {
  const options = argumentsFor(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/install-local.mjs --vault <absolute-vault-path> --backup <absolute-new-backup-directory> [--apply]\nDefault: preview only. --apply requires Obsidian to be closed. The backup parent must exist outside the vault and source tree. Existing independent-plugin data is preserved.');
    return;
  }
  const sourceRoot = await realpath(fileURLToPath(new URL('..', import.meta.url)));
  const vault = await realpath(options.vault);
  await directory(vault, 'Vault');
  if (within(sourceRoot, vault)) stop('The vault must be outside the source tree.');
  const config = join(vault, '.obsidian'), plugins = join(config, 'plugins');
  await directory(config, 'Vault .obsidian');
  await directory(plugins, 'Vault plugins', true);
  const backup = await prospectivePath(options.backup);
  if (within(vault, backup) || within(sourceRoot, backup)) stop('The backup must be outside both the vault and source tree.');
  if (await info(backup)) stop('The backup directory must not already exist. Choose a new directory.');
  await directory(dirname(backup), 'Backup parent');
  const target = join(plugins, PLUGIN_ID);
  const targetExisted = await directory(target, 'Independent plugin', true);
  for (const id of PREDECESSORS) await directory(join(plugins, id), `Predecessor ${id}`, true);

  const program = new Map();
  for (const name of PROGRAM_FILES) program.set(name, await regularFile(join(sourceRoot, name), `Build ${name}`));
  const manifest = json(program.get('manifest.json'), 'Build manifest');
  const packageJson = json(await regularFile(join(sourceRoot, 'package.json'), 'Package metadata'), 'Package metadata');
  if (manifest.id !== PLUGIN_ID || manifest.version !== packageJson.version || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(manifest.version)) {
    stop('Build manifest ID/version does not match this project. Build the independent plugin first.');
  }
  if (!program.get('main.js').length || !program.get('styles.css').length) stop('The runtime build is empty. Run npm run build first.');
  const installedManifest = await regularFile(join(target, 'manifest.json'), 'Installed manifest', true);
  if (installedManifest && json(installedManifest, 'Installed manifest').id !== PLUGIN_ID) stop('The target directory belongs to a different plugin.');

  const communityPath = join(config, 'community-plugins.json');
  const communityOriginal = await regularFile(communityPath, 'Community plugin list', true);
  const community = communityOriginal ? json(communityOriginal, 'Community plugin list') : [];
  if (!Array.isArray(community) || community.some(id => typeof id !== 'string')) stop('The community plugin list must contain only plugin IDs.');
  const enabled = [...new Set([...community.filter(id => id !== 'zhengtao-picks'), PLUGIN_ID])];
  const workspaces = new Map();
  for (const name of await readdir(config)) {
    if (!name.startsWith('workspace') || !name.endsWith('.json')) continue;
    const original = await regularFile(join(config, name), 'Workspace configuration');
    const data = json(original, 'Workspace configuration'), changes = migrateWorkspaceViews(data);
    workspaces.set(name, { original, changes, updated: JSON.stringify(data, null, 2) + '\n' });
  }
  const previous = [];
  for (const id of PREDECESSORS) {
    const bytes = await regularFile(join(plugins, id, 'data.json'), `Predecessor ${id} data`, true);
    previous.push(bytes ? json(bytes, `Predecessor ${id} data`) : null);
  }
  const ownBytes = await regularFile(join(target, 'data.json'), 'Independent plugin data', true);
  let state;
  try {
    const tools = await migrationTools(sourceRoot);
    state = ownBytes ? tools.initialState(json(ownBytes, 'Independent plugin data')) : await tools.createIntegratedState(...previous);
  } catch { stop('Could not prepare the reader state. Existing files were not changed and no data was printed.'); }
  console.log(JSON.stringify({ mode: options.apply ? 'apply' : 'preview', pluginId: PLUGIN_ID, version: manifest.version, existingDataPreserved: Boolean(ownBytes), predecessorDataFound: previous.map(value => value !== null), counts: counts(state), workspaceViewsToMigrate: [...workspaces.values()].reduce((total, item) => total + item.changes, 0), enabledPluginCount: enabled.length }, null, 2));
  if (!options.apply) { console.log('Preview complete. No files or directories were written.'); return; }
  if (!obsidianClosed()) stop('Close Obsidian before running with --apply. The installer does not close it for you.');

  await mkdir(backup, { mode: 0o700 });
  const recordPath = join(backup, 'install-state.json');
  const record = { status: 'backing-up', pluginId: PLUGIN_ID, version: manifest.version, vault, sourceRoot, targetExisted, originalDataExisted: Boolean(ownBytes), originalCommunityListExisted: Boolean(communityOriginal), programFiles: PROGRAM_FILES, wroteFiles: [], changedWorkspaceFiles: [], communityRestored: false, workspacesRestored: false };
  let changed = false;
  const saveRecord = () => atomicWrite(recordPath, JSON.stringify(record, null, 2) + '\n');
  try {
    await saveRecord();
    await mkdir(join(backup, 'config'));
    await mkdir(join(backup, 'plugins'));
    for (const name of await readdir(config)) {
      if (name === 'community-plugins.json' || (name.startsWith('workspace') && name.endsWith('.json'))) {
        await regularFile(join(config, name), 'Vault configuration backup');
        await copyChecked(join(config, name), join(backup, 'config', name));
      }
    }
    for (const id of [...PREDECESSORS, PLUGIN_ID]) {
      const folder = join(plugins, id);
      if (await directory(folder, `Plugin ${id}`, true)) await copyChecked(folder, join(backup, 'plugins', id));
    }
    record.status = 'backed-up'; await saveRecord();
    if (!obsidianClosed()) stop('Obsidian started during backup. Close it and retry with a new backup directory.');
    // A concurrent writer must not lose data even if the process check was clear.
    if (Boolean(await info(join(target, 'data.json'))) !== Boolean(ownBytes)) stop('The target data changed during backup; retry after checking the vault.');
    const currentCommunity = await regularFile(communityPath, 'Community plugin list', true);
    if (Boolean(currentCommunity) !== Boolean(communityOriginal) || (currentCommunity && !currentCommunity.equals(communityOriginal))) stop('The enabled plugin list changed during backup; retry after checking the vault.');
    for (const [name, item] of workspaces) {
      const current = await regularFile(join(config, name), 'Workspace configuration');
      if (!current.equals(item.original)) stop('A workspace changed during backup; retry after checking the vault.');
    }
    await mkdir(target, { recursive: true }); changed = true;
    if (!ownBytes) {
      const oldImages = join(plugins, 'qiaomu-ai-rss', 'image-cache'), newImages = join(target, 'image-cache');
      await directory(newImages, 'Independent image cache', true);
      if (await directory(oldImages, 'Predecessor image cache', true)) { await copyChecked(oldImages, newImages); record.wroteFiles.push('image-cache/'); }
    }
    for (const [name, bytes] of program) { await atomicWrite(join(target, name), bytes); record.wroteFiles.push(name); await saveRecord(); }
    if (!ownBytes) {
      await writeFile(join(target, 'data.json'), JSON.stringify(state, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      record.wroteFiles.push('data.json'); await saveRecord();
    }
    const copied = json(await regularFile(join(target, 'manifest.json'), 'Copied manifest'), 'Copied manifest');
    if (copied.id !== manifest.id || copied.version !== manifest.version) stop('The copied manifest does not match the build.');
    for (const [name, item] of workspaces) {
      if (!item.changes) continue;
      record.changedWorkspaceFiles.push(name); await saveRecord();
      await atomicWrite(join(config, name), item.updated); record.wroteFiles.push(`../${name}`); await saveRecord();
    }
    await atomicWrite(communityPath, JSON.stringify(enabled, null, 2) + '\n');
    record.wroteFiles.push('../community-plugins.json'); record.status = 'installed'; await saveRecord();
    console.log('Installation complete. Obsidian remains closed; predecessor data and old note URIs were preserved.');
  } catch (error) {
    if (changed) {
      try {
        if (communityOriginal) await atomicWrite(communityPath, communityOriginal);
        else await unlink(communityPath).catch(failure => { if (failure.code !== 'ENOENT') throw failure; });
        record.communityRestored = true;
      } catch { record.communityRestored = false; }
      record.workspacesRestored = true;
      for (const name of record.changedWorkspaceFiles) {
        try { await atomicWrite(join(config, name), workspaces.get(name).original); }
        catch { record.workspacesRestored = false; }
      }
    }
    record.status = 'failed'; record.partialInstallationPossible = changed;
    record.recovery = 'Keep Obsidian closed. Restore config/community-plugins.json and changed workspace files from this backup if necessary. Restore plugins/zhengtao-ai-pick from this backup if it existed; otherwise leave the partial new plugin disabled. The installer never removes plugin directories or changes predecessor files.';
    await saveRecord().catch(() => {});
    if (changed && (!record.communityRestored || !record.workspacesRestored)) stop('Installation failed and configuration could not be fully restored. Keep Obsidian closed and use install-state.json in the external backup to restore it.');
    stop(error instanceof InstallError ? error.message : 'Installation failed. The enabled list and changed workspaces were restored if installation had started; inspect install-state.json in the external backup.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof InstallError ? error.message : 'Installer could not complete. No private data was printed. Check the paths, permissions and build files.');
    process.exitCode = 1;
  });
}
