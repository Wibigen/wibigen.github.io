/* OdysseyDoc — C++ syntax highlighting (home-made, offline) with links into the docs. */
'use strict';

const HL = (() => {
  const KW = new Set(('alignas alignof asm auto bool break case catch char char16_t char32_t class const constexpr ' +
    'const_cast continue decltype default delete do double dynamic_cast else enum explicit export extern false float ' +
    'for friend goto if inline int long mutable namespace new noexcept nullptr operator override final private protected ' +
    'public register reinterpret_cast return short signed sizeof static static_assert static_cast struct switch template ' +
    'this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while ' +
    'NULL __thiscall __cdecl undefined undefined1 undefined2 undefined4 undefined8 ulong uint ushort uchar byte longlong ' +
    'ulonglong code').split(' '));
  const BUILTIN_T = new Set('s8 s16 s32 s64 u8 u16 u32 u64 f32 f64 size_t uintptr_t intptr_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t'.split(' '));

  // order matters: comments, strings, preprocessor, numbers, identifiers, rest
  const RE = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(^[ \t]*#[^\n]*)|(\b0[xX][0-9a-fA-F]+[uUlL]*\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[fFuUlL]*\b)|(~?[A-Za-z_]\w*(?:::~?[A-Za-z_]\w*|::operator\s*[^\s(]+)*)|(\s+|[^\w\s"'\/#]+|[\s\S])/gm;

  /** Name-resolution context: list of prefixes to try ("al::", "Shine::" ...). */
  function ctxFromEntity(i) {
    const out = [];
    let p = i;
    while (p !== null && p !== undefined) {
      const k = IX.kind(p);
      if (['ns', 'xns', 'class', 'struct', 'union', 'tclass', 'xclass'].includes(k)) out.push(IX.q(p) + '::');
      p = IX.parent(p);
    }
    out.push('');
    return out;
  }
  function ctxFromText(text) {
    const s = new Set();
    const re = /\bnamespace\s+([A-Za-z_]\w*(?:::\w+)*)\s*\{/g; let m;
    while ((m = re.exec(text))) s.add(m[1] + '::');
    const re2 = /\b([A-Z]\w*)::\1\s*\(/g;      // Class::Class( in a .cpp
    while ((m = re2.exec(text))) s.add(m[1] + '::');
    return [...s, ''];
  }

  function resolve(id, isCall, ctx) {
    // exact qualified name or relative to the context
    for (const pre of ctx) {
      const q = pre + id;
      if (isCall) {
        const f = IX.fnByQ.get(q); if (f) return f[0];
        const t = IX.typeByQ.get(q); if (t !== undefined) return t;
      } else {
        const t = IX.typeByQ.get(q); if (t !== undefined) return t;
        if (id.includes('::')) { const f = IX.fnByQ.get(q); if (f) return f[0]; const a = IX.anyByQ.get(q); if (a !== undefined) return a; }
      }
    }
    if (!id.includes('::')) {
      const s = IX.typeShort.get(id);
      if (s !== undefined && s >= 0 && !isCall) return s;
    }
    return -1;
  }

  /** Renvoie un tableau de lignes HTML. */
  function lines(text, ctx = ['']) {
    const out = [];
    let cur = '';
    const push = (cls, s) => {
      const parts = s.split('\n');
      for (let k = 0; k < parts.length; k++) {
        if (k > 0) { out.push(cur); cur = ''; }
        if (parts[k]) cur += cls ? `<span class="${cls}">${U.esc(parts[k])}</span>` : U.esc(parts[k]);
      }
    };
    RE.lastIndex = 0;
    let m;
    while ((m = RE.exec(text))) {
      if (m[1]) push('tk-co', m[1]);
      else if (m[2]) push('tk-st', m[2]);
      else if (m[3]) push('tk-pp', m[3]);
      else if (m[4]) push('tk-nu', m[4]);
      else if (m[5]) {
        const id = m[5];
        if (KW.has(id)) { push('tk-kw', id); continue; }
        if (BUILTIN_T.has(id)) { push('tk-ty', id); continue; }
        const after = text.slice(RE.lastIndex, RE.lastIndex + 40);
        const isCall = /^\s*(<[^;(){}]*>)?\s*\(/.test(after);
        const t = IX.ready ? resolve(id, isCall, ctx) : -1;
        if (t >= 0) {
          const k = IX.kind(t);
          const cls = ['class', 'struct', 'union', 'tclass', 'xclass', 'enum', 'typedef', 'alias'].includes(k) ? 'tk-ty' : 'tk-fn';
          cur += `<a class="${cls}" href="${IX.href(t)}" title="${U.esc(U.KIND_LABEL[k] + ' ' + IX.q(t))}">${U.esc(id)}</a>`;
        } else push(isCall ? 'tk-fn' : '', id);
      } else push('', m[6] ?? m[0]);
      if (m[0].length === 0) RE.lastIndex++;
    }
    out.push(cur);
    return out;
  }

  /**
   * Code block with line numbers.
   * opts: {start: first line number, hl: [a,b] highlighted lines, fileIdx, anchors, ctx, maxHeight}
   */
  function block(text, opts = {}) {
    const start = opts.start || 1;
    const L = lines(text, opts.ctx || ['']);
    const hl = opts.hl;
    const id = opts.id ? ` id="${opts.id}"` : '';
    let h = `<div class="code"${id}${opts.maxHeight ? ` style="max-height:${opts.maxHeight}"` : ''}><table>`;
    for (let k = 0; k < L.length; k++) {
      const n = start + k;
      const cls = hl && n >= hl[0] && n <= hl[1] ? (hl[0] === hl[1] ? ' class="hl"' : ' class="hlr"') : '';
      const ln = opts.fileIdx !== undefined ? `<a href="${U.fileHref(opts.fileIdx, n)}">${n}</a>` : n;
      h += `<tr${cls}${opts.anchors ? ` id="L${n}"` : ''}><td class="ln">${ln}</td><td class="lc">${L[k] || ' '}</td></tr>`;
    }
    return h + '</table></div>';
  }

  /** Link(s) inside a C++ type string ("const al::LiveActor *"). */
  function type(str, hintId, ctx = ['']) {
    if (!str) return '';
    const re = /(~?[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)|([^A-Za-z_]+)/g;
    let out = '', m, first = true;
    while ((m = re.exec(str))) {
      if (m[1]) {
        const id = m[1];
        if (KW.has(id)) { out += `<span class="tk-kw">${id}</span>`; continue; }
        let t = -1;
        if (first && hintId !== null && hintId !== undefined && IX.name(hintId) === id.split('::').pop()) t = hintId;
        if (t < 0 && IX.ready) t = resolve(id, false, ctx);
        if (t >= 0 && !['func', 'method', 'ctor', 'dtor'].includes(IX.kind(t))) {
          out += `<a href="${IX.href(t)}" title="${U.esc(U.KIND_LABEL[IX.kind(t)] + ' ' + IX.q(t))}">${U.esc(id)}</a>`;
          first = false;
        } else out += U.esc(id);
      } else out += U.esc(m[2]);
    }
    return out;
  }

  /** Fully qualifies the type names of a C++ type string, resolving them from the given context
   *  ("const ActorInitInfo &" in al:: → "const al::ActorInitInfo &"). */
  function qualify(str, ctx = ['']) {
    if (!str || !IX.ready) return str;
    const TYPEK = ['class', 'struct', 'union', 'tclass', 'xclass', 'enum', 'typedef', 'alias'];
    return str.replace(/(::\s*)?\b([A-Za-z_]\w*)\b/g, (m, pre, id) => {
      if (pre || KW.has(id) || BUILTIN_T.has(id)) return m;
      const t = resolve(id, false, ctx);
      if (t < 0 || !TYPEK.includes(IX.kind(t))) return m;
      const q = IX.q(t);
      return q.endsWith(id) && !q.includes('(anonymous@') ? q : m;
    });
  }

  return { lines, block, type, ctxFromEntity, ctxFromText, qualify };
})();
