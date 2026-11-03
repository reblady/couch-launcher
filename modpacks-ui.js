(function () {
  'use strict';

  // Ansichten für den Modpack-Baukasten: Bildschirmtastatur, neues Modpack, Inhalte verwalten und suchen

  const ui = window.CouchUI;
  const { Osk, couch } = window;
  const $ = (sel) => document.querySelector(sel);

  const TYPES = [
    { type: 'mod', label: 'Mods' },
    { type: 'resourcepack', label: 'Ressourcenpakete' },
    { type: 'shader', label: 'Shader' },
  ];

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(className) {
    const b = el('button', className);
    b.type = 'button';
    return b;
  }

  function icon(url) {
    const box = el('span', 'mod-icon');
    if (url) {
      const img = el('img');
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = () => img.remove();
      img.src = url;
      box.appendChild(img);
    }
    return box;
  }

  // ---------- Hinweise unten ----------

  const noticeEl = $('#notice');
  let noticeTimer = null;

  function notice(message, sticky = false) {
    noticeEl.textContent = message;
    noticeEl.hidden = false;
    clearTimeout(noticeTimer);
    if (!sticky) noticeTimer = setTimeout(() => (noticeEl.hidden = true), 4000);
  }

  // ---------- Bildschirmtastatur ----------

  const oskEl = $('#keyboard');
  const oskText = $('#osk-text');
  const oskKeys = $('#osk-keys');
  let osk = null;
  let oskDone = null;

  function drawOsk() {
    oskText.textContent = osk.text;
    oskKeys.classList.toggle('upper', osk.shift);
  }

  function oskPress(key) {
    if (key === 'done') {
      finishOsk(osk.text);
      return;
    }
    osk = Osk.applyKey(osk, key);
    ui.sound.play('move');
    drawOsk();
  }

  function finishOsk(result) {
    oskDone = result;
    ui.closeTop(result !== null);
  }

  function buildOsk() {
    const add = (row, key, label) => {
      const b = button('tile key');
      b.dataset.k = key;
      b.textContent = label;
      b.addEventListener('click', () => oskPress(key));
      row.appendChild(b);
    };
    oskKeys.style.gridTemplateColumns = `repeat(${Osk.COLUMNS}, 1fr)`;
    for (const keys of Osk.ROWS) {
      const row = el('div', 'osk-row');
      for (const k of keys) add(row, k, k);
      oskKeys.appendChild(row);
    }
    const row = el('div', 'osk-row special');
    for (const s of Osk.SPECIAL) {
      add(row, s.key, s.label);
      row.lastChild.style.gridColumn = `span ${s.span}`;
    }
    oskKeys.appendChild(row);
  }

  let oskResolve = null;

  // Fragt Text per Controller ab. Ergebnis ist null, wenn abgebrochen wurde.
  function askText({ title, value = '', max = 60 }) {
    return new Promise((resolve) => {
      osk = Osk.createState(value, max);
      oskDone = null;
      oskResolve = resolve;
      $('#osk-title').textContent = title;
      drawOsk();
      ui.sound.play('open');
      ui.openView('keyboard', null, oskKeys.querySelector('[data-k="q"]'));
    });
  }

  ui.registerView('keyboard', oskEl, '#osk-keys .key', {
    hints: () => ({ a: 'Taste', x: 'Löschen', y: 'Leerzeichen', lb: 'Groß', b: 'Abbrechen' }),
    onClose() {
      const resolve = oskResolve;
      oskResolve = null;
      if (resolve) resolve(oskDone);
    },
    onButton(name) {
      if (name === 'x') oskPress('back');
      else if (name === 'y') oskPress('space');
      else if (name === 'lb' || name === 'rb') oskPress('shift');
      else if (name === 'start') finishOsk(osk.text);
      return true;
    },
    // Echte Tastatur funktioniert nebenbei auch
    onKey(event) {
      if (event.key === 'Backspace') oskPress('back');
      else if (event.key === 'Enter') finishOsk(osk.text);
      else if (event.key === ' ') oskPress('space');
      else if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
        if (osk.text.length < osk.max) {
          osk = { ...osk, text: osk.text + event.key };
          ui.sound.play('move');
          drawOsk();
        }
      } else return false;
      return true;
    },
  });

  // ---------- Rückfrage ----------

  const askEl = $('#ask');
  const askButtons = $('#ask-buttons');
  let askResolve = null;
  let askResult = null;

  // Fragt zwischen mehreren Möglichkeiten, die erste ist vorausgewählt. Mit B ist das Ergebnis null.
  function askChoice({ title, text = '', choices }) {
    return new Promise((resolve) => {
      askResolve = resolve;
      askResult = null;
      $('#ask-title').textContent = title;
      $('#ask-text').textContent = text;
      $('#ask-text').hidden = !text;
      askButtons.classList.toggle('stack', choices.length > 2);
      askButtons.replaceChildren(
        ...choices.map((choice) => {
          const b = button(choice.primary ? 'tile btn play' : 'tile btn');
          b.textContent = choice.label;
          b.addEventListener('click', () => {
            askResult = choice.value;
            ui.closeTop(choice.value !== null);
          });
          return b;
        })
      );
      ui.sound.play('open');
      ui.openView('ask', null);
    });
  }

  async function askConfirm({ title, text, yes }) {
    const choices = [
      { label: 'Abbrechen', value: null },
      { label: yes, value: true },
    ];
    return (await askChoice({ title, text, choices })) === true;
  }

  ui.registerView('ask', askEl, '#ask button', {
    onClose() {
      const resolve = askResolve;
      askResolve = null;
      if (resolve) resolve(askResult);
    },
  });

  // ---------- Controlify vor dem Start ----------

  async function addControlify(id) {
    notice('Controlify wird hinzugefügt …', true);
    const res = await couch.addControlify(id);
    noticeEl.hidden = true;
    if (!res.ok) {
      ui.toast(`Controlify nicht hinzugefügt: ${res.error}`);
      return false;
    }
    if (res.missing && res.missing.length) {
      ui.toast(`Keine passende Version für: ${res.missing.join(', ')}`);
      return false;
    }
    return true;
  }

  // true: Spiel starten. Ein Fehler bei der Prüfung hält den Start nie auf.
  ui.confirmControlify = async (instance) => {
    const res = await couch.checkControlify(instance.id);
    if (!res.ok || res.state === 'ok') return true;

    const off = res.state === 'disabled';
    let text = off
      ? 'Controlify ist in diesem Modpack ausgeschaltet. Ohne die Mod kannst du Minecraft nicht mit dem Controller spielen.'
      : 'Ohne die Mod Controlify kannst du Minecraft nicht mit dem Controller spielen.';
    if (!res.installable) text += ' Für dieses Modpack lässt sie sich gerade nicht hinzufügen.';

    const choices = [];
    if (res.installable) {
      choices.push({ label: off ? 'Einschalten und starten' : 'Hinzufügen und starten', value: 'add', primary: true });
    }
    choices.push({ label: 'Ohne Controlify starten', value: 'skip' }, { label: 'Abbrechen', value: null });

    const choice = await askChoice({ title: 'Wirklich ohne Controlify starten?', text, choices });
    if (choice === 'add') return addControlify(instance.id);
    return choice === 'skip';
  };

  // ---------- Neues Modpack ----------

  const newpackEl = $('#newpack');
  const newpackRows = $('#newpack-rows');
  let draft = null;
  let creating = false;

  function draftFields() {
    return [
      { key: 'mc', label: 'Minecraft-Version', values: draft.options.minecraft.map((v) => ({ value: v, label: v })) },
      { key: 'loader', label: 'Mod-Loader', values: draft.options.loaders },
    ];
  }

  function fillRow(row, label, value, withArrows) {
    const box = el('span', 'value');
    if (withArrows) box.append(el('span', 'arrow', '‹'));
    box.append(el('span', '', value));
    if (withArrows) box.append(el('span', 'arrow', '›'));
    row.replaceChildren(el('span', '', label), box);
  }

  function drawDraft() {
    const focused = document.activeElement && document.activeElement.dataset.field;
    newpackRows.replaceChildren();

    const name = button('tile setting');
    name.dataset.field = 'name';
    fillRow(name, 'Name', draft.name, false);
    name.addEventListener('click', editName);
    newpackRows.appendChild(name);

    for (const field of draftFields()) {
      const row = button('tile setting');
      row.dataset.field = field.key;
      fillRow(row, field.label, field.values.find((v) => v.value === draft[field.key]).label, true);
      row.addEventListener('click', () => stepDraft(field.key, 1, true));
      newpackRows.appendChild(row);
    }

    const create = button('tile btn play');
    create.dataset.field = 'create';
    create.textContent = 'Erstellen';
    create.addEventListener('click', createPack);
    newpackRows.appendChild(create);

    const again = newpackRows.querySelector(`[data-field="${focused}"]`);
    if (again) ui.focusEl(again, false);
  }

  async function editName() {
    const text = await askText({ title: 'Name des Modpacks', value: draft.name, max: 40 });
    if (text !== null && text.trim()) draft.name = text.trim();
    drawDraft();
    const row = newpackRows.querySelector('[data-field="name"]');
    if (row) ui.focusEl(row, false);
  }

  function stepDraft(key, dir, wrap) {
    const values = draftFields().find((f) => f.key === key).values;
    const i = values.findIndex((v) => v.value === draft[key]);
    const n = wrap ? (i + dir + values.length) % values.length : i + dir;
    if (n < 0 || n >= values.length) {
      ui.sound.play('bump');
      return;
    }
    draft[key] = values[n].value;
    ui.sound.play('move');
    drawDraft();
  }

  async function createPack() {
    if (creating) return;
    creating = true;
    notice('Modpack wird angelegt …', true);
    const res = await couch.createPack({ name: draft.name, mc: draft.mc, loader: draft.loader });
    creating = false;
    noticeEl.hidden = true;
    if (!res.ok) {
      ui.toast(res.error);
      return;
    }
    ui.sound.play('confirm');
    ui.closeTop(true);
    await ui.refresh(res.id);
    const inst = ui.instance(res.id);
    if (inst) {
      ui.openDetails(inst);
      openBrowse(inst, 'mod');
    }
  }

  ui.registerView('newpack', newpackEl, '#newpack-rows .tile', {
    hints: () => ({ a: 'Auswählen' }),
    onMove(dir, active) {
      const field = active && active.dataset.field;
      if ((dir !== 'left' && dir !== 'right') || (field !== 'mc' && field !== 'loader')) return false;
      stepDraft(field, dir === 'left' ? -1 : 1, false);
      return true;
    },
  });

  ui.newPack = async () => {
    if (creating) return;
    notice('Versionen werden geladen …', true);
    const res = await couch.packOptions();
    noticeEl.hidden = true;
    if (!res.ok) {
      ui.toast(`Versionen nicht geladen: ${res.error}`);
      return;
    }
    if (ui.top() !== 'home') return;
    draft = { name: 'Mein Modpack', mc: res.minecraft[0], loader: res.loaders[0].value, options: res };
    newpackRows.replaceChildren();
    drawDraft();
    ui.sound.play('open');
    ui.openView('newpack', null);
  };

  // ---------- Einstellungen pro Modpack ----------

  const packEl = $('#packsettings');
  const packRows = $('#packsettings-rows');
  const WINDOWS = ['default', 'max', '1280x720', '1920x1080', '2560x1440'];
  let packInst = null;
  let packState = null;

  function fmtMemory(mb) {
    return `${(mb / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} GB`;
  }

  function memoryLabel(mb) {
    if (mb) return fmtMemory(mb);
    return packState.globalMemory ? `Wie in Prism (${fmtMemory(packState.globalMemory)})` : 'Wie in Prism';
  }

  function windowLabel(value) {
    if (value === 'default') return ui.settings().gameFullscreen ? 'Vollbild' : 'Wie in Prism';
    return value === 'max' ? 'Maximiert' : value.replace('x', ' × ');
  }

  function packFields() {
    const current = packState.settings.window;
    return [
      { key: 'memory', label: 'Arbeitsspeicher', values: packState.memoryOptions, text: memoryLabel },
      { key: 'window', label: 'Fenstergröße', values: WINDOWS.includes(current) ? WINDOWS : [...WINDOWS, current], text: windowLabel },
    ];
  }

  function drawPackRows(focusField) {
    packRows.replaceChildren();

    const name = button('tile setting');
    name.dataset.field = 'name';
    fillRow(name, 'Name', packState.settings.name, false);
    name.addEventListener('click', editPackName);
    packRows.appendChild(name);

    for (const field of packFields()) {
      const row = button('tile setting');
      row.dataset.field = field.key;
      fillRow(row, field.label, field.text(packState.settings[field.key]), true);
      row.addEventListener('click', () => stepPack(field.key, 1, true));
      packRows.appendChild(row);
    }

    if (packInst.managedId) {
      const version = button('tile setting');
      version.dataset.field = 'packversion';
      fillRow(version, 'Modpack-Version', packInst.managedVersionName || 'Unbekannt', false);
      version.addEventListener('click', openPackSwitch);
      packRows.appendChild(version);
    }

    const remove = button('tile btn danger');
    remove.dataset.field = 'delete';
    remove.textContent = 'Modpack löschen';
    remove.addEventListener('click', deletePack);
    packRows.appendChild(remove);

    const target = packRows.querySelector(`[data-field="${focusField}"]`);
    if (target) ui.focusEl(target, false);
  }

  async function savePack(patch) {
    const res = await couch.savePackSettings(packInst.id, patch);
    if (!res.ok) {
      ui.toast(`Nicht gespeichert: ${res.error}`);
      return false;
    }
    return true;
  }

  function stepPack(key, dir, wrap) {
    const { values } = packFields().find((f) => f.key === key);
    const i = values.indexOf(packState.settings[key]);
    const n = wrap ? (i + dir + values.length) % values.length : i + dir;
    if (n < 0 || n >= values.length) {
      ui.sound.play('bump');
      return;
    }
    const value = values[n];
    packState.settings[key] = value;
    ui.sound.play('move');
    drawPackRows(key);
    savePack({ [key]: value });
  }

  async function editPackName() {
    const text = await askText({ title: 'Name des Modpacks', value: packState.settings.name, max: 40 });
    if (text !== null && text.trim() && text.trim() !== packState.settings.name && (await savePack({ name: text.trim() }))) {
      packState.settings.name = text.trim();
      $('#packsettings-title').textContent = text.trim();
      await ui.refresh(packInst.id);
    }
    drawPackRows('name');
  }

  async function deletePack() {
    const yes = await askConfirm({
      title: `„${packState.settings.name}“ löschen?`,
      text: 'Das Modpack wandert samt Welten in den Papierkorb und lässt sich von dort zurückholen.',
      yes: 'Löschen',
    });
    if (!yes) return;
    const res = await couch.deletePack(packInst.id);
    if (!res.ok) {
      ui.toast(`Löschen fehlgeschlagen: ${res.error}`);
      return;
    }
    // Einstellungen und Detailseite gehören zur gelöschten Instanz
    ui.closeTop(true);
    ui.closeTop(true);
    await ui.refresh();
    notice(`${packState.settings.name} liegt im Papierkorb`);
  }

  ui.registerView('packsettings', packEl, '#packsettings-rows .tile', {
    hints: () => ({ a: 'Ändern' }),
    onMove(dir, active) {
      const field = active && active.dataset.field;
      if ((dir !== 'left' && dir !== 'right') || (field !== 'memory' && field !== 'window')) return false;
      stepPack(field, dir === 'left' ? -1 : 1, false);
      return true;
    },
  });

  ui.openPackSettings = async (instance) => {
    const res = await couch.packSettings(instance.id);
    if (!res.ok) {
      ui.toast(res.error);
      return;
    }
    if (ui.top() !== 'details') return;
    packInst = instance;
    packState = res;
    $('#packsettings-title').textContent = res.settings.name;
    packEl.scrollTop = 0;
    drawPackRows('');
    ui.sound.play('confirm');
    ui.openView('packsettings', null);
  };

  // ---------- Gemeinsam: Reiter für Inhaltstypen ----------

  let inst = null;
  let type = 'mod';

  function typesFor(instance) {
    return TYPES.filter((t) => t.type !== 'mod' || instance.loader);
  }

  function drawTabs(selector) {
    const box = $(selector);
    box.replaceChildren(
      ...typesFor(inst).map((t) => el('span', t.type === type ? 'tab active' : 'tab', t.label))
    );
  }

  function nextType(dir) {
    const list = typesFor(inst);
    const i = list.findIndex((t) => t.type === type);
    const next = list[i + dir];
    if (!next) {
      ui.sound.play('bump');
      return false;
    }
    type = next.type;
    ui.sound.play('move');
    return true;
  }

  function firstType(instance, wanted) {
    const list = typesFor(instance);
    return (list.find((t) => t.type === wanted) || list[0]).type;
  }

  // ---------- Installierte Inhalte ----------

  const listEl = $('#content-list');
  const listItems = $('#content-list-items');
  let items = [];
  let listToken = 0;
  // null: noch nicht geprüft, sonst Map(Datei -> neue Version)
  let updates = null;
  let updating = false;

  function makeItemRow(item) {
    const row = button('tile setting');
    row.dataset.file = item.file;
    const left = el('span', 'item');
    left.append(icon(item.icon), el('span', '', item.title || item.name));
    const update = updates && updates.get(item.file);
    const state = item.enabled ? 'An' : 'Aus';
    row.append(left, el('span', item.enabled ? 'value' : 'value off', update ? `Update: ${update} · ${state}` : state));
    row.addEventListener('click', () => toggleItem(item));
    return row;
  }

  function drawItems(focusFile) {
    const rows = items.map(makeItemRow);
    const add = button('tile setting');
    add.dataset.file = '';
    add.append(el('span', '', '+ Hinzufügen'));
    add.addEventListener('click', () => openBrowse(inst, type));

    const update = button('tile setting');
    update.dataset.file = '';
    update.dataset.action = 'update';
    const open = updates ? updates.size : 0;
    const single = open > 0 && Boolean(inst.managedId);
    update.append(el('span', '', single ? `${open} ${open === 1 ? 'Update' : 'Updates'} verfügbar` : open ? `Alle aktualisieren (${open})` : 'Nach Updates suchen'));
    if (updates && !open) update.append(el('span', 'value off', 'Alles aktuell'));
    if (single) update.append(el('span', 'value off', 'Einzeln mit Y'));
    update.addEventListener('click', () => {
      if (single) notice('Bei Modpacks mit Y einzeln aktualisieren. Das ganze Pack hebst du in den Einstellungen an.');
      else if (open) applyUpdates();
      else checkUpdates();
    });

    listItems.replaceChildren(add, update, ...rows);
    if (ui.top() !== 'list') return;
    const target = rows.find((r) => r.dataset.file === focusFile) || (focusFile === 'update' ? update : add);
    ui.focusEl(target, false);
  }

  async function checkUpdates() {
    if (updating) return;
    updating = true;
    ui.sound.play('confirm');
    notice('Suche nach Updates …', true);
    const res = await couch.findContentUpdates({ id: inst.id, type });
    updating = false;
    noticeEl.hidden = true;
    if (!res.ok) {
      ui.toast(`Updates nicht geprüft: ${res.error}`);
      return;
    }
    updates = new Map(res.updates.map((u) => [u.file, u.to]));
    drawItems('update');
  }

  function afterUpdate(res) {
    const problems = [];
    if (res.skipped.length) problems.push(`Übersprungen: ${res.skipped.join(', ')}`);
    if (res.missing.length) problems.push(`Keine passende Version für: ${res.missing.join(', ')}`);
    if (problems.length) ui.toast(problems.join(' · '));
  }

  async function updateOne(item) {
    if (updating) return;
    const name = item.title || item.name;
    if (inst.managedId) {
      const yes = await askConfirm({
        title: `„${name}“ aktualisieren?`,
        text: 'In Modpacks sind die Mods aufeinander abgestimmt, ein einzelnes Update kann Probleme machen. Die alte Datei wird ersetzt.',
        yes: 'Aktualisieren',
      });
      if (!yes) return;
    }
    updating = true;
    ui.sound.play('confirm');
    notice(`${name} wird aktualisiert …`, true);
    const res = await couch.updateContent({ id: inst.id, type, file: item.file });
    updating = false;
    noticeEl.hidden = true;
    if (!res.ok) {
      ui.toast(`Update abgebrochen: ${res.error}`);
      return;
    }
    afterUpdate(res);
    const open = updates;
    if (res.updated) {
      open.delete(item.file);
      notice(`${name} aktualisiert`);
    }
    const moved = res.replaced.find((r) => r.from === item.file);
    await loadItems(moved ? moved.to : item.file, open);
  }

  async function applyUpdates() {
    if (updating) return;
    const label = TYPES.find((t) => t.type === type).label;
    const yes = await askConfirm({
      title: `${updates.size} ${updates.size === 1 ? 'Eintrag' : label} aktualisieren?`,
      text: 'Die alten Dateien werden ersetzt.',
      yes: 'Aktualisieren',
    });
    if (!yes) return;
    updating = true;
    ui.sound.play('confirm');
    notice('Updates werden vorbereitet …', true);
    const res = await couch.updateContent({ id: inst.id, type });
    updating = false;
    noticeEl.hidden = true;
    if (!res.ok) {
      ui.toast(`Update abgebrochen: ${res.error}`);
      loadItems();
      return;
    }
    notice(`${res.updated} aktualisiert`);
    afterUpdate(res);
    await loadItems();
  }

  // keep: bekannte Updates behalten, damit nach einem Einzel-Update nicht neu gesucht werden muss
  async function loadItems(focusFile, keep = null) {
    const token = ++listToken;
    items = [];
    updates = keep;
    drawTabs('#content-list-tabs');
    drawItems();
    const res = await couch.installedContent({ id: inst.id, type });
    if (token !== listToken) return;
    if (!res.ok) {
      ui.toast(res.error);
      return;
    }
    items = res.items;
    drawItems(focusFile);
  }

  async function toggleItem(item) {
    const res = await couch.toggleContent({ id: inst.id, type, file: item.file, enabled: !item.enabled });
    if (!res.ok) {
      ui.toast(res.error);
      return;
    }
    ui.sound.play('move');
    item.file = res.file;
    item.enabled = !item.enabled;
    drawItems(res.file);
  }

  async function removeItem(item) {
    const yes = await askConfirm({ title: `„${item.title || item.name}“ entfernen?`, yes: 'Entfernen' });
    if (!yes) return;
    const res = await couch.removeContent({ id: inst.id, type, file: item.file });
    if (!res.ok) {
      ui.toast(res.error);
      return;
    }
    const i = items.indexOf(item);
    items.splice(i, 1);
    const next = items[i] || items[i - 1];
    drawItems(next ? next.file : undefined);
  }

  // Der Hinweis für Y hängt von der gewählten Zeile ab
  listItems.addEventListener('focusin', () => ui.updateHints());

  ui.registerView('list', listEl, '#content-list-items .tile', {
    hints() {
      const file = document.activeElement && document.activeElement.dataset.file;
      const y = updates && updates.has(file) ? 'Aktualisieren' : 'Hinzufügen';
      return { a: 'An / Aus', x: 'Entfernen', y, lb: 'Kategorie' };
    },
    onButton(name) {
      if (name === 'x') {
        const item = items.find((i) => i.file === document.activeElement.dataset.file);
        if (item) removeItem(item);
        else ui.sound.play('bump');
      } else if (name === 'y') {
        const item = items.find((i) => i.file === document.activeElement.dataset.file);
        if (item && updates && updates.has(item.file)) updateOne(item);
        else openBrowse(inst, type);
      } else if ((name === 'lb' || name === 'rb') && nextType(name === 'lb' ? -1 : 1)) {
        loadItems();
      }
      return name !== 'start';
    },
  });

  ui.openContent = (instance) => {
    inst = instance;
    type = firstType(instance, 'mod');
    $('#content-list-title').textContent = instance.name;
    listEl.scrollTop = 0;
    ui.sound.play('confirm');
    ui.openView('list', null);
    loadItems();
  };

  // ---------- Suchen und installieren ----------

  const browseEl = $('#content-browse');
  const results = $('#content-browse-results');
  const statusEl = $('#content-browse-status');
  const searchBtn = $('#content-search');
  let query = '';
  let offset = 0;
  let total = 0;
  let installed = new Set();
  let searchToken = 0;
  let installingId = null;

  function drawSearchButton() {
    const box = el('span', query ? 'value' : 'value off', query || 'Alles, nach Beliebtheit');
    searchBtn.replaceChildren(el('span', '', 'Suchen'), box);
  }

  function cardFor(hit) {
    const card = button('tile mod-card');
    card.dataset.project = hit.id;
    const head = el('span', 'mod-head');
    const text = el('span', 'mod-title');
    text.append(el('span', 'name', hit.title), el('span', 'meta', `${hit.author} · ${hit.downloads.toLocaleString('de-DE', { notation: 'compact' })} Downloads`));
    head.append(icon(hit.icon), text);
    card.append(head, el('span', 'mod-desc', hit.description));
    return card;
  }

  function makeCard(hit) {
    const card = cardFor(hit);
    card.append(el('span', 'badge', ''));
    card.addEventListener('click', () => install(hit, card));
    markCard(card);
    return card;
  }

  function markCard(card) {
    const id = card.dataset.project;
    const badge = card.querySelector('.badge');
    badge.textContent = id === installingId ? 'Wird installiert …' : installed.has(id) ? 'Installiert' : '';
    badge.hidden = !badge.textContent;
  }

  function markCards() {
    results.querySelectorAll('.mod-card').forEach(markCard);
  }

  function moreButton() {
    const more = button('tile btn more');
    more.textContent = 'Mehr laden';
    more.addEventListener('click', () => search(offset + 24));
    return more;
  }

  async function search(from = 0) {
    const token = ++searchToken;
    if (from === 0) {
      results.replaceChildren();
      statusEl.textContent = 'Suche läuft …';
    }
    const res = await couch.searchContent({ id: inst.id, type, query, offset: from });
    if (token !== searchToken) return;
    if (!res.ok) {
      statusEl.textContent = '';
      ui.toast(`Suche fehlgeschlagen: ${res.error}`);
      return;
    }
    offset = from;
    total = res.total;
    statusEl.textContent = total ? '' : 'Nichts gefunden.';
    const old = results.querySelector('.more');
    if (old) old.remove();
    const cards = res.hits.map(makeCard);
    results.append(...cards);
    if (offset + res.hits.length < total) results.appendChild(moreButton());
    if (ui.top() === 'browse' && (from > 0 || document.activeElement === document.body) && cards[0]) {
      ui.focusEl(cards[0], false);
    }
  }

  async function loadInstalled() {
    const res = await couch.installedContent({ id: inst.id, type });
    if (!res.ok) return;
    installed = new Set(res.items.map((i) => i.projectId).filter(Boolean));
    markCards();
  }

  async function install(hit, card) {
    if (installingId) {
      ui.sound.play('bump');
      return;
    }
    if (installed.has(hit.id)) {
      ui.sound.play('bump');
      notice(`${hit.title} ist schon installiert.`);
      return;
    }
    installingId = hit.id;
    markCard(card);
    ui.sound.play('confirm');
    notice(`${hit.title} wird vorbereitet …`, true);
    const res = await couch.installContent({ id: inst.id, type, projectId: hit.id });
    installingId = null;
    noticeEl.hidden = true;
    if (!res.ok) {
      markCards();
      ui.toast(res.error);
      return;
    }
    res.ids.forEach((id) => installed.add(id));
    markCards();
    const extra = res.installed.length - 1;
    notice(extra > 0 ? `${hit.title} und ${extra} Abhängigkeiten installiert` : `${hit.title} installiert`);
    if (res.missing.length) ui.toast(`Keine passende Version für: ${res.missing.join(', ')}`);
  }

  async function editQuery() {
    const text = await askText({ title: 'Suchen', value: query, max: 60 });
    if (ui.top() === 'browse') ui.focusEl(searchBtn, false);
    if (text === null) return;
    query = text.trim();
    drawSearchButton();
    search();
  }

  function startBrowse() {
    drawTabs('#content-browse-tabs');
    drawSearchButton();
    installed = new Set();
    loadInstalled();
    return search();
  }

  searchBtn.addEventListener('click', editQuery);
  couch.onContentProgress((p) => notice(`Lade ${p.title} (${p.done + 1}/${p.total}) …`, true));

  ui.registerView('browse', browseEl, '#content-search, #content-browse-results .tile', {
    hints: () => ({ a: 'Installieren', y: 'Suchen', lb: 'Kategorie' }),
    // Die Liste dahinter kann durch Installieren oder Kategoriewechsel veraltet sein
    onClose() {
      if (!listEl.hidden) loadItems();
    },
    onButton(name) {
      if (name === 'y') editQuery();
      else if ((name === 'lb' || name === 'rb') && nextType(name === 'lb' ? -1 : 1)) {
        query = '';
        startBrowse();
        ui.focusEl(searchBtn, false);
      }
      return name !== 'start' && name !== 'x';
    },
  });

  function openBrowse(instance, wanted) {
    inst = instance;
    type = firstType(instance, wanted);
    query = '';
    $('#content-browse-title').textContent = `${instance.name}: hinzufügen`;
    browseEl.scrollTop = 0;
    ui.sound.play('confirm');
    ui.openView('browse', null, searchBtn);
    startBrowse();
  }

  // ---------- Fertige Modpacks ----------

  const packBrowseEl = $('#pack-browse');
  const packResults = $('#pack-results');
  const packStatus = $('#pack-status');
  const packSearchBtn = $('#pack-search');
  const packVersionsEl = $('#pack-versions');
  const packVersionsList = $('#pack-versions-list');
  const packInstallEl = $('#pack-install');
  const LOADER_NAMES = { fabric: 'Fabric', quilt: 'Quilt', neoforge: 'NeoForge', forge: 'Forge', minecraft: 'Vanilla' };
  let packQuery = '';
  let packOffset = 0;
  let packToken = 0;
  let packInstalling = false;
  let versionsHint = 'Installieren';

  function drawPackSearch() {
    packSearchBtn.replaceChildren(
      el('span', '', 'Suchen'),
      el('span', packQuery ? 'value' : 'value off', packQuery || 'Alles, nach Beliebtheit')
    );
  }

  async function searchPacks(from = 0) {
    const token = ++packToken;
    if (from === 0) {
      packResults.replaceChildren();
      packStatus.textContent = 'Suche läuft …';
    }
    const res = await couch.searchPacks({ query: packQuery, offset: from });
    if (token !== packToken) return;
    if (!res.ok) {
      packStatus.textContent = '';
      ui.toast(`Suche fehlgeschlagen: ${res.error}`);
      return;
    }
    packOffset = from;
    packStatus.textContent = res.total ? '' : 'Nichts gefunden.';
    const old = packResults.querySelector('.more');
    if (old) old.remove();
    const cards = res.hits.map((hit) => {
      const card = cardFor(hit);
      card.addEventListener('click', () => openPackVersions(hit));
      return card;
    });
    packResults.append(...cards);
    if (packOffset + res.hits.length < res.total) {
      const more = button('tile btn more');
      more.textContent = 'Mehr laden';
      more.addEventListener('click', () => searchPacks(packOffset + 24));
      packResults.appendChild(more);
    }
    if (from > 0 && cards[0]) ui.focusEl(cards[0], false);
  }

  async function editPackQuery() {
    const text = await askText({ title: 'Modpack suchen', value: packQuery, max: 60 });
    if (ui.top() === 'packbrowse') ui.focusEl(packSearchBtn, false);
    if (text === null) return;
    packQuery = text.trim();
    drawPackSearch();
    searchPacks();
  }

  async function openPackVersions(hit) {
    ui.sound.play('confirm');
    const res = await couch.packVersions(hit.id);
    if (!res.ok) {
      ui.toast(res.error);
      return;
    }
    if (!res.versions.length) {
      ui.toast('Für dieses Modpack gibt es keine passende Version.');
      return;
    }
    if (ui.top() !== 'packbrowse') return;
    showVersions(hit.title, res.versions, null, (v) => installPack(hit, v), 'Installieren');
  }

  function showVersions(title, versions, currentId, onPick, hint) {
    versionsHint = hint;
    $('#pack-versions-title').textContent = title;
    packVersionsList.replaceChildren(
      ...versions.map((v) => {
        const row = button('tile setting');
        const left = el('span', 'item');
        left.append(el('span', '', `Minecraft ${v.mc}`));
        const loader = LOADER_NAMES[v.loader] || v.loader;
        const state = v.id === currentId ? 'Installiert' : v.beta ? 'Beta' : null;
        row.append(left, el('span', 'value', [loader, v.name, state].filter(Boolean).join(' · ')));
        row.addEventListener('click', () => onPick(v));
        return row;
      })
    );
    packVersionsEl.scrollTop = 0;
    ui.openView('packversions', null);
  }

  // Pack-Version einer installierten Instanz wechseln
  async function openPackSwitch() {
    ui.sound.play('confirm');
    const res = await couch.packVersions(packInst.managedId);
    if (!res.ok) {
      ui.toast(res.error);
      return;
    }
    if (ui.top() !== 'packsettings') return;
    showVersions(packState.settings.name, res.versions, packInst.managedVersionId, switchPack, 'Wechseln');
  }

  async function switchPack(version) {
    if (packInstalling) return;
    if (version.id === packInst.managedVersionId) {
      ui.sound.play('bump');
      notice('Diese Version ist schon installiert.');
      return;
    }
    const otherGame = version.mc !== packInst.mc;
    const text = otherGame
      ? `Das Pack wechselt auf Minecraft ${version.mc}. Welten vertragen das oft nicht, zurück geht es dann nicht mehr ohne Weiteres. Sichere wichtige Welten vorher.`
      : 'Die Mods des Packs werden ersetzt. Welten, eigene Mods und von dir geänderte Einstellungen bleiben.';
    const yes = await askConfirm({ title: `Auf „${version.name}“ wechseln?`, text, yes: 'Wechseln' });
    if (!yes) return;

    packInstalling = true;
    $('#pack-install-title').textContent = packState.settings.name;
    $('#pack-install-status').textContent = 'Modpack wird geladen …';
    $('#pack-install-bar').style.width = '0%';
    ui.sound.play('open');
    ui.openView('packinstall', null);
    const res = await couch.switchPackVersion(packInst.id, version.id);
    packInstalling = false;
    if (ui.top() !== 'packinstall') {
      if (res.ok) ui.refresh(packInst.id);
      return;
    }
    ui.closeTop(true);
    if (!res.ok) {
      ui.toast(`Update fehlgeschlagen: ${res.error}`);
      return;
    }
    // Versionsliste und Einstellungen zeigen noch die alte Version
    ui.closeTop(true);
    ui.closeTop(true);
    ui.sound.play('launch');
    await ui.refresh(packInst.id);
    notice(`${packState.settings.name} ist jetzt auf ${version.name}`);
  }

  async function installPack(hit, version) {
    if (packInstalling) return;
    packInstalling = true;
    $('#pack-install-title').textContent = hit.title;
    $('#pack-install-status').textContent = 'Modpack wird geladen …';
    $('#pack-install-bar').style.width = '0%';
    ui.sound.play('open');
    ui.openView('packinstall', null);
    const res = await couch.installPack(version.id);
    packInstalling = false;
    // Mit B abgebrochen: Die Ansicht ist schon zu, und der Hauptprozess hat aufgeräumt.
    // War die Installation da schon durch, gibt es die Instanz trotzdem.
    if (ui.top() !== 'packinstall') {
      if (res.ok) ui.refresh();
      return;
    }
    ui.closeTop(true);
    if (!res.ok) {
      ui.toast(`Installation fehlgeschlagen: ${res.error}`);
      return;
    }
    ui.closeTop(true);
    ui.closeTop(true);
    ui.sound.play('launch');
    await ui.refresh(res.id);
    const instance = ui.instance(res.id);
    if (instance) ui.openDetails(instance);
    notice(`${instance ? instance.name : hit.title} ist installiert`);
  }

  couch.onPackProgress(({ done, total }) => {
    $('#pack-install-status').textContent = `Dateien: ${done} von ${total}`;
    $('#pack-install-bar').style.width = `${total ? Math.round((done / total) * 100) : 100}%`;
  });

  packSearchBtn.addEventListener('click', editPackQuery);

  ui.registerView('packbrowse', packBrowseEl, '#pack-search, #pack-results .tile', {
    hints: () => ({ a: 'Auswählen', y: 'Suchen' }),
    onButton(name) {
      if (name === 'y') editPackQuery();
      return name === 'y' || name === 'x' || name === 'lb' || name === 'rb';
    },
  });

  ui.registerView('packversions', packVersionsEl, '#pack-versions-list .tile', {
    hints: () => ({ a: versionsHint }),
  });

  ui.registerView('packinstall', packInstallEl, '#pack-install button', {
    hints: () => ({ a: ' ', b: 'Abbrechen' }),
    onClose() {
      if (packInstalling) couch.cancelPackInstall();
    },
  });

  ui.browsePacks = () => {
    packQuery = '';
    drawPackSearch();
    packBrowseEl.scrollTop = 0;
    ui.sound.play('open');
    ui.openView('packbrowse', null, packSearchBtn);
    searchPacks();
  };

  buildOsk();
})();
