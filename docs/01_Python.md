# Python: Interview Preparation

> **Updated:** 24 October 2026 · **Level:** basics → internals → production engineering
> **How to use:** Read the *Short answer* first and say it aloud (that is your 30-second interview reply). Then read *Explanation* and *Example* to understand **why**. *Pitfall / Follow-up* lists what interviewers push on next.

---

## Table of contents

1. [Mental model: how Python runs your code](#1-mental-model-how-python-runs-your-code)
2. [Core data types & memory](#2-core-data-types--memory) (Q01–Q08)
3. [Functions, scope, closures, decorators](#3-functions-scope-closures-decorators) (Q09–Q15)
4. [OOP: classes, dunder methods, inheritance](#4-oop-classes-dunder-methods-inheritance) (Q16–Q22)
5. [Iterators, generators, context managers, errors](#5-iterators-generators-context-managers-errors) (Q23–Q27)
6. [Typing & data modelling](#6-typing--data-modelling) (Q28–Q30)
7. [Concurrency: threads, processes, asyncio, GIL](#7-concurrency-threads-processes-asyncio-gil) (Q31–Q37)
8. [Packaging, testing, tooling](#8-packaging-testing-tooling) (Q38–Q41)
9. [Production engineering](#9-production-engineering) (Q42–Q48)
10. [Scenario & debugging questions](#10-scenario--debugging-questions) (Q49–Q52)
11. [Cheat sheet](#11-cheat-sheet)

---

## 1. Mental model: how Python runs your code

```
  your_app.py
      │  (1) compile
      ▼
  ┌──────────────┐     cached as __pycache__/your_app.cpython-314.pyc
  │  Bytecode    │
  └──────┬───────┘
         │  (2) execute
         ▼
  ┌──────────────────────────────────────────────────────────┐
  │  CPython interpreter (the "VM")                           │
  │                                                          │
  │   Frame stack (one frame per function call)               │
  │   ┌────────────┐                                         │
  │   │ locals     │ ──► names are just LABELS pointing to    │
  │   │ globals    │     objects living on the heap           │
  │   └────────────┘                                         │
  │                                                          │
  │   Heap:  [list obj]  [int obj 42]  [str obj "hi"]         │
  │          each object has: type, value, reference count    │
  │                                                          │
  │   Memory mgmt: reference counting (+ cyclic GC for loops) │
  │   GIL: one thread runs Python bytecode at a time          │
  │        (removed in the optional "free-threaded" build)    │
  └──────────────────────────────────────────────────────────┘
```

Three ideas explain most "tricky" Python questions:

1. **Names are labels, not boxes.** `a = [1]` creates a list object and sticks label `a` on it. `b = a` sticks a second label on the *same* object.
2. **Everything is an object** — ints, functions, classes, modules. Each has a type and an identity (`id()`).
3. **Mutable vs immutable** decides whether "changing" a value modifies the object or creates a new one.

**Recent versions worth knowing (say "I'd check the exact version in our stack"):**

| Version | Notable for interviews |
|---|---|
| 3.10 | `match` statement (structural pattern matching), `X | Y` union types |
| 3.11 | 10–60% faster interpreter, `ExceptionGroup` / `except*`, `asyncio.TaskGroup` |
| 3.12 | New generic syntax `def f[T](x: T) -> T`, `type` alias statement, better f-strings |
| 3.13 | Experimental **free-threaded build** (no GIL), experimental JIT, new REPL |
| 3.14 | Free-threading officially supported (still optional build), template strings (`t"..."`), deferred evaluation of annotations, `concurrent.interpreters` |
| 3.15 | Explicit lazy imports (`lazy import x`, PEP 810) — faster startup |

---

## 2. Core data types & memory

### Q01. Difference between list, tuple, set and dict?

**Short answer:** List = ordered, mutable sequence. Tuple = ordered, immutable sequence. Set = unordered collection of unique hashable items. Dict = mapping of unique hashable keys to values (keeps insertion order since 3.7).

```flow
pipeline: Picking the right built-in collection
Need order + duplicates + changes? > list.
Fixed record, hashable, can be a dict key? > tuple.
Fast membership test, unique items? > set: O(1) `in` instead of O(n) for a list.
Look up values by key? > dict: O(1) average get/set, keeps insertion order.
```

**Explanation:** Sets and dicts are **hash tables**: Python computes `hash(key)` to jump directly to a slot, so lookup is O(1) on average. A list must scan item by item, O(n).

| Type | Ordered | Mutable | Duplicates | Lookup `x in c` | Typical use |
|---|---|---|---|---|---|
| `list` | ✅ | ✅ | ✅ | O(n) | sequence of results |
| `tuple` | ✅ | ❌ | ✅ | O(n) | fixed record, dict key |
| `set` | ❌ | ✅ | ❌ | O(1) avg | dedupe, membership |
| `dict` | ✅ (insertion) | ✅ | keys ❌ | O(1) avg | index by ID |

**Example:**
```python
doc_ids = ["a1", "b2", "a1"]
unique = set(doc_ids)                 # {'a1', 'b2'}  – dedupe
point = (12.5, 77.6)                  # tuple: fixed coordinates, can be a dict key
status = {"job-1": "DONE", "job-2": "RUNNING"}
if "job-1" in status:                 # O(1) – no scan
    print(status["job-1"])
```

**Pitfall / Follow-up:** "Why can't a list be a dict key?" → keys must be **hashable**; a mutable list could change after insertion, breaking its hash slot. A tuple is hashable only if all its items are hashable (`(1, [2])` is not).

---

### Q02. Mutable vs immutable objects and aliasing

**Short answer:** Mutable objects (list, dict, set, custom objects) can change in place; immutable ones (int, float, str, tuple, frozenset) cannot — "changing" them creates a new object. Two names pointing to the same mutable object are **aliases**; a change via one is visible via the other.

```flow
trace: Aliasing: two names, one object
a = [1]          →  a ──► **[1]** > One list object on the heap; `a` is a label pointing at it.
b = a            →  a, b ──► **[1]** > Assignment copies the reference, not the list. Both names point at the same object.
b.append(2)      →  a, b ──► **[1, 2]** > Mutating through `b` changes the one shared object, so `a` sees it too.
x = "a"; y = x   →  x, y ──► **"a"** > Same idea with a string: two names, one object.
y += "b"         →  x ──► "a",  y ──► **"ab"** > Strings are immutable, so `+=` builds a NEW object and rebinds `y`. `x` is untouched.
```

**Explanation:**
```
a = [1]          b = a            b.append(2)
a ──► [1]        a ──┐            a ──┐
                 b ──┴► [1]       b ──┴► [1, 2]     ← both see the change

x = "a"          y = x            y += "b"
x ──► "a"        x ──┐            x ──► "a"
                 y ──┴► "a"       y ──► "ab"        ← new object, x untouched
```

**Example:**
```python
config = {"retries": 3}
per_request = config            # alias, NOT a copy
per_request["retries"] = 0      # oops: global config now has retries=0
```

**Pitfall:** Shared mutable state across requests (module-level dicts, class attributes) is a classic production bug in FastAPI/Lambda where the process is reused.

---

### Q03. Why are mutable default arguments dangerous?

**Short answer:** Default values are evaluated **once, when the function is defined**, not on every call. A list default is the same list object shared by every call.

```flow
trace: The shared mutable default
def add(x, items=[]) > At definition time Python evaluates `[]` once and stores that single list on the function (`add.__defaults__`).
add(1)  →  items is the default list  →  **[1]** > First call appends to the shared default list.
add(2)  →  same default list  →  **[1, 2]** > Second call gets the SAME list, which still holds 1. The surprise bug.
Fix: items=None; if items is None: items = [] > A fresh list is created inside the function on every call.
```

**Example:**
```python
def add_tag(tag, tags=[]):       # ❌ one list shared forever
    tags.append(tag)
    return tags

add_tag("a")   # ['a']
add_tag("b")   # ['a', 'b']  ← surprise! leaked from previous call

def add_tag(tag, tags=None):     # ✅ sentinel pattern
    if tags is None:
        tags = []
    tags.append(tag)
    return tags
```

**Why it matters:** In a web server this leaks one user's data into another user's response.

---

### Q04. `is` vs `==`, shallow copy vs deep copy

**Short answer:** `==` compares **values** (calls `__eq__`); `is` compares **identity** (same object in memory). A shallow copy creates a new outer container but shares inner objects; a deep copy recursively copies everything.

```flow
trace: Shallow vs deep copy
orig = [[1, 2], [3]] > A list containing two inner lists.
s = copy.copy(orig)   →  new outer list, **same inner lists** > Shallow copy: only the outer container is new.
s[0].append(9)        →  orig == **[[1, 2, 9], [3]]** > Changing an inner list through the copy also changes the original.
d = copy.deepcopy(orig)  →  new outer **and new inner lists** > Deep copy recursively copies everything it contains.
d[0].append(7)        →  orig unchanged > Fully independent. Slower and uses more memory.
```

**Example:**
```python
import copy
state = {"user": "u1", "messages": [{"role": "user", "text": "hi"}]}

shallow = state.copy()          # or dict(state), copy.copy(state)
shallow["messages"].append("x") # ❌ also changes state["messages"]

deep = copy.deepcopy(state)
deep["messages"].append("y")    # ✅ original untouched

a = [1, 2]; b = [1, 2]
a == b   # True  (same values)
a is b   # False (different objects)
x is None  # ✅ correct way to test for None (None is a singleton)
```

**Pitfall:** Small ints (-5..256) and some strings are cached, so `a is b` may be `True` for them by accident — never use `is` for value comparison.

---

### Q05. How are arguments passed in Python?

**Short answer:** "Pass by object reference" (also called pass-by-assignment). The function receives a reference to the same object. Mutating it affects the caller; **rebinding** the parameter name does not.

```flow
trace: Pass by object reference
nums = [1]; f(nums) > The parameter `x` inside `f` becomes a second label for the same list object.
x.append(2)   →  caller sees **[1, 2]** > Mutating the object is visible to the caller, because it's the same object.
x = [99]      →  caller still sees [1, 2] > Rebinding only moves the local label to a new object. The caller's name is unaffected.
```

**Example:**
```python
def mutate(items):  items.append(3)      # caller sees [1, 2, 3]
def rebind(items):  items = [99]         # caller unaffected – only local label moved

nums = [1, 2]
mutate(nums); rebind(nums)
print(nums)   # [1, 2, 3]
```

---

### Q06. How does hashing work and what makes an object hashable?

**Short answer:** An object is hashable if it has a `__hash__` that never changes during its lifetime and an `__eq__` consistent with it (equal objects → equal hashes). Dicts/sets use the hash to pick a bucket, then `__eq__` to confirm.

```flow
pipeline: How a dict / set finds a key
hash(key) > `__hash__` turns the key into an integer.
Pick a bucket > The hash (modulo table size) chooses a slot in the internal table. This is why lookup is O(1) on average.
Compare with __eq__ > Several keys can share a slot (a collision), so Python compares with `==` to find the exact key.
Found / not found > Mutable objects like lists can't be keys: if their contents (and hash) changed after insertion, they'd sit in the wrong bucket.
```

**Example:**
```python
from dataclasses import dataclass

@dataclass(frozen=True)          # frozen → immutable → auto __hash__
class DocKey:
    tenant: str
    doc_id: str

cache = {DocKey("t1", "d9"): "summary..."}
```

**Pitfall:** If you override `__eq__` in a class without defining `__hash__`, Python sets `__hash__ = None` → instances become unhashable.

---

### Q07. Comprehensions vs generator expressions

**Short answer:** List/set/dict comprehensions build the whole collection **eagerly** in memory. A generator expression `( ... )` produces items **lazily**, one at a time, using constant memory.

```flow
trace: Eager list vs lazy generator
[x*x for x in range(5)]  →  **[0, 1, 4, 9, 16]** built now > A list comprehension computes everything up front and holds it all in memory.
g = (x*x for x in range(5))  →  nothing computed yet > A generator expression only stores how to produce the next value.
next(g)  →  **0** > Values are produced one at a time, on demand.
next(g)  →  **1** > Memory stays constant however long the sequence is.
… after the last value  →  **StopIteration** > A generator can be consumed only once.
```

**Example:**
```python
squares = [x * x for x in range(5)]            # [0, 1, 4, 9, 16]
evens   = {x for x in range(10) if x % 2 == 0} # set comprehension
by_id   = {d["id"]: d for d in docs}           # dict comprehension

total = sum(x * x for x in range(10_000_000))  # generator: no 10M-item list
```

**When to use which:** Need to iterate more than once or index? → list. Only stream once (sum, any, write to file)? → generator.

---

### Q08. How does Python manage memory (refcounting and GC)?

**Short answer:** CPython frees an object as soon as its **reference count** drops to zero. A separate **cyclic garbage collector** periodically finds groups of objects that reference each other but are unreachable (cycles) and frees them.

```flow
trace: Reference counting, and the cycle it can't free
a = Obj()           refcount(Obj) = **1** > One name refers to the object.
b = a               refcount = **2** > Every new reference increases the count.
del a; del b        refcount = **0**  →  freed immediately > CPython frees the object the moment the count hits zero.
x.peer = y; y.peer = x; del x, y   →  counts stay **1** > A reference cycle: each object keeps the other alive, so refcounting alone never frees them.
Cyclic GC runs  →  finds unreachable cycle  →  **freed** > The generational garbage collector periodically detects groups that nothing outside refers to.
```

**Explanation:**
```
a = Node(); b = Node()
a.other = b; b.other = a     # cycle: refcounts never reach 0
del a, b                     # refcounting can't free them
                             # → cyclic GC (module `gc`) cleans up later
```

**Follow-ups:**
- `sys.getrefcount(obj)` shows refcount; `gc.collect()` forces collection.
- `weakref` lets you reference an object **without** keeping it alive (good for caches/observers).
- `__slots__` removes the per-instance `__dict__` → much less memory for millions of small objects.

```python
class Point:
    __slots__ = ("x", "y")   # no __dict__, fixed attributes, ~40-50% less memory
    def __init__(self, x, y): self.x, self.y = x, y
```

---

## 3. Functions, scope, closures, decorators

### Q09. `*args` and `**kwargs`, keyword-only and positional-only parameters

**Short answer:** `*args` collects extra positional arguments into a tuple; `**kwargs` collects extra keyword arguments into a dict. Parameters after `*` are keyword-only; parameters before `/` are positional-only.

```flow
trace: How arguments bind to parameters
def f(a, /, b, *args, c, **kwargs) > a positional-only, b either, c keyword-only.
f(1, 2, 3, 4, c=5, d=6) > The call.
a=**1**, b=**2** > Positional slots filled first.
args=**(3, 4)** > Extra positionals collected into a tuple.
c=**5**, kwargs=**{"d": 6}** > c must be passed by name; unknown keywords go to the dict.
```

**Example:**
```python
def call_tool(name, /, *args, timeout=10, **kwargs):
    # name  -> positional-only (can't call call_tool(name="x"))
    # timeout -> keyword-only
    print(name, args, timeout, kwargs)

call_tool("search", "q1", "q2", timeout=5, user="u1")
# search ('q1', 'q2') 5 {'user': 'u1'}

def f(a, b): ...
f(*[1, 2]); f(**{"a": 1, "b": 2})   # unpacking at call site
```

**Why it matters:** Keyword-only arguments make APIs safer: `send(email, dry_run=True)` can't be misread as `send(email, True)`.

---

### Q10. LEGB scope, `global` and `nonlocal`

**Short answer:** Name lookup order is **L**ocal → **E**nclosing function → **G**lobal (module) → **B**uiltins. Assigning to a name makes it local unless declared `global` (module level) or `nonlocal` (enclosing function).

```flow
pipeline: LEGB: where Python looks up a name
Local > Names assigned inside the current function.
Enclosing > Names in any outer function (closures). Rebinding one needs `nonlocal`.
Global > Module-level names. Rebinding one inside a function needs `global`.
Built-ins > `len`, `print`, `Exception`… Not found anywhere → `NameError`.
```

**Example:**
```python
count = 0                     # Global
def outer():
    total = 0                 # Enclosing
    def inner():
        nonlocal total        # rebind the enclosing variable
        total += 1
        return len("abc")     # len → Builtins
    inner(); return total
```

**Pitfall:** `UnboundLocalError` — `x += 1` inside a function where `x` is global without `global x`.

---

### Q11. What is a closure? What is the late-binding trap?

**Short answer:** A closure is an inner function that **remembers variables from its enclosing scope** even after the outer function has returned. Python closures capture the *variable*, not its value at creation time, so loops can surprise you.

```flow
trace: The late-binding closure trap
fns = [lambda: i for i in range(3)] > Three closures are created. Each captures the VARIABLE `i`, not its value at that moment.
loop ends  →  i == **2** > By the time anyone calls the lambdas, the loop has finished.
[f() for f in fns]  →  **[2, 2, 2]** > Every closure reads the same `i`, which is now 2.
lambda i=i: i  →  **[0, 1, 2]** > Fix: a default argument is evaluated immediately, freezing the current value.
```

**Example:**
```python
def make_retry(limit):
    def should_retry(attempt):
        return attempt < limit      # 'limit' remembered
    return should_retry

retry3 = make_retry(3); retry3(2)  # True

# Late-binding trap
funcs = [lambda: i for i in range(3)]
[f() for f in funcs]                # [2, 2, 2]  ← all see final i
funcs = [lambda i=i: i for i in range(3)]
[f() for f in funcs]                # [0, 1, 2]  ← default arg freezes value
```

---

### Q12. How do decorators work? Write one with arguments.

**Short answer:** A decorator is a function that takes a function and returns a new function (usually a wrapper). `@deco` above `def f` is just `f = deco(f)`. Use `functools.wraps` to keep the original name/docstring.

**Explanation:**
```flow
pipeline: What happens when you call a decorated function
Caller calls fetch() > `fetch` is now the wrapper: `@timed` ran `fetch = timed(fetch)` once, at definition time.
wrapper(*args, **kwargs) > The wrapper receives the original arguments unchanged.
Before logic > Runs first: start a timer, check auth, open a span, log the call.
Original fetch() > The wrapper calls the real function it captured in its closure.
After logic > Runs after (in `finally` if it must always run): stop timer, log duration.
Result returned > The caller gets the original return value; `functools.wraps` keeps the name and docstring.
```

```
@timed            ≡    def fetch(...): ...
def fetch(...):        fetch = timed(fetch)

caller ──► wrapper(*args) ──► [before logic] ──► original fetch() ──► [after logic] ──► result
```

**Example (decorator with arguments = 3 levels):**
```python
import functools, time, random

def retry(times=3, exceptions=(TimeoutError,)):
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(1, times + 1):
                try:
                    return func(*args, **kwargs)
                except exceptions:
                    if attempt == times:
                        raise
                    time.sleep((2 ** attempt) + random.random())  # backoff + jitter
        return wrapper
    return decorator

@retry(times=4)
def call_llm(prompt): ...
```

**Follow-up:** Async functions need an `async def wrapper` that `await`s `func`.

---

### Q13. `lambda`, `map`, `filter`, `sorted(key=...)`, `functools`

**Short answer:** `lambda` is an anonymous single-expression function. `map`/`filter` return lazy iterators. `sorted(iterable, key=fn)` sorts by a computed key and is **stable**. `functools` provides `lru_cache`/`cache`, `partial`, `reduce`, `wraps`, `cached_property`.

```flow
trace: sorted with a key, and lazy map/filter
sorted(users, key=lambda u: u.age) > key is computed once per item, then items are compared by it.
ages [31, 25, 31] → order **25, 31, 31** (ties keep original order) > Python's sort is stable.
map(str.upper, names) → lazy iterator > Nothing computed until you iterate.
list(...) → **["ASHA", "RAVI"]** > Comprehensions are usually clearer than map/filter with lambdas.
```

**Example:**
```python
from functools import lru_cache, partial
jobs = [{"id": 2, "p": 1}, {"id": 1, "p": 1}, {"id": 3, "p": 0}]
sorted(jobs, key=lambda j: (-j["p"], j["id"]))   # priority desc, then id asc

@lru_cache(maxsize=1024)          # memoise pure, hashable-argument function
def get_schema(table: str): ...

log_error = partial(print, "[ERROR]")   # pre-fill arguments
log_error("disk full")                  # [ERROR] disk full
```

**Pitfall:** `lru_cache` on a method caches `self` too → objects never freed. Unbounded `@cache` in a long-running service = memory leak.

---

### Q14. Useful built-ins: `enumerate`, `zip`, `any/all`, unpacking, walrus, `match`

**Example:**
```python
for i, name in enumerate(["a", "b"], start=1): ...
for q, a in zip(questions, answers, strict=True): ...   # strict: error if lengths differ
any(d["error"] for d in results)                       # short-circuits
first, *rest = [1, 2, 3]                               # first=1, rest=[2,3]

while (chunk := f.read(4096)):        # walrus: assign + test in one expression
    process(chunk)

match event:                          # structural pattern matching (3.10+)
    case {"type": "token", "text": t}:  emit(t)
    case {"type": "tool_call", "name": n, **rest}: run_tool(n, rest)
    case _: log.warning("unknown event")
```

---

### Q15. Modules, packages, imports and `if __name__ == "__main__"`

**Short answer:** A module is a `.py` file; a package is a directory of modules (usually with `__init__.py`). A module's top-level code runs **once** on first import and is cached in `sys.modules`. `__name__ == "__main__"` is true only when the file is run directly.

```flow
pipeline: What `import mymod` does
Check sys.modules > Already imported? Reuse the cached module object. This is why top-level code runs only once.
Find it on sys.path > Search the script's folder, installed packages and so on, for a module or package.
Create module object > A fresh namespace for the module.
Run its top-level code > Definitions, constants and any side effects run now, with `__name__` set to "mymod".
Bind the name > `mymod` is now available in the importing file. When run directly, a file gets `__name__ == "__main__"`, which is why the main guard works.
```

**Example:**
```python
# app/main.py
def main(): ...
if __name__ == "__main__":   # runs for `python -m app.main`, not for `import app.main`
    main()
```

**Follow-ups:** Circular imports (A imports B imports A) → move shared code into a third module or import inside the function. Python 3.15 adds `lazy import heavy_lib` to defer loading until first use — useful for CLI/Lambda cold-start time.

---

## 4. OOP: classes, dunder methods, inheritance

### Q16. Class vs instance attributes; `self`

**Short answer:** Class attributes are shared by all instances; instance attributes live in each object's `__dict__`. `self` is just the instance passed automatically as the first argument.

```flow
trace: Attribute lookup: instance first, then class
class Job: retries = 3 > Class attribute, shared.
j = Job();  j.retries  →  **3** (found on the class) > The instance has no own value yet.
j.retries = 5  →  j.__dict__ = {retries: 5} > Assignment creates an INSTANCE attribute that shadows the class one.
Job.retries still **3**;  other instances still 3 > Pitfall: a mutable class attribute (a list) is shared by every instance.
```

**Example:**
```python
class Agent:
    registry = []                  # class attribute – SHARED
    def __init__(self, name):
        self.name = name           # instance attribute
        self.tools = []            # ✅ per-instance list
        Agent.registry.append(name)
```

**Pitfall:** `tools = []` at class level would be shared by every Agent (same bug as mutable defaults).

---

### Q17. `@staticmethod`, `@classmethod`, `@property`

**Short answer:**
- **Instance method** — gets `self`, works on one object.
- **`@classmethod`** — gets `cls`; used for alternative constructors and respects subclasses.
- **`@staticmethod`** — gets nothing; a plain function grouped in the class namespace.
- **`@property`** — exposes a method as an attribute, enabling validation or computed values without changing the public API.

```flow
pipeline: What each method kind receives
Instance method > `self`: works on one object's data.
@classmethod > `cls`: alternative constructors (`from_json`), respects subclasses.
@staticmethod > Nothing implicit: a plain function namespaced in the class.
@property > Called like an attribute: computed or validated access.
```

**Example:**
```python
class Money:
    def __init__(self, cents: int): self._cents = cents

    @classmethod
    def from_str(cls, s: str) -> "Money":     # Money.from_str("12.50")
        return cls(round(float(s) * 100))

    @staticmethod
    def is_valid(s: str) -> bool:
        return s.replace(".", "", 1).isdigit()

    @property
    def dollars(self) -> float:                # m.dollars (no parentheses)
        return self._cents / 100

    @dollars.setter
    def dollars(self, v: float):
        if v < 0: raise ValueError("negative")
        self._cents = round(v * 100)
```

---

### Q18. What are dunder (magic) methods? Name important ones.

**Short answer:** Special `__name__` methods let your objects plug into Python syntax and built-ins.

```flow
trace: Operators call dunder methods
a + b  →  a.__add__(b) > If it returns NotImplemented, Python tries b.__radd__(a).
len(x)  →  x.__len__() > Built-ins delegate to dunders.
x == y  →  x.__eq__(y);  hash(x) → x.__hash__() > Keep __eq__ and __hash__ consistent.
for i in x  →  iter(x) → x.__iter__() > Your objects plug into Python syntax this way.
```

| Want this to work | Implement |
|---|---|
| `print(obj)`, logs | `__str__` (friendly), `__repr__` (unambiguous, for devs) |
| `a == b`, `a < b` | `__eq__`, `__lt__` (or `functools.total_ordering`) |
| `len(x)`, `x[i]`, `for i in x` | `__len__`, `__getitem__`, `__iter__` |
| `x in c` | `__contains__` |
| `obj()` | `__call__` |
| `with obj:` | `__enter__`, `__exit__` |
| `hash(obj)`, dict key | `__hash__` |
| `a + b` | `__add__` |

**Example:**
```python
class Batch:
    def __init__(self, items): self.items = list(items)
    def __len__(self): return len(self.items)
    def __iter__(self): return iter(self.items)
    def __repr__(self): return f"Batch(n={len(self)})"
```

---

### Q19. Inheritance, `super()` and MRO

**Short answer:** A subclass inherits behaviour and can override it. `super()` calls the **next class in the Method Resolution Order (MRO)**, not necessarily the direct parent. Python computes MRO with the C3 linearization algorithm; inspect it with `Cls.__mro__`.

```flow
pipeline: super() follows the MRO, not the parent
class D(B, C) > B and C both inherit from A (a "diamond").
D.__mro__ = D → B → C → A → object > C3 linearisation: each class appears once, children before parents, in base-class order.
D().send() calls super() > In D, `super()` means "the next class in D's MRO": B.
B.send() calls super() > The next class after B in D's MRO is **C**, not A, even though B's parent is A.
C → A > Each class runs once, which is why cooperative `super()` chains work.
```

**Explanation (diamond):**
```
        Base
       /    \
   LogMixin  RetryMixin
       \    /
       Client          Client.__mro__ = (Client, LogMixin, RetryMixin, Base, object)
```
Each class calling `super().send()` passes the call along this chain, so every mixin runs **once**.

**Example:**
```python
class Base:
    def send(self, msg): print("send", msg)
class LogMixin(Base):
    def send(self, msg): print("log"); super().send(msg)
class RetryMixin(Base):
    def send(self, msg): print("retry-wrap"); super().send(msg)
class Client(LogMixin, RetryMixin): pass

Client().send("hi")   # log → retry-wrap → send hi
```

**Interview tip:** Prefer **composition** ("has-a") over deep inheritance ("is-a") for business logic — easier to test and change.

---

### Q20. Abstract base classes vs Protocols (duck typing)

**Short answer:** An `ABC` with `@abstractmethod` forces subclasses to implement methods (**nominal** typing: you must inherit). A `typing.Protocol` describes the required methods; any class with matching methods satisfies it without inheriting (**structural** typing — formal duck typing).

**Example:**
```python
from abc import ABC, abstractmethod
from typing import Protocol

class Storage(ABC):
    @abstractmethod
    def put(self, key: str, data: bytes) -> None: ...

class DocumentStore(Protocol):            # no inheritance needed
    def get(self, key: str) -> bytes: ...

class S3Store:                            # satisfies DocumentStore automatically
    def get(self, key: str) -> bytes: ...

def summarize(store: DocumentStore, key: str): ...   # mypy checks shape
```

---

### Q21. Dataclasses — what do they generate?

**Short answer:** `@dataclass` auto-generates `__init__`, `__repr__`, `__eq__` (and optionally ordering, hashing, immutability) from annotated fields. Options: `frozen=True` (immutable), `slots=True` (memory), `kw_only=True`, `field(default_factory=list)` for mutable defaults.

```flow
pipeline: What @dataclass generates
Read annotated fields > id: str, total: float = 0.0.
__init__ > Assigns each field, with defaults.
__repr__ + __eq__ > Readable printing, field-by-field equality.
Options > frozen=True (immutable + hashable), order=True, slots=True, kw_only=True.
```

**Example:**
```python
from dataclasses import dataclass, field

@dataclass(slots=True)
class Job:
    id: str
    status: str = "PENDING"
    pages: list[int] = field(default_factory=list)   # ✅ not `= []`
```

---

### Q22. What are descriptors and metaclasses (high level)?

**Short answer:**
- A **descriptor** is an object with `__get__`/`__set__` that controls attribute access on another class. `property`, `classmethod`, `staticmethod` and ORM fields (SQLAlchemy columns) are descriptors.
- A **metaclass** is "the class of a class" — it customises class *creation*. Used by frameworks (Pydantic, Django ORM, Enum). Rarely needed in application code; prefer `__init_subclass__` or decorators.

```flow
pipeline: How obj.attr is resolved (descriptors)
Data descriptor on the class? > `property` or a class with __get__ + __set__ wins first.
Instance __dict__? > The object's own attributes.
Non-data descriptor / class attribute? > Methods (functions are descriptors), classmethod, plain values.
__getattr__? > Last resort, then AttributeError. Metaclasses go one level up: they customise how the class itself is created.
```

```python
class Plugin:
    registry = {}
    def __init_subclass__(cls, name, **kw):   # runs when a subclass is defined
        super().__init_subclass__(**kw)
        Plugin.registry[name] = cls

class PdfParser(Plugin, name="pdf"): ...
Plugin.registry   # {'pdf': PdfParser}
```

---

## 5. Iterators, generators, context managers, errors

### Q23. Iterable vs iterator vs generator, and `yield`

**Short answer:** An **iterable** can give you an iterator (`__iter__`), e.g. list. An **iterator** returns the next item on `__next__()` and raises `StopIteration` when done. A **generator** is the easiest way to write an iterator: a function with `yield` that pauses and resumes with local state preserved.

```flow
sequence: The iterator protocol behind a for loop
actors: for loop, Iterable, Iterator
for loop -> Iterable: iter(obj) calls __iter__()
Iterable --> for loop: a fresh iterator
for loop -> Iterator: next() calls __next__()
Iterator --> for loop: value 1
for loop -> Iterator: next()
Iterator --> for loop: value 2
for loop -> Iterator: next()
Iterator --> for loop: raises StopIteration → loop ends
> A generator function writes this for you: each `yield` hands out the next value and pauses until the next `next()`.
```

**Explanation:**
```
for x in iterable:          ≡   it = iter(iterable)
    body                        while True:
                                    try: x = next(it)
                                    except StopIteration: break
                                    body
```

**Example (streaming pipeline, constant memory):**
```python
def read_pages(path):
    with open(path) as f:
        for line in f:
            yield line                    # pause here, resume on next()

def only_errors(lines):
    return (l for l in lines if "ERROR" in l)

for line in only_errors(read_pages("app.log")):   # one line in memory at a time
    print(line)
```

**Follow-ups:** Generators are single-pass. `yield from sub_gen()` delegates to another generator. `itertools` (`islice`, `chain`, `groupby`, `batched` in 3.12+) composes lazy pipelines.

---

### Q24. Context managers and `with`

**Short answer:** A context manager guarantees setup and teardown around a block — even if an exception occurs. Implement `__enter__`/`__exit__` or use `@contextlib.contextmanager` with a single `yield`. Async version: `async with` / `@asynccontextmanager`.

```flow
sequence: What `with` guarantees
actors: Your code, Context manager
Your code -> Context manager: __enter__()
Context manager --> Your code: resource (file, lock, DB session)
Your code -> Your code: run the block
> It might finish normally or raise an exception.
Your code -> Context manager: __exit__(exc_type, exc, tb)
> Always called, success or failure: close the file, release the lock, commit or roll back.
Context manager --> Your code: return True to swallow the exception, else it propagates
```

**Example:**
```python
from contextlib import contextmanager
import time

@contextmanager
def timer(label):
    start = time.perf_counter()
    try:
        yield                         # body of the `with` runs here
    finally:
        print(f"{label}: {time.perf_counter() - start:.3f}s")

with timer("embed"):
    embed_documents(docs)
```

**Decorator vs context manager:** decorator wraps a whole **function**; context manager wraps a **block** of code. Both remove repeated setup/cleanup from business logic.

---

### Q25. `try / except / else / finally`

**Short answer:** `try` holds risky code; `except` handles specific errors; `else` runs only if **no** exception happened; `finally` always runs (cleanup), even after `return`.

```flow
pipeline: try / except / else / finally, in order
try > Run the risky code.
except (only if it raised) > Handle the specific error types you expect.
else (only if it did NOT raise) > Code that should run only on success. Keeping it out of `try` avoids catching its errors by accident.
finally (always) > Cleanup that must happen, even after `return`, `break` or an unhandled exception.
```

**Example:**
```python
try:
    resp = client.get(url, timeout=5)
except TimeoutError:
    log.warning("timeout, will retry")        # transient → retry
    raise
except PermissionError:
    return {"error": "forbidden"}             # permanent → don't retry
else:
    cache.save(resp)                          # only on success
finally:
    client.close()                            # always
```

**Rules:** Catch the narrowest exception. Never `except: pass`. Use `raise ... from err` to keep the original cause (exception chaining).

---

### Q26. Custom exceptions and exception hierarchy

**Short answer:** Create a base exception for your domain and subclasses for specific failures, so callers can catch at the right granularity.

```flow
trace: Catching at the right level with an exception hierarchy
DocumentError ← NotFound, ← ParseError, ← QuotaExceeded > Domain base class + specific subclasses.
raise ParseError("page 3") > The specific failure.
except NotFound → 404 handler: **skipped** > Doesn't match.
except DocumentError → **caught** > Callers can catch broadly or narrowly. Use `raise … from err` to keep the original cause.
```

```python
class ToolError(Exception): """Base for all tool failures."""
class RetryableToolError(ToolError): pass
class ToolPermissionError(ToolError): pass

try:
    run_tool()
except RetryableToolError: schedule_retry()
except ToolError as e: report(e)
```

---

### Q27. `ExceptionGroup` and `except*` (3.11+)

**Short answer:** When several concurrent tasks fail at once (e.g., inside `asyncio.TaskGroup`), Python raises an `ExceptionGroup` holding all of them. `except*` lets you handle each type separately.

```flow
sequence: except* splits an ExceptionGroup
actors: TaskGroup, Your code
TaskGroup --> Your code: ExceptionGroup([TimeoutError, ValueError, TimeoutError])
Your code -> Your code: except* TimeoutError → handles both timeouts
Your code -> Your code: except* ValueError → handles the ValueError
> Each `except*` clause takes the matching part of the group; unhandled parts are re-raised.
```

```python
try:
    async with asyncio.TaskGroup() as tg:
        tg.create_task(fetch_a()); tg.create_task(fetch_b())
except* TimeoutError as eg:
    log.warning("timeouts: %s", eg.exceptions)
except* ValueError as eg:
    log.error("bad data: %s", eg.exceptions)
```

---

## 6. Typing & data modelling

### Q28. Type hints and generics — are they enforced?

**Short answer:** No. Type hints are **not enforced at runtime**; they are checked by static tools (mypy, pyright) and used by IDEs and frameworks like FastAPI/Pydantic that *choose* to read them.

```flow
pipeline: Where type hints actually matter
Write hints > def get(id: str) -> Doc | None.
Runtime ignores them > Passing an int still runs.
Static checkers > mypy / pyright catch the bug before running.
Frameworks read them > FastAPI / Pydantic turn hints into validation at runtime.
```

**Example:**
```python
from typing import TypeVar, Callable, Literal, TypedDict

def first[T](items: list[T]) -> T:          # 3.12+ generic syntax
    return items[0]

type JSON = dict[str, "JSON"] | list["JSON"] | str | int | float | bool | None  # 3.12 alias

Mode = Literal["fast", "accurate"]
def run(mode: Mode, cb: Callable[[str], None] | None = None) -> None: ...
```

**Common hints:** `Optional[X]` = `X | None`, `Literal`, `Callable`, `Iterable`, `Annotated[int, Field(gt=0)]`, `Self`, `TypedDict`, `Protocol`.

---

### Q29. dataclass vs NamedTuple vs TypedDict vs Pydantic

**Short answer:** Pick by **where the data comes from**:

```flow
pipeline: Choosing a data container by where data comes from
Internal, trusted data > @dataclass.
Small immutable record / tuple compatibility > NamedTuple.
Typing an existing dict (JSON shape) > TypedDict: no runtime checks.
Untrusted input (API, LLM output, files) > Pydantic: validates and converts at runtime.
```

| Tool | Runtime validation | Mutable | Best for |
|---|---|---|---|
| `dataclass` | ❌ | ✅ (or frozen) | internal domain objects |
| `NamedTuple` | ❌ | ❌ | small immutable records, tuple-compatible |
| `TypedDict` | ❌ (static only) | it's a dict | typing JSON/dict shapes, LangGraph state |
| **Pydantic `BaseModel`** | ✅ parses & validates | ✅ | **untrusted input**: APIs, LLM outputs, config |

**Example:**
```python
from pydantic import BaseModel, Field

class ExtractRequest(BaseModel):
    doc_id: str = Field(min_length=3)
    pages: list[int] = []

ExtractRequest.model_validate({"doc_id": "d1", "pages": ["1", 2]})
# pages coerced to [1, 2]; invalid doc_id → ValidationError with details
```

**Key line for interviews:** "Type hints describe; Pydantic **enforces** at the trust boundary."

---

### Q30. Enums and when to use them

```python
from enum import StrEnum
class JobStatus(StrEnum):
    PENDING = "PENDING"; RUNNING = "RUNNING"; DONE = "DONE"

JobStatus("DONE") is JobStatus.DONE   # True; JobStatus("X") → ValueError
```
Use enums instead of magic strings for statuses, routes and modes — typos become errors, and IDEs autocomplete.

---

## 7. Concurrency: threads, processes, asyncio, GIL

### Big picture

```
            Is the work waiting (I/O) or computing (CPU)?
                         │
          ┌──────────────┴───────────────┐
        I/O bound                     CPU bound
   (HTTP, DB, S3, LLM APIs)      (parsing, image ops, math)
          │                               │
   ┌──────┴──────┐                 multiprocessing /
 async libs?   only sync libs?     ProcessPoolExecutor
   │               │               (or native libs: NumPy,
 asyncio        threads              free-threaded 3.14 build)
 (1 thread,     (ThreadPoolExecutor,
 1000s of       asyncio.to_thread)
 waiting tasks)
```

### Q31. What is the GIL and what does it NOT guarantee?

**Short answer:** The Global Interpreter Lock in standard CPython lets only **one thread execute Python bytecode at a time** per interpreter. Threads still help for I/O (the GIL is released while waiting), but don't speed up pure-Python CPU work. The GIL does **not** make your code thread-safe.

```flow
sequence: Two threads under the GIL
actors: Thread 1, GIL, Thread 2, Network
Thread 1 -> GIL: acquire, run Python bytecode
Thread 1 -> Network: blocking I/O: release GIL while waiting
> I/O-bound threads still overlap, because the GIL is released during blocking I/O.
Thread 2 -> GIL: acquire, run bytecode
Thread 2 -> GIL: switch interval: forced to release
> CPU-bound threads just take turns, so two CPU-heavy threads aren't faster than one. Use processes, native extensions or the free-threaded build.
Thread 1 -> GIL: reacquire, continue
> The GIL doesn't make your code thread-safe: `x += 1` is several bytecodes and can still interleave. Use locks.
```

**Example:**
```python
counter = 0
def work():
    global counter
    for _ in range(100_000):
        counter += 1      # read → add → write: threads can interleave → lost updates

import threading
lock = threading.Lock()
def safe_work():
    global counter
    for _ in range(100_000):
        with lock: counter += 1
```

**Follow-up:** Python 3.13 introduced an optional **free-threaded build** (`python3.14t`) without the GIL; since 3.14 it is officially supported but still not the default, and some C extensions may not support it yet. Mention it, but state which interpreter you run.

---

### Q32. Threads vs processes vs asyncio — when to use each?

```flow
pipeline: Threads, processes or asyncio?
Many concurrent I/O waits with async libraries? > asyncio: thousands of tasks on one thread.
I/O with blocking libraries (boto3, requests)? > Threads (or asyncio.to_thread).
CPU-heavy pure Python? > Processes (ProcessPoolExecutor) to use multiple cores.
Free-threaded build (3.13+) > Threads can run Python in parallel, once your libraries support it.
```

| | Threads | Processes | asyncio |
|---|---|---|---|
| Parallel CPU (standard CPython) | ❌ | ✅ | ❌ |
| Good for I/O | ✅ | ✅ (heavy) | ✅✅ (thousands of tasks) |
| Memory cost | low | high (separate interpreter) | very low |
| Shared memory | yes (need locks) | no (pickle data between) | yes, single thread |
| Switching | OS preemptive | OS | **cooperative** at `await` |

**Example:**
```python
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor
with ThreadPoolExecutor(max_workers=16) as ex:          # blocking boto3 calls
    results = list(ex.map(s3_get, keys))
with ProcessPoolExecutor() as ex:                       # CPU-heavy OCR post-processing
    results = list(ex.map(clean_page, pages))
```

---

### Q33. How does asyncio work? (`async`, `await`, event loop, tasks)

**Short answer:** asyncio runs many coroutines on **one thread**. An event loop runs a coroutine until it hits `await` on something not ready (network, sleep), then switches to another ready coroutine. It is **cooperative**: a coroutine that never awaits (CPU loop, blocking call) freezes everything.

**Explanation:**
```flow
sequence: One thread, many tasks: how the event loop interleaves work
actors: Event loop, Task A, Task B, OS
Event loop -> Task A: run A
> The loop picks A from the ready queue and runs it until it hits an `await`.
Task A -> OS: await HTTP response
> A starts network I/O and yields control. A is parked; its socket is registered with the OS.
Event loop -> Task B: run B
> The single thread is free, so the loop runs B straight away instead of waiting for A.
Task B -> OS: await DB query
> B also yields at its `await`. Now both A and B are waiting on I/O at the same time.
OS --> Event loop: A's socket has data
> The OS reports that A's I/O is ready (epoll/kqueue/IOCP).
Event loop -> Task A: resume A
> A goes back on the ready queue and continues right after its `await`. Concurrency without threads: tasks take turns at every `await`.
```

**Example:**
```python
import asyncio, httpx

async def fetch(client, url):
    r = await client.get(url, timeout=10)     # yields control while waiting
    return r.status_code

async def main(urls):
    async with httpx.AsyncClient() as client:
        return await asyncio.gather(*(fetch(client, u) for u in urls))

asyncio.run(main(["https://a", "https://b"]))   # 2 requests overlap in time
```

**Pitfall:** Calling a coroutine without `await` (`fetch(c, u)`) only creates a coroutine object — nothing runs.

---

### Q34. `gather` vs `TaskGroup` vs `Semaphore` vs timeouts vs cancellation

**Short answer:**
- `asyncio.gather(*aws)` — run concurrently, return results in order. If one fails, the others **keep running** unless you cancel them (`return_exceptions=True` collects errors instead).
- `asyncio.TaskGroup` (3.11+) — **structured concurrency**: if one task fails, siblings are cancelled and errors are raised together as an `ExceptionGroup`.
- `asyncio.Semaphore(n)` — limit how many run at once (protect rate limits).
- `asyncio.timeout(s)` — deadline for a block.
- Cancellation is cooperative: a `CancelledError` is raised at the next `await`; clean up in `finally`.

```flow
sequence: TaskGroup: one failure cancels the rest
actors: Parent, TaskGroup, Task A, Task B
Parent -> TaskGroup: async with TaskGroup() as tg
TaskGroup -> Task A: create_task(fetch_a())
TaskGroup -> Task B: create_task(fetch_b())
Task A --> TaskGroup: raises ValueError
TaskGroup -> Task B: cancel()
> Structured concurrency: no task is left running in the background after a failure.
TaskGroup --> Parent: ExceptionGroup([ValueError])
> With `gather`, by contrast, the other tasks keep running unless you cancel them yourself.
```

**Example (bounded fan-out — a very common interview ask):**
```python
sem = asyncio.Semaphore(20)                  # max 20 concurrent LLM calls

async def embed_one(text):
    async with sem:
        async with asyncio.timeout(30):
            return await llm.embed(text)

async def embed_all(texts):
    async with asyncio.TaskGroup() as tg:
        tasks = [tg.create_task(embed_one(t)) for t in texts]
    return [t.result() for t in tasks]
```

---

### Q35. How do you call blocking code from async code?

**Short answer:** Offload it to a thread with `await asyncio.to_thread(fn, *args)` (or `loop.run_in_executor`). For CPU-heavy work, use a process pool.

```flow
sequence: Calling blocking code from async code
actors: Event loop, Thread pool, Blocking lib (boto3)
Event loop -> Thread pool: await asyncio.to_thread(s3.get_object, …)
Thread pool -> Blocking lib (boto3): runs in a worker thread
> The event loop is free to serve other requests while the thread waits on the network.
Blocking lib (boto3) --> Thread pool: result
Thread pool --> Event loop: await resumes with the result
> Calling boto3 directly inside `async def` would freeze every request on that worker until it finished.
```

```python
async def get_object(key):
    return await asyncio.to_thread(s3.get_object, Bucket="b", Key=key)  # boto3 is sync
```

**Pitfall:** `time.sleep()`, `requests.get()`, sync DB drivers inside `async def` routes block the whole event loop → all users get slow.

---

### Q36. Thread-safety tools

`threading.Lock/RLock` (mutual exclusion), `queue.Queue` (thread-safe producer/consumer), `threading.Event` (signal), `asyncio.Lock/Queue` (async equivalents — **not** thread-safe), `contextvars` (per-request context such as request ID that works with asyncio).

```flow
sequence: Producer / consumer with queue.Queue
actors: Producer thread, Queue, Worker 1, Worker 2
Producer thread -> Queue: put(job1), put(job2)
Worker 1 -> Queue: get() → job1
Worker 2 -> Queue: get() → job2
Worker 1 -> Queue: task_done()
Producer thread -> Queue: join() waits until all jobs are done
> The queue handles locking for you; maxsize gives backpressure.
```

```python
import contextvars
request_id = contextvars.ContextVar("request_id", default="-")
# set in middleware; read in logging filter → every log line has the request ID
```

---

### Q37. Multiprocessing pitfalls

```flow
sequence: What multiprocessing does with your arguments
actors: Parent process, Pickle, Child process
Parent process -> Pickle: serialise function + arguments
Pickle -> Child process: send bytes (spawn: child re-imports your module)
Child process -> Child process: run work
Child process --> Parent process: pickled result back
> Big arguments are slow to copy, so pass file paths or IDs. Guard the entry point with `if __name__ == "__main__":`.
```

- Arguments and results are **pickled** → large data is slow; send file paths/IDs instead.
- On Windows/macOS the default start method is `spawn` → protect entry code with `if __name__ == "__main__":`.
- Lambdas/local functions can't be pickled → use module-level functions.

---

## 8. Packaging, testing, tooling

### Q38. Virtual environments, dependencies and reproducible builds

**Short answer:** Isolate each project in a virtual environment, declare dependencies in `pyproject.toml`, and install from a **lockfile** that pins every transitive version (plus hashes). Build an immutable Docker image tagged with the git SHA.

```flow
pipeline: Reproducible Python environments
pyproject.toml > Declares direct dependencies and version ranges.
Lockfile (uv.lock) > Resolver pins every transitive package to an exact version + hash.
Virtual environment > Isolated per project, so projects don't break each other.
Install from lock > CI, Docker and teammates all get identical versions (`uv sync --frozen`).
Upgrade deliberately > Bump the lock in a PR, let tests run, then merge.
```

**Example workflow (uv is now the common fast tool; pip-tools/Poetry also fine):**
```bash
uv init my-service && cd my-service
uv add fastapi pydantic boto3          # updates pyproject.toml + uv.lock
uv add --dev pytest mypy ruff
uv sync --frozen                       # CI: install exactly the lockfile, fail if out of date
uv run pytest
```

**Follow-ups:** separate dev/test/runtime deps; scan with `pip-audit`; never deploy unpinned `latest`.

---

### Q39. Testing with pytest: fixtures, parametrize, mocks

**Short answer:** Use plain `assert`; **fixtures** for reusable setup (with scopes: function/module/session); **parametrize** for many input cases; **mock only external boundaries** (HTTP, AWS, LLM), not your own logic.

```flow
pipeline: A pytest run with fixtures
Collect tests > pytest finds `test_*` functions; `parametrize` expands one test into many cases.
Set up fixtures > Requested fixtures are created at their scope (function, module or session), dependencies first.
Run test > Plain `assert`; pytest shows the values that differed.
Tear down > Code after `yield` in each fixture runs, even if the test failed.
Report > Pass/fail, coverage, JUnit XML for CI.
```

**Example:**
```python
import pytest
from unittest.mock import Mock

@pytest.fixture
def fake_llm():
    llm = Mock()
    llm.invoke.return_value = "billing"
    return llm

@pytest.mark.parametrize("text,expected", [("refund please", "billing"), ("", "unknown")])
def test_router(fake_llm, text, expected):
    fake_llm.invoke.return_value = expected
    assert route(text, llm=fake_llm) == expected

def test_router_timeout(fake_llm):
    fake_llm.invoke.side_effect = TimeoutError
    with pytest.raises(TimeoutError):
        route("x", llm=fake_llm)
```

**Test pyramid:** many fast unit tests → fewer integration tests (real DB in container, moto/localstack or sandbox AWS) → few end-to-end tests.

---

### Q40. Code-quality tooling

```flow
pipeline: Quality gates on every commit
pre-commit > ruff format + ruff lint on changed files.
Type check > mypy / pyright.
Tests + coverage > pytest, pytest-cov.
Security > bandit, pip-audit.
CI repeats all of it > Nothing merges without passing.
```

| Tool | Purpose |
|---|---|
| `ruff` | very fast linter + formatter (replaces flake8, isort, black for many teams) |
| `mypy` / `pyright` | static type checking |
| `pytest` + `pytest-cov` | tests + coverage |
| `pre-commit` | run checks before each commit |
| `bandit`, `pip-audit` | security lint, vulnerable dependency scan |

---

### Q41. Logging properly

**Short answer:** Use the `logging` module (not `print`), one logger per module (`logging.getLogger(__name__)`), configure handlers once at startup, log **structured JSON** in services, and never log secrets/PII.

```flow
pipeline: The path of one log call
logger = getLogger(__name__) > One logger per module.
logger.info("job done", extra={job_id}) > Level checked first: below threshold → dropped cheaply.
Handlers > Configured once at startup (stdout in containers).
Formatter (JSON) > Structured fields: time, level, message, trace_id, job_id.
Collector > CloudWatch / OpenSearch. Never log secrets or PII.
```

```python
import logging
log = logging.getLogger(__name__)
log.info("job finished", extra={"job_id": job_id, "duration_ms": 812})
log.exception("tool failed")      # inside except: includes stack trace
```

---

## 9. Production engineering

### Q42. Memory leaks / high memory in long-running services

**Short answer:** Common causes: unbounded caches/dicts, references kept in globals/closures, `lru_cache` on methods, accumulating background tasks, loading whole files/results lists, and native library allocations. Measure first: `tracemalloc` snapshots, `memray`, container memory metrics.

```flow
pipeline: Usual causes of memory growth
Unbounded caches / dicts > Add maxsize or TTL.
lru_cache on methods > Keeps `self` alive forever.
Globals and closures > Holding references longer than needed.
Background tasks never awaited > Accumulate.
Whole files in memory > Stream instead.
```

```python
import tracemalloc
tracemalloc.start()
...  # run workload
top = tracemalloc.take_snapshot().statistics("lineno")[:5]
for stat in top: print(stat)     # shows which lines allocate the most
```

**Fixes:** bounded LRU/TTL caches, streaming (generators), process recycling (gunicorn `--max-requests`), pass IDs instead of payloads.

---

### Q43. Retries without making outages worse

**Short answer:** Retry **only transient errors** (timeouts, 429, 5xx), use **exponential backoff with jitter** and a max attempt/time budget, respect `Retry-After`, and make side-effecting operations **idempotent** (idempotency keys). Add circuit breakers so a dead dependency isn't hammered.

```flow
pipeline: Exponential backoff with jitter
Attempt 1 fails > A transient error (timeout, 429, 503). Only retry operations that are safe to repeat (idempotent).
Wait ~1 s ± jitter > Random jitter spreads clients out, so 1,000 clients don't all retry in the same second (the "thundering herd").
Attempt 2 fails > Still failing, so back off further.
Wait ~2 s, then ~4 s > The delay doubles each time, up to a cap; respect a `Retry-After` header if the server sends one.
Give up > Stop after max attempts or when the request's total deadline is used up.
DLQ / alert > Park the work in a dead-letter queue and alarm, instead of retrying forever.
```

```python
from tenacity import retry, stop_after_attempt, wait_random_exponential, retry_if_exception_type

@retry(stop=stop_after_attempt(5),
       wait=wait_random_exponential(multiplier=1, max=30),
       retry=retry_if_exception_type((TimeoutError, RateLimitError)))
def call_model(prompt): ...
```

---

### Q44. Optimising slow Python methodically

**Short answer:** **Measure → find the bottleneck → fix the biggest one → measure again.** Most slowness is algorithmic (O(n²)), I/O (serial network calls), or serialization — not Python syntax.

```flow
cycle: Optimising slow code
Measure > Time the real workload; get a baseline.
Profile > cProfile / py-spy / scalene: find where the time actually goes.
Fix the biggest cost > Usually algorithmic (O(n²)), serial I/O, or serialization.
Measure again > Keep only changes that helped.
exit > Stop when the target is met. Optimising without measuring usually fixes the wrong thing.
```

```bash
python -m cProfile -s cumtime app.py      # deterministic profiler
py-spy top --pid 1234                     # sampling profiler on live process
```

**Typical wins:** right data structure (set instead of list for membership), batch API calls, run I/O concurrently, cache stable results, NumPy/pandas/polars vectorisation for numeric work, avoid repeated JSON parse/dump.

---

### Q45. Serialization choices and pickle security

```flow
pipeline: Serialising data safely
JSON > Interoperable, safe; validate with Pydantic on the way in.
MessagePack / Protobuf > Compact, fast, schema options.
pickle > Python-only; unpickling untrusted data can execute code.
Version your payloads > A `version` field so formats can evolve.
```

| Format | Pros | Cons |
|---|---|---|
| JSON | universal, human-readable | no datetime/bytes/Decimal natively, larger |
| MessagePack / Protobuf | compact, fast; Protobuf has schemas | binary, needs tooling |
| **pickle** | any Python object | **unsafe**: `pickle.loads` can execute arbitrary code |

**Rule:** Never unpickle data from an untrusted source. Validate JSON at boundaries with Pydantic and include a schema `version` field for evolution.

---

### Q46. Database transactions, race conditions and idempotency

**Short answer:** A transaction makes several writes atomic. To prevent lost updates between concurrent workers use **optimistic locking** (version column, conditional update) or **pessimistic locking** (`SELECT ... FOR UPDATE`). Python `threading.Lock` does **not** work across multiple processes/containers — the database must enforce it.

```flow
sequence: Optimistic locking stops a lost update
actors: Worker A, Database, Worker B
Worker A -> Database: read job (status=PENDING, version=4)
Worker B -> Database: read job (status=PENDING, version=4)
Worker A -> Database: UPDATE … SET status=RUNNING, version=5 WHERE id=… AND version=4
Database --> Worker A: 1 row updated ✓
Worker B -> Database: same UPDATE … WHERE version=4
Database --> Worker B: 0 rows updated
> B's write didn't match the version, so it knows someone else won. It re-reads or skips. No lost update, and no lock held while thinking.
```

```sql
-- optimistic locking: succeeds only if nobody changed it since we read version 7
UPDATE jobs SET status='DONE', version=8 WHERE id='j1' AND version=7;
-- 0 rows updated → someone else won → re-read and decide
```

```python
# DynamoDB equivalent: claim a job exactly once
table.update_item(
    Key={"job_id": "j1"},
    UpdateExpression="SET #s = :running",
    ConditionExpression="#s = :pending",
    ExpressionAttributeNames={"#s": "status"},
    ExpressionAttributeValues={":running": "RUNNING", ":pending": "PENDING"},
)   # raises ConditionalCheckFailedException if another worker claimed it
```

---

### Q47. Logs, metrics, traces (observability)

**Short answer:**
- **Logs** = what happened (events, with IDs).
- **Metrics** = how much / how often (latency p50/p95/p99, error rate, queue depth).
- **Traces** = where time went across services (spans linked by a trace ID).

```flow
pipeline: Logs, metrics, traces together
Metric alarm fires > Error rate up for the documents API.
Trace > Shows which hop is slow or failing.
Logs for that trace_id > The exact error and context.
Fix + dashboard > And an alert on the cause next time.
```

Propagate a correlation/trace ID through every hop (OpenTelemetry does this), and redact tokens/PII.

```flow
sequence: One request, one trace ID
actors: Browser, FastAPI, Agent, Lambda tool, S3
Browser -> FastAPI: request (trace_id=abc)
> The first hop starts the trace (or reads a `traceparent` header). Span 1 = the API handler.
FastAPI -> Agent: invoke (traceparent header)
> The trace context travels in a header, so the agent's work becomes span 2 under the same trace.
Agent -> Lambda tool: tool call
> Span 3. Every hop forwards the same trace ID.
Lambda tool -> S3: GetObject
> Span 4. In the trace viewer you see one waterfall: exactly where the time went and which hop failed.
```

---

### Q48. Clean architecture / dependency inversion in Python

**Short answer:** Business logic depends on **interfaces** (Protocols), not concrete SDKs. Adapters (S3, Bedrock, Postgres) implement those interfaces. This makes code testable (swap in a fake) and lets you change providers without rewriting logic.

```flow
pipeline: Dependency inversion in a request
API handler > Receives the request, then calls a use case.
Use case (business logic) > Depends only on interfaces like `DocumentStore` and `LLMClient` (Protocols).
Interface > The contract: method names, inputs and outputs.
Adapter > `S3DocumentStore`, `BedrockLLM` implement the interface. In tests, `FakeLLM` does.
External system > S3, Bedrock, Postgres. Swapping one only changes an adapter, never the business logic.
```

```
  ┌────────────── API layer (FastAPI routes) ──────────────┐
  │                     calls                              │
  │      ┌──────── Service layer (pure logic) ────────┐     │
  │      │   depends on Protocols: DocumentStore, LLM │     │
  │      └──────────▲─────────────────▲───────────────┘     │
  │          implements          implements                 │
  │       S3DocumentStore     BedrockLLM / FakeLLM (tests)  │
  └─────────────────────────────────────────────────────────┘
```

---

## 10. Scenario & debugging questions

### Q49. An API is fast for 1 user but slow with 100 concurrent users. How do you investigate?

**Answer structure (say it in this order):**
1. **Measure where time goes:** p95/p99 latency, per-dependency latency (traces), CPU, memory, event-loop lag, connection pool wait time.
2. **Common culprits:**
   - Blocking call inside `async def` (sync boto3/requests, `time.sleep`) → event loop stalls.
   - Connection pool too small (DB/HTTP) → requests queue.
   - Downstream rate limit (LLM 429s) → retries pile up.
   - CPU-bound work in the web process.
3. **Fix the bottleneck**, *then* scale horizontally. Adding ECS tasks doesn't help if all of them wait on the same DB.

```flow
pipeline: Fast for 1 user, slow for 100: investigation order
Measure > p95/p99 latency, per-dependency latency from traces, CPU, memory, event-loop lag.
Find the queue > Where do requests wait? DB pool, thread pool, event loop, a rate-limited API?
Check for blocking calls > Sync I/O inside `async def` blocks every request on that worker.
Check pools and limits > DB connection pool size, HTTP client limits, worker count.
Fix + load test > Change one thing, re-run the load test, compare.
```

```python
@app.get("/doc/{id}")
async def get_doc(id: str):
    return s3.get_object(Bucket="b", Key=id)                         # ❌ blocks loop
    return await asyncio.to_thread(s3.get_object, Bucket="b", Key=id) # ✅
```

---

### Q50. Design a safe concurrent document-processing worker

```flow
pipeline: A safe concurrent document worker
S3 upload > A user uploads a file; S3 sends an event.
SQS queue > The queue buffers bursts and redelivers messages if a worker crashes.
Receive {job_id} > The worker (ECS task, asyncio) long-polls for a message.
Claim job > DynamoDB conditional write: only one worker can claim this job_id, so duplicate deliveries are harmless (idempotent).
Stream file from S3 > Process page by page; don't load a 500-page PDF into memory.
Semaphore(10) > Limits in-flight Textract/LLM calls so you stay inside API quotas.
Checkpoint per page > Save progress in DynamoDB, so a retry continues instead of starting over.
Retry with backoff > Transient errors retry with jitter; permanent errors fail fast.
Delete message > Only after success. Too many failures → dead-letter queue + alarm. On SIGTERM: stop receiving, finish in-flight work, exit.
```

Key points to say: idempotent claim, bounded concurrency, streaming I/O, checkpointing, DLQ for poison messages, graceful shutdown, metrics (queue depth, age of oldest message, failures).

---

### Q51. Your service's memory grows until the container is OOM-killed. Steps?

```flow
pipeline: Memory grows until OOM-kill
Confirm the pattern > Container metrics: steady growth (leak) or spikes per request (big payloads)?
Reproduce under load > Locally, with the same traffic shape.
Take snapshots > `tracemalloc` / `memray` snapshots a few minutes apart; diff them.
Find the owner > Unbounded cache, global list, `lru_cache` on a method, never-awaited tasks, whole files loaded.
Fix + guard > Bound caches (maxsize/TTL), stream files, set memory limits and alarms.
```

1. Confirm the pattern (steady growth vs spikes per request) from container metrics.
2. Reproduce locally under load; take `tracemalloc`/`memray` snapshots at intervals and diff them.
3. Look for: global dicts/caches without bounds, `lru_cache(maxsize=None)`, accumulating `asyncio` tasks never awaited, large lists of results, unclosed clients.
4. Fix, add a memory regression test/alarm, and as a safety net configure worker recycling.

---

### Q52. What do you check in a Python PR review for an AI service?

```flow
pipeline: Reviewing a Python PR for an AI service
Boundaries > Inputs validated (Pydantic); LLM output validated before use.
Resilience > Timeouts, bounded concurrency, retries with backoff, idempotency.
Security > No secrets in code/logs, authorisation on every tool, injection risks.
Observability > Structured logs, trace ids, token/cost metrics.
Tests > Unit tests with fake LLM, eval cases for prompt changes.
```

- **Input validation** at boundaries (Pydantic), output validation of LLM responses.
- **Timeouts** on every network call; **bounded concurrency** (no unbounded `gather` over 5,000 items).
- **Retries** only on transient errors; side effects idempotent.
- **Secrets** from Secrets Manager/env, never hard-coded or logged; logs redacted.
- **Resource cleanup** (`with`, `async with`), no blocking calls in async code.
- **Types + tests** for edge cases and failure paths; meaningful assertions.
- **Backward compatibility** of API/state schemas.

---

## 11. Cheat sheet

| Topic | One-liner |
|---|---|
| Names | labels on objects; `b = a` → alias, not copy |
| Defaults | evaluated once → use `None` sentinel |
| `is` vs `==` | identity vs value |
| Copy | shallow shares inner objects; `deepcopy` doesn't |
| Hashable | immutable + `__hash__`/`__eq__` consistent |
| Memory | refcount + cyclic GC; `__slots__` saves memory |
| Closures | capture variables, not values (late binding) |
| Decorator | `f = deco(f)`; use `functools.wraps` |
| MRO | `super()` = next class in C3 MRO |
| Protocol vs ABC | structural (duck) vs nominal (inherit) |
| Generator | lazy, single-pass, constant memory |
| Context manager | guaranteed cleanup; `@contextmanager` |
| GIL | one thread runs bytecode; not thread safety |
| I/O-bound | asyncio (or threads); CPU-bound → processes |
| asyncio | cooperative; never block the loop; `to_thread` |
| Bounded fan-out | `Semaphore` + `TaskGroup` + `timeout` |
| Validation | hints describe; Pydantic enforces |
| Retries | transient only, backoff + jitter, idempotency |
| Distributed locking | DB conditional writes, not Python locks |

## Official references

- https://docs.python.org/3/ · https://docs.python.org/3/whatsnew/
- https://docs.python.org/3/library/asyncio.html
- https://docs.python.org/3/howto/free-threading-python.html
- https://docs.pydantic.dev/ · https://docs.pytest.org/en/stable/
