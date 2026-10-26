"""Validate one course markdown file without writing anything.

Usage: python tools/check_course.py docs/05_Agentic_AI.md

Checks:
- title line, sections ("## N. ...") and questions ("### Qnn. ...") parse
- question ids are sequential Q01..Qnn with no gaps or duplicates
- every question has a "**Short answer:**" paragraph
- code fences are balanced
- every ```flow block starts with sequence:/pipeline:/cycle:/trace: and has no
  ambiguous " > " in labels (only one " > " allowed per non-sequence line)
- sequence lines match "A -> B: label"
Prints a summary; exits with code 1 if any check fails.
"""

import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
lines = text.split("\n")
errors = []

if not lines[0].startswith("# "):
    errors.append("first line must be '# Title'")
if text.count("```") % 2:
    errors.append("unbalanced ``` fences")

ids, in_fence = [], False
for l in lines:
    if re.match(r"^\s*```", l):
        in_fence = not in_fence
        continue
    if not in_fence:
        m = re.match(r"^### (Q\d+)\.", l)
        if m:
            ids.append(m.group(1))
expected = [f"Q{i:02d}" for i in range(1, len(ids) + 1)]
if ids != expected:
    errors.append(f"question ids must be sequential Q01..Q{len(ids):02d}; got {ids}")

blocks = re.split(r"^### Q\d+\..*$", text, flags=re.M)[1:]
missing = [ids[i] for i, b in enumerate(blocks) if "**Short answer:**" not in b.split("\n## ")[0]]
if missing:
    errors.append(f"missing **Short answer:** in {missing}")

SEQ = re.compile(r"^(.+?)\s*(-->|->)\s*(.+?)\s*:\s*(.+)$")
flows = list(re.finditer(r"```flow\n(.*?)```", text, re.S))
for f in flows:
    body = [l.strip() for l in f.group(1).split("\n") if l.strip()]
    kind = body[0].split(":")[0] if body else ""
    if kind not in ("sequence", "pipeline", "cycle", "trace"):
        errors.append(f"flow must start with sequence:/pipeline:/cycle:/trace: -> {body[:1]}")
        continue
    steps = 0
    for l in body[1:]:
        if l.startswith(">"):
            continue
        if kind == "sequence":
            if l.startswith("actors:"):
                continue
            if not SEQ.match(l):
                errors.append(f"bad sequence line: {l[:80]}")
        else:
            if l.startswith("stage:") or l.startswith("exit >"):
                continue
            if l.count(" > ") > 1:
                errors.append(f"ambiguous ' > ' in flow line: {l[:80]}")
        steps += 1
    if steps < 2:
        errors.append(f"flow has fewer than 2 steps: {body[0][:60]}")

print(f"{path.name}: {len(ids)} questions, {len(flows)} diagrams, {len(text.split())} words")
if errors:
    print("FAILED:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print("OK")
