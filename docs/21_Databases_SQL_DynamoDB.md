# Databases: SQL, PostgreSQL, DynamoDB & Caching: L2 → L3 Interview Preparation

> **Updated:** 25 October 2026 · **Level:** SQL basics → indexes & transactions → scaling → DynamoDB design → production scenarios
> **How to use:** *Short answer* = your first 30 seconds. *Explanation / Example* build intuition. *Pitfall / Follow-up* = where interviewers dig deeper.

---

## Table of contents

1. [Mental model: what happens when you run a query](#1-mental-model-what-happens-when-you-run-a-query)
2. [SQL fundamentals](#2-sql-fundamentals) (Q01–Q07)
3. [Indexes & query performance](#3-indexes--query-performance) (Q08–Q13)
4. [Transactions, isolation & locking](#4-transactions-isolation--locking) (Q14–Q19)
5. [Schema design & scaling relational databases](#5-schema-design--scaling-relational-databases) (Q20–Q25)
6. [DynamoDB](#6-dynamodb) (Q26–Q33)
7. [Caching with Redis / ElastiCache](#7-caching-with-redis--elasticache) (Q34–Q35)
8. [Scenario & debugging questions](#8-scenario--debugging-questions) (Q36–Q41)
9. [Cheat sheet](#9-cheat-sheet)

---

## 1. Mental model: what happens when you run a query

```
 app (FastAPI) ── connection pool ──► DB server
                                        │
     SQL text ──► parser ──► planner/optimizer ──► executor ──► storage
                               │  "use index on       │          ├─ table (heap) pages
                               │   orders(user_id)?   │          ├─ index pages (B-tree)
                               │   or scan all rows?" │          └─ write-ahead log (WAL) → durability
                               ▼                      ▼
                       picks cheapest plan     reads pages (from memory cache or disk)
```

**Three ideas explain most database interview questions:**
1. **Indexes** decide whether a query touches 10 rows or 10 million.
2. **Transactions + isolation** decide what concurrent users can see and overwrite.
3. **Access patterns** decide the schema — especially in DynamoDB, where you design tables *around the queries*, not around the entities.

**Relational vs DynamoDB in one picture:**
```
PostgreSQL / Aurora                         DynamoDB
─────────────────────                       ─────────────────────────────
flexible queries (JOIN, GROUP BY, ad hoc)   only fast lookups by key you designed
schema enforced, normalised                 schemaless items, denormalised
scale up + read replicas                    scales horizontally automatically (partitions)
"what questions will I ask?" → later        "what questions will I ask?" → BEFORE you design
```

---

## 2. SQL fundamentals

### Q01. Types of JOIN

**Short answer:** A JOIN combines rows from two tables on a condition. **INNER** keeps only matches; **LEFT** keeps all left rows (NULLs where no match); **RIGHT** the reverse; **FULL OUTER** keeps everything; **CROSS** is every combination.

```
users                orders
id | name            id | user_id | total
1  | Asha            10 | 1       | 500
2  | Ravi            11 | 1       | 200
3  | Meena           12 | 2       | 900

INNER JOIN → Asha 500, Asha 200, Ravi 900          (Meena gone: no orders)
LEFT JOIN  → Asha 500, Asha 200, Ravi 900, Meena NULL
```
```sql
-- users who have never ordered (classic "anti-join")
SELECT u.id, u.name
FROM users u LEFT JOIN orders o ON o.user_id = u.id
WHERE o.id IS NULL;
```

**Pitfall:** putting a condition on the right table in `WHERE` turns a LEFT JOIN into an INNER JOIN (`WHERE o.status = 'paid'` removes the NULL rows). Put it in the `ON` clause instead.

---

### Q02. `WHERE` vs `HAVING`, and the logical order of a query

**Short answer:** `WHERE` filters **rows before grouping**; `HAVING` filters **groups after aggregation**.

```
Logical order:  FROM/JOIN → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT
```
```sql
-- customers with more than 3 paid orders this year
SELECT user_id, COUNT(*) AS n, SUM(total) AS spend
FROM orders
WHERE status = 'paid' AND created_at >= '2026-01-01'   -- row filter
GROUP BY user_id
HAVING COUNT(*) > 3                                     -- group filter
ORDER BY spend DESC;
```
This order explains why you can't use a `SELECT` alias inside `WHERE` (SELECT runs later).

---

### Q03. Subqueries vs CTEs (`WITH`)

**Short answer:** Both let you build a query from smaller queries. A **CTE** names an intermediate result so the query reads top-down; **recursive CTEs** walk hierarchies (org charts, folder trees). Modern Postgres usually inlines simple CTEs, so performance is similar.

```sql
WITH recent AS (
  SELECT user_id, SUM(total) AS spend
  FROM orders WHERE created_at > now() - interval '30 days'
  GROUP BY user_id
)
SELECT u.name, r.spend FROM recent r JOIN users u ON u.id = r.user_id
WHERE r.spend > 1000;
```

---

### Q04. Window functions

**Short answer:** Window functions compute a value **across related rows without collapsing them** (unlike GROUP BY). Used for ranking, running totals, "latest row per group".

```sql
-- latest order per user
SELECT * FROM (
  SELECT o.*, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
  FROM orders o
) t WHERE rn = 1;

-- running total per user
SELECT user_id, created_at, total,
       SUM(total) OVER (PARTITION BY user_id ORDER BY created_at) AS running_total
FROM orders;
```
| Function | Ties |
|---|---|
| `ROW_NUMBER()` | 1,2,3,4 (no ties) |
| `RANK()` | 1,2,2,4 (gaps) |
| `DENSE_RANK()` | 1,2,2,3 (no gaps) |

Also `LAG()/LEAD()` (previous/next row) — e.g. time between a user's orders. Frequently asked: "second-highest salary per department" → `DENSE_RANK() ... WHERE rnk = 2`.

---

### Q05. NULL behaviour

**Short answer:** NULL means "unknown", so `NULL = NULL` is not true — use `IS NULL`. Aggregates ignore NULLs (`COUNT(col)` skips them; `COUNT(*)` doesn't). `NOT IN (subquery)` returns nothing if the subquery contains a NULL — prefer `NOT EXISTS`.

---

### Q06. `DELETE` vs `TRUNCATE` vs `DROP`; `UNION` vs `UNION ALL`

- `DELETE` removes chosen rows (logged, can be filtered, fires triggers). `TRUNCATE` empties the whole table fast. `DROP` removes the table itself.
- `UNION` removes duplicates (extra sort/hash work); `UNION ALL` keeps all rows — use it when duplicates are impossible or wanted.

---

### Q07. Upserts

**Short answer:** Insert, or update if the key already exists — atomically. Essential for idempotent writes.

```sql
INSERT INTO job_status (job_id, status, updated_at)
VALUES ($1, 'RUNNING', now())
ON CONFLICT (job_id) DO UPDATE
SET status = EXCLUDED.status, updated_at = EXCLUDED.updated_at;
```
**Pitfall:** "SELECT, then INSERT if missing" in app code is a race — two requests both see "missing". Use a unique constraint + upsert.

---

## 3. Indexes & query performance

### Q08. What is an index and how does a B-tree work?

**Short answer:** An index is a separate sorted structure that maps column values → row locations, so the database can find rows without scanning the whole table. The default is a **B-tree**: a shallow balanced tree (3–4 levels even for millions of rows), giving O(log n) lookups and ordered range scans.

```
                     [ 50 | 100 ]                    ← root
              ┌──────────┼───────────┐
        [10|20|30]   [60|70|80]   [120|150]          ← internal pages
           │             │             │
     leaf pages: sorted keys → row pointers (and linked left↔right for range scans)

WHERE user_id = 70           → walk root → middle → leaf: ~3 page reads instead of millions
WHERE created_at BETWEEN a,b → find a, then walk the linked leaves until b
```

**Cost of an index:** every INSERT/UPDATE/DELETE must update it too, and it uses storage. Index for your real queries, not every column.

---

### Q09. Composite indexes and the leftmost-prefix rule

**Short answer:** An index on `(a, b, c)` is sorted by a, then b, then c — like a phone book sorted by surname then first name. It helps queries that filter on **a**, **a+b**, or **a+b+c**, but not on **b alone**.

```sql
CREATE INDEX idx_orders_user_status_date ON orders (user_id, status, created_at);

WHERE user_id = 7                                   -- ✅ uses index
WHERE user_id = 7 AND status = 'paid'               -- ✅
WHERE user_id = 7 AND status = 'paid' ORDER BY created_at DESC LIMIT 20   -- ✅ also avoids sort
WHERE status = 'paid'                               -- ❌ can't use (not leftmost)
```
**Rule of thumb for column order:** equality filters first, then range/sort columns.

**Covering index:** if the index contains every column the query needs (`INCLUDE (total)` in Postgres), the DB answers from the index alone ("index-only scan").

---

### Q10. When does the database NOT use your index?

- Functions on the column: `WHERE lower(email) = ...` → create an **expression index** on `lower(email)`.
- Leading wildcard: `LIKE '%abc'` (B-tree can't help; use trigram/full-text index).
- Type mismatch / implicit casts (comparing text column to a number).
- Low selectivity: `WHERE is_active = true` on 95% of rows — scanning is cheaper.
- Stale statistics → planner misestimates (run `ANALYZE`).
- `OR` across different columns (sometimes) — rewrite or use separate indexes.

---

### Q11. Reading `EXPLAIN ANALYZE`

**Short answer:** `EXPLAIN` shows the plan; `EXPLAIN ANALYZE` runs it and shows actual times and row counts. Look for **Seq Scan on big tables**, **estimated vs actual rows far apart**, expensive **Sort**/**Hash** spilling to disk, and **nested loops over many rows**.

```
EXPLAIN ANALYZE SELECT * FROM orders WHERE user_id = 7 ORDER BY created_at DESC LIMIT 20;

Limit  (actual time=0.05..0.09 rows=20)
  ->  Index Scan Backward using idx_orders_user_status_date on orders
        Index Cond: (user_id = 7)                     ← good: index, no separate sort
```
Before the index you'd see `Seq Scan on orders (rows=5,000,000)` + `Sort` — that's the fix target.

---

### Q12. The N+1 query problem

**Short answer:** Loading a list with 1 query, then running 1 more query **per item** → N+1 round trips. Fine with 5 rows, terrible with 500.

```python
# ❌ N+1: 1 query for orders + 1 query per order for its user
orders = session.scalars(select(Order).limit(100)).all()
for o in orders:
    print(o.user.name)          # lazy load → 100 extra queries

# ✅ eager load: 2 queries total (or 1 with a JOIN)
orders = session.scalars(
    select(Order).options(selectinload(Order.user)).limit(100)
).all()
```
Detect it with query logs/APM (many identical queries per request). Also applies to APIs (calling a service per item → batch endpoint).

---

### Q13. Pagination: OFFSET vs keyset (cursor)

**Short answer:** `OFFSET 100000 LIMIT 20` still reads and discards 100,000 rows → slow on deep pages, and rows shift if data changes. **Keyset pagination** remembers the last seen key and continues from it using the index.

```sql
-- page 1
SELECT * FROM orders WHERE user_id = 7 ORDER BY created_at DESC, id DESC LIMIT 20;
-- next page: pass the last row's (created_at, id) as an opaque cursor
SELECT * FROM orders
WHERE user_id = 7 AND (created_at, id) < ($last_created_at, $last_id)
ORDER BY created_at DESC, id DESC LIMIT 20;
```
Add a tie-breaker (`id`) so ordering is unique. (API side: 20 Q05.)

---

## 4. Transactions, isolation & locking

### Q14. ACID

| Letter | Meaning | Example |
|---|---|---|
| **A**tomicity | all statements commit or none | debit + credit both happen or neither |
| **C**onsistency | constraints hold after commit | no negative balance if a CHECK forbids it |
| **I**solation | concurrent transactions don't see each other's half-done work (to a chosen degree) | see Q15 |
| **D**urability | committed = survives a crash | write-ahead log flushed before "COMMIT OK" |

```python
async with session.begin():               # one transaction
    await debit(session, from_acct, 100)
    await credit(session, to_acct, 100)   # exception here → both rolled back
```

---

### Q15. Isolation levels and the anomalies they prevent

**Short answer:** Isolation is a trade-off between correctness and concurrency. Stronger levels prevent more anomalies but cause more blocking or retries.

| Anomaly | What happens |
|---|---|
| Dirty read | you read another transaction's **uncommitted** change, which then rolls back |
| Non-repeatable read | you read a row twice in one transaction and get different values |
| Phantom read | you re-run a range query and **new rows** appear |
| Lost update | two transactions read the same value, both write; one write disappears |
| Write skew | two transactions each check a rule, each update different rows, together break the rule |

| Level | Prevents | Default in |
|---|---|---|
| Read Uncommitted | nothing much (Postgres: behaves exactly like Read Committed — never shows uncommitted data) | — |
| **Read Committed** | dirty reads | **PostgreSQL**, Oracle, SQL Server |
| **Repeatable Read** | + non-repeatable reads (Postgres: also phantoms via snapshot) | **MySQL InnoDB** |
| **Serializable** | everything; result equals *some* serial order | opt-in; on failure Postgres raises SQLSTATE `40001` → roll back and retry the **whole** transaction |

**Lost-update example** (two support agents edit a ticket's counter at once):
```
T1: SELECT count FROM t WHERE id=1  → 5
T2: SELECT count FROM t WHERE id=1  → 5
T1: UPDATE t SET count = 6 ...       (5+1)
T2: UPDATE t SET count = 6 ...       (5+1)  ← one increment lost
Fix: UPDATE t SET count = count + 1 (atomic), or SELECT ... FOR UPDATE, or optimistic version check (Q17)
```

---

### Q16. Locks, `SELECT ... FOR UPDATE`, and deadlocks

**Short answer:** Writes take **row locks** held until commit. `SELECT ... FOR UPDATE` locks rows you read so nobody changes them before you write. A **deadlock** is two transactions each waiting for a lock the other holds; the DB detects it and kills one.

```
T1 locks account A → wants B
T2 locks account B → wants A      → deadlock → DB aborts one ("deadlock detected")
Fix: always lock in the same order (e.g. by ascending id), keep transactions short, retry on deadlock errors.
```

**Job-queue trick:** `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 10` lets many workers grab different pending jobs from one table without blocking each other.

---

### Q17. Pessimistic vs optimistic concurrency

| | Pessimistic | Optimistic |
|---|---|---|
| How | lock first (`FOR UPDATE`) | no lock; check a `version` column on update |
| Best when | conflicts are frequent, short transactions | conflicts rare, user think-time between read and write (forms, UIs) |
| Failure mode | blocking, deadlocks | update affects 0 rows → tell user / retry |

```sql
UPDATE documents SET body = $1, version = version + 1
WHERE id = $2 AND version = $3;     -- 0 rows updated → someone else saved first → 409 Conflict
```
This is the DB side of HTTP ETags (20 Q06).

---

### Q18. Long transactions — why are they dangerous?

Locks held longer → other requests wait; in Postgres, old row versions can't be cleaned (**VACUUM** is blocked) → table bloat; replicas may lag. **Never call an LLM, HTTP API or wait for a user inside a DB transaction.** Read → release → do slow work → short transaction to write (with an optimistic check).

---

### Q19. Transactions across services (no distributed transaction)

**Short answer:** You can't wrap a DB write + an SQS message + an S3 upload in one ACID transaction. Use the **transactional outbox** (write the event row in the same DB transaction; a relay publishes it), **idempotent consumers**, and **sagas** with compensation (15 Q13, 22 Q24).

---

## 5. Schema design & scaling relational databases

### Q20. Normalisation vs denormalisation

**Short answer:** **Normalise** (each fact stored once) to avoid update anomalies; **denormalise** (copy data for faster reads) deliberately when reads dominate and you can keep copies in sync.

```
1NF: atomic values, no repeating groups     (no "tags = 'a,b,c'" column → separate table)
2NF: no column depends on only part of a composite key
3NF: no column depends on another non-key column  (don't store customer_city in orders)
```
Practical stance: start in ~3NF for OLTP; add denormalised read models, materialised views or caches for hot read paths.

---

### Q21. Keys and constraints

- **Primary key:** unique row identity. Use surrogate keys (bigint identity or UUID); UUIDv7 is time-ordered, so it's friendlier to B-tree inserts than random UUIDv4.
- **Foreign key:** enforces relationships (`ON DELETE` behaviour).
- **UNIQUE**, **CHECK**, **NOT NULL:** push invariants into the DB — the last line of defence against app bugs and races.

---

### Q22. Connection pooling

**Short answer:** Opening a DB connection is expensive (TCP + TLS + auth + a server process in Postgres). A pool keeps connections open and reuses them. Too many connections hurts the DB (memory, context switching).

```
10 ECS tasks × 4 workers × pool 10 = 400 connections   ← may exceed max_connections
Lambda at 1,000 concurrency × 1 conn = 1,000           ← use RDS Proxy
```
- App: SQLAlchemy `pool_size`, `max_overflow`, `pool_pre_ping=True`, `pool_recycle`.
- Lambda/bursty: **RDS Proxy** multiplexes many clients onto fewer DB connections, and handles failover faster.
- Size pools from the DB's limit downward, not from the app upward.

---

### Q23. Read replicas and replication lag

**Short answer:** Replicas copy the primary asynchronously and serve read traffic. Because they lag (milliseconds to seconds), a user who just wrote may not see their change if the next read goes to a replica (**read-your-writes** problem).

Fixes: read from primary for a short time after a write / for that user's own data; route by consistency need; Aurora replicas share storage so lag is usually low but not zero.

---

### Q24. Partitioning vs sharding

| | Partitioning (one DB) | Sharding (many DBs) |
|---|---|---|
| What | split one big table into pieces (e.g. by month) inside one database | split data across separate database servers by a shard key (e.g. tenant_id) |
| Gains | faster pruning, cheap drop of old data | write scale beyond one machine |
| Costs | little | cross-shard queries/transactions, rebalancing, hot shards, ops complexity |

Exhaust indexes → caching → read replicas → partitioning → bigger instance **before** sharding. Or choose a DB built to scale horizontally (DynamoDB, Aurora Limitless) for that workload.

---

### Q25. Zero-downtime schema migrations (expand → migrate → contract)

**Short answer:** Old and new app versions run side by side during a deploy, so every migration must work with both.

```
Rename column "fullname" → "display_name":
1. EXPAND   add display_name (nullable); app writes both columns; reads old
2. MIGRATE  backfill in batches; switch reads to display_name
3. CONTRACT after all old versions are gone, stop writing fullname, then drop it
```
Avoid in one step: dropping/renaming columns used by running code, adding NOT NULL without a default to a big table, long-locking index builds (Postgres: `CREATE INDEX CONCURRENTLY`). Tools: Alembic (20 Q42), Flyway, Liquibase.

---

## 6. DynamoDB

### Q26. DynamoDB data model: partition key, sort key, items

**Short answer:** DynamoDB is a serverless key-value/document database. Every item has a **partition key** (decides which physical partition stores it, via a hash) and optionally a **sort key** (orders items inside that partition). You can only *efficiently* fetch by key: `GetItem` (exact key) or `Query` (one partition key + sort key conditions).

```
Table: Orders      PK = customer_id      SK = order_date#order_id
┌───────────────┬──────────────────────────┬────────┬────────┐
│ PK            │ SK                       │ total  │ status │
├───────────────┼──────────────────────────┼────────┼────────┤
│ CUST#42       │ 2026-10-01#A12           │ 500    │ PAID   │   ← one partition holds
│ CUST#42       │ 2026-10-20#B07           │ 120    │ NEW    │     all of customer 42's
│ CUST#77       │ 2026-09-15#C33           │ 900    │ PAID   │     orders, sorted by date
└───────────────┴──────────────────────────┴────────┴────────┘
Query: PK = CUST#42 AND begins_with(SK, "2026-10")   → this month's orders, one fast read
```

**Limits to know:** item ≤ 400 KB (store big payloads in S3, keep a pointer); a Query/Scan page returns ≤ 1 MB (paginate with `LastEvaluatedKey`); `BatchGetItem` ≤ 100 items / 16 MB; `BatchWriteItem` ≤ 25 put/delete requests (batches are *not* transactions — handle `UnprocessedItems`).

---

### Q27. Query vs Scan

**Short answer:** **Query** reads one partition key's items (fast, cheap). **Scan** reads the *entire table* then filters (slow, expensive, consumes capacity for everything read). `FilterExpression` filters *after* reading, so it doesn't reduce cost.

**Rule:** if a production path needs Scan, the key design is missing an access pattern → add a GSI or redesign keys.

---

### Q28. Secondary indexes: GSI vs LSI

| | GSI (Global) | LSI (Local) |
|---|---|---|
| Keys | any new partition + sort key | same partition key, different sort key |
| When created | any time | only at table creation |
| Consistency | eventually consistent only | strong or eventual |
| Capacity | its own | shares the table's |

```
Need: "find order by order_id" (no customer id known)
→ GSI1: PK = order_id → item       (GSI is updated asynchronously from the table)
Need: "all orders with status NEW, oldest first"
→ GSI2: PK = status, SK = created_at  (careful: few statuses = hot partition → shard the key, e.g. NEW#3)
```

---

### Q29. Access-pattern-first design and single-table design

**Short answer:** In SQL you model entities then write any query. In DynamoDB you **list every access pattern first**, then choose keys so each pattern is one `GetItem` or `Query`. **Single-table design** stores several entity types in one table with generic keys (`PK`, `SK`) so related items can be fetched together.

```
Access patterns for an agent-job service:
1. get job by id                    → PK=JOB#<id>,      SK=META
2. list a job's steps in order      → PK=JOB#<id>,      SK=STEP#<n>
3. list a user's jobs, newest first → GSI1PK=USER#<u>,  GSI1SK=<created_at>
4. idempotency check                → PK=IDEMP#<key>,   SK=IDEMP  (TTL 24h)

Query PK=JOB#123 → returns META + all STEP items in one call (no JOIN needed)
```
**Trade-off:** single-table is fast and cheap but harder to read and evolve. Multiple tables are fine when entities aren't fetched together — don't force it.

---

### Q30. Conditional writes, atomic counters and transactions

**Short answer:** DynamoDB has no locks you hold; instead, a write can carry a **condition** that must be true or the write fails. This gives idempotency and optimistic locking.

```python
# create only if new (idempotency / dedupe)
table.put_item(
    Item={"PK": f"IDEMP#{key}", "SK": "IDEMP", "result": "...", "ttl": expires},
    ConditionExpression="attribute_not_exists(PK)",
)   # second request → ConditionalCheckFailedException → return stored result

# optimistic lock
table.update_item(
    Key={"PK": "JOB#123", "SK": "META"},
    UpdateExpression="SET #s = :new, version = version + :one",
    ConditionExpression="version = :expected",
    ExpressionAttributeNames={"#s": "status"},
    ExpressionAttributeValues={":new": "DONE", ":one": 1, ":expected": 4},
)
```
- **Atomic counter:** `UpdateExpression="ADD views :one"` — no read-modify-write race.
- **Transactions:** `TransactWriteItems` — all-or-nothing across up to **100 unique items and 4 MB**; two actions can't target the same item; same account and Region only; costs 2× capacity. Use for "create order + decrement stock".

---

### Q31. Partitions, hot keys and throttling

**Short answer:** Data is spread across partitions by the hash of the partition key. Each partition has a throughput ceiling (about 3,000 read units and 1,000 write units per second). If one key gets most of the traffic (a **hot partition**), requests throttle even if the table overall has spare capacity.

```
Bad key:  PK = "2026-10-25" (today's date) → every write today hits ONE partition
Good key: PK = user_id / job_id (high cardinality, evenly used)
Hot by nature (e.g. one viral item)? → write sharding: PK = "ITEM#9#" + random(0..9), read all 10 and merge
```
Adaptive capacity helps with uneven load but can't fix a single extreme key.

---

### Q32. Capacity modes, consistency, TTL, Streams

- **On-demand:** pay per request, no planning — default for spiky/unknown traffic. **Provisioned** (+ auto scaling): cheaper for steady, predictable load.
- **Reads:** eventually consistent by default (half the cost); strongly consistent reads on the table/LSI only.
- **TTL:** set an epoch-seconds attribute; DynamoDB deletes expired items for free (deletion is not instant — filter expired items in reads if exactness matters). Great for sessions, idempotency keys, cache entries.
- **Streams:** ordered change log per item → trigger Lambda for outbox-style events, search index updates, audit.
- **PITR + on-demand backups** for recovery; **global tables** for multi-Region active-active (last-writer-wins conflicts).

---

### Q33. DynamoDB vs Aurora PostgreSQL — when to pick which?

| Choose DynamoDB when | Choose Aurora/RDS PostgreSQL when |
|---|---|
| access patterns are known and key-based | queries are ad hoc, reporting, JOIN-heavy |
| you need massive scale with no ops, single-digit ms | strong relational integrity, complex transactions |
| serverless/Lambda (no connection limits) | team knows SQL; data model will evolve unpredictably |
| e.g. job status, sessions, idempotency, agent state | e.g. billing, user/org management, analytics-lite |

Many systems use both: Postgres for core business data, DynamoDB for high-volume key-value state. For vectors, Aurora **pgvector** keeps embeddings next to relational data with SQL filters (04 Q25). DynamoDB now also offers **vector indexes** (`SearchVectors`; up to 4,096 dimensions, TopK ≤ 100, 5 vector indexes per table by default) — check the current quotas page before relying on limits.

---

## 7. Caching with Redis / ElastiCache

### Q34. Caching patterns

| Pattern | How | Watch out |
|---|---|---|
| **Cache-aside** (most common) | read cache → miss → read DB → write cache with TTL | stale data until TTL; cache stampede |
| Write-through | write DB and cache together | slower writes; caches unread data |
| Write-behind | write cache, flush to DB later | data loss risk |

```python
async def get_user(uid):
    if (hit := await redis.get(f"user:{uid}")):
        return json.loads(hit)
    user = await db.fetch_user(uid)
    await redis.set(f"user:{uid}", json.dumps(user), ex=300)   # TTL 5 min
    return user
# on update: write DB, then DELETE the cache key (invalidate) rather than updating it
```

**Cache stampede:** a hot key expires and 1,000 requests hit the DB at once → lock/single-flight per key, jittered TTLs, or refresh early in the background.

---

### Q35. What else is Redis used for?

Sessions, rate limiting (atomic `INCR` + `EXPIRE`, or token bucket in a Lua script), distributed locks (with expiry and fencing tokens — locks can expire mid-work), leaderboards (sorted sets), pub/sub and streams, short-term agent memory, semantic cache for LLM responses (04 Q44). ElastiCache/MemoryDB run Valkey or Redis OSS; **MemoryDB** is durable (can be a primary DB), ElastiCache is a cache.

---

## 8. Scenario & debugging questions

### Q36. An endpoint got slow as the table grew to 50M rows. Steps?

1. Find the query (APM / `pg_stat_statements` top by total time).
2. `EXPLAIN ANALYZE` → Seq Scan? Sort spilling? Bad estimates?
3. Add the right composite index (equality columns first, then sort column); `CREATE INDEX CONCURRENTLY` in prod.
4. Replace OFFSET pagination with keyset; select only needed columns.
5. Check N+1 and missing `LIMIT`. Run `ANALYZE` if stats are stale.
6. Then consider caching, read replicas, partitioning by time.

---

### Q37. "Deadlock detected" errors appear under load

Find the two statements in the DB log. Usually two code paths update the same rows in different orders (e.g. transfer A→B and B→A). Fix: consistent lock ordering, smaller transactions, fewer rows per transaction, index the WHERE columns (so updates lock fewer rows), and retry the aborted transaction with backoff.

---

### Q38. Users don't see their own update right after saving

Read-after-write going to a lagging **read replica**, or a cache not invalidated, or DynamoDB **GSI** (always eventually consistent) used for the read. Fix: read own data from primary/strongly consistent read for a short window, invalidate cache on write, return the updated object in the write response so the UI doesn't need to re-read.

---

### Q39. DynamoDB throttles (`ProvisionedThroughputExceededException`) though the table is mostly idle

Hot partition key (one key gets most traffic) or a GSI with a low-cardinality key that throttles and back-pressures writes. Check CloudWatch Contributor Insights for top keys. Fix: higher-cardinality keys, write sharding, on-demand mode, cache hot reads (DAX/ElastiCache), SDK retries with backoff.

---

### Q40. Lambda functions exhaust Postgres connections during a spike

Each concurrent Lambda environment holds its own connection → thousands. Fix: **RDS Proxy**, cap reserved concurrency for that function, buffer writes through SQS, open the connection outside the handler (reused per environment), or move that high-volume state to DynamoDB.

---

### Q41. Design the storage for an agentic document-processing platform

```
Aurora PostgreSQL  → tenants, users, document metadata, ACLs, billing (relational + integrity)
DynamoDB           → job status & steps, idempotency keys (TTL), rate-limit counters, session index
S3                 → raw documents, extracted JSON, large tool outputs (pointers stored in DB)
Vector store       → chunk embeddings with tenant_id + doc_id metadata filters (pgvector / OpenSearch / S3 Vectors)
Redis              → hot caches, short-lived locks, semantic cache
LangGraph checkpointer → its own store (Postgres/DynamoDB-backed), keyed by thread_id + tenant
```
Explain each choice by **access pattern, consistency need and scale**, and how tenant isolation is enforced in every store (row filter, key prefix, IAM leading-key conditions on DynamoDB).

---

## 9. Cheat sheet

| Concept | One-liner |
|---|---|
| JOINs | INNER = matches; LEFT = all left + NULLs; filter right table in `ON` |
| WHERE vs HAVING | rows before grouping vs groups after |
| Window functions | rank/running totals without collapsing rows; `ROW_NUMBER` for latest-per-group |
| B-tree index | sorted tree, O(log n), helps `=` and ranges; costs writes |
| Composite index | leftmost prefix; equality first, then range/sort |
| EXPLAIN ANALYZE | look for Seq Scan, bad estimates, spills |
| N+1 | eager load / batch |
| Keyset pagination | `WHERE (k) < last ORDER BY k LIMIT n` |
| ACID | atomic, consistent, isolated, durable |
| Isolation | Postgres default Read Committed; Serializable needs retries |
| Lost update | atomic update, `FOR UPDATE`, or version check |
| Deadlock | same lock order, short txns, retry |
| Outbox | event row in same txn; relay publishes |
| Migrations | expand → migrate → contract |
| Pooling | size from DB limit; RDS Proxy for Lambda |
| DynamoDB keys | PK spreads load, SK orders; design from access patterns |
| Query vs Scan | Query one partition; Scan = design smell |
| GSI | any keys, eventual consistency |
| Conditional write | idempotency + optimistic locking |
| Hot partition | high-cardinality keys, write sharding |
| Cache-aside | read-through on miss, TTL, invalidate on write |

## Official references

- PostgreSQL docs (indexes, EXPLAIN, transaction isolation): https://www.postgresql.org/docs/current/
- Amazon Aurora: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/
- RDS Proxy: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html
- DynamoDB developer guide: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/
- DynamoDB best practices (partition keys, GSIs): https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html
- DynamoDB constraints (item size, transactions, batch, Query limits): https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Constraints.html
- DynamoDB quotas (incl. vector indexes): https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ServiceQuotas.html
- DynamoDB partition key design (3,000 RCU / 1,000 WCU per partition): https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html
- MySQL InnoDB isolation levels: https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-isolation-levels.html
- SQLAlchemy asyncio: https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html
- ElastiCache: https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/
