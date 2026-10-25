# OdysseyDoc generator

Python scripts that produce the site's `data/` folder from the two repositories.

## Requirements (tested on Linux; on Windows, use WSL)

```bash
pip install libclang pyyaml
# clang (for -print-resource-dir) and c++filt (binutils) must be in PATH
git clone https://github.com/Wibigen/OdysseyDecomp
cd OdysseyDecomp
git submodule update --init --depth 1 lib/sead lib/NintendoSDK lib/agl lib/eui lib/NintendoSDK-NEX toolchain/musl
cd ..
git clone https://github.com/Wibigen/OdysseyDecomp-GhidraPseudoCodes
```

## Regenerate everything

```bash
python generator/build_all.py --decomp OdysseyDecomp --ghidra OdysseyDecomp-GhidraPseudoCodes --site .
```

Options: `--no-pack` (no offline Ghidra pack), `--skip-clang` (reuse `work/clang_raw.jsonl`).

## Steps

| Script | Role |
|---|---|
| `extract_clang.py` | Parses every `.cpp` in `src/` and `lib/al`, then the remaining headers (sead, agl, nn, NEX, eui) with libclang. Writes one JSON line per entity: qualified name, USR, location, signature, return type, parameters (type/name/default), qualifiers, mangled symbol, fields with offsets, sizes, bases, enumerators, macros. |
| `extract_binary.py` | Reads `data/file_list.yml` (the 74,171 functions of the binary: offset, size, status, object, symbol), demangles them with `c++filt`, and matches each function to its Ghidra file by address (`.text::X = offset + 0x100000`). |
| `build_data.py` | Merges: declaration (.h) + definition (.cpp) by USR; binary matching by demangled name; "inferred from binary" functions/classes for everything else; inheritance, virtual overrides, nerves (`NERVE_IMPL…`), factories (`Project*Factory.cpp`), units; writes `data/`. |
| `build_ghidra_pack.py` | Writes `data/ghidra-pack/<xx>/<hash>.js` (cyrb53 hash of the path, same as `js/core.js`). |

## Compile flags used by libclang

`-std=c++17 -DNON_MATCHING -DNNSDK=1 -DSWITCH=1 -DSEAD_VERSION=SEAD_VERSION_SMO -DNN_SDK_MAJOR=3 …`
with the include directories from the decomp's `CMakeLists.txt`. Field sizes and offsets are
computed by clang (x86-64 LP64 target, identical to AArch64 for these structures).
