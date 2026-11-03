'use strict';

// Sammelt alle Texte, die übersetzt werden: t('…') im Code, data-i18n in index.html und Beschriftungen,
// die erst beim Anzeigen durch t() laufen (Einstellungen, Tastatur, Reiter).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCES = fs.readdirSync(ROOT).filter((f) => f.endsWith('.js') && !f.startsWith('lang-'));
// Eigennamen in ihrer eigenen Sprache und reine Zahlen brauchen keine Übersetzung
const SKIP = new Set(['Deutsch', 'English']);

function unescape(text) {
  return text.replace(/\\'/g, "'").replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
}

function collectKeys() {
  const keys = new Set();
  for (const file of SOURCES) {
    const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const m of code.matchAll(/(?<![\w$.])t\('((?:[^'\\]|\\.)*)'/g)) keys.add(unescape(m[1]));
  }
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const m of html.matchAll(/data-i18n>([^<]+)</g)) keys.add(m[1].trim());

  const Settings = require('../settings');
  for (const def of Settings.DEFS) {
    keys.add(def.label);
    for (const o of def.options || []) keys.add(o.label);
  }
  for (const s of require('../osk').SPECIAL) keys.add(s.label);
  for (const label of ['Mods', 'Ressourcenpakete', 'Shader']) keys.add(label);
  for (const skip of SKIP) keys.delete(skip);
  return [...keys].sort();
}

module.exports = { collectKeys };

if (require.main === module) {
  for (const key of collectKeys()) console.log(JSON.stringify(key));
}
