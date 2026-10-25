#!/usr/bin/env python3
"""Reads data/file_list.yml (every function in the binary) and the Ghidra
pseudo-code repository, demangles symbols and writes binary.json."""
import json, os, re, subprocess, sys
import yaml

R = os.environ.get('ODYSSEY_ROOT', '/root/OdysseyDecomp')
G = os.environ.get('GHIDRA_ROOT', '/root/OdysseyDecomp-GhidraPseudoCodes')
GHIDRA_BASE = 0x100000   # Ghidra address .text::X = file_list offset + 0x100000


def demangle(names):
    p = subprocess.run(['c++filt'], input='\n'.join(names), capture_output=True, text=True)
    out = p.stdout.split('\n')
    return out[:len(names)]


def load_binary():
    with open(os.path.join(R, 'data/file_list.yml')) as f:
        data = yaml.load(f, Loader=yaml.CSafeLoader)
    entries = []
    for obj, secs in data.items():
        for sec, items in (secs or {}).items():
            for it in items or []:
                labels = it.get('label')
                if labels is None:
                    labels = []
                elif isinstance(labels, str):
                    labels = [labels]
                entries.append({'obj': obj, 'sec': sec, 'off': it['offset'], 'size': it.get('size', 0),
                                'labels': labels, 'status': it.get('status', 'NotDecompiled'),
                                'guess': bool(it.get('guess')), 'lazy': bool(it.get('lazy'))})
    allnames = sorted({l for e in entries for l in e['labels']})
    dem = dict(zip(allnames, demangle(allnames)))
    for e in entries:
        e['demangled'] = [dem.get(l, l) for l in e['labels']]
    return entries


HDR = re.compile(r'^// (.*?) : (.*)$')


def load_ghidra():
    out = {}
    for dp, dn, fn in os.walk(G):
        if '.git' in dp:
            continue
        for n in fn:
            if not n.endswith('.cpp'):
                continue
            p = os.path.join(dp, n)
            with open(p, encoding='utf-8', errors='replace') as f:
                head = [f.readline() for _ in range(12)]
            sig = None; addr = None; comment = None; demn = None
            for line in head:
                line = line.rstrip('\n')
                if line.startswith('// Nom démêlé'):  # header written by the Ghidra export script
                    demn = line.split(':', 1)[1].strip()
                elif line.startswith('// ') and '@ .text::' in line:
                    s, a = line[3:].rsplit('@ .text::', 1)
                    sig = s.strip().rstrip(';')
                    addr = int(a.strip(), 16)
                elif line.startswith('/* ') and line.endswith(' */') and comment is None and 'WARNING' not in line:
                    comment = line[3:-3]
            if addr is None:
                continue
            rp = os.path.relpath(p, G)
            out.setdefault(addr, []).append({'path': rp, 'sig': sig, 'demangled': comment, 'name': demn})
    return out


def main():
    entries = load_binary()
    print('binary functions:', len(entries))
    gh = load_ghidra()
    print('ghidra:', sum(len(v) for v in gh.values()), 'addresses', len(gh))
    used = set()
    for e in entries:
        a = e['off'] + GHIDRA_BASE if e['sec'] == '.text' else None
        if a is not None and a in gh:
            e['ghidra'] = gh[a]
            used.add(a)
    orphan = {hex(a): v for a, v in gh.items() if a not in used}
    print('ghidra files without a binary entry:', len(orphan))
    json.dump(entries, open('binary.json', 'w'), ensure_ascii=False)
    json.dump(orphan, open('ghidra_orphans.json', 'w'), ensure_ascii=False)


if __name__ == '__main__':
    main()
