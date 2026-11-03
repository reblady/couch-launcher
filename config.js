'use strict';

const { t } = require('./i18n');

const fs = require('fs');
const path = require('path');
const { sanitizePatch } = require('./settings');

function loadConfig(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

// Geänderte Einstellungen in config.json schreiben. Andere Schlüssel (Pfade, overrides) bleiben erhalten.
// Ist die vorhandene Datei kaputt, wird sie nicht überschrieben, damit nichts vom Nutzer verloren geht.
function saveConfigPatch(file, patch) {
  const clean = sanitizePatch(patch);
  let cfg = {};
  let text = null;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') return { ok: false, error: t('config.json nicht lesbar: {error}', { error: err.message }) };
  }
  if (text !== null) {
    try {
      cfg = JSON.parse(text);
    } catch {
      return { ok: false, error: t('config.json enthält einen Fehler und wird nicht überschrieben.') };
    }
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
      return { ok: false, error: t('config.json hat ein unerwartetes Format und wird nicht überschrieben.') };
    }
  }
  Object.assign(cfg, clean);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.config.json.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n');
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {}
    return { ok: false, error: t('Einstellungen nicht gespeichert: {error}', { error: err.message }) };
  }
  return { ok: true, config: cfg };
}

module.exports = { loadConfig, saveConfigPatch };
