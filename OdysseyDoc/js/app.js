/* OdysseyDoc — startup and router (#/...). */
'use strict';

let lastEntity = null;
const APP = (() => {
  const main = () => document.getElementById('main');

  async function route() {
    const m = main();
    const h = decodeURIComponent(location.hash.replace(/^#/, '')) || '/';
    const parts = h.split('/').filter((x, k) => k > 0);
    const [r, ...rest] = parts;
    const arg = rest.join('/');
    let cur = null;
    try {
      if (!r) P.home(m);
      else if (r === 'e') {
        const i = IX.bySlug.get(arg);
        if (i === undefined) {
          const ids = IX.fnByQ.get(arg);
          if (ids && ids.length) cur = ids[0], await P.entity(ids[0], m);
          else m.innerHTML = `<h1 class="page-title">Not found</h1><p>No entity named “${U.esc(arg)}”. <a href="#/search/${encodeURIComponent(arg.split('::').pop())}">Search</a></p>`;
        } else { cur = i; await P.entity(i, m); }
      }
      else if (r === 'src') { const [fi, line] = rest; await P.srcPage(+fi, line ? +line : null, m); }
      else if (r === 'search') P.searchPage(m, arg);
      else if (r === 'n') P.overloads(m, arg);
      else if (r === 'progress') P.progress(m);
      else if (r === 'files') P.filesPage(m, arg);
      else if (r === 'hierarchy') P.hierarchy(m, arg);
      else if (r === 'nerves') P.nerves(m);
      else if (r === 'factories') await P.factories(m);
      else if (r === 'strings') await P.strings(m);
      else if (r === 'symbols') await P.symbols(m);
      else if (r === 'about') P.about(m);
      else if (r === 'classes') P.listPage(m, 'All classes', ['class', 'struct', 'union', 'tclass', 'xclass'], 'Classes, structs, unions and templates declared in the decomp, plus classes inferred from binary symbols.', { binToggle: true });
      else if (r === 'functions') P.listPage(m, 'All functions', ['func', 'method', 'ctor', 'dtor', 'conv', 'tfunc', 'tmethod', 'sym'], 'Every function and method (decomp + binary). Filter by qualified name, e.g. <code>al::isNerve</code> or <code>Shine::exe</code>.', { binToggle: true, methods: true, per: 400 });
      else if (r === 'namespaces') P.listPage(m, 'Namespaces', ['ns', 'xns'], '');
      else if (r === 'enums') P.listPage(m, 'Enums', ['enum'], '');
      else if (r === 'typedefs') P.listPage(m, 'Typedefs & aliases', ['typedef', 'alias'], '');
      else if (r === 'vars') P.listPage(m, 'Variables', ['var'], 'Global and namespace variables, and static members.');
      else if (r === 'macros') P.listPage(m, 'Macros', ['macro'], 'Preprocessor macros defined in src/ and lib/.');
      else m.innerHTML = '<h1 class="page-title">Unknown page</h1>';
    } catch (e) {
      console.error(e);
      m.innerHTML = `<div class="note warn">Erreur : ${U.esc(e.message)}</div>`;
    }
    lastEntity = cur;
    if (TREE.ready) TREE.reveal(cur);
    const title = cur !== null ? IX.q(cur) : (r || 'Home');
    document.title = `${title} — OdysseyDoc`;
    window.scrollTo(0, 0);
  }

  function theme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('odoc-theme', t); } catch (e) { }
  }

  async function start() {
    let t = null;
    try { t = localStorage.getItem('odoc-theme'); } catch (e) { }
    theme(t || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    document.getElementById('theme-btn').addEventListener('click', () => theme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
    document.getElementById('menu-btn').addEventListener('click', () => document.body.classList.toggle('side-open'));
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-copy]');
      if (b) { U.copy(b.dataset.copy); b.textContent = '✓'; setTimeout(() => (b.textContent = '⧉'), 900); }
    });
    SEARCH.setup();
    const target = decodeURIComponent(location.hash.replace(/^#\/?(e\/)?/, ''));
    const ld = document.getElementById('loading');
    if (ld && target) ld.textContent = `Loading index, then opening ${target}…`;
    try {
      const d = await DOC.load('index');
      IX.init(d);
    } catch (e) {
      main().innerHTML = `<div class="note warn">Could not load <code>data/index.js</code>. Make sure the <code>data/</code> folder sits next to <code>index.html</code>.<br>${U.esc(e.message)}</div>`;
      return;
    }
    window.addEventListener('hashchange', route);
    // render the requested page first, then build the sidebar
    await route();
    TREE.setup();
    TREE.reveal(lastEntity);
  }

  return { start };
})();

document.addEventListener('DOMContentLoaded', APP.start);
