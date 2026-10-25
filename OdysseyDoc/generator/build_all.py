#!/usr/bin/env python3
"""Regenerates all OdysseyDoc site data.

Usage:
    python build_all.py --decomp <OdysseyDecomp path> --ghidra <GhidraPseudoCodes path> --site <site folder>
                        [--ghidra-export <ExportOdysseyDoc output>]

Requirements:
    pip install libclang pyyaml
    clang (for -print-resource-dir) and c++filt (binutils) in PATH
    OdysseyDecomp cloned WITH its submodules:
        git submodule update --init lib/sead lib/NintendoSDK lib/agl lib/eui lib/NintendoSDK-NEX toolchain/musl

Steps:
    1. extract_clang.py      : semantic analysis of .h/.cpp files (≈ 20-40 min depending on the CPU)
    2. extract_binary.py     : data/file_list.yml + Ghidra pseudo-code headers (≈ 1 min)
    3. extract_xrefs.py      : call graph from the Ghidra pseudo-code (≈ 20 s)
    4. build_data.py         : merge and write <site>/data/ (≈ 1 min), including the Ghidra
                               pseudo-code (data/gh/) and, if given, the hook-safety export

Optional hook-safety data: run ghidra/ExportOdysseyDoc.java on your SMO 1.0.0 program in Ghidra,
then pass the produced file with --ghidra-export.
"""
import argparse, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))


def run(script, *args, env):
    print('==>', script, *args, flush=True)
    subprocess.check_call([sys.executable, os.path.join(HERE, script), *args], env=env, cwd=env['WORKDIR'])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--decomp', required=True)
    ap.add_argument('--ghidra', required=True)
    ap.add_argument('--site', default=os.path.dirname(HERE))
    ap.add_argument('--work', default=os.path.join(HERE, 'work'))
    ap.add_argument('--ghidra-export', help='output of ghidra/ExportOdysseyDoc.java (hook safety + call graph)')
    ap.add_argument('--skip-clang', action='store_true', help='reuse work/clang_raw.jsonl')
    a = ap.parse_args()
    os.makedirs(a.work, exist_ok=True)
    env = dict(os.environ, ODYSSEY_ROOT=os.path.abspath(a.decomp), GHIDRA_ROOT=os.path.abspath(a.ghidra),
               WORKDIR=os.path.abspath(a.work))
    if a.ghidra_export:
        env['GHIDRA_EXPORT'] = os.path.abspath(a.ghidra_export)
    if not a.skip_clang:
        run('extract_clang.py', 'clang_raw.jsonl', env=env)
    run('extract_binary.py', env=env)
    run('extract_xrefs.py', env=env)
    run('build_data.py', os.path.abspath(a.site), env=env)
    print('Done. Open', os.path.join(os.path.abspath(a.site), 'index.html'))


if __name__ == '__main__':
    main()
