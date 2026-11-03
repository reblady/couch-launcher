# Couch Launcher

**English** · [Deutsch](README.de.md)

A Big Picture style frontend for [Prism Launcher](https://prismlauncher.org): your Prism instances as large tiles, controlled with a gamepad or keyboard. **A** opens an instance's detail page (version, loader, playtime, open folder), *Play* launches it through Prism. **X** launches right away. Installing modpacks from Modrinth, building your own, updating and managing them all works with the controller too.

The interface is available in English and German. By default it follows your system language, you can change it under *Settings → Language*.

## Installation

You need [Prism Launcher](https://prismlauncher.org) installed and started once, with your Minecraft account signed in.

1. Download `Couch-Launcher-….AppImage` from [Releases](../../releases/latest).
2. Make it executable: right-click → Properties → "Executable", or in a terminal `chmod +x Couch-Launcher-*.AppImage`.
3. Double-click it, done.

On Arch Linux an AppImage needs the `fuse2` package (`sudo pacman -S fuse2`), most other systems already have it.

**Add it to Steam** (for Big Picture mode or the Steam Deck): *Add a Game → Add a Non-Steam Game → Browse* and pick the AppImage.

## Building it yourself

With Node.js 20 or newer:

```bash
npm install
npm start                # fullscreen
npm run start:windowed   # windowed, handy for development
npm test
npm run dist             # builds dist/Couch-Launcher-<version>.AppImage
```

A new release is created automatically when a tag like `v0.2.0` is pushed to GitHub: GitHub builds the AppImage and attaches it to the release.

## Controls

| Controller | Keyboard | Action |
|---|---|---|
| D-pad / left stick | Arrow keys | Move selection |
| A | Enter | Open detail page or select a button (configurable, see `aButton`) |
| X | X | Launch the instance right away (with `aButton: "launch"` it opens the details instead) |
| B | Esc | Go back one level, on the home screen the quit dialog (Cancel is preselected) |
| Y | R | Reload the instance list |
| Start / Menu | S | Open and close settings (also via *Settings* at the top right) |
| LB / RB | Q / E | Switch category (mods, resource packs, shaders) |
| – | F11 | Toggle fullscreen |

## Ready-made modpacks

The **Download modpack** tile on the home screen searches the modpacks on [Modrinth](https://modrinth.com/modpacks). Pick a pack and a Minecraft version, the rest happens on its own. **B** cancels the installation and leaves nothing behind. The pack becomes a regular Prism instance that Prism recognizes as a Modrinth pack.

Big packs often need more memory, you can set that in the modpack's settings.

There, **Modpack version** also switches to a newer version of the pack. Only the pack's own files get replaced: worlds, your own mods and settings you changed stay, disabled mods stay disabled. When switching to a different Minecraft version, back up important worlds first.

## Building your own modpack

Everything works with the controller:

1. On the home screen choose the **New modpack** tile and set name, Minecraft version and mod loader. Couch Launcher creates a regular Prism instance that also shows up in Prism.
2. Pick mods, resource packs or shaders from [Modrinth](https://modrinth.com) in the search. **Y** opens the search with an on-screen keyboard, **A** installs including required dependencies. Only entries matching the instance's version and loader are shown. Every file is verified by checksum.
3. On an instance's detail page (ready-made packs too), **Manage mods** shows everything installed: **A** turns it on and off, **X** removes, **Y** adds.

The **Check for updates** row in *Manage mods* shows which entries have new versions. **Y** updates the selected mod, **Update all** updates everything at once. Stable mods only get stable updates, beta and alpha mods also get newer betas and alphas. Disabled mods and files Modrinth doesn't know stay as they are. Mods in ready-made modpacks are tuned to work together, so there are only single updates there. To update the whole pack, use **Modpack version**.

Before installing or updating, Couch Launcher reads each mod's requirements: if the Fabric Loader is too old it gets raised, mods that need a newer Java are skipped, and mods that are incompatible with installed ones are refused.

The first launch of a new instance makes Prism download Minecraft and the loader, which takes a moment.

On-screen keyboard: **X** deletes, **Y** adds a space, **LB/RB** toggles capitals, **Start** confirms, **B** cancels.

## Per-modpack settings

On the detail page, **Settings** leads to this modpack's values:

- **Name:** the displayed name, the folder stays the same.
- **Memory:** from 1 GB up to your installed RAM, or *Same as Prism* for Prism's global value.
- **Window size:** *Fullscreen*, *Maximized* or a fixed resolution. Games start in fullscreen by default (like F11), you can turn that off in the general settings under *Start games in fullscreen*, then this shows *Same as Prism*.
- **Delete modpack:** it goes to the trash together with its worlds and can be restored from there.

The values live in the instance's `instance.cfg`, so Prism shows the same settings. They apply from the next start.

## Controller in game

Minecraft itself can only be played with a controller through the [Controlify](https://modrinth.com/mod/controlify) mod. If a modpack doesn't have it, Couch Launcher asks before launching and can add it including its dependencies. Controlify doesn't exist for Forge, so the button is missing there. You can turn this question off in the settings.

## Configuration (optional)

Language, A button, sounds, volume, behavior after launching and fullscreen can be changed right in the app under *Settings*. Changes are saved to `config.json` immediately, other entries there are kept.

For paths and custom images the file lives at `~/.config/couch-launcher/config.json`. Use `config.example.json` as a template and delete what you don't need.

| Key | Meaning |
|---|---|
| `instancesDir` | Path to the instances folder if it isn't found automatically |
| `iconsDir` | Folder with custom instance icons (default: `icons` next to the instances folder) |
| `prismCommand` | Command to start Prism as a list, e.g. `["flatpak", "run", "org.prismlauncher.PrismLauncher"]` |
| `onLaunch` | `stay` (default): loading screen until the Minecraft window opens on top. `hide`: hide the window while Prism runs. `quit`: close Couch Launcher |
| `language` | `auto` (default): follow the system, otherwise `de` or `en` |
| `fullscreen` | `false` starts in a window |
| `aButton` | `details` (default): A opens the detail page, X launches. `launch`: A launches right away, X opens the details |
| `gameFullscreen` | `false`: don't start games in fullscreen automatically |
| `controlifyCheck` | `false`: don't ask about Controlify before launching |
| `sounds` | `false` turns off UI sounds |
| `volume` | UI sound volume from `0` to `1` (default `0.5`) |
| `overrides` | Custom title and image per instance, the key is the instance ID (folder name), see below |

### Custom titles and images

```json
"overrides": {
  "Fabric-1.21.1": { "title": "Survival with friends", "icon": "covers/survival.png" }
}
```

Relative paths are relative to `~/.config/couch-launcher/`, `~/` works too. Allowed are png, jpg, webp, svg, gif and ico. Images in 16:9 fit best, they fill the whole tile. If the file is missing, the regular icon stays.

The default paths for Linux (native and Flatpak), Windows and macOS are detected automatically.

## Steam and controller layout

The standard gamepad layout in Steam is enough. If you run from source, you can add `start.sh` as a non-Steam game instead of the AppImage.

## Notes

- Prism launches instances by their ID, which is the instance's **folder name**, not the displayed name. Couch Launcher handles this automatically.
- Instances without `instance.cfg` and folders starting with `.` or `_` are ignored.
- Custom Prism icons are shown when the file is in `iconsDir`. Prism's built-in icons get a colored tile with the initials instead. Larger images work through `overrides`.
- If Prism is already running, it may hand the launch over to the running Prism and exit right away. Couch Launcher then comes back immediately.

## Troubleshooting

- **Sandbox error on start (Linux, from source):** try `npm run start:nosandbox`.
- **"Prism not found":** set `prismCommand` in `config.json` (see above).
- **Controller doesn't respond:** the window needs focus. In Steam, use a gamepad layout.

## Tests

```bash
npm test
```

Checks instance detection, launch commands, navigation, controller input, Modrinth, modpacks and that every interface text is translated, using fake data.

## Translating

The German text in the code doubles as the key. The English texts live in `lang-en.js`. A new language is another file like it, registered in `i18n.js` and `index.html`. `npm test` reports missing translations.
