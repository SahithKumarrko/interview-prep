# Python: Interview Preparation

> **Updated:** 27 October 2026 (Python 3.15 is current; 3.14 is widely deployed) · **Level:** basics → internals → concurrency & production
> **How to use:** read the *Short answer* first, then *How it works* and the *Example* walkthrough. *Common mistake → fix* shows what goes wrong in real code. *Interview answer* is what you can say out loud.

---

## Table of contents

1. [Mental model: how Python runs your code](#1-mental-model-how-python-runs-your-code)
2. [Basics](#2-basics) (Q01–Q08)
3. [Core data types & memory](#3-core-data-types--memory) (Q09–Q17)
4. [Functions, scope, closures, decorators](#4-functions-scope-closures-decorators) (Q18–Q26)
5. [OOP: classes, dunder methods, inheritance](#5-oop-classes-dunder-methods-inheritance) (Q27–Q34)
6. [Iterators, generators, context managers, errors](#6-iterators-generators-context-managers-errors) (Q35–Q40)
7. [Typing & data modelling](#7-typing--data-modelling) (Q41–Q43)
8. [Concurrency: threads, processes, asyncio, GIL](#8-concurrency-threads-processes-asyncio-gil) (Q44–Q51)
9. [Packaging, testing, tooling](#9-packaging-testing-tooling) (Q52–Q56)
10. [Production engineering](#10-production-engineering) (Q57–Q63)
11. [Recent Python versions](#11-recent-python-versions) (Q64)
12. [Scenario & debugging questions](#12-scenario--debugging-questions) (Q65–Q68)
13. [Cheat sheet](#13-cheat-sheet)

---

## 1. Mental model: how Python runs your code

**The one idea everything else follows from:** in Python, **everything is an object** (numbers, strings, lists, functions, classes, modules), and a **variable is just a name tag stuck on an object**. Assigning `b = a` does not copy anything; it sticks a second tag on the same object. Whether "changing" a value modifies that shared object or creates a new one depends on whether the object is **mutable** (lists, dicts, sets) or **immutable** (ints, strings, tuples).

Think of a cloakroom: objects are coats on hooks, and names are tickets. Two tickets can point to the same coat. If someone sews a patch on the coat (mutation), both ticket holders see the patch. If someone swaps their ticket for a different coat (rebinding), the other ticket still points to the old coat.

```flow
pipeline: What happens when you run python app.py
stage: 1. Compile
Read app.py as text > Python reads your source file. Nothing has run yet.
Compile to bytecode > The source is turned into bytecode: small, simple instructions for Python's virtual machine. Imported modules have their bytecode cached in __pycache__ as .pyc files, so the next import skips this step.
stage: 2. Execute
The interpreter runs the bytecode > CPython (the standard interpreter, written in C) executes one instruction at a time. Each function call gets a frame that holds its local names.
Names point to objects on the heap > x = [1, 2] creates a list object in memory and binds the name x to it. Every object has a type, a value and a reference count.
stage: 3. Clean up
Objects with no names left are freed > When an object's reference count reaches 0 it is freed immediately. A cycle collector cleans up groups of objects that only point at each other.
```

**Three rules that come straight from this model:**
1. **Assignment never copies.** `b = a` gives the same object a second name. Use `.copy()` or `copy.deepcopy()` when you want a copy.
2. **Mutable objects can change under every name that points to them.** This explains mutable default arguments, shared class attributes and "why did my config change?" bugs.
3. **Python checks types while running, not before.** A wrong type fails only when that line runs. Type hints and checkers like mypy catch mistakes earlier, but the interpreter ignores hints.

---

## 2. Basics

### Q01. What is Python, and how does it run your code?

**Short answer:** Python is a general-purpose, high-level programming language known for readable syntax. It is **dynamically typed** (a variable's type is decided while the program runs, not declared up front) and usually run by **CPython**, the reference interpreter. CPython first compiles your source code into **bytecode** (simple instructions for a virtual machine) and then executes that bytecode one instruction at a time.

**How it works:**
1. You run `python app.py`.
2. CPython parses the text and compiles it into bytecode. For imported modules it saves the bytecode in `__pycache__/module.cpython-314.pyc` so later runs can skip compiling (if the source hasn't changed).
3. The interpreter loop executes the bytecode. Every value it creates is an object on the heap.
4. Types are checked when an operation actually runs: `"3" + 4` raises `TypeError` only when that line executes.

"Interpreted vs compiled" is a blurry line: Python *does* compile, but to bytecode, not to machine code. Since 3.13 CPython also has an experimental JIT (just-in-time compiler) that can turn hot bytecode into machine code; it is off by default.

**Example:**
```python
# greet.py
def greet(name):
    return "Hello, " + name

print(greet("Asha"))
print(greet(42))
```

**What happens, step by step:**
1. `python greet.py` compiles the whole file to bytecode first. A syntax error anywhere would stop it here, before anything runs.
2. Running the bytecode defines the function `greet` (the `def` statement creates a function object and binds the name `greet`).
3. `greet("Asha")` runs and prints `Hello, Asha`.
4. `greet(42)` runs `"Hello, " + 42`. Only now does Python discover that it can't add a `str` and an `int`, and it raises `TypeError: can only concatenate str (not "int") to str`. The first line was already printed.

You can see the bytecode with the `dis` module:
```python
import dis
dis.dis(greet)   # shows instructions such as LOAD_CONST, LOAD_FAST, BINARY_OP, RETURN_VALUE
```

**Common mistake → fix:** assuming Python catches type errors before running, like Java or C#. It doesn't: the bug in `greet(42)` only shows up when that call runs, possibly in production. Fix: add type hints (`def greet(name: str) -> str`) and run a type checker (mypy or pyright) in CI, plus tests that execute each code path.

**Interview answer:** "Python is a high-level, dynamically typed language. The standard implementation, CPython, compiles source to bytecode and runs it on a virtual machine; imported modules have their bytecode cached in `__pycache__`. Because typing is dynamic, type errors appear only when the line executes, which is why we add type hints and static checkers on top."

**Follow-ups:**
- *What other implementations exist?* PyPy (a JIT-compiling interpreter, often much faster for pure Python loops), MicroPython (microcontrollers) and others. CPython is the default and what most libraries target.
- *Is Python strongly or weakly typed?* Strongly: it won't silently convert `"3" + 4`. It is dynamically *and* strongly typed.

---

### Q02. What is a variable in Python?

**Short answer:** A variable is a **name that refers to an object**. You create it simply by assigning: `count = 3`. There is no type declaration; the *object* has a type, the name does not, so the same name can later refer to an object of a different type. Python is **dynamically typed** (types are checked at run time) and **strongly typed** (it won't silently mix incompatible types).

**How it works:** `count = 3` does two things: it makes sure an `int` object with value 3 exists, and it binds the name `count` to it in the current namespace (a dictionary of names). `count = "three"` rebinds the same name to a new `str` object; the `int` is untouched and is freed if nothing else refers to it.

**Example:**
```python
count = 3
print(type(count), id(count))
count = "three"
print(type(count), id(count))

a = b = []          # one list, two names
a.append(1)
print(b)
```

**What happens, step by step:**
1. `count = 3` binds `count` to an `int` object. `type(count)` is `<class 'int'>`; `id(count)` is that object's identity (in CPython, its memory address).
2. `count = "three"` rebinds the name. `type(count)` is now `<class 'str'>` and `id(count)` is a different number, because it's a different object.
3. `a = b = []` creates **one** list and binds both names to it.
4. `a.append(1)` changes that one list, so `print(b)` prints `[1]`.

**Naming rules:** letters, digits and underscores, not starting with a digit; case-sensitive. By convention (PEP 8, the official style guide) use `snake_case` for variables and functions, `PascalCase` for classes and `UPPER_CASE` for constants. A leading underscore (`_cache`) means "internal, please don't use from outside".

**Common mistake → fix:** expecting `a = b = []` to make two lists. It makes one shared list. Fix: `a, b = [], []` creates two separate lists.

**Interview answer:** "A Python variable is a name bound to an object; the object carries the type, not the name. Assignment just binds or rebinds a name and never copies the object. Python is dynamically typed, because a name can point to any type at run time, and strongly typed, because it raises an error instead of silently converting incompatible types."

**Follow-ups:**
- *Does Python have constants?* Not enforced. `MAX_RETRIES = 3` is a convention; `typing.Final` lets a type checker flag reassignment.
- *What does `del x` do?* It removes the name `x`, not necessarily the object. The object is freed only when no names or references to it remain.

---

### Q03. Numbers: `int`, `float`, `/` vs `//` vs `%`, and float precision

**Short answer:** Python has `int` (whole numbers of **unlimited size**), `float` (64-bit floating point, about 15–17 significant digits) and `complex`. `/` always returns a float, `//` is **floor division** (rounds down toward negative infinity) and `%` is the remainder that goes with it. Floats are binary approximations, so `0.1 + 0.2` is not exactly `0.3`; use `decimal.Decimal` for money.

**How it works:**
- `int` grows as needed: `2 ** 100` is exact. There is no overflow.
- `a // b` and `a % b` always satisfy `a == (a // b) * b + (a % b)`. Because `//` rounds **down**, `-7 // 2` is `-4` (not `-3`), and so `-7 % 2` is `1`.
- A float stores numbers in base 2. Values like 0.1 have no exact base-2 form (like 1/3 has no exact decimal form), so tiny errors appear.
- `round()` uses "round half to even" (banker's rounding): `round(2.5)` is `2`, `round(3.5)` is `4`.

**Example:**
```python
print(7 / 2, 7 // 2, 7 % 2)        # 3.5 3 1
print(-7 // 2, -7 % 2)             # -4 1
print(0.1 + 0.2)                   # 0.30000000000000004
print(0.1 + 0.2 == 0.3)            # False

import math
from decimal import Decimal
print(math.isclose(0.1 + 0.2, 0.3))          # True
print(Decimal("0.10") + Decimal("0.20"))     # 0.30
```

**What happens, step by step:**
1. `7 / 2` is true division → `3.5`. `7 // 2` floors 3.5 → `3`. `7 % 2` → `1`.
2. `-7 / 2` would be `-3.5`; flooring rounds **down** to `-4`. Then the remainder must make `-4 * 2 + r == -7`, so `r = 1`.
3. `0.1` and `0.2` are each stored as the nearest binary value, slightly off. Their sum is `0.30000000000000004`, so `== 0.3` is `False`.
4. `math.isclose` compares with a tolerance → `True`.
5. `Decimal("0.10")` stores exact decimal digits, so the sum is exactly `0.30`. Note the string: `Decimal(0.1)` would copy the float's error.

**Common mistake → fix:** storing prices as floats and comparing with `==`.
```python
total = 0.1 + 0.2
if total == 0.3: ...                   # ❌ never true
# ✅ money: integer cents or Decimal; science: math.isclose
total_cents = 10 + 20                  # 30
```

**Interview answer:** "Python ints are arbitrary precision, floats are IEEE 754 doubles. `/` is true division and always gives a float; `//` floors toward negative infinity and `%` gives the matching remainder, so `-7 // 2` is `-4`. Floats can't represent most decimal fractions exactly, so I compare them with `math.isclose` and use `Decimal` or integer cents for money."

**Follow-ups:**
- *How do you convert?* `int("42")`, `float("3.5")`, `int(3.9)` truncates to `3`. `int("3.5")` raises `ValueError`.
- *What's `divmod`?* `divmod(17, 5)` returns `(3, 2)`, the floor quotient and remainder together.

---

### Q04. Strings: indexing, slicing, f-strings and common methods

**Short answer:** A `str` is an **immutable** sequence of Unicode characters. You read characters with indexes (`s[0]`, `s[-1]` for the last) and substrings with **slices** `s[start:stop:step]`, where `stop` is excluded. Every "change" (`upper()`, `replace()`) returns a **new** string. Build strings with **f-strings** (`f"Hi {name}"`), and join many pieces with `"".join(parts)`.

**How it works:**
- Indexes start at 0; negative indexes count from the end (`-1` is last).
- A slice `s[a:b]` takes characters from index `a` up to, but **not including**, `b`. Missing `a` means "from the start", missing `b` means "to the end". `s[::-1]` reverses.
- Slicing never raises for out-of-range bounds; indexing does (`IndexError`).
- Because strings are immutable, `s[0] = "J"` is an error. Make a new string instead.

**Example:**
```python
s = "invoice-2026.pdf"
print(s[0], s[-1])            # i f
print(s[0:7])                 # invoice
print(s[-3:])                 # pdf
print(s[::-1][:3])            # fdp
name, ext = s.rsplit(".", 1)
print(name, ext)              # invoice-2026 pdf
print(f"{name.upper()} has {len(s)} chars")   # INVOICE-2026 has 16 chars
print(", ".join(["a", "b", "c"]))             # a, b, c
```

**What happens, step by step:**
1. `s[0]` is `"i"`; `s[-1]` is the last character `"f"`.
2. `s[0:7]` takes indexes 0–6: `"invoice"` (index 7 is the `-`, excluded).
3. `s[-3:]` starts 3 from the end and goes to the end: `"pdf"`.
4. `s[::-1]` builds a reversed copy `"fdp.6202-eciovni"`; `[:3]` takes `"fdp"`.
5. `rsplit(".", 1)` splits once from the right: `["invoice-2026", "pdf"]`, unpacked into two names.
6. The f-string evaluates each `{…}` expression and builds one new string.

**Useful methods:** `strip()`, `split()`, `join()`, `replace()`, `startswith()`/`endswith()`, `find()` (returns `-1`) vs `index()` (raises), `lower()`/`upper()`, `isdigit()`, `removeprefix()`/`removesuffix()`. f-string format specs: `f"{price:.2f}"`, `f"{n:,}"` → `1,000,000`, `f"{x=}"` prints `x=…` for debugging.

**Common mistake → fix:** building a long string with `+=` in a loop.
```python
out = ""
for line in lines:
    out += line + "\n"        # ❌ may copy the growing string each time: O(n²) in the worst case
out = "\n".join(lines)        # ✅ one pass, one final string
```

**Interview answer:** "Strings are immutable Unicode sequences. I index with positive or negative positions and slice with start, stop and step, where stop is exclusive. Methods return new strings rather than changing the original. I format with f-strings and join many pieces with `str.join`, which is faster than repeated concatenation."

**Follow-ups:**
- *`str` vs `bytes`?* `str` is text (Unicode code points); `bytes` is raw 8-bit data. Convert with `s.encode("utf-8")` and `b.decode("utf-8")`.
- *What are t-strings?* Python 3.14 template strings (`t"Hi {name}"`) return a `Template` object that keeps the literal text and the values separate, so a library can escape the values safely (for HTML or SQL) before combining them.

---

### Q05. Truthiness, `None`, and how `and` / `or` work

**Short answer:** Every object is either "truthy" or "falsy" when used in an `if` or `while`. Falsy values are `False`, `None`, zero (`0`, `0.0`), and **empty** containers (`""`, `[]`, `{}`, `set()`, `()`); almost everything else is truthy. `None` is Python's single "no value" object; test it with `is None`. `and`/`or` **short-circuit** and return one of their **operands**, not necessarily `True`/`False`.

**How it works:**
- `if x:` calls `bool(x)`, which uses the object's `__bool__` (or `__len__`, where length 0 means falsy).
- `a or b`: if `a` is truthy, return `a` (and don't evaluate `b`); otherwise return `b`.
- `a and b`: if `a` is falsy, return `a`; otherwise return `b`.
- `None` is a singleton (there is exactly one), so `x is None` is both correct and fast.

**Example:**
```python
def display_name(user):
    return user.get("nickname") or user.get("name") or "Anonymous"

print(display_name({"nickname": "", "name": "Asha"}))   # Asha
print(display_name({}))                                 # Anonymous

retries = 0
timeout = retries or 3
print(timeout)                                          # 3  ← surprise
timeout = 3 if retries is None else retries
print(timeout)                                          # 0
```

**What happens, step by step:**
1. First call: `user.get("nickname")` is `""` → falsy, so `or` moves on. `user.get("name")` is `"Asha"` → truthy, so the whole expression returns `"Asha"` and `"Anonymous"` is never evaluated.
2. Second call: both lookups return `None` (falsy), so the last operand `"Anonymous"` is returned.
3. `retries or 3`: `retries` is `0`, which is falsy, so `3` is returned, even though 0 was a valid, deliberate value.
4. The explicit `is None` check only falls back when the value is really missing, so `timeout` is `0`.

**Common mistake → fix:** using `or` for defaults when `0`, `""` or `[]` are valid values. Use `x if x is not None else default`. Also: never write `if x == None`; use `if x is None` (a class could override `==`).

**Interview answer:** "Python treats `None`, `False`, zero and empty containers as falsy and nearly everything else as truthy. `and` and `or` short-circuit and return one of their operands, which makes `a or default` a handy idiom, but it's wrong when 0 or an empty string is a valid value; then I check `is None` explicitly. `None` is a singleton, so identity comparison is the right test."

**Follow-ups:**
- *Can my own class be falsy?* Yes: define `__bool__` (or `__len__`).
- *`if not items:` vs `if len(items) == 0:`?* Same result for lists; the first is the idiomatic style (PEP 8).

---

### Q06. Control flow: `if`, `for`, `while`, `range`, `break`, `continue` and loop `else`

**Short answer:** `if / elif / else` chooses a branch. `for` loops over **any iterable** (list, string, dict, file, `range`), one item at a time. `while` repeats as long as a condition is true. `break` exits the loop, `continue` skips to the next item. A loop can have an `else` block that runs **only if the loop finished without `break`**, which is handy for "search, and do something if not found".

**How it works:**
- `range(start, stop, step)` produces numbers lazily, with `stop` excluded: `range(2, 10, 3)` → 2, 5, 8.
- Python uses indentation (4 spaces by convention) to mark blocks; there are no braces.
- The loop `else` pairs with `break`: think of it as "no break".

**Example:**
```python
def find_first_negative(nums):
    for i, n in enumerate(nums):
        if n == 0:
            continue
        if n < 0:
            print("found", n, "at", i)
            break
    else:
        print("no negatives")

find_first_negative([3, 0, -2, 5])
find_first_negative([1, 2])
```

```flow
trace: find_first_negative([3, 0, -2, 5])
i=0, n=**3** > Not zero, not negative, so the loop moves on to the next item.
i=1, n=**0** > continue skips the rest of the body for this item.
i=2, n=**-2** > Negative: print "found -2 at 2", then break leaves the loop immediately.
else block **skipped** > The loop ended through break, so the "no break" else does not run. Item 5 is never looked at.
```

**What happens, step by step:**
1. With `[3, 0, -2, 5]`, the trace above prints `found -2 at 2` and the `else` is skipped.
2. With `[1, 2]`, neither item is zero or negative. The loop runs to the end without `break`, so the `else` runs and prints `no negatives`.

**Common mistake → fix:** changing a list while looping over it.
```python
nums = [1, -2, -3, 4]
for n in nums:
    if n < 0:
        nums.remove(n)        # ❌ shifts items left; -3 is skipped → [1, -3, 4]
nums = [n for n in nums if n >= 0]   # ✅ build a new list → [1, 4]
```
Removing `-2` moves `-3` into the slot the loop just visited, so the loop's internal index jumps past it.

**Interview answer:** "`for` iterates over any iterable, `while` repeats on a condition, and `break` and `continue` exit or skip. `range` generates numbers lazily with an exclusive stop. A loop's `else` runs only if the loop wasn't broken out of, which is clean for search loops. I avoid mutating a list while iterating over it and build a new list instead."

**Follow-ups:**
- *Is there a `do-while` or `switch`?* No `do-while` (use `while True: … if cond: break`). `match` (3.10+) is structural pattern matching, more powerful than a switch (see Q25).
- *How do I loop with an index?* `for i, item in enumerate(items):`, not `range(len(items))`.

---

### Q07. What is a function? (`def`, `return`, docstrings)

**Short answer:** A function is a named, reusable block of code that takes **parameters** and can **return** a value. You define it with `def`. If it reaches the end without `return`, it returns `None`. Functions are objects too: you can store them in variables, pass them to other functions and return them, which is what makes decorators and callbacks possible.

**How it works:**
1. `def` runs when Python reaches it: it creates a function object and binds the name. The body does **not** run yet.
2. Calling `f(args)` creates a new **frame** (a workspace with its own local names), binds the arguments to the parameters, and runs the body.
3. `return value` ends the call and hands back the value; the frame is discarded.
4. The first string in the body is the **docstring**, available as `f.__doc__` and shown by `help(f)`.

**Example:**
```python
def apply_discount(price, percent=10):
    """Return price reduced by percent (default 10)."""
    if percent < 0:
        return None
    return round(price * (1 - percent / 100), 2)

print(apply_discount(200))          # 180.0
print(apply_discount(200, 25))      # 150.0
print(apply_discount(200, -5))      # None
pricing = apply_discount            # a function is an object
print(pricing(50, percent=50))      # 25.0
```

**What happens, step by step:**
1. `def` creates the function object; nothing is printed.
2. `apply_discount(200)`: `price=200`, `percent` uses its default `10`. `200 * 0.9` → `180.0` is returned.
3. `apply_discount(200, 25)`: `percent=25` → `150.0`.
4. `apply_discount(200, -5)`: the guard hits `return None` and the rest is skipped.
5. `pricing = apply_discount` binds a second name to the **same** function object; calling it works the same way, here with a keyword argument.

**Common mistake → fix:** forgetting `return`.
```python
def total(items):
    sum(items)            # ❌ computes the value, then throws it away → returns None
def total(items):
    return sum(items)     # ✅
```
`x = total([1, 2])` with the first version silently gives `None`, and the error appears later, far from the cause (for example `None + 1` → `TypeError`).

**Interview answer:** "A function is defined with `def`, takes parameters and returns a value; without an explicit return it returns `None`. Each call gets its own frame of local variables. Functions are first-class objects, so I can pass them around, store them and return them, which is the basis of callbacks, `sorted(key=…)` and decorators."

**Follow-ups:**
- *Can a function return several values?* It returns one tuple: `return lo, hi` → the caller unpacks `a, b = f()`.
- *What is a pure function?* One whose output depends only on its inputs and which has no side effects; easy to test and safe to cache.

---

### Q08. How do you read and write files?

**Short answer:** Use `open(path, mode, encoding=...)` inside a `with` block so the file is **always closed**, even on errors. Modes: `"r"` read (default), `"w"` write (truncates!), `"a"` append, `"x"` create-only, add `"b"` for binary. For text, always pass `encoding="utf-8"`. Iterate over a file object to read it **line by line** without loading it all into memory. `pathlib.Path` is the modern way to build paths.

**How it works:** `open` returns a file object. Reading or writing goes through a buffer; `close()` flushes the buffer to disk and releases the operating-system handle. `with` calls `close()` automatically when the block ends (see Q36 on context managers).

**Example:**
```python
from pathlib import Path

log = Path("data") / "app.log"
log.parent.mkdir(exist_ok=True)

with open(log, "w", encoding="utf-8") as f:
    f.write("INFO start\n")
    f.write("ERROR disk full\n")

errors = 0
with open(log, encoding="utf-8") as f:
    for line in f:                       # one line at a time
        if line.startswith("ERROR"):
            errors += 1
print(errors)                            # 1
print(log.read_text(encoding="utf-8").splitlines())   # ['INFO start', 'ERROR disk full']
```

**What happens, step by step:**
1. `Path("data") / "app.log"` builds `data/app.log` (correct separator on Windows and Linux). `mkdir(exist_ok=True)` creates the folder if missing.
2. Opening with `"w"` creates the file (or empties it if it exists). Two lines are written into a buffer.
3. Leaving the `with` block closes the file, which flushes both lines to disk.
4. The read loop gets `"INFO start\n"` then `"ERROR disk full\n"`; only the second starts with `ERROR`, so `errors` is `1`.
5. `read_text` reads the whole file at once (fine for small files) and `splitlines()` removes the newlines.

**Common mistake → fix:**
```python
f = open("report.csv", "w")
f.write(data)              # ❌ if write raises, close() never runs; data may stay in the buffer
f.close()
with open("report.csv", "w", encoding="utf-8", newline="") as f:   # ✅ always closed
    f.write(data)
```
Also: opening with `"w"` when you meant `"a"` silently erases the existing file.

**Interview answer:** "I open files with a `with` statement so they're closed even if an exception happens, pass an explicit encoding for text, and pick the mode carefully, because `w` truncates. For large files I iterate line by line so memory stays constant, and I use `pathlib` for paths. For CSV and JSON I use the `csv` and `json` modules rather than parsing by hand."

**Follow-ups:**
- *What's the default encoding?* It used to depend on the operating system (a common Windows bug). Python 3.15 makes UTF-8 the default when no encoding is given (PEP 686), but passing `encoding="utf-8"` is still the clearest.
- *How do you read JSON?* `with open(p, encoding="utf-8") as f: data = json.load(f)`.

---
## 3. Core data types & memory

### Q09. What is the difference between a list, tuple, set and dict?

**Short answer:** A **list** is an ordered, changeable sequence (`[1, 2, 2]`). A **tuple** is an ordered sequence that can't be changed after creation (`(12.5, 77.6)`). A **set** holds unique items with no order (`{"a", "b"}`) and answers "is x in here?" very fast. A **dict** maps unique keys to values (`{"id": 7}`), keeps insertion order (guaranteed since 3.7) and looks up by key very fast.

**How it works:** Sets and dicts are **hash tables**: Python computes `hash(key)` to jump straight to a slot, so lookup is O(1) on average (constant time, no matter how many items). A list or tuple has to compare items one by one, O(n). That's why set and dict keys must be **hashable** (see Q15).

| Type | Ordered | Changeable | Duplicates | `x in c` | Typical use |
|---|---|---|---|---|---|
| `list` | yes | yes | yes | O(n) | sequence of results, a queue of work |
| `tuple` | yes | no | yes | O(n) | fixed record, multiple return values, dict key |
| `set` | no | yes | no | O(1) average | removing duplicates, membership tests |
| `dict` | yes (insertion) | yes | keys no | O(1) average by key | lookup by ID, counting, caching |

**Example:**
```python
doc_ids = ["a1", "b2", "a1", "c3"]
unique = set(doc_ids)                    # {'a1', 'b2', 'c3'} (order not guaranteed)
point = (12.5, 77.6)                     # tuple: fixed pair, usable as a dict key
status = {"job-1": "DONE", "job-2": "RUNNING"}
locations = {point: "warehouse"}

print(len(doc_ids), len(unique))         # 4 3
print("job-1" in status)                 # True: one hash lookup
print(status.get("job-9", "UNKNOWN"))    # UNKNOWN
```

**What happens, step by step:**
1. `set(doc_ids)` hashes each id and keeps one copy of each, so the duplicate `"a1"` disappears: 4 items become 3.
2. `point` is a tuple of two floats; because it is immutable and its items are hashable, it can be a dict key.
3. `"job-1" in status` hashes `"job-1"`, jumps to its slot and finds it: `True`, without scanning other keys.
4. `status.get("job-9", "UNKNOWN")` finds nothing and returns the default instead of raising `KeyError`.

**How to choose:** need order and duplicates → list; a fixed record or a key → tuple; uniqueness or fast "contains" → set; lookup by a key → dict.

**Common mistake → fix:** checking membership in a big list inside a loop.
```python
blocked = load_blocked_ids()          # list of 100,000 ids
clean = [u for u in users if u not in blocked]       # ❌ O(n) scan per user
blocked = set(load_blocked_ids())
clean = [u for u in users if u not in blocked]       # ✅ O(1) per user
```

**Interview answer:** "Lists are ordered and mutable, tuples are ordered and immutable, sets hold unique unordered items, and dicts map keys to values in insertion order. Sets and dicts are hash tables, so membership and key lookup are O(1) on average, versus O(n) for lists. I pick by access pattern: sequence, fixed record, uniqueness or lookup by key."

**Follow-ups:**
- *Why can't a list be a dict key?* It's mutable: if its contents changed after insertion, its hash would change and it would sit in the wrong slot. Lists don't define a hash at all.
- *Is a tuple always hashable?* Only if every item is: `(1, [2])` raises `TypeError: unhashable type: 'list'`.

---

### Q10. Working with dictionaries: `get`, `setdefault`, `defaultdict` and `Counter`

**Short answer:** Reading a missing key with `d[key]` raises `KeyError`; `d.get(key, default)` returns a default instead. For "group items" or "count items" patterns, `collections.defaultdict` creates a default value automatically for a missing key, and `collections.Counter` counts things in one line. Loop over pairs with `for k, v in d.items()`.

**How it works:**
- `d.get(k, x)` never changes the dict.
- `d.setdefault(k, x)` returns `d[k]` if present; otherwise it **inserts** `k: x` and returns `x`.
- `defaultdict(list)` calls `list()` to make `[]` the first time a missing key is read.
- `Counter(iterable)` is a dict of item → count, with helpers like `most_common(n)`.

**Example:**
```python
from collections import defaultdict, Counter

orders = [("asha", "pen"), ("ravi", "ink"), ("asha", "pad")]

by_user = defaultdict(list)
for user, item in orders:
    by_user[user].append(item)
print(dict(by_user))          # {'asha': ['pen', 'pad'], 'ravi': ['ink']}

words = "the cat and the hat".split()
counts = Counter(words)
print(counts["the"], counts["dog"])     # 2 0
print(counts.most_common(1))            # [('the', 2)]

prices = {"pen": 10, "ink": 25}
for name, price in prices.items():
    print(name, price)
```

**What happens, step by step:**
1. First order `("asha", "pen")`: `"asha"` is missing, so `defaultdict` creates `[]` for it, then `.append("pen")` makes `["pen"]`.
2. `("ravi", "ink")`: same, `"ravi"` → `["ink"]`.
3. `("asha", "pad")`: `"asha"` exists, so `"pad"` is appended → `["pen", "pad"]`.
4. `Counter(words)` counts: `the` → 2, `cat` → 1, `and` → 1, `hat` → 1. Reading a missing key (`"dog"`) on a Counter returns `0` (and does not insert it).
5. `prices.items()` yields `("pen", 10)` then `("ink", 25)` in insertion order.

**Common mistake → fix:** changing a dict's size while iterating over it.
```python
for k in cache:
    if expired(k):
        del cache[k]          # ❌ RuntimeError: dictionary changed size during iteration
for k in list(cache):         # ✅ iterate over a snapshot of the keys
    if expired(k):
        del cache[k]
```

**Interview answer:** "For safe reads I use `get` with a default. For grouping I use `defaultdict(list)`, and for counting `Counter`, which also gives `most_common`. I iterate with `.items()`, and I never add or delete keys while iterating; I loop over `list(d)` or build a new dict with a comprehension."

**Follow-ups:**
- *How do you merge dicts?* `merged = a | b` (3.9+), where `b`'s values win on conflicts; `a |= b` updates in place.
- *Is a dict ordered?* Yes, by insertion, guaranteed since 3.7.

---

### Q11. Mutable vs immutable objects, and aliasing

**Short answer:** A **mutable** object can be changed in place (list, dict, set, most custom objects). An **immutable** object can't be changed; any "change" builds a new object (int, float, str, tuple, frozenset, bytes). When two names point to the same mutable object they are **aliases**: a change made through one name is visible through the other.

**How it works:** Assignment copies the *reference*, never the object. Mutating methods (`append`, `update`, `d[k] = v`) change the shared object. Operations on immutable objects (`s += "b"`, `n += 1`) create a new object and **rebind** only the name on the left.

**Example:**
```python
a = [1]
b = a
b.append(2)
print(a)            # [1, 2]

x = "a"
y = x
y += "b"
print(x, y)         # a ab
```

```flow
trace: Two names, one object
a = [1]   →   a points to **[1]** > One list object is created and the name a is bound to it.
b = a   →   a and b point to the same **[1]** > Assignment copies the reference, not the list.
b.append(2)   →   a and b see **[1, 2]** > append changes the one shared list, so a sees it too.
x = "a"; y = x   →   x and y point to **"a"** > Same idea with a string: two names, one object.
y += "b"   →   x is "a", y is **"ab"** > Strings can't change, so += builds a new string and rebinds only y.
```

**What happens, step by step:**
1. `a = [1]`, then `b = a`: one list, two names (`a is b` is `True`).
2. `b.append(2)` mutates that list in place, so printing `a` shows `[1, 2]`.
3. `y = x` makes both names point to the string `"a"`.
4. `y += "b"` can't change `"a"`, so it creates `"ab"` and points `y` at it. `x` still points to `"a"`.

**Common mistake → fix:** sharing a mutable config dict between requests.
```python
DEFAULTS = {"retries": 3}
def handle(request):
    cfg = DEFAULTS            # ❌ alias: the next line changes DEFAULTS for every later request
    cfg["retries"] = 0
def handle(request):
    cfg = {**DEFAULTS, "retries": 0}   # ✅ a new dict per request
```

**Interview answer:** "Mutable objects like lists and dicts can change in place; immutable ones like ints, strings and tuples can't, so operations on them create new objects. Assignment just adds another reference, so two names can alias one mutable object and see each other's changes. In long-running services, shared mutable module-level state is a classic source of cross-request bugs."

**Follow-ups:**
- *Can a tuple change?* The tuple itself can't, but if it holds a list, that list can: `t = ([1],); t[0].append(2)` works.
- *Why is `a += [3]` different from `a = a + [3]`?* `+=` on a list mutates it in place (aliases see it); `a + [3]` builds a new list and rebinds only `a`.

---

### Q12. Why are mutable default arguments dangerous?

**Short answer:** Default values are evaluated **once, when the `def` statement runs**, not on every call. If the default is a mutable object like `[]` or `{}`, every call that uses the default shares **the same object**, so data leaks from one call into the next. Use `None` as the default and create the object inside the function.

**How it works:** Python stores defaults on the function object (`func.__defaults__`). Calling without that argument binds the parameter to the stored object. Appending to it changes the stored object permanently.

**Example:**
```python
def add_tag(tag, tags=[]):        # ❌
    tags.append(tag)
    return tags

print(add_tag("a"))   # ['a']
print(add_tag("b"))   # ['a', 'b']
print(add_tag.__defaults__)       # (['a', 'b'],)
```

```flow
trace: The shared default list
def add_tag(tag, tags=[]) > When def runs, [] is evaluated once and stored in add_tag.__defaults__.
add_tag("a")   →   tags is the stored list   →   **['a']** > The first call appends to the stored default list.
add_tag("b")   →   same stored list   →   **['a', 'b']** > The second call gets the same list, which still holds 'a'.
fix: tags=None, then tags = [] inside > A fresh list is created on every call, so add_tag("b") returns ['b'].
```

**What happens, step by step:**
1. `def` runs once and creates one list, stored as the default.
2. `add_tag("a")` binds `tags` to that list and appends `"a"` → `['a']`.
3. `add_tag("b")` binds `tags` to the **same** list, which already holds `"a"` → `['a', 'b']`.
4. The stored default itself now contains both items, as `__defaults__` shows.

**Fix:**
```python
def add_tag(tag, tags=None):      # ✅ sentinel
    if tags is None:
        tags = []
    tags.append(tag)
    return tags
```
For dataclasses, use `field(default_factory=list)`.

**Interview answer:** "Defaults are evaluated once at function definition, so a mutable default is one shared object across all calls. Mutations accumulate and can leak one user's data into another's in a server. The fix is a `None` sentinel and creating the list or dict inside the function, or `default_factory` in dataclasses."

**Follow-ups:**
- *Is this ever useful?* Rarely, as a crude cache, but `functools.lru_cache` is clearer.
- *Do linters catch it?* Yes: Ruff's `B006` rule (from flake8-bugbear) flags mutable defaults.

---

### Q13. `is` vs `==`, and shallow vs deep copy

**Short answer:** `==` asks "do these have the **same value**?" (it calls `__eq__`). `is` asks "are these the **same object**?" (identity). Use `is` only for singletons like `None`. A **shallow copy** creates a new outer container but shares the objects inside it; a **deep copy** recursively copies everything, so the copy is fully independent.

**How it works:** `list(x)`, `x.copy()`, `x[:]`, `dict(d)` and `copy.copy(x)` are all shallow. `copy.deepcopy(x)` walks the whole structure (and handles cycles). Deep copies are slower and use more memory, so use them only when nested data must be independent.

**Example:**
```python
import copy

orig = [[1, 2], [3]]
s = copy.copy(orig)
s[0].append(9)
print(orig)                 # [[1, 2, 9], [3]]

d = copy.deepcopy(orig)
d[0].append(7)
print(orig, d)              # [[1, 2, 9], [3]] [[1, 2, 9, 7], [3]]

a = [1, 2]; b = [1, 2]
print(a == b, a is b)       # True False
```

```flow
trace: Shallow vs deep copy of [[1, 2], [3]]
orig = [[1, 2], [3]] > One outer list holding two inner lists.
s = copy.copy(orig)   →   new outer list, **same inner lists** > A shallow copy only creates a new outer container.
s[0].append(9)   →   orig is **[[1, 2, 9], [3]]** > s[0] and orig[0] are the same inner list, so the original changes too.
d = copy.deepcopy(orig)   →   new outer **and new inner lists** > A deep copy copies every nested object.
d[0].append(7)   →   orig unchanged > d is fully independent of orig.
```

**What happens, step by step:**
1. `copy.copy(orig)` makes a new outer list whose two slots point to the **same** inner lists as `orig`.
2. `s[0].append(9)` changes the inner list `[1, 2]` that both share, so `orig` shows `[[1, 2, 9], [3]]`.
3. `deepcopy` creates new inner lists too; appending `7` to `d[0]` doesn't touch `orig`.
4. `a` and `b` hold equal values but are two different list objects: `==` is `True`, `is` is `False`.

**Common mistake → fix:** using `is` to compare values.
```python
code = int("1000")
if code is 1000: ...        # ❌ SyntaxWarning; often False (different int objects)
if code == 1000: ...        # ✅
```
CPython caches small ints (-5 to 256) and some strings, so `is` sometimes "works" by accident in tests and fails in production. That cache is an implementation detail; never rely on it.

**Interview answer:** "`==` compares values via `__eq__`, `is` compares identity, and I only use `is` for singletons like `None`. A shallow copy duplicates the outer container but shares nested objects, so changing a nested list through the copy changes the original. `deepcopy` duplicates everything recursively, at a cost in time and memory."

**Follow-ups:**
- *Does `deepcopy` handle cycles?* Yes, it keeps a memo of already-copied objects.
- *Can a class customise copying?* Yes, with `__copy__` and `__deepcopy__`.

---

### Q14. How are arguments passed to functions in Python?

**Short answer:** Python uses **pass by object reference** (also called "pass by assignment"): the parameter becomes a new name for the **same object** the caller passed. If the function **mutates** that object, the caller sees the change. If the function **rebinds** the parameter (`items = [...]`), only the local name moves; the caller is unaffected.

**How it works:** Calling `f(nums)` is like running `items = nums` at the start of the function: one object, two names (one in each frame). It's not "pass by value" (no copy is made) and not C++-style "pass by reference" (you can't make the caller's variable point to something else).

**Example:**
```python
def mutate(items):
    items.append(3)

def rebind(items):
    items = [99]

nums = [1, 2]
mutate(nums)
rebind(nums)
print(nums)      # [1, 2, 3]
```

**What happens, step by step:**
1. `mutate(nums)`: `items` and `nums` point to the same list. `append(3)` changes it → `[1, 2, 3]`.
2. `rebind(nums)`: `items` starts pointing at that list, then `items = [99]` points the local name at a brand-new list. `nums` still points to `[1, 2, 3]`.
3. When `rebind` returns, the `[99]` list has no names left and is freed.

**Common mistake → fix:** a function that "cleans" its input in place by surprise.
```python
def normalise(tags):
    tags.sort()                       # ❌ the caller's list is now reordered
    return tags
def normalise(tags):
    return sorted(tags)               # ✅ returns a new list, input untouched
```

**Interview answer:** "Python passes references to objects. The parameter is a new name for the caller's object, so mutating it is visible to the caller, but reassigning the parameter only changes the local name. To avoid surprises I don't mutate arguments unless that's the documented purpose, and I return new objects instead."

**Follow-ups:**
- *What about ints and strings?* Same mechanism, but they're immutable, so the function can't change them; it can only rebind its local name.

---

### Q15. How does hashing work, and what makes an object hashable?

**Short answer:** A **hash** is an integer computed from an object's value (`hash("abc")`). Dicts and sets use it to decide where to store and find a key. An object is **hashable** if its hash never changes during its lifetime and it has an `__eq__` that agrees with it: **equal objects must have equal hashes**. Immutable built-ins (int, str, tuple of hashables, frozenset) are hashable; list, dict and set are not.

**How it works:**
1. `hash(key)` turns the key into an integer.
2. The integer (reduced to the table size) picks a slot in the internal table.
3. Different keys can land on the same slot (a **collision**), so Python compares candidates with `==` to find the exact key.
4. If a key's hash changed after it was stored, the dict would look in the wrong slot and never find it. That's why mutable objects are not hashable.

**Example:**
```python
from dataclasses import dataclass

@dataclass(frozen=True)          # frozen → immutable → __hash__ is generated
class DocKey:
    tenant: str
    doc_id: str

cache = {DocKey("t1", "d9"): "summary..."}
print(cache[DocKey("t1", "d9")])            # summary...
print(hash(DocKey("t1", "d9")) == hash(DocKey("t1", "d9")))   # True
```

**What happens, step by step:**
1. `DocKey("t1", "d9")` is created. Because it's frozen, the dataclass generates `__eq__` and `__hash__` from the fields.
2. Storing it in `cache` computes its hash and places the entry in a slot.
3. A **new** `DocKey("t1", "d9")` object has the same field values → the same hash → Python goes to the same slot, `==` confirms a match, and the value is returned.

**Common mistake → fix:** overriding `__eq__` without `__hash__`.
```python
class User:
    def __init__(self, uid): self.uid = uid
    def __eq__(self, other): return self.uid == other.uid
{User(1)}     # ❌ TypeError: unhashable type: 'User' (defining __eq__ sets __hash__ to None)

class User:
    def __init__(self, uid): self.uid = uid
    def __eq__(self, other): return isinstance(other, User) and self.uid == other.uid
    def __hash__(self): return hash(self.uid)      # ✅ consistent with __eq__
```

**Interview answer:** "Dicts and sets hash a key to find its slot, then use equality to confirm the exact key among collisions. Hashable objects need a hash that never changes and that agrees with equality. That's why immutable types are hashable and lists aren't, and why defining `__eq__` without `__hash__` makes a class unhashable."

**Follow-ups:**
- *Why does `hash("abc")` differ between runs?* String hashing is randomised per process (to resist denial-of-service attacks that force collisions). Set `PYTHONHASHSEED` to make it repeatable.
- *What's the worst-case lookup cost?* O(n) if many keys collide, but with good hashes it's O(1) on average.

---

### Q16. Comprehensions vs generator expressions

**Short answer:** A **comprehension** builds a whole collection at once in one readable expression: `[x * x for x in nums if x > 0]` (list), `{…}` (set) or `{k: v for …}` (dict). A **generator expression** uses parentheses, `(x * x for x in nums)`, and produces items **lazily**, one at a time on demand, so it uses almost no memory but can be consumed only once.

**How it works:** A comprehension runs the loop immediately and stores every result. A generator expression creates a generator object that remembers where it is; each `next()` runs the loop just far enough to produce the next item.

**Example:**
```python
squares = [x * x for x in range(5)]                 # [0, 1, 4, 9, 16]
evens = {x for x in range(10) if x % 2 == 0}        # {0, 2, 4, 6, 8}
by_id = {u["id"]: u["name"] for u in [{"id": 1, "name": "Asha"}]}   # {1: 'Asha'}

g = (x * x for x in range(3))
print(next(g), next(g), next(g))     # 0 1 4
print(list(g))                       # []   ← already used up

total = sum(x * x for x in range(10_000_000))   # no 10-million-item list in memory
```

```flow
trace: A generator expression produces values on demand
g = (x * x for x in range(3))   →   **nothing computed yet** > Only a generator object is created. It stores how to produce the next value.
next(g)   →   **0** > The loop runs once (x = 0) and pauses.
next(g)   →   **1** > It resumes where it paused (x = 1) and pauses again.
next(g)   →   **4** > x = 2, the last value.
list(g)   →   **[]** > The generator is exhausted. Asking again gives nothing: generators are single-use.
```

**What happens, step by step:**
1. The list, set and dict comprehensions run straight away and build their full results.
2. `g` holds no values yet. Each `next(g)` computes exactly one value: 0, then 1, then 4.
3. `list(g)` finds the generator already exhausted and returns `[]`.
4. `sum(…)` pulls ten million values one at a time; memory stays flat because no list is stored.

**How to choose:** need to index, get the length or loop more than once → list comprehension. Only stream once into `sum`, `any`, `max`, `"".join` or a file → generator expression.

**Common mistake → fix:** iterating a generator twice.
```python
rows = (parse(line) for line in f)
count = sum(1 for _ in rows)
valid = [r for r in rows if r.ok]     # ❌ always [] — rows was consumed by the count
rows = [parse(line) for line in f]    # ✅ a list if you need two passes
```

**Interview answer:** "Comprehensions build the whole list, set or dict eagerly; generator expressions yield items lazily with constant memory but can only be iterated once. I use comprehensions when I need the collection itself or several passes, and generator expressions when streaming into something like `sum` or `any`. For complex logic I switch to a normal loop for readability."

**Follow-ups:**
- *Do comprehension variables leak?* No, in Python 3 the loop variable is local to the comprehension.
- *Is a comprehension faster than a loop with append?* Usually a little, because it avoids looking up `append` each time, but readability is the main reason.

---

### Q17. How does Python manage memory? (reference counting and garbage collection)

**Short answer:** CPython keeps a **reference count** on every object: how many names, containers or other objects point to it. When the count drops to **zero**, the object is freed immediately. Reference counting can't free **cycles** (objects that point to each other), so a separate **cyclic garbage collector** periodically finds groups of objects that nothing else can reach and frees them.

**How it works:**
- Every new reference (assignment, adding to a list, passing as an argument) increases the count; every removed reference (`del`, rebinding, a function returning) decreases it.
- The cycle collector is **generational**: new objects are checked often, long-lived ones less often, because most objects die young.
- `weakref` lets you refer to an object **without** increasing its count, useful for caches and observers.
- `__slots__` removes the per-instance `__dict__`, saving memory when you have millions of small objects.

**Example:**
```python
import sys, gc

class Node:
    pass

a = Node()
print(sys.getrefcount(a))   # e.g. 2 (a + the temporary argument to getrefcount)
b = a
print(sys.getrefcount(a))   # one more than before
del a, b                    # count → 0 → freed now

x, y = Node(), Node()
x.peer, y.peer = y, x       # a cycle
del x, y                    # counts stay at 1 each → not freed yet
print(gc.collect() > 0)     # True: the collector found and freed the cycle
```

```flow
trace: Reference counts, and the cycle they can't free
a = Node()   →   refcount **1** > One name refers to the object.
b = a   →   refcount **2** > Each new reference adds one.
del a, b   →   refcount **0**, freed immediately > CPython frees the object the moment its count reaches zero.
x.peer = y; y.peer = x; del x, y   →   counts stay **1** > Each object keeps the other alive, so reference counting alone never frees them.
gc.collect()   →   unreachable cycle **freed** > The cycle collector sees that nothing outside the pair refers to them.
```

**What happens, step by step:**
1. `getrefcount` usually shows one more than you expect, because passing `a` to it creates a temporary reference. The docs warn not to rely on exact values (immortal objects such as `None` report huge counts), so treat it as a teaching tool.
2. `b = a` adds one. `del a, b` removes both names; the count hits 0 and the object is freed at once.
3. The two `Node`s in the cycle each hold the other, so after `del x, y` each count is still 1 even though your code can't reach them.
4. `gc.collect()` runs the cycle collector, which detects the unreachable pair and frees it. It returns the number of unreachable objects found, so the comparison prints `True`.

**Common mistake → fix:** a cache that grows forever.
```python
_cache = {}
def get_user(uid):
    if uid not in _cache:
        _cache[uid] = load_user(uid)     # ❌ every user ever seen stays in memory
    return _cache[uid]

from functools import lru_cache
@lru_cache(maxsize=10_000)               # ✅ bounded: least-recently-used entries are evicted
def get_user(uid): return load_user(uid)
```

**Interview answer:** "CPython frees objects as soon as their reference count drops to zero, which makes memory release predictable. A generational cycle collector handles reference cycles that refcounting can't free. In practice, memory problems usually come from references we keep by accident, such as unbounded caches or global lists, so I bound caches, use `weakref` where appropriate and `__slots__` for very many small objects."

**Follow-ups:**
- *Does `del x` free the object?* It removes one reference. The object is freed only when the count reaches zero.
- *How much does `__slots__` save?* It removes the per-instance dict, which typically saves tens of bytes per object; measure with `tracemalloc` for your case.
- *Is refcounting the same in the free-threaded build?* It uses a modified scheme (biased reference counting) so threads can update counts safely without a global lock; behaviour from Python code looks the same.

---
## 4. Functions, scope, closures, decorators

### Q18. `*args` and `**kwargs`, keyword-only and positional-only parameters

**Short answer:** `*args` collects any **extra positional** arguments into a tuple; `**kwargs` collects any **extra keyword** arguments into a dict. Parameters placed after `*` (or after `*args`) are **keyword-only**: callers must write their name. Parameters before `/` are **positional-only**: callers can't use their name. At a call site, `*seq` and `**mapping` do the reverse and *unpack* values into arguments.

**How it works:** Python binds arguments in this order: positional arguments fill parameters left to right; leftovers go into `*args`; keyword arguments are matched by name; unknown names go into `**kwargs`. Anything left without a value and without a default raises `TypeError`.

**Example:**
```python
def f(a, /, b, *args, c, **kwargs):
    print(a, b, args, c, kwargs)

f(1, 2, 3, 4, c=5, d=6)       # 1 2 (3, 4) 5 {'d': 6}
f(1, b=2, c=3)                # 1 2 () 3 {}
# f(a=1, b=2, c=3)            # TypeError: a is positional-only
# f(1, 2, 3)                  # TypeError: missing keyword-only argument 'c'

def send(to, *, dry_run=False): ...
send("a@x.com", dry_run=True)        # ✅ the meaning is obvious at the call site

nums = [1, 2]
opts = {"c": 9}
f(*nums, **opts)              # 1 2 () 9 {}
```

```flow
trace: Binding f(1, 2, 3, 4, c=5, d=6) to def f(a, /, b, *args, c, **kwargs)
positional 1, 2   →   a=**1**, b=**2** > Positional arguments fill the named parameters from left to right.
leftover 3, 4   →   args=**(3, 4)** > Extra positional arguments are collected into a tuple.
c=5   →   c=**5** > c comes after *args, so it can only be passed by name.
d=6   →   kwargs=**{'d': 6}** > Keyword arguments with no matching parameter go into the dict.
```

**What happens, step by step:**
1. The first call binds as in the trace and prints `1 2 (3, 4) 5 {'d': 6}`.
2. `f(1, b=2, c=3)`: no extras, so `args` is `()` and `kwargs` is `{}`.
3. `f(a=1, …)` fails because `a` is before `/`; `f(1, 2, 3)` fails because `c` has no default and wasn't given by name.
4. `f(*nums, **opts)` unpacks to `f(1, 2, c=9)`.

**Common mistake → fix:** boolean flags passed positionally. `send(email, True)` — what is `True`? Make flags keyword-only with `*` so callers must write `dry_run=True`.

**Interview answer:** "`*args` gathers extra positional arguments into a tuple and `**kwargs` gathers extra keyword arguments into a dict; at a call site the same symbols unpack. A bare `*` makes the following parameters keyword-only, which I use for flags and options to keep calls readable, and `/` makes the earlier ones positional-only, so I can rename them later without breaking callers."

**Follow-ups:**
- *Why use positional-only?* Parameter names become part of your public API once callers use them by keyword; `/` keeps you free to rename them. Many built-ins (like `len(obj, /)`) work this way.
- *How do wrappers forward everything?* `def wrapper(*args, **kwargs): return func(*args, **kwargs)`.

---

### Q19. LEGB scope, `global` and `nonlocal`

**Short answer:** When you use a name, Python looks for it in four places in order: **L**ocal (the current function), **E**nclosing (outer functions), **G**lobal (the module), **B**uilt-ins (`len`, `print`). The first match wins; if none matches you get `NameError`. **Assigning** to a name inside a function makes it local for the *whole* function, unless you declare it `global` (module level) or `nonlocal` (an enclosing function's variable).

**How it works:** Python decides which names are local at **compile time** by looking for assignments in the function body. That's why reading a global and later assigning to it in the same function fails: the name is local everywhere in that function, including before the assignment.

**Example:**
```python
count = 0                          # Global

def outer():
    total = 0                      # Enclosing (for inner)
    def inner():
        nonlocal total             # rebind outer's total
        total += 1
        return len("abc")          # len is a Built-in
    inner(); inner()
    return total

print(outer())                     # 2

def broken():
    count += 1                     # ❌ UnboundLocalError
```

**What happens, step by step:**
1. `outer()` sets its local `total = 0` and defines `inner`.
2. Each `inner()` call: `nonlocal total` tells Python that `total` means `outer`'s variable, so `total += 1` updates it. After two calls it's `2`.
3. `len` isn't local, enclosing or global, so Python finds it in built-ins.
4. In `broken`, the assignment makes `count` local to `broken`. `count += 1` first *reads* the local `count`, which has no value yet → `UnboundLocalError: cannot access local variable 'count'`.

**Common mistake → fix:** reaching for `global` to share state.
```python
def increment():
    global count
    count += 1             # works, but hidden shared state; not thread-safe
class Counter:             # ✅ explicit state you can pass around and test
    def __init__(self): self.count = 0
    def increment(self): self.count += 1
```

**Interview answer:** "Python resolves names Local, Enclosing, Global, then Built-ins. Any assignment in a function makes that name local for the whole function, which is why `x += 1` on a global raises `UnboundLocalError`. `global` and `nonlocal` let me rebind outer names, but I prefer passing values in and returning them, or using an object, over shared global state."

**Follow-ups:**
- *Do you need `nonlocal` to mutate an outer list?* No. `items.append(x)` doesn't rebind the name; `nonlocal` is only needed for assignment.
- *Does an `if` or `for` block create a scope?* No. Only modules, functions, classes and comprehensions do.

---

### Q20. What is a closure, and what is the late-binding trap?

**Short answer:** A **closure** is an inner function that **remembers variables from the function that created it**, even after that outer function has returned. It's how you build small configured functions (`make_multiplier(3)`) without a class. Closures capture the **variable**, not its value at the moment of creation, so functions created in a loop all see the variable's **final** value (the late-binding trap).

**How it works:** When an inner function uses an outer variable, Python stores that variable in a **cell** shared by the outer function and the inner function (`fn.__closure__`). The inner function reads the cell's *current* value each time it runs.

**Example:**
```python
def make_retry(limit):
    def should_retry(attempt):
        return attempt < limit          # limit is remembered
    return should_retry

retry3 = make_retry(3)
print(retry3(2), retry3(3))             # True False

funcs = [lambda: i for i in range(3)]
print([f() for f in funcs])             # [2, 2, 2]

funcs = [lambda i=i: i for i in range(3)]
print([f() for f in funcs])             # [0, 1, 2]
```

```flow
trace: The late-binding trap
funcs = [lambda: i for i in range(3)] > Three functions are created. Each one refers to the variable i, not to a copy of its value.
loop ends   →   i is **2** > Nobody has called the functions yet; by now the loop variable holds its last value.
[f() for f in funcs]   →   **[2, 2, 2]** > Each call looks up i at call time and finds 2.
lambda i=i: i   →   **[0, 1, 2]** > A default value is evaluated when the lambda is created, so each function keeps its own value.
```

**What happens, step by step:**
1. `make_retry(3)` returns `should_retry`; `make_retry` has finished, but `limit = 3` lives on in the closure cell.
2. `retry3(2)` → `2 < 3` → `True`; `retry3(3)` → `False`.
3. The first list of lambdas all share one variable `i`; when they're called it's `2`, so each returns `2`.
4. `i=i` copies the current value into each lambda's own default parameter at creation time, giving `[0, 1, 2]`. `functools.partial` is another clean fix.

**Common mistake → fix:** registering callbacks in a loop.
```python
for name in ["save", "load"]:
    buttons[name].on_click(lambda: run(name))            # ❌ both buttons run "load"
for name in ["save", "load"]:
    buttons[name].on_click(lambda name=name: run(name))  # ✅ each keeps its own name
```

**Interview answer:** "A closure is a nested function that keeps access to variables from its enclosing scope after that scope has returned. Python captures the variable itself, so lambdas created in a loop all see the loop variable's final value. I fix that by binding the current value as a default argument or with `functools.partial`."

**Follow-ups:**
- *Closure vs class?* A closure is lighter for one behaviour with a little state; a class is clearer when there are several methods or the state is complex.
- *How do you change a captured variable?* Declare it `nonlocal` inside the inner function.

---

### Q21. What is a decorator?

**Short answer:** A **decorator** is a function that takes a function and returns a replacement function, usually a **wrapper** that adds behaviour before and/or after calling the original (logging, timing, retries, caching, access checks). Writing `@timed` above `def fetch` is just shorthand for `fetch = timed(fetch)`. Decorators work because functions are objects you can pass and return.

**How it works:**
1. Python runs `def fetch` and creates the function object.
2. It immediately calls `timed(fetch)`, **once**, at definition time.
3. Whatever `timed` returns (the wrapper) is bound to the name `fetch`.
4. Every later call to `fetch(...)` actually calls the wrapper, which calls the original that it captured in a closure.

**Example:**
```python
import functools, time

def timed(func):
    @functools.wraps(func)                 # copy name, docstring etc. onto the wrapper
    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        try:
            return func(*args, **kwargs)
        finally:
            print(f"{func.__name__} took {time.perf_counter() - start:.3f}s")
    return wrapper

@timed
def fetch(n):
    time.sleep(0.1)
    return n * 2

print(fetch(21))
print(fetch.__name__)
```

```flow
sequence: Calling a decorated function
actors: Caller, wrapper, fetch (original)
Caller -> wrapper: fetch(21)
> The name fetch now refers to the wrapper, because @timed ran fetch = timed(fetch) when the module loaded.
wrapper -> wrapper: start = perf_counter()
> Code before the call runs first.
wrapper -> fetch (original): func(21)
fetch (original) --> wrapper: returns 42
wrapper -> wrapper: finally: print "fetch took 0.100s"
> The finally block runs whether the original returned or raised.
wrapper --> Caller: 42
```

**What happens, step by step:**
1. When the module loads, `@timed` runs `timed(fetch)` once and rebinds `fetch` to `wrapper`.
2. `fetch(21)` calls `wrapper(21)`; it records the start time.
3. The wrapper calls the original `fetch(21)`, which sleeps 0.1 s and returns `42`.
4. The `finally` block prints `fetch took 0.100s` (roughly), then `42` is returned and printed.
5. `fetch.__name__` prints `fetch`, thanks to `functools.wraps`. Without it, it would print `wrapper`, which confuses logs, debuggers and tools.

**Common mistake → fix:** forgetting to return the result.
```python
def wrapper(*args, **kwargs):
    func(*args, **kwargs)           # ❌ every decorated function now returns None
def wrapper(*args, **kwargs):
    return func(*args, **kwargs)    # ✅
```

**Interview answer:** "A decorator is a callable that takes a function and returns a new one, usually a wrapper that adds behaviour around the call. The `@` syntax is just `f = deco(f)`, applied once at definition time. I always use `functools.wraps` so the wrapper keeps the original name and docstring, and I forward `*args` and `**kwargs` and return the result."

**Follow-ups:**
- *Built-in decorators?* `@property`, `@classmethod`, `@staticmethod`, `@functools.cache`, `@dataclass`.
- *Decorating `async def`?* The wrapper must be `async def` too and `await func(...)`, otherwise it returns an un-awaited coroutine.
- *Order of stacked decorators?* `@a` above `@b` means `f = a(b(f))`: `b` wraps first, `a` is the outer layer.

---

### Q22. How do you write a decorator that takes arguments?

**Short answer:** A decorator with arguments needs **three levels**: an outer function that takes the arguments and returns a decorator; the decorator, which takes the function and returns a wrapper; and the wrapper, which runs on each call. `@retry(times=3)` first *calls* `retry(times=3)`, and the result is then applied to the function.

**How it works:** `@retry(times=3)` above `def call_api` means `call_api = retry(times=3)(call_api)`. The arguments live in the outer closure, so every wrapper call can read them.

**Example:**
```python
import functools, time, random

def retry(times=3, exceptions=(TimeoutError,), base_delay=0.5):
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(1, times + 1):
                try:
                    return func(*args, **kwargs)
                except exceptions:
                    if attempt == times:
                        raise                         # give up: re-raise the last error
                    delay = base_delay * 2 ** (attempt - 1) + random.uniform(0, 0.1)
                    time.sleep(delay)
        return wrapper
    return decorator

calls = 0
@retry(times=3)
def call_api():
    global calls
    calls += 1
    if calls < 3:
        raise TimeoutError
    return "ok"

print(call_api(), calls)        # ok 3
```

**What happens, step by step:**
1. At definition time `retry(times=3)` returns `decorator`; then `decorator(call_api)` returns `wrapper`, now bound to `call_api`.
2. Call → attempt 1: `call_api` raises `TimeoutError`. It's in `exceptions` and `attempt` (1) isn't 3, so it sleeps about 0.5 s.
3. Attempt 2: raises again → sleeps about 1.0 s (the delay doubles).
4. Attempt 3: `calls` is 3, so it returns `"ok"`, which the wrapper returns. Output: `ok 3`.
5. If attempt 3 had also failed, `raise` would re-raise the error to the caller instead of swallowing it.

**Common mistake → fix:** writing `@retry` without parentheses for a decorator that expects arguments. Then `retry(call_api)` treats the function as `times`, returns `decorator`, and calling `call_api()` fails with a confusing `TypeError`. Write `@retry()` or support both forms explicitly.

**Interview answer:** "A parameterised decorator is a function that returns a decorator: `@retry(times=3)` calls `retry` first and applies its result. So there are three levels: the argument function, the decorator that receives the function, and the wrapper that runs per call. The arguments are captured in closures, and I still use `functools.wraps` and re-raise after the final attempt."

**Follow-ups:**
- *Can a class be a decorator?* Yes: any callable works, for example a class with `__call__`, which is handy when the decorator needs state.
- *What's the production version of this?* Libraries like `tenacity` provide tested retry decorators with backoff, jitter and stop conditions (see Q58).

---

### Q23. `lambda`, `map`, `filter`, `sorted(key=…)` and `functools`

**Short answer:** A `lambda` is a small anonymous function limited to one expression: `lambda u: u["age"]`. `map` and `filter` apply a function lazily and return iterators. `sorted(items, key=fn)` returns a new sorted list ordered by `fn(item)` and is **stable** (equal keys keep their original order). `functools` adds tools like `cache`/`lru_cache` (memoisation), `partial` (pre-filled arguments), `reduce` and `wraps`.

**How it works:** `sorted` calls the key function **once per item**, then sorts by those keys. A tuple key sorts by the first element, then the second for ties. Negating a number sorts it descending.

**Example:**
```python
from functools import lru_cache, partial

jobs = [{"id": 2, "p": 1}, {"id": 1, "p": 1}, {"id": 3, "p": 0}]
print(sorted(jobs, key=lambda j: (-j["p"], j["id"])))
# [{'id': 1, 'p': 1}, {'id': 2, 'p': 1}, {'id': 3, 'p': 0}]

names = ["asha", "ravi"]
print(list(map(str.upper, names)))            # ['ASHA', 'RAVI']
print([n.upper() for n in names])              # same, usually clearer

@lru_cache(maxsize=1024)
def fib(n): return n if n < 2 else fib(n - 1) + fib(n - 2)
print(fib(80))                                 # instant: each n computed once

log_error = partial(print, "[ERROR]")
log_error("disk full")                         # [ERROR] disk full
```

**What happens, step by step:**
1. The key for each job is `(-p, id)`: `(-1, 2)`, `(-1, 1)`, `(0, 3)`. Sorting these tuples gives `(-1, 1)`, `(-1, 2)`, `(0, 3)`: priority descending, then id ascending.
2. `map(str.upper, names)` produces nothing until `list()` pulls the values.
3. `fib(80)` without the cache would take ages (exponential calls); with `lru_cache` each `fib(n)` is computed once and then read from the cache.
4. `partial(print, "[ERROR]")` creates a function that always passes `"[ERROR]"` as the first argument.

**Common mistake → fix:** confusing `sorted` and `list.sort`.
```python
result = items.sort()        # ❌ sort() sorts in place and returns None
result = sorted(items)       # ✅ new list; items unchanged
```
Also: `lru_cache` on an instance method keeps every `self` alive in the cache (a memory leak in services). Cache a module-level function, or use `functools.cached_property` for per-instance values.

**Interview answer:** "Lambdas are one-expression anonymous functions, mostly used as `key` functions. `sorted` with a key is stable and computes the key once per item; a tuple key handles multi-level sorting. `map` and `filter` are lazy, but comprehensions are usually clearer. From `functools` I use `lru_cache` for pure functions with hashable arguments, `partial` to pre-fill arguments, and `wraps` in decorators."

**Follow-ups:**
- *Sort descending by a string?* `sorted(items, key=f, reverse=True)`, or sort twice, relying on stability.
- *`cache` vs `lru_cache`?* `cache` is unbounded (`lru_cache(maxsize=None)`); prefer a bound in long-running processes.

---

### Q24. Everyday built-ins: `enumerate`, `zip`, `any`/`all`, unpacking and the walrus operator

**Short answer:** These built-ins replace manual index bookkeeping. `enumerate` gives `(index, item)` pairs; `zip` walks several iterables in step; `any`/`all` test a condition across items and stop early; **unpacking** (`first, *rest = items`) splits sequences into names; the **walrus operator** `:=` assigns a value inside an expression.

**Example:**
```python
names = ["asha", "ravi", "li"]
scores = [91, 78, 85]

for rank, name in enumerate(names, start=1):
    print(rank, name)                         # 1 asha / 2 ravi / 3 li

for name, score in zip(names, scores, strict=True):
    print(f"{name}: {score}")

print(any(s < 80 for s in scores))            # True (stops at 78)
print(all(s > 50 for s in scores))            # True

first, *rest = scores
print(first, rest)                            # 91 [78, 85]

import io
f = io.StringIO("abcdefgh")
while (chunk := f.read(3)):
    print(chunk)                              # abc / def / gh
```

**What happens, step by step:**
1. `enumerate(names, start=1)` yields `(1, "asha")`, `(2, "ravi")`, `(3, "li")`.
2. `zip(..., strict=True)` pairs items by position and raises `ValueError` if the lists have different lengths (3.10+). Without `strict`, `zip` silently stops at the shortest.
3. `any` checks 91 (no), 78 (yes) and stops; 85 is never checked.
4. `first, *rest` puts the first item in `first` and the remaining items in a list.
5. The walrus loop: `f.read(3)` returns `"abc"`, `"def"`, `"gh"`, then `""`, which is falsy and ends the loop. Without `:=` you'd need the read call twice (before and inside the loop).

**Common mistake → fix:** `zip` silently dropping data.
```python
for q, a in zip(questions, answers): ...               # ❌ 10 questions, 9 answers → last question skipped silently
for q, a in zip(questions, answers, strict=True): ...  # ✅ ValueError tells you about the mismatch
```

**Interview answer:** "I use `enumerate` instead of `range(len(...))`, `zip` with `strict=True` to walk lists in parallel safely, and `any`/`all` with generator expressions because they short-circuit. Unpacking with a starred name splits sequences cleanly, and the walrus operator avoids repeating a call in read loops or comprehensions with a filter."

**Follow-ups:**
- *How do you swap two variables?* `a, b = b, a` (the right side is built as a tuple first).
- *Other handy built-ins?* `sum`, `min`/`max` with `key=`, `reversed`, `sorted`, `divmod`, `isinstance`.

---

### Q25. What is structural pattern matching (`match` / `case`)?

**Short answer:** `match` (Python 3.10+) compares a value against a series of **patterns** and runs the first `case` that fits. Unlike a simple switch, patterns can check **shape and type** and pull out parts in one step: a dict with certain keys, a list of a certain length, an object of a class with certain attributes. `case _:` is the catch-all.

**How it works:** Cases are tried top to bottom. A pattern can be a literal (`case 404:`), a capture name (`case x:` binds anything), a sequence (`case [first, *rest]:`), a mapping (`case {"type": "token", "text": t}:` — extra keys are allowed), a class pattern (`case Point(x=0):`), alternatives with `|`, and a guard `if …`.

**Example:**
```python
def handle(event):
    match event:
        case {"type": "token", "text": str(t)}:
            return f"emit {t!r}"
        case {"type": "tool_call", "name": name, **args}:
            return f"run {name} with {args}"
        case {"type": "error", "code": 429 | 503 as code}:
            return f"retry after {code}"
        case [first, *_] if first == "batch":
            return "batch"
        case _:
            return "unknown"

print(handle({"type": "token", "text": "Hi"}))
print(handle({"type": "tool_call", "name": "search", "q": "py"}))
print(handle({"type": "error", "code": 503}))
print(handle(["batch", 1, 2]))
print(handle({"type": "token", "text": 5}))
```

**What happens, step by step:**
1. `{"type": "token", "text": "Hi"}` matches the first case: the key `type` equals `"token"` and `text` is a `str`, bound to `t`. Returns `emit 'Hi'`.
2. The tool call skips case 1 (`type` differs) and matches case 2; `name` = `"search"`, and `**args` collects the remaining keys → `run search with {'q': 'py'}`.
3. The error with code 503 matches `429 | 503`, bound to `code` → `retry after 503`.
4. The list matches the sequence pattern and the guard `first == "batch"` is true → `batch`.
5. The last event has `text: 5`, which fails `str(t)`; no other case fits, so `case _` → `unknown`.

**Common mistake → fix:** expecting a bare name to compare against a variable.
```python
OK = 200
match status:
    case OK:            # ❌ a bare name CAPTURES anything; this always matches (and Python errors that later cases are unreachable)
        ...
match status:
    case HTTPStatus.OK:  # ✅ a dotted name is compared as a constant
        ...
```

**Interview answer:** "`match`/`case` is structural pattern matching: it checks the shape of data and destructures it in one step. I use it for event or message handling, where each case checks keys or types and binds the fields I need. Cases are tried in order, mapping patterns allow extra keys, and bare names capture rather than compare, so constants must be dotted names like enum members."

**Follow-ups:**
- *Is it faster than if/elif?* Not meaningfully; use it for clarity when matching on structure.
- *Can it match class instances?* Yes: `case Point(x=0, y=y):` checks `isinstance` and attributes; dataclasses support positional patterns via `__match_args__`.

---

### Q26. Modules, packages, imports and `if __name__ == "__main__"`

**Short answer:** A **module** is a `.py` file; a **package** is a folder of modules (normally with an `__init__.py`). `import x` runs the module's top-level code **once**, caches the module in `sys.modules`, and binds the name. Every module has a `__name__`: it's the module's dotted name when imported, but `"__main__"` when the file is run directly, so `if __name__ == "__main__":` holds code that should run only as a script.

**How it works:**

```flow
pipeline: What import app.utils does
Check sys.modules > If the module was imported before, reuse the cached object. This is why top-level code runs only once per process.
Search sys.path > Look in the script's folder, the current environment's site-packages and other configured paths.
Create a module object > A fresh namespace with __name__ set to "app.utils".
Run the module's top-level code > Every def, class and assignment at the top level runs now, in order.
Bind the name > The importing file can now use app.utils. A file run directly gets __name__ == "__main__" instead.
```

**Example:**
```python
# app/utils.py
print("loading utils")
def slugify(s): return s.lower().replace(" ", "-")

if __name__ == "__main__":
    print(slugify("Hello World"))

# app/main.py
from app import utils
from app import utils as again
print(utils.slugify("A B"))
```

**What happens, step by step:**
1. `python -m app.main`: the first `from app import utils` finds nothing in `sys.modules`, locates `app/utils.py`, and runs it: it prints `loading utils` and defines `slugify`. Its `__name__` is `"app.utils"`, so the `if` block is skipped.
2. The second import finds `app.utils` in `sys.modules` and reuses it; `loading utils` is **not** printed again.
3. `utils.slugify("A B")` prints `a-b`.
4. `python -m app.utils` runs the file as the main program: `__name__` is `"__main__"`, so it prints `loading utils` and then `hello-world`.

**Common mistake → fix:** circular imports. `a.py` does `from b import g` and `b.py` does `from a import f`; whichever runs first is only half-initialised when the other asks for a name → `ImportError: cannot import name`. Fix: move the shared code into a third module, or import inside the function that needs it.

**Interview answer:** "A module is a file and a package is a directory of modules. Importing runs a module's top-level code once and caches it in `sys.modules`, so later imports are cheap and side effects at import time happen only once. The `__name__ == '__main__'` guard lets a file act as both an importable module and a script. I keep import-time work light and break circular imports by moving shared code."

**Follow-ups:**
- *Absolute vs relative imports?* `from app.utils import x` (absolute, preferred) vs `from .utils import x` (relative, inside a package).
- *What are lazy imports?* Python 3.15 adds `lazy import json` (PEP 810): the name is bound immediately, but the module is only loaded on first use, which can cut startup time for command-line tools.

---
## 5. OOP: classes, dunder methods, inheritance

### Q27. What is a class, and what is an object?

**Short answer:** A **class** is a blueprint that bundles **data** (attributes) and **behaviour** (methods) under one name. An **object** (or *instance*) is one concrete thing built from that blueprint, with its own attribute values. Calling the class like a function (`Account("Asha")`) creates an object and runs `__init__` to set it up. `self` is the object the method is working on.

**How it works:**
1. `Account("Asha", 100)` first creates an empty object (via `__new__`).
2. Python then calls `__init__(self, "Asha", 100)`, where `self` is the new object; `__init__` stores the values as attributes.
3. Calling `acct.deposit(50)` is shorthand for `Account.deposit(acct, 50)`: Python passes the object as `self` automatically.

**Example:**
```python
class Account:
    def __init__(self, owner, balance=0):
        self.owner = owner
        self.balance = balance

    def deposit(self, amount):
        if amount <= 0:
            raise ValueError("amount must be positive")
        self.balance += amount
        return self.balance

a = Account("Asha", 100)
b = Account("Ravi")
print(a.deposit(50))           # 150
print(b.balance)               # 0
print(type(a).__name__, isinstance(a, Account))   # Account True
```

**What happens, step by step:**
1. `Account("Asha", 100)` builds object `a`; `__init__` sets `a.owner = "Asha"` and `a.balance = 100`.
2. `Account("Ravi")` builds a **separate** object `b` with `balance` defaulting to `0`.
3. `a.deposit(50)` runs with `self` being `a`: `a.balance` goes from 100 to 150, and 150 is returned.
4. `b.balance` is still `0`: each object has its own attributes.

**Common mistake → fix:** forgetting `self`.
```python
class Account:
    def deposit(amount):            # ❌ a.deposit(50) → TypeError: takes 1 positional argument but 2 were given
        ...
    def deposit(self, amount):      # ✅ the object is always passed first
        ...
```
Python passed `a` *and* `50`, but the method only accepted one parameter.

**Interview answer:** "A class defines the attributes and methods shared by a kind of object, and an object is one instance with its own state. Calling the class creates the object and runs `__init__` to initialise it. Methods receive the instance as `self`, so `a.deposit(50)` is really `Account.deposit(a, 50)`. Classes are how I keep data and the rules that protect it together."

**Follow-ups:**
- *What's `__new__` vs `__init__`?* `__new__` creates the object, `__init__` fills it in. You only override `__new__` for special cases like immutable types or singletons.
- *Does Python have private attributes?* Not enforced. `_name` means "internal by convention"; `__name` triggers name mangling to `_Class__name`, mainly to avoid clashes in subclasses.

---

### Q28. Class attributes vs instance attributes

**Short answer:** An **instance attribute** (`self.x = …`, usually set in `__init__`) belongs to one object. A **class attribute** (assigned in the class body) is stored once on the class and **shared** by all instances. Looking up `obj.x` checks the instance first, then the class. Assigning `obj.x = …` always creates or updates an **instance** attribute, which then hides (shadows) the class one.

**Example:**
```python
class Job:
    retries = 3                      # class attribute, shared
    tags = []                        # ❌ shared mutable list

    def __init__(self, name):
        self.name = name             # instance attribute

j1, j2 = Job("a"), Job("b")
print(j1.retries)                    # 3 (found on the class)
j1.retries = 5                       # creates j1's own attribute
print(j1.retries, j2.retries, Job.retries)   # 5 3 3
j1.tags.append("urgent")
print(j2.tags)                       # ['urgent']  ← shared
```

```flow
trace: Attribute lookup: the instance first, then the class
j1.retries   →   **3** > j1's own __dict__ has no retries, so Python finds it on the class Job.
j1.retries = 5   →   j1.__dict__ is **{'name': 'a', 'retries': 5}** > Assignment through an instance creates an instance attribute; the class is untouched.
j2.retries   →   **3** > j2 has no own value, so it still sees the class attribute.
j1.tags.append("urgent")   →   Job.tags is **['urgent']** > No assignment happened: lookup found the class's list and mutated it, so every instance sees the change.
```

**What happens, step by step:**
1. `j1.retries` isn't in `j1.__dict__`, so Python reads `Job.retries` → 3.
2. `j1.retries = 5` writes into `j1.__dict__`. `j2` and `Job` still have 3.
3. `j1.tags.append(...)` *reads* `tags` (found on the class) and mutates that one shared list, so `j2.tags` shows it too.

**Common mistake → fix:** mutable class attributes. Create per-instance containers in `__init__`: `self.tags = []`. Use class attributes for constants and true shared state (like a registry), and name them clearly.

**Interview answer:** "Instance attributes live in each object's `__dict__`; class attributes live on the class and are shared. Reading an attribute checks the instance, then the class and its parents. Assigning through an instance creates an instance attribute that shadows the class one, but mutating a class-level list changes it for everyone, so mutable per-object data belongs in `__init__`."

**Follow-ups:**
- *How do you change a class attribute for everyone?* Assign through the class: `Job.retries = 4`.

---

### Q29. `@staticmethod`, `@classmethod` and `@property`

**Short answer:**
- An **instance method** receives the object (`self`) and works with its data.
- A **`@classmethod`** receives the class (`cls`) instead; it's used for **alternative constructors** like `Money.from_str("12.50")`, and it builds the right subclass when called on one.
- A **`@staticmethod`** receives nothing automatically; it's a plain function grouped inside the class.
- **`@property`** makes a method look like an attribute (`m.dollars`, no parentheses), so you can compute or validate a value without changing how callers use it.

**Example:**
```python
class Money:
    def __init__(self, cents: int):
        self._cents = cents

    @classmethod
    def from_str(cls, s: str) -> "Money":
        return cls(round(float(s) * 100))

    @staticmethod
    def is_valid(s: str) -> bool:
        return s.replace(".", "", 1).isdigit()

    @property
    def dollars(self) -> float:
        return self._cents / 100

    @dollars.setter
    def dollars(self, value: float) -> None:
        if value < 0:
            raise ValueError("negative")
        self._cents = round(value * 100)

class Euro(Money): pass

m = Money.from_str("12.50")
print(m.dollars)                 # 12.5
m.dollars = 3
print(m._cents)                  # 300
print(type(Euro.from_str("1")).__name__)   # Euro
print(Money.is_valid("1.2.3"))   # False
```

**What happens, step by step:**
1. `Money.from_str("12.50")`: `cls` is `Money`; it computes 1250 cents and calls `Money(1250)`.
2. `m.dollars` calls the property getter → `1250 / 100` → `12.5`.
3. `m.dollars = 3` calls the setter, which validates and stores 300 cents.
4. `Euro.from_str("1")`: `cls` is `Euro`, so it returns a `Euro`, not a `Money`. A static method or a hard-coded `Money(...)` would lose that.
5. `is_valid` needs neither the object nor the class; removing one dot from `"1.2.3"` leaves `"12.3"`, which isn't all digits → `False`.

| Kind | First argument | Typical use |
|---|---|---|
| instance method | `self` | behaviour using this object's data |
| `@classmethod` | `cls` | alternative constructors, class-wide settings |
| `@staticmethod` | none | helper that logically belongs to the class |
| `@property` | `self` (called on attribute access) | computed or validated attributes |

**Common mistake → fix:** calling a property like a method: `m.dollars()` → `TypeError: 'float' object is not callable`, because `m.dollars` already returned the float. Use `m.dollars`.

**Interview answer:** "Instance methods get `self`; class methods get `cls`, which makes them ideal for alternative constructors that also work for subclasses; static methods get nothing and are just namespaced helpers. Properties expose computed or validated values with attribute syntax, so I can start with a plain attribute and add validation later without changing callers."

**Follow-ups:**
- *What's `functools.cached_property`?* A property computed on first access and then stored on the instance; good for expensive values that don't change.

---

### Q30. What are dunder (magic) methods? `__str__` vs `__repr__`

**Short answer:** **Dunder methods** ("double underscore", like `__len__`) are special methods Python calls for you when you use built-in syntax: `len(x)` calls `x.__len__()`, `a + b` calls `a.__add__(b)`, `for i in x` calls `x.__iter__()`. Implementing them lets your objects behave like built-in types. `__repr__` gives an unambiguous developer-facing description (used in the REPL, logs and debuggers); `__str__` gives a friendly one for `print()` and f-strings.

**How it works:** Python looks up the dunder on the object's **type**. For binary operators, if `a.__add__(b)` returns `NotImplemented`, Python tries `b.__radd__(a)`. If `__str__` is missing, `str()` falls back to `__repr__`.

| You want | Implement |
|---|---|
| `print(obj)`, `repr(obj)` | `__str__`, `__repr__` |
| `a == b`, `a < b` | `__eq__`, `__lt__` (or `functools.total_ordering`) |
| `len(x)`, `x[i]`, `for i in x`, `x in c` | `__len__`, `__getitem__`, `__iter__`, `__contains__` |
| `obj()` | `__call__` |
| `with obj:` | `__enter__`, `__exit__` |
| `hash(obj)`, dict key | `__hash__` |
| `a + b` | `__add__` / `__radd__` |

**Example:**
```python
class Money:
    def __init__(self, cents): self.cents = cents
    def __repr__(self): return f"Money(cents={self.cents})"
    def __str__(self): return f"${self.cents / 100:.2f}"
    def __add__(self, other):
        if not isinstance(other, Money):
            return NotImplemented
        return Money(self.cents + other.cents)
    def __eq__(self, other):
        return isinstance(other, Money) and self.cents == other.cents

total = Money(250) + Money(100)
print(total)              # $3.50
print(repr(total))        # Money(cents=350)
print([total])            # [Money(cents=350)]  ← containers use repr
print(total == Money(350))   # True
```

**What happens, step by step:**
1. `Money(250) + Money(100)` calls `Money(250).__add__(Money(100))` → `Money(350)`.
2. `print(total)` calls `__str__` → `$3.50`.
3. `repr(total)` and printing a list both use `__repr__` → `Money(cents=350)`.
4. `==` calls `__eq__`, comparing cents → `True`.
5. `Money(1) + 5` would return `NotImplemented` from `__add__`; Python then tries `int.__radd__`, which also can't handle it, so you get a clean `TypeError`.

**Common mistake → fix:** a useless default repr in logs: `<__main__.Money object at 0x7f…>`. Always define `__repr__` for domain objects (dataclasses generate one for you).

**Interview answer:** "Dunder methods are hooks that let my classes work with Python syntax and built-ins: `__len__`, `__iter__`, `__eq__`, `__add__`, `__enter__` and so on. `__repr__` should be unambiguous, ideally looking like code that recreates the object, and it's what logs and containers show; `__str__` is the user-friendly form. Operators should return `NotImplemented` for unsupported types so Python can try the reflected method."

**Follow-ups:**
- *What if I define `__eq__`?* Python sets `__hash__` to `None`, so define `__hash__` too if instances must be dict keys (see Q15).

---

### Q31. Inheritance, `super()` and the MRO

**Short answer:** **Inheritance** lets a class (the subclass) reuse and extend another (the base class): `class Admin(User)`. A subclass can **override** a method and call the parent version with `super()`. With multiple inheritance, `super()` doesn't simply mean "my parent"; it means **"the next class in the MRO"** (Method Resolution Order), the single list of classes Python searches, computed with the C3 algorithm and visible as `Cls.__mro__`.

**How it works:** The MRO lists each class once, children before parents, keeping the order you wrote the bases in. Every `super().send()` passes the call to the next class in **the original object's** MRO, so in a diamond each class runs exactly once.

**Example:**
```python
class Base:
    def send(self, msg): print("send", msg)

class LogMixin(Base):
    def send(self, msg):
        print("log"); super().send(msg)

class RetryMixin(Base):
    def send(self, msg):
        print("retry"); super().send(msg)

class Client(LogMixin, RetryMixin):
    pass

print([c.__name__ for c in Client.__mro__])
# ['Client', 'LogMixin', 'RetryMixin', 'Base', 'object']
Client().send("hi")
```

```flow
trace: Client().send("hi") walks the MRO
MRO = **Client, LogMixin, RetryMixin, Base, object** > C3 lists each class once: children before parents, bases in the order written.
Client has no send, so LogMixin.send runs   →   prints **log** > Python takes the first class in the MRO that defines send.
LogMixin calls super().send   →   **RetryMixin**.send prints **retry** > The next class after LogMixin in Client's MRO is RetryMixin, not Base, even though LogMixin's parent is Base.
RetryMixin calls super().send   →   **Base**.send prints **send hi** > Base runs once, at the end. Every class in the diamond ran exactly once.
```

**What happens, step by step:**
1. Python computes `Client.__mro__` once, when the class is created.
2. `Client().send("hi")` finds `send` first on `LogMixin` → prints `log`.
3. `super()` inside `LogMixin` continues from LogMixin's position in **Client's** MRO, so it calls `RetryMixin.send` → prints `retry`.
4. `RetryMixin`'s `super()` reaches `Base.send` → prints `send hi`. Output: `log`, `retry`, `send hi`.

**Common mistake → fix:** calling the parent by name in cooperative classes: `Base.send(self, msg)` inside `LogMixin` skips `RetryMixin` entirely. Use `super()` consistently, and give methods compatible signatures (accept `**kwargs` in `__init__` chains).

**Interview answer:** "A subclass inherits and can override methods, and `super()` calls the next implementation. In multiple inheritance, `super()` follows the MRO computed by C3 linearisation, not just the direct parent, which lets cooperative mixins each run exactly once in a diamond. In application code I prefer composition over deep inheritance, because it's easier to test and change."

**Follow-ups:**
- *Composition vs inheritance?* Inheritance is "is-a" and couples you to the parent's internals; composition ("has-a": pass a `Logger` into `Client`) is more flexible.
- *Why do I get `TypeError: Cannot create a consistent method resolution order`?* The base-class order you listed contradicts another class's order, so C3 can't build a single list.

---

### Q32. Abstract base classes vs Protocols (duck typing)

**Short answer:** Both describe "what methods an object must have". An **abstract base class** (ABC, from the `abc` module) is **nominal**: a class must *inherit* from it, and Python refuses to instantiate a subclass that hasn't implemented every `@abstractmethod`. A **`typing.Protocol`** is **structural**: any class with matching methods satisfies it, no inheritance needed. That's "duck typing" ("if it quacks like a duck…") checked by a static type checker.

**Example:**
```python
from abc import ABC, abstractmethod
from typing import Protocol

class Storage(ABC):
    @abstractmethod
    def put(self, key: str, data: bytes) -> None: ...

class BrokenStore(Storage):
    pass

class DocumentSource(Protocol):
    def get(self, key: str) -> bytes: ...

class DiskSource:                       # no inheritance
    def get(self, key: str) -> bytes:
        return b"..."

def summarise(src: DocumentSource, key: str) -> int:
    return len(src.get(key))

print(summarise(DiskSource(), "a"))     # 3
BrokenStore()                           # TypeError: Can't instantiate abstract class BrokenStore ...
```

**What happens, step by step:**
1. `summarise(DiskSource(), "a")` works at run time (Python doesn't check types) and passes a type checker, because `DiskSource` has a matching `get` method.
2. `BrokenStore()` fails **at run time** with `TypeError`, because it inherits from an ABC but doesn't implement `put`.
3. If you passed an object without `get` to `summarise`, mypy would flag it before running; at run time you'd get `AttributeError` only when the call happened.

| | ABC | Protocol |
|---|---|---|
| Needs inheritance | yes | no |
| Checked | at run time when instantiating | by static type checkers (or `isinstance` with `@runtime_checkable`, which checks only that method names exist) |
| Can share code | yes (concrete helper methods) | rarely |
| Best for | a family of your own classes | describing what a function needs from third-party or unrelated classes |

**Common mistake → fix:** forcing third-party classes to inherit from your ABC just to type a parameter. Use a Protocol that lists only the methods you call.

**Interview answer:** "ABCs are nominal: subclasses must inherit and implement abstract methods, and Python enforces that at instantiation. Protocols are structural: any object with the right methods fits, and type checkers verify it. I use ABCs when I own a class hierarchy and want shared code or runtime enforcement, and Protocols to describe the minimum a function needs, which keeps code decoupled and easy to fake in tests."

**Follow-ups:**
- *Is duck typing safe without Protocols?* It works at run time, but errors appear late; Protocols move the check to development time.

---

### Q33. Dataclasses: what do they generate?

**Short answer:** `@dataclass` reads the **annotated fields** of a class and generates the boring methods for you: `__init__`, `__repr__` and `__eq__`, plus optionally ordering (`order=True`), immutability and hashing (`frozen=True`), `__slots__` (`slots=True`) and keyword-only arguments (`kw_only=True`). Mutable defaults must use `field(default_factory=list)`.

**Example:**
```python
from dataclasses import dataclass, field, asdict

@dataclass(slots=True)
class Job:
    id: str
    status: str = "PENDING"
    pages: list[int] = field(default_factory=list)

j = Job("j1")
j.pages.append(3)
print(j)                        # Job(id='j1', status='PENDING', pages=[3])
print(j == Job("j1", pages=[3]))    # True
print(asdict(j))                # {'id': 'j1', 'status': 'PENDING', 'pages': [3]}

@dataclass(frozen=True)
class Point:
    x: int
    y: int
p = Point(1, 2)
# p.x = 5                       # dataclasses.FrozenInstanceError
print({p: "origin-ish"})        # hashable, so usable as a key
```

**What happens, step by step:**
1. The decorator sees three fields and generates `__init__(self, id, status="PENDING", pages=<new list>)`.
2. `Job("j1")` gets its **own** new list from `default_factory`; appending 3 affects only this job.
3. `print(j)` uses the generated `__repr__`. `==` compares all fields in order → `True`.
4. `asdict` converts it (recursively) into a dict, handy for JSON.
5. `frozen=True` blocks assignment after creation and generates `__hash__`, so `Point` can be a dict key.

**Common mistake → fix:** `pages: list[int] = []` raises `ValueError: mutable default <class 'list'> for field pages is not allowed: use default_factory`. The dataclass refuses it to save you from the shared-default bug (Q12).

**Interview answer:** "A dataclass generates `__init__`, `__repr__` and `__eq__` from type-annotated fields, with options for ordering, immutability and hashing, slots and keyword-only arguments. I use them for internal domain objects. Mutable defaults need `default_factory`. Dataclasses don't validate types at run time, so for untrusted input I use Pydantic instead."

**Follow-ups:**
- *Can I validate in a dataclass?* Yes, in `__post_init__`, which runs after the generated `__init__`.
- *Does `frozen=True` make it deeply immutable?* No: a frozen dataclass holding a list still lets you mutate that list.

---

### Q34. What are descriptors and metaclasses? (high level)

**Short answer:** A **descriptor** is an object, stored as a class attribute, that controls what happens when that attribute is read or written on instances, by defining `__get__`, `__set__` or `__delete__`. `property`, `classmethod`, `staticmethod`, methods themselves and ORM column fields are all descriptors. A **metaclass** is "the class of a class": it customises how **classes** are created. Frameworks use metaclasses (Django models, Enum); application code rarely needs them, because `__init_subclass__` and class decorators cover most cases.

**How it works (attribute lookup `obj.attr`):**
1. A **data descriptor** (has `__set__` or `__delete__`) on the class wins first. That's how `property` can validate assignment.
2. Otherwise the instance's own `__dict__`.
3. Otherwise a **non-data descriptor** (only `__get__`; plain functions are this kind, which is how they become bound methods) or a plain class attribute.
4. Otherwise `__getattr__` if defined, else `AttributeError`.

**Example:**
```python
class Positive:
    def __set_name__(self, owner, name):
        self.name = "_" + name
    def __get__(self, obj, objtype=None):
        return getattr(obj, self.name)
    def __set__(self, obj, value):
        if value <= 0:
            raise ValueError(f"{self.name[1:]} must be positive")
        setattr(obj, self.name, value)

class Order:
    qty = Positive()
    def __init__(self, qty): self.qty = qty

o = Order(3)
print(o.qty)          # 3
o.qty = -1            # ValueError: qty must be positive

class Plugin:
    registry = {}
    def __init_subclass__(cls, name, **kw):
        super().__init_subclass__(**kw)
        Plugin.registry[name] = cls

class PdfParser(Plugin, name="pdf"): ...
print(Plugin.registry)   # {'pdf': <class '__main__.PdfParser'>}
```

**What happens, step by step:**
1. When `Order` is created, Python calls `Positive.__set_name__(Order, "qty")`, so the descriptor stores values in `_qty`.
2. `self.qty = 3` in `__init__` finds the data descriptor on the class and calls its `__set__`, which validates and stores `o._qty = 3`.
3. `o.qty` calls `__get__` → `3`. `o.qty = -1` → `__set__` raises.
4. Defining `PdfParser` runs `Plugin.__init_subclass__` with `name="pdf"`, registering it, with no metaclass needed.

**Common mistake → fix:** writing a metaclass for registration or validation. Use `__init_subclass__` or a class decorator; they're simpler and don't conflict with other libraries' metaclasses.

**Interview answer:** "Descriptors are objects with `__get__`/`__set__` that control attribute access on another class; `property`, methods and ORM fields are built on them, and data descriptors take priority over the instance dict. Metaclasses customise class creation and are mainly for frameworks; for plugin registration or validating subclasses I use `__init_subclass__` or class decorators."

**Follow-ups:**
- *Why are functions descriptors?* `func.__get__(obj)` returns a bound method with `obj` filled in as `self`; that's how `obj.method()` gets `self`.

---
## 6. Iterators, generators, context managers, errors

### Q35. Iterable vs iterator vs generator, and `yield`

**Short answer:** An **iterable** is anything you can loop over (list, string, dict, file); calling `iter()` on it gives an **iterator**. An **iterator** is an object that hands out the next item each time you call `next()` and raises `StopIteration` when it runs out. A **generator** is the easiest way to write an iterator: a function containing `yield`, which **pauses** at each `yield`, hands out a value, and **resumes** from the same spot (with its local variables intact) on the next `next()`.

**How it works:** A `for` loop is really this:
```python
it = iter(iterable)            # calls iterable.__iter__()
while True:
    try:
        x = next(it)           # calls it.__next__()
    except StopIteration:
        break
    ...loop body...
```
Calling a generator function doesn't run its body; it returns a generator object. The body runs a piece at a time as values are requested.

**Example:**
```python
def countdown(n):
    print("start")
    while n > 0:
        yield n
        n -= 1
    print("done")

g = countdown(2)
print(next(g))
print(next(g))
print(next(g, "exhausted"))
```

```flow
sequence: The generator pauses at each yield
actors: Caller, countdown generator
Caller -> countdown generator: g = countdown(2)
> Nothing runs yet: calling a generator function only creates the generator object.
Caller -> countdown generator: next(g)
countdown generator -> countdown generator: print "start", reach yield n
countdown generator --> Caller: 2
> The generator pauses right at the yield, keeping n = 2 in memory.
Caller -> countdown generator: next(g)
countdown generator -> countdown generator: resume, n becomes 1, reach yield
countdown generator --> Caller: 1
Caller -> countdown generator: next(g, "exhausted")
countdown generator -> countdown generator: n becomes 0, loop ends, print "done"
countdown generator --> Caller: StopIteration, so next returns the default "exhausted"
```

**What happens, step by step:**
1. `countdown(2)` creates a generator; nothing is printed.
2. First `next(g)`: the body runs from the top, prints `start`, reaches `yield 2` and pauses. `2` is printed.
3. Second `next(g)`: it resumes after the `yield`, sets `n = 1`, loops and yields `1`.
4. Third `next`: `n` becomes 0, the loop exits, `done` is printed and the function ends, which raises `StopIteration`; `next(g, "exhausted")` returns the default instead of raising.

**Why it matters:** generators process data as a **stream** in constant memory: reading a 10 GB log line by line, paging through an API, or chaining steps (`read → filter → parse`) where each item flows through before the next is read.

**Common mistake → fix:** treating a generator (or any iterator) as reusable. After one full pass it's empty. If you need several passes, store a list, or call the generator function again.

**Interview answer:** "An iterable can produce an iterator; an iterator returns items one at a time via `__next__` and raises `StopIteration` at the end, which is exactly what a `for` loop relies on. A generator function uses `yield` to pause and resume with its local state kept, giving me a lazy, constant-memory iterator with very little code. Generators are single-pass."

**Follow-ups:**
- *What does `yield from` do?* It delegates to another iterable or generator: `yield from sub()` yields everything `sub()` yields.
- *Useful `itertools`?* `islice` (take n lazily), `chain`, `groupby`, `batched` (3.12+, fixed-size chunks), `pairwise`.

---

### Q36. What is a context manager, and how does `with` work?

**Short answer:** A **context manager** is an object that sets something up at the start of a `with` block and **guarantees** the cleanup at the end, even if the block raises an exception or returns early: closing a file, releasing a lock, committing or rolling back a transaction. You write one either as a class with `__enter__` and `__exit__`, or as a generator function with one `yield` decorated with `@contextlib.contextmanager`.

**How it works:**
1. `with cm as x:` calls `cm.__enter__()`; its return value is bound to `x`.
2. The block runs.
3. `cm.__exit__(exc_type, exc, traceback)` is **always** called. If the block raised, the exception details are passed in; if `__exit__` returns `True`, the exception is swallowed, otherwise it continues upward.

**Example:**
```python
from contextlib import contextmanager
import time

@contextmanager
def timer(label):
    start = time.perf_counter()
    try:
        yield start                       # the with-block runs here
    finally:
        print(f"{label}: {time.perf_counter() - start:.2f}s")

with timer("load"):
    time.sleep(0.2)

with timer("fail"):
    raise ValueError("bad row")
```

```flow
sequence: What with timer("fail") guarantees
actors: Your code, timer context manager
Your code -> timer context manager: __enter__ runs the code up to yield
timer context manager --> Your code: start time (bound by as, if used)
Your code -> Your code: run the block: raise ValueError("bad row")
Your code -> timer context manager: __exit__ with the ValueError
> The exception is thrown into the generator at the yield, so the finally block runs.
timer context manager -> timer context manager: finally prints "fail: 0.00s"
timer context manager --> Your code: the ValueError continues upward
> Cleanup happened, but the error was not swallowed.
```

**What happens, step by step:**
1. First block: setup records the start time, the block sleeps 0.2 s, then the `finally` prints `load: 0.20s`.
2. Second block: the `raise` happens inside the `with`. Python calls `__exit__` with the error, which re-raises it at the `yield`; the `finally` prints `fail: 0.00s`.
3. The `ValueError` then propagates to the caller, because the context manager didn't suppress it.

**Common mistake → fix:** writing the `@contextmanager` generator without `try/finally`.
```python
@contextmanager
def lock_held(lock):
    lock.acquire()
    yield
    lock.release()          # ❌ skipped if the block raises → the lock is never released
@contextmanager
def lock_held(lock):
    lock.acquire()
    try:
        yield
    finally:
        lock.release()      # ✅ always runs
```

**Interview answer:** "A context manager pairs setup with guaranteed cleanup around a block: `__enter__` runs at the start and `__exit__` always runs at the end, receiving any exception. I use them for files, locks, transactions and timers, and write my own with `@contextmanager`, always putting the cleanup in `finally`. A decorator wraps a whole function; a context manager wraps a block."

**Follow-ups:**
- *Async version?* `async with` with `__aenter__`/`__aexit__`, or `@contextlib.asynccontextmanager`.
- *Managing a variable number of resources?* `contextlib.ExitStack` lets you enter many context managers in a loop and closes them all.

---

### Q37. What is an exception?

**Short answer:** An **exception** is Python's way of signalling that something went wrong while running: dividing by zero, a missing key, a failed network call. When one is **raised**, normal execution stops and Python unwinds the call stack looking for a matching `except` handler. If none is found, the program stops and prints a **traceback** (the chain of calls that led to the error, most recent call last).

**How it works:**
- Exceptions are objects; all ordinary ones inherit from `Exception` (which inherits from `BaseException`).
- Common built-ins: `ValueError` (right type, bad value), `TypeError` (wrong type), `KeyError`, `IndexError`, `AttributeError`, `FileNotFoundError`, `ZeroDivisionError`, `TimeoutError`.
- You raise your own with `raise ValueError("message")`.
- Python's style is **EAFP** ("easier to ask forgiveness than permission"): try the operation and handle the failure, rather than checking every condition first.

**Example:**
```python
def parse_age(text):
    age = int(text)                      # may raise ValueError
    if age < 0:
        raise ValueError(f"age must be >= 0, got {age}")
    return age

def load(user):
    return parse_age(user["age"])        # may raise KeyError

for user in [{"age": "41"}, {"age": "x"}, {}]:
    try:
        print(load(user))
    except (ValueError, KeyError) as e:
        print(type(e).__name__, e)
```

**What happens, step by step:**
1. `{"age": "41"}` → `int("41")` = 41, printed.
2. `{"age": "x"}` → `int("x")` raises `ValueError` inside `parse_age`. Python leaves `parse_age`, then `load`, and finds the `except` in the loop → prints `ValueError invalid literal for int() with base 10: 'x'`.
3. `{}` → `user["age"]` raises `KeyError` in `load` → prints `KeyError 'age'`.
4. The loop keeps going after each handled error. Without the `try`, the first error would end the program with a traceback pointing at the failing line.

**Common mistake → fix:** silencing everything.
```python
try:
    process(order)
except:                     # ❌ also catches KeyboardInterrupt/SystemExit and hides real bugs
    pass
try:
    process(order)
except PaymentDeclined as e:     # ✅ catch what you can handle; let the rest surface
    notify_customer(e)
```

**Interview answer:** "An exception is an object that interrupts normal flow when something goes wrong; Python unwinds the stack until a matching `except` handles it, or prints a traceback and exits. I raise specific built-in or custom exceptions with clear messages, catch only the types I can actually handle, and let unexpected ones propagate so they're logged and fixed."

**Follow-ups:**
- *`Exception` vs `BaseException`?* `BaseException` also covers `KeyboardInterrupt`, `SystemExit` and `asyncio.CancelledError`, which you normally must not swallow; catch `Exception` at most.
- *How do you read a traceback?* From the bottom: the last line is the exception type and message, the line above is where it was raised, and the lines above that are the calls that led there.

---

### Q38. `try` / `except` / `else` / `finally`

**Short answer:** `try` holds the code that might fail. `except SomeError` runs only if that error was raised. `else` runs only if the `try` block raised **nothing** (code that should run on success but whose own errors you don't want caught by the `except` above). `finally` runs **always**, success or failure, even after `return`, which makes it the place for cleanup.

**Example:**
```python
def fetch(url, fail=None):
    print("try")
    try:
        if fail:
            raise fail
        data = "payload"
    except TimeoutError:
        print("except: will retry")
        return None
    else:
        print("else: cache", data)
        return data
    finally:
        print("finally: close connection")

fetch("u")
fetch("u", fail=TimeoutError)
```

**What happens, step by step:**
1. `fetch("u")`: `try` succeeds → `except` skipped → `else` prints `else: cache payload` and hits `return data` → before the function actually returns, `finally` prints `finally: close connection` → returns `"payload"`.
2. `fetch("u", fail=TimeoutError)`: the `raise` jumps to `except TimeoutError`, which prints and reaches `return None` → `finally` still runs first → returns `None`. `else` is skipped.
3. If a different error (say `KeyError`) were raised, no `except` matches: `finally` runs and then the `KeyError` propagates to the caller.

| Block | Runs when |
|---|---|
| `try` | always first |
| `except X` | an `X` (or subclass) was raised in `try` |
| `else` | `try` finished without raising |
| `finally` | always, last, even after `return`/`break` |

**Common mistake → fix:**
1. Putting too much in `try`, so the `except` catches errors from code you didn't mean to guard. Keep `try` small and move the success path into `else`.
2. `return` inside `finally` silently discards any in-flight exception. Python 3.14 emits a `SyntaxWarning` for `return`, `break` or `continue` that exits a `finally` block (PEP 765). Don't do it.

**Interview answer:** "`try` contains the risky call, `except` handles the specific errors I expect, `else` holds the success path so its errors aren't accidentally caught, and `finally` always runs for cleanup. I keep the try block minimal, catch narrow exception types, use `raise … from err` when translating errors, and use context managers instead of `finally` when one exists."

**Follow-ups:**
- *Can one `except` catch several types?* `except (TimeoutError, ConnectionError):`. Python 3.14 also accepts it without parentheses when there's no `as` (PEP 758).
- *How do you re-raise the same error?* A bare `raise` inside the `except` block.

---

### Q39. Custom exceptions, exception hierarchies and chaining

**Short answer:** Define one **base exception for your domain** (`class PaymentError(Exception)`) and specific subclasses (`CardDeclined`, `GatewayTimeout`). Callers can then catch broadly (`except PaymentError`) or narrowly (`except GatewayTimeout`). When you translate a low-level error into your own, use `raise NewError(...) from err` so the original cause is kept in the traceback (**exception chaining**).

**Example:**
```python
class PaymentError(Exception):
    """Base class for payment failures."""

class CardDeclined(PaymentError):
    pass

class GatewayTimeout(PaymentError):
    retryable = True

def charge(amount):
    try:
        raise TimeoutError("gateway did not answer in 5s")   # simulated low-level error
    except TimeoutError as err:
        raise GatewayTimeout(f"charge of {amount} timed out") from err

try:
    charge(100)
except CardDeclined:
    print("ask for another card")
except PaymentError as e:
    print(type(e).__name__, "|", e, "| cause:", repr(e.__cause__))
```

**What happens, step by step:**
1. `charge(100)` hits a `TimeoutError` (simulated here).
2. The `except` translates it: `raise GatewayTimeout(...) from err` creates the domain error and stores the original as `__cause__`.
3. The caller's `except CardDeclined` doesn't match (`GatewayTimeout` isn't a `CardDeclined`).
4. `except PaymentError` matches, because `GatewayTimeout` is a subclass. It prints `GatewayTimeout | charge of 100 timed out | cause: TimeoutError('gateway did not answer in 5s')`.
5. If uncaught, the traceback would show both errors joined by "The above exception was the direct cause of the following exception".

**Common mistake → fix:** inheriting from `BaseException` (then `except Exception` won't catch it), or raising a bare `Exception("failed")` that callers can't distinguish from bugs. Inherit from `Exception` and raise specific subclasses. Also, put the broad `except` **after** the narrow ones; the first match wins.

**Interview answer:** "I create a base exception per domain and subclasses for distinct failures, so callers choose how broadly to catch and can distinguish, say, retryable timeouts from permanent declines. When I wrap a library error I use `raise … from err` to keep the original cause visible. I order handlers from most specific to most general."

**Follow-ups:**
- *What does `from None` do?* It hides the original context, which is useful when the low-level error is noise for the caller.
- *Should exceptions carry data?* Yes: attributes like `status_code` or `retryable` let handlers decide without parsing the message.

---

### Q40. `ExceptionGroup` and `except*` (Python 3.11+)

**Short answer:** When several things fail **at the same time** (typically concurrent tasks in an `asyncio.TaskGroup`), Python can raise an **`ExceptionGroup`**: one exception that contains a list of others. `except*` handles such a group by type: each `except*` clause takes the matching exceptions out of the group, and anything left unhandled is re-raised.

**Example:**
```python
import asyncio

async def fetch(name, error=None):
    await asyncio.sleep(0.01)
    if error:
        raise error
    return name

async def main():
    try:
        async with asyncio.TaskGroup() as tg:
            tg.create_task(fetch("a", TimeoutError("a slow")))
            tg.create_task(fetch("b", ValueError("b bad json")))
            tg.create_task(fetch("c", TimeoutError("c slow")))
    except* TimeoutError as eg:
        print("timeouts:", [str(e) for e in eg.exceptions])
    except* ValueError as eg:
        print("bad data:", [str(e) for e in eg.exceptions])

asyncio.run(main())
```

**What happens, step by step:**
1. All three tasks start; each sleeps, then raises.
2. When the first task fails, the `TaskGroup` cancels any siblings still running. Here all three have already failed at the same moment, so the group collects all three errors.
3. Leaving the `async with`, the group raises `ExceptionGroup` containing `[TimeoutError, ValueError, TimeoutError]` (order may vary).
4. `except* TimeoutError` receives a sub-group with both timeouts → prints `timeouts: ['a slow', 'c slow']`.
5. `except* ValueError` receives the rest → prints `bad data: ['b bad json']`. Nothing is left over, so nothing is re-raised. Unlike plain `except`, **several** `except*` clauses can run for one group.

**Common mistake → fix:** catching `except TimeoutError:` around a `TaskGroup`. It won't match, because the raised object is an `ExceptionGroup`, not a `TimeoutError`. Use `except*`, or `except ExceptionGroup as eg:` and inspect `eg.exceptions`.

**Interview answer:** "An `ExceptionGroup` bundles several exceptions raised together, for example by tasks in a `TaskGroup`. `except*` splits the group by type so each handler gets just the matching errors, several handlers can run, and unmatched ones are re-raised. It's how structured concurrency reports multiple failures without losing any."

**Follow-ups:**
- *Can I raise one myself?* `raise ExceptionGroup("validation failed", [ValueError("a"), ValueError("b")])`, for example to report all invalid fields at once.

---

## 7. Typing & data modelling

### Q41. What are type hints, and are they enforced?

**Short answer:** **Type hints** are annotations that say what types a function expects and returns, like `def get(id: str) -> User | None`. Python **does not enforce them at run time**; the interpreter mostly ignores them. They're checked by **static type checkers** (mypy, pyright) before the code runs, used by editors for autocomplete, and read by frameworks such as FastAPI and Pydantic, which *choose* to validate data against them.

**How it works:** hints are stored as metadata (`func.__annotations__`). Since Python 3.14, annotations are evaluated lazily, only when something asks for them (PEP 649/749), so forward references to classes defined later usually no longer need quotes.

**Example:**
```python
from typing import Literal, Callable

def first[T](items: list[T]) -> T:          # 3.12+ generic syntax: T is a type variable
    return items[0]

type JSON = dict[str, "JSON"] | list["JSON"] | str | int | float | bool | None   # 3.12+ alias

Mode = Literal["fast", "accurate"]

def run(mode: Mode, on_done: Callable[[str], None] | None = None) -> int:
    return 1 if mode == "fast" else 2

print(run("fast"))          # 1
print(run("turbo"))         # 2 at run time! mypy reports: incompatible type "Literal['turbo']"
n: int = first(["a", "b"])  # runs fine; mypy reports: str is not int
```

**What happens, step by step:**
1. `run("fast")` → `1`.
2. `run("turbo")` runs without complaint, because Python doesn't check hints, and returns `2` (the else branch). A type checker in CI would flag it before it ever ran.
3. `first[T]` tells the checker "returns the same type as the list's items", so `first(["a", "b"])` is a `str`; assigning it to `n: int` is a checker error, not a run-time error.

**Common hints:** `X | None` (same as `Optional[X]`), `list[int]`, `dict[str, float]`, `Literal`, `Callable`, `Iterable`, `Protocol`, `TypedDict`, `Self`, `Annotated[int, ...]`, `Final`.

**Common mistake → fix:** assuming hints validate API input. `def create(age: int)` happily receives `"abc"` from JSON. Validate at the boundary with Pydantic (Q42), and use hints plus a checker for internal correctness.

**Interview answer:** "Type hints document the expected types and let static checkers like mypy or pyright catch errors before run time, but CPython doesn't enforce them. Frameworks such as Pydantic and FastAPI read them to validate data at run time. I use modern syntax, `X | None`, built-in generics and the 3.12 `def f[T]` form, and run a checker in CI."

**Follow-ups:**
- *`Any` vs `object`?* `Any` turns checking off for that value; `object` means "anything, but you can only use operations every object supports".
- *What's `Optional[X]`?* Exactly `X | None`; it does **not** mean the parameter is optional.

---

### Q42. `dataclass` vs `NamedTuple` vs `TypedDict` vs Pydantic

**Short answer:** All four describe structured data; choose by **where the data comes from**. `dataclass` for internal objects you create yourself; `NamedTuple` for small immutable records that should also behave like tuples; `TypedDict` to describe the shape of a plain dict (such as parsed JSON) for the type checker only; **Pydantic** `BaseModel` when data comes from **outside** (API requests, files, environment, model outputs) and must be validated and converted at run time.

| Tool | Validates at run time | Mutable | Object type | Best for |
|---|---|---|---|---|
| `dataclass` | no | yes (or `frozen`) | your class | internal domain objects |
| `NamedTuple` | no | no | a tuple | small records, tuple compatibility |
| `TypedDict` | no (static only) | it's a dict | `dict` | typing JSON-shaped dicts |
| Pydantic `BaseModel` | **yes**, parses and converts | yes | your class | untrusted input at boundaries |

**Example:**
```python
from pydantic import BaseModel, Field, ValidationError

class ExtractRequest(BaseModel):
    doc_id: str = Field(min_length=3)
    pages: list[int] = []

req = ExtractRequest.model_validate({"doc_id": "doc1", "pages": ["1", 2]})
print(req.pages)                 # [1, 2]

try:
    ExtractRequest.model_validate({"doc_id": "d", "pages": ["x"]})
except ValidationError as e:
    print(e.error_count())       # 2
```

**What happens, step by step:**
1. The first input is checked field by field: `doc_id` is a string of length 4 (OK); `"1"` is converted to `1` because Pydantic's default ("lax") mode coerces numeric strings to ints.
2. The second input has two problems: `doc_id` is shorter than 3 characters, and `"x"` can't become an int. Pydantic collects **both** into one `ValidationError` instead of stopping at the first.
3. A `dataclass` or `TypedDict` with the same fields would have accepted the bad data silently.

**How to choose:** "Did this data cross a trust boundary?" Yes → Pydantic. No → dataclass (or NamedTuple for tiny immutable records). Just need to type an existing dict → TypedDict.

**Common mistake → fix:** using Pydantic models for every internal object in hot loops. Validation costs time; validate once at the edge, then pass plain dataclasses or validated models inward.

**Interview answer:** "Type hints describe; Pydantic enforces. I use dataclasses for internal objects, NamedTuple for small immutable tuple-like records, TypedDict to type dict-shaped data, and Pydantic models at trust boundaries, where data must be parsed, coerced and validated with clear error messages."

**Follow-ups:**
- *Strict mode?* Pydantic can disable coercion (`strict=True`), so `"1"` is rejected for an `int` field.

---

### Q43. What are enums, and when do you use them?

**Short answer:** An **enum** (`enum.Enum`) is a fixed set of named constants, such as the statuses a job can have. Using `JobStatus.DONE` instead of the string `"DONE"` turns typos into immediate errors, gives autocomplete, and documents every allowed value in one place. `StrEnum` (3.11+) members are also real strings, which makes them easy to store and send as JSON.

**Example:**
```python
from enum import Enum, StrEnum, auto

class JobStatus(StrEnum):
    PENDING = auto()          # value "pending" (auto lowercases the name for StrEnum)
    RUNNING = auto()
    DONE = auto()

s = JobStatus("done")
print(s is JobStatus.DONE, s == "done")       # True True
print([m.value for m in JobStatus])           # ['pending', 'running', 'done']
JobStatus("finished")                         # ValueError: 'finished' is not a valid JobStatus

class Color(Enum):
    RED = 1
print(Color.RED == 1)                         # False: plain Enum members aren't ints
```

**What happens, step by step:**
1. `auto()` in a `StrEnum` gives each member its lowercased name as the value.
2. `JobStatus("done")` looks the value up and returns the existing singleton member, so `is` is `True`; because it's a `str` subclass, `== "done"` is also `True`.
3. Iterating the class lists members in definition order.
4. An unknown value raises `ValueError`, which is exactly what you want when parsing input.
5. A plain `Enum` member is not equal to its raw value; compare members, or use `.value`.

**Common mistake → fix:** comparing a plain `Enum` member with a raw string from the database (`if job.status == "DONE"`), which is always `False`. Convert once at the boundary (`JobStatus(row["status"])`) and compare members afterwards, or use `StrEnum`.

**Interview answer:** "Enums define a closed set of named values, which removes magic strings, catches typos and centralises the allowed states. I use `StrEnum` when values are serialised as strings, convert raw input to the enum at the boundary, and get a `ValueError` for anything invalid. `match` statements work well with enum members."

**Follow-ups:**
- *What's `Flag`?* An enum whose members combine with `|` (bit flags), for permissions like `READ | WRITE`.

---
## 8. Concurrency: threads, processes, asyncio, GIL

### Q44. Concurrency vs parallelism, and I/O-bound vs CPU-bound work

**Short answer:** **Concurrency** means several tasks are *in progress* at the same time, taking turns (one cook juggling three pans). **Parallelism** means several tasks are literally *running at the same instant* on different CPU cores (three cooks). Which one you need depends on the work: **I/O-bound** work spends most of its time *waiting* (network, disk, database), so concurrency is enough; **CPU-bound** work spends its time *computing* (parsing, image processing, maths), so only parallelism makes it faster.

**How it works:**
- While an I/O-bound task waits for a reply, the CPU is idle. Another task can use that time, so taking turns speeds things up even on one core.
- A CPU-bound task never waits, so taking turns gives no speed-up. You need more cores working at once.

| Work type | Example | Python tool |
|---|---|---|
| I/O-bound, async libraries available | 1,000 HTTP calls with `httpx` | `asyncio` |
| I/O-bound, only blocking libraries | a blocking SDK, `requests` | threads (`ThreadPoolExecutor`, `asyncio.to_thread`) |
| CPU-bound, pure Python | parsing, scoring | processes (`ProcessPoolExecutor`), or threads on the free-threaded build |
| CPU-bound, numeric | matrix maths | NumPy and similar (C code that runs outside the GIL) |

**Example (illustrative timings):**
```python
import time
from concurrent.futures import ThreadPoolExecutor

def io_task(_):
    time.sleep(1)                   # stands in for a 1-second network call

start = time.perf_counter()
with ThreadPoolExecutor(max_workers=10) as ex:
    list(ex.map(io_task, range(10)))
print(round(time.perf_counter() - start, 1))    # about 1.0, not 10
```

**What happens, step by step:**
1. Ten tasks each "wait" 1 second. Run one after another, that's 10 s.
2. With 10 threads, all ten waits overlap. `time.sleep` (like real network I/O) releases the GIL while waiting, so the threads don't block each other.
3. Total ≈ 1 s. If `io_task` instead did 1 s of pure-Python arithmetic, on the standard (GIL) build the 10 threads would still take about 10 s, because only one can run Python code at a time (Q45).

**Common mistake → fix:** adding threads to speed up a CPU-heavy pure-Python loop and seeing no gain (or a slowdown). Measure first; use processes, a native library, or the free-threaded build for CPU-bound work.

**Interview answer:** "Concurrency is about dealing with many things at once by interleaving; parallelism is doing many things at the same instant on multiple cores. I/O-bound work benefits from concurrency, so I use asyncio or threads. CPU-bound work needs parallelism, so I use processes, native libraries that release the GIL, or the free-threaded build. The first step is always to find out whether the workload is waiting or computing."

**Follow-ups:**
- *How do you tell which one you have?* Profile: if CPU usage sits near 100% of one core, it's CPU-bound; if it's low while requests are slow, the code is waiting on I/O.

---

### Q45. What is the GIL, and what does it NOT guarantee?

**Short answer:** The **GIL** (Global Interpreter Lock) is a lock in standard CPython that lets **only one thread run Python bytecode at a time** in a process. Threads still help with I/O, because a thread releases the GIL while it waits, but they don't speed up pure-Python CPU work. The GIL does **not** make your code thread-safe: operations like `counter += 1` take several bytecode steps and can still interleave. CPython also ships an optional **free-threaded build** with no GIL (experimental in 3.13, officially supported but not the default since 3.14).

**How it works:**
1. A thread must hold the GIL to run Python code.
2. It releases the GIL when it does blocking I/O, calls `time.sleep`, or runs C code that explicitly releases it (NumPy, compression, hashing).
3. A thread running pure Python is asked to give up the GIL after a short **switch interval** (5 ms by default, `sys.getswitchinterval()`), so threads take turns.
4. Because a switch can happen *between* the read, add and write steps of `counter += 1`, two threads can both read the same old value and one update is lost.

**Example:**
```python
import threading

counter = 0
lock = threading.Lock()

def unsafe():
    global counter
    for _ in range(1_000_000):
        counter += 1                 # read → add → write: can interleave

def safe():
    global counter
    for _ in range(1_000_000):
        with lock:
            counter += 1

threads = [threading.Thread(target=unsafe) for _ in range(4)]
for t in threads: t.start()
for t in threads: t.join()
print(counter)       # may be less than 4,000,000; the result varies by run and version
```

```flow
sequence: How an update gets lost even with the GIL
actors: Thread 1, counter, Thread 2
Thread 1 -> counter: read counter (100)
> Thread 1 holds the GIL and loads the current value.
Thread 1 -> Thread 1: switch interval: forced to release the GIL
Thread 2 -> counter: read counter (100), add 1, write 101
> Thread 2 runs its whole read-add-write while Thread 1 is paused.
Thread 1 -> counter: add 1 to its stale 100, write 101
> Two increments happened but the counter only went up by one. A Lock around the update makes the three steps atomic.
```

**What happens, step by step:**
1. Four threads each try to add one million.
2. Sometimes a thread is paused right after reading `counter`, and another thread updates it in the meantime.
3. The paused thread then writes back its stale value plus one, overwriting the other's work. The final count can come out below 4,000,000. How often this happens depends on the Python version and timing, which is exactly why it's dangerous: tests may pass while production loses updates.
4. With `safe`, the lock makes read-add-write one indivisible step, so the result is always 4,000,000.

**The free-threaded build:** installed as a separate interpreter (for example `python3.14t`). Threads then run Python code truly in parallel on multiple cores. Single-threaded code is a little slower on it (the 3.14 docs quote roughly 5–10%), and C extensions must declare support, otherwise the GIL is re-enabled at import time. Check with `sys._is_gil_enabled()`.

**Common mistake → fix:** "Python has a GIL, so I don't need locks." Wrong: protect shared mutable state with `threading.Lock`, or avoid sharing by passing messages through `queue.Queue`.

**Interview answer:** "The GIL lets only one thread execute Python bytecode at a time per interpreter, so threads help with I/O, since the GIL is released while waiting, but not with CPU-bound pure Python. It doesn't make code thread-safe: compound operations like `+=` can interleave, so shared state still needs locks. Since 3.14 there's an officially supported free-threaded build without a GIL, which enables real multi-core threading if your dependencies support it."

**Follow-ups:**
- *Why does the GIL exist?* It makes CPython's reference counting and internals simple and fast for single-threaded code, and it made writing C extensions easy.
- *Are subinterpreters an alternative?* Yes: 3.14 adds `concurrent.interpreters` and `InterpreterPoolExecutor`; each interpreter has its own GIL, so they can run Python in parallel inside one process.

---

### Q46. Threads vs processes vs asyncio: when to use each?

**Short answer:** Use **asyncio** for many concurrent I/O waits when you have async libraries (thousands of connections on one thread). Use **threads** for I/O with blocking libraries, or for a modest number of parallel waits. Use **processes** for CPU-heavy pure-Python work that must use several cores. The key differences are how they switch (asyncio switches only at `await`; threads are switched by the OS at any moment) and whether they share memory.

| | Threads | Processes | asyncio |
|---|---|---|---|
| Runs Python on several cores (standard build) | no | **yes** | no |
| Good for I/O | yes | yes, but heavy | **best** (thousands of tasks) |
| Memory per worker | small | large (a whole interpreter each) | tiny (one coroutine) |
| Shares memory | yes (needs locks) | no (data is pickled between them) | yes, one thread |
| Switching | OS, at any point | OS | cooperative, only at `await` |
| Main risk | race conditions | serialisation cost, start-up time | a blocking call freezes everything |

**Example:**
```python
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor

def download(key): ...          # blocking SDK call: waits on the network
def clean_page(text): ...       # heavy pure-Python string processing

if __name__ == "__main__":
    with ThreadPoolExecutor(max_workers=16) as ex:
        files = list(ex.map(download, keys))
    with ProcessPoolExecutor() as ex:          # defaults to one worker per CPU core
        pages = list(ex.map(clean_page, files, chunksize=50))
```

**What happens, step by step:**
1. Sixteen threads each run `download`; while one waits on the network it releases the GIL, so up to 16 downloads overlap.
2. `ProcessPoolExecutor` starts one worker process per core. `map` pickles batches of 50 pages, sends them to the workers, runs `clean_page` in parallel, and pickles the results back, in the original order.
3. The `__main__` guard is required where processes are started with `spawn` or `forkserver` (the defaults on Windows/macOS and Linux respectively), because each worker re-imports the module (Q51).

**How to choose:** waiting or computing? Waiting + async libraries → asyncio; waiting + blocking libraries → threads; computing → processes (or native code, or the free-threaded build).

**Common mistake → fix:** using a `ProcessPoolExecutor` for tiny tasks. Pickling and inter-process communication can cost more than the work itself. Batch work with `chunksize`, or keep tiny tasks in one process.

**Interview answer:** "asyncio is best for high-concurrency I/O with async libraries; threads for I/O through blocking libraries; processes for CPU-bound Python, since each has its own interpreter and GIL. Threads and asyncio share memory, so I watch for races; processes don't, so I watch serialisation costs. I decide by whether the workload is waiting or computing."

**Follow-ups:**
- *Can you mix them?* Yes: an asyncio app can call `asyncio.to_thread` for blocking calls and `loop.run_in_executor(process_pool, …)` for CPU work.

---

### Q47. What is a coroutine, and how does asyncio work?

**Short answer:** A **coroutine** is a function defined with `async def` that can **pause** at each `await` and be resumed later. **asyncio** runs many coroutines on **one thread** using an **event loop**: it runs one coroutine until it reaches an `await` on something not ready yet (a network reply, a timer), then switches to another coroutine that *is* ready. It's **cooperative**: a coroutine that never awaits (a CPU loop or a blocking call) freezes everything else.

**How it works:**
1. `asyncio.run(main())` creates an event loop and runs `main()`.
2. Calling `fetch()` only creates a coroutine object; `await` runs it, or `asyncio.create_task()` schedules it to run concurrently as a **task**.
3. When a task awaits I/O, it registers interest with the operating system and gives control back to the loop.
4. The loop runs other ready tasks; when the OS reports that the I/O finished, the waiting task is resumed right after its `await`.

**Example:**
```python
import asyncio, time

async def fetch(name, seconds):
    print(f"start {name}")
    await asyncio.sleep(seconds)          # stands in for a network call
    print(f"end {name}")
    return name

async def main():
    start = time.perf_counter()
    results = await asyncio.gather(fetch("A", 1), fetch("B", 1))
    print(results, round(time.perf_counter() - start, 1))

asyncio.run(main())
# start A / start B / end A / end B / ['A', 'B'] 1.0
```

```flow
sequence: One thread, two tasks: how the event loop interleaves them
actors: Event loop, Task A, Task B, OS timer
Event loop -> Task A: run A
Task A -> OS timer: await sleep(1): pause A
> A prints "start A", then yields control at its await. The thread is free.
Event loop -> Task B: run B
Task B -> OS timer: await sleep(1): pause B
> B prints "start B" and also pauses. Both are now waiting at the same time.
OS timer --> Event loop: A's timer is done
Event loop -> Task A: resume A after its await
> A prints "end A" and returns.
OS timer --> Event loop: B's timer is done
Event loop -> Task B: resume B
> B prints "end B". Total time is about 1 second, not 2, on a single thread.
```

**What happens, step by step:**
1. `gather` wraps both coroutines in tasks and the loop starts A: it prints `start A` and pauses at `await asyncio.sleep(1)`.
2. The loop immediately runs B: `start B`, then B pauses.
3. About one second later both timers fire; A resumes (`end A`), then B (`end B`).
4. `gather` returns results **in the order the coroutines were passed**: `['A', 'B']`. Total ≈ 1.0 s.

**Common mistake → fix:** calling a coroutine without `await`.
```python
async def main():
    fetch("A", 1)              # ❌ creates a coroutine object that never runs
                               #    ("RuntimeWarning: coroutine 'fetch' was never awaited")
    await fetch("A", 1)        # ✅ runs it
```

**Interview answer:** "A coroutine is an `async def` function that can suspend at `await`. The asyncio event loop runs many of them on one thread: when one awaits I/O it yields control and the loop runs another, resuming the first when its I/O is ready. That gives huge I/O concurrency cheaply, but it's cooperative, so blocking or CPU-heavy code inside a coroutine stalls every task; that work goes to a thread or process."

**Follow-ups:**
- *`await coro()` vs `create_task(coro())`?* `await` runs it now and waits; `create_task` starts it in the background so you can do other things and await the task later. Keep a reference to the task, or it may be garbage-collected.
- *How do you inspect running tasks?* Python 3.14 adds `python -m asyncio ps <PID>` and `pstree` to list the tasks of a running process.

---

### Q48. `gather` vs `TaskGroup`, plus `Semaphore`, timeouts and cancellation

**Short answer:**
- **`asyncio.gather(*aws)`** runs awaitables concurrently and returns their results in order. If one raises, `gather` raises that error, but the **other tasks keep running** unless you cancel them; `return_exceptions=True` returns errors as values instead.
- **`asyncio.TaskGroup`** (3.11+) is **structured concurrency**: if any task fails, the group **cancels the rest** and raises all failures together in an `ExceptionGroup`. No task outlives the `async with` block.
- **`asyncio.Semaphore(n)`** caps how many tasks do something at once (for example, to respect an API rate limit).
- **`asyncio.timeout(s)`** (3.11+) sets a deadline for a block and raises `TimeoutError` if it's exceeded.
- **Cancellation** is delivered as `CancelledError` at the task's next `await`; clean up in `finally` and don't swallow it.

**Example (bounded fan-out, a very common interview task):**
```python
import asyncio, random

sem = asyncio.Semaphore(3)                  # at most 3 calls in flight

async def embed_one(text):
    async with sem:
        async with asyncio.timeout(2):
            await asyncio.sleep(random.uniform(0.1, 0.3))   # stands in for an API call
            return len(text)

async def embed_all(texts):
    async with asyncio.TaskGroup() as tg:
        tasks = [tg.create_task(embed_one(t)) for t in texts]
    return [t.result() for t in tasks]

print(asyncio.run(embed_all(["a", "bb", "ccc", "dddd", "eeeee"])))   # [1, 2, 3, 4, 5]
```

```flow
sequence: TaskGroup: one failure cancels the rest
actors: Parent, TaskGroup, Task 1, Task 2
Parent -> TaskGroup: async with TaskGroup() as tg
TaskGroup -> Task 1: create_task(embed_one("a"))
TaskGroup -> Task 2: create_task(embed_one("bb"))
Task 1 --> TaskGroup: raises TimeoutError after 2 s
TaskGroup -> Task 2: cancel()
> Task 2 receives CancelledError at its next await and runs its finally blocks.
TaskGroup --> Parent: ExceptionGroup([TimeoutError])
> Nothing keeps running in the background. With gather, Task 2 would have continued unless you cancelled it yourself.
```

**What happens, step by step (normal run):**
1. The `TaskGroup` creates five tasks at once.
2. Only three get past `async with sem`; the other two wait until a slot frees up.
3. Each call runs under a 2-second deadline; all finish in 0.1–0.3 s here.
4. When the `async with TaskGroup` block exits, all tasks are done, so `t.result()` is safe. Results keep the input order: `[1, 2, 3, 4, 5]`.
5. If one call exceeded 2 s, it would raise `TimeoutError`, the group would cancel the others, and the caller would get an `ExceptionGroup` (handle it with `except*`, Q40).

**Common mistake → fix:** unbounded fan-out: `await asyncio.gather(*(call(x) for x in ten_thousand_items))` opens 10,000 connections at once and triggers rate limits. Add a `Semaphore` (or process the items in batches).

**Interview answer:** "`gather` collects results in order but doesn't cancel siblings on failure; `TaskGroup` gives structured concurrency: a failure cancels the rest and errors come back as an `ExceptionGroup`. For fan-out I combine a `TaskGroup` with a `Semaphore` to bound concurrency and `asyncio.timeout` for deadlines, and I let `CancelledError` propagate after cleaning up in `finally`."

**Follow-ups:**
- *Need results as they finish?* `asyncio.as_completed(tasks)` yields them in completion order.
- *What about `asyncio.wait_for`?* It times out one awaitable; `asyncio.timeout()` is the newer block-level form.

---

### Q49. How do you call blocking code from async code?

**Short answer:** Move it off the event loop. For a blocking I/O call (a synchronous SDK, `requests`, a sync database driver, file I/O), use `await asyncio.to_thread(func, *args)`, which runs it in a worker thread while the loop keeps serving other tasks. For CPU-heavy work, use a process pool via `loop.run_in_executor(pool, func, *args)`. Never call blocking functions directly inside `async def`.

**How it works:** the event loop is one thread. A blocking call holds that thread until it finishes, so no other coroutine can run in the meantime: every request on that worker stalls. `to_thread` hands the call to a thread from a pool and returns an awaitable; your coroutine pauses at `await`, and the loop is free.

**Example:**
```python
import asyncio, time

def slow_sdk_call(key):          # a blocking library function
    time.sleep(1)
    return f"data:{key}"

async def bad(key):
    return slow_sdk_call(key)                        # ❌ blocks the loop for 1 s

async def good(key):
    return await asyncio.to_thread(slow_sdk_call, key)   # ✅ runs in a worker thread

async def main():
    t = time.perf_counter()
    await asyncio.gather(*(bad(k) for k in "abc"))
    print("bad", round(time.perf_counter() - t, 1))      # about 3.0
    t = time.perf_counter()
    await asyncio.gather(*(good(k) for k in "abc"))
    print("good", round(time.perf_counter() - t, 1))     # about 1.0

asyncio.run(main())
```

```flow
sequence: Offloading a blocking call with to_thread
actors: Event loop, Worker thread, Blocking SDK
Event loop -> Worker thread: await asyncio.to_thread(slow_sdk_call, "a")
Worker thread -> Blocking SDK: slow_sdk_call("a") blocks for 1 s
> Meanwhile the event loop keeps running other coroutines, including the calls for "b" and "c".
Blocking SDK --> Worker thread: "data:a"
Worker thread --> Event loop: the await resumes with "data:a"
```

**What happens, step by step:**
1. `bad`: each call blocks the loop thread for 1 s, and the three run one after another → about 3 s, even inside `gather`.
2. `good`: each call goes to its own worker thread; the three sleeps overlap → about 1 s.
3. Under real traffic, the `bad` version means every other request on that worker also waits for each blocking call.

**Common mistake → fix:** the hidden blockers: `time.sleep` (use `await asyncio.sleep`), `requests.get` (use `httpx.AsyncClient` or `to_thread`), sync DB drivers, big `json.loads` or CPU work in a request handler (use a process pool or a background job).

**Interview answer:** "A blocking call inside a coroutine stops the entire event loop, so I offload it: `asyncio.to_thread` for blocking I/O and a process pool via `run_in_executor` for CPU-heavy work. Better still is a native async library. In production I watch event-loop lag to catch blocking calls that slipped in."

**Follow-ups:**
- *How do you find them?* Run asyncio in debug mode (`PYTHONASYNCIODEBUG=1`), which logs callbacks that take longer than 100 ms, or use a sampling profiler on the live process.

---

### Q50. Thread-safety tools: locks, queues, events and `contextvars`

**Short answer:** When threads share data, protect it. **`threading.Lock`** lets one thread at a time run a critical section (`RLock` can be re-acquired by the same thread). **`queue.Queue`** is a thread-safe FIFO queue for producer/consumer designs, so threads pass work instead of sharing variables. **`threading.Event`** signals "something happened" (like shutdown). `asyncio.Lock`/`asyncio.Queue` are the async versions and are **not** thread-safe. **`contextvars`** store per-request values (like a request ID) that work correctly with both threads and asyncio tasks.

**Example (producer / consumer):**
```python
import queue, threading

jobs = queue.Queue(maxsize=100)       # maxsize gives backpressure
results = []
results_lock = threading.Lock()

def worker():
    while True:
        job = jobs.get()
        if job is None:               # sentinel: time to stop
            jobs.task_done()
            break
        with results_lock:
            results.append(job * 2)
        jobs.task_done()

threads = [threading.Thread(target=worker) for _ in range(2)]
for t in threads: t.start()
for n in [1, 2, 3]: jobs.put(n)
for _ in threads: jobs.put(None)
jobs.join()                           # wait until every item is marked done
print(sorted(results))                # [2, 4, 6]
```

**What happens, step by step:**
1. Two workers block on `jobs.get()` until something arrives.
2. The main thread puts 1, 2, 3; each item goes to exactly one worker (the queue does the locking).
3. Each worker appends under `results_lock` so the shared list isn't corrupted.
4. One `None` per worker tells each to stop. `jobs.join()` returns once every `put` has a matching `task_done()`.
5. `results` holds 2, 4, 6 in whatever order the workers finished, hence `sorted`.

**Common mistake → fix:** using `threading.Lock` to coordinate several **processes or servers**. It only works inside one process. Across processes or containers, use the database (conditional updates, row locks) or a distributed lock (Q61).

**Interview answer:** "I prefer passing work through a `queue.Queue`, which handles the locking and gives backpressure, over sharing mutable state. When I must share, I guard it with a `Lock` in a `with` block. `Event` is good for shutdown signals, asyncio has its own non-thread-safe primitives, and `contextvars` carry request-scoped data like a trace ID safely across threads and tasks."

**Follow-ups:**
- *What's a deadlock?* Two threads each hold one lock and wait for the other's. Avoid it by always acquiring locks in the same order, or by holding only one at a time.

---

### Q51. Multiprocessing pitfalls

**Short answer:** Each worker process is a separate Python interpreter with its own memory, so everything you send to it (the function, its arguments and the results) must be **pickled** (serialised) and copied. That leads to three classic problems: large arguments are slow to send; lambdas and nested functions can't be pickled; and with the **`spawn`** start method (the default on Windows and macOS) or **`forkserver`** (the default on Linux since 3.14) each worker **re-imports your main module**, so code without an `if __name__ == "__main__":` guard runs again in every worker.

**Example:**
```python
from concurrent.futures import ProcessPoolExecutor

def score(path):                     # top-level function: picklable
    with open(path, encoding="utf-8") as f:
        return sum(len(line) for line in f)

if __name__ == "__main__":           # required with spawn and forkserver
    paths = ["a.txt", "b.txt", "c.txt"]
    with ProcessPoolExecutor(max_workers=3) as ex:
        print(list(ex.map(score, paths)))
```

```flow
sequence: What a process pool does with one task
actors: Parent process, Worker process
Parent process -> Parent process: pickle score and "a.txt"
> Only the function's name and the small path string are serialised, so this is cheap.
Parent process -> Worker process: send the bytes
> With spawn, the worker started by importing your module; the __main__ guard stops it from launching its own pool.
Worker process -> Worker process: open a.txt and compute the score
Worker process --> Parent process: pickled result, for example 1834
```

**What happens, step by step:**
1. Three worker processes start; with `spawn`, each imports this module. Because of the guard, the pool-creating code doesn't run in the workers.
2. For each path, the parent pickles a reference to `score` (by module and name) and the path, and sends it.
3. Workers read their file and return an integer, pickled back to the parent.
4. Sending **paths** instead of file contents keeps the data transferred tiny.

**Common mistakes → fixes:**
1. `ex.map(lambda p: …, paths)` → `PicklingError`. Use a module-level function.
2. No `__main__` guard with spawn → a `RuntimeError` about starting new processes before the current one has finished bootstrapping. Add the guard.
3. Passing a 500 MB DataFrame to each task → most of the time goes into copying. Pass file paths or IDs, or use `multiprocessing.shared_memory`.

**Interview answer:** "Processes don't share memory, so arguments and results are pickled and copied. I pass small things like paths or IDs, use top-level functions because lambdas can't be pickled, and always guard the entry point with `if __name__ == '__main__'` because spawn re-imports the main module in each worker. I also batch small tasks with `chunksize` so the per-task overhead doesn't dominate."

**Follow-ups:**
- *`fork` vs `spawn`?* `fork` copies the parent process (fast, but unsafe if threads exist); `spawn` starts a fresh interpreter (safer, slower). Linux defaulted to `fork`, but since Python 3.14 the default on Linux is `forkserver`, a safer variant.

---
## 9. Packaging, testing, tooling

### Q52. What is a virtual environment, and what does `pip` do?

**Short answer:** A **virtual environment** ("venv") is a self-contained folder with its own Python interpreter link and its own `site-packages` directory, so each project can install its own library versions without affecting other projects or the system Python. **pip** is Python's standard package installer: it downloads packages from **PyPI** (the Python Package Index) and installs them into whichever environment is active.

**How it works:**
1. `python -m venv .venv` creates the folder.
2. "Activating" it puts `.venv`'s `bin` (or `Scripts` on Windows) first on your `PATH`, so `python` and `pip` refer to the environment's copies.
3. `pip install httpx` installs into `.venv/…/site-packages`, where only this environment's interpreter looks.

**Example:**
```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
python -m pip install "httpx>=0.27"
python -c "import sys; print(sys.prefix)"     # …/.venv
pip freeze > requirements.txt      # exact versions currently installed
deactivate
```

**What happens, step by step:**
1. `.venv/` is created with a Python executable and an empty `site-packages`.
2. After activation, `python` resolves to `.venv`'s interpreter; `sys.prefix` confirms it.
3. `pip install` resolves `httpx` and its dependencies (such as `httpcore` and `idna`) and installs them only into `.venv`.
4. `pip freeze` lists every installed package with its exact version, a crude way to record the environment.
5. `deactivate` restores your previous `PATH`; the system Python never saw `httpx`.

**Common mistake → fix:** running `pip install` with no environment active and installing into the system Python (sometimes needing `sudo`), which can break operating-system tools and mixes versions between projects. Always create a venv per project, and run pip as `python -m pip` so it's tied to the interpreter you expect. Many Linux distributions now block system-wide pip installs for this reason ("externally-managed-environment").

**Interview answer:** "A virtual environment isolates a project's interpreter and installed packages, so different projects can use different versions safely. pip installs packages from PyPI into the active environment. I create one venv per project, never install into the system Python, and record dependencies in `pyproject.toml` with a lockfile rather than relying on an unpinned install."

**Follow-ups:**
- *What's PyPI?* The public repository of Python packages that pip installs from by default. Companies often run a private mirror.
- *What's a wheel?* A pre-built package file (`.whl`) that installs without compiling; a source distribution may need a compiler.

---

### Q53. Managing dependencies and reproducible builds

**Short answer:** Declare your direct dependencies with version ranges in **`pyproject.toml`** (the standard project file), and generate a **lockfile** that pins every package, including indirect ones, to an exact version (and file hash). Install from the lockfile in CI and production so every machine gets **identical** packages. Tools such as `uv`, Poetry or pip-tools handle this; `uv` is a popular, very fast option.

**How it works:**

```flow
pipeline: From declared dependencies to an identical install everywhere
pyproject.toml > Lists what your code imports directly, with ranges such as httpx>=0.27.
Resolve and lock > The tool picks one exact version of every package, direct and indirect, and writes them to uv.lock with hashes.
Commit the lockfile > Teammates, CI and the Docker build all read the same file.
Install exactly the lock > uv sync --locked fails if the lock is out of date, so nothing changes silently.
Upgrade on purpose > Update the lock in a pull request so tests run against the new versions before release.
```

**Example:**
```bash
uv init invoice-service && cd invoice-service
uv add httpx pydantic              # updates pyproject.toml and uv.lock
uv add --dev pytest ruff mypy      # development-only dependencies
uv sync --locked                   # CI: install exactly what's in uv.lock; error if it's stale
uv run pytest
```

**What happens, step by step:**
1. `uv init` creates `pyproject.toml` and a project layout.
2. `uv add httpx pydantic` records the ranges in `pyproject.toml`, resolves every transitive dependency, writes exact pins to `uv.lock`, and installs them into the project's `.venv`.
3. `--dev` dependencies go into a separate group, so they're not installed in production images.
4. In CI, `uv sync --locked` installs the pinned versions and exits with an error if `pyproject.toml` changed without the lock being updated.
5. Six months later, a rebuild still gets the same versions, so a new upstream release can't break you unexpectedly.

**Common mistake → fix:** a `requirements.txt` containing only `fastapi` with no versions. Each build installs whatever is newest that day, so a build that worked yesterday can fail today. Pin via a lockfile, and update deliberately.

**Interview answer:** "I declare direct dependencies in `pyproject.toml`, lock the full dependency tree with exact versions and hashes, commit the lock, and install from it in CI and Docker so builds are reproducible. Upgrades happen in pull requests where tests run against the new lock, and I scan dependencies for known vulnerabilities with a tool like `pip-audit`."

**Follow-ups:**
- *Library vs application?* Applications pin exactly via a lock; libraries declare compatible ranges and don't pin, so they don't fight their users' other dependencies.

---

### Q54. Testing with pytest: fixtures, parametrize and mocks

**Short answer:** **pytest** finds functions named `test_*` and runs them; you check results with plain `assert`. **Fixtures** are functions that provide reusable setup (and teardown after `yield`), injected by naming them as test parameters. **`@pytest.mark.parametrize`** runs one test with many inputs. **Mocks** replace external dependencies (HTTP APIs, payment gateways, clocks) with fakes; mock only the boundaries, not your own logic.

**Example:**
```python
# pricing.py
def final_price(amount, coupon, rates):
    rate = rates.get_discount(coupon)          # external call (a service)
    return round(amount * (1 - rate), 2)

# test_pricing.py
import pytest
from unittest.mock import Mock
from pricing import final_price

@pytest.fixture
def rates():
    fake = Mock()
    fake.get_discount.return_value = 0.10
    return fake

@pytest.mark.parametrize("amount, expected", [(100, 90.0), (0, 0.0), (19.99, 17.99)])
def test_final_price(rates, amount, expected):
    assert final_price(amount, "SAVE10", rates) == expected
    rates.get_discount.assert_called_once_with("SAVE10")

def test_rate_service_down(rates):
    rates.get_discount.side_effect = TimeoutError
    with pytest.raises(TimeoutError):
        final_price(100, "SAVE10", rates)
```

**What happens, step by step:**
1. pytest collects `test_final_price` and expands it into **three** tests, one per tuple.
2. For each, it calls the `rates` fixture to get a **fresh** `Mock` whose `get_discount` returns 0.10.
3. Case `(19.99, 17.99)`: `19.99 * 0.9 = 17.991` → rounded to `17.99`, so the assertion passes. The mock also verifies it was called exactly once with `"SAVE10"`.
4. `test_rate_service_down` makes the mock raise `TimeoutError` and checks that the error propagates.
5. If an assertion fails, pytest shows both sides of the comparison (for example `assert 18.0 == 17.99`).

**Common mistake → fix:** patching where a name is **defined** instead of where it's **used**. If `app.py` does `from http_client import fetch`, patch `app.fetch` (`mock.patch("app.fetch")`), not `http_client.fetch`, because `app` already holds its own reference.

**Interview answer:** "pytest gives me plain asserts with detailed failure output, fixtures for reusable setup and teardown with configurable scope, and parametrize for many cases from one test. I mock only external boundaries such as HTTP services or clocks, patch names where they're looked up, and keep a pyramid: many fast unit tests, fewer integration tests against real dependencies in containers, and a few end-to-end tests."

**Follow-ups:**
- *Fixture scopes?* `function` (default, new per test), `class`, `module`, `session` (once per run, for expensive things like a test database).
- *Testing async code?* The `pytest-asyncio` or `anyio` plugin lets you write `async def test_…`.

---

### Q55. Which code-quality tools do you use?

**Short answer:** A typical modern setup is a **formatter** (consistent layout, no style debates), a **linter** (catches bugs and bad patterns), a **type checker**, **tests with coverage**, and **security scanners**, run locally through **pre-commit** hooks and again in CI so nothing merges without passing.

| Tool | Purpose |
|---|---|
| `ruff` | very fast linter and formatter (replaces flake8, isort and black in many projects) |
| `mypy` / `pyright` | static type checking |
| `pytest` + `pytest-cov` | tests and coverage |
| `pre-commit` | runs the checks on changed files before each commit |
| `bandit` | security-focused lint (for example, `subprocess` with `shell=True`) |
| `pip-audit` | checks installed dependencies against known vulnerabilities |

**Example (`pyproject.toml`):**
```toml
[tool.ruff]
line-length = 100
[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP"]    # pycodestyle, pyflakes, import sorting, bugbear, pyupgrade

[tool.mypy]
strict = true
```

**What happens, step by step:**
1. You commit; pre-commit runs `ruff format` and `ruff check --fix` on the changed files.
2. Ruff's `B006` rule flags `def f(x=[])` (mutable default, Q12); `F401` flags an unused import.
3. CI runs the same checks plus `mypy`, `pytest --cov` and `pip-audit`; any failure blocks the merge.

**Common mistake → fix:** adding a linter to an old codebase with every rule enabled, getting 5,000 warnings, and then ignoring all of them. Start with a small rule set, fix or baseline the existing issues, and tighten gradually.

**Interview answer:** "I use Ruff for formatting and linting, mypy or pyright for types, pytest with coverage for tests, and bandit plus pip-audit for security. The same checks run in pre-commit hooks for fast feedback and in CI as the gate, so style is automatic and reviews can focus on logic."

**Follow-ups:**
- *Is 100% coverage the goal?* No. Coverage shows what *wasn't* tested; aim for meaningful tests of important paths and failure cases.

---

### Q56. How do you log properly in Python?

**Short answer:** Use the standard **`logging`** module, not `print`. Create one logger per module with `logging.getLogger(__name__)`, configure handlers and format **once** at application startup, choose the right **level** (DEBUG, INFO, WARNING, ERROR, CRITICAL), and in services emit **structured** (JSON) logs with IDs such as a request or trace ID. Never log secrets or personal data.

**How it works:**
1. `log.info("msg")` first checks the logger's effective level; below it, the call returns almost immediately.
2. Otherwise a `LogRecord` is created and passed to the handlers (for containers, usually stdout).
3. Each handler's formatter turns the record into text (or JSON).
4. Loggers form a hierarchy by dotted name (`app.db` → `app` → root), so configuring the root logger configures everything.

**Example:**
```python
import logging

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("billing.invoices")

def charge(invoice_id, amount):
    log.debug("charging %s", invoice_id)               # below INFO: dropped
    log.info("charging invoice=%s amount=%s", invoice_id, amount)
    try:
        1 / 0
    except ZeroDivisionError:
        log.exception("charge failed invoice=%s", invoice_id)   # includes the traceback

charge("inv-7", 120)
```

**What happens, step by step:**
1. `basicConfig` runs once and attaches a stdout handler with that format to the root logger at INFO.
2. The `debug` call is below INFO, so it's discarded cheaply, and the `%s` string is never even built.
3. The `info` call prints `… INFO billing.invoices charging invoice=inv-7 amount=120`.
4. `log.exception` logs at ERROR and appends the full traceback, because it's called inside an `except` block.

**Common mistake → fix:** formatting messages eagerly with f-strings: `log.debug(f"payload {big_obj}")` builds the string even when DEBUG is off. Pass arguments instead (`log.debug("payload %s", big_obj)`) so formatting happens only if the message is emitted. And never call `logging.basicConfig` inside library code; libraries only create loggers.

**Interview answer:** "I use one logger per module via `getLogger(__name__)`, configure output once at startup, and choose levels deliberately. In services I log structured JSON with request and trace IDs so logs can be searched and joined with traces, use `log.exception` inside handlers to capture stack traces, pass arguments lazily instead of f-strings, and make sure tokens and personal data are never logged."

**Follow-ups:**
- *How do you add a request ID to every line?* Store it in a `contextvars.ContextVar` in middleware and add it in a `logging.Filter` or a structured-logging library.

---

## 10. Production engineering

### Q57. Why does memory keep growing in a long-running Python service?

**Short answer:** Usually because the code **keeps references** it no longer needs, so the objects can never be freed: unbounded caches or dicts, module-level lists that only grow, `lru_cache` on methods (it holds every `self`), background tasks that are never awaited, or loading whole files and result sets into memory. Sometimes it's native memory from C libraries. **Measure first** with `tracemalloc` or `memray` and container memory metrics; don't guess.

**Example:**
```python
import tracemalloc

_seen = {}
def handle(request_id, payload):
    _seen[request_id] = payload            # ❌ grows forever: one entry per request

tracemalloc.start()
before = tracemalloc.take_snapshot()
for i in range(50_000):
    handle(i, "x" * 200)
after = tracemalloc.take_snapshot()
for stat in after.compare_to(before, "lineno")[:1]:
    print(stat)       # e.g. leak.py:5: size=13.4 MiB (+13.4 MiB), count=50001 (+50001) …
```

**What happens, step by step:**
1. `tracemalloc.start()` begins recording where each allocation happens.
2. Fifty thousand calls each store a new 200-character string under a new key; nothing ever removes them.
3. Comparing snapshots ranks source lines by memory growth; the top line points straight at `_seen[request_id] = payload`, with tens of thousands of new blocks. (The exact size printed varies by version and platform.)
4. The fix is to bound it: `functools.lru_cache(maxsize=…)`, a TTL cache, or not storing it at all.

**Usual causes and fixes:**

| Cause | Fix |
|---|---|
| Unbounded dict or cache | `maxsize` or TTL eviction |
| `lru_cache` on a method | cache a module-level function, or use `cached_property` |
| Tasks created and never awaited | keep references and await them, or use a `TaskGroup` |
| Whole file or query result in memory | stream with generators, paginate |
| Native library growth | check the library's docs; recycle workers (`--max-requests` in gunicorn) as a safety net |

**Common mistake → fix:** "fixing" it by raising the container's memory limit. That only delays the out-of-memory kill. Find the owner of the growing references with snapshot diffs.

**Interview answer:** "Python leaks are usually references we keep by accident: unbounded caches, growing globals, `lru_cache` holding `self`, unawaited tasks or loading whole datasets. I confirm steady growth in metrics, reproduce under load, diff `tracemalloc` or `memray` snapshots to find the allocating line, then bound or remove the reference, and add worker recycling and a memory alarm as safety nets."

**Follow-ups:**
- *Why doesn't memory drop after objects are freed?* CPython's allocator keeps freed memory in its own pools for reuse, so the process size (RSS) may stay high even though Python can reuse it.

---

### Q58. How do you retry failed calls without making outages worse?

**Short answer:** Retry only **transient** errors (timeouts, HTTP 429 "too many requests", 5xx), with **exponential backoff** (wait longer after each failure) plus **jitter** (a random amount, so many clients don't retry at the same moment), a **maximum number of attempts or total time**, and respect for a `Retry-After` header. Only retry operations that are **idempotent** (safe to repeat), or make them so with an idempotency key. Add a **circuit breaker** so a dependency that's down isn't hammered.

**How it works:** if 1,000 clients fail at the same second and all retry after exactly 1 s, they hit the struggling service together again (a "thundering herd"). Doubling delays spread retries over time, and jitter spreads them further.

**Example:**
```python
from tenacity import retry, stop_after_attempt, wait_random_exponential, retry_if_exception_type

class RateLimited(Exception): pass

@retry(stop=stop_after_attempt(4),
       wait=wait_random_exponential(multiplier=1, max=20),
       retry=retry_if_exception_type((TimeoutError, RateLimited)),
       reraise=True)
def call_service(payload):
    ...
```

```flow
trace: call_service with exponential backoff and jitter (illustrative waits)
attempt 1 fails with TimeoutError > A transient error, so a retry is allowed.
wait a random time up to **1 s** (say 0.7 s) > wait_random_exponential picks a random delay up to multiplier × 2^0. Randomness spreads clients out.
attempt 2 fails with RateLimited > Still failing, so back off further.
wait a random time up to **2 s** (say 1.6 s) > The upper bound doubles each time, capped at max=20.
attempt 3 fails, wait up to **4 s** > The service gets more breathing room each round.
attempt 4 fails   →   **give up**, re-raise the error > stop_after_attempt(4) ends the loop; reraise=True surfaces the original error so the caller can alert or park the work.
```

**What happens, step by step:**
1. A `TimeoutError` or `RateLimited` triggers a retry; a `ValueError` (a bug or bad input) would fail immediately, because retrying wouldn't help.
2. Waits are random but bounded by 1, 2, 4 s… up to 20 s.
3. After the 4th failure tenacity re-raises the last error instead of wrapping it.
4. A message-queue consumer would then let the message go to a **dead-letter queue** (a holding queue for messages that keep failing) and raise an alarm, instead of retrying forever.

**Common mistake → fix:** retrying at every layer. If the client retries 3 times, the API retries 3 times and the worker retries 3 times, one user action can produce 27 calls to the failing service. Retry at one layer, and pass a total deadline down.

**Interview answer:** "I retry only transient failures, with exponential backoff and jitter, a cap on attempts and total time, and I honour `Retry-After`. The operation must be idempotent, using idempotency keys for writes. I retry at one layer only, use a circuit breaker to stop calling a dependency that's clearly down, and send exhausted work to a dead-letter queue with an alert."

**Follow-ups:**
- *What's a circuit breaker?* After N failures it "opens" and fails fast for a cool-down period, then lets a trial request through; success closes it again.

---

### Q59. How do you optimise slow Python code methodically?

**Short answer:** **Measure, find the bottleneck, fix the biggest cost, measure again.** Most slowness comes from the algorithm (an O(n²) loop), from I/O done one call at a time, or from repeated serialisation, rather than from Python syntax. Use a profiler (`cProfile`, `py-spy`, and in 3.15 the new `profiling.sampling` module) to see where the time actually goes before changing anything.

**Example:**
```python
def find_dupes_slow(ids):
    return [x for i, x in enumerate(ids) if x in ids[:i]]        # O(n²)

def find_dupes_fast(ids):
    seen, dupes = set(), []
    for x in ids:
        if x in seen:
            dupes.append(x)
        seen.add(x)
    return dupes                                                   # O(n)

# python -m cProfile -s cumtime app.py   → shows find_dupes_slow dominating
# py-spy top --pid 1234                  → samples a live process without restarting it
```

**What happens, step by step (illustrative numbers):**
1. Baseline: processing 20,000 ids takes several seconds.
2. `cProfile` shows nearly all the time inside `find_dupes_slow`: for each item it slices and scans the previous items, so about n²/2 = 200 million comparisons.
3. The fix uses a set: each `in` check is O(1), so about 20,000 operations; it now runs in milliseconds.
4. Measure again to confirm; then look at the next biggest cost, or stop if the target is met.

```flow
cycle: The optimisation loop
Measure > Time the real workload to get a baseline number.
Profile > Find where the time actually goes: a function, a query, a network call.
Fix the biggest cost > Usually a better data structure or algorithm, batching I/O, running I/O concurrently, or caching.
Measure again > Keep the change only if the number improved.
exit > Stop when the target is met. Optimising without measuring usually speeds up the wrong thing.
```

**Typical wins:** the right data structure (set or dict instead of list scans), batching network or database calls, running I/O concurrently, caching stable results, vectorising numeric work with NumPy or Polars, and avoiding repeated `json.loads`/`dumps`.

**Common mistake → fix:** micro-optimising (replacing loops with `map`, caching attribute lookups) before profiling. It makes code harder to read and rarely matters compared with the one O(n²) loop or the 200 sequential HTTP calls.

**Interview answer:** "I measure a baseline, profile to find the real hotspot, fix the largest cost, usually an algorithm or I/O pattern, and measure again. Typical wins are sets and dicts instead of list scans, batching and concurrent I/O, caching and vectorised libraries. Only after that would I consider lower-level options like Cython, Rust extensions or the free-threaded build."

**Follow-ups:**
- *Deterministic vs sampling profiler?* `cProfile` records every call (precise, adds overhead); `py-spy` or `profiling.sampling` take periodic snapshots (low overhead, safe in production).

---

### Q60. Serialisation formats, and why `pickle` is dangerous

**Short answer:** **Serialisation** turns objects into bytes or text to store or send them. **JSON** is the safe, universal default for data exchange. **MessagePack** and **Protocol Buffers** are compact binary formats (Protobuf adds a schema). **pickle** can serialise almost any Python object, but **loading a pickle can execute arbitrary code**, so never unpickle data from an untrusted source.

| Format | Strengths | Weaknesses |
|---|---|---|
| JSON | readable, every language supports it | no native datetime, bytes or Decimal; larger |
| MessagePack | compact, fast, JSON-like | binary, less tooling |
| Protobuf | compact, typed schema, versioning rules | needs code generation |
| pickle | any Python object | Python-only, version-sensitive, **unsafe on untrusted data** |

**Example:**
```python
import json, datetime, pickle

event = {"id": 7, "at": datetime.datetime(2026, 10, 27, 9, 30)}
json.dumps(event)                                  # TypeError: datetime is not JSON serializable
text = json.dumps(event, default=str)              # '{"id": 7, "at": "2026-10-27 09:30:00"}'
print(json.loads(text)["at"])                      # a plain string, not a datetime

class Evil:
    def __reduce__(self):
        import os
        return (os.system, ("echo pwned",))
payload = pickle.dumps(Evil())
# pickle.loads(payload)                            # would run `echo pwned` on the loading machine
```

**What happens, step by step:**
1. `json.dumps` fails on the datetime; `default=str` converts unknown types to strings.
2. Loading gives back a string for `at`, so the reader must parse it (Pydantic can do this with a typed model).
3. `Evil.__reduce__` tells pickle "to rebuild me, call `os.system('echo pwned')`". Whoever calls `pickle.loads(payload)` executes that command. An attacker can put any command there.

**Common mistake → fix:** caching objects with pickle in a shared store (Redis, a bucket) that other systems can write to. If anyone can tamper with those bytes, they can run code in your service. Store JSON and validate it on load, or sign the payloads.

**Interview answer:** "I use JSON for most data exchange, validated with Pydantic on the way in, and Protobuf or MessagePack when size or speed matters. Pickle is convenient but its loader can execute arbitrary code, so I only use it for data my own process wrote and nobody else can modify. I include a version field in payloads so formats can evolve."

**Follow-ups:**
- *Faster JSON?* Libraries like `orjson` are much faster than the standard `json` module and handle datetimes natively.

---

### Q61. Database transactions, race conditions and idempotency

**Short answer:** A **transaction** groups several database writes so they all succeed or all fail together. A **race condition** happens when two workers read the same row and both write based on what they read, so one update is lost. Prevent it with **optimistic locking** (a version column plus a conditional `UPDATE … WHERE version = ?`) or **pessimistic locking** (`SELECT … FOR UPDATE` holds a row lock). Python's `threading.Lock` does **not** help across processes or servers; the database must enforce it. **Idempotency** means repeating an operation has the same effect as doing it once.

**Example:**
```sql
-- both workers read: status='PENDING', version=4
UPDATE jobs SET status='RUNNING', version=5 WHERE id='j1' AND version=4;
-- worker A: 1 row updated  → A owns the job
-- worker B: 0 rows updated → someone else won; B re-reads or skips
```

```flow
sequence: Optimistic locking prevents a lost update
actors: Worker A, Database, Worker B
Worker A -> Database: read job j1 (status PENDING, version 4)
Worker B -> Database: read job j1 (status PENDING, version 4)
Worker A -> Database: UPDATE … SET status RUNNING, version 5 WHERE version = 4
Database --> Worker A: 1 row updated
> A's condition matched, so A now owns the job.
Worker B -> Database: the same UPDATE … WHERE version = 4
Database --> Worker B: 0 rows updated
> The version is now 5, so B's condition fails. B knows another worker won, and no update is lost.
```

**What happens, step by step:**
1. Both workers see version 4.
2. A's update matches `version = 4`, sets version 5 and reports 1 row changed.
3. B's identical update now matches no row (the version is 5) and reports 0 rows. B must not proceed; it re-reads or moves on.
4. Without the `version` condition, both would set `RUNNING` and both would process the job, so the customer is charged twice.

**Idempotency in practice:** the client sends an `Idempotency-Key` header; the server stores the key with the result in the same transaction as the write. A retried request with the same key returns the stored result instead of charging again.

**Common mistake → fix:** check-then-act in application code: `if job.status == "PENDING": job.status = "RUNNING"; save()`. Two processes can both pass the check. Make the check part of the write (a conditional update or a unique constraint) so the database decides atomically.

**Interview answer:** "Transactions make related writes atomic, but they don't stop two workers from both acting on the same stale read. I put the condition into the write itself, either optimistic locking with a version column or `SELECT … FOR UPDATE` for short critical sections, and check the affected-row count. For retried requests and redelivered messages I make handlers idempotent with idempotency keys or unique constraints. In-process locks don't work across servers."

**Follow-ups:**
- *Optimistic or pessimistic?* Optimistic when conflicts are rare (no locks held while working); pessimistic when conflicts are frequent and retries would be expensive.

---

### Q62. Logs, metrics and traces (observability)

**Short answer:** These are the three kinds of signal you use to understand a running system. **Logs** record individual events ("payment 81 failed: card declined"). **Metrics** are numbers over time (requests per second, error rate, p95 latency, queue depth), cheap to store and good for alerts. **Traces** follow **one request** across services as a tree of timed **spans**, linked by a shared trace ID, showing where the time went. OpenTelemetry is the standard library and protocol for producing all three.

**How it works:** the first service starts a trace; every outgoing call carries the trace context in a `traceparent` HTTP header; each service records its own span under the same trace ID; and logs include that trace ID so you can jump from a slow trace to its log lines.

**Example (a slow checkout):**
```flow
sequence: One checkout request, one trace ID
actors: Browser, API, Pricing service, Database
Browser -> API: POST /checkout
> The API starts trace abc123. Span 1 covers the whole request: 1,250 ms.
API -> Pricing service: GET /price (traceparent header carries abc123)
> Span 2 under the same trace: 1,100 ms. Most of the time is here.
Pricing service -> Database: SELECT … (span 3)
> Span 3 takes 1,050 ms: a slow query, perhaps a missing index.
Database --> Pricing service: rows
Pricing service --> API: price
API --> Browser: 200 OK
> The trace view shows the whole waterfall; the logs for trace abc123 show the exact query.
```

**What happens, step by step:**
1. A **metric** alert fires: p95 checkout latency rose from 300 ms to 1,200 ms.
2. You open a slow **trace**: the database span inside the pricing service takes 1,050 ms of the 1,250 ms total.
3. You search the **logs** for trace `abc123` and find the exact query and parameters.
4. You add the missing index; the metric returns to normal, confirming the fix.

**Common mistake → fix:** metrics labelled by user ID or full URL. Each unique label value creates a new time series ("high cardinality"), which explodes cost. Label by route template (`/orders/{id}`) and status code; put IDs in logs and traces.

**Interview answer:** "Metrics tell me *that* something is wrong and drive alerts, traces tell me *where* across services, and logs tell me *what* exactly happened. I instrument with OpenTelemetry, propagate the trace context on every call, include the trace ID in structured logs, keep metric labels low-cardinality, and redact secrets and personal data everywhere."

**Follow-ups:**
- *What should you alert on?* User-facing symptoms such as error rate and latency against an objective, not every CPU spike.

---

### Q63. Clean architecture and dependency inversion in Python

**Short answer:** **Dependency inversion** means your business logic depends on **small interfaces you define** (in Python, often a `Protocol`), not on concrete SDKs or databases. **Adapters** implement those interfaces for real systems (a Postgres repository, an HTTP payment client) and for tests (an in-memory fake). Concrete objects are created at the edge of the app and **passed in** (dependency injection). The result: logic is easy to test, and swapping a provider changes one adapter, not the business code.

**Example:**
```python
from typing import Protocol
from dataclasses import dataclass

class PaymentGateway(Protocol):
    def charge(self, customer_id: str, cents: int) -> str: ...

@dataclass
class CheckoutService:                          # business logic: no SDK imports
    gateway: PaymentGateway
    def checkout(self, customer_id: str, cents: int) -> str:
        if cents <= 0:
            raise ValueError("amount must be positive")
        return self.gateway.charge(customer_id, cents)

class FakeGateway:                              # test adapter
    def __init__(self): self.calls = []
    def charge(self, customer_id, cents):
        self.calls.append((customer_id, cents))
        return "txn-test-1"

fake = FakeGateway()
print(CheckoutService(fake).checkout("c1", 4999))   # txn-test-1
print(fake.calls)                                    # [('c1', 4999)]
```

```flow
pipeline: Dependency inversion in one request
API handler > Parses the request, then calls CheckoutService. It is the only place that knows which adapter to use.
CheckoutService > Pure business rules. It only knows the PaymentGateway interface.
PaymentGateway interface > The contract: charge(customer_id, cents) returns a transaction id.
Adapter > In production, an HTTP client for the real payment provider; in tests, FakeGateway.
External system > The payment provider. Switching providers means writing a new adapter, with no change to CheckoutService.
```

**What happens, step by step:**
1. The test creates a `FakeGateway` and injects it into `CheckoutService`.
2. `checkout("c1", 4999)` validates the amount and calls `gateway.charge`; the fake records the call and returns `"txn-test-1"`.
3. The test asserts on the return value and on `fake.calls`, with no network, credentials or mocking library.
4. In production, the startup code builds `CheckoutService(HttpPaymentGateway(api_key=…))` instead; the service code is identical.

**Common mistake → fix:** creating clients inside business functions (`client = PaymentSDK(...)` inside `checkout`). Then every test needs patching and switching providers touches business code. Pass dependencies in through the constructor.

**Interview answer:** "I keep business logic depending on small Protocols I own, with adapters for real systems and fakes for tests, and I wire concrete implementations at the application's entry point. That makes the core logic fast to test without mocks, and lets me change a database or provider by writing one adapter. I keep it pragmatic, though: I don't add interfaces for things that will only ever have one implementation and are easy to test anyway."

**Follow-ups:**
- *Do you need a DI framework?* Usually not in Python; constructor arguments plus a small composition function at startup are enough. FastAPI's `Depends` is a lightweight built-in option for web apps.

---

## 11. Recent Python versions

### Q64. What changed in recent Python versions (3.10 to 3.15)?

**Short answer:** Highlights to know: **3.10** added `match` (pattern matching) and `X | Y` union types; **3.11** made CPython much faster and added `ExceptionGroup`/`except*`, `TaskGroup` and `asyncio.timeout`; **3.12** added the `def f[T]` generic syntax and the `type` alias statement; **3.13** introduced the experimental free-threaded (no-GIL) build, an experimental JIT and a new interactive shell; **3.14** made free-threading officially supported, added template strings (`t"…"`), deferred evaluation of annotations and the `concurrent.interpreters` module; **3.15** (released 9 October 2026) adds explicit lazy imports, a built-in `frozendict`, UTF-8 as the default encoding and a new `profiling` package.

| Version | Features worth mentioning |
|---|---|
| 3.10 | `match`/`case`; `int \| None` union syntax; `zip(strict=True)`; better error messages |
| 3.11 | large interpreter speed-up; `ExceptionGroup` and `except*`; `asyncio.TaskGroup`, `asyncio.timeout`; `tomllib`; `StrEnum` |
| 3.12 | `def first[T](xs: list[T]) -> T`; `type Alias = …`; more flexible f-strings; `itertools.batched` |
| 3.13 | experimental free-threaded build (PEP 703); experimental JIT (PEP 744); new REPL with colour and multi-line editing |
| 3.14 | free-threading officially supported (PEP 779) but still optional; t-strings (PEP 750); lazily evaluated annotations (PEP 649/749); `concurrent.interpreters` (PEP 734); `compression.zstd` (PEP 784); `except A, B` without brackets (PEP 758); `forkserver` default on Linux |
| 3.15 | `lazy import x` / `lazy from x import y` (PEP 810); `frozendict` (PEP 814); `sentinel` built-in (PEP 661); `*`/`**` unpacking in comprehensions (PEP 798); UTF-8 default encoding (PEP 686); `profiling` package with a sampling profiler (PEP 799) |

**Example (3.15 lazy imports and `frozendict`):**
```python
lazy import json                 # name bound now, module loaded on first use
print("starting up")             # json has not been imported yet
data = json.loads('{"a": 1}')    # json is actually imported here

settings = frozendict(region="eu", retries=3)
cache = {settings: "computed"}   # hashable, so it can be a dict key
# settings["retries"] = 4        # TypeError: 'frozendict' object does not support item assignment
```

**What happens, step by step:**
1. `lazy import json` binds `json` to a lazy placeholder; startup doesn't pay the cost of loading the module.
2. The first attribute access (`json.loads`) triggers the real import, then the call runs normally.
3. `frozendict` is immutable and hashable, so it can be used as a dict key or a safe default; any assignment raises `TypeError`.

**Common mistake → fix:** claiming in an interview that "Python 3.13+ has no GIL". The default build still has the GIL; the free-threaded build is a separate interpreter (such as `python3.14t`) that you opt into, and your C extensions must support it.

**Interview answer:** "The big themes are speed, concurrency and typing. 3.11 brought a major speed-up plus exception groups and TaskGroup; 3.12 cleaned up generic syntax; 3.13 and 3.14 brought the free-threaded build from experimental to officially supported, though it's still opt-in; 3.14 also added t-strings and lazy annotations; and 3.15 adds explicit lazy imports and `frozendict`. In practice I'd check which version our runtime and dependencies support before using any of them."

**Follow-ups:**
- *How do you know when a version stops getting fixes?* Each release gets about two years of bug fixes and then security fixes until five years after release; the python.org downloads page lists each version's status.

---
## 12. Scenario & debugging questions

### Q65. An API is fast for 1 user but slow with 100 concurrent users. How do you investigate?

**Short answer:** Something is **queuing** under load: a blocking call on the event loop, a small connection pool, a rate-limited dependency, or CPU work in the web process. Measure where requests wait before changing anything, fix that one bottleneck, then re-run the load test. Adding more servers only helps if the bottleneck isn't a shared resource such as the database.

**Steps (in this order):**
1. **Measure.** Look at p95/p99 latency (not just the average), per-dependency latency from traces, CPU, memory, event-loop lag and connection-pool wait time. Result: tells you whether time is spent computing, waiting on a dependency, or waiting in a queue inside your own service.
2. **Find the queue.** Compare latency of one request alone with latency at 100. If the single-request time is unchanged but total time grows linearly, requests are being served one at a time somewhere (event loop, a lock, a pool of size 5).
3. **Check for blocking calls in `async def`.** Search for `time.sleep`, `requests.get`, sync DB drivers or SDK calls. Run with `PYTHONASYNCIODEBUG=1` to log slow callbacks. Result: a blocked loop makes every request wait for each blocking call.
4. **Check pool and limit sizes.** Database pool size, HTTP client connection limit, thread-pool size, number of worker processes. Result: a pool of 5 with 100 users means 95 are waiting.
5. **Check downstream limits.** Are there HTTP 429 responses or retries piling up? Result: retries multiply load on an already limited dependency (see Q58).
6. **Fix one thing, load-test again, compare.**

**Example (the most common cause):**
```python
@app.get("/doc/{id}")
async def get_doc(id: str):
    return s3.get_object(Bucket="b", Key=id)                              # ❌ blocking SDK call stalls the loop
    # return await asyncio.to_thread(s3.get_object, Bucket="b", Key=id)   # ✅ runs in a worker thread
```

**What happens, step by step (illustrative numbers):**
1. One request takes 200 ms, all of it inside the blocking call.
2. With 100 simultaneous requests, the event loop handles them one at a time while it is blocked: request 100 waits about 99 × 200 ms ≈ 20 s.
3. With `to_thread` (default thread pool), up to the pool's limit run concurrently, so the 100 requests finish in a few seconds, and then the thread pool or the downstream service becomes the next limit to tune.

**Interview answer:** "I'd first measure where requests wait: p95 latency, traces per dependency, event-loop lag and pool wait times. Typical culprits are blocking calls inside async handlers, undersized connection pools, downstream rate limits with retry storms, and CPU work in the web process. I fix the specific bottleneck, for example offloading with `to_thread`, resizing the pool or adding a semaphore, re-run the load test, and only then scale out."

**Follow-ups:**
- *How do you detect event-loop lag?* Schedule a tiny periodic task and record how late it runs; sustained lag means something is blocking.

---

### Q66. Design a safe concurrent document-processing worker

**Short answer:** Put work on a **queue**, make each job **idempotent** with a conditional "claim", process with **bounded concurrency**, **stream** big files, **checkpoint** progress, retry only transient errors, and send repeatedly failing messages to a **dead-letter queue**. Delete the message only after success, and shut down gracefully.

```flow
pipeline: A safe concurrent document worker
Upload and event > A user uploads a file to object storage; an event puts {job_id} on a queue. The queue buffers bursts and redelivers if a worker crashes.
Receive a message > The worker long-polls the queue. Delivery is at least once, so duplicates can happen.
Claim the job > A conditional database write (status must still be PENDING) lets exactly one worker win. A duplicate delivery then does nothing: that is idempotency.
Stream and process > Read the file page by page. Loading a 500-page PDF into memory would risk an out-of-memory kill.
Bounded concurrency > A Semaphore(10) caps in-flight calls to the OCR or LLM service, to stay inside its quota.
Checkpoint each page > Save progress, so a retry resumes at page 38 instead of page 1.
Retry or give up > Transient errors retry with backoff and jitter; permanent errors fail fast. After N failures the message goes to the dead-letter queue and an alarm fires.
Acknowledge > Delete the message only after the result is saved. On SIGTERM, stop receiving, finish in-flight pages, then exit.
```

**Example (the core loop):**
```python
async def handle(message):
    job_id = message["job_id"]
    if not await db.claim(job_id):          # conditional write: PENDING -> RUNNING, False if already claimed
        return                              # duplicate delivery: ack and move on
    start = await db.last_page_done(job_id) + 1
    async with asyncio.TaskGroup() as tg:
        sem = asyncio.Semaphore(10)
        for page in pages_from(job_id, start):          # a generator streaming from storage
            tg.create_task(process_page(sem, job_id, page))
    await db.mark_done(job_id)
```

**What happens, step by step:**
1. The message `{job_id: "j1"}` arrives. `claim` runs `UPDATE … WHERE status='PENDING'`; if it affected 0 rows another worker has the job, so this one returns immediately.
2. The worker looks up the last checkpoint, say page 37, so it resumes at page 38.
3. Pages are produced lazily by the generator; each task waits on the semaphore, so at most 10 pages call the external service at once.
4. If a page raises a transient error, `process_page` retries with backoff; a permanent error fails the job, which is recorded with the error.
5. After all pages succeed, the job is marked done and then the message is acknowledged. A crash before that point causes redelivery, and the claim plus checkpoints make the retry safe.

**Common mistake → fix:** deleting the message when it is received, then processing. If the worker crashes mid-job the work is lost forever. Acknowledge only after the result is durably saved.

**Interview answer:** "A queue decouples uploads from processing and gives redelivery on crashes. Because delivery is at-least-once, each job is claimed with a conditional write so duplicates are harmless. I stream the document, bound concurrency with a semaphore, checkpoint per page, retry only transient errors with backoff, and use a dead-letter queue and alarms for poison messages. I acknowledge only after saving results and handle SIGTERM by finishing in-flight work, and I watch queue depth and the age of the oldest message."

**Follow-ups:**
- *What if processing takes longer than the visibility timeout?* The queue redelivers while you are still working; extend the timeout with a heartbeat, and rely on the claim to keep it safe.

---

### Q67. Your service's memory grows until the container is killed (OOM). What are the steps?

**Short answer:** First confirm the pattern, then reproduce it under load, take memory snapshots minutes apart, diff them to find which line keeps allocating, fix that reference, and add guards. Don't just raise the memory limit.

**Steps:**
1. **Confirm the shape.** In container memory metrics: a steady upward slope is a leak (references kept); sudden spikes per request point to big payloads or loading whole files. Result: decides whether to hunt a leak or reduce per-request peak memory.
2. **Reproduce locally** with the same traffic shape (a load tool replaying typical requests). Result: a repeatable test you can run after the fix.
3. **Snapshot and diff.** `tracemalloc.take_snapshot()` at two points and call `compare_to` (Q57), or run `memray`. Result: the top lines by growth name the allocation site.
4. **Find who holds the reference.** Typical owners: a global dict or list, `lru_cache(maxsize=None)` or a cache on a method, tasks created and never awaited, per-request objects stored in a module-level structure, unclosed clients or sessions. `gc.get_referrers(obj)` can help trace holders.
5. **Fix and guard.** Bound the cache, stream data, close clients with `with`/`async with`. Add a memory alarm, a regression test that runs the loop and checks growth, and as a safety net recycle workers (for example `--max-requests` in gunicorn).

**Example:**
```python
from functools import lru_cache

class Parser:
    @lru_cache(maxsize=None)          # ❌ cache key includes self: every Parser instance and result is kept forever
    def parse(self, text): ...

@lru_cache(maxsize=2048)              # ✅ module-level, bounded, no self in the key
def parse(text): ...
```

**What happens, step by step:**
1. Each request creates a `Parser` and calls `parse`. The cache stores `(self, text)` → result, so the `Parser` can never be freed.
2. After a few hours the snapshot diff shows `parse` and the cache's internal dict as the top growth.
3. Switching to a bounded module-level cache stops the growth: old entries are evicted, and `Parser` objects are freed when their last reference goes.

**Interview answer:** "I confirm from metrics whether it's steady growth or per-request spikes, reproduce under load, and use tracemalloc or memray snapshots a few minutes apart to diff allocations. The owner is usually an unbounded cache, a growing global, an `lru_cache` on a method, never-awaited tasks or whole payloads in memory. I fix the reference, add alarms and a regression test, and recycle workers as a safety net, never just a bigger limit."

**Follow-ups:**
- *Growth that never appears in tracemalloc?* Native memory from C extensions or fragmentation. Compare process memory (RSS) against Python's own numbers, and try `memray`'s native tracking.

---

### Q68. What do you check in a Python pull request review?

**Short answer:** Check the things that fail in production, not only style: input validation at boundaries, timeouts, bounded concurrency, retries and idempotency, secrets handling, resource cleanup, blocking calls in async code, error handling, tests for failure paths, and backward compatibility.

**Checklist (each item says what to look for):**
1. **Boundaries.** Is external input (requests, files, model output) validated with something like Pydantic before use?
2. **Timeouts.** Does every network call have one? A call without a timeout can hang a worker forever.
3. **Concurrency.** Is fan-out bounded (a semaphore or pool size) rather than `gather` over thousands of items? Any shared mutable state without a lock?
4. **Retries.** Only for transient errors, with backoff and a cap, and only on idempotent operations?
5. **Secrets and data.** No keys in code or logs; no personal data logged; parameterised SQL.
6. **Cleanup.** Files, sessions and locks in `with`/`async with`; no blocking calls such as `time.sleep` or `requests` inside `async def`.
7. **Errors.** No bare `except:` and no swallowed exceptions; `raise … from err` when translating.
8. **Types and tests.** Type hints on new code, tests for edge cases and failure paths, meaningful assertions, no mocks of your own logic.
9. **Compatibility.** Do API or stored-data schema changes keep old clients and old data working?

**Example finding:**
```python
async def fetch_all(urls):
    return await asyncio.gather(*(client.get(u) for u in urls))      # review comment ↓
# 1) no timeout on client.get  2) unbounded: 5,000 urls open 5,000 connections
# suggested: Semaphore(20) + asyncio.timeout(10) + TaskGroup
```

**What happens, step by step:**
1. The reviewer sees `gather` over an input list of unknown size, a red flag for unbounded concurrency.
2. They check the client's settings: no timeout, so one stuck server can hold a task forever.
3. The suggested change caps in-flight requests at 20 and gives each a 10-second deadline, so failures are bounded and visible (Q48).

**Interview answer:** "I review for production failure modes first: validated inputs, timeouts on all network calls, bounded concurrency, retries only where safe, idempotent side effects, no secrets or personal data in code or logs, proper cleanup and no blocking in async code. Then I check types, failure-path tests and backward compatibility. Formatting is handled automatically by Ruff in CI."

**Follow-ups:**
- *How do you give feedback?* Explain the failure scenario ("this can hang a worker when the server stalls"), not just the rule.

---

## 13. Cheat sheet

| Topic | One-liner |
|---|---|
| Variables | names are labels on objects; `b = a` is an alias, not a copy |
| Numbers | ints are unlimited; floats are approximate; use `Decimal` or cents for money |
| Truthiness | empty containers, 0 and `None` are falsy; test `None` with `is` |
| Defaults | evaluated once at `def`; use a `None` sentinel |
| `is` vs `==` | identity vs value |
| Copy | shallow shares inner objects; `deepcopy` does not |
| Hashable | immutable, with `__hash__` consistent with `__eq__` |
| Memory | refcount frees at zero; the cycle collector handles cycles |
| Scope | Local, Enclosing, Global, Built-ins; `nonlocal` and `global` rebind |
| Closures | capture variables, not values (late binding) |
| Decorator | `f = deco(f)`; use `functools.wraps`; with arguments it has three levels |
| MRO | `super()` is the next class in the C3 order |
| Protocol vs ABC | structural vs nominal |
| Generator | lazy, single pass, constant memory |
| Context manager | guaranteed cleanup; put cleanup in `finally` |
| Exceptions | catch narrow; `raise … from err`; `except*` for groups |
| Hints | describe; Pydantic enforces at boundaries |
| GIL | one thread runs bytecode; not thread safety; free-threaded build is opt-in |
| I/O-bound vs CPU-bound | asyncio or threads vs processes |
| asyncio | cooperative; never block the loop; `to_thread` |
| Bounded fan-out | `Semaphore` + `TaskGroup` + `timeout` |
| Reproducible builds | `pyproject.toml` + lockfile + `uv sync --locked` |
| Retries | transient only, backoff + jitter, idempotency |
| Shared state across servers | database conditional writes, not Python locks |
| Newest | 3.14 t-strings and free-threading support; 3.15 lazy imports and `frozendict` |

## Official references

- https://docs.python.org/3/tutorial/ · https://docs.python.org/3/whatsnew/
- https://docs.python.org/3/library/asyncio.html
- https://docs.python.org/3/howto/free-threading-python.html
- https://docs.python.org/3/library/multiprocessing.html
- https://docs.pydantic.dev/ · https://docs.pytest.org/en/stable/
- https://docs.astral.sh/uv/
