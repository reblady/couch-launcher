'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { listInstances, launchCommand, isValidId, parseIni } = require('../instances');
const { findNext } = require('../nav');
const { createMapper } = require('../input');
const { createViewStack, tileActions } = require('../views');
const { createPlayer, clampVolume, SOUNDS } = require('../sounds');
const Settings = require('../settings');
const { saveConfigPatch, loadConfig } = require('../config');
const { logPath, logShowsStarted, checkLog } = require('../gamewatch');
const { createClient, pickVersion, pickFile, searchFacets, safeIcon } = require('../modrinth');
const packs = require('../modpacks');
const Osk = require('../osk');
const cfgFile = require('../instancecfg');
const modcheck = require('../modcheck');
const zlib = require('zlib');
const i18n = require('../i18n');
const { collectKeys } = require('./i18n-keys');
const zipReader = require('../zip');
const { isSafePath, isAllowedUrl, parseIndex, installMrpack, updateMrpack } = require('../mrpack');
const { packChoices } = require('../modrinth');
const crypto = require('crypto');

let passed = 0;
const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// ---------- Fake-Prism-Ordner ----------

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'couch-test-'));
const dataDir = path.join(root, 'PrismLauncher');
const instDir = path.join(dataDir, 'instances');
fs.mkdirSync(path.join(dataDir, 'icons'), { recursive: true });
fs.writeFileSync(path.join(dataDir, 'icons', 'myicon.png'), '');

function makeInstance(id, cfg, pack) {
  const dir = path.join(instDir, id);
  fs.mkdirSync(dir, { recursive: true });
  if (cfg !== null) fs.writeFileSync(path.join(dir, 'instance.cfg'), cfg);
  if (pack) fs.writeFileSync(path.join(dir, 'mmc-pack.json'), JSON.stringify(pack));
}

makeInstance(
  'Fabric-1.21.1',
  '[General]\nInstanceType=OneSix\nname=Fabric 1.21.1\niconKey=myicon\nlastLaunchTime=1761000000000\ntotalTimePlayed=7200\n',
  { components: [{ uid: 'net.minecraft', version: '1.21.1' }, { uid: 'net.fabricmc.fabric-loader', version: '0.16.0' }] }
);
makeInstance(
  'Vanilla',
  '[General]\nname="Vanilla Test"\niconKey=default\n',
  { components: [{ uid: 'net.minecraft', version: '1.20.4' }] }
);
makeInstance('Old', '[General]\nname=Alt\nlastLaunchTime=1700000000\ntotalTimePlayed=90\n', null);
makeInstance('.tmp', '[General]\nname=Versteckt\n', null);
makeInstance('_LAUNCHER_TEMP', '[General]\nname=Temp\n', null);
makeInstance('ohne-cfg', null, null);

// ---------- instances.js ----------

test('parseIni liest Schlüssel, ignoriert Sektionen, entfernt Anführungszeichen', () => {
  const cfg = parseIni('[General]\nname="A B"\n# kommentar\nx=1\n');
  assert.deepStrictEqual(cfg, { name: 'A B', x: '1' });
});

test('listInstances findet nur echte Instanzen', () => {
  const res = listInstances({ instancesDir: instDir });
  assert.strictEqual(res.dir, instDir);
  assert.deepStrictEqual(res.instances.map((i) => i.id).sort(), ['Fabric-1.21.1', 'Old', 'Vanilla']);
});

test('Sortierung: zuletzt gespielt zuerst, nie gespielte am Ende', () => {
  const res = listInstances({ instancesDir: instDir });
  assert.deepStrictEqual(res.instances.map((i) => i.id), ['Fabric-1.21.1', 'Old', 'Vanilla']);
});

test('Felder: Name, Version, Loader, Spielzeit, Zeitstempel', () => {
  const res = listInstances({ instancesDir: instDir });
  const fabric = res.instances.find((i) => i.id === 'Fabric-1.21.1');
  assert.strictEqual(fabric.name, 'Fabric 1.21.1');
  assert.strictEqual(fabric.mc, '1.21.1');
  assert.strictEqual(fabric.loader, 'Fabric');
  assert.strictEqual(fabric.playedSeconds, 7200);
  assert.strictEqual(fabric.lastLaunch, 1761000000000);
  const old = res.instances.find((i) => i.id === 'Old');
  assert.strictEqual(old.lastLaunch, 1700000000 * 1000, 'Sekunden werden zu Millisekunden');
  assert.strictEqual(old.mc, null);
  const vanilla = res.instances.find((i) => i.id === 'Vanilla');
  assert.strictEqual(vanilla.name, 'Vanilla Test');
  assert.strictEqual(vanilla.loader, null);
  assert.strictEqual(vanilla.lastLaunch, 0);
});

test('Eigenes Icon wird gefunden, Standard-Icon nicht', () => {
  const res = listInstances({ instancesDir: instDir });
  const fabric = res.instances.find((i) => i.id === 'Fabric-1.21.1');
  assert.ok(fabric.icon && fabric.icon.startsWith('file://') && fabric.icon.endsWith('myicon.png'));
  assert.strictEqual(res.instances.find((i) => i.id === 'Vanilla').icon, null);
});

test('Overrides: eigener Titel und eigenes Bild (relativ zu baseDir), Unsinn wird ignoriert', () => {
  fs.writeFileSync(path.join(root, 'cover.png'), '');
  const res = listInstances(
    {
      instancesDir: instDir,
      overrides: {
        Vanilla: { title: '  Survival  ', icon: 'cover.png' },
        'Fabric-1.21.1': { title: '', icon: 'fehlt.png' },
        Old: { icon: 'test.txt' },
        GibtsNicht: { title: 'X' },
        __proto__: { title: 'Hack' },
      },
    },
    root
  );
  const vanilla = res.instances.find((i) => i.id === 'Vanilla');
  assert.strictEqual(vanilla.name, 'Survival');
  assert.ok(vanilla.icon.startsWith('file://') && vanilla.icon.endsWith('/cover.png'));
  assert.strictEqual(vanilla.cover, true);
  const fabric = res.instances.find((i) => i.id === 'Fabric-1.21.1');
  assert.strictEqual(fabric.name, 'Fabric 1.21.1', 'leerer Titel ändert nichts');
  assert.ok(fabric.icon.endsWith('myicon.png'), 'fehlende Datei behält das Prism-Icon');
  assert.strictEqual(fabric.cover, false);
  const old = res.instances.find((i) => i.id === 'Old');
  assert.strictEqual(old.name, 'Alt');
  assert.strictEqual(old.icon, null, 'nur Bilddateien');
  assert.strictEqual(res.instances.length, 3);
});

test('Fehlender Ordner liefert dir=null und die Liste der geprüften Pfade', () => {
  const res = listInstances({ instancesDir: path.join(root, 'gibts-nicht') });
  assert.strictEqual(res.dir, null);
  assert.strictEqual(res.instances.length, 0);
  assert.strictEqual(res.tried.length, 1);
});

test('Leerer, aber vorhandener Ordner wird als Ordner erkannt', () => {
  const empty = path.join(root, 'leer');
  fs.mkdirSync(empty);
  const res = listInstances({ instancesDir: empty });
  assert.strictEqual(res.dir, empty);
  assert.strictEqual(res.instances.length, 0);
});

test('launchCommand: String, Array, Anführungszeichen, Flatpak-Standard', () => {
  assert.deepStrictEqual(launchCommand({ prismCommand: 'flatpak run org.prismlauncher.PrismLauncher' }, false, 'X'), {
    cmd: 'flatpak',
    args: ['run', 'org.prismlauncher.PrismLauncher', '-l', 'X'],
  });
  assert.deepStrictEqual(launchCommand({ prismCommand: ['/opt/Prism Launcher/prism'] }, false, 'X'), {
    cmd: '/opt/Prism Launcher/prism',
    args: ['-l', 'X'],
  });
  assert.deepStrictEqual(launchCommand({ prismCommand: '"C:\\Program Files\\Prism\\p.exe" --foo' }, false, 'X'), {
    cmd: 'C:\\Program Files\\Prism\\p.exe',
    args: ['--foo', '-l', 'X'],
  });
  assert.deepStrictEqual(launchCommand({}, true, 'X'), {
    cmd: 'flatpak',
    args: ['run', 'org.prismlauncher.PrismLauncher', '-l', 'X'],
  });
  if (process.platform === 'linux') {
    assert.deepStrictEqual(launchCommand({}, false, 'X'), { cmd: 'prismlauncher', args: ['-l', 'X'] });
  }
});

test('isValidId lehnt Optionen und Pfade ab', () => {
  assert.ok(isValidId('Fabric-1.21.1'));
  assert.ok(isValidId('Mein Pack'));
  assert.ok(!isValidId('--help'));
  assert.ok(!isValidId('-l'));
  assert.ok(!isValidId('../etc'));
  assert.ok(!isValidId('a/b'));
  assert.ok(!isValidId(''));
  assert.ok(!isValidId(null));
  assert.ok(!isValidId(42));
});

// ---------- nav.js ----------

// Obere Reihe: 3 große Kacheln, darunter ein Raster mit 4 Spalten und 2 Reihen
const recent = [0, 1, 2].map((i) => ({ x: i * 324, y: 0, w: 300, h: 240 }));
const grid = [
  ...[0, 1, 2, 3].map((i) => ({ x: i * 244, y: 300, w: 220, h: 200 })),
  ...[0, 1].map((i) => ({ x: i * 244, y: 524, w: 220, h: 200 })),
];
const rects = [...recent, ...grid];
const R = (i) => i; // Index in recent
const G = (i) => 3 + i; // Index im Raster

test('Navigation: rechts/links innerhalb einer Reihe', () => {
  assert.strictEqual(findNext(rects, G(0), 'right'), G(1));
  assert.strictEqual(findNext(rects, G(2), 'left'), G(1));
  assert.strictEqual(findNext(rects, R(0), 'right'), R(1));
});

test('Navigation: Rand der Reihe bleibt am Rand (kein Sprung in andere Reihe)', () => {
  assert.strictEqual(findNext(rects, R(2), 'right'), -1);
  assert.strictEqual(findNext(rects, G(3), 'right'), -1);
  assert.strictEqual(findNext(rects, G(5), 'right'), -1);
  assert.strictEqual(findNext(rects, R(0), 'left'), -1);
});

test('Navigation: hoch/runter zwischen großen Kacheln und Raster', () => {
  assert.strictEqual(findNext(rects, R(0), 'down'), G(0));
  assert.strictEqual(findNext(rects, G(1), 'up'), R(1));
  assert.strictEqual(findNext(rects, G(0), 'down'), G(4));
  assert.strictEqual(findNext(rects, G(4), 'up'), G(0));
  assert.strictEqual(findNext(rects, R(0), 'up'), -1);
  assert.strictEqual(findNext(rects, G(4), 'down'), -1);
});

test('Navigation: versetzte Reihe wird nicht übersprungen (Bildschirmtastatur)', () => {
  const key = (x, y, w = 68) => ({ x, y, w, h: 58 });
  const r1 = [0, 76, 152].map((x) => key(x, 0));
  const r2 = [38, 114].map((x) => key(x, 66));
  const r3 = [0, 76, 152].map((x) => key(x, 132));
  const all = [...r1, ...r2, ...r3];
  assert.strictEqual(findNext(all, 0, 'down'), 3, 'erste Taste trifft die versetzte Reihe');
  assert.strictEqual(findNext(all, 2, 'down'), 4, 'letzte Taste auch');
  assert.strictEqual(findNext(all, 5, 'up'), 3);
  assert.strictEqual(findNext(all, 7, 'up'), 4);
  assert.strictEqual(findNext(all, 3, 'down'), 5);
  assert.strictEqual(findNext(all, 3, 'up'), 0);
});

test('Navigation: Randfälle (kein Fokus, leere Liste, falsche Richtung)', () => {
  assert.strictEqual(findNext(rects, -1, 'down'), 0);
  assert.strictEqual(findNext([], 0, 'down'), -1);
  assert.strictEqual(findNext(rects, 0, 'diagonal'), -1);
});

// ---------- input.js ----------

function pad(pressed = [], axes = [0, 0]) {
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) }));
  return { connected: true, buttons, axes };
}

test('Eingabe: Tastendruck löst genau einmal aus', () => {
  const m = createMapper();
  assert.deepStrictEqual(m.update([pad([0])], 0), ['a']);
  assert.deepStrictEqual(m.update([pad([0])], 16), []);
  assert.deepStrictEqual(m.update([pad([])], 32), []);
  assert.deepStrictEqual(m.update([pad([0])], 48), ['a']);
});

test('Eingabe: Richtungen wiederholen sich erst nach Verzögerung, dann gleichmäßig', () => {
  const m = createMapper();
  assert.deepStrictEqual(m.update([pad([15])], 0), ['right']);
  assert.deepStrictEqual(m.update([pad([15])], 100), []);
  assert.deepStrictEqual(m.update([pad([15])], 400), ['right']);
  assert.deepStrictEqual(m.update([pad([15])], 450), []);
  assert.deepStrictEqual(m.update([pad([15])], 530), ['right']);
});

test('Eingabe: linker Stick wirkt wie das Steuerkreuz', () => {
  const m = createMapper();
  assert.deepStrictEqual(m.update([pad([], [0.8, 0])], 0), ['right']);
  const m2 = createMapper();
  assert.deepStrictEqual(m2.update([pad([], [0, -0.9])], 0), ['up']);
  const m3 = createMapper();
  assert.deepStrictEqual(m3.update([pad([], [0.2, 0.3])], 0), []);
});

test('Eingabe: B, Y, mehrere Controller, getrennte oder fehlende Controller', () => {
  const m = createMapper();
  assert.deepStrictEqual(m.update([pad([1, 3])], 0).sort(), ['b', 'y']);
  const m2 = createMapper();
  assert.deepStrictEqual(m2.update([null, pad([14])], 0), ['left']);
  const m3 = createMapper();
  assert.deepStrictEqual(m3.update([null, { ...pad([0]), connected: false }], 0), []);
  assert.deepStrictEqual(m3.update(null, 10), []);
});

test('Eingabe: X ist Taste 2', () => {
  const m = createMapper();
  assert.deepStrictEqual(m.update([pad([2])], 0), ['x']);
});

// ---------- views.js ----------

test('Ansichts-Stapel: home bleibt immer unten, B geht eine Ebene zurück', () => {
  const v = createViewStack();
  assert.strictEqual(v.top().name, 'home');
  assert.strictEqual(v.pop(), null);
  assert.strictEqual(v.depth(), 1);
  const tile = { id: 'tile' };
  v.push('details', { id: 'A' }, tile);
  v.push('quit');
  assert.ok(v.has('quit'));
  assert.strictEqual(v.top().name, 'quit');
  assert.strictEqual(v.base().name, 'details', 'base liegt direkt über home');
  assert.strictEqual(v.pop().name, 'quit');
  const details = v.pop();
  assert.strictEqual(details.returnFocus, tile);
  assert.strictEqual(details.data.id, 'A');
  assert.strictEqual(v.top().name, 'home');
  assert.ok(!v.has('details'));
});

test('Tastenbelegung: A öffnet standardmäßig Details, umstellbar auf Starten', () => {
  assert.deepStrictEqual(tileActions(undefined), { a: 'details', x: 'launch' });
  assert.deepStrictEqual(tileActions('details'), { a: 'details', x: 'launch' });
  assert.deepStrictEqual(tileActions('launch'), { a: 'launch', x: 'details' });
  assert.deepStrictEqual(tileActions('quatsch'), { a: 'details', x: 'launch' });
});

// ---------- sounds.js ----------

test('Sounds: Lautstärke wird auf 0 bis 1 begrenzt, Unsinn ergibt 0,5', () => {
  assert.strictEqual(clampVolume(0.3), 0.3);
  assert.strictEqual(clampVolume(5), 1);
  assert.strictEqual(clampVolume(-1), 0);
  assert.strictEqual(clampVolume('laut'), 0.5);
  assert.strictEqual(clampVolume(undefined), 0.5);
});

test('Sounds: alle Töne sind gültig, ohne Web Audio passiert beim Abspielen nichts', () => {
  for (const [name, notes] of Object.entries(SOUNDS)) {
    assert.ok(notes.length > 0, name);
    for (const n of notes) assert.ok(n.f > 0 && n.d > 0 && n.v > 0 && n.v <= 0.3, name);
  }
  const p = createPlayer({ volume: 0.4 });
  p.play('move');
  p.play('gibts-nicht');
  p.configure({ enabled: false, volume: 2 });
  p.play('launch');
});

// ---------- settings.js und config.js ----------

test('Einstellungen: Standardwerte, ungültige Werte werden ersetzt', () => {
  assert.deepStrictEqual(Settings.normalize({}), {
    language: 'auto',
    aButton: 'details',
    sounds: true,
    volume: 0.5,
    onLaunch: 'stay',
    controlifyCheck: true,
    gameFullscreen: true,
    fullscreen: true,
  });
  const n = Settings.normalize({ aButton: 'launch', sounds: 'ja', volume: 3, onLaunch: 'quit', fullscreen: false });
  assert.strictEqual(n.aButton, 'launch');
  assert.strictEqual(n.sounds, true, 'nur echte Booleans');
  assert.strictEqual(n.volume, 1, 'wird begrenzt');
  assert.strictEqual(n.onLaunch, 'quit');
  assert.strictEqual(n.fullscreen, false);
  assert.strictEqual(Settings.normalize({ volume: '' }).volume, 0.5);
  assert.strictEqual(Settings.normalize({ volume: true }).volume, 0.5);
});

test('Einstellungen: Schritte bei Auswahl und Regler, mit und ohne Umlauf', () => {
  const a = Settings.findDef('aButton');
  assert.strictEqual(Settings.stepValue(a, 'details', 1), 'launch');
  assert.strictEqual(Settings.stepValue(a, 'launch', 1), 'launch', 'rechts bleibt am Ende');
  assert.strictEqual(Settings.stepValue(a, 'launch', 1, true), 'details', 'A läuft im Kreis');
  const vol = Settings.findDef('volume');
  assert.strictEqual(Settings.stepValue(vol, 0.5, 1), 0.6);
  assert.strictEqual(Settings.stepValue(vol, 0.7, 1), 0.8, 'keine Rundungsfehler');
  assert.strictEqual(Settings.stepValue(vol, 1, 1), 1);
  assert.strictEqual(Settings.stepValue(vol, 0, -1), 0);
  assert.strictEqual(Settings.valueLabel(vol, 0.3), '30 %');
  assert.strictEqual(Settings.valueLabel(Settings.findDef('sounds'), false), 'Aus');
});

test('Einstellungen: Patch nimmt nur bekannte Schlüssel mit gültigen Werten', () => {
  assert.deepStrictEqual(
    Settings.sanitizePatch({ volume: 0.25, aButton: 'quatsch', instancesDir: '/etc', prismCommand: ['rm'] }),
    { volume: 0.25 }
  );
  assert.deepStrictEqual(Settings.sanitizePatch(null), {});
});

test('config.json: Speichern behält andere Schlüssel, legt Datei an, lässt kaputte Datei in Ruhe', () => {
  const dir = path.join(root, 'cfg');
  fs.mkdirSync(dir);
  const file = path.join(dir, 'config.json');

  let res = saveConfigPatch(file, { sounds: false });
  assert.ok(res.ok);
  assert.deepStrictEqual(loadConfig(file), { sounds: false });

  fs.writeFileSync(file, JSON.stringify({ instancesDir: '/x', overrides: { A: { title: 'B' } }, volume: 0.5 }));
  res = saveConfigPatch(file, { volume: 0.8, prismCommand: 'evil' });
  assert.ok(res.ok);
  assert.deepStrictEqual(loadConfig(file), { instancesDir: '/x', overrides: { A: { title: 'B' } }, volume: 0.8 });

  fs.writeFileSync(file, '{ kaputt');
  res = saveConfigPatch(file, { volume: 0.1 });
  assert.ok(!res.ok);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '{ kaputt');
  assert.deepStrictEqual(fs.readdirSync(dir), ['config.json'], 'keine Temp-Dateien übrig');
});

// ---------- gamewatch.js ----------

test('Spielstart: Log-Zeilen neuer und alter Versionen, Modliste zählt nicht', () => {
  assert.ok(logShowsStarted('[19:52:23] [Render thread/INFO]: Setting user: Reblady\n'));
  assert.ok(logShowsStarted('[10:00:00] [Client thread/INFO]: LWJGL Version: 2.9.4\n'));
  assert.ok(!logShowsStarted('[19:13:15] [main/INFO]: Loading 111 mods:\n\t   |-- org_lwjgl_lwjgl-lmdb 3.3.3\n'));
  assert.ok(!logShowsStarted(''));
});

test('Spielstart: altes Log wird ignoriert, neues Log zeigt Laden und dann Start', () => {
  const inst = path.join(root, 'watch-inst');
  const logs = path.join(inst, 'minecraft', 'logs');
  fs.mkdirSync(logs, { recursive: true });
  const file = logPath(inst);
  assert.strictEqual(file, path.join(logs, 'latest.log'));

  const since = Date.now();
  assert.strictEqual(checkLog(file, since), 'waiting', 'noch kein Log');
  fs.writeFileSync(file, '[1] [Render thread/INFO]: Setting user: Alt\n');
  const old = (since - 60000) / 1000;
  fs.utimesSync(file, old, old);
  assert.strictEqual(checkLog(file, since), 'waiting', 'Log vom letzten Mal');

  fs.writeFileSync(file, '[1] [main/INFO]: Loading Minecraft 1.21 with Fabric Loader\n');
  assert.strictEqual(checkLog(file, since), 'loading');
  fs.appendFileSync(file, '[2] [Render thread/INFO]: Setting user: Neu\n');
  assert.strictEqual(checkLog(file, since), 'started');
});

test('Spielstart: .minecraft als Spielordner wird auch gefunden', () => {
  const inst = path.join(root, 'watch-old');
  fs.mkdirSync(path.join(inst, '.minecraft'), { recursive: true });
  assert.strictEqual(logPath(inst), path.join(inst, '.minecraft', 'logs', 'latest.log'));
});

test('Eingabe: LB und RB sind Tasten 4 und 5', () => {
  const m = createMapper();
  assert.deepStrictEqual(m.update([pad([4, 5])], 0).sort(), ['lb', 'rb']);
});

// Ungemappter Controller wie der GameSir G7 SE: 15 Tasten, Steuerkreuz auf den Achsen 6 und 7
function rawPad(pressed = [], axes = [0, 0, 0, 0, 0, 0, 0, 0]) {
  const buttons = Array.from({ length: 15 }, (_, i) => ({ pressed: pressed.includes(i) }));
  return { connected: true, mapping: '', buttons, axes };
}

test('Eingabe: ungemappter Controller mit 15 Tasten', () => {
  const press = (i) => createMapper().update([rawPad([i])], 0);
  assert.deepStrictEqual(press(0), ['a']);
  assert.deepStrictEqual(press(1), ['b']);
  assert.deepStrictEqual(press(2), [], 'unbelegte Taste');
  assert.deepStrictEqual(press(3), ['x']);
  assert.deepStrictEqual(press(4), ['y']);
  assert.deepStrictEqual(press(6), ['lb']);
  assert.deepStrictEqual(press(7), ['rb']);
  assert.deepStrictEqual(press(11), ['start']);
  assert.deepStrictEqual(createMapper().update([rawPad([], [0, 0, 0, 0, 0, 0, 1, 0])], 0), ['right']);
  assert.deepStrictEqual(createMapper().update([rawPad([], [0, 0, 0, 0, 0, 0, 0, -1])], 0), ['up']);
  assert.deepStrictEqual(createMapper().update([{ ...pad([4]), mapping: 'standard' }], 0), ['lb'], 'bekannte Controller bleiben gleich');
});

// ---------- i18n.js ----------

test('Sprache: Auswahl, Systemsprache, Platzhalter, Rückfall auf Deutsch', () => {
  assert.strictEqual(i18n.resolve('auto', 'de-AT'), 'de');
  assert.strictEqual(i18n.resolve('auto', 'en-GB'), 'en');
  assert.strictEqual(i18n.resolve('auto', 'fr-FR'), 'en', 'unbekannte Sprache wird Englisch');
  assert.strictEqual(i18n.resolve('auto', ''), 'en');
  assert.strictEqual(i18n.resolve('de', 'en-US'), 'de');
  assert.strictEqual(i18n.resolve('quatsch', 'de'), 'de');
  i18n.setLanguage('en');
  assert.strictEqual(i18n.t('Spielen'), 'Play');
  assert.strictEqual(i18n.t('Dateien: {done} von {total}', { done: 3, total: 9 }), 'Files: 3 of 9');
  assert.strictEqual(i18n.t('Gibt es nicht'), 'Gibt es nicht', 'fehlt die Übersetzung, bleibt es Deutsch');
  assert.strictEqual(i18n.locale(), 'en-US');
  i18n.setLanguage('de');
  assert.strictEqual(i18n.t('Spielen'), 'Spielen');
  assert.strictEqual(i18n.t('{n} min', { n: 5 }), '5 min');
});

test('Sprache: jeder Text im Code hat eine Übersetzung mit denselben Platzhaltern', () => {
  const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const [lang, dict] of Object.entries(i18n.LANGS)) {
    const keys = collectKeys();
    const missing = keys.filter((k) => !(k in dict));
    assert.deepStrictEqual(missing, [], `${lang}: Übersetzung fehlt`);
    for (const k of keys) assert.strictEqual(placeholders(dict[k]), placeholders(k), `${lang}: Platzhalter in „${k}“`);
    const unused = Object.keys(dict).filter((k) => !keys.includes(k));
    assert.deepStrictEqual(unused, [], `${lang}: Übersetzung wird nicht mehr gebraucht`);
  }
});

// ---------- osk.js ----------

test('Bildschirmtastatur: alle Reihen gleich breit, keine versetzten Tasten', () => {
  for (const rows of Object.values(Osk.LAYOUTS)) {
    for (const row of rows) assert.strictEqual(row.length, Osk.COLUMNS, row);
  }
  assert.strictEqual(Osk.rowsFor('en')[1], 'qwertyuiop');
  assert.strictEqual(Osk.rowsFor('de')[1], 'qwertzuiop');
  assert.strictEqual(Osk.rowsFor('fr'), Osk.LAYOUTS.en);
  assert.strictEqual(Osk.SPECIAL.reduce((sum, s) => sum + s.span, 0), Osk.COLUMNS);
});

test('Bildschirmtastatur: Tippen, Großschreibung, Löschen, Längenlimit', () => {
  let s = Osk.createState('', 4);
  s = Osk.applyKey(s, 'shift');
  s = Osk.applyKey(s, 'a');
  assert.strictEqual(s.text, 'A');
  assert.strictEqual(s.shift, false, 'Großschreibung gilt nur für einen Buchstaben');
  s = Osk.applyKey(s, 'b');
  s = Osk.applyKey(s, 'space');
  s = Osk.applyKey(s, 'c');
  s = Osk.applyKey(s, 'd');
  assert.strictEqual(s.text, 'Ab c', 'Limit greift');
  assert.strictEqual(Osk.applyKey(s, 'back').text, 'Ab ');
  assert.strictEqual(Osk.applyKey(Osk.createState(''), 'back').text, '');
});

// ---------- modrinth.js ----------

function version(id, kind, file, dependencies = []) {
  return { id, version_type: kind, files: [file], dependencies };
}

function fakeRes(body, ok = true, status = 200) {
  return { ok, status, json: async () => body, arrayBuffer: async () => body };
}

test('Modrinth: Version, Datei und Icon werden sicher gewählt', () => {
  const jar = { filename: 'a.jar', primary: true };
  assert.strictEqual(pickVersion([version('1', 'beta', jar), version('2', 'release', jar)]).id, '2');
  assert.strictEqual(pickVersion([version('1', 'alpha', jar)]).id, '1');
  assert.strictEqual(pickVersion([]), null);
  const v = { files: [{ filename: 'a-sources.zip', primary: true }, { filename: 'a.jar' }] };
  assert.strictEqual(pickFile(v, ['.jar']).filename, 'a.jar');
  assert.strictEqual(pickFile(v, ['.mrpack']), null);
  assert.strictEqual(safeIcon('https://evil.example/x.png'), null);
  assert.ok(safeIcon('https://cdn.modrinth.com/data/x/icon.png'));
});

test('Modrinth: Quilt findet auch Fabric-Mods, Shader filtern nicht nach Loader', () => {
  assert.deepStrictEqual(searchFacets({ type: 'mod', mc: '1.21', loader: 'quilt' })[2], ['categories:quilt', 'categories:fabric']);
  assert.deepStrictEqual(searchFacets({ type: 'shader', mc: '1.21', loader: 'fabric' }), [['project_type:shader'], ['versions:1.21']]);
});

test('Modrinth: Abhängigkeiten werden aufgelöst, Installiertes und Kreise übersprungen', async () => {
  const jar = (n) => ({ filename: `${n}.jar`, primary: true, url: 'u', hashes: {} });
  const dep = (id, kind = 'required') => ({ project_id: id, dependency_type: kind });
  const data = {
    root: [version('r', 'release', jar('root'), [dep('a'), dep('b'), dep('opt', 'optional'), dep('have')])],
    a: [version('a', 'release', jar('a'), [dep('root'), dep('fehlt')])],
    b: [version('b', 'release', jar('b'), [dep('a')])],
    fehlt: [],
  };
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    return fakeRes(data[decodeURIComponent(url).match(/project\/([^/]+)\/version/)[1]]);
  };
  const client = createClient(fetchFn);
  const ctx = { type: 'mod', mc: '1.21', loader: 'fabric' };
  const { plan, missing } = await client.resolve('root', ctx, new Set(['have']), ['.jar']);
  assert.deepStrictEqual(plan.map((p) => p.projectId), ['root', 'a', 'b']);
  assert.deepStrictEqual(missing, ['fehlt']);
  assert.ok(!calls.some((u) => u.includes('/opt/') || u.includes('/have/')));
  await assert.rejects(() => client.resolve('fehlt', ctx, new Set(), ['.jar']), /Keine passende Version/);
});

test('Modrinth: Ressourcenpakete ziehen keine Mods als Abhängigkeit nach', async () => {
  const zipFile = { filename: 'pack.zip', primary: true };
  const dep = { project_id: 'etf', dependency_type: 'required' };
  const fetchFn = async () => fakeRes([version('v', 'release', zipFile, [dep])]);
  const { plan, missing } = await createClient(fetchFn).resolve('pack', { type: 'resourcepack', mc: '1.21' }, new Set(), ['.zip']);
  assert.deepStrictEqual(plan.map((p) => p.projectId), ['pack']);
  assert.deepStrictEqual(missing, []);
});

test('Updates: nie instabiler als installiert, Aktuelles und Unbekanntes bleibt', async () => {
  const file = (name, sha1) => ({ filename: `${name}.jar`, primary: true, hashes: { sha1 } });
  const ver = (id, kind, project, f) => ({ id, version_type: kind, project_id: project, files: [f] });
  const installed = {
    h1: ver('alt1', 'release', 'stabil', file('a-1', 'h1')),
    h2: ver('alt2', 'beta', 'beta', file('b-1', 'h2')),
    h3: ver('neu3', 'release', 'aktuell', file('c-1', 'h3')),
  };
  const bodies = [];
  const fetchFn = async (url, options) => {
    if (url.endsWith('/version_files')) return fakeRes(installed);
    const body = JSON.parse(options.body);
    bodies.push(body);
    const out = {};
    if (body.hashes.includes('h1')) out.h1 = ver('neu1', 'release', 'stabil', file('a-2', 'n1'));
    if (body.hashes.includes('h2')) out.h2 = ver('neu2', 'beta', 'beta', file('b-2', 'n2'));
    if (body.hashes.includes('h3')) out.h3 = installed.h3;
    return fakeRes(out);
  };
  const items = [{ sha1: 'h1', file: 'a.jar' }, { sha1: 'h2', file: 'b.jar' }, { sha1: 'h3', file: 'c.jar' }, { sha1: 'h4', file: 'x.jar' }];
  const ctx = { type: 'mod', mc: '1.21', loader: 'quilt' };
  const { updates, known } = await createClient(fetchFn).findUpdates(items, ctx, ['.jar']);
  assert.deepStrictEqual(updates.map((u) => [u.item.file, u.file.filename]), [['a.jar', 'a-2.jar'], ['b.jar', 'b-2.jar']]);
  assert.deepStrictEqual(bodies[0].version_types, ['release']);
  assert.ok(bodies[0].hashes.includes('h1') && !bodies[0].hashes.includes('h2'));
  assert.deepStrictEqual(bodies[1].version_types, ['release', 'beta']);
  assert.deepStrictEqual(bodies[0].loaders, ['quilt', 'fabric']);
  assert.ok(known.has('stabil') && known.has('aktuell'));

  const shader = await createClient(fetchFn).findUpdates(items, { type: 'shader', mc: '1.21' }, ['.zip']);
  assert.strictEqual(bodies[bodies.length - 1].loaders, undefined, 'Shader ohne Loader-Filter');
  assert.deepStrictEqual(shader.updates, [], 'nur passende Dateiendung');
  assert.deepStrictEqual((await createClient(fetchFn).findUpdates([], ctx, ['.jar'])).updates, []);
});

// ---------- modpacks.js ----------

test('Loader-Version: passend zu Minecraft, stabil bevorzugt', () => {
  const list = [
    { version: '3', requires: [{ uid: 'net.minecraft', equals: '1.20' }], recommended: true },
    { version: '2-beta', type: 'beta', requires: [{ uid: 'net.minecraft', equals: '1.21' }] },
    { version: '2', requires: [{ uid: 'net.minecraft', equals: '1.21' }] },
    { version: '1', requires: [{ uid: 'net.minecraft', equals: '1.21' }], recommended: true },
  ];
  assert.strictEqual(packs.pickLoaderVersion(list, '1.21'), '1');
  assert.strictEqual(packs.pickLoaderVersion(list, '1.19'), null);
  assert.strictEqual(packs.pickLoaderVersion([{ version: 'b', type: 'beta' }], '1.21'), 'b', 'nur Betas: dann Beta');
});

test('Neue Instanz: Prism-Format, wird von listInstances erkannt, Name sicher, kein Überschreiben', () => {
  const dir = path.join(root, 'neu');
  fs.mkdirSync(dir);
  const id = packs.createInstance(dir, { name: 'Mein Pack', mc: '1.21.11', loader: 'fabric', version: '0.20.1' });
  assert.strictEqual(id, 'Mein Pack');
  const second = packs.createInstance(dir, { name: 'Mein Pack', mc: '1.21.11', loader: 'fabric', version: '0.20.1' });
  assert.strictEqual(second, 'Mein Pack (2)');
  const evil = packs.createInstance(dir, { name: '../../x\nname=böse', mc: '1.21', loader: 'neoforge', version: '1' });
  assert.ok(isValidId(evil) && !evil.includes('/'));
  assert.ok(fs.existsSync(path.join(dir, evil, 'instance.cfg')), 'bleibt im Instanzordner');
  assert.strictEqual(packs.uniqueId('---', dir), 'Modpack');
  assert.strictEqual(packs.uniqueId('Fresh & Smooth', dir), 'Fresh Smooth', 'keine doppelten Leerzeichen');

  const res = listInstances({ instancesDir: dir });
  const inst = res.instances.find((i) => i.id === 'Mein Pack');
  assert.strictEqual(inst.mc, '1.21.11');
  assert.strictEqual(inst.loader, 'Fabric');
  assert.strictEqual(res.instances.find((i) => i.id === evil).loader, 'NeoForge');
  const pack = JSON.parse(fs.readFileSync(path.join(dir, 'Mein Pack', 'mmc-pack.json'), 'utf8'));
  assert.deepStrictEqual(pack.components[1], { uid: 'net.fabricmc.fabric-loader', version: '0.20.1' });
});

test('Controlify: wird am Dateinamen erkannt, ausgeschaltet zählt nicht als vorhanden', () => {
  const item = (file, enabled = true) => ({ file, enabled });
  assert.strictEqual(packs.controlifyState([]), 'missing');
  assert.strictEqual(packs.controlifyState([item('sodium.jar')]), 'missing');
  assert.strictEqual(packs.controlifyState([item('controlify-3.5.3+mc26.3-universal.jar')]), 'ok');
  assert.strictEqual(packs.controlifyState([item('Controlify-2.0.jar')]), 'ok');
  assert.strictEqual(packs.controlifyState([item('controlify-3.5.3.jar.disabled', false)]), 'disabled');
  assert.strictEqual(packs.controlifyState([item('my-controlify-addon.jar')]), 'missing');
});

const SAMPLE_CFG = [
  '[General]',
  'Env={\\"__GL_THREADED_OPTIMIZATIONS\\":\\"0\\"}',
  'InstanceType=OneSix',
  'MaxMemAlloc=4096',
  'OverrideMemory=false',
  'name=Mein Pack',
  '',
  '[UI]',
  'mods_Page\\ColumnSizes="{\\"Provider\\":100}"',
  'name=NichtDieser',
  '',
].join('\n');

test('instance.cfg: nur [General] wird geändert, alles andere bleibt unangetastet', () => {
  const out = cfgFile.editCfg(SAMPLE_CFG, { name: 'Neu', OverrideWindow: 'true' });
  const lines = out.split('\n');
  assert.ok(lines.includes('name=Neu'));
  assert.ok(lines.includes('name=NichtDieser'), 'gleicher Schlüssel im Abschnitt [UI] bleibt');
  assert.ok(lines.indexOf('OverrideWindow=true') < lines.indexOf('[UI]'), 'neuer Schlüssel landet in [General]');
  assert.ok(lines.includes('Env={\\"__GL_THREADED_OPTIMIZATIONS\\":\\"0\\"}'), 'Maskierung bleibt');
  assert.ok(lines.includes('mods_Page\\ColumnSizes="{\\"Provider\\":100}"'));
  assert.strictEqual(lines.length, SAMPLE_CFG.split('\n').length + 1);
  assert.ok(cfgFile.editCfg('[General]\r\nname=A\r\n', { name: 'B' }).includes('name=B\r\n'), 'Zeilenenden bleiben');
  assert.strictEqual(cfgFile.editCfg(SAMPLE_CFG, {}), SAMPLE_CFG);
});

test('instance.cfg: Arbeitsspeicher setzen und zurück auf Prism', () => {
  assert.strictEqual(cfgFile.readSettings(SAMPLE_CFG).memory, 0, 'ohne Override gilt Prism');
  const on = cfgFile.applySettings(SAMPLE_CFG, { memory: 8192 });
  const s = cfgFile.readSettings(on);
  assert.strictEqual(s.memory, 8192);
  assert.ok(on.includes('OverrideMemory=true') && on.includes('MinMemAlloc=512'));
  const off = cfgFile.applySettings(on, { memory: 0 });
  assert.strictEqual(cfgFile.readSettings(off).memory, 0);
  assert.ok(cfgFile.applySettings('[General]\nMinMemAlloc=4096\n', { memory: 2048 }).includes('MinMemAlloc=2048'), 'Min nie über Max');
  for (const bad of [100, -1, 1.5, '8192', NaN]) assert.throws(() => cfgFile.applySettings(SAMPLE_CFG, { memory: bad }), /Arbeitsspeicher/);
});

test('instance.cfg: Fenstergröße, Name, keine Zeilen einschleusen', () => {
  const max = cfgFile.applySettings(SAMPLE_CFG, { window: 'max' });
  assert.strictEqual(cfgFile.readSettings(max).window, 'max');
  const hd = cfgFile.applySettings(max, { window: '1920x1080' });
  assert.strictEqual(cfgFile.readSettings(hd).window, '1920x1080');
  assert.strictEqual(cfgFile.readSettings(cfgFile.applySettings(hd, { window: 'default' })).window, 'default');
  assert.throws(() => cfgFile.applySettings(SAMPLE_CFG, { window: '1x1\nJvmArgs=x' }), /Fenstergröße/);

  assert.strictEqual(cfgFile.readSettings(cfgFile.applySettings(SAMPLE_CFG, { name: ' Neu ' })).name, 'Neu');
  const evil = cfgFile.applySettings(SAMPLE_CFG, { name: 'A\nJvmArgs=-Xevil\\"' });
  assert.ok(!evil.split('\n').some((l) => l.startsWith('JvmArgs')));
  assert.throws(() => cfgFile.applySettings(SAMPLE_CFG, { name: '  ' }), /leer/);
  assert.strictEqual(cfgFile.applySettings(SAMPLE_CFG, { prismCommand: 'x' }), SAMPLE_CFG, 'unbekannte Schlüssel');
});

test('Vollbild: options.txt wird gezielt geändert, Rest bleibt', () => {
  const opts = 'version:5023\nao:true\nfullscreen:false\nfullscreenResolution:\ngamma:0.5\n';
  const on = cfgFile.setFullscreenOption(opts, true);
  assert.strictEqual(on, 'version:5023\nao:true\nfullscreen:true\nfullscreenResolution:\ngamma:0.5\n');
  assert.strictEqual(cfgFile.setFullscreenOption(on, true), on);
  assert.strictEqual(cfgFile.setFullscreenOption('', true), 'fullscreen:true\n', 'neue Instanz ohne Datei');
  assert.strictEqual(cfgFile.setFullscreenOption('ao:true', true), 'ao:true\nfullscreen:true\n');
  assert.strictEqual(cfgFile.setFullscreenOption('ao:true\r\nfullscreen:false\r\n', true), 'ao:true\r\nfullscreen:true\r\n');
});

test('Vollbild: Standard wird Vollbild, eigene Fenstergröße geht vor, Aus lässt Minecraft in Ruhe', () => {
  assert.strictEqual(cfgFile.wantedFullscreen('default', true), true);
  assert.strictEqual(cfgFile.wantedFullscreen('max', true), false);
  assert.strictEqual(cfgFile.wantedFullscreen('1920x1080', true), false);
  assert.strictEqual(cfgFile.wantedFullscreen('default', false), null);
  assert.strictEqual(cfgFile.wantedFullscreen('max', false), false);
});

test('instance.cfg: Auswahl für den Arbeitsspeicher', () => {
  assert.deepStrictEqual(cfgFile.memoryOptions(4096, 0), [0, 1024, 2048, 3072, 4096]);
  assert.deepStrictEqual(cfgFile.memoryOptions(2500, 1536), [0, 1024, 1536, 2048]);
  assert.deepStrictEqual(cfgFile.memoryOptions(500, 0), [0, 1024]);
});

// Baut ein kleines ZIP wie eine echte .mrpack-Datei: gespeichert oder mit Deflate
function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content, deflate] of files) {
    const data = Buffer.from(content);
    const packed = deflate ? zlib.deflateRawSync(data) : data;
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, packed);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

test('Mod-Anforderungen: Versionen vergleichen und Untergrenzen lesen', () => {
  assert.ok(modcheck.isNewer('0.20.1', '0.19.5'));
  assert.ok(modcheck.isNewer('0.19.10', '0.19.5'), 'Zahlen, nicht Text');
  assert.ok(!modcheck.isNewer('0.19.5', '0.19.5+build.3'));
  assert.ok(modcheck.isNewer('22', '21'));
  assert.ok(!modcheck.isNewer('21', '21.0.7'));
  assert.strictEqual(modcheck.lowerBound('>=0.19.5'), '0.19.5');
  assert.strictEqual(modcheck.lowerBound('>=0.15 <0.21'), '0.15');
  assert.strictEqual(modcheck.lowerBound(['>=22', '>=17']), '17', 'Alternativen: kleinste reicht');
  assert.strictEqual(modcheck.lowerBound('*'), null);
  assert.strictEqual(modcheck.lowerBound(['*', '>=22']), null);
  assert.strictEqual(modcheck.lowerBound(undefined), null);
});

test('Mod-Anforderungen: verschachtelte Jars, optionale Module zählen bei Java nicht', () => {
  const mod = (id, depends) => JSON.stringify({ id, depends });
  const inner = (id) => makeZip([['fabric.mod.json', mod(id, { java: '>=22' }), true]]);
  const middle = makeZip([['fabric.mod.json', mod('mitte', { fabricloader: '>=0.19.5' }), false], ['META-INF/jars/inner.jar', inner('innen'), false]]);
  const optional = makeZip([
    ['fabric.mod.json', mod('aussen', { fabricloader: '>=0.18.0', java: '>=21' }), true],
    ['META-INF/jars/middle.jar', middle, true],
    ['assets/bild.png', 'x', false],
  ]);
  assert.deepStrictEqual(modcheck.readRequirements(optional), { loader: '0.19.5', java: '21' }, 'wie c2me: Java 22 ist nur optional');

  const needed = makeZip([
    ['fabric.mod.json', mod('aussen', { java: '>=21', pflicht: '*' }), true],
    ['META-INF/jars/pflicht.jar', inner('pflicht'), true],
  ]);
  assert.strictEqual(modcheck.readRequirements(needed).java, '22', 'verlangtes Modul zählt');

  const broken = makeZip([['fabric.mod.json', '{ kaputt', false]]);
  assert.deepStrictEqual(modcheck.readRequirements(broken), { loader: null, java: null });
  assert.deepStrictEqual(modcheck.readRequirements(Buffer.from('keine Jar, aber lang genug hier drin')), { loader: null, java: null });
  assert.deepStrictEqual(modcheck.readRequirements(makeZip([['META-INF/neoforge.mods.toml', 'x', false]])), { loader: null, java: null });
});

test('Mod-Konflikte: Versionsbereiche aus breaks', () => {
  assert.ok(modcheck.versionMatches('1.5.10+1.21.11', '*'));
  assert.ok(modcheck.versionMatches('0.4.9', '<0.5'));
  assert.ok(!modcheck.versionMatches('0.5.0', '<0.5'));
  assert.ok(modcheck.versionMatches('2.1', '>=2 <3'));
  assert.ok(!modcheck.versionMatches('3.0', '>=2 <3'));
  assert.ok(modcheck.versionMatches('1.0', ['<1', '1.0']), 'Liste heißt oder');
  assert.ok(!modcheck.versionMatches('1.2', '~1.2'), 'Unlesbares blockiert nicht');
});

test('Mod-Konflikte: beide Richtungen, verschachtelt, Aliase, keine Fehlalarme', () => {
  const jar = (json, extra = []) => makeZip([['fabric.mod.json', JSON.stringify(json), true], ...extra]);
  const provider = modcheck.readModInfo(jar({ id: 'cape-provider', name: 'Cape Provider', version: '5.1.0', breaks: { capes: '*' } }));
  const capes = modcheck.readModInfo(jar({ id: 'capes', name: 'Capes', version: '1.5.10' }));
  const other = modcheck.readModInfo(jar({ id: 'sodium', name: 'Sodium', version: '0.8', breaks: { iris: '<1' } }));
  assert.deepStrictEqual(modcheck.findConflicts([capes], [provider]), [{ a: 'Cape Provider', b: 'Capes' }]);
  assert.deepStrictEqual(modcheck.findConflicts([provider], [capes]), [{ a: 'Cape Provider', b: 'Capes' }]);
  assert.deepStrictEqual(modcheck.findConflicts([capes], [other]), []);

  const newIris = modcheck.readModInfo(jar({ id: 'iris', version: '1.2' }));
  assert.deepStrictEqual(modcheck.findConflicts([newIris], [other]), [], 'nur alte Iris-Versionen sind betroffen');

  const inner = jar({ id: 'capes', name: 'Capes', version: '1.0' });
  const bundled = modcheck.readModInfo(jar({ id: 'paket', name: 'Paket', version: '1' }, [['META-INF/jars/capes.jar', inner, false]]));
  assert.strictEqual(modcheck.findConflicts([bundled], [provider]).length, 1, 'verschachtelte Mod zählt');

  const alias = modcheck.readModInfo(jar({ id: 'neu', name: 'Neu', version: '1', provides: ['capes'] }));
  assert.strictEqual(modcheck.findConflicts([alias], [provider]).length, 1, 'provides zählt');

  const optionalBreak = jar({ id: 'modul', version: '1', breaks: { sodium: '*' } });
  const parent = modcheck.readModInfo(jar({ id: 'hülle', version: '1' }, [['META-INF/jars/modul.jar', optionalBreak, false]]));
  assert.deepStrictEqual(modcheck.findConflicts([parent], [other]), [], 'optionales Modul blockiert nicht');
  assert.deepStrictEqual(modcheck.readModInfo(Buffer.from('keine Jar, aber lang genug')).mods, []);
});

test('Java: Wert aus Prisms Meta-Daten, neueste kompatible Version', async () => {
  assert.strictEqual(await packs.gameJavaMajor(async () => ({ compatibleJavaMajors: [17, 21] }), '1.21'), 21);
  assert.strictEqual(await packs.gameJavaMajor(async () => ({}), '1.21'), null);
});

test('Instanz: Loader anheben, Java-Version wird gelesen', () => {
  const dir = path.join(root, 'loader');
  fs.mkdirSync(dir);
  const id = packs.createInstance(dir, { name: 'L', mc: '1.21', loader: 'fabric', version: '0.19.3' });
  const instDir = path.join(dir, id);
  packs.setLoaderVersion(instDir, 'fabric', '0.20.1');
  const inst = listInstances({ instancesDir: dir }).instances[0];
  assert.strictEqual(inst.loaderVersion, '0.20.1');
  assert.strictEqual(inst.javaMajor, null, 'vor dem ersten Start unbekannt');
  const pack = JSON.parse(fs.readFileSync(path.join(instDir, 'mmc-pack.json'), 'utf8'));
  assert.strictEqual(pack.components[0].version, '1.21', 'Minecraft bleibt');
  fs.appendFileSync(path.join(instDir, 'instance.cfg'), 'JavaVersion=21.0.7\n');
  assert.strictEqual(listInstances({ instancesDir: dir }).instances[0].javaMajor, 21);
  fs.writeFileSync(path.join(instDir, 'instance.cfg'), '[General]\nname=L\nJavaVersion=1.8.0_402\n');
  assert.strictEqual(listInstances({ instancesDir: dir }).instances[0].javaMajor, 8);
});

test('ZIP: gespeicherte und komprimierte Einträge, kaputte Dateien werden erkannt', () => {
  const buf = makeZip([['a.txt', 'hallo', false], ['ordner/b.txt', 'welt'.repeat(100), true]]);
  const entries = zipReader.readEntries(buf);
  assert.deepStrictEqual(entries.map((e) => e.name), ['a.txt', 'ordner/b.txt']);
  assert.strictEqual(zipReader.extract(buf, entries[0]).toString(), 'hallo');
  assert.strictEqual(zipReader.extract(buf, entries[1]).toString(), 'welt'.repeat(100));
  assert.throws(() => zipReader.readEntries(Buffer.from('kein zip, aber lang genug für den Kopf')), /ZIP/);
  assert.throws(() => zipReader.extract(buf, { ...entries[1], size: 5 }), /./, 'Packbombe: mehr als angegeben');
});

test('Modpack: Pfade und Adressen werden streng geprüft', () => {
  for (const ok of ['mods/a.jar', 'config/x/y.json']) assert.ok(isSafePath(ok), ok);
  for (const bad of ['../a.jar', 'mods/../../a.jar', '/etc/passwd', 'a\\b.jar', 'C:/x', 'mods//a.jar', '', './a', 42]) {
    assert.ok(!isSafePath(bad), String(bad));
  }
  assert.ok(isAllowedUrl('https://cdn.modrinth.com/data/a.jar'));
  assert.ok(isAllowedUrl('https://github.com/a/b/releases/x.jar'));
  assert.ok(!isAllowedUrl('http://cdn.modrinth.com/a.jar'));
  assert.ok(!isAllowedUrl('https://evil.example/a.jar'));
  assert.ok(!isAllowedUrl('kaputt'));
});

test('Modpack: Index lesen, Serverdateien weglassen, Unsicheres ablehnen', () => {
  const sha512 = 'a'.repeat(128);
  const file = (over) => ({ path: 'mods/a.jar', hashes: { sha512 }, downloads: ['https://cdn.modrinth.com/a.jar'], ...over });
  const index = (files, dependencies = { minecraft: '1.21', 'fabric-loader': '0.1' }) =>
    JSON.stringify({ game: 'minecraft', name: 'P', dependencies, files });
  const pack = parseIndex(index([file(), file({ path: 'mods/server.jar', env: { client: 'unsupported' } })]));
  assert.deepStrictEqual([pack.mc, pack.loader, pack.loaderVersion], ['1.21', 'fabric', '0.1']);
  assert.deepStrictEqual(pack.files.map((f) => f.path), ['mods/a.jar']);
  assert.strictEqual(parseIndex(index([], { minecraft: '1.21' })).loader, null, 'Vanilla-Pack');
  assert.strictEqual(parseIndex(index([], { minecraft: '1.21', neoforge: '21' })).loader, 'neoforge');
  assert.throws(() => parseIndex(index([file({ path: '../../böse.jar' })])), /Unsicherer Pfad/);
  assert.throws(() => parseIndex(index([file({ downloads: ['https://evil.example/a.jar'] })])), /Download-Adresse/);
  assert.throws(() => parseIndex(index([file({ hashes: {} })])), /Prüfsumme/);
  assert.throws(() => parseIndex(JSON.stringify({ game: 'anderes' })), /Minecraft/);
});

test('Modpack: Versionsliste je Minecraft-Version, stabile bevorzugt, ohne Pack-Datei raus', () => {
  const v = (id, mc, type, file = 'p.mrpack') => ({
    id,
    name: id,
    version_type: type,
    game_versions: [mc],
    loaders: ['fabric'],
    files: [{ filename: file, primary: true }],
  });
  const list = packChoices([v('a', '1.21', 'beta'), v('b', '1.21', 'release'), v('c', '1.20', 'beta'), v('d', '1.19', 'release', 'p.zip')]);
  assert.deepStrictEqual(list.map((x) => [x.id, x.mc, x.beta]), [['b', '1.21', false], ['c', '1.20', true]]);
});

async function fakePackInstall(root2, { index, overrides = [], fetchFn, isCancelled = () => false }) {
  const instancesDir = path.join(root2, 'instances');
  fs.mkdirSync(instancesDir, { recursive: true });
  const buffer = makeZip([['modrinth.index.json', JSON.stringify(index), true], ...overrides]);
  return installMrpack({
    fetchFn,
    instancesDir,
    iconsDir: path.join(root2, 'icons'),
    buffer,
    meta: { projectId: 'abc', slug: 'mein-pack', title: 'Mein Pack', icon: 'https://cdn.modrinth.com/i/icon.png', versionId: 'v1', versionName: '1.0' },
    onProgress: () => {},
    isCancelled,
  });
}

test('Modpack: komplette Installation ergibt eine fertige Prism-Instanz', async () => {
  const dir = path.join(root, 'mp1');
  const jar = Buffer.from('mod');
  const sha512 = crypto.createHash('sha512').update(jar).digest('hex');
  const seen = [];
  const fetchFn = async (url) => {
    seen.push(url);
    return url.includes('kaputt') ? fakeRes(null, false, 404) : fakeRes(jar);
  };
  const index = {
    game: 'minecraft',
    name: 'P',
    dependencies: { minecraft: '1.21.11', 'fabric-loader': '0.18' },
    files: [
      {
        path: 'mods/a.jar',
        hashes: { sha512 },
        downloads: ['https://cdn.modrinth.com/kaputt.jar', 'https://github.com/x/a.jar'],
      },
    ],
  };
  const id = await fakePackInstall(dir, {
    index,
    fetchFn,
    overrides: [
      ['overrides/config/a.json', 'allgemein', true],
      ['overrides/config/b.json', 'allgemein', false],
      ['client-overrides/config/b.json', 'nur client', false],
      ['server-overrides/config/c.json', 'server', false],
    ],
  });
  assert.strictEqual(id, 'Mein Pack');
  const instDir = path.join(dir, 'instances', id);
  const game = path.join(instDir, 'minecraft');
  assert.ok(fs.existsSync(path.join(game, 'mods', 'a.jar')), 'zweite Adresse greift');
  assert.strictEqual(fs.readFileSync(path.join(game, 'config', 'b.json'), 'utf8'), 'nur client');
  assert.ok(!fs.existsSync(path.join(game, 'config', 'c.json')), 'Server-Dateien nicht');
  assert.ok(fs.existsSync(path.join(dir, 'icons', 'modrinth_mein-pack.png')));

  const inst = listInstances({ instancesDir: path.join(dir, 'instances'), iconsDir: path.join(dir, 'icons') }).instances[0];
  assert.deepStrictEqual([inst.name, inst.mc, inst.loader], ['Mein Pack', '1.21.11', 'Fabric']);
  assert.ok(inst.icon.endsWith('modrinth_mein-pack.png'));
  const cfg = parseIni(fs.readFileSync(path.join(instDir, 'instance.cfg'), 'utf8'));
  assert.strictEqual(cfg.ManagedPackID, 'abc');
  assert.strictEqual(cfg.ManagedPackType, 'modrinth');
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'instances')), ['Mein Pack'], 'keine Reste');
});

test('Modpack: Fehler und Abbruch hinterlassen nichts, Overrides bleiben im Spielordner', async () => {
  const dir = path.join(root, 'mp2');
  const instances = path.join(dir, 'instances');
  const file = { path: 'mods/a.jar', hashes: { sha512: 'b'.repeat(128) }, downloads: ['https://cdn.modrinth.com/a.jar'] };
  const index = { game: 'minecraft', dependencies: { minecraft: '1.21' }, files: [file] };
  const fetchFn = async () => fakeRes(Buffer.from('falscher inhalt'));

  await assert.rejects(() => fakePackInstall(dir, { index, fetchFn }), /Prüfsumme/);
  assert.deepStrictEqual(fs.readdirSync(instances), []);

  await assert.rejects(() => fakePackInstall(dir, { index, fetchFn, isCancelled: () => true }), /Abgebrochen/);
  assert.deepStrictEqual(fs.readdirSync(instances), []);

  const clean = { ...index, files: [] };
  await assert.rejects(
    () => fakePackInstall(dir, { index: clean, fetchFn, overrides: [['overrides/../../../böse.txt', 'x', false]] }),
    /Unsicherer Pfad/
  );
  assert.deepStrictEqual(fs.readdirSync(instances), []);
  assert.ok(!fs.existsSync(path.join(dir, 'böse.txt')));
});

// Baut eine Instanz samt Spielordner und eine Fake-Umgebung für Pack-Updates
function packUpdateSetup(name) {
  const instDir = path.join(root, name);
  const game = path.join(instDir, 'minecraft');
  fs.mkdirSync(path.join(game, 'mods'), { recursive: true });
  fs.mkdirSync(path.join(game, 'config'), { recursive: true });
  fs.mkdirSync(path.join(game, 'saves', 'Welt'), { recursive: true });
  fs.writeFileSync(path.join(game, 'saves', 'Welt', 'level.dat'), 'welt');
  fs.writeFileSync(path.join(instDir, 'instance.cfg'), '[General]\nname=P\nManagedPackVersionID=alt\nManagedPackVersionName=1.0\n');
  fs.writeFileSync(path.join(instDir, 'mmc-pack.json'), JSON.stringify(packs.packJson('1.21', 'fabric', '0.18')));
  const sha = (a, d) => crypto.createHash(a).update(d).digest('hex');
  const mod = (file, content) => ({
    path: `mods/${file}`,
    hashes: { sha1: sha('sha1', content), sha512: sha('sha512', content) },
    downloads: [`https://cdn.modrinth.com/${content}`],
  });
  const index = (files, loader = '0.19', mc = '1.21') =>
    JSON.stringify({ game: 'minecraft', name: 'P', dependencies: { minecraft: mc, 'fabric-loader': loader }, files });
  const fetchFn = async (url) => fakeRes(Buffer.from(url.split('/').pop()));
  const run = (oldBuffer, buffer, extra = {}) =>
    updateMrpack({
      fetchFn,
      instDir,
      oldBuffer,
      buffer,
      current: { mc: '1.21', loader: 'fabric', loaderVersion: '0.18' },
      meta: { versionId: 'neu', versionName: '2.0' },
      identify: async () => new Map(),
      onProgress: () => {},
      isCancelled: () => false,
      ...extra,
    });
  return { instDir, game, mod, index, run };
}

test('Pack-Update: Pack-Dateien wechseln, Eigenes und Welten bleiben', async () => {
  const { instDir, game, mod, index, run } = packUpdateSetup('pu1');
  const bleibt = mod('bleibt.jar', 'bleibt');
  const weg = mod('weg.jar', 'weg');
  const neu = mod('neu.jar', 'neu');
  const write = (rel, content) => fs.writeFileSync(path.join(game, rel), content);
  write('mods/bleibt.jar', 'bleibt');
  write('mods/weg.jar', 'weg');
  write('mods/eigene.jar', 'von mir');
  write('config/unveraendert.json', 'alt');
  write('config/geaendert.json', 'von mir geändert');
  write('config/entfaellt.json', 'alt');
  write('config/entfaellt-geaendert.json', 'von mir');

  const oldPack = makeZip([
    ['modrinth.index.json', index([bleibt, weg]), true],
    ['overrides/config/unveraendert.json', 'alt', false],
    ['overrides/config/geaendert.json', 'alt', false],
    ['overrides/config/entfaellt.json', 'alt', false],
    ['overrides/config/entfaellt-geaendert.json', 'alt', false],
  ]);
  const newPack = makeZip([
    ['modrinth.index.json', index([bleibt, neu], '0.19'), true],
    ['overrides/config/unveraendert.json', 'neu', false],
    ['overrides/config/geaendert.json', 'neu', false],
    ['overrides/config/ganz-neu.json', 'neu', false],
  ]);
  const res = await run(oldPack, newPack);
  const has = (rel) => fs.existsSync(path.join(game, rel));
  const read = (rel) => fs.readFileSync(path.join(game, rel), 'utf8');
  assert.ok(has('mods/neu.jar') && has('mods/bleibt.jar') && !has('mods/weg.jar'));
  assert.ok(has('mods/eigene.jar'), 'eigene Mod bleibt');
  assert.strictEqual(read('saves/Welt/level.dat'), 'welt');
  assert.strictEqual(read('config/unveraendert.json'), 'neu', 'unveränderte Einstellung wird aktuell');
  assert.strictEqual(read('config/geaendert.json'), 'von mir geändert', 'eigene Änderung bleibt');
  assert.strictEqual(read('config/ganz-neu.json'), 'neu');
  assert.ok(!has('config/entfaellt.json'));
  assert.ok(has('config/entfaellt-geaendert.json'));
  assert.strictEqual(res.added, 1, 'nur Fehlendes wird geladen');

  const cfg = parseIni(fs.readFileSync(path.join(instDir, 'instance.cfg'), 'utf8'));
  assert.deepStrictEqual([cfg.ManagedPackVersionID, cfg.ManagedPackVersionName, cfg.name], ['neu', '2.0', 'P']);
  const pack = JSON.parse(fs.readFileSync(path.join(instDir, 'mmc-pack.json'), 'utf8'));
  assert.strictEqual(pack.components[1].version, '0.19');
  assert.deepStrictEqual(fs.readdirSync(instDir).sort(), ['instance.cfg', 'minecraft', 'mmc-pack.json'], 'keine Reste');
});

test('Pack-Update: Ausgeschaltetes bleibt aus, Fassungen aus Einzel-Updates fallen weg', async () => {
  const { game, mod, index, run } = packUpdateSetup('pu2');
  const a2 = mod('a-2.jar', 'a2');
  const b2 = mod('b-2.jar', 'b2');
  const c = mod('c.jar', 'c');
  fs.writeFileSync(path.join(game, 'mods', 'a-1-einzeln.jar'), 'a-einzeln');
  fs.writeFileSync(path.join(game, 'mods', 'b-1.jar.disabled'), 'b1');
  fs.writeFileSync(path.join(game, 'mods', 'c.jar.disabled'), 'c');
  const sha1 = (d) => crypto.createHash('sha1').update(d).digest('hex');
  const projects = new Map([
    [sha1('a-einzeln'), 'A'],
    [a2.hashes.sha1, 'A'],
    [sha1('b1'), 'B'],
    [b2.hashes.sha1, 'B'],
  ]);
  await run(null, makeZip([['modrinth.index.json', index([a2, b2, c]), true]]), { identify: async () => projects });
  const files = fs.readdirSync(path.join(game, 'mods')).sort();
  assert.deepStrictEqual(files, ['a-2.jar', 'b-2.jar.disabled', 'c.jar.disabled']);
});

test('Pack-Update: Ohne alte Datei geht nichts verloren, Abbruch ändert nichts, Identify-Fehler stören nicht', async () => {
  const { instDir, game, mod, index, run } = packUpdateSetup('pu3');
  fs.writeFileSync(path.join(game, 'mods', 'alt.jar'), 'alt');
  fs.writeFileSync(path.join(game, 'config', 'a.json'), 'mein');
  const neu = mod('neu.jar', 'neu');
  const newPack = makeZip([['modrinth.index.json', index([neu]), true], ['overrides/config/a.json', 'pack', false]]);

  await assert.rejects(() => run(null, newPack, { isCancelled: () => true }), /Abgebrochen/);
  assert.deepStrictEqual(fs.readdirSync(path.join(game, 'mods')), ['alt.jar']);
  assert.ok(!fs.existsSync(path.join(instDir, '.couch-update')));
  assert.ok(fs.readFileSync(path.join(instDir, 'instance.cfg'), 'utf8').includes('ManagedPackVersionID=alt'));

  await run(null, newPack, { identify: async () => { throw new Error('offline'); } });
  assert.deepStrictEqual(fs.readdirSync(path.join(game, 'mods')).sort(), ['alt.jar', 'neu.jar']);
  assert.strictEqual(fs.readFileSync(path.join(game, 'config', 'a.json'), 'utf8'), 'mein');

  const other = makeZip([['modrinth.index.json', index([neu], '0.20', '1.22'), true]]);
  await run(null, other);
  const pack = JSON.parse(fs.readFileSync(path.join(instDir, 'mmc-pack.json'), 'utf8'));
  assert.strictEqual(pack.components[0].version, '1.22', 'Minecraft-Wechsel');
});

test('Inhalte: Liste, An/Aus wie in Prism, Entfernen samt Index, keine fremden Pfade', () => {
  const inst = path.join(root, 'inhalte');
  const mods = path.join(inst, 'minecraft', 'mods');
  fs.mkdirSync(path.join(mods, '.index'), { recursive: true });
  fs.writeFileSync(path.join(mods, 'b.jar'), 'x');
  fs.writeFileSync(path.join(mods, 'a.jar.disabled'), 'x');
  fs.writeFileSync(path.join(mods, 'notiz.txt'), 'x');
  fs.writeFileSync(path.join(mods, '.index', 'b.pw.toml'), "name = 'B'\nfilename = 'b.jar'\n");
  fs.writeFileSync(path.join(root, 'draussen.jar'), 'x');

  assert.deepStrictEqual(packs.listContent(inst, 'mod').map((i) => [i.name, i.enabled]), [['a', false], ['b', true]]);
  assert.strictEqual(packs.setEnabled(inst, 'mod', 'b.jar', false), 'b.jar.disabled');
  assert.strictEqual(packs.setEnabled(inst, 'mod', 'a.jar.disabled', true), 'a.jar');
  assert.ok(fs.existsSync(path.join(mods, 'b.jar.disabled')) && fs.existsSync(path.join(mods, 'a.jar')));

  packs.removeContent(inst, 'mod', 'b.jar.disabled');
  assert.ok(!fs.existsSync(path.join(mods, 'b.jar.disabled')));
  assert.ok(!fs.existsSync(path.join(mods, '.index', 'b.pw.toml')));

  for (const bad of ['../../draussen.jar', '..\\x.jar', 'notiz.txt', '.versteckt.jar', 42]) {
    assert.throws(() => packs.removeContent(inst, 'mod', bad), /Ungültig/);
  }
  assert.ok(fs.existsSync(path.join(root, 'draussen.jar')));
  assert.deepStrictEqual(packs.listContent(path.join(root, 'gibtsnicht'), 'mod'), []);
});

test('Download: nur Modrinth-CDN, Prüfsumme und Dateiname werden geprüft', async () => {
  const inst = path.join(root, 'dl');
  fs.mkdirSync(path.join(inst, 'minecraft'), { recursive: true });
  const data = Buffer.from('jar-inhalt');
  const sha512 = crypto.createHash('sha512').update(data).digest('hex');
  const fetchFn = async () => fakeRes(data);
  const file = { url: 'https://cdn.modrinth.com/data/x/a.jar', filename: 'a.jar', hashes: { sha512 } };

  await packs.downloadFile(fetchFn, inst, 'mod', file);
  const mods = path.join(inst, 'minecraft', 'mods');
  assert.deepStrictEqual(fs.readdirSync(mods), ['a.jar']);

  await assert.rejects(() => packs.downloadFile(fetchFn, inst, 'mod', { ...file, filename: 'b.jar', hashes: { sha512: 'falsch' } }), /Prüfsumme/);
  await assert.rejects(() => packs.downloadFile(fetchFn, inst, 'mod', { ...file, url: 'https://evil.example/a.jar' }), /Adresse/);
  await assert.rejects(() => packs.downloadFile(fetchFn, inst, 'mod', { ...file, filename: '../../a.jar' }), /Dateiname/);
  assert.deepStrictEqual(fs.readdirSync(mods), ['a.jar'], 'nichts Fremdes liegt im Ordner');
});

(async () => {
  for (const { name, fn } of tests) {
    try {
      await fn();
      passed++;
      console.log(`ok   ${name}`);
    } catch (err) {
      console.error(`FAIL ${name}\n     ${err.message}`);
      process.exitCode = 1;
    }
  }
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} Tests bestanden${process.exitCode ? ', es gab Fehler' : ''}`);
})();
