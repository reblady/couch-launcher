'use strict';

// Neue Instanzen anlegen und Inhalte (Mods, Ressourcenpakete, Shader) einer Instanz verwalten.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { gameDir, isValidId } = require('./instances');
const { cleanName } = require('./instancecfg');

const META = 'https://meta.prismlauncher.org/v1';

const LOADERS = {
  fabric: { label: 'Fabric', uid: 'net.fabricmc.fabric-loader', intermediary: true },
  quilt: { label: 'Quilt', uid: 'org.quiltmc.quilt-loader', intermediary: true },
  neoforge: { label: 'NeoForge', uid: 'net.neoforged' },
  forge: { label: 'Forge', uid: 'net.minecraftforge' },
};

const CONTENT = {
  mod: { dir: 'mods', exts: ['.jar'] },
  resourcepack: { dir: 'resourcepacks', exts: ['.zip'] },
  shader: { dir: 'shaderpacks', exts: ['.zip'] },
};

const DISABLED = '.disabled';

// Controlify (Modrinth): ohne diese Mod lässt sich Minecraft nicht mit dem Controller spielen
const CONTROLIFY_ID = 'DOUdJVEm';

// ---------- Neue Instanz ----------

// Ordnername aus dem Anzeigenamen, ohne Konflikt mit vorhandenen Ordnern
function uniqueId(name, instancesDir) {
  const base =
    cleanName(name)
      .replace(/[^\p{L}\p{N} ._()-]/gu, '')
      .replace(/ +/g, ' ')
      .replace(/^[-._ ]+/, '')
      .replace(/[. ]+$/, '') || 'Modpack';
  let id = base;
  for (let n = 2; fs.existsSync(path.join(instancesDir, id)); n++) id = `${base} (${n})`;
  return id;
}

// Neueste passende Loader-Version aus Prisms Versionsliste (neueste zuerst)
function pickLoaderVersion(versions, mc) {
  const fits = versions.filter((v) => {
    const req = (v.requires || []).find((r) => r.uid === 'net.minecraft');
    return !req || req.equals === mc;
  });
  const stable = fits.filter((v) => !v.type || v.type === 'release');
  const pool = stable.length ? stable : fits;
  return (pool.find((v) => v.recommended) || pool[0] || {}).version || null;
}

async function fetchOptions(fetchJson) {
  const index = await fetchJson(`${META}/net.minecraft/index.json`);
  const minecraft = index.versions.filter((v) => v.type === 'release').map((v) => v.version);
  const loaders = Object.entries(LOADERS).map(([value, l]) => ({ value, label: l.label }));
  return { minecraft, loaders };
}

// Die Java-Version, die Prism für diese Minecraft-Version automatisch wählt.
// In der instance.cfg steht sie erst, nachdem Prism sie einmal geprüft hat.
async function gameJavaMajor(fetchJson, mc) {
  const meta = await fetchJson(`${META}/net.minecraft/${encodeURIComponent(mc)}.json`);
  const majors = meta.compatibleJavaMajors || [];
  return majors.length ? Math.max(...majors) : null;
}

async function loaderVersion(fetchJson, loader, mc) {
  const def = LOADERS[loader];
  if (def.intermediary) {
    const mappings = await fetchJson(`${META}/net.fabricmc.intermediary/index.json`);
    if (!mappings.versions.some((v) => v.version === mc)) return null;
  }
  const index = await fetchJson(`${META}/${def.uid}/index.json`);
  return pickLoaderVersion(index.versions, mc);
}

// Prism ergänzt fehlende Abhängigkeiten (LWJGL, Intermediary) beim ersten Start selbst
function packJson(mc, loader, version) {
  const components = [{ uid: 'net.minecraft', version: mc, important: true }];
  if (loader) components.push({ uid: LOADERS[loader].uid, version });
  return { formatVersion: 1, components };
}

function instanceCfgText(name, extra = {}) {
  const values = { ConfigVersion: '1.3', InstanceType: 'OneSix', iconKey: 'default', ...extra, name };
  return `[General]\n${Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n')}\n`;
}

function createInstance(instancesDir, { name, mc, loader, version }) {
  const title = cleanName(name) || 'Modpack';
  const id = uniqueId(title, instancesDir);
  if (!isValidId(id)) throw new Error('Ungültiger Name.');
  const dir = path.join(instancesDir, id);
  fs.mkdirSync(dir);
  fs.mkdirSync(path.join(dir, 'minecraft', 'mods'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'mmc-pack.json'), JSON.stringify(packJson(mc, loader, version), null, 4) + '\n');
  // instance.cfg zuletzt: erst damit gilt der Ordner für Prism als Instanz
  fs.writeFileSync(path.join(dir, 'instance.cfg'), instanceCfgText(title));
  return id;
}

// ---------- Inhalte einer Instanz ----------

function contentDir(instDir, type) {
  return path.join(gameDir(instDir), CONTENT[type].dir);
}

function isContentFile(name, type) {
  const lower = name.toLowerCase();
  const plain = lower.endsWith(DISABLED) ? lower.slice(0, -DISABLED.length) : lower;
  return !name.startsWith('.') && CONTENT[type].exts.some((e) => plain.endsWith(e));
}

// Dateinamen kommen vom Renderer oder aus dem Netz, sie dürfen nie aus dem Ordner herausführen
function safeFileName(name, type) {
  return typeof name === 'string' && !/[\\/\x00-\x1f]/.test(name) && isContentFile(name, type);
}

function displayName(file) {
  return file.replace(/\.disabled$/i, '').replace(/\.(jar|zip)$/i, '');
}

function listContent(instDir, type) {
  let entries;
  try {
    entries = fs.readdirSync(contentDir(instDir, type), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && isContentFile(e.name, type))
    .map((e) => ({
      file: e.name,
      name: displayName(e.name),
      enabled: !e.name.toLowerCase().endsWith(DISABLED),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function controlifyFiles(items) {
  return items.filter((i) => /^controlify[-_ .]/i.test(i.file));
}

// 'ok', 'disabled' (liegt im Ordner, ist aber aus) oder 'missing'
function controlifyState(items) {
  const files = controlifyFiles(items);
  if (!files.length) return 'missing';
  return files.some((i) => i.enabled) ? 'ok' : 'disabled';
}

async function sha1(file) {
  return crypto.createHash('sha1').update(await fs.promises.readFile(file)).digest('hex');
}

async function hashContent(instDir, type, items) {
  const dir = contentDir(instDir, type);
  const out = [];
  for (const item of items) out.push({ ...item, sha1: await sha1(path.join(dir, item.file)) });
  return out;
}

function setEnabled(instDir, type, file, enabled) {
  if (!safeFileName(file, type)) throw new Error('Ungültiger Dateiname.');
  const dir = contentDir(instDir, type);
  const isOff = file.toLowerCase().endsWith(DISABLED);
  const target = enabled ? (isOff ? file.slice(0, -DISABLED.length) : file) : isOff ? file : file + DISABLED;
  if (target !== file) fs.renameSync(path.join(dir, file), path.join(dir, target));
  return target;
}

// Prism führt eigene Einträge in .index, die dürfen nach dem Löschen nicht liegen bleiben
function removeIndexEntry(dir, file) {
  const index = path.join(dir, '.index');
  const plain = file.replace(/\.disabled$/i, '');
  let names;
  try {
    names = fs.readdirSync(index);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.endsWith('.pw.toml')) continue;
    const p = path.join(index, name);
    const match = fs.readFileSync(p, 'utf8').match(/^filename\s*=\s*['"](.*)['"]\s*$/m);
    if (match && match[1] === plain) fs.rmSync(p);
  }
}

function removeContent(instDir, type, file) {
  if (!safeFileName(file, type)) throw new Error('Ungültiger Dateiname.');
  const dir = contentDir(instDir, type);
  fs.rmSync(path.join(dir, file));
  removeIndexEntry(dir, file);
}

// Hebt den Loader einer Instanz an. Prism holt die Dateien beim nächsten Start selbst.
function setLoaderVersion(instDir, loader, version) {
  const file = path.join(instDir, 'mmc-pack.json');
  const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
  const component = pack.components.find((c) => c.uid === LOADERS[loader].uid);
  if (!component) throw new Error('Loader nicht gefunden.');
  component.version = version;
  component.cachedVersion = version;
  const tmp = `${file}.couch.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(pack, null, 4) + '\n');
  fs.renameSync(tmp, file);
}

// Lädt eine Datei vom Modrinth-CDN und prüft den Hash. Geschrieben wird noch nichts.
async function fetchVerified(fetchFn, type, file) {
  const url = new URL(file.url);
  if (url.protocol !== 'https:' || url.hostname !== 'cdn.modrinth.com') throw new Error('Unerwartete Download-Adresse.');
  if (!safeFileName(file.filename, type)) throw new Error('Unerwarteter Dateiname.');

  const res = await fetchFn(file.url, { headers: { 'User-Agent': 'couch-launcher/0.1.0' } });
  if (!res.ok) throw new Error(`Download fehlgeschlagen (${res.status})`);
  const data = Buffer.from(await res.arrayBuffer());
  const hash = crypto.createHash('sha512').update(data).digest('hex');
  if (hash !== file.hashes.sha512) throw new Error(`Prüfsumme stimmt nicht: ${file.filename}`);
  return data;
}

function writeContent(instDir, type, file, data) {
  const dir = contentDir(instDir, type);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${file.filename}.part`);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, path.join(dir, file.filename));
}

async function downloadFile(fetchFn, instDir, type, file) {
  writeContent(instDir, type, file, await fetchVerified(fetchFn, type, file));
}

module.exports = {
  LOADERS,
  CONTENT,
  uniqueId,
  pickLoaderVersion,
  fetchOptions,
  gameJavaMajor,
  loaderVersion,
  packJson,
  instanceCfgText,
  createInstance,
  contentDir,
  safeFileName,
  listContent,
  CONTROLIFY_ID,
  controlifyFiles,
  controlifyState,
  hashContent,
  setEnabled,
  removeContent,
  setLoaderVersion,
  fetchVerified,
  writeContent,
  downloadFile,
};
