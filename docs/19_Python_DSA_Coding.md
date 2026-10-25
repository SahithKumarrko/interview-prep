# Python Algorithms & Coding: Interview Preparation

> **Updated:** 24 October 2026 · **Level:** complexity basics → core patterns with code → scale & concurrency problems
> **How to use:** For each pattern learn (1) **when to recognise it**, (2) the **template code**, (3) the **complexity**. In the interview: clarify → examples & edge cases → brute force → optimise → code → test → complexity.

---

## Table of contents

1. [How to approach a coding interview](#1-how-to-approach-a-coding-interview)
2. [Pattern recognition map](#2-pattern-recognition-map)
3. [Complexity](#3-complexity) (Q01–Q03)
4. [Arrays, hashing, strings](#4-arrays-hashing-strings) (Q04–Q11)
5. [Stacks, queues, heaps](#5-stacks-queues-heaps) (Q12–Q15)
6. [Linked lists](#6-linked-lists) (Q16–Q17)
7. [Trees & tries](#7-trees--tries) (Q18–Q21)
8. [Graphs](#8-graphs) (Q22–Q27)
9. [Recursion, backtracking, dynamic programming](#9-recursion-backtracking-dynamic-programming) (Q28–Q32)
10. [Design & scale problems](#10-design--scale-problems) (Q33–Q38)
11. [Testing & concurrency](#11-testing--concurrency) (Q39–Q41)
12. [More patterns: sorting, bits, grids, strings](#12-more-patterns-sorting-bits-grids-strings) (Q42–Q45)
13. [Cheat sheet](#13-cheat-sheet)

---

## 1. How to approach a coding interview

```
 1. Clarify     inputs, outputs, constraints (n up to?), duplicates? negatives? empty? sorted?
 2. Examples    walk 1 normal + 2 edge cases by hand
 3. Brute force state it + its complexity (shows you understand the problem)
 4. Optimise    which pattern removes the repeated work? (see map below)
 5. Code        clean names, helper functions, no premature cleverness
 6. Test        run through your examples, then edge cases (empty, one item, all same, large)
 7. Complexity  time AND space, explain why
```

**Constraint → expected complexity:**
| n | Acceptable |
|---|---|
| ≤ 20 | O(2ⁿ), O(n!) backtracking |
| ≤ 10³ | O(n²) |
| ≤ 10⁵–10⁶ | O(n log n) or O(n) |
| ≥ 10⁸ / streaming | O(n) single pass, O(1)/O(log n) memory, or distributed |

---

## 2. Pattern recognition map

| Clue in the problem | Pattern |
|---|---|
| "find pair/complement", "seen before", counting | **Hash map / set** |
| sorted array, pair with target, palindrome, in-place | **Two pointers** |
| longest/shortest **contiguous** subarray/substring with condition | **Sliding window** |
| sum of range, subarray sum = k | **Prefix sums** (+ hash map) |
| sorted / monotonic answer space, "minimum X such that…" | **Binary search** |
| top-k, k-th largest, merge k sorted, scheduling | **Heap** |
| next greater/smaller element, histogram | **Monotonic stack** |
| matching brackets, undo, evaluate expressions | **Stack** |
| overlapping ranges, meetings | **Sort + intervals** |
| shortest path in unweighted graph / grid, levels | **BFS** |
| connected components, all paths, cycle detection | **DFS** |
| dependencies, ordering, prerequisites | **Topological sort** |
| weighted shortest path (non-negative) | **Dijkstra** |
| dynamic connectivity, grouping | **Union-Find** |
| prefix search, autocomplete | **Trie** |
| all combinations/permutations/subsets | **Backtracking** |
| optimal value with overlapping subproblems ("max/min/number of ways") | **Dynamic programming** |
| O(1) get/put with eviction | **Hash map + doubly linked list (LRU)** |

---

## 3. Complexity

### Q01. How do you analyse time and space complexity?

**Short answer:** Count how the number of operations grows with input size n, keep the dominant term, drop constants. Space = extra memory beyond the input (include recursion stack).

```flow
trace: Counting work as input grows (n = 1,000)
dict lookup: O(1) → ~**1** step > Same cost whatever the size.
binary search: O(log n) → ~**10** steps > Halving each time.
single loop: O(n) → **1,000** steps > Linear.
sort: O(n log n) → ~**10,000** > Typical best for comparison sorting.
nested loops: O(n²) → **1,000,000** > Becomes unusable fast: 10× more data = 100× more time.
```

| Big-O | Example |
|---|---|
| O(1) | dict lookup, list append |
| O(log n) | binary search, heap push/pop |
| O(n) | single loop, `x in list` |
| O(n log n) | sorting |
| O(n²) | nested loops over n |
| O(2ⁿ) | all subsets |

**Python costs to know:** `list.append/pop()` O(1) amortised; `list.insert(0,x)` / `pop(0)` O(n) → use `deque`; `x in set/dict` O(1) avg; `x in list` O(n); slicing `a[i:j]` O(j−i) copy; string `+=` in loop can be O(n²) → `"".join(parts)`; `sorted` O(n log n).

---

### Q02. What is amortised complexity?

**Short answer:** Average cost per operation over a sequence, even if some operations are expensive. A Python list over-allocates; occasionally `append` copies everything (O(n)), but averaged over many appends it's O(1).

```flow
trace: Amortised O(1) append on a dynamic array
capacity 4: [1 2 3 4] > Appends 1–4 are cheap: write into a free slot.
append 5  →  full  →  allocate capacity **8**, copy 4 items > One expensive step: O(n) copy.
appends 6, 7, 8  →  cheap > The spare room absorbs the next appends.
append 9  →  allocate **16**, copy 8 > Copies happen at 4, 8, 16, … so total copy work ≤ 2n. Spread over n appends → O(1) each, on average.
```

---

### Q03. Recursion depth and space

Each recursive call uses a stack frame → DFS on a 10⁵-deep chain hits Python's default recursion limit (~1000) → use iterative versions with an explicit stack, or `sys.setrecursionlimit` cautiously.

```flow
trace: The call stack for fact(3)
fact(3) waits on fact(2) > Each call pushes a stack frame.
fact(3) → fact(2) → fact(1) waits on fact(0) > Depth grows with n: O(n) space, and Python's limit is ~1000 frames.
fact(0) returns **1** > Base case reached.
fact(1)=1 → fact(2)=2 → fact(3)=**6** > Frames pop in reverse order. For deep inputs, convert to a loop or an explicit stack.
```

---

## 4. Arrays, hashing, strings

### Q04. Frequency counting with hash maps

```flow
trace: Counting with a hash map: first non-repeating character
s = "aabcb" > Goal: first character that appears once.
pass 1: counts = {a: **2**, b: **2**, c: **1**} > One O(n) pass builds the frequencies.
pass 2: a(2) no, a(2) no, b(2) no, **c(1) yes** > Second pass in original order finds the first count of 1.
answer: "c" > O(n) time, O(k) space for k distinct characters.
```

```python
from collections import Counter, defaultdict

def top_words(text: str, k: int) -> list[tuple[str, int]]:
    return Counter(text.lower().split()).most_common(k)       # O(n + m log k)

def group_anagrams(words: list[str]) -> list[list[str]]:
    groups = defaultdict(list)
    for w in words:
        groups[tuple(sorted(w))].append(w)                    # key = sorted letters
    return list(groups.values())                              # O(n · L log L)
```

---

### Q05. Two Sum (classic hash-map problem)

**Idea:** for each number, check whether its complement was seen before. One pass, O(n) time, O(n) space (brute force O(n²)).

```flow
trace: Two Sum in one pass (target = 9)
nums = [2, 7, 11, 15]   seen = {} > For each number, ask: have I already seen its complement (target − x)?
i=0, x=**2**: need 7, not seen  →  seen = {2: 0} > Store the value with its index.
i=1, x=**7**: need 2 → **found at index 0** > The complement is in the map.
return [0, 1] > O(n) time instead of O(n²) checking every pair.
```

```python
def two_sum(nums: list[int], target: int) -> list[int]:
    seen = {}                                   # value -> index
    for i, x in enumerate(nums):
        if target - x in seen:
            return [seen[target - x], i]
        seen[x] = i
    return []
# two_sum([2, 7, 11, 15], 9) -> [0, 1]
```

---

### Q06. Two pointers

**When:** sorted input, pairs, reversing, removing duplicates in place, palindromes.

```flow
trace: Two pointers on a sorted array (pair summing to 10)
[**1**, 3, 4, 6, 8, **9**]   1+9 = 10 > Start with the smallest and largest values.
… but say target = 12: 1+9 = 10 < 12  →  move left → > Sum too small: the only way up is a bigger left value.
[1, **3**, 4, 6, 8, **9**]  3+9 = 12 ✓ > Found. Sum too big would have moved the right pointer left instead.
Each step discards one element  →  O(n), O(1) space > Works because the array is sorted.
```

```python
def pair_sum_sorted(nums: list[int], target: int) -> tuple[int, int] | None:
    lo, hi = 0, len(nums) - 1
    while lo < hi:
        s = nums[lo] + nums[hi]
        if s == target: return lo, hi
        if s < target: lo += 1        # need bigger sum
        else: hi -= 1                 # need smaller sum
    return None                       # O(n) time, O(1) space

def is_palindrome(s: str) -> bool:
    t = [c.lower() for c in s if c.isalnum()]
    return t == t[::-1]
```

---

### Q07. Sliding window

**When:** best contiguous subarray/substring under a condition. Expand right; shrink left while the window is invalid.

```flow
trace: Sliding window: longest substring without repeats in "abcabcbb"
[**a**]bcabcbb   window "a", best 1 > Expand the right edge one character at a time.
[**abc**]abcbb   best 3 > No repeats yet, so the window keeps growing.
a[**bca**]bcbb   "a" repeated → move left past the old "a" > On a repeat, shrink from the left until the window is valid again.
ab[**cab**]cbb … abcab[**cb**]b > Each character enters and leaves the window at most once.
answer **3** > O(n) instead of checking every substring (O(n²) or worse).
```

```python
def longest_unique_substring(s: str) -> int:
    last = {}                        # char -> last index
    left = best = 0
    for right, ch in enumerate(s):
        if ch in last and last[ch] >= left:
            left = last[ch] + 1      # shrink past the duplicate
        last[ch] = right
        best = max(best, right - left + 1)
    return best                      # "abcabcbb" -> 3, O(n)

def max_sum_k(nums: list[int], k: int) -> int:          # fixed-size window
    window = sum(nums[:k]); best = window
    for i in range(k, len(nums)):
        window += nums[i] - nums[i - k]
        best = max(best, window)
    return best
```

---

### Q08. Prefix sums

**When:** many range-sum queries, or count subarrays with sum = k.

```flow
trace: Prefix sums answer range sums in O(1)
nums   = [3, 1, 4, 1, 5] > The input.
prefix = [0, 3, 4, 8, 9, **14**] > prefix[i] = sum of the first i numbers. One O(n) pass.
sum(nums[1..3]) = prefix[4] − prefix[1] = 9 − 3 = **6** > 1 + 4 + 1 = 6. Any range is one subtraction.
"subarray sums to k": count prefix values seen in a dict > Look for prefix − k among earlier prefixes.
```

```python
from itertools import accumulate
prefix = [0, *accumulate(nums)]               # prefix[i] = sum(nums[:i])
range_sum = lambda i, j: prefix[j + 1] - prefix[i]   # O(1) per query

def subarray_sum_equals_k(nums: list[int], k: int) -> int:
    count, running = 0, 0
    seen = {0: 1}                             # prefix sum -> occurrences
    for x in nums:
        running += x
        count += seen.get(running - k, 0)     # earlier prefix that makes a sum of k
        seen[running] = seen.get(running, 0) + 1
    return count                              # O(n); works with negatives (window doesn't)
```

---

### Q09. Binary search (and its invariant)

**Invariant:** the answer always stays inside `[lo, hi]`. Also used on an **answer space** ("minimum capacity to ship in D days").

```flow
trace: Binary search for 7
[1, 3, 5, **7**, 9, 11]   lo=0 hi=5 mid=2 (5) > Invariant: if 7 exists, it's between lo and hi.
5 < 7  →  lo = mid + 1 = 3 > Discard the left half, including mid.
lo=3 hi=5 mid=4 (9)  →  9 is above 7  →  hi = 3 > Discard the right half.
lo=3 hi=3 mid=3 (**7**) ✓ > Found in 3 steps: O(log n). The same idea works on any monotonic yes/no condition ("binary search on the answer").
```

```python
def first_ge(nums: list[int], target: int) -> int:
    """Index of first element >= target (len(nums) if none). Same as bisect_left."""
    lo, hi = 0, len(nums)
    while lo < hi:
        mid = (lo + hi) // 2
        if nums[mid] < target: lo = mid + 1
        else: hi = mid
    return lo

def min_capacity(weights: list[int], days: int) -> int:
    def ok(cap):                                  # can we ship within `days`?
        need, load = 1, 0
        for w in weights:
            if load + w > cap: need, load = need + 1, 0
            load += w
        return need <= days
    lo, hi = max(weights), sum(weights)
    while lo < hi:
        mid = (lo + hi) // 2
        if ok(mid): hi = mid
        else: lo = mid + 1
    return lo
```
`import bisect` gives `bisect_left/bisect_right/insort`.

---

### Q10. Sorting — when is it the right tool?

Python's `sort` is **Timsort**-derived (since 3.11 its merge order uses **Powersort**): O(n log n) worst, O(n) on nearly sorted data, **stable**. Sorting often turns a hard problem into a scan (intervals, dedupe, closest pairs). Custom order with `key=`.

```flow
trace: Sorting turns "closest pair" into one scan
times = [9, 2, 15, 4] > Find the two closest values.
brute force: compare every pair → O(n²) > 6 comparisons here; 500k for 1,000 items.
sorted → [2, 4, 9, 15] > O(n log n).
compare neighbours only: 2, **5**, 6 → closest pair (2, 4) > After sorting, the answer must be adjacent: one O(n) pass.
```

```python
people.sort(key=lambda p: (-p.score, p.name))     # score desc, name asc
```

---

### Q11. Merge overlapping intervals

```flow
trace: Merging overlapping intervals
input: [1,3] [8,10] [2,6] [15,18] > Unsorted intervals.
sort by start: [1,3] [2,6] [8,10] [15,18] > O(n log n). Overlaps are now neighbours.
[1,3] + [2,6]: 2 ≤ 3 overlap  →  **[1,6]** > Extend the current interval's end to max(3, 6).
[8,10]: 8 is after 6, no overlap  →  start new > Push [1,6]; start a new current interval.
result: [1,6] [8,10] [15,18] > One linear pass after sorting.
```

```python
def merge(intervals: list[list[int]]) -> list[list[int]]:
    intervals.sort(key=lambda x: x[0])
    merged = []
    for start, end in intervals:
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)   # overlap → extend
        else:
            merged.append([start, end])
    return merged                                      # [[1,3],[2,6],[8,10]] -> [[1,6],[8,10]]
```
O(n log n). Related: meeting rooms (sort starts and ends, or heap of end times).

---

## 5. Stacks, queues, heaps

### Q12. Stack vs queue vs deque

Stack = LIFO (`list.append/pop`); Queue = FIFO (`collections.deque.append/popleft`, O(1)); Deque = both ends O(1). `queue.Queue` is thread-safe (for producer/consumer threads); `asyncio.Queue` for coroutines.

```flow
trace: Stack vs queue vs deque
push 1, 2, 3 > Same three items in each structure.
stack.pop()  →  **3** (last in, first out) > Undo, DFS, matching brackets.
queue.popleft()  →  **1** (first in, first out) > BFS, task queues. Use `collections.deque`: `list.pop(0)` is O(n).
deque: appendleft / pop at both ends in O(1) > Sliding window maximum, palindromes.
```

```python
def valid_brackets(s: str) -> bool:
    pairs = {")": "(", "]": "[", "}": "{"}
    stack = []
    for ch in s:
        if ch in "([{": stack.append(ch)
        elif not stack or stack.pop() != pairs[ch]: return False
    return not stack
```

---

### Q13. Monotonic stack

**When:** "next greater/smaller element", stock span, largest rectangle. Keep the stack increasing/decreasing; each element pushed/popped once → O(n).

```flow
trace: Monotonic stack: next greater element for [2, 1, 2, 4, 3]
x=2  stack [**2**] > Keep a stack of indices still waiting for a bigger value (values decreasing).
x=1  stack [2, **1**] > Smaller, so push.
x=2  pops 1 → next greater of 1 is **2**;  stack [2, 2] > A bigger value resolves everything smaller on top.
x=4  pops 2, 2 → both get **4**;  stack [**4**] > Each index is pushed and popped once: O(n).
x=3  stack [4, 3]; end → leftovers get −1 > Answer: [4, 2, 4, −1, −1].
```

```python
def next_greater(nums: list[int]) -> list[int]:
    res = [-1] * len(nums)
    stack = []                                   # indices with decreasing values
    for i, x in enumerate(nums):
        while stack and nums[stack[-1]] < x:
            res[stack.pop()] = x                 # x is the next greater for that index
        stack.append(i)
    return res                                   # [2,1,2,4,3] -> [4,2,4,-1,-1]
```

---

### Q14. Heaps for top-k

Python `heapq` is a **min-heap**. For top-k largest keep a min-heap of size k: O(n log k), memory O(k) — works on streams.

```flow
trace: Top-3 largest with a min-heap of size 3
stream: 5, 1, 9, 3, 7, 8 > Keep only the best k seen so far.
push 5, 1, 9  →  heap [1, 5, 9] (min on top) > Fill up to k.
3: bigger than min 1  →  replace  →  [**3**, 5, 9] > The smallest of the top-k sits at the root, so comparing is O(1).
7  →  [5, 7, 9];  8  →  [**7**, 8, 9] > Each push/pop is O(log k).
answer: 9, 8, 7 > O(n log k) time, O(k) memory. Works on streams too large to sort.
```

```python
import heapq
def top_k(nums, k):
    heap = []
    for x in nums:
        heapq.heappush(heap, x)
        if len(heap) > k:
            heapq.heappop(heap)          # drop the smallest
    return sorted(heap, reverse=True)
# shortcuts: heapq.nlargest(k, nums), heapq.merge(*sorted_lists)
# max-heap trick: push -x
```

---

### Q15. Merge k sorted lists / streams

Push the first element of each list with its source index; pop smallest, push next from the same source. O(N log k).

```flow
trace: Merging k sorted lists with a heap
heads: A=[1,4]  B=[2,5]  C=[3] > Put each list's first element in a min-heap.
heap {1A, 2B, 3C}  →  pop **1** from A, push 4 > Always take the global minimum.
heap {2B, 3C, 4A}  →  pop **2**, push 5 > The heap never holds more than k items.
… out: 1, 2, 3, 4, 5 > O(N log k) for N total items.
```

---

## 6. Linked lists

### Q16. Reverse a linked list

```flow
trace: Reversing a linked list in place
prev=None  curr=**1** → 2 → 3 > Three pointers: prev, curr, next.
save next=2;  1.next = None;  prev=1, curr=**2** > Point the current node backwards, then step forward.
2.next = 1;  prev=2, curr=**3** > The reversed part grows behind us: 2 → 1.
3.next = 2;  prev=3, curr=None > Done: 3 → 2 → 1. Return prev. O(n) time, O(1) space.
```

```python
class Node:
    def __init__(self, val, next=None): self.val, self.next = val, next

def reverse(head: Node | None) -> Node | None:
    prev = None
    while head:
        head.next, prev, head = prev, head, head.next   # re-point, advance
    return prev                                          # O(n) time, O(1) space
```
Explain it step by step: keep `prev`, save `next`, point current back, move both forward.

---

### Q17. Fast & slow pointers

Detect a cycle (Floyd), find the middle, k-th from end.

```flow
trace: Floyd's cycle detection (fast & slow pointers)
slow=1 fast=1   list 1→2→3→4→5→3 (cycle) > Slow moves 1 step, fast moves 2.
slow=2 fast=3 > If there's no cycle, fast reaches the end (None).
slow=3 fast=5 > Inside a cycle, fast gains 1 step per move on slow.
slow=4 fast=4  →  **meet: cycle exists** > O(n) time, O(1) memory. Same trick finds the middle of a list.
```

```python
def has_cycle(head):
    slow = fast = head
    while fast and fast.next:
        slow, fast = slow.next, fast.next.next
        if slow is fast: return True
    return False
```

---

## 7. Trees & tries

### Q18. Tree traversals

```flow
trace: Traversal orders on tree 2(1, 3)
tree: root **2**, left 1, right 3 > The order of visiting the root decides the name.
pre-order (root, L, R):  **2**, 1, 3 > Copy or serialise a tree.
in-order  (L, root, R):  1, **2**, 3 > On a BST this gives sorted order.
post-order (L, R, root): 1, 3, **2** > Delete or evaluate children first (e.g. sizes, expression trees).
level-order (BFS with a queue): 2 | 1, 3 > Level by level.
```

```python
class TreeNode:
    def __init__(self, val, left=None, right=None): self.val, self.left, self.right = val, left, right

def inorder(root):                       # left, node, right → sorted order for a BST
    return inorder(root.left) + [root.val] + inorder(root.right) if root else []

from collections import deque
def level_order(root):                   # BFS by levels
    if not root: return []
    out, q = [], deque([root])
    while q:
        level = []
        for _ in range(len(q)):
            n = q.popleft(); level.append(n.val)
            if n.left: q.append(n.left)
            if n.right: q.append(n.right)
        out.append(level)
    return out
```
Preorder (node first — copy/serialise), postorder (children first — delete, compute heights).

---

### Q19. Common tree recursion: depth, validate BST

```flow
trace: Validate a BST by passing bounds down
check(5, −∞, +∞) ✓ > Each node must sit strictly inside the range its ancestors allow.
check(3, −∞, **5**) ✓  check(7, **5**, +∞) ✓ > Going left tightens the upper bound; going right tightens the lower bound.
check(4, 5, +∞) under 7  →  4 < 5 **✗** > Fails even though 4 < 7: it's in 5's right subtree. Checking only parent–child misses this.
```

```python
def max_depth(root): return 1 + max(max_depth(root.left), max_depth(root.right)) if root else 0

def is_bst(root, lo=float("-inf"), hi=float("inf")):
    if not root: return True
    if not (lo < root.val < hi): return False
    return is_bst(root.left, lo, root.val) and is_bst(root.right, root.val, hi)
```

---

### Q20. Trie (prefix tree)

**When:** prefix search/autocomplete, many words sharing prefixes. Insert/search O(L).

```flow
trace: Trie: insert "car", "cat"; search prefix "ca"
root → c → a → **r**(end) > Each node is one character; words share prefixes.
root → c → a → **t**(end) > "cat" reuses the c → a path.
prefix "ca": walk c → a  →  found **2 words below** > O(length of prefix), whatever the dictionary size. Used for autocomplete.
```

```python
class Trie:
    def __init__(self): self.root = {}
    def insert(self, word):
        node = self.root
        for ch in word: node = node.setdefault(ch, {})
        node["$"] = True                       # end marker
    def starts_with(self, prefix):
        node = self.root
        for ch in prefix:
            if ch not in node: return False
            node = node[ch]
        return True
```

---

### Q21. BST vs balanced trees vs sorted containers

BST operations are O(h) — O(n) if unbalanced. Balanced trees (AVL/red-black) keep O(log n). In Python interviews, `bisect` on a sorted list (O(n) insert) or `sortedcontainers.SortedList` (O(log n)) are practical substitutes.

```flow
trace: Why balance matters for a BST
insert 1, 2, 3, 4, 5 into a plain BST  →  a **chain** (1 → 2 → 3 → 4 → 5) > Search becomes O(n).
balanced tree (AVL / red-black) rotates  →  height **~log n** > Search stays O(log n).
Python has no built-in balanced tree > Use `bisect` on a sorted list or `sortedcontainers.SortedList`.
```

---

## 8. Graphs

### Q22. Representing graphs

Adjacency list (`dict[node, list[node]]`) — memory O(V+E), best for sparse graphs. Adjacency matrix O(V²). Grids are implicit graphs (neighbours = 4 directions).

```flow
trace: Two ways to store the same graph
edges: A–B, A–C, B–C, C–D > 4 nodes, 4 edges.
adjacency list: {A: [B, C], B: [A, C], C: [A, B, D], D: [C]} > O(V + E) memory; fast neighbour iteration. Default choice.
adjacency matrix: 4×4 grid of 0/1 > O(V²) memory; O(1) "is there an edge?". Only for dense or small graphs.
```

---

### Q23. BFS and DFS

**BFS** explores level by level (queue) → shortest path in **unweighted** graphs. **DFS** goes deep (stack/recursion) → components, cycle detection, paths. Both O(V + E).

```flow
trace: BFS finds the shortest path in steps
graph: A–B, A–C, B–D, C–D, D–E   start A > Use a queue and a visited set.
queue [A]  →  visit **A**, enqueue B, C > Level 1 = everything one edge away.
queue [B, C]  →  B: enqueue D;  C: D already seen > Mark visited when enqueuing, so nodes aren't added twice.
queue [D]  →  enqueue E > Level 2.
queue [E]  →  reached E at distance **3** > Explores in rings, so the first time you reach a node is the shortest path (unweighted). DFS goes deep first and doesn't guarantee this.
```

```python
from collections import deque
def shortest_path_grid(grid, start, goal):
    rows, cols = len(grid), len(grid[0])
    q, dist = deque([start]), {start: 0}
    while q:
        r, c = q.popleft()
        if (r, c) == goal: return dist[(r, c)]
        for dr, dc in ((1,0), (-1,0), (0,1), (0,-1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < rows and 0 <= nc < cols and grid[nr][nc] == 0 and (nr, nc) not in dist:
                dist[(nr, nc)] = dist[(r, c)] + 1
                q.append((nr, nc))
    return -1

def count_islands(grid):
    seen, count = set(), 0
    def dfs(r, c):
        stack = [(r, c)]
        while stack:
            r, c = stack.pop()
            if (r, c) in seen or not (0 <= r < len(grid) and 0 <= c < len(grid[0])) or grid[r][c] != "1":
                continue
            seen.add((r, c))
            stack += [(r+1, c), (r-1, c), (r, c+1), (r, c-1)]
    for r in range(len(grid)):
        for c in range(len(grid[0])):
            if grid[r][c] == "1" and (r, c) not in seen:
                dfs(r, c); count += 1
    return count
```

---

### Q24. Cycle detection in a directed graph

DFS with three colours: white (unvisited), grey (on current path), black (done). Reaching a **grey** node = back edge = cycle. (Or Kahn's algorithm: if topological sort can't include all nodes, there's a cycle.)

```flow
trace: Cycle detection with three colours
all nodes WHITE (unvisited) > DFS on a directed graph.
visit A → GREY (on the current path) → B GREY → C GREY > Grey = currently being explored.
C → A, and A is **GREY**  →  cycle found > An edge back to a node on the current path is a cycle.
finished nodes turn BLACK > Edges to black nodes are fine (already fully explored).
```

```python
def has_cycle(graph: dict[str, list[str]]) -> bool:
    WHITE, GREY, BLACK = 0, 1, 2
    color = {n: WHITE for n in graph}
    def visit(n):
        color[n] = GREY
        for m in graph.get(n, []):
            if color.get(m, WHITE) == GREY: return True
            if color.get(m, WHITE) == WHITE and visit(m): return True
        color[n] = BLACK
        return False
    return any(color[n] == WHITE and visit(n) for n in graph)
```

---

### Q25. Topological sort (Kahn's algorithm)

**When:** order tasks with dependencies (build steps, course prerequisites, workflow DAGs — like Terraform's graph or `needs:` in CI).

```flow
trace: Kahn's algorithm (topological sort)
edges: A→C, B→C, C→D   in-degree A0 B0 C2 D1 > Count incoming edges per node.
queue [A, B] (in-degree 0) > Start with nodes nothing depends on.
take A: C→1;  take B: C→**0** → enqueue C > Removing a node lowers its dependents' counts.
take C: D→0 → enqueue D;  take D > Order: A, B, C, D.
processed 4 of 4 nodes ✓ > Fewer processed than nodes means a cycle. Used for build orders and task scheduling.
```

```python
from collections import deque, defaultdict
def topo_order(n: int, edges: list[tuple[int, int]]) -> list[int]:
    indeg, adj = [0] * n, defaultdict(list)
    for a, b in edges:                    # a must come before b
        adj[a].append(b); indeg[b] += 1
    q = deque(i for i in range(n) if indeg[i] == 0)
    order = []
    while q:
        u = q.popleft(); order.append(u)
        for v in adj[u]:
            indeg[v] -= 1
            if indeg[v] == 0: q.append(v)
    return order if len(order) == n else []   # [] → cycle exists
```

---

### Q26. Dijkstra's algorithm

**When:** shortest path with **non-negative** weights. Min-heap of (distance, node). O((V + E) log V). Negative weights → Bellman-Ford.

```flow
trace: Dijkstra from A
dist A0, B∞, C∞, D∞   heap [(0,A)] > Edges: A–B 4, A–C 1, C–B 2, B–D 1.
pop A (0): C = **1**, B = 4 > Relax each neighbour: is going through A shorter?
pop C (1): B via C = 1+2 = **3** < 4  →  update B > Always expand the closest unfinished node next.
pop B (3): D = **4** > B's distance is now final.
pop D (4): done > O((V+E) log V) with a heap. Needs non-negative weights.
```

```python
import heapq
def dijkstra(graph: dict[str, list[tuple[str, int]]], src: str) -> dict[str, int]:
    dist = {src: 0}
    heap = [(0, src)]
    while heap:
        d, u = heapq.heappop(heap)
        if d > dist.get(u, float("inf")): continue         # stale entry
        for v, w in graph.get(u, []):
            nd = d + w
            if nd < dist.get(v, float("inf")):
                dist[v] = nd
                heapq.heappush(heap, (nd, v))
    return dist
```

---

### Q27. Union-Find (Disjoint Set Union)

**When:** grouping/connectivity queries, merging duplicates, Kruskal's MST. With path compression + union by rank, operations are ~O(1) (inverse Ackermann).

```flow
trace: Union-Find
parent: 1→1, 2→2, 3→3, 4→4 > Every element starts as its own group.
union(1,2): 2 → 1 > Attach one root under the other (by size or rank).
union(3,4): 4 → 3;  union(2,4): root 3 → **1** > Groups merge by joining their roots.
find(4): 4 → 3 → **1**, then compress: 4 → 1 directly > Path compression flattens the tree, so operations are almost O(1).
```

```python
class DSU:
    def __init__(self, n): self.parent, self.rank = list(range(n)), [0] * n
    def find(self, x):
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]   # path compression (halving)
            x = self.parent[x]
        return x
    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb: return False
        if self.rank[ra] < self.rank[rb]: ra, rb = rb, ra
        self.parent[rb] = ra
        self.rank[ra] += self.rank[ra] == self.rank[rb]
        return True
```

---

## 9. Recursion, backtracking, dynamic programming

### Q28. When is recursion appropriate?

When the problem is naturally recursive (trees, divide-and-conquer, backtracking). Risks: recursion limit, repeated work (→ memoise), extra stack memory. Always define the base case first.

```flow
pipeline: Recursion or iteration?
Naturally recursive shape? > Trees, nested structures, divide and conquer.
Depth bounded and small? > Recursion is clear and fine.
Could be deep (long lists, big graphs)? > Python's limit is ~1,000 frames: use a loop or an explicit stack.
Overlapping sub-problems? > Add memoisation (or bottom-up DP).
```

---

### Q29. Backtracking

**Template:** choose → explore → un-choose. Prune invalid branches early.

```flow
trace: Backtracking: subsets of [1, 2]
path [] > At each element: choose it or skip it.
choose 1 → [**1**] → choose 2 → [**1, 2**] ✓ record > Go deep with a choice.
undo 2 → [1] ✓ record > Backtrack: undo the last choice and try the alternative.
undo 1 → [] → choose 2 → [**2**] ✓;  skip → [] ✓ > All 4 subsets: [], [1], [1,2], [2]. Prune branches early when they can't lead to a valid answer.
```

```python
def subsets(nums):
    res, path = [], []
    def go(i):
        if i == len(nums):
            res.append(path[:]); return
        path.append(nums[i]); go(i + 1)        # include
        path.pop();           go(i + 1)        # exclude
    go(0)
    return res                                  # O(2ⁿ · n)

def permutations(nums):
    res = []
    def go(path, remaining):
        if not remaining: res.append(path); return
        for i in range(len(remaining)):
            go(path + [remaining[i]], remaining[:i] + remaining[i+1:])
    go([], nums)
    return res
```

---

### Q30. Dynamic programming — how to think about it

**Short answer:** DP = recursion + **memoisation** of overlapping subproblems (or bottom-up table). Steps: (1) define the **state** (what does `dp[i]` mean?), (2) **transition** (how dp[i] depends on smaller states), (3) **base cases**, (4) order of computation, (5) answer location, (6) optimise space.

```flow
trace: Climbing stairs (1 or 2 steps): from recursion to DP
ways(n) = ways(n−1) + ways(n−2) > Define the state and the recurrence first.
naive recursion recomputes ways(3) again and again > Exponential time.
memo / table: ways = [1, 1, **2**, **3**, **5**, **8**] > Each sub-problem computed once: O(n).
keep only the last two values > O(1) space. Same steps for any DP: state, recurrence, base cases, order.
```

```python
from functools import cache

@cache
def climb(n: int) -> int:                # ways to climb n stairs with 1 or 2 steps
    return 1 if n <= 1 else climb(n - 1) + climb(n - 2)

def coin_change(coins: list[int], amount: int) -> int:   # min coins (bottom-up)
    dp = [0] + [float("inf")] * amount   # dp[a] = min coins to make a
    for a in range(1, amount + 1):
        for c in coins:
            if c <= a: dp[a] = min(dp[a], dp[a - c] + 1)
    return dp[amount] if dp[amount] != float("inf") else -1   # O(amount · len(coins))

def lcs(a: str, b: str) -> int:          # longest common subsequence (2-D DP)
    dp = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            dp[i][j] = dp[i-1][j-1] + 1 if a[i-1] == b[j-1] else max(dp[i-1][j], dp[i][j-1])
    return dp[-1][-1]
```

---

### Q31. Longest increasing subsequence in O(n log n)

Keep `tails[k]` = smallest possible tail of an increasing subsequence of length k+1; binary-search where each number goes.

```flow
trace: LIS in O(n log n) with patience sorting: [3, 1, 4, 1, 5, 9, 2, 6]
3  →  tails [**3**] > tails[i] = smallest possible ending value of an increasing run of length i+1.
1  →  replace 3  →  [**1**] > A smaller ending value is always better for the future.
4 → [1, **4**];  1 → no change;  5 → [1, 4, **5**];  9 → [1, 4, 5, **9**] > Bigger than every tail: extend.
2  →  replaces 4  →  [1, **2**, 5, 9];  6  →  replaces 9  →  [1, 2, 5, **6**] > Binary search finds the replacement spot.
length **4** > The tails array isn't the sequence itself; its length is the answer.
```

```python
from bisect import bisect_left
def lis(nums: list[int]) -> int:
    tails = []
    for x in nums:
        i = bisect_left(tails, x)
        if i == len(tails): tails.append(x)
        else: tails[i] = x
    return len(tails)               # [10,9,2,5,3,7,101,18] -> 4
```

---

### Q32. Greedy vs DP

Greedy picks the locally best choice (interval scheduling by earliest end, coin change with canonical coins) — must be provably correct. If a counterexample exists (coins [1,3,4], amount 6: greedy 4+1+1=3 coins, optimal 3+3=2), use DP.

```flow
trace: Greedy fails on coins [1, 3, 4], amount 6
greedy: take biggest first → 4, then 1, 1  →  **3 coins** > Locally best choice each step.
optimal: 3 + 3  →  **2 coins** > Greedy missed it.
DP: best[a] = 1 + min(best[a − c]) → best[6] = **2** > Tries every last coin; always correct here.
greedy works when the problem has the greedy-choice property > e.g. interval scheduling by earliest end time.
```

---

## 10. Design & scale problems

### Q33. LRU cache — implementation and complexity

**Requirement:** `get` and `put` in O(1), evict the least recently used. Hash map (key → node) + doubly linked list (recency order). In Python, `OrderedDict` provides both.

```flow
trace: LRU cache with capacity 2
put(a)  →  [**a**] > An OrderedDict / hash map + doubly linked list: most recent at the end.
put(b)  →  [a, **b**] > Full.
get(a)  →  move a to the end  →  [b, **a**] > Every access refreshes recency in O(1).
put(c)  →  evict least recent **b**  →  [a, c] > The front of the list is the eviction candidate.
```

```python
from collections import OrderedDict
class LRUCache:
    def __init__(self, capacity: int):
        self.cap, self.data = capacity, OrderedDict()
    def get(self, key):
        if key not in self.data: return -1
        self.data.move_to_end(key)              # mark as recently used
        return self.data[key]
    def put(self, key, value):
        self.data[key] = value
        self.data.move_to_end(key)
        if len(self.data) > self.cap:
            self.data.popitem(last=False)       # evict least recently used
```
Follow-ups: thread safety (lock), TTL expiry, `functools.lru_cache` for memoising functions, distributed cache (Redis `maxmemory-policy allkeys-lru`).

---

### Q34. Find duplicates at massive scale with limited RAM

Options: **external sort** (sort chunks to disk, merge, compare neighbours); **hash partitioning** (hash each record into N files so duplicates land in the same file, then dedupe each file in memory); **Bloom filter** for a probabilistic first pass; distributed (Spark/Athena `GROUP BY`). Normalise first (case, whitespace, Unicode NFKC).

```flow
pipeline: Duplicates in data too big for memory
Normalise > Case, whitespace, Unicode.
Hash partition > Write each record to file hash(key) % N, so duplicates land in the same file.
Dedupe each file in memory > Each partition now fits.
Or external sort > Sort chunks to disk, merge, compare neighbours.
At scale > Spark/Athena GROUP BY; Bloom filter for a cheap first pass.
```

---

### Q35. Bloom filter — trade-off

Bit array + k hash functions. "Not present" is **certain**; "maybe present" can be a **false positive** (rate depends on bits per item and k). No deletes (counting Bloom filters allow them). Tiny memory for huge sets — used for "have we seen this URL/ID?" before an expensive lookup.

```flow
trace: Bloom filter (3 hash functions, 10 bits)
add "alice": set bits 1, 4, 7  →  0**1**00**1**00**1**00 > Each item flips k bits; no item is stored.
add "bob": set bits 2, 4, 9 > Bits can overlap between items.
check "carol": bits 1, 2, 9 all set  →  "**maybe present**" > Could be a false positive from other items' bits.
check "dave": bit 5 is 0  →  "**definitely not present**" > Never false negatives. Tiny memory, but no deletes in the basic version.
```

---

### Q36. Near-duplicate detection for 1M titles takes hours — what do you change?

Pairwise comparison is O(n²) = 10¹² comparisons. Fix with **candidate generation**: normalise text → exact duplicates via hash set → near-duplicates via blocking (same first token / sorted tokens), **MinHash + LSH** (Jaccard similarity buckets) or **embeddings + ANN index** (FAISS/HNSW) to get top-k neighbours → then apply an expensive similarity (rapidfuzz, edit distance) only to candidates → union-find to group. Parallelise with multiprocessing; profile before tuning.

```flow
pipeline: Near-duplicates for 1M titles in minutes, not hours
Normalise + exact dedupe > Hash set removes identical titles first.
Candidate generation > Blocking, MinHash + LSH, or embeddings + ANN index: top-k neighbours only.
Expensive similarity on candidates > rapidfuzz / edit distance on a few pairs instead of 10¹² pairs.
Group > Union-find merges matches into clusters.
```

---

### Q37. Numeric overflow, precision and floats

Python ints are arbitrary precision (no overflow). Floats are IEEE-754: `0.1 + 0.2 != 0.3` → compare with `math.isclose(a, b, rel_tol=1e-9)`; money → `decimal.Decimal` or integer cents; `fractions.Fraction` for exact ratios. NumPy ints **can** overflow.

```flow
trace: Floating point surprises money code
0.1 + 0.2  →  **0.30000000000000004** > Binary floats can't represent 0.1 exactly.
0.1 + 0.2 == 0.3  →  **False** > Compare with math.isclose for floats.
Decimal("0.1") + Decimal("0.2")  →  **Decimal("0.3")** > Use Decimal (or integer paise/cents) for money.
Python ints never overflow > But NumPy int64 can.
```

---

### Q38. Rate limiter (coding version)

```flow
trace: Token bucket (capacity 3, refill 1 token/s)
t=0: tokens **3** > Bucket starts full, allowing short bursts.
3 requests at t=0  →  tokens 0, all allowed > Each request takes one token.
4th request at t=0  →  **rejected (429)** > Empty bucket.
t=2s  →  refilled to **2** > Tokens are added based on elapsed time (computed on the next request, no timer needed).
```

```python
import time, threading
class TokenBucket:
    def __init__(self, rate: float, capacity: int):
        self.rate, self.capacity = rate, capacity
        self.tokens, self.updated = capacity, time.monotonic()
        self.lock = threading.Lock()
    def allow(self) -> bool:
        with self.lock:
            now = time.monotonic()
            self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)
            self.updated = now
            if self.tokens >= 1:
                self.tokens -= 1
                return True
            return False
```

---

## 11. Testing & concurrency

### Q39. Designing tests for algorithmic solutions

Cover: empty input, single element, duplicates, negatives, already sorted / reverse sorted, very large n (performance), boundary values. Compare against a **brute-force oracle** on random inputs (property-based testing with `hypothesis`).

```flow
pipeline: Testing an algorithm properly
Example cases > From the problem statement.
Edge cases > Empty, one element, duplicates, negatives, max sizes.
Brute-force oracle > Compare against a slow but obviously correct version.
Property-based tests > Hypothesis generates random inputs.
Complexity check > Time it on large inputs.
```

```python
from hypothesis import given, strategies as st
@given(st.lists(st.integers()))
def test_merge_matches_bruteforce(xs):
    assert sorted(xs) == my_sort(xs)
```

---

### Q40. How would you find a race condition in concurrent Python code?

Symptoms: wrong totals, intermittent failures. Look for shared mutable state accessed by multiple threads/coroutines with read-modify-write (`counter += 1`, check-then-act `if key not in d: d[key] = …`). Reproduce with stress tests (many threads, `sys.setswitchinterval` small), add logging with thread IDs; fix with locks, queues, atomic DB operations (conditional writes), or immutable data. In asyncio, races happen across `await` points (state changed while you awaited).

```flow
trace: How a race loses an increment
counter = 0;  threads A and B run `counter += 1` > `+=` is read, add, write: three steps.
A reads 0;  B reads 0 > Both read before either writes.
A writes 1;  B writes **1** > Expected 2.
fix: with lock: counter += 1 > Or a queue / atomic structures. Find races by stress tests, sleep injection, and code review of shared state.
```

```python
# check-then-act race in asyncio
if user_id not in cache:
    cache[user_id] = await fetch(user_id)   # two coroutines can both fetch; fine if idempotent,
                                            # otherwise use asyncio.Lock per key
```

---

### Q41. Classic quick problems to rehearse

Valid anagram (Counter), product of array except self (prefix/suffix products), rotate array, kth largest (heap/quickselect), meeting rooms II (heap), course schedule (topo sort), word search (backtracking), number of islands (DFS/BFS), house robber (DP), coin change (DP), LRU cache, merge intervals, sliding window maximum (monotonic deque), serialize/deserialize tree, implement a trie.

```flow
pipeline: How to approach any coding question
Clarify > Inputs, outputs, constraints, edge cases.
Brute force first > State it and its complexity.
Spot the pattern > Hash map, two pointers, window, heap, BFS, DP…
Code cleanly > Talk while you write.
Test by hand > Examples + edge cases; state final complexity.
```

---

## 12. More patterns: sorting, bits, grids, strings

### Q42. Sorting algorithms — which to know and why

**Short answer:** In real code use `sorted()` / `list.sort()` (Timsort-derived; since Python 3.11 the merge order uses **Powersort** — still **stable**, O(n log n), very fast on partly sorted data). In interviews, know how merge sort and quicksort work, their complexity, and stability.

```flow
trace: Merge sort on [5, 2, 4, 1]
[5, 2, 4, 1] > Divide until each piece has one element.
[5, 2]  [4, 1]  →  [5] [2] [4] [1] > log n levels of splitting.
merge  →  [**2, 5**]  [**1, 4**] > Merge two sorted lists by repeatedly taking the smaller front item.
merge  →  [**1, 2, 4, 5**] > O(n log n) always, stable, O(n) extra memory.
```

| Algorithm | Average | Worst | Extra space | Stable | Key idea |
|---|---|---|---|---|---|
| Merge sort | n log n | n log n | O(n) | yes | split in half, sort each, merge |
| Quicksort | n log n | n² (bad pivots) | O(log n) | no | partition around a pivot |
| Heap sort | n log n | n log n | O(1) | no | repeatedly pop max from a heap |
| Counting / bucket | n + k | n + k | O(k) | yes | small integer range |
| Insertion sort | n² | n² | O(1) | yes | great for tiny/nearly-sorted arrays |

```python
def merge_sort(a):
    if len(a) <= 1:
        return a
    mid = len(a) // 2
    left, right = merge_sort(a[:mid]), merge_sort(a[mid:])
    out, i, j = [], 0, 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:          # <= keeps it stable
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
```
**Stability** matters when sorting by multiple keys: sort by date, then (stable) by priority → items with equal priority stay in date order. Python: `sorted(rows, key=lambda r: (r.priority, r.date))` does both at once.

---

### Q43. Bit manipulation basics

```flow
trace: XOR finds the number that appears once in [4, 1, 2, 1, 2]
acc = 0 > XOR facts: a ^ a = 0 and a ^ 0 = a; order doesn't matter.
^4 → 4;  ^1 → 5;  ^2 → 7 > Running XOR.
^1 → 6;  ^2 → **4** > Every pair cancels itself out.
answer **4** > O(n) time, O(1) space.
```

| Trick | Code | Use |
|---|---|---|
| Check bit k | `(n >> k) & 1` | flags, permissions |
| Set / clear bit k | `n \| (1 << k)` / `n & ~(1 << k)` | flags |
| Is power of two | `n > 0 and n & (n - 1) == 0` | sizing |
| Count set bits | `n.bit_count()` (3.10+) | Hamming weight |
| XOR cancels pairs | `a ^ a = 0`, `a ^ 0 = a` | find the single non-duplicated number |

```python
from functools import reduce
from operator import xor
def single_number(nums):          # every number appears twice except one
    return reduce(xor, nums)      # O(n) time, O(1) space
```
Subsets via bitmask: for n items, numbers `0 .. 2**n - 1` enumerate every subset (bit i = item i included).

---

### Q44. Grid / matrix problems (BFS & DFS on a 2D grid)

**Short answer:** Treat each cell as a graph node with up to 4 neighbours. Use **BFS** for shortest path in steps, **DFS/BFS** for counting connected regions. Track visited cells and check bounds.

```flow
trace: Counting islands with BFS
11000 / 11000 / 00100 / 00011 > Grid: 1 = land. Scan cells left to right, top to bottom.
(0,0) is new land  →  islands = **1**, BFS marks its 4 cells > Flood the whole island so it's never counted again.
(2,2) new land  →  islands = **2** > A single cell is still an island.
(3,3) new land  →  islands = **3**, BFS also marks (3,4) > Each cell is visited once: O(rows × cols).
```

```python
from collections import deque
def num_islands(grid: list[list[str]]) -> int:
    rows, cols = len(grid), len(grid[0])
    seen, count = set(), 0
    for r in range(rows):
        for c in range(cols):
            if grid[r][c] == "1" and (r, c) not in seen:
                count += 1
                q = deque([(r, c)]); seen.add((r, c))
                while q:
                    x, y = q.popleft()
                    for dx, dy in ((1,0), (-1,0), (0,1), (0,-1)):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < rows and 0 <= ny < cols and grid[nx][ny] == "1" and (nx, ny) not in seen:
                            seen.add((nx, ny)); q.append((nx, ny))
    return count          # O(rows × cols) time and space
```
Variants: shortest path in a maze (BFS with distance), "rotting oranges" (**multi-source BFS** — start with all sources in the queue), flood fill. Prefer BFS over recursive DFS on big grids to avoid Python's recursion limit.

---

### Q45. Common string patterns

```flow
trace: Group anagrams by a sorted-letters key
"eat" → key "aet"; "tea" → "aet"; "tan" → "ant" > Anagrams share the same letters, so their sorted form is identical.
groups {"aet": [eat, tea], "ant": [tan]} > A dict from key to list.
"ate" → "aet"  →  appended to [eat, tea, **ate**] > O(n · k log k). A letter-count tuple as the key makes it O(n · k).
```

```python
from collections import Counter
def is_anagram(a, b):               # same letters, same counts
    return Counter(a) == Counter(b)            # O(n)

def group_anagrams(words):
    groups = defaultdict(list)
    for w in words:
        groups["".join(sorted(w))].append(w)   # key = sorted letters
    return list(groups.values())

def is_palindrome(s):               # ignore case and non-alphanumerics
    t = [c.lower() for c in s if c.isalnum()]
    return t == t[::-1]

def longest_unique_substring(s):    # sliding window (Q07)
    last, start, best = {}, 0, 0
    for i, ch in enumerate(s):
        if ch in last and last[ch] >= start:
            start = last[ch] + 1
        last[ch] = i
        best = max(best, i - start + 1)
    return best
```
**Pitfall:** building strings with `+=` in a loop can be O(n²) — collect parts in a list and `"".join(parts)`.

---

## 13. Cheat sheet

| Pattern | Template idea | Complexity |
|---|---|---|
| Sorting | Python = Timsort/Powersort, stable n log n; merge sort stable; quicksort n² worst |
| Bits | `n & (n-1) == 0` power of two; XOR cancels pairs |
| Grids | cells = graph nodes; BFS for shortest steps; multi-source BFS |
| Hash map | seen/complement/counts | O(n) |
| Two pointers | lo/hi move inward | O(n) |
| Sliding window | expand right, shrink left | O(n) |
| Prefix sum | `prefix[j+1]-prefix[i]`; sum-k with dict | O(n) |
| Binary search | invariant `[lo, hi)`; search answer space | O(log n) |
| Heap top-k | min-heap size k | O(n log k) |
| Monotonic stack | pop while violates order | O(n) |
| Intervals | sort by start, merge | O(n log n) |
| BFS | queue; shortest unweighted | O(V+E) |
| DFS | stack/recursion; components, cycles | O(V+E) |
| Topo sort | Kahn in-degree queue | O(V+E) |
| Dijkstra | min-heap of distances | O((V+E) log V) |
| Union-Find | path compression + rank | ~O(1) |
| Trie | dict of dicts | O(L) |
| Backtracking | choose, explore, un-choose | exponential |
| DP | state, transition, base, order | states × transition |
| LRU | OrderedDict / map + DLL | O(1) |

## References

- Python TimeComplexity wiki: https://wiki.python.org/moin/TimeComplexity
- `collections`, `heapq`, `bisect`, `functools`: https://docs.python.org/3/library/
- NeetCode roadmap (pattern-based practice): https://neetcode.io/roadmap
