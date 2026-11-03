(function (root) {
  'use strict';

  // Kleiner Ansichts-Stapel: unten liegt immer 'home', darüber z. B. 'details' oder 'quit'.
  // B nimmt die oberste Ansicht wieder herunter. Jede Ansicht merkt sich, wohin der Fokus zurück soll.
  function createViewStack() {
    const stack = [{ name: 'home', data: null, returnFocus: null }];
    return {
      top() {
        return stack[stack.length - 1];
      },
      depth() {
        return stack.length;
      },
      // Ansicht direkt über 'home': Ihr Rücksprungziel ist eine Kachel der Startseite
      base() {
        return stack[1] || null;
      },
      has(name) {
        return stack.some((v) => v.name === name);
      },
      find(name) {
        return stack.find((v) => v.name === name) || null;
      },
      push(name, data = null, returnFocus = null) {
        const view = { name, data, returnFocus };
        stack.push(view);
        return view;
      },
      // Gibt die entfernte Ansicht zurück, 'home' bleibt immer liegen (dann null)
      pop() {
        return stack.length > 1 ? stack.pop() : null;
      },
    };
  }

  // Einstellung "aButton": 'details' (Standard) oder 'launch'. X macht jeweils das andere.
  function tileActions(aButton) {
    return aButton === 'launch' ? { a: 'launch', x: 'details' } : { a: 'details', x: 'launch' };
  }

  const api = { createViewStack, tileActions };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Views = api;
})(typeof window !== 'undefined' ? window : this);
