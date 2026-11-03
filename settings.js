(function (root) {
  'use strict';

  // Einstellungen, die in der App per Controller geändert werden können. Gespeichert wird in config.json.
  // Auswahl-Einstellungen haben `options`, Regler haben `min`, `max`, `step`.
  const DEFS = [
    {
      key: 'aButton',
      label: 'A-Taste auf der Startseite',
      options: [
        { value: 'details', label: 'Details öffnen' },
        { value: 'launch', label: 'Direkt starten' },
      ],
      default: 'details',
    },
    {
      key: 'sounds',
      label: 'UI-Sounds',
      options: [
        { value: true, label: 'An' },
        { value: false, label: 'Aus' },
      ],
      default: true,
    },
    { key: 'volume', label: 'Lautstärke', min: 0, max: 1, step: 0.1, default: 0.5 },
    {
      key: 'onLaunch',
      label: 'Nach dem Spielstart',
      options: [
        { value: 'stay', label: 'Ladeanimation, dann Spiel drüber' },
        { value: 'hide', label: 'Fenster sofort verstecken' },
        { value: 'quit', label: 'Couch Launcher beenden' },
      ],
      default: 'stay',
    },
    {
      key: 'controlifyCheck',
      label: 'Vor dem Start nach Controlify fragen',
      options: [
        { value: true, label: 'An' },
        { value: false, label: 'Aus' },
      ],
      default: true,
    },
    {
      key: 'gameFullscreen',
      label: 'Spiele im Vollbild starten',
      options: [
        { value: true, label: 'An' },
        { value: false, label: 'Aus' },
      ],
      default: true,
    },
    {
      key: 'fullscreen',
      label: 'Launcher im Vollbild starten',
      options: [
        { value: true, label: 'An' },
        { value: false, label: 'Aus' },
      ],
      default: true,
    },
  ];

  function findDef(key) {
    return DEFS.find((d) => d.key === key) || null;
  }

  function round(n) {
    return Math.round(n * 100) / 100;
  }

  // Gibt einen gültigen Wert zurück oder undefined, wenn der Wert nicht passt
  function validate(def, value) {
    if (def.options) return def.options.some((o) => o.value === value) ? value : undefined;
    const n = Number(value);
    if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(n)) return undefined;
    return round(Math.min(def.max, Math.max(def.min, n)));
  }

  // Alle Einstellungen aus einer Config lesen, Fehlendes oder Ungültiges durch Standardwerte ersetzen
  function normalize(cfg = {}) {
    const out = {};
    for (const def of DEFS) {
      const v = validate(def, cfg[def.key]);
      out[def.key] = v === undefined ? def.default : v;
    }
    return out;
  }

  // Nur bekannte Schlüssel mit gültigen Werten übernehmen (für das Speichern aus dem Renderer)
  function sanitizePatch(patch) {
    const out = {};
    if (!patch || typeof patch !== 'object') return out;
    for (const def of DEFS) {
      if (!Object.prototype.hasOwnProperty.call(patch, def.key)) continue;
      const v = validate(def, patch[def.key]);
      if (v !== undefined) out[def.key] = v;
    }
    return out;
  }

  // Nächster Wert in Richtung dir (-1 oder 1). wrap: bei Auswahl am Ende wieder vorne anfangen (Taste A).
  function stepValue(def, value, dir, wrap = false) {
    if (def.options) {
      const n = def.options.length;
      const i = Math.max(0, def.options.findIndex((o) => o.value === value));
      const next = wrap ? (i + dir + n) % n : Math.min(n - 1, Math.max(0, i + dir));
      return def.options[next].value;
    }
    const v = validate(def, value);
    const base = v === undefined ? def.default : v;
    return round(Math.min(def.max, Math.max(def.min, base + dir * def.step)));
  }

  function valueLabel(def, value) {
    if (def.options) {
      const o = def.options.find((x) => x.value === value);
      return o ? o.label : '';
    }
    return `${Math.round(value * 100)} %`;
  }

  const api = { DEFS, findDef, normalize, sanitizePatch, stepValue, valueLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Settings = api;
})(typeof window !== 'undefined' ? window : this);
