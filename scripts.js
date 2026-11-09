/* =====================================================
   Wibigen — site scripts
   Every block only runs on the pages that have the
   matching elements, so this one file is shared by all.
   ===================================================== */

/* ---------- Settings: edit these ---------- */
const CONFIG = {
  // YouTube Data API v3. This key is public in the page source:
  // restrict it to "wibigen.github.io/*" in the Google Cloud Console.
  youtubeApiKey: 'AIzaSyCI-0n3CfEwlbW_t5ROp1k2U1mH0hlwuM4',
  youtubeChannelId: 'UCPntukjCpAnk4hoeqCcRgfw',
  // Shown on the Content page if the YouTube API can't be reached.
  fallbackVideo: { id: 'Z658vDqZJhY', title: 'System Fix (All Coin) - Geometry Dash' },

  twitchLogin: 'wibigen',
  discordInvite: 'JNUA7q6dcx',

  // GameBanana: your member ID (the number in your profile URL,
  // gamebanana.com/members/XXXXXX). Leave null to detect it from the
  // first mod below.
  gamebananaMemberId: null,
  // Known submissions. They are always shown, even if the automatic
  // listing misses them, and they are used to find your member ID.
  // New mods you upload appear automatically — no need to add them here.
  gamebananaKnown: [
    'Mod/718091', 'Mod/716479', 'Mod/688406', 'Mod/681980', 'Mod/681823',
    'Mod/665218', 'Wip/99325', 'Mod/664938', 'Mod/662800', 'Mod/630379',
    'Mod/627806',
  ],
  cacheMinutes: 30,
};

const GB_API = 'https://gamebanana.com/apiv11';

/* ---------- Small helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const nf = new Intl.NumberFormat('en-US');
function compact(n) {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}
function niceDate(ts) {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function cacheGet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    if (Date.now() - t > CONFIG.cacheMinutes * 60000) return null;
    return v;
  } catch { return null; }
}
function cacheSet(key, v) {
  try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch { /* storage off */ }
}

async function getJSON(url, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- Header: active link + mobile menu ---------- */
(function header() {
  const current = window.location.pathname.split('/').pop() || 'index.html';
  $$('.nav a').forEach(link => {
    if (link.getAttribute('href') === current) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }
  });

  const head = $('.header');
  const btn = $('.menu-btn');
  if (head && btn) {
    btn.addEventListener('click', () => {
      const open = head.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
  }

  $$('.year').forEach(e => { e.textContent = new Date().getFullYear(); });
})();

/* ---------- Fade-in on scroll ---------- */
(function reveal() {
  const items = $$('.reveal');
  if (!items.length) return;
  if (!('IntersectionObserver' in window)) { items.forEach(i => i.classList.add('visible')); return; }
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); }
    });
  }, { threshold: 0.1 });
  items.forEach(i => io.observe(i));
})();

/* =====================================================
   Stats page
   ===================================================== */
function setStat(id, value) {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = value;
  node.classList.remove('loading');
}

async function youtubeStats() {
  if (!document.getElementById('Yviews')) return;
  try {
    const data = await getJSON(`https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${CONFIG.youtubeChannelId}&key=${CONFIG.youtubeApiKey}`);
    const s = data.items[0].statistics;
    setStat('Ysubscribers', s.hiddenSubscriberCount ? 'Hidden' : nf.format(s.subscriberCount));
    setStat('Yviews', nf.format(s.viewCount));
    setStat('Yvideos', nf.format(s.videoCount));
  } catch (err) {
    console.warn('YouTube stats unavailable:', err);
    ['Ysubscribers', 'Yviews', 'Yvideos'].forEach(id => setStat(id, '—'));
  }
}

async function twitchStatus() {
  const node = document.getElementById('Tstatus');
  if (!node) return;
  try {
    const res = await fetch(`https://decapi.me/twitch/uptime/${CONFIG.twitchLogin}`);
    const text = (await res.text()).trim();
    if (!res.ok) throw new Error(text);
    const offline = /offline/i.test(text);
    setStat('Tstatus', offline ? 'Offline' : 'Live now');
    if (!offline) node.style.color = '#ff5c5c';
  } catch (err) {
    console.warn('Twitch status unavailable:', err);
    setStat('Tstatus', '—');
  }
}

async function discordStats() {
  if (!document.getElementById('Dmembers')) return;
  try {
    const data = await getJSON(`https://discord.com/api/v10/invites/${CONFIG.discordInvite}?with_counts=true`);
    setStat('Dmembers', nf.format(data.approximate_member_count));
    setStat('Donline', nf.format(data.approximate_presence_count));
    setStat('Dboosts', nf.format(data.guild?.premium_subscription_count ?? 0));
  } catch (err) {
    // Keep the numbers written in the HTML
    console.warn('Discord stats unavailable:', err);
    $$('#Dmembers, #Donline, #Dboosts').forEach(n => n.classList.remove('loading'));
  }
}

/* =====================================================
   Content page: latest uploads
   ===================================================== */
async function latestVideos() {
  const frame = $('#main-video');
  if (!frame) return;
  const grid = $('#video-grid');
  const title = $('#main-video-title');
  const date = $('#main-video-date');

  function play(v, autoplay) {
    frame.src = `https://www.youtube-nocookie.com/embed/${v.id}${autoplay ? '?autoplay=1' : ''}`;
    frame.title = v.title;
    title.textContent = v.title;
    date.textContent = v.date ? `Published ${v.date}` : '';
  }

  let videos = cacheGet('yt-latest-v1');
  if (!videos) {
    try {
      // Every channel's uploads playlist is its ID with "UC" replaced by "UU"
      const playlist = 'UU' + CONFIG.youtubeChannelId.slice(2);
      const data = await getJSON(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=7&playlistId=${playlist}&key=${CONFIG.youtubeApiKey}`);
      videos = data.items
        .filter(i => i.snippet.resourceId?.videoId)
        .map(i => ({
          id: i.snippet.resourceId.videoId,
          title: i.snippet.title,
          date: new Date(i.snippet.publishedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
          thumb: (i.snippet.thumbnails.high || i.snippet.thumbnails.medium || i.snippet.thumbnails.default).url,
        }));
      if (videos.length) cacheSet('yt-latest-v1', videos);
    } catch (err) {
      console.warn('Latest videos unavailable:', err);
      videos = null;
    }
  }

  if (!videos || !videos.length) {
    play(CONFIG.fallbackVideo, false);
    $('#recent-section')?.remove();
    return;
  }

  play(videos[0], false);
  grid.replaceChildren(...videos.slice(1).map(v => {
    const card = el('button', { class: 'card video-card reveal visible', type: 'button', 'aria-label': `Play ${v.title}` },
      el('div', { class: 'thumb', style: `background-image:url("${v.thumb}")` }),
      el('div', { class: 'body' }, el('h3', { text: v.title }), el('time', { text: v.date })));
    card.addEventListener('click', () => {
      play(v, true);
      $('.video-main').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return card;
  }));
  if (videos.length < 2) $('#recent-section')?.remove();
}

/* =====================================================
   WibiDev page: mods pulled from GameBanana
   ===================================================== */
const ICONS = {
  like: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2 0 3.5 1.1 4.2 2.4.7-1.3 2.2-2.4 4.2-2.4 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z"/></svg>',
  view: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5C6.5 5 2.3 9.4 1 12c1.3 2.6 5.5 7 11 7s9.7-4.4 11-7c-1.3-2.6-5.5-7-11-7zm0 11a4 4 0 110-8 4 4 0 010 8z"/></svg>',
  dl: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 3h2v9.6l3.3-3.3 1.4 1.4L12 16.4 6.3 10.7l1.4-1.4L11 12.6V3zM4 18h16v2H4z"/></svg>',
};

// Turns any GameBanana record (index row or profile page) into one shape
function normalizeGB(r) {
  if (!r || !r._idRow) return null;
  if (r._bIsPrivate || r._bIsTrashed || r._bIsWithheld) return null;
  const img = r._aPreviewMedia?._aImages?.[0];
  const model = r._sModelName || 'Mod';
  return {
    key: `${model}/${r._idRow}`,
    id: r._idRow,
    model,
    name: r._sName || 'Untitled',
    url: r._sProfileUrl || `https://gamebanana.com/${model.toLowerCase()}s/${r._idRow}`,
    image: img ? `${img._sBaseUrl}/${img._sFile530 || img._sFile}` : null,
    game: r._aGame?._sName || 'Other',
    gameIcon: r._aGame?._sIconUrl || null,
    category: r._aRootCategory?._sName || r._aCategory?._sName || '',
    desc: r._sDescription || '',
    likes: r._nLikeCount ?? null,
    views: r._nViewCount ?? null,
    downloads: r._nDownloadCount ?? null,
    added: r._tsDateAdded || 0,
    updated: r._tsDateUpdated || r._tsDateModified || r._tsDateAdded || 0,
  };
}

async function gbProfile(key) {
  const data = await getJSON(`${GB_API}/${key}/ProfilePage`);
  return data;
}

// Lists every Mod and WIP of a member, page by page
async function gbListMember(memberId) {
  const out = [];
  for (const model of ['Mod', 'Wip']) {
    for (let page = 1; page <= 10; page++) {
      const url = `${GB_API}/${model}/Index?_nPage=${page}&_nPerpage=50&_aFilters%5BGeneric_Submitter%5D=${memberId}`;
      let data;
      try { data = await getJSON(url); } catch (err) { console.warn(`GameBanana ${model} list failed:`, err); break; }
      const rows = data._aRecords || [];
      out.push(...rows.map(r => ({ _sModelName: model, ...r })));
      if (data._aMetadata?._bIsComplete !== false || !rows.length) break;
    }
  }
  return out;
}

async function loadMods() {
  const cached = cacheGet('gb-mods-v1');
  if (cached) return cached;

  const byKey = new Map();
  const add = rec => {
    const m = normalizeGB(rec);
    if (!m) return;
    const prev = byKey.get(m.key) || {};
    // Keep earlier values when the new record lacks them
    for (const [k, v] of Object.entries(m)) if (v == null || v === '' || v === 0) m[k] = prev[k] ?? v;
    byKey.set(m.key, m);
  };

  // 1. Find the member ID (and profile link) from the first known mod
  let memberId = CONFIG.gamebananaMemberId;
  let profileUrl = memberId ? `https://gamebanana.com/members/${memberId}` : null;
  const known = [...CONFIG.gamebananaKnown];
  if (!memberId && known.length) {
    for (const key of known.slice(0, 3)) {
      try {
        const first = await gbProfile(key);
        add({ _sModelName: key.split('/')[0], ...first });
        memberId = first._aSubmitter?._idRow;
        profileUrl = first._aSubmitter?._sProfileUrl || (memberId && `https://gamebanana.com/members/${memberId}`);
        known.splice(known.indexOf(key), 1);
        break;
      } catch (err) { console.warn('GameBanana lookup failed for', key, err); }
    }
  }

  // 2. Everything the member has published
  if (memberId) (await gbListMember(memberId)).forEach(add);

  // 3. Fill in details (description, downloads) and any known item the list missed
  const toDetail = [...new Set([...known, ...byKey.keys()])].filter(k => !byKey.get(k)?.desc);
  await Promise.all(toDetail.map(async key => {
    try { add({ _sModelName: key.split('/')[0], ...(await gbProfile(key)) }); }
    catch (err) { console.warn('GameBanana details failed for', key, err); }
  }));

  const result = { mods: [...byKey.values()], profileUrl };
  if (result.mods.length) cacheSet('gb-mods-v1', result);
  return result;
}

function stripHtml(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return (d.textContent || '').replace(/\s+/g, ' ').trim();
}

function modCard(m) {
  const isNew = m.added && (Date.now() / 1000 - m.added) < 30 * 86400;
  const badges = el('div', { class: 'badges' },
    m.model === 'Wip' ? el('span', { class: 'badge wip', text: 'Work in progress' }) : null,
    isNew ? el('span', { class: 'badge new', text: 'New' }) : null,
    m.category ? el('span', { class: 'badge', text: m.category }) : null);

  const thumb = el('div', { class: 'mod-thumb' },
    m.image ? el('img', { src: m.image, alt: '', loading: 'lazy' }) : null, badges);

  const stats = el('div', { class: 'mod-stats' });
  const stat = (icon, n, label) => {
    if (n == null) return;
    const s = el('span', { title: `${nf.format(n)} ${label}` });
    s.innerHTML = icon;
    s.append(compact(n));
    stats.append(s);
  };
  stat(ICONS.like, m.likes, 'likes');
  stat(ICONS.view, m.views, 'views');
  stat(ICONS.dl, m.downloads, 'downloads');
  stats.append(el('time', { datetime: new Date(m.updated * 1000).toISOString(), text: niceDate(m.updated) }));

  const desc = m.desc ? stripHtml(m.desc) : '';
  return el('a', { class: 'card mod-card reveal', href: m.url, target: '_blank', rel: 'noopener' },
    thumb,
    el('div', { class: 'mod-body' },
      el('div', { class: 'mod-game' },
        m.gameIcon ? el('img', { src: m.gameIcon, alt: '', loading: 'lazy' }) : null,
        el('span', { text: m.game })),
      el('h3', { text: m.name }),
      desc ? el('p', { class: 'mod-desc', text: desc }) : null,
      stats));
}

function fallbackBanners(grid) {
  // GameBanana's own embeddable banners: they work even when the API doesn't
  grid.replaceChildren(...CONFIG.gamebananaKnown.map(key => {
    const [model, id] = key.split('/');
    const path = model === 'Wip' ? 'wips' : 'mods';
    return el('a', { class: 'card mod-banner', href: `https://gamebanana.com/${path}/${id}`, target: '_blank', rel: 'noopener' },
      el('img', { src: `https://gamebanana.com/${path}/embeddables/${id}?type=large`, alt: `GameBanana ${model} ${id}`, loading: 'lazy' }));
  }));
}

async function wibidev() {
  const grid = $('#mod-grid');
  if (!grid) return;

  const chips = $('#game-chips');
  const search = $('#mod-search');
  const sort = $('#mod-sort');
  const count = $('#mod-count');
  const credit = $('#gb-profile');

  let data;
  try { data = await loadMods(); } catch (err) { console.warn(err); data = { mods: [] }; }

  if (!data.mods.length) {
    fallbackBanners(grid);
    $('.toolbar')?.setAttribute('hidden', '');
    count.closest('.gb-credit')?.replaceChildren('Mods hosted on ', el('a', { href: 'https://gamebanana.com/', target: '_blank', rel: 'noopener', text: 'GameBanana' }));
    return;
  }
  if (data.profileUrl && credit) credit.href = data.profileUrl;

  const state = { game: 'All', q: '', sort: 'updated' };

  // One chip per game, busiest first
  const games = {};
  data.mods.forEach(m => { games[m.game] = (games[m.game] || 0) + 1; });
  const gameList = Object.entries(games).sort((a, b) => b[1] - a[1]);
  const chipFor = (name, n) => {
    const b = el('button', { class: 'chip', type: 'button', 'data-game': name }, name, el('span', { class: 'count', text: n }));
    b.addEventListener('click', () => { state.game = name; render(); });
    return b;
  };
  chips.replaceChildren(chipFor('All', data.mods.length), ...(gameList.length > 1 ? gameList.map(([g, n]) => chipFor(g, n)) : []));

  search.addEventListener('input', () => { state.q = search.value.trim().toLowerCase(); render(); });
  sort.addEventListener('change', () => { state.sort = sort.value; render(); });

  function render() {
    $$('.chip', chips).forEach(c => c.classList.toggle('active', c.dataset.game === state.game));
    const sorters = {
      updated: (a, b) => b.updated - a.updated,
      added: (a, b) => b.added - a.added,
      likes: (a, b) => (b.likes || 0) - (a.likes || 0),
      views: (a, b) => (b.views || 0) - (a.views || 0),
      downloads: (a, b) => (b.downloads || 0) - (a.downloads || 0),
    };
    const list = data.mods
      .filter(m => state.game === 'All' || m.game === state.game)
      .filter(m => !state.q || `${m.name} ${m.game} ${m.category}`.toLowerCase().includes(state.q))
      .sort(sorters[state.sort]);

    grid.replaceChildren(...(list.length
      ? list.map(modCard)
      : [el('p', { class: 'empty', text: 'No mod matches your search.' })]));
    requestAnimationFrame(() => $$('.reveal', grid).forEach((c, i) => setTimeout(() => c.classList.add('visible'), i * 40)));
    count.textContent = `${list.length} of ${data.mods.length} · `;
  }
  render();
}

/* ---------- Start ---------- */
youtubeStats();
twitchStatus();
discordStats();
latestVideos();
wibidev();
