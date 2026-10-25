# OdysseyDoc — Super Mario Odyssey code documentation

A static website (HTML + CSS + JS, no dependencies, no server) documenting all known
code of Super Mario Odyssey 1.0.0:

- every **class / struct / union / template** (decomp + classes inferred from the binary),
- every **function and method** (≈ 83,500: decompiled or not),
- **namespaces, enums, typedefs, variables, macros, files**,
- for each function: return type, arguments (type, name, default, passing mode),
  whether it is a method (and of which class), declaring `.h`, implementing `.cpp`,
  offset / address / size / status in the binary, mangled symbol, decompiled code,
  Ghidra pseudo-code, virtual overrides, overloads,
- for each class: header, `.cpp`, size, fields with offsets, bases, inheritance chain,
  derived classes, methods (grouped), inherited methods, nerves (states),
  factory names (stage files), decompilation progress.

## Usage

Open `index.html` in a browser (double-click). Everything works over `file://`.

- `Ctrl+K` or `/`: search (name, `Class::method`, several words, or an **address**:
  `0x1ccff4`, `0x71001ccff4`, `.text::002ccff4`).
- Sidebar: tree by **folders** (.h/.cpp/.o units), by **namespaces**, and special pages.
- Light / dark theme: ◐ button.

### Offline Ghidra pseudo-code (optional)

Without the pack, pseudo-code is fetched from GitHub when displayed. To have everything
locally, unzip `OdysseyDoc-ghidra-pack.zip` **at the site root** (it contains
`data/ghidra-pack/…`, ≈ 67,000 files).

## Layout

```
index.html          single page (router on #/...)
css/style.css       styles (light/dark themes)
js/core.js          data loading, index, utilities
js/highlight.js     C++ highlighting + automatic links into the docs
js/search.js        search (names, addresses)
js/tree.js          sidebar
js/pages.js         rendering of every page
js/app.js           startup + routes
data/index.js       global index (all entities)
data/e/*.js         entity details (one bundle per class / group)
data/src/*.js       decomp source code (src/, lib/al, sead/agl/nn headers…)
data/strings.js     binary strings; data/symbols.js data symbols
data/factories.js   factory tables (actor names → classes)
generator/          Python scripts that produce data/ (see generator/README.md)
```

## Routes

| URL | Page |
|---|---|
| `#/e/<qualified name>` | entity (class, function, enum…); overloads: `~2`, `~3`… |
| `#/e/file:<path without extension>` | unit (.h + .cpp + object file) |
| `#/src/<n>/<line>` | full source file |
| `#/search/<text>` | search results |
| `#/classes`, `#/functions`, `#/namespaces`, `#/enums`, `#/typedefs`, `#/vars`, `#/macros` | lists |
| `#/progress`, `#/files`, `#/hierarchy`, `#/nerves`, `#/factories`, `#/symbols`, `#/strings`, `#/about` | special pages |

## Sources

- Decompilation: https://github.com/MonsterDruide1/OdysseyDecomp
- Pseudo-code: https://github.com/Wibigen/OdysseyDecomp-GhidraPseudoCodes
