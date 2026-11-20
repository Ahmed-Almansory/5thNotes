/* Folio 196 platform — boot, routing, portal home, bank boot, prefetch.
   Single-page platform: the portal home + all 7 question banks served from
   JSON data files. The question-bank UI itself lives in engine.js
   (runBankEngine — the v2.5 shell, wrapped as a function).
   Do NOT deploy from here; the deploy root is assembled by build_platform.py.
*/
(function () {
'use strict';

/* ---------- build-time flag ----------
   'history' — pushState, clean URLs /<bank>/<chapter> (Cloudflare Workers
               SPA fallback via not_found_handling: single-page-application).
   'hash'    — #/<bank>/<chapter> (GitHub Pages, which has no SPA fallback).
   Flip this one line to build the GitHub Pages variant. */
var ROUTE_MODE = 'hash';

var SLUGS = ['dermatology', 'chest', 'cardiology', 'tropical',
             'anesthesia', 'andrology', 'radiology'];
var SK = {
  dermatology: 'derma5',
  chest: 'chest-question-bank',
  cardiology: 'cardio-qb',
  tropical: 'tropical-medicine-5thnotes',
  anesthesia: 'anesthesia-qb',
  andrology: 'andrology-qb',
  radiology: 'radiology-qb'
};
/* Relative data URLs resolve against the page URL. In history mode the page
   can be /<bank>/..., so data must be root-absolute; in hash mode the page
   is always at the deploy root, so relative is correct (and required on
   GitHub Pages, where the site lives under /5thNotes/). */
var DATA_BASE = (ROUTE_MODE === 'history') ? '/data/' : 'data/';
var SW_URL = (ROUTE_MODE === 'history') ? '/sw.js' : 'sw.js';
var HOME_PATH = (ROUTE_MODE === 'history') ? '/' : '#/';

var PREFETCH_AHEAD = 50; /* questions, not images */

function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function hexRgb(hex) {
  var h = String(hex).replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16),
          parseInt(h.slice(4, 6), 16)];
}

/* ---------- routing ---------- */
function routeFromParts(parts) {
  if (!parts.length || !parts[0]) return { bank: null, view: null };
  var slug = parts[0];
  if (SLUGS.indexOf(slug) < 0) return { bank: null, view: null };
  if (parts.length === 1) return { bank: slug, view: null };
  var v = parts[1];
  if (v === 'all') return { bank: slug, view: 'all' };
  if (v === 'notes') return { bank: slug, view: '__notes' };
  if (v === 'quiz') return { bank: slug, view: '__quiz' };
  if (v === 'cat' && parts[2]) return { bank: slug, view: '__cat_' + parts[2] };
  return { bank: slug, view: v }; /* chapter name (decoded) */
}
function parseRoute() {
  if (ROUTE_MODE === 'hash') {
    var h = location.hash.replace(/^#\/?/, '');
    if (!h) return { bank: null, view: null };
    return routeFromParts(h.split('/').map(decodeURIComponent));
  }
  var parts = location.pathname.replace(/^\/+|\/+$/g, '').split('/')
    .filter(Boolean).map(decodeURIComponent);
  /* tolerate a sub-path deploy: drop a leading segment that is not a bank */
  if (parts.length > 1 && SLUGS.indexOf(parts[0]) < 0 &&
      SLUGS.indexOf(parts[1]) >= 0) parts.shift();
  return routeFromParts(parts);
}
var bootedBank = null; /* slug the engine is booted for (null = not booted) */
function bankPath(slug) {
  return (ROUTE_MODE === 'hash') ? '#/' + slug : '/' + slug;
}
function urlForView(c) {
  var slug = bootedBank;
  if (!slug) return HOME_PATH;
  var path;
  if (c === null || c === undefined) path = '/' + slug;
  else if (c === 'all') path = '/' + slug + '/all';
  else if (c === '__notes') path = '/' + slug + '/notes';
  else if (c === '__quiz') path = '/' + slug + '/quiz';
  else if (typeof c === 'string' && c.indexOf('__cat_') === 0)
    path = '/' + slug + '/cat/' + c.slice(6);
  else path = '/' + slug + '/' + encodeURIComponent(c);
  return (ROUTE_MODE === 'hash') ? '#' + path : path;
}
/* The engine reads this global when it pushes history entries. */
window.PLATFORM = { mode: ROUTE_MODE, urlForView: urlForView };

/* ---------- Google Analytics 4 (owner-only stats) ----------
   Property "Folio 196", Measurement ID G-54EJBSV490. The snippet in
   index.html loads with send_page_view:false, so every page_view comes from
   here with a clean route path ('/' portal, '/dermatology', '/dermatology/all',
   '/cardiology/<chapter>' ...). One page_view per route change: portal opens,
   bank entries, chapter/view moves, and back/forward. The per-bank abacus
   counter (countBankOpen, above) stays as the lightweight open count. */
function gaPage(path) {
  try {
    if (typeof gtag === 'function') gtag('config', 'G-54EJBSV490', { page_path: path });
  } catch (e) {}
}
function routePath(slug, view) {
  var p = '/' + slug;
  if (view === 'all') p += '/all';
  else if (view === '__notes') p += '/notes';
  else if (view === '__quiz') p += '/quiz';
  else if (typeof view === 'string' && view.indexOf('__cat_') === 0) p += '/cat/' + view.slice(6);
  else if (typeof view === 'string' && view) p += '/' + encodeURIComponent(view);
  return p;
}
/* Engine chapter/view moves use history.pushState, which fires no route event
   — mirror each pushed route into GA as a page view with its clean path. */
(function () {
  try {
    var _pushState = history.pushState.bind(history);
    history.pushState = function (state, title, url) {
      var r = _pushState(state, title, url);
      if (typeof url === 'string' && url) gaPage(url.replace(/^#/, ''));
      return r;
    };
  } catch (e) {}
})();
/* History mode only: back/forward fires popstate (no hashchange). In hash
   mode the hashchange handler below already routes through bootBank/showPortal,
   so no popstate listener here — it would double-count. */
if (ROUTE_MODE !== 'hash') {
  window.addEventListener('popstate', function () {
    var r = parseRoute();
    gaPage(r.bank ? routePath(r.bank, r.view) : '/');
  });
}

/* ---------- portal data (from the Night Shift v4 portal's PAGES) ----------
   Counts come from data/index.json at runtime; the rest is portal copy. */
var PORTAL_META = {
  dermatology: { title: 'Dermatology MCQs', subtitle: '11 Chapters · Infections, inflammatory, allergic, vitiligo & hair',
    views: [['all', 'All Past Questions'], ['haw', 'Hawary Only'], ['zanq', 'El Zanqa']],
    chapters: 'Introduction, Infections, Inflammatory, Allergic, Vitiligo, Hair & Acne, Hawary, Paradox',
    tag: 'Dermatology', accent: '#b45309', deep: '#1e3a5f', notes: 'https://t.me/kafifthnotes/18' },
  chest: { title: 'Chest Question Bank', subtitle: '14 Chapters · Symptoms, examination, asthma, COPD, TB, ILD & pleura',
    views: [['all', 'All Past Questions'], ['haw', 'Hawary Only']],
    chapters: 'Symptoms, Examination, Syndromes, Asthma, COPD, TB, ILD, Pleural, Hawary Only',
    tag: 'Internal Medicine', accent: '#0d9488', deep: '#0b2545', notes: 'https://t.me/kafifthnotes/5' },
  cardiology: { title: 'Cardiology Question Bank', subtitle: '13 Chapters · ECG, arrhythmias, IHD, HTN, heart failure & valves',
    views: [['all', 'All Past Questions'], ['haw', 'Hawary Only'], ['zanq', 'El Zanqa']],
    chapters: 'History, Examination, ECG, Arrhythmias, IHD, HTN, Heart Failure, Valvular & Pericardial, Hawary Only, El Zanqa',
    tag: 'Internal Medicine', accent: '#b91c1c', deep: '#450a0a', notes: 'https://t.me/kafifthnotes/4' },
  tropical: { title: 'Tropical Medicine Question Bank', subtitle: '11 Chapters · GI symptoms, liver, hepatitis & portal hypertension',
    views: [['all', 'All Past Questions'], ['haw', 'Hawary Only'], ['zanq', 'El Zanqa']],
    chapters: 'Symptoms & Investigations, Abdominal Examination, Esophagus, Stomach & Duodenum, Diarrhea, Malabsorption & Constipation, IBD & GI Neoplasms, Liver Investigations & Jaundice, Hepatic Failure & Cirrhosis, Ascites, HRS & Portal Hypertension, Viral & Autoimmune Hepatitis, Metabolic, Vascular Liver Disease & Tumors, Gall Bladder & Pancreas, Hawary Only, El Zanqa',
    tag: 'Internal Medicine', accent: '#b45309', deep: '#14532d', notes: null },
  anesthesia: { title: 'Anesthesia Question Bank', subtitle: '8 Chapters · Preoperative assessment, general anesthetics, muscle relaxants, analgesics, local & regional, airway, CPR & complications',
    views: [['all', 'All Past Questions']],
    chapters: 'Preoperative Assessment & Premedication, General Anesthetics, Muscle Relaxants & Reversal, Analgesics, Antidotes & PONV, Local & Regional Anesthesia, Airway & Monitoring, CPR & Cardiac Arrest, Perioperative Complications',
    tag: 'Surgery', accent: '#0284c7', deep: '#1e293b', notes: null },
  andrology: { title: 'Andrology Question Bank', subtitle: '8 Chapters · Infertility & semen, erectile dysfunction, priapism & emergencies, ejaculatory disorders, syphilis, urethritis & STIs, HIV/AIDS, anatomy & endocrinology',
    views: [['all', 'All Past Questions']],
    chapters: 'Infertility, Semen & Spermatogenesis, Erectile Dysfunction, Priapism & Andrological Emergencies, Ejaculatory Disorders & Sexual Function, Syphilis, Urethritis, Genital Ulcers & Other STIs, HIV / AIDS, Anatomy, Endocrinology & Puberty',
    tag: 'Surgery', accent: '#6366f1', deep: '#1e1b4b', notes: null },
  radiology: { title: 'Radiology Question Bank', subtitle: '7 Chapters · Introduction, cardiothoracic, uroradiology, neuroradiology, women imaging, musculoskeletal, GIT & hepatobiliary',
    views: [['all', 'All Past Questions']],
    chapters: 'Introduction, Cardiothoracic Imaging, Uroradiology, Neuroradiology (CNS), Women Imaging, Musculoskeletal Imaging, GIT & Hepatobiliary Imaging',
    tag: 'Surgery', accent: '#ea580c', deep: '#431407', notes: null }
};
var ICONS = {
  Dermatology: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 8q3-2.5 6 0t6 0 6 0"/><path d="M2 13q3-2.5 6 0t6 0 6 0"/><path d="M2 18q3-2.5 6 0t6 0 6 0"/></svg>',
  Chest: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v5.5"/><path d="M12 8.5L9.8 11.2M12 8.5l2.2 2.7"/><path d="M11 9C9 6 5 6 3.8 9.5 2.5 13.5 3 18 5.5 20 8 22 11 20.5 11 17Z"/><path d="M13 9c2-3 6-3 7.2.5C21.5 13.5 21 18 18.5 20 16 22 13 20.5 13 17Z"/></svg>',
  Cardiology: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/><path d="M4.5 12.5h2.6l1.4-2.8 2.4 5.6 1.9-4.2 1.2 1.4h2.5"/></svg>',
  Tropical: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13C4 8.5 8 5.5 12.5 5.5 17 5.5 21 8 21 11.5 21 14.8 18 17 14.5 17.8 13 18.1 11.5 17.5 10 17 7 16 2.5 16 3 13Z"/><path d="M12.5 5.5C12.5 9.5 12.3 13.5 11.8 17.5"/><path d="M15 17.9C15 19.8 16.2 21 17.3 20.6 18.4 20.2 18.5 18.8 17.8 17.6"/></svg>',
  Anesthesia: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="6" y="8" width="10" height="8" rx="1.5"/><path d="M2 12h4M2 9.5v5M16 12h5M9 8v2.5M12 8v2.5M15 8v2.5"/></svg>',
  Andrology: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="10" cy="14" r="5.5"/><path d="M14 10L20.5 3.5M15.5 3.5h5v5"/></svg>',
  Radiology: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12L12 3A9 9 0 0 1 19.8 7.5Z"/><path d="M12 12L12 3A9 9 0 0 1 19.8 7.5Z" transform="rotate(120 12 12)"/><path d="M12 12L12 3A9 9 0 0 1 19.8 7.5Z" transform="rotate(240 12 12)"/><circle cx="12" cy="12" r="1.8"/></svg>'
};

/* ---------- per-bank header + theme (inlined into index.html) ---------- */
var BANK_CHROME = null;
try { BANK_CHROME = JSON.parse($('bankChrome').textContent); } catch (e) { BANK_CHROME = {}; }

function bankThemeCss(t) {
  var rgb = hexRgb(t.teal);
  var rgba = function (a) { return 'rgba(' + rgb.join(',') + ',' + a + ')'; };
  return '#bankView{--teal:' + t.teal + ';--teal-hover:' + t.tealHover +
    ';--hd1:' + t.teal + ';--hd2:' + t.hd2 + ';--soft:' + t.soft + '}' +
    '#bankView header::after{background:linear-gradient(90deg,' + t.teal + ',' +
    rgba(0.2) + ' 60%,transparent)}' +
    '#bankView .tg{background:linear-gradient(135deg,' + t.teal + ' 0%,' + t.hd2 +
    ' 100%);border-color:' + rgba(0.35) + '}' +
    '#bankView .prog i{background:linear-gradient(90deg,var(--teal),' + t.tealDark + ')}' +
    'html[data-theme=dark] #bankView{--teal:' + t.tealDark + ';--teal-hover:' +
    t.tealHoverDark + ';--hd1:' + t.teal + ';--soft:' + t.softDark + '}' +
    '@media (prefers-color-scheme: dark){html:not([data-theme=light]) #bankView' +
    '{--teal:' + t.tealDark + ';--teal-hover:' + t.tealHoverDark + ';--hd1:' +
    t.teal + ';--soft:' + t.softDark + '}}';
}
function applyBankChrome(slug) {
  var c = BANK_CHROME[slug];
  if (!c) return;
  var t = c.theme, rgb = hexRgb(t.teal);
  document.title = c.title;
  $('bankMotif').innerHTML = c.motif;
  $('bankH1').textContent = c.h1;
  var badge = $('bankH1Badge');
  badge.style.background = 'rgba(' + rgb.join(',') + ',.25)';
  badge.style.borderColor = 'rgba(' + rgb.join(',') + ',.45)';
  $('bankSub').innerHTML = c.sub;
  $('bankColl').textContent = c.coll;
  $('ns').placeholder = c.notesPlaceholder;
  $('bankHelpH3').textContent = 'How to use Folio 196 ' + c.helpSubject;
  var tgPath = document.querySelector('#bankView .tg path');
  if (tgPath) tgPath.style.fill = t.tealHover;
  var st = $('bankTheme');
  if (!st) {
    st = document.createElement('style');
    st.id = 'bankTheme';
    document.head.appendChild(st);
  }
  st.textContent = bankThemeCss(t);
}

/* ---------- portal home ---------- */
var portalIndex = null; /* data/index.json, fetched once */
var portalWired = false;

function fetchIndex() {
  if (portalIndex) return Promise.resolve(portalIndex);
  return fetch(DATA_BASE + 'index.json').then(function (r) {
    if (!r.ok) throw new Error('index.json HTTP ' + r.status);
    return r.json();
  }).then(function (d) { portalIndex = d; return d; });
}

function bankName(meta) {
  return meta.title.replace(/ (Question Bank|MCQs)$/, '')
    .replace(/^Tropical Medicine$/, 'Tropical');
}

function renderCards() {
  var q = ($('searchInput').value || '').toLowerCase().trim();
  var banks = (portalIndex && portalIndex.banks) || [];
  var grid = $('cardsGrid');
  var filtered = banks.filter(function (b) {
    var p = PORTAL_META[b.slug];
    if (!p) return false;
    return (p.title + ' ' + p.subtitle + ' ' + (p.chapters || '') + ' ' + p.tag +
      ' ' + p.views.map(function (v) { return v[1]; }).join(' ')).toLowerCase().includes(q);
  });
  var bookEl = $('bookCard');
  var bookSearch = 'dermatology complete book tables images notes';
  bookEl.style.display = (!q || bookSearch.indexOf(q) >= 0) ? '' : 'none';
  var flashEl = $('flashCard');
  var flashSearch = 'flashcards spaced repetition fsrs decks cards internal medicine ashraf zaki review study';
  flashEl.style.display = (!q || flashSearch.indexOf(q) >= 0) ? '' : 'none';
  $('flashSection').style.display = flashEl.style.display;
  $('booksSection').style.display = bookEl.style.display;
  if (!filtered.length) {
    grid.innerHTML = '<p style="color:var(--mut)">No matching subjects found.</p>';
    return;
  }
  grid.innerHTML = filtered.map(function (b) {
    var p = PORTAL_META[b.slug];
    var name = bankName(p);
    var nmfs = name.length <= 5 ? '15.5cqw' : name.length <= 8 ? '13.5cqw' : '12.5cqw';
    return '\n    <div class="cell">\n      <a class="card" href="' + bankPath(b.slug) +
      '" style="--accent:' + p.accent + ';--deep:' + p.deep + ';--nmfs:' + nmfs + '">' +
      '\n        <span class="card-icon">' + (ICONS[name] || '') + '</span>' +
      '\n        <div class="card-top">\n          <span class="card-tag">' + esc(p.tag) +
      '</span>\n          <span class="card-arrow">\u2197</span>\n        </div>' +
      '\n        <div class="card-name">\n          <span class="nm">' + esc(name) +
      '</span>\n          <span class="kind">MCQs</span>\n        </div>' +
      '\n        <div class="card-meta"><span>' + b.questionCount + ' Questions</span></div>' +
      '\n      </a>' +
      (p.notes ? '\n      <a class="notes-btn" href="' + p.notes +
        '" target="_blank" rel="noopener noreferrer">\uD83D\uDCC4 Open Revision Notes PDF \u2197</a>' : '') +
      '\n    </div>';
  }).join('');
}

function renderProgress() {
  var banks = (portalIndex && portalIndex.banks) || [];
  var rows = banks.map(function (b) {
    var p = PORTAL_META[b.slug];
    var total = b.questionCount || 0, answered = 0;
    try {
      var raw = localStorage.getItem(SK[b.slug]);
      if (raw) answered = Object.keys(JSON.parse(raw) || {}).length;
    } catch (e) {}
    return { name: bankName(p), total: total, answered: Math.min(answered, total),
             accent: p.accent, deep: p.deep, slug: b.slug };
  });
  var totalQ = rows.reduce(function (s, r) { return s + r.total; }, 0);
  var totalA = rows.reduce(function (s, r) { return s + r.answered; }, 0);
  var pct = totalQ ? Math.round(totalA / totalQ * 100) : 0;
  $('progressOverall').innerHTML = '<b>' + totalA.toLocaleString('en-US') + '</b> / ' +
    totalQ.toLocaleString('en-US') + ' &middot; <b>' + pct + '%</b>';
  $('progressTotalBar').style.width = pct + '%';
  $('progressRows').innerHTML = rows.map(function (r) {
    var p = r.total ? Math.round(r.answered / r.total * 100) : 0;
    return '<a class="progress-row" href="' + bankPath(r.slug) + '">' +
      '<span class="progress-dot" style="background:' + r.accent + '"></span>' +
      '<span class="progress-name">' + esc(r.name) + '</span>' +
      '<span class="progress-track"><span style="width:' + p + '%;background:linear-gradient(90deg,' +
      r.deep + ',' + r.accent + ')"></span></span>' +
      '<span class="progress-count"><b>' + r.answered + '</b> / ' + r.total +
      ' &middot; ' + p + '%</span></a>';
  }).join('');
  if (totalA === 0) {
    document.querySelector('.progress-note').textContent =
      'No progress yet — solve any bank and your progress will appear here.';
  }
}

function renderMenu() {
  var banks = (portalIndex && portalIndex.banks) || [];
  $('menuBanks').innerHTML = banks.map(function (b) {
    var p = PORTAL_META[b.slug];
    return '\n    <a class="menu-link" href="' + bankPath(b.slug) + '">' +
      '\n      <span class="menu-dot" style="background:' + p.accent + '"></span>' +
      '\n      <span class="menu-label">' + esc(p.title) + '</span>' +
      '\n      <span class="menu-meta">' + b.questionCount + ' Questions</span>\n    </a>';
  }).join('');
}

function renderPortal() {
  return fetchIndex().then(function () {
    renderCards();
    renderProgress();
    renderMenu();
  }).catch(function (err) {
    $('cardsGrid').innerHTML = '<p style="color:var(--mut)">Could not load the banks list. ' +
      'Check your connection and reload.</p>';
    console.error('portal index failed:', err);
  });
}

function wirePortalOnce() {
  if (portalWired) return;
  portalWired = true;
  /* history-mode asset fix: the page can be /<bank>/..., so the logo must be
     root-absolute there; in hash mode the page is at the deploy root. */
  if (ROUTE_MODE === 'history') {
    document.querySelectorAll('#portalView img[src="logo.jpg"]').forEach(function (img) {
      img.setAttribute('src', '/logo.jpg');
    });
  }
  /* the side-menu Flashcards link is relative in the portal markup; make it
     absolute so it works from any route */
  var menuFlash = document.querySelector('#sideMenu a[href="Folio196%20Flashcards.html"]');
  if (menuFlash) {
    menuFlash.setAttribute('href',
      'https://ahmed-almansory.github.io/5thNotes/Folio196%20Flashcards.html');
    menuFlash.setAttribute('target', '_blank');
    menuFlash.setAttribute('rel', 'noopener noreferrer');
  }
  $('searchInput').addEventListener('input', renderCards);
  $('themeBtn').addEventListener('click', function () {
    var root = document.documentElement;
    var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('folio196-theme', next); } catch (e) {}
  });
  document.querySelectorAll('.hero-hint button').forEach(function (b) {
    b.addEventListener('click', function () {
      $('searchInput').value = b.dataset.q;
      $('searchInput').dispatchEvent(new Event('input'));
      $('banksSection').scrollIntoView();
    });
  });
  var toggle = $('progressToggle'), body = $('progressBody');
  toggle.addEventListener('click', function () {
    var open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
    body.hidden = open;
  });
  /* side menu */
  (function () {
    var menuBtn = $('menuBtn'), sideMenu = $('sideMenu'),
        overlay = $('menuOverlay'), closeBtn = $('menuClose');
    function openMenu() {
      document.body.classList.add('menu-open');
      menuBtn.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
      closeBtn.focus();
    }
    function closeMenu(returnFocus) {
      document.body.classList.remove('menu-open');
      menuBtn.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
      if (returnFocus) menuBtn.focus();
    }
    menuBtn.addEventListener('click', openMenu);
    closeBtn.addEventListener('click', function () { closeMenu(true); });
    overlay.addEventListener('click', function () { closeMenu(true); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('menu-open')) closeMenu(true);
    });
  })();
  /* visitor counter (portal visits only) */
  (function () {
    var el = $('visitorCount');
    fetch('https://abacus.jasoncameron.dev/hit/5thnotes-almansory/visits')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.value === undefined) throw new Error('bad response');
        el.textContent = Number(d.value).toLocaleString('en-US');
      })
      .catch(function (err) {
        console.error('Visitor counter failed:', err);
        el.parentElement.style.display = 'none';
      });
  })();
}

function showPortal() {
  gaPage('/');
  $('bankView').hidden = true;
  $('portalView').hidden = false;
  document.title = 'Folio 196 — Question Banks';
  wirePortalOnce();
  renderPortal();
}

/* ---------- bank boot ---------- */
function buildDB(slug, bank) {
  var img = {};
  var meta = bank.imgMeta || {};
  Object.keys(meta).forEach(function (id) {
    img[id] = DATA_BASE + slug + '/' + meta[id];
  });
  return {
    ch: bank.chapters.map(function (c) { return c.name; }),
    q: bank.questions,
    img: img,
    skillVersion: bank.skillVersion,
    categories: bank.categories,
    notes: bank.notes,
    palette: bank.palette,
    paletteColors: bank.paletteColors
  };
}

/* Private per-bank open counter (not shown anywhere on the site): one hit per
   bank entry, on the same free counter service as the portal total. Fires
   only when entering a bank from the portal (or a deep link); chapter/view
   moves inside a bank do not count. Fire-and-forget: a failed hit (offline,
   blocked counter) never breaks the bank. Read a count with the matching
   abacus /get/ key for the bank slug. */
function countBankOpen(slug) {
  fetch('https://abacus.jasoncameron.dev/hit/folio196-bank-' + slug).catch(function () {});
}

function showBank(slug) {
  $('portalView').hidden = true;
  $('bankView').hidden = false;
  window.scrollTo(0, 0);
}

function bootBank(slug, view) {
  gaPage(routePath(slug, view));
  if ($('bankView').hidden) countBankOpen(slug);
  if (bootedBank === slug) { /* hash-mode return to an already-booted bank */
    showBank(slug);
    if (window.__folio) {
      try {
        history.replaceState({ v: window.__folio.view() }, '',
          urlForView(window.__folio.view()));
      } catch (e) {}
    }
    return;
  }
  if (bootedBank) { location.reload(); return; } /* different bank: engine runs once per load */
  /* chrome is inline — apply it before the fetch so the header is right
     from the first paint, then show the skeleton with a loading note */
  applyBankChrome(slug);
  showBank(slug);
  $('home').innerHTML = '<p class="stat">Loading questions…</p>';
  fetch(DATA_BASE + slug + '/bank.json').then(function (r) {
    if (!r.ok) throw new Error('bank.json HTTP ' + r.status);
    return r.json();
  }).then(function (bank) {
    var DB = buildDB(slug, bank);
    bootedBank = slug;
    runBankEngine(DB, SK[slug], view || null);
    tellSWToCache(DATA_BASE + slug + '/bank.json');
  }).catch(function (err) {
    console.error('bank load failed:', err);
    $('home').innerHTML = '<p class="stat">Could not load this bank. ' +
      'Check your connection and <a href="' + bankPath(slug) + '">try again</a>.</p>';
  });
}

function goHome() {
  if (ROUTE_MODE === 'hash') {
    if (location.hash) { location.hash = ''; }
    else { showPortal(); }
  } else {
    location.assign('/');
  }
}

/* ---------- prefetch ----------
   (1) On entering a chapter, warm that whole chapter's images.
   (2) In All Questions / Shuffle, keep the next 50 questions' images
       preloaded ahead of the current position (50 counted by questions).
   (3) <img loading="lazy"> is already on every question image (engine). */
var prefetched = new Set();
function warmIds(ids) {
  var f = window.__folio;
  if (!f) return;
  ids.forEach(function (id) {
    var q = f.byId(id);
    if (!q || !q.im) return;
    q.im.forEach(function (k) {
      if (prefetched.has(k)) return;
      prefetched.add(k);
      var im = new Image();
      im.src = f.imgUrl(k);
    });
  });
}
function firstVisibleIndex(order) {
  var cards = document.querySelectorAll('#list .q');
  for (var i = 0; i < cards.length; i++) {
    var r = cards[i].getBoundingClientRect();
    if (r.bottom > 0 && r.top < window.innerHeight) {
      var idx = order.indexOf(cards[i].getAttribute('data-id'));
      if (idx >= 0) return idx;
    }
  }
  return 0;
}
window.__folioPrefetch = function () {
  var f = window.__folio;
  if (!f) return;
  var order = f.order(), view = f.view();
  if (!order || !order.length) return;
  /* rolling window: next 50 questions' images ahead of the first visible card */
  var at = firstVisibleIndex(order);
  warmIds(order.slice(at, at + PREFETCH_AHEAD));
  /* chapter entry: the whole current view is one chapter — warm it all */
  if (view && view !== 'all' && view !== '__notes' && view !== '__quiz' &&
      view.indexOf('__cat_') !== 0) warmIds(order);
};
var scrollQueued = false;
window.addEventListener('scroll', function () {
  if (scrollQueued || !window.__folio) return;
  scrollQueued = true;
  requestAnimationFrame(function () {
    scrollQueued = false;
    try { window.__folioPrefetch(); } catch (e) {}
  });
}, { passive: true });

/* ---------- service worker ---------- */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' &&
      location.hostname !== '127.0.0.1') return;
  navigator.serviceWorker.register(SW_URL).catch(function (e) {
    console.warn('SW registration failed:', e);
  });
}
/* Ask the SW to cache a bank's JSON after it loads (see sw.js: the fetch can
   fire before the worker takes control, so the fetch handler never sees it). */
function tellSWToCache(url) {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then(function (reg) {
    if (reg.active) reg.active.postMessage({ type: 'folio-cache', url: url });
  }).catch(function () {});
}

/* ---------- boot ---------- */
document.addEventListener('click', function (e) {
  var a = e.target.closest ? e.target.closest('[data-portal-link]') : null;
  if (!a) return;
  e.preventDefault();
  goHome();
});
window.addEventListener('hashchange', function () {
  if (ROUTE_MODE !== 'hash') return;
  var route = parseRoute();
  if (!route.bank) { showPortal(); return; }
  if (route.bank === bootedBank) { bootBank(route.bank, route.view); return; }
  if (bootedBank) { location.reload(); return; }
  bootBank(route.bank, route.view);
});

var route = parseRoute();
if (route.bank) bootBank(route.bank, route.view);
else showPortal();
registerSW();
})();
