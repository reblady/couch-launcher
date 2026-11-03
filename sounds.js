(function (root) {
  'use strict';

  // Dezente UI-Sounds, live per Web Audio erzeugt (keine Dateien).
  // Jeder Sound ist eine Liste von Tönen: f = Frequenz, to = Ziel-Frequenz (Gleiten), t = Startversatz,
  // d = Dauer, v = Lautstärke, type = Wellenform. Alle Zeiten in Sekunden.
  const SOUNDS = {
    move: [{ f: 1250, to: 1050, d: 0.045, v: 0.12 }],
    bump: [{ f: 190, to: 150, d: 0.09, v: 0.16, type: 'triangle' }],
    confirm: [
      { f: 880, d: 0.07, v: 0.12 },
      { f: 1320, t: 0.05, d: 0.11, v: 0.1 },
    ],
    back: [
      { f: 1100, d: 0.06, v: 0.1 },
      { f: 740, t: 0.045, d: 0.1, v: 0.09 },
    ],
    open: [
      { f: 660, to: 990, d: 0.12, v: 0.1, type: 'triangle' },
    ],
    launch: [
      { f: 523.25, d: 0.55, v: 0.08, type: 'triangle' },
      { f: 659.25, t: 0.05, d: 0.55, v: 0.07, type: 'triangle' },
      { f: 783.99, t: 0.1, d: 0.6, v: 0.07, type: 'triangle' },
      { f: 1046.5, t: 0.16, d: 0.7, v: 0.05 },
    ],
    error: [
      { f: 330, d: 0.12, v: 0.12, type: 'triangle' },
      { f: 247, t: 0.1, d: 0.2, v: 0.12, type: 'triangle' },
    ],
  };

  function clampVolume(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
  }

  function createPlayer(options = {}) {
    let enabled = options.enabled !== false;
    let volume = clampVolume(options.volume);
    let ctx = null;
    let master = null;

    function ensure() {
      if (!ctx) {
        const AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = volume;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }

    function tone(note, start) {
      const end = start + note.d;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = note.type || 'sine';
      osc.frequency.setValueAtTime(note.f, start);
      if (note.to) osc.frequency.exponentialRampToValueAtTime(note.to, end);
      // kurzer Anschlag, dann weich ausklingen (kein Knacken)
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(note.v, start + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain).connect(master);
      osc.start(start);
      osc.stop(end + 0.02);
    }

    return {
      play(name) {
        const notes = SOUNDS[name];
        if (!enabled || !volume || !notes) return;
        const c = ensure();
        if (!c) return;
        const now = c.currentTime + 0.005;
        notes.forEach((n) => tone(n, now + (n.t || 0)));
      },
      configure(opts = {}) {
        if ('enabled' in opts) enabled = opts.enabled !== false;
        if ('volume' in opts) {
          volume = clampVolume(opts.volume);
          if (master) master.gain.value = volume;
        }
      },
    };
  }

  const api = { createPlayer, clampVolume, SOUNDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sounds = api;
})(typeof window !== 'undefined' ? window : this);
