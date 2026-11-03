'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const FLATPAK_ID = 'org.prismlauncher.PrismLauncher';
const ICON_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif', '.ico'];

const LOADERS = {
  'net.fabricmc.fabric-loader': 'Fabric',
  'org.quiltmc.quilt-loader': 'Quilt',
  'net.minecraftforge': 'Forge',
  'net.neoforged': 'NeoForge',
  'com.mumfrey.liteloader': 'LiteLoader',
};

function candidateDirs(config) {
  if (config.instancesDir) {
    return [{ dir: config.instancesDir, flatpak: config.instancesDir.includes(FLATPAK_ID) }];
  }
  const home = os.homedir();
  const dirs = [];
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    dirs.push(path.join(appdata, 'PrismLauncher', 'instances'));
  } else if (process.platform === 'darwin') {
    dirs.push(path.join(home, 'Library', 'Application Support', 'PrismLauncher', 'instances'));
  } else {
    const xdg = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
    dirs.push(path.join(xdg, 'PrismLauncher', 'instances'));
    dirs.push(path.join(home, '.var', 'app', FLATPAK_ID, 'data', 'PrismLauncher', 'instances'));
  }
  return dirs.map((dir) => ({ dir, flatpak: dir.includes(FLATPAK_ID) }));
}

function parseIni(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#' || line[0] === ';' || line[0] === '[') continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    let value = line.slice(i + 1).trim();
    if (value.length >= 2 && value[0] === '"' && value[value.length - 1] === '"') {
      value = value.slice(1, -1);
    }
    out[line.slice(0, i).trim()] = value;
  }
  return out;
}

function readPack(instDir) {
  try {
    const pack = JSON.parse(fs.readFileSync(path.join(instDir, 'mmc-pack.json'), 'utf8'));
    let mc = null;
    let loader = null;
    let loaderVersion = null;
    for (const c of pack.components || []) {
      if (c.uid === 'net.minecraft') mc = c.version || null;
      else if (LOADERS[c.uid]) {
        loader = LOADERS[c.uid];
        loaderVersion = c.version || null;
      }
    }
    return { mc, loader, loaderVersion };
  } catch {
    return { mc: null, loader: null, loaderVersion: null };
  }
}

// Spielordner einer Instanz, ältere Instanzen nutzen .minecraft
function gameDir(instDir) {
  for (const sub of ['minecraft', '.minecraft']) {
    const dir = path.join(instDir, sub);
    if (fs.existsSync(dir)) return dir;
  }
  return path.join(instDir, 'minecraft');
}

function findIcon(iconDirs, key) {
  if (!key || key !== path.basename(key)) return null;
  for (const dir of iconDirs) {
    for (const ext of ICON_EXT) {
      const p = path.join(dir, key + ext);
      if (fs.existsSync(p)) return pathToFileURL(p).href;
    }
  }
  return null;
}

function toMillis(value) {
  const n = Number(value) || 0;
  if (n > 0 && n < 1e11) return n * 1000;
  return n;
}

function javaMajor(version) {
  if (!version) return null;
  const [a, b] = String(version).split('.');
  return Number(a === '1' ? b : a) || null;
}

function readInstance(instDir, id, iconDirs) {
  let cfg;
  try {
    cfg = parseIni(fs.readFileSync(path.join(instDir, 'instance.cfg'), 'utf8'));
  } catch {
    return null;
  }
  const pack = readPack(instDir);
  return {
    id,
    name: cfg.name || id,
    mc: pack.mc,
    loader: pack.loader,
    loaderVersion: pack.loaderVersion,
    // Prism trägt das erst nach dem ersten Start ein, „1.8.0“ ist Java 8
    javaMajor: javaMajor(cfg.JavaVersion),
    lastLaunch: toMillis(cfg.lastLaunchTime),
    playedSeconds: Number(cfg.totalTimePlayed) || 0,
    // Nur bei fertigen Modpacks gesetzt, Prism und der Launcher schreiben dieselben Schlüssel
    managedId: cfg.ManagedPack === 'true' && cfg.ManagedPackType === 'modrinth' ? cfg.ManagedPackID || null : null,
    managedVersionId: cfg.ManagedPackVersionID || null,
    managedVersionName: cfg.ManagedPackVersionName || null,
    iconKey: cfg.iconKey || null,
    icon: findIcon(iconDirs, cfg.iconKey),
    // true bei eigenem Bild aus overrides: füllt die Kachel statt als kleines Icon mittig zu sitzen
    cover: false,
  };
}

function resolveUserPath(p, baseDir) {
  if (p === '~' || p.startsWith('~/')) p = path.join(os.homedir(), p.slice(1));
  return path.resolve(baseDir, p);
}

// Eigene Titel und Bilder aus config.json: "overrides": { "<Instanz-ID>": { "title", "icon" } }
function applyOverride(inst, overrides, baseDir) {
  const o = overrides && Object.prototype.hasOwnProperty.call(overrides, inst.id) ? overrides[inst.id] : null;
  if (!o || typeof o !== 'object') return inst;
  if (typeof o.title === 'string' && o.title.trim()) inst.name = o.title.trim();
  if (typeof o.icon === 'string' && o.icon.trim()) {
    const p = resolveUserPath(o.icon.trim(), baseDir);
    if (ICON_EXT.includes(path.extname(p).toLowerCase()) && fs.existsSync(p)) {
      inst.icon = pathToFileURL(p).href;
      inst.cover = true;
    }
  }
  return inst;
}

function listInstances(config = {}, baseDir = process.cwd()) {
  const dirs = candidateDirs(config);
  const tried = [];
  for (const candidate of dirs) {
    tried.push(candidate.dir);
    let entries;
    try {
      entries = fs.readdirSync(candidate.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const iconDirs = config.iconsDir
      ? [config.iconsDir]
      : [path.join(path.dirname(candidate.dir), 'icons')];
    const instances = [];
    for (const entry of entries) {
      if (!(entry.isDirectory() || entry.isSymbolicLink())) continue;
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
      const inst = readInstance(path.join(candidate.dir, entry.name), entry.name, iconDirs);
      if (inst) instances.push(applyOverride(inst, config.overrides, baseDir));
    }
    if (instances.length || dirs.length === 1) {
      instances.sort((a, b) => b.lastLaunch - a.lastLaunch || a.name.localeCompare(b.name));
      return { dir: candidate.dir, flatpak: candidate.flatpak, instances, tried };
    }
  }
  return { dir: null, flatpak: false, instances: [], tried };
}

function splitCommand(str) {
  return (str.match(/"[^"]*"|\S+/g) || []).map((s) => s.replace(/^"|"$/g, ''));
}

function defaultCommand(flatpak) {
  if (flatpak) return ['flatpak', 'run', FLATPAK_ID];
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    if (local) {
      const p = path.join(local, 'Programs', 'PrismLauncher', 'prismlauncher.exe');
      if (fs.existsSync(p)) return [p];
    }
    return ['prismlauncher.exe'];
  }
  if (process.platform === 'darwin') {
    return ['/Applications/Prism Launcher.app/Contents/MacOS/prismlauncher'];
  }
  return ['prismlauncher'];
}

function launchCommand(config, flatpak, id) {
  let base;
  if (Array.isArray(config.prismCommand) && config.prismCommand.length) {
    base = config.prismCommand.map(String);
  } else if (typeof config.prismCommand === 'string' && config.prismCommand.trim()) {
    base = splitCommand(config.prismCommand);
  } else {
    base = defaultCommand(flatpak);
  }
  return { cmd: base[0], args: [...base.slice(1), '-l', id] };
}

function isValidId(id) {
  return typeof id === 'string' && id.length > 0 && !id.startsWith('-') && !/[\\/]/.test(id);
}

module.exports = { listInstances, launchCommand, isValidId, parseIni, gameDir, FLATPAK_ID };
