# Vite.js: Interview Preparation

> **Updated:** 27 October 2026 (Vite 8 is current, stable since March 2026, built on **Rolldown** and **Oxc**) · **Level:** basics → internals → production delivery
> **How to use:** read the *Short answer* first, then *How it works* and the *Example* walkthrough. *Common mistake → fix* shows what goes wrong in real projects. *Interview answer* is what you can say out loud.

---

## Table of contents

1. [Mental model: what Vite does](#1-mental-model-what-vite-does)
2. [Fundamentals](#2-fundamentals) (Q01–Q12)
3. [Configuration & environment](#3-configuration--environment) (Q13–Q19)
4. [Build output, assets & performance](#4-build-output-assets--performance) (Q20–Q27)
5. [Deployment & security](#5-deployment--security) (Q28–Q33)
6. [Scenario & debugging questions](#6-scenario--debugging-questions) (Q34–Q38)
7. [Cheat sheet](#7-cheat-sheet)

---

## 1. Mental model: what Vite does

**The one idea everything else follows from:** the code you write (TypeScript, JSX, CSS imports, images) is not what a browser can run directly, and it is not in the shape a browser should download in production. Vite is the tool that sits between your source files and the browser. It has two very different jobs:

- **In development** it is a fast local web server. When the browser asks for a file, Vite converts just that file (for example TypeScript to JavaScript) and sends it back. Nothing is bundled up front, so the server starts in about the same time whether your app has 10 files or 10,000.
- **In production** it is a bundler. `vite build` reads the whole app, combines the files into a few optimised ones, removes unused code, shrinks it, and writes static files into `dist/`. Vite itself is not running when real users visit the site; only those static files are.

Think of a restaurant kitchen. During development, Vite is a cook who prepares each dish the moment it's ordered. For production, Vite is the factory that prepares and packs all the meals in advance, so the shop (your CDN or web server) only has to hand them out.

```flow
pipeline: The same source code, two different jobs
stage: Development (npm run dev)
Browser asks for /src/main.tsx > Vite converts only that file from TypeScript and JSX to JavaScript and returns it as a native ES module.
Browser follows the imports > Each import becomes another request, and Vite converts each file only when it is asked for.
You save a file > Vite pushes a message over a WebSocket and the browser swaps just that module, keeping React state.
stage: Production (npm run build)
Rolldown bundles the whole app > All modules are combined, unused exports are removed and the code is minified.
Files get content hashes > Output names like index-4f9c2a1b.js change only when their content changes, so they can be cached for a year.
dist/ is deployed > Plain static files go to a CDN or web server. Vite is not running in production.
```

**Three rules that come straight from this model:**
1. **Dev and production are different pipelines.** Dev serves many small unbundled modules; production serves a few bundled files. Always check the real build with `vite build` and `vite preview` before you ship.
2. **Anything decided at build time is frozen into the files.** Environment variables like `import.meta.env.VITE_API_URL` are replaced with literal text during the build, so they are public and need a rebuild to change.
3. **Vite does not run in production.** Proxies, the dev server and HMR exist only on your machine. Routing, headers, caching and CORS in production belong to your host (CDN, Nginx, API gateway).

**Version history to know:**

| Version | What changed |
|---|---|
| Vite 1–7 | Two tools under the hood: **esbuild** for dev transforms and dependency pre-bundling, **Rollup** for the production build |
| Vite 7 (2025) | Node.js 20.19+ or 22.12+, default browser target `'baseline-widely-available'` |
| **Vite 8 (12 March 2026)** | **Rolldown** (a Rust bundler) replaces both esbuild and Rollup; **Oxc** handles parsing, transforming and minifying; Lightning CSS is the default CSS minifier; `build.rollupOptions` renamed to `build.rolldownOptions`; built-in `resolve.tsconfigPaths`; Vite is published as ESM only; `@vitejs/plugin-react` v6 uses Oxc instead of Babel |

---

## 2. Fundamentals

### Q01. What is a build tool, and why does a web app need one?

**Short answer:** A **build tool** is a program that turns the files you write into files a browser can load efficiently. Browsers understand plain JavaScript, CSS and HTML; they do not understand TypeScript, JSX, `import logo from "./logo.svg"` or packages referenced by name like `import React from "react"`. A build tool translates all of that, and for production it also combines and shrinks the files so the page loads fast.

**How it works:** A build tool usually does four jobs:
1. **Transform:** convert each file into something the browser understands. TypeScript loses its types, JSX becomes function calls, a `.svg` import becomes a URL string.
2. **Resolve:** work out where each import points. `"react"` is a "bare" name; the browser can't find it, so the tool maps it to a real file inside `node_modules`.
3. **Bundle:** combine many modules into a few files, so the browser makes a handful of requests instead of hundreds.
4. **Optimise:** remove unused code (tree shaking), minify (shorten names, strip whitespace), split code into chunks that load on demand, and add content hashes to file names for caching.

**Example:** you write this:
```tsx
// src/main.tsx
import { createRoot } from "react-dom/client";
import logo from "./logo.svg";
const title: string = "Hello";
createRoot(document.getElementById("root")!).render(<img src={logo} alt={title} />);
```

**What happens, step by step:**
1. The browser can't run `: string` (TypeScript) or `<img … />` (JSX). The build tool strips the type and turns the JSX into a call like `jsx("img", { src: logo, alt: title })`.
2. `"react-dom/client"` is a bare name. The build tool finds the file in `node_modules/react-dom/` and points the import there.
3. `./logo.svg` becomes a URL string, for example `"/assets/logo-a1b2c3d4.svg"`, and the SVG file is copied into the output.
4. In production, your code and React are combined into a file like `dist/assets/index-4f9c2a1b.js`, minified, and referenced from `dist/index.html`.

**Common mistake → fix:** thinking the build tool "runs" your app in production. It doesn't. After `vite build` you have static files; if something must happen per request (secrets, auth, routing to an API), it belongs to a server or the hosting layer, not to Vite.

**Interview answer:** "A build tool turns source code the browser can't run directly, like TypeScript, JSX and package imports, into plain JavaScript, CSS and HTML. It resolves imports, transforms each file, and for production bundles, tree-shakes, minifies and fingerprints the output. Vite is a build tool that also gives you a very fast development server."

**Follow-ups:**
- *Examples of build tools?* Vite, webpack, Parcel, Rspack, and the older Create React App (which wrapped webpack and is now deprecated).
- *Is a compiler the same as a bundler?* No. A compiler/transformer handles one file at a time (TS to JS); a bundler combines many files into a few.

---

### Q02. What is Vite, and how is it different from React?

**Short answer:** **React** is a UI library: it runs in the user's browser and decides what to show on the screen. **Vite** is a development server plus build tool: it runs on your machine or in CI (continuous integration, the automated build server), compiles your React code, and produces static files. Vite also works with Vue, Svelte, Solid or plain JavaScript; it is not tied to React.

**How it works:** you write React components. During development Vite serves them to the browser, converting each file on request. For release, Vite bundles them into `dist/`. When a user visits the site, the browser downloads those files and React runs inside the browser. Vite has finished its work long before that.

**Example:**
```bash
npm create vite@latest my-app -- --template react-ts
cd my-app
npm install
npm run dev       # runs "vite"          → dev server at http://localhost:5173
npm run build     # runs "tsc -b && vite build" → writes dist/
npm run preview   # runs "vite preview"  → serves dist/ at http://localhost:4173
```

**What happens, step by step:**
1. `npm create vite@latest` downloads the scaffolding tool and copies the `react-ts` template: `index.html`, `src/main.tsx`, `src/App.tsx`, `vite.config.ts`, TypeScript config files and a `package.json` with `vite` and `@vitejs/plugin-react` as dev dependencies.
2. `npm run dev` starts Vite's dev server on port 5173. Opening it in the browser shows the app; React runs in the browser, Vite serves the files.
3. `npm run build` type-checks with `tsc -b`, then Vite writes `dist/index.html` and `dist/assets/*.js|css`.
4. You upload `dist/` to a static host. From now on only the browser and React are involved.

**Common mistake → fix:** saying "Vite renders the page" or putting server logic (database calls, secrets) into a Vite React app expecting it to run on a server. A plain Vite SPA (single-page application) is 100% client-side. If you need a server, add a backend (for example FastAPI) or use a framework with server rendering built on Vite.

**Interview answer:** "React is a UI library that runs in the browser and turns state into UI. Vite is the dev server and build tool that runs on my machine and in CI: it serves files with instant hot reload in development and bundles the app into static files for production. Vite isn't running in production at all, and it isn't React-specific."

**Follow-ups:**
- *What replaced Create React App?* The React docs recommend starting with a framework, or with a build tool like Vite for a plain client-side app. Create React App is deprecated.
- *Which frameworks build on Vite?* Many: SvelteKit, Nuxt, Astro, Remix/React Router's framework mode, SolidStart, and others use Vite under the hood.

---

### Q03. What are ES modules (`import`/`export`), and why does Vite rely on them?

**Short answer:** **ES modules (ESM)** are JavaScript's built-in module system: each file declares what it shares with `export` and what it needs with `import`. Modern browsers can load ES modules natively with `<script type="module">`, following each `import` with a separate HTTP request. Vite's dev server is built on this: it lets the browser do the module loading and only converts the files the browser actually requests.

**How it works:**
1. `<script type="module" src="/src/main.tsx">` tells the browser "this file is a module".
2. The browser downloads it, reads its `import` lines, and requests each imported file.
3. Imports are **static**: they are at the top level and use fixed strings, so tools can see the full dependency graph without running the code. This is also what makes tree shaking possible.
4. Browsers only accept URLs in imports (`"/src/App.tsx"`, `"./App.tsx"`), not bare package names (`"react"`). Vite rewrites bare names to real URLs before sending a file.

The older format, **CommonJS** (`require()` and `module.exports`), is what Node.js used originally. Browsers can't load it, which is why Vite converts CommonJS packages to ESM (see Q07).

**Example:**
```ts
// src/math.ts
export function add(a: number, b: number) { return a + b; }
export const PI = 3.14159;

// src/main.ts
import { add } from "./math";
console.log(add(2, 3));
```

**What happens, step by step (in dev):**
1. The browser requests `/src/main.ts`. Vite strips the types and rewrites `"./math"` to `"/src/math.ts"`.
2. The browser sees `import { add } from "/src/math.ts"` and requests that URL.
3. Vite returns the converted `math.ts`. The browser links `add` and runs `main.ts`, which logs `5`.
4. In the production build, Rolldown sees that `PI` is never imported anywhere and drops it from the bundle.

**Common mistake → fix:** mixing formats, for example `const x = require("./x")` in browser code. It works in some Node setups but fails in the browser with "require is not defined". Use `import` in app code; if a dependency only ships CommonJS, Vite's pre-bundling converts it for you.

**Interview answer:** "ES modules are the standard import/export system. Browsers load them natively with script type=module and fetch each import as its own request. Vite's dev server uses that directly: the browser walks the module graph, and Vite only transforms the files requested. Because imports are static, bundlers can also analyse them for tree shaking."

**Follow-ups:**
- *What is a dynamic import?* `import("./Reports")` returns a Promise and loads the module at runtime; bundlers turn it into a separate chunk (see Q23).
- *Why not ship unbundled ESM to production?* A large app has hundreds of modules; even with HTTP/2, the request waterfall (each file reveals its imports only after it downloads) makes loading slow. Bundling flattens that.

---

### Q04. What is a bundler, and what are Rolldown and Oxc?

**Short answer:** A **bundler** follows every `import` starting from your entry file and combines all the modules it finds into a few output files (chunks). **Rolldown** is the Rust-based bundler that Vite 8 uses for both the production build and dependency pre-bundling. **Oxc** is a Rust toolkit (parser, transformer, minifier) that Vite 8 uses to convert TypeScript and JSX and to minify JavaScript.

**How it works:**
1. **Parse:** read each file into a syntax tree (Oxc's parser).
2. **Build the module graph:** start at `src/main.tsx`, follow every import, record which module imports which.
3. **Tree-shake:** mark the exports that are really used and drop the rest.
4. **Chunk:** decide which modules go into which output files. Each dynamic `import()` starts a new chunk.
5. **Render and minify:** write the final code, shorten names, remove whitespace (Oxc minifier by default in Vite 8), add content hashes to file names.

Before Vite 8, Vite used two tools: esbuild (fast, Go) in development and Rollup (JavaScript) for production. They sometimes behaved slightly differently, so a bug could appear only in one mode. Rolldown has a Rollup-compatible plugin API and replaces both, which makes dev and build more consistent and production builds much faster (the Vite team reports 10–30× faster than Rollup in benchmarks).

**Example:** a real build log (numbers illustrative):
```
$ vite build
vite v8.0.x building client environment for production...
✓ 412 modules transformed.
dist/index.html                   0.46 kB
dist/assets/index-0c3e5b8a.css    5.12 kB │ gzip:  1.70 kB
dist/assets/Reports-7d1e0f22.js  48.30 kB │ gzip: 15.10 kB
dist/assets/index-4f9c2a1b.js   196.40 kB │ gzip: 61.80 kB
✓ built in 610ms
```

**What happens, step by step:**
1. Rolldown starts at `index.html` → `src/main.tsx` and finds 412 modules (your files plus React and other dependencies).
2. Oxc converts each `.tsx` file to JavaScript.
3. `Reports` was imported with `import()`, so it becomes its own chunk (`Reports-7d1e0f22.js`) and is only downloaded when that page opens.
4. Everything else ends up in the entry chunk `index-4f9c2a1b.js`, minified to about 196 kB (about 62 kB when compressed with gzip over the network).

**Common mistake → fix:** assuming every old Rollup option still works unchanged in Vite 8. Most do through a compatibility layer, but some don't: for example the object form of `output.manualChunks` was removed. Read the migration guide and move to `build.rolldownOptions` and Rolldown's `codeSplitting` option.

**Interview answer:** "A bundler walks the import graph from the entry, tree-shakes unused exports, groups modules into chunks, and writes minified, hashed files. Vite 8 uses Rolldown, a Rust bundler with a Rollup-compatible plugin API, for both dependency pre-bundling and production builds, and Oxc for parsing, TypeScript/JSX transforms and minification. Before Vite 8 it used esbuild in dev and Rollup for production."

**Follow-ups:**
- *Do Rollup plugins still work?* Most do, because Rolldown implements the Rollup plugin interface. Plugins that depend on esbuild-specific helpers (`transformWithEsbuild`) need esbuild installed or should switch to `transformWithOxc`.
- *What is Full Bundle Mode?* An experimental Vite 8 dev mode that bundles in development too, aimed at very large apps where many separate module requests become slow.

---

### Q05. What does a new Vite project contain, and what does each file do?

**Short answer:** A Vite React + TypeScript project has `index.html` at the root (the entry point), `src/` (your code), `public/` (files copied as-is), `vite.config.ts` (Vite settings) and `package.json` (scripts and dependencies). Knowing which file does what is the base for every other Vite question.

**How it works:**

| File / folder | What it does |
|---|---|
| `index.html` | The entry point. Its `<script type="module" src="/src/main.tsx">` is where the module graph starts. |
| `src/main.tsx` | Mounts React: `createRoot(document.getElementById("root")!).render(<App />)`. |
| `src/App.tsx` | Your top-level component. |
| `public/` | Files copied to `dist/` unchanged, served at the root URL (`/favicon.svg`). |
| `vite.config.ts` | Plugins, dev server, proxy, aliases, build options. |
| `tsconfig.json` (+ `tsconfig.app.json`, `tsconfig.node.json`) | TypeScript settings for app code and for config files that run in Node. |
| `package.json` | Scripts (`dev`, `build`, `preview`, `lint`) and dependencies. |
| `node_modules/.vite/` | Vite's cache of pre-bundled dependencies (safe to delete). |
| `dist/` | Output of `vite build` (what you deploy). |

**Example:** the scripts the template creates:
```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview"
  }
}
```

**What happens, step by step (`npm run build`):**
1. `tsc -b` type-checks the project using the TypeScript config files. If there's a type error, the command fails and Vite never runs.
2. `vite build` loads `vite.config.ts`, reads `index.html`, follows `/src/main.tsx` and every import.
3. Files from `public/` are copied to `dist/` unchanged.
4. Bundled, hashed JS and CSS are written to `dist/assets/`, and `dist/index.html` is rewritten to point at them.

**Common mistake → fix:** putting `index.html` in `public/` (Create React App habit). In Vite, `public/` files are never processed, so the `<script>` tag would not be bundled. Keep `index.html` at the project root (or at the configured `root`).

**Interview answer:** "index.html at the root is the entry, and its module script points at src/main.tsx, which mounts React. vite.config.ts holds plugins, server and build settings; public/ holds files copied verbatim; dist/ is the build output. The build script runs tsc first because Vite itself doesn't type-check."

**Follow-ups:**
- *Why two tsconfig files?* App code runs in the browser and config code (`vite.config.ts`) runs in Node, so they need different type libraries and settings.

---

### Q06. How does the Vite dev server work?

**Short answer:** In development Vite does not bundle your code. The browser loads `index.html`, sees `<script type="module" src="/src/main.tsx">`, and requests that file. Vite converts just that one file (TypeScript and JSX to JavaScript), rewrites its imports into URLs, and sends it back. The browser then requests each import the same way. Files the current page never imports are never processed, which is why start-up is almost instant.

**How it works:**
1. **Start:** Vite starts an HTTP server (port 5173 by default) and a WebSocket for hot updates. It scans your imports once to pre-bundle dependencies (Q07).
2. **Request:** the browser asks for `/src/main.tsx`.
3. **Transform:** Vite runs the file through the plugin pipeline: resolve imports, load the file, transform it (Oxc strips types and converts JSX; the React plugin adds Fast Refresh code).
4. **Rewrite imports:** `import App from "./App"` becomes `import App from "/src/App.tsx"`; `import React from "react"` becomes a URL into `node_modules/.vite/deps/`.
5. **Cache:** transformed files are cached in memory; source files get cheap `304 Not Modified` responses when unchanged, pre-bundled deps get a one-year browser cache.

Old webpack-style dev servers bundled the entire app before showing anything and rebuilt bundles on every change, so start-up got slower as the app grew. Vite's work grows only with what the current page imports.

**Example:**
```tsx
// src/main.tsx
import { createRoot } from "react-dom/client";
import App from "./App";
createRoot(document.getElementById("root")!).render(<App />);
```

```flow
sequence: Opening http://localhost:5173 in development
actors: Browser, Vite dev server
Browser -> Vite dev server: GET /
Vite dev server --> Browser: index.html with a module script for /src/main.tsx
> Vite serves index.html (and injects its small HMR client script).
Browser -> Vite dev server: GET /src/main.tsx
Vite dev server -> Vite dev server: Oxc converts TSX to JS and rewrites imports to URLs
Vite dev server --> Browser: JS that imports /node_modules/.vite/deps/react-dom_client.js and /src/App.tsx
> Only main.tsx was converted. App.tsx has not been touched yet.
Browser -> Vite dev server: GET /src/App.tsx
Vite dev server --> Browser: converted App.tsx
Browser -> Vite dev server: GET /node_modules/.vite/deps/react-dom_client.js
Vite dev server --> Browser: pre-bundled dependency, cached by the browser for a year
> The browser walks the module graph itself, one request per module.
```

**What happens, step by step:**
1. `GET /` returns `index.html`. The browser finds the module script and requests `/src/main.tsx`.
2. Vite converts `main.tsx`. The returned code imports `/src/App.tsx` and a pre-bundled `react-dom_client.js`.
3. The browser requests both. `App.tsx` is converted at that moment; React comes from the dependency cache.
4. If `App.tsx` imports `/src/pages/Reports.tsx` only through `lazy(() => import(...))`, that file is converted only when the user opens the Reports page.

**Common mistake → fix:** testing only in dev and shipping. Dev serves separate modules; production is bundled and minified, so problems like wrong file-name casing (works on Windows/macOS, fails on Linux CI), circular-import ordering, or CommonJS interop show up only in the build. Run `vite build && vite preview` (and ideally end-to-end tests against it) before shipping.

**Interview answer:** "Vite's dev server serves source files as native ES modules. The browser requests main.tsx, Vite transforms just that file and rewrites its imports into URLs, and the browser keeps following imports. Nothing is bundled, so start-up doesn't grow with app size, and node_modules dependencies are pre-bundled once and cached. The production build is a separate, bundled pipeline."

**Follow-ups:**
- *Why does the first page load in dev make many requests?* One per module. That's fine locally; for very large apps Vite 8 has an experimental Full Bundle Mode.
- *How do you warm up slow pages?* `server.warmup.clientFiles` lets Vite transform listed files in advance.

---

### Q07. What is dependency pre-bundling, and why does it exist?

**Short answer:** When the dev server starts, Vite scans your code for imports of packages (`react`, `lodash-es`), bundles each package into a single ES module file, and stores them in `node_modules/.vite/deps`. It does this for two reasons: browsers can't load CommonJS packages, so they must be converted to ESM; and packages made of hundreds of tiny modules would otherwise cause hundreds of requests. In Vite 8 Rolldown does this work; before, esbuild did.

**How it works:**
1. **Discover:** with no cache, Vite crawls your source for "bare" imports (package names).
2. **Bundle:** each package becomes one ESM file. CommonJS (`module.exports`) is converted so `import React from "react"` works.
3. **Cache on disk:** in `node_modules/.vite`. Vite re-runs pre-bundling only when the lockfile changes, the patches folder changes, relevant `vite.config` fields change, or `NODE_ENV` changes.
4. **Cache in the browser:** pre-bundled files are served with `Cache-Control: max-age=31536000,immutable` and a version query string, so after the first load the browser doesn't even ask the server again.
5. **New dependency found later:** Vite re-bundles and reloads the page.

**Example:** `lodash-es` contains over 600 internal modules.
```ts
import { debounce } from "lodash-es";
```

**What happens, step by step:**
1. First `npm run dev`: Vite finds `lodash-es`, bundles all of its modules into `node_modules/.vite/deps/lodash-es.js`.
2. The browser requests one file instead of 600+.
3. Next start: lockfile unchanged → Vite reuses the cache, start-up is instant.
4. You run `npm install lodash-es@latest`: the lockfile changes → Vite re-bundles on next start.
5. You hand-edit a file inside `node_modules/lodash-es` to debug: nothing changes, because the cached copy is used. Restart with `vite --force` and disable the browser cache in DevTools.

**Common mistake → fix:** a linked local package in a monorepo (not resolved from `node_modules`) that ships CommonJS breaks with "does not provide an export named …". Vite treats linked packages as source code and doesn't pre-bundle them. Fix: add it to `optimizeDeps.include` so it is converted.
```ts
export default defineConfig({ optimizeDeps: { include: ["@acme/shared-utils"] } });
```

**Interview answer:** "On first start Vite scans for bare imports and pre-bundles each dependency into one ESM file in node_modules/.vite, using Rolldown in Vite 8. That converts CommonJS packages to ESM so the browser can import them, and collapses packages with hundreds of modules into one request. The result is cached on disk until the lockfile or config changes, and cached by the browser with immutable headers. It only applies in development."

**Follow-ups:**
- *How do you force a rebuild?* `vite --force` or delete `node_modules/.vite`.
- *Does pre-bundling affect production?* No. The production build bundles everything with Rolldown anyway.

---

### Q08. What is HMR, and how does React Fast Refresh fit in?

**Short answer:** **HMR (Hot Module Replacement)** means that when you save a file, the browser swaps in the new version of just that module without reloading the page. Vite sends a message over a WebSocket, the browser re-imports the changed module, and the code that "accepts" the update applies it. **React Fast Refresh**, added by `@vitejs/plugin-react`, is the HMR handler for React components: it re-renders the edited component and **keeps its state** (`useState` values, typed text).

**How it works:**
1. Vite watches files on disk.
2. When `Button.tsx` changes, Vite finds the nearest **HMR boundary**: a module that knows how to accept updates. With Fast Refresh, a file that exports only React components is a boundary.
3. Vite sends `{ type: "update", path: "/src/Button.tsx", timestamp: … }` over the WebSocket.
4. The browser imports `/src/Button.tsx?t=1730000000000` (the timestamp avoids the cached old version).
5. Fast Refresh swaps the component function and re-renders it. Hook state is preserved as long as the hooks are in the same order.
6. If no boundary accepts the update (for example you edited `main.tsx`), Vite does a full page reload.

**Example:**
```tsx
// src/Counter.tsx
export function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>Clicked {count} times</button>;
}
```

```flow
sequence: Editing Counter.tsx while count is 3
actors: You, Vite, Browser
You -> Vite: change the text to "Pressed {count} times" and save
Vite -> Vite: Counter.tsx is a Fast Refresh boundary
Vite -> Browser: WebSocket update for /src/Counter.tsx
Browser -> Vite: GET /src/Counter.tsx?t=1730000000000
Vite --> Browser: newly converted module
Browser -> Browser: Fast Refresh re-renders Counter with count still 3
> The button now says "Pressed 3 times". The page didn't reload, so the count you clicked up to is kept.
```

**What happens, step by step:**
1. You clicked three times; `count` is 3.
2. You change the label and save. Vite sends an update message for `Counter.tsx`.
3. The browser fetches the new module. Fast Refresh replaces the `Counter` function but keeps React's stored state for it.
4. The screen shows "Pressed 3 times". If you had added a new `useState` above the existing one (changing hook order), Fast Refresh would reset that component's state instead.

**Common mistake → fix:** exporting a non-component from a component file:
```tsx
// ❌ src/Counter.tsx
export const MAX = 10;              // not a component
export function Counter() { … }
```
Fast Refresh can't safely hot-swap a module that also exports plain values, so every save triggers a full reload and you lose state. Move `MAX` into `constants.ts`. (The ESLint rule `react-refresh/only-export-components` in the template warns about this.)

**Interview answer:** "HMR swaps a changed module into the running page over a WebSocket instead of reloading. Vite finds the nearest module that accepts the update and the browser re-imports just that file with a timestamp. For React, the plugin's Fast Refresh re-renders the edited component and keeps its hook state. If no boundary accepts the change, for example in main.tsx or in a file exporting non-components, Vite falls back to a full reload."

**Follow-ups:**
- *Can my own code handle HMR?* Yes, with `import.meta.hot.accept(...)` and `import.meta.hot.dispose(...)`, for example to close a WebSocket before the module is replaced.
- *HMR not working in Docker or WSL?* File change events may not reach the container; set `server.watch.usePolling: true`, and check that the HMR WebSocket port is reachable.

---

### Q09. `vite` vs `vite build` vs `vite preview`: what does each do?

**Short answer:** `vite` (also `vite dev`) starts the development server with on-demand transforms and HMR. `vite build` creates the optimised production files in `dist/`. `vite preview` starts a small local static server for `dist/` so you can check the real build. Only the **output of `vite build`** goes to production; neither server is meant to serve real users.

**How it works:**

| Command | Default mode | What it does | Port | Use in production? |
|---|---|---|---|---|
| `vite` / `vite dev` | `development` | On-demand transforms, pre-bundled deps, HMR | 5173 | No |
| `vite build` | `production` | Bundle, tree-shake, minify, hash into `dist/` | none | Its output, yes |
| `vite preview` | `production` | Serves `dist/` as static files | 4173 | No, local check only |

**Example:**
```bash
npm run build            # dist/ created
npm run preview          # ➜ Local: http://localhost:4173/
```

**What happens, step by step:**
1. `vite build` writes `dist/index.html` and `dist/assets/index-4f9c2a1b.js`.
2. `vite preview` serves those exact files. If a dynamic import, a CSS order issue or an environment variable is wrong in the build, you see it here, not in dev.
3. You deploy `dist/` to a CDN or web server (S3 + CloudFront, Nginx, Netlify, etc.).

**Common mistake → fix:** running `vite` (the dev server) inside a production Docker container "because it works". It transforms on demand, is not hardened, serves source maps and source files, and is slow under load. Build in CI and serve `dist/` with a static host or Nginx.

**Interview answer:** "vite runs the dev server with on-demand transforms and HMR; vite build produces the optimised static files in dist; vite preview serves dist locally so I can test the real build. In production I deploy only the dist output to a static host or CDN; neither dev nor preview is a production server."

**Follow-ups:**
- *Does `vite preview` do SPA fallback?* Yes, for a single-page app it serves `index.html` for unknown routes, which can hide a missing fallback rule on your real host. Test deep links on the real host too.

---

### Q10. What does `index.html` do in Vite?

**Short answer:** In Vite, `index.html` is the **entry point** of the app, sitting at the project root, not a static file in `public/`. Vite reads it, follows its `<script type="module">` and `<link>` tags into your source, and during the build rewrites those tags to point to the final hashed files. It is also where you can use `%VITE_…%` placeholders that are replaced at build time.

**How it works:**
1. Dev: Vite serves `index.html` (adding its HMR client), and the browser follows the module script.
2. Build: Vite treats every `<script type="module" src>` as an entry for Rolldown, bundles it, and replaces the tag with the hashed output file. It adds `<link rel="modulepreload">` for chunks the entry needs right away, and `<link rel="stylesheet">` for extracted CSS.
3. Several HTML files can be entries (a multi-page app) by listing them in `build.rolldownOptions.input`.

**Example:**
```html
<!-- index.html (source) -->
<!doctype html>
<html lang="en">
  <head><title>%VITE_APP_TITLE%</title></head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```
```html
<!-- dist/index.html (after vite build, with VITE_APP_TITLE=Reports) -->
<head>
  <title>Reports</title>
  <script type="module" crossorigin src="/assets/index-4f9c2a1b.js"></script>
  <link rel="stylesheet" crossorigin href="/assets/index-0c3e5b8a.css">
</head>
<body><div id="root"></div></body>
```

**What happens, step by step:**
1. Vite replaces `%VITE_APP_TITLE%` with `Reports` from the `.env` file.
2. `/src/main.tsx` and everything it imports are bundled into `index-4f9c2a1b.js`; the CSS they import goes into `index-0c3e5b8a.css`.
3. The script and stylesheet tags are rewritten to those names.
4. When you change code and rebuild, the hashes change, so `dist/index.html` changes too. That's why `index.html` itself must never be cached for long (see Q33).

**Common mistake → fix:** referencing a source file from `index.html` with a path that only works in dev, for example `<script src="./src/main.tsx">` inside a page served under a sub-path, or adding a plain `<script src="/legacy.js">` without `type="module"` and expecting Vite to bundle it. Vite only processes module scripts and their imports; classic scripts are copied as-is. Use `type="module"` and absolute paths from the project root.

**Interview answer:** "In Vite, index.html at the project root is the real entry point. Vite parses it, treats the module script as the start of the module graph, and in the build rewrites the tags to the hashed bundle and stylesheet with modulepreload hints. Because its content changes with every build, index.html must be served with no-cache while hashed assets can be cached forever."

**Follow-ups:**
- *How do you make a multi-page app?* Add more HTML files and list them in `build.rolldownOptions.input`, for example `{ main: "index.html", admin: "admin/index.html" }`.

---

### Q11. What is a Vite plugin, and how does it work?

**Short answer:** A **plugin** is an object with a `name` and some **hook** functions that Vite calls at specific points while it processes files. The main hooks are `resolveId` ("where does this import point?"), `load` ("what is the content of this file?") and `transform` ("change this code"). Vite's plugin API extends Rollup's, so Rolldown-compatible Rollup plugins usually work, plus Vite-only hooks such as `config`, `configureServer` and `transformIndexHtml`.

**How it works:** for every module, Vite runs the plugins in order:
1. **`resolveId(source, importer)`** turns `"./Button"` or `"virtual:build-info"` into an ID (usually an absolute file path).
2. **`load(id)`** returns the file contents (or generated content for a virtual module).
3. **`transform(code, id)`** returns changed code. The React plugin uses this to add Fast Refresh code.
4. Build-only hooks such as `generateBundle` and `writeBundle` run on the final output.

Options that control ordering and scope: `enforce: "pre" | "post"` (run before or after core plugins) and `apply: "serve" | "build"` (dev only or build only).

**Example:** a virtual module that exposes the build time and git commit:
```ts
// vite.config.ts
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

function buildInfo(): Plugin {
  const virtualId = "virtual:build-info";
  const resolvedId = "\0" + virtualId;          // "\0" marks it as not a real file
  return {
    name: "build-info",
    resolveId(id) {
      if (id === virtualId) return resolvedId;
    },
    load(id) {
      if (id === resolvedId) {
        const sha = execSync("git rev-parse --short HEAD").toString().trim();
        return `export const commit = "${sha}"; export const builtAt = "${new Date().toISOString()}";`;
      }
    },
  };
}

export default defineConfig({ plugins: [react(), buildInfo()] });
```
```ts
// src/Footer.tsx
import { commit, builtAt } from "virtual:build-info";
```

**What happens, step by step:**
1. Vite sees `import … from "virtual:build-info"` in `Footer.tsx` and asks each plugin's `resolveId`. `build-info` returns `"\0virtual:build-info"`.
2. Vite calls `load("\0virtual:build-info")`. The plugin runs `git rev-parse` (say it returns `a1b2c3d`) and returns a small module.
3. That code goes through `transform` hooks like any other module, and `Footer` gets `commit = "a1b2c3d"`.
4. In the build the values are frozen into the bundle, so the footer shows the commit the app was built from.

**Common mistake → fix:** installing random plugins without review. Plugins run arbitrary Node.js code on your machine and in CI, with access to environment variables and secrets used during the build. Pin versions with a lockfile, prefer well-maintained plugins (the official registry at registry.vite.dev lists them), and review new ones like any other dependency (supply-chain risk).

**Interview answer:** "A Vite plugin is an object with hooks Vite calls as it processes modules: resolveId to locate an import, load to read or generate content, transform to change code, plus build hooks on the bundle and Vite-only hooks like configureServer and transformIndexHtml. The API extends Rollup's, and Vite 8's Rolldown keeps that compatibility. Plugins run with full Node access during the build, so I treat them as supply-chain dependencies."

**Follow-ups:**
- *What is a virtual module?* An import that doesn't exist on disk; a plugin resolves and generates it, often prefixed with `virtual:` and `\0` internally.
- *How do you debug plugin transforms?* `vite-plugin-inspect` shows each plugin's output for a module; Vite 8 also has a `devtools` option.

---

### Q12. How does Vite handle TypeScript?

**Short answer:** Vite **transpiles** TypeScript: it removes the type annotations and converts the syntax to JavaScript, file by file, very quickly (with Oxc in Vite 8). It does **not type-check**. Code with type errors still runs in the browser. You must run the TypeScript compiler (`tsc --noEmit` or `tsc -b`) separately, which is why the template's build script is `tsc -b && vite build`.

**How it works:**
1. Type checking needs the whole program (every file's types). Transpiling only needs the current file. Vite does only the cheap per-file part, so HMR stays instant.
2. Because each file is handled alone, TypeScript features that need information from other files don't work the same way. The template sets `"isolatedModules": true` (or `verbatimModuleSyntax`) so `tsc` warns you about them, for example re-exporting a type without `export type`.
3. Your editor (VS Code) and `tsc` give you the type errors; Vite gives you speed.

**Example:**
```ts
// src/total.ts
export function total(prices: number[]): number {
  return prices.reduce((sum, p) => sum + p, 0);
}
total(["10", "20"]);   // type error: string[] is not number[]
```

**What happens, step by step:**
1. `npm run dev`: Vite strips the types and serves the file. No error appears in the terminal. In the browser, `reduce` concatenates strings: `0 + "10" + "20"` → `"01020"`.
2. VS Code underlines the call in red, but nothing stops you from running it.
3. `npm run build`: `tsc -b` reports `Argument of type 'string[]' is not assignable to parameter of type 'number[]'` and exits with an error, so `vite build` never runs and the bug doesn't ship.

**Common mistake → fix:** changing the build script to just `vite build` to "make the build faster" (or because it fails). Type errors then reach production silently. Keep `tsc -b` (or `tsc --noEmit`) in the build or as a separate CI step; for type errors shown in the browser overlay during dev, use `vite-plugin-checker`.

**Interview answer:** "Vite only transpiles TypeScript, using Oxc in Vite 8: it strips types per file, which keeps dev and HMR fast, but it never type-checks. So I run tsc separately, in the build script as tsc -b && vite build and in CI, and keep isolatedModules on so per-file transpiling is safe. Optionally vite-plugin-checker shows type errors in the dev overlay."

**Follow-ups:**
- *Why `import type`?* It tells the transpiler the import is only a type and can be removed entirely, which matters when each file is compiled alone.
- *Does Vite support decorators with metadata?* Vite 8 supports `emitDecoratorMetadata` without extra plugins.

---

## 3. Configuration & environment

### Q13. What does `vite.config.ts` control?

**Short answer:** `vite.config.ts` is a file that runs in Node.js when Vite starts and exports your settings: which **plugins** to use, how the **dev server** behaves (port, proxy), how imports are **resolved** (aliases), and how the **build** is produced (output folder, source maps, browser target, chunking). You can export a function instead of an object to change settings per command or mode.

**How it works:**
1. Vite looks for `vite.config.ts` (or `.js`/`.mjs`) in the project root and loads it with Node.
2. If the default export is a function, Vite calls it with `{ command, mode }`: `command` is `"serve"` for the dev server and `"build"` for builds; `mode` is `"development"`, `"production"` or your `--mode` value.
3. `.env` files are **not** loaded into `process.env` for the config file automatically; use `loadEnv(mode, process.cwd(), "")` if the config needs them.
4. `defineConfig` adds TypeScript autocompletion; it doesn't change behaviour.

**Example:**
```ts
// vite.config.ts
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");   // "" = load all vars, not only VITE_*
  return {
    plugins: [react()],
    base: "/",
    resolve: { alias: { "@": "/src" } },
    server: {
      port: 5173,
      proxy: { "/api": { target: env.API_TARGET ?? "http://localhost:8000", changeOrigin: true } },
    },
    build: {
      outDir: "dist",
      sourcemap: command === "build" ? "hidden" : true,
      chunkSizeWarningLimit: 600,           // kB; only a warning threshold
    },
  };
});
```

**What happens, step by step (`vite build --mode staging`):**
1. Vite calls the function with `{ command: "build", mode: "staging" }`.
2. `loadEnv("staging", …)` reads `.env`, `.env.local`, `.env.staging`, `.env.staging.local`. Suppose `.env.staging` has `API_TARGET=https://staging-api.example.com`; `env.API_TARGET` is that string (only used here in Node, it does not reach the browser).
3. `sourcemap` becomes `"hidden"` because `command` is `"build"`.
4. The proxy setting is ignored for the build: it only affects the dev server.

**Common mistake → fix:** reading `process.env.VITE_API_URL` inside `vite.config.ts` and getting `undefined`. The config is loaded before Vite processes `.env` files for the app. Use `loadEnv(mode, process.cwd())` as shown.

**Interview answer:** "vite.config.ts runs in Node at start-up and exports plugins, server settings like port and proxy, resolve aliases, and build options like outDir, sourcemaps, target and chunking. Exporting a function gives me command and mode so I can vary settings, and I use loadEnv when the config itself needs .env values."

**Follow-ups:**
- *Where are Rollup options in Vite 8?* `build.rolldownOptions` (the old `build.rollupOptions` name is deprecated but still converted).
- *What's `server.host`?* Set `host: true` to listen on all network interfaces, needed inside Docker or to test from a phone.

---

### Q14. What are environment variables in Vite, and which ones reach the browser?

**Short answer:** An **environment variable** is a named setting (like `VITE_API_URL=https://api.example.com`) supplied from outside the code, so the same code can run with different settings. In Vite, client code reads them through `import.meta.env`. Only variables whose names start with **`VITE_`** (changeable with `envPrefix`) plus a few built-ins (`MODE`, `BASE_URL`, `PROD`, `DEV`, `SSR`) are exposed, and they are **replaced with literal text at build time**. Everything exposed is public: anyone can read it in the JavaScript files.

**How it works:**
1. Vite loads `.env` files for the current mode (Q15) and real shell variables.
2. It keeps only names starting with `VITE_`, so `DB_PASSWORD` stays out of the bundle.
3. During transform, every `import.meta.env.VITE_API_URL` is replaced with the string value, for example `"https://api.example.com"`.
4. The built JS contains that string. Changing the variable later does nothing until you rebuild.

**Example:**
```bash
# .env.production
VITE_API_BASE_URL=https://api.example.com   # public config: fine
VITE_OPENAI_KEY=sk-live-123                 # ❌ will be shipped to every visitor
DB_PASSWORD=hunter2                         # not exposed (no VITE_ prefix)
```
```ts
// src/api.ts
const base = import.meta.env.VITE_API_BASE_URL;
if (import.meta.env.DEV) console.log("API base:", base);
```
```ts
// src/vite-env.d.ts — typing (this file must not contain import statements)
interface ImportMetaEnv { readonly VITE_API_BASE_URL: string }
interface ImportMeta { readonly env: ImportMetaEnv }
```

**What happens, step by step (`vite build`):**
1. Mode is `production`, so `.env.production` is loaded.
2. `import.meta.env.VITE_API_BASE_URL` becomes `"https://api.example.com"` in the output.
3. `import.meta.env.DEV` becomes `false`, so `if (false) console.log(...)` is removed by the minifier entirely.
4. `VITE_OPENAI_KEY` is used anywhere in code → the string `sk-live-123` is now inside `dist/assets/index-4f9c2a1b.js`. Anyone can open DevTools → Sources and copy it.
5. `DB_PASSWORD` is never in the bundle; `import.meta.env.DB_PASSWORD` is `undefined`.

**Common mistake → fix:** putting an API key in a `VITE_` variable "because the frontend needs to call the provider". Every visitor gets the key. Fix: call your own backend, which holds the key as a server-side secret (in a secrets manager) and calls the provider for the user, with authentication and rate limits.

**Interview answer:** "Vite exposes only VITE_-prefixed variables plus MODE, BASE_URL, PROD, DEV and SSR to client code via import.meta.env, and it replaces them with literal strings at build time. So they're baked into the bundle, public to anyone, and need a rebuild to change. Secrets never go there; they stay on a backend. I type them in vite-env.d.ts."

**Follow-ups:**
- *Can I change `envPrefix` to `""` to expose everything?* Vite refuses an empty prefix precisely to avoid leaking every variable.
- *How do I use env values in HTML?* `%VITE_APP_TITLE%` in `index.html` is replaced at build time.

---

### Q15. What are modes, and how are `.env` files loaded?

**Short answer:** A **mode** is a name that tells Vite which `.env` files to load. The dev server runs in `development` mode and `vite build` runs in `production` mode by default; `--mode staging` picks a custom one. Files load in this order, later ones overriding earlier ones: `.env` → `.env.local` → `.env.[mode]` → `.env.[mode].local`, and variables already set in the shell beat all files. Mode is **not** the same as `NODE_ENV`.

**How it works:**

| File | Loaded when | Committed to git? |
|---|---|---|
| `.env` | always | yes (non-secret defaults) |
| `.env.local` | always | no (git-ignored, your machine) |
| `.env.staging` | mode is `staging` | yes |
| `.env.staging.local` | mode is `staging` | no |
| shell variable `VITE_X=…` | always, highest priority | n/a |

`NODE_ENV` controls "is this an optimised production build?" and mode controls "which config set?":

| Command | `NODE_ENV` | mode |
|---|---|---|
| `vite build` | production | production |
| `vite build --mode staging` | production | staging |
| `vite build --mode development` | production | development |

**Example:**
```bash
# .env
VITE_API_BASE_URL=http://localhost:8000
VITE_APP_TITLE=Reports

# .env.staging
VITE_API_BASE_URL=https://staging-api.example.com
```
```bash
VITE_APP_TITLE="Reports (QA)" vite build --mode staging
```

```flow
trace: Resolving variables for vite build --mode staging
.env loaded: API = localhost:8000, TITLE = Reports > The base file is always loaded first.
.env.staging loaded: API = **staging-api.example.com** > Mode-specific files override the base file.
shell variable: TITLE = **Reports (QA)** > A variable already set in the shell is never overwritten by any file.
build output: API = staging-api.example.com, TITLE = Reports (QA), PROD = true > Mode staging still produces an optimised production build because NODE_ENV is production.
```

**What happens, step by step:**
1. Vite reads `.env`: API is `http://localhost:8000`, title is `Reports`.
2. Mode is `staging`, so `.env.staging` overrides the API URL.
3. `VITE_APP_TITLE` was set in the shell, so it stays `Reports (QA)`.
4. `NODE_ENV` is still `production`, so the output is minified and `import.meta.env.PROD` is `true`, `import.meta.env.MODE` is `"staging"`.

**Common mistake → fix:** using `--mode development` to get a "debuggable" build and expecting `import.meta.env.DEV` to be `true`. `DEV`/`PROD` follow `NODE_ENV`, not mode. Check `import.meta.env.MODE === "staging"` for mode-specific behaviour, and use `build.minify: false` or `sourcemap: true` for a debuggable build.

**Interview answer:** "A mode selects which .env files load: .env, .env.local, then .env.[mode] and .env.[mode].local, with later files winning and real shell variables winning over all of them. dev defaults to development and build to production, and --mode staging selects .env.staging. Mode isn't NODE_ENV: a staging-mode build is still an optimised production build."

**Follow-ups:**
- *Should `.env.production` contain secrets?* No. Committed `.env` files must contain only public settings; secrets don't belong in a frontend build at all.

---

### Q16. How does the dev proxy work, and what replaces it in production?

**Short answer:** `server.proxy` makes the Vite dev server forward certain paths (like `/api/*`) to your backend, so the browser talks to one origin, `localhost:5173`, and you don't hit CORS during development. The proxy **only exists in the dev server**. After `vite build` there is no Vite running, so in production something else must route `/api` to the backend: a CDN behaviour, a load balancer rule, an API gateway or an Nginx `location` block.

**How it works:**
1. The browser calls `fetch("/api/chat")`, a relative URL on the same origin.
2. In dev, Vite matches `/api`, forwards the request to `http://localhost:8000`, and passes the response back.
3. `changeOrigin: true` rewrites the `Host` header to the target's, which some backends and virtual hosts need.
4. `rewrite` can strip the prefix if the backend doesn't expect it.
5. In production, `fetch("/api/chat")` goes to whatever host serves the page; that host must forward `/api/*`.

**Example:**
```ts
// vite.config.ts
server: {
  proxy: {
    "/api": {
      target: "http://localhost:8000",
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api/, ""),   // /api/chat → /chat
    },
  },
}
```

```flow
sequence: Same relative URL /api/chat in development and production
actors: Browser, Vite dev server, CDN, Backend
Browser -> Vite dev server: DEV: GET localhost:5173/api/chat
Vite dev server -> Backend: forwards to localhost:8000/chat
Backend --> Browser: 200 JSON, same origin so no CORS check
> In development the Vite proxy forwards the call, and the browser only ever sees localhost:5173.
Browser -> CDN: PROD: GET app.example.com/api/chat
CDN -> Backend: path rule /api/* sends it to the backend origin
Backend --> Browser: 200 JSON, still same origin
> In production there is no Vite. The CDN (or Nginx or a gateway) routes /api/* so the same relative URL keeps working.
```

**What happens, step by step:**
1. Dev: `GET /api/chat` reaches Vite; the rewrite turns it into `/chat` and it's forwarded to `localhost:8000/chat`.
2. FastAPI answers 200; Vite returns it. The browser saw only `localhost:5173`.
3. Production: the same code calls `app.example.com/api/chat`. A CDN path rule `/api/*` forwards to the backend. If the backend expects `/chat` (because dev stripped `/api`), the production router must strip it too, or the backend should simply serve under `/api` in both environments.

**Common mistake → fix:** works in dev, 404 (or HTML instead of JSON) in production, because nobody configured `/api` routing on the host, so the SPA fallback returns `index.html`. Fix: add the `/api/*` route on the CDN/Nginx, and keep the path identical in dev and prod (avoid `rewrite` if the backend can just mount routes under `/api`).

**Interview answer:** "server.proxy forwards matching paths from the Vite dev server to the backend so the browser sees one origin and CORS never comes up locally. It only exists in dev. In production I configure the same routing at the hosting layer, like a CDN path behaviour, load balancer rule or Nginx location, so the frontend keeps using relative /api URLs."

**Follow-ups:**
- *Can the proxy forward WebSockets?* Yes, set `ws: true` on that proxy entry.

---

### Q17. What is CORS, and why doesn't the Vite proxy solve it in production?

**Short answer:** **CORS (Cross-Origin Resource Sharing)** is a browser rule. An **origin** is scheme + host + port (`https://app.example.com`). By default, JavaScript on one origin may *send* a request to another origin but may not *read* the response, unless the other server replies with headers like `Access-Control-Allow-Origin: https://app.example.com`. CORS is configured on the **backend** (or avoided by serving both from one origin). The dev proxy avoids it locally only because it makes everything same-origin.

**How it works:**
1. For "simple" requests (GET, or POST with form content types and no custom headers) the browser sends the request with an `Origin` header and checks the response headers.
2. For other requests (JSON body, `Authorization` header, PUT/DELETE) the browser first sends a **preflight**: `OPTIONS` with `Access-Control-Request-Method` and `Access-Control-Request-Headers`.
3. The server must answer with matching `Access-Control-Allow-*` headers. If not, the browser blocks the page's JavaScript from seeing the response (the request may still have reached the server).
4. With cookies (`credentials: "include"`), the server must return the exact origin, not `*`, and `Access-Control-Allow-Credentials: true`.

**Example:** the app at `https://app.example.com` calls `https://api.example.com/chat` with JSON and a bearer token.

```flow
sequence: CORS preflight for a JSON POST with a token
actors: Browser (app.example.com), API (api.example.com)
Browser (app.example.com) -> API (api.example.com): OPTIONS /chat with Origin app.example.com, method POST, headers authorization and content-type
API (api.example.com) --> Browser (app.example.com): 204 with Allow-Origin app.example.com, Allow-Methods POST, Allow-Headers authorization and content-type
> The browser asks permission first because the request has a JSON body and an Authorization header.
Browser (app.example.com) -> API (api.example.com): POST /chat
API (api.example.com) --> Browser (app.example.com): 200 with Allow-Origin app.example.com
> The headers match, so the page's JavaScript can read the response. Without them the browser blocks it, even though the server answered.
```

**What happens, step by step:**
1. The browser sends `OPTIONS /chat` with `Origin: https://app.example.com`.
2. The API replies `204` with `Access-Control-Allow-Origin: https://app.example.com`, `Access-Control-Allow-Methods: POST`, `Access-Control-Allow-Headers: authorization, content-type`.
3. The browser sends the real `POST /chat`; the API responds `200` with the allow-origin header again.
4. If step 2 returned no CORS headers, the console shows "blocked by CORS policy" and `fetch` rejects with a `TypeError`, even if the server logged a successful request.

**Common mistake → fix:** "fixing" CORS with `Access-Control-Allow-Origin: *` plus credentials (browsers reject that combination) or by reflecting any `Origin` back (lets any website make authenticated calls). Fix: allowlist exact origins on the API, or better, serve the app and API under one domain (`app.example.com` and `app.example.com/api`) through the CDN so CORS never applies.

**Interview answer:** "CORS is a browser-enforced rule: a page can read a cross-origin response only if the server returns matching Access-Control-Allow headers, and non-simple requests get an OPTIONS preflight first. It's configured on the backend. The Vite proxy hides it in dev by making calls same-origin, but it doesn't exist in production, so I either serve frontend and API under one origin via the CDN or allowlist exact origins on the API."

**Follow-ups:**
- *Is CORS a security feature for the server?* It protects users' browsers from other sites reading responses; it doesn't stop curl or scripts. The server still needs authentication.

---

### Q18. How do import aliases work in Vite and TypeScript?

**Short answer:** An **alias** is a shortcut in import paths, like `@/components/Button` instead of `../../../components/Button`. Two tools must agree on it: **TypeScript `paths`** (so the editor and `tsc` understand the import) and **Vite's `resolve.alias`** (so the dev server and build actually find the file). In Vite 8 you can set `resolve.tsconfigPaths: true` to let Vite read the `paths` from `tsconfig` instead of duplicating them.

**How it works:**
1. `tsc` and VS Code read `compilerOptions.paths` to resolve types.
2. Vite never reads `tsconfig` paths by default; it uses `resolve.alias` to turn `@/x` into `/src/x`.
3. If only one is set, you get either red squiggles but a working app, or a clean editor but a runtime "Failed to resolve import" error.

**Example:**
```json
// tsconfig.app.json
{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }
```
```ts
// vite.config.ts, option A: explicit alias
import { fileURLToPath, URL } from "node:url";
resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } }

// option B (Vite 8): reuse tsconfig paths (off by default; small performance cost)
resolve: { tsconfigPaths: true }
```
```ts
import { Button } from "@/components/Button";
```

**What happens, step by step:**
1. The editor resolves `@/components/Button` to `src/components/Button.tsx` via `paths`, so types work.
2. Vite resolves the same import via the alias to the absolute path of `src/components/Button.tsx`.
3. The build bundles it like any other import; the alias leaves no trace in the output.

**Common mistake → fix:** adding the alias only to `tsconfig.json`. `tsc` passes, but `vite` fails with `Failed to resolve import "@/components/Button"`. Add the Vite alias too, or turn on `resolve.tsconfigPaths` in Vite 8 (on older versions use the `vite-tsconfig-paths` plugin). Remember Vitest uses the same Vite config, so tests need it as well.

**Interview answer:** "Aliases need to be configured for both TypeScript and Vite: tsconfig paths drive the editor and type checking, Vite's resolve.alias drives real module resolution. In Vite 8 I can set resolve.tsconfigPaths to true so Vite reads tsconfig paths directly, which avoids the two drifting apart."

**Follow-ups:**
- *Why use `fileURLToPath(new URL("./src", import.meta.url))`?* It gives an absolute path that works in an ESM config file, where `__dirname` doesn't exist.

---

### Q19. How do you deploy a Vite app under a sub-path (the `base` option)?

**Short answer:** If the app lives at `https://example.com/portal/` instead of the root, set `base: "/portal/"` in `vite.config.ts` so every asset URL in the build starts with `/portal/`. If you use a client-side router, also give it the same **basename** (`/portal`). Missing either one gives a blank page: the browser requests `/assets/index-4f9c2a1b.js` from the root and gets a 404 or the wrong HTML.

**How it works:**
1. `base` changes the URLs Vite writes into `index.html` and the JS (`/portal/assets/...`).
2. `import.meta.env.BASE_URL` is set to `"/portal/"` for your own code.
3. The router needs to know its routes start after `/portal`, otherwise `/portal/reports` doesn't match `/reports`.
4. The host must serve files under `/portal/` and do SPA fallback to `/portal/index.html` (see Q29).

**Example:**
```ts
// vite.config.ts
export default defineConfig({ base: "/portal/", plugins: [react()] });
```
```tsx
// src/router.tsx (React Router)
const router = createBrowserRouter(routes, { basename: import.meta.env.BASE_URL });
```

**What happens, step by step:**
1. Build: `dist/index.html` references `/portal/assets/index-4f9c2a1b.js`.
2. A user opens `https://example.com/portal/reports`. The host returns `/portal/index.html`.
3. The browser loads `/portal/assets/index-4f9c2a1b.js` (correct path, 200).
4. The router strips the basename and matches `/reports`.
5. Without `base`, step 3 would request `/assets/index-4f9c2a1b.js`, which doesn't exist at the root → blank page and a 404 in the Network tab.

**Common mistake → fix:** hard-coding `<img src="/logo.png">` or `fetch("/config.json")` in code. These ignore `base`. Use imported assets (`import logo from "./logo.png"`, which respects `base`) or build URLs with `import.meta.env.BASE_URL + "config.json"`.

**Interview answer:** "base sets the public path Vite writes into asset URLs, so for an app at /portal/ I set base to /portal/ and give the router the same basename, usually from import.meta.env.BASE_URL. The host must serve that prefix and fall back to /portal/index.html for deep links. Hard-coded absolute URLs in code are the usual leftover bug."

**Follow-ups:**
- *Can `base` be relative?* `base: "./"` makes asset URLs relative, useful when the deploy path isn't known in advance, but it doesn't work well with client-side routing on nested URLs.

---

## 4. Build output, assets & performance

### Q20. What does a production build produce, and why are file names hashed?

**Short answer:** `vite build` writes a `dist/` folder: a small `index.html` plus an `assets/` folder of JavaScript, CSS and media files whose names contain a **content hash**, like `index-4f9c2a1b.js`. The hash is calculated from the file's content, so it changes only when the content changes. That lets you cache assets "forever" in browsers and CDNs, while `index.html` (which points at the current hashes) is never cached for long.

**How it works:**
1. Rolldown writes each chunk and computes a short hash of its bytes.
2. The hash goes into the file name; `index.html` and other chunks reference the hashed names.
3. On the next release, changed files get new names; unchanged files keep the old names, so returning users only download what changed.
4. Caching rule that follows: `assets/*` → `Cache-Control: public, max-age=31536000, immutable`; `index.html` → `Cache-Control: no-cache` (always check with the server).

**Example:**
```
dist/
├── index.html                      ← small; points at the current hashes; never cache long
├── favicon.svg                     ← copied from public/, no hash
└── assets/
    ├── index-4f9c2a1b.js           ← entry chunk (your app code + what it needs at start)
    ├── Reports-7d1e0f22.js         ← lazy chunk from import("./Reports")
    ├── react-vendor-91ab33cd.js    ← only if you configure a vendor group
    ├── index-0c3e5b8a.css
    └── logo-a1b2c3d4.svg
```

```flow
trace: What changes between two releases
release 1: index.html points to index-**4f9c2a1b**.js and Reports-7d1e0f22.js > Browsers cache both JS files for a year because the names are tied to the content.
you edit only src/pages/Reports.tsx > The entry code does not change.
release 2: Reports-**c09e5512**.js, index-**8a01d3fe**.js, index.html updated > The Reports chunk has a new hash. The entry also changes, because it contains the import path of the Reports chunk.
returning user > Downloads the new index.html (no-cache), the new entry and the new Reports chunk. Everything else comes from cache.
```

**What happens, step by step:**
1. Release 1 is deployed; a user's browser caches `index-4f9c2a1b.js` and `Reports-7d1e0f22.js`.
2. You change `Reports.tsx` and rebuild. Its chunk gets a new hash. The entry chunk references the Reports file name, so its content (and hash) changes too.
3. The user reloads. `index.html` is revalidated (`no-cache`), the server returns the new one pointing at the new names.
4. The browser downloads only the files with new names; CSS and the logo are still cached.

**Common mistake → fix:** caching `index.html` for a long time (or with the same `immutable` header as assets). Users keep getting the old HTML that points at old hashes, so they don't see the release, or they get 404s once old files are deleted. Give `index.html` `no-cache` and invalidate it on the CDN after each deploy.

**Interview answer:** "vite build outputs a tiny index.html and content-hashed assets in dist/assets. Because the hash is derived from the content, a file name changes only when its content does, so I can cache assets with max-age one year and immutable, and keep index.html no-cache so users always get the current list of files. Returning users only download what actually changed."

**Follow-ups:**
- *Why does the entry chunk change when only a lazy chunk changes?* The entry contains the lazy chunk's file name; Vite/Rolldown hashing accounts for that so references never point to stale names.
- *What's `build.manifest`?* An optional `manifest.json` mapping source files to output files, used for backend integration or server-side templates.

---

### Q21. How do static assets work: `import` vs the `public/` folder?

**Short answer:** If you **import** an asset (`import logo from "./logo.svg"`), Vite processes it: the import gives you a URL string, the file gets a hashed name, small files can be inlined as data URLs, and a missing file fails the build. Files in **`public/`** are copied to `dist/` unchanged and served at a fixed URL (`/robots.txt`). Use imports for anything your code uses; use `public/` only for files that need an exact, fixed name.

**How it works:**

| | `import logo from "./logo.svg"` | `public/robots.txt` |
|---|---|---|
| Processed by Vite | yes | no, copied as-is |
| URL | `/assets/logo-a1b2c3d4.svg` (hashed) | `/robots.txt` (fixed) |
| Small files | inlined as base64 if under `build.assetsInlineLimit` (default 4096 bytes) | never inlined |
| Missing file | build error | runtime 404 |
| Respects `base` | yes | only if you add `BASE_URL` yourself |
| Use for | images, fonts, files your code uses | `robots.txt`, `favicon.ico`, files referenced by exact name |

Import **suffixes** change what you get:

| Import | Result |
|---|---|
| `import url from "./a.png?url"` | the URL string |
| `import text from "./prompt.md?raw"` | the file content as a string |
| `import Worker from "./heavy.ts?worker"` | a Web Worker constructor |
| `import data from "./data.json"` | parsed JSON (named imports are tree-shaken) |
| `import.meta.glob("./pages/*.tsx")` | an object of lazy importers for matching files |

**Example:**
```tsx
import logo from "./assets/logo.svg";          // 6 KB file
import icon from "./assets/dot.png";           // 300 bytes
export function Header() {
  return <><img src={logo} alt="Logo" /><img src={icon} alt="" /></>;
}
```

**What happens, step by step:**
1. Build: `logo.svg` (6 KB) is over 4096 bytes, so it is emitted as `dist/assets/logo-a1b2c3d4.svg` and `logo` equals `"/assets/logo-a1b2c3d4.svg"`.
2. `dot.png` (300 bytes) is under the limit, so `icon` becomes `"data:image/png;base64,iVBOR…"` inside the JS: one less request.
3. If someone renames `logo.svg`, the build fails immediately instead of shipping a broken image.

**Common mistake → fix:** putting app images in `public/` and referencing them as `"/images/logo.png"`. They aren't hashed, so after you replace the image, browsers and the CDN keep serving the cached old one (or you must disable caching for them), and a typo only shows as a 404 in production. Import them instead.

**Interview answer:** "Imported assets go through Vite: they get hashed names that are safe to cache forever, small ones are inlined, missing ones fail the build, and they respect base. public/ is copied verbatim to fixed URLs, so I use it only for robots.txt, favicons and files that need an exact name. Query suffixes like ?url, ?raw and ?worker change what the import returns."

**Follow-ups:**
- *How do you reference a `public/` file from code?* With an absolute path, ideally `import.meta.env.BASE_URL + "robots.txt"` so it works under a sub-path.

---

### Q22. How does Vite handle CSS?

**Short answer:** You import CSS from JavaScript (`import "./app.css"`). In development Vite injects it into the page with a `<style>` tag and hot-updates it on save without a reload. In the build it extracts CSS into hashed `.css` files, split per chunk so lazy pages bring their own CSS. **CSS Modules** (`*.module.css`) give you locally scoped class names, and Sass/Less, PostCSS and Tailwind work through standard integrations. In Vite 8, Lightning CSS is the default CSS minifier.

**How it works:**
1. `import "./app.css"` → global styles.
2. `import styles from "./Card.module.css"` → an object mapping your class names to unique generated ones, so `.title` in two components never clash.
3. Pre-processors: install `sass` (or `less`) and import `.scss` files; no Vite plugin needed.
4. PostCSS config (`postcss.config.js`) is applied automatically; Tailwind CSS v4 uses its `@tailwindcss/vite` plugin.
5. Build: CSS imported by a lazy chunk is emitted as that chunk's own CSS file and loaded when the chunk loads.

**Example:**
```css
/* Card.module.css */
.title { font-weight: 600; }
```
```tsx
import styles from "./Card.module.css";
export const Card = ({ title }: { title: string }) => <h2 className={styles.title}>{title}</h2>;
```

**What happens, step by step:**
1. Vite turns `.title` into a unique name, for example `._title_x7a2c_1`, and `styles.title` equals that string.
2. The rendered HTML is `<h2 class="_title_x7a2c_1">`. A `.title` rule in another file doesn't affect it.
3. In dev, editing the CSS file updates the `<style>` tag instantly; component state is untouched.
4. In the build, the rule ends up in `dist/assets/index-0c3e5b8a.css` (or the chunk's CSS), minified.

**Common mistake → fix:** relying on CSS order between lazily loaded chunks ("my override works in dev but not in prod"). In the build, CSS files load in chunk order, which can differ from the dev injection order. Fix: avoid order-dependent overrides across files; use CSS Modules, higher specificity in one place, or cascade layers (`@layer`).

**Interview answer:** "I import CSS from JS; Vite injects it with HMR in dev and extracts hashed, per-chunk CSS files in the build. *.module.css files are CSS Modules with locally scoped class names, Sass works once the sass package is installed, PostCSS config is picked up automatically, and Tailwind v4 uses its Vite plugin. Vite 8 minifies CSS with Lightning CSS by default."

**Follow-ups:**
- *Can I import CSS as a string?* Yes, `import css from "./x.css?inline"` returns the CSS text without injecting it.

---

### Q23. What is code splitting, and how does dynamic `import()` create chunks?

**Short answer:** **Code splitting** means breaking the JavaScript into several files so the first page only downloads what it needs. Every dynamic `import("./Reports")` tells the bundler "this can load later", so it becomes a separate **chunk** downloaded on demand. Split by route and by heavy, rarely used features (a PDF viewer, a code editor); don't split tiny components, because every chunk is an extra network round trip.

**How it works:**
1. Static `import` → the module is part of the current chunk.
2. Dynamic `import()` → returns a Promise; the bundler emits a separate chunk and the code fetches it when that line runs.
3. In React, `lazy(() => import(...))` plus `<Suspense>` shows a fallback while the chunk loads.
4. Vite adds **preload** logic: when a chunk is requested, its own dependencies (shared chunks, CSS) are fetched in parallel instead of one after another (a "waterfall").
5. Modules used by several chunks are moved into shared chunks automatically.

**Example:**
```tsx
import { lazy, Suspense } from "react";
const Reports = lazy(() => import("./pages/Reports"));   // split point

export function App() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/reports" element={<Reports />} />
      </Routes>
    </Suspense>
  );
}
```

```flow
sequence: Opening /reports for the first time
actors: Browser, CDN
Browser -> CDN: GET index.html and index-4f9c2a1b.js (190 kB)
CDN --> Browser: app shell renders the Home page
Browser -> Browser: user clicks Reports, lazy() calls import("./pages/Reports")
Browser -> CDN: GET Reports-7d1e0f22.js and Reports-55aa.css in parallel
CDN --> Browser: chunk arrives, Suspense swaps "Loading…" for the page
> The first load skipped the 48 kB Reports chunk entirely. Users who never open Reports never download it.
```

**What happens, step by step:**
1. First visit to `/`: the browser downloads only the entry chunk; Home renders.
2. The user clicks Reports. `lazy` calls `import("./pages/Reports")`.
3. Vite's preload helper requests `Reports-7d1e0f22.js` and its CSS together. "Loading…" shows for that time.
4. The Promise resolves; `Reports` renders. Later visits to `/reports` use the cached module instantly.

**Vendor chunks in Vite 8:** to keep rarely changing libraries in their own long-cached file, use Rolldown's `codeSplitting` option. The old object form of `manualChunks` was **removed** in Vite 8 and the function form is deprecated.
```ts
// vite.config.ts (Vite 8)
build: {
  rolldownOptions: {
    output: {
      codeSplitting: {
        groups: [
          { name: "react-vendor", test: /node_modules[\\/](react|react-dom)[\\/]/, priority: 20 },
          { name: "vendor", test: /node_modules/, priority: 10 },
        ],
      },
    },
  },
}
```

**Common mistake → fix:** a static import of the same module elsewhere defeats the split:
```tsx
import { exportPdf } from "./pages/Reports";   // ❌ static import in Home.tsx
const Reports = lazy(() => import("./pages/Reports"));
```
Because Home already pulls `Reports` in statically, it lands in the entry chunk and the lazy import splits nothing (Vite prints a warning about it). Move `exportPdf` into its own small module, or import it dynamically too.

**Interview answer:** "Code splitting breaks the bundle into chunks that load on demand, and every dynamic import is a split point. I lazy-load routes and heavy features with React.lazy and Suspense, Vite preloads each chunk's dependencies in parallel, and shared modules go into common chunks automatically. In Vite 8, vendor grouping uses Rolldown's codeSplitting groups because the manualChunks object form was removed. A stray static import of the same module cancels the split."

**Follow-ups:**
- *What if a chunk fails to load after a deploy?* Vite fires a `vite:preloadError` event; reload the page (see Q33).
- *Can you prefetch a route?* Call the same `import()` on hover or idle; the module is then cached when the user navigates.

---

### Q24. What is tree shaking, and why does unused code sometimes still ship?

**Short answer:** **Tree shaking** is the bundler removing exports that nothing imports. It works by static analysis of `import`/`export` statements, so it only removes code it can **prove** is unused and safe to drop. Code still ships when the package is CommonJS (no static exports), when a module has **side effects** (code that runs just by being imported) and isn't marked side-effect-free, or when you import a whole namespace and use it dynamically.

**How it works:**
1. Start at the entry, follow every import, and mark the exports actually used.
2. For an unused export, check: does removing it change behaviour? If the module might run code on import (set a global, register a polyfill), the bundler keeps the module.
3. Packages can declare `"sideEffects": false` in `package.json` (or list the files that do have side effects), which lets the bundler drop whole unused modules.
4. In Vite 8, Oxc's semantic analysis helps Rolldown find more provably unused code.

**Example:**
```ts
import _ from "lodash";                 // ❌ CommonJS, whole library (~70 kB min)
_.debounce(save, 300);

import { debounce } from "lodash-es";   // ✅ ESM, only debounce and its helpers
debounce(save, 300);
```

**What happens, step by step:**
1. `lodash` is CommonJS: one big object assigned to `module.exports`. The bundler can't see which properties you use, so it keeps all of it.
2. `lodash-es` is ESM with one export per function and `"sideEffects": false`. Rolldown keeps `debounce` and the few internal helpers it imports, and drops the other functions.
3. The bundle visualiser shows `lodash` as a large block in the first case and a few kB in the second.

**Common mistake → fix:** barrel files (`src/components/index.ts` re-exporting 200 components) where some components have side effects (a top-level `import "./heavy-theme.css"` or a global registration). Importing one component pulls in the side-effectful modules. Fix: import from the component's own file, mark the package `"sideEffects": ["*.css"]`, and keep top-level code free of side effects.

**Interview answer:** "Tree shaking removes exports the bundler can statically prove are unused. It needs ES modules and code without side effects at import time; CommonJS packages, side-effectful modules, barrel files and namespace imports used dynamically all defeat it. I check with a bundle visualiser, switch to ESM packages and named imports, and use sideEffects in package.json for my own libraries."

**Follow-ups:**
- *How do you visualise the bundle?* `rollup-plugin-visualizer` (works with Rolldown) or Vite DevTools; look for big or duplicated modules.

---

### Q25. What are source maps, and how do you use them safely in production?

**Short answer:** A **source map** is a `.map` file that maps positions in the minified bundle back to your original source files, so a stack trace like `index-4f9c2a1b.js:1:48211` can show `Reports.tsx:42`. Publicly served source maps let anyone read your original code. The safe pattern is `build.sourcemap: "hidden"` (generate maps but don't link them from the JS), upload them privately to your error tracker, and don't deploy `.map` files to the public CDN.

**How it works:**

| `build.sourcemap` | What you get |
|---|---|
| `false` (default) | no maps |
| `true` | `.map` files plus a `//# sourceMappingURL=` comment in each JS file, so browsers load them automatically |
| `"inline"` | map embedded in the JS as a data URL (big files; dev/debug only) |
| `"hidden"` | `.map` files without the comment, so browsers don't fetch them |

**Example:**
```ts
build: { sourcemap: "hidden" }
```
```bash
vite build
# upload maps to the error tracker for this release, then remove them from dist/
npx @sentry/cli sourcemaps upload --release "$GIT_SHA" dist/assets
find dist -name "*.map" -delete
```

**What happens, step by step:**
1. The build writes `index-4f9c2a1b.js` and `index-4f9c2a1b.js.map`, without a reference comment.
2. CI uploads the maps to the error tracker, tagged with the release (the git commit).
3. CI deletes the `.map` files before uploading `dist/` to the CDN.
4. A user hits an error; the tracker receives `index-4f9c2a1b.js:1:48211` and, using the private map, shows `Reports.tsx:42 in exportPdf`.

**Common mistake → fix:** `sourcemap: true` and deploying everything. Anyone can open DevTools and browse your original source, comments and internal API paths. Use `"hidden"`, upload privately, or restrict access to `*.map` at the CDN.

**Interview answer:** "Source maps map minified code back to the original files so production stack traces are readable. Public maps expose the source, so I build with sourcemap hidden, upload the maps to the error tracker tagged with the release, and don't deploy them to the CDN. Users get minified code; my team gets readable traces."

**Follow-ups:**
- *Do source maps slow down users?* No, browsers only download them when DevTools is open and the comment is present.

---

### Q26. What do `build.target` and polyfills control?

**Short answer:** `build.target` tells Vite which browsers the output must run in, so it knows which **syntax** to rewrite (for example optional chaining for very old browsers). Vite's default is `'baseline-widely-available'`, which in Vite 8 means Chrome/Edge 111, Firefox 114 and Safari 16.4. Vite does **not** add **polyfills** (code that adds missing browser APIs like `Array.prototype.toSorted`); for old browsers you add them yourself or use `@vitejs/plugin-legacy`.

**How it works:**
1. **Syntax** is how code is written (`a?.b`, `class #private`). A transformer can rewrite it into older syntax.
2. **APIs** are built-in functions and objects (`structuredClone`, `Promise.withResolvers`). If the browser lacks them, rewriting syntax doesn't help; you need a polyfill that defines them.
3. Vite only handles syntax, based on `build.target`.
4. `@vitejs/plugin-legacy` produces an extra legacy bundle with polyfills, loaded only by old browsers.

**Example:**
```ts
// your code
const total = items?.reduce((s, i) => s + i.price, 0) ?? 0;
const sorted = items.toSorted((a, b) => a.price - b.price);
```

**What happens, step by step:**
1. With the default target, `?.` and `??` are supported natively, so they're left as is.
2. `toSorted` is an API, not syntax, so Vite leaves the call untouched. It became available in all major browsers in July 2023; Firefox added it in version 115 (check MDN's compatibility table), so Firefox 114, which is inside the default target, doesn't have it.
3. A user on Firefox 114 gets `TypeError: items.toSorted is not a function`, even though the build "targets" that browser.
4. Fix: use `[...items].sort(...)`, or add a specific polyfill (for example from `core-js`) in `main.tsx`.

**Common mistake → fix:** believing "the target includes Safari 16.4 so everything works there". Target covers syntax only. Check new APIs against your support list and polyfill or avoid them.

**Interview answer:** "build.target controls syntax lowering; Vite 8's default 'baseline-widely-available' targets Chrome and Edge 111, Firefox 114 and Safari 16.4. Vite never polyfills missing APIs, so I either avoid newer APIs, add targeted polyfills, or use plugin-legacy for a separate legacy bundle when we must support old browsers."

**Follow-ups:**
- *How do you set an explicit target?* `build: { target: ["es2022", "safari15"] }`; lower targets mean bigger, slower output.

---

### Q27. What is Vitest, and how does it relate to Vite?

**Short answer:** **Vitest** is a test runner built on Vite. It uses the same `vite.config.ts` (plugins, aliases, `import.meta.env`), so tests understand TypeScript, JSX and CSS imports exactly like your app does, with no separate Babel or Jest configuration. Its API (`describe`, `it`, `expect`, `vi.fn()`) is Jest-compatible, and it re-runs only affected tests on save.

**How it works:**
1. `vitest` loads your Vite config plus its `test` section.
2. Test files are transformed through the same Vite plugin pipeline.
3. `environment: "jsdom"` (or `"happy-dom"`) gives tests a fake browser DOM for React component tests; Vitest also has a browser mode that runs tests in a real browser.
4. In watch mode it uses the module graph to re-run only tests affected by a changed file.

**Example:**
```ts
// vite.config.ts
/// <reference types="vitest/config" />
export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", setupFiles: "./src/test-setup.ts" },
});
```
```tsx
// src/Counter.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Counter } from "./Counter";

it("increments", async () => {
  render(<Counter />);
  await userEvent.click(screen.getByRole("button"));
  expect(screen.getByRole("button")).toHaveTextContent("Clicked 1 times");
});
```

**What happens, step by step:**
1. `npx vitest` finds `Counter.test.tsx`, transforms it with the React plugin, and creates a jsdom document.
2. `render` mounts `<Counter />`; the button text is "Clicked 0 times".
3. `userEvent.click` fires a click; React updates state; the text becomes "Clicked 1 times"; the assertion passes.
4. You edit `Counter.tsx`; Vitest re-runs only this test file.

**Common mistake → fix:** adding an alias to `vite.config.ts` but configuring tests in a separate Jest setup, so tests fail with "Cannot find module '@/…'". Use Vitest so tests share the config, or keep Jest's `moduleNameMapper` in sync manually.

**Interview answer:** "Vitest is a Vite-native test runner: it reuses the Vite config and plugin pipeline, so TypeScript, JSX, aliases and env variables behave the same in tests as in the app. It has a Jest-compatible API, jsdom or happy-dom environments for component tests, a browser mode, and fast watch mode based on the module graph."

**Follow-ups:**
- *Is Vitest a replacement for end-to-end tests?* No. It tests units and components; use Playwright for real browser flows across pages and the backend.

---

## 5. Deployment & security

### Q28. How do you deploy a Vite React SPA on AWS?

**Short answer:** A Vite SPA is just static files, so the standard setup is: build in CI, upload `dist/` to a **private S3 bucket**, and serve it through **CloudFront** (AWS's CDN, content delivery network) with HTTPS. CloudFront also routes `/api/*` to the backend so the app and API share one origin (no CORS), sets security headers, and returns `index.html` for client-side routes. Hashed assets get a one-year cache; `index.html` gets `no-cache`.

**How it works:**
1. **CI:** `npm ci` → type-check, lint, test → `vite build`.
2. **Upload:** hashed files in `dist/assets/` first (long cache), then `index.html` (no-cache). Keep old assets for a while (Q33).
3. **CloudFront:** an **Origin Access Control (OAC)** lets only CloudFront read the private bucket; a TLS certificate from ACM (AWS Certificate Manager) gives HTTPS; AWS WAF (web application firewall) can filter attacks; a response headers policy adds CSP and HSTS (Q30).
4. **Cache behaviours** (path rules): `/assets/*` → S3, cached; `/api/*` → load balancer or API Gateway → backend, not cached; default `/*` → S3 `index.html`.
5. **SPA fallback:** routes like `/reports/42` don't exist in S3, so they must be answered with `index.html` (Q29).
6. **Invalidate** `/index.html` after upload so edge locations fetch the new one.

**Example:**
```bash
# CI deploy step (bucket and distribution IDs illustrative)
npm ci && npm run build
aws s3 sync dist/assets s3://my-app-bucket/assets \
  --cache-control "public,max-age=31536000,immutable"
aws s3 cp dist/index.html s3://my-app-bucket/index.html \
  --cache-control "no-cache"
aws cloudfront create-invalidation --distribution-id E123EXAMPLE --paths "/index.html"
```

```flow
sequence: A user loads app.example.com/reports/42
actors: Browser, CloudFront, S3, Backend
Browser -> CloudFront: GET /reports/42
CloudFront -> S3: no file at reports/42, so serve index.html (no-cache)
CloudFront --> Browser: index.html with CSP and HSTS headers
Browser -> CloudFront: GET /assets/index-4f9c2a1b.js
CloudFront --> Browser: from edge cache, max-age one year, immutable
> Hashed assets are served from the edge cache. Only index.html is revalidated on each visit.
Browser -> CloudFront: GET /api/reports/42
CloudFront -> Backend: behaviour /api/* forwards to the load balancer, no caching
Backend --> Browser: 200 JSON
> The API is on the same origin, so no CORS preflight is needed.
```

**What happens, step by step:**
1. `/reports/42` has no S3 object; CloudFront's fallback returns `index.html` with status 200.
2. The browser loads the hashed entry from the edge cache.
3. React Router renders the Reports page and fetches `/api/reports/42`; CloudFront forwards that to the backend without caching it.
4. On the next deploy, only `index.html` changes URL content; the invalidation makes every edge serve the new HTML within minutes.

**Common mistake → fix:** a public S3 website bucket with no CloudFront. You lose HTTPS on your domain, edge caching, WAF and headers, and the bucket is publicly listable or writable if misconfigured. Use a private bucket with OAC behind CloudFront.

**Interview answer:** "I build in CI and upload dist to a private S3 bucket fronted by CloudFront with Origin Access Control, an ACM certificate and a response headers policy. Hashed assets get a one-year immutable cache, index.html gets no-cache and an invalidation on deploy, /api/* is routed to the backend on the same origin so there's no CORS, and client routes fall back to index.html. Old assets are kept so open tabs don't break."

**Follow-ups:**
- *Alternatives?* Nginx in a container, Amplify Hosting, Netlify, Vercel, Cloudflare Pages. The same caching and fallback rules apply.

---

### Q29. Why do deep links return 404 on a static host, and how does SPA fallback fix it?

**Short answer:** In a **single-page app (SPA)** the URL `/reports/42` exists only inside the client-side router; there is no file called `reports/42` on the server. When a user opens that link directly or refreshes, the host looks for the file, finds nothing, and returns 404. **SPA fallback** means the host returns `index.html` for unknown page routes so the app loads and the router renders the page. The fallback must not apply to `/api/*` or `/assets/*`.

**How it works:**
1. Navigating inside the app never asks the server for `/reports/42`; the router just changes the URL.
2. A refresh or a pasted link does ask the server.
3. The host must map "not a real file and not an API path" → `index.html` with status 200.
4. If the fallback also catches a missing JS file, the browser receives HTML instead of JavaScript and fails with `Unexpected token '<'`.

**Example:**
```nginx
# Nginx
location /api/    { proxy_pass http://backend:8000; }
location /assets/ { try_files $uri =404; add_header Cache-Control "public,max-age=31536000,immutable"; }
location /        { try_files $uri /index.html; add_header Cache-Control "no-cache"; }
```

**What happens, step by step:**
1. `GET /reports/42`: no such file; `try_files $uri /index.html` returns `index.html`, 200. The router renders report 42.
2. `GET /assets/index-old.js` (an asset deleted in the last deploy): `try_files $uri =404` returns a real 404, which the app can detect, instead of HTML.
3. `GET /api/reports/42`: goes to the backend, which returns JSON or a JSON error; never `index.html`.
4. On CloudFront with S3 the usual setup is a custom error response mapping 403/404 → `/index.html` with 200; because that applies to the whole distribution, prefer a CloudFront Function on the default behaviour that rewrites only extension-less paths, so asset and API errors stay real errors.

**Common mistake → fix:** a global "all 404s return index.html with 200" rule. A missing chunk then returns HTML (blank page, `Unexpected token '<'`), and API 404s become 200 HTML that breaks `response.json()`. Scope the fallback to page routes only.

**Interview answer:** "Client-side routes don't exist as files, so a refresh on /reports/42 asks the host for a file it doesn't have. The host must serve index.html for unknown page routes so the router can take over, but must keep real 404s for assets and API paths; otherwise a missing chunk or API error comes back as HTML with status 200."

**Follow-ups:**
- *What about SEO and 404 pages?* A pure SPA returns 200 for every route; the app should render a "not found" page, and server rendering or prerendering is needed if real 404 statuses matter for search engines.

---

### Q30. What is a Content Security Policy, and how do you set security headers for a Vite app?

**Short answer:** A **Content Security Policy (CSP)** is an HTTP response header that tells the browser which sources it may load scripts, styles, images and network connections from. If an attacker manages to inject `<script src="https://evil.example/x.js">`, the browser refuses to run it. Vite only produces files; the **hosting layer** (CDN, Nginx) sends CSP and other security headers. Vite's production build needs no inline scripts, so a strict `script-src 'self'` usually works.

**How it works:**

| Header | What it does |
|---|---|
| `Content-Security-Policy` | Allowlist of sources per type (`script-src`, `connect-src`, `img-src`, `frame-ancestors`) |
| `Strict-Transport-Security` (HSTS) | Browser uses HTTPS only for this domain |
| `X-Content-Type-Options: nosniff` | Browser doesn't guess file types |
| `Referrer-Policy` | Limits how much of the URL is sent to other sites |
| `frame-ancestors 'none'` (in CSP) | Page can't be embedded in an iframe (clickjacking protection) |

**Example:**
```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self';
  connect-src 'self' https://api.example.com; img-src 'self' data:;
  object-src 'none'; frame-ancestors 'none'; report-to csp
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

```flow
sequence: CSP blocking an injected script
actors: CDN, Browser, Injected script
CDN --> Browser: index.html with Content-Security-Policy script-src 'self'
Browser -> Browser: runs /assets/index-4f9c2a1b.js because it is same-origin
Injected script -> Browser: script tag pointing to evil.example/x.js
Browser -> Browser: blocks it because evil.example is not in script-src, logs a violation
> The policy came from the hosting layer. The injected script never runs, even though it got into the page.
```

**What happens, step by step:**
1. The CDN adds the CSP header to `index.html`.
2. The browser runs `/assets/index-4f9c2a1b.js` because it's on `'self'`.
3. An XSS (cross-site scripting) bug lets user content add a script tag pointing at `evil.example`; the browser blocks it and reports the violation.
4. A `fetch("https://tracker.example")` from injected code would also be blocked by `connect-src`.

**Common mistake → fix:** adding `'unsafe-inline'` to `script-src` to "make it work". That re-enables exactly the injected inline scripts CSP is meant to stop. Find what needs inline code (often an analytics snippet or a theme script in `index.html`), move it to a file, or use a nonce/hash. Roll out with `Content-Security-Policy-Report-Only` first to see violations without breaking users.

**Interview answer:** "CSP is a response header that allowlists where scripts, styles, connections and frames can come from, so injected scripts don't run. Vite doesn't send headers; I set CSP, HSTS, nosniff and referrer policy on the CDN or Nginx. Vite's build has no inline scripts, so script-src 'self' works; I roll out in report-only mode first and avoid unsafe-inline."

**Follow-ups:**
- *Does Vite's dev server need a looser CSP?* Yes, HMR injects scripts and uses a WebSocket, so apply the strict policy to production only.

---

### Q31. Why are client-side environment variables and feature flags not security?

**Short answer:** Everything in the browser bundle can be read and changed by the user: they can open DevTools, edit variables, or skip the UI and call the API with `curl`. So a flag like `VITE_ENABLE_ADMIN=false` can **hide a button** but can't **protect** anything. Permissions must be checked on the **backend** for every request.

**How it works:**
1. `import.meta.env.VITE_ENABLE_ADMIN` is replaced with `"false"` at build time.
2. React doesn't render the admin button.
3. The admin endpoint still exists on the server; anyone who knows or guesses the URL can call it.
4. Only the server, which checks the user's identity and role, can say no.

**Example:**
```tsx
{import.meta.env.VITE_ENABLE_ADMIN === "true" && <DeleteUserButton />}
```

```flow
sequence: A hidden button doesn't stop a direct API call
actors: User, Browser app, API
User -> Browser app: loads the app with VITE_ENABLE_ADMIN false
Browser app --> User: no Delete button shown
User -> API: DELETE /admin/users/7 sent with curl and the user's token
API -> API: checks the token's role, which is "viewer"
API --> User: 403 Forbidden
> The flag only changed what was drawn on screen. The server-side role check is what actually blocked the request.
```

**What happens, step by step:**
1. The button is hidden for everyone because the flag is `"false"`.
2. A curious user copies their token from DevTools and sends `DELETE /admin/users/7`.
3. If the API only trusted the UI, user 7 would be deleted. Because it checks the role, it returns 403.

**Common mistake → fix:** shipping "secret" admin routes or keys behind a flag, assuming nobody finds them. Search the built JS for routes and strings: everything is there. Fix: authorise every request on the server; use flags only for UX.

**Interview answer:** "The bundle is fully readable and modifiable by the user, so env vars and feature flags in the frontend are only UX switches. They can hide a button but can't protect an action; the backend must authenticate and authorise every request, and secrets never go into VITE_ variables."

**Follow-ups:**
- *Where should feature flags live then?* Evaluate them on the server (or a flag service) per user, and have the server enforce any flag that controls access.

---

### Q32. How do you build once and deploy the same artifact to every environment?

**Short answer:** Because `VITE_*` variables are baked in at build time, the naive approach builds the app separately for dev, staging and prod, so the bundle you tested in staging isn't byte-for-byte what goes to prod. The fix is **runtime configuration**: build one artifact, and at deploy time place a small `config.json` (API URL, environment name) next to it, which the app fetches at start-up.

**How it works:**
1. Build once per commit; tag the artifact with the git SHA.
2. Keep environment-specific values out of `import.meta.env`; put them in `config.json`.
3. Deploy: copy the same `dist/` to each environment and write that environment's `config.json` (with `no-cache`).
4. App start-up: fetch `config.json`, then render.

**Example:**
```ts
// src/main.tsx
type AppConfig = { apiBaseUrl: string; environment: string };

const config: AppConfig = await fetch(`${import.meta.env.BASE_URL}config.json`, { cache: "no-store" })
  .then(r => r.json());
createRoot(document.getElementById("root")!).render(<App config={config} />);
```

```flow
sequence: One artifact, two environments
actors: CI, Staging bucket, Production bucket, Browser
CI -> Staging bucket: dist/ from commit a1b2c3d plus config.json with the staging API URL
CI -> Production bucket: the same dist/ from a1b2c3d plus config.json with the production API URL
Browser -> Production bucket: index.html and index-4f9c2a1b.js
Browser -> Production bucket: config.json fetched at start-up
> Both environments run identical JavaScript. Only the small config file differs, so what passed staging is exactly what runs in production.
```

**What happens, step by step:**
1. CI builds commit `a1b2c3d` once; `index-4f9c2a1b.js` is identical everywhere.
2. Staging gets `{"apiBaseUrl":"https://staging-api.example.com","environment":"staging"}`; prod gets the production URL.
3. In prod the browser loads the bundle, fetches `config.json`, and calls the production API.
4. Promoting to prod is a copy plus a config write, not a rebuild.

**Common mistake → fix:** putting `config.json` in `public/` with long caching. After you change the API URL, users keep the old config. Serve it `no-cache` (and `fetch` with `cache: "no-store"`). Also remember it's public; never put secrets in it.

**Interview answer:** "Build-time env vars force one build per environment, so what you tested isn't what ships. I build once per commit and load environment settings at runtime from a small config.json written at deploy time and served no-cache. The same hashed bundle is promoted from staging to production, so releases and rollbacks are just copies."

**Follow-ups:**
- *Doesn't the extra fetch slow start-up?* It's one tiny request; you can inline it into `index.html` at deploy time (for example `window.__CONFIG__`) to avoid it.

---

### Q33. How do you release a new version without breaking users who have the old version open?

**Short answer:** Upload in an order that never points to missing files: **new hashed assets first, `index.html` last**, and **keep old assets** for days. Users with an old tab open still request old chunk names when they navigate; if you deleted them, those requests 404 and the page breaks. Also handle Vite's `vite:preloadError` event by reloading the page, so an unavoidable chunk failure turns into a fresh load of the new version.

**How it works:**
1. Upload new `assets/*` (new hashes, so nothing is overwritten).
2. Upload the new `index.html` with `no-cache`, then invalidate it on the CDN. New visitors now get the new version.
3. Leave old assets in place (for example, delete assets older than 7 days with a lifecycle rule).
4. Rollback = put the previous build's `index.html` back; its assets are still there.

**Example:**
```ts
// src/main.tsx
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();          // don't throw the error
  window.location.reload();        // load the new index.html and new chunks
});
```

```flow
trace: An old tab during a release
10:00 user opens the app: index.html v1 references Reports-**7d1e**.js > The tab has the v1 entry loaded in memory.
10:05 deploy v2: Reports-**c09e**.js uploaded, index.html v2 uploaded > The v1 files are deliberately left in the bucket.
10:20 user clicks Reports in the old tab: GET Reports-7d1e.js returns 200 > The old chunk still exists, so the old tab keeps working.
if v1 files had been deleted: 404, vite:preloadError fires, page reloads into v2 > The reload handler turns a broken navigation into a fresh load of the new version.
```

**What happens, step by step:**
1. The user's tab runs v1 and lazy chunks haven't loaded yet.
2. v2 is deployed: new files added, `index.html` replaced, old files kept.
3. The user opens Reports; the v1 code requests `Reports-7d1e.js`, which still exists → the page works.
4. If cleanup had deleted it, the dynamic import fails, Vite emits `vite:preloadError`, the handler reloads, and the user lands on v2.

**Common mistake → fix:** `aws s3 sync dist/ s3://bucket --delete` as the deploy command. It removes old chunks immediately and can upload `index.html` before its assets. Fix: sync assets without `--delete`, upload `index.html` last, and clean up old assets later with a lifecycle rule.

**Interview answer:** "I upload hashed assets first and index.html last with no-cache plus an invalidation, and keep old assets around for several days so open tabs can still lazy-load their chunks. Rollback is just restoring the previous index.html. As a safety net I listen for vite:preloadError and reload the page into the new version."

**Follow-ups:**
- *How do you tell users a new version exists?* Poll a `version.json` (no-cache) and show a "new version available, reload" banner.

---

## 6. Scenario & debugging questions

### Q34. The app works locally, but API calls fail after deployment. How do you diagnose it?

**Short answer:** Locally the Vite proxy made every API call same-origin and pointed at your local backend. In production that proxy doesn't exist, so the usual causes are: no `/api` routing on the host, the wrong API URL baked into the build, CORS, missing credentials, or an unhealthy backend. Open the browser's Network tab and let the **URL, status code and response body** tell you which one.

**Step by step:**
1. **Which URL was called?** DevTools → Network → the failing request. *If* it's `http://localhost:8000/...`, a dev value was baked into the build (`VITE_API_BASE_URL` from the wrong `.env`). Fix the mode or use runtime config (Q32).
2. **Status 200 but the body is HTML.** The SPA fallback answered the API call with `index.html`, so the host has no `/api/*` route. `response.json()` fails with `Unexpected token '<'`. Add the route (CloudFront behaviour, Nginx `location /api/`).
3. **"Blocked by CORS policy" in the console.** The app and API are on different origins and the API doesn't allow the deployed origin. It worked locally because of the proxy. Fix: same-origin routing via the CDN, or allowlist the exact origin on the API.
4. **401/403.** The token isn't sent (wrong `Authorization` header logic in prod), cookies are blocked (`SameSite`, domain mismatch), or the identity provider is configured for localhost callback URLs only. Check the request headers.
5. **502/504.** The request reached your load balancer but the backend is unhealthy or slow. Check target health and backend logs.
6. **Request never leaves the browser / mixed content.** The page is HTTPS but calls `http://` → blocked. Use HTTPS or relative URLs.

**Example:** the request to `https://app.example.com/api/reports` returns `200`, `content-type: text/html`, body starts with `<!doctype html>`.

**What happens, step by step:**
1. The browser calls `/api/reports` on the app's origin.
2. The CDN has no `/api/*` behaviour, so the request goes to S3; the object doesn't exist; the fallback returns `index.html` with 200.
3. The app calls `response.json()` and throws `SyntaxError: Unexpected token '<'`.
4. After adding the `/api/*` behaviour pointing to the load balancer, the response is JSON and the page works.

**Common mistake → fix:** "fixing" a CORS error on the frontend (adding `mode: "no-cors"` to `fetch`). That makes the response opaque, so the code can't read it at all. CORS is fixed on the server or avoided by same-origin routing.

**Interview answer:** "I start from the Network tab: the URL tells me if a dev URL was baked in, an HTML body with 200 means the SPA fallback caught an API route because the host has no /api routing, a CORS error means different origins without allow headers, 401/403 points at tokens or cookies, and 502/504 at backend health. The underlying lesson is that the Vite proxy only exists in dev, so production routing must be configured on the host."

**Follow-ups:**
- *How do you prevent this?* Use relative `/api` URLs everywhere, test the built app behind the real routing in staging, and add a smoke test that calls one API endpoint after each deploy.

---

### Q35. Users see a blank page right after a release. What do you check?

**Short answer:** A blank page means the entry JavaScript failed to load or crashed before React rendered. After a release the common causes are: chunk files that 404 (old HTML cached, or old assets deleted), a CSP blocking the script, the wrong `base` path, or a runtime error in the new code. The browser console and Network tab show which one in seconds.

**Step by step:**
1. **Console:** read the first red error.
   - `Failed to fetch dynamically imported module` or a 404 for `assets/*.js` → chunk mismatch (go to 2).
   - `Refused to load the script … violates the Content Security Policy` → CSP (go to 3).
   - `Unexpected token '<'` → a JS request returned HTML (fallback catching assets, or wrong `base`) (go to 4).
   - A normal JS `TypeError` in your code → a bug in the release; roll back, then fix.
2. **Chunk mismatch:** check `index.html` response headers. If it is cached (`max-age` or CDN cache), users get old HTML pointing at deleted files. Fix: `no-cache` on `index.html`, invalidation, keep old assets, `vite:preloadError` reload (Q33).
3. **CSP:** a new third-party script or a different API domain isn't in the policy. Update `script-src`/`connect-src`.
4. **Paths:** script URLs start with `/assets/` but the app is under `/portal/` → set `base` (Q19). Or the SPA fallback is returning HTML for `/assets/*` → scope it to pages (Q29).
5. **Roll back first if many users are affected:** restore the previous `index.html`; its assets still exist.

**Example:** console shows `GET https://app.example.com/assets/index-4f9c2a1b.js 404`.

```flow
sequence: Blank page caused by a cached index.html
actors: Browser, CDN, S3
Browser -> CDN: GET /index.html
CDN --> Browser: v1 HTML from the edge cache, because max-age was one day
Browser -> CDN: GET /assets/index-4f9c2a1b.js
CDN -> S3: fetch the v1 entry
S3 --> CDN: 404, the deploy deleted v1 assets
CDN --> Browser: 404, the entry script never runs and the root div stays empty
> Two mistakes combined: index.html was cached and the old assets were deleted. Either fix alone would have prevented the blank page.
```

**What happens, step by step:**
1. The CDN still serves yesterday's `index.html`, which references `index-4f9c2a1b.js`.
2. The deploy used `sync --delete`, so that file is gone.
3. The entry script 404s; React never mounts; the user sees an empty `<div id="root">`.
4. Fix both: `no-cache` + invalidation for `index.html`, and stop deleting assets on deploy.

**Common mistake → fix:** telling users to "hard refresh". It hides the cause and fails for everyone who doesn't. Fix the caching and release order so it can't happen.

**Interview answer:** "A blank page means the entry script didn't load or crashed. I read the first console error: 404s on chunks point to a cached index.html or deleted assets, CSP violations to the header policy, 'Unexpected token <' to HTML being returned for JS, which is a base path or fallback issue, and anything else is a code bug. If it's widespread I roll back index.html first, then fix caching and release order."

**Follow-ups:**
- *How do you catch it before users do?* A post-deploy smoke test with Playwright that loads the page and checks a visible element, plus error tracking alerting on new errors.

---

### Q36. The production bundle is 8 MB. How do you shrink it?

**Short answer:** Measure first, then remove the biggest items. Use a bundle visualiser to see which modules are largest; then lazy-load heavy features, replace or slim down heavy libraries, fix imports that defeat tree shaking, remove duplicate versions, and add a **size budget** to CI so it doesn't grow back.

**Step by step:**
1. **Measure:** add `rollup-plugin-visualizer` and run `vite build`; open the treemap. Note the entry chunk size (what blocks first render) separately from lazy chunks.
2. **Lazy-load heavy, rare features:** PDF viewer, code editor, charts, markdown renderer, maps → `lazy(() => import(...))` per route or on interaction.
3. **Fix imports:** `import _ from "lodash"` → `import { debounce } from "lodash-es"`; icon packs → per-icon imports; date libraries → `date-fns` functions or native `Intl`.
4. **Remove duplicates:** two versions of the same library appear in the treemap → `npm ls <pkg>`, then align versions or use `overrides`.
5. **Drop unused locales and data:** moment-style locale packs, large JSON files imported at the top level (load them with `fetch` or dynamic import).
6. **Group vendors sensibly:** a stable vendor chunk caches across releases (Q23).
7. **Set a budget:** fail CI if the entry chunk's gzip size exceeds an agreed limit (for example 200 kB, illustrative).

**Example (illustrative numbers):**

| Module | Before | Action | After |
|---|---|---|---|
| `pdfjs-dist` | 2.1 MB | lazy-load on the viewer route | 0 in entry |
| `monaco-editor` | 2.8 MB | lazy-load when the editor opens | 0 in entry |
| `lodash` (CJS) | 0.5 MB | `lodash-es` named imports | 12 kB |
| Icon pack | 1.2 MB | per-icon imports | 30 kB |
| Two copies of a chart library | 0.9 MB | dedupe | 0.45 MB |

**What happens, step by step:**
1. The treemap shows pdf.js and Monaco dominate the entry chunk because they're imported at the top of `App.tsx`.
2. Moving them behind `lazy()` removes about 4.9 MB from the entry; they now load only on the routes that need them.
3. Import fixes and deduping remove another ~2 MB.
4. The entry chunk drops from 8 MB to a few hundred kB; the CI budget now prevents regressions.

**Common mistake → fix:** raising `build.chunkSizeWarningLimit` to silence the warning. That hides the problem; users still download 8 MB. Treat the warning as a prompt to measure.

**Interview answer:** "I measure with a visualiser, then attack the biggest items: lazy-load heavy rarely used features, switch to tree-shakable ESM imports, remove duplicate library versions and unused locales or large JSON, and group stable vendors for caching. Then I add a gzip size budget for the entry chunk in CI so it can't regress."

**Follow-ups:**
- *Does gzip/brotli fix it?* Compression helps transfer size, but the browser still has to parse and run all that JavaScript, which is what hurts slow phones.

---

### Q37. Design a CI/CD quality gate for a Vite frontend.

**Short answer:** A pipeline that installs reproducibly, checks types, lint and tests, builds **once**, checks the bundle size, and promotes the **same artifact** through staging (with end-to-end smoke tests) to production. Deployments use short-lived credentials (OIDC, OpenID Connect) rather than long-lived cloud keys, and only protected branches or tags can deploy.

**How it works:**
1. **Install:** `npm ci` uses the exact lockfile versions.
2. **Static checks:** `tsc --noEmit` (Vite doesn't type-check), ESLint (including React hooks rules).
3. **Tests:** Vitest unit and component tests.
4. **Dependency scan:** `npm audit` or a software composition analysis tool for vulnerable packages.
5. **Build once:** `vite build`, artifact tagged with the commit SHA.
6. **Budget:** fail if the entry chunk exceeds the limit.
7. **Deploy to staging** with runtime config; **Playwright smoke tests** against it.
8. **Promote** the same artifact to production (manual approval or automatic), assets first, `index.html` last.

**Example:**
```yaml
# illustrative CI config
stages: [verify, build, staging, production]
verify:
  script: [npm ci, npx tsc --noEmit, npx eslint ., npx vitest run, npm audit --audit-level=high]
build:
  script: [npm ci, npx vite build, node scripts/check-bundle-size.mjs]
  artifacts: { paths: [dist/] }
staging:
  script: [./deploy.sh staging, npx playwright test --grep @smoke]
production:
  when: manual
  script: [./deploy.sh production]
```

**What happens, step by step:**
1. A merge request runs `verify`; a type error fails it before anything is built.
2. On the main branch, `build` produces `dist/` for commit `a1b2c3d` and checks its size.
3. `staging` deploys that `dist/` with staging `config.json` and runs smoke tests.
4. An approver triggers `production`; the same files are copied with the production config.

**Common mistake → fix:** rebuilding for production with different env variables after staging passed. The production bundle was never tested. Promote the staged artifact and vary only runtime config.

**Interview answer:** "npm ci, then type-check, lint, unit tests and a dependency scan; a single vite build per commit with a bundle-size budget; deploy that artifact to staging and run Playwright smoke tests; then promote the same artifact to production with assets first and index.html last. Deploy credentials come from OIDC, and only protected branches can deploy."

**Follow-ups:**
- *Where do preview environments fit?* Deploy each merge request's build to a temporary URL for review; same artifact rules apply.

---

### Q38. How do you upgrade a project from Vite 7 to Vite 8?

**Short answer:** Vite 8 swaps esbuild and Rollup for **Rolldown** and **Oxc**, and a compatibility layer converts most old options automatically, so many projects upgrade by bumping versions. The work is in the things that changed: `build.rollupOptions` → `build.rolldownOptions`, the removed object form of `manualChunks` (use `codeSplitting`), `esbuild` options → `oxc`, newer default browser targets, and stricter CommonJS default-import rules. Upgrade on a branch and compare the build output and the app behaviour.

**How it works / checklist:**

| Area | Vite 7 | Vite 8 |
|---|---|---|
| Bundler | esbuild (dev deps) + Rollup (build) | Rolldown for both |
| Build options | `build.rollupOptions` | `build.rolldownOptions` (old name deprecated, auto-converted) |
| Vendor chunks | `manualChunks: { react: [...] }` | object form removed; use `output.codeSplitting.groups` |
| Transform options | `esbuild: {...}` | `oxc: {...}` (`esbuild` deprecated, auto-converted) |
| Dep optimizer options | `optimizeDeps.esbuildOptions` | `optimizeDeps.rolldownOptions` |
| JS / CSS minify | esbuild | Oxc minifier / Lightning CSS |
| Default target | Chrome 107, Firefox 104, Safari 16.0 | Chrome 111, Firefox 114, Safari 16.4 |
| CJS default imports | lenient | new consistent rules; `legacy.inconsistentCjsInterop: true` as a temporary escape hatch |
| Node.js | 20.19+ / 22.12+ | 20.19+ / 22.12+ |

**Example:**
```bash
npm install -D vite@8 @vitejs/plugin-react@6
npx vite build
```
```ts
// before (Vite 7)
build: { rollupOptions: { output: { manualChunks: { react: ["react", "react-dom"] } } } }
// after (Vite 8)
build: { rolldownOptions: { output: { codeSplitting: { groups: [
  { name: "react", test: /node_modules[\\/](react|react-dom)[\\/]/ },
] } } } }
```

**What happens, step by step:**
1. Bump `vite` and `@vitejs/plugin-react`. Run `vite build`: the build gets much faster (the Vite team reports 10–30× vs Rollup in benchmarks; real projects vary).
2. The build errors on the object `manualChunks`; replace it with a `codeSplitting` group.
3. A plugin calling `transformWithEsbuild` fails because esbuild is now optional; install `esbuild` or update the plugin to `transformWithOxc`.
4. At runtime a CommonJS package's default import is now the whole module object rather than its `default`; fix the import, or set `legacy.inconsistentCjsInterop: true` temporarily.
5. Compare `dist/` sizes, run tests and smoke tests on `vite preview`, then merge.

**Common mistake → fix:** upgrading on the main branch and trusting a green dev server. Dev and build both changed engines, so verify the production build, chunk names/sizes and browser support (the new default target drops Safari below 16.4) before release.

**Interview answer:** "Vite 8 replaces esbuild and Rollup with Rolldown and Oxc, with a compatibility layer, so I bump vite and the React plugin on a branch and run the build. Then I fix what doesn't convert: rollupOptions becomes rolldownOptions, object manualChunks becomes codeSplitting groups, esbuild-specific plugin helpers, CommonJS default-import differences, and I confirm the new default browser target is acceptable. Finally I compare the bundle and run tests against vite preview."

**Follow-ups:**
- *Can I try Rolldown before upgrading?* The `rolldown-vite` package was the intermediate step for Vite 7 users.
- *Does `@vitejs/plugin-react` v5 work on Vite 8?* Yes; v6 is recommended because it uses Oxc and drops Babel.

---

## 7. Cheat sheet

| Topic | Remember |
|---|---|
| Build tool | Transforms, resolves, bundles and optimises source for the browser |
| Vite vs React | Build tool on your machine/CI vs UI library in the browser |
| ES modules | Static `import`/`export`; browsers load them natively; enables tree shaking |
| Vite 8 | Rolldown (bundler) + Oxc (parse, transform, minify); Lightning CSS minify |
| Dev server | Native ESM, transform on request, nothing bundled, port 5173 |
| Pre-bundling | `node_modules/.vite/deps`; CJS → ESM, 600 files → 1; `--force` to rebuild |
| HMR | WebSocket update, re-import with `?t=`; Fast Refresh keeps state; non-component exports force reload |
| Commands | `vite` dev · `vite build` → `dist/` · `vite preview` local check (4173) |
| TypeScript | Transpiled, never type-checked → `tsc -b && vite build` |
| Env vars | Only `VITE_*` + MODE/BASE_URL/PROD/DEV/SSR; replaced at build; public |
| Modes | `.env` → `.env.local` → `.env.[mode]` → `.env.[mode].local`; shell wins; mode ≠ NODE_ENV |
| Proxy | Dev only; production routing lives on the CDN/Nginx |
| CORS | Browser rule, fixed on the backend; same origin avoids it |
| Aliases | tsconfig `paths` + `resolve.alias`, or Vite 8 `resolve.tsconfigPaths` |
| `base` | Sub-path deploys; router basename too |
| Hashing | Assets immutable for a year; `index.html` no-cache |
| Assets | `import` = hashed, inlined under 4 KB; `public/` = fixed name, as-is |
| Code splitting | `import()` = chunk; Vite 8 vendor groups via `codeSplitting` |
| Tree shaking | ESM + no side effects; CJS and barrels defeat it |
| Source maps | `"hidden"`, upload privately |
| Target | Syntax only; no polyfills; default Chrome 111/Firefox 114/Safari 16.4 |
| Deploy | Private S3 + CloudFront OAC, `/api/*` same origin, scoped SPA fallback |
| Releases | Assets first, HTML last, keep old chunks, reload on `vite:preloadError` |
| Config per env | Build once, runtime `config.json` |

## Official references

- https://vite.dev/guide/ · https://vite.dev/guide/why · https://vite.dev/guide/features
- https://vite.dev/guide/dep-pre-bundling · https://vite.dev/guide/env-and-mode
- https://vite.dev/guide/static-deploy · https://vite.dev/guide/build · https://vite.dev/guide/api-plugin
- https://vite.dev/blog/announcing-vite8 · https://vite.dev/guide/migration
- https://rolldown.rs/ · https://rolldown.rs/reference/OutputOptions.codeSplitting · https://oxc.rs/
- https://vitest.dev/guide/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS · https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
