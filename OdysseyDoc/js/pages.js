/* OdysseyDoc — page rendering (entities, files, lists, special pages). */
'use strict';

const P = (() => {
  const esc = U.esc;
  const CLS = new Set(['class', 'struct', 'union', 'tclass', 'xclass']);
  const FN = new Set(['func', 'method', 'ctor', 'dtor', 'conv', 'tfunc', 'tmethod', 'sym']);
  const TYPEK = new Set(['class', 'struct', 'union', 'tclass', 'xclass', 'enum', 'typedef', 'alias']);

  // ================================================================ helpers
  function crumbs(i, extra = []) {
    const chain = [];
    let p = IX.parent(i);
    while (p !== null) { chain.unshift(p); p = IX.parent(p); }
    let h = '<div class="crumbs"><a href="#/">Home</a>';
    for (const c of chain) h += `<span class="sep">›</span>${U.link(c)}`;
    for (const x of extra) h += `<span class="sep">›</span>${x}`;
    return h + '</div>';
  }

  function title(i, k) {
    const q = IX.q(i), n = IX.name(i);
    const pre = q.length > n.length && q.endsWith(n) ? q.slice(0, q.length - n.length) : '';
    return `<div class="page-head">${U.kb(k)}<h1 class="page-title"><span class="ns-prefix">${esc(pre)}</span>${esc(n)}</h1></div>`;
  }

  function kv(rows) {
    let h = '<dl class="kv">';
    for (const [k, v] of rows) if (v !== null && v !== undefined && v !== '') h += `<dt>${k}</dt><dd>${v}</dd>`;
    return h + '</dl>';
  }

  function section(t, body, cnt = '', id = '') {
    return `<section class="blk"${id ? ` id="${id}"` : ''}><h2>${t}${cnt !== '' ? ` <span class="cnt">(${cnt})</span>` : ''}</h2>${body}</section>`;
  }

  function flagTags(flags = [], acc) {
    let h = '';
    const F = { static: ['stat', 'static'], 'static?': ['stat', 'static?'], virtual: ['virt', 'virtual'],
                pure: ['virt', 'pure virtual (= 0)'], override: ['virt', 'override'], final: ['virt', 'final'],
                const: ['const', 'const'], inline: ['', 'inline'], explicit: ['', 'explicit'], default: ['', '= default'],
                deleted: ['', '= delete'], variadic: ['', 'variadic (...)'], copy_ctor: ['', 'copy'],
                move_ctor: ['', 'move'], constexpr: ['', 'constexpr'], extern: ['', 'extern'] };
    for (const f of flags) { const x = F[f]; if (x) h += `<span class="tag ${x[0]}">${x[1]}</span>`; }
    if (acc && acc !== 'public') h += `<span class="tag priv">${acc}</span>`;
    return h;
  }

  function progressBar(c) {          // c = [_, m1, m2, m3, m4]
    const tot = c[1] + c[2] + c[3] + c[4];
    if (!tot) return '<span class="dim">No function present in the binary.</span>';
    const w = x => (100 * x / tot).toFixed(3) + '%';
    return `<div class="bar" title="${c[1]} matching, ${c[2]} minor, ${c[3]} major, ${c[4]} not decompiled">
      <span class="b1" style="width:${w(c[1])}"></span><span class="b2" style="width:${w(c[2])}"></span><span class="b3" style="width:${w(c[3])}"></span></div>
      <div class="legend"><span>${U.st(1)} Matching: ${U.num(c[1])}</span><span>${U.st(2)} NonMatching minor: ${U.num(c[2])}</span>
      <span>${U.st(3)} NonMatching major: ${U.num(c[3])}</span><span>${U.st(4)} Not decompiled: ${U.num(c[4])}</span>
      <span><b>${U.pct(c[1] + c[2] + c[3], tot)}</b> decompiled (by function count)</span></div>`;
  }

  function paramsText(d, withNames = true) {
    return (d.params || []).map(p => esc(p[0]) + (withNames && p[1] ? ' ' + esc(p[1]) : '')).join(', ');
  }

  /** full signature as HTML */
  function signature(i, d) {
    const k = IX.kind(i);
    const ctx = HL.ctxFromEntity(i);
    if (k === 'sym' || (d.binonly && !d.params)) return `<div class="sig">${esc(d.dem || IX.q(i))}</div>`;
    let h = '';
    if (d.tp && d.tp.length) h += `<span class="tk-kw">template</span> &lt;${esc(d.tp.join(', '))}&gt;\n`;
    const fl = d.flags || [];
    if (fl.includes('static')) h += '<span class="tk-kw">static</span> ';
    if (fl.includes('virtual') && !fl.includes('override')) h += '<span class="tk-kw">virtual</span> ';
    if (fl.includes('explicit')) h += '<span class="tk-kw">explicit</span> ';
    if (fl.includes('inline')) h += '<span class="tk-kw">inline</span> ';
    if (d.ret) h += HL.type(d.ret, d.ret_id, ctx) + ' ';
    const q = IX.q(i), n = IX.name(i);
    const pre = q.endsWith(n) ? q.slice(0, q.length - n.length) : '';
    const p = IX.parent(i);
    h += (p !== null ? U.link(p, pre.replace(/::$/, '')) + '::' : esc(pre)) + `<span class="fname">${esc(n)}</span>(`;
    const ps = d.params || [];
    const multi = ps.length > 2 || ps.reduce((a, x) => a + x[0].length + (x[1] || '').length, 0) > 70;
    ps.forEach((x, j) => {
      h += (multi ? '\n    ' : '') + HL.type(x[0], x[3], ctx) + (x[1] ? ` <span class="pname">${esc(x[1])}</span>` : '') +
        (x[2] ? ` = ${esc(x[2])}` : '') + (j < ps.length - 1 ? ', ' : '');
    });
    if (fl.includes('variadic')) h += (ps.length ? ', ' : '') + '...';
    h += (multi ? '\n' : '') + ')';
    if (fl.includes('const')) h += ' <span class="tk-kw">const</span>';
    if (fl.includes('override')) h += ' <span class="tk-kw">override</span>';
    if (fl.includes('final')) h += ' <span class="tk-kw">final</span>';
    if (fl.includes('pure')) h += ' = 0';
    if (fl.includes('default')) h += ' = <span class="tk-kw">default</span>';
    if (fl.includes('deleted')) h += ' = <span class="tk-kw">delete</span>';
    return `<div class="sig">${h};</div>`;
  }

  function natureOf(i, d) {
    const k = IX.kind(i), p = IX.parent(i);
    const pk = p !== null ? IX.kind(p) : null;
    const fl = d.flags || [];
    const ofCls = p !== null ? `${U.KIND_LABEL[pk].toLowerCase()} ${U.link(p, IX.q(p))}` : '';
    if (k === 'ctor') return `Constructor of ${ofCls}`;
    if (k === 'dtor') return `Destructor of ${ofCls}${fl.includes('virtual') || fl.includes('override') ? ' (virtual)' : ''}`;
    if (k === 'conv') return `Conversion operator of ${ofCls}`;
    if (pk && CLS.has(pk)) {
      let w = 'Method';
      if (fl.includes('static')) w = 'Static method (no <code>this</code>)';
      else if (fl.includes('pure')) w = 'Pure virtual method (abstract)';
      else if (fl.includes('override')) w = 'Virtual method (<code>override</code>)';
      else if (fl.includes('virtual')) w = 'Virtual method';
      else if (fl.includes('static?')) w = 'Method (probably static: Ghidra sees no <code>this</code>)';
      if (k === 'tmethod') w = 'Method template';
      return `${w} of ${ofCls} — <b>yes, this is a method</b>`;
    }
    if (k === 'sym') return 'Binary symbol without a C++ signature (C function, runtime, or non-demanglable name)';
    const nsTxt = p !== null ? `in namespace ${U.link(p, IX.q(p))}` : 'in the global namespace';
    return `${k === 'tfunc' ? 'Function template' : 'Free function'} ${nsTxt} — <b>not a method</b>`;
  }

  function retText(i, d) {
    const k = IX.kind(i);
    const ctx = HL.ctxFromEntity(i);
    if (k === 'ctor' || k === 'dtor') return '<span class="dim">Nothing — constructors / destructors have no return type.</span>';
    if (k === 'conv') return `<span class="type">${HL.type(IX.name(i).replace(/^operator\s*/, ''), null, ctx)}</span> (conversion target type)`;
    if (d.ret) {
      let h = `<span class="type">${HL.type(d.ret, d.ret_id, ctx)}</span>`;
      const r = d.ret.trim();
      if (r === 'void') h += ' <span class="dim">— returns nothing</span>';
      else if (r === 'bool') h += ' <span class="dim">— boolean (true / false)</span>';
      else if (/\*$/.test(r)) h += ' <span class="dim">— pointer (may be nullptr)</span>';
      else if (/&$/.test(r)) h += ' <span class="dim">— reference</span>';
      if (d.binonly) h += ' <span class="dim">(from the demangled template name)</span>';
      return h;
    }
    if (d.binonly) {
      return `<span class="dim">Unknown in the decomp (function not declared yet).</span>` +
        (d.gret ? ` Ghidra estimate: <code>${esc(d.gret)}</code> <span class="dim">(undefinedN = N-byte value of unknown type)</span>` : '');
    }
    return '<span class="dim">—</span>';
  }

  // ---------------------------------------------------------------- return type provenance
  const RSRC = {
    verified: ['s1', 'Confirmed', 'Declared in a decomp header, and the decompiled implementation matches the binary.'],
    declared: ['s2', 'Declared, not verified', 'Declared in a decomp header, but the function is not decompiled yet: nobody has proven this signature against the binary.'],
    mangled: ['s1', 'Exact (mangled name)', 'Encoded in the mangled template symbol, so it is exact.'],
    ghidra: ['bad', 'Guessed by Ghidra', 'Not declared in the decomp. This is Ghidra’s guess — verify it in the disassembly before relying on it.'],
    unknown: ['bad', 'Unknown', 'Not declared in the decomp and Ghidra gives no usable type.'],
  };
  function rsrcPill(d, short = false) {
    const r = RSRC[d.rsrc];
    if (!r) return '';
    return `<span class="pill ${r[0]}" title="${esc(r[2])}">${r[0] === 'bad' ? '⚠ ' : ''}${r[1]}</span>${short ? '' : ` <span class="small dim">${esc(r[2])}</span>`}`;
  }

  // ---------------------------------------------------------------- hook safety
  /** Evaluates a binary entry for an exlaunch trampoline hook.
   *  near = single B patch (callback within ±128 MB, the normal case for SMO's ~12.5 MB main)
   *  far  = absolute jump patch (LDR X17 / BR X17 / address: 4–5 instructions, 16–20 bytes) */
  function hookSafety(b) {
    const issues = [];
    const hk = b.hk;
    if (b.thunk) issues.push({ lvl: 'warn', mode: 'both', t: 'This entry is a non-virtual thunk (this-pointer adjustor). Hooking it only catches calls made through this base-class view; hook the main entry instead.' });
    if (b.sz < 20) issues.push({ lvl: 'bad', mode: 'far', t: `The function is only ${b.sz} bytes. An absolute-jump patch writes 16–20 bytes and would overwrite the start of the next function.` });
    if (hk) {
      if (hk.loop && hk.loop.length) issues.push({ lvl: 'bad', mode: 'both', t: `The function branches back to its own entry from inside (at ${hk.loop.map(x => U.hex(x)).join(', ')}). With a trampoline, every iteration re-enters your hook (nested calls, stack growth).` });
      if (hk.into && hk.into.length) issues.push({ lvl: 'bad', mode: 'far', t: `Code branches into the bytes an absolute-jump patch overwrites: ${hk.into.map(([t, f]) => `${U.hex(f)} → ${U.hex(t)} (entry+${t - b.off})`).join(', ')}. Those branches would land in the middle of the patch.` });
      const ins = hk.i || [];
      if (ins[0] && ins[0][2]) issues.push({ lvl: 'warn', mode: 'near', t: `The first instruction (<code>${esc(ins[0][0] + ' ' + ins[0][1])}</code>) is PC-relative. exlaunch relocates it into the trampoline (b/bl/b.cond/cbz/tbz/adr/adrp/ldr literal are supported), so it normally works — but a literal load copies the value at hook time, and a hand-written trampoline would break.` });
      const farPc = ins.slice(1, 5).map((x, k) => x[2] ? `#${k + 2} <code>${esc(x[0] + ' ' + x[1])}</code>` : null).filter(Boolean);
      if (farPc.length) issues.push({ lvl: 'warn', mode: 'far', t: `PC-relative instruction(s) inside a 5-instruction patch: ${farPc.join(', ')}. exlaunch relocates them, but this is the classic place where trampolines break.` });
      if (ins[0] && /^b$/i.test(ins[0][0])) issues.push({ lvl: 'info', mode: 'both', t: 'The function is a tail jump (<code>b</code>) to another function; consider hooking the target instead.' });
    }
    const worst = mode => {
      const l = issues.filter(x => x.mode === mode || x.mode === 'both').map(x => x.lvl);
      if (l.includes('bad')) return 'bad';
      if (l.includes('warn')) return 'warn';
      return hk ? 'ok' : 'unknown';
    };
    return { issues, near: worst('near'), far: worst('far'), checked: !!hk };
  }
  const HOOK_LABEL = { ok: ['s1', 'Safe to hook'], warn: ['s2', 'Hook with care'], bad: ['bad', 'Unsafe to hook'], unknown: ['', 'Not checked'] };
  function hookPill(v, prefix = '') { const l = HOOK_LABEL[v]; return `<span class="pill ${l[0]}">${prefix}${l[1]}</span>`; }

  function hookSection(i, d) {
    const bins = (d.bin || []);
    if (!bins.length) return '';
    let h = '';
    for (const b of bins) {
      const r = hookSafety(b);
      const lst = mode => r.issues.filter(x => x.mode === mode || x.mode === 'both').map(x => `<li class="hk-${x.lvl}">${x.t}</li>`).join('');
      const nearL = lst('near'), farL = lst('far');
      if (bins.length > 1) h += `<h3>Entry ${U.hex(b.off)}${b.thunk ? ' (thunk)' : ''}</h3>`;
      h += kv([
        ['Normal case', `${hookPill(r.near)} <span class="small dim">exlaunch writes a single <code>B</code> over the first instruction (callback within ±128 MB — always the case for SMO’s ~12.5 MB main).</span>${nearL ? `<ul class="hk-list">${nearL}</ul>` : ''}`],
        ['Fallback', `${hookPill(r.far)} <span class="small dim">If the callback is out of range, exlaunch writes an absolute jump over the first 4–5 instructions (16–20 bytes).</span>${farL ? `<ul class="hk-list">${farL}</ul>` : ''}`],
        ['Size', `${U.num(b.sz)} bytes`],
      ]);
      if (b.hk && b.hk.i && b.hk.i.length) {
        h += `<table class="t hk-ins"><thead><tr><th>#</th><th>Offset</th><th>Instruction</th><th>PC-relative</th><th>Overwritten</th></tr></thead><tbody>${b.hk.i.map((x, k) =>
          `<tr><td class="num">${k + 1}</td><td class="num">${U.hex(b.off + 4 * k)}</td><td class="m">${esc(x[0])} ${esc(x[1])}</td><td>${x[2] ? '<span class="pill s2">yes</span>' : '<span class="dim">no</span>'}</td><td class="small">${k === 0 ? 'normal + fallback' : k < 5 ? 'fallback only' : '—'}</td></tr>`).join('')}</tbody></table>`;
      }
      if (!r.checked) h += `<div class="note">Instruction-level checks (PC-relative instructions, branches into the patch, loops back to the entry) need data from your Ghidra project: run <code>generator/ghidra/ExportOdysseyDoc.java</code>, then rebuild with <code>--ghidra-export</code>. Only the size check is shown here.</div>`;
    }
    return h;
  }

  // ---------------------------------------------------------------- HOOK_DEFINE_TRAMPOLINE template
  const GH_TYPES = { void: 'void', undefined: 'u8', undefined1: 'u8', undefined2: 'u16', undefined4: 'u32', undefined8: 'u64',
    bool: 'bool', byte: 'u8', uchar: 'u8', char: 'char', ushort: 'u16', short: 's16', uint: 'u32', int: 's32',
    ulong: 'u64', long: 's64', ulonglong: 'u64', longlong: 's64', float: 'f32', double: 'f64' };
  function ghidraTypeToCpp(t) {
    t = (t || '').trim();
    if (!t) return null;
    if (GH_TYPES[t]) return GH_TYPES[t];
    const m = t.match(/^(.*?)\s*\*$/);
    if (m) {
      const base = m[1].trim();
      if (GH_TYPES[base]) return GH_TYPES[base] + '*';
      const ti = IX.typeByQ.get(base) ?? IX.typeShort.get(base);
      return ti !== undefined && ti >= 0 ? IX.q(ti) + '*' : 'void*';
    }
    return null;
  }
  function includeFor(path) {
    if (!path) return null;
    if (path.startsWith('src/')) return `"${path.slice(4)}"`;
    if (path.startsWith('lib/al/')) return `"${path.slice(7)}"`;
    const m = path.match(/^lib\/(?:sead|agl|eui|NintendoSDK|NintendoSDK-NEX)\/include\/(.*)$/);
    return m ? `<${m[1]}>` : null;
  }
  function hookTemplate(i, d) {
    const bins = (d.bin || []).filter(b => !b.thunk);
    if (!bins.length) return null;
    const b = bins[0], k = IX.kind(i), fl = d.flags || [];
    const q = IX.q(i), name = IX.name(i);
    const owner = q.endsWith('::' + name) ? q.slice(0, q.length - name.length - 2) : null;
    const p = IX.parent(i);
    const isMember = owner && p !== null && CLS.has(IX.kind(p)) && !fl.includes('static') && k !== 'sym';
    const warn = [];
    let ret;
    const hctx = HL.ctxFromEntity(i);
    if (k === 'ctor' || k === 'dtor') ret = 'void';
    else if (d.ret) ret = HL.qualify(d.ret, hctx).replace(/\s+([*&])/g, '$1');
    else {
      const g = ghidraTypeToCpp(d.gret);
      ret = g || 'u64';
      warn.push(`return type GUESSED${d.gret ? ` (Ghidra: ${d.gret})` : ''} — verify before shipping`);
    }
    if (d.rsrc === 'declared') warn.push('return type declared in the decomp but not verified (function not decompiled yet)');
    const args = [];
    if (isMember) args.push([(fl.includes('const') ? 'const ' : '') + owner + '*', 'self']);
    (d.params || []).forEach((x, n) => args.push([HL.qualify(x[0], hctx).replace(/\s+([*&])/g, '$1'), (x[1] || 'arg' + n).replace(/^(this|self)$/, '$1_')]));
    if (fl.includes('variadic')) warn.push('variadic function: Orig() cannot forward the "..." arguments');
    if (k === 'sym') warn.push('no C++ signature known: fill in the parameters from the Ghidra pseudo-code');
    const r = hookSafety(b);
    if (r.near === 'bad') warn.push('hook safety: UNSAFE (see "Hook safety" on this page)');
    else if (r.near === 'warn') warn.push('hook safety: check the warnings in "Hook safety" on this page');
    const ov = IX.slug(i).match(/~(\d+)$/);
    const id = q.replace(/\(anonymous@[^)]*\)/g, 'anon').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') + (ov ? '_' + ov[1] : '') + '_Hook';
    const inc = includeFor(d.decl && d.decl.f);
    const sig = args.map(a => a[0] + ' ' + a[1]).join(', ');
    const call = 'Orig(' + args.map(a => a[1]).join(', ') + ')';
    const sym = (b.lab || []).find(l => l.startsWith('_Z'));
    let code = `// ${q} — offset ${U.hex(b.off)}\n`;
    warn.forEach(w => code += `// WARNING: ${w}\n`);
    code += `HOOK_DEFINE_TRAMPOLINE(${id}) {\n    static ${ret} Callback(${sig}) {\n`;
    code += ret === 'void' ? `        ${call};\n` : `        ${ret} result = ${call};\n        return result;\n`;
    code += `    }\n};\n\n//${id}::InstallAtOffset(${U.hex(b.off)});\n`;
    if (sym) code += `//${id}::InstallAtSymbol("${sym}");\n`;
    if (bins.length > 1) code += `// Other entries for this function: ${bins.slice(1).map(x => U.hex(x.off) + (x.lab && x.lab[0] ? ' (' + x.lab[0] + ')' : '')).join(', ')}\n`;
    return code;
  }

  // ---------------------------------------------------------------- calls / called by
  const shortQ = q => q.replace(/\(anonymous@[^)]*\)/g, '(anon)');
  function xrefRow(x, dup) {
    return `<div>${U.st(IX.status(x))}${U.link(x, shortQ(IX.q(x)))}${dup.has(IX.q(x)) ? `<span class="dim small xr-sig" data-id="${x}"></span>` : ''}</div>`;
  }
  function xrefList(ids, limit = 400) {
    const sorted = ids.slice().sort((a, b) => IX.q(a).localeCompare(IX.q(b)));
    const cnt = new Map(); sorted.forEach(x => cnt.set(IX.q(x), (cnt.get(IX.q(x)) || 0) + 1));
    const dup = new Set([...cnt].filter(([, n]) => n > 1).map(([q]) => q));
    const row = x => xrefRow(x, dup);
    let h = `<div class="entity-list">${sorted.slice(0, limit).map(row).join('')}</div>`;
    if (sorted.length > limit) h += `<button class="btn xr-more" data-ids="${sorted.slice(limit).join(',')}">Show ${sorted.length - limit} more</button>`;
    return h;
  }
  function xrefAmb(groups) {
    return groups.map(g => `<div class="xr-amb">one of: ${g.map(x => `${U.st(IX.status(x))}${U.link(x, shortQ(IX.q(x)))}<span class="dim small xr-sig" data-id="${x}"></span>`).join(' <span class="dim">|</span> ')}</div>`).join('');
  }
  /** fills the parameter lists of overloads shown in call lists */
  async function fillXrefSigs(main) {
    const els = [...main.querySelectorAll('.xr-sig')];
    if (!els.length) return;
    const dm = await details([...new Set(els.map(e => +e.dataset.id))]);
    els.forEach(e => { const d = dm.get(+e.dataset.id) || {}; e.textContent = '(' + (d.params || []).map(p => p[0]).join(', ') + ')'; });
  }

  function binTable(bins) {
    let h = `<div class="note warn ver-note"><b>Super Mario Odyssey 1.0.0 only.</b> These offsets and addresses do not apply to 1.1, 1.2 or 1.3 — functions move between versions.</div>`;
    h += '<table class="t"><thead><tr><th>Status</th><th>Offset (main)</th><th>Absolute address</th><th>Ghidra address</th><th>Size</th><th>Object file</th><th>Mangled symbol(s)</th></tr></thead><tbody>';
    for (const b of bins) {
      const s = U.STATUS_CODE[b.st] || 4;
      h += `<tr><td class="nw">${U.pill(s)}${b.thunk ? ' <span class="tag">thunk</span>' : ''}${b.guess ? ' <span class="tag" title="Function boundary guessed by the tooling">guessed</span>' : ''}</td>
        <td class="num"><a href="#/search/${U.hex(b.off)}">${U.hex(b.off, 6)}</a> <button class="btn" data-copy="${U.hex(b.off)}" title="Copy">⧉</button></td>
        <td class="num">${U.hex(U.MAIN_BASE + b.off)}</td><td class="num">.text::${(U.GHIDRA_BASE + b.off).toString(16).padStart(8, '0')}</td>
        <td class="num">${U.num(b.sz)} B</td><td class="m">${objLink(b.obj)}</td>
        <td class="m small">${(b.lab || []).map(esc).join('<br>')}</td></tr>`;
    }
    return h + '</tbody></table>';
  }

  function objLink(obj) {
    const stem = U.objToStem(obj);
    const u = IX.unitByStem.get(stem);
    return u !== undefined ? `<a href="${IX.href(u)}">${esc(obj)}</a>` : esc(obj);
  }

  /** highlighted source excerpt */
  async function codeExcerpt(fi, from, to, opts = {}) {
    const txt = await sourceText(fi);
    const lines = txt.split('\n');
    const a = Math.max(1, from), b = Math.min(lines.length, to || from);
    const path = IX.files[fi][0];
    const head = `<div class="code-head"><span class="path">${esc(path)}:${a}${b > a ? '–' + b : ''}</span><span class="acts">
      <a class="btn" href="${U.fileHref(fi, a)}">View in file</a><a class="btn" target="_blank" rel="noopener" href="${U.githubUrl(path, a, b)}">GitHub ↗</a></span></div>`;
    return head + HL.block(lines.slice(a - 1, b).join('\n'), { start: a, fileIdx: fi, ctx: opts.ctx, maxHeight: opts.maxHeight });
  }

  function later(el, sel, promise) {
    promise.then(h => { const x = el.querySelector(sel); if (x) x.innerHTML = h; })
      .catch(e => { const x = el.querySelector(sel); if (x) x.innerHTML = `<div class="note warn">${esc(e.message)}</div>`; });
  }

  async function ghidraBlock(path, ctx, bundle) {
    const head = `<div class="code-head"><span class="path">${esc(path)}</span><span class="acts"><button class="btn" data-copy="${esc(path)}" title="Copy path">⧉</button></span></div>`;
    try {
      const t = await ghidraText(path, bundle);
      return head + HL.block(t, { ctx, maxHeight: '70vh' });
    } catch (e) {
      return head + `<div class="note warn">Pseudo-code not found in <code>data/gh/</code> (${esc(e.message)}).</div>`;
    }
  }

  // ================================================================ entity pages
  async function entity(i, main) {
    const k = IX.kind(i);
    const d = await detail(i);
    if (FN.has(k)) return funcPage(i, d, main);
    if (CLS.has(k)) return classPage(i, d, main);
    if (k === 'ns' || k === 'xns') return nsPage(i, d, main);
    if (k === 'enum') return enumPage(i, d, main);
    if (k === 'typedef' || k === 'alias') return typedefPage(i, d, main);
    if (k === 'var') return varPage(i, d, main);
    if (k === 'macro') return macroPage(i, d, main);
    if (k === 'unit') return unitPage(i, d, main);
    main.innerHTML = '<p>Unknown kind.</p>';
  }

  function locRows(i, d) {
    const rows = [];
    const u = IX.unit(i);
    if (d.decl) rows.push([d.decl.f.endsWith('.cpp') ? 'Declared in (.cpp)' : 'Header (.h)', U.fileLink(d.decl.f, d.decl.l, d.decl.fi) +
      ` <a class="small" target="_blank" rel="noopener" href="${U.githubUrl(d.decl.f, d.decl.l)}">GitHub ↗</a>`]);
    if (u !== null) rows.push(['Unit', U.link(u, IX.q(u))]);
    return rows;
  }

  // ---------------------------------------------------------------- function
  async function funcPage(i, d, main) {
    const k = IX.kind(i);
    const ctx = HL.ctxFromEntity(i);
    const st = IX.status(i);
    let h = crumbs(i) + title(i, k);
    h += `<div class="page-sub">${U.esc(U.KIND_LABEL[k])} ${st ? U.pill(st) : `<span class="pill">${U.STATUS_SHORT[0]}</span>`}
          ${d.binonly ? '<span class="pill warn" title="No declaration in the decomp headers: signature rebuilt from the binary symbol">Inferred from binary</span>' : ''}
          ${(d.bin || []).length ? hookPill(hookSafety((d.bin.find(b => !b.thunk) || d.bin[0])).near, 'Hook: ') : ''}
          ${['ghidra', 'unknown'].includes(d.rsrc) ? '<span class="pill bad" title="The return type is not confirmed by the decomp">⚠ Return type guessed</span>' : ''}
          ${flagTags(d.flags, d.acc)}</div>`;
    if (d.cm) h += `<div class="comment-doc">${esc(d.cm)}</div>`;
    h += signature(i, d);

    // ---- summary
    const rows = [];
    rows.push(['Nature', natureOf(i, d)]);
    rows.push(['Returns', retText(i, d) + (d.rsrc && d.rsrc !== 'na' ? `<div class="mt-s">${rsrcPill(d)}</div>` : '')]);
    const ps = d.params || [];
    if (k === 'sym') rows.push(['Arguments', '<span class="dim">Unknown (symbol without a C++ signature).</span>' + ((d.bin || [])[0]?.gh?.[0]?.[1] ? ` Ghidra signature: <code>${esc(d.bin[0].gh[0][1])}</code>` : '')]);
    else rows.push(['Arguments', ps.length ? `${ps.length} parameter${ps.length > 1 ? 's' : ''}${(d.flags || []).includes('variadic') ? ' + variadic' : ''} (details below)` :
      ((d.flags || []).includes('variadic') ? 'variadic (...)' : 'None')]);
    const p = IX.parent(i);
    if (p !== null && CLS.has(IX.kind(p)) && !((d.flags || []).includes('static')) && k !== 'sym')
      rows.push(['Implicit parameter', `<code>this</code>: <span class="type">${(d.flags || []).includes('const') ? 'const ' : ''}${U.link(p, IX.q(p))} *</span> <span class="dim">(register x0 on ARM64)</span>`]);
    if (d.acc) rows.push(['Access', `<code>${d.acc}</code>`]);
    if (d.decl) rows.push([d.decl.f.endsWith('.cpp') ? 'Declared in (.cpp)' : 'Declared in (.h)', U.fileLink(d.decl.f, d.decl.l, d.decl.fi)]);
    else rows.push(['Declared in (.h)', '<span class="dim">No header: the function is not declared in the decomp (yet).</span>']);
    if (d.def) rows.push(['Implemented in (.cpp)', U.fileLink(d.def.f, d.def.l, d.def.fi) + (d.def.f.endsWith('.h') ? ' <span class="dim">(inline in the header)</span>' : '')]);
    else {
      const obj = (d.bin || [])[0]?.obj;
      const cpp = obj ? U.objToCpp(obj) : null;
      rows.push(['Implemented in (.cpp)', (cpp ? `<code>${esc(cpp)}</code> <span class="dim">(expected file from the object — body not decompiled yet${IX.fileByPath.has(cpp) ? '' : ', file not created yet'})</span>`
        : '<span class="dim">No body in the decomp.</span>') + ((d.flags || []).includes('pure') ? ' <span class="dim">Pure virtual: no body.</span>' : '')]);
    }
    const u = IX.unit(i); if (u !== null) rows.push(['Unit / file', U.link(u, IX.q(u))]);
    if (d.mangled) rows.push(['Mangled symbol', `<code>${esc(d.mangled)}</code> <button class="btn" data-copy="${esc(d.mangled)}">⧉</button>`]);
    if (d.bin && d.bin.length) rows.push(['Offset (main)', d.bin.map(b => `<code>${U.hex(b.off)}</code>`).join(', ') + ' <span class="pill warn ver">SMO 1.0.0 only</span> <span class="dim">— offset for exlaunch <code>InstallAtOffset</code></span>']);
    else rows.push(['Binary', '<span class="dim">No matching symbol (inline function, uninstantiated template, or removed by the optimizer).</span>']);
    if (d.overrides) rows.push(['Overrides', d.overrides.map(x => U.link(x, IX.q(x))).join('<br>')]);
    const over = IX.fnByQ.get(IX.q(i))?.filter(x => x !== i) || [];
    if (over.length) rows.push(['Other overloads', over.map(x => U.link(x, IX.q(x) + (IX.slug(x).match(/~\d+$/)?.[0] || ''))).join('<br>')]);
    h += section('Summary', kv(rows));

    // ---- parameters
    if (ps.length) {
      let t = '<table class="t"><thead><tr><th>#</th><th>Type</th><th>Name</th><th>Default</th><th>Passing</th></tr></thead><tbody>';
      ps.forEach((x, j) => {
        const ty = x[0];
        const pass = /&&$/.test(ty) ? 'rvalue (move)' : /&$/.test(ty) ? (/^const /.test(ty) ? 'const reference (read-only)' : 'reference (mutable: possible out-parameter)')
          : /\*$/.test(ty) ? (/^const /.test(ty) ? 'pointer to const' : 'pointer') : 'by value';
        t += `<tr><td class="num">${j + 1}</td><td class="type">${HL.type(ty, x[3], ctx)}</td><td class="member-name">${esc(x[1] || '—')}</td><td class="m">${x[2] ? esc(x[2]) : '<span class="dim">—</span>'}</td><td class="small dim">${pass}</td></tr>`;
      });
      h += section('Parameters', t + '</tbody></table>', ps.length);
    }

    if (d.overby) {
      h += section('Overridden by', `<div class="entity-list">${d.overby.map(x => `<div>${U.st(IX.status(x))}${U.link(x, IX.q(x))}</div>`).join('')}</div>`, d.overby.length);
    }

    // ---- declaration & implementation
    if (d.decl) h += section('Declaration (' + esc(d.decl.f.split('.').pop()) + ')', '<div id="x-decl"><div class="dim">Loading…</div></div>');
    if (d.def && !(d.decl && d.def.f === d.decl.f && d.def.l === d.decl.l))
      h += section('Implementation (decompiled code)', '<div id="x-def"><div class="dim">Loading…</div></div>');
    else if (d.def) h += section('Implementation (decompiled code)', '<div class="note">Defined at the declaration (see above).</div>');

    const tpl = hookTemplate(i, d);
    if (tpl) h += section('Hook template (exlaunch)', `<div class="code-head"><span class="path">HOOK_DEFINE_TRAMPOLINE — paste into your exlaunch project</span><span class="acts"><button class="btn" data-copy-tpl="1">Copy</button></span></div><div id="x-tpl"></div>`);
    if (d.bin && d.bin.length) h += section('Hook safety', hookSection(i, d));
    if (d.bin && d.bin.length) {
      const ambNote = '<h3>Ambiguous</h3><p class="small dim">Several overloads have the same name and argument count; the pseudo-code does not say which one is called.</p>';
      h += section('Calls', (d.calls ? xrefList(d.calls) : '<span class="dim">No direct calls found.</span>') +
        (d.callsAmb ? ambNote + xrefAmb(d.callsAmb) : ''), (d.calls ? d.calls.length : 0) + (d.callsAmb ? ' + ' + d.callsAmb.length + ' ambiguous' : ''));
      h += section('Called by', (d.callers ? xrefList(d.callers) : '<span class="dim">No direct callers found (it may only be called virtually or through a function pointer).</span>') +
        (d.callersAmb ? '<h3>Maybe called by</h3><p class="small dim">These call an overload with the same name and argument count — possibly this one.</p>' + xrefList(d.callersAmb) : '') +
        '<p class="small dim">Built from the Ghidra pseudo-code (direct calls) plus nerve states (<code>…Nrv…::execute</code> → <code>exe…</code>). Virtual calls and function pointers are not listed.</p>',
        (d.callers ? d.callers.length : 0) + (d.callersAmb ? ' + ' + d.callersAmb.length + ' maybe' : ''));
    }
    if (d.bin && d.bin.length) h += section('Binary (Super Mario Odyssey 1.0.0)', binTable(d.bin), d.bin.length);
    const ghs = (d.bin || []).flatMap(b => (b.gh || []).map(g => g));
    if (ghs.length) {
      h += section('Ghidra pseudo-code', ghs.map((g, j) => `<div class="small dim" style="margin:4px 0 6px">Ghidra signature: <code>${esc(g[1] || '')}</code></div><div id="x-gh${j}"><div class="dim">Loading pseudo-code…</div></div>`).join(''), ghs.length);
    }
    main.innerHTML = h;
    if (tpl) {
      main.querySelector('#x-tpl').innerHTML = HL.block(tpl, { ctx });
      main.querySelector('[data-copy-tpl]').addEventListener('click', ev => { U.copy(tpl); ev.target.textContent = 'Copied ✓'; setTimeout(() => (ev.target.textContent = 'Copy'), 1200); });
    }
    main.querySelectorAll('.xr-more').forEach(btn => btn.addEventListener('click', () => {
      const ids = btn.dataset.ids.split(',').map(Number);
      btn.previousElementSibling.insertAdjacentHTML('beforeend', ids.map(x => `<div>${U.st(IX.status(x))}${U.link(x, shortQ(IX.q(x)))}</div>`).join(''));
      btn.remove();
    }));
    fillXrefSigs(main);
    if (d.decl && d.decl.fi !== undefined && d.decl.fi !== null) {
      const n = (d.decl.sig || '').split('\n').length;
      const s = d.decl.l - (d.decl.sig || '').split('\n').findIndex(x => x.includes(IX.name(i).replace(/^~/, ''))) ;
      later(main, '#x-decl', codeExcerpt(d.decl.fi, Math.min(s, d.decl.l), Math.min(s, d.decl.l) + n - 1, { ctx }));
    }
    if (d.def && d.def.fi !== undefined && d.def.fi !== null && !(d.decl && d.def.f === d.decl.f && d.def.l === d.decl.l)) {
      const n = (d.def.sig || '').split('\n');
      const off = Math.max(0, n.findIndex(x => x.includes(IX.name(i).replace(/^~/, ''))));
      later(main, '#x-def', codeExcerpt(d.def.fi, d.def.l - off, d.def.end || d.def.l, { ctx }));
    }
    ghs.forEach((g, j) => later(main, '#x-gh' + j, ghidraBlock(g[0], ctx, IX.E[i][5])));
  }

  // ---------------------------------------------------------------- class
  async function classPage(i, d, main) {
    const k = IX.kind(i);
    const kids = IX.children(i);
    const dm = await details(kids);
    const ctx = HL.ctxFromEntity(i);
    const c = IX.memberStatus(i);
    let h = crumbs(i) + title(i, k);
    h += `<div class="page-sub">${U.KIND_LABEL[k]}${d.tp && d.tp.length ? ` <code>template&lt;${esc(d.tp.join(', '))}&gt;</code>` : ''}
      ${d.inferred ? '<span class="pill warn" title="No declaration in the headers: inferred from binary symbols">Inferred from binary</span>' : ''}
      ${d.complete === false ? '<span class="pill">forward declaration only</span>' : ''} ${flagTags([], d.acc)}</div>`;
    if (d.cm) h += `<div class="comment-doc">${esc(d.cm)}</div>`;
    if (d.decl && d.decl.sig) h += `<div class="sig">${HL.lines(d.decl.sig, ctx).join('\n')}</div>`;

    const meths = kids.filter(x => FN.has(IX.kind(x)));
    const rows = [];
    const p = IX.parent(i);
    rows.push(['Namespace / parent', p !== null ? U.link(p, IX.q(p)) : 'global namespace']);
    if (d.decl) rows.push(['Header (.h)', U.fileLink(d.decl.f, d.decl.l, d.decl.fi) + (d.decl.end ? ` <span class="dim">(lines ${d.decl.l}–${d.decl.end})</span>` : '')]);
    else rows.push(['Header (.h)', '<span class="dim">None: class not declared in the decomp yet.</span>']);
    const cpps = new Set(); const objs = new Set();
    let inl = 0;
    for (const x of meths) { const dd = dm.get(x); if (dd.def) { if (dd.def.f.endsWith('.cpp')) cpps.add(dd.def.f); else inl++; } for (const b of dd.bin || []) objs.add(b.obj); }
    rows.push(['.cpp file(s)', (cpps.size ? [...cpps].map(f => U.fileLink(f)).join('<br>') : '<span class="dim">No method implemented in a decomp .cpp' + (objs.size ? ` (expected: <code>${esc([...objs].map(U.objToCpp).filter(Boolean).join(', '))}</code>)` : '') + '.</span>') + (inl ? `<div class="small dim">${inl} method(s) defined inline in the header.</div>` : '')]);
    if (objs.size) rows.push(['Binary object(s)', [...objs].map(objLink).join('<br>')]);
    if (d.size) rows.push(['Size', `<code>${U.hex(d.size)}</code> (${d.size} bytes)${d.align ? `, alignment ${d.align}` : ''}`]);
    rows.push(['Methods', `${meths.length} (${meths.filter(x => IX.isBinOnly(x)).length} known only from the binary)`]);
    if (d.fields) rows.push(['Fields', d.fields.length]);
    if (d.factory) rows.push(['Factory name(s)', d.factory.map(f => `<code>${esc(f[1])}</code> <span class="dim">via ${esc(f[0])}</span>`).join('<br>')]);
    if (d.nerves) rows.push(['States (nerves)', d.nerves.length]);
    rows.push(['Progress', progressBar(c)]);
    h += section('Summary', kv(rows));

    // ---- inheritance
    const bases = d.bases || [];
    const derived = d.derived || [];
    let inh = '';
    if (bases.length) {
      inh += '<h3>Base classes</h3><table class="t"><tbody>' + bases.map(b => `<tr><td class="type">${b[3] !== null && b[3] !== undefined ? U.link(b[3], b[0]) : HL.type(b[0], null, ctx)}</td><td class="small">${b[1]}${b[2] ? ' virtual' : ''}</td></tr>`).join('') + '</tbody></table>';
      inh += '<h3>Full inheritance chain</h3><div class="inherit">' + ancestorsTree(i) + '</div>';
    }
    if (derived.length) inh += `<h3>Direct derived classes (${derived.length})</h3><div class="entity-list">${derived.map(x => `<div>${U.kb(IX.kind(x))}${U.link(x, IX.q(x))}</div>`).join('')}</div>`;
    const allDer = descendants(i);
    if (allDer.length > derived.length) inh += `<p class="small dim">${allDer.length} derived classes in total (all generations). <a href="#/hierarchy/${encodeURIComponent(IX.slug(i))}">View the tree</a></p>`;
    if (inh) h += section('Inheritance', inh);

    // ---- fields
    if (d.fields && d.fields.length) {
      let t = '<table class="t"><thead><tr><th>Offset</th><th>Size</th><th>Type</th><th>Name</th><th>Access</th></tr></thead><tbody>';
      for (const f of d.fields) {
        t += `<tr id="f-${esc(f.n)}"><td class="num">${f.off !== null && f.off !== undefined ? U.hex(f.off) : '?'}</td><td class="num">${f.sz ?? ''}${f.bits ? ` (${f.bits} bits)` : ''}</td>
          <td class="type">${HL.type(f.t, f.ti, ctx)}</td><td class="member-name">${esc(f.n)}${f.cm ? `<div class="small dim">${esc(f.cm)}</div>` : ''}</td><td class="small">${f.acc || ''}</td></tr>`;
      }
      h += section('Fields (memory layout)', t + '</tbody></table>', d.fields.length, 'fields');
    }

    // ---- methods
    if (meths.length) {
      const groups = [
        ['Constructors & destructors', x => ['ctor', 'dtor'].includes(IX.kind(x))],
        ['Public methods', x => (dm.get(x).acc || 'public') === 'public' && !(dm.get(x).flags || []).includes('static')],
        ['Static methods', x => (dm.get(x).flags || []).includes('static')],
        ['Protected methods', x => dm.get(x).acc === 'protected'],
        ['Private methods', x => dm.get(x).acc === 'private'],
      ];
      const used = new Set();
      let body = `<div class="toolbar"><input type="text" id="mfilter" placeholder="Filter methods…"><label><input type="checkbox" id="mhide"> hide non-decompiled</label><label><input type="checkbox" id="mvirt"> virtual only</label></div><div id="mlist">`;
      for (const [g, f] of groups) {
        const ids = meths.filter(x => !used.has(x) && f(x));
        ids.forEach(x => used.add(x));
        if (!ids.length) continue;
        ids.sort((a, b) => ((dm.get(a).decl || {}).l || 1e9) - ((dm.get(b).decl || {}).l || 1e9) || (dm.get(a).bin?.[0]?.off || 0) - (dm.get(b).bin?.[0]?.off || 0));
        body += `<h3>${g} <span class="dim">(${ids.length})</span></h3>` + methodTable(ids, dm, ctx);
      }
      h += section('Methods', body + '</div>', meths.length, 'methods');
    }
    if (bases.length) h += section('Inherited members', `<div id="x-inherited">${ancestors(i).map(a => `<details data-id="${a}"><summary>${U.kb(IX.kind(a))} From ${U.link(a, IX.q(a))} <span class="dim">(${IX.children(a).filter(x => FN.has(IX.kind(x))).length} methods)</span></summary><div class="dim">…</div></details>`).join('')}</div>`);

    // ---- nerves
    if (d.nerves && d.nerves.length) {
      let t = '<table class="t"><thead><tr><th>State</th><th>Executed function</th><th>End</th><th>Macro</th><th>Source</th></tr></thead><tbody>';
      for (const n of d.nerves) {
        const exe = meths.find(x => IX.name(x) === n.exe);
        const end = n.end ? meths.find(x => IX.name(x) === n.end) : null;
        t += `<tr><td class="member-name">${esc(n.n)}</td><td class="m">${exe !== undefined ? U.link(exe, n.exe) : esc(n.exe)}</td><td class="m">${n.end ? (end ? U.link(end, n.end) : esc(n.end)) : ''}</td><td class="m small">${esc(n.m)}</td><td class="m small">${U.fileLink(n.f, n.l)}</td></tr>`;
      }
      h += section('State machine states (nerves)', `<p class="small dim">Each nerve calls <code>exe&lt;State&gt;()</code> every frame while the actor is in that state (<code>al::setNerve</code>).</p>` + t + '</tbody></table>', d.nerves.length);
    }

    // ---- nested types and other members
    const others = kids.filter(x => !FN.has(IX.kind(x)));
    if (others.length) {
      h += section('Nested types and members', `<div class="entity-list">${others.map(x => `<div>${U.kb(IX.kind(x))}${U.link(x)}</div>`).join('')}</div>`, others.length);
    }
    if (d.friends) h += section('Friends', d.friends.map(f => `<div class="sig" style="margin-bottom:8px">${HL.lines(f, ctx).join('\n')}</div>`).join(''), d.friends.length);
    if (d.decl && d.decl.fi !== undefined && d.decl.fi !== null && d.decl.end)
      h += section('Class definition (header)', '<div id="x-src"><div class="dim">Loading…</div></div>');
    if (d.fwd) h += section('Forward declarations', `<details><summary>${d.fwd.length} file(s) forward-declare <code>${esc(IX.name(i))}</code></summary>${d.fwd.map(f => `<div>${U.fileLink(f[0], f[1])}</div>`).join('')}</details>`);

    main.innerHTML = h;
    if (d.decl && d.decl.end && d.decl.fi !== undefined && d.decl.fi !== null) later(main, '#x-src', codeExcerpt(d.decl.fi, d.decl.l, d.decl.end, { ctx, maxHeight: '60vh' }));
    wireMethodFilter(main);
    main.querySelectorAll('#x-inherited details').forEach(det => det.addEventListener('toggle', async () => {
      if (!det.open || det._done) return; det._done = true;
      const a = +det.dataset.id;
      const ms = IX.children(a).filter(x => FN.has(IX.kind(x)));
      const dd = await details(ms);
      det.querySelector('div').outerHTML = methodTable(ms, dd, HL.ctxFromEntity(a));
    }));
  }

  function methodTable(ids, dm, ctx) {
    let t = '<table class="t mtable"><thead><tr><th></th><th>Return</th><th>Method</th><th>Qualifiers</th><th>Offset</th><th>Implementation</th></tr></thead><tbody>';
    for (const x of ids) {
      const dd = dm.get(x) || {};
      const fl = dd.flags || [];
      const st = IX.status(x);
      const ret = ['ctor', 'dtor'].includes(IX.kind(x)) ? '' : (dd.ret ? HL.type(dd.ret, dd.ret_id, ctx) : (dd.gret ? `<span class="dim" title="Ghidra estimate">${esc(dd.gret)}?</span>` : ''));
      const sig = `${U.link(x)}<span class="dim">(${paramsText(dd)})</span>${['ghidra', 'unknown'].includes(dd.rsrc) ? ' <span class="tag priv" title="Return type guessed (not in the decomp)">ret?</span>' : ''}${dd.bin && dd.bin.length && hookSafety(dd.bin.find(b => !b.thunk) || dd.bin[0]).near === 'bad' ? ' <span class="tag priv" title="Unsafe to hook with a trampoline">no hook</span>' : ''}`;
      const off = dd.bin && dd.bin.length ? `<code>${U.hex(dd.bin[0].off)}</code>` : '<span class="dim">—</span>';
      const impl = dd.def ? U.fileLink(dd.def.f, dd.def.l, dd.def.fi).replace(/>([^<]*)</, (m, s) => '>' + esc(s.split('/').pop()) + '<') : (dd.binonly ? '<span class="dim">binary only</span>' : (fl.includes('pure') ? '<span class="dim">= 0</span>' : '<span class="dim">—</span>'));
      t += `<tr data-n="${esc(IX.nameL[x])}" data-st="${st}" data-v="${fl.includes('virtual') || fl.includes('override') ? 1 : 0}"><td>${U.st(st)}</td><td class="type">${ret}</td><td class="m">${sig}</td><td class="tags">${flagTags(fl.includes('override') ? fl.filter(f => f !== 'virtual') : fl)}</td><td class="num">${off}</td><td class="small">${impl}</td></tr>`;
    }
    return t + '</tbody></table>';
  }

  function wireMethodFilter(main) {
    const f = main.querySelector('#mfilter');
    if (!f) return;
    const hide = main.querySelector('#mhide'), virt = main.querySelector('#mvirt');
    const apply = () => {
      const q = f.value.trim().toLowerCase();
      main.querySelectorAll('#mlist tr[data-n]').forEach(tr => {
        const ok = (!q || tr.dataset.n.includes(q)) && (!hide.checked || tr.dataset.st !== '4') && (!virt.checked || tr.dataset.v === '1');
        tr.classList.toggle('hidden', !ok);
      });
    };
    f.addEventListener('input', apply); hide.addEventListener('change', apply); virt.addEventListener('change', apply);
  }

  function ancestors(i) {
    const out = []; const seen = new Set([i]); const q = [...(IX.bases.get(i) || [])];
    while (q.length) { const x = q.shift(); if (seen.has(x)) continue; seen.add(x); out.push(x); q.push(...(IX.bases.get(x) || [])); }
    return out;
  }
  function descendants(i) {
    const out = []; const seen = new Set([i]); const q = [...(IX.derived.get(i) || [])];
    while (q.length) { const x = q.shift(); if (seen.has(x)) continue; seen.add(x); out.push(x); q.push(...(IX.derived.get(x) || [])); }
    return out;
  }
  function ancestorsTree(i) {
    // from the class up to its roots: inverted base tree
    const rec = (x, depth) => {
      const bs = IX.bases.get(x) || [];
      let h = `<li>${x === i ? `<span class="self">${esc(IX.q(x))}</span>` : `${U.kb(IX.kind(x))} ${U.link(x, IX.q(x))}`}`;
      if (bs.length && depth < 12) h += '<ul>' + bs.map(b => rec(b, depth + 1)).join('') + '</ul>';
      return h + '</li>';
    };
    return '<ul>' + rec(i, 0) + '</ul>';
  }

  // ---------------------------------------------------------------- namespace
  async function nsPage(i, d, main) {
    const k = IX.kind(i);
    const kids = IX.children(i);
    const groups = [
      ['Namespaces', ['ns', 'xns']], ['Classes & structs', ['class', 'struct', 'union', 'tclass', 'xclass']],
      ['Enums', ['enum']], ['Typedefs & aliases', ['typedef', 'alias']],
      ['Functions', ['func', 'tfunc', 'sym', 'method', 'ctor', 'dtor', 'tmethod', 'conv']], ['Variables', ['var']],
    ];
    let h = crumbs(i) + title(i, k);
    h += `<div class="page-sub">${U.KIND_LABEL[k]}${d.inferred ? ' <span class="pill warn">Inferred from binary</span>' : ''}</div>`;
    const rows = [['Contents', groups.map(([g, ks]) => { const n = kids.filter(x => ks.includes(IX.kind(x))).length; return n ? `${n} ${g.toLowerCase()}` : ''; }).filter(Boolean).join(' · ')]];
    rows.push(['Progress (direct functions)', progressBar(IX.memberStatus(i))]);
    if (d.files) rows.push([`Opened in ${d.files.length} file(s)`, `<details><summary>show list</summary>${d.files.map(f => `<div>${U.fileLink(f)}</div>`).join('')}</details>`]);
    h += section('Summary', kv(rows));
    for (const [g, ks] of groups) {
      const ids = kids.filter(x => ks.includes(IX.kind(x))).sort((a, b) => IX.nameL[a].localeCompare(IX.nameL[b]));
      if (!ids.length) continue;
      if (g === 'Functions') {
        h += section(g, `<div class="toolbar"><input type="text" class="lfilter" placeholder="Filter…"></div><div class="plist" data-g="f"></div>`, ids.length);
      } else {
        h += section(g, `<div class="entity-list">${ids.map(x => `<div>${U.kb(IX.kind(x))}${IX.status(x) ? U.st(IX.status(x)) : ''}${U.link(x)}</div>`).join('')}</div>`, ids.length);
      }
    }
    main.innerHTML = h;
    const fl = main.querySelector('.plist[data-g="f"]');
    if (fl) {
      const ids = kids.filter(x => FN.has(IX.kind(x))).sort((a, b) => IX.nameL[a].localeCompare(IX.nameL[b]));
      paged(fl, ids, main.querySelector('.lfilter'), async (slice) => {
        const dm = await details(slice);
        return methodTable(slice, dm, HL.ctxFromEntity(i));
      }, 300);
    }
  }

  // ---------------------------------------------------------------- enum / typedef / var / macro
  async function enumPage(i, d, main) {
    const ctx = HL.ctxFromEntity(i);
    let h = crumbs(i) + title(i, 'enum');
    h += `<div class="page-sub">Enum ${d.scoped ? '<span class="tag">enum class (scoped)</span>' : '<span class="tag">plain enum</span>'} ${flagTags([], d.acc)}</div>`;
    if (d.cm) h += `<div class="comment-doc">${esc(d.cm)}</div>`;
    const rows = locRows(i, d);
    rows.unshift(['Underlying type', `<span class="type">${HL.type(d.underlying || 'int', null, ctx)}</span>`]);
    rows.push(['Value count', (d.values || []).length]);
    const p = IX.parent(i); if (p !== null) rows.unshift(['Defined in', U.link(p, IX.q(p))]);
    h += section('Summary', kv(rows));
    if (d.values) {
      let t = '<table class="t"><thead><tr><th>Name</th><th>Value</th><th>Hex</th><th>Expression</th><th>Line</th></tr></thead><tbody>';
      for (const v of d.values) t += `<tr><td class="member-name">${esc(v.n)}${v.cm ? `<div class="small dim">${esc(v.cm)}</div>` : ''}</td><td class="num">${v.v}</td><td class="num">${v.v < 0 ? '' : U.hex(v.v)}</td><td class="m small">${v.x ? esc(v.x) : ''}</td><td class="num">${v.l}</td></tr>`;
      h += section('Values', t + '</tbody></table>', d.values.length);
    }
    h += section('Source', '<div id="x-src"></div>');
    main.innerHTML = h;
    if (d.decl && d.decl.fi !== undefined && d.decl.fi !== null) {
      const last = d.values && d.values.length ? d.values[d.values.length - 1].l + 1 : d.decl.l;
      later(main, '#x-src', codeExcerpt(d.decl.fi, d.decl.l, last, { ctx }));
    }
  }

  async function typedefPage(i, d, main) {
    const k = IX.kind(i);
    const ctx = HL.ctxFromEntity(i);
    let h = crumbs(i) + title(i, k) + `<div class="page-sub">${U.KIND_LABEL[k]} ${flagTags([], d.acc)}</div>`;
    if (d.cm) h += `<div class="comment-doc">${esc(d.cm)}</div>`;
    if (d.decl) h += `<div class="sig">${HL.lines(d.decl.sig, ctx).join('\n')}</div>`;
    const rows = [['Actual type', `<span class="type">${HL.type(d.underlying || '', d.under_id, ctx)}</span>`]];
    if (d.tp) rows.push(['Template parameters', `<code>${esc(d.tp.join(', '))}</code>`]);
    const p = IX.parent(i); if (p !== null) rows.push(['Defined in', U.link(p, IX.q(p))]);
    h += section('Summary', kv(rows.concat(locRows(i, d))));
    main.innerHTML = h;
  }

  async function varPage(i, d, main) {
    const ctx = HL.ctxFromEntity(i);
    let h = crumbs(i) + title(i, 'var') + `<div class="page-sub">Variable ${flagTags(d.flags, d.acc)}</div>`;
    if (d.cm) h += `<div class="comment-doc">${esc(d.cm)}</div>`;
    if (d.decl) h += `<div class="sig">${HL.lines(d.decl.sig, ctx).join('\n')}</div>`;
    const rows = [['Type', `<span class="type">${HL.type(d.type || '', d.type_id, ctx)}</span>`]];
    const p = IX.parent(i);
    rows.push(['Scope', p !== null ? (CLS.has(IX.kind(p)) ? `Static member of ${U.link(p, IX.q(p))}` : `Namespace ${U.link(p, IX.q(p))}`) : 'Global']);
    if (d.mangled) rows.push(['Symbol', `<code>${esc(d.mangled)}</code>`]);
    rows.push(['Address (data)', '<span id="x-addr" class="dim">looking up…</span>']);
    if (d.def) rows.push(['Defined in', U.fileLink(d.def.f, d.def.l, d.def.fi)]);
    h += section('Summary', kv(rows.concat(locRows(i, d))));
    main.innerHTML = h;
    DOC.load('symbols').then(sy => {
      const s = d.mangled ? sy.find(x => x[1] === d.mangled) : null;
      const el = main.querySelector('#x-addr');
      if (el) el.innerHTML = s ? `<code>${esc(s[0])}</code> (offset ${U.hex(parseInt(s[0], 16) - U.MAIN_BASE)})` : 'not listed in data_symbols.csv';
    });
  }

  async function macroPage(i, d, main) {
    let h = crumbs(i) + title(i, 'macro') + '<div class="page-sub">Preprocessor macro</div>';
    h += section('Summary', kv(locRows(i, d)));
    h += section('Definition', '<div id="x-src"></div>');
    main.innerHTML = h;
    if (d.decl && d.decl.fi !== undefined && d.decl.fi !== null) {
      const n = (d.decl.sig || '').split('\n').length;
      later(main, '#x-src', codeExcerpt(d.decl.fi, d.decl.l, d.decl.l + n - 1));
    }
  }

  // ---------------------------------------------------------------- unit (file)
  async function unitPage(i, d, main) {
    const stem = IX.q(i);
    const parts = stem.split('/');
    let h = `<div class="crumbs"><a href="#/">Home</a><span class="sep">›</span><a href="#/files">Files</a>${parts.slice(0, -1).map((p, k) => `<span class="sep">›</span><a href="#/files/${encodeURIComponent(parts.slice(0, k + 1).join('/'))}">${esc(p)}</a>`).join('')}</div>`;
    h += `<div class="page-head">${U.kb('unit')}<h1 class="page-title"><span class="ns-prefix">${esc(parts.slice(0, -1).join('/'))}/</span>${esc(parts.at(-1))}</h1></div>`;
    h += `<div class="page-sub">Compilation unit (header + source + binary object)</div>`;
    const ust = d.ust || {};
    const c = [0, ust.Matching || 0, ust.NonMatchingMinor || 0, ust.NonMatchingMajor || 0, ust.NotDecompiled || 0];
    const ub = d.ubytes || {};
    const rows = [];
    rows.push(['Files', (d.ufiles || []).map(f => U.fileLink(f[0], null, f[1]) + ` <a class="small" target="_blank" rel="noopener" href="${U.githubUrl(f[0])}">GitHub ↗</a>`).join('<br>') || '<span class="dim">No source file in the decomp (unit known only from the binary).</span>']);
    if (d.objs) rows.push(['Binary object(s)', d.objs.map(o => `<code>${esc(o)}</code>`).join(', ')]);
    rows.push(['Progress', progressBar(c) + (Object.keys(ub).length ? `<div class="small dim mt">By bytes: ${U.pct((ub.Matching || 0) + (ub.NonMatchingMinor || 0) + (ub.NonMatchingMajor || 0), Object.values(ub).reduce((a, b) => a + b, 0))} decompiled out of ${U.num(Object.values(ub).reduce((a, b) => a + b, 0))} bytes of code</div>` : '')]);
    h += section('Summary', kv(rows));
    const decl = (d.udecl || []);
    const isAnon = p => p !== null && IX.slug(p).startsWith('(anonymous@') && !IX.slug(p).includes('::');
    const top = decl.filter(x => { const p = IX.parent(x); return (p === null || !decl.includes(p)) && !isAnon(p); });
    const anon = decl.filter(x => isAnon(IX.parent(x)));
    if (top.length) h += section('Declared in this unit', entityTable(top), top.length);
    if (anon.length) h += section('Anonymous namespace (internal to the .cpp)', `<p class="small dim">Nerve structs (<code>…Nrv…</code>), helper functions and file-local constants.</p><details><summary>Show the ${anon.length} items</summary>${entityTable(anon)}</details>`, anon.length);
    if (d.udefs && d.udefs.length) h += section('Implemented here (declared elsewhere)', entityTable(d.udefs), d.udefs.length);
    if (d.ufactory) h += section('Factory table', `<table class="t"><thead><tr><th>Name (stage files)</th><th>Class</th><th>Line</th></tr></thead><tbody>${d.ufactory.map(f => `<tr><td class="m">${esc(f[0])}</td><td class="m">${f[1] ? (IX.typeByQ.has(f[1]) ? U.link(IX.typeByQ.get(f[1]), f[1]) : esc(f[1])) : '<span class="dim">nullptr (not decompiled)</span>'}</td><td class="num">${f[2]}</td></tr>`).join('')}</tbody></table>`, d.ufactory.length);
    if (d.ufiles && d.ufiles.length) {
      h += section('Source code', `<div class="tabs">${d.ufiles.map((f, k) => `<button data-k="${k}" class="${k ? '' : 'on'}">${esc(f[0].split('/').pop())}</button>`).join('')}</div><div class="tabpanes">${d.ufiles.map((f, k) => `<div data-k="${k}" class="${k ? '' : 'on'}"><div class="dim">Loading…</div></div>`).join('')}</div>`);
    }
    main.innerHTML = h;
    const loadPane = async k => {
      const pane = main.querySelector(`.tabpanes > div[data-k="${k}"]`);
      if (!pane || pane._done) return; pane._done = true;
      const f = d.ufiles[k];
      const t = await sourceText(f[1]);
      pane.innerHTML = `<div class="code-head"><span class="path">${esc(f[0])}</span><span class="acts"><a class="btn" href="${U.fileHref(f[1])}">Full screen</a><a class="btn" target="_blank" rel="noopener" href="${U.githubUrl(f[0])}">GitHub ↗</a></span></div>` + HL.block(t, { fileIdx: f[1], ctx: HL.ctxFromText(t), maxHeight: '75vh' });
    };
    main.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
      main.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
      main.querySelectorAll('.tabpanes > div').forEach(x => x.classList.toggle('on', x.dataset.k === b.dataset.k));
      loadPane(b.dataset.k);
    }));
    if (d.ufiles && d.ufiles.length) loadPane(0);
  }

  function entityTable(ids) {
    const sorted = ids.slice().sort((a, b) => (IX.kind(a) > IX.kind(b) ? 1 : -1) || IX.nameL[a].localeCompare(IX.nameL[b]));
    return `<table class="t"><thead><tr><th></th><th>Name</th><th>Kind</th><th>Status</th></tr></thead><tbody>${sorted.map(x => {
      const k = IX.kind(x); const s = CLS.has(k) ? IX.memberStatus(x) : null;
      return `<tr><td>${U.kb(k)}</td><td class="m">${U.link(x, IX.q(x))}</td><td class="small">${U.KIND_LABEL[k]}</td><td class="small">${s ? `${s[1] + s[2] + s[3]}/${s[1] + s[2] + s[3] + s[4]} functions decompiled` : (IX.status(x) ? U.pill(IX.status(x)) : '')}</td></tr>`;
    }).join('')}</tbody></table>`;
  }

  // ---------------------------------------------------------------- raw source file
  async function srcPage(fi, line, main) {
    const f = IX.files[fi];
    if (!f) { main.innerHTML = '<p>File not found.</p>'; return; }
    const [path, mod, n] = f;
    const stem = path.replace(/\.[^.\/]+$/, '');
    const u = IX.unitByStem.get(stem);
    let h = `<div class="crumbs"><a href="#/">Home</a><span class="sep">›</span><a href="#/files">Files</a>${u !== undefined ? `<span class="sep">›</span>${U.link(u, stem)}` : ''}</div>`;
    h += `<div class="page-head">${U.kb('unit')}<h1 class="page-title">${esc(path)}</h1></div>`;
    h += `<div class="page-sub"><span class="pill">${esc(U.MODULE_LABEL[mod] || mod)}</span><span class="pill">${n} lines</span><a class="btn" target="_blank" rel="noopener" href="${U.githubUrl(path, line)}">Open on GitHub ↗</a></div>`;
    h += '<div id="x-src"><div class="dim">Loading…</div></div>';
    main.innerHTML = h;
    const t = await sourceText(fi);
    main.querySelector('#x-src').innerHTML = HL.block(t, { fileIdx: fi, anchors: true, hl: line ? [line, line] : null, ctx: HL.ctxFromText(t) }).replace('class="code"', 'class="code" style="max-height:none"');
    if (line) { const r = main.querySelector('#L' + line); if (r) r.scrollIntoView({ block: 'center' }); }
  }

  // ================================================================ special pages
  function paged(container, items, filterInput, renderSlice, per = 500) {
    let page = 0, list = items;
    const draw = async () => {
      const total = list.length, pages = Math.max(1, Math.ceil(total / per));
      page = Math.min(page, pages - 1);
      const slice = list.slice(page * per, page * per + per);
      const nav = `<div class="pager"><button class="btn" data-a="prev" ${page ? '' : 'disabled'}>‹ Prev</button><span>Page ${page + 1} / ${pages} — ${U.num(total)} item(s)</span><button class="btn" data-a="next" ${page < pages - 1 ? '' : 'disabled'}>Next ›</button></div>`;
      container.innerHTML = nav + '<div class="dim">Loading…</div>';
      const body = await renderSlice(slice, page * per);
      container.innerHTML = nav + body + (pages > 1 ? nav : '');
      container.querySelectorAll('.pager button').forEach(b => b.addEventListener('click', () => { page += b.dataset.a === 'next' ? 1 : -1; draw(); container.scrollIntoView(); }));
    };
    if (filterInput) filterInput.addEventListener('input', U.debounce(() => {
      const q = filterInput.value.trim().toLowerCase();
      list = q ? items.filter(x => (typeof x === 'number' ? IX.qL[x] : String(x).toLowerCase()).includes(q) || (Array.isArray(x) && x.join(' ').toLowerCase().includes(q))) : items;
      page = 0; draw();
    }, 150));
    draw();
  }

  function listPage(main, titleTxt, kinds, intro = '', opts = {}) {
    const ks = new Set(kinds);
    const ids = [];
    for (let i = 0; i < IX.E.length; i++) if (ks.has(IX.kind(i))) ids.push(i);
    ids.sort((a, b) => IX.nameL[a].localeCompare(IX.nameL[b]) || IX.qL[a].localeCompare(IX.qL[b]));
    main.innerHTML = `<div class="crumbs"><a href="#/">Home</a></div><h1 class="page-title">${titleTxt}</h1><p class="lead">${intro}</p>
      <div class="toolbar"><input type="text" class="lfilter" placeholder="Filter (qualified name)…" style="min-width:320px">
      ${opts.binToggle ? '<label><input type="checkbox" class="hidebin"> hide entities inferred from the binary</label>' : ''}</div><div class="plist"></div>`;
    const cont = main.querySelector('.plist');
    const render = async (slice) => {
      if (opts.methods) { const dm = await details(slice); return methodTableFull(slice, dm); }
      return `<div class="entity-list">${slice.map(x => `<div>${U.kb(IX.kind(x))}${IX.status(x) ? U.st(IX.status(x)) : ''}${U.link(x, IX.q(x))}</div>`).join('')}</div>`;
    };
    let base = ids;
    const fi = main.querySelector('.lfilter');
    const hb = main.querySelector('.hidebin');
    if (hb) hb.addEventListener('change', () => { base = hb.checked ? ids.filter(x => !IX.isBinOnly(x)) : ids; cont.innerHTML = ''; paged(cont, base, null, render, opts.per || 1500); fi.value = ''; });
    paged(cont, base, fi, render, opts.per || 1500);
  }

  function methodTableFull(ids, dm) {
    let t = '<table class="t"><thead><tr><th></th><th>Return</th><th>Function</th><th>Offset</th><th>Implementation</th></tr></thead><tbody>';
    for (const x of ids) {
      const dd = dm.get(x) || {};
      const ret = dd.ret ? HL.type(dd.ret, dd.ret_id) : (dd.gret ? `<span class="dim">${esc(dd.gret)}?</span>` : '');
      t += `<tr><td class="nw">${U.kb(IX.kind(x))} ${U.st(IX.status(x))}</td><td class="type">${ret}</td><td class="m">${U.link(x, IX.q(x))}<span class="dim">(${paramsText(dd, false)})</span></td><td class="num">${dd.bin?.length ? U.hex(dd.bin[0].off) : '—'}</td><td class="small">${dd.def ? U.fileLink(dd.def.f, dd.def.l, dd.def.fi) : ''}</td></tr>`;
    }
    return t + '</tbody></table>';
  }

  function home(main) {
    const m = IX.meta, s = m.stats, b = m.bytes, kc = m.kinds;
    const tot = m.nbin;
    const c = [0, s.Matching || 0, s.NonMatchingMinor || 0, s.NonMatchingMajor || 0, s.NotDecompiled || 0];
    const btot = Object.values(b).reduce((x, y) => x + y, 0);
    const card = (n, l, h) => `<a class="card" href="${h}"><div class="big">${U.num(n)}</div><div class="lbl">${l}</div></a>`;
    const ncls = (kc.class || 0) + (kc.struct || 0) + (kc.union || 0) + (kc.tclass || 0);
    const nfn = ['func', 'method', 'ctor', 'dtor', 'conv', 'tfunc', 'tmethod', 'sym'].reduce((a, k) => a + (kc[k] || 0), 0);
    main.innerHTML = `<div class="home-hero"><h1>Super Mario Odyssey code documentation</h1>
      <p>Complete reference generated from the decompilation <a target="_blank" rel="noopener" href="https://github.com/${m.decomp_repo}">${esc(m.decomp_repo)}</a>
      (commit <code>${m.decomp_rev.slice(0, 10)}</code>), the list of the ${U.num(tot)} functions in the binary (<code>data/file_list.yml</code>)
      and the Ghidra pseudo-code from <a target="_blank" rel="noopener" href="https://github.com/${m.ghidra_repo}">${esc(m.ghidra_repo)}</a>.
      Every class, function, method, enum, typedef, variable, macro and file has its own page.</p>
      <p class="small dim">Tip: <span class="kbd">Ctrl</span>+<span class="kbd">K</span> or <span class="kbd">/</span> to search. You can also search an address: <code>0x1ccff4</code>, <code>0x71001ccff4</code> or <code>.text::002ccff4</code>.</p></div>
      <div class="note warn ver-note"><b>All offsets and addresses on this site are for Super Mario Odyssey 1.0.0.</b> Functions move between versions, so they do not work on 1.1, 1.2 or 1.3.</div>
      <div class="cards">
        ${card(ncls, 'declared classes / structs', '#/classes')}
        ${card(kc.xclass || 0, 'classes inferred from binary', '#/classes')}
        ${card(nfn, 'functions & methods', '#/functions')}
        ${card((kc.ns || 0) + (kc.xns || 0), 'namespaces', '#/namespaces')}
        ${card(kc.enum || 0, 'enums', '#/enums')}
        ${card((kc.typedef || 0) + (kc.alias || 0), 'typedefs & aliases', '#/typedefs')}
        ${card(kc.var || 0, 'variables', '#/vars')}
        ${card(IX.files.length, 'source files', '#/files')}
      </div>
      ${section('Decompilation progress', progressBar(c) + `<p class="small dim mt">By bytes of code: ${U.pct((b.Matching || 0) + (b.NonMatchingMinor || 0) + (b.NonMatchingMajor || 0), btot)} decompiled (${U.num(btot)} bytes in total). <a href="#/progress">Per-folder details →</a></p>`)}
      ${section('Where to start', `<div class="grid2"><div>${kv([
        ['Base actor', quick('al::LiveActor')], ['Player', quick('PlayerActorHakoniwa')], ['Power Moon', quick('Shine')],
        ['Game scene', quick('StageScene')], ['Nerves', quick('al::Nerve')], ['Save data', quick('GameDataFile')],
      ])}</div><div>${kv([
        ['Actor factory', '<a href="#/factories">stage-file names → classes</a>'],
        ['Hierarchy', '<a href="#/hierarchy">full inheritance tree</a>'], ['State machines', '<a href="#/nerves">nerves per class</a>'],
        ['Binary', '<a href="#/symbols">data symbols</a> · <a href="#/strings">strings</a>'],
        ['Legend', '<a href="#/about">statuses, return types, hook safety</a>'],
      ])}</div></div>`)}`;
  }
  function quick(q) { const i = IX.typeByQ.get(q) ?? IX.anyByQ.get(q); return i !== undefined ? U.link(i, q) : `<code>${esc(q)}</code>`; }

  function progress(main) {
    // per-folder aggregation
    const agg = new Map();
    for (const [u, s] of IX.ustats) {
      const parts = IX.q(u).split('/');
      for (let k = 1; k < parts.length; k++) {
        const key = parts.slice(0, k).join('/');
        let a = agg.get(key); if (!a) agg.set(key, a = [0, 0, 0, 0, 0, 0, 0, 0, 0]);
        for (let j = 1; j <= 8; j++) a[j] += s[j];
      }
    }
    const keys = [...agg.keys()].sort();
    let t = '<table class="t"><thead><tr><th>Folder</th><th>Functions</th><th>Decompiled</th><th>Bytes</th><th style="width:30%">Progress (bytes)</th></tr></thead><tbody>';
    for (const k of keys) {
      const a = agg.get(k), fn = a[1] + a[2] + a[3] + a[4], by = a[5] + a[6] + a[7] + a[8];
      const depth = k.split('/').length - 1;
      t += `<tr><td class="m" style="padding-left:${10 + depth * 16}px"><a href="#/files/${encodeURIComponent(k)}">${esc(k.split('/').pop())}/</a></td><td class="num">${U.num(fn)}</td><td class="num">${U.pct(a[1] + a[2] + a[3], fn)}</td><td class="num">${U.num(by)}</td>
        <td><div class="bar"><span class="b1" style="width:${100 * a[5] / (by || 1)}%"></span><span class="b2" style="width:${100 * a[6] / (by || 1)}%"></span><span class="b3" style="width:${100 * a[7] / (by || 1)}%"></span></div></td></tr>`;
    }
    const m = IX.meta, s = m.stats;
    main.innerHTML = `<div class="crumbs"><a href="#/">Home</a></div><h1 class="page-title">Progress</h1>
      ${section('Global', progressBar([0, s.Matching || 0, s.NonMatchingMinor || 0, s.NonMatchingMajor || 0, s.NotDecompiled || 0]))}
      ${section('Per folder', t + '</tbody></table>')}`;
  }

  function filesPage(main, dir) {
    const units = [];
    for (let i = 0; i < IX.E.length; i++) if (IX.kind(i) === 'unit') units.push(i);
    const pre = dir ? dir + '/' : '';
    const subdirs = new Map(); const here = [];
    for (const u of units) {
      const q = IX.q(u);
      if (!q.startsWith(pre)) continue;
      const rest = q.slice(pre.length);
      const p = rest.indexOf('/');
      if (p < 0) here.push(u);
      else { const d = rest.slice(0, p); subdirs.set(d, (subdirs.get(d) || 0) + 1); }
    }
    const parts = dir ? dir.split('/') : [];
    let h = `<div class="crumbs"><a href="#/">Home</a><span class="sep">›</span><a href="#/files">Files</a>${parts.map((p, k) => `<span class="sep">›</span><a href="#/files/${encodeURIComponent(parts.slice(0, k + 1).join('/'))}">${esc(p)}</a>`).join('')}</div>`;
    h += `<h1 class="page-title">${esc(dir || 'File tree')}/</h1><p class="lead">Units = a header, its .cpp and the matching binary object, grouped under one name.</p>`;
    if (subdirs.size) h += section('Folders', `<div class="entity-list">${[...subdirs].sort().map(([d, n]) => `<div>📁 <a href="#/files/${encodeURIComponent(pre + d)}">${esc(d)}/</a> <span class="dim small">${n}</span></div>`).join('')}</div>`, subdirs.size);
    if (here.length) {
      let t = '<table class="t"><thead><tr><th>Unit</th><th>Functions</th><th>Decompiled</th><th style="width:30%">Progress</th></tr></thead><tbody>';
      for (const u of here.sort((a, b) => IX.nameL[a].localeCompare(IX.nameL[b]))) {
        const s = IX.ustats.get(u) || [u, 0, 0, 0, 0, 0, 0, 0, 0];
        const fn = s[1] + s[2] + s[3] + s[4];
        t += `<tr><td class="m">${U.link(u)}</td><td class="num">${fn}</td><td class="num">${fn ? U.pct(s[1] + s[2] + s[3], fn) : '—'}</td><td><div class="bar"><span class="b1" style="width:${100 * s[1] / (fn || 1)}%"></span><span class="b2" style="width:${100 * s[2] / (fn || 1)}%"></span><span class="b3" style="width:${100 * s[3] / (fn || 1)}%"></span></div></td></tr>`;
      }
      h += section('Units', t + '</tbody></table>', here.length);
    }
    main.innerHTML = h;
  }

  function hierarchy(main, rootSlug) {
    let roots;
    if (rootSlug) roots = [IX.bySlug.get(rootSlug)];
    else {
      roots = [];
      for (const [b] of IX.derived) if (!(IX.bases.get(b) || []).length) roots.push(b);
      roots.sort((a, b) => IX.nameL[a].localeCompare(IX.nameL[b]));
    }
    const rec = (x, depth) => {
      const ds = (IX.derived.get(x) || []).slice().sort((a, b) => IX.nameL[a].localeCompare(IX.nameL[b]));
      if (!ds.length) return `<li>${U.kb(IX.kind(x))} ${U.link(x, IX.q(x))}</li>`;
      return `<li><details ${depth < 1 && rootSlug ? 'open' : ''}><summary>${U.kb(IX.kind(x))} ${U.link(x, IX.q(x))} <span class="dim">(${ds.length})</span></summary><ul>${depth < 25 ? ds.map(d => rec(d, depth + 1)).join('') : ''}</ul></details></li>`;
    };
    main.innerHTML = `<div class="crumbs"><a href="#/">Home</a><span class="sep">›</span><a href="#/hierarchy">Hierarchy</a></div><h1 class="page-title">Class hierarchy${rootSlug ? ' : ' + esc(rootSlug) : ''}</h1>
      <p class="lead">Root classes (no known base) with at least one derived class. Click to expand.</p><div class="inherit"><ul>${roots.map(r => rec(r, 0)).join('')}</ul></div>`;
  }

  function nerves(main) {
    const rows = IX.nerv.slice().sort((a, b) => IX.nameL[a[0]].localeCompare(IX.nameL[b[0]]));
    main.innerHTML = `<div class="crumbs"><a href="#/">Home</a></div><h1 class="page-title">Nerves (state machines)</h1>
      <p class="lead">Classes defining nerves (<code>NERVE_IMPL</code>, <code>NERVES_MAKE_STRUCT</code>…). Each state is detailed on the class page.</p>
      <div class="entity-list">${rows.map(([c, n]) => `<div>${U.kb(IX.kind(c))}${U.link(c, IX.q(c))} <span class="dim small">${n} states</span></div>`).join('')}</div>`;
  }

  async function factories(main) {
    const f = await DOC.load('factories');
    let h = `<div class="crumbs"><a href="#/">Home</a></div><h1 class="page-title">Factories</h1><p class="lead">Tables mapping the names used in stage files (BYML, <code>UnitConfigName</code>/<code>ClassName</code>) to C++ classes. <code>nullptr</code> = class not decompiled yet.</p>`;
    for (const [path, rows] of Object.entries(f)) {
      if (!rows.length) continue;
      h += section(esc(path.split('/').pop()), `<div class="toolbar"><input type="text" class="ff" placeholder="Filter…"> ${U.fileLink(path)}</div><table class="t"><thead><tr><th>Name</th><th>Class</th><th>Line</th></tr></thead><tbody>${rows.map(r => `<tr data-n="${esc((r[0] + ' ' + (r[1] || '')).toLowerCase())}"><td class="m">${esc(r[0])}</td><td class="m">${r[1] ? (r[3] !== null ? U.link(r[3], r[1]) : esc(r[1])) : '<span class="dim">nullptr</span>'}</td><td class="num"><a href="#/src/${IX.fileByPath.get(path)}/${r[2]}">${r[2]}</a></td></tr>`).join('')}</tbody></table>`, rows.length);
    }
    main.innerHTML = h;
    main.querySelectorAll('.ff').forEach(inp => inp.addEventListener('input', () => {
      const q = inp.value.toLowerCase();
      inp.closest('section').querySelectorAll('tr[data-n]').forEach(tr => tr.classList.toggle('hidden', !tr.dataset.n.includes(q)));
    }));
  }

  async function strings(main) {
    const s = await DOC.load('strings');
    main.innerHTML = `<div class="crumbs"><a href="#/">Home</a></div><h1 class="page-title">Binary strings</h1><p class="lead">${U.num(s.length)} strings from <code>data/data_strings.csv</code> (absolute address, main base 0x7100000000).</p><div class="toolbar"><input type="text" class="lfilter" placeholder="Filtrer…" style="min-width:320px"></div><div class="plist"></div>`;
    paged(main.querySelector('.plist'), s, main.querySelector('.lfilter'), slice =>
      `<table class="t"><thead><tr><th>Address</th><th>Offset</th><th>String</th></tr></thead><tbody>${slice.map(r => `<tr><td class="num">${esc(r[0])}</td><td class="num">${U.hex(parseInt(r[0], 16) - U.MAIN_BASE)}</td><td class="m">${esc(r[1])}</td></tr>`).join('')}</tbody></table>`, 1000);
  }

  async function symbols(main) {
    const s = await DOC.load('symbols');
    main.innerHTML = `<div class="crumbs"><a href="#/">Home</a></div><h1 class="page-title">Data symbols</h1><p class="lead">${U.num(s.length)} symbols from <code>data/data_symbols.csv</code> (global variables, static members, vtables…).</p><div class="toolbar"><input type="text" class="lfilter" placeholder="Filtrer…" style="min-width:320px"></div><div class="plist"></div>`;
    paged(main.querySelector('.plist'), s, main.querySelector('.lfilter'), slice =>
      `<table class="t"><thead><tr><th>Address</th><th>Offset</th><th>Demangled symbol</th><th>Mangled</th></tr></thead><tbody>${slice.map(r => `<tr><td class="num">${esc(r[0])}</td><td class="num">${U.hex(parseInt(r[0], 16) - U.MAIN_BASE)}</td><td class="m">${r[3] !== null ? U.link(r[3], r[2]) : esc(r[2])}</td><td class="m small dim">${esc(r[1])}</td></tr>`).join('')}</tbody></table>`, 1000);
  }

  function searchPage(main, q) {
    const kinds = [['Classes', ['class', 'struct', 'union', 'tclass', 'xclass']], ['Functions', ['func', 'tfunc', 'sym']],
                   ['Methods', ['method', 'ctor', 'dtor', 'conv', 'tmethod']], ['Namespaces', ['ns', 'xns']],
                   ['Enums', ['enum']], ['Types', ['typedef', 'alias']], ['Variables', ['var']], ['Macros', ['macro']], ['Files', ['unit']]];
    main.innerHTML = `<div class="crumbs"><a href="#/">Home</a></div><h1 class="page-title">Search</h1>
      <div class="toolbar"><input type="text" id="sq" value="${esc(q)}" style="min-width:360px">${kinds.map(([l], k) => `<label><input type="checkbox" class="sk" data-k="${k}" checked> ${l}</label>`).join('')}</div><div id="sres"></div>`;
    const run = () => {
      const sel = new Set();
      main.querySelectorAll('.sk').forEach(c => { if (c.checked) kinds[+c.dataset.k][1].forEach(k => sel.add(k)); });
      const r = SEARCH.run(main.querySelector('#sq').value, 2000, sel);
      const cont = main.querySelector('#sres');
      paged(cont, r.map(x => x.i), null, slice => `<table class="t"><tbody>${slice.map(i => `<tr><td>${U.kb(IX.kind(i))}${IX.status(i) ? U.st(IX.status(i)) : ''}</td><td class="m">${U.link(i, IX.q(i))}</td><td class="small dim">${U.KIND_LABEL[IX.kind(i)]}</td></tr>`).join('')}</tbody></table>`, 200);
    };
    main.querySelector('#sq').addEventListener('input', U.debounce(run, 200));
    main.querySelectorAll('.sk').forEach(c => c.addEventListener('change', run));
    run();
  }

  function overloads(main, q) {
    const ids = IX.fnByQ.get(q) || [];
    main.innerHTML = `<h1 class="page-title">${esc(q)}</h1><div class="entity-list">${ids.map(i => `<div>${U.link(i, IX.slug(i))}</div>`).join('')}</div>`;
  }

  function about(main) {
    const m = IX.meta;
    main.innerHTML = `<div class="crumbs"><a href="#/">Home</a></div><h1 class="page-title">About & legend</h1>
    ${section('Sources', kv([
      ['Decompilation', `<a target="_blank" rel="noopener" href="https://github.com/${m.decomp_repo}/tree/${m.decomp_rev}">${esc(m.decomp_repo)}</a>`],
      ['Ghidra pseudo-code', `<a target="_blank" rel="noopener" href="https://github.com/${m.ghidra_repo}/tree/${m.ghidra_rev}">${esc(m.ghidra_repo)}</a>`],
      ...Object.entries(m.subs || {}).map(([p, [r, v]]) => [esc(p), `<a target="_blank" rel="noopener" href="https://github.com/${r}/tree/${v}">${esc(r)}</a>`]),
      ['Method', 'Semantic analysis of every header and .cpp with libclang (types, parameters, field offsets, sizes), cross-referenced with <code>data/file_list.yml</code> (every function in the binary, with status) by demangled name, then with the Ghidra repository by address.'],
    ]))}
    ${section('Game version', '<p><b>Super Mario Odyssey 1.0.0 only.</b> The decompilation targets 1.0.0, and every offset, address, size and instruction shown here comes from the 1.0.0 <code>main</code> executable. Do not use them on 1.1, 1.2 or 1.3: functions are at different offsets there.</p>')}
    ${section('Return types', kv(Object.values(RSRC).map(r => [`<span class="pill ${r[0]}">${r[0] === 'bad' ? '⚠ ' : ''}${r[1]}</span>`, esc(r[2])])))}
    ${section('Hook safety', '<p>exlaunch’s trampoline hook writes a single <code>B</code> over the first instruction when the callback is within ±128 MB (the normal case for SMO, whose <code>main</code> is ~12.5 MB), otherwise an absolute jump over the first 4–5 instructions. PC-relative instructions in the overwritten part (b, bl, b.cond, cbz/cbnz, tbz/tbnz, adr/adrp, ldr literal) are relocated into the trampoline. Real breakage comes from code branching back into the overwritten bytes, loops back to the entry, and functions shorter than the patch.</p><p>Size checks are always shown. Instruction-level checks need <code>generator/ghidra/ExportOdysseyDoc.java</code> run on your Ghidra project.</p>')}
    ${section('Calls / called by', '<p>Built from the Ghidra pseudo-code (direct calls, overloads resolved by argument count). Virtual calls and calls through function pointers are not visible there.</p>')}
    ${section('Function statuses', kv([
      [U.pill(1), 'The decompiled code recompiles to instructions identical to the original.'],
      [U.pill(2), 'Decompiled, small differences (registers, instruction order).'],
      [U.pill(3), 'Decompiled but with significant differences.'],
      [U.pill(4), 'Present in the binary but not decompiled yet: only the Ghidra pseudo-code is available.'],
      [`<span class="pill">${U.STATUS_SHORT[0]}</span>`, 'Declared in the decomp but no symbol in the binary (inline, template, removed by the optimizer…).'],
    ]))}
    ${section('Entity kinds', kv(Object.entries(U.KIND_LABEL).map(([k, l]) => [U.kb(k), l])))}
    ${section('Addresses', kv([
      ['Offset (main)', 'Offset from the start of the main module (<code>.text</code>). This is the value used by exlaunch / hooks.'],
      ['Absolute address', 'Offset + <code>0x7100000000</code> (base used by the decomp tooling and CSV files).'],
      ['Ghidra address', 'Offset + <code>0x100000</code>, in the <code>.text::XXXXXXXX</code> format of the pseudo-code repository.'],
    ]))}
    ${section('Entities “inferred from binary”', '<p>Functions that do not exist in the decomp headers yet are rebuilt from their mangled symbol: name, class and parameter types are exact, but parameter names and the return type are unknown (Ghidra gives an estimate, e.g. <code>undefined4</code> = 4-byte value). An owner is treated as a class when Ghidra sees a <code>__thiscall</code>, a constructor or a const method.</p>')}`;
  }

  return { entity, srcPage, listPage, home, progress, filesPage, hierarchy, nerves, factories, strings, symbols, searchPage, overloads, about };
})();
