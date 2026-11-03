# Couch Launcher

Ein Big-Picture-artiges Frontend für den [Prism Launcher](https://prismlauncher.org): Deine Prism-Instanzen als große Kacheln, steuerbar mit Controller oder Tastatur. **A** öffnet die Detailseite einer Instanz (Version, Loader, Spielzeit, Ordner öffnen), von dort startet *Spielen* die Instanz über Prism. **X** startet direkt. Mods, Modpacks und Einstellungen verwaltest du weiter in Prism selbst.

## Installation

Voraussetzung: [Prism Launcher](https://prismlauncher.org) ist installiert und wurde einmal gestartet, dein Minecraft-Konto ist dort angemeldet.

1. Unter [Releases](../../releases/latest) die Datei `Couch-Launcher-….AppImage` herunterladen.
2. Ausführbar machen: Rechtsklick → Eigenschaften → „Ausführbar“, oder im Terminal `chmod +x Couch-Launcher-*.AppImage`.
3. Doppelklick, fertig.

Unter Arch Linux braucht eine AppImage das Paket `fuse2` (`sudo pacman -S fuse2`), auf den meisten anderen Systemen ist es schon da.

**In Steam einbinden** (für den Big-Picture-Modus oder das Steam Deck): *Spiel hinzufügen → Nicht-Steam-Spiel hinzufügen → Durchsuchen* und die AppImage wählen.

## Selbst bauen

Mit Node.js 20 oder neuer:

```bash
npm install
npm start                # Vollbild
npm run start:windowed   # Fenster, praktisch zum Entwickeln
npm test
npm run dist             # baut dist/Couch-Launcher-<Version>.AppImage
```

Ein neues Release entsteht automatisch, sobald ein Tag wie `v0.2.0` auf GitHub landet: GitHub baut dann die AppImage und hängt sie an das Release.

## Steuerung

| Controller | Tastatur | Aktion |
|---|---|---|
| Steuerkreuz / linker Stick | Pfeiltasten | Auswahl bewegen |
| A | Enter | Detailseite öffnen bzw. Button auswählen (umstellbar, siehe `aButton`) |
| X | X | Instanz direkt starten (bei `aButton: "launch"` stattdessen Detailseite) |
| B | Esc | Eine Ebene zurück, auf der Startseite Beenden-Dialog (Abbrechen ist vorausgewählt) |
| Y | R | Instanzliste neu laden |
| Start / Menü | S | Einstellungen öffnen und schließen (auch über *Einstellungen* oben rechts) |
| LB / RB | Q / E | Kategorie wechseln (Mods, Ressourcenpakete, Shader) |
| – | F11 | Vollbild an/aus |

## Fertige Modpacks

Die Kachel **Modpack herunterladen** auf der Startseite durchsucht die Modpacks auf [Modrinth](https://modrinth.com/modpacks). Wähle ein Pack und die Minecraft-Version, der Rest läuft von allein. Mit **B** brichst du die Installation ab, dann bleibt nichts zurück. Das Pack ist danach eine normale Prism-Instanz, die Prism als Modrinth-Pack erkennt.

Große Packs brauchen oft mehr Arbeitsspeicher, das stellst du in den Einstellungen des Modpacks ein.

Dort wechselst du unter **Modpack-Version** auch auf eine neuere Version des Packs. Ersetzt werden nur die Dateien des Packs: Welten, eigene Mods und von dir geänderte Einstellungen bleiben, ausgeschaltete Mods bleiben aus. Bei einem Wechsel auf eine andere Minecraft-Version sichere vorher wichtige Welten.

## Modpacks selbst zusammenstellen

Alles geht mit dem Controller:

1. Auf der Startseite die Kachel **Neues Modpack** wählen, Name, Minecraft-Version und Mod-Loader festlegen. Der Couch Launcher legt eine normale Prism-Instanz an, sie taucht auch in Prism auf.
2. In der Suche Mods, Ressourcenpakete oder Shader von [Modrinth](https://modrinth.com) auswählen. **Y** öffnet die Suche mit Bildschirmtastatur, **A** installiert samt Pflicht-Abhängigkeiten. Es werden nur Einträge angezeigt, die zu Version und Loader der Instanz passen. Jede Datei wird per Prüfsumme kontrolliert.
3. Auf der Detailseite einer Instanz (auch bei fertigen Packs) zeigt **Mods verwalten** alles Installierte: **A** schaltet an und aus, **X** entfernt, **Y** fügt hinzu.

Die Zeile **Nach Updates suchen** in *Mods verwalten* zeigt, wofür es neue Versionen gibt. **Y** aktualisiert die gewählte Mod, **Alle aktualisieren** alles auf einen Schlag. Stabile Mods bekommen nur stabile Updates, Beta- und Alpha-Mods auch neuere Betas und Alphas. Ausgeschaltete Mods und Dateien, die Modrinth nicht kennt, bleiben, wie sie sind. In fertigen Modpacks sind die Mods aufeinander abgestimmt, dort gibt es deshalb nur Einzel-Updates. Das ganze Pack hebst du über die **Modpack-Version** an.

Beim ersten Start einer neuen Instanz lädt Prism Minecraft und den Loader herunter, das dauert einen Moment.

Bildschirmtastatur: **X** löscht, **Y** macht ein Leerzeichen, **LB/RB** schaltet Großschreibung um, **Start** bestätigt, **B** bricht ab.

## Einstellungen pro Modpack

Auf der Detailseite führt **Einstellungen** zu den Werten dieses Modpacks:

- **Name:** Der angezeigte Name, der Ordner bleibt gleich.
- **Arbeitsspeicher:** Von 1 GB bis zum eingebauten RAM, oder *Wie in Prism* für Prisms globalen Wert.
- **Fenstergröße:** *Vollbild*, *Maximiert* oder eine feste Auflösung. Spiele starten standardmäßig im Vollbild (wie F11), das lässt sich in den allgemeinen Einstellungen unter *Spiele im Vollbild starten* abschalten, dann steht hier *Wie in Prism*.
- **Modpack löschen:** Es wandert samt Welten in den Papierkorb und lässt sich von dort zurückholen.

Die Werte stehen in der `instance.cfg` der Instanz, Prism zeigt also dieselben Einstellungen an. Sie gelten ab dem nächsten Start.

## Controller im Spiel

Minecraft selbst lässt sich nur mit der Mod [Controlify](https://modrinth.com/mod/controlify) per Controller spielen. Fehlt sie in einem Modpack, fragt der Couch Launcher vor dem Start nach und kann sie samt Abhängigkeiten hinzufügen. Für Forge gibt es Controlify nicht, dort fehlt der Button. Die Nachfrage lässt sich in den Einstellungen abschalten.

## Konfiguration (optional)

A-Taste, Sounds, Lautstärke, Verhalten nach dem Start und Vollbild stellst du direkt in der App unter *Einstellungen* um. Das wird sofort in `config.json` gespeichert, andere Einträge dort bleiben erhalten.

Für Pfade und eigene Bilder liegt die Datei unter `~/.config/couch-launcher/config.json`. Als Vorlage dient `config.example.json`, lösche daraus, was du nicht brauchst.

| Schlüssel | Bedeutung |
|---|---|
| `instancesDir` | Pfad zum Instanzordner, falls er nicht automatisch gefunden wird |
| `iconsDir` | Ordner mit eigenen Instanz-Icons (Standard: `icons` neben dem Instanzordner) |
| `prismCommand` | Startbefehl für Prism als Liste, z. B. `["flatpak", "run", "org.prismlauncher.PrismLauncher"]` |
| `onLaunch` | `stay` (Standard): Ladeanimation, bis das Minecraft-Fenster aufgeht, das legt sich dann darüber. `hide`: Fenster sofort verstecken, solange Prism läuft. `quit`: Couch Launcher beenden |
| `fullscreen` | `false` startet im Fenster |
| `aButton` | `details` (Standard): A öffnet die Detailseite, X startet. `launch`: A startet sofort, X öffnet die Details |
| `gameFullscreen` | `false`: Spiele nicht automatisch im Vollbild starten |
| `controlifyCheck` | `false`: vor dem Start nicht mehr nach Controlify fragen |
| `sounds` | `false` schaltet die UI-Sounds aus |
| `volume` | Lautstärke der UI-Sounds von `0` bis `1` (Standard `0.5`) |
| `overrides` | Eigener Titel und eigenes Bild pro Instanz, Schlüssel ist die Instanz-ID (Ordnername), siehe unten |

### Eigene Titel und Bilder

```json
"overrides": {
  "Fabric-1.21.1": { "title": "Survival mit Freunden", "icon": "covers/survival.png" }
}
```

Relative Pfade gelten ab `~/.config/couch-launcher/`, `~/` geht auch. Erlaubt sind png, jpg, webp, svg, gif und ico. Am besten passen Bilder im Format 16:9, sie füllen die ganze Kachel. Fehlt die Datei, bleibt das normale Icon.

Automatisch erkannt werden die Standardpfade für Linux (nativ und Flatpak), Windows und macOS.

## Steam und Controller-Layout

Als Controller-Layout in Steam reicht das Standard-Gamepad-Layout. Wer aus dem Quellcode startet, kann statt der AppImage die Datei `start.sh` als Nicht-Steam-Spiel hinzufügen.

## Hinweise

- Prism startet Instanzen über ihre ID, das ist der **Ordnername** der Instanz, nicht der angezeigte Name. Der Couch Launcher benutzt das automatisch.
- Instanzen ohne `instance.cfg` sowie Ordner, die mit `.` oder `_` beginnen, werden ignoriert.
- Eigene Prism-Icons werden angezeigt, wenn die Datei in `iconsDir` liegt. Für Prisms eingebaute Icons gibt es stattdessen eine farbige Kachel mit den Anfangsbuchstaben. Größere Bilder gehen über `overrides`.
- Läuft Prism bereits, leitet es den Start eventuell nur an die laufende Prism-Instanz weiter und beendet sich sofort. Dann erscheint der Couch Launcher gleich wieder.

## Probleme

- **Fehler zur Sandbox beim Start (Linux):** `npm run start:nosandbox` ausprobieren.
- **„Prism nicht gefunden“:** `prismCommand` in `config.json` setzen (siehe oben).
- **Controller reagiert nicht:** Das Fenster muss den Fokus haben. Unter Steam ein Gamepad-Layout verwenden.

## Tests

```bash
npm test
```

Prüft Instanz-Erkennung, Startbefehle, die Navigation zwischen Kacheln und die Controller-Eingabe mit Fake-Daten.
