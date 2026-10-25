// In-memory full-text search over every question in every course.

const strip = (md) =>
  md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_>#|]/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

export function buildIndex(courses) {
  const docs = [];
  for (const c of courses) {
    for (const s of c.sections) {
      for (const q of s.questions) {
        const short = strip(q.short_md);
        docs.push({
          slug: c.slug,
          course: c.title,
          accent: c.accent,
          num: c.num,
          qid: q.id,
          title: q.title.replace(/[`*]/g, ""),
          short,
          t: q.title.replace(/[`*]/g, "").toLowerCase(),
          s: short.toLowerCase(),
          b: (strip(q.body_md) + " " + q.body_md).toLowerCase(),
          c: c.title.toLowerCase(),
        });
      }
    }
  }
  return docs;
}

export function search(index, query, limit = 40) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const phrase = terms.join(" ");
  const results = [];
  for (const d of index) {
    let score = 0;
    let ok = true;
    for (const t of terms) {
      const inT = d.t.includes(t), inS = d.s.includes(t), inB = d.b.includes(t), inC = d.c.includes(t);
      if (!(inT || inS || inB || inC)) { ok = false; break; }
      score += (inT ? 10 : 0) + (inS ? 4 : 0) + (inB ? 1 : 0) + (inC ? 2 : 0);
    }
    if (!ok) continue;
    if (terms.length > 1) {
      if (d.t.includes(phrase)) score += 15;
      else if (d.s.includes(phrase) || d.b.includes(phrase)) score += 6;
    }
    results.push({ d, score });
  }
  results.sort((a, b) => b.score - a.score || a.d.num - b.d.num);
  return results.slice(0, limit).map((r) => r.d);
}

export function snippet(text, query, len = 150) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    at = lower.indexOf(t);
    if (at >= 0) break;
  }
  const start = Math.max(0, at - 40);
  let out = text.slice(start, start + len);
  if (start > 0) out = "…" + out;
  if (start + len < text.length) out += "…";
  return out;
}
