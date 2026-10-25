import { store } from "./store.js";
import { buildIndex, search, snippet } from "./search.js";

/* ---------- data ---------- */

let INDEX = null;                 // data/index.json
const courseCache = new Map();    // slug -> course json
let searchIndex = null;

async function loadIndex() {
  const res = await fetch("data/index.json");
  if (!res.ok) throw new Error(`Couldn't load data/index.json (HTTP ${res.status}).`);
  INDEX = await res.json();
}

async function getCourse(slug) {
  if (courseCache.has(slug)) return courseCache.get(slug);
  const meta = INDEX.courses.find((c) => c.slug === slug);
  if (!meta) return null;
  const res = await fetch(`data/courses/${slug}.json`);
  if (!res.ok) throw new Error(`Couldn't load ${slug} (HTTP ${res.status}).`);
  const course = await res.json();
  courseCache.set(slug, course);
  return course;
}

const allCourses = () => Promise.all(INDEX.courses.map((c) => getCourse(c.slug)));

/* ---------- helpers ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pad = (n) => String(n).padStart(2, "0");
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), 2200);
}

const ICON = {
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
};

/* ---------- markdown ---------- */

const LANG_ALIAS = { ts: "typescript", tsx: "typescript", jsx: "javascript", js: "javascript", py: "python", sh: "bash", yml: "yaml" };

marked.use({
  gfm: true,
  renderer: {
    code(code, info) {
      const lang = (info || "").trim().split(/\s+/)[0].toLowerCase();
      if (!lang) {
        return `<figure class="plate"><button class="copy-btn" type="button" aria-label="Copy diagram">${ICON.copy}</button><pre class="diagram">${esc(code)}</pre></figure>`;
      }
      const name = LANG_ALIAS[lang] || lang;
      let html = esc(code);
      if (window.hljs && hljs.getLanguage(name)) {
        try { html = hljs.highlight(code, { language: name, ignoreIllegals: true }).value; } catch { /* plain */ }
      }
      return `<div class="code"><div class="code-bar"><span>${esc(lang)}</span><button class="copy-btn" type="button" aria-label="Copy code">${ICON.copy}<span>Copy</span></button></div><pre><code class="hljs">${html}</code></pre></div>`;
    },
    table(header, body) {
      return `<div class="table-wrap"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
    },
    link(href, title, text) {
      const ext = /^https?:\/\//.test(href || "");
      return `<a href="${esc(href || "")}"${title ? ` title="${esc(title)}"` : ""}${ext ? ' target="_blank" rel="noopener"' : ""}>${text}</a>`;
    },
  },
});

const md = (text) => (text ? marked.parse(text) : "");
const inl = (text) => marked.parseInline(text || "");           // titles: inline code/bold
const plain = (text) => (text || "").replace(/[`*]/g, "");        // titles where markup isn't wanted

// Style the lead paragraphs that the docs mark with bold labels.
function decorate(root) {
  $$(".md > p", root).forEach((p) => {
    const first = p.firstElementChild;
    if (!first || first.tagName !== "STRONG" || p.firstChild !== first) return;
    const label = first.textContent.trim().toLowerCase();
    if (label.startsWith("short answer")) p.classList.add("callout", "callout-short");
    else if (label.startsWith("pitfall") || label.startsWith("rule") || label.startsWith("golden rule")) p.classList.add("callout", "callout-warn");
  });
}

/* ---------- sidebar ---------- */

function renderNav(activeSlug) {
  const groups = INDEX.groups.map((g) => {
    const rows = INDEX.courses
      .filter((c) => c.group === g.name)
      .map((c) => {
        const done = store.reviewedCount(c.slug);
        return `<a class="nav-course${c.slug === activeSlug ? " active" : ""}" href="#/c/${c.slug}" style="--accent:${c.accent}" data-slug="${c.slug}">
          <span class="nav-num">${pad(c.num)}</span>
          <span class="nav-title">${esc(c.title)}</span>
          <span class="nav-meter" aria-label="${done} of ${c.question_count} reviewed"><i style="width:${pct(done, c.question_count)}%"></i></span>
        </a>`;
      })
      .join("");
    return `<section class="nav-group"><h2>${esc(g.name)}</h2>${rows}</section>`;
  });
  $("#courseNav").innerHTML =
    `<a class="nav-home${activeSlug === "home" ? " active" : ""}" href="#/">Overview</a>
     <a class="nav-home${activeSlug === "bookmarks" ? " active" : ""}" href="#/bookmarks">Bookmarks <span class="count">${store.bookmarkKeys().length}</span></a>` +
    groups.join("");
}

function setDrawer(open) {
  document.body.classList.toggle("drawer-open", open);
  $("#scrim").hidden = !open;
  $("#menuBtn").setAttribute("aria-expanded", String(open));
}

/* ---------- views ---------- */

const main = () => $("#main");
const outline = () => $("#outline");
let currentCourse = null;
let spy = null;

function setView(html, { outlineHtml = "", mode = "" } = {}) {
  if (spy) { spy.disconnect(); spy = null; }
  currentCourse = null;
  main().innerHTML = html;
  outline().innerHTML = outlineHtml;
  document.body.dataset.mode = mode;
}

function progressBlock(done, total, label) {
  return `<div class="progress" role="img" aria-label="${done} of ${total} ${label}">
    <div class="progress-track"><i style="width:${pct(done, total)}%"></i></div>
    <span><b>${done}</b> of ${total} ${label}</span>
  </div>`;
}

function homeView() {
  renderNav("home");
  document.title = "Interview Prep Handbook";
  const total = INDEX.total_questions;
  const done = store.totalReviewed();
  const last = store.get().last;
  const lastCourse = last && INDEX.courses.find((c) => c.slug === last.slug);
  const resume = lastCourse
    ? `<a class="btn btn-primary" href="#/c/${lastCourse.slug}${last.qid ? "/" + last.qid : ""}">Continue ${esc(lastCourse.title)}${last.qid ? ", " + last.qid : ""}</a>`
    : `<a class="btn btn-primary" href="#/c/${INDEX.courses[0].slug}">Start with ${esc(INDEX.courses[0].title)}</a>`;

  const groups = INDEX.groups.map((g) => {
    const rows = INDEX.courses.filter((c) => c.group === g.name).map((c) => {
      const d = store.reviewedCount(c.slug);
      return `<a class="course-row" href="#/c/${c.slug}" style="--accent:${c.accent}">
        <span class="row-num">${pad(c.num)}</span>
        <span class="row-main"><span class="row-title">${esc(c.title)}</span><span class="row-level">${esc(c.level)}</span></span>
        <span class="row-count">${c.question_count} questions</span>
        <span class="row-meter"><i style="width:${pct(d, c.question_count)}%"></i></span>
      </a>`;
    }).join("");
    return `<section class="course-group" style="--accent:${g.accent}"><h2>${esc(g.name)}</h2><div class="rows">${rows}</div></section>`;
  }).join("");

  setView(`
    <div class="home">
      <section class="hero">
        <h1>Interview prep handbook</h1>
        <p class="lede">For the Infosys Specialist Programmer L2 to L3 interview. ${total} questions across ${INDEX.courses.length} courses, each answered with a short version, a worked explanation and the follow-ups interviewers ask next.</p>
        <div class="hero-actions">
          ${resume}
          <a class="btn" href="#/cards/all">Practise with flashcards</a>
          <button class="btn btn-ghost" type="button" data-action="search">Search everything</button>
        </div>
        ${progressBlock(done, total, "questions reviewed")}
      </section>
      ${groups}
      <section class="data-tools">
        <h2>Your progress</h2>
        <p>Reviewed questions and bookmarks are saved in this browser only. Export them to move to another device.</p>
        <div class="hero-actions">
          <button class="btn" type="button" data-action="export">Export progress</button>
          <label class="btn">Import progress<input type="file" accept="application/json" data-action="import" hidden></label>
          <button class="btn btn-ghost danger" type="button" data-action="reset">Reset progress</button>
        </div>
      </section>
    </div>`, { mode: "home" });
  main().focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function questionHTML(course, q) {
  const r = store.isReviewed(course.slug, q.id);
  const b = store.isBookmarked(course.slug, q.id);
  return `<article class="q${r ? " is-reviewed" : ""}" id="${q.id}" data-q="${q.id}">
    <header class="q-head">
      <a class="q-id" href="#/c/${course.slug}/${q.id}" aria-label="Link to ${q.id}">${q.id}</a>
      <h3>${inl(q.title)}</h3>
    </header>
    <div class="q-body md">${md(q.body_md)}</div>
    <footer class="q-actions">
      <button type="button" class="chip${r ? " on" : ""}" data-action="review" aria-pressed="${r}">${ICON.check}<span>${r ? "Reviewed" : "Mark reviewed"}</span></button>
      <button type="button" class="chip chip-star${b ? " on" : ""}" data-action="bookmark" aria-pressed="${b}">${ICON.star}<span>${b ? "Bookmarked" : "Bookmark"}</span></button>
      <button type="button" class="chip chip-quiet" data-action="copylink">${ICON.link}<span>Copy link</span></button>
    </footer>
  </article>`;
}

async function courseView(slug, qid) {
  if (currentCourse && currentCourse.slug === slug) {
    scrollToQuestion(qid);
    return;
  }
  const course = await getCourse(slug);
  if (!course) return notFound(`There's no course called “${slug}”.`);
  renderNav(slug);
  document.title = `${course.title} | Interview Prep`;
  const i = INDEX.courses.findIndex((c) => c.slug === slug);
  const prev = INDEX.courses[i - 1], next = INDEX.courses[i + 1];
  const done = store.reviewedCount(slug);

  const sections = course.sections.map((s, si) => {
    const isModel = si === 0 && !s.questions.length;
    const cls = isModel ? "section section-model" : /cheat sheet/i.test(s.title) ? "section section-cheat" : /reference/i.test(s.title) ? "section section-refs" : "section";
    return `<section class="${cls}" id="s-${s.id}" data-section="${s.id}">
      <h2 class="section-title">${inl(s.title)}</h2>
      ${s.intro_md ? `<div class="md section-intro">${md(s.intro_md)}</div>` : ""}
      ${s.questions.map((q) => questionHTML(course, q)).join("")}
    </section>`;
  }).join("");

  const outlineHtml = `<h2>On this page</h2><nav>${course.sections.map((s) => `
      <a class="ol-section" href="#/c/${slug}" data-target="s-${s.id}">${esc(plain(s.title))}</a>
      ${s.questions.length ? `<div class="ol-qs" data-for="s-${s.id}">${s.questions.map((q) => `<a class="ol-q" href="#/c/${slug}/${q.id}" data-q="${q.id}"><span>${q.id}</span>${esc(plain(q.title))}</a>`).join("")}</div>` : ""}`).join("")}</nav>`;

  setView(`
    <article class="course" style="--accent:${course.accent}">
      <header class="course-head">
        <span class="course-num" aria-hidden="true">${pad(course.num)}</span>
        <div>
          <p class="crumbs"><a href="#/">Overview</a><span aria-hidden="true">/</span>${esc(course.group)}</p>
          <h1>${esc(course.title)}</h1>
          <p class="course-level">${esc(course.level)}</p>
          <div class="course-tools">
            ${progressBlock(done, course.question_count, "reviewed")}
            <a class="btn btn-primary" href="#/cards/${slug}">Flashcards for this course</a>
          </div>
        </div>
      </header>
      ${sections}
      <nav class="pager">
        ${prev ? `<a href="#/c/${prev.slug}" class="pager-link"><span>Previous</span>${esc(prev.title)}</a>` : "<span></span>"}
        ${next ? `<a href="#/c/${next.slug}" class="pager-link next"><span>Next</span>${esc(next.title)}</a>` : "<span></span>"}
      </nav>
    </article>`, { outlineHtml, mode: "course" });

  currentCourse = course;
  decorate(main());
  startSpy();
  if (qid) scrollToQuestion(qid);
  else { window.scrollTo(0, 0); store.setLast(slug, null); }
}

function scrollToQuestion(qid) {
  if (!qid) { window.scrollTo({ top: 0 }); return; }
  const el = document.getElementById(qid);
  if (!el) return;
  el.scrollIntoView({ block: "start" });
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
  store.setLast(currentCourse.slug, qid);
}

function startSpy() {
  const links = new Map($$(".ol-q").map((a) => [a.dataset.q, a]));
  const sectionLinks = new Map($$(".ol-section").map((a) => [a.dataset.target, a]));
  spy = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target;
      if (el.dataset.q) {
        $$(".ol-q.active").forEach((a) => a.classList.remove("active"));
        const a = links.get(el.dataset.q);
        if (a) { a.classList.add("active"); a.scrollIntoView({ block: "nearest" }); }
        const sec = el.closest("section");
        if (sec) activateSection(sec.id, sectionLinks);
      } else if (el.dataset.section) {
        activateSection(el.id, sectionLinks);
      }
    }
  }, { rootMargin: "-80px 0px -70% 0px" });
  $$(".q, .section").forEach((el) => spy.observe(el));
}

function activateSection(id, sectionLinks) {
  $$(".ol-section.active").forEach((a) => a.classList.remove("active"));
  $$(".ol-qs.open").forEach((d) => d.classList.remove("open"));
  sectionLinks.get(id)?.classList.add("active");
  $(`.ol-qs[data-for="${id}"]`)?.classList.add("open");
}

async function bookmarksView() {
  renderNav("bookmarks");
  document.title = "Bookmarks | Interview Prep";
  const keys = store.bookmarkKeys();
  const slugs = [...new Set(keys.map((k) => k.split("/")[0]))];
  const courses = (await Promise.all(slugs.map(getCourse))).filter(Boolean);
  const items = [];
  for (const c of courses) {
    for (const s of c.sections) for (const q of s.questions) {
      if (store.isBookmarked(c.slug, q.id)) items.push({ c, q });
    }
  }
  items.sort((a, b) => a.c.num - b.c.num);
  setView(`
    <div class="home">
      <section class="hero hero-small">
        <h1>Bookmarks</h1>
        <p class="lede">${items.length ? `${items.length} saved question${items.length > 1 ? "s" : ""}. Use them for a focused revision round.` : "Nothing saved yet. Use Bookmark on any question to collect the ones you want to revisit."}</p>
        ${items.length ? `<div class="hero-actions"><a class="btn btn-primary" href="#/cards/bookmarks">Flashcards from bookmarks</a></div>` : ""}
      </section>
      <div class="rows">${items.map(({ c, q }) => `
        <a class="course-row" href="#/c/${c.slug}/${q.id}" style="--accent:${c.accent}">
          <span class="row-num">${q.id}</span>
          <span class="row-main"><span class="row-title">${inl(q.title)}</span><span class="row-level">${esc(c.title)}</span></span>
        </a>`).join("")}</div>
    </div>`, { mode: "home" });
  window.scrollTo(0, 0);
}

function notFound(msg) {
  renderNav("");
  setView(`<div class="home"><section class="hero hero-small"><h1>Page not found</h1><p class="lede">${esc(msg)}</p><div class="hero-actions"><a class="btn btn-primary" href="#/">Go to the overview</a></div></section></div>`);
}

/* ---------- flashcards ---------- */

const deck = { cards: [], i: 0, flipped: false, full: false, scope: "all", skipReviewed: false, tally: { knew: 0, shaky: 0, missed: 0 } };

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function cardsView(scope) {
  renderNav("");
  document.title = "Flashcards | Interview Prep";
  setView(`<div class="loading">Preparing cards…</div>`, { mode: "cards" });
  const courses = scope === "all" || scope === "bookmarks" ? await allCourses() : [await getCourse(scope)].filter(Boolean);
  if (!courses.length) return notFound(`There's no course called “${scope}”.`);
  const cards = [];
  for (const c of courses) for (const s of c.sections) for (const q of s.questions) {
    if (scope === "bookmarks" && !store.isBookmarked(c.slug, q.id)) continue;
    if (deck.skipReviewed && store.isReviewed(c.slug, q.id)) continue;
    cards.push({ c, q });
  }
  Object.assign(deck, { cards: shuffle(cards), i: 0, flipped: false, full: false, scope, tally: { knew: 0, shaky: 0, missed: 0 } });
  drawCard();
}

function scopeOptions() {
  const opt = (v, label) => `<option value="${v}"${deck.scope === v ? " selected" : ""}>${esc(label)}</option>`;
  return opt("all", "All courses") + opt("bookmarks", "Bookmarked only") +
    INDEX.courses.map((c) => opt(c.slug, `${pad(c.num)} ${c.title}`)).join("");
}

function drawCard() {
  const total = deck.cards.length;
  const head = `
    <header class="cards-head">
      <h1>Flashcards</h1>
      <div class="cards-controls">
        <label class="select"><span class="sr-only">Deck</span><select id="deckScope">${scopeOptions()}</select></label>
        <label class="toggle"><input type="checkbox" id="skipReviewed"${deck.skipReviewed ? " checked" : ""}><span>Skip reviewed</span></label>
      </div>
    </header>`;

  if (!total) {
    main().innerHTML = head + `<div class="card-empty"><p>No cards in this deck.${deck.scope === "bookmarks" ? " Bookmark some questions first." : deck.skipReviewed ? " Everything here is already reviewed." : ""}</p></div>`;
    return;
  }
  if (deck.i >= total) {
    const t = deck.tally;
    main().innerHTML = head + `<div class="card-done">
      <h2>Deck finished</h2>
      <p>You knew <b>${t.knew}</b>, were unsure on <b>${t.shaky}</b> and missed <b>${t.missed}</b>. Questions you knew are now marked reviewed.</p>
      <div class="hero-actions"><button class="btn btn-primary" type="button" data-action="restart">Shuffle and go again</button><a class="btn" href="#/">Back to overview</a></div>
    </div>`;
    return;
  }
  const { c, q } = deck.cards[deck.i];
  main().innerHTML = head + `
    <div class="deck-meter"><div class="progress-track"><i style="width:${pct(deck.i, total)}%"></i></div><span>${deck.i + 1} / ${total}</span></div>
    <div class="flashcard${deck.flipped ? " flipped" : ""}" style="--accent:${c.accent}">
      <p class="fc-course">${esc(c.title)} <span>${q.id}</span></p>
      <h2 class="fc-q">${inl(q.title)}</h2>
      ${deck.flipped ? `
        <div class="fc-answer md">${md(deck.full ? q.body_md : q.short_md)}</div>
        <div class="fc-row">
          <button class="btn btn-ghost" type="button" data-action="full">${deck.full ? "Show short answer" : "Show full answer"}</button>
          <a class="btn btn-ghost" href="#/c/${c.slug}/${q.id}">Open in course</a>
        </div>
        <div class="fc-rate" role="group" aria-label="How well did you know it?">
          <button class="rate rate-missed" type="button" data-rate="missed"><kbd>1</kbd>Didn't know</button>
          <button class="rate rate-shaky" type="button" data-rate="shaky"><kbd>2</kbd>Shaky</button>
          <button class="rate rate-knew" type="button" data-rate="knew"><kbd>3</kbd>Knew it</button>
        </div>` : `
        <p class="fc-hint">Say your answer out loud, then reveal it.</p>
        <button class="btn btn-primary fc-flip" type="button" data-action="flip">Reveal answer <kbd>Space</kbd></button>`}
    </div>
    <p class="fc-keys">Space reveals, 1 2 3 rate, arrow keys move between cards.</p>`;
  decorate(main());
}

function rateCard(rating) {
  const card = deck.cards[deck.i];
  if (!card) return;
  store.rate(card.c.slug, card.q.id, rating);
  deck.tally[rating] += 1;
  if (rating !== "knew") {
    // bring it back later in this session
    const gap = rating === "missed" ? 3 + Math.floor(Math.random() * 3) : 8 + Math.floor(Math.random() * 5);
    deck.cards.splice(Math.min(deck.i + gap, deck.cards.length), 0, card);
  }
  deck.i += 1;
  deck.flipped = false;
  deck.full = false;
  drawCard();
  window.scrollTo({ top: 0 });
}

/* ---------- search palette ---------- */

let paletteSel = 0;
let paletteHits = [];

async function openPalette(prefill = "") {
  const pal = $("#palette");
  pal.hidden = false;
  document.body.classList.add("palette-open");
  const input = $("#searchInput");
  input.value = prefill || input.value;
  input.focus();
  input.select();
  if (!searchIndex) {
    $("#searchResults").innerHTML = `<p class="palette-empty">Indexing all courses…</p>`;
    searchIndex = buildIndex(await allCourses());
  }
  runSearch();
}

function closePalette() {
  $("#palette").hidden = true;
  document.body.classList.remove("palette-open");
}

function highlight(text, query) {
  let out = esc(text);
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!terms.length) return out;
  return out.replace(new RegExp(`(${terms.join("|")})`, "gi"), "<mark>$1</mark>");
}

function runSearch() {
  const q = $("#searchInput").value;
  const box = $("#searchResults");
  if (!searchIndex) return;
  if (!q.trim()) {
    box.innerHTML = `<p class="palette-empty">Type to search titles, answers and code across every course.</p>`;
    paletteHits = [];
    return;
  }
  paletteHits = search(searchIndex, q);
  paletteSel = 0;
  if (!paletteHits.length) {
    box.innerHTML = `<p class="palette-empty">No questions match “${esc(q)}”. Try fewer or different words.</p>`;
    return;
  }
  box.innerHTML = paletteHits.map((d, i) => `
    <a class="hit${i === 0 ? " sel" : ""}" role="option" href="#/c/${d.slug}/${d.qid}" style="--accent:${d.accent}" data-i="${i}">
      <span class="hit-meta"><i></i>${esc(d.course)} <b>${d.qid}</b></span>
      <span class="hit-title">${highlight(d.title, q)}</span>
      <span class="hit-snip">${highlight(snippet(d.short, q), q)}</span>
    </a>`).join("");
}

function movePalette(delta) {
  const hits = $$(".hit");
  if (!hits.length) return;
  paletteSel = (paletteSel + delta + hits.length) % hits.length;
  hits.forEach((h, i) => h.classList.toggle("sel", i === paletteSel));
  hits[paletteSel].scrollIntoView({ block: "nearest" });
}

/* ---------- events ---------- */

function bindEvents() {
  $("#menuBtn").addEventListener("click", () => setDrawer(!document.body.classList.contains("drawer-open")));
  $("#scrim").addEventListener("click", () => setDrawer(false));
  $("#courseNav").addEventListener("click", (e) => { if (e.target.closest("a")) setDrawer(false); });
  $("#searchBtn").addEventListener("click", () => openPalette());
  $("#themeBtn").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    store.setTheme(next);
  });
  if (/Mac|iPhone|iPad/.test(navigator.platform)) $("#searchKbd").textContent = "⌘ K";

  $("#palette").addEventListener("click", (e) => {
    if (e.target.id === "palette") closePalette();
    if (e.target.closest(".hit")) closePalette();
  });
  $("#searchInput").addEventListener("input", runSearch);
  $("#searchInput").addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); movePalette(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); movePalette(-1); }
    else if (e.key === "Enter") {
      const d = paletteHits[paletteSel];
      if (d) { closePalette(); location.hash = `#/c/${d.slug}/${d.qid}`; }
    } else if (e.key === "Escape") closePalette();
  });

  document.addEventListener("keydown", (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "");
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); return; }
    if (e.key === "Escape") { closePalette(); setDrawer(false); return; }
    if (typing || !$("#palette").hidden) return;
    if (e.key === "/") { e.preventDefault(); openPalette(); return; }
    if (document.body.dataset.mode === "cards" && deck.cards.length) {
      if (e.key === " ") { e.preventDefault(); if (!deck.flipped) { deck.flipped = true; drawCard(); } }
      else if (deck.flipped && ["1", "2", "3"].includes(e.key)) rateCard({ 1: "missed", 2: "shaky", 3: "knew" }[e.key]);
      else if (e.key === "ArrowRight" && deck.i < deck.cards.length) { deck.i += 1; deck.flipped = false; deck.full = false; drawCard(); }
      else if (e.key === "ArrowLeft" && deck.i > 0) { deck.i -= 1; deck.flipped = false; deck.full = false; drawCard(); }
    }
  });

  main().addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action], [data-rate], .copy-btn");
    if (!btn) return;
    if (btn.classList.contains("copy-btn")) {
      const pre = btn.closest(".code, .plate").querySelector("pre");
      try { await navigator.clipboard.writeText(pre.innerText); toast("Copied to clipboard"); }
      catch { toast("Copy isn't available in this browser"); }
      return;
    }
    if (btn.dataset.rate) return rateCard(btn.dataset.rate);
    const action = btn.dataset.action;
    const art = btn.closest(".q");
    if (action === "review" && art && currentCourse) {
      const on = store.toggleReviewed(currentCourse.slug, art.dataset.q);
      art.classList.toggle("is-reviewed", on);
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", on);
      btn.querySelector("span").textContent = on ? "Reviewed" : "Mark reviewed";
      refreshCourseProgress();
    } else if (action === "bookmark" && art && currentCourse) {
      const on = store.toggleBookmark(currentCourse.slug, art.dataset.q);
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", on);
      btn.querySelector("span").textContent = on ? "Bookmarked" : "Bookmark";
      renderNav(currentCourse.slug);
      toast(on ? "Bookmarked" : "Bookmark removed");
    } else if (action === "copylink" && art && currentCourse) {
      const url = `${location.origin}${location.pathname}#/c/${currentCourse.slug}/${art.dataset.q}`;
      try { await navigator.clipboard.writeText(url); toast("Link copied"); } catch { toast(url); }
    } else if (action === "search") openPalette();
    else if (action === "flip") { deck.flipped = true; drawCard(); }
    else if (action === "full") { deck.full = !deck.full; drawCard(); }
    else if (action === "restart") cardsView(deck.scope);
    else if (action === "export") {
      const blob = new Blob([store.exportJSON()], { type: "application/json" });
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `interview-prep-progress-${new Date().toISOString().slice(0, 10)}.json` });
      a.click();
      URL.revokeObjectURL(a.href);
      toast("Progress exported");
    } else if (action === "reset") {
      btn.dataset.confirm ? (store.reset(), toast("Progress reset"), homeView()) : ((btn.dataset.confirm = "1"), (btn.textContent = "Click again to reset everything"));
    }
  });

  main().addEventListener("change", async (e) => {
    if (e.target.matches('[data-action="import"]')) {
      const file = e.target.files[0];
      if (!file) return;
      try { store.importJSON(await file.text()); toast("Progress imported"); homeView(); }
      catch (err) { toast(err.message || "That file couldn't be read."); }
    } else if (e.target.id === "deckScope") {
      location.hash = `#/cards/${e.target.value}`;
    } else if (e.target.id === "skipReviewed") {
      deck.skipReviewed = e.target.checked;
      cardsView(deck.scope);
    }
  });

  outline().addEventListener("click", (e) => {
    const a = e.target.closest(".ol-section");
    if (!a) return;
    e.preventDefault();
    document.getElementById(a.dataset.target)?.scrollIntoView({ block: "start" });
  });

  window.addEventListener("hashchange", route);
}

function refreshCourseProgress() {
  if (!currentCourse) return;
  const done = store.reviewedCount(currentCourse.slug);
  const block = $(".course-tools .progress");
  if (block) block.outerHTML = progressBlock(done, currentCourse.question_count, "reviewed");
  const link = $(`.nav-course[data-slug="${currentCourse.slug}"] .nav-meter i`);
  if (link) link.style.width = `${pct(done, currentCourse.question_count)}%`;
}

/* ---------- router ---------- */

async function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  setDrawer(false);
  try {
    if (!parts.length) homeView();
    else if (parts[0] === "c" && parts[1]) await courseView(parts[1], parts[2]);
    else if (parts[0] === "cards") await cardsView(parts[1] || "all");
    else if (parts[0] === "bookmarks") await bookmarksView();
    else notFound("That address doesn't match any page.");
  } catch (err) {
    console.error(err);
    setView(`<div class="home"><section class="hero hero-small"><h1>Couldn't load this page</h1><p class="lede">${esc(err.message)} If you opened index.html directly from disk, run <code>python -m http.server 8000</code> in the project folder and open http://localhost:8000.</p></section></div>`);
  }
}

(async function init() {
  bindEvents();
  try {
    await loadIndex();
  } catch (err) {
    main().innerHTML = `<div class="home"><section class="hero hero-small"><h1>Couldn't load the course list</h1><p class="lede">${esc(err.message)} Browsers block data loading from local files, so serve the folder instead: run <code>python -m http.server 8000</code> here and open http://localhost:8000.</p></section></div>`;
    return;
  }
  route();
})();
