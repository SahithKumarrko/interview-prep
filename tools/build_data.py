"""Convert docs/NN_*.md interview-prep courses into JSON for the web app.

Usage:  python tools/build_data.py
Output: data/index.json and data/courses/<slug>.json

Structure expected in each markdown file:
  # Title
  > **Updated:** ... · **Level:** ...
  ## N. Section title          (## Table of contents is skipped)
  ### Qnn. Question title
Headings inside ``` fenced code blocks are ignored.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
OUT = ROOT / "data"

# course number -> (group, accent colour)
GROUPS = {
    "Core": ({1, 2, 3}, "#60a5fa"),
    "AI & Agents": ({4, 5, 6, 7, 8}, "#a78bfa"),
    "DevOps": ({9, 10, 11}, "#f59e0b"),
    "AWS": ({12, 13, 14, 15, 16, 17}, "#fb923c"),
    "Design & Coding": ({18, 19, 20, 21, 22}, "#34d399"),
}
ACCENTS = [
    "#60a5fa", "#38bdf8", "#a78bfa", "#c084fc", "#f472b6", "#fb7185",
    "#f59e0b", "#fbbf24", "#34d399", "#2dd4bf", "#fb923c", "#818cf8",
]

FILE_RE = re.compile(r"^(\d{2})_(.+)\.md$")
H2_RE = re.compile(r"^## (?:(\d+)\.\s+)?(.+?)\s*$")
Q_RE = re.compile(r"^### (Q\d+)\.\s+(.+?)\s*$")
FENCE_RE = re.compile(r"^\s*```")


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def group_for(num: int) -> str:
    for name, (nums, _) in GROUPS.items():
        if num in nums:
            return name
    return "Other"


def strip_trailing_rule(md: str) -> str:
    """Remove trailing horizontal rules / blank lines left between questions."""
    lines = md.rstrip().splitlines()
    while lines and lines[-1].strip() in ("---", ""):
        lines.pop()
    return "\n".join(lines).strip("\n")


def short_answer(body: str) -> str:
    """Paragraph after **Short answer:**, else the first prose paragraph."""
    m = re.search(r"\*\*Short answer:\*\*\s*(.+?)(?:\n\s*\n|\n```|\Z)", body, re.S)
    if m:
        text = m.group(1).strip()
        if text:
            return text
    para: list[str] = []
    for line in body.splitlines():
        s = line.strip()
        if FENCE_RE.match(line) or s.startswith("|"):
            if para:
                break
            continue
        if not s:
            if para:
                break
            continue
        if s.startswith("#"):
            continue
        para.append(s)
    text = " ".join(para)
    if text:
        return text[:600] + ("…" if len(text) > 600 else "")
    return first_block(body)


def first_block(body: str, max_lines: int = 14) -> str:
    """For answers that are only a table or code block: return that block (trimmed)."""
    out: list[str] = []
    in_fence = False
    for line in body.splitlines():
        if FENCE_RE.match(line):
            out.append(line)
            if in_fence:
                break
            in_fence = True
            continue
        if in_fence or line.strip().startswith("|"):
            out.append(line)
        elif out:
            break
    if in_fence and len(out) > max_lines:
        out = out[: max_lines - 1] + ["…", "```"]
    elif len(out) > max_lines:
        out = out[:max_lines]
    return "\n".join(out).strip()


def parse(path: Path) -> dict:
    lines = path.read_text(encoding="utf-8").splitlines()
    title, updated, level = "", "", ""
    sections: list[dict] = []
    current_section: dict | None = None
    current_q: dict | None = None
    buf: list[str] = []
    in_fence = False
    fence_count = 0

    def flush() -> None:
        nonlocal buf
        text = strip_trailing_rule("\n".join(buf))
        if current_q is not None:
            current_q["body_md"] = text
        elif current_section is not None:
            current_section["intro_md"] = text
        buf = []

    for line in lines:
        if FENCE_RE.match(line):
            in_fence = not in_fence
            fence_count += 1
            buf.append(line)
            continue
        if not in_fence:
            if line.startswith("# ") and not title:
                title = line[2:].strip()
                continue
            if line.startswith("> **Updated:**"):
                m = re.search(r"\*\*Updated:\*\*\s*([^·]+)", line)
                updated = m.group(1).strip() if m else ""
                m = re.search(r"\*\*Level:\*\*\s*(.+)$", line)
                level = m.group(1).strip() if m else ""
                continue
            if line.startswith("> **How to use:**") and current_section is None:
                continue
            h2 = H2_RE.match(line)
            if h2 and line.startswith("## "):
                flush()
                current_q = None
                name = h2.group(2)
                current_section = {
                    "id": slugify(name),
                    "num": int(h2.group(1)) if h2.group(1) else None,
                    "title": name,
                    "intro_md": "",
                    "questions": [],
                    "skip": name.lower() == "table of contents",
                }
                sections.append(current_section)
                continue
            q = Q_RE.match(line)
            if q:
                flush()
                if current_section is None:
                    raise ValueError(f"{path.name}: question before any section: {line}")
                current_q = {"id": q.group(1), "title": q.group(2), "short_md": "", "body_md": ""}
                current_section["questions"].append(current_q)
                continue
        if current_section is not None:
            buf.append(line)
    flush()

    if fence_count % 2:
        raise ValueError(f"{path.name}: unbalanced code fences ({fence_count})")

    sections = [s for s in sections if not s.pop("skip")]
    for s in sections:
        for q in s["questions"]:
            q["short_md"] = short_answer(q["body_md"])
    return {"title": title, "updated": updated, "level": level, "sections": sections}


def main() -> int:
    files = sorted(p for p in DOCS.iterdir() if FILE_RE.match(p.name))
    if not files:
        print("no course files found in docs/", file=sys.stderr)
        return 1
    (OUT / "courses").mkdir(parents=True, exist_ok=True)
    index = []
    total = 0
    print(f"{'course':40} {'sections':>8} {'questions':>9}")
    for i, path in enumerate(files):
        num_s, raw = FILE_RE.match(path.name).groups()
        num = int(num_s)
        slug = f"{num_s}-{slugify(raw)}"
        data = parse(path)
        questions = [q for s in data["sections"] for q in s["questions"]]
        expected = sum(1 for l in path.read_text(encoding="utf-8").splitlines() if Q_RE.match(l))
        ids = [q["id"] for q in questions]
        if len(questions) != expected:
            raise ValueError(f"{path.name}: parsed {len(questions)} questions, file has {expected} headings")
        if len(set(ids)) != len(ids):
            dupes = sorted({x for x in ids if ids.count(x) > 1})
            raise ValueError(f"{path.name}: duplicate question ids {dupes}")
        empty = [q["id"] for q in questions if not q["short_md"]]
        if empty:
            raise ValueError(f"{path.name}: no short answer derivable for {empty}")

        short_title = re.split(r":\s*(?:L2|Interview)", data["title"])[0].strip()
        course = {
            "slug": slug,
            "num": num,
            "title": short_title,
            "full_title": data["title"],
            "group": group_for(num),
            "accent": ACCENTS[i % len(ACCENTS)],
            "updated": data["updated"],
            "level": data["level"],
            "source": f"docs/{path.name}",
            "question_count": len(questions),
            "section_count": len(data["sections"]),
        }
        (OUT / "courses" / f"{slug}.json").write_text(
            json.dumps({**course, "sections": data["sections"]}, ensure_ascii=False, indent=1),
            encoding="utf-8",
        )
        index.append(course)
        total += len(questions)
        print(f"{short_title[:40]:40} {len(data['sections']):>8} {len(questions):>9}")

    groups = [{"name": g, "accent": a} for g, (_, a) in GROUPS.items()]
    (OUT / "index.json").write_text(
        json.dumps({"total_questions": total, "groups": groups, "courses": index}, ensure_ascii=False, indent=1),
        encoding="utf-8",
    )
    print(f"\n{len(index)} courses, {total} questions -> {OUT.relative_to(ROOT)}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
