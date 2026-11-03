(function () {
  'use strict';

  const { t } = window.I18n;
  const $ = (sel) => document.querySelector(sel);
  const recentSection = $('#recent-section');
  const recentGrid = $('#recent');
  const allSection = $('#all-section');
  const allGrid = $('#all');
  const allTitle = $('#all-title');
  const emptySection = $('#empty');
  const emptyTitle = $('#empty-title');
  const emptyText = $('#empty-text');
  const emptyActions = $('#empty-actions');
  const launchingEl = $('#launching');
  const launchingName = $('#launching-name');
  const confirmEl = $('#confirm');
  const toastEl = $('#toast');
  const detailsEl = $('#details');
  const settingsEl = $('#settings');
  const settingsList = $('#settings-list');

  const views = window.Views.createViewStack();
  // Zusatzverhalten von Ansichten, die andere Skripte über registerView anmelden
  const VIEW_EXT = {};
  let instances = [];
  let launching = false;
  // true, sobald das Minecraft-Fenster offen ist: dann landen Controller-Eingaben im Spiel, nicht hier
  let gameRunning = false;
  const S = window.Settings;
  let settings = S.normalize({});
  let actions = window.Views.tileActions(settings.aButton);
  const sound = window.Sounds.createPlayer();
  let toastTimer = null;

  // ---------- Hilfsfunktionen ----------

  function hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h;
  }

  function relTime(ms) {
    const diff = Date.now() - ms;
    const min = Math.floor(diff / 60000);
    if (min < 2) return t('gerade eben');
    if (min < 60) return t('vor {n} min', { n: min });
    const h = Math.floor(min / 60);
    if (h < 24) return t('vor {n} h', { n: h });
    const d = Math.floor(h / 24);
    if (d === 1) return t('gestern');
    if (d < 14) return t('vor {n} Tagen', { n: d });
    return new Date(ms).toLocaleDateString(window.I18n.locale());
  }

  function fmtDate(ms) {
    return new Date(ms).toLocaleString(window.I18n.locale(), { dateStyle: 'medium', timeStyle: 'short' });
  }

  function fmtDuration(sec) {
    if (sec < 3600) return t('{n} min', { n: Math.max(1, Math.round(sec / 60)) });
    const h = (sec / 3600).toLocaleString(window.I18n.locale(), { maximumFractionDigits: 1 });
    return t('{n} h', { n: h });
  }

  function fmtPlayed(sec) {
    return t('{time} gespielt', { time: fmtDuration(sec) });
  }

  function toast(message) {
    sound.play('error');
    toastEl.textContent = message;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, 8000);
  }

  function updateClock() {
    $('#clock').textContent = new Date().toLocaleTimeString(window.I18n.locale(), { hour: '2-digit', minute: '2-digit' });
  }

  // ---------- Rendering ----------

  function fillArt(art, inst) {
    const letters = (inst.name.match(/[A-Za-zÄÖÜäöü0-9]/g) || ['?']).slice(0, 2).join('').toUpperCase();
    const hue = hash(inst.name) % 360;
    art.dataset.hue = hue;
    art.style.background = `linear-gradient(135deg, hsl(${hue} 55% 38%), hsl(${(hue + 40) % 360} 50% 18%))`;
    if (inst.icon) {
      const img = document.createElement('img');
      img.alt = '';
      img.onerror = () => {
        art.replaceChildren();
        art.textContent = letters;
      };
      img.src = inst.icon;
      if (!inst.cover) {
        // Kleines Prism-Icon: mittig in Originalschärfe, dahinter dasselbe Bild groß und weichgezeichnet
        img.className = 'icon';
        const backdrop = document.createElement('img');
        backdrop.alt = '';
        backdrop.className = 'backdrop';
        backdrop.src = inst.icon;
        art.appendChild(backdrop);
      }
      art.appendChild(img);
    } else {
      art.textContent = letters;
    }
  }

  function makeTile(inst) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'tile';
    tile.dataset.id = inst.id;

    const art = document.createElement('div');
    art.className = 'art';
    fillArt(art, inst);

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = inst.name;

    const version = document.createElement('div');
    version.className = 'meta';
    version.textContent = [inst.mc, inst.loader].filter(Boolean).join(' · ') || 'Minecraft';

    const stats = document.createElement('div');
    stats.className = 'meta';
    stats.textContent = [
      inst.lastLaunch ? t('Zuletzt {when}', { when: relTime(inst.lastLaunch) }) : t('Noch nie gespielt'),
      inst.playedSeconds ? fmtPlayed(inst.playedSeconds) : null,
    ]
      .filter(Boolean)
      .join(' · ');

    tile.append(art, name, version, stats);
    tile.addEventListener('click', () => tileAction('a', inst));
    tile.addEventListener('focus', () => {
      document.body.style.setProperty('--hero', `${art.dataset.hue} 60% 32%`);
    });
    return tile;
  }

  function makeActionTile(symbol, title, subtitle, onClick) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'tile new-pack';
    const art = document.createElement('div');
    art.className = 'art';
    art.textContent = symbol;
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = title;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = subtitle;
    tile.append(art, name, meta);
    tile.addEventListener('click', onClick);
    return tile;
  }

  function makeNewPackTile() {
    return makeActionTile('+', t('Neues Modpack'), t('Selbst zusammenstellen'), () => ui.newPack());
  }

  function makeFindPackTile() {
    return makeActionTile('↓', t('Modpack herunterladen'), t('Fertige Packs von Modrinth'), () => ui.browsePacks());
  }

  function makeButton(label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tile btn';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function render(listing) {
    instances = listing.instances;
    recentGrid.replaceChildren();
    allGrid.replaceChildren();
    emptyActions.replaceChildren();

    if (!instances.length) {
      recentSection.hidden = true;
      allSection.hidden = true;
      emptySection.hidden = false;
      if (listing.dir) {
        emptyTitle.textContent = t('Keine Instanzen gefunden');
        emptyText.textContent = t('Der Ordner {dir} enthält keine Prism-Instanzen.', { dir: listing.dir });
      } else {
        emptyTitle.textContent = t('Prism-Ordner nicht gefunden');
        emptyText.textContent =
          t('Gesucht wurde in:') +
          '\n' +
          listing.tried.join('\n') +
          '\n\n' +
          t('Trage den richtigen Pfad als "instancesDir" in config.json ein.');
      }
      emptyActions.appendChild(makeButton(t('Neu laden'), () => refresh()));
      if (listing.dir) emptyActions.append(makeNewPackTile(), makeFindPackTile());
      return;
    }

    emptySection.hidden = true;
    const recent = instances.filter((i) => i.lastLaunch > 0).slice(0, 4);
    const rest = instances.filter((i) => !recent.includes(i));

    recent.forEach((i) => recentGrid.appendChild(makeTile(i)));
    rest.forEach((i) => allGrid.appendChild(makeTile(i)));
    allGrid.append(makeNewPackTile(), makeFindPackTile());
    recentSection.hidden = recent.length === 0;
    allSection.hidden = false;
    allTitle.textContent = recent.length ? t('Weitere Instanzen') : t('Alle Instanzen');
  }

  function fillDetails(inst) {
    const art = $('#details-art');
    art.replaceChildren();
    fillArt(art, inst);
    $('#details-name').textContent = inst.name;
    $('#details-mc').textContent = inst.mc || t('unbekannt');
    $('#details-loader').textContent = inst.loader || 'Vanilla';
    $('#details-played').textContent = inst.playedSeconds ? fmtDuration(inst.playedSeconds) : '–';
    $('#details-last').textContent = inst.lastLaunch
      ? `${relTime(inst.lastLaunch)} (${fmtDate(inst.lastLaunch)})`
      : t('Noch nie');
  }

  // Fußleiste passend zur obersten Ansicht beschriften
  function updateHints() {
    const view = views.top().name;
    const label = { details: t('Details'), launch: t('Starten') };
    const ext = VIEW_EXT[view];
    const custom = ext && ext.hints ? ext.hints() : {};
    const home = view === 'home';
    const x = home ? label[actions.x] : custom.x;
    const y = home ? t('Neu laden') : custom.y;
    $('#hint-a').textContent = custom.a || (home ? label[actions.a] : view === 'settings' ? t('Ändern') : t('Auswählen'));
    $('#hint-x').textContent = x || '';
    $('#hint-x-wrap').hidden = !x;
    $('#hint-y').textContent = y || '';
    $('#hint-y-wrap').hidden = !y;
    $('#hint-lb').textContent = custom.lb || '';
    $('#hint-lb-wrap').hidden = !custom.lb;
    $('#hint-b').textContent = custom.b || (home ? t('Beenden') : t('Zurück'));
  }

  async function refresh(keepId) {
    const top = views.top();
    const wanted =
      keepId ||
      (top.name === 'details' && top.data.id) ||
      (document.activeElement && document.activeElement.dataset.id) ||
      null;
    let listing;
    try {
      listing = await window.couch.listInstances();
    } catch (err) {
      toast(t('Instanzen konnten nicht geladen werden: {error}', { error: err.message }));
      return;
    }
    render(listing);

    // Offene Detailseite mit frischen Daten füllen (Spielzeit ändert sich nach dem Spielen)
    const open = views.find('details');
    if (open) {
      const fresh = instances.find((i) => i.id === open.data.id);
      if (fresh) {
        open.data = fresh;
        fillDetails(fresh);
      } else if (views.top() === open) {
        closeTop();
      }
    }
    // Kacheln sind neu, also Fokus direkt setzen oder als Rücksprungziel der offenen Ansicht merken
    const els = focusables('home');
    const tiles = els.filter((e) => e.dataset.id);
    // Ohne Wunschziel die erste Kachel: die zuletzt gespielte Instanz
    const target =
      tiles.find((e) => e.dataset.id === wanted) || tiles[0] || els.find((e) => e.id !== 'open-settings') || els[0] || null;
    if (views.top().name === 'home') {
      if (target) focusEl(target, false);
    } else {
      views.base().returnFocus = target;
    }
  }

  // ---------- Fokus und Navigation ----------

  const FOCUS_SEL = {
    home: '#content .tile, #open-settings',
    details: '#details-actions button',
    settings: '#settings-list .setting',
    quit: '#dialog button',
  };

  function focusables(view = views.top().name) {
    return Array.from(document.querySelectorAll(FOCUS_SEL[view])).filter((e) => e.offsetParent !== null);
  }

  function focusEl(el, scroll = true) {
    el.focus({ preventScroll: true });
    if (scroll) el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  }

  function move(dir) {
    const active = document.activeElement;
    const ext = VIEW_EXT[views.top().name];
    if (ext && ext.onMove && ext.onMove(dir, active)) return;
    if (views.top().name === 'settings' && (dir === 'left' || dir === 'right') && active && active.dataset.key) {
      changeSetting(active.dataset.key, dir === 'left' ? -1 : 1, false);
      return;
    }
    const els = focusables();
    if (!els.length) return;
    const current = els.indexOf(document.activeElement);
    const rects = els.map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    const next = window.Nav.findNext(rects, current, dir);
    if (next >= 0) {
      focusEl(els[next]);
      sound.play('move');
    } else {
      sound.play('bump');
    }
  }

  function activate() {
    const el = document.activeElement;
    if (el && el.tagName === 'BUTTON') el.click();
  }

  // ---------- Ansichten: Detailseite, Beenden-Dialog ----------

  const VIEW_EL = { details: detailsEl, settings: settingsEl, quit: confirmEl };

  function openView(name, data, firstFocus) {
    views.push(name, data, document.activeElement);
    VIEW_EL[name].hidden = false;
    updateHints();
    const el = firstFocus || focusables()[0];
    if (el) focusEl(el, false);
  }

  function closeTop(silent = false) {
    const view = views.pop();
    if (!view) return;
    if (!silent) sound.play('back');
    VIEW_EL[view.name].hidden = true;
    updateHints();
    const ext = VIEW_EXT[view.name];
    if (ext && ext.onClose) ext.onClose();
    const back = view.returnFocus;
    if (back && document.contains(back) && back.offsetParent !== null) focusEl(back, false);
    else {
      const els = focusables();
      const first = els.find((e) => e.dataset.id) || els[0];
      if (first) focusEl(first, false);
    }
  }

  function openDetails(inst) {
    sound.play('confirm');
    fillDetails(inst);
    detailsEl.scrollTop = 0;
    openView('details', inst, detailsEl.querySelector('[data-action="launch"]'));
  }

  function tileAction(button, inst) {
    if (launching || views.top().name !== 'home') return;
    if (actions[button] === 'details') openDetails(inst);
    else launch(inst);
  }

  async function openFolder(inst) {
    sound.play('confirm');
    let res;
    try {
      res = await window.couch.openFolder(inst.id);
    } catch (err) {
      res = { ok: false, error: err.message };
    }
    if (!res.ok) toast(res.error);
  }

  detailsEl.addEventListener('click', (event) => {
    const action = event.target.dataset && event.target.dataset.action;
    const inst = views.top().name === 'details' ? views.top().data : null;
    if (!inst) return;
    if (action === 'launch') launch(inst);
    else if (action === 'folder') openFolder(inst);
    else if (action === 'mods') ui.openContent(inst);
    else if (action === 'settings') ui.openPackSettings(inst);
    else if (action === 'back') closeTop();
  });

  // ---------- Einstellungen ----------

  // Feste Texte aus index.html. Der deutsche Text wird beim ersten Mal als Schlüssel gemerkt.
  function applyStaticTexts() {
    document.documentElement.lang = window.I18n.language();
    for (const node of document.querySelectorAll('[data-i18n]')) {
      if (!node.dataset.i18n) node.dataset.i18n = node.textContent.trim();
      node.textContent = t(node.dataset.i18n);
    }
  }

  // Wechselt die Sprache sofort: feste Texte, Kacheln, offene Einstellungen, Tastatur
  function applyLanguage(setting) {
    const lang = window.I18n.resolve(setting, navigator.language);
    const changed = lang !== window.I18n.language();
    window.I18n.setLanguage(lang);
    applyStaticTexts();
    if (!changed) return;
    updateClock();
    if (instances.length) refresh();
    if (views.has('settings')) {
      const key = document.activeElement && document.activeElement.dataset.key;
      renderSettings();
      const row = settingsList.querySelector(`[data-key="${key}"]`);
      if (row) focusEl(row, false);
    }
    ui.onLanguage();
  }

  function applySettings(next) {
    const languageChanged = next.language !== settings.language;
    settings = next;
    if (languageChanged) applyLanguage(settings.language);
    actions = window.Views.tileActions(settings.aButton);
    sound.configure({ enabled: settings.sounds, volume: settings.volume });
    updateHints();
  }

  function fillSettingRow(row, def) {
    const value = settings[def.key];
    const atStart = def.options ? def.options[0].value === value : value <= def.min;
    const atEnd = def.options ? def.options[def.options.length - 1].value === value : value >= def.max;

    const label = document.createElement('span');
    label.textContent = t(def.label);
    const box = document.createElement('span');
    box.className = 'value';
    const left = document.createElement('span');
    left.className = atStart ? 'arrow off' : 'arrow';
    left.textContent = '‹';
    const text = document.createElement('span');
    text.textContent = t(S.valueLabel(def, value));
    const right = document.createElement('span');
    right.className = atEnd ? 'arrow off' : 'arrow';
    right.textContent = '›';
    box.append(left);
    if (!def.options) {
      const meter = document.createElement('span');
      meter.className = 'meter';
      const fill = document.createElement('div');
      fill.style.width = `${Math.round(((value - def.min) / (def.max - def.min)) * 100)}%`;
      meter.appendChild(fill);
      box.append(meter);
    }
    box.append(text, right);
    row.replaceChildren(label, box);
  }

  function renderSettings() {
    settingsList.replaceChildren();
    for (const def of S.DEFS) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'tile setting';
      row.dataset.key = def.key;
      fillSettingRow(row, def);
      row.addEventListener('click', () => changeSetting(def.key, 1, true));
      settingsList.appendChild(row);
    }
  }

  async function changeSetting(key, dir, wrap) {
    const def = S.findDef(key);
    const value = S.stepValue(def, settings[key], dir, wrap);
    if (value === settings[key]) {
      sound.play('bump');
      return;
    }
    applySettings({ ...settings, [key]: value });
    const row = settingsList.querySelector(`[data-key="${key}"]`);
    if (row) fillSettingRow(row, def);
    // nach dem Übernehmen, damit man die neue Lautstärke gleich hört
    sound.play('move');
    let res;
    try {
      res = await window.couch.saveSettings({ [key]: value });
    } catch (err) {
      res = { ok: false, error: err.message };
    }
    if (!res.ok) toast(res.error);
  }

  function openSettings() {
    if (launching || views.top().name !== 'home') return;
    sound.play('open');
    renderSettings();
    settingsEl.scrollTop = 0;
    openView('settings', null);
  }

  $('#open-settings').addEventListener('click', openSettings);

  // ---------- Starten und Beenden ----------

  let preparing = false;

  async function launch(inst) {
    if (launching || preparing || views.has('quit')) return;
    preparing = true;
    let go = true;
    try {
      if (settings.controlifyCheck) go = await ui.confirmControlify(inst);
    } finally {
      preparing = false;
    }
    if (go) startGame(inst);
  }

  async function startGame(inst) {
    launching = true;
    gameRunning = false;
    sound.play('launch');
    launchingName.textContent = inst.name;
    for (const sel of ['#launching-bg', '#launching-art']) {
      const art = $(sel);
      art.replaceChildren();
      fillArt(art, inst);
    }
    setLaunchStage('spawn');
    launchingEl.hidden = false;
    let res;
    try {
      res = await window.couch.launch(inst.id);
    } catch (err) {
      res = { ok: false, error: err.message };
    }
    if (!res.ok) {
      hideLaunching();
      toast(res.error);
    }
  }

  const STAGE_TEXT = {
    spawn: t('Prism wird gestartet …'),
    loading: t('Minecraft lädt …'),
    started: t('Viel Spaß!'),
  };

  function setLaunchStage(stage) {
    launchingEl.dataset.stage = stage;
    $('#launching-status').textContent = STAGE_TEXT[stage];
    $('#launching-hint').hidden = stage === 'started';
  }

  function hideLaunching() {
    launching = false;
    gameRunning = false;
    launchingEl.hidden = true;
  }

  window.couch.onLaunchProgress((data) => {
    if (!launching || !STAGE_TEXT[data.stage]) return;
    setLaunchStage(data.stage);
    if (data.stage === 'started') gameRunning = true;
  });

  confirmEl.addEventListener('click', (event) => {
    const action = event.target.dataset && event.target.dataset.action;
    if (action === 'quit') window.couch.quit();
    else if (action === 'cancel') closeTop();
  });

  // B / Esc: Startanzeige ausblenden, sonst eine Ebene zurück, auf der Startseite Beenden-Dialog
  function back() {
    if (gameRunning) {
      return;
    } else if (launching) {
      sound.play('back');
      hideLaunching();
    } else if (views.depth() > 1) closeTop();
    else {
      sound.play('open');
      openView('quit', null, confirmEl.querySelector('[data-action="cancel"]'));
    }
  }

  function focusedInstance() {
    const id = document.activeElement && document.activeElement.dataset.id;
    return id ? instances.find((i) => i.id === id) : null;
  }

  function pressX() {
    const inst = focusedInstance();
    if (inst) tileAction('x', inst);
  }

  window.couch.onLaunchEnded((data) => {
    const keep = document.activeElement && document.activeElement.dataset.id;
    hideLaunching();
    if (!data.ok) toast(data.error);
    refresh(keep);
  });

  // ---------- Eingabe: Tastatur und Controller ----------

  const KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

  const VIEW_KEYS = { x: 'x', r: 'y', q: 'lb', e: 'rb' };

  window.addEventListener('keydown', (event) => {
    const ext = VIEW_EXT[views.top().name];
    if (ext && ext.onKey && !launching && ext.onKey(event)) {
      event.preventDefault();
      return;
    }
    if (ext && ext.onButton && !launching && !event.repeat && VIEW_KEYS[event.key.toLowerCase()]) {
      ext.onButton(VIEW_KEYS[event.key.toLowerCase()]);
      return;
    }
    if (KEYS[event.key]) {
      event.preventDefault();
      if (!launching) move(KEYS[event.key]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      back();
    } else if (event.key === 'F11') {
      event.preventDefault();
      window.couch.toggleFullscreen();
    } else if ((event.key === 'r' || event.key === 'R') && views.top().name === 'home' && !launching) {
      sound.play('confirm');
      refresh();
    } else if ((event.key === 'x' || event.key === 'X') && !event.repeat) {
      pressX();
    } else if ((event.key === 's' || event.key === 'S') && !event.repeat) {
      if (views.top().name === 'settings') closeTop();
      else openSettings();
    }
  });

  const mapper = window.Input.createMapper();

  function handlePad(action) {
    const ext = VIEW_EXT[views.top().name];
    if (ext && ext.onButton && !launching && ['x', 'y', 'lb', 'rb', 'start'].includes(action) && ext.onButton(action)) {
      return;
    }
    switch (action) {
      case 'up':
      case 'down':
      case 'left':
      case 'right':
        if (!launching) move(action);
        break;
      case 'a':
        if (!launching) activate();
        break;
      case 'b':
        back();
        break;
      case 'x':
        pressX();
        break;
      case 'start':
        if (views.top().name === 'settings') closeTop();
        else openSettings();
        break;
      case 'y':
        if (views.top().name === 'home' && !launching) {
          sound.play('confirm');
          refresh();
        }
        break;
      default:
        break;
    }
  }

  function loop(now) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const events = mapper.update(pads, now);
    // Ohne Fenster-Fokus (Spiel liegt darüber) Tasten verwerfen, sonst würde A im Spiel hier etwas starten
    if (document.hasFocus() && !gameRunning) events.forEach(handlePad);
    requestAnimationFrame(loop);
  }

  // Mauszeiger ausblenden, wenn er länger nicht bewegt wurde
  let cursorTimer = null;
  function showCursor() {
    document.body.classList.remove('nocursor');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => document.body.classList.add('nocursor'), 3000);
  }
  window.addEventListener('mousemove', showCursor);

  // ---------- Schnittstelle für weitere Ansichten (modpacks-ui.js) ----------

  const ui = {
    sound,
    toast,
    openView,
    closeTop,
    focusEl,
    focusables,
    updateHints,
    refresh,
    openDetails,
    instance: (id) => instances.find((i) => i.id === id) || null,
    top: () => views.top().name,
    settings: () => settings,
    registerView(name, el, selector, ext = {}) {
      VIEW_EL[name] = el;
      FOCUS_SEL[name] = selector;
      VIEW_EXT[name] = ext;
    },
    // werden von modpacks-ui.js gesetzt
    newPack() {},
    openContent() {},
    confirmControlify: async () => true,
    openPackSettings() {},
    browsePacks() {},
    onLanguage() {},
  };
  window.CouchUI = ui;

  // ---------- Start ----------

  updateClock();
  setInterval(updateClock, 30000);
  showCursor();
  applyLanguage(settings.language);
  updateHints();
  window.couch
    .getSettings()
    .then((loaded) => applySettings(S.normalize(loaded)))
    .catch(() => {});
  refresh();
  requestAnimationFrame(loop);
})();
