// Animated diagrams for ```flow blocks.
//
// Syntax (first line picks the kind):
//
//   sequence: Title                      pipeline: Title                 cycle: Title
//   actors: User, API, Agent             stage: Optional group label     Think > caption
//   User -> API: label                   Step label > caption            Act > caption
//   > caption for the step above         Next step > caption             exit > when the loop stops
//   API -> API: self step
//
// Every step can carry a caption ("> ..."); the caption explains what is happening
// at that moment and is shown under the diagram while the step is active.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const inline = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

const STEP_MS = 2600;
const HOLD_MS = 3200;
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- parsing ---------- */

function parse(src) {
  const lines = src.split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim());
  const head = lines.shift() || "";
  const m = head.match(/^(sequence|pipeline|cycle)\s*:\s*(.*)$/i);
  if (!m) throw new Error(`flow block must start with "sequence:", "pipeline:" or "cycle:" (got "${head}")`);
  const kind = m[1].toLowerCase();
  const flow = { kind, title: m[2].trim(), actors: [], steps: [], exit: "" };
  let stage = "";

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith(">")) {
      const last = flow.steps[flow.steps.length - 1];
      if (last) last.caption = (last.caption ? last.caption + " " : "") + line.slice(1).trim();
      continue;
    }
    if (kind === "sequence") {
      if (/^actors\s*:/i.test(line)) {
        flow.actors = line.replace(/^actors\s*:/i, "").split(",").map((a) => a.trim()).filter(Boolean);
        continue;
      }
      const s = line.match(/^(.+?)\s*(-->|->)\s*(.+?)\s*:\s*(.+)$/);
      if (!s) throw new Error(`can't read sequence step "${line}" (expected "A -> B: label")`);
      const [, from, arrow, to, label] = s;
      for (const a of [from, to]) if (!flow.actors.includes(a)) flow.actors.push(a);
      flow.steps.push({ from, to, label, reply: arrow === "-->", caption: "" });
    } else {
      if (/^stage\s*:/i.test(line)) { stage = line.replace(/^stage\s*:/i, "").trim(); continue; }
      const [label, ...rest] = line.split(" > ");
      if (kind === "cycle" && /^exit$/i.test(label.trim())) { flow.exit = rest.join(" > ").trim(); continue; }
      flow.steps.push({ label: label.trim(), caption: rest.join(" > ").trim(), stage });
    }
  }
  if (!flow.steps.length) throw new Error("flow block has no steps");
  return flow;
}

/* ---------- rendering ---------- */

const controls = (n) => `
  <div class="flow-bar">
    <div class="flow-caption" aria-live="polite"><span class="flow-count">1 / ${n}</span><span class="flow-text"></span></div>
    <div class="flow-ctrls">
      <button type="button" class="flow-btn" data-flow="prev" aria-label="Previous step"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg></button>
      <button type="button" class="flow-btn flow-play" data-flow="play" aria-label="Pause animation"><svg class="i-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6v12M15 6v12"/></svg><svg class="i-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z"/></svg></button>
      <button type="button" class="flow-btn" data-flow="next" aria-label="Next step"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>
      <button type="button" class="flow-btn" data-flow="all" aria-label="Show all steps"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
    </div>
  </div>`;

function renderSequence(f) {
  const n = f.actors.length;
  const col = (a) => f.actors.indexOf(a);
  const lifelines = f.actors.map((_, i) => `<div class="seq-life" style="grid-column:${i + 1};grid-row:1 / -1"></div>`).join("");
  const heads = f.actors.map((a, i) => `<div class="seq-actor" style="grid-column:${i + 1};grid-row:1"><span>${inline(a)}</span></div>`).join("");
  const rows = f.steps.map((s, i) => {
    const a = col(s.from), b = col(s.to);
    const self = a === b;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const span = hi - lo + 1;
    const dir = self ? "self" : b > a ? "right" : "left";
    // the arrow runs between the centres of the first and last column it spans
    const inset = `${50 / span}%`;
    return `<div class="seq-row seq-${dir}${s.reply ? " seq-reply" : ""}" data-step="${i}" style="grid-column:${lo + 1} / ${hi + 2};grid-row:${i + 2};--inset:${inset}">
      <span class="seq-label"><span class="seq-num">${i + 1}</span>${inline(s.label)}</span>
      ${self ? `<span class="seq-self" aria-hidden="true"></span>` : `<span class="seq-line"><i class="seq-packet"></i></span>`}
    </div>`;
  }).join("");
  return `<div class="seq">
    <div class="seq-grid" style="min-width:calc(${n} * var(--seq-col));grid-template-columns:repeat(${n}, minmax(0, 1fr));grid-template-rows:auto repeat(${f.steps.length}, auto)">
      ${lifelines}${heads}${rows}
    </div>
  </div>`;
}

function renderPipeline(f) {
  let html = "", lastStage = null;
  f.steps.forEach((s, i) => {
    if (s.stage !== lastStage) {
      if (lastStage !== null) html += `</div></div>`;
      html += `<div class="pipe-stage">${s.stage ? `<div class="pipe-stage-label">${inline(s.stage)}</div>` : ""}<div class="pipe-track">`;
      lastStage = s.stage;
    } else if (i > 0) {
      html += `<span class="pipe-link" data-link="${i}"><i class="pipe-packet"></i></span>`;
    }
    html += `<div class="pipe-step" data-step="${i}"><span class="pipe-num">${i + 1}</span><span class="pipe-label">${inline(s.label)}</span></div>`;
  });
  html += `</div></div>`;
  return `<div class="pipe">${html}</div>`;
}

function renderCycle(f) {
  const n = f.steps.length;
  const R = 38; // % radius of node ring
  const nodes = f.steps.map((s, i) => {
    const ang = (-90 + (360 / n) * i) * (Math.PI / 180);
    const x = 50 + R * Math.cos(ang), y = 50 + R * Math.sin(ang);
    return `<div class="cyc-node" data-step="${i}" style="left:${x}%;top:${y}%"><span class="cyc-num">${i + 1}</span><span>${inline(s.label)}</span></div>`;
  }).join("");
  return `<div class="cyc">
    <div class="cyc-ring">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle class="cyc-track" cx="50" cy="50" r="${R}" />
        <circle class="cyc-progress" cx="50" cy="50" r="${R}" pathLength="100" />
      </svg>
      <i class="cyc-dot"></i>
      ${nodes}
    </div>
    ${f.exit ? `<div class="cyc-exit"><span>Exit when</span> ${inline(f.exit)}</div>` : ""}
  </div>`;
}

export function renderFlow(src) {
  let f;
  try {
    f = parse(src);
  } catch (err) {
    return `<figure class="plate"><pre class="diagram">${esc(src)}</pre></figure><p class="flow-error">Diagram error: ${esc(err.message)}</p>`;
  }
  const body = f.kind === "sequence" ? renderSequence(f) : f.kind === "pipeline" ? renderPipeline(f) : renderCycle(f);
  const data = esc(JSON.stringify(f.steps.map((s) => s.caption || (s.from ? `${s.from} → ${s.to}: ${s.label}` : s.label))));
  return `<figure class="flow flow-${f.kind}" data-kind="${f.kind}" data-n="${f.steps.length}" data-captions="${data}" data-cycle="${f.steps.length}">
    ${f.title ? `<figcaption class="flow-title"><span class="flow-kind">${f.kind === "sequence" ? "Step-by-step" : f.kind === "pipeline" ? "Pipeline" : "Loop"}</span>${inline(f.title)}</figcaption>` : ""}
    <div class="flow-body">${body}</div>
    ${controls(f.steps.length)}
  </figure>`;
}

/* ---------- animation ---------- */

class FlowPlayer {
  constructor(el) {
    this.el = el;
    this.n = Number(el.dataset.n);
    this.kind = el.dataset.kind;
    this.captions = JSON.parse(el.dataset.captions);
    this.i = 0;
    this.playing = !reducedMotion();
    this.visible = false;
    this.timer = null;
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-flow]");
      const stepEl = e.target.closest("[data-step]");
      if (b) {
        const a = b.dataset.flow;
        if (a === "play") this.toggle();
        else if (a === "next") { this.pause(); this.go(Math.min(this.i + 1, this.n - 1)); }
        else if (a === "prev") { this.pause(); this.go(Math.max(this.i - 1, 0)); }
        else if (a === "all") { this.pause(); this.showAll(); }
      } else if (stepEl) {
        this.pause();
        this.go(Number(stepEl.dataset.step));
      }
    });
    if (reducedMotion()) this.showAll(); else this.go(0);
    this.syncButton();
  }

  go(i) {
    this.i = i;
    this.el.classList.remove("show-all");
    const steps = this.el.querySelectorAll("[data-step]");
    steps.forEach((s) => {
      const k = Number(s.dataset.step);
      s.classList.toggle("done", k < i);
      s.classList.toggle("active", k === i);
      s.classList.toggle("future", k > i);
    });
    this.el.querySelectorAll("[data-link]").forEach((l) => {
      const k = Number(l.dataset.link);
      l.classList.toggle("done", k < i);
      l.classList.toggle("active", k === i);
    });
    if (this.kind === "cycle") {
      const frac = this.n > 1 ? i / this.n : 0;
      this.el.style.setProperty("--cyc-frac", frac);
      this.el.style.setProperty("--cyc-angle", `${frac * 360}deg`);
    }
    // restart CSS animations on the active step
    const active = this.el.querySelector(`[data-step="${i}"]`);
    if (active) { active.classList.remove("pulse"); void active.offsetWidth; active.classList.add("pulse"); }
    this.el.querySelector(".flow-count").textContent = `${i + 1} / ${this.n}`;
    this.el.querySelector(".flow-text").innerHTML = inline(this.captions[i] || "");
    this.schedule();
  }

  showAll() {
    this.el.classList.add("show-all");
    this.el.querySelectorAll("[data-step]").forEach((s) => { s.classList.remove("future", "active"); s.classList.add("done"); });
    this.el.querySelectorAll("[data-link]").forEach((l) => l.classList.add("done"));
    this.el.querySelector(".flow-count").textContent = `${this.n} steps`;
    this.el.querySelector(".flow-text").textContent = "All steps shown. Press play to walk through them one by one.";
    if (this.kind === "cycle") this.el.style.setProperty("--cyc-frac", 1);
  }

  schedule() {
    clearTimeout(this.timer);
    if (!this.playing || !this.visible) return;
    const last = this.i >= this.n - 1;
    this.timer = setTimeout(() => this.go(last ? 0 : this.i + 1), last ? HOLD_MS : STEP_MS);
  }

  toggle() {
    this.playing = !this.playing;
    if (this.playing && this.el.classList.contains("show-all")) this.go(0);
    else this.schedule();
    this.syncButton();
  }

  pause() {
    this.playing = false;
    clearTimeout(this.timer);
    this.syncButton();
  }

  setVisible(v) {
    this.visible = v;
    if (v) this.schedule(); else clearTimeout(this.timer);
  }

  syncButton() {
    const b = this.el.querySelector(".flow-play");
    this.el.classList.toggle("is-playing", this.playing);
    b.setAttribute("aria-label", this.playing ? "Pause animation" : "Play animation");
  }
}

const players = new WeakMap();
let observer = null;

export function initFlows(root) {
  if (!observer) {
    observer = new IntersectionObserver((entries) => {
      for (const e of entries) players.get(e.target)?.setVisible(e.isIntersecting);
    }, { threshold: 0.35 });
  }
  root.querySelectorAll("figure.flow").forEach((el) => {
    if (players.has(el)) return;
    players.set(el, new FlowPlayer(el));
    observer.observe(el);
  });
}
