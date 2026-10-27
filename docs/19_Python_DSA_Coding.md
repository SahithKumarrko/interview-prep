# Python Algorithms & Coding: Interview Preparation

> **Updated:** 27 October 2026 · **Level:** fundamentals → core patterns with code → scale & concurrency problems
> **How to use:** read the *Short answer* first, then *How it works* and the *Example*. The *What happens, step by step* section (and the `trace` diagrams) show the real values changing, so follow them with a pencil. In the interview: clarify → examples and edge cases → brute force → optimise → code → test → state complexity.

---

## Table of contents

1. [Mental model: how to attack a coding problem](#1-mental-model-how-to-attack-a-coding-problem)
2. [Foundations: data structures and complexity](#2-foundations-data-structures-and-complexity) (Q01–Q06)
3. [Arrays, hashing, strings](#3-arrays-hashing-strings) (Q07–Q16)
4. [Stacks, queues, heaps](#4-stacks-queues-heaps) (Q17–Q22)
5. [Linked lists](#5-linked-lists) (Q23–Q26)
6. [Trees & tries](#6-trees--tries) (Q27–Q32)
7. [Graphs](#7-graphs) (Q33–Q40)
8. [Recursion, backtracking, dynamic programming, greedy](#8-recursion-backtracking-dynamic-programming-greedy) (Q41–Q47)
9. [Sorting and bits](#9-sorting-and-bits) (Q48–Q49)
10. [Design & scale problems](#10-design--scale-problems) (Q50–Q55)
11. [Testing & concurrency](#11-testing--concurrency) (Q56–Q58)
12. [Cheat sheet](#12-cheat-sheet)

---

## 1. Mental model: how to attack a coding problem

**The one idea:** almost every interview problem is a known **pattern** wearing a disguise. Your job is to (1) understand exactly what is asked, (2) find the slow obvious solution, (3) spot which repeated work a pattern can remove, and (4) say the complexity out loud. A pattern is just "a data structure plus a way of walking over the data".

Think of it like a toolbox: a hash map is a label-maker for instant lookup, two pointers is walking in from both ends, a heap is a "who is the smallest right now?" desk, and so on. You don't invent tools in the interview; you recognise which tool the problem is asking for.

```flow
pipeline: The seven steps for any coding question
Clarify > Ask about input size, duplicates, negatives, empty input, sorted or not, and what to return if there is no answer. Write the constraints down.
Examples > Work one normal case and two edge cases by hand. This is also how you discover the pattern.
Brute force > Say the simple solution and its complexity out loud. It proves you understand the problem and gives you a fallback.
Optimise > Ask which repeated work a pattern can remove (see the table below).
Code > Use clear names and small helper functions. Talk while you write.
Test > Trace your own examples through the code, then edge cases: empty, one item, all equal, very large.
Complexity > State time and extra space and explain why in one sentence each.
```

**Constraint → what complexity is acceptable** (rough rule: a computer does about 10⁷–10⁸ simple steps per second in Python-level loops, so aim lower):

| n (input size) | Acceptable |
|---|---|
| up to 20 | O(2ⁿ), O(n!): backtracking |
| up to 1,000 | O(n²) |
| up to 10⁵–10⁶ | O(n log n) or O(n) |
| 10⁸ or a stream | O(n) single pass with O(1) or O(log n) memory, or distribute the work |

**Pattern recognition map: clue → pattern:**

| Clue in the problem | Pattern |
|---|---|
| "find a pair/complement", "seen before", counting | **Hash map / set** |
| sorted array, pair with target, palindrome, in place | **Two pointers** |
| longest/shortest **contiguous** subarray or substring with a condition | **Sliding window** |
| sum of a range, count subarrays with sum = k | **Prefix sums** (+ hash map) |
| sorted or monotonic answer space, "minimum X such that…" | **Binary search** |
| top-k, k-th largest, merge k sorted, scheduling | **Heap** |
| next greater/smaller element, histogram | **Monotonic stack** |
| matching brackets, undo, nested expressions | **Stack** |
| overlapping ranges, meetings | **Sort + intervals** |
| shortest path in an unweighted graph or grid, "levels" | **BFS** |
| connected components, all paths, cycle detection | **DFS** |
| dependencies, ordering, prerequisites | **Topological sort** |
| weighted shortest path (non-negative) | **Dijkstra** |
| grouping, "are these connected?" with merges | **Union-Find** |
| prefix search, autocomplete | **Trie** |
| all combinations / permutations / subsets | **Backtracking** |
| optimal value with overlapping subproblems ("max/min/number of ways") | **Dynamic programming** |
| O(1) get/put with eviction | **Hash map + doubly linked list (LRU)** |

---

## 2. Foundations: data structures and complexity

### Q01. What is a data structure, and what is an algorithm?

**Short answer:** A **data structure** is a way of organising data in memory so that certain operations are fast (a list for ordered items, a dict for lookup by key, a heap for "give me the smallest"). An **algorithm** is a step-by-step procedure that solves a problem using those structures (binary search, BFS). Interview questions ask you to pick the structure whose fast operations match what the problem needs most.

**How it works:** every structure is a trade-off. A list keeps order and gives O(1) access by position but needs a full scan to find a value. A set gives O(1) "is it in here?" but forgets order. Choosing well often turns an O(n²) solution into O(n): the algorithm barely changes, but the structure under it does.

**Example:** "Does this list of 100,000 user IDs contain a duplicate?"
```python
def has_duplicate_slow(ids):
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):       # compares every pair
            if ids[i] == ids[j]:
                return True
    return False                               # O(n²)

def has_duplicate(ids):
    seen = set()
    for x in ids:
        if x in seen:                          # O(1) lookup
            return True
        seen.add(x)
    return False                               # O(n) time, O(n) space

print(has_duplicate([4, 8, 15, 8]))            # True
```

**What happens, step by step (`[4, 8, 15, 8]`):**
1. `seen` is empty. `x = 4`: not in `seen`, so add it → `{4}`.
2. `x = 8`: not in `seen` → `{4, 8}`.
3. `x = 15`: → `{4, 8, 15}`.
4. `x = 8`: `8 in seen` is `True` → return `True` immediately, without looking at anything else.
5. The slow version would compare up to n(n−1)/2 ≈ 5 billion pairs for 100,000 ids; the set version does at most 100,000 lookups. Same algorithmic idea ("look for a repeat"), different structure.

**Common mistake → fix:** picking a structure by habit. Using a list for repeated membership tests (`if x in some_list` inside a loop) hides an O(n) scan inside every iteration. Fix: ask "what operation do I repeat most?" and choose the structure that makes that operation cheap (set or dict for lookups, heap for min/max, deque for both-end queues).

**Interview answer:** "A data structure organises data to make particular operations cheap, and an algorithm is the procedure that uses it. Most optimisations are really a change of structure, such as replacing a list scan with a hash set. So I start by asking which operation the problem repeats and pick the structure that makes it fast."

**Follow-ups:**
- *What's an abstract data type?* The behaviour (stack: push/pop, queue: enqueue/dequeue) separate from how it is stored. A stack can be built on a list or a linked list.

---

### Q02. Which built-in structures does Python give you, and what do they cost?

**Short answer:** `list` (dynamic array), `tuple` (immutable list), `dict` and `set` (hash tables), `str` (immutable text), `collections.deque` (fast at both ends), and `heapq` (min-heap functions working on a list). Knowing the cost of the common operations lets you judge a solution's complexity at a glance.

| Operation | Cost | Notes |
|---|---|---|
| `list[i]`, `list.append(x)`, `list.pop()` | O(1) | `append` is O(1) *amortised* (Q04) |
| `list.insert(0, x)`, `list.pop(0)` | O(n) | shifts every element; use `deque` instead |
| `x in list` | O(n) | scans |
| `x in set`, `x in dict`, `d[k]` | O(1) average | hashing (needs hashable keys) |
| `list[a:b]` | O(b − a) | slicing **copies** |
| `deque.append`, `appendleft`, `pop`, `popleft` | O(1) | no random index access in the middle |
| `heapq.heappush`, `heappop` | O(log n) | `heap[0]` is the smallest, O(1) |
| `sorted(x)`, `x.sort()` | O(n log n) | stable |
| `s += "x"` in a loop | up to O(n²) | collect pieces and `"".join(parts)` |

**Example:**
```python
from collections import deque
import heapq

queue = deque([1, 2, 3])
queue.append(4)                 # [1, 2, 3, 4]
first = queue.popleft()         # 1, O(1)  (list.pop(0) would be O(n))

heap = []
for x in [5, 1, 9, 3]:
    heapq.heappush(heap, x)
print(heap[0], heapq.heappop(heap), heap[0])    # 1 1 3

counts = {}
for ch in "banana":
    counts[ch] = counts.get(ch, 0) + 1
print(counts)                   # {'b': 1, 'a': 3, 'n': 2}
```

**What happens, step by step:**
1. `deque([1, 2, 3])` then `append(4)` adds at the right end; `popleft()` removes `1` from the left end in constant time, with no shifting.
2. Pushing 5, 1, 9, 3 into the heap keeps the smallest at index 0. `heap[0]` is `1`; `heappop` removes and returns `1`; the new smallest is `3`.
3. The counting loop: for each letter, `get(ch, 0)` returns the current count (or 0), we add 1 and store it. `banana` → b:1, a:3, n:2.

**Common mistake → fix:** using a list as a queue.
```python
q = list(range(100_000))
while q:
    q.pop(0)            # ❌ every pop shifts all remaining items: O(n²) overall
from collections import deque
q = deque(range(100_000))
while q:
    q.popleft()         # ✅ O(1) each
```

**Interview answer:** "I know the costs by heart: list index and append are O(1), insert or pop at the front is O(n), membership in a list is O(n) but in a set or dict is O(1) on average, heap push and pop are O(log n), sorting is O(n log n). When I need a queue I use `deque`, for 'smallest first' I use `heapq`, and for counting I use `Counter` or a dict."

**Follow-ups:**
- *Why does a dict give O(1)?* It is a hash table: the key's hash picks the slot directly (see the Python course, hashing).
- *Does Python have a built-in linked list or tree?* No. Linked lists and trees are built from small classes; `deque` covers most linked-list uses.

---

### Q03. How do you analyse time and space complexity?

**Short answer:** Count how the number of basic steps **grows as the input size n grows**, keep only the fastest-growing term, and drop constants: 3n² + 5n + 2 is **O(n²)**. **Space complexity** is the *extra* memory your algorithm uses beyond the input, including the recursion stack. Big-O describes growth rate, not exact time.

**How it works:** look at the loops. One loop over n items → O(n). A loop inside a loop over the same n → O(n²). Halving the problem each step → O(log n). Doing something O(n) inside each of log n steps → O(n log n). Sequential blocks add (take the largest); nested blocks multiply.

```flow
trace: How the number of steps grows with n = 1,000
dictionary lookup, O(1) > About 1 step. It does not matter how big the dictionary is.
binary search, O(log n) > About **10** steps, because 2 to the power 10 is roughly 1,000: each step halves the range.
one loop, O(n) > **1,000** steps.
sorting, O(n log n) > About **10,000** steps.
nested loops, O(n²) > **1,000,000** steps. Ten times more data means a hundred times more work.
```

| Big-O | Typical example |
|---|---|
| O(1) | dict lookup, `list.append` |
| O(log n) | binary search, heap push/pop |
| O(n) | one loop, `x in list` |
| O(n log n) | sorting |
| O(n²) | two nested loops over the input |
| O(2ⁿ) | generating all subsets |

**Example:**
```python
def example(nums):                 # n = len(nums)
    total = 0
    for x in nums:                 # O(n)
        total += x
    seen = set()
    for x in nums:                 # O(n)
        seen.add(x)
    pairs = 0
    for a in nums:                 # O(n²)
        for b in nums:
            if a + b == total:
                pairs += 1
    return pairs                   # time O(n + n + n²) = O(n²); extra space O(n) for the set
```

**What happens, step by step:**
1. The first two loops are each n steps, and they run one after the other, so they add: n + n = 2n.
2. The nested loops do n × n = n² steps.
3. Total ≈ n² + 2n. For large n the n² term dominates, so the time is **O(n²)**.
4. The only extra memory that grows with n is the set, so space is **O(n)**; `total` and `pairs` are single numbers (O(1)).

**Common mistake → fix:** forgetting hidden costs. `if x in my_list` looks like one step but is O(n); slicing `a[i:j]` copies; `s = s + c` copies the string. A loop with one of these inside is quietly O(n²). Count the cost of each line, not just the loops.

**Interview answer:** "I count how many basic steps run as a function of the input size, keep the dominant term and drop constants. Sequential loops add, nested loops multiply, halving gives log n. I also state extra space, including the recursion stack, and I watch for hidden costs such as `in` on a list or slicing. Then I check the result against the constraints to see if it is fast enough."

**Follow-ups:**
- *Best, average, worst case?* Big-O usually means worst case; quicksort is O(n log n) on average but O(n²) worst case. Say which one you mean.
- *O(n) vs O(2n)?* The same: constants are dropped.

---

### Q04. What is amortised complexity?

**Short answer:** Amortised cost is the **average cost per operation over a long sequence**, even though an occasional operation is expensive. Python's `list.append` is O(1) amortised: usually it writes into spare room, and occasionally it has to allocate a bigger array and copy everything (O(n)), but those copies are rare enough that the average stays constant.

**How it works:** a list over-allocates capacity. When it is full, Python allocates a bigger block (the growth is proportional, so the number of copies grows only logarithmically), copies the items over, and now has room for many cheap appends. If the capacity roughly doubles each time (the real growth factor is smaller, about 1.125×, but the argument is the same for any constant factor), the total copying across n appends is a small multiple of n, so each append costs a constant on average.

```flow
trace: Appending to a list that doubles when full (simplified model)
capacity 4, items [1, 2, 3, 4] > Appends 1 to 4 each wrote into a free slot: 1 step each.
append 5, list is full > Allocate capacity **8** and copy 4 items: one expensive append costing about 4 steps.
appends 6, 7, 8 > The spare room absorbs these: 1 step each.
append 9, list is full again > Allocate capacity **16** and copy 8 items.
total copy work so far: 4 + 8 = 12, for 9 appends > Copies happen at sizes 4, 8, 16, ... which sum to less than 2n, so the average per append is a constant.
```

**Example:**
```python
import sys
a, sizes = [], set()
for i in range(40):
    a.append(i)
    sizes.add(sys.getsizeof(a))
print(sorted(sizes))     # a short list of sizes: memory jumps only now and then
```

**What happens, step by step:**
1. Each `append` that finds spare room is a simple write.
2. `sys.getsizeof(a)` only changes when Python reallocates, so `sizes` contains far fewer values than the 40 appends (the exact numbers depend on the Python version and platform).
3. The few reallocations are the expensive "copy everything" steps; they are spread across many cheap appends.

**Common mistake → fix:** treating an amortised O(1) as a guarantee for every call. In a latency-critical path, a single append can still be slow if it triggers the copy. If you need guaranteed bounds, preallocate (`[0] * n`) or use a fixed-size structure.

**Interview answer:** "Amortised complexity averages the cost over a sequence of operations. A list append is usually one write, and occasionally an O(n) resize, but because the array grows proportionally, the total copy work is linear in the number of appends, so each append is O(1) amortised. It's an average over time, not a worst-case promise for each individual call."

**Follow-ups:**
- *Other amortised examples?* Hash table inserts (with occasional resizing) and union-find with path compression.

---

### Q05. What is recursion, and what are its limits in Python?

**Short answer:** **Recursion** means a function calls itself on a smaller version of the problem until it reaches a **base case** that it can answer directly. Each call gets its own stack frame holding its local variables, so the **depth** of the recursion costs memory (O(depth) space). Python limits the depth, by default to about **1,000** frames, and raises `RecursionError` beyond that; for deep inputs use a loop or an explicit stack.

**How it works:**
1. Define the **base case** first (the smallest input, answered directly).
2. Define the **recursive case**: solve a smaller problem, then combine.
3. Calls pile up on the call stack going down; once the base case returns, the frames unwind in reverse order, combining results.

**Example:**
```python
import sys

def fact(n):
    if n == 0:               # base case
        return 1
    return n * fact(n - 1)   # recursive case

print(fact(3))                       # 6
print(sys.getrecursionlimit())       # 1000 by default

def fact_iter(n):              # the loop version never hits the limit
    total = 1
    for i in range(2, n + 1):
        total *= i
    return total
```

```flow
trace: The call stack for fact(3)
fact(3) calls fact(2) > fact(3) is paused, waiting for the answer. One frame is on the stack.
fact(2) calls fact(1), fact(1) calls fact(0) > Four frames are stacked: fact(3), fact(2), fact(1), fact(0). Depth grows with n, so space is O(n).
fact(0) returns **1** > The base case answers directly. No more calls.
fact(1) returns 1 * 1 = **1**, fact(2) returns 2 * 1 = **2** > Frames pop off in reverse order, each multiplying by its own n.
fact(3) returns 3 * 2 = **6** > The stack is empty again.
```

**What happens, step by step:** follow the trace: three calls go down to `fact(0)`, then results come back up as 1, 1, 2, 6 (written with the multiplications: 1, 1×1, 2×1, 3×2). `fact(5000)` would need 5,000 frames and fail with `RecursionError`, which is not a bug in the algorithm but a limit of the language; the loop version handles it fine.

**When recursion fits:** trees and nested structures, divide and conquer, backtracking. **When to avoid it:** simple linear loops, or very deep inputs (a linked list or graph path of 100,000 nodes).

**Common mistake → fix:** a missing or unreachable base case, e.g. `fact(n)` called with a negative number never reaches `n == 0`, so it recurses until `RecursionError`. Make sure every path moves toward the base case; guard inputs. Raising the limit with `sys.setrecursionlimit` can crash the interpreter with a real stack overflow if you go too high; prefer an explicit stack.

**Interview answer:** "Recursion solves a problem by calling itself on a smaller input until a base case. Each call uses a stack frame, so space is proportional to the depth, and Python's default limit is about a thousand frames. I use recursion for trees and backtracking where it is natural, and convert to a loop with an explicit stack when depth could be large. I always write the base case first."

**Follow-ups:**
- *Is tail recursion optimised in Python?* No. Python doesn't eliminate tail calls, so write the loop yourself.
- *How do you avoid repeated work in recursion?* Memoise (Q43): cache results of subproblems.

---

### Q06. What does a good interview solution look like end to end?

**Short answer:** Not just correct code: a clear problem statement, a stated brute force, a justified optimisation, clean code and a hand-run test. Interviewers watch how you reason as much as the final answer. Below is one problem taken through every step.

**Example problem:** "Given a list of numbers, return the length of the longest run of consecutive integers (order in the list doesn't matter), for example `[100, 4, 200, 1, 3, 2]` → `4` (1, 2, 3, 4)."

**Step by step:**
1. **Clarify:** can the list be empty (answer 0)? Duplicates? (Yes, ignore them.) Size? Say up to 10⁵, so O(n²) is too slow.
2. **Brute force:** sort and scan, O(n log n); or for each number keep checking `x+1, x+2, …` in a list, O(n²). State both.
3. **Optimise:** put the numbers in a set for O(1) lookups. Only start counting from a number `x` whose predecessor `x − 1` is **not** in the set (so `x` begins a run); then walk up `x+1, x+2, …` while they are present. Each number is walked over at most once, so O(n).
4. **Code:**
```python
def longest_consecutive(nums: list[int]) -> int:
    present = set(nums)
    best = 0
    for x in present:
        if x - 1 not in present:            # x starts a run
            length = 1
            while x + length in present:
                length += 1
            best = max(best, length)
    return best

print(longest_consecutive([100, 4, 200, 1, 3, 2]))   # 4
```
5. **Test by hand** on `[100, 4, 200, 1, 3, 2]`: `present = {100, 4, 200, 1, 3, 2}`.
   - `100`: is `99` present? No → run starts. `101` present? No → length 1.
   - `4`: `3` is present → skip (not a start).
   - `200`: `199` absent → run of length 1.
   - `1`: `0` absent → start. `2`, `3`, `4` all present, `5` not → length **4**. Best = 4.
   - `3`, `2`: predecessors present → skipped.
   Edge cases: `[]` → loop doesn't run → `0`. `[5, 5]` → set has one item → `1`.
6. **Complexity:** time O(n) (each number is the start of a walk at most once, and is walked over at most once); space O(n) for the set.

**Common mistake → fix:** jumping straight to code. Without examples and a stated brute force, you can miss edge cases (empty input, duplicates) and can't show you considered trade-offs. Spend the first minutes clarifying and working an example by hand.

**Interview answer:** "I restate the problem, ask about constraints and edge cases, give the brute-force solution with its complexity, then use the constraint to pick an optimisation, here a set to find run starts in O(n). I code it cleanly, walk through an example and the edge cases by hand, and finish by stating time and space complexity."

**Follow-ups:**
- *What if you get stuck?* Say what you tried, go back to a small example, and ask whether a hint on the data (sorted? bounded?) is allowed.

---
## 3. Arrays, hashing, strings

### Q07. How do you count and group things with a hash map?

**Short answer:** A **hash map** (Python `dict`) stores key → value pairs and finds a key in O(1) on average. The classic uses are **counting** how many times each item appears and **grouping** items under a shared key. `collections.Counter` counts, and `collections.defaultdict(list)` groups. Reach for a hash map whenever the problem says "how many", "have I seen this", or "which items share X".

**How it works:** one pass over the data, updating the map as you go: O(n) time, O(k) space for k distinct keys. A second pass over the *original order* (not the map) is how you answer "first/last" questions.

**Example 1: first non-repeating character.**
```python
from collections import Counter

def first_unique_char(s: str) -> str | None:
    counts = Counter(s)
    for ch in s:                     # original order
        if counts[ch] == 1:
            return ch
    return None

print(first_unique_char("aabcb"))   # c
```

```flow
trace: Counting with a hash map for s = "aabcb"
start, counts = {} > Pass 1 reads the string once and updates the counts.
after "a", "a" > counts = {a: **2**}
after "b", "c", "b" > counts = {a: 2, b: **2**, c: **1**}
pass 2 in original order: a has 2, a has 2, b has 2, c has **1** > The first character whose count is 1 is the answer: "c".
cost > Two passes of n steps: O(n) time, O(k) space for k distinct characters.
```

**Example 2: grouping anagrams** (words that use the same letters).
```python
from collections import defaultdict

def group_anagrams(words: list[str]) -> list[list[str]]:
    groups = defaultdict(list)
    for w in words:
        groups["".join(sorted(w))].append(w)    # key = the word's letters, sorted
    return list(groups.values())

print(group_anagrams(["eat", "tea", "tan", "ate", "nat"]))
# [['eat', 'tea', 'ate'], ['tan', 'nat']]
```

**What happens, step by step:**
1. `"eat"` → key `"aet"` (letters sorted) → new group `{"aet": ["eat"]}`.
2. `"tea"` → key `"aet"` → appended: `["eat", "tea"]`.
3. `"tan"` → key `"ant"` → new group. `"ate"` → `"aet"` → appended. `"nat"` → `"ant"` → appended.
4. Time is O(n · L log L) for n words of length L, because each word is sorted; using a tuple of 26 letter counts as the key makes it O(n · L).

**Common mistake → fix:** using a **list** as a dict key (`groups[sorted(w)]` raises `TypeError: unhashable type: 'list'`). Convert to a string or tuple first.

**Interview answer:** "For counting or grouping I use a hash map: one pass building counts with `Counter` or groups with `defaultdict(list)`, which is O(n) time. For 'first unique' I count first and then scan the original order. Keys must be hashable, so I convert lists to tuples or strings."

**Follow-ups:**
- *Top k frequent words?* `Counter(words).most_common(k)`, which uses a heap internally: O(n + m log k) for m distinct words.

---

### Q08. Two Sum: why does a hash map beat the brute force?

**Short answer:** "Find two numbers in a list that add up to `target`." Brute force checks every pair, O(n²). The hash-map solution makes **one pass**: for each number `x`, check whether its **complement** `target − x` was already seen. That makes it O(n) time and O(n) space. This is the template for any "find a pair/complement" question.

**How it works:** the map stores `value → index` for numbers seen so far. When you reach `x`, the partner (if one exists earlier in the list) is already in the map, so one lookup replaces a whole scan.

**Example:**
```python
def two_sum(nums: list[int], target: int) -> list[int]:
    seen = {}                                # value -> index
    for i, x in enumerate(nums):
        need = target - x
        if need in seen:
            return [seen[need], i]
        seen[x] = i
    return []

print(two_sum([2, 7, 11, 15], 9))            # [0, 1]
print(two_sum([3, 3], 6))                    # [0, 1]
```

```flow
trace: Two Sum on [2, 7, 11, 15] with target 9
i=0, x=**2**, need 7, seen = {} > 7 is not in seen, so store 2 → seen = {2: 0}.
i=1, x=**7**, need 2, seen = {2: 0} > 2 **is** in seen at index 0: the pair is found.
return [0, 1] > After 2 steps. Brute force would have compared pairs: (2,7), (2,11), ... up to n(n-1)/2 of them.
```

**What happens, step by step (`[3, 3]`, target 6):**
1. `i=0, x=3`: need `3`; `seen` is empty → store `seen = {3: 0}`.
2. `i=1, x=3`: need `3`; it is in `seen` at index 0 → return `[0, 1]`.
3. Checking **before** storing is what prevents a number pairing with itself when it appears only once (`[3]` with target 6 returns `[]`).

**Common mistake → fix:** storing `x` before checking the complement. For `[3]` and target 6, `seen[3]` is set first, then `need = 3` is found → it wrongly "pairs" index 0 with itself. Always look up first, then insert.

**Interview answer:** "Brute force is O(n²). With a hash map I do one pass: for each number I look up `target − x` among the numbers already seen and, if it isn't there, store the number with its index. That's O(n) time and O(n) space. I check before inserting so an element can't pair with itself."

**Follow-ups:**
- *What if the array is sorted?* Two pointers (Q09) solve it in O(n) time and O(1) space.
- *Three Sum?* Sort, fix one number, and run two pointers on the rest: O(n²).

---

### Q09. What is the two-pointers technique?

**Short answer:** Keep **two indexes** that move through the data in a coordinated way, usually one at each end moving inward, or both moving left to right at different speeds. On **sorted** data this turns pair searches from O(n²) into O(n) with O(1) extra memory, because every comparison lets you discard one element for good.

**How it works:** for "pair with sum = target" in a sorted array, put `lo` at the smallest value and `hi` at the largest. If `nums[lo] + nums[hi]` is too small, the only way to increase it is to move `lo` right (bigger left value). If it's too big, move `hi` left. If equal, you've found it.

**Example:**
```python
def pair_sum_sorted(nums: list[int], target: int) -> tuple[int, int] | None:
    lo, hi = 0, len(nums) - 1
    while lo < hi:
        s = nums[lo] + nums[hi]
        if s == target:
            return lo, hi
        if s < target:
            lo += 1              # need a bigger sum
        else:
            hi -= 1              # need a smaller sum
    return None

print(pair_sum_sorted([1, 3, 4, 6, 8, 9], 12))   # (1, 5)  -> 3 + 9
print(pair_sum_sorted([1, 3, 4, 6, 8, 9], 100))  # None
```

```flow
trace: Two pointers on [1, 3, 4, 6, 8, 9] with target 12
lo=0 (**1**), hi=5 (**9**), sum 10 > 10 is less than 12, so the sum must grow. Moving hi left could only make it smaller, so move lo right. Index 0 is discarded for good.
lo=1 (**3**), hi=5 (**9**), sum 12 > Equal to the target: return (1, 5).
cost > Each step discards one element, so at most n steps: O(n) time, O(1) space.
```

**What happens, step by step:**
1. Start `lo=0` (value 1), `hi=5` (value 9). Sum 10 < 12 → `lo += 1`.
2. Now `lo=1` (value 3): sum = 3 + 9 = 12 → return `(1, 5)`.
3. For target 100: sums are always smaller, so `lo` keeps moving until `lo == hi` and the loop ends → `None`.

**Another use: in-place removal of duplicates** from a sorted list: a slow pointer marks where the next unique value goes, a fast pointer scans.
```python
def dedupe_sorted(nums: list[int]) -> int:
    if not nums:
        return 0
    write = 1
    for read in range(1, len(nums)):
        if nums[read] != nums[write - 1]:
            nums[write] = nums[read]
            write += 1
    return write            # nums[:write] are the unique values
```
For `[1, 1, 2, 2, 3]`: `read=1` (1 equals last kept 1) skip; `read=2` (2 ≠ 1) write 2 at index 1, `write=2`; `read=3` skip; `read=4` (3 ≠ 2) write at index 2, `write=3` → first 3 items are `[1, 2, 3]`.

**Common mistake → fix:** using the opposite-ends version on **unsorted** data. The "discard one side" logic only holds when sortedness tells you which pointer to move. Sort first (O(n log n)) if you only need the values, or use the hash-map version (Q08).

**Interview answer:** "Two pointers walk the data from both ends or at different speeds. On sorted input, comparing the pair tells me which pointer to move, so each step discards an element and the whole thing is O(n) time and O(1) space. I use it for pair sums, palindromes, merging sorted lists and in-place filtering."

**Follow-ups:**
- *Is a palindrome check two pointers?* Yes: compare `s[lo]` and `s[hi]` while moving inward.

---

### Q10. What is the sliding window technique?

**Short answer:** For problems about a **contiguous** stretch of an array or string ("longest substring without repeats", "maximum sum of any 3 consecutive numbers"), keep a **window** `[left, right]`. Expand `right` one step at a time, and shrink `left` whenever the window breaks the rule. Each element enters and leaves the window at most once, so it runs in O(n) instead of checking every substring (O(n²) or worse).

**How it works:** two cases. **Fixed-size window:** slide it by adding the new element and subtracting the one that fell out. **Variable-size window:** grow on the right; while the window is invalid, advance `left`.

**Example:**
```python
def longest_unique_substring(s: str) -> int:
    last = {}                        # char -> most recent index
    left = best = 0
    for right, ch in enumerate(s):
        if ch in last and last[ch] >= left:
            left = last[ch] + 1      # jump past the earlier copy
        last[ch] = right
        best = max(best, right - left + 1)
    return best

def max_sum_k(nums: list[int], k: int) -> int:     # fixed window
    window = sum(nums[:k])
    best = window
    for i in range(k, len(nums)):
        window += nums[i] - nums[i - k]            # add newcomer, drop the one leaving
        best = max(best, window)
    return best

print(longest_unique_substring("abcabcbb"))    # 3
print(max_sum_k([2, 1, 5, 1, 3, 2], 3))        # 9
```

```flow
trace: Longest substring without repeats in "abcabcbb"
right=0..2, window "abc" (left=0) > All distinct, so the window grows. best = **3**.
right=3, char "a" was last seen at index 0, which is inside the window > A repeat. Move left to index 1, just past the old "a". Window "bca", length 3.
right=4, "b" last seen at 1, inside the window > left jumps to 2. Window "cab", length 3.
right=5, "c" last seen at 2 > left jumps to 3. Window "abc", length 3.
right=6, "b" last seen at 4 > left jumps to 5. Window "cb", length 2.
right=7, "b" last seen at 6 > left jumps to 7. Window "b", length 1. Final answer **3**.
```

**What happens, step by step (fixed window `[2, 1, 5, 1, 3, 2]`, k=3):**
1. First window `[2, 1, 5]` = 8, `best = 8`.
2. `i=3`: add `nums[3]=1`, drop `nums[0]=2` → 8 + 1 − 2 = 7. best stays 8.
3. `i=4`: add 3, drop 1 → 9. best = **9**.
4. `i=5`: add 2, drop 5 → 6. Answer 9. Each step is O(1), so O(n) total.

**Common mistake → fix:** forgetting the `last[ch] >= left` check. If `last["a"]` points to an index that is *before* `left`, that earlier "a" is already outside the window and must not move `left` backwards. Without the check, `"abba"` returns the wrong answer.

**Interview answer:** "A sliding window handles contiguous-range problems in O(n): I expand the right edge, and when the window violates the condition I advance the left edge until it is valid again. A fixed-size window updates its total by adding the new element and removing the old one. Each index enters and leaves at most once, so it's linear."

**Follow-ups:**
- *When does the window not work?* When the condition isn't monotonic, e.g. subarray sums with negative numbers: shrinking doesn't reliably fix a bad sum. Use prefix sums with a hash map (Q11).

---

### Q11. What are prefix sums, and how do they answer range queries fast?

**Short answer:** A **prefix sum** array stores running totals: `prefix[i]` is the sum of the first `i` numbers. After one O(n) pass, the sum of any range `nums[i..j]` is `prefix[j+1] − prefix[i]` in O(1). Combined with a hash map of earlier prefix values, it also counts subarrays whose sum equals `k` in O(n), even with negative numbers.

**How it works:** the sum of a range is "everything up to the end, minus everything before the start". For "subarray sums to k": if the running total now is `R` and an earlier running total was `R − k`, then the elements in between sum to exactly `k`.

**Example:**
```python
from itertools import accumulate

nums = [3, 1, 4, 1, 5]
prefix = [0, *accumulate(nums)]            # [0, 3, 4, 8, 9, 14]

def range_sum(i, j):                       # sum of nums[i..j], inclusive
    return prefix[j + 1] - prefix[i]

def count_subarrays_sum_k(nums, k):
    count, running = 0, 0
    seen = {0: 1}                          # running total -> how many times seen
    for x in nums:
        running += x
        count += seen.get(running - k, 0)
        seen[running] = seen.get(running, 0) + 1
    return count

print(range_sum(1, 3))                          # 6   (1 + 4 + 1)
print(count_subarrays_sum_k([1, 2, 3, -3, 3], 3))   # 5 (the subarrays [1,2], [3], [1,2,3,-3], [3,-3,3], [3])
```

```flow
trace: Prefix sums for nums = [3, 1, 4, 1, 5]
prefix = [0, 3, 4, 8, 9, 14] > prefix[i] is the sum of the first i numbers. Built in one pass.
range_sum(1, 3) = prefix[4] minus prefix[1] > 9 minus 3 = **6**, which is 1 + 4 + 1. One subtraction, however long the range.
queries > Each later query costs O(1) instead of O(length).
```

**What happens, step by step (`count_subarrays_sum_k([1, 2, 3], 3)`):**
1. `seen = {0: 1}`, `running = 0`.
2. `x=1`: running 1; need `1 − 3 = −2` → not seen; `seen = {0:1, 1:1}`.
3. `x=2`: running 3; need `3 − 3 = 0` → seen once → `count = 1` (the subarray `[1, 2]`); `seen[3] = 1`.
4. `x=3`: running 6; need `6 − 3 = 3` → seen once → `count = 2` (the subarray `[3]`). Answer 2.
5. `{0: 1}` at the start represents "an empty prefix", so a subarray starting at index 0 can be counted.

**Common mistake → fix:** using a sliding window for "sum equals k" when the array has negative numbers. Adding a negative number can make a window's sum smaller, so you can't decide whether to grow or shrink. Prefix sums with a hash map work for any integers.

**Interview answer:** "I build a prefix-sum array once so any range sum is `prefix[j+1] - prefix[i]` in constant time. To count subarrays with sum k, I keep a hash map of how often each running total has occurred and, at each element, add the count of `running - k`. It's O(n) and handles negative numbers."

**Follow-ups:**
- *2-D version?* A 2-D prefix grid answers rectangle-sum queries in O(1) with four lookups.

---

### Q12. How does binary search work, and how do you get it right?

**Short answer:** **Binary search** finds a value in a **sorted** array in O(log n) by repeatedly looking at the middle element and discarding the half that can't contain the target. The reliable way to write it is to keep a clear **invariant** (a statement that stays true each loop): "the answer, if it exists, is always inside `[lo, hi)`". It also works on any yes/no condition that flips only once ("binary search on the answer").

**How it works:** compare the middle to the target. If the middle is too small, the target (if present) is to the right: `lo = mid + 1`. Otherwise it is at `mid` or to the left: `hi = mid`. The range shrinks until `lo == hi`.

**Example 1: first index with value ≥ target** (this is `bisect_left`).
```python
def first_ge(nums: list[int], target: int) -> int:
    lo, hi = 0, len(nums)                # search in [lo, hi)
    while lo < hi:
        mid = (lo + hi) // 2
        if nums[mid] < target:
            lo = mid + 1                 # everything up to mid is too small
        else:
            hi = mid                     # mid could be the answer; keep it
    return lo

nums = [1, 3, 5, 7, 9, 11]
i = first_ge(nums, 7)
print(i, i < len(nums) and nums[i] == 7)   # 3 True
```

```flow
trace: Binary search for 7 in [1, 3, 5, 7, 9, 11]
lo=0, hi=6, mid=3, nums[3] is **7** > 7 is not less than 7, so mid might be the answer: hi = 3.
lo=0, hi=3, mid=1, nums[1] is **3** > 3 is less than 7: lo = mid + 1 = 2.
lo=2, hi=3, mid=2, nums[2] is **5** > 5 is less than 7: lo = 3.
lo=3, hi=3, loop ends > The first index with a value that is 7 or more is **3**. Steps: 3, about log2(6).
```

**Example 2: binary search on the answer.** "What is the smallest ship capacity that moves all packages in at most `days` days (in order)?"
```python
def min_capacity(weights: list[int], days: int) -> int:
    def can_ship(cap):
        need, load = 1, 0
        for w in weights:
            if load + w > cap:
                need, load = need + 1, 0
            load += w
        return need <= days

    lo, hi = max(weights), sum(weights)      # answer is somewhere in [lo, hi]
    while lo < hi:
        mid = (lo + hi) // 2
        if can_ship(mid):
            hi = mid                         # mid works; try smaller
        else:
            lo = mid + 1                     # mid too small
    return lo

print(min_capacity([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5))   # 15
```
Why it works: `can_ship(cap)` is false for small capacities and true from some point on (monotonic), so we binary search for the switch point. With capacity 15 the loads are [1..5], [6,7], [8], [9], [10]... checking 5 days: 15 (1+2+3+4+5), 13 (6+7), 8, 9, 10 → 5 days, OK; with 14, the first day holds 1+2+3+4 = 10 and so on, needing 6 days.

**Common mistake → fix:** `lo = mid` or `hi = mid - 1` mixed with the wrong loop condition causes an infinite loop or skips the answer. Pick one convention (`[lo, hi)` with `while lo < hi`, `lo = mid + 1`, `hi = mid`) and keep it. Also, the array must actually be sorted.

**Interview answer:** "Binary search keeps an invariant that the answer lies in a shrinking range and halves it each step, so it's O(log n). I use the half-open `[lo, hi)` form with `lo = mid + 1` or `hi = mid` to avoid off-by-one bugs. It also works on the answer space: if a yes/no check is monotonic, like 'can we ship in D days with capacity C', I binary search the capacity."

**Follow-ups:**
- *Python's built-in?* `bisect.bisect_left(a, x)` and `bisect_right`; `bisect.insort` inserts while keeping order (the insert itself is O(n)).

---

### Q13. When is sorting the right tool?

**Short answer:** Sorting costs O(n log n) but often turns a hard problem into a simple scan, because **related items become neighbours**: duplicates, closest values, overlapping intervals, anagram groups. If a brute force compares every pair (O(n²)), ask "if this were sorted, would I only need to compare neighbours?"

**How it works:** Python's `sorted(iterable, key=...)` returns a new list; `list.sort()` sorts in place. Both are **stable** (equal items keep their original order) and take a `key` function. A tuple key sorts by several fields; negate a number to sort it descending.

**Example:** smallest difference between any two numbers.
```python
def min_gap(nums: list[int]) -> int:
    nums = sorted(nums)                              # O(n log n)
    return min(b - a for a, b in zip(nums, nums[1:]))     # O(n)

print(min_gap([9, 2, 15, 4]))     # 2   (between 2 and 4)

people = [("Asha", 91), ("Ravi", 78), ("Li", 91)]
people.sort(key=lambda p: (-p[1], p[0]))     # score descending, then name ascending
print(people)    # [('Asha', 91), ('Li', 91), ('Ravi', 78)]
```

```flow
trace: Sorting makes "closest pair" a single scan
input [9, 2, 15, 4] > Brute force would compare all 6 pairs; for 1,000 numbers that is about 500,000 comparisons.
sorted gives [2, 4, 9, 15] > Cost O(n log n).
neighbour gaps: 4 minus 2 = **2**, 9 minus 4 = 5, 15 minus 9 = 6 > After sorting, the closest pair must be adjacent, so n minus 1 subtractions are enough.
answer **2** > Total O(n log n) instead of O(n²).
```

**What happens, step by step (the people example):** keys become `(-91, "Asha")`, `(-78, "Ravi")`, `(-91, "Li")`. Tuples compare element by element: `-91 < -78`, so both 91-scorers come first; between them `"Asha" < "Li"`. Result: Asha, Li, Ravi.

**Common mistake → fix:** `result = nums.sort()` sets `result` to `None` because `.sort()` works in place and returns nothing. Use `sorted(nums)` when you want a new list.

**Interview answer:** "I sort when it makes related elements adjacent, so that a quadratic comparison becomes a linear scan: closest pair, duplicates, intervals. Python's sort is stable, O(n log n) and accepts a key function, with tuple keys for multi-level ordering. I remember that `sort()` returns `None` and `sorted()` returns a new list."

**Follow-ups:**
- *When is a sort too expensive?* When you only need the top k (use a heap, Q20) or one value (quickselect, average O(n)).

---

### Q14. How do you merge overlapping intervals?

**Short answer:** Sort the intervals by start time, then sweep through them keeping a current merged interval. If the next interval starts at or before the current end, they overlap, so extend the end with `max`; otherwise close the current one and start a new one. Cost: O(n log n) for the sort plus O(n) for the sweep.

**Example:**
```python
def merge(intervals: list[list[int]]) -> list[list[int]]:
    intervals.sort(key=lambda x: x[0])
    merged = []
    for start, end in intervals:
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)    # overlap: extend
        else:
            merged.append([start, end])                # gap: start a new one
    return merged

print(merge([[1, 3], [8, 10], [2, 6], [15, 18]]))   # [[1, 6], [8, 10], [15, 18]]
```

```flow
trace: Merging [1,3] [8,10] [2,6] [15,18]
sort by start > [1,3] [2,6] [8,10] [15,18]. After sorting, anything that overlaps is next to each other.
merged = [[1,3]] > The first interval starts the output.
next [2,6], start 2 is at most the current end 3 > Overlap: end becomes max(3, 6) = 6, so merged = [[1,**6**]].
next [8,10], start 8 is greater than end 6 > A gap, so start a new interval: [[1,6], [8,10]].
next [15,18], start 15 is greater than 10 > Another gap: [[1,6], [8,10], [15,18]].
```

**What happens, step by step:** follow the trace. The `max` matters: for `[1,10]` followed by `[2,3]`, the end must stay 10, not shrink to 3.

**Common mistake → fix:** forgetting to sort, or using `<` instead of `<=` (touching intervals like `[1,2]` and `[2,3]` then aren't merged; whether they should be is something to ask the interviewer). Also, don't overwrite `merged[-1][1] = end` without `max`.

**Interview answer:** "Sort by start, then walk once: if the next start is at or before the current end I extend the end with max, otherwise I begin a new interval. That is O(n log n) for the sort and O(n) for the sweep. The same sort-then-sweep idea solves meeting rooms: sort the starts and ends, or keep a heap of end times."

**Follow-ups:**
- *Minimum meeting rooms?* Sort by start; keep a min-heap of end times; if the earliest end is at or before the new start, reuse that room (pop it), then push the new end. The heap size at the end is the answer.

---

### Q15. Common string patterns: anagrams, palindromes and building strings

**Short answer:** Most string questions reduce to patterns you already know: **counting** (anagram = same letter counts), **two pointers** (palindrome), **sliding window** (longest substring), and **joining** (build with a list and `"".join`). Remember strings are immutable, so repeated `+=` can copy the growing string every time.

**Example:**
```python
from collections import Counter

def is_anagram(a: str, b: str) -> bool:
    return Counter(a) == Counter(b)                 # O(n)

def is_palindrome(s: str) -> bool:
    lo, hi = 0, len(s) - 1
    while lo < hi:
        while lo < hi and not s[lo].isalnum(): lo += 1
        while lo < hi and not s[hi].isalnum(): hi -= 1
        if s[lo].lower() != s[hi].lower():
            return False
        lo, hi = lo + 1, hi - 1
    return True

def compress(s: str) -> str:
    out = []
    i = 0
    while i < len(s):
        j = i
        while j < len(s) and s[j] == s[i]:
            j += 1
        out.append(f"{s[i]}{j - i}")
        i = j
    return "".join(out)

print(is_anagram("listen", "silent"))                       # True
print(is_palindrome("A man, a plan, a canal: Panama"))      # True
print(compress("aaabcc"))                                   # a3b1c2
```

**What happens, step by step:**
1. `is_anagram`: both strings have l:1, i:1, s:1, t:1, e:1, n:1 → the counters are equal.
2. `is_palindrome` on `"A man, a plan, a canal: Panama"`: `lo` and `hi` skip spaces and punctuation, compare lowercase letters from both ends (a/a, m/m, a/a, n/n, …) and meet in the middle → `True`. This version uses O(1) extra space (no cleaned copy).
3. `compress("aaabcc")`: `i=0`, `j` runs to 3 → `"a3"`; `i=3`, `j=4` → `"b1"`; `i=4`, `j=6` → `"c2"`. Joined once at the end: `a3b1c2`.

**Common mistake → fix:** building the result with `result += piece` inside a loop. Because each `+=` may copy the whole string so far, n pieces can cost O(n²) (CPython sometimes optimises this, but you can't rely on it). Append pieces to a list and call `"".join(parts)` once.

**Interview answer:** "String problems usually map to counting for anagrams, two pointers for palindromes and sliding windows for longest-substring questions. Strings are immutable, so I build results in a list and join once. I ask about case, punctuation and Unicode, and I mention the O(1)-space two-pointer version when a cleaned copy isn't necessary."

**Follow-ups:**
- *`str` slicing cost?* `s[i:j]` copies j − i characters, so slicing in a loop can hide O(n²).

---

### Q16. What is Kadane's algorithm (maximum subarray sum)?

**Short answer:** "Find the contiguous subarray with the largest sum." **Kadane's algorithm** does it in one pass: at each element, either **extend** the best subarray ending at the previous element or **start fresh** at this element, whichever is larger. Keep the best value seen. O(n) time, O(1) space. It is the simplest example of a dynamic-programming recurrence.

**How it works:** `cur` = best sum of a subarray that **ends at the current index**. If `cur` from before is negative, it only hurts, so drop it: `cur = max(x, cur + x)`. The answer is the maximum `cur` seen anywhere.

**Example:**
```python
def max_subarray(nums: list[int]) -> int:
    cur = best = nums[0]
    for x in nums[1:]:
        cur = max(x, cur + x)      # extend, or start over at x
        best = max(best, cur)
    return best

print(max_subarray([-2, 1, -3, 4, -1, 2, 1, -5, 4]))   # 6  (the subarray [4, -1, 2, 1])
print(max_subarray([-3, -1, -2]))                      # -1
```

```flow
trace: Kadane's algorithm on [-2, 1, -3, 4, -1, 2, 1, -5, 4]
x=-2 > cur = -2, best = -2. Nothing earlier to extend.
x=1 > cur = max(1, -2 + 1) = **1** (starting fresh beats extending a negative). best = 1.
x=-3 > cur = max(-3, 1 - 3) = **-2**. best stays 1.
x=4 > cur = max(4, -2 + 4) = **4** (the negative prefix is dropped). best = 4.
x=-1, 2, 1 > cur becomes 3, 5, **6**. best = **6**.
x=-5, 4 > cur drops to 1, then 5. best remains **6**: the subarray [4, -1, 2, 1].
```

**What happens, step by step:** the trace shows `cur` rising and falling; `best` only keeps the highest value. For an all-negative array like `[-3, -1, -2]`, starting `cur = best = nums[0]` (not 0) is what makes the answer `-1` instead of an empty subarray's 0.

**Common mistake → fix:** initialising `best = 0`. For all-negative input that returns 0 (an empty subarray) when the problem requires at least one element. Initialise from the first element.

**Interview answer:** "Kadane's algorithm tracks the best subarray sum ending at each position: either extend the previous best or start fresh at the current element, `cur = max(x, cur + x)`, and keeps the global maximum. It is a one-pass O(n) solution with O(1) space. I initialise from the first element so all-negative arrays work."

**Follow-ups:**
- *Return the subarray, not just the sum?* Track the start index whenever you "start fresh", and the best start/end when `best` improves.

---
## 4. Stacks, queues, heaps

### Q17. What are a stack, a queue and a deque?

**Short answer:** A **stack** is "last in, first out" (LIFO): like a pile of plates, you add and remove at the top. A **queue** is "first in, first out" (FIFO): like a line at a ticket counter. A **deque** ("double-ended queue", pronounced "deck") lets you add and remove at **both** ends in O(1). In Python: a `list` works as a stack (`append`, `pop`); use `collections.deque` for queues (`append`, `popleft`), because `list.pop(0)` is O(n).

**How it works:** stacks fit anything "most recent first": undo, matching brackets, DFS, evaluating expressions. Queues fit "in arrival order": BFS, task queues, buffering. `queue.Queue` is a thread-safe queue for threads; `asyncio.Queue` is for coroutines.

**Example: matching brackets with a stack.**
```python
def valid_brackets(s: str) -> bool:
    pairs = {")": "(", "]": "[", "}": "{"}
    stack = []
    for ch in s:
        if ch in "([{":
            stack.append(ch)                 # remember the opener
        elif ch in pairs:
            if not stack or stack.pop() != pairs[ch]:
                return False                 # closer with no matching opener
    return not stack                         # leftovers mean unclosed openers

print(valid_brackets("{[()]}"))    # True
print(valid_brackets("([)]"))      # False
print(valid_brackets("(("))        # False
```

**What happens, step by step (`"([)]"`):**
1. `(` → push → stack `["("]`.
2. `[` → push → `["(", "["]`.
3. `)` → pop gives `"["`, but `pairs[")"]` is `"("`. They differ → return `False`. The most recent opener (`[`) has to be closed first, which is exactly LIFO order.
4. For `"{[()]}"`: push `{`, `[`, `(`; then `)` pops `(` ✓, `]` pops `[` ✓, `}` pops `{` ✓; the stack is empty → `True`.

```flow
trace: Same inputs 1, 2, 3 in a stack and in a queue
push 1, 2, 3 into both > Stack holds [1, 2, 3] with the top at 3. Queue holds [1, 2, 3] with the front at 1.
stack.pop() > Returns **3**: the last item in comes out first.
queue.popleft() > Returns **1**: the first item in comes out first.
deque > Can do both: append and pop at the right, appendleft and popleft at the left, all O(1).
```

**Common mistake → fix:** `queue = [1, 2, 3]; queue.pop(0)` is O(n) because every remaining item shifts left; in a BFS over 10⁵ nodes that's quadratic. Use `deque([1, 2, 3]).popleft()`.

**Interview answer:** "A stack is LIFO and a queue is FIFO. In Python I use a list as a stack and `collections.deque` as a queue, since `popleft` is O(1) while `list.pop(0)` is O(n). I reach for a stack for nesting and undo, such as matching brackets and iterative DFS, and a queue for BFS and in-order processing."

**Follow-ups:**
- *Implement a queue using two stacks?* Push onto an input stack; when asked to pop and the output stack is empty, move everything over (reversing it). Each element moves at most once, so operations are O(1) amortised.

---

### Q18. What is a monotonic stack?

**Short answer:** A **monotonic stack** is a stack whose values are kept always increasing or always decreasing, by popping items that would break the order before pushing a new one. It solves "next greater/smaller element", stock spans and largest-rectangle problems in O(n), because each element is pushed once and popped once.

**How it works:** to find the next greater element for each position, keep a stack of **indices** that are still waiting for a bigger value (their values decrease from bottom to top). When a new value `x` arrives, every stacked index with a smaller value has just found its answer: `x`. Pop them and record `x`, then push the new index.

**Example:**
```python
def next_greater(nums: list[int]) -> list[int]:
    result = [-1] * len(nums)
    stack = []                                   # indices waiting for a greater value
    for i, x in enumerate(nums):
        while stack and nums[stack[-1]] < x:
            result[stack.pop()] = x              # x is the next greater for that index
        stack.append(i)
    return result

print(next_greater([2, 1, 2, 4, 3]))   # [4, 2, 4, -1, -1]
```

```flow
trace: Next greater element for [2, 1, 2, 4, 3]
i=0, x=2 > Stack is empty, so push index 0. stack = [0] (value 2). result = [-1,-1,-1,-1,-1].
i=1, x=1 > 1 is not greater than 2, nothing pops. Push. stack = [0, 1] (values 2, 1).
i=2, x=2 > 2 is greater than 1 (index 1): result[1] = **2**, pop. Next top is value 2, not less than 2, stop. Push. stack = [0, 2].
i=3, x=4 > 4 beats value 2 (index 2): result[2] = **4**; then beats value 2 (index 0): result[0] = **4**. stack = [3].
i=4, x=3 > 3 does not beat 4. Push. stack = [3, 4].
end > Indices 3 and 4 never found a greater value and keep -1. Final: **[4, 2, 4, -1, -1]**.
```

**What happens, step by step:** read the trace: each index is pushed once (5 pushes) and popped at most once (3 pops) → O(n), even though there's a `while` inside the `for`.

**Common mistake → fix:** pushing values instead of indices, then not knowing where to write the answer. Store indices and look up the value with `nums[stack[-1]]`. Another: using `<=` vs `<` by accident when duplicates exist (decide whether "next greater" means strictly greater).

**Interview answer:** "A monotonic stack keeps its elements ordered; before pushing a new element I pop everything it invalidates, and those pops are exactly where the 'next greater' answers are found. Every index is pushed and popped once, so it is O(n). I use it for next greater/smaller element, daily temperatures, stock span and largest rectangle in a histogram."

**Follow-ups:**
- *Previous smaller element?* Same idea scanning left to right, taking the stack's top after popping larger values.

---

### Q19. What is a heap (priority queue), and how does `heapq` work?

**Short answer:** A **heap** is a structure that always lets you take out the **smallest** (min-heap) or largest (max-heap) item quickly. Push and pop cost O(log n), and peeking at the smallest costs O(1). It is stored as a plain array arranged as a "tree" where every parent is smaller than its children. Python's `heapq` module provides min-heap functions that work on an ordinary list; for a max-heap, push negated values.

**How it works:** think of a tournament where the champion (smallest) is always at the top. Pushing adds the item at the bottom and lets it "bubble up" past larger parents. Popping removes the top, moves the last item to the top and lets it "sink down" past smaller children. Each moves along one root-to-leaf path, which has about log₂ n levels. In the array, the children of index `i` are at `2i+1` and `2i+2`.

**Example:**
```python
import heapq

heap = []
for x in [5, 1, 9, 3]:
    heapq.heappush(heap, x)
print(heap)                      # [1, 3, 9, 5]  (smallest first; the rest is only partly ordered)
print(heapq.heappop(heap))       # 1
print(heap[0])                   # 3

tasks = []
heapq.heappush(tasks, (2, "email"))
heapq.heappush(tasks, (1, "page on-call"))
heapq.heappush(tasks, (3, "report"))
print(heapq.heappop(tasks))      # (1, 'page on-call')

maxheap = [-x for x in [5, 1, 9, 3]]
heapq.heapify(maxheap)           # O(n)
print(-heapq.heappop(maxheap))   # 9
```

```flow
trace: Building a min-heap by pushing 5, 1, 9, 3
push 5 > heap = [5]
push 1 > 1 is added at the end, then bubbles up past its parent 5: heap = [**1**, 5]
push 9 > 9 stays below 1: heap = [1, 5, 9]
push 3 > 3 is added as a child of 5 (index 3), is smaller than 5, so it swaps with it: heap = [1, **3**, 9, 5]
heappop > Takes out **1**. The last item (5) moves to the top and sinks: it swaps with the smaller child 3. heap = [3, 5, 9]
```

**What happens, step by step:** the printed list `[1, 3, 9, 5]` is the array form; only the parent-smaller-than-child rule holds, so don't expect it to be fully sorted. Tuples compare element by element, so `(priority, item)` pairs pop in priority order (add a counter as a tiebreaker if items themselves can't be compared).

**Common mistake → fix:** assuming `heapq` is a max-heap, or iterating over the heap list expecting sorted order. It's a min-heap, and only `heap[0]` is guaranteed to be the smallest. For a max-heap, store negated values; for sorted output, repeatedly `heappop`, or use `sorted`.

**Interview answer:** "A heap gives O(1) access to the smallest element and O(log n) push and pop, stored as an array where each parent is smaller than its children. Python's `heapq` is a min-heap over a list; I get a max-heap by negating values and store `(priority, item)` tuples for priority queues. I use it for top-k, merging sorted streams, scheduling and Dijkstra's algorithm."

**Follow-ups:**
- *How long does `heapify` take?* O(n), faster than n separate pushes (O(n log n)).
- *How do you update a priority?* `heapq` has no decrease-key; push a new entry and skip stale ones when popped (as in Dijkstra, Q39).

---

### Q20. How do you find the top k items with a heap?

**Short answer:** To get the **k largest** items from n, keep a **min-heap of size k**. For each new item, push it; if the heap grows above k, pop the smallest. At the end, the heap holds the k largest. This is O(n log k) time and O(k) memory, so it works on streams too big to sort or hold in memory.

**How it works:** the heap's root is the *smallest* of the current top k, i.e. the "bar" an item must beat to get in. A new item that doesn't beat the root can be ignored; one that does replaces it.

**Example:**
```python
import heapq

def top_k(nums, k):
    heap = []
    for x in nums:
        heapq.heappush(heap, x)
        if len(heap) > k:
            heapq.heappop(heap)           # drop the smallest of the k+1
    return sorted(heap, reverse=True)

print(top_k([5, 1, 9, 3, 7, 8], 3))       # [9, 8, 7]
print(heapq.nlargest(3, [5, 1, 9, 3, 7, 8]))   # [9, 8, 7] built-in shortcut
```

```flow
trace: Top 3 of the stream 5, 1, 9, 3, 7, 8 with a min-heap of size 3
5, 1, 9 > The heap is not full yet: [1, 5, 9]. The root **1** is the bar to beat.
3 arrives > Push gives [1, 3, 5, 9] (size 4), so pop the smallest (1): heap = [**3**, 5, 9].
7 arrives > Push, then pop the smallest (3): heap = [**5**, 7, 9].
8 arrives > Push, then pop the smallest (5): heap = [**7**, 8, 9].
end > The heap holds the three largest: 7, 8, 9. Each push and pop cost O(log 3).
```

**What happens, step by step:** after the loop, `sorted(heap, reverse=True)` gives `[9, 8, 7]`. The heap never holds more than k+1 items, so memory is O(k) however long the stream is. For k-th largest only, the answer is simply `heap[0]` after processing everything.

**Common mistake → fix:** using a max-heap of size k for "k largest". The root would then be the *largest*, and you'd have no cheap way to evict the smallest. Remember: for the k largest, use a **min**-heap; for the k smallest, a max-heap (negated values).

**Interview answer:** "For the top k I keep a min-heap of size k: push each item and pop the smallest when the size exceeds k, so the root is the k-th largest. That's O(n log k) time and O(k) space, and it works on streams. If k is close to n, sorting is simpler; `heapq.nlargest` does the same job."

**Follow-ups:**
- *Is there something faster?* Quickselect finds the k-th element in O(n) on average but needs all data in memory and changes the order.

---

### Q21. How do you merge k sorted lists or streams?

**Short answer:** Put the **first element of each list** in a min-heap together with which list it came from. Repeatedly pop the smallest, add it to the output, and push the next element from the same list. The heap never holds more than k items, so the total time is O(N log k) for N elements overall, with O(k) extra memory.

**Example:**
```python
import heapq

def merge_k(lists):
    heap = []                                    # entries: (value, list_index, position)
    for li, lst in enumerate(lists):
        if lst:
            heapq.heappush(heap, (lst[0], li, 0))
    out = []
    while heap:
        value, li, pos = heapq.heappop(heap)
        out.append(value)
        if pos + 1 < len(lists[li]):
            heapq.heappush(heap, (lists[li][pos + 1], li, pos + 1))
    return out

print(merge_k([[1, 4], [2, 5], [3]]))      # [1, 2, 3, 4, 5]
print(list(heapq.merge([1, 4], [2, 5], [3])))   # built-in, lazy
```

```flow
trace: Merging A=[1,4], B=[2,5], C=[3]
start > Heap holds each list's head: (1,A), (2,B), (3,C). Output so far: [].
pop (1,A) > Output [1]. Push A's next element: (4,A). Heap: (2,B), (3,C), (4,A).
pop (2,B) > Output [1, 2]. Push (5,B). Heap: (3,C), (4,A), (5,B).
pop (3,C) > Output [1, 2, 3]. C has no more items, so nothing is pushed.
pop (4,A), then (5,B) > Output **[1, 2, 3, 4, 5]**. Each of the N items is pushed and popped once at O(log k) each.
```

**What happens, step by step:** the trace shows that the heap always contains exactly one candidate per non-empty list, so the smallest of them is the globally smallest remaining value. The `(value, list_index, position)` tuple also avoids comparing lists when two values tie (the index breaks the tie).

**Common mistake → fix:** concatenating all lists and sorting: O(N log N) and needs everything in memory at once. With k small relative to N (or with huge files on disk), the heap merge is faster and streams. `heapq.merge` does it lazily for you.

**Interview answer:** "I keep a min-heap with one entry per list; I pop the smallest, output it, and push the next item from that same list. The heap has at most k entries, so the cost is O(N log k) time and O(k) memory, and it can work on lists that don't fit in memory. It's the merge step of an external sort."

**Follow-ups:**
- *Divide and conquer alternative?* Merge lists pairwise like merge sort: also O(N log k).

---

### Q22. How do you find the maximum in every sliding window? (monotonic deque)

**Short answer:** Keep a **deque of indices** whose values are in decreasing order; the front always holds the maximum of the current window. For each new element, pop smaller values from the back (they can never be the maximum while the new element is in the window), push the new index, and pop the front if it has left the window. Each index is added and removed once → O(n).

**Example:**
```python
from collections import deque

def sliding_max(nums: list[int], k: int) -> list[int]:
    dq = deque()                         # indices, values decreasing
    result = []
    for i, x in enumerate(nums):
        while dq and nums[dq[-1]] <= x:
            dq.pop()                     # smaller values are useless now
        dq.append(i)
        if dq[0] <= i - k:
            dq.popleft()                 # front is outside the window
        if i >= k - 1:
            result.append(nums[dq[0]])
    return result

print(sliding_max([1, 3, -1, -3, 5, 3, 6, 7], 3))   # [3, 3, 5, 5, 6, 7]
```

```flow
trace: Sliding window maximum for [1, 3, -1, -3, 5, 3, 6, 7], k=3
i=0 (1), i=1 (3) > deque (as values): [1], then 3 removes 1: [**3**]. Window not full yet.
i=2 (-1) > deque [3, -1]. First window [1,3,-1] is complete: max is the front, **3**.
i=3 (-3) > deque [3, -1, -3]. Index 1 (value 3) is still inside the window [3,-1,-3]: max **3**.
i=4 (5) > 5 removes -3, -1, 3 from the back. deque [**5**]. Window [-1,-3,5]: max **5**.
i=5 (3), i=6 (6) > i=5: deque [5, 3], max **5**. i=6: 6 removes 3 and 5, deque [**6**], max **6**.
i=7 (7) > 7 removes 6: deque [**7**], max **7**. Result [3, 3, 5, 5, 6, 7].
```

**What happens, step by step:** the trace is the walkthrough. The key insight: when a larger value arrives, the smaller values before it are *older and smaller*, so they will leave the window earlier and are never the answer again. Dropping them keeps the deque decreasing.

**Common mistake → fix:** recomputing `max(nums[i-k+1:i+1])` for each window: O(n·k). A heap also works but needs lazy deletion; the monotonic deque is O(n) with simpler logic.

**Interview answer:** "I keep a deque of indices whose values decrease from front to back. A new element evicts smaller values from the back, then I evict the front if it slid out of the window. The front is always the window's maximum, and since every index enters and leaves once, it's O(n) rather than O(n·k)."

**Follow-ups:**
- *Why indices rather than values?* To detect when the front has left the window, and to handle duplicates.

---

## 5. Linked lists

### Q23. What is a linked list, and how does it differ from an array?

**Short answer:** A **linked list** is a chain of small objects called **nodes**; each node holds a value and a pointer (reference) to the **next** node. The list is accessed through its **head** (the first node); the last node points to `None`. Unlike an array, there is no index: to reach the k-th item you follow k pointers (O(k)). In exchange, inserting or deleting a node when you already hold a reference next to it is O(1), with no shifting.

**How it works:** with a Python `list`, items sit side by side in memory, so `a[3]` jumps directly. In a linked list each node lives anywhere in memory and only knows its neighbour. A **doubly** linked list also stores a `prev` pointer, enabling O(1) removal given a node (this is what an LRU cache uses, Q50).

| | Array (`list`) | Linked list |
|---|---|---|
| Access by index | O(1) | O(n) |
| Insert/delete at front | O(n) | O(1) |
| Insert/delete in the middle (given the node) | O(n) | O(1) |
| Memory | compact | extra pointer per node |

**Example:**
```python
class Node:
    def __init__(self, val, next=None):
        self.val = val
        self.next = next

# build 1 -> 2 -> 3
head = Node(1, Node(2, Node(3)))

def to_list(head):
    out = []
    while head:
        out.append(head.val)
        head = head.next
    return out

def insert_after(node, val):
    node.next = Node(val, node.next)       # O(1): relink two pointers

insert_after(head, 99)                     # 1 -> 99 -> 2 -> 3
print(to_list(head))                       # [1, 99, 2, 3]
```

**What happens, step by step:**
1. `Node(3)` has `next=None`; `Node(2, Node(3))` points to it; `head = Node(1, …)` points to 2. The chain is 1 → 2 → 3.
2. `to_list` starts at `head`, appends its value, and moves to `head.next` until it reaches `None`.
3. `insert_after(head, 99)` creates a new node whose `next` is the old `head.next` (the node 2), then sets `head.next` to the new node: 1 → 99 → 2 → 3. No other node moved.

**Common mistake → fix:** losing the rest of the list by overwriting a pointer before saving it. `node.next = new_node` first, and then trying to attach the old `node.next` is too late; set `new_node.next = node.next` **before** changing `node.next`. Also check for `None` before reading `.next`.

**Interview answer:** "A linked list is a chain of nodes, each holding a value and a pointer to the next. Access by position is O(n), but inserting or deleting next to a node you already hold is O(1) because only pointers change. Arrays are better for random access and memory; linked lists matter in interviews for pointer manipulation, and doubly linked lists power structures like LRU caches."

**Follow-ups:**
- *Why use a dummy (sentinel) head node?* It removes special cases for operations at the head, such as deleting the first node or merging lists.

---

### Q24. How do you reverse a linked list?

**Short answer:** Walk the list once and, for each node, point its `next` **backwards** to the previous node. You need three variables: `prev` (the already reversed part), the current node, and a saved `next` (so you don't lose the rest). O(n) time and O(1) extra space.

**Example:**
```python
class Node:
    def __init__(self, val, next=None):
        self.val, self.next = val, next

def reverse(head):
    prev = None
    curr = head
    while curr:
        nxt = curr.next        # 1. save the rest of the list
        curr.next = prev       # 2. point backwards
        prev = curr            # 3. advance prev
        curr = nxt             # 4. advance curr
    return prev                # prev is the new head

def to_list(h):
    out = []
    while h:
        out.append(h.val); h = h.next
    return out

print(to_list(reverse(Node(1, Node(2, Node(3))))))   # [3, 2, 1]
```

```flow
trace: Reversing 1 → 2 → 3
start: prev = None, curr = **1** > The reversed part (before curr) is empty.
step 1: save nxt = 2, set 1.next = None, then prev = 1, curr = **2** > The reversed part is now: 1 → None.
step 2: save nxt = 3, set 2.next = 1, then prev = 2, curr = **3** > The reversed part is: 2 → 1 → None.
step 3: save nxt = None, set 3.next = 2, then prev = 3, curr = None > The reversed part is: 3 → 2 → 1 → None.
curr is None, return prev (**3**) > The new head. One pass: O(n) time, O(1) space.
```

**What happens, step by step:** the trace lists the pointer changes; the invariant is "everything before `curr` is already reversed and hangs off `prev`". Saving `nxt` first is what keeps the unreversed remainder reachable after `curr.next` has been overwritten.

**Common mistake → fix:** writing `curr.next = prev` before saving `curr.next`: the rest of the list becomes unreachable (lost). Save first, then re-point. The same applies to the one-line tuple assignment: order of evaluation matters.

**Interview answer:** "I iterate with three pointers: before changing `curr.next` I save the next node, then I point `curr` back to `prev`, and move `prev` and `curr` one step forward. When `curr` becomes `None`, `prev` is the new head. It's O(n) time and O(1) space; the recursive version uses O(n) stack."

**Follow-ups:**
- *Reverse only a sublist?* Walk to the node before the sublist, reverse `m..n` with the same loop, then reconnect both ends.

---

### Q25. What are fast and slow pointers? (cycle detection and the middle)

**Short answer:** Move two pointers along a linked list at different speeds: **slow** one step at a time, **fast** two steps. If the list has a **cycle**, fast eventually laps slow and they meet. If there is no cycle, fast reaches the end (`None`). When fast reaches the end, slow is at the **middle**. This is **Floyd's cycle detection**: O(n) time, O(1) memory (compared with O(n) memory for a "visited" set).

**How it works:** inside a cycle, each step shrinks the gap between fast and slow by one, so the gap eventually becomes zero: they must land on the same node.

**Example:**
```python
class Node:
    def __init__(self, val): self.val, self.next = val, None

def has_cycle(head) -> bool:
    slow = fast = head
    while fast and fast.next:
        slow = slow.next
        fast = fast.next.next
        if slow is fast:
            return True
    return False

def middle(head):
    slow = fast = head
    while fast and fast.next:
        slow, fast = slow.next, fast.next.next
    return slow

nodes = [Node(i) for i in range(1, 6)]            # 1..5
for a, b in zip(nodes, nodes[1:]):
    a.next = b
print(has_cycle(nodes[0]), middle(nodes[0]).val)  # False 3
nodes[4].next = nodes[2]                          # 5 points back to 3: cycle
print(has_cycle(nodes[0]))                        # True
```

```flow
trace: Detecting the cycle 1 → 2 → 3 → 4 → 5 → back to 3
start: slow = 1, fast = 1 > Both at the head.
move: slow = 2, fast = 3 > Slow steps once, fast steps twice. They are different nodes.
move: slow = 3, fast = 5 > Fast has entered the loop (nodes 3, 4, 5).
move: slow = 4, fast = 4 (5 goes to 3, then 4) > They are the same node: **a cycle exists**.
no cycle case > Fast would have reached None, ending the loop. Cost O(n) time, O(1) space.
```

**What happens, step by step (middle of 1→2→3→4→5):** slow/fast positions: (1,1) → (2,3) → (3,5) → fast.next is `None` so stop. Slow is at node **3**, the middle. For an even-length list the loop ends with slow at the second of the two middle nodes.

**Common mistake → fix:** the loop condition `while fast.next` without checking `fast` first raises `AttributeError` on `None` when the list has an even length. Use `while fast and fast.next`.

**Interview answer:** "With two pointers moving at speeds one and two, a cycle forces the fast pointer to catch the slow one, and if there is no cycle fast hits `None`. It's O(n) time and O(1) space, versus O(n) space for a visited set. The same trick finds the middle of a list in one pass, because slow is halfway when fast finishes."

**Follow-ups:**
- *Where does the cycle start?* After they meet, reset one pointer to the head and move both one step at a time; they meet again at the cycle's entry node.

---

### Q26. How do you merge two sorted linked lists?

**Short answer:** Use a **dummy node** to start the result, and a `tail` pointer to its end. Repeatedly compare the fronts of the two lists, attach the smaller node to `tail`, and advance. When one list runs out, attach the remainder of the other. O(n + m) time, O(1) extra space (it relinks existing nodes).

**Example:**
```python
class Node:
    def __init__(self, val, next=None): self.val, self.next = val, next

def merge_two(a, b):
    dummy = tail = Node(0)             # dummy avoids special-casing the first node
    while a and b:
        if a.val <= b.val:
            tail.next, a = a, a.next
        else:
            tail.next, b = b, b.next
        tail = tail.next
    tail.next = a or b                 # attach whichever list still has nodes
    return dummy.next

def build(vals):
    head = None
    for v in reversed(vals):
        head = Node(v, head)
    return head

def to_list(h):
    out = []
    while h: out.append(h.val); h = h.next
    return out

print(to_list(merge_two(build([1, 3, 5]), build([2, 4]))))   # [1, 2, 3, 4, 5]
```

```flow
trace: Merging 1 → 3 → 5 with 2 → 4
a=1, b=2 > 1 is less than or equal to 2: attach 1. Result: 1. a moves to 3.
a=3, b=2 > 2 is smaller: attach 2. Result: 1 → 2. b moves to 4.
a=3, b=4 > Attach 3. Result: 1 → 2 → 3. a moves to 5.
a=5, b=4 > Attach 4. Result: 1 → 2 → 3 → 4. b is now empty.
b is empty > Attach the rest of a (5) in one step: **1 → 2 → 3 → 4 → 5**.
```

**What happens, step by step:** the trace shows each comparison; the dummy node means the first attachment needs no special `if result is None` branch, and we return `dummy.next` (skipping the dummy). Using `<=` keeps the merge stable (equal values from `a` come first).

**Common mistake → fix:** forgetting to attach the leftover nodes after the loop, which silently drops the tail of the longer list. `tail.next = a or b` handles both cases.

**Interview answer:** "I create a dummy head and a tail pointer, repeatedly attach the smaller front node from the two lists, and when one list is exhausted I attach the remainder of the other. It relinks existing nodes, so it's O(n + m) time and O(1) space. This merge is also the building block of merge sort and of merging k lists."

**Follow-ups:**
- *Recursive version?* Possible but uses O(n + m) stack; the iterative one is safer for long lists.

---
## 6. Trees & tries

### Q27. What is a tree, and what is a binary search tree?

**Short answer:** A **tree** is a set of **nodes** connected in a parent-child hierarchy, with one **root** at the top and no cycles. A **binary tree** gives each node at most two children (left and right). A **binary search tree (BST)** adds an ordering rule: for every node, everything in its **left** subtree is smaller and everything in its **right** subtree is larger. That rule lets you search by repeatedly going left or right, discarding half the remaining tree at each step.

**How it works:** key vocabulary: **leaf** = node with no children; **height** = number of edges on the longest root-to-leaf path; **subtree** = a node plus all its descendants. Search in a BST: if the target is smaller than the current node go left, if larger go right, if equal you're done. The cost is O(height): O(log n) if the tree is balanced, but O(n) if the tree degenerated into a chain (Q32).

**Example:**
```python
class TreeNode:
    def __init__(self, val, left=None, right=None):
        self.val, self.left, self.right = val, left, right

def bst_insert(root, val):
    if root is None:
        return TreeNode(val)
    if val < root.val:
        root.left = bst_insert(root.left, val)
    elif val > root.val:
        root.right = bst_insert(root.right, val)
    return root

def bst_contains(root, val):
    while root:
        if val == root.val:
            return True
        root = root.left if val < root.val else root.right
    return False

root = None
for v in [5, 3, 7, 2, 4]:
    root = bst_insert(root, v)
print(bst_contains(root, 4), bst_contains(root, 6))   # True False
```

```flow
trace: Searching for 4 in the BST built from 5, 3, 7, 2, 4
tree > 5 is the root; 3 and 7 are its children; 3 has children 2 and 4.
at 5, target 4 > 4 is less than 5, so go left (everything on the right is larger than 5 and can be ignored).
at 3, target 4 > 4 is greater than 3, so go right.
at 4, target 4 > Equal: found after 3 comparisons. For 6: at 5 go right to 7, 6 is less than 7 so go left to None: not found.
```

**What happens, step by step:** inserting 5 makes the root; 3 < 5 goes left; 7 > 5 goes right; 2 < 5, < 3 → left of 3; 4 < 5, > 3 → right of 3. Each search touched only one node per level.

**Common mistake → fix:** assuming a BST is always O(log n). Inserting already sorted values (1, 2, 3, 4, 5) builds a chain where every node has only a right child, and search is O(n). Self-balancing trees (AVL, red-black) prevent this (Q32).

**Interview answer:** "A tree is a hierarchy of nodes with a root and no cycles; a binary tree has at most two children per node. A BST keeps smaller values in the left subtree and larger ones in the right, so search, insert and delete walk a single root-to-leaf path: O(height), which is O(log n) when balanced and O(n) in the worst case."

**Follow-ups:**
- *What does in-order traversal of a BST give?* The values in sorted order (Q28).

---

### Q28. What are the tree traversal orders?

**Short answer:** **Depth-first** traversals go deep before wide, and differ in when the node itself is visited relative to its children: **pre-order** (node, left, right), **in-order** (left, node, right), **post-order** (left, right, node). **Breadth-first / level-order** visits the tree level by level using a queue. In-order on a BST yields sorted order; pre-order is used to copy or serialise a tree; post-order is used when children must be handled first (computing sizes or heights, deleting).

**Example:**
```python
from collections import deque

class TreeNode:
    def __init__(self, val, left=None, right=None):
        self.val, self.left, self.right = val, left, right

def preorder(n):  return [n.val] + preorder(n.left) + preorder(n.right) if n else []
def inorder(n):   return inorder(n.left) + [n.val] + inorder(n.right) if n else []
def postorder(n): return postorder(n.left) + postorder(n.right) + [n.val] if n else []

def level_order(root):
    if not root:
        return []
    out, q = [], deque([root])
    while q:
        level = []
        for _ in range(len(q)):          # exactly the nodes on this level
            n = q.popleft()
            level.append(n.val)
            if n.left:  q.append(n.left)
            if n.right: q.append(n.right)
        out.append(level)
    return out

#        4
#      /   \
#     2     6
#    / \
#   1   3
tree = TreeNode(4, TreeNode(2, TreeNode(1), TreeNode(3)), TreeNode(6))
print(preorder(tree))      # [4, 2, 1, 3, 6]
print(inorder(tree))       # [1, 2, 3, 4, 6]
print(postorder(tree))     # [1, 3, 2, 6, 4]
print(level_order(tree))   # [[4], [2, 6], [1, 3]]
```

```flow
trace: Visiting order on the tree 4 (2 (1, 3), 6)
pre-order: node, left, right > **4**, 2, 1, 3, 6. The root comes first, which is why it is used to copy or serialise a tree.
in-order: left, node, right > 1, 2, 3, **4**, 6. Sorted, because this is a BST.
post-order: left, right, node > 1, 3, 2, 6, **4**. Both children are finished before their parent.
level-order: queue, one level at a time > [4], then [2, 6], then [1, 3].
```

**What happens, step by step (in-order):** at 4, first recurse left into 2; at 2 recurse left into 1 (no children) and record **1**; back at 2 record **2**; recurse right into 3 → **3**; back at 4 record **4**; recurse right into 6 → **6**. Result 1, 2, 3, 4, 6.

For level order: the queue starts `[4]`; processing 4 adds 2 and 6; the `for _ in range(len(q))` loop takes a snapshot of the level size, so each inner loop handles exactly one level.

**Common mistake → fix:** in the level-order loop, using `while q:` and appending children without fixing the level size first, which mixes levels together. Capture `len(q)` before the inner loop. Also, deep recursion on a degenerate tree (a chain of 10⁵ nodes) hits Python's recursion limit; use an explicit stack.

**Interview answer:** "The three depth-first orders differ in when I visit the node: pre-order before the children, in-order between them, post-order after. In-order on a BST gives sorted output. Level-order uses a queue and a per-level loop. Each traversal visits every node once, so it's O(n) time, with O(height) stack space for DFS and O(width) queue space for BFS."

**Follow-ups:**
- *Iterative in-order?* Push nodes while going left, pop and visit, then go to the right child. It avoids recursion limits.

---

### Q29. Common tree recursion: depth and validating a BST

**Short answer:** Most tree problems are solved by trusting recursion: **solve for the left subtree, solve for the right subtree, combine with the current node.** The base case is the empty tree (`None`). To validate a BST you must pass **bounds** down the tree: each node has to lie strictly between the limits set by *all* its ancestors, not just its parent.

**Example:**
```python
class TreeNode:
    def __init__(self, val, left=None, right=None):
        self.val, self.left, self.right = val, left, right

def max_depth(root):
    if root is None:
        return 0
    return 1 + max(max_depth(root.left), max_depth(root.right))

def is_bst(root, lo=float("-inf"), hi=float("inf")):
    if root is None:
        return True
    if not (lo < root.val < hi):
        return False
    return is_bst(root.left, lo, root.val) and is_bst(root.right, root.val, hi)

good = TreeNode(5, TreeNode(3), TreeNode(7, TreeNode(6), TreeNode(8)))
bad  = TreeNode(5, TreeNode(3), TreeNode(7, TreeNode(4), TreeNode(8)))
print(max_depth(good), is_bst(good), is_bst(bad))    # 3 True False
```

```flow
trace: Validating by passing bounds down (the tree "bad")
check 5 with bounds (minus infinity, plus infinity) > Fine: any value is allowed at the root.
check 3 with bounds (minus infinity, **5**) > Going left means the value must be less than 5. 3 passes.
check 7 with bounds (**5**, plus infinity) > Going right means greater than 5. 7 passes.
check 4 (left child of 7) with bounds (**5**, **7**) > 4 is not greater than 5, so it fails, even though 4 is less than its parent 7. It sits in the right subtree of 5, where everything must exceed 5.
```

**What happens, step by step:** `max_depth(good)`: leaves 6 and 8 each return `1 + max(0, 0) = 1`; node 7 returns 2; node 3 returns 1; root returns `1 + max(1, 2) = 3`. For validation, comparing only parent and child (`4 < 7` ✓) would wrongly accept `bad`; the bounds carry the ancestors' constraints down.

**Common mistake → fix:** checking only `root.left.val < root.val < root.right.val`. That misses violations deeper in the tree (as with `4` above). Pass bounds, or do an in-order traversal and check that values strictly increase.

**Interview answer:** "For tree problems I define what the function returns for a subtree, handle `None` as the base case, call it on both children, and combine. For validating a BST I pass down the allowed range, because a node must respect all its ancestors, not just its parent. Both run in O(n) time and O(height) stack space."

**Follow-ups:**
- *Is a tree balanced?* Return the height of each subtree and signal imbalance (e.g. `-1`) if the heights differ by more than one; do it in one pass.

---

### Q30. How do you find the lowest common ancestor (LCA) of two nodes?

**Short answer:** The **lowest common ancestor** of nodes `p` and `q` is the deepest node that has both as descendants (a node counts as its own descendant). In a **BST** you walk down from the root: if both values are smaller go left, if both are larger go right, otherwise this node is the split point and is the LCA. In a general binary tree, recurse: if the left and right subtrees each contain one of the nodes, the current node is the LCA.

**Example:**
```python
class TreeNode:
    def __init__(self, val, left=None, right=None):
        self.val, self.left, self.right = val, left, right

def lca_bst(root, p, q):
    while root:
        if p < root.val and q < root.val:
            root = root.left
        elif p > root.val and q > root.val:
            root = root.right
        else:
            return root.val          # paths split here (or one of them is root)

def lca_tree(root, p, q):
    if root is None or root.val in (p, q):
        return root
    left = lca_tree(root.left, p, q)
    right = lca_tree(root.right, p, q)
    return root if left and right else (left or right)

#         6
#       /   \
#      2     8
#     / \   / \
#    0   4 7   9
tree = TreeNode(6, TreeNode(2, TreeNode(0), TreeNode(4)), TreeNode(8, TreeNode(7), TreeNode(9)))
print(lca_bst(tree, 0, 4))           # 2
print(lca_bst(tree, 2, 8))           # 6
print(lca_tree(tree, 0, 7).val)      # 6
```

**What happens, step by step (`lca_bst(tree, 0, 4)`):**
1. At 6: both 0 and 4 are less than 6 → go left.
2. At 2: 0 < 2 but 4 > 2 → they split here (or one equals the node) → LCA is **2**.
3. For `(2, 8)`: at 6, 2 < 6 but 8 > 6 → split immediately → **6**.
4. For `lca_tree(tree, 0, 7)`: the left subtree search finds 0 (returns that node), the right subtree finds 7; both non-`None` → the current node 6 is the LCA. When only one side finds something, that result bubbles up.

**Common mistake → fix:** using the BST shortcut on a plain binary tree (it relies on the ordering rule), or forgetting that a node can be an ancestor of the other (`lca_bst(tree, 2, 4)` is 2). The general-tree version handles that through `root.val in (p, q)`.

**Interview answer:** "In a BST the LCA is the first node where the two values fall on different sides (or equal the node), found by walking down in O(height). In a general binary tree I recurse: if both subtrees return a match, the current node is the LCA; otherwise I return whichever side found something. That's O(n) time."

**Follow-ups:**
- *Many LCA queries?* Preprocess with Euler tour + sparse table or binary lifting for O(1) or O(log n) per query.

---

### Q31. What is a trie (prefix tree)?

**Short answer:** A **trie** stores a set of words in a tree where each node represents **one character**, and the path from the root spells a prefix. Words that share a beginning share nodes. Inserting, searching and prefix-searching each take O(L), where L is the word's length, regardless of how many words are stored. It is the standard answer for **autocomplete** and "does any word start with…?".

**How it works:** each node is a dictionary mapping a character to a child node, plus a marker that says "a word ends here" (so "car" can be a word and a prefix of "card").

**Example:**
```python
class Trie:
    def __init__(self):
        self.root = {}

    def insert(self, word):
        node = self.root
        for ch in word:
            node = node.setdefault(ch, {})
        node["$"] = True                      # end-of-word marker

    def _walk(self, text):
        node = self.root
        for ch in text:
            if ch not in node:
                return None
            node = node[ch]
        return node

    def search(self, word):
        node = self._walk(word)
        return bool(node and "$" in node)

    def starts_with(self, prefix):
        return self._walk(prefix) is not None

    def words_with_prefix(self, prefix):
        node = self._walk(prefix)
        out = []
        def collect(n, path):
            for ch, child in n.items():
                if ch == "$":
                    out.append(prefix + path)
                else:
                    collect(child, path + ch)
        if node:
            collect(node, "")
        return sorted(out)

t = Trie()
for w in ["car", "cat", "card"]:
    t.insert(w)
print(t.search("car"), t.search("ca"), t.starts_with("ca"))   # True False True
print(t.words_with_prefix("car"))                              # ['car', 'card']
```

```flow
trace: Inserting "car", "cat", "card" into a trie
insert "car" > Nodes created: root → c → a → r, then an end marker on r.
insert "cat" > It reuses c → a, then adds t with an end marker. Now a has two children: r and t.
insert "card" > It reuses c → a → r, adds d, and marks d. The marker on r stays: "car" is still a word.
search prefix "ca" > Walk c → a: the path exists, so starts_with is True. But there is no end marker on a, so search("ca") is False.
autocomplete "car" > Walk to r, then collect words below it: car (marker on r) and card.
```

**What happens, step by step:** `search("car")` walks c, a, r and finds the `"$"` marker → `True`. `search("ca")` reaches the node for `a` but no `"$"` → `False`, while `starts_with("ca")` only needs the path → `True`.

**Common mistake → fix:** treating "the path exists" as "the word exists". Without the end-of-word marker, `search("ca")` would wrongly return `True`. Keep the marker and check it in `search`.

**Interview answer:** "A trie is a tree where each edge is a character, so words with a common prefix share a path. Insert, search and prefix queries cost O(L) regardless of dictionary size, and I mark word endings so that prefixes aren't confused with words. It's the right tool for autocomplete and prefix matching; the cost is memory for the nodes, which a compressed trie or a sorted list with binary search can reduce."

**Follow-ups:**
- *Trie vs hash set?* A hash set answers exact membership in O(L) too, but cannot answer prefix queries efficiently.

---

### Q32. Why do balanced trees matter, and what do you use in Python?

**Short answer:** A plain BST can degrade into a **chain** (when keys arrive sorted), making search O(n). **Self-balancing** trees (AVL, red-black) rotate nodes after inserts and deletes to keep the height around log₂ n, so search, insert and delete stay O(log n). Python has **no built-in balanced tree**; practical substitutes are `bisect` on a sorted list (O(log n) search but O(n) insert), a heap when you only need the min/max, or the third-party `sortedcontainers.SortedList` (fast O(log n)-style operations).

**Example:**
```python
import bisect

scores = []
for s in [50, 20, 70, 20, 90]:
    bisect.insort(scores, s)              # keeps the list sorted: O(log n) search + O(n) shift
print(scores)                             # [20, 20, 50, 70, 90]
i = bisect.bisect_left(scores, 60)
print(i, scores[i - 1], scores[i])        # 3 50 70   -> the neighbours of 60
```

```flow
trace: Why balance matters
insert 1, 2, 3, 4, 5 into a plain BST > Each new value is larger than everything so far, so it always goes right: 1 → 2 → 3 → 4 → 5, a chain. Height **5**, search is O(n).
insert the same values into an AVL tree > After each insert it rotates, ending with root **2** or **3** with balanced subtrees. Height about 3: search is O(log n).
Python's options > bisect on a sorted list, a heap for min/max, or sortedcontainers.SortedList when you need ordered insert and delete.
```

**What happens, step by step (`bisect` example):** `insort` finds the insertion point by binary search and inserts, shifting later items: the list ends as `[20, 20, 50, 70, 90]`. `bisect_left(scores, 60)` returns index 3 (the first element ≥ 60), so the predecessor is `scores[2] = 50` and the successor `scores[3] = 70`: a "floor/ceiling" query.

**Common mistake → fix:** hand-coding an AVL or red-black tree in an interview when the question only needs "nearest value" or "sorted insert". Say which structure you would use in practice (`sortedcontainers`, `bisect`, or a database index), and explain the idea of rotations briefly if asked.

**Interview answer:** "An unbalanced BST can degrade to O(n) when keys arrive in order, so production code uses self-balancing trees such as AVL or red-black trees to guarantee O(log n). Python's standard library has none, so I use `bisect` on a sorted list for mostly-static data, a heap for min/max, or `sortedcontainers.SortedList`, which is purpose-built for ordered inserts and removals."

**Follow-ups:**
- *What's a B-tree?* A wide balanced tree with many keys per node, used in databases and file systems because it minimises disk reads.

---

## 7. Graphs

### Q33. What is a graph, and how do you represent one?

**Short answer:** A **graph** is a set of **nodes** (vertices) connected by **edges**. Edges can be **directed** (one-way, like "A depends on B") or **undirected**, and **weighted** (carry a cost, like distance) or not. Trees are graphs with no cycles; grids are graphs where each cell connects to its neighbours. The usual representation is an **adjacency list**: a dict mapping each node to a list of its neighbours, using O(V + E) memory (V nodes, E edges).

**How it works:** an **adjacency matrix** (a V×V table of 0/1) answers "is there an edge A–B?" in O(1) but uses O(V²) memory, which is wasteful for sparse graphs (few edges, which is most real graphs). Choose the list unless the graph is small and dense.

**Example:**
```python
from collections import defaultdict

edges = [("A", "B"), ("A", "C"), ("B", "C"), ("C", "D")]    # undirected

graph = defaultdict(list)
for u, v in edges:
    graph[u].append(v)
    graph[v].append(u)           # drop this line for a directed graph

print(dict(graph))
# {'A': ['B', 'C'], 'B': ['A', 'C'], 'C': ['A', 'B', 'D'], 'D': ['C']}

weighted = {"A": [("B", 4), ("C", 1)], "C": [("B", 2)], "B": []}   # (neighbour, weight)
```

```flow
trace: Two ways to store the graph A–B, A–C, B–C, C–D
adjacency list > {A: [B, C], B: [A, C], C: [A, B, D], D: [C]}. Memory grows with V + E, and looping over a node's neighbours is fast. This is the default choice.
adjacency matrix > A 4 by 4 table of 0 and 1: row A has 1 in columns B and C. Memory is V squared, but "is there an edge?" is a single lookup. Use it only for small or dense graphs.
```

**What happens, step by step:** for each undirected edge `(u, v)` we add `v` to `u`'s list and `u` to `v`'s list, so `C` ends up with `[A, B, D]`. For a directed graph only the first append is done. `defaultdict(list)` creates an empty list the first time a node is mentioned.

**Common mistake → fix:** forgetting nodes that have no outgoing edges. In a directed graph, `D` might appear only as a target and never as a key, so `graph[D]` raises `KeyError` in a plain dict. Use `defaultdict` or `graph.get(node, [])`, and include every node in the initial set when iterating "all nodes".

**Interview answer:** "A graph is nodes plus edges, which may be directed or weighted. I store it as an adjacency list, a dict from node to neighbours, which takes O(V + E) memory and makes neighbour iteration cheap; a matrix is O(V²) and only worth it for dense graphs. Grids and many puzzles are implicit graphs whose neighbours I compute on the fly."

**Follow-ups:**
- *Edge list?* A plain list of `(u, v, weight)`; useful for Kruskal's algorithm and Union-Find.

---

### Q34. How does breadth-first search (BFS) work?

**Short answer:** **BFS** explores a graph in rings: first the start node, then everything one edge away, then two edges away, and so on, using a **queue** and a **visited** set. Because it explores in order of distance, the first time it reaches a node is via a **shortest path** in an **unweighted** graph. Time O(V + E), space O(V).

**How it works:** put the start in the queue and mark it visited. Repeatedly take the front node, and for each unvisited neighbour, mark it visited **when you enqueue it** (not when you dequeue it, or it may be queued twice) and queue it with distance +1.

**Example:**
```python
from collections import deque

def bfs_distances(graph, start):
    dist = {start: 0}                 # doubles as the visited set
    q = deque([start])
    while q:
        node = q.popleft()
        for nb in graph.get(node, []):
            if nb not in dist:
                dist[nb] = dist[node] + 1
                q.append(nb)
    return dist

graph = {"A": ["B", "C"], "B": ["A", "D"], "C": ["A", "D"], "D": ["B", "C", "E"], "E": ["D"]}
print(bfs_distances(graph, "A"))      # {'A': 0, 'B': 1, 'C': 1, 'D': 2, 'E': 3}
```

```flow
trace: BFS from A on the edges A-B, A-C, B-D, C-D, D-E
queue [A], dist {A: 0} > Start: A is visited.
take A, enqueue B and C > dist {A: 0, B: **1**, C: **1**}. Everything one edge away.
take B, enqueue D; take C, D already seen > dist gets D: **2**. D was marked when first enqueued, so it is not queued twice.
take D, enqueue E > dist E: **3**. Queue [E].
take E, nothing new > The queue is empty. E is 3 edges away: the first time BFS reaches a node is a shortest path.
```

**What happens, step by step:** read the trace. The queue order is A, then B, C, then D, then E: strictly increasing distance, which is why the first discovery is the shortest in an unweighted graph. DFS gives no such guarantee.

**Common mistake → fix:** marking nodes visited when they are dequeued instead of when they are enqueued. A node reachable from several queued nodes then gets queued several times, which can blow up the queue and the running time. Mark on enqueue.

**Interview answer:** "BFS uses a queue and a visited set to explore a graph level by level, so the first time it reaches a node is along a shortest path when edges are unweighted. It runs in O(V + E) time and O(V) space. I mark nodes visited as I enqueue them, and I use it for shortest paths in mazes and grids, word ladders and 'minimum steps' problems."

**Follow-ups:**
- *Weighted edges?* Use Dijkstra (Q39); for 0/1 weights a deque-based 0-1 BFS works.

---

### Q35. How does depth-first search (DFS) work?

**Short answer:** **DFS** follows one path as deep as possible before backing up and trying another, using a **stack** (explicitly, or implicitly through recursion) and a visited set. It's the tool for **connected components**, **all paths**, **cycle detection** and anything where you must explore a branch fully before the next. Time O(V + E), space O(V).

**Example:**
```python
def dfs_recursive(graph, node, visited=None):
    if visited is None:
        visited = []
    visited.append(node)
    for nb in graph.get(node, []):
        if nb not in visited:
            dfs_recursive(graph, nb, visited)
    return visited

def dfs_iterative(graph, start):
    seen, order, stack = set(), [], [start]
    while stack:
        node = stack.pop()
        if node in seen:
            continue
        seen.add(node)
        order.append(node)
        for nb in reversed(graph.get(node, [])):   # reversed: visit neighbours in listed order
            if nb not in seen:
                stack.append(nb)
    return order

def components(graph):
    seen, count = set(), 0
    for n in graph:
        if n not in seen:
            count += 1
            seen.update(dfs_iterative(graph, n))
    return count

graph = {"A": ["B", "C"], "B": ["D"], "C": [], "D": [], "X": ["Y"], "Y": []}
print(dfs_recursive(graph, "A"))     # ['A', 'B', 'D', 'C']
print(dfs_iterative(graph, "A"))     # ['A', 'B', 'D', 'C']
print(components({**graph, "B": ["A", "D"], "Y": ["X"]}))   # 2 groups: A-B-C-D and X-Y
```

```flow
trace: DFS from A over A→B, A→C, B→D
stack [A] > Start.
pop A, visit A, push C then B > Pushed in reverse so that B is popped first. visited [A].
pop B, visit B, push D > Go deep into B's branch before touching C. visited [A, B].
pop D, visit D > D has no neighbours. visited [A, B, D].
pop C, visit C > Only now does DFS back up and visit A's second branch. visited [**A, B, D, C**].
```

**What happens, step by step:** the trace shows the stack order. The recursive version produces the same order because the call stack plays the role of the explicit stack. `components` starts a new DFS only from nodes not yet seen, so the number of starts equals the number of connected groups (made undirected here so that reachability is symmetric).

**Common mistake → fix:** recursive DFS on a graph with a 10⁵-long path raises `RecursionError` (Python's limit is about 1,000). Use the explicit-stack version. Also, `nb not in visited` on a **list** is O(n); use a set.

**Interview answer:** "DFS goes as deep as it can along each branch using a stack or recursion, tracking visited nodes. It's O(V + E) and suits connected components, cycle detection, path finding and backtracking. In Python I use an explicit stack for deep graphs because of the recursion limit, and a set for visited."

**Follow-ups:**
- *BFS or DFS?* BFS for shortest path in unweighted graphs and level-based questions; DFS for exhaustive exploration, components and cycles.

---

### Q36. How do you solve grid problems with BFS and DFS?

**Short answer:** Treat each cell `(row, col)` as a node whose neighbours are the cells up, down, left and right (check the bounds and skip walls). Use **BFS** for the shortest path in steps, and **DFS or BFS** to count or flood connected regions such as islands. Track visited cells so each is processed once: O(rows × cols).

**Example:**
```python
from collections import deque

DIRS = ((1, 0), (-1, 0), (0, 1), (0, -1))

def shortest_path(grid, start, goal):          # 0 = open, 1 = wall
    rows, cols = len(grid), len(grid[0])
    dist = {start: 0}
    q = deque([start])
    while q:
        r, c = q.popleft()
        if (r, c) == goal:
            return dist[(r, c)]
        for dr, dc in DIRS:
            nr, nc = r + dr, c + dc
            if 0 <= nr < rows and 0 <= nc < cols and grid[nr][nc] == 0 and (nr, nc) not in dist:
                dist[(nr, nc)] = dist[(r, c)] + 1
                q.append((nr, nc))
    return -1

def num_islands(grid):                         # "1" = land
    rows, cols = len(grid), len(grid[0])
    seen, count = set(), 0
    for r in range(rows):
        for c in range(cols):
            if grid[r][c] == "1" and (r, c) not in seen:
                count += 1
                q = deque([(r, c)]); seen.add((r, c))
                while q:
                    x, y = q.popleft()
                    for dx, dy in DIRS:
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < rows and 0 <= ny < cols and grid[nx][ny] == "1" and (nx, ny) not in seen:
                            seen.add((nx, ny)); q.append((nx, ny))
    return count

maze = [[0, 0, 1],
        [1, 0, 1],
        [0, 0, 0]]
print(shortest_path(maze, (0, 0), (2, 2)))     # 4
land = ["11000", "11000", "00100", "00011"]
print(num_islands([list(row) for row in land]))   # 3
```

```flow
trace: Counting islands in the grid 11000 / 11000 / 00100 / 00011
scan reaches (0,0), unvisited land > islands = **1**. BFS marks (0,0), (0,1), (1,0), (1,1) as seen, so the same island is never counted again.
scan reaches (2,2), unvisited land > islands = **2**. A single cell is still an island.
scan reaches (3,3), unvisited land > islands = **3**. BFS also marks (3,4).
all cells scanned > Each cell was visited at most once by the scan and once by a BFS: O(rows times cols).
```

**What happens, step by step (maze):** BFS from `(0,0)`: distance 0; neighbours `(0,1)` (open) get 1; `(1,0)` is a wall. From `(0,1)`: `(1,1)` gets 2. From `(1,1)`: `(2,1)` gets 3. From `(2,1)`: `(2,0)` gets 4 and `(2,2)` gets **4**. The goal is dequeued with distance 4.

**Variants:** "rotting oranges" and "distance to nearest 0" use **multi-source BFS**: put *all* sources in the queue at the start, so distances spread outward from all of them at once. Prefer BFS over recursive DFS on large grids to avoid the recursion limit.

**Common mistake → fix:** forgetting the bounds check before indexing (`grid[-1]` silently wraps around in Python, which hides bugs). Check `0 <= nr < rows and 0 <= nc < cols` first, and mark cells visited when enqueuing.

**Interview answer:** "A grid is an implicit graph: each cell connects to its four neighbours, subject to bounds and walls. BFS gives the shortest number of steps, and a flood fill with BFS or DFS counts regions like islands. I mark cells as seen when I enqueue them so each cell is processed once, for O(rows times cols), and I use multi-source BFS when many starting points spread simultaneously."

**Follow-ups:**
- *Diagonal moves?* Add the four diagonal direction pairs to `DIRS`.

---

### Q37. How do you detect a cycle in a directed graph?

**Short answer:** Run DFS with **three colours**: white = not visited, grey = currently on the DFS path (being explored), black = fully finished. If you ever reach a **grey** node, you've found an edge back to a node on the current path, which means a **cycle**. Reaching a black node is harmless. (Alternative: Kahn's algorithm, Q38, detects a cycle when it can't process all nodes.)

**Example:**
```python
def has_cycle(graph: dict[str, list[str]]) -> bool:
    WHITE, GREY, BLACK = 0, 1, 2
    color = {n: WHITE for n in graph}

    def visit(n):
        color[n] = GREY
        for m in graph.get(n, []):
            c = color.get(m, WHITE)
            if c == GREY:
                return True                   # back edge: cycle
            if c == WHITE and visit(m):
                return True
        color[n] = BLACK
        return False

    return any(color[n] == WHITE and visit(n) for n in graph)

print(has_cycle({"A": ["B"], "B": ["C"], "C": ["A"]}))            # True
print(has_cycle({"A": ["B", "C"], "B": ["D"], "C": ["D"], "D": []}))   # False
```

```flow
trace: Colouring nodes in the cycle A → B → C → A
all white > No node visited.
visit A → grey, then B → grey, then C → grey > Grey means "on the current path". The path is A, B, C.
C looks at its neighbour A > A is **grey**: it is still on the current path. An edge back into the path is a cycle. Return True.
the diamond A→B→D, A→C→D > When C finishes, D is already **black** (fully explored by B's branch). Reaching a black node is fine: no cycle.
```

**What happens, step by step:** in the diamond graph, visiting `A` → `B` → `D` (D finishes, black) → B finishes → then `C` → sees `D` black, ignores → finishes → no grey node was ever re-entered → `False`. Using a simple visited set would wrongly report a cycle at the second visit to `D`; the grey/black distinction separates "on my current path" from "seen before in another branch".

**Common mistake → fix:** using a plain visited set. In a directed graph, reaching an already-visited node does not imply a cycle (the diamond). For an *undirected* graph a visited set plus "not my parent" works, or Union-Find (Q40).

**Interview answer:** "In a directed graph I run DFS with three states: unvisited, in the current path, and finished. An edge to a node that's in the current path is a back edge, so there's a cycle; edges to finished nodes are fine. It's O(V + E). Alternatively, Kahn's topological sort reports a cycle if it can't process every node."

**Follow-ups:**
- *Real use?* Detecting circular dependencies in build systems, package managers or task graphs.

---

### Q38. What is a topological sort? (Kahn's algorithm)

**Short answer:** A **topological sort** orders the nodes of a **directed acyclic graph (DAG)** so that every edge `u → v` has `u` before `v`: a valid order to do tasks that have dependencies (build steps, course prerequisites). **Kahn's algorithm** repeatedly takes nodes with **in-degree 0** (no unfinished dependencies), outputs them, and lowers the in-degree of their dependents. If fewer nodes than the total are output, there's a cycle. O(V + E).

**Example:**
```python
from collections import deque, defaultdict

def topo_order(n, edges):
    indeg = [0] * n
    adj = defaultdict(list)
    for a, b in edges:                  # a must come before b
        adj[a].append(b)
        indeg[b] += 1
    q = deque(i for i in range(n) if indeg[i] == 0)
    order = []
    while q:
        u = q.popleft()
        order.append(u)
        for v in adj[u]:
            indeg[v] -= 1
            if indeg[v] == 0:
                q.append(v)
    return order if len(order) == n else []        # [] means a cycle

# 0 = A, 1 = B, 2 = C, 3 = D : A before C, B before C, C before D
print(topo_order(4, [(0, 2), (1, 2), (2, 3)]))     # [0, 1, 2, 3]
print(topo_order(2, [(0, 1), (1, 0)]))             # []  (cycle)
```

```flow
trace: Kahn's algorithm for edges A→C, B→C, C→D
in-degrees > A: 0, B: 0, C: **2** (from A and B), D: 1. Queue starts with the nodes that have in-degree 0: [A, B].
take A > Output [A]. C's in-degree drops to **1**. Not zero yet, so C waits for B.
take B > Output [A, B]. C's in-degree drops to **0**, so C joins the queue.
take C > Output [A, B, C]. D's in-degree drops to 0 and D joins the queue.
take D > Output [A, B, C, D]: all 4 nodes processed, so there is no cycle.
```

**What happens, step by step (cycle case `0→1`, `1→0`):** both nodes have in-degree 1, so the starting queue is empty, the output is empty (0 of 2 nodes), and the function returns `[]`, signalling the cycle.

**Common mistake → fix:** treating a shorter-than-expected result as success. Always compare `len(order)` with the node count; otherwise a cycle silently produces a partial order. And edge direction matters: for "course b requires a" the edge is `a → b`.

**Interview answer:** "Topological sort orders a DAG so every dependency comes first. With Kahn's algorithm I compute in-degrees, start from nodes with none, and as I output a node I decrement its dependents' in-degrees, queuing those that reach zero. If I can't output every node, the graph has a cycle. It's O(V + E), and it's how build tools and course-schedule problems are solved."

**Follow-ups:**
- *Alternative?* DFS post-order reversed also gives a topological order.

---

### Q39. How does Dijkstra's algorithm find the shortest weighted path?

**Short answer:** **Dijkstra's algorithm** finds the shortest distance from a start node to every other node in a graph with **non-negative** edge weights. It keeps a **min-heap** of `(distance so far, node)`. It repeatedly takes the closest unfinished node, then **relaxes** its edges: if going through this node gives a shorter route to a neighbour, update it. Time O((V + E) log V). With negative weights, use Bellman-Ford instead.

**Example:**
```python
import heapq

def dijkstra(graph, src):
    dist = {src: 0}
    heap = [(0, src)]
    while heap:
        d, u = heapq.heappop(heap)
        if d > dist.get(u, float("inf")):
            continue                              # stale entry: a better one was already processed
        for v, w in graph.get(u, []):
            nd = d + w
            if nd < dist.get(v, float("inf")):
                dist[v] = nd
                heapq.heappush(heap, (nd, v))
    return dist

graph = {"A": [("B", 4), ("C", 1)], "C": [("B", 2)], "B": [("D", 1)], "D": []}
print(dijkstra(graph, "A"))     # {'A': 0, 'B': 3, 'C': 1, 'D': 4}
```

```flow
trace: Dijkstra from A (edges A-B 4, A-C 1, C-B 2, B-D 1)
start > dist {A: 0}, heap [(0, A)].
pop (0, A), relax its edges > B becomes **4**, C becomes **1**. heap [(1, C), (4, B)].
pop (1, C), the closest unfinished node > Going to B through C costs 1 + 2 = **3**, which beats 4: update B to 3 and push (3, B).
pop (3, B) > B's distance is final. Relax B to D: 3 + 1 = **4**. Push (4, D).
pop (4, B) is stale, skipped; pop (4, D) > Final distances: A 0, C 1, B 3, D 4.
```

**What happens, step by step:** the heap always yields the unfinished node with the smallest known distance. With non-negative weights, no later path can beat it, so its distance is final when popped. The stale entry `(4, B)` is still in the heap (heapq has no decrease-key), which is why the `if d > dist[u]: continue` check is there.

**Common mistake → fix:** using Dijkstra with negative edge weights. The "popped means final" argument breaks, giving wrong answers. Use Bellman-Ford (O(V·E)), which also detects negative cycles. For unweighted graphs plain BFS is simpler and faster.

**Interview answer:** "Dijkstra keeps a min-heap of tentative distances and always expands the closest unfinished node, relaxing its outgoing edges. With non-negative weights, a node's distance is final when it's popped. Using a binary heap it runs in O((V + E) log V). I skip stale heap entries instead of decreasing keys, and I use BFS for unweighted graphs and Bellman-Ford for negative weights."

**Follow-ups:**
- *Recover the path?* Store a `parent[v] = u` whenever you improve `dist[v]`, then walk back from the target.
- *What is A-star search?* Dijkstra plus a heuristic estimate of the remaining distance to the goal.

---

### Q40. What is Union-Find (disjoint set union)?

**Short answer:** **Union-Find** tracks which elements belong to the same group while groups merge over time. `find(x)` returns the group's representative (its **root**); `union(a, b)` merges two groups. With **path compression** and **union by rank (or size)**, each operation is nearly O(1) (inverse-Ackermann, effectively constant). Use it for "are these two connected?", counting components as edges arrive, detecting cycles in an undirected graph and Kruskal's minimum spanning tree.

**How it works:** each element points to a parent; a root points to itself. `find` follows parents up to the root (and flattens the path along the way). `union` attaches one root under the other, choosing the shorter tree to go under the taller.

**Example:**
```python
class DSU:
    def __init__(self, n):
        self.parent = list(range(n))
        self.rank = [0] * n
        self.groups = n

    def find(self, x):
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]   # path halving
            x = self.parent[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False                                    # already together (would form a cycle)
        if self.rank[ra] < self.rank[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        if self.rank[ra] == self.rank[rb]:
            self.rank[ra] += 1
        self.groups -= 1
        return True

d = DSU(5)
print(d.union(0, 1), d.union(2, 3), d.union(1, 3))     # True True True
print(d.find(0) == d.find(2), d.find(0) == d.find(4))  # True False
print(d.groups, d.union(0, 2))                         # 2 False
```

```flow
trace: Union-Find on elements 0 to 4
start > parent = [0, 1, 2, 3, 4]. Every element is its own group: **5 groups**.
union(0, 1) > Root 1 attaches under root 0. Groups: {0, 1}, {2}, {3}, {4}.
union(2, 3) > Root 3 attaches under root 2. Groups: {0, 1}, {2, 3}, {4}.
union(1, 3) > find(1) = 0 and find(3) = 2 are different roots, so one root attaches under the other: {0, 1, 2, 3} and {4}: **2 groups**.
union(0, 2) > Both already have the same root, so it returns False: this edge would have formed a cycle.
```

**What happens, step by step:** `find(0) == find(2)` is `True` after the merges because they share one root; `find(0) == find(4)` is `False`. The `groups` counter decrements only on a real merge, so it ends at 2.

**Common mistake → fix:** comparing `parent[a] == parent[b]` instead of `find(a) == find(b)`. Parents are only direct pointers; two elements in the same group can have different parents. Always compare roots.

**Interview answer:** "Union-Find maintains disjoint groups: `find` returns a group's root and `union` merges two groups. With path compression and union by rank, operations are effectively constant time. I use it to count connected components as edges arrive, to detect a cycle in an undirected graph (union returns False), and in Kruskal's minimum spanning tree algorithm."

**Follow-ups:**
- *Why is it better than rerunning DFS?* For a stream of edges, each new edge costs about O(1), instead of re-traversing the whole graph.

---
## 8. Recursion, backtracking, dynamic programming, greedy

### Q41. What is backtracking?

**Short answer:** **Backtracking** builds a solution one choice at a time and **undoes** (backs out of) a choice when it leads nowhere, then tries the next option. It is a systematic way to generate all combinations, permutations or subsets, or to search a puzzle (sudoku, N-queens). The template is **choose → explore → un-choose**. **Pruning** (abandoning a branch as soon as it can't produce a valid answer) is what keeps it fast enough.

**How it works:** you keep a `path` (the choices so far). At each step, for every option: add it to `path`, recurse, then remove it. When `path` is a complete solution, record a **copy** of it.

**Example: all subsets.**
```python
def subsets(nums):
    result, path = [], []

    def go(i):
        if i == len(nums):
            result.append(path[:])      # record a COPY of the current choices
            return
        path.append(nums[i])            # choose: include nums[i]
        go(i + 1)                       # explore
        path.pop()                      # un-choose
        go(i + 1)                       # explore without it

    go(0)
    return result

print(subsets([1, 2]))     # [[1, 2], [1], [2], []]
```

```flow
trace: Backtracking over subsets of [1, 2]
go(0), path [] > Decide about the number 1: include it first.
include 1, go(1), path [**1**] > Decide about 2: include it first.
include 2, go(2), path [**1, 2**] > i equals 2 = len(nums): a complete choice. Record a copy: **[1, 2]**.
pop 2 (un-choose), go(2), path [1] > Skip 2: record **[1]**.
pop 1, go(1), path [] > Skip 1, then include 2: path [**2**] is recorded; then skip 2: **[]** is recorded.
```

**What happens, step by step:** follow the trace. There are 2ⁿ subsets (two choices per element), so the time is O(2ⁿ · n) (copying each result), which is why backtracking is used for n up to about 20. `path[:]` matters: if you appended `path` itself, every stored subset would be the same list object, finally empty after all the pops.

**Common mistake → fix:** `result.append(path)` instead of `result.append(path[:])` (or `list(path)`). All entries in `result` end up pointing to the one shared `path` list, which is empty at the end, so you get `[[], [], [], []]`.

**Interview answer:** "Backtracking builds a candidate step by step: choose an option, recurse, then undo the choice and try the next. I record a copy of the path when it is a complete solution and prune branches that can't succeed. The cost is exponential in the worst case, such as 2ⁿ for subsets and n! for permutations, so it fits small inputs and search problems."

**Follow-ups:**
- *Subsets with duplicates?* Sort the numbers first and skip an element equal to the previous one at the same decision level.

---

### Q42. How do permutations and constrained searches (with pruning) work?

**Short answer:** For **permutations**, at each position try every unused element. For **constrained** problems such as "combinations that sum to a target", add a **pruning** check: stop going down a branch the moment the partial answer is already too big (or otherwise impossible). Pruning does not change the worst case, but it cuts away most of the search in practice.

**Example:**
```python
def permutations(nums):
    result, path, used = [], [], [False] * len(nums)

    def go():
        if len(path) == len(nums):
            result.append(path[:])
            return
        for i, x in enumerate(nums):
            if used[i]:
                continue
            used[i] = True; path.append(x)     # choose
            go()                               # explore
            path.pop(); used[i] = False        # un-choose
    go()
    return result

def combination_sum(candidates, target):       # each number may be reused
    candidates.sort()
    result, path = [], []

    def go(start, remaining):
        if remaining == 0:
            result.append(path[:])
            return
        for i in range(start, len(candidates)):
            if candidates[i] > remaining:
                break                          # PRUNE: sorted, so all later ones are too big
            path.append(candidates[i])
            go(i, remaining - candidates[i])   # i, not i+1: reuse allowed
            path.pop()
    go(0, target)
    return result

print(permutations([1, 2, 3]))          # 6 lists: [1,2,3] [1,3,2] [2,1,3] [2,3,1] [3,1,2] [3,2,1]
print(combination_sum([2, 3, 6, 7], 7)) # [[2, 2, 3], [7]]
```

```flow
trace: combination_sum([2, 3, 6, 7], 7)
go(start 0, remaining 7), path [] > Try candidates from index 0 onward.
choose 2 → path [**2**], remaining 5 > Reuse is allowed, so recurse with the same start index.
choose 2, 2 → path [2, 2], remaining 3 > Then choose 3 → path [**2, 2, 3**], remaining 0: record it.
back at [2, 2] with remaining 3 > Candidates 6 and 7 are larger than 3. **Prune**: break, no need to look further.
back at [] and later choices > Choosing 7 gives remaining 0: record **[7]**. Choosing 3 or 6 leads to dead ends and is pruned.
```

**What happens, step by step (permutations of `[1,2,3]`):** position 0 tries 1, then 2, then 3. With 1 chosen, position 1 can't reuse index 0 (`used`), so it tries 2 then 3, and so on, giving 3 × 2 × 1 = 6 results. The `used` array un-marks on backtrack so that the next branch can reuse each element.

**Common mistake → fix:** forgetting to un-choose (`used[i] = False`, `path.pop()`). Later branches then see stale state and miss solutions. Also, using `go(i + 1, …)` when reuse is allowed (or `go(i, …)` when it isn't) answers a different question.

**Interview answer:** "Permutations loop over unused elements at each position with choose, explore, un-choose. For constrained searches, I sort the candidates and prune as soon as a partial answer exceeds the target, which cuts off whole branches. Worst-case time stays exponential, n! for permutations, but pruning makes realistic inputs fast."

**Follow-ups:**
- *N-Queens?* Same template: place a queen row by row; prune any column or diagonal already attacked.

---

### Q43. What is dynamic programming, and how do you think about it?

**Short answer:** **Dynamic programming (DP)** solves a problem by breaking it into **overlapping subproblems**, solving each one **once**, and reusing the answers. Two styles: **top-down** (recursion plus **memoisation**, i.e. caching results in a dict or `functools.cache`) and **bottom-up** (fill a table from the smallest subproblem upward). Use it when a problem asks for an optimum or a count ("minimum", "maximum", "number of ways") and a plain recursion would recompute the same subproblems again and again.

**How it works (the recipe):**
1. **State:** what does `dp[i]` (or `dp[i][j]`) mean? Write it in words.
2. **Transition:** how does `dp[i]` depend on smaller states?
3. **Base cases:** the smallest answers.
4. **Order:** compute smaller states first.
5. **Answer:** which cell holds it?
6. **Optimise space:** keep only the cells the transition needs.

**Example: climbing stairs** (1 or 2 steps at a time: how many ways to climb n stairs?).
```python
from functools import cache

@cache
def ways(n: int) -> int:                  # top-down
    return 1 if n <= 1 else ways(n - 1) + ways(n - 2)

def ways_bottom_up(n: int) -> int:        # bottom-up with O(1) space
    a, b = 1, 1                           # ways(0), ways(1)
    for _ in range(n - 1):
        a, b = b, a + b
    return b if n >= 1 else 1

print(ways(5), ways_bottom_up(5))         # 8 8
print(ways(50))                           # 20365011074 (instant)
```

```flow
trace: From recursion to a table for climbing stairs (n = 5)
state and transition > ways(n) = ways(n-1) + ways(n-2): the last step was either 1 stair or 2 stairs.
naive recursion > ways(5) calls ways(4) and ways(3); ways(4) calls ways(3) again. The same subproblems are recomputed, so time is exponential.
table by index 0, 1, 2, 3, 4, 5 > [1, 1, **2**, **3**, **5**, **8**]. Each entry is the sum of the two before it, computed once. O(n) time.
keep only two values > a and b hold the last two entries, so space drops to O(1). The answer for n = 5 is **8**.
```

**What happens, step by step (`ways_bottom_up(5)`):** start `(a, b) = (1, 1)`. Loop 4 times: `(1, 2)`, `(2, 3)`, `(3, 5)`, `(5, 8)` → return `b = 8`. With `@cache`, `ways(5)` computes `ways(4)` and `ways(3)`, and `ways(3)` is calculated once and then read from the cache; there are only n+1 distinct calls.

**Common mistake → fix:** applying DP without defining the state in words. If you can't say "`dp[i]` is the minimum coins needed to make amount i", the transition will be muddled. Also, memoising a function with unhashable arguments (lists) fails; pass tuples or indexes.

**Interview answer:** "DP is recursion with caching of overlapping subproblems. I define the state in words, write the transition from smaller states, set base cases, and either memoise the recursion or fill a table bottom-up, then trim the space to the cells the transition needs. Each state is computed once, so time is states times the work per state."

**Follow-ups:**
- *Memoisation or tabulation?* Memoisation is quicker to write and only computes needed states; tabulation avoids recursion depth limits and allows easy space optimisation.

---

### Q44. DP in practice: coin change and longest common subsequence

**Short answer:** Two staples. **Coin change (minimum coins)** is a 1-D DP: `dp[a]` = fewest coins to make amount `a`; try each coin as the last one. **Longest common subsequence (LCS)** is a 2-D DP: `dp[i][j]` = LCS length of the first `i` characters of `a` and first `j` of `b`; if the last characters match, extend the diagonal, else take the better of dropping one character from either string.

**Example:**
```python
def coin_change(coins: list[int], amount: int) -> int:
    INF = float("inf")
    dp = [0] + [INF] * amount               # dp[a] = fewest coins to make a
    for a in range(1, amount + 1):
        for c in coins:
            if c <= a:
                dp[a] = min(dp[a], dp[a - c] + 1)
    return dp[amount] if dp[amount] != INF else -1

def lcs(a: str, b: str) -> int:
    dp = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            if a[i - 1] == b[j - 1]:
                dp[i][j] = dp[i - 1][j - 1] + 1
            else:
                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])
    return dp[-1][-1]

print(coin_change([1, 3, 4], 6))     # 2   (3 + 3)
print(coin_change([5], 3))           # -1
print(lcs("abcde", "ace"))           # 3   ("ace")
```

```flow
trace: coin_change([1, 3, 4], 6) filling dp[0..6]
dp[0] > 0 coins for amount 0 (base case).
dp[1], dp[2] > dp[1] = dp[0] + 1 = **1**; dp[2] = dp[1] + 1 = **2** (only the coin 1 fits).
dp[3] > Coin 3 gives dp[0] + 1 = **1**. Best is 1.
dp[4] > Coin 4 gives dp[0] + 1 = **1**.
dp[5], dp[6] > dp[5] = min(dp[4] + 1, dp[2] + 1, dp[1] + 1) = **2**. dp[6] = min(dp[5] + 1, dp[3] + 1, dp[2] + 1) = min(3, 2, 3) = **2**: the answer is 3 + 3.
```

**What happens, step by step (LCS of `"abcde"` and `"ace"`):** the table's rows are prefixes of `abcde`, the columns prefixes of `ace`. Matching characters (a/a, c/c, e/e) each add 1 to the diagonal value; mismatches copy the larger neighbour (above or left). The bottom-right cell is **3**. Cost: O(len(a) · len(b)) time and space.

**Common mistake → fix:** using a greedy "largest coin first" for coin change. With coins `[1, 3, 4]` and amount 6, greedy takes 4 + 1 + 1 = 3 coins, but the optimum is 3 + 3 = 2 coins (see Q46). DP tries every last coin, so it is always correct. Also, initialise unreachable states with infinity, not 0.

**Interview answer:** "For coin change I define `dp[a]` as the fewest coins for amount a, with `dp[0] = 0`, and for each amount try every coin as the last: `dp[a - c] + 1`. That's O(amount times coins). For LCS I use a 2-D table where matching characters extend the diagonal and mismatches take the max of left and up, O(n·m). Both illustrate state, transition, base case and order."

**Follow-ups:**
- *Number of ways to make the amount?* Same table but add instead of min, and loop over coins in the outer loop to avoid counting permutations.

---

### Q45. How can longest increasing subsequence run in O(n log n)?

**Short answer:** The simple DP for the **longest increasing subsequence (LIS)** is O(n²). The faster method keeps an array `tails` where `tails[k]` is the **smallest possible last value** of an increasing subsequence of length `k+1`. For each number, use **binary search** to find the first tail that is ≥ the number and replace it (or append if none). The final length of `tails` is the answer.

**How it works:** a smaller tail is always better for extending later, so replacing a tail with a smaller number never hurts. `tails` stays sorted, so binary search applies. Note: `tails` itself is *not* the subsequence, only its length is meaningful.

**Example:**
```python
from bisect import bisect_left

def lis_length(nums: list[int]) -> int:
    tails = []
    for x in nums:
        i = bisect_left(tails, x)     # first position with tails[i] >= x
        if i == len(tails):
            tails.append(x)           # x extends the longest run so far
        else:
            tails[i] = x              # x gives a smaller tail for length i+1
    return len(tails)

print(lis_length([3, 1, 4, 1, 5, 9, 2, 6]))       # 4
print(lis_length([10, 9, 2, 5, 3, 7, 101, 18]))   # 4
```

```flow
trace: tails while scanning [3, 1, 4, 1, 5, 9, 2, 6]
x=3 > tails is empty, so append: [**3**].
x=1 > First tail at least 1 is 3: replace it. tails = [**1**]. A smaller tail is always better.
x=4 > Larger than all tails: append. tails = [1, **4**].
x=1 > First tail at least 1 is the 1 itself: replaced by itself, no change. tails = [1, 4].
x=5, x=9 > Both extend: tails = [1, 4, **5**], then [1, 4, 5, **9**].
x=2 > First tail at least 2 is 4: replace. tails = [1, **2**, 5, 9].
x=6 > First tail at least 6 is 9: replace. tails = [1, 2, 5, **6**]. Length **4**.
```

**What happens, step by step:** the final `tails` is `[1, 2, 5, 6]`, so the LIS length is **4** (a real example: `1, 4, 5, 9`, or `3, 4, 5, 6`). Notice that `[1, 2, 5, 6]` is *not* itself a valid subsequence of the input (2 appears after 5), which is why `tails` only tracks lengths. Each element does one O(log n) binary search → O(n log n) overall.

**Common mistake → fix:** using `bisect_right` for a *strictly* increasing subsequence. With `bisect_right`, equal values extend the run (non-decreasing). Use `bisect_left` for strictly increasing and `bisect_right` for non-decreasing.

**Interview answer:** "I keep `tails[k]`, the smallest possible ending value of an increasing subsequence of length k+1. For each number I binary-search the first tail that is at least as large, replacing it, or appending if there isn't one. The length of `tails` is the LIS length, in O(n log n) time; the O(n²) DP is the simpler fallback if I need to reconstruct the sequence."

**Follow-ups:**
- *Reconstruct the actual subsequence?* Store, for each element, the index of the previous element in its run and walk backwards from the last tail.

---

### Q46. Greedy vs DP: when is the locally best choice enough?

**Short answer:** A **greedy** algorithm always takes the choice that looks best right now and never reconsiders. It is fast (often O(n log n) from a sort) but is correct only when the problem has the **greedy-choice property**: a locally best choice can always be extended to a globally optimal answer. If a counterexample exists, use DP. Classic greedy successes: interval scheduling by earliest end time, jump game, fractional knapsack.

**Example:**
```python
def max_non_overlapping(intervals):          # interval scheduling
    count, last_end = 0, float("-inf")
    for start, end in sorted(intervals, key=lambda x: x[1]):   # earliest END first
        if start >= last_end:
            count += 1
            last_end = end
    return count

def greedy_coins(coins, amount):
    count = 0
    for c in sorted(coins, reverse=True):
        count += amount // c
        amount %= c
    return count if amount == 0 else -1

print(max_non_overlapping([(1, 3), (2, 4), (3, 5), (0, 6), (5, 7)]))   # 3
print(greedy_coins([1, 5, 10, 25], 41))   # 4   (25+10+5+1: correct for this coin system)
print(greedy_coins([1, 3, 4], 6))         # 3   (4+1+1 but the optimum is 2: 3+3)
```

```flow
trace: Greedy fails on coins [1, 3, 4], amount 6
greedy takes the biggest coin that fits > 4, remaining 2.
then 1, then 1 > Total **3 coins**: 4 + 1 + 1.
the optimal answer > 3 + 3 = **2 coins**. Greedy never reconsidered its first choice.
DP tries every last coin > best[6] = 1 + min(best[5], best[3], best[2]) = 1 + min(2, 1, 2) = **2**. Always correct.
```

**What happens, step by step (interval scheduling):** sorted by end: (1,3), (2,4), (3,5), (0,6), (5,7). Take (1,3) → `last_end=3`. (2,4): start 2 < 3, skip. (3,5): start 3 ≥ 3, take → `last_end=5`. (0,6): skip. (5,7): start 5 ≥ 5, take. Total **3**. Choosing the interval that ends earliest leaves the most room for the rest; that argument is what makes the greedy choice provably correct.

**Common mistake → fix:** assuming greedy works because it passes the examples. Always try to find a counterexample or argue the greedy-choice property (an exchange argument: swapping any optimal solution's first choice for the greedy one doesn't make it worse). If you can't, use DP.

**Interview answer:** "Greedy picks the locally best option each step and is correct only when that choice is provably part of an optimal solution, as with earliest-end-time interval scheduling. Coin change with arbitrary denominations is a counterexample: coins 1, 3, 4 and amount 6 give 3 coins greedily but 2 optimally. When I can't prove the greedy choice, I use DP, which considers all options."

**Follow-ups:**
- *Other greedy problems?* Jump game (track the farthest reachable index), gas station, task scheduling with deadlines, Huffman coding.

---

### Q47. How do "choose or skip" DP problems work? (house robber and 0/1 knapsack)

**Short answer:** Many DP problems have the shape "for each item, either take it or skip it". **House robber**: you can't rob two adjacent houses; `dp[i]` = best total using the first `i` houses = `max(dp[i-1], dp[i-2] + value[i])` (skip house i, or take it plus the best from two houses back). **0/1 knapsack**: `dp[w]` = best value with capacity `w`; process each item and iterate capacities **downward** so each item is used at most once.

**Example:**
```python
def house_robber(nums: list[int]) -> int:
    prev2, prev1 = 0, 0                      # best up to i-2, best up to i-1
    for x in nums:
        prev2, prev1 = prev1, max(prev1, prev2 + x)
    return prev1

def knapsack(weights, values, capacity):
    dp = [0] * (capacity + 1)                # dp[w] = best value with capacity w
    for wt, val in zip(weights, values):
        for w in range(capacity, wt - 1, -1):    # downwards: each item used once
            dp[w] = max(dp[w], dp[w - wt] + val)
    return dp[capacity]

print(house_robber([2, 7, 9, 3, 1]))               # 12 (2 + 9 + 1)
print(knapsack([1, 3, 4], [15, 20, 30], 4))        # 35 (items of weight 1 and 3)
```

```flow
trace: House robber on [2, 7, 9, 3, 1]
house 1 (value 2) > best up to here: max(skip = 0, take = 0 + 2) = **2**.
house 2 (value 7) > max(skip = 2, take = 0 + 7) = **7**.
house 3 (value 9) > max(skip = 7, take = 2 + 9 = 11) = **11**. Taking 9 means we could only add the best from two houses back.
house 4 (value 3) > max(skip = 11, take = 7 + 3 = 10) = **11**.
house 5 (value 1) > max(skip = 11, take = 11 + 1 = 12) = **12**, where 11 here is the best up to house 3 (2 + 9). Answer 12.
```

**What happens, step by step (knapsack `[1,3,4]`, values `[15,20,30]`, capacity 4):** start `dp = [0,0,0,0,0]`. Item (1, 15): `dp[1..4]` all become 15. Item (3, 20): for `w=4`: `max(15, dp[1] + 20 = 35)` = 35; `w=3`: `max(15, dp[0] + 20 = 20)` = 20. Item (4, 30): `w=4`: `max(35, dp[0] + 30 = 30)` = 35. Answer **35**.
Iterating `w` upward instead would let an item be reused (unbounded knapsack), because `dp[w - wt]` would already include the item.

**Common mistake → fix:** the direction of the inner loop in knapsack. Downward = each item at most once (0/1); upward = unlimited copies. And in house robber, writing `dp[i-1] + x` (adjacent) instead of `dp[i-2] + x`.

**Interview answer:** "For choose-or-skip problems I define `dp` as the best result using the first i items, and the transition compares skipping the item with taking it plus the best compatible earlier state. House robber is `max(dp[i-1], dp[i-2] + x)`; 0/1 knapsack iterates capacity downward so each item is used once. Both are O(n) or O(n times capacity) with small space."

**Follow-ups:**
- *Why is knapsack 'pseudo-polynomial'?* Its time depends on the numeric value of the capacity, not just the number of items.

---

## 9. Sorting and bits

### Q48. Which sorting algorithms should you know, and why?

**Short answer:** In real code, use `sorted()` or `list.sort()`: Python uses **Timsort**, an adaptive merge sort (CPython has also refined its merge policy with Powersort), which is **stable**, O(n log n) in the worst case and close to O(n) on data that is already mostly sorted. In interviews, know how **merge sort** and **quicksort** work, their complexity and whether they're stable, plus when a non-comparison sort such as counting sort applies.

**How it works:**
- **Merge sort:** split in half, sort each half recursively, merge the two sorted halves by repeatedly taking the smaller front item. Always O(n log n), stable, O(n) extra memory.
- **Quicksort:** pick a pivot, partition into smaller / equal / larger, recurse. Average O(n log n); O(n²) worst case with bad pivots; not stable.
- **Heap sort:** build a heap, pop the max n times. O(n log n), O(1) extra space, not stable.
- **Counting / bucket sort:** for small integer ranges, count occurrences: O(n + k).

| Algorithm | Average | Worst | Extra space | Stable |
|---|---|---|---|---|
| Merge sort | n log n | n log n | O(n) | yes |
| Quicksort | n log n | n² | O(log n) | no |
| Heap sort | n log n | n log n | O(1) | no |
| Counting sort | n + k | n + k | O(k) | yes |
| Insertion sort | n² | n² | O(1) | yes |

**Example:**
```python
def merge_sort(a):
    if len(a) <= 1:
        return a
    mid = len(a) // 2
    left, right = merge_sort(a[:mid]), merge_sort(a[mid:])
    out, i, j = [], 0, 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:          # <= keeps equal items in original order: stable
            out.append(left[i]); i += 1
        else:
            out.append(right[j]); j += 1
    return out + left[i:] + right[j:]

def quicksort(a):
    if len(a) <= 1:
        return a
    pivot = a[len(a) // 2]
    return (quicksort([x for x in a if x < pivot])
            + [x for x in a if x == pivot]
            + quicksort([x for x in a if x > pivot]))

print(merge_sort([5, 2, 4, 1]))      # [1, 2, 4, 5]
print(quicksort([3, 6, 1, 8, 2]))    # [1, 2, 3, 6, 8]
```

```flow
trace: Merge sort on [5, 2, 4, 1]
split [5, 2, 4, 1] > Into [5, 2] and [4, 1], then into single elements [5] [2] [4] [1]. That is log n levels of splitting.
merge [5] and [2] > Compare fronts 5 and 2: take 2, then 5. Result [**2, 5**].
merge [4] and [1] > Take 1, then 4. Result [**1, 4**].
merge [2, 5] and [1, 4] > Fronts 2 and 1: take 1; fronts 2 and 4: take 2; fronts 5 and 4: take 4; then 5. Result [**1, 2, 4, 5**].
cost > Each of the log n levels does O(n) merging work: O(n log n) always, with O(n) extra memory.
```

**What happens, step by step:** follow the trace. **Stability** matters when sorting by several keys: if you sort by date and then (stably) by priority, items with equal priority keep their date order. In Python you can get this with a tuple key: `sorted(rows, key=lambda r: (r.priority, r.date))`.

**Common mistake → fix:** writing your own sort in production, or claiming quicksort is "always O(n log n)". Its worst case is O(n²) (for example with the first element as pivot on sorted data); random or median-of-three pivots make it rare. Use the built-in sort unless the question is specifically about implementing one.

**Interview answer:** "In practice I use Python's built-in sort: Timsort, stable and O(n log n) worst case, fast on partly sorted data. For interviews: merge sort is stable with guaranteed n log n and O(n) extra space; quicksort averages n log n with O(log n) space but is O(n²) in the worst case and not stable; heap sort is in place; counting sort is linear for small integer ranges."

**Follow-ups:**
- *Can comparison sorting beat n log n?* No: that is a lower bound for comparison-based sorting. Counting and radix sorts avoid it by not comparing.

---

### Q49. What bit-manipulation tricks should you know?

**Short answer:** Integers are stored as bits, and operators work on them directly: `&` (and), `|` (or), `^` (xor), `~` (not), `<<` and `>>` (shifts). A few tricks come up repeatedly: **XOR cancels pairs** (`a ^ a == 0`, `a ^ 0 == a`), `n & (n - 1)` clears the lowest set bit (so `n & (n - 1) == 0` tests for a power of two), and `(n >> k) & 1` reads bit `k`. They give O(1)-space solutions to puzzle-style questions.

| Trick | Code | Use |
|---|---|---|
| Check bit k | `(n >> k) & 1` | flags, permissions |
| Set / clear bit k | `n \| (1 << k)` / `n & ~(1 << k)` | flags |
| Power of two | `n > 0 and n & (n - 1) == 0` | sizing |
| Count set bits | `n.bit_count()` (3.10+) | Hamming weight |
| XOR cancels pairs | `a ^ a = 0`, `a ^ 0 = a` | find the single non-duplicated number |

**Example:**
```python
from functools import reduce
from operator import xor

def single_number(nums):          # every number appears twice except one
    return reduce(xor, nums)

def is_power_of_two(n):
    return n > 0 and n & (n - 1) == 0

def all_subsets(items):           # bitmask: bit i of mask says "include items[i]"
    return [[items[i] for i in range(len(items)) if mask >> i & 1]
            for mask in range(1 << len(items))]

print(single_number([4, 1, 2, 1, 2]))     # 4
print(is_power_of_two(16), is_power_of_two(18))   # True False
print(all_subsets(["a", "b"]))            # [[], ['a'], ['b'], ['a', 'b']]
```

```flow
trace: XOR finds the number that appears once in [4, 1, 2, 1, 2]
acc = 0 > XOR facts: a ^ a = 0, a ^ 0 = a, and the order does not matter.
acc ^ 4 = **4** > 0 ^ 4 = 4.
acc ^ 1 = **5**, then ^ 2 = **7** > 4 ^ 1 = 5; 5 ^ 2 = 7 (binary 101 ^ 010 = 111).
acc ^ 1 = **6**, then ^ 2 = **4** > The second 1 and second 2 cancel the first ones.
answer **4** > One pass, O(1) space.
```

**What happens, step by step:** `16` is `10000` and `15` is `01111`; `16 & 15 = 0`, so a power of two. `18` is `10010`; `17` is `10001`; `18 & 17 = 10000 ≠ 0`. For subsets, masks 0 to 3 for two items: 00 → `[]`, 01 → `['a']`, 10 → `['b']`, 11 → `['a','b']`.

**Common mistake → fix:** operator precedence. `n & (n - 1) == 0` without parentheses around the `&` side is parsed as `n & ((n - 1) == 0)` in many languages; in Python, comparison binds *looser* than `&`, so the form above works, but writing `(n & (n - 1)) == 0` is clearer and safer. Also, `~n` is `-n - 1` for Python's unlimited-width ints, not an unsigned flip.

**Interview answer:** "I know XOR cancels pairs, so a single pass finds the unpaired number in O(1) space; `n & (n - 1)` clears the lowest set bit, which gives the power-of-two test and a fast popcount; and bitmasks enumerate subsets with a loop from 0 to 2ⁿ − 1. Python ints are arbitrary precision, so I mask explicitly if I need fixed-width behaviour."

**Follow-ups:**
- *Swap without a temp?* `a ^= b; b ^= a; a ^= b` works, but in Python `a, b = b, a` is clearer.

---
## 10. Design & scale problems

### Q50. How do you implement an LRU cache with O(1) operations?

**Short answer:** An **LRU (least recently used) cache** holds at most `capacity` items; when it's full, it evicts the item that hasn't been used for the longest time. `get` and `put` must both be O(1). The structure is a **hash map** (key → node, for instant lookup) plus a **doubly linked list** (ordered by recency, for instant move-to-front and evict-from-back). In Python, `collections.OrderedDict` gives you both in one object.

**How it works:** every `get` or `put` marks the key as most recently used by moving it to the "recent" end. When the size exceeds the capacity, remove from the "old" end. A plain dict can't reorder cheaply and a list can't find by key cheaply; the combination can do both in O(1).

**Example:**
```python
from collections import OrderedDict

class LRUCache:
    def __init__(self, capacity: int):
        self.cap = capacity
        self.data = OrderedDict()           # oldest first, newest last

    def get(self, key):
        if key not in self.data:
            return -1
        self.data.move_to_end(key)          # mark as most recently used
        return self.data[key]

    def put(self, key, value):
        self.data[key] = value
        self.data.move_to_end(key)
        if len(self.data) > self.cap:
            self.data.popitem(last=False)   # evict the least recently used

cache = LRUCache(2)
cache.put("a", 1)
cache.put("b", 2)
print(cache.get("a"))      # 1   (now a is the most recent)
cache.put("c", 3)          # full: evicts b
print(cache.get("b"))      # -1
print(list(cache.data))    # ['a', 'c']
```

```flow
trace: LRU cache with capacity 2 (oldest on the left)
put a, put b > Order: [a, b]. The cache is full.
get a > a moves to the recent end: [b, **a**]. Now b is the oldest.
put c > Insert c at the recent end: [b, a, c] has 3 items, more than the capacity 2, so evict the oldest, **b**: [a, c].
get b > b is gone: returns -1. Every operation did a hash lookup plus O(1) list moves.
```

**What happens, step by step:** after `get("a")` the order is `[b, a]`, so when `c` arrives and the size becomes 3, `popitem(last=False)` removes the first item, `b`. A cache that evicts by insertion order instead of usage (FIFO) would have wrongly dropped `a`.

**Common mistake → fix:** implementing LRU with a list and `list.remove(key)`: finding and removing is O(n). Another: forgetting to refresh recency on `get` (then it's FIFO, not LRU). Also, `put` on an existing key must update the value *and* refresh recency.

**Interview answer:** "LRU needs O(1) lookup and O(1) reordering, so I combine a hash map for lookup with a doubly linked list for recency; in Python `OrderedDict` with `move_to_end` and `popitem(last=False)` does exactly that. On every access I move the key to the recent end, and on insert I evict from the old end when over capacity. For thread safety I'd add a lock; for function memoisation there's `functools.lru_cache`."

**Follow-ups:**
- *Distributed LRU?* Redis with `maxmemory-policy allkeys-lru` (approximate LRU).
- *Add TTL expiry?* Store an expiry time with each entry and check it on `get`, plus lazy or periodic cleanup.

---

### Q51. How do you find duplicates in data too big for memory?

**Short answer:** If the data doesn't fit in RAM you can't use a simple `set`. Options: **hash partitioning** (split records into N files by `hash(key) % N` so equal records always land in the same file, then dedupe each small file in memory), **external sort** (sort chunks, write them to disk, merge, and compare neighbours), a **Bloom filter** for a cheap probabilistic first pass, or a distributed `GROUP BY` (Spark, Athena). Normalise first (case, whitespace, Unicode form), or "equal" records won't hash alike.

```flow
pipeline: Duplicates in a file too large for memory
Normalise > Lowercase, trim whitespace, apply Unicode normalisation (NFKC) so visually equal records become identical strings.
Hash partition > Write each record to file number hash(record) % N. Identical records always land in the same file, so duplicates never span files.
Dedupe each partition > Each file is about 1/N of the data and now fits in memory: load it into a set and write the unique records.
Or external sort > Sort manageable chunks, write them to disk, merge the sorted chunks with a heap, and compare neighbouring records.
At cluster scale > Use GROUP BY in Spark or Athena, or a Bloom filter to skip records that are definitely new.
```

**Example (hash partitioning):**
```python
import hashlib, os, tempfile

def stable_bucket(text: str, n: int) -> int:
    # Python's built-in hash() is randomised per process, so use a stable hash
    return int(hashlib.md5(text.encode("utf-8")).hexdigest(), 16) % n

def dedupe_large(lines, n_buckets=4):
    tmp = tempfile.mkdtemp()
    files = [open(os.path.join(tmp, f"b{i}.txt"), "w", encoding="utf-8") for i in range(n_buckets)]
    for line in lines:                                   # pass 1: stream, never hold all lines
        norm = " ".join(line.lower().split())
        files[stable_bucket(norm, n_buckets)].write(norm + "\n")
    for f in files:
        f.close()
    unique = []
    for i in range(n_buckets):                           # pass 2: one small file at a time
        with open(os.path.join(tmp, f"b{i}.txt"), encoding="utf-8") as f:
            unique.extend(sorted(set(line.rstrip("\n") for line in f)))
    return unique

data = ["Hello World", "hello  world", "Bye", "BYE", "Another one"]
print(sorted(dedupe_large(data)))      # ['another one', 'bye', 'hello world']
```

**What happens, step by step:**
1. Each line is normalised: `"Hello World"` and `"hello  world"` both become `"hello world"`.
2. The stable hash of the normalised text picks a bucket file. Both copies of `"hello world"` hash identically, so they land in the same file.
3. In pass 2 each bucket file is read alone and deduplicated with a `set`; memory use is about the size of one bucket, not the whole input.
4. The three distinct normalised lines remain.

**Common mistake → fix:** using Python's built-in `hash()` for partitioning across runs or machines. String hashes are randomised per process (`PYTHONHASHSEED`), so the same record would go to different buckets in different runs. Use a stable hash such as `hashlib` or `zlib.crc32`.

**Interview answer:** "I'd normalise the records, then hash-partition them into N files with a stable hash so equal records share a file, and dedupe each file in memory. External sort-and-merge is the alternative, and at cluster scale it's a distributed GROUP BY. A Bloom filter can cheaply skip records that are definitely new. The key points are streaming I/O and bounded memory."

**Follow-ups:**
- *How many buckets?* Total size divided by the memory you can spare per bucket, with headroom for skew (some keys hot).

---

### Q52. What is a Bloom filter, and what trade-off does it make?

**Short answer:** A **Bloom filter** is a compact way to ask "have I seen this item before?" using a bit array and several hash functions. Adding an item sets k bits. Checking an item looks at the same k bits: if any is 0, the item is **definitely not present**; if all are 1, it is **probably present** (a possible **false positive**, caused by other items having set those bits). It never gives false negatives, uses very little memory, and the basic version doesn't support deletion.

**How it works:** the false-positive rate depends on how many bits you allot per item and the number of hash functions k. More bits per item → fewer false positives. It's used as a cheap guard before an expensive lookup (a database, a disk read, a network call).

**Example:**
```python
import hashlib

class Bloom:
    def __init__(self, size=64, k=3):
        self.size, self.k, self.bits = size, k, 0       # bits stored in one Python int

    def _positions(self, item):
        for i in range(self.k):
            h = hashlib.sha256(f"{i}:{item}".encode()).digest()
            yield int.from_bytes(h[:8], "big") % self.size

    def add(self, item):
        for p in self._positions(item):
            self.bits |= 1 << p

    def might_contain(self, item):
        return all(self.bits >> p & 1 for p in self._positions(item))

b = Bloom()
for word in ["alice", "bob"]:
    b.add(word)
print(b.might_contain("alice"))     # True
print(b.might_contain("zoe"))       # almost certainly False; True would be a false positive
```

```flow
trace: A Bloom filter with 10 bits and 3 hash functions (positions are illustrative)
add alice > Hashes point to bits 1, 4 and 7. Bits set: {1, 4, 7}. The word itself is not stored anywhere.
add bob > Hashes point to bits 2, 4 and 9. Bit 4 was already set; bits can be shared. Bits set: {1, 2, 4, 7, 9}.
check carol with bits 1, 2 and 9 > All three are set (by alice and bob), so the answer is "**maybe present**": a false positive.
check dave with bits 3, 5 and 8 > Bit 5 is 0, so the answer is "**definitely not present**". There are never false negatives.
```

**What happens, step by step:** `might_contain("alice")` recomputes the same three positions and finds them all set → `True`. For an item never added, it is `False` unless all of its k positions happen to be set by other items, which is rare while the filter is far from full. As you add more items than it was sized for, the false-positive rate rises.

**Common mistake → fix:** treating "maybe present" as "present". A positive must be confirmed against the real store; a negative can be trusted. Also size the filter for the expected item count (a filter that's too small fills up and says "maybe" to everything).

**Interview answer:** "A Bloom filter is a bit array plus k hash functions. Adding sets k bits; querying checks them. Any zero bit means definitely absent, all ones means probably present, so it has false positives but no false negatives, uses a tiny amount of memory, and doesn't support deletes (counting Bloom filters do). I use it in front of expensive lookups, for example to skip database queries for IDs that were never seen."

**Follow-ups:**
- *How do you reduce false positives?* Use more bits per item (and the right number of hash functions, roughly k ≈ (m/n)·ln 2).

---

### Q53. Near-duplicate detection on 1 million titles takes hours. What do you change?

**Short answer:** Comparing every pair of 1M titles is about 5 × 10¹¹ comparisons: O(n²) is the problem. Replace it with **candidate generation**: only compare items that are likely to be similar. First remove exact duplicates with a hash set, then use **blocking** (compare only titles that share a key such as a rare token), **MinHash + LSH** (locality-sensitive hashing: similar sets land in the same bucket with high probability), or **embeddings + an approximate nearest-neighbour index** (FAISS, HNSW). Run the expensive similarity (edit distance, `rapidfuzz`) only on the candidate pairs, then group matches with Union-Find.

```flow
pipeline: From O(n²) to near-linear near-duplicate detection
Normalise and drop exact duplicates > Lowercase, strip punctuation, collapse spaces, then a hash set removes identical titles in O(n).
Generate candidates > Blocking by shared rare tokens, MinHash with LSH buckets, or an embedding index returning the top-k neighbours. Each title is compared with a handful of candidates, not 1,000,000.
Score only the candidate pairs > Use an expensive similarity such as edit distance or token overlap on a few pairs instead of about 5 times 10 to the 11 pairs.
Group the matches > Union-Find merges matching pairs into clusters, so A~B and B~C put A, B and C in one group.
Parallelise and measure > Profile first; then spread candidate scoring across processes.
```

**Example (token blocking, then scoring):**
```python
from collections import defaultdict
from itertools import combinations

def near_duplicates(titles, threshold=0.6):
    def tokens(t): return set(t.lower().split())
    blocks = defaultdict(list)                    # token -> titles containing it
    for t in titles:
        for tok in tokens(t):
            blocks[tok].append(t)
    pairs = set()
    for group in blocks.values():
        if len(group) > 50:                       # skip very common tokens (they create huge blocks)
            continue
        for a, b in combinations(sorted(set(group)), 2):
            ta, tb = tokens(a), tokens(b)
            if len(ta & tb) / len(ta | tb) >= threshold:    # Jaccard similarity
                pairs.add((a, b))
    return sorted(pairs)

titles = ["red running shoes", "red running shoe", "blue coffee mug", "coffee mug blue"]
print(near_duplicates(titles))
```

**What happens, step by step:**
1. Each title is split into tokens, and every token has a block listing the titles containing it.
2. Only titles that share at least one (not-too-common) token are compared. "red running shoes" and "blue coffee mug" never meet.
3. Within a block, **Jaccard similarity** = shared tokens ÷ all distinct tokens: for "red running shoes" vs "red running shoe": shared {red, running} = 2, all {red, running, shoes, shoe} = 4 → 0.5, below 0.6, so it is not matched (a stemmer would fix that; this shows why normalisation matters). "blue coffee mug" vs "coffee mug blue": 3 shared / 3 total = 1.0 → matched.
4. At scale, the same shape is used with MinHash/LSH or embeddings to produce the candidate pairs.

**Common mistake → fix:** optimising the comparison function (faster edit distance) while still doing O(n²) comparisons. The win comes from doing **fewer** comparisons. Profile first to confirm the pairwise loop is the bottleneck.

**Interview answer:** "The cost is the n² pairwise comparison, so I reduce candidates: normalise and remove exact duplicates with a hash set, then generate candidate pairs by blocking, MinHash with LSH or an embedding nearest-neighbour index, run the precise similarity only on those pairs, and cluster matches with Union-Find. Then I parallelise and verify precision and recall on a labelled sample."

**Follow-ups:**
- *What is MinHash?* A compact signature of a set such that the fraction of matching signature slots estimates the Jaccard similarity; LSH puts similar signatures in the same bucket.

---

### Q54. Numeric overflow, precision and floating-point pitfalls

**Short answer:** Python `int`s have **arbitrary precision**, so they never overflow (unlike C or Java). `float`s are 64-bit IEEE-754 binary numbers, so `0.1 + 0.2 != 0.3`; compare with `math.isclose` and use `decimal.Decimal` or integer cents for money. NumPy integers have **fixed width** and *can* overflow silently.

**Example:**
```python
import math
from decimal import Decimal

print(2 ** 100)                       # 1267650600228229401496703205376 (no overflow)
print(0.1 + 0.2, 0.1 + 0.2 == 0.3)    # 0.30000000000000004 False
print(math.isclose(0.1 + 0.2, 0.3))   # True
print(Decimal("0.1") + Decimal("0.2"))         # 0.3
total = 0.0
for _ in range(10):
    total += 0.1
print(total, total == 1.0)            # 0.9999999999999999 False
print(math.fsum([0.1] * 10) == 1.0)   # True

import numpy as np
x = np.array([2**31 - 1], dtype=np.int32)
print(x + 1)                          # [-2147483648]  silent wrap-around
```

```flow
trace: Floating point surprises in money code
0.1 + 0.2 > Gives **0.30000000000000004**: 0.1 and 0.2 have no exact binary form.
0.1 + 0.2 == 0.3 > **False**. Never compare floats with ==; use math.isclose with a tolerance.
Decimal("0.1") + Decimal("0.2") > Exactly **0.3**. Build Decimals from strings, not floats. Or store money as integer cents.
adding 0.1 ten times in a loop > 0.9999999999999999, but math.fsum compensates for the rounding error and returns **1.0**.
NumPy int32 holding 2147483647, plus 1 > Wraps to **-2147483648**. Python ints never do this; NumPy ints do.
```

**What happens, step by step:** each float addition rounds to the nearest representable binary value, and the small errors accumulate: ten additions of 0.1 drift from 1.0 by about 10⁻¹⁶. `fsum` tracks the lost low-order bits and corrects them. The NumPy array is 32-bit, so adding 1 to the maximum value wraps around to the minimum.

**Common mistake → fix:** `Decimal(0.1)` copies the float's error (`0.1000000000000000055511151231257827…`). Write `Decimal("0.1")`. And when porting "overflow" interview problems (like reversing a 32-bit integer), remember Python won't overflow on its own: check the range explicitly.

**Interview answer:** "Python ints are unbounded, so no integer overflow, but floats are binary approximations: I compare with `math.isclose`, sum with `math.fsum` when accuracy matters (recent Python versions also made the built-in `sum` more accurate for floats, but a manual `+=` loop still drifts), and use `Decimal` built from strings, or integer cents, for money. NumPy and other fixed-width types can overflow silently, so I choose dtypes deliberately."

**Follow-ups:**
- *Exact fractions?* `fractions.Fraction(1, 3)` keeps exact rational numbers.

---

### Q55. How do you code a rate limiter? (token bucket)

**Short answer:** A **token bucket** allows bursts but limits the long-run rate: a bucket holds up to `capacity` tokens and refills at `rate` tokens per second; each request takes one token, and a request with no token available is rejected (HTTP 429). You don't need a timer: on every request, compute how many tokens were earned since the last request, add them (up to the capacity), and then try to take one.

**Example (with an injectable clock so it can be tested):**
```python
import time, threading

class TokenBucket:
    def __init__(self, rate: float, capacity: int, clock=time.monotonic):
        self.rate, self.capacity, self.clock = rate, capacity, clock
        self.tokens, self.updated = float(capacity), clock()
        self.lock = threading.Lock()

    def allow(self) -> bool:
        with self.lock:
            now = self.clock()
            self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)
            self.updated = now
            if self.tokens >= 1:
                self.tokens -= 1
                return True
            return False

now = [0.0]                                   # a fake clock we control
bucket = TokenBucket(rate=1, capacity=3, clock=lambda: now[0])
print([bucket.allow() for _ in range(4)])     # [True, True, True, False]
now[0] = 2.0
print([bucket.allow() for _ in range(3)])     # [True, True, False]
```

```flow
trace: Token bucket with capacity 3 and a refill of 1 token per second
t=0, tokens **3** > The bucket starts full, which allows a short burst.
4 requests at t=0 > The first three take a token each (tokens 0). The fourth finds none and is **rejected** with 429.
t=2, the next request arrives > Elapsed 2 seconds times 1 token per second = **2 tokens** earned. Tokens = min(3, 0 + 2) = 2. No timer ran; the refill is computed lazily.
3 requests at t=2 > Two succeed (tokens 0). The third is rejected.
```

**What happens, step by step:** the fake clock makes the behaviour deterministic: at `t=0` three requests pass and the fourth fails; advancing the clock to 2.0 seconds adds 2 tokens, so exactly two more requests pass. `time.monotonic` (not `time.time`) is used in production so that system clock adjustments can't break the maths.

**Common mistake → fix:** a per-process in-memory bucket in a service with several instances: each instance has its own bucket, so the real limit is multiplied by the number of instances. Use a shared store (Redis with an atomic Lua script or `INCR` with expiry) for a global limit. Also keep the refill-and-take under one lock so concurrent requests can't double-spend a token.

**Interview answer:** "A token bucket refills at a fixed rate up to a capacity, and each request consumes a token; I compute the refill lazily from elapsed time on each call, so no background timer is needed. It allows bursts up to the capacity while enforcing the average rate. It needs a lock for thread safety, and a shared store like Redis when the limit must hold across multiple instances."

**Follow-ups:**
- *Token bucket vs sliding window?* A sliding window log is exact but stores timestamps; a fixed window is cheap but allows double bursts at the window edges; the token bucket is cheap and burst-friendly.

---

## 11. Testing & concurrency

### Q56. How do you design tests for an algorithm?

**Short answer:** Test the examples from the problem, then the **edge cases** (empty input, one element, duplicates, negatives, already sorted, reverse sorted, maximum size), compare against a slow but obviously correct **brute-force oracle** on many random inputs (property-based testing with `hypothesis`), and check the running time on a large input.

```flow
pipeline: Testing an algorithm properly
Examples > The cases from the problem statement. They prove you understood it.
Edge cases > Empty, one element, all equal, negatives, sorted and reverse sorted, boundary values.
Brute-force oracle > A simple slow solution that is obviously correct, used as the expected result.
Random comparison > Generate many random inputs and assert that the fast and slow answers agree. Hypothesis does this and shrinks failures to a minimal example.
Performance check > Time the solution at the maximum n to confirm the complexity.
```

**Example:**
```python
import random

def longest_consecutive_fast(nums):
    present, best = set(nums), 0
    for x in present:
        if x - 1 not in present:
            length = 1
            while x + length in present:
                length += 1
            best = max(best, length)
    return best

def longest_consecutive_slow(nums):               # the oracle: sort and scan
    if not nums:
        return 0
    s = sorted(set(nums))
    best = cur = 1
    for a, b in zip(s, s[1:]):
        cur = cur + 1 if b == a + 1 else 1
        best = max(best, cur)
    return best

random.seed(1)
for _ in range(1000):
    nums = [random.randint(-10, 10) for _ in range(random.randint(0, 12))]
    assert longest_consecutive_fast(nums) == longest_consecutive_slow(nums), nums
print("1000 random cases agree")

# with hypothesis (pip install hypothesis):
# from hypothesis import given, strategies as st
# @given(st.lists(st.integers(-10, 10)))
# def test_agree(xs): assert longest_consecutive_fast(xs) == longest_consecutive_slow(xs)
```

**What happens, step by step:**
1. The loop generates 1,000 random lists including empty ones and ones with duplicates and negatives.
2. For each, both implementations run; `assert` fails with the input printed if they ever disagree.
3. Because the oracle is simple and the fast version is clever, a disagreement points to a bug in the fast one. `hypothesis` goes further by shrinking a failing 12-element list to the smallest failing example.

**Common mistake → fix:** testing only the happy-path examples. Off-by-one and empty-input bugs live in the edges. Also, random tests need a fixed seed (or a recorded failing example) so failures are reproducible.

**Interview answer:** "I test the given examples, then edge cases like empty, single element, duplicates, negatives and sorted or reversed input, and compare my fast solution against a brute-force oracle on random inputs, ideally with Hypothesis, which shrinks failures. Finally I time a maximum-size input to confirm the complexity."

**Follow-ups:**
- *What about the interviewer's own tests?* Walk your code through one example by hand, aloud, before saying you're done.

---

### Q57. How would you find a race condition in concurrent Python code?

**Short answer:** Look for shared mutable state that several threads, processes or coroutines touch with a read-modify-write or check-then-act pattern, force the bad interleaving with a stress test, and fix it with a lock, a queue, immutable data or an atomic database operation.

**Steps:**
1. **Recognise the symptoms:** wrong totals, duplicated or missing records, failures that disappear when you add logging or run a single thread. Result: points to shared mutable state rather than ordinary logic.
2. **Find shared state:** look for variables, dicts, files or database rows touched by several threads, processes or coroutines. Look specifically for **read-modify-write** (`counter += 1`) and **check-then-act** (`if key not in cache: cache[key] = compute()`).
3. **Reproduce under stress:** run many threads in a loop, lower the thread switch interval (`sys.setswitchinterval(1e-6)`), add small random sleeps between the read and the write. Result: turns a rare failure into a frequent one.
4. **Log with thread or task IDs** around the suspicious section to see the interleaving.
5. **Fix:** a lock around the whole critical section, a thread-safe queue instead of shared variables, immutable data, or an atomic database operation (conditional update). In asyncio, races occur across `await` points: state can change while you're suspended.

**Example:**
```python
import asyncio

cache = {}
calls = 0

async def fetch(user_id):
    global calls
    calls += 1
    await asyncio.sleep(0.01)             # stands in for a network call
    return f"user-{user_id}"

async def get_user(user_id):
    if user_id not in cache:               # check
        cache[user_id] = await fetch(user_id)   # act: another coroutine can interleave at the await
    return cache[user_id]

async def main():
    await asyncio.gather(*(get_user(7) for _ in range(5)))
    print("fetch calls:", calls)           # 5, not 1

asyncio.run(main())
```

```flow
trace: How a race loses an increment (two threads, counter starts at 0)
both threads run counter += 1 > The statement is really three steps: read, add, write.
thread A reads 0, then thread B reads 0 > Both read before either one writes.
thread A writes 1, thread B writes **1** > The final value is 1, but two increments happened. One update is lost.
fix: with lock: counter += 1 > The lock makes the three steps one unit. Result **2**.
```

**What happens, step by step (asyncio example):** five coroutines call `get_user(7)`. Each checks `7 not in cache` (True, since nobody has stored it yet) and awaits `fetch`, which suspends it; the others run the same check before any result is stored. All five fetch: `calls` is **5**. Fix: keep a dict of in-flight tasks (`cache[user_id] = asyncio.ensure_future(fetch(user_id))` before awaiting), or an `asyncio.Lock` per key, so concurrent callers share one fetch.

**Common mistake → fix:** assuming asyncio code has no races because it is single-threaded. Interleaving happens at every `await`; any check-then-act spanning an `await` can race. And assuming the GIL makes `counter += 1` safe (it doesn't).

**Interview answer:** "I look for shared mutable state with read-modify-write or check-then-act patterns, reproduce the problem with stress tests that force interleaving, log thread or task IDs to see the order, and then fix it with a lock, a queue, immutable data or an atomic database operation. In asyncio, races happen across await points, so I treat any check-then-act spanning an await as suspect."

**Follow-ups:**
- *How do you share one fetch among concurrent callers?* Cache the in-flight task or future, not the result.

---

### Q58. Which classic problems should you rehearse, and with which pattern?

**Short answer:** Drilling a short list of classic problems, each mapped to a pattern, covers most interviews. For each one, practise saying the pattern, the brute force, the optimised idea and the complexity before you code.

| Problem | Pattern | Complexity |
|---|---|---|
| Valid anagram, group anagrams | hash map / `Counter` (Q07) | O(n) |
| Two Sum | hash map complement (Q08) | O(n) |
| Longest substring without repeats | sliding window (Q10) | O(n) |
| Subarray sum equals k | prefix sums + hash map (Q11) | O(n) |
| Search in sorted data, minimum capacity | binary search (Q12) | O(log n) |
| Merge intervals, meeting rooms | sort + sweep, heap (Q14) | O(n log n) |
| Valid brackets | stack (Q17) | O(n) |
| Daily temperatures, next greater | monotonic stack (Q18) | O(n) |
| Kth largest, top-k frequent | heap (Q20) | O(n log k) |
| Merge k sorted lists | heap (Q21) | O(N log k) |
| Sliding window maximum | monotonic deque (Q22) | O(n) |
| Reverse list, detect cycle | pointers (Q24, Q25) | O(n) |
| Validate BST, lowest common ancestor | tree recursion (Q29, Q30) | O(n) |
| Implement a trie | trie (Q31) | O(L) |
| Number of islands, shortest path in a maze | BFS / DFS on a grid (Q36) | O(rows times cols) |
| Course schedule | topological sort (Q38) | O(V + E) |
| Network delay time | Dijkstra (Q39) | O((V + E) log V) |
| Subsets, permutations, word search | backtracking (Q41, Q42) | exponential |
| Climbing stairs, coin change, house robber, LIS | dynamic programming (Q43 to Q47) | states times transitions |
| LRU cache | hash map + doubly linked list (Q50) | O(1) per operation |

```flow
pipeline: How to approach any of them in the interview
Clarify > Inputs, outputs, constraints and edge cases.
Brute force first > State it and its complexity out loud.
Spot the pattern > Hash map, two pointers, window, heap, BFS, DP... use the clue table in section 1.
Code cleanly > Talk while you write; use helper functions.
Test by hand > Run an example and the edge cases; state the final time and space complexity.
```

**Example of the habit (Daily temperatures):** the prompt says "for each day, how many days until a warmer day?" The clue "next greater element" maps to a monotonic stack of indices. Brute force: for each day scan forward, O(n²). Optimised: the stack from Q18, writing `i - j` instead of the value, O(n).
```python
def daily_temperatures(temps):
    result = [0] * len(temps)
    stack = []                                # indices of days still waiting for a warmer day
    for i, t in enumerate(temps):
        while stack and temps[stack[-1]] < t:
            j = stack.pop()
            result[j] = i - j
        stack.append(i)
    return result

print(daily_temperatures([73, 74, 75, 71, 69, 72, 76, 73]))   # [1, 1, 4, 2, 1, 1, 0, 0]
```

**What happens, step by step:** day 0 (73) waits; day 1 (74) is warmer, so pop day 0 and record `1 - 0 = 1`; day 2 (75) pops day 1 → 1; days 3 and 4 (71, 69) wait; day 5 (72) pops day 4 → 1 and day 3 → `5 - 3 = 2`; day 6 (76) pops day 5 → 1 and day 2 → `6 - 2 = 4`; day 7 (73) waits; leftovers (days 6 and 7) stay 0.

**Interview answer:** "I keep a mental map from problem clues to patterns: pairs and counting to hash maps, sorted pairs to two pointers, contiguous ranges to sliding window or prefix sums, 'next greater' to a monotonic stack, top-k to a heap, shortest unweighted path to BFS, dependencies to topological sort, optimisation with overlapping subproblems to DP. For any problem I state the brute force, the pattern, the complexity, then code and test."

**Follow-ups:**
- *How do you practise efficiently?* Group problems by pattern, solve each without looking, then re-solve after a few days; explain each solution aloud.

---

## 12. Cheat sheet

| Pattern | Idea and complexity |
|---|---|
| Complexity | count steps as n grows; keep the dominant term |
| Hash map | seen, complement, counts (O(n)) |
| Two pointers | lo and hi move inward on sorted data (O(n)) |
| Sliding window | expand right, shrink left (O(n)) |
| Prefix sum | `prefix[j+1] - prefix[i]`; sum k with a dict (O(n)) |
| Binary search | invariant on `[lo, hi)`; search the answer space (O(log n)) |
| Sorting | stable Timsort; neighbours become comparable (O(n log n)) |
| Intervals | sort by start, merge (O(n log n)) |
| Stack | nesting, undo, DFS (O(n)) |
| Monotonic stack | pop while the order is violated (O(n)) |
| Heap top-k | min-heap of size k (O(n log k)) |
| Linked list | save next, re-point, advance; fast and slow pointers (O(n)) |
| Tree recursion | base case `None`, combine children (O(n)) |
| Trie | dict of dicts with an end marker (O(L)) |
| BFS | queue, mark on enqueue; shortest unweighted path (O(V + E)) |
| DFS | stack or recursion; components, cycles (O(V + E)) |
| Topological sort | Kahn: in-degree zero queue (O(V + E)) |
| Dijkstra | min-heap of distances, non-negative weights (O((V + E) log V)) |
| Union-Find | path compression and rank (about O(1)) |
| Backtracking | choose, explore, un-choose, prune (exponential) |
| Dynamic programming | state, transition, base, order (states times transition) |
| Greedy | locally best choice, only if provably correct (usually O(n log n)) |
| Bits | XOR cancels pairs; `n & (n-1)` (O(1) or O(n)) |
| LRU | OrderedDict, or map plus doubly linked list (O(1)) |
| Rate limiter | token bucket, lazy refill (O(1)) |

## Official references

- Python time complexity of built-ins: https://wiki.python.org/moin/TimeComplexity
- `collections`, `heapq`, `bisect`, `functools` docs: https://docs.python.org/3/library/
- Sorting HOWTO: https://docs.python.org/3/howto/sorting.html
- NeetCode roadmap (pattern-based practice): https://neetcode.io/roadmap
