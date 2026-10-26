"""Insert new questions into a course file and renumber every question.

Usage: python tools/insert_questions.py docs/02_React.md new_questions.md

new_questions.md contains blocks introduced by directive lines:
    @@AFTER Q05      (insert after existing question Q05)
    @@BEFORE Q10     (insert before existing question Q10)
followed by one or more questions written as "### QNEW. Title" … "---".

After inserting, every "### Qnn." heading is renumbered in order, in-text
references like "Q24" / "(see Q34)" are remapped to the new numbers (references
to other courses such as "Vite Q24" or "08 Q10" are left alone), and the
"(Qa–Qb)" ranges in the table of contents are recomputed.
"""

import re
import sys
from pathlib import Path

course, new_file = Path(sys.argv[1]), Path(sys.argv[2])
lines = course.read_text(encoding="utf-8").split("\n")
new_text = new_file.read_text(encoding="utf-8")

Q_RE = re.compile(r"^### (Q\d+)\.")
FENCE = re.compile(r"^\s*```")


def blocks_index(lines):
    """Map question id -> (start, end) line span (end exclusive), ignoring fenced code."""
    spans, current, in_fence = {}, None, False
    for i, l in enumerate(lines):
        if FENCE.match(l):
            in_fence = not in_fence
        if in_fence:
            continue
        m = Q_RE.match(l)
        if m or l.startswith("## "):
            if current:
                spans[current[0]] = (current[1], i)
            current = (m.group(1), i) if m else None
    if current:
        spans[current[0]] = (current[1], len(lines))
    return spans


directives = re.split(r"^@@(AFTER|BEFORE) (Q\d+)\s*$", new_text, flags=re.M)
inserts = []  # (anchor, where, text)
for i in range(1, len(directives), 3):
    where, anchor, body = directives[i], directives[i + 1], directives[i + 2].strip("\n")
    inserts.append((anchor, where, body))

spans = blocks_index(lines)
# apply from the bottom so earlier indices stay valid
def position(item):
    anchor, where, _ = item
    s, e = spans[anchor]
    return e if where == "AFTER" else s

for anchor, where, body in sorted(inserts, key=position, reverse=True):
    assert anchor in spans, f"unknown anchor {anchor}"
    pos = position((anchor, where, body))
    chunk = body.split("\n")
    if chunk[-1].strip() != "---":
        chunk += ["", "---"]
    lines[pos:pos] = chunk + [""]

# renumber
mapping, n, in_fence = {}, 0, False
for i, l in enumerate(lines):
    if FENCE.match(l):
        in_fence = not in_fence
        continue
    if in_fence:
        continue
    m = re.match(r"^### (Q\d+|QNEW)\.(.*)$", l)
    if m:
        n += 1
        new_id = f"Q{n:02d}"
        if m.group(1) != "QNEW":
            mapping[m.group(1)] = new_id
        lines[i] = f"### {new_id}.{m.group(2)}"

text = "\n".join(lines)
# remap in-text references (not headings, not references to other courses)
OTHER = r"(?<!Vite )(?<!Python )(?<![0-9] )"
def remap(m):
    return mapping.get(m.group(0), m.group(0))
body_lines = []
for l in text.split("\n"):
    if l.startswith("### Q"):
        body_lines.append(l)
    else:
        body_lines.append(re.sub(OTHER + r"\bQ\d{2}\b", remap, l))
text = "\n".join(body_lines)

# recompute TOC ranges: "N. [Title](#anchor) (Qa–Qb)"
section_ranges, current = {}, None
for l in text.split("\n"):
    s = re.match(r"^## (\d+)\. ", l)
    if s:
        current = s.group(1)
    q = re.match(r"^### Q(\d+)\.", l)
    if q and current:
        lo, hi = section_ranges.get(current, (None, None))
        v = int(q.group(1))
        section_ranges[current] = (lo if lo is not None else v, v)

def toc(m):
    num = m.group(1)
    if num not in section_ranges:
        return m.group(0)
    lo, hi = section_ranges[num]
    rng = f"Q{lo:02d}" if lo == hi else f"Q{lo:02d}–Q{hi:02d}"
    return f"{m.group(1)}. {m.group(2)} ({rng})"
text = re.sub(r"^(\d+)\. (\[[^\]]+\]\([^)]+\)) \(Q\d+(?:–Q\d+)?\)", toc, text, flags=re.M)

course.write_text(text, encoding="utf-8")
print(f"{course.name}: {n} questions; renumbered {sum(1 for k, v in mapping.items() if k != v)} existing ids")
