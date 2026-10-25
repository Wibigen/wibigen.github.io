# OdysseyDoc generator

Python scripts that produce the site's `data/` folder, plus a Ghidra script for hook-safety data.

## Requirements (tested on Linux; on Windows, use WSL)

```bash
pip install libclang pyyaml
# clang (for -print-resource-dir) and c++filt (binutils) must be in PATH
git clone https://github.com/MonsterDruide1/OdysseyDecomp
cd OdysseyDecomp
git submodule update --init --depth 1 lib/sead lib/NintendoSDK lib/agl lib/eui lib/NintendoSDK-NEX toolchain/musl
cd ..
# plus your local Ghidra pseudo-code export folder (one .cpp per function)
```

## Regenerate everything

```bash
python generator/build_all.py --decomp OdysseyDecomp --ghidra <pseudo-code folder> --site .
```

Options: `--ghidra-export <file>` (hook-safety data, see below), `--skip-clang` (reuse `work/clang_raw.jsonl`).

## Hook-safety data from Ghidra (optional, recommended)

The site always shows size-based hook checks. Instruction-level checks (first instructions,
PC-relative instructions in the patch, branches into the patched bytes, loops back to the entry)
need the real instructions, which only your Ghidra project has:

1. Copy `ghidra/ExportOdysseyDoc.java` into a Ghidra script folder (Script Manager → *Manage Script
   Directories*), or point `-scriptPath` at `generator/ghidra`.
2. Open your **SMO 1.0.0** `main` program, run `ExportOdysseyDoc.java`, choose an output file.
   Headless alternative:
   `analyzeHeadless <projectDir> <projectName> -process main -noanalysis -scriptPath generator/ghidra -postScript ExportOdysseyDoc.java odysseydoc_export.ndjson`
3. Rebuild with `--ghidra-export odysseydoc_export.ndjson`.

The address offset between your Ghidra program and `data/file_list.yml` is detected automatically
(by matching function sizes). Callees from the export are merged into the call graph.
Tested with Ghidra 11.3.2.

## Steps

| Script | Role |
|---|---|
| `extract_clang.py` | Parses every `.cpp` in `src/` and `lib/al`, then the remaining headers (sead, agl, nn, NEX, eui) with libclang. One JSON line per entity: qualified name, USR, location, signature, return type, parameters, qualifiers, mangled symbol, fields with offsets, sizes, bases, enumerators, macros. |
| `extract_binary.py` | Reads `data/file_list.yml` (the 74,171 functions of the binary: offset, size, status, object, symbol), demangles them, and matches each one to its Ghidra pseudo-code file by address (`.text::X = offset + 0x100000`). |
| `extract_xrefs.py` | Call graph from the pseudo-code: direct calls resolved like C++ name lookup (Ghidra drops the shared namespace prefix), overloads disambiguated by argument count; remaining ambiguities are kept as "one of" groups. |
| `build_data.py` | Merges everything: declaration (.h) + definition (.cpp) by USR, binary matching by demangled name, "inferred from binary" entities, inheritance, overrides, nerves and nerve call edges (`…Nrv…::execute → exe…`), factories, units, return-type provenance, hook data; writes `data/` (index, entity bundles, sources, Ghidra pseudo-code bundles in `data/gh/`). |
| `ghidra/ExportOdysseyDoc.java` | Ghidra script described above. |

## Compile flags used by libclang

`-std=c++17 -DNON_MATCHING -DNNSDK=1 -DSWITCH=1 -DSEAD_VERSION=SEAD_VERSION_SMO -DNN_SDK_MAJOR=3 …`
with the include directories from the decomp's `CMakeLists.txt`. Field sizes and offsets are
computed by clang (x86-64 LP64 target, identical to AArch64 for these structures).
