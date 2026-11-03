(function (root) {
  'use strict';

  // Bildschirmtastatur: Layout und Tastenlogik, ohne DOM (läuft auch in Node-Tests)
  // Alle Reihen sind gleich breit, damit die Spalten genau untereinander stehen. span: Breite in Spalten.
  const COLUMNS = 10;
  const ROWS = ['1234567890', 'qwertzuiop', 'asdfghjkl+', 'yxcvbnm-_.'];
  const SPECIAL = [
    { key: 'shift', label: 'Groß', span: 2 },
    { key: 'space', label: 'Leerzeichen', span: 4 },
    { key: 'back', label: 'Löschen', span: 2 },
    { key: 'done', label: 'Fertig', span: 2 },
  ];

  function createState(text = '', max = 60) {
    return { text: String(text).slice(0, max), max, shift: false };
  }

  // Gibt den neuen Zustand zurück, die Eingabe bleibt unverändert
  function applyKey(state, key) {
    if (key === 'shift') return { ...state, shift: !state.shift };
    if (key === 'back') return { ...state, text: Array.from(state.text).slice(0, -1).join('') };
    const ch = key === 'space' ? ' ' : key;
    if (Array.from(ch).length !== 1 || Array.from(state.text).length >= state.max) return state;
    return { ...state, text: state.text + (state.shift ? ch.toUpperCase() : ch), shift: false };
  }

  const api = { COLUMNS, ROWS, SPECIAL, createState, applyKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Osk = api;
})(typeof window !== 'undefined' ? window : this);
