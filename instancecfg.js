'use strict';

const { t } = require('./i18n');

// Einstellungen einer Instanz in Prisms instance.cfg lesen und ändern. Prism pflegt in der Datei viele
// eigene Werte und Abschnitte, deshalb werden nur einzelne Zeilen in [General] angefasst.

const { parseIni } = require('./instances');

const DEFAULT_WIDTH = 854;
const DEFAULT_HEIGHT = 480;
const MIN_MEMORY = 512;
const MAX_MEMORY = 1024 * 1024;
const NAME_LENGTH = 60;

// Anführungszeichen und Backslash haben in Prisms INI-Format eine eigene Bedeutung
function cleanName(name) {
  return String(name || '').replace(/[\x00-\x1f\x7f"\\]/g, '').trim().slice(0, NAME_LENGTH);
}

// Nur [General]: Andere Abschnitte können gleichnamige Schlüssel enthalten
function parseGeneral(text) {
  const match = text.match(/^\[General\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m);
  return match ? parseIni(match[1]) : {};
}

// Setzt Schlüssel im Abschnitt [General], alles andere bleibt Zeichen für Zeichen erhalten
function editCfg(text, changes) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const pending = new Map(Object.entries(changes));
  let section = '';
  let lastGeneral = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('[')) {
      section = line;
      if (section === '[General]') lastGeneral = i;
      continue;
    }
    if (section !== '[General]' || !line) continue;
    lastGeneral = i;
    const key = line.slice(0, line.indexOf('=')).trim();
    if (pending.has(key)) {
      lines[i] = `${key}=${pending.get(key)}`;
      pending.delete(key);
    }
  }

  const added = [...pending].map(([key, value]) => `${key}=${value}`);
  if (lastGeneral < 0) {
    lines.unshift('[General]', ...added);
  } else {
    lines.splice(lastGeneral + 1, 0, ...added);
  }
  return lines.join(eol);
}

function readWindow(cfg) {
  if (cfg.OverrideWindow !== 'true') return 'default';
  if (cfg.LaunchMaximized === 'true') return 'max';
  return `${Number(cfg.MinecraftWinWidth) || DEFAULT_WIDTH}x${Number(cfg.MinecraftWinHeight) || DEFAULT_HEIGHT}`;
}

// memory: 0 heißt, die Instanz nutzt Prisms globalen Wert
function readSettings(text) {
  const cfg = parseGeneral(text);
  return {
    name: cfg.name || '',
    memory: cfg.OverrideMemory === 'true' ? Number(cfg.MaxMemAlloc) || 0 : 0,
    window: readWindow(cfg),
  };
}

function memoryChanges(cfg, memory) {
  if (memory === 0) return { OverrideMemory: 'false' };
  if (!Number.isInteger(memory) || memory < MIN_MEMORY || memory > MAX_MEMORY) {
    throw new Error(t('Ungültiger Arbeitsspeicher.'));
  }
  const min = Number(cfg.MinMemAlloc) || MIN_MEMORY;
  return { OverrideMemory: 'true', MaxMemAlloc: memory, MinMemAlloc: Math.min(min, memory) };
}

function windowChanges(cfg, value) {
  if (value === 'default') return { OverrideWindow: 'false' };
  const size = {
    MinecraftWinWidth: cfg.MinecraftWinWidth || DEFAULT_WIDTH,
    MinecraftWinHeight: cfg.MinecraftWinHeight || DEFAULT_HEIGHT,
  };
  if (value === 'max') return { OverrideWindow: 'true', LaunchMaximized: 'true', ...size };
  const match = typeof value === 'string' && value.match(/^(\d{3,5})x(\d{3,5})$/);
  if (!match) throw new Error(t('Ungültige Fenstergröße.'));
  return {
    OverrideWindow: 'true',
    LaunchMaximized: 'false',
    MinecraftWinWidth: match[1],
    MinecraftWinHeight: match[2],
  };
}

// Nur diese drei Werte lassen sich ändern. Was nicht passt, löst einen Fehler aus und ändert nichts.
function applySettings(text, patch) {
  const cfg = parseGeneral(text);
  const changes = {};
  if ('name' in patch) {
    const name = cleanName(patch.name);
    if (!name) throw new Error(t('Der Name darf nicht leer sein.'));
    changes.name = name;
  }
  if ('memory' in patch) Object.assign(changes, memoryChanges(cfg, patch.memory));
  if ('window' in patch) Object.assign(changes, windowChanges(cfg, patch.window));
  return editCfg(text, changes);
}

// Der F11-Modus gehört Minecraft, nicht Prism: Er steht als fullscreen: in der options.txt der Instanz.
// Gibt den neuen Text zurück. Eine leere Datei ist erlaubt, Minecraft ergänzt beim Start den Rest.
function setFullscreenOption(text, on) {
  const line = `fullscreen:${on}`;
  if (/^fullscreen:.*$/m.test(text)) return text.replace(/^fullscreen:[^\r\n]*$/m, line);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return text && !text.endsWith('\n') ? `${text}${eol}${line}${eol}` : `${text}${line}${eol}`;
}

// true/false: Wert für die options.txt, null: nichts ändern.
// Eine eigene Fenstergröße des Packs ist eine bewusste Wahl und geht vor.
function wantedFullscreen(windowSetting, gameFullscreen) {
  if (windowSetting !== 'default') return false;
  return gameFullscreen ? true : null;
}

// Auswahl für den Regler: volle Gigabyte bis zum eingebauten RAM, dazu ein schon gesetzter krummer Wert
function memoryOptions(totalMb, current) {
  const gb = Math.max(1, Math.floor(totalMb / 1024));
  const values = Array.from({ length: gb }, (_, i) => (i + 1) * 1024);
  if (current > 0 && !values.includes(current)) values.push(current);
  return [0, ...values.sort((a, b) => a - b)];
}

module.exports = {
  cleanName,
  editCfg,
  readSettings,
  applySettings,
  memoryOptions,
  setFullscreenOption,
  wantedFullscreen,
};
