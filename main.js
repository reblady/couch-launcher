'use strict';

const i18n = require('./i18n');

const { t } = i18n;

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listInstances, launchCommand, isValidId, parseIni, gameDir } = require('./instances');
const { normalize } = require('./settings');
const configFile = require('./config');
const { watchLaunch } = require('./gamewatch');
const { createClient, createFetchJson, pickFile } = require('./modrinth');
const packs = require('./modpacks');
const { installMrpack, updateMrpack } = require('./mrpack');
const { isNewer, maxVersion, readRequirements, readModInfo, findConflicts } = require('./modcheck');
const instanceCfg = require('./instancecfg');

app.commandLine.appendSwitch('ozone-platform-hint', 'auto');

let win = null;
let lastListing = null;
// Eigener Ordner unter ~/.config, weil der App-Ordner in einer fertigen AppImage schreibgeschützt ist.
// Relative Bildpfade aus "overrides" gelten ab hier.
const CONFIG_DIR = path.join(app.getPath('appData'), 'couch-launcher');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
app.setPath('userData', CONFIG_DIR);

// Früher lag die config.json im Projektordner. Einmalig übernehmen, damit nichts verloren geht.
function migrateConfig() {
  const old = path.join(__dirname, 'config.json');
  if (fs.existsSync(CONFIG_PATH) || !fs.existsSync(old)) return;
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.copyFileSync(old, CONFIG_PATH);
}
migrateConfig();

// Liest die Einstellungen und stellt dabei die Sprache für Meldungen aus dem Hauptprozess ein
function loadConfig() {
  const cfg = configFile.loadConfig(CONFIG_PATH);
  i18n.setLanguage(i18n.resolve(normalize(cfg).language, app.isReady() ? app.getLocale() : ''));
  return cfg;
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function showWindow() {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
  }
}

function createWindow() {
  const cfg = loadConfig();
  const windowed = process.argv.includes('--windowed') || cfg.fullscreen === false;
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    fullscreen: !windowed,
    autoHideMenuBar: true,
    backgroundColor: '#0b0e13',
    title: 'Couch Launcher',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Controller-Eingaben zählen nicht als Nutzergeste, sonst blieben die UI-Sounds stumm
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    win = null;
  });
  win.loadFile('index.html');
}

ipcMain.handle('instances:list', () => {
  lastListing = listInstances(loadConfig(), CONFIG_DIR);
  return lastListing;
});

// Vor dem Start, damit Minecraft gleich im richtigen Modus aufgeht. Ein Fehler hier darf den Start nie verhindern.
function prepareFullscreen(cfg, instDir) {
  try {
    const { window } = instanceCfg.readSettings(fs.readFileSync(path.join(instDir, 'instance.cfg'), 'utf8'));
    const on = instanceCfg.wantedFullscreen(window, normalize(cfg).gameFullscreen);
    if (on === null) return;
    const dir = gameDir(instDir);
    const file = path.join(dir, 'options.txt');
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      fs.mkdirSync(dir, { recursive: true });
    }
    const next = instanceCfg.setFullscreenOption(text, on);
    if (next !== text) fs.writeFileSync(file, next);
  } catch (err) {
    console.error('Vollbild nicht gesetzt:', err.message);
  }
}

ipcMain.handle('instances:launch', (_event, id) => {
  const cfg = loadConfig();
  if (!isValidId(id)) return { ok: false, error: t('Ungültige Instanz.') };

  const listing = lastListing || listInstances(cfg, CONFIG_DIR);
  if (!listing.instances.some((i) => i.id === id)) {
    return { ok: false, error: t('Instanz nicht gefunden. Liste neu laden (Y oder R).') };
  }

  prepareFullscreen(cfg, path.join(listing.dir, id));

  const { cmd, args } = launchCommand(cfg, listing.flatpak, id);
  const mode = normalize(cfg).onLaunch;
  const since = Date.now();
  let watcher = null;

  let child;
  try {
    child = spawn(cmd, args, { stdio: 'ignore', detached: mode === 'quit' });
  } catch (err) {
    return { ok: false, error: t('Start fehlgeschlagen: {error}', { error: err.message }) };
  }

  let settled = false;
  child.on('error', (err) => {
    if (settled) return;
    settled = true;
    if (watcher) watcher.stop();
    showWindow();
    const msg =
      err.code === 'ENOENT'
        ? t('Prism nicht gefunden (Befehl: {cmd}). Trage "prismCommand" in config.json ein.', { cmd })
        : t('Start fehlgeschlagen: {error}', { error: err.message });
    send('launch:ended', { ok: false, error: msg });
  });
  child.on('spawn', () => {
    if (mode === 'stay') {
      // Fenster bleibt offen und zeigt die Ladeanimation, bis das Minecraft-Fenster darüber aufgeht
      watcher = watchLaunch(path.join(listing.dir, id), since, (stage) => send('launch:progress', { stage }));
    } else if (mode === 'hide' && win && !win.isDestroyed()) {
      win.hide();
    } else if (mode === 'quit') {
      child.unref();
      setTimeout(() => app.quit(), 1500);
    }
  });
  child.on('exit', (code) => {
    if (settled) return;
    settled = true;
    if (watcher) watcher.stop();
    showWindow();
    send('launch:ended', { ok: true, code });
  });

  return { ok: true };
});

ipcMain.handle('instances:open-folder', async (_event, id) => {
  if (!isValidId(id)) return { ok: false, error: t('Ungültige Instanz.') };
  const listing = lastListing || listInstances(loadConfig(), CONFIG_DIR);
  if (!listing.dir || !listing.instances.some((i) => i.id === id)) {
    return { ok: false, error: t('Instanz nicht gefunden. Liste neu laden (Y oder R).') };
  }
  const error = await shell.openPath(path.join(listing.dir, id));
  return error ? { ok: false, error: t('Ordner konnte nicht geöffnet werden: {error}', { error }) } : { ok: true };
});

ipcMain.handle('settings:get', () => normalize(loadConfig()));

ipcMain.handle('settings:set', (_event, patch) => {
  const res = configFile.saveConfigPatch(CONFIG_PATH, patch);
  return res.ok ? { ok: true, settings: normalize(res.config) } : res;
});

// ---------- Modpacks und Inhalte ----------

const modrinth = createClient();
const fetchJson = createFetchJson();
let installing = false;

// Version und Loader kommen aus der Instanz selbst, nicht vom Renderer
function contentContext(id, type) {
  if (!isValidId(id) || !packs.CONTENT[type]) throw new Error(t('Ungültige Anfrage.'));
  const listing = lastListing || listInstances(loadConfig(), CONFIG_DIR);
  const inst = listing.instances.find((i) => i.id === id);
  if (!listing.dir || !inst) throw new Error(t('Instanz nicht gefunden. Liste neu laden (Y oder R).'));
  if (!inst.mc) throw new Error(t('Minecraft-Version der Instanz ist unbekannt.'));
  if (type === 'mod' && !inst.loader) throw new Error(t('Diese Instanz hat keinen Mod-Loader.'));
  return {
    instDir: path.join(listing.dir, id),
    type,
    mc: inst.mc,
    loader: inst.loader ? inst.loader.toLowerCase() : null,
    loaderVersion: inst.loaderVersion,
    javaMajor: inst.javaMajor,
  };
}

// Fehler als Ergebnis zurückgeben, damit der Renderer sie als Meldung zeigen kann
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, args) => {
    loadConfig();
    try {
      return { ok: true, ...(await fn(args || {})) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

handle('modpack:options', () => packs.fetchOptions(fetchJson));

handle('modpack:create', async ({ name, mc, loader }) => {
  const listing = listInstances(loadConfig(), CONFIG_DIR);
  if (!listing.dir) throw new Error(t('Prism-Ordner nicht gefunden.'));
  if (!packs.LOADERS[loader] || typeof mc !== 'string') throw new Error(t('Ungültige Auswahl.'));
  const version = await packs.loaderVersion(fetchJson, loader, mc);
  if (!version) throw new Error(t('{loader} gibt es nicht für Minecraft {mc}.', { loader: packs.LOADERS[loader].label, mc }));
  const id = packs.createInstance(listing.dir, { name, mc, loader, version });
  lastListing = listInstances(loadConfig(), CONFIG_DIR);
  return { id };
});

const ID_PATTERN = /^[A-Za-z0-9]{1,32}$/;
const MAX_PACK_FILE = 512 * 1024 * 1024;
let packCancelled = false;

handle('modpack:search', ({ query, offset }) =>
  modrinth.search({
    type: 'modpack',
    query: String(query || '').slice(0, 100),
    offset: Math.max(0, Number(offset) || 0),
  })
);

handle('modpack:versions', async ({ projectId }) => {
  if (typeof projectId !== 'string' || !ID_PATTERN.test(projectId)) throw new Error(t('Ungültiges Projekt.'));
  return { versions: await modrinth.packVersions(projectId) };
});

async function fetchPackFile(version) {
  const file = pickFile(version, ['.mrpack']);
  if (!file) throw new Error(t('Diese Version hat keine Modpack-Datei.'));
  if (file.size > MAX_PACK_FILE) throw new Error(t('Die Modpack-Datei ist zu groß.'));
  if (new URL(file.url).hostname !== 'cdn.modrinth.com') throw new Error(t('Unerwartete Download-Adresse.'));
  const res = await fetch(file.url, { headers: { 'User-Agent': 'couch-launcher/0.1.0' } });
  if (!res.ok) throw new Error(t('Download fehlgeschlagen ({status})', { status: res.status }));
  const buffer = Buffer.from(await res.arrayBuffer());
  if (crypto.createHash('sha512').update(buffer).digest('hex') !== file.hashes.sha512) {
    throw new Error(t('Prüfsumme der Modpack-Datei stimmt nicht.'));
  }
  return buffer;
}

// Die alte Fassung dient nur zum Vergleich. Ist sie auf Modrinth nicht mehr da, geht es auch ohne.
async function fetchOldPack(versionId) {
  try {
    return versionId ? await fetchPackFile(await modrinth.version(versionId)) : null;
  } catch {
    return null;
  }
}

handle('modpack:switch', async ({ id, versionId }) => {
  if (typeof versionId !== 'string' || !ID_PATTERN.test(versionId)) throw new Error(t('Ungültige Version.'));
  if (!isValidId(id)) throw new Error(t('Ungültige Instanz.'));
  if (installing) throw new Error(t('Es läuft gerade schon eine Installation.'));
  const listing = listInstances(loadConfig(), CONFIG_DIR);
  const inst = listing.instances.find((i) => i.id === id);
  if (!listing.dir || !inst || !inst.managedId) throw new Error(t('Das ist kein Modpack von Modrinth.'));
  installing = true;
  packCancelled = false;
  try {
    const version = await modrinth.version(versionId);
    if (version.project_id !== inst.managedId) throw new Error(t('Diese Version gehört zu einem anderen Modpack.'));
    const buffer = await fetchPackFile(version);
    await updateMrpack({
      fetchFn: fetch,
      instDir: path.join(listing.dir, id),
      oldBuffer: await fetchOldPack(inst.managedVersionId),
      buffer,
      current: { mc: inst.mc, loader: inst.loader ? inst.loader.toLowerCase() : null, loaderVersion: inst.loaderVersion },
      meta: { versionId: version.id, versionName: version.name || version.version_number },
      identify: (hashes) => modrinth.identify(hashes),
      onProgress: (data) => send('modpack:progress', data),
      isCancelled: () => packCancelled,
    });
    lastListing = listInstances(loadConfig(), CONFIG_DIR);
    return {};
  } finally {
    installing = false;
  }
});

// Titel, Datei und Bild holt der Hauptprozess selbst, der Renderer nennt nur die Versions-ID
handle('modpack:install', async ({ versionId }) => {
  if (typeof versionId !== 'string' || !ID_PATTERN.test(versionId)) throw new Error(t('Ungültige Version.'));
  if (installing) throw new Error(t('Es läuft gerade schon eine Installation.'));
  const listing = listInstances(loadConfig(), CONFIG_DIR);
  if (!listing.dir) throw new Error(t('Prism-Ordner nicht gefunden.'));
  installing = true;
  packCancelled = false;
  const progress = (data) => send('modpack:progress', data);
  try {
    const version = await modrinth.version(versionId);
    const project = await modrinth.project(version.project_id);
    const buffer = await fetchPackFile(version);

    const cfg = loadConfig();
    const id = await installMrpack({
      fetchFn: fetch,
      instancesDir: listing.dir,
      iconsDir: cfg.iconsDir || path.join(path.dirname(listing.dir), 'icons'),
      buffer,
      meta: {
        projectId: project.id,
        slug: project.slug,
        title: project.title,
        icon: project.icon,
        versionId: version.id,
        versionName: version.name || version.version_number,
      },
      onProgress: progress,
      isCancelled: () => packCancelled,
    });
    lastListing = listInstances(cfg, CONFIG_DIR);
    return { id };
  } finally {
    installing = false;
  }
});

ipcMain.on('modpack:cancel', () => {
  packCancelled = true;
});

handle('content:search', async ({ id, type, query, offset }) => {
  const ctx = contentContext(id, type);
  return modrinth.search({
    type,
    mc: ctx.mc,
    loader: ctx.loader,
    query: String(query || '').slice(0, 100),
    offset: Math.max(0, Number(offset) || 0),
  });
});

// Installierte Dateien, per Hash den Modrinth-Projekten zugeordnet. Ohne Netz bleiben die Dateinamen.
handle('content:installed', async ({ id, type }) => {
  const ctx = contentContext(id, type);
  const items = packs.listContent(ctx.instDir, type);
  try {
    const hashed = await packs.hashContent(ctx.instDir, type, items);
    const projectIds = await modrinth.identify(hashed.map((i) => i.sha1));
    const info = await modrinth.projects([...new Set(projectIds.values())]);
    return {
      items: hashed.map(({ sha1, ...item }) => {
        const projectId = projectIds.get(sha1) || null;
        return { ...item, projectId, ...(info.get(projectId) || {}) };
      }),
    };
  } catch {
    return { items, offline: true };
  }
});

// Lädt eine Datei und liest, was sie braucht. Bei Ressourcenpaketen und Shadern gibt es nichts zu prüfen.
async function fetchChecked(ctx, file) {
  const data = await packs.fetchVerified(fetch, ctx.type, file);
  return { data, needs: ctx.type === 'mod' ? readRequirements(data) : { loader: null, java: null } };
}

// Ohne Eintrag in der instance.cfg gilt, was Prism für diese Minecraft-Version nimmt.
// Bleibt das unbekannt, entfällt die Java-Prüfung.
async function fillJavaMajor(ctx) {
  if (ctx.javaMajor || ctx.type !== 'mod') return;
  ctx.javaMajor = await packs.gameJavaMajor(fetchJson, ctx.mc).catch(() => null);
}

// Java wählt Prism passend zur Minecraft-Version, das kann der Launcher nicht einfach anheben
function javaTooOld(ctx, needs) {
  return Boolean(ctx.javaMajor && needs.java && isNewer(needs.java, String(ctx.javaMajor)));
}

// Fabric Loader lässt sich gefahrlos anheben. Quilt bringt eigene Versionen mit.
async function ensureLoader(ctx, required) {
  if (ctx.loader !== 'fabric' || !required || !ctx.loaderVersion || !isNewer(required, ctx.loaderVersion)) return;
  const newest = await packs.loaderVersion(fetchJson, 'fabric', ctx.mc);
  if (!newest || isNewer(required, newest)) throw new Error(t('Fabric Loader {version} ist für Minecraft {mc} nicht verfügbar.', { version: required, mc: ctx.mc }));
  packs.setLoaderVersion(ctx.instDir, 'fabric', newest);
  ctx.loaderVersion = newest;
  lastListing = listInstances(loadConfig(), CONFIG_DIR);
}

// Eingeschaltete Mods der Instanz. except: Dateien, die gerade ersetzt werden.
async function installedModInfos(ctx, except = new Set()) {
  const dir = packs.contentDir(ctx.instDir, 'mod');
  const infos = [];
  for (const item of packs.listContent(ctx.instDir, 'mod')) {
    if (item.enabled && !except.has(item.file)) {
      infos.push(readModInfo(await fs.promises.readFile(path.join(dir, item.file))));
    }
  }
  return infos;
}

async function installProject(ctx, projectId) {
  const { type } = ctx;
  if (installing) throw new Error(t('Es läuft gerade schon eine Installation.'));
  installing = true;
  try {
    const existing = await packs.hashContent(ctx.instDir, type, packs.listContent(ctx.instDir, type));
    const known = await modrinth.identify(existing.map((i) => i.sha1));
    const { plan, missing } = await modrinth.resolve(projectId, ctx, new Set(known.values()), packs.CONTENT[type].exts);
    const info = await modrinth.projects([...plan.map((p) => p.projectId), ...missing]);
    const titleOf = (pid) => (info.get(pid) || {}).title || pid;
    // Erst alles laden und prüfen, damit bei einem Hindernis keine halbe Installation liegen bleibt
    await fillJavaMajor(ctx);
    const loaded = [];
    let loaderNeeded = null;
    for (const [i, step] of plan.entries()) {
      send('content:progress', { done: i, total: plan.length, title: titleOf(step.projectId) });
      const { data, needs } = await fetchChecked(ctx, step.file);
      if (javaTooOld(ctx, needs)) {
        throw new Error(t('{name} braucht Java {java}, hier läuft Java {have}.', { name: titleOf(step.projectId), java: needs.java, have: ctx.javaMajor }));
      }
      loaderNeeded = maxVersion(loaderNeeded, needs.loader);
      loaded.push({ file: step.file, data });
    }
    if (type === 'mod') {
      const [conflict] = findConflicts(loaded.map((l) => readModInfo(l.data)), await installedModInfos(ctx));
      if (conflict) throw new Error(t('{a} verträgt sich nicht mit {b}. Es wurde nichts installiert.', { a: conflict.a, b: conflict.b }));
    }
    await ensureLoader(ctx, loaderNeeded);
    for (const { file, data } of loaded) packs.writeContent(ctx.instDir, type, file, data);
    return {
      ids: plan.map((p) => p.projectId),
      installed: plan.map((p) => titleOf(p.projectId)),
      missing: missing.map(titleOf),
    };
  } finally {
    installing = false;
  }
}

async function checkUpdates(ctx) {
  const enabled = packs.listContent(ctx.instDir, ctx.type).filter((i) => i.enabled);
  const items = await packs.hashContent(ctx.instDir, ctx.type, enabled);
  return modrinth.findUpdates(items, ctx, packs.CONTENT[ctx.type].exts);
}

handle('content:updates', async ({ id, type }) => {
  const { updates } = await checkUpdates(contentContext(id, type));
  return { updates: updates.map((u) => ({ file: u.item.file, to: u.version.version_number })) };
});

// Die Liste wird hier neu ermittelt: Der Renderer sagt nur, dass aktualisiert werden soll
handle('content:update', async ({ id, type, file }) => {
  if (installing) throw new Error(t('Es läuft gerade schon eine Installation.'));
  const ctx = contentContext(id, type);
  const { exts } = packs.CONTENT[type];
  installing = true;
  try {
    const found = await checkUpdates(ctx);
    const { known } = found;
    // Mit Dateiname nur diese eine Mod, sonst alle
    const updates = file ? found.updates.filter((u) => u.item.file === file) : found.updates;
    await fillJavaMajor(ctx);
    const applied = [];
    const skipped = [];
    const missing = [];
    let loaderNeeded = null;
    const others = type === 'mod' ? await installedModInfos(ctx, new Set(updates.map((u) => u.item.file))) : [];
    for (const [i, u] of updates.entries()) {
      send('content:progress', { done: i, total: updates.length, title: u.item.name });
      const { data, needs } = await fetchChecked(ctx, u.file);
      if (javaTooOld(ctx, needs)) {
        skipped.push(t('{name} (braucht Java {java})', { name: u.item.name, java: needs.java }));
        continue;
      }
      const [conflict] = type === 'mod' ? findConflicts([readModInfo(data)], others) : [];
      if (conflict) {
        const other = conflict.a === u.item.name ? conflict.b : conflict.a;
        skipped.push(t('{name} (verträgt sich nicht mit {other})', { name: u.item.name, other }));
        continue;
      }
      loaderNeeded = maxVersion(loaderNeeded, needs.loader);
      applied.push({ ...u, data });
    }

    // Neue Versionen können neue Pflicht-Abhängigkeiten mitbringen
    const extra = [];
    if (type === 'mod') {
      const required = applied.flatMap((u) => u.version.dependencies || []).filter((d) => d.dependency_type === 'required');
      for (const { project_id: dep } of required) {
        if (!dep || known.has(dep)) continue;
        const plan = await modrinth.resolve(dep, ctx, known, exts).catch(() => null);
        if (!plan) {
          missing.push(dep);
          continue;
        }
        missing.push(...plan.missing);
        for (const step of plan.plan) {
          const { data, needs } = await fetchChecked(ctx, step.file);
          if (javaTooOld(ctx, needs)) {
            missing.push(step.projectId);
            continue;
          }
          loaderNeeded = maxVersion(loaderNeeded, needs.loader);
          extra.push({ file: step.file, data });
          known.add(step.projectId);
        }
      }
    }

    // Der Loader zuerst: Klappt das nicht, bleibt das Pack, wie es war
    await ensureLoader(ctx, loaderNeeded);
    for (const u of applied) {
      packs.writeContent(ctx.instDir, type, u.file, u.data);
      if (u.file.filename !== u.item.file) packs.removeContent(ctx.instDir, type, u.item.file);
    }
    for (const { file, data } of extra) packs.writeContent(ctx.instDir, type, file, data);

    const info = await modrinth.projects(missing).catch(() => new Map());
    return {
      updated: applied.length,
      replaced: applied.map((u) => ({ from: u.item.file, to: u.file.filename })),
      skipped,
      loader: ctx.loaderVersion,
      missing: missing.map((m) => (info.get(m) || {}).title || m),
    };
  } finally {
    installing = false;
  }
});

handle('content:install', ({ id, type, projectId }) => {
  if (typeof projectId !== 'string' || !/^[A-Za-z0-9]{1,32}$/.test(projectId)) throw new Error(t('Ungültiges Projekt.'));
  return installProject(contentContext(id, type), projectId);
});

function instanceCfgPath(id) {
  const listing = listInstances(loadConfig(), CONFIG_DIR);
  if (!isValidId(id) || !listing.dir || !listing.instances.some((i) => i.id === id)) {
    throw new Error(t('Instanz nicht gefunden.'));
  }
  return { file: path.join(listing.dir, id, 'instance.cfg'), dataDir: path.dirname(listing.dir) };
}

// Prisms globaler Wert, den die Instanz ohne eigene Einstellung nutzt
function globalMemory(dataDir) {
  try {
    const cfg = fs.readFileSync(path.join(dataDir, 'prismlauncher.cfg'), 'utf8');
    return Number(parseIni(cfg).MaxMemAlloc) || null;
  } catch {
    return null;
  }
}

handle('instance:settings', ({ id }) => {
  const { file, dataDir } = instanceCfgPath(id);
  const settings = instanceCfg.readSettings(fs.readFileSync(file, 'utf8'));
  return {
    settings,
    memoryOptions: instanceCfg.memoryOptions(Math.floor(os.totalmem() / 1048576), settings.memory),
    globalMemory: globalMemory(dataDir),
  };
});

handle('instance:save', ({ id, patch }) => {
  const { file } = instanceCfgPath(id);
  const text = instanceCfg.applySettings(fs.readFileSync(file, 'utf8'), patch || {});
  const tmp = `${file}.couch.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
  lastListing = listInstances(loadConfig(), CONFIG_DIR);
  return {};
});

// In den Papierkorb, nicht endgültig: In der Instanz liegen auch die Welten
handle('instance:delete', async ({ id }) => {
  const listing = listInstances(loadConfig(), CONFIG_DIR);
  if (!isValidId(id) || !listing.dir || !listing.instances.some((i) => i.id === id)) {
    throw new Error(t('Instanz nicht gefunden.'));
  }
  await shell.trashItem(path.join(listing.dir, id));
  lastListing = listInstances(loadConfig(), CONFIG_DIR);
  return {};
});

// Vor dem Start: Ist Controlify dabei, und ließe es sich für diese Instanz hinzufügen?
handle('controlify:check', async ({ id }) => {
  const ctx = contentContext(id, 'resourcepack');
  const state = packs.controlifyState(packs.listContent(ctx.instDir, 'mod'));
  if (state !== 'missing') return { state, installable: true };
  if (!ctx.loader) return { state, installable: false };
  try {
    const installable = await modrinth.hasVersion(packs.CONTROLIFY_ID, { ...ctx, type: 'mod' });
    return { state, installable };
  } catch {
    return { state, installable: false };
  }
});

handle('controlify:add', async ({ id }) => {
  const ctx = contentContext(id, 'mod');
  const files = packs.controlifyFiles(packs.listContent(ctx.instDir, 'mod'));
  if (files.length) {
    for (const item of files) packs.setEnabled(ctx.instDir, 'mod', item.file, true);
    return {};
  }
  return installProject(ctx, packs.CONTROLIFY_ID);
});

handle('content:toggle', ({ id, type, file, enabled }) => {
  const ctx = contentContext(id, type);
  return { file: packs.setEnabled(ctx.instDir, type, file, enabled !== false) };
});

handle('content:remove', ({ id, type, file }) => {
  packs.removeContent(contentContext(id, type).instDir, type, file);
  return {};
});

ipcMain.on('app:quit', () => app.quit());
ipcMain.on('app:toggle-fullscreen', () => {
  if (win && !win.isDestroyed()) win.setFullScreen(!win.isFullScreen());
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
