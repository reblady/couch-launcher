'use strict';

const fs = require('fs');
const path = require('path');
const { gameDir } = require('./instances');

// Erkennt anhand von logs/latest.log, wie weit Minecraft beim Starten ist.
// "loading": Minecraft hat ein neues Log angelegt (Java läuft, Mods laden).
// "started": Das Spielfenster ist da. Minecraft schreibt "Setting user:" direkt bevor es das Fenster öffnet,
// ältere Versionen haben dafür einen "Client thread", neuere einen "Render thread".
const STARTED = [/\]: Setting user: /, /^\[[^\]]*\] \[(Render|Client) thread\//m];
const READ_LIMIT = 1024 * 1024;

function logPath(instDir) {
  return path.join(gameDir(instDir), 'logs', 'latest.log');
}

function logShowsStarted(text) {
  return STARTED.some((re) => re.test(text));
}

function readHead(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(READ_LIMIT);
    const n = fs.readSync(fd, buf, 0, READ_LIMIT, 0);
    return buf.toString('utf8', 0, n);
  } finally {
    fs.closeSync(fd);
  }
}

// Stand des Logs seit `since` (ms). Ein Log von einem früheren Start zählt nicht.
function checkLog(file, since) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return 'waiting';
  }
  // Minecraft legt beim Start ein neues latest.log an. Toleranz, weil manche Dateisysteme auf Sekunden runden.
  if (stat.mtimeMs < since - 1000) return 'waiting';
  let text;
  try {
    text = readHead(file);
  } catch {
    return 'waiting';
  }
  return logShowsStarted(text) ? 'started' : 'loading';
}

// Fragt das Log regelmäßig ab und meldet jede neue Stufe einmal. stop() beendet die Abfrage.
function watchLaunch(instDir, since, onStage, interval = 700) {
  const file = logPath(instDir);
  let last = 'waiting';
  const timer = setInterval(() => {
    const stage = checkLog(file, since);
    if (stage === 'waiting' || stage === last) return;
    last = stage;
    onStage(stage);
    if (stage === 'started') clearInterval(timer);
  }, interval);
  return { stop: () => clearInterval(timer) };
}

module.exports = { logPath, logShowsStarted, checkLog, watchLaunch };
