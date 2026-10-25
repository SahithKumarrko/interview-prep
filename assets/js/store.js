// Progress, bookmarks, theme and last-visited position, saved in this browser only.
// Every storage access is wrapped: the app keeps working if storage is blocked.

const KEY = "ip.state";
const blank = () => ({ reviewed: {}, bookmarks: {}, last: null, theme: null, ratings: {} });

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...blank(), ...JSON.parse(raw) } : blank();
  } catch {
    return blank();
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: keep in memory only */
  }
  listeners.forEach((fn) => fn(state));
}

export const qkey = (slug, qid) => `${slug}/${qid}`;

export const store = {
  get: () => state,
  onChange: (fn) => listeners.add(fn),

  isReviewed: (slug, qid) => Boolean(state.reviewed[qkey(slug, qid)]),
  isBookmarked: (slug, qid) => Boolean(state.bookmarks[qkey(slug, qid)]),

  toggleReviewed(slug, qid, force) {
    const k = qkey(slug, qid);
    const on = force ?? !state.reviewed[k];
    if (on) state.reviewed[k] = Date.now();
    else delete state.reviewed[k];
    save();
    return on;
  },

  toggleBookmark(slug, qid) {
    const k = qkey(slug, qid);
    const on = !state.bookmarks[k];
    if (on) state.bookmarks[k] = Date.now();
    else delete state.bookmarks[k];
    save();
    return on;
  },

  rate(slug, qid, rating) {
    state.ratings[qkey(slug, qid)] = { rating, at: Date.now() };
    if (rating === "knew") state.reviewed[qkey(slug, qid)] = Date.now();
    save();
  },

  reviewedCount(slug) {
    const prefix = `${slug}/`;
    return Object.keys(state.reviewed).filter((k) => k.startsWith(prefix)).length;
  },

  totalReviewed: () => Object.keys(state.reviewed).length,
  bookmarkKeys: () => Object.keys(state.bookmarks),

  setLast(slug, qid) {
    state.last = { slug, qid: qid || null, at: Date.now() };
    save();
  },

  setTheme(theme) {
    state.theme = theme;
    save();
  },

  exportJSON: () => JSON.stringify({ app: "interview-prep", version: 1, ...state }, null, 2),

  importJSON(text) {
    const data = JSON.parse(text);
    if (data.app !== "interview-prep") throw new Error("This file is not an Interview Prep progress export.");
    state = { ...blank(), reviewed: data.reviewed || {}, bookmarks: data.bookmarks || {}, ratings: data.ratings || {}, last: data.last || null, theme: state.theme };
    save();
  },

  reset() {
    state = { ...blank(), theme: state.theme };
    save();
  },
};
