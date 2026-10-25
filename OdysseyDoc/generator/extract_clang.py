#!/usr/bin/env python3
"""Extracts OdysseyDecomp C++ declarations with libclang.

Writes clang_raw.jsonl: one JSON record per entity (namespace, class,
function, field, enum, typedef, variable, macro...). Duplicates (same USR seen
in several translation units) are merged later by build_data.py.
"""
import json, os, sys, subprocess, multiprocessing as mp, time
import clang.cindex as ci
from clang.cindex import CursorKind as K

R = os.environ.get('ODYSSEY_ROOT', '/root/OdysseyDecomp')
RD = subprocess.check_output(['clang', '-print-resource-dir'], text=True).strip()
ARGS = ['-x', 'c++', '-std=c++17', '-DNON_MATCHING', '-DNNSDK=1', '-DSWITCH=1', '-DSEAD_VERSION=SEAD_VERSION_SMO',
        '-DNN_SDK_MAJOR=3', '-DNN_SDK_MINOR=5', '-DNN_SDK_PATCH=1',
        '-DNN_WARE_MAJOR=3', '-DNN_WARE_MINOR=5', '-DNN_WARE_PATCH=1',
        f'-I{R}/src', f'-I{R}/lib/al', f'-I{R}/lib', 
        f'-I{R}/lib/sead/include', f'-I{R}/lib/NintendoSDK/include', f'-I{R}/lib/agl/include',
        f'-I{R}/lib/eui/include', f'-I{R}/lib/NintendoSDK-NEX/include',
        '-isystem', RD + '/include', '-Wno-everything', '-ferror-limit=0']
OPTS = ci.TranslationUnit.PARSE_DETAILED_PROCESSING_RECORD

FUNC_KINDS = {K.FUNCTION_DECL, K.CXX_METHOD, K.CONSTRUCTOR, K.DESTRUCTOR,
              K.CONVERSION_FUNCTION, K.FUNCTION_TEMPLATE}
CLASS_KINDS = {K.CLASS_DECL, K.STRUCT_DECL, K.UNION_DECL, K.CLASS_TEMPLATE,
               K.CLASS_TEMPLATE_PARTIAL_SPECIALIZATION}
KIND_NAME = {
    K.NAMESPACE: 'namespace', K.CLASS_DECL: 'class', K.STRUCT_DECL: 'struct',
    K.UNION_DECL: 'union', K.CLASS_TEMPLATE: 'class_template',
    K.CLASS_TEMPLATE_PARTIAL_SPECIALIZATION: 'class_template_spec',
    K.ENUM_DECL: 'enum', K.ENUM_CONSTANT_DECL: 'enumerator', K.TYPEDEF_DECL: 'typedef',
    K.TYPE_ALIAS_DECL: 'alias', K.TYPE_ALIAS_TEMPLATE_DECL: 'alias',
    K.FUNCTION_DECL: 'function', K.CXX_METHOD: 'method', K.CONSTRUCTOR: 'ctor',
    K.DESTRUCTOR: 'dtor', K.CONVERSION_FUNCTION: 'conversion',
    K.FUNCTION_TEMPLATE: 'function_template', K.FIELD_DECL: 'field', K.VAR_DECL: 'var',
    K.MACRO_DEFINITION: 'macro',
}
ACCESS = {ci.AccessSpecifier.PUBLIC: 'public', ci.AccessSpecifier.PROTECTED: 'protected',
          ci.AccessSpecifier.PRIVATE: 'private'}

_text_cache = {}


def ftext(path):
    t = _text_cache.get(path)
    if t is None:
        with open(path, 'rb') as f:
            t = f.read()
        _text_cache[path] = t
    return t


def extent_text(c, start=None, end=None):
    e = c.extent
    if e.start.file is None:
        return ''
    data = ftext(e.start.file.name)
    s = e.start.offset if start is None else start
    en = e.end.offset if end is None else end
    return data[s:en].decode('utf-8', 'replace')


def rel(path):
    p = os.path.realpath(path)
    return os.path.relpath(p, R) if p.startswith(R + '/') else None


def qname(c):
    parts = []
    p = c
    while p is not None and p.kind != K.TRANSLATION_UNIT:
        n = p.spelling
        if p.kind == K.NAMESPACE and not n:
            n = '(anonymous namespace)'
        elif p.kind in CLASS_KINDS or p.kind == K.ENUM_DECL:
            if not n or 'unnamed' in n or '(anonymous' in n:
                n = '(anonymous)'
        parts.append(n)
        p = p.semantic_parent
    return '::'.join(reversed(parts))


def type_usr(t):
    """USR of the core declaration of a type (after pointers/refs/arrays)."""
    for _ in range(8):
        k = t.kind
        if k in (ci.TypeKind.POINTER, ci.TypeKind.LVALUEREFERENCE, ci.TypeKind.RVALUEREFERENCE):
            t = t.get_pointee()
        elif k in (ci.TypeKind.CONSTANTARRAY, ci.TypeKind.INCOMPLETEARRAY):
            t = t.element_type
        elif k == ci.TypeKind.ELABORATED:
            t = t.get_named_type()
        else:
            break
    d = t.get_declaration()
    if d is None or d.kind == K.NO_DECL_FOUND:
        return None
    if d.kind in (K.TYPEDEF_DECL, K.TYPE_ALIAS_DECL) or d.kind in CLASS_KINDS or d.kind == K.ENUM_DECL:
        return d.get_usr() or None
    return None


def tparams(c):
    out = []
    for ch in c.get_children():
        if ch.kind == K.TEMPLATE_TYPE_PARAMETER:
            out.append('typename ' + ch.spelling)
        elif ch.kind == K.TEMPLATE_NON_TYPE_PARAMETER:
            out.append(ch.type.spelling + ' ' + ch.spelling)
        elif ch.kind == K.TEMPLATE_TEMPLATE_PARAMETER:
            out.append('template<...> class ' + ch.spelling)
    return out


def func_record(c, rec):
    rec['ret'] = c.result_type.spelling if c.kind not in (K.CONSTRUCTOR, K.DESTRUCTOR) else ''
    if c.kind == K.FUNCTION_TEMPLATE:
        # result_type is not always available: fall back to the function type
        rec['ret'] = c.type.get_result().spelling if c.type.kind == ci.TypeKind.FUNCTIONPROTO else rec['ret']
    rec['ret_usr'] = type_usr(c.result_type) if rec['ret'] else None
    params = []
    pcursors = [ch for ch in c.get_children() if ch.kind == K.PARM_DECL]
    for a in pcursors:
        default = None
        toks = [t.spelling for t in a.get_tokens()]
        if '=' in toks:
            default = ' '.join(toks[toks.index('=') + 1:])
        params.append([a.type.spelling, a.spelling, default, type_usr(a.type)])
    rec['params'] = params
    fl = []
    try:
        if c.is_const_method(): fl.append('const')
        if c.is_static_method(): fl.append('static')
        if c.is_virtual_method(): fl.append('virtual')
        if c.is_pure_virtual_method(): fl.append('pure')
        if c.is_default_method(): fl.append('default')
        if c.is_deleted_method(): fl.append('deleted')
        if c.kind == K.CONSTRUCTOR:
            if c.is_explicit_method(): fl.append('explicit')
            if c.is_copy_constructor(): fl.append('copy_ctor')
            if c.is_move_constructor(): fl.append('move_ctor')
    except Exception:
        pass
    for ch in c.get_children():
        if ch.kind == K.CXX_OVERRIDE_ATTR: fl.append('override')
        elif ch.kind == K.CXX_FINAL_ATTR: fl.append('final')
    if c.type.kind == ci.TypeKind.FUNCTIONPROTO and c.type.is_function_variadic():
        fl.append('variadic')
    toks = [t.spelling for t in list(c.get_tokens())[:6]]
    if 'inline' in toks: fl.append('inline')
    if 'static' in toks and 'static' not in fl and c.kind == K.FUNCTION_DECL: fl.append('static')
    rec['flags'] = fl
    if c.kind == K.FUNCTION_TEMPLATE:
        rec['tparams'] = tparams(c)
    try:
        rec['mangled'] = c.mangled_name or None
    except Exception:
        rec['mangled'] = None
    body = None
    for ch in c.get_children():
        if ch.kind == K.COMPOUND_STMT:
            body = ch
    if c.is_definition():
        rec['is_def'] = True
        rec['def_text'] = extent_text(c)
        if body is not None:
            rec['sig'] = extent_text(c, end=body.extent.start.offset).strip()
        else:
            rec['sig'] = extent_text(c).strip()
        rec['def_end'] = c.extent.end.line
    else:
        rec['sig'] = extent_text(c).strip()


def walk(c, out, mainfiles, parent_usr):
    for ch in c.get_children():
        loc = ch.location
        if loc.file is None:
            continue
        f = rel(loc.file.name)
        if f is None or f not in mainfiles:
            continue
        handle(ch, out, mainfiles, parent_usr, f)


def handle(c, out, mainfiles, parent_usr, f):
    k = c.kind
    kn = KIND_NAME.get(k)
    if kn is None:
        if k in (K.LINKAGE_SPEC, K.UNEXPOSED_DECL):
            walk(c, out, mainfiles, parent_usr)
        return
    if k == K.MACRO_DEFINITION:
        if c.spelling.startswith('_') and c.spelling.endswith('_H'):
            return
        toks = [t.spelling for t in c.get_tokens()]
        out.append({'kind': 'macro', 'usr': 'macro:' + f + ':' + c.spelling, 'name': c.spelling,
                    'qname': c.spelling, 'file': f, 'line': c.location.line,
                    'sig': '#define ' + extent_text(c)})
        return
    usr = c.get_usr()
    if not usr:
        if k in CLASS_KINDS or k == K.ENUM_DECL:
            usr = 'anon:%s:%d:%d' % (f, c.location.line, c.location.column)
        else:
            return
    rec = {'kind': kn, 'usr': usr, 'name': c.spelling, 'qname': qname(c), 'file': f,
           'line': c.location.line, 'parent': parent_usr,
           'sem_parent': (c.semantic_parent.get_usr() if c.semantic_parent is not None and
                          c.semantic_parent.kind != K.TRANSLATION_UNIT else None)}
    acc = ACCESS.get(c.access_specifier)
    if acc and k != K.NAMESPACE:
        rec['access'] = acc
    if c.raw_comment:
        rec['comment'] = c.raw_comment
    if k == K.NAMESPACE:
        out.append(rec)
        walk(c, out, mainfiles, usr)
        return
    if k in CLASS_KINDS:
        rec['is_def'] = c.is_definition()
        rec['tparams'] = tparams(c) if k != K.CLASS_DECL and k != K.STRUCT_DECL else []
        if k == K.CLASS_TEMPLATE:
            rec['tparams'] = tparams(c)
        bases = []
        for ch in c.get_children():
            if ch.kind == K.CXX_BASE_SPECIFIER:
                bacc = ACCESS.get(ch.access_specifier, 'public')
                virt = 'virtual' in [t.spelling for t in ch.get_tokens()][:3]
                bd = ch.type.get_declaration()
                bases.append([ch.type.spelling, bacc, virt,
                              bd.get_usr() if bd is not None and bd.kind != K.NO_DECL_FOUND else None])
        rec['bases'] = bases
        if rec['is_def']:
            sz = c.type.get_size()
            rec['size'] = sz if sz > 0 else None
            al_ = c.type.get_align()
            rec['align'] = al_ if al_ > 0 else None
            rec['sig'] = extent_text(c, end=_brace(c)).strip()
            rec['def_end'] = c.extent.end.line
        else:
            rec['sig'] = extent_text(c).strip()
        out.append(rec)
        if rec['is_def']:
            # all children (even outside the main file: rare includes)
            for ch in c.get_children():
                if ch.kind in (K.CXX_BASE_SPECIFIER,):
                    continue
                if ch.location.file is None:
                    continue
                cf = rel(ch.location.file.name)
                if cf is None:
                    continue
                if ch.kind == K.FRIEND_DECL:
                    for fc in ch.get_children():
                        out.append({'kind': 'friend', 'usr': usr + '#friend#' + fc.spelling,
                                    'name': fc.spelling, 'qname': rec['qname'] + '::friend ' + fc.spelling,
                                    'file': cf, 'line': fc.location.line, 'parent': usr,
                                    'sig': extent_text(ch).strip()})
                    continue
                handle(ch, out, mainfiles | {cf}, usr, cf)
        return
    if k == K.ENUM_DECL:
        rec['is_def'] = c.is_definition()
        rec['underlying'] = c.enum_type.spelling if c.is_definition() else None
        rec['scoped'] = c.is_scoped_enum()
        rec['sig'] = extent_text(c, end=_brace(c)).strip() if rec['is_def'] else extent_text(c).strip()
        out.append(rec)
        for ch in c.get_children():
            if ch.kind == K.ENUM_CONSTANT_DECL:
                toks = [t.spelling for t in ch.get_tokens()]
                expr = ' '.join(toks[toks.index('=') + 1:]) if '=' in toks else None
                out.append({'kind': 'enumerator', 'usr': ch.get_usr(), 'name': ch.spelling,
                            'qname': qname(ch), 'file': f, 'line': ch.location.line, 'parent': usr,
                            'value': ch.enum_value, 'expr': expr,
                            'comment': ch.raw_comment})
        return
    if k in (K.TYPEDEF_DECL, K.TYPE_ALIAS_DECL, K.TYPE_ALIAS_TEMPLATE_DECL):
        if k == K.TYPE_ALIAS_TEMPLATE_DECL:
            rec['underlying'] = extent_text(c).split('=', 1)[-1].strip().rstrip(';')
            rec['tparams'] = tparams(c)
        else:
            rec['underlying'] = c.underlying_typedef_type.spelling
            rec['under_usr'] = type_usr(c.underlying_typedef_type)
        rec['sig'] = extent_text(c).strip()
        out.append(rec)
        return
    if k == K.FIELD_DECL:
        rec['type'] = c.type.spelling
        rec['type_usr'] = type_usr(c.type)
        off = c.get_field_offsetof()
        rec['offset'] = off // 8 if off is not None and off >= 0 else None
        if c.is_bitfield():
            rec['bits'] = c.get_bitfield_width()
        sz = c.type.get_size()
        rec['size'] = sz if sz > 0 else None
        rec['sig'] = extent_text(c).strip()
        out.append(rec)
        return
    if k == K.VAR_DECL:
        rec['type'] = c.type.spelling
        rec['type_usr'] = type_usr(c.type)
        toks = [t.spelling for t in list(c.get_tokens())[:5]]
        rec['flags'] = [x for x in ('static', 'extern', 'constexpr', 'const', 'inline') if x in toks]
        rec['is_def'] = c.is_definition()
        rec['sig'] = extent_text(c).strip()[:600]
        try:
            rec['mangled'] = c.mangled_name or None
        except Exception:
            pass
        out.append(rec)
        return
    if k in FUNC_KINDS:
        func_record(c, rec)
        out.append(rec)
        return


def _brace(c):
    for t in c.get_tokens():
        if t.spelling == '{':
            return t.extent.start.offset
    return None


_seen = set()


def process(path):
    t0 = time.time()
    idx = ci.Index.create()
    try:
        tu = idx.parse(os.path.join(R, path), args=ARGS, options=OPTS)
    except Exception as e:
        return path, [], [], str(e)
    files = set()
    for inc in tu.get_includes():
        f = rel(inc.include.name)
        if f:
            files.add(f)
    files.add(path)
    todo = {f for f in files if f not in _seen}
    _seen.update(todo)
    out = []
    walk(tu.cursor, out, todo, None)
    diags = [str(d) for d in tu.diagnostics if d.severity >= 3][:5]
    return path, out, sorted(todo), diags


def main():
    srcs = []
    for base in ['src', 'lib/al']:
        for dp, dn, fn in os.walk(os.path.join(R, base)):
            for n in fn:
                if n.endswith('.cpp'):
                    srcs.append(os.path.relpath(os.path.join(dp, n), R))
    hdrs = []
    for base in ['src', 'lib/al', 'lib/sead/include', 'lib/agl/include', 'lib/eui/include',
                 'lib/NintendoSDK/include', 'lib/NintendoSDK-NEX/include']:
        for dp, dn, fn in os.walk(os.path.join(R, base)):
            for n in fn:
                if n.endswith(('.h', '.hpp')):
                    hdrs.append(os.path.relpath(os.path.join(dp, n), R))
    srcs.sort(); hdrs.sort()
    out = open(sys.argv[1] if len(sys.argv) > 1 else 'clang_raw.jsonl', 'w')
    covered = set()
    errors = {}
    n = 0
    # 1) .cpp files (cover most included headers)
    with mp.Pool(os.cpu_count() or 2) as pool:
        for path, recs, todo, diags in pool.imap_unordered(process, srcs, chunksize=4):
            covered.update(todo)
            for r in recs:
                out.write(json.dumps(r, ensure_ascii=False) + '\n')
            if diags: errors[path] = diags
            n += 1
            if n % 50 == 0: print('cpp', n, len(srcs), flush=True)
    rest = [h for h in hdrs if h not in covered]
    print('remaining headers', len(rest), flush=True)
    with mp.Pool(os.cpu_count() or 2) as pool:
        for path, recs, todo, diags in pool.imap_unordered(process, rest, chunksize=4):
            for r in recs:
                out.write(json.dumps(r, ensure_ascii=False) + '\n')
            if diags: errors[path] = diags
            n += 1
            if n % 50 == 0: print('h', n, flush=True)
    out.close()
    json.dump(errors, open('clang_errors.json', 'w'), indent=1)
    print('done; files with errors:', len(errors))


if __name__ == '__main__':
    main()
