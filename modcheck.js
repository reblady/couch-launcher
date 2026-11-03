'use strict';

// Liest aus einer Mod-Jar, was sie zum Laufen braucht. Modrinth kennt nur Minecraft-Version und Loader-Typ,
// die Mindestversionen von Fabric Loader und Java stehen allein in der fabric.mod.json, auch in
// verschachtelten Jars unter META-INF/jars. Ohne diese Prüfung starten aktualisierte Packs oft nicht mehr.

const zip = require('./zip');

const MOD_JSON = 'fabric.mod.json';
const NESTED = /^META-INF\/jars\/[^/]+\.jar$/;
const MAX_DEPTH = 3;

function parts(version) {
  return String(version).split(/[.+-]/).map((p) => parseInt(p, 10));
}

// true, wenn a neuer ist als b. Nur die Zahlen vorne zählen, „0.19.5+build“ ist 0.19.5.
function isNewer(a, b) {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = Number.isNaN(x[i]) || x[i] === undefined ? 0 : x[i];
    const q = Number.isNaN(y[i]) || y[i] === undefined ? 0 : y[i];
    if (p !== q) return p > q;
  }
  return false;
}

function maxVersion(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return isNewer(b, a) ? b : a;
}

function boundOf(spec) {
  const match = String(spec).match(/>=?\s*v?(\d[\d.]*)/);
  return match ? match[1].replace(/\.$/, '') : null;
}

// Fabric erlaubt eine Liste von Alternativen: Dann reicht die kleinste Untergrenze.
// Eine Alternative ohne Untergrenze heißt, es gibt keine Mindestversion.
function lowerBound(spec) {
  if (spec === undefined || spec === null) return null;
  const bounds = (Array.isArray(spec) ? spec : [spec]).map(boundOf);
  if (bounds.some((b) => !b)) return null;
  return bounds.reduce((min, b) => (isNewer(min, b) ? b : min));
}

function readModJson(buffer, entries) {
  const entry = entries.find((e) => e.name === MOD_JSON);
  if (!entry) return null;
  try {
    return JSON.parse(zip.extract(buffer, entry).toString('utf8').replace(/^﻿/, ''));
  } catch {
    // Eine unlesbare Beschreibung soll das Update nicht blockieren
    return null;
  }
}

// Verschachtelte Mods sind optional: Passt ihr Java nicht, lässt Fabric sie weg (c2me liefert so Module
// für neuere Java-Versionen mit). Java zählt deshalb nur, wenn die Mod selbst das Modul verlangt.
// Beim Loader ist das egal, ihn anzuheben schadet nicht.
function scan(buffer, depth, required, parentDepends, out) {
  const entries = zip.readEntries(buffer);
  const mod = readModJson(buffer, entries);
  const depends = (mod && mod.depends) || {};
  const hard = required && (depth === 0 || Boolean(mod && mod.id in parentDepends));
  out.loader = maxVersion(out.loader, lowerBound(depends.fabricloader));
  if (hard) out.java = maxVersion(out.java, lowerBound(depends.java));
  if (depth >= MAX_DEPTH) return;
  for (const entry of entries) {
    if (!NESTED.test(entry.name)) continue;
    try {
      scan(zip.extract(buffer, entry), depth + 1, hard, depends, out);
    } catch {
      // Beschädigte verschachtelte Jars prüft Fabric beim Start selbst
    }
  }
}

function collectInfo(buffer, depth, required, parentDepends, out) {
  const entries = zip.readEntries(buffer);
  const mod = readModJson(buffer, entries);
  const depends = (mod && mod.depends) || {};
  const hard = required && (depth === 0 || Boolean(mod && mod.id in parentDepends));
  if (mod && mod.id) {
    const name = mod.name || mod.id;
    out.mods.push({ id: mod.id, name, version: String(mod.version || '') });
    for (const alias of Array.isArray(mod.provides) ? mod.provides : []) {
      out.mods.push({ id: alias, name, version: String(mod.version || '') });
    }
    // Wie bei Java zählen nur Module, die wirklich geladen werden müssen
    if (hard) {
      for (const [id, spec] of Object.entries(mod.breaks || {})) out.breaks.push({ owner: name, id, spec });
    }
  }
  if (depth >= MAX_DEPTH) return;
  for (const entry of entries) {
    if (!NESTED.test(entry.name)) continue;
    try {
      collectInfo(zip.extract(buffer, entry), depth + 1, hard, depends, out);
    } catch {
      // Beschädigte verschachtelte Jars prüft Fabric beim Start selbst
    }
  }
}

// Welche Mods stecken in der Jar, und was verträgt sie nicht? Bei Forge-Mods bleibt beides leer.
function readModInfo(jar) {
  const out = { mods: [], breaks: [] };
  try {
    collectInfo(jar, 0, true, {}, out);
  } catch {
    return { mods: [], breaks: [] };
  }
  return out;
}

function matchesOne(version, condition) {
  const match = condition.match(/^(>=|<=|>|<|=)?\s*v?(\d[\d.]*)$/);
  if (!match) return false;
  const [, op = '=', bound] = match;
  const newer = isNewer(version, bound);
  const older = isNewer(bound, version);
  if (op === '>=') return !older;
  if (op === '<=') return !newer;
  if (op === '>') return newer;
  if (op === '<') return older;
  return !newer && !older;
}

// Fabric-Bereiche: Liste heißt oder, Leerzeichen heißt und. Was sich nicht lesen lässt (etwa ~1.2 oder 1.x),
// zählt nicht: Lieber prüft Fabric beim Start, als dass der Launcher eine gute Mod ablehnt.
function versionMatches(version, spec) {
  return (Array.isArray(spec) ? spec : [spec]).some((one) => {
    const text = String(one).trim();
    if (text === '*' || text === '') return true;
    return text.split(/\s+/).every((condition) => matchesOne(version, condition));
  });
}

function breaksOf(from, to) {
  const found = [];
  for (const rule of from.breaks) {
    const hit = to.mods.find((m) => m.id === rule.id && versionMatches(m.version, rule.spec));
    if (hit) found.push({ a: rule.owner, b: hit.name });
  }
  return found;
}

// Konflikte zwischen neuen und vorhandenen Mods, in beide Richtungen
function findConflicts(added, installed) {
  const found = [];
  for (const a of added) {
    for (const b of installed) found.push(...breaksOf(a, b), ...breaksOf(b, a));
  }
  return found;
}

// { loader: '0.19.5' | null, java: '22' | null }, bei Forge-Mods oder fremden Formaten beides null
function readRequirements(jar) {
  const out = { loader: null, java: null };
  try {
    scan(jar, 0, true, {}, out);
  } catch {
    return { loader: null, java: null };
  }
  return out;
}

module.exports = { isNewer, maxVersion, lowerBound, readRequirements, readModInfo, versionMatches, findConflicts };
