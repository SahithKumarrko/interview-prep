# Interview Prep Handbook

A static, single-page study app for the Infosys Specialist Programmer L2 → L3 interview: 22 courses and 928 questions covering Python, React, Vite, GenAI, agentic AI, LangChain, LangGraph, Bedrock AgentCore, GitLab CI/CD, Docker, Terraform, AWS (foundations, ECS, Lambda, Step Functions, Secrets Manager, EC2), system design, DSA, FastAPI, databases and design patterns.

Plain HTML, CSS and JavaScript. No framework and no build step for the site itself.

## Features

- Reading view per course: mental-model diagrams, every question with a short answer, explanation, examples and pitfalls
- Search across all courses (`Ctrl K` / `⌘ K` or `/`)
- Progress tracking: mark questions reviewed, bookmark them, see progress per course
- Flashcards per course, across all courses or from bookmarks, with "knew it / shaky / didn't know" ratings that bring missed cards back
- Dark and light themes, mobile layout, deep links to every question (`#/c/<course>/<Q05>`)
- Progress lives in your browser's localStorage; export and import it as a JSON file to move devices

## Project layout

```
index.html               app shell
assets/css/app.css       styles and themes
assets/js/app.js         router, views, flashcards, search palette
assets/js/store.js       progress / bookmarks / theme (localStorage)
assets/js/search.js      in-memory search index
assets/vendor/           marked 12.0.2, highlight.js 11.9.0 (+ dockerfile grammar), vendored for offline use
data/index.json          course list (generated)
data/courses/*.json      one file per course (generated)
docs/                    source markdown for every course + the study guide (docs/README.md)
tools/build_data.py      converts docs/*.md into data/*.json
```

## Run locally

Browsers block `fetch` from `file://`, so serve the folder:

```bash
python -m http.server 8000
# open http://localhost:8000
```

## Edit content

The markdown in `docs/` is the source of truth. After editing it, regenerate the JSON:

```bash
python tools/build_data.py
```

The script (Python 3.10+, standard library only) checks every file: question counts, unique IDs and balanced code fences. If something is malformed it stops and names the file. Commit the regenerated `data/` together with the markdown change.

Markdown conventions the parser relies on:

- `# Title` on the first line, then `> **Updated:** <date> · **Level:** <text>`
- Sections as `## N. Section title`
- Questions as `### Qnn. Question title`, with IDs unique within the file
- An optional `**Short answer:**` paragraph, which is used on flashcards. Without it, the first paragraph is used.

## Publish on GitHub Pages

1. Push this folder to a GitHub repository.
2. In the repository, open **Settings → Pages**, set **Source** to "Deploy from a branch", choose `main` and `/ (root)`, then save.
3. The site appears at `https://<user>.github.io/<repo>/` after a minute. The empty `.nojekyll` file makes Pages serve the files as they are.
