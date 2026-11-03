# Couch Launcher

Big-Picture-artiges Frontend für den Prism Launcher (Electron). Zeigt die Prism-Instanzen als Kacheln, bedienbar per Controller und Tastatur, und startet die gewählte Instanz über Prism. Kein Fork von Prism, es wird nur dessen Kommandozeile benutzt.

## Zusammenarbeit

- Mit dem Nutzer auf Deutsch, locker und knapp. UI-Texte werden auf Deutsch geschrieben und in `lang-en.js` übersetzt (siehe Übersetzung unten). `README.md` ist englisch, `README.de.md` deutsch, beide pflegen.
- Der Nutzer spielt am Sofa mit Controller, deshalb zählt: große Ziele, deutlicher Fokus, nichts, das nur mit Maus geht.
- Keine schweren neuen Abhängigkeiten ohne Rückfrage. Aktuell gibt es nur `electron` und, nur zum Bauen, `electron-builder` (vom Nutzer erlaubt).
- Verteilt wird als AppImage für Linux über GitHub-Releases, so wollte es der Nutzer. Windows und macOS gibt es bewusst nicht.

## Befehle

```bash
npm install
npm start                # Vollbild
npm run start:windowed   # Fenster, zum Entwickeln
npm test                 # Tests für Instanzen, Startbefehl, Navigation, Eingabe, Einstellungen, Modrinth, Modpacks
npm run dist             # AppImage nach dist/ bauen
```

Repo: https://github.com/reblady/couch-launcher (öffentlich, Commits als `reblady` mit Noreply-Adresse, nur in diesem Repo eingestellt). Releases: Ein Tag `v*` startet `.github/workflows/release.yml`, das testet, die AppImage baut und an ein GitHub-Release hängt. Vor einem Tag die Version in `package.json` anheben.

## Aufbau

| Datei | Aufgabe |
|---|---|
| `main.js` | Electron-Hauptprozess: Fenster, IPC, startet Prism per `spawn` |
| `preload.js` | Brücke zum Renderer (`window.couch`), per `contextBridge` |
| `instances.js` | Liest Prisms Instanzordner (`instance.cfg`, `mmc-pack.json`), baut den Startbefehl |
| `renderer.js` | Oberfläche: Kacheln rendern, Fokus, Dialoge, Eingabe verdrahten |
| `nav.js` | Reine Funktion `findNext` für Navigation nach Richtung (läuft auch in Node-Tests) |
| `input.js` | Reiner Controller-Mapper mit Tastenwiederholung (läuft auch in Node-Tests) |
| `sounds.js` | UI-Sounds, live per Web Audio erzeugt (keine Dateien). Klangdefinitionen in `SOUNDS` |
| `settings.js` | Definition der In-App-Einstellungen, Prüfen, Standardwerte, Schritte (läuft im Renderer und in Node) |
| `config.js` | Liest `config.json` und schreibt Änderungen hinein, ohne andere Schlüssel zu verlieren (nur Hauptprozess) |
| `gamewatch.js` | Erkennt am `latest.log`, wann Minecraft lädt und wann das Fenster offen ist (nur Hauptprozess) |
| `instancecfg.js` | Name, Arbeitsspeicher und Fenstergröße in Prisms `instance.cfg` lesen und ändern (nur Hauptprozess) |
| `zip.js` | Kleiner ZIP-Leser für `.mrpack` auf Basis von `zlib`, statt einer Abhängigkeit (nur Hauptprozess) |
| `mrpack.js` | Installiert fertige Modpacks und hebt sie auf andere Pack-Versionen (nur Hauptprozess) |
| `modcheck.js` | Liest aus Mod-Jars Mindestversionen von Fabric Loader und Java sowie Konflikte, auch verschachtelt (nur Hauptprozess) |
| `views.js` | Ansichts-Stapel und Belegung von A/X (läuft auch in Node-Tests) |
| `modrinth.js` | Modrinth-API: Suche, Abhängigkeiten auflösen, Dateien per Hash erkennen (nur Hauptprozess) |
| `modpacks.js` | Neue Prism-Instanz anlegen, Mods/Ressourcenpakete/Shader auflisten, schalten, entfernen, herunterladen (nur Hauptprozess) |
| `osk.js` | Bildschirmtastatur: Layout pro Sprache (QWERTZ, QWERTY) und Tastenlogik (läuft auch in Node-Tests) |
| `i18n.js`, `lang-en.js` | Übersetzung: `t('deutscher Text', { platzhalter })`, englisches Wörterbuch (Renderer und Hauptprozess) |
| `test/i18n-keys.js` | Sammelt alle zu übersetzenden Texte, `npm test` prüft damit die Vollständigkeit |
| `modpacks-ui.js` | Ansichten Tastatur, Rückfrage, Neues Modpack, Einstellungen pro Modpack, Inhalte verwalten und suchen. Hängt sich über `window.CouchUI` in `renderer.js` ein |
| `index.html`, `style.css` | Layout und Optik |
| `config.json` | Liegt unter `~/.config/couch-launcher/`, weil die AppImage schreibgeschützt ist. Eine alte `config.json` im Projektordner wird beim Start einmalig dorthin kopiert (Vorlage: `config.example.json`) |
| `build/` | App-Icon (`icon.svg`, daraus `icon.png` per `rsvg-convert -w 512 -h 512`) |
| `test/test.js` | Tests mit Fake-Prism-Ordner, ohne Testframework (`node:assert`) |

## Wichtige Entscheidungen

- Prism wird mit `-l <Instanz-ID>` gestartet. Die ID ist der Ordnername der Instanz, nicht der angezeigte Name.
- Der Renderer darf nur IDs starten, die in der letzten Instanzliste standen. IDs, die mit `-` beginnen oder `/` und `\` enthalten, werden abgelehnt (`isValidId`).
- Renderer ohne Node-Zugriff (`contextIsolation`, `sandbox`, strenge CSP in `index.html`). Dynamische Texte immer mit `textContent`, nie mit `innerHTML`, weil Instanznamen aus Dateien kommen.
- Logik, die sich testen lässt (Navigation, Eingabe, Instanz-Erkennung), steht in reinen Modulen und bekommt Tests. Neue Logik dieser Art bitte genauso anlegen.
- Controller laufen über die Gamepad API mit Standard-Mapping (A=0, B=1, X=2, Y=3, Start=9, Steuerkreuz 12 bis 15, linker Stick). Tastatur: Pfeile, Enter, Esc, X, R, S, F11.
- Ansichten liegen auf einem Stapel (`views.js`), B/Esc nimmt die oberste herunter und gibt den Fokus an die Stelle zurück, von der aus sie geöffnet wurde. Neue Seiten (Einstellungen, Mod-Browser) dort als weitere Ansicht anhängen.
- Nach dem Start bleibt das Fenster standardmäßig offen (`onLaunch: "stay"`, vom Nutzer so gewünscht) und zeigt eine Ladeanimation. `gamewatch.js` liest `minecraft/logs/latest.log` der Instanz: neues Log = „lädt“, Zeile `Setting user:` bzw. `Render/Client thread` = Spielfenster offen. Nicht auf „lwjgl“ prüfen, das steht bei Fabric schon in der Modliste. Logs können Binärzeichen enthalten (grep mit `-a`).
- Solange das Spiel läuft oder das Fenster keinen Fokus hat, verwirft der Renderer Controller-Eingaben, sonst würde A im Spiel im Launcher etwas auslösen.
- Wenn der Prism-Prozess endet, kommt das Fenster nach vorn und die Liste wird neu geladen.
- Der Controller des Nutzers (GameSir G7 SE, 3537:1082) kommt ungemappt an: `mapping === ''` und 15 Tasten in Kernel-Reihenfolge, also X=3, Y=4, LB=6, RB=7, Start=11, Steuerkreuz auf den Achsen 6 und 7. `input.js` hat dafür ein eigenes Layout, vom Nutzer am echten Controller bestätigt.
- Controller zusätzlich LB=4, RB=5 (Kategorie), Tastatur Q/E. Neue Ansichten mit `ui.registerView(name, element, fokusSelektor, { hints, onMove, onButton, onKey, onClose })` anmelden.
- Modrinth läuft im Hauptprozess, im Renderer sind nur Bilder von `cdn.modrinth.com` erlaubt (CSP). Version und Loader nimmt der Hauptprozess aus der Instanz, nie vom Renderer. Dateinamen aus Netz oder Renderer laufen durch `safeFileName`, Downloads nur vom Modrinth-CDN und mit SHA-512-Prüfung.
- Eine neue Instanz braucht nur `instance.cfg` und `mmc-pack.json` mit `net.minecraft` und dem Loader. LWJGL und Intermediary ergänzt Prism selbst. Loader-Versionen kommen aus `meta.prismlauncher.org`.
- Was schon installiert ist, wird per SHA-1 über Modrinth erkannt, ohne eigene Liste. So werden auch fertige Packs erkannt und Abhängigkeiten nicht doppelt geladen. Ausschalten funktioniert wie in Prism über die Endung `.disabled`, beim Entfernen fällt auch der `.pw.toml`-Eintrag aus `.index` weg.
- Vor jedem Start prüft der Launcher, ob Controlify im Mods-Ordner liegt (am Dateinamen, ohne Netz). Fehlt die Mod oder ist sie aus, fragt ein Dialog nach: hinzufügen bzw. einschalten und starten, ohne starten, abbrechen. Das Hinzufügen läuft über dieselbe Installation wie die Suche, also samt Abhängigkeiten. Ohne passende Version (z. B. Forge) oder ohne Netz fehlt der Hinzufügen-Button. Ein Fehler bei der Prüfung hält den Start nie auf. Abschaltbar über `controlifyCheck`.
- `findNext`: Hoch und runter gehen immer in die nächste Reihe, erst danach zählt die seitliche Nähe. Sonst wird die versetzte Reihe der Bildschirmtastatur übersprungen.
- Jedes Modpack hat eine eigene Einstellungsseite (Detailseite → Einstellungen): Name, Arbeitsspeicher, Fenstergröße, Löschen. So wollte es der Nutzer, nicht in den globalen Einstellungen.
- Löschen geht per `shell.trashItem` in den Papierkorb und nie endgültig, weil in der Instanz auch die Welten liegen. Der Hauptprozess prüft die ID gegen die frische Instanzliste.
- Updates in „Mods verwalten“ (auch Ressourcenpakete und Shader): `findUpdates` nutzt `version_files/update` und filtert per `version_types`, damit ein Eintrag nie instabiler wird als das Installierte (stabil bleibt stabil, Beta darf Beta, Alpha darf alles). Ohne Filter liefert Modrinth auch Alphas. Der Hauptprozess ermittelt die Liste beim Anwenden neu, die alte Datei fliegt erst nach erfolgreichem Download raus. Ausgeschaltete und unbekannte Dateien bleiben unberührt, neue Pflicht-Abhängigkeiten kommen automatisch mit.
- Modrinth kennt nur Minecraft-Version und Loader-Typ. Die Mindestversionen stehen in der `fabric.mod.json`, auch verschachtelt unter `META-INF/jars`. Ohne diese Prüfung hat ein Update Fresh & Smooth unstartbar gemacht (Fabric Loader 0.19.3, die Mods wollten bis 0.20.1). Deshalb liest `modcheck.js` vor dem Einspielen jede Jar: Ist der Fabric Loader zu alt, wird er in der `mmc-pack.json` angehoben. Ist Java zu alt, wird das Update übersprungen. Verschachtelte Module zählen bei Java nur, wenn die Mod sie in `depends` verlangt: Fabric lässt optionale weg, c2me liefert so Module für Java 22, die im Fehler-Log nur als Beiwerk auftauchen, denn Prism wählt Java passend zur Minecraft-Version. Java kommt aus `JavaVersion` in der `instance.cfg`, sonst aus Prisms Meta-Daten (`compatibleJavaMajors`). Gilt für Updates und Installation. Nur Fabric-Mods, für Forge und NeoForge gibt es diese Prüfung nicht.
- Konflikte: Mods nennen in `fabric.mod.json` unter `breaks`, was sie nicht vertragen, Modrinth kennt das oft nicht. Beim Hinzufügen liest der Hauptprozess alle eingeschalteten Mods der Instanz und lehnt ab, ohne etwas zu installieren (Beispiel: Capes gegen Cape Provider). Bei Updates wird die betroffene Mod übersprungen. Geprüft wird in beide Richtungen, samt verschachtelter Mods und `provides`. Optionale verschachtelte Module blockieren nicht, und Versionsbereiche, die sich nicht lesen lassen, zählen nicht. Pack-Installationen und Pack-Wechsel prüfen das nicht, die Packs sind in sich abgestimmt.
- Abhängigkeiten werden nur bei Mods aufgelöst. Ressourcenpakete nennen oft Mods (ETF, EMF, Polytone), die gehören nicht in ihren Ordner.
- Pack-Version wechseln (Einstellungen des Modpacks, nur mit `ManagedPack`): `updateMrpack` vergleicht alte und neue `.mrpack`. Erst wird alles geladen, der Spielordner bleibt bis dahin unberührt. Ersetzt wird nur Pack-Eigenes: Pack-Dateien, die es nicht mehr gibt, fallen nur weg, wenn ihr Hash unverändert ist. Overrides werden nur geschrieben, wenn die Datei fehlt, unter `mods/`, `resourcepacks/`, `shaderpacks/` liegt oder unverändert der alten Pack-Fassung entspricht. Eigene Mods, Welten und geänderte Einstellungen bleiben. Über die Modrinth-Projekte fallen Fassungen aus Einzel-Updates weg, und ausgeschaltete Mods bleiben aus. Fehlt die alte `.mrpack` auf Modrinth, bleiben alte Pack-Dateien im Zweifel liegen.
- Einzelne Mods: In „Mods verwalten“ aktualisiert Y die gewählte Zeile, wenn sie ein Update hat, sonst öffnet Y wie bisher die Suche. Bei Modpacks gibt es kein „Alle aktualisieren“, weil das Fresh & Smooth unstartbar gemacht hat. Einzel-Updates fragen dort vorher nach.
- Fertige Modpacks: Prisms eigener Import braucht die Maus, deshalb installiert `mrpack.js` selbst. Die Instanz entsteht in einem versteckten Ordner `.couch-install-*` und wird erst am Ende umbenannt, weder Prism noch der Launcher sehen je ein halbes Pack. Inhalte der `.mrpack` gelten als fremd: Pfade laufen durch `isSafePath`, Downloads nur von den vier Hosts der Modrinth-Spezifikation und mit SHA-512. `ManagedPack*` in der `instance.cfg` sorgt dafür, dass Prism das Pack als Modrinth-Pack erkennt.
- Spiel-Vollbild (F11-Modus) steht nicht bei Prism, sondern als `fullscreen:` in der `options.txt`. Der Hauptprozess setzt es direkt vor jedem Start (`gameFullscreen`, Standard an). Hat ein Pack eine eigene Fenstergröße (Maximiert, feste Auflösung), geht die vor und `fullscreen:false` wird gesetzt. Bei Aus bleibt die Datei in Ruhe. F11 im Spiel gilt deshalb nur bis zum nächsten Start.
- `instancecfg.js` ändert nur einzelne Zeilen in `[General]`, die Datei wird nie neu aufgebaut, weil Prism dort eigene Abschnitte und Maskierungen pflegt. Prism schaltet in Gruppen: `OverrideMemory` (`MaxMemAlloc`, `MinMemAlloc`), `OverrideWindow` (`LaunchMaximized`, `MinecraftWinWidth`, `MinecraftWinHeight`). „Wie in Prism“ heißt, der Override ist aus. Der Ordnername bleibt beim Umbenennen gleich, er ist die ID. Weitere Gruppen wären `OverrideJavaArgs` (`JvmArgs`), `OverridePerformance` (GameMode, MangoHud, Zink), `OverrideConsole`.
- Bildschirmtastatur ist ein Raster mit 10 Spalten (`COLUMNS` in `osk.js`), jede Reihe muss genau so breit sein.
- Übersetzung: Jeder sichtbare Text läuft durch `t()`, der deutsche Text ist der Schlüssel, Platzhalter in `{}`. Fehlt eine Übersetzung, erscheint Deutsch. `npm test` scheitert, wenn in `lang-en.js` ein Text oder Platzhalter fehlt oder übrig ist. Feste Texte in `index.html` tragen `data-i18n`. Beschriftungen, die beim Laden entstehen (`DEFS`, `TYPES`, `SPECIAL`), bleiben deutsch und laufen erst beim Anzeigen durch `t()`, weil die Sprache sich zur Laufzeit ändern kann. Gleicher deutscher Text heißt gleiche Übersetzung, für verschiedene Bedeutungen verschiedene deutsche Texte wählen (Beispiel „Zuletzt gespielt“ gegen „Letzter Start“). Einstellung `language`: `auto` folgt der Systemsprache (Deutsch, sonst Englisch). Der Hauptprozess stellt die Sprache in `loadConfig()` ein, damit Fehlermeldungen passen.
- Startfokus liegt auf der ersten Instanz-Kachel (zuletzt gespielt), nie auf dem Einstellungs-Button.

## Stand

Release 0.1.0 veröffentlicht (3.11.2026): GitHub Actions hat getestet und die AppImage gebaut, der Download funktioniert. Die lokal gebaute AppImage startet ohne Fehler, bedient wurde sie noch nicht.
Vom Nutzer bestätigt: Instanzen werden angezeigt, Starten klappt, Controller und Tastatur funktionieren, Detailseite, Einstellungen, Sounds, Ladeanimation mit echtem Spielstart.
Gegen die echte Modrinth- und Prism-Meta-API getestet (Anlegen, Suche, Abhängigkeiten, Download, Hash-Erkennung), aber in einer Wegwerf-Instanz außerhalb von Prism.
Selbst angelegte Instanz (Fabric, 26.3, ein Mod) startet in Prism: Prism hat LWJGL und Intermediary ergänzt, Minecraft lief bis `Setting user:`.
Controlify-Dialog in Electron bestätigt: Hinzufügen samt YACL und Fabric API klappt, die Mod lädt im Spiel (Fabric, 26.3).
Modpacks löschen in Electron unter KDE bestätigt: Instanzen landen im Papierkorb.
Einstellungen pro Modpack in Electron bestätigt: Prism übernimmt den RAM-Wert (im Prism-Log steht `-Xmx8192m`, zu finden in `logs/PrismLauncher-*.log`).
Maximiert im laufenden Spiel vom Nutzer bestätigt.
Vollbild im Spiel vom Nutzer bei Fabulously Optimized bestätigt.
Fertige Modpacks gegen echtes Modrinth installiert (Fabulously Optimized 1.21.11, 50 Dateien, in einen Wegwerf-Ordner), Oberfläche im Browser mit Stub.
Installiertes Pack startet in Prism bestätigt (Fresh & Smooth, Fabric, 1.21.11, 122 Mods): Prism ergänzt die fehlenden Teile, Minecraft läuft.
Updates gegen echtes Modrinth an einer Kopie von Wynncraft FPS getestet: 12 aktualisiert, danach 0 offen. Oberfläche im Browser mit Stub.
Offener Fehler (Stand 30.10.2026 abends): Fresh & Smooth startete auch nach Neuinstallation, Loader-Anhebung und „Alle aktualisieren“ nicht, laut Nutzer weil die aktualisierten Mods nicht mehr aufeinander abgestimmt sind. Die Meldung bei den Ressourcenpaketen ist weg. Der genaue Abbruchgrund ist unbekannt, die Instanz samt Log ist gelöscht. Beim nächsten Mal das `latest.log` lesen, bevor das Pack gelöscht wird.
Pack-Wechsel gegen echtes Modrinth im Wegwerf-Ordner getestet (Fabulously Optimized 12.2.0 auf 12.3.0: eigene Mod, Welt und ausgeschaltete Mod blieben, keine Doppelten, Loader mitgehoben). Oberfläche im Browser mit Stub.
Offen beim Test am 31.10.: „Fabulously Optimized (2)“ startete nicht, weil Capes einzeln zu Cape Provider dazukam. Das war kein Pack-Wechsel.
Nicht geprüft: Konflikt-Prüfung in Electron, Pack-Wechsel in Electron und ob das Pack danach startet, ob ein Pack mit einzeln aktualisierten Mods startet, Packs mit Forge, NeoForge oder Quilt, Vollbild-Automatik bei einem Pack, das vorher auf `fullscreen:false` stand, selbst angelegte Instanzen mit Quilt, NeoForge und Forge, Flatpak-Pfad, Windows und macOS, eigene Icons aus `iconsDir`, Bilder aus `overrides` in echt.

## Nächste Schritte

1. **Icons und Optik**
   - Optik im Stil von Steam Big Picture, saubere moderne Schrift (vom Nutzer entschieden). Farben als Variablen oben in `style.css`.
   - Erledigt, vom Nutzer noch nicht in Electron gesehen: Steam-Look (Farbverlauf-Kacheln, Fokus mit weißem Rahmen, Hintergrund färbt sich nach der fokussierten Instanz, runde A/B/Y-Symbole unten rechts) und `overrides` in `config.json` für Titel und Bild (`cover: true` füllt die Kachel).
   - Prisms eingebaute Icons liegen nicht im Instanzordner, deshalb gibt es bisher nur die farbige Kachel mit Buchstaben als Ersatz.
2. **Instanz-Detailseite**
   - Erledigt, vom Nutzer noch nicht in Electron gesehen: Banner, Spielen / Ordner öffnen / Zurück, Infokacheln. A öffnet standardmäßig die Details, X startet direkt. Umstellbar über `"aButton": "launch"` in `config.json`.
   - Einstellungsseite erledigt (Start / S / Zahnrad oben rechts): A-Taste, Sounds, Lautstärke, `onLaunch`, Vollbild. Speichert sofort per IPC `settings:set`; der Hauptprozess nimmt nur Schlüssel aus `settings.js` an, Pfade und `prismCommand` lassen sich vom Renderer aus nicht ändern. Neue Einstellungen: Eintrag in `DEFS` in `settings.js`.
3. **UI-Sounds und Icons:** Erledigt, Sounds vom Nutzer noch nicht gehört. Sounds für Bewegen, Rand, Bestätigen, Zurück, Dialog, Start, Fehler; abschaltbar über `sounds`/`volume` in `config.json`. Prism-Icons (Modrinth-Logos, ca. 92 px) werden glatt skaliert und mittig mit weichgezeichnetem Hintergrund gezeigt statt pixelig hochgezogen.
4. **Modpack-Baukasten:** Erledigt, siehe Stand. Kachel „Neues Modpack“, Suche mit Bildschirmtastatur, Mods/Ressourcenpakete/Shader, „Mods verwalten“ auf der Detailseite.
5. **Fertige Modpacks:** Erledigt, siehe Stand. Kachel „Modpack herunterladen“, Suche, Auswahl der Minecraft-Version, Fortschritt, Abbrechen mit B.
6. **Mods aktualisieren:** Erledigt, siehe Stand. Einzeln mit Y, alle auf einmal nur bei selbst gebauten Packs.
7. **Pack-Versionen:** Erledigt, siehe Stand. Zeile „Modpack-Version“ in den Einstellungen des Modpacks.
8. **Offen:** Alte Dateien vor Updates sichern, damit sie sich zurücknehmen lassen.
9. **Später:** Instanz kopieren, Welten und Screenshots.

## Testen der Oberfläche

Electron läuft nur auf dem Rechner des Nutzers. Für schnelle Sichtprüfungen hat sich Headless-Chromium (Playwright) mit einem Stub für `window.couch` und Fake-Instanzen bewährt. Tastatur-Navigation lässt sich damit simulieren und per Screenshot prüfen.
