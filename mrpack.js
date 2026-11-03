'use strict';

const { t } = require('./i18n');

// Installiert fertige Modpacks (.mrpack) als Prism-Instanz. Der Inhalt einer .mrpack-Datei kommt aus dem
// Netz: Pfade und Download-Adressen werden deshalb genauso streng geprüft wie bei einzelnen Mods.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zip = require('./zip');
const { gameDir } = require('./instances');
const { LOADERS, uniqueId, instanceCfgText, packJson, setLoaderVersion } = require('./modpacks');
const { cleanName, editCfg } = require('./instancecfg');
const { isNewer } = require('./modcheck');

const TEMP_PREFIX = '.couch-install-';
const UPDATE_DIR = '.couch-update';
const DISABLED = '.disabled';
const MODS_PREFIX = 'mods/';
// Inhalte, die zum Pack gehören und immer ersetzt werden. Alles andere können eigene Einstellungen sein.
const PACK_OWNED = ['mods/', 'resourcepacks/', 'shaderpacks/'];
const INDEX = 'modrinth.index.json';
const OVERRIDES = ['overrides/', 'client-overrides/'];
const PARALLEL = 6;
const DOWNLOAD_TIMEOUT = 120000;
// Laut Modrinth-Format dürfen Dateien nur von diesen Adressen kommen
const HOSTS = ['cdn.modrinth.com', 'github.com', 'raw.githubusercontent.com', 'gitlab.com'];
const LOADER_KEYS = {
  'fabric-loader': 'fabric',
  'quilt-loader': 'quilt',
  neoforge: 'neoforge',
  forge: 'forge',
};
const ICON_EXT = ['.png', '.webp', '.jpg', '.jpeg', '.gif'];

// Relativer Pfad, der den Spielordner nicht verlassen kann
function isSafePath(p) {
  if (typeof p !== 'string' || !p || p.startsWith('/') || /[\\:\x00-\x1f]/.test(p)) return false;
  return p.split('/').every((part) => part && part !== '.' && part !== '..');
}

function isAllowedUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

function parseIndex(text) {
  const index = JSON.parse(text);
  const deps = index.dependencies || {};
  if (index.game !== 'minecraft' || !deps.minecraft) throw new Error(t('Das ist kein Minecraft-Modpack.'));
  const key = Object.keys(LOADER_KEYS).find((k) => deps[k]);
  const files = (index.files || []).filter((f) => !f.env || f.env.client !== 'unsupported');
  for (const f of files) {
    if (!isSafePath(f.path)) throw new Error(t('Unsicherer Pfad im Modpack: {path}', { path: f.path }));
    if (!f.hashes || !/^[0-9a-f]{128}$/.test(f.hashes.sha512 || '')) throw new Error(t('Prüfsumme fehlt: {path}', { path: f.path }));
    if (!Array.isArray(f.downloads) || !f.downloads.some(isAllowedUrl)) {
      throw new Error(t('Unerlaubte Download-Adresse: {path}', { path: f.path }));
    }
  }
  return {
    name: index.name,
    mc: deps.minecraft,
    loader: key ? LOADER_KEYS[key] : null,
    loaderVersion: key ? deps[key] : null,
    files,
  };
}

// Map(relativer Pfad -> ZIP-Eintrag). client-overrides kommen danach und gehen deshalb vor.
function overrideEntries(entries) {
  const out = new Map();
  for (const prefix of OVERRIDES) {
    for (const entry of entries) {
      if (!entry.name.startsWith(prefix) || entry.name.endsWith('/')) continue;
      const rel = entry.name.slice(prefix.length);
      if (!isSafePath(rel)) throw new Error(t('Unsicherer Pfad im Modpack: {path}', { path: entry.name }));
      out.set(rel, entry);
    }
  }
  return out;
}

function extractOverrides(buf, entries, targetDir) {
  for (const [rel, entry] of overrideEntries(entries)) {
    const target = path.join(targetDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, zip.extract(buf, entry));
  }
}

async function downloadVerified(fetchFn, file) {
  let lastError = null;
  for (const url of file.downloads.filter(isAllowedUrl)) {
    try {
      const res = await fetchFn(url, {
        headers: { 'User-Agent': 'couch-launcher/0.1.0' },
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT),
      });
      if (!res.ok) throw new Error(t('Fehler {status}', { status: res.status }));
      const data = Buffer.from(await res.arrayBuffer());
      const hash = crypto.createHash('sha512').update(data).digest('hex');
      if (hash !== file.hashes.sha512) throw new Error(t('Prüfsumme stimmt nicht'));
      return data;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`${path.basename(file.path)}: ${lastError ? lastError.message : t('kein Download')}`);
}

async function downloadAll(fetchFn, files, targetDir, onFile, isCancelled) {
  const queue = [...files];
  async function worker() {
    while (queue.length) {
      if (isCancelled()) throw new Error(t('Abgebrochen.'));
      const file = queue.shift();
      const data = await downloadVerified(fetchFn, file);
      const target = path.join(targetDir, file.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data);
      onFile();
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker));
}

// Das Bild ist Beiwerk: Klappt es nicht, bekommt die Instanz die farbige Kachel
async function saveIcon(fetchFn, iconUrl, slug, iconsDir) {
  try {
    if (!iconUrl || !slug || !/^[a-z0-9_-]+$/i.test(slug) || new URL(iconUrl).hostname !== 'cdn.modrinth.com') return null;
    const ext = path.extname(new URL(iconUrl).pathname).toLowerCase();
    if (!ICON_EXT.includes(ext)) return null;
    const res = await fetchFn(iconUrl, { headers: { 'User-Agent': 'couch-launcher/0.1.0' } });
    if (!res.ok) return null;
    const key = `modrinth_${slug}`;
    fs.mkdirSync(iconsDir, { recursive: true });
    fs.writeFileSync(path.join(iconsDir, key + ext), Buffer.from(await res.arrayBuffer()));
    return key;
  } catch {
    return null;
  }
}

function managedCfg(meta) {
  return {
    ManagedPack: 'true',
    ManagedPackID: meta.projectId,
    ManagedPackName: cleanName(meta.title),
    ManagedPackType: 'modrinth',
    ManagedPackURL: '',
    ManagedPackVersionID: meta.versionId,
    ManagedPackVersionName: cleanName(meta.versionName),
  };
}

// Reste abgebrochener Installationen entfernen, etwa wenn das Fenster währenddessen geschlossen wurde
function removeLeftovers(instancesDir) {
  for (const name of fs.readdirSync(instancesDir)) {
    if (name.startsWith(TEMP_PREFIX)) fs.rmSync(path.join(instancesDir, name), { recursive: true, force: true });
  }
}

// Baut die Instanz in einem versteckten Ordner und benennt sie erst fertig um, damit weder
// Prism noch der Launcher je ein halbes Modpack sehen. Gibt die neue Instanz-ID zurück.
async function installMrpack({ fetchFn, instancesDir, iconsDir, buffer, meta, onProgress, isCancelled }) {
  removeLeftovers(instancesDir);
  const entries = zip.readEntries(buffer);
  const indexEntry = entries.find((e) => e.name === INDEX);
  if (!indexEntry) throw new Error(t('Keine gültige Modpack-Datei.'));
  const pack = parseIndex(zip.extract(buffer, indexEntry).toString('utf8'));
  if (pack.loader && !LOADERS[pack.loader]) throw new Error(t('Unbekannter Mod-Loader.'));

  const title = cleanName(meta.title || pack.name) || 'Modpack';
  const temp = path.join(instancesDir, `${TEMP_PREFIX}${process.pid}-${Date.now()}`);
  const game = path.join(temp, 'minecraft');
  try {
    fs.mkdirSync(game, { recursive: true });
    extractOverrides(buffer, entries, game);

    let done = 0;
    const total = pack.files.length;
    onProgress({ done, total });
    await downloadAll(fetchFn, pack.files, game, () => onProgress({ done: ++done, total }), isCancelled);

    const iconKey = await saveIcon(fetchFn, meta.icon, meta.slug, iconsDir);
    fs.writeFileSync(
      path.join(temp, 'mmc-pack.json'),
      JSON.stringify(packJson(pack.mc, pack.loader, pack.loaderVersion), null, 4) + '\n'
    );
    fs.writeFileSync(path.join(temp, 'instance.cfg'), instanceCfgText(title, { iconKey: iconKey || 'default', ...managedCfg(meta) }));

    const id = uniqueId(title, instancesDir);
    fs.renameSync(temp, path.join(instancesDir, id));
    return id;
  } catch (err) {
    fs.rmSync(temp, { recursive: true, force: true });
    throw err;
  }
}

function digest(algorithm, data) {
  return crypto.createHash(algorithm).update(data).digest('hex');
}

function fileMatches(file, sha512) {
  return fs.existsSync(file) && digest('sha512', fs.readFileSync(file)) === sha512;
}

function readPackFile(buffer) {
  const entries = zip.readEntries(buffer);
  const indexEntry = entries.find((e) => e.name === INDEX);
  if (!indexEntry) throw new Error(t('Keine gültige Modpack-Datei.'));
  return {
    pack: parseIndex(zip.extract(buffer, indexEntry).toString('utf8')),
    overrides: overrideEntries(entries),
  };
}

// Vergleicht die installierten Mods mit dem neuen Pack über die Modrinth-Projekte. So fallen Fassungen
// aus früheren Einzel-Updates weg, und ausgeschaltete Mods bleiben auch unter neuem Dateinamen aus.
async function matchMods(game, files, identify) {
  const dir = path.join(game, MODS_PREFIX);
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /\.jar(\.disabled)?$/i.test(n)) : [];
  const local = names.map((name) => ({ name, sha1: digest('sha1', fs.readFileSync(path.join(dir, name))) }));
  const known = files.filter((f) => f.hashes.sha1);
  let projects = new Map();
  try {
    projects = await identify([...local.map((l) => l.sha1), ...known.map((f) => f.hashes.sha1)]);
  } catch {
    // Ohne Netz zur Modrinth-API entfällt nur das Aufräumen, das Update selbst geht trotzdem
  }
  const wanted = new Map();
  for (const f of known) {
    if (projects.has(f.hashes.sha1)) wanted.set(projects.get(f.hashes.sha1), f.path);
  }
  const remove = [];
  const disabled = new Set();
  for (const { name, sha1 } of local) {
    const target = wanted.get(projects.get(sha1));
    if (!target) continue;
    const off = name.toLowerCase().endsWith(DISABLED);
    const plain = MODS_PREFIX + (off ? name.slice(0, -DISABLED.length) : name);
    if (off) disabled.add(target);
    if (plain !== target) remove.push(MODS_PREFIX + name);
  }
  return { remove, disabled };
}

function writeInstanceFiles(instDir, pack, current, meta) {
  const cfgFile = path.join(instDir, 'instance.cfg');
  fs.writeFileSync(
    cfgFile,
    editCfg(fs.readFileSync(cfgFile, 'utf8'), {
      ManagedPackVersionID: meta.versionId,
      ManagedPackVersionName: cleanName(meta.versionName),
    })
  );
  const same = pack.mc === current.mc && pack.loader === current.loader;
  if (!same) {
    // Prism ergänzt LWJGL und Intermediary passend zur neuen Version selbst
    const json = JSON.stringify(packJson(pack.mc, pack.loader, pack.loaderVersion), null, 4);
    fs.writeFileSync(path.join(instDir, 'mmc-pack.json'), json + '\n');
  } else if (pack.loader && current.loaderVersion && isNewer(pack.loaderVersion, current.loaderVersion)) {
    setLoaderVersion(instDir, pack.loader, pack.loaderVersion);
  }
}

// Hebt eine Instanz auf eine andere Pack-Version. Erst wird alles geladen, der Spielordner bleibt dabei
// unberührt. Ersetzt wird nur, was zum Pack gehört: Eigene Mods, Welten und vom Nutzer geänderte
// Einstellungen bleiben. oldBuffer darf null sein, dann bleiben alte Pack-Dateien im Zweifel liegen.
async function updateMrpack({ fetchFn, instDir, oldBuffer, buffer, current, meta, identify, onProgress, isCancelled }) {
  const next = readPackFile(buffer);
  if (next.pack.loader && !LOADERS[next.pack.loader]) throw new Error(t('Unbekannter Mod-Loader.'));
  let old = null;
  try {
    old = oldBuffer ? readPackFile(oldBuffer) : null;
  } catch {
    old = null;
  }

  const game = gameDir(instDir);
  const work = path.join(instDir, UPDATE_DIR);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  try {
    const present = (f) =>
      fileMatches(path.join(game, f.path), f.hashes.sha512) || fileMatches(path.join(game, f.path + DISABLED), f.hashes.sha512);
    const missing = next.pack.files.filter((f) => !present(f));
    let done = 0;
    onProgress({ done, total: missing.length });
    await downloadAll(fetchFn, missing, work, () => onProgress({ done: ++done, total: missing.length }), isCancelled);

    const { remove, disabled } = await matchMods(game, next.pack.files, identify);
    for (const f of next.pack.files) {
      if (fs.existsSync(path.join(game, f.path + DISABLED))) disabled.add(f.path);
    }

    // Pack-Dateien, die es nicht mehr gibt. Eine geänderte Datei gehört dem Nutzer und bleibt.
    const nextPaths = new Set(next.pack.files.map((f) => f.path));
    for (const f of old ? old.pack.files : []) {
      if (nextPaths.has(f.path)) continue;
      for (const rel of [f.path, f.path + DISABLED]) {
        if (fileMatches(path.join(game, rel), f.hashes.sha512)) remove.push(rel);
      }
    }

    const unchanged = (rel) => {
      const entry = old && old.overrides.get(rel);
      if (!entry) return false;
      const file = path.join(game, rel);
      return digest('sha1', fs.readFileSync(file)) === digest('sha1', zip.extract(oldBuffer, entry));
    };
    const writes = [];
    for (const [rel, entry] of next.overrides) {
      const exists = fs.existsSync(path.join(game, rel));
      if (!exists || PACK_OWNED.some((p) => rel.startsWith(p)) || unchanged(rel)) {
        writes.push({ rel, data: zip.extract(buffer, entry) });
      }
    }
    for (const rel of old ? old.overrides.keys() : []) {
      if (!next.overrides.has(rel) && fs.existsSync(path.join(game, rel)) && unchanged(rel)) remove.push(rel);
    }

    if (isCancelled()) throw new Error(t('Abgebrochen.'));

    // Ab hier wird der Spielordner geändert
    for (const rel of remove) fs.rmSync(path.join(game, rel), { force: true });
    for (const f of missing) {
      const target = path.join(game, disabled.has(f.path) ? f.path + DISABLED : f.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(path.join(work, f.path), target);
    }
    for (const { rel, data } of writes) {
      const target = path.join(game, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data);
    }
    writeInstanceFiles(instDir, next.pack, current, meta);
    return { added: missing.length, removed: remove.length };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = { isSafePath, isAllowedUrl, parseIndex, installMrpack, updateMrpack };
