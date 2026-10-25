#!/usr/bin/env python3
"""Construit le pack Ghidra hors-ligne : <site>/data/ghidra-pack/<xx>/<hash>.js
Chaque fichier appelle DOC.got("gh/<chemin>", "<pseudo-code>").
Le nom est un hash cyrb53 du chemin (noms courts, compatibles Windows)."""
import json, os, sys

G = os.environ.get('GHIDRA_ROOT', '/root/OdysseyDecomp-GhidraPseudoCodes')


def imul(a, b):
    return ((a & 0xffffffff) * (b & 0xffffffff)) & 0xffffffff


def cyrb53(s, seed=0):
    h1 = 0xdeadbeef ^ seed
    h2 = 0x41c6ce57 ^ seed
    for ch in s.encode('utf-16-le').decode('utf-16-le'):
        # JS charCodeAt: UTF-16 code units
        for cu in ([ord(ch)] if ord(ch) < 0x10000 else
                   [0xd800 + ((ord(ch) - 0x10000) >> 10), 0xdc00 + ((ord(ch) - 0x10000) & 0x3ff)]):
            h1 = imul(h1 ^ cu, 2654435761)
            h2 = imul(h2 ^ cu, 1597334677)
    h1 = imul(h1 ^ (h1 >> 16), 2246822507)
    h1 ^= imul(h2 ^ (h2 >> 13), 3266489909)
    h2 = imul(h2 ^ (h2 >> 16), 2246822507)
    h2 ^= imul(h1 ^ (h1 >> 13), 3266489909)
    v = 4294967296 * (2097151 & h2) + (h1 & 0xffffffff)
    return format(v, 'x')


def main():
    out = os.path.join(sys.argv[1] if len(sys.argv) > 1 else '/root/site', 'data', 'ghidra-pack')
    os.makedirs(out, exist_ok=True)
    seen = {}
    n = 0
    for dp, dn, fn in os.walk(G):
        if '.git' in dp.split(os.sep):
            continue
        for f in fn:
            if not f.endswith('.cpp'):
                continue
            rel = os.path.relpath(os.path.join(dp, f), G).replace(os.sep, '/')
            h = cyrb53(rel)
            if h in seen:
                raise SystemExit('collision %s %s' % (rel, seen[h]))
            seen[h] = rel
            txt = open(os.path.join(dp, f), encoding='utf-8', errors='replace').read()
            d = os.path.join(out, h[:2])
            os.makedirs(d, exist_ok=True)
            with open(os.path.join(d, h + '.js'), 'w', encoding='utf-8') as o:
                o.write('DOC.got(%s,%s);' % (json.dumps('gh/' + rel, ensure_ascii=False), json.dumps(txt, ensure_ascii=False)))
            n += 1
    print('Ghidra pack:', n, 'files ->', out)


if __name__ == '__main__':
    main()
