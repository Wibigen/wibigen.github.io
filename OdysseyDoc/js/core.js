/* OdysseyDoc — core: data loading, index, utilities.
 * Data files are .js files (data/...) that call DOC.got(key, value):
 * this works even when opening index.html directly (file://), without a server. */
'use strict';

const DOC = {
  cache: Object.create(null),
  waiting: Object.create(null),

  got(key, value) {
    this.cache[key] = value;
    const w = this.waiting[key];
    if (w) { delete this.waiting[key]; w.forEach(([res]) => res(value)); }
  },

  /** Loads data/<key>.js once and returns a Promise of its value. */
  load(key, base = 'data/', src = null) {
    if (key in this.cache) return Promise.resolve(this.cache[key]);
    return new Promise((resolve, reject) => {
      if (this.waiting[key]) { this.waiting[key].push([resolve, reject]); return; }
      this.waiting[key] = [[resolve, reject]];
      const s = document.createElement('script');
      s.src = src || (base + key.split('/').map(encodeURIComponent).join('/') + '.js');
      s.async = true;
      s.onerror = () => {
        const w = this.waiting[key] || [];
        delete this.waiting[key];
        w.forEach(([, rej]) => rej(new Error('Could not load ' + s.src)));
        s.remove();
      };
      s.onload = () => s.remove();
      document.head.appendChild(s);
    });
  },
};

/* ------------------------------------------------------------------ index */
const IX = {
  ready: false,
  E: null,          // raw rows: [slug, kind, name, parent, status, bundle, flags, unit]
  K: null,          // entity kind names
  files: null,      // [path, module, lines]
  meta: null,
  bySlug: new Map(),
  kids: null,       // id -> [child ids]
  typeByQ: new Map(),
  typeShort: new Map(),   // short name -> id (or -1 if ambiguous)
  fnByQ: new Map(),       // qname -> [ids]
  anyByQ: new Map(),
  fileByPath: new Map(),
  unitKids: null,
  unitByStem: new Map(),
  nameL: null, qL: null,
  ustats: new Map(),

  init(d) {
    this.meta = d.meta; this.E = d.e; this.K = d.meta.kmap; this.files = d.files; this.addr = d.addr;
    const n = this.E.length;
    // rows store 0 instead of the slug when it is simply "<parent qname>::<name>"
    const E = this.E;
    const qOf = s => { const t = s.lastIndexOf('~'); if (t > 0 && /^~\d+$/.test(s.slice(t))) s = s.slice(0, t); return s.startsWith('file:') ? s.slice(5) : s; };
    const calc = i => {
      const r = E[i];
      if (r[0] !== 0) return r[0];
      const p = r[3];
      r[0] = p >= 0 ? qOf(calc(p)) + '::' + r[2] : r[2];
      return r[0];
    };
    for (let i = 0; i < n; i++) calc(i);
    this.kids = new Array(n);
    this.nameL = new Array(n); this.qL = new Array(n);
    const TYPE = new Set(['class', 'struct', 'union', 'tclass', 'xclass', 'enum', 'typedef', 'alias']);
    const FN = new Set(['func', 'method', 'ctor', 'dtor', 'conv', 'tfunc', 'tmethod', 'sym', 'var']);
    for (let i = 0; i < n; i++) {
      const r = this.E[i];
      this.bySlug.set(r[0], i);
      const p = r[3];
      if (p >= 0) (this.kids[p] || (this.kids[p] = [])).push(i);
      const k = this.K[r[1]];
      const q = this.q(i);
      this.nameL[i] = r[2].toLowerCase();
      this.qL[i] = q.toLowerCase();
      if (TYPE.has(k)) {
        if (!this.typeByQ.has(q)) this.typeByQ.set(q, i);
        const s = this.typeShort.get(r[2]);
        this.typeShort.set(r[2], s === undefined ? i : (s === i ? i : -1));
      }
      if (FN.has(k)) { const a = this.fnByQ.get(q); if (a) a.push(i); else this.fnByQ.set(q, [i]); }
      if (k === 'unit') this.unitByStem.set(q, i);
      else if (!this.anyByQ.has(q)) this.anyByQ.set(q, i);
    }
    this.files.forEach((f, i) => this.fileByPath.set(f[0], i));
    (d.ustats || []).forEach(s => this.ustats.set(s[0], s));
    this.bases = new Map(); this.derived = new Map();
    for (const [c, ...bs] of (d.inh || [])) {
      if (!bs.length) continue;
      this.bases.set(c, bs);
      for (const b of bs) { const a = this.derived.get(b); if (a) a.push(c); else this.derived.set(b, [c]); }
    }
    this.nerv = d.nerv || [];
    this.ready = true;
  },

  kind(i) { return this.K[this.E[i][1]]; },
  name(i) { return this.E[i][2]; },
  parent(i) { const p = this.E[i][3]; return p >= 0 ? p : null; },
  status(i) { return this.E[i][4]; },
  flags(i) { return this.E[i][6]; },
  unit(i) { const u = this.E[i][7]; return u >= 0 ? u : null; },
  slug(i) { return this.E[i][0]; },
  /** qualified name (slug without the ~n overload suffix or the file: prefix) */
  q(i) {
    let s = this.E[i][0];
    const t = s.lastIndexOf('~');
    if (t > 0 && /^~\d+$/.test(s.slice(t))) s = s.slice(0, t);
    if (s.startsWith('file:')) s = s.slice(5);
    return s;
  },
  isBinOnly(i) { return (this.E[i][6] & 1) !== 0; },
  href(i) { return '#/e/' + encodeURIComponent(this.E[i][0]); },
  children(i) { return this.kids[i] || []; },

  /** top-level children of each unit (file) */
  buildUnitKids() {
    if (this.unitKids) return;
    this.unitKids = new Map();
    const CLS = new Set(['class', 'struct', 'union', 'tclass', 'xclass']);
    for (let i = 0; i < this.E.length; i++) {
      const u = this.E[i][7];
      if (u < 0) continue;
      const k = this.kind(i);
      if (k === 'unit') continue;
      const anon = n => this.E[n][0].startsWith('(anonymous@') && !this.E[n][0].includes('::');
      if ((k === 'ns' || k === 'xns') && !anon(i)) continue;
      const p = this.parent(i);
      if (p !== null && CLS.has(this.kind(p)) && this.E[p][7] === u) continue;
      if (p !== null && (this.kind(p) === 'ns' || this.kind(p) === 'xns') && anon(p)) continue;
      let a = this.unitKids.get(u); if (!a) this.unitKids.set(u, a = []);
      a.push(i);
    }
  },

  /** status counts of child functions */
  memberStatus(i) {
    const c = [0, 0, 0, 0, 0];
    const stack = [...this.children(i)];
    while (stack.length) {
      const x = stack.pop();
      c[this.status(x)]++;
    }
    return c;
  },

  findAddr(off) {
    const a = this.addr; let lo = 0, hi = a.length - 1, best = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m][0] <= off) { best = m; lo = m + 1; } else hi = m - 1; }
    return best >= 0 ? a[best] : null;
  },
};

/* ------------------------------------------------------------------ utils */
const U = {
  esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  hex(n, pad = 0) { return '0x' + Number(n).toString(16).padStart(pad, '0'); },
  num(n) { return Number(n).toLocaleString('en-US'); },
  pct(a, b) { return b ? (100 * a / b).toFixed(2) + '%' : '—'; },
  MAIN_BASE: 0x7100000000,
  GHIDRA_BASE: 0x100000,

  KIND_LABEL: {
    ns: 'Namespace', xns: 'Namespace (inferred from binary)', class: 'Class', struct: 'Struct', union: 'Union',
    tclass: 'Class template', xclass: 'Class (inferred from binary)', enum: 'Enum', typedef: 'Typedef',
    alias: 'Type alias (using)', func: 'Function', method: 'Method', ctor: 'Constructor', dtor: 'Destructor',
    conv: 'Conversion operator', tfunc: 'Function template', tmethod: 'Method template',
    var: 'Variable', macro: 'Macro', unit: 'File / unit', sym: 'Binary symbol',
  },
  KIND_SHORT: {
    ns: 'N', xns: 'N', class: 'C', struct: 'S', union: 'U', tclass: 'T', xclass: 'C', enum: 'E', typedef: 'Ty',
    alias: 'Ty', func: 'F', method: 'M', ctor: 'C+', dtor: 'C~', conv: 'Op', tfunc: 'TF', tmethod: 'TM',
    var: 'V', macro: '#', unit: '▤', sym: '?',
  },
  STATUS_LABEL: ['No symbol in the binary', 'Matching (identical to the original)', 'NonMatching (minor)',
                 'NonMatching (major)', 'Not decompiled'],
  STATUS_SHORT: ['no symbol', 'Matching', 'NonMatching minor', 'NonMatching major', 'Not decompiled'],
  STATUS_CODE: { Matching: 1, NonMatchingMinor: 2, NonMatchingMajor: 3, NotDecompiled: 4 },
  MODULE_LABEL: {
    game: 'Game (src/)', 'al-library': 'al — Library', 'al-project': 'al — Project', al: 'al', sead: 'sead',
    agl: 'agl', eui: 'eui', nex: 'NintendoSDK-NEX', nn: 'NintendoSDK (nn)', other: 'Other',
  },

  kb(k) { return `<span class="kb ${k}" title="${U.esc(U.KIND_LABEL[k] || k)}">${U.KIND_SHORT[k] || '?'}</span>`; },
  st(s) { return `<span class="st s${s}" title="${U.esc(U.STATUS_LABEL[s])}"></span>`; },
  pill(s) { return `<span class="pill s${s}"><span class="st s${s}"></span>${U.STATUS_SHORT[s]}</span>`; },

  link(i, text, cls = '') {
    if (i === null || i === undefined || i < 0) return U.esc(text ?? '');
    const t = text ?? IX.name(i);
    return `<a class="${cls}" href="${IX.href(i)}" title="${U.esc(U.KIND_LABEL[IX.kind(i)] + ' ' + IX.q(i))}">${U.esc(t)}</a>`;
  },
  linkQ(i) { return U.link(i, IX.q(i)); },
  fileHref(fi, line) { return '#/src/' + fi + (line ? '/' + line : ''); },
  fileLink(path, line, fi) {
    if (fi === undefined || fi === null) fi = IX.fileByPath.get(path);
    const label = path + (line ? ':' + line : '');
    if (fi === undefined || fi === null) return `<code>${U.esc(label)}</code>`;
    return `<a class="mono" href="${U.fileHref(fi, line)}">${U.esc(label)}</a>`;
  },
  githubUrl(path, line, end) {
    const m = IX.meta;
    for (const [pre, [repo, rev]] of Object.entries(m.subs || {})) {
      if (path.startsWith(pre + '/')) return `https://github.com/${repo}/blob/${rev}/${path.slice(pre.length + 1)}${line ? '#L' + line + (end && end !== line ? '-L' + end : '') : ''}`;
    }
    return `https://github.com/${m.decomp_repo}/blob/${m.decomp_rev}/${path}${line ? '#L' + line + (end && end !== line ? '-L' + end : '') : ''}`;
  },
  objToCpp(obj) {
    let o = obj.replace(/\.o$/, '');
    const h = o.split('/')[0];
    if (h === 'Library' || h === 'Project') return 'lib/al/' + o + '.cpp';
    if (h === 'sead') return 'lib/sead/modules/src/' + o.slice(5) + '.cpp';
    if (h === 'NintendoSDK' || h === 'NintendoSDK-NEX' || h === 'eui') return 'lib/' + o + '.cpp';
    if (/\.a$/.test(o) || h === 'Unknown' || h === 'UNKNOWN') return null;
    return 'src/' + o + '.cpp';
  },
  objToStem(obj) {
    let o = obj.replace(/\.o$/, '');
    const h = o.split('/')[0];
    if (h === 'Library' || h === 'Project') return 'lib/al/' + o;
    if (h === 'sead') return 'lib/sead/modules/src/' + o.slice(5);
    if (h === 'NintendoSDK' || h === 'NintendoSDK-NEX' || h === 'eui') return 'lib/' + o;
    if (/\.a$/.test(o)) return 'lib/(archives)/' + o;
    if (h === 'Unknown' || h === 'UNKNOWN') return 'unknown/' + o;
    return 'src/' + o;
  },
  debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; },
  copy(text) { navigator.clipboard?.writeText(text); },
};

/** entity details (loads its data bundle) */
async function detail(i) {
  const b = await DOC.load('e/' + IX.E[i][5]);
  return b[i] || {};
}
async function details(ids) {
  const bs = [...new Set(ids.map(i => IX.E[i][5]))];
  await Promise.all(bs.map(b => DOC.load('e/' + b)));
  const out = new Map();
  for (const i of ids) out.set(i, DOC.cache['e/' + IX.E[i][5]][i] || {});
  return out;
}
async function sourceText(fi) { return DOC.load('src/' + fi); }

/** Ghidra pseudo-code, bundled locally in data/gh/<bundle>.js (same bundle number as the entity). */
async function ghidraText(path, bundle) {
  const b = await DOC.load('gh/' + bundle);
  if (!(path in b)) throw new Error('missing ' + path);
  return b[path];
}
