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

---

### Q03. Recursion depth and space

Each recursive call uses a stack frame → DFS on a 10⁵-deep chain hits Python's default recursion limit (~1000) → use iterative versions with an explicit stack, or `sys.setrecursionlimit` cautiously.

---

## 4. Arrays, hashing, strings

### Q04. Frequency counting with hash maps

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

```python
people.sort(key=lambda p: (-p.score, p.name))     # score desc, name asc
```

---

### Q11. Merge overlapping intervals

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

---

## 6. Linked lists

### Q16. Reverse a linked list

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

---

## 8. Graphs

### Q22. Representing graphs

Adjacency list (`dict[node, list[node]]`) — memory O(V+E), best for sparse graphs. Adjacency matrix O(V²). Grids are implicit graphs (neighbours = 4 directions).

---

### Q23. BFS and DFS

**BFS** explores level by level (queue) → shortest path in **unweighted** graphs. **DFS** goes deep (stack/recursion) → components, cycle detection, paths. Both O(V + E).

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

---

### Q29. Backtracking

**Template:** choose → explore → un-choose. Prune invalid branches early.

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

---

## 10. Design & scale problems

### Q33. LRU cache — implementation and complexity

**Requirement:** `get` and `put` in O(1), evict the least recently used. Hash map (key → node) + doubly linked list (recency order). In Python, `OrderedDict` provides both.

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

---

### Q35. Bloom filter — trade-off

Bit array + k hash functions. "Not present" is **certain**; "maybe present" can be a **false positive** (rate depends on bits per item and k). No deletes (counting Bloom filters allow them). Tiny memory for huge sets — used for "have we seen this URL/ID?" before an expensive lookup.

---

### Q36. Near-duplicate detection for 1M titles takes hours — what do you change?

Pairwise comparison is O(n²) = 10¹² comparisons. Fix with **candidate generation**: normalise text → exact duplicates via hash set → near-duplicates via blocking (same first token / sorted tokens), **MinHash + LSH** (Jaccard similarity buckets) or **embeddings + ANN index** (FAISS/HNSW) to get top-k neighbours → then apply an expensive similarity (rapidfuzz, edit distance) only to candidates → union-find to group. Parallelise with multiprocessing; profile before tuning.

---

### Q37. Numeric overflow, precision and floats

Python ints are arbitrary precision (no overflow). Floats are IEEE-754: `0.1 + 0.2 != 0.3` → compare with `math.isclose(a, b, rel_tol=1e-9)`; money → `decimal.Decimal` or integer cents; `fractions.Fraction` for exact ratios. NumPy ints **can** overflow.

---

### Q38. Rate limiter (coding version)

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

```python
from hypothesis import given, strategies as st
@given(st.lists(st.integers()))
def test_merge_matches_bruteforce(xs):
    assert sorted(xs) == my_sort(xs)
```

---

### Q40. How would you find a race condition in concurrent Python code?

Symptoms: wrong totals, intermittent failures. Look for shared mutable state accessed by multiple threads/coroutines with read-modify-write (`counter += 1`, check-then-act `if key not in d: d[key] = …`). Reproduce with stress tests (many threads, `sys.setswitchinterval` small), add logging with thread IDs; fix with locks, queues, atomic DB operations (conditional writes), or immutable data. In asyncio, races happen across `await` points (state changed while you awaited).

```python
# check-then-act race in asyncio
if user_id not in cache:
    cache[user_id] = await fetch(user_id)   # two coroutines can both fetch; fine if idempotent,
                                            # otherwise use asyncio.Lock per key
```

---

### Q41. Classic quick problems to rehearse

Valid anagram (Counter), product of array except self (prefix/suffix products), rotate array, kth largest (heap/quickselect), meeting rooms II (heap), course schedule (topo sort), word search (backtracking), number of islands (DFS/BFS), house robber (DP), coin change (DP), LRU cache, merge intervals, sliding window maximum (monotonic deque), serialize/deserialize tree, implement a trie.

---

## 12. More patterns: sorting, bits, grids, strings

### Q42. Sorting algorithms — which to know and why

**Short answer:** In real code use `sorted()` / `list.sort()` (Timsort-derived; since Python 3.11 the merge order uses **Powersort** — still **stable**, O(n log n), very fast on partly sorted data). In interviews, know how merge sort and quicksort work, their complexity, and stability.

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
