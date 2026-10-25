/* OdysseyDoc — sidebar: folder tree, namespace tree and special pages. */
'use strict';

const TREE = (() => {
  let tab = 'dirs';
  let root, filterInput;
  let dirTree = null;
  const CLS = new Set(['class', 'struct', 'union', 'tclass', 'xclass']);
  const KORDER = { ns: 0, xns: 1, class: 2, struct: 2, union: 2, tclass: 2, xclass: 3, enum: 4, typedef: 5, alias: 5,
                   ctor: 6, dtor: 7, method: 8, tmethod: 8, conv: 8, func: 9, tfunc: 9, var: 10, macro: 11, sym: 12 };
  const CHUNK = 400;

  function sortIds(ids) {
    return ids.slice().sort((a, b) => (KORDER[IX.kind(a)] ?? 20) - (KORDER[IX.kind(b)] ?? 20) ||
      IX.nameL[a].localeCompare(IX.nameL[b]));
  }

  function unitStatus(u) {
    const s = IX.ustats.get(u);
    if (!s) return 0;
    const tot = s[1] + s[2] + s[3] + s[4];
    if (!tot) return 0;
    if (s[4] === 0 && s[2] + s[3] === 0) return 1;
    if (s[4] === tot) return 4;
    return 2;
  }

  function buildDirTree() {
    const rootN = { name: '', dirs: new Map(), units: [], key: '' };
    for (let i = 0; i < IX.E.length; i++) {
      if (IX.kind(i) !== 'unit') continue;
      const parts = IX.q(i).split('/');
      let n = rootN;
      for (let k = 0; k < parts.length - 1; k++) {
        let c = n.dirs.get(parts[k]);
        if (!c) { c = { name: parts[k], dirs: new Map(), units: [], key: n.key + parts[k] + '/' }; n.dirs.set(parts[k], c); }
        n = c;
      }
      n.units.push(i);
    }
    const count = n => { n.count = n.units.length; for (const c of n.dirs.values()) n.count += count(c); return n.count; };
    count(rootN);
    return rootN;
  }

  // -------------------------------------------------------------- nodes
  function row({ label, kb = '', st = '', count = '', href = null, expandable = false, key = '', depth = 0, id = null }) {
    const el = document.createElement('div');
    el.className = 'tn';
    if (key) el.dataset.key = key;
    if (id !== null) el.dataset.id = id;
    el.innerHTML = `<div class="tn-row" style="padding-left:${6 + depth * 14}px"><span class="tn-tw">${expandable ? '▸' : ''}</span>${kb}${st}<span class="tn-label">${label}</span><span class="tn-count">${count}</span></div><div class="tn-kids"></div>`;
    el._href = href;
    return el;
  }

  function attachLazy(el, fill) {
    el._fill = fill;
  }

  function toggle(el, force) {
    const open = force !== undefined ? force : !el.classList.contains('open');
    if (open && el._fill && !el._filled) { el._filled = true; el._fill(el.querySelector(':scope > .tn-kids')); }
    el.classList.toggle('open', open);
    const tw = el.querySelector(':scope > .tn-row > .tn-tw');
    if (tw && tw.textContent) tw.textContent = open ? '▾' : '▸';
  }

  function appendChunked(container, ids, depth, maker) {
    let pos = 0;
    const more = () => {
      const frag = document.createDocumentFragment();
      for (const i of ids.slice(pos, pos + CHUNK)) frag.appendChild(maker(i, depth));
      pos += CHUNK;
      container.appendChild(frag);
      if (pos < ids.length) {
        const m = document.createElement('div');
        m.className = 'tn';
        m.innerHTML = `<div class="tn-row" style="padding-left:${20 + depth * 14}px"><span class="dim">… ${ids.length - pos} more (click)</span></div>`;
        m.addEventListener('click', ev => { ev.stopPropagation(); m.remove(); more(); });
        container.appendChild(m);
      }
    };
    more();
  }

  function entityNode(i, depth) {
    const k = IX.kind(i);
    const kids = (CLS.has(k) || k === 'ns' || k === 'xns' || k === 'enum') ? IX.children(i).filter(c => IX.kind(c) !== 'unit') : [];
    const st = IX.status(i) ? U.st(IX.status(i)) : '';
    let label = IX.name(i);
    const p = IX.parent(i);
    if (depth > 0 && p !== null && CLS.has(IX.kind(p)) && IX.unit(p) !== IX.unit(i)) label = IX.name(p).replace(/<.*$/, '<…>') + '::' + label;
    if (k === 'ns' && label.startsWith('(anonymous@')) label = '(anonymous namespace)';
    const el = row({ label: U.esc(label), kb: U.kb(k), st, count: kids.length || '', href: IX.href(i),
                     expandable: kids.length > 0, depth, id: i, key: 'e' + i });
    if (kids.length) attachLazy(el, c => appendChunked(c, sortIds(kids), depth + 1, entityNode));
    return el;
  }

  function unitNode(u, depth) {
    IX.buildUnitKids();
    const kids = IX.unitKids.get(u) || [];
    const el = row({ label: U.esc(IX.name(u)), kb: U.kb('unit'), st: U.st(unitStatus(u)), count: kids.length || '',
                     href: IX.href(u), expandable: kids.length > 0, depth, id: u, key: 'u' + u });
    if (kids.length) attachLazy(el, c => appendChunked(c, sortIds(kids), depth + 1, entityNode));
    return el;
  }

  function dirNode(n, depth, label) {
    const el = row({ label: U.esc(label || n.name) + '/', count: n.count, expandable: true, depth, key: 'd' + n.key });
    attachLazy(el, c => {
      const frag = document.createDocumentFragment();
      [...n.dirs.values()].sort((a, b) => a.name.localeCompare(b.name)).forEach(d => frag.appendChild(dirNode(d, depth + 1)));
      c.appendChild(frag);
      appendChunked(c, n.units.slice().sort((a, b) => IX.nameL[a].localeCompare(IX.nameL[b])), depth + 1, unitNode);
    });
    return el;
  }

  // -------------------------------------------------------------- tabs
  function showDirs() {
    dirTree = dirTree || buildDirTree();
    root.innerHTML = '';
    const labels = { src: 'src  (game code)', lib: 'lib  (al, sead, agl, nn…)', unknown: 'unknown' };
    for (const d of [...dirTree.dirs.values()].sort((a, b) => (a.name === 'src' ? -1 : b.name === 'src' ? 1 : a.name.localeCompare(b.name)))) {
      const el = dirNode(d, 0, labels[d.name] ? d.name : d.name);
      root.appendChild(el);
      if (d.name === 'src') toggle(el, true);
    }
  }

  function showNamespaces() {
    root.innerHTML = '';
    const roots = [];
    const globals = [];
    for (let i = 0; i < IX.E.length; i++) {
      if (IX.E[i][3] >= 0) continue;
      const k = IX.kind(i);
      if (k === 'ns' || k === 'xns') roots.push(i);
      else if (k !== 'unit' && k !== 'macro') globals.push(i);
    }
    const g = row({ label: '<i>(global namespace)</i>', count: globals.length, expandable: true, key: 'global' });
    attachLazy(g, c => appendChunked(c, sortIds(globals), 1, entityNode));
    root.appendChild(g);
    const isAnon = i => IX.slug(i).startsWith('(anonymous@');
    const anon = roots.filter(isAnon);
    appendChunked(root, sortIds(roots.filter(i => !isAnon(i))), 0, entityNode);
    if (anon.length) {
      const a = row({ label: '<i>(anonymous namespaces of .cpp files)</i>', count: anon.length, expandable: true, key: 'anon' });
      attachLazy(a, c => appendChunked(c, anon.slice().sort((x, y) => IX.qL[x].localeCompare(IX.qL[y])), 1, (i, d) => {
        const el = entityNode(i, d); el.querySelector('.tn-label').textContent = IX.q(i).replace(/^\(anonymous@(.*)\)$/, '$1'); return el;
      }));
      root.appendChild(a);
    }
  }

  function showPages() {
    root.innerHTML = '';
    const pages = [
      ['#/', 'Home'], ['#/progress', 'Decompilation progress'], ['#/classes', 'All classes (A–Z)'],
      ['#/functions', 'All functions'], ['#/namespaces', 'All namespaces'], ['#/hierarchy', 'Class hierarchy'],
      ['#/nerves', 'Nerves (states) per class'], ['#/factories', 'Factories (actor names → classes)'],
      ['#/enums', 'Enums'], ['#/typedefs', 'Typedefs & aliases'], ['#/vars', 'Global / static variables'],
      ['#/macros', 'Macros'], ['#/symbols', 'Data symbols (addresses)'], ['#/strings', 'Binary strings'],
      ['#/files', 'File tree'], ['#/about', 'About / legend'],
    ];
    for (const [h, l] of pages) {
      const el = row({ label: U.esc(l), href: h, key: 'p' + h });
      root.appendChild(el);
    }
  }

  function showFiltered(q) {
    root.innerHTML = '';
    const ql = q.toLowerCase();
    const res = [];
    if (tab === 'dirs') {
      for (let i = 0; i < IX.E.length && res.length < 300; i++)
        if (IX.kind(i) === 'unit' && IX.qL[i].includes(ql)) res.push(i);
      res.forEach(u => { const el = unitNode(u, 0); el.querySelector('.tn-label').textContent = IX.q(u); root.appendChild(el); });
    } else {
      const ok = new Set(['ns', 'xns', 'class', 'struct', 'union', 'tclass', 'xclass', 'enum']);
      for (let i = 0; i < IX.E.length && res.length < 300; i++)
        if (ok.has(IX.kind(i)) && IX.qL[i].includes(ql)) res.push(i);
      res.forEach(i => { const el = entityNode(i, 0); el.querySelector('.tn-label').textContent = IX.q(i); root.appendChild(el); });
    }
    if (!res.length) root.innerHTML = '<div class="tn-row dim" style="padding-left:12px">No results</div>';
  }

  function show() {
    const q = filterInput.value.trim();
    filterInput.classList.toggle('hidden', tab === 'pages');
    if (q && tab !== 'pages') return showFiltered(q);
    if (tab === 'dirs') showDirs();
    else if (tab === 'ns') showNamespaces();
    else showPages();
    markCurrent();
  }

  // -------------------------------------------------------------- reveal the current item
  let current = null;
  function markCurrent() {
    root.querySelectorAll('.tn-row.cur').forEach(r => r.classList.remove('cur'));
    if (current === null) return;
    const el = root.querySelector(`[data-id="${current}"] > .tn-row`) || root.querySelector(`[data-key="p${CSS.escape(location.hash || '#/')}"] > .tn-row`);
    if (el) el.classList.add('cur');
  }

  function reveal(i) {
    current = i;
    if (i === null || filterInput.value.trim()) { markCurrent(); return; }
    if (tab === 'dirs') {
      const u = IX.kind(i) === 'unit' ? i : IX.unit(i);
      if (u !== null) {
        const parts = IX.q(u).split('/');
        let key = '';
        for (let k = 0; k < parts.length - 1; k++) {
          key += parts[k] + '/';
          const d = root.querySelector(`[data-key="d${CSS.escape(key)}"]`);
          if (!d) break;
          toggle(d, true);
        }
        if (u !== i) {
          const ue = root.querySelector(`[data-key="u${u}"]`);
          if (ue) {
            toggle(ue, true);
            // open the chain of parent classes
            const chain = [];
            let p = IX.parent(i);
            while (p !== null && CLS.has(IX.kind(p))) { chain.unshift(p); p = IX.parent(p); }
            for (const c of chain) { const ce = ue.querySelector(`[data-key="e${c}"]`); if (ce) toggle(ce, true); }
          }
        }
      }
    }
    markCurrent();
    const cur = root.querySelector('.tn-row.cur');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }

  function setup() {
    root = document.getElementById('tree');
    filterInput = document.getElementById('side-filter');
    document.querySelectorAll('#side-tabs button').forEach(b => b.addEventListener('click', () => {
      tab = b.dataset.tab;
      document.querySelectorAll('#side-tabs button').forEach(x => x.classList.toggle('on', x === b));
      try { localStorage.setItem('odoc-tab', tab); } catch (e) { }
      show();
    }));
    try {
      const t = localStorage.getItem('odoc-tab');
      if (t) { tab = t; document.querySelectorAll('#side-tabs button').forEach(x => x.classList.toggle('on', x.dataset.tab === t)); }
    } catch (e) { }
    filterInput.addEventListener('input', U.debounce(show, 120));
    root.addEventListener('click', e => {
      const r = e.target.closest('.tn-row');
      if (!r) return;
      const el = r.parentElement;
      if (e.target.closest('.tn-tw') || !el._href) { toggle(el); return; }
      if (el._fill && !el.classList.contains('open')) toggle(el, true);
      location.hash = el._href;
      document.body.classList.remove('side-open');
    });
    show();
  }

  return { setup, reveal, show, get ready() { return !!root; } };
})();
