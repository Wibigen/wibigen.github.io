/* OdysseyDoc — global search (names, qualified names, addresses). */
'use strict';

const SEARCH = (() => {
  const KIND_BONUS = { class: 60, struct: 55, tclass: 55, xclass: 40, union: 50, ns: 45, xns: 30, enum: 45, typedef: 30,
                       alias: 30, func: 20, method: 15, ctor: 10, dtor: 5, unit: 25, macro: 10, var: 10 };

  /** Parses an address: offset (0x1ccff4), main address (0x71001ccff4) or Ghidra (.text::002ccff4 / gh:002ccff4). */
  function parseAddr(q) {
    let s = q.trim().toLowerCase();
    let ghidra = false;
    if (s.startsWith('.text::')) { s = s.slice(7); ghidra = true; }
    else if (s.startsWith('gh:')) { s = s.slice(3); ghidra = true; }
    if (!/^(0x)?[0-9a-f]{4,12}$/.test(s)) return null;
    if (!s.startsWith('0x') && !ghidra && !/[a-f]/.test(s) && s.length < 6) return null;
    let v = parseInt(s.replace(/^0x/, ''), 16);
    if (v >= U.MAIN_BASE) v -= U.MAIN_BASE;
    else if (ghidra) v -= U.GHIDRA_BASE;
    return v;
  }

  function run(q, limit = 60, kinds = null) {
    q = q.trim();
    if (!q) return [];
    const res = [];
    const off = parseAddr(q);
    if (off !== null) {
      const a = IX.findAddr(off);
      if (a) res.push({ i: a[1], score: 1e6, addr: off, base: a[0] });
    }
    const ql = q.toLowerCase();
    const qual = ql.includes('::');
    const words = ql.split(/\s+/).filter(Boolean);
    const E = IX.E, nameL = IX.nameL, qL = IX.qL, K = IX.K;
    for (let i = 0; i < E.length; i++) {
      const k = K[E[i][1]];
      if (kinds && !kinds.has(k)) continue;
      const n = nameL[i];
      let s = 0;
      if (words.length > 1) {
        const ql2 = qL[i];
        if (words.every(w => ql2.includes(w))) s = 150 - Math.min(ql2.length, 140) / 2;
        else continue;
      } else if (qual) {
        const ql2 = qL[i];
        if (ql2 === ql) s = 1000;
        else if (ql2.endsWith(ql)) s = 800 - ql2.length / 4;
        else if (ql2.startsWith(ql)) s = 600 - ql2.length / 4;
        else if (ql2.includes(ql)) s = 300 - ql2.length / 4;
        else continue;
      } else {
        if (n === ql) s = 1000;
        else if (n.startsWith(ql)) s = 700 - (n.length - ql.length) * 2;
        else if (n.includes(ql)) s = 400 - (n.length - ql.length);
        else if (qL[i].includes(ql)) s = 150 - qL[i].length / 4;
        else continue;
      }
      s += (KIND_BONUS[k] || 0);
      if (E[i][6] & 1) s -= 15;           // inferred from binary: slightly lower priority
      res.push({ i, score: s });
    }
    res.sort((a, b) => b.score - a.score || (IX.qL[a.i] < IX.qL[b.i] ? -1 : 1));
    return limit ? res.slice(0, limit) : res;
  }

  function context(i) {
    const k = IX.kind(i);
    const p = IX.parent(i);
    if (k === 'unit') return 'file';
    return (p !== null ? IX.q(p) : (IX.isBinOnly(i) ? 'binary' : 'global'));
  }

  function hlName(name, q) {
    const ql = q.toLowerCase(), nl = name.toLowerCase();
    const p = nl.indexOf(ql);
    if (p < 0 || !ql) return U.esc(name);
    return U.esc(name.slice(0, p)) + '<b>' + U.esc(name.slice(p, p + ql.length)) + '</b>' + U.esc(name.slice(p + ql.length));
  }

  // ---------------------------------------------------------------- search bar UI
  let input, box, items = [], active = -1;

  function render(q) {
    if (!IX.ready) { box.innerHTML = '<div class="sr-foot">Loading index…</div>'; box.classList.add('open'); return; }
    items = run(q, 40);
    active = items.length ? 0 : -1;
    if (!q.trim()) { box.classList.remove('open'); return; }
    let h = '';
    items.forEach((r, n) => {
      const i = r.i, k = IX.kind(i);
      const label = r.addr !== undefined
        ? `${U.esc(IX.q(i))} <span class="dim">(offset ${U.hex(r.base)}${r.addr !== r.base ? ' + ' + U.hex(r.addr - r.base) : ''})</span>`
        : (q.includes('::') ? hlName(IX.q(i), q) : hlName(IX.name(i), q));
      h += `<div class="sr-item${n === active ? ' active' : ''}" data-n="${n}">${U.kb(k)}${IX.status(i) ? U.st(IX.status(i)) : ''}<span class="sr-name">${label}</span><span class="sr-ctx">${U.esc(context(i))}</span></div>`;
    });
    if (!items.length) h = '<div class="sr-foot">No results.</div>';
    else h += `<div class="sr-foot">↑↓ to navigate · Enter to open · <a href="#/search/${encodeURIComponent(q)}">all results</a></div>`;
    box.innerHTML = h;
    box.classList.add('open');
  }

  function go(n) {
    const r = items[n];
    if (!r) return;
    location.hash = IX.href(r.i);
    close();
  }
  function close() { box.classList.remove('open'); input.blur(); }

  function setup() {
    input = document.getElementById('search');
    box = document.getElementById('search-results');
    const deb = U.debounce(() => render(input.value), 70);
    input.addEventListener('input', deb);
    input.addEventListener('focus', () => { if (input.value.trim()) render(input.value); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); upd(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); upd(); e.preventDefault(); }
      else if (e.key === 'Enter') {
        if (e.ctrlKey || e.metaKey || active < 0) { location.hash = '#/search/' + encodeURIComponent(input.value); close(); }
        else go(active);
        e.preventDefault();
      } else if (e.key === 'Escape') close();
    });
    box.addEventListener('mousedown', e => {
      const it = e.target.closest('.sr-item');
      if (it) { e.preventDefault(); go(+it.dataset.n); }
    });
    document.addEventListener('mousedown', e => { if (!e.target.closest('#search-wrap')) box.classList.remove('open'); });
    document.addEventListener('keydown', e => {
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) {
        e.preventDefault(); input.focus(); input.select();
      }
    });
    function upd() {
      box.querySelectorAll('.sr-item').forEach((el, n) => el.classList.toggle('active', n === active));
      box.querySelector('.sr-item.active')?.scrollIntoView({ block: 'nearest' });
    }
  }

  return { run, setup, parseAddr, context, hlName };
})();
