(function (root) {
  'use strict';

  // Standard-Mapping der Gamepad API (Xbox-Layout, auch PlayStation und Steam Deck über Steam Input)
  const BUTTONS = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, start: 9, up: 12, down: 13, left: 14, right: 15 };
  // Controller, die Chromium nicht kennt, kommen ungemappt an. Sie melden 15 Tasten in Kernel-Reihenfolge,
  // dabei zwei unbelegte zwischen B und X und zwischen Y und LB (z. B. GameSir G7 SE). Das Steuerkreuz sind die Achsen 6 und 7.
  const RAW_BUTTONS = { a: 0, b: 1, x: 3, y: 4, lb: 6, rb: 7, start: 11, up: -1, down: -1, left: -1, right: -1 };
  const RAW_BUTTON_COUNT = 15;
  const DIRS = ['up', 'down', 'left', 'right'];
  const REPEAT_DELAY = 380;
  const REPEAT_RATE = 120;
  const STICK_DEADZONE = 0.55;

  function readState(pads) {
    const s = { up: false, down: false, left: false, right: false, a: false, b: false, x: false, y: false, lb: false, rb: false, start: false };
    for (const p of Array.from(pads || [])) {
      if (!p || p.connected === false) continue;
      const raw = p.mapping === '' && p.buttons && p.buttons.length === RAW_BUTTON_COUNT;
      const map = raw ? RAW_BUTTONS : BUTTONS;
      const pressed = (i) => !!(p.buttons && p.buttons[i] && p.buttons[i].pressed);
      const axis = (i) => (p.axes && p.axes[i]) || 0;
      const ax = axis(0);
      const ay = axis(1);
      const hatX = raw ? axis(6) : 0;
      const hatY = raw ? axis(7) : 0;
      s.up = s.up || pressed(map.up) || ay < -STICK_DEADZONE || hatY < -STICK_DEADZONE;
      s.down = s.down || pressed(map.down) || ay > STICK_DEADZONE || hatY > STICK_DEADZONE;
      s.left = s.left || pressed(map.left) || ax < -STICK_DEADZONE || hatX < -STICK_DEADZONE;
      s.right = s.right || pressed(map.right) || ax > STICK_DEADZONE || hatX > STICK_DEADZONE;
      s.a = s.a || pressed(map.a);
      s.b = s.b || pressed(map.b);
      s.x = s.x || pressed(map.x);
      s.y = s.y || pressed(map.y);
      s.lb = s.lb || pressed(map.lb);
      s.rb = s.rb || pressed(map.rb);
      s.start = s.start || pressed(map.start);
    }
    return s;
  }

  // update(pads, nowMs) gibt eine Liste von Aktionen zurück, die seit dem letzten Aufruf ausgelöst wurden.
  // Richtungen wiederholen sich bei gehaltener Taste (erst nach Verzögerung, dann gleichmäßig).
  function createMapper() {
    const prev = {};
    const nextRepeat = {};
    return {
      update(pads, now) {
        const state = readState(pads);
        const events = [];
        for (const key of Object.keys(state)) {
          const isDir = DIRS.indexOf(key) !== -1;
          if (state[key] && !prev[key]) {
            events.push(key);
            if (isDir) nextRepeat[key] = now + REPEAT_DELAY;
          } else if (state[key] && isDir && now >= nextRepeat[key]) {
            events.push(key);
            nextRepeat[key] = now + REPEAT_RATE;
          }
          prev[key] = state[key];
        }
        return events;
      },
    };
  }

  const api = { createMapper };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Input = api;
})(typeof window !== 'undefined' ? window : this);
