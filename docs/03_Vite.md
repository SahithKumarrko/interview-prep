# Vite.js: L2 → L3 Interview Preparation

> **Updated:** 24 October 2026 (Vite 8 is current — stable since March 2026, uses **Rolldown**) · **Level:** basics → internals → production delivery
> **How to use:** *Short answer* = your first 30 seconds. *Explanation* / *Example* = understanding. *Pitfall* = follow-up traps.

---

## Table of contents

1. [Mental model: what Vite does](#1-mental-model-what-vite-does)
2. [Fundamentals](#2-fundamentals) (Q01–Q08)
3. [Configuration & environment](#3-configuration--environment) (Q09–Q15)
4. [Build output, assets & performance](#4-build-output-assets--performance) (Q16–Q22)
5. [Deployment & security](#5-deployment--security) (Q23–Q28)
6. [Scenario & debugging questions](#6-scenario--debugging-questions) (Q29–Q32)
7. [Cheat sheet](#7-cheat-sheet)

---

## 1. Mental model: what Vite does

**Vite is a build tool, not a UI framework.** React decides *what* to render; Vite turns your source files (JSX, TypeScript, CSS, images) into something a browser can load — quickly in development, optimally in production.

```
                         ┌───────────────────── DEVELOPMENT (vite / vite dev) ─────────────────────┐
  src/main.tsx           │                                                                          │
  src/App.tsx   ───────► │  Dev server:                                                             │
  src/*.css              │   • serves YOUR files as native ES modules, transformed ON DEMAND         │
  node_modules/*         │     (TS/JSX → JS by Oxc) only when the browser requests them             │
                         │   • pre-bundles node_modules deps once (many files → few, CJS → ESM)      │
                         │   • HMR over WebSocket: edit a file → only that module is swapped         │
                         └──────────────────────────────────────────────────────────────────────────┘

                         ┌───────────────────── PRODUCTION (vite build) ────────────────────────────┐
                         │  Rolldown (Rust bundler, Vite 8+):                                        │
                         │   • bundles + tree-shakes + minifies                                      │
                         │   • splits chunks at dynamic import() boundaries                          │
                         │   • fingerprints files: assets/index-a1b2c3.js                            │
                         │  Output: dist/  (static files: index.html + assets/)                      │
                         └──────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼  upload
                           S3 + CloudFront / Nginx / any static host
```

**Why was Vite faster than Webpack-era tools?** Old dev servers bundled the *entire* app before you could see anything and re-bundled on every change. Vite skips bundling your source in dev: the browser asks for modules, Vite transforms each one when asked. Start-up time no longer grows with app size.

**Version history to know:**

| Version | Change |
|---|---|
| Vite ≤ 7 | esbuild (dev transforms + dependency pre-bundling) + Rollup (production build) — two different tools |
| Vite 7 (2025) | Node 20.19+/22.12+, default browser target `baseline-widely-available` |
| **Vite 8 (Mar 2026)** | **Rolldown** = one Rust bundler for dev and build (10–30× faster builds), **Oxc** for parsing/transforming; ESM-only package; built-in `resolve.tsconfigPaths`; `@vitejs/plugin-react` v6 (Oxc-based, no Babel) |

---

## 2. Fundamentals

### Q01. What is Vite and how is it different from React?

**Short answer:** React is a **UI library** (runs in the browser). Vite is a **dev server + build tool** (runs on your machine/CI). Vite compiles and serves React code; you could use Vite with Vue, Svelte or plain JS.

```bash
npm create vite@latest my-app -- --template react-ts
cd my-app && npm install
npm run dev      # vite        → dev server http://localhost:5173
npm run build    # vite build  → dist/
npm run preview  # vite preview → serve dist/ locally to check the build
```

---

### Q02. How does the dev server work? (native ESM + on-demand transforms)

**Short answer:** The browser loads `index.html`, which has `<script type="module" src="/src/main.tsx">`. The browser then requests each `import` as a separate HTTP request; Vite intercepts, transforms that one file (TS→JS, JSX→JS, CSS→JS module), and returns it. Untouched files are never processed.

```
Browser: GET /src/main.tsx ─► Vite transforms → JS with `import App from "/src/App.tsx"`
Browser: GET /src/App.tsx  ─► Vite transforms → ...
Browser: GET /node_modules/.vite/deps/react.js ─► pre-bundled dependency (cached)
```

**Pitfall:** Dev ≠ production. In dev, files are separate modules; in prod, they're bundled. Bugs like circular-import ordering or case-sensitive paths can show up only in one of them — always test `vite build && vite preview`.

---

### Q03. What is dependency pre-bundling and why does it exist?

**Short answer:** On first start, Vite scans your imports and bundles `node_modules` dependencies into a few files in `node_modules/.vite/deps`. Two reasons: (1) **convert CommonJS/UMD to ESM** so the browser can import them, (2) **reduce request count** — `lodash-es` has 600+ internal modules that would otherwise be 600 HTTP requests.

**Follow-up:** Cache is invalidated when the lockfile or config changes. Force rebuild: `vite --force`. Include/exclude problem deps with `optimizeDeps.include/exclude`.

---

### Q04. What is HMR and how does React Fast Refresh fit in?

**Short answer:** **Hot Module Replacement** — when you save a file, Vite sends a WebSocket message; the browser fetches just that module and swaps it into the running page without a full reload. **React Fast Refresh** (via `@vitejs/plugin-react`) re-renders the edited components while **keeping their state**.

```
save Button.tsx → Vite: "Button.tsx changed" (WebSocket) → browser imports Button.tsx?t=123
               → Fast Refresh re-renders Button, preserves useState values
```

**When it falls back to full reload:** the file exports non-components alongside components, you changed a module with no HMR boundary (e.g. `main.tsx`), or a syntax error.

---

### Q05. `vite dev` vs `vite build` vs `vite preview`

| Command | What it does | Use in production? |
|---|---|---|
| `vite` / `vite dev` | Dev server with on-demand transforms + HMR | ❌ never |
| `vite build` | Optimised static output in `dist/` | ✅ output is what you deploy |
| `vite preview` | Simple local static server for `dist/` | ❌ only for checking the build |

**Production hosting:** upload `dist/` to S3 + CloudFront, Nginx, or a container serving static files.

---

### Q06. What does `index.html` do in Vite?

**Short answer:** It's the **entry point** (not tucked away in `public/`). Vite parses it, follows `<script type="module">` and `<link>` tags, and rewrites them to hashed asset URLs in the build. Multi-page apps can have several HTML entries.

---

### Q07. What are plugins?

**Short answer:** Plugins hook into Vite's pipeline — `resolveId` (where is this import?), `load` (read it), `transform` (change code), plus build hooks. Vite's plugin API extends the Rollup plugin interface, and in Vite 8 most Rollup plugins still work on Rolldown.

```ts
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ plugins: [react()] });

// Tiny custom plugin: inject build time
function buildInfo() {
  return {
    name: "build-info",
    transform(code, id) {
      if (id.endsWith("version.ts")) return code.replace("__BUILD_TIME__", new Date().toISOString());
    },
  };
}
```

**Security:** plugins run arbitrary code during the build with access to your CI environment → pin versions, prefer well-maintained plugins, review new ones (supply-chain risk).

---

### Q08. How is TypeScript handled?

**Short answer:** Vite **transpiles** TS (strips types, very fast) but does **not type-check**. Run `tsc --noEmit` (or `vue-tsc`) separately in CI or via `vite-plugin-checker`.

```json
"scripts": { "build": "tsc -b && vite build" }
```

---

## 3. Configuration & environment

### Q09. What does `vite.config.ts` control?

```ts
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());        // read .env files in config (Node side)
  return {
    plugins: [react()],
    base: "/",                                    // public path for assets
    resolve: {
      alias: { "@": "/src" },                      // import x from "@/components/x"
      // tsconfigPaths: true,                      // Vite 8: use tsconfig "paths" directly
    },
    server: {
      port: 5173,
      proxy: { "/api": { target: "http://localhost:8000", changeOrigin: true } },
    },
    build: {
      outDir: "dist",
      sourcemap: "hidden",                         // generate maps, don't reference them publicly
      chunkSizeWarningLimit: 600,
    },
  };
});
```

---

### Q10. `import.meta.env` — which variables reach the browser?

**Short answer:** Only variables prefixed `VITE_` (configurable via `envPrefix`) plus built-ins: `MODE`, `DEV`, `PROD`, `BASE_URL`, `SSR`. They are **replaced as literal strings at build time** — anyone can read them in the bundle. **Never put secrets there.**

```bash
# .env.production
VITE_API_BASE_URL=https://api.example.com     # ✅ public config
VITE_OPENAI_KEY=sk-...                        # ❌ leaked to every visitor
DB_PASSWORD=...                               # not exposed to client (no prefix), but don't keep secrets in repo files anyway
```
```ts
const api = import.meta.env.VITE_API_BASE_URL;
if (import.meta.env.DEV) console.log("dev mode");
```

**TypeScript typing:** declare `interface ImportMetaEnv { readonly VITE_API_BASE_URL: string }` in `src/vite-env.d.ts`.

---

### Q11. Modes and `.env` files

**Short answer:** A mode selects which `.env` files load. `vite` uses `development`, `vite build` uses `production`; custom: `vite build --mode staging`.

Load order (later wins): `.env` → `.env.local` → `.env.[mode]` → `.env.[mode].local`. Real shell environment variables override files. `*.local` files are git-ignored.

**Pitfall:** mode ≠ `NODE_ENV`. `--mode staging` still produces an optimised production build.

---

### Q12. Dev proxy vs production routing

**Short answer:** `server.proxy` forwards `/api/*` from the Vite dev server to your backend so the browser sees one origin (no CORS during dev). It **does not exist in the built app**. In production you need real routing: CloudFront behaviour, ALB rule, API Gateway, or Nginx.

```
DEV:   browser ─► localhost:5173/api/chat ─(Vite proxy)─► localhost:8000/chat
PROD:  browser ─► app.example.com/api/chat ─(CloudFront behaviour /api/*)─► ALB ─► FastAPI
```

---

### Q13. What is CORS and why doesn't the Vite proxy solve it in production?

**Short answer:** CORS is a **browser** security rule: JS on origin A can read a response from origin B only if B replies with matching `Access-Control-Allow-Origin` headers. It's configured on the **backend**, not the frontend. The dev proxy hides the problem by making requests same-origin locally.

```
Request from https://app.example.com to https://api.example.com
  ├─ preflight: OPTIONS /chat  (for non-simple requests: JSON body, Authorization header)
  └─ server must reply:
       Access-Control-Allow-Origin: https://app.example.com   (exact origin, not * with credentials)
       Access-Control-Allow-Headers: Authorization, Content-Type
       Access-Control-Allow-Credentials: true                 (if cookies)
```

**Best practice:** serve frontend and API from the **same origin** via CloudFront path routing → no CORS at all. Otherwise allowlist exact origins.

---

### Q14. Aliases: Vite vs TypeScript `paths`

**Short answer:** TypeScript `paths` affect type checking/IDE; Vite `resolve.alias` affects actual module resolution at runtime/build. They must agree. In Vite 8 you can set `resolve.tsconfigPaths: true` to reuse tsconfig paths (or use `vite-tsconfig-paths` plugin on older versions).

```json
// tsconfig.json
{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }
```

---

### Q15. `base`, router basename and deploying under a sub-path

If the app lives at `https://example.com/portal/`: set `base: "/portal/"` (asset URLs) **and** the router basename (`createBrowserRouter(routes, { basename: "/portal" })`). Missing either → blank page with 404s for `/assets/...`.

---

## 4. Build output, assets & performance

### Q16. What does a production build output look like?

```
dist/
├── index.html                       ← small, references hashed files; DO NOT cache long
└── assets/
    ├── index-4f9c2a1b.js            ← entry chunk (app code)
    ├── vendor-react-91ab33cd.js     ← (if you configure manual chunks)
    ├── PdfViewer-7d1e0f22.js        ← lazy chunk from import()
    └── index-0c3e5b8a.css
```
**Content hash in filenames** = the name changes only when content changes → cache forever (`immutable`), new deploys get new names automatically.

---

### Q17. Static assets: `import` vs `public/`

| | `import logo from "./logo.svg"` | `public/robots.txt` |
|---|---|---|
| Processed by Vite | ✅ (hashed name, maybe inlined if small < 4 KB as base64) | ❌ copied as-is |
| URL | `/assets/logo-ab12.svg` | `/robots.txt` (fixed) |
| Use for | images/fonts used by code | files needing a fixed name: robots.txt, favicon, `config.json` |

Other import suffixes: `?url` (get URL), `?raw` (file content as string), `?worker` (Web Worker), `?inline`.

---

### Q18. Code splitting and dynamic `import()`

**Short answer:** Every `import()` creates a split point → separate chunk loaded on demand. Use for routes and heavy, rarely-used features. Don't split tiny components (each chunk is a network round trip).

```tsx
const AdminPage = lazy(() => import("./pages/AdminPage"));
const MonacoEditor = lazy(() => import("./components/MonacoEditor"));
```
Vite also inserts **preload** hints for a chunk's dependencies to avoid waterfalls.

**Manual vendor chunks** (cache rarely-changing libs separately):
```ts
build: { rolldownOptions: { output: { manualChunks: { react: ["react", "react-dom"] } } } }
// (Vite ≤7: build.rollupOptions; Vite 8 auto-converts rollupOptions for compatibility)
```

---

### Q19. Tree shaking — why does unused code still ship?

**Short answer:** Tree shaking removes exports that are **statically provably unused**. It fails when: the package is CommonJS, a module has **side effects** (code that runs on import) and isn't marked `"sideEffects": false`, you import a whole namespace and use it dynamically, or a barrel file (`index.ts` re-exporting everything) pulls in side-effectful modules.

```ts
import _ from "lodash";               // ❌ whole library (CJS)
import { debounce } from "lodash-es"; // ✅ only debounce
```
**Diagnose:** `rollup-plugin-visualizer` treemap or Vite DevTools; check for duplicate copies of the same library.

---

### Q20. CSS handling

Plain `.css` imports are injected (dev) and extracted into hashed files (build). **CSS Modules**: `*.module.css` → locally scoped class names. PostCSS, Sass/Less (install preprocessor), Tailwind via its Vite plugin. Vite 8 includes **Lightning CSS** as a dependency for fast CSS transforms/minification.

---

### Q21. Source maps and their security

**Short answer:** Source maps map minified code back to original source for debugging. They can reveal your source code and internal logic. Options: `sourcemap: "hidden"` (generate, but don't add `//# sourceMappingURL`), upload maps privately to Sentry/your error tracker, and don't publish `.map` files on the public CDN.

---

### Q22. Browser targets and polyfills

`build.target` controls the JS syntax level emitted (Vite 7+ default: `baseline-widely-available` browsers). Vite does **not** add polyfills for missing APIs automatically; use `@vitejs/plugin-legacy` if you must support old browsers.

---

## 5. Deployment & security

### Q23. Deploying a Vite React SPA on AWS

```
 GitLab CI: install (lockfile) → typecheck → lint → test → vite build → upload dist/
                                                                           │
                         ┌─────────────────────────────────────────────────┘
                         ▼
 ┌──────────────┐   ┌────────────────────────── CloudFront ───────────────────────────┐
 │  User        │──►│ HTTPS (ACM cert) · WAF · response headers policy (CSP, HSTS)     │
 └──────────────┘   │                                                                 │
                    │ Behaviour /assets/*  → S3 (Origin Access Control)                │
                    │       Cache-Control: public, max-age=31536000, immutable         │
                    │ Behaviour /api/*     → ALB / API Gateway → FastAPI (no caching)  │
                    │ Default  /*          → S3 index.html                              │
                    │       Cache-Control: no-cache (always revalidate)                │
                    │ SPA fallback: 403/404 from S3 → /index.html (status 200)         │
                    └─────────────────────────────────────────────────────────────────┘
```
**Key points:** private S3 bucket + OAC (no public bucket), long cache for hashed assets, `no-cache` for `index.html`, path-based routing for `/api` (same origin → no CORS), invalidate `/index.html` on deploy.

---

### Q24. SPA fallback — why do deep links 404?

**Short answer:** `/chat/123` exists only in the client router; there's no `chat/123` file on S3. The host must return `index.html` for unknown **page** routes so React Router can take over. But don't apply the fallback to `/api/*` or `/assets/*` — a missing JS file returning `index.html` (HTML with status 200) causes "Unexpected token '<'" errors.

---

### Q25. Content Security Policy and secure headers

**Short answer:** Vite produces files; the **hosting layer** sets headers. Configure on CloudFront/Nginx: `Content-Security-Policy` (restrict script sources, `connect-src` for your API), `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `frame-ancestors`.

```
Content-Security-Policy: default-src 'self'; script-src 'self'; connect-src 'self' https://api.example.com;
                         img-src 'self' data:; object-src 'none'; frame-ancestors 'none'
```
Vite's production build doesn't need inline scripts, so a strict `script-src 'self'` usually works.

---

### Q26. Client-side env vars and feature flags are not security

Anything in the bundle is readable and editable by the user. `VITE_ENABLE_ADMIN=true` can hide/show a button but must never grant access — the **backend** enforces permissions.

---

### Q27. One build for all environments (build once, deploy many)

**Short answer:** Build-time env vars force a separate build per environment, so what you tested in staging isn't byte-identical to prod. Instead, build once and load **runtime config**:

```ts
// public/config.json is replaced per environment at deploy time (or served by the backend)
const config = await fetch("/config.json", { cache: "no-store" }).then(r => r.json());
createRoot(el).render(<App apiBaseUrl={config.apiBaseUrl} />);
```
The same artifact (tagged by git SHA) is promoted dev → staging → prod.

---

### Q28. Atomic, cache-safe releases

1. Upload **new hashed assets first** (old ones stay).
2. Then upload new `index.html` (`no-cache`).
3. Keep previous assets for some days — users with an old tab open still request old chunks.
4. Invalidate `index.html` in CloudFront.
5. Rollback = re-point `index.html` to the previous build.

If you delete old chunks immediately, users with the old HTML get **chunk load errors** on navigation. Handle `vite:preloadError` to reload the page gracefully:
```ts
window.addEventListener("vite:preloadError", () => window.location.reload());
```

---

## 6. Scenario & debugging questions

### Q29. Works locally with Vite, but API calls fail after deployment. Diagnose.

1. Browser DevTools → Network: what URL, status and **response body**? (HTML returned for an API call = wrong routing/fallback.)
2. **404** → CloudFront behaviour/path pattern wrong or base URL env var wrong.
3. **CORS error** → backend not allowing the deployed origin (worked locally because of the dev proxy).
4. **401/403** → cookie domain/SameSite, missing Authorization header, wrong Cognito config for the environment.
5. **502/504** → ALB target unhealthy or backend timeout.

---

### Q30. Users see a blank page right after a release

Check console: **chunk 404s** (old HTML cached, or old assets deleted), **CSP violations**, a runtime error in the entry chunk, wrong `base`. Fix: correct cache headers (`index.html` no-cache), retain old assets, add `vite:preloadError` handler, roll back if needed.

---

### Q31. Production bundle is 8 MB. How do you shrink it?

Visualise the bundle → find the biggest modules (PDF viewer, syntax highlighter, chart lib, icon packs, moment locales). Lazy-load heavy features, import only what you use, replace heavy libs, dedupe versions, check `sideEffects`, set a **size budget** in CI.

---

### Q32. Design a frontend CI/CD quality gate

```
lockfile install (npm ci) → tsc --noEmit → eslint → vitest → npm audit / dependency scan
  → vite build → bundle size budget check → upload artifact (dist/, tagged with SHA)
  → deploy to staging → Playwright smoke tests → manual/automatic promote same artifact to prod
```
Only protected branches/tags can deploy; deployment credentials via OIDC (no long-lived AWS keys).

---

## 7. Cheat sheet

| Topic | Remember |
|---|---|
| Vite vs React | build tool vs UI library |
| Dev server | native ESM, transform on demand, pre-bundle deps |
| HMR | WebSocket → swap module; Fast Refresh keeps state |
| Build | Vite 8 = Rolldown + Oxc; hashed chunks in `dist/` |
| `preview` | local check only, never production |
| Env | only `VITE_*` exposed, baked at build, **public** |
| Modes | `--mode staging` selects `.env.staging`; ≠ NODE_ENV |
| Proxy | dev only; prod needs CloudFront/ALB routing |
| CORS | backend headers; same-origin avoids it |
| TS | transpiled, not type-checked → run `tsc` |
| Caching | hashed assets immutable; `index.html` no-cache |
| SPA fallback | unknown pages → index.html, not API/assets |
| Source maps | `hidden`, upload privately |
| Releases | assets first, HTML last, keep old chunks |

## Official references

- https://vite.dev/guide/ · https://vite.dev/guide/why
- https://vite.dev/guide/env-and-mode · https://vite.dev/guide/static-deploy
- https://vite.dev/blog/announcing-vite8 · https://vite.dev/guide/migration
- https://rolldown.rs/
