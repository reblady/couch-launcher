(function (root) {
  'use strict';

  // Übersetzungen. Der deutsche Text im Code ist zugleich der Schlüssel: Fehlt eine Übersetzung,
  // erscheint er einfach auf Deutsch. Platzhalter stehen in geschweiften Klammern, etwa {name}.
  // Eine neue Sprache ist eine weitere Datei wie lang-en.js, eingetragen in LANGS und in index.html.

  const LANGS =
    typeof module !== 'undefined' && module.exports ? { en: require('./lang-en') } : root.I18nLangs || {};

  const LOCALES = { de: 'de-DE', en: 'en-US' };
  let current = 'de';

  // 'auto' folgt der Systemsprache. Deutsch ist die Grundsprache, alles Unbekannte wird Englisch.
  function resolve(setting, systemLocale) {
    if (setting === 'de' || LANGS[setting]) return setting;
    const base = String(systemLocale || '').toLowerCase().split(/[-_]/)[0];
    if (base === 'de') return 'de';
    return LANGS[base] ? base : 'en';
  }

  function setLanguage(lang) {
    current = lang === 'de' || LANGS[lang] ? lang : 'de';
  }

  function language() {
    return current;
  }

  function locale() {
    return LOCALES[current] || current;
  }

  function t(text, params) {
    const dict = LANGS[current];
    const out = (dict && dict[text]) || text;
    if (!params) return out;
    return out.replace(/\{(\w+)\}/g, (match, key) => (key in params ? String(params[key]) : match));
  }

  const api = { t, resolve, setLanguage, language, locale, LANGS, LANGUAGES: ['de', ...Object.keys(LANGS)] };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.I18n = api;
})(typeof window !== 'undefined' ? window : this);
