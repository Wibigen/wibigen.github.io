#!/usr/bin/env python3
"""Merges the libclang extraction, the binary function list and the Ghidra
pseudo-code, then writes the site data (site/data/*.js).

Inputs : clang_raw.jsonl (extract_clang.py), binary.json (extract_binary.py)
Output : <site>/data/index.js, <site>/data/e/*.js, <site>/data/src/*.js, ...
"""
import json, os, re, sys, subprocess, collections, csv, hashlib, shutil

R = os.environ.get('ODYSSEY_ROOT', '/root/OdysseyDecomp')
G = os.environ.get('GHIDRA_ROOT', '/root/OdysseyDecomp-GhidraPseudoCodes')
SITE = sys.argv[1] if len(sys.argv) > 1 else '/root/site'
DATA = os.path.join(SITE, 'data')
MAIN_BASE = 0x7100000000
GHIDRA_BASE = 0x100000

STATUS = {'Matching': 1, 'NonMatchingMinor': 2, 'NonMatchingMajor': 3, 'NotDecompiled': 4}


def git_rev(path):
    try:
        return subprocess.check_output(['git', '-C', path, 'rev-parse', 'HEAD'], text=True).strip()
    except Exception:
        return 'main'


def demangle(names):
    names = list(names)
    if not names:
        return {}
    p = subprocess.run(['c++filt'], input='\n'.join(names), capture_output=True, text=True)
    return dict(zip(names, p.stdout.split('\n')))


# --------------------------------------------------------------------- utils
def module_of(path):
    if path.startswith('src/'): return 'game'
    if path.startswith('lib/al/Library/'): return 'al-library'
    if path.startswith('lib/al/Project/'): return 'al-project'
    if path.startswith('lib/al/'): return 'al'
    if path.startswith('lib/sead'): return 'sead'
    if path.startswith('lib/agl'): return 'agl'
    if path.startswith('lib/eui'): return 'eui'
    if path.startswith('lib/NintendoSDK-NEX'): return 'nex'
    if path.startswith('lib/NintendoSDK'): return 'nn'
    return 'other'


def obj_to_stem(obj):
    o = obj[:-2] if obj.endswith('.o') else obj
    head = o.split('/')[0]
    if head in ('Library', 'Project'): return 'lib/al/' + o
    if head == 'sead': return 'lib/sead/modules/src/' + o[5:]
    if head in ('NintendoSDK', 'NintendoSDK-NEX', 'eui'): return 'lib/' + o
    if o.endswith('.a'): return 'lib/(archives)/' + o
    if head in ('Unknown', 'UNKNOWN'): return 'unknown/' + o
    return 'src/' + o


def stem_of(path):
    return os.path.splitext(path)[0]


def split_top(s, sep='::'):
    """Splits s on sep, ignoring anything inside <> () [] {}."""
    out, depth, cur, i = [], 0, '', 0
    while i < len(s):
        c = s[i]
        if c in '<([{':
            # "operator<" / "operator<<" : ne pas compter
            if c == '<' and cur.endswith('operator'):
                cur += c; i += 1
                while i < len(s) and s[i] in '<=': cur += s[i]; i += 1
                continue
            depth += 1
        elif c in '>)]}':
            if c == '>' and (cur.endswith('operator') or cur.endswith('-')):
                cur += c; i += 1; continue
            depth -= 1
        if depth == 0 and s.startswith(sep, i):
            out.append(cur); cur = ''; i += len(sep); continue
        cur += c; i += 1
    out.append(cur)
    return out


def parse_demangled(d):
    """'void ns::A::f<int>(int, float) const' -> (qname, params[list], const, ret)"""
    s = d.strip()
    depth = 0; ppos = None; i = 0
    while i < len(s):
        c = s[i]
        if s.startswith('operator', i):
            # skip the operator symbol
            j = i + 8
            if s.startswith('()', j): i = j + 2; continue
            while j < len(s) and s[j] in '<>=!+-*/%&|^~[],': j += 1
            i = max(j, i + 8); continue
        if c in '<[{': depth += 1
        elif c in '>]}': depth -= 1
        elif c == '(':
            if depth == 0 and ppos is None:
                ppos = i
            depth += 1
        elif c == ')': depth -= 1
        i += 1
    if ppos is None:
        return s, None, False, None
    head = s[:ppos]
    # parameters: up to the matching ')'
    depth = 0; end = None
    for j in range(ppos, len(s)):
        if s[j] in '(<[{': depth += 1
        elif s[j] in ')>]}': depth -= 1
        if depth == 0:
            end = j; break
    plist = s[ppos + 1:end] if end else s[ppos + 1:]
    tail = s[end + 1:].strip() if end else ''
    params = [p.strip() for p in split_top(plist, ',')] if plist.strip() and plist.strip() != 'void' else []
    # optional return type (templates): last top-level "word"
    ret = None
    parts = []; depth = 0; cur = ''
    for c in head:
        if c in '<([{': depth += 1
        elif c in '>)]}': depth -= 1
        if c == ' ' and depth == 0 and not cur.endswith('operator') and not cur.endswith(','):
            parts.append(cur); cur = ''
        else:
            cur += c
    parts.append(cur)
    if len(parts) > 1 and 'operator' not in parts[-1]:
        ret = ' '.join(parts[:-1]); head = parts[-1]
    elif len(parts) > 1:
        # "operator new", "operator bool" ...
        k = max(i for i, p in enumerate(parts) if 'operator' in p)
        ret = ' '.join(parts[:k]) or None
        head = ' '.join(parts[k:])
    return head.strip(), params, 'const' in tail.split(), ret


def norm_key(d):
    return re.sub(r'\s+', '', d)


def strip_targs(name):
    out, depth = '', 0
    for c in name:
        if c == '<': depth += 1; continue
        if c == '>': depth -= 1; continue
        if depth == 0: out += c
    return out


# --------------------------------------------------------------------- clang
ANON_RE = re.compile(r'\((?:unnamed|anonymous) (?:struct|union|class|enum) at [^)]*\)')
def load_clang():
    recs = collections.defaultdict(list)
    with open('clang_raw.jsonl') as f:
        for line in f:
            line = ANON_RE.sub('(anonymous)', line).replace(R + '/', '')
            r = json.loads(line)
            recs[r['usr']].append(r)
    return recs


def pick(rs):
    """Returns (decl, defn) for a list of records sharing one USR."""
    decl = None; defn = None
    hdr = [r for r in rs if r['file'].endswith(('.h', '.hpp'))]
    defs = [r for r in rs if r.get('is_def')]
    if defs:
        cpp = [r for r in defs if r['file'].endswith('.cpp')]
        defn = (cpp or defs)[0]
    nd = [r for r in hdr if not r.get('is_def')]
    decl = (nd or hdr or rs)[0]
    return decl, defn


def main():
    os.makedirs(DATA, exist_ok=True)
    for d in ('e', 'src'):
        p = os.path.join(DATA, d)
        if os.path.isdir(p): shutil.rmtree(p)
        os.makedirs(p)

    recs = load_clang()
    print('USR uniques', len(recs))
    binary = json.load(open('binary.json'))

    ents = []         # dicts
    by_usr = {}
    by_q = collections.defaultdict(list)

    def new_ent(e):
        e['id'] = len(ents)
        ents.append(e)
        by_q[e['q']].append(e['id'])
        return e

    ANON = '(anonymous namespace)'

    def fix_anon(q, f):
        if ANON in q:
            return q.replace(ANON, '(anonymous@%s)' % stem_of(f))
        return q

    # 1) entities from headers / sources
    kinds_page = {'namespace', 'class', 'struct', 'union', 'class_template', 'class_template_spec',
                  'enum', 'typedef', 'alias', 'function', 'method', 'ctor', 'dtor', 'conversion',
                  'function_template', 'var', 'macro'}
    order = sorted(recs.items(), key=lambda kv: (kv[1][0]['kind'] != 'namespace', kv[1][0]['qname']))
    members = []
    for usr, rs in order:
        k = rs[0]['kind']
        decl, defn = pick(rs)
        if k == 'namespace':
            files = sorted({r['file'] for r in rs})
            q = fix_anon(decl['qname'], decl['file'])
            e = new_ent({'k': 'ns', 'q': q, 'n': decl['name'] or '(anonymous namespace)', 'usr': usr,
                         'files': files, 'parent_usr': decl['sem_parent']})
            by_usr[usr] = e['id']
            continue
        if k in ('field', 'enumerator', 'friend'):
            members.append((k, decl))
            continue
        if k not in kinds_page:
            continue
        # classes: prefer the definition (with members)
        if k in ('class', 'struct', 'union', 'class_template', 'class_template_spec'):
            main_r = defn or decl
        else:
            main_r = decl
        q = fix_anon(main_r['qname'], (defn or decl)['file'])
        kk = {'class': 'class', 'struct': 'struct', 'union': 'union', 'class_template': 'tclass',
              'class_template_spec': 'tclass', 'enum': 'enum', 'typedef': 'typedef', 'alias': 'alias',
              'function': 'func', 'method': 'method', 'ctor': 'ctor', 'dtor': 'dtor',
              'conversion': 'conv', 'function_template': 'tfunc', 'var': 'var', 'macro': 'macro'}[k]
        e = {'k': kk, 'q': q, 'n': main_r['name'], 'usr': usr, 'parent_usr': main_r.get('sem_parent'),
             'decl': {'f': decl['file'], 'l': decl['line'], 'sig': decl.get('sig', '')},
             'acc': main_r.get('access'), 'cm': main_r.get('comment') or decl.get('comment')}
        if defn is not None and kk not in ('ns',):
            e['def'] = {'f': defn['file'], 'l': defn['line'], 'end': defn.get('def_end'),
                        'sig': defn.get('sig', '')}
        if kk in ('func', 'method', 'ctor', 'dtor', 'conv', 'tfunc', 'tmethod'):
            src = defn or decl
            e['ret'] = decl.get('ret', '') if decl.get('ret') is not None else src.get('ret', '')
            e['ret_usr'] = decl.get('ret_usr') or src.get('ret_usr')
            # parameter names: the definition often has the real names
            dp = decl.get('params') or []
            fp = (defn or {}).get('params') or []
            params = []
            for i, p in enumerate(dp or fp):
                name = p[1] or (fp[i][1] if i < len(fp) else '')
                params.append([p[0], name, p[2], p[3]])
            e['params'] = params
            e['flags'] = sorted(set(decl.get('flags', []) + ((defn or {}).get('flags') or [])) - {'static'} |
                                ({'static'} if 'static' in decl.get('flags', []) else set()))
            e['mangled'] = decl.get('mangled') or (defn or {}).get('mangled')
            if decl.get('tparams') or (defn or {}).get('tparams'):
                e['tp'] = decl.get('tparams') or defn.get('tparams')
        elif kk in ('class', 'struct', 'union', 'tclass'):
            e['size'] = main_r.get('size'); e['align'] = main_r.get('align')
            e['bases'] = main_r.get('bases') or []
            e['tp'] = main_r.get('tparams') or []
            e['complete'] = bool(defn)
            if defn: e['decl'] = {'f': defn['file'], 'l': defn['line'], 'sig': defn.get('sig', ''),
                                  'end': defn.get('def_end')}
            e.pop('def', None)
            fwd = sorted({(r['file'], r['line']) for r in rs if not r.get('is_def')})
            if fwd: e['fwd'] = fwd[:20]
        elif kk == 'enum':
            m = defn or decl
            e['underlying'] = m.get('underlying'); e['scoped'] = m.get('scoped')
            e['decl'] = {'f': m['file'], 'l': m['line'], 'sig': m.get('sig', '')}
            e.pop('def', None)
            e['values'] = []
        elif kk in ('typedef', 'alias'):
            e['underlying'] = decl.get('underlying'); e['under_usr'] = decl.get('under_usr')
            if decl.get('tparams'): e['tp'] = decl['tparams']
            e.pop('def', None)
        elif kk == 'var':
            e['type'] = decl.get('type'); e['type_usr'] = decl.get('type_usr')
            e['flags'] = decl.get('flags', []); e['mangled'] = decl.get('mangled') or (defn or {}).get('mangled')
        elif kk == 'macro':
            e['parent_usr'] = None
            e.pop('def', None)
        new_ent(e)
        by_usr[usr] = e['id']

    # parents
    for e in ents:
        pu = e.get('parent_usr')
        e['p'] = by_usr.get(pu) if pu else None
        if e['k'] == 'tfunc' and e['p'] is not None and ents[e['p']]['k'] in ('class', 'struct', 'union', 'tclass'):
            e['k'] = 'tmethod'
    # members (fields, enumerators, friends)
    for k, r in members:
        pid = by_usr.get(r['parent'])
        if pid is None:
            continue
        pe = ents[pid]
        if k == 'field':
            pe.setdefault('fields', []).append({'n': r['name'], 't': r.get('type'), 'off': r.get('offset'),
                                                'sz': r.get('size'), 'acc': r.get('access'), 'tu': r.get('type_usr'),
                                                'bits': r.get('bits'), 'l': r['line'], 'f': r['file'],
                                                'cm': r.get('comment')})
        elif k == 'enumerator':
            pe.setdefault('values', []).append({'n': r['name'], 'v': r.get('value'), 'x': r.get('expr'),
                                                'cm': r.get('comment'), 'l': r['line']})
        elif k == 'friend':
            pe.setdefault('friends', []).append(r.get('sig'))
    for e in ents:
        if 'fields' in e:
            e['fields'].sort(key=lambda x: (x['off'] if x['off'] is not None else 1 << 30, x['l']))
        if 'values' in e:
            e['values'].sort(key=lambda x: x['l'])

    # 2) matching with the binary
    mangled = {e['mangled'] for e in ents if e.get('mangled')}
    dm = demangle(mangled)
    key2ent = collections.defaultdict(list)
    for e in ents:
        if e.get('mangled'):
            key2ent[norm_key(dm.get(e['mangled'], e['mangled']))].append(e['id'])
    matched = 0
    unmatched = []
    for b in binary:
        b['addr'] = MAIN_BASE + b['off']
        hit = None
        for d in b['demangled']:
            thunk = False
            dd = d
            for pre in ('non-virtual thunk to ', 'virtual thunk to '):
                if dd.startswith(pre):
                    dd = dd[len(pre):]; thunk = True
            cands = key2ent.get(norm_key(dd))
            if cands:
                if len(cands) > 1:
                    st = obj_to_stem(b['obj'])
                    c2 = [c for c in cands if (ents[c].get('def') or ents[c]['decl'])['f'].startswith(st)]
                    cands = c2 or cands
                hit = (cands[0], thunk)
                break
        if hit:
            ents[hit[0]].setdefault('bin', []).append(bin_info(b, hit[1]))
            matched += 1
        else:
            unmatched.append(b)
    print('binary functions matched to headers:', matched, '/', len(binary))

    # 3) functions only present in the binary
    ns_q = {e['q'] for e in ents if e['k'] == 'ns'}
    owner_info = collections.defaultdict(lambda: {'this': False, 'ctor': False})
    parsed = []
    for b in unmatched:
        d = b['demangled'][0] if b['demangled'] else ''
        lab = b['labels'][0] if b['labels'] else ''
        thunk = False
        if (not d or d == lab) and lab:
            m = re.match(r'^(?:j_)?(_Z.*?)(?:_\d+)?$', lab)
            if m and m.group(1) != lab:
                alt = demangle([m.group(1)]).get(m.group(1))
                if alt and alt != m.group(1):
                    d = alt; thunk = True
        if not d:
            d = lab or 'sub_%x' % b['off']
        for pre in ('non-virtual thunk to ', 'virtual thunk to '):
            if d.startswith(pre): d = d[len(pre):]; thunk = True
        anon_name = '(anonymous@%s)' % obj_to_stem(b['obj'])
        d = d.replace(ANON, anon_name)
        q, params, const, ret = parse_demangled(d.replace(anon_name, '\x01'))
        q = q.strip().replace('\x01', anon_name)
        if params: params = [x.replace('\x01', anon_name) for x in params]
        if ret: ret = ret.replace('\x01', anon_name)
        parts = split_top(q)
        owner = '::'.join(parts[:-1])
        gh = (b.get('ghidra') or [{}])[0]
        is_this = '__thiscall' in (gh.get('sig') or '') or const or 'Nrv' in (parts[-2] if len(parts) > 1 else '')
        if owner:
            oi = owner_info[owner]
            if is_this: oi['this'] = True
            last = strip_targs(parts[-1])
            if last == strip_targs(parts[-2]) or last == '~' + strip_targs(parts[-2]): oi['ctor'] = True
        parsed.append((b, d, q, parts, params, const, ret, thunk, is_this))

    def ensure_owner(path):
        """Returns the id of entity 'path' (class/namespace), creating it if needed."""
        if not path:
            return None
        ids = [i for i in by_q.get(path, []) if ents[i]['k'] in ('ns', 'class', 'struct', 'union', 'tclass', 'xclass', 'xns')]
        if ids:
            return ids[0]
        base = strip_targs(path)
        if base != path:
            ids = [i for i in by_q.get(base, []) if ents[i]['k'] in ('class', 'struct', 'union', 'tclass', 'xclass')]
            if ids:
                # template instantiation: attached to the template
                return ids[0]
        parts = split_top(path)
        pid = ensure_owner('::'.join(parts[:-1]))
        oi = owner_info.get(path, {'this': False, 'ctor': False})
        isclass = oi['this'] or oi['ctor'] or ('<' in parts[-1])
        if path.startswith('(anonymous@'):
            isclass = len(parts) > 1 and isclass
        if len(parts) == 1 and path.startswith('(anonymous@'):
            isclass = False
        e = new_ent({'k': 'xclass' if isclass else 'xns', 'q': path, 'n': parts[-1], 'p': pid,
                     'inferred': True})
        return e['id']

    for b, d, q, parts, params, const, ret, thunk, is_this in parsed:
        owner = '::'.join(parts[:-1])
        pid = ensure_owner(owner)
        name = parts[-1]
        bi = bin_info(b, thunk)
        # thunk of an already created function: merge
        key = norm_key(d)
        ex = [i for i in by_q.get(q, []) if ents[i].get('dkey') == key]
        if ex:
            ents[ex[0]].setdefault('bin', []).append(bi)
            continue
        gh = (b.get('ghidra') or [{}])[0]
        gret = ghidra_ret(gh.get('sig'))
        pk = ents[pid]['k'] if pid is not None else None
        if pk in ('class', 'struct', 'union', 'tclass', 'xclass'):
            sn = strip_targs(name); so = strip_targs(parts[-2]) if len(parts) > 1 else ''
            kk = 'ctor' if sn == so else 'dtor' if sn == '~' + so else 'method'
        else:
            kk = 'func'
        e = new_ent({'k': kk, 'q': q, 'n': name, 'p': pid, 'binonly': True, 'dkey': key,
                     'dem': d, 'params': [[t, '', None, None] for t in (params or [])],
                     'ret': ret, 'gret': gret, 'flags': (['const'] if const else []) +
                     ([] if is_this or kk != 'method' else ['static?']),
                     'mangled': b['labels'][0] if b['labels'] else None, 'bin': [bi]})
        if params is None:
            e['k'] = 'sym'
    print('entities:', len(ents))

    # 4) derived classes, virtual overrides
    for e in ents:
        for bs in e.get('bases', []) or []:
            bid = by_usr.get(bs[3]) if bs[3] else None
            if bid is None:
                ids = [i for i in by_q.get(strip_targs(bs[0]).replace('const ', ''), [])
                       if ents[i]['k'] in ('class', 'struct', 'union', 'tclass', 'xclass')]
                bid = ids[0] if ids else None
            bs.append(bid)
            if bid is not None:
                ents[bid].setdefault('derived', []).append(e['id'])

    children = collections.defaultdict(list)
    for e in ents:
        if e.get('p') is not None:
            children[e['p']].append(e['id'])

    def sigkey(e):
        return (e['n'], tuple(p[0] for p in e.get('params', [])), 'const' in e.get('flags', []))

    for e in ents:
        if e['k'] != 'method' or e.get('binonly'):
            continue
        if not ({'virtual', 'override'} & set(e.get('flags', []))):
            continue
        owner = e.get('p')
        if owner is None: continue
        sk = sigkey(e)
        seen = set(); stack = [b[4] for b in ents[owner].get('bases', []) if b[4] is not None]
        while stack:
            c = stack.pop()
            if c in seen: continue
            seen.add(c)
            for ch in children[c]:
                if ents[ch]['k'] == 'method' and sigkey(ents[ch]) == sk:
                    e.setdefault('overrides', []).append(ch)
                    ents[ch].setdefault('overby', []).append(e['id'])
            stack.extend(b[4] for b in ents[c].get('bases', []) if b[4] is not None)

    # 5) nerves and factories
    nerve_re = re.compile(r'\b(NERVE_IMPL|NERVE_IMPL_|NERVE_END_IMPL|NERVE_END_IMPL_|NERVE_ACTION_IMPL|'
                          r'NERVE_ACTION_IMPL_|NERVE_HOST_TYPE_IMPL|NERVE_HOST_TYPE_IMPL_)\(\s*([\w:]+)\s*,\s*(\w+)\s*(?:,\s*(\w+))?(?:,\s*(\w+))?\)')
    fact_re = re.compile(r'\{\s*"([^"]+)"\s*,\s*(?:([\w:]+)<([\w:]+)>|(nullptr|[\w:]+))\s*\}')
    all_src = []
    for base in ['src', 'lib/al']:
        for dp, dn, fn in os.walk(os.path.join(R, base)):
            for n in fn:
                if n.endswith(('.cpp', '.h')):
                    all_src.append(os.path.relpath(os.path.join(dp, n), R))
    cls_by_q = {}
    for e in ents:
        if e['k'] in ('class', 'struct', 'union', 'tclass', 'xclass'):
            cls_by_q.setdefault(e['q'], e['id'])
    factories = collections.defaultdict(list)
    for path in all_src:
        txt = open(os.path.join(R, path), encoding='utf-8', errors='replace').read()
        for m in nerve_re.finditer(txt):
            macro, cls, nm, a3, a4 = m.groups()
            cid = cls_by_q.get(cls)
            if cid is None:
                continue
            line = txt.count('\n', 0, m.start()) + 1
            fn = 'exe' + nm
            if macro.startswith('NERVE_IMPL_') or macro == 'NERVE_ACTION_IMPL_' or macro == 'NERVE_HOST_TYPE_IMPL_':
                fn = 'exe' + (a3 or nm)
            ents[cid].setdefault('nerves', []).append({'n': nm, 'm': macro, 'exe': fn,
                                                       'end': ('end' + (a4 or a3 or nm)) if 'END' in macro else None,
                                                       'f': path, 'l': line})
        if 'Factory' in path and path.endswith('.cpp'):
            for m in fact_re.finditer(txt):
                fname, fn, cls, other = m.groups()
                line = txt.count('\n', 0, m.start()) + 1
                factories[path].append([fname, cls, line])
                if cls:
                    cid = cls_by_q.get(cls)
                    if cid is not None:
                        ents[cid].setdefault('factory', []).append([os.path.basename(path)[:-4], fname, path, line])

    # 6) files / units
    files = {}
    def add_file(path):
        if path in files or path is None: return
        full = os.path.join(R, path)
        if not os.path.isfile(full): return
        files[path] = {'path': path, 'mod': module_of(path)}
    for base in ['src', 'lib/al']:
        for dp, dn, fn in os.walk(os.path.join(R, base)):
            for n in fn:
                if n.endswith(('.cpp', '.h', '.hpp', '.inc')):
                    add_file(os.path.relpath(os.path.join(dp, n), R))
    for e in ents:
        for loc in (e.get('decl'), e.get('def')):
            if loc: add_file(loc['f'])
    units = {}
    def unit(stem):
        u = units.get(stem)
        if u is None:
            u = units[stem] = {'stem': stem, 'files': [], 'objs': set(), 'decl': [], 'defs': [], 'bins': 0,
                               'st': collections.Counter(), 'bytes': collections.Counter()}
        return u
    for path in files:
        unit(stem_of(path))['files'].append(path)
    for b in binary:
        u = unit(obj_to_stem(b['obj']))
        u['objs'].add(b['obj'])
        u['st'][b['status']] += 1
        u['bytes'][b['status']] += b['size']
    for e in ents:
        if e['k'] in ('ns', 'xns'): continue
        if e.get('decl'): unit(stem_of(e['decl']['f']))['decl'].append(e['id'])
        if e.get('def') and stem_of(e['def']['f']) != stem_of(e['decl']['f']):
            unit(stem_of(e['def']['f']))['defs'].append(e['id'])
        if e.get('binonly'):
            u = unit(obj_to_stem(e['bin'][0]['obj']))
            u['decl'].append(e['id'])
    # units = entities of kind 'unit'
    for stem in sorted(units):
        u = units[stem]
        e = new_ent({'k': 'unit', 'q': stem, 'n': stem.split('/')[-1], 'p': None, 'unit': u})
        u['id'] = e['id']
    # attach inferred classes to the unit of their functions
    for e in ents:
        if e['k'] in ('xclass',):
            objs = collections.Counter()
            for c in children[e['id']]:
                for bb in ents[c].get('bin', []): objs[bb['obj']] += 1
            if objs:
                e['obj'] = objs.most_common(1)[0][0]
                units[obj_to_stem(e['obj'])]['decl'].append(e['id'])

    # owning unit (for the folder tree)
    for e in ents:
        if e['k'] == 'unit': continue
        loc = e.get('decl')
        if loc: e['u'] = units[stem_of(loc['f'])]['id']
        elif e.get('bin'): e['u'] = units[obj_to_stem(e['bin'][0]['obj'])]['id']
        elif e.get('obj'): e['u'] = units[obj_to_stem(e['obj'])]['id']

    # 7) aggregated status
    for e in ents:
        bs = e.get('bin')
        if bs:
            e['st'] = min(STATUS.get(b['st'], 4) for b in bs)
        else:
            e['st'] = 0

    # 8) unique slugs (URLs)
    slug_count = collections.Counter()
    for e in ents:
        base = ('file:' + e['q']) if e['k'] == 'unit' else e['q']
        slug_count[base] += 1
        e['slug'] = base if slug_count[base] == 1 else '%s~%d' % (base, slug_count[base])

    # 9) bundles
    bundle_of = {}
    page_kinds_cls = {'class', 'struct', 'union', 'tclass', 'xclass'}
    def owner_page(e):
        p = e
        while p is not None:
            if p['k'] in page_kinds_cls: return p['id']
            if p['k'] in ('ns', 'xns'): return None
            p = ents[p['p']] if p.get('p') is not None else None
        return None
    groups = collections.defaultdict(list)
    for e in ents:
        if e['k'] in page_kinds_cls:
            groups[('c', e['id'])].append(e['id'])
        elif e['k'] == 'unit':
            groups[('u', e['id'] // 40)].append(e['id'])
        else:
            op = owner_page(e)
            if op is not None:
                groups[('c', op)].append(e['id'])
            else:
                groups[('n', e.get('p'))].append(e['id'])
    bnum = 0
    for key, ids in sorted(groups.items(), key=lambda kv: str(kv[0])):
        for i in range(0, len(ids), 250 if key[0] == 'n' else 100000):
            for x in ids[i:i + 250 if key[0] == 'n' else len(ids)]:
                bundle_of[x] = bnum
            bnum += 1
    print('bundles', bnum)

    # 10) output
    KMAP = {k: i for i, k in enumerate(['ns', 'xns', 'class', 'struct', 'union', 'tclass', 'xclass', 'enum',
                                        'typedef', 'alias', 'func', 'method', 'ctor', 'dtor', 'conv', 'tfunc',
                                        'tmethod', 'var', 'macro', 'unit', 'sym'])}
    file_list = sorted(files)
    file_idx = {p: i for i, p in enumerate(file_list)}
    fl_out = []
    for p in file_list:
        txt = open(os.path.join(R, p), encoding='utf-8', errors='replace').read()
        n = txt.count('\n') + 1
        fl_out.append([p, files[p]['mod'], n])
        with open(os.path.join(DATA, 'src', '%d.js' % file_idx[p]), 'w') as f:
            f.write('DOC.got("src/%d",%s);' % (file_idx[p], json.dumps(txt, ensure_ascii=False)))

    idx_out = []
    for e in ents:
        flags = 0
        if e.get('binonly') or e['k'] in ('xclass', 'xns'): flags |= 1
        if e.get('acc') == 'private': flags |= 2
        if e.get('acc') == 'protected': flags |= 4
        if 'virtual' in e.get('flags', []) or 'override' in e.get('flags', []): flags |= 8
        if 'static' in e.get('flags', []): flags |= 16
        if e.get('def'): flags |= 32
        row = [e['slug'], KMAP[e['k']], e['n'], e.get('p') if e.get('p') is not None else -1,
               e['st'], bundle_of[e['id']], flags, e.get('u', -1)]
        idx_out.append(row)

    # statistics
    stats = collections.Counter(); sbytes = collections.Counter()
    for b in binary:
        stats[b['status']] += 1; sbytes[b['status']] += b['size']
    kcount = collections.Counter(e['k'] for e in ents)
    subs = {}
    for sp, repo in [('lib/sead', 'open-ead/sead'), ('lib/agl', 'open-ead/agl'), ('lib/eui', 'open-ead/eui'),
                     ('lib/NintendoSDK-NEX', 'open-ead/NintendoSDK-NEX'), ('lib/NintendoSDK', 'open-ead/nnheaders')]:
        subs[sp] = [repo, git_rev(os.path.join(R, sp))]
    meta = {'decomp_rev': git_rev(R), 'ghidra_rev': git_rev(G),
            'decomp_repo': 'Wibigen/OdysseyDecomp', 'ghidra_repo': 'Wibigen/OdysseyDecomp-GhidraPseudoCodes',
            'stats': stats, 'bytes': sbytes, 'kinds': kcount, 'nbin': len(binary),
            'kmap': list(KMAP.keys()), 'subs': subs}
    SN = ['Matching', 'NonMatchingMinor', 'NonMatchingMajor', 'NotDecompiled']
    ustats = [[u['id']] + [u['st'].get(k, 0) for k in SN] + [u['bytes'].get(k, 0) for k in SN]
              for u in units.values() if u['st']]
    inh = [[e['id']] + [b[4] for b in e.get('bases', []) if len(b) > 4 and b[4] is not None]
           for e in ents if e.get('bases')]
    nerv = [[e['id'], len(e['nerves'])] for e in ents if e.get('nerves')]
    addr = sorted([b['off'], e['id']] for e in ents for b in e.get('bin', []))
    with open(os.path.join(DATA, 'index.js'), 'w') as f:
        f.write('DOC.got("index",')
        json.dump({'meta': meta, 'e': idx_out, 'files': fl_out, 'addr': addr, 'ustats': ustats, 'inh': inh, 'nerv': nerv}, f, ensure_ascii=False, separators=(',', ':'))
        f.write(');')

    # per-bundle details
    def ids_link(lst):
        return lst
    bundles = collections.defaultdict(dict)
    for e in ents:
        d = {}
        for k in ('q', 'acc', 'cm', 'decl', 'def', 'ret', 'gret', 'params', 'flags', 'mangled', 'tp', 'size',
                  'align', 'bases', 'derived', 'complete', 'fwd', 'underlying', 'scoped', 'values', 'type',
                  'fields', 'friends', 'nerves', 'factory', 'overrides', 'overby', 'dem', 'files', 'inferred',
                  'obj', 'binonly'):
            v = e.get(k)
            if v not in (None, [], {}, ''):
                d[k] = v
        for k in ('ret_usr', 'type_usr', 'under_usr'):
            if e.get(k) and e[k] in by_usr:
                d[k.replace('_usr', '_id')] = by_usr[e[k]]
        if 'bases' in d:
            d['bases'] = [[x[0], x[1], x[2], x[4]] for x in d['bases']]
        if 'params' in d:
            d['params'] = [[p[0], p[1], p[2], by_usr.get(p[3]) if p[3] else None] for p in d['params']]
        if 'fields' in d:
            for fd in d['fields']:
                fd['ti'] = by_usr.get(fd.pop('tu')) if fd.get('tu') else None
                fd.pop('f', None)
        if 'decl' in d: d['decl'] = dict(d['decl'], fi=file_idx.get(d['decl']['f']))
        if 'def' in d: d['def'] = dict(d['def'], fi=file_idx.get(d['def']['f']))
        if e.get('bin'): d['bin'] = e['bin']
        if e['k'] == 'unit':
            u = e['unit']
            d['ufiles'] = [[p, file_idx.get(p)] for p in sorted(u['files'], key=lambda x: (not x.endswith('.h'), x))]
            d['objs'] = sorted(u['objs'])
            d['udecl'] = sorted(set(u['decl'])); d['udefs'] = sorted(set(u['defs']) - set(u['decl']))
            d['ust'] = dict(u['st']); d['ubytes'] = dict(u['bytes'])
            fac = [factories[p] for p in u['files'] if p in factories]
            if fac: d['ufactory'] = fac[0]
        bundles[bundle_of[e['id']]][e['id']] = d
    for b, m in bundles.items():
        with open(os.path.join(DATA, 'e', '%d.js' % b), 'w') as f:
            f.write('DOC.got("e/%d",' % b)
            json.dump(m, f, ensure_ascii=False, separators=(',', ':'))
            f.write(');')

    # strings and data symbols
    strings = []
    with open(os.path.join(R, 'data/data_strings.csv'), encoding='utf-8', errors='replace') as f:
        for row in csv.reader(f):
            if len(row) >= 2: strings.append([row[0], row[1]])
    syms = []
    with open(os.path.join(R, 'data/data_symbols.csv'), encoding='utf-8', errors='replace') as f:
        for row in csv.reader(f):
            if len(row) >= 2: syms.append([row[0], row[1]])
    dsy = demangle([s[1] for s in syms])
    var_by_m = {e['mangled']: e['id'] for e in ents if e['k'] == 'var' and e.get('mangled')}
    syms = [[a, m, dsy.get(m, m), var_by_m.get(m)] for a, m in syms]
    with open(os.path.join(DATA, 'strings.js'), 'w') as f:
        f.write('DOC.got("strings",'); json.dump(strings, f, ensure_ascii=False, separators=(',', ':')); f.write(');')
    with open(os.path.join(DATA, 'symbols.js'), 'w') as f:
        f.write('DOC.got("symbols",'); json.dump(syms, f, ensure_ascii=False, separators=(',', ':')); f.write(');')
    with open(os.path.join(DATA, 'factories.js'), 'w') as f:
        f.write('DOC.got("factories",')
        json.dump({p: [[a, b, l, cls_by_q.get(b) if b else None] for a, b, l in v] for p, v in factories.items()},
                  f, ensure_ascii=False, separators=(',', ':'))
        f.write(');')
    print('ok', kcount)


def ghidra_ret(sig):
    if not sig: return None
    m = re.match(r'^(.*?)\s*(?:__thiscall|__cdecl|__stdcall|__fastcall)?\s*[\w:~<>,\.\s\*&\[\]\(\)=!+\-/|^%]*?\(', sig)
    head = sig.split('(')[0]
    head = head.replace('__thiscall', '').replace('__cdecl', '').strip()
    toks = head.rsplit(' ', 1)
    return toks[0].strip() if len(toks) == 2 else None


def bin_info(b, thunk):
    gh = b.get('ghidra') or []
    d = {'off': b['off'], 'sz': b['size'], 'st': b['status'], 'obj': b['obj'], 'lab': b['labels'],
         'gh': [[g['path'], g['sig']] for g in gh]}
    if thunk: d['thunk'] = 1
    if b['guess']: d['guess'] = 1
    return d


if __name__ == '__main__':
    main()
