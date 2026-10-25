#!/usr/bin/env python3
"""Builds the call graph (calls / called-by) from the Ghidra pseudo-code.

Each pseudo-code file names the function it contains (header lines) and its
address. Direct calls inside the body (`al::isNerve(...)`, `tryActionCapReturn(this)`,
`FUN__text__00537628(...)`) are resolved to function addresses:
  * names are looked up like C++ does: relative to the caller's namespace/class
    first, then outward (Ghidra omits the shared prefix),
  * overloads are disambiguated by argument count (this included),
  * FUN_/thunk_FUN_ names carry their address directly.
Indirect calls (virtual calls through the vtable, function pointers) are not visible.

Output: xrefs.json = {"<caller offset>": [[exact callee offsets], [[ambiguous candidates], ...]]}
using file_list offsets (Ghidra address - 0x100000). A call is ambiguous when several overloads
share the name and argument count.
"""
import json, os, re, sys, collections

G = os.environ.get('GHIDRA_ROOT', '/root/OdysseyDecomp-GhidraPseudoCodes')
GHIDRA_BASE = 0x100000

HDR_NAME = '// Nom démêlé'
CALL_RE = re.compile(
    r'(?<![\w:.>])((?:[A-Za-z_][\w]*(?:<[^;(){}]*?>)?::)*(?:operator\s*(?:\(\)|[^\s(\w]+|\w+)|~?[A-Za-z_]\w*(?:<[^;(){}]*?>)?))\s*\(')
FUN_RE = re.compile(r'^(?:thunk_)?FUN_[._]text__([0-9a-f]{6,10})$')
SKIP = {'if', 'while', 'for', 'switch', 'return', 'sizeof', 'do', 'else', 'case'}


def split_ns(name):
    parts, depth, cur, i = [], 0, '', 0
    while i < len(name):
        c = name[i]
        if c == '<': depth += 1
        elif c == '>': depth -= 1
        if depth == 0 and name.startswith('::', i):
            parts.append(cur); cur = ''; i += 2; continue
        cur += c; i += 1
    parts.append(cur)
    return parts


def count_args(text, pos):
    """pos = index just after '('. Returns number of top-level arguments."""
    depth, n, nonempty, i = 0, 0, False, pos
    end = min(len(text), pos + 4000)
    while i < end:
        c = text[i]
        if c in '([{':
            depth += 1; nonempty = True
        elif c in ')]}':
            if depth == 0:
                return n + (1 if nonempty else 0)
            depth -= 1
        elif c == ',' and depth == 0:
            n += 1
        elif not c.isspace():
            nonempty = True
        i += 1
    return -1


def sig_params(sig):
    if not sig or '(' not in sig:
        return -1
    inner = sig[sig.index('(') + 1:sig.rindex(')')] if ')' in sig else ''
    inner = inner.strip()
    if not inner or inner == 'void':
        return 0
    depth, n = 0, 1
    for c in inner:
        if c in '(<[': depth += 1
        elif c in ')>]': depth -= 1
        elif c == ',' and depth == 0: n += 1
    return n


def load_headers():
    funcs = []          # (path, ghidra addr, name, nparams)
    for dp, dn, fn in os.walk(G):
        if '.git' in dp.split(os.sep):
            continue
        for f in fn:
            if not f.endswith('.cpp'):
                continue
            p = os.path.join(dp, f)
            name = sig = addr = None
            with open(p, encoding='utf-8', errors='replace') as fh:
                for _ in range(6):
                    line = fh.readline().rstrip('\n')
                    if line.startswith(HDR_NAME):
                        name = line.split(':', 1)[1].strip()
                    elif line.startswith('// ') and '@ .text::' in line:
                        s, a = line[3:].rsplit('@ .text::', 1)
                        sig = s.strip()
                        addr = int(a.strip(), 16)
            if addr is not None and name:
                funcs.append((p, addr, name, sig_params(sig)))
    return funcs


def main():
    funcs = load_headers()
    print('pseudo-code functions:', len(funcs), flush=True)
    by_name = collections.defaultdict(list)
    for p, addr, name, npar in funcs:
        by_name[name].append((addr, npar))

    out = {}
    unresolved = collections.Counter()
    for n, (p, addr, name, npar) in enumerate(funcs):
        scope = split_ns(name)[:-1]
        with open(p, encoding='utf-8', errors='replace') as fh:
            text = fh.read()
        # body starts after the first '{' following the signature
        b = text.find('\n{')
        body = text[b:] if b >= 0 else text
        callees = set()
        amb = set()
        for m in CALL_RE.finditer(body):
            tok = m.group(1)
            if tok in SKIP:
                continue
            fm = FUN_RE.match(tok)
            if fm:
                callees.add(int(fm.group(1), 16))
                continue
            cands = None
            for k in range(len(scope), -1, -1):
                q = '::'.join(scope[:k] + [tok]) if k else tok
                cands = by_name.get(q)
                if cands:
                    break
            if not cands:
                if '::' in tok or tok[0].isupper():
                    unresolved[tok] += 1
                continue
            if len(cands) > 1:
                na = count_args(body, m.end())
                c2 = [c for c in cands if c[1] == na]
                cands = c2 or cands
            if len(cands) == 1:
                callees.add(cands[0][0])
            else:
                amb.add(tuple(sorted(c[0] - GHIDRA_BASE for c in cands[:8])))
        callees.discard(addr)
        if callees or amb:
            exact = sorted(a - GHIDRA_BASE for a in callees)
            out[addr - GHIDRA_BASE] = [exact, [list(g) for g in sorted(amb) if not set(g) & set(exact)]]
        if n % 10000 == 0:
            print(' ', n, flush=True)
    json.dump(out, open('xrefs.json', 'w'))
    edges = sum(len(v[0]) for v in out.values())
    print('ambiguous call sites:', sum(len(v[1]) for v in out.values()))
    print('callers:', len(out), 'edges:', edges)
    print('top unresolved names:', unresolved.most_common(8))


if __name__ == '__main__':
    main()
