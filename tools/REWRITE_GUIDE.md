# Course rewrite guide (the standard every course must meet)

The reader is preparing for interviews and wants to **understand** each concept, not decode it. The gold-standard example is `docs/02_React.md`. Read several of its questions (for example Q07, Q08, Q10, Q18, Q21, Q42) before writing anything, and match its depth and tone.

## 1. Research first: find what's missing
Before rewriting, list the course's current questions. Then compare them against the official learning path or docs for the topic (the official tutorial or concepts guide), using Context7 (`resolve-library-id` → `query-docs`) or WebFetch on the official docs.

**Add every missing fundamental concept.** The course must start from "what is X" before "how does X work". For example, React was missing "What is a hook?", "What is JSX?", "What is state?" and "How do you handle events?". Each course will have equivalents: what is a decorator, what is a container image, what is an IAM role, what is a Lambda execution environment, what is a checkpointer, and so on. Place new questions **where they belong logically** (basics first), not at the end.

## 2. Answer template (every question)
```
### Qnn. Clear question title

**Short answer:** 2–4 plain sentences. Say what the thing IS in everyday words, what it's for,
and the one key rule. Explain any technical term in the same sentence the first time it appears.

**How it works:** the mechanism in the order it happens, with the "why". Use an analogy if it
genuinely helps. Short paragraphs or a numbered list.

**Example:** a realistic, minimal snippet (code, config, CLI or a concrete scenario with numbers).

**What happens, step by step:** a numbered walkthrough tied to the example: actual values and
outputs at each step, and WHEN things change. Never show code with a comment like "// still 0"
without explaining why, when it changes, and how to get the value you want.

**Common mistake → fix:** the wrong version, concretely why it breaks, the corrected version.

**Interview answer:** a ready-to-say 3–5 sentence answer.

**Follow-ups:**
- *Likely follow-up question?* 1–2 sentence answer.
```
- Keep the exact label `**Short answer:**` (the app uses it for flashcards and search).
- **Comparison questions:** a table, plus a "how to choose" rule.
- **Debugging/scenario questions:** numbered steps; each says what to check, how to check it, and what the result means. Then the fix.
- Simple questions stay short. Length comes from clarity, not padding.
- Plain English and active voice. No unexplained jargon or acronyms (expand them on first use: "IAM (Identity and Access Management)").
- No role-, company- or person-specific wording (no "your platform at work", no company names, no seniority grades like L2/L3). The handbook is generic.

## 3. Diagrams (```flow blocks): fewer, correct, useful
Only add a diagram when it shows something the text can't:
- an order of interactions between parties (`sequence:`),
- data or state changing over time (`trace:`),
- a real loop (`cycle:`),
- a true multi-stage pipeline (`pipeline:`).

Each diagram must use the **same names and values as the example** in that answer. Each caption is a complete plain sentence saying what happens and why. **Never** turn a checklist, comparison or list of tips into a diagram; use a table or a numbered list instead. Expect roughly 10–20 diagrams per course, not one per question.

Syntax (rendered by `assets/js/flow.js`):
```
sequence: Title
actors: User, API, DB
User -> API: label          (request)
API --> User: label         (reply, dashed)
API -> API: label           (step inside one actor)
> caption for the step above

pipeline: Title             cycle: Title               trace: Title
stage: Optional group       Step > caption             state of the data > caption
Step label > caption        exit > when the loop ends  (wrap a highlighted cell in **…**)
```
In pipeline, cycle and trace lines, ` > ` separates the label from the caption. **Never put ` > ` inside a label**; write "is above" or "greater than" instead.

## 4. Correctness
- Verify every version-specific or numeric fact (API names, defaults, limits, quotas, timeouts, pricing models, newest features) against official docs via Context7 or WebFetch **before** writing it. Don't write facts from memory when you're unsure; leave them out or check them.
- Label illustrative numbers or prices as illustrative.
- Code must be correct and runnable in spirit (right imports, right API names).

## 5. File structure (the parser depends on it)
- Line 1: `# <Course title>: Interview Preparation`
- Line 3: `> **Updated:** 27 October 2026 · **Level:** …` and a `> **How to use:** …` line, like React's.
- `## Table of contents` with lines like `2. [Fundamentals](#2-fundamentals) (Q01–Q12)`.
- `## 1. Mental model: …` (no questions; a short intuitive overview, optionally with one diagram).
- Sections are `## N. Title`. Questions are `### Qnn. Title`, numbered **sequentially from Q01 across the whole file** with no gaps. Renumber after inserting new questions, and update the TOC ranges.
- End with `## N. Cheat sheet` (a 2-column table) and `## Official references` (links).
- **Do not reference other courses by question number** (no "see 08 Q10"). Refer by topic name instead, e.g. "(see the AgentCore course, Runtime service contract)". Same-file references like "(see Q12)" are fine but must be correct after renumbering.

## 6. How to write the file
- Files are large. Write the new course in several parts (for example in your scratchpad: `part1.md`, `part2.md` …), then concatenate them into `docs/<file>.md`. Don't try to emit the whole file in one tool call.
- After writing, run: `python tools/check_course.py docs/<file>.md`. It must print OK. Fix anything it reports.
- Do **not** run `tools/build_data.py`, do **not** edit `data/`, `assets/` or other courses, and do **not** commit or push. The coordinator reviews, builds and commits.

## 7. Report back
When done, reply with:
- per course: question count before and after, the list of NEW questions you added (titles), diagrams count, and the check_course output,
- any facts you could not verify,
- anything you were unsure about.
