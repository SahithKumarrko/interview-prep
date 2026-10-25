# React.js: L2 → L3 Interview Preparation

> **Updated:** 24 October 2026 (React 19.2 line is current) · **Level:** basics → hooks → architecture & production
> **How to use:** *Short answer* = what you say first. *Explanation* + *Example* = why it works. *Pitfall / Follow-up* = where interviewers dig.

---

## Table of contents

1. [Mental model: how React updates the screen](#1-mental-model-how-react-updates-the-screen)
2. [Fundamentals](#2-fundamentals) (Q01–Q09)
3. [Hooks in depth](#3-hooks-in-depth) (Q10–Q19)
4. [React 18/19 features](#4-react-1819-features) (Q20–Q26)
5. [State management & data fetching](#5-state-management--data-fetching) (Q27–Q31)
6. [Performance](#6-performance) (Q32–Q35)
7. [Security, testing, accessibility](#7-security-testing-accessibility) (Q36–Q40)
8. [Scenario & debugging questions](#8-scenario--debugging-questions) (Q41–Q45)
9. [React with TypeScript](#9-react-with-typescript) (Q46)
10. [Cheat sheet](#10-cheat-sheet)

---

## 1. Mental model: how React updates the screen

**Core idea:** `UI = f(state)`. You describe *what* the UI should look like for the current state; React figures out *how* to change the DOM.

```
   Trigger                 Render phase (pure, can be paused/redone)      Commit phase (sync)
 ┌─────────────┐         ┌────────────────────────────────────────┐     ┌──────────────────────┐
 │ setState()  │         │ React calls your component functions    │     │ React applies the     │
 │ new props   │ ──────► │ → new element tree (virtual DOM)        │ ──► │ minimal DOM changes    │
 │ context     │         │ → diff with previous tree               │     │ → runs ref callbacks   │
 │ change      │         │   (reconciliation)                      │     │ → useLayoutEffect      │
 └─────────────┘         └────────────────────────────────────────┘     │ → browser paints       │
                                                                         │ → useEffect runs       │
                                                                         └──────────────────────┘
```

**Rules that follow from this:**
- Component functions must be **pure**: same props/state → same output, no side effects during render (React may call them more than once — Strict Mode does so deliberately in development).
- Side effects (network, subscriptions, timers) go in **event handlers** (user caused it) or **effects** (synchronising with an external system).
- A component re-renders when **its state changes, its parent re-renders, or a context it reads changes**.

**Where React fits in a typical AI app (your stack):**
```
 ┌──────────────────────────── Browser ────────────────────────────┐
 │  Vite-built React SPA                                            │
 │  ┌──────────┐  ┌────────────────┐  ┌───────────────────────────┐ │
 │  │ Router   │  │ Server-state   │  │ Chat UI                    │ │
 │  │ (URL =   │  │ cache (TanStack│  │ useAgentStream(sessionId)  │ │
 │  │ state)   │  │ Query)         │  │ → SSE/WebSocket tokens     │ │
 │  └──────────┘  └───────┬────────┘  └────────────┬──────────────┘ │
 └─────────────────────────┼────────────────────────┼────────────────┘
                           │ HTTPS + JWT (Cognito)   │ SSE stream
                           ▼                         ▼
                   FastAPI / API Gateway  ──►  Agent (LangGraph on AgentCore)
```

---

## 2. Fundamentals

### Q01. What is React and what is a component?

**Short answer:** React is a JavaScript library for building UIs declaratively. A component is a function that takes **props** and returns **JSX** describing a piece of UI. Components compose into a tree.

**Example:**
```jsx
function JobStatus({ status }) {
  const color = status === "failed" ? "red" : "green";
  return <span style={{ color }}>{status}</span>;
}
// Use it:
<JobStatus status="running" />
```
Instead of "find the span and change its text" (imperative), you say "for this status, show this" (declarative).

**Follow-up — what is JSX?** Syntax sugar compiled to function calls: `<JobStatus status="x" />` → `jsx(JobStatus, { status: "x" })`. It produces plain objects (React elements), not DOM nodes.

---

### Q02. Props vs state vs derived values

**Short answer:**
- **Props**: inputs passed from the parent — read-only for the child.
- **State**: data the component *remembers* between renders; changing it triggers a re-render.
- **Derived values**: anything you can compute from props/state — **compute it during render, don't store it in state.**

**Example:**
```jsx
function DocList({ documents }) {
  const [filter, setFilter] = useState("all");                 // state
  const visible = documents.filter(d => filter === "all" || d.status === filter); // derived
  const doneCount = documents.filter(d => d.status === "done").length;            // derived
  // ❌ const [doneCount, setDoneCount] = useState(0) + an effect to sync it → can drift out of sync
  return <>{doneCount} done … {visible.map(d => <Row key={d.id} doc={d} />)}</>;
}
```

**Rule:** single source of truth. Duplicated state = bugs where two copies disagree.

---

### Q03. How does state update? Why is `setState` "async"?

**Short answer:** `setX(v)` doesn't change `x` immediately; it **schedules** a re-render. Inside the current render, `x` is a snapshot. React **batches** multiple updates (in all handlers since React 18) into one render.

**Example:**
```jsx
const [count, setCount] = useState(0);
function handleClick() {
  setCount(count + 1);
  setCount(count + 1);       // both use the same snapshot (0) → result 1
  setCount(c => c + 1);      // updater function uses latest queued value → correct
  console.log(count);        // still 0 here – snapshot
}
```

**Immutable updates:** never mutate state objects; create new ones so React sees a new reference.
```jsx
setUser(u => ({ ...u, name: "Ana" }));                // ✅
setItems(items => [...items, newItem]);               // ✅
items.push(newItem); setItems(items);                 // ❌ same reference → may not re-render
```

---

### Q04. Why do list keys matter?

**Short answer:** Keys tell React **which item is which** between renders, so it can keep the right state and DOM for each row. Use a stable unique ID; avoid array index when the list can reorder, insert or delete.

**Explanation:**
```
Before: [A(key=0), B(key=1)]   insert X at top → [X(key=0), A(key=1), B(key=2)]
With index keys React thinks "item 0 changed from A to X" → A's input text now shows on X's row ❌
With id keys   React sees "new X inserted, A and B unchanged" ✅
```

```jsx
{messages.map(m => <Message key={m.id} message={m} />)}
```

---

### Q05. Render vs commit

**Short answer:** **Render** = React calls your components to compute the new UI tree (pure, may be interrupted or repeated). **Commit** = React applies changes to the real DOM, then runs effects. Never do side effects in render.

```jsx
function Bad({ id }) {
  fetch(`/api/log/${id}`, { method: "POST" });   // ❌ may fire twice or more
  return <div/>;
}
```

---

### Q06. Controlled vs uncontrolled inputs

**Short answer:** **Controlled**: React state holds the value (`value` + `onChange`) — easy validation and syncing. **Uncontrolled**: the DOM holds the value; you read it via a `ref` or form data — less code, fewer re-renders.

```jsx
// Controlled
const [q, setQ] = useState("");
<input value={q} onChange={e => setQ(e.target.value)} />

// Uncontrolled (file inputs are always uncontrolled)
const fileRef = useRef(null);
<input type="file" ref={fileRef} />
// later: fileRef.current.files[0]

// React 19: form action reads FormData, no state per field needed
<form action={async (formData) => save(formData.get("title"))}>
  <input name="title" />
</form>
```

---

### Q07. Lifting state up and prop drilling

**Short answer:** When two siblings need the same data, move the state to their **closest common parent** and pass it down as props. If you pass props through many layers that don't use them ("prop drilling"), consider **composition** (pass components as `children`) or **context**.

```jsx
// Composition avoids drilling `user` through Layout
<Layout sidebar={<UserMenu user={user} />}>
  <Dashboard />
</Layout>
```

---

### Q08. Conditional rendering and fragments

```jsx
{isLoading && <Spinner />}                 // careful: {count && <X/>} renders "0" when count=0
{count > 0 ? <List /> : <Empty />}
<>                                          {/* Fragment: group without an extra div */}
  <dt>Name</dt><dd>{name}</dd>
</>
```

---

### Q09. Class components vs function components

**Short answer:** Function components with Hooks are the modern standard. Class components (`this.state`, `componentDidMount`) still work and are still needed for **error boundaries** (no hook equivalent yet), but new code uses functions.

| Class lifecycle | Hook equivalent |
|---|---|
| `componentDidMount` / `componentDidUpdate` / `componentWillUnmount` | `useEffect(() => { …; return cleanup }, [deps])` |
| `shouldComponentUpdate` | `React.memo` |
| `this.state` | `useState` / `useReducer` |

---

## 3. Hooks in depth

### Q10. Rules of Hooks — and why they exist

**Short answer:** (1) Call hooks only at the **top level** of a component or custom hook — not inside loops, conditions or nested functions. (2) Call them only from React functions. Reason: React stores hook state in an ordered list per component and matches them **by call order** each render.

```
Render 1: useState(A) → slot 0, useState(B) → slot 1, useEffect → slot 2
Render 2 with an `if` skipping first hook: useState(B) reads slot 0 → gets A's value ❌
```

```jsx
function Doc({ data }) {
  const [open, setOpen] = useState(false);   // ✅ all hooks first
  if (!data) return null;                    // early return AFTER hooks
  …
}
```

(`use()` in React 19 is the one exception — it may be called conditionally.)

---

### Q11. `useState` vs `useReducer`

**Short answer:** `useState` for simple independent values. `useReducer` when the next state depends on the previous state through several **named transitions** — logic becomes a pure, testable function.

```jsx
function jobReducer(state, action) {
  switch (action.type) {
    case "start":    return { status: "running", progress: 0, error: null };
    case "progress": return { ...state, progress: action.pct };
    case "fail":     return { ...state, status: "failed", error: action.error };
    case "done":     return { ...state, status: "succeeded", progress: 100 };
    default:         return state;
  }
}
const [job, dispatch] = useReducer(jobReducer, { status: "idle", progress: 0 });
dispatch({ type: "progress", pct: 40 });
```

---

### Q12. What does `useEffect` actually do?

**Short answer:** It **synchronises your component with an external system** (WebSocket, browser API, third-party widget, non-React state) after the commit. It runs after paint, re-runs when dependencies change, and its **cleanup** runs before the next run and on unmount.

**Lifecycle:**
```
mount:        render → commit → paint → effect(sessionId=A)
deps change:  render → commit → paint → cleanup(A) → effect(sessionId=B)
unmount:      cleanup(B)
```

**Example:**
```jsx
useEffect(() => {
  const ws = new WebSocket(`wss://api/sessions/${sessionId}`);
  ws.onmessage = e => setMessages(m => [...m, JSON.parse(e.data)]);
  return () => ws.close();                 // cleanup prevents leaks & cross-session writes
}, [sessionId]);
```

**Dependency array:** `[]` → run once after mount; `[a, b]` → when a or b change; omitted → after every render.

**Strict Mode (dev only):** mounts → unmounts → remounts once to expose missing cleanup. If your effect breaks under this, it has a bug.

---

### Q13. When should you NOT use `useEffect`?

**Short answer:** Don't use effects for (1) values you can **compute during render**, (2) logic caused by a **user event** (put it in the handler), (3) resetting state when a prop changes (use a **key**), (4) data fetching where a library/framework can do it better.

```jsx
// ❌ effect to derive data
const [fullName, setFullName] = useState("");
useEffect(() => setFullName(first + " " + last), [first, last]);
// ✅
const fullName = first + " " + last;

// ❌ effect reacting to a submit flag
// ✅ do the POST inside onSubmit
```

---

### Q14. `useRef` — what is it for?

**Short answer:** A ref is a mutable box `{ current }` that **persists across renders without causing a re-render** when changed. Uses: DOM access (focus, scroll, measure) and storing non-visual values (timers, `AbortController`, previous value).

```jsx
const inputRef = useRef(null);
const abortRef = useRef(null);
<input ref={inputRef} />
inputRef.current.focus();
abortRef.current?.abort(); abortRef.current = new AbortController();
```

**Rule:** if the value is shown in UI, it belongs in state, not a ref. React 19: `ref` can be passed as a normal prop to function components (no `forwardRef` needed).

---

### Q15. `useMemo`, `useCallback`, `React.memo`

**Short answer:**
- `useMemo(fn, deps)` — cache a **computed value**.
- `useCallback(fn, deps)` — cache a **function identity**.
- `React.memo(Component)` — skip re-rendering a child if its props are shallow-equal.

They're **performance** tools only. `useCallback` alone does nothing useful unless the function is passed to a memoised child or used as an effect dependency.

```jsx
const filtered = useMemo(() => rows.filter(r => r.text.includes(q)), [rows, q]);
const onSelect = useCallback(id => setSelected(id), []);
const Row = React.memo(function Row({ row, onSelect }) { … });
```

**React Compiler (v1.0 stable since Oct 2025):** a build-time plugin that inserts this memoisation automatically. With it enabled, most manual `useMemo/useCallback` become unnecessary — but code must follow the Rules of React (purity, no mutation of props/state).

---

### Q16. `useContext` — when to use, when to avoid

**Short answer:** Context passes a value to any depth without props. Every consumer re-renders when the provider **value** changes. Good for low-frequency global values (theme, current user, locale, feature flags). Bad for high-frequency data (streaming tokens, mouse position) in one big provider.

```jsx
const AuthContext = createContext(null);
function App() {
  const [user, setUser] = useState(null);
  const value = useMemo(() => ({ user, setUser }), [user]);   // stable object identity
  return <AuthContext value={value}><Routes/></AuthContext>;   // React 19: <Context> as provider
}
const { user } = useContext(AuthContext);  // or use(AuthContext) in React 19
```

**Fixes for context churn:** split contexts (state vs dispatch), memoise the value, or use a store with selectors (Zustand, Redux).

---

### Q17. `useLayoutEffect`, `useId`, `useSyncExternalStore`, `useImperativeHandle`

| Hook | Use when |
|---|---|
| `useLayoutEffect` | measure DOM and update **before paint** (avoid flicker, e.g., tooltip position). Blocks paint — use sparingly |
| `useId` | stable unique IDs for accessibility (`htmlFor`/`aria-describedby`) that match on server & client |
| `useSyncExternalStore` | subscribe to an external store (browser API, custom store) safely with concurrent rendering |
| `useImperativeHandle` | expose a limited imperative API from a child (`ref.current.focus()`) |

---

### Q18. Stale closures

**Short answer:** Each render's functions "see" the props/state of **that** render. A timer, interval or subscription created in an earlier render keeps reading old values unless dependencies are correct or you use updater functions/refs.

```jsx
useEffect(() => {
  const id = setInterval(() => setCount(count + 1), 1000);  // ❌ count frozen at 0 → stuck at 1
  return () => clearInterval(id);
}, []);

useEffect(() => {
  const id = setInterval(() => setCount(c => c + 1), 1000); // ✅ updater reads latest
  return () => clearInterval(id);
}, []);
```

**React 19.2 `useEffectEvent`:** wrap logic that should read the *latest* props without making the effect re-subscribe.
```jsx
const onMessage = useEffectEvent(msg => { if (!muted) notify(msg); }); // always latest `muted`
useEffect(() => { const ws = connect(roomId); ws.on("msg", onMessage); return () => ws.close(); }, [roomId]);
```

---

### Q19. Custom hooks — design and testing

**Short answer:** A custom hook (`useSomething`) extracts reusable **stateful logic** (not UI). Each component calling it gets its own independent state.

```jsx
function useAgentStream(sessionId) {
  const [tokens, setTokens] = useState("");
  const [status, setStatus] = useState("idle");
  useEffect(() => {
    if (!sessionId) return;
    const ctrl = new AbortController();
    setTokens(""); setStatus("streaming");
    (async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/stream`, { signal: ctrl.signal });
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          setTokens(t => t + value);
        }
        setStatus("done");
      } catch (e) {
        if (e.name !== "AbortError") setStatus("error");
      }
    })();
    return () => ctrl.abort();          // switching session cancels the old stream
  }, [sessionId]);
  return { tokens, status };
}
```
**Test:** `renderHook` from React Testing Library + MSW to mock the stream; assert cleanup on session change.

---

## 4. React 18/19 features

### Q20. Concurrent rendering — what changed in React 18?

**Short answer:** React can **interrupt** a long render to handle an urgent update (typing), then resume. Enabled with `createRoot`. Also: **automatic batching** everywhere, `useTransition`, `useDeferredValue`, Suspense improvements, streaming SSR.

---

### Q21. `useTransition` and `useDeferredValue`

**Short answer:** Both mark work as **non-urgent** so urgent updates (keystrokes) stay responsive.
- `useTransition` — you control the **state update**: `startTransition(() => setFilter(v))`, with `isPending` for a spinner.
- `useDeferredValue` — you receive a **value** and want a lagging copy for expensive rendering.

```jsx
const [query, setQuery] = useState("");
const deferredQuery = useDeferredValue(query);
<input value={query} onChange={e => setQuery(e.target.value)} />   // urgent: instant
<HugeList filter={deferredQuery} />                                 // can lag behind
```
**Pitfall:** these don't reduce **network** calls — still debounce API requests and paginate on the server.

---

### Q22. Suspense, `React.lazy` and code splitting

**Short answer:** `React.lazy(() => import("./X"))` loads a component's code on demand. `<Suspense fallback>` shows a placeholder while children are "suspended" (loading code or data via a Suspense-enabled source).

```jsx
const PdfViewer = lazy(() => import("./PdfViewer"));     // separate chunk built by Vite
<Suspense fallback={<Spinner />}>
  {tab === "pdf" && <PdfViewer docId={id} />}
</Suspense>
```

---

### Q23. Error boundaries — what they catch and what they don't

**Short answer:** An error boundary catches errors thrown **during rendering, in lifecycle methods and constructors** of its descendants, and shows a fallback UI. It does **not** catch errors in event handlers, async code (`setTimeout`, promises), server errors, or errors in the boundary itself.

```jsx
class ErrorBoundary extends React.Component {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error, info) { reportToSentry(error, info.componentStack); }
  render() { return this.state.hasError ? <p>Chart failed to load</p> : this.props.children; }
}
<ErrorBoundary><RevenueChart /></ErrorBoundary>
```
(Most teams use the `react-error-boundary` package.) Handle API errors with explicit `error` state in data-fetching code.

---

### Q24. React 19: Actions, `useActionState`, `useFormStatus`, `useOptimistic`

**Short answer:** An **Action** is an async function passed to a transition or `<form action>`. React manages pending state, errors and optimistic updates for you.

```jsx
function RenameForm({ doc }) {
  const [optimisticName, setOptimisticName] = useOptimistic(doc.name);
  const [error, submit, isPending] = useActionState(async (prev, formData) => {
    const name = formData.get("name");
    setOptimisticName(name);                    // show instantly
    const res = await fetch(`/api/docs/${doc.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
    return res.ok ? null : "Rename failed";     // optimistic value auto-reverts if this fails
  }, null);

  return (
    <form action={submit}>
      <h3>{optimisticName}</h3>
      <input name="name" defaultValue={doc.name} />
      <SubmitButton />
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
function SubmitButton() {
  const { pending } = useFormStatus();          // reads parent form's pending state
  return <button disabled={pending}>Save</button>;
}
```

---

### Q25. The `use()` API and Server Components

**Short answer:**
- `use(promise)` reads a promise's value inside render (suspends until resolved); `use(Context)` reads context — and `use` can be called conditionally.
- **React Server Components (RSC)** run only on the server (in frameworks like Next.js), can access DB/secrets directly, send zero JS to the browser, and are composed with **Client Components** (`"use client"`). A plain Vite SPA doesn't use RSC by default.

```
Server Component (fetches data, no JS shipped) ──► renders ──► Client Component ("use client", has state/handlers)
```

---

### Q26. React 19.2: `<Activity>` and other recent additions

- **`<Activity mode="hidden">`** — hide part of the UI while **keeping its state** and deferring its updates (e.g., keep a chat tab's scroll and draft while another tab is shown; pre-render a likely next screen).
- **`useEffectEvent`** — see Q18.
- **Performance tracks** in Chrome DevTools showing React scheduler work.
- Other React 19 niceties: `ref` as a prop, `<Context>` as provider, document metadata (`<title>`, `<meta>`) rendered anywhere and hoisted to `<head>`, better hydration error messages.

---

## 5. State management & data fetching

### Q27. How do you organise state in a large app?

**Short answer:** Classify state by **who owns it**, then pick the tool:

| Kind of state | Example | Where it lives |
|---|---|---|
| Local UI | modal open, input draft | `useState` in the component |
| URL | selected doc, filters, page | router search params |
| **Server state** (cached copy of backend data) | document list, user profile | **TanStack Query / SWR / RTK Query** |
| Shared client state | sidebar layout, multi-step wizard | Zustand / Redux Toolkit / context |
| Form state | big forms | React Hook Form / form actions |

**Key insight:** most "global state" is really **server state** and needs caching, deduping, refetching and invalidation — not a hand-rolled Redux store.

---

### Q28. Server state with TanStack Query

```jsx
const { data, isPending, error } = useQuery({
  queryKey: ["documents", tenantId, page],     // cache key — include everything that changes the result
  queryFn: ({ signal }) => api.listDocs(tenantId, page, { signal }),   // auto-abort
  staleTime: 30_000,
});

const qc = useQueryClient();
const rename = useMutation({
  mutationFn: api.renameDoc,
  onSuccess: () => qc.invalidateQueries({ queryKey: ["documents", tenantId] }),
});
```
Gives you caching, dedupe of identical requests, background refetch, retries, cancellation and pagination for free.

---

### Q29. Race conditions in async fetching

**Short answer:** If the user switches from document A to B, A's slow response may arrive after B's and overwrite it. Fix: cancel superseded requests with `AbortController`, or ignore results whose request is no longer current (or use a query library keyed by ID).

```jsx
useEffect(() => {
  const ctrl = new AbortController();
  fetch(`/api/docs/${docId}`, { signal: ctrl.signal })
    .then(r => r.json()).then(setDoc)
    .catch(e => { if (e.name !== "AbortError") setError(e); });
  return () => ctrl.abort();      // runs when docId changes → old request cancelled
}, [docId]);
```

---

### Q30. Optimistic updates

**Short answer:** Show the expected result immediately, send the request, then **confirm or roll back**. Needs a temporary ID and a reconciliation step.

```
user sends message → add {id: "tmp-1", status: "pending"} → POST
   ├─ 201 {id: "m-42"} → replace tmp-1 with m-42, status "sent"
   └─ error           → mark tmp-1 "failed", show Retry
```

---

### Q31. Routing (React Router) basics

- Routes map URL → component tree; nested routes share layouts (`<Outlet/>`).
- Put shareable state (selected document, filters) in the URL so refresh/back button/deep links work.
- Protect routes in the UI for UX, but **the server must still authorise** every request.
- Lazy-load route components to split bundles.

---

## 6. Performance

### Q32. Reconciliation and how component identity affects state

**Short answer:** React compares the new tree with the old by **position + type + key**. Same type at same position → keep state and update. Different type or key → unmount old (state lost), mount new.

```jsx
<Editor key={documentId} doc={doc} />    // changing key = deliberately reset editor state
```

**Pitfall:** defining a component *inside* another component creates a new type every render → its state resets every time.
```jsx
function Parent() { const Child = () => <input/>; return <Child/>; }   // ❌ input loses focus each render
```

---

### Q33. How do you diagnose unnecessary re-renders?

1. **Measure** with React DevTools Profiler ("Highlight updates", flamegraph, "why did this render").
2. Look for: a context whose value changes every render, new object/array/function props each render, state held too high in the tree, expensive work in render.
3. Fix: move state down / split components, memoise value or component, use selectors, virtualise long lists.
4. Re-measure. Don't optimise blindly.

---

### Q34. Rendering long lists and streaming LLM text efficiently

**Short answer:**
- **Virtualise** long lists (only render visible rows) with `@tanstack/react-virtual` or `react-window`.
- For streaming tokens: append to **only the active message**, **batch** updates (e.g., flush every animation frame or ~50 ms), memoise completed messages so they don't re-render, render Markdown incrementally and safely.

```jsx
const bufferRef = useRef("");
function onToken(t) {
  bufferRef.current += t;
  if (!frameRef.current) frameRef.current = requestAnimationFrame(() => {
    setActiveText(prev => prev + bufferRef.current);
    bufferRef.current = ""; frameRef.current = null;
  });
}
```

---

### Q35. Bundle size and load performance

- Code-split routes and heavy widgets (PDF viewer, charts) with `lazy`.
- Tree-shake: import named functions (`import { debounce } from "lodash-es"`).
- Analyse the bundle (`rollup-plugin-visualizer` with Vite).
- Optimise images, preload critical fonts, measure **Core Web Vitals** (LCP, INP, CLS).

---

## 7. Security, testing, accessibility

### Q36. Preventing XSS, especially with LLM output

**Short answer:** React escapes strings in JSX by default — `{text}` is safe. Danger comes from `dangerouslySetInnerHTML`, `javascript:` URLs in `href`, and Markdown/HTML renderers. Treat **all model output and retrieved documents as untrusted**.

```jsx
<div>{llmText}</div>                                       // ✅ escaped
<div dangerouslySetInnerHTML={{ __html: llmHtml }} />      // ❌ unless sanitised
import DOMPurify from "dompurify";
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(llmHtml) }} />   // sanitised
<ReactMarkdown>{llmText}</ReactMarkdown>                   // react-markdown: no raw HTML by default
```
Also: validate link protocols (`http/https` only), set a **Content Security Policy**, and never put secrets in frontend code (everything in the bundle is public — including `VITE_*` env vars).

---

### Q37. Authentication vs authorisation in a React app

**Short answer:** **Authentication** = who you are (login, token). **Authorisation** = what you may do. The frontend uses auth state only for **UX** (hide buttons, redirect). The **server must enforce** authorisation on every request, because users can edit JS or call the API directly.

**Token storage:** HttpOnly, Secure, SameSite cookies protect tokens from XSS-based theft (need CSRF protection); in-memory tokens + refresh flow are another option. Avoid long-lived tokens in `localStorage`.

---

### Q38. Testing React at multiple layers

| Layer | Tool | What to test |
|---|---|---|
| Pure logic | Vitest | reducers, formatters, validators |
| Components & flows | **React Testing Library** + **MSW** (mock HTTP) | user-visible behaviour: "click upload → shows progress → shows retry on 500" |
| End-to-end | Playwright / Cypress | login, upload, streaming, reconnect against a real-ish backend |

```jsx
test("shows retry when upload fails", async () => {
  server.use(http.post("/api/upload", () => new HttpResponse(null, { status: 500 })));
  render(<Uploader />);
  await userEvent.upload(screen.getByLabelText(/file/i), new File(["x"], "a.pdf"));
  expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
});
```
**Principle:** test what the user sees (roles, labels, text), not implementation details (internal state, class names).

---

### Q39. Accessibility basics

- Use semantic elements (`<button>`, `<nav>`, `<label htmlFor>`), not clickable `<div>`s.
- Every input has a label; images have `alt`.
- Keyboard navigation and visible focus; manage focus when opening modals.
- Announce streaming/async updates with `aria-live="polite"` regions.
- Check colour contrast; test with axe / Lighthouse.

---

### Q40. Environment variables and config in a React SPA

All config embedded in the bundle is **public**. Use build-time env vars only for non-secret values (API base URL, feature flags). Secrets (API keys) must stay on the server — the browser calls your backend, which calls the LLM.

---

## 8. Scenario & debugging questions

### Q41. A chat view shows messages from the previous session after switching. What do you inspect?

1. **Effect cleanup** — is the old SSE/WebSocket aborted when `sessionId` changes?
2. **Cache keys** — does the query key include `sessionId` (and tenant/user)?
3. **Local state reset** — use `key={sessionId}` on the chat panel to reset drafts.
4. **Event routing** — tag stream events with session ID and drop mismatches.
5. **Backend** — verify the server authorises session ownership; if another *user's* data appears, it's a **security incident**, not a UI bug.

---

### Q42. Design a UI for a long-running job (e.g., document extraction)

```
 states: queued → running(progress %) → partial → succeeded
                       │                    └─► failed (retry) / cancelled
 ┌──────────── React ────────────┐        ┌──────── Backend ────────┐
 │ POST /jobs → {jobId}           │ ─────► │ persists job in DB       │
 │ subscribe SSE /jobs/{id}/events│ ◄───── │ emits progress events    │
 │   (with Last-Event-ID resume)  │        │ with event ids           │
 │ fallback: poll GET /jobs/{id}  │        │                          │
 │ on reload: GET /jobs/{id}      │ ◄───── │ server is source of truth│
 └────────────────────────────────┘        └──────────────────────────┘
```
Key points: explicit state machine, server-authoritative state, reconnect/resume, idempotent cancel, clear error and retry UX.

---

### Q43. A page re-renders the whole app on every streamed token. Fix?

Profile → token state lives in a top-level context → every consumer re-renders. Move token state into the active message component or a store with selectors, batch token updates per animation frame, memoise finished messages, virtualise the transcript.

---

### Q44. Users report the app is "frozen" while typing in a filter over 10k rows

Rendering 10k rows on every keystroke blocks the main thread. Fixes in order: virtualise the list, `useDeferredValue` for the filter value, `useMemo` the filtering, move filtering to the server with debounced queries if data is larger.

---

### Q45. What do you check in a frontend PR before release?

Correct state ownership (no duplicated state), effects have cleanup and correct deps, loading/empty/error states, request cancellation, XSS-safe rendering of model output, no secrets in bundle, accessibility, code splitting for heavy components, tests for main user flows and failure paths, monitoring (error reporting, web vitals).

---

## 9. React with TypeScript

### Q46. How do you type React components, state and events?

**Short answer:** Type **props** with a `type`/`interface`, let TypeScript **infer** most state, add generics only when inference can't (e.g. `null` initial value), and model UI states as **discriminated unions** so impossible states can't be represented.

```tsx
type ButtonProps = {
  label: string;
  variant?: "primary" | "danger";              // union of allowed strings
  onClick: () => void;
} & React.ComponentProps<"button">;              // also accept native <button> props

export function Button({ label, variant = "primary", ...rest }: ButtonProps) {
  return <button className={variant} {...rest}>{label}</button>;
}

type CardProps = { title: string; children: React.ReactNode };   // anything renderable

const [count, setCount] = useState(0);                    // inferred number
const [user, setUser] = useState<User | null>(null);      // explicit: starts null

function onChange(e: React.ChangeEvent<HTMLInputElement>) { setQuery(e.target.value); }
const inputRef = useRef<HTMLInputElement>(null);
```

**Discriminated union for async state** (no "loading AND error at the same time" bugs):
```tsx
type JobState =
  | { status: "idle" }
  | { status: "running"; progress: number }
  | { status: "done"; resultUrl: string }
  | { status: "failed"; error: string };

function JobView({ job }: { job: JobState }) {
  switch (job.status) {
    case "running": return <Progress value={job.progress} />;       // TS knows progress exists
    case "done":    return <a href={job.resultUrl}>Download</a>;
    case "failed":  return <ErrorBox msg={job.error} />;
    default:        return null;
  }
}
```

**Generic component:**
```tsx
type ListProps<T> = { items: T[]; render: (item: T) => React.ReactNode; getKey: (item: T) => string };
function List<T>({ items, render, getKey }: ListProps<T>) {
  return <ul>{items.map(i => <li key={getKey(i)}>{render(i)}</li>)}</ul>;
}
```

**API types end to end:** generate TypeScript types from the FastAPI OpenAPI schema (e.g. `openapi-typescript`) so frontend and backend can't drift; validate untrusted runtime data (e.g. with Zod) because TS types vanish at runtime.

**Pitfalls:** `any` switches checking off (use `unknown` and narrow); `React.FC` is optional and no longer adds `children` implicitly; Vite only strips types (esbuild/Oxc) — run `tsc --noEmit` in CI for type errors (03 Q08).

---

## 10. Cheat sheet

| Concept | Remember |
|---|---|
| TS + React | type props; infer state; discriminated unions for UI states; `unknown` not `any` |
| UI = f(state) | describe, don't mutate DOM |
| Render vs commit | render pure; side effects in handlers/effects |
| `setState` | schedules re-render; snapshot; use updater `c => c + 1` |
| Immutability | new object/array for every update |
| Keys | stable IDs, not index |
| Hooks order | top level only, same order each render |
| `useEffect` | sync with external system; always clean up |
| Not an effect | derived values, event logic, reset via `key` |
| `useRef` | mutable, no re-render; DOM handles |
| Memo hooks | perf only; React Compiler can automate |
| Context | low-frequency values; split/memoise |
| Server state | TanStack Query, not hand-rolled global store |
| Races | `AbortController` / query keys |
| React 19 | Actions, `useActionState`, `useOptimistic`, `use`, ref-as-prop |
| React 19.2 | `<Activity>`, `useEffectEvent` |
| Error boundary | render errors only, not async/events |
| XSS | `{}` escapes; sanitise `dangerouslySetInnerHTML`; LLM output untrusted |
| Security | UI hides; **server authorises** |

## Official references

- https://react.dev/learn · https://react.dev/reference/react
- https://react.dev/learn/you-might-not-need-an-effect
- https://react.dev/blog (React 19, 19.2, React Compiler 1.0)
- https://tanstack.com/query/latest · https://testing-library.com/docs/react-testing-library/intro
