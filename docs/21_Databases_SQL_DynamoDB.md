# Databases: SQL, PostgreSQL, DynamoDB & Caching: Interview Preparation

> **Updated:** 27 October 2026 (PostgreSQL 18 is current) · **Level:** SQL basics → indexes & transactions → scaling → DynamoDB design → production scenarios
> **How to use:** read the *Short answer* first, then *How it works* and the *Example* walkthrough. *Common mistake → fix* shows what goes wrong in real systems. *Interview answer* is what you can say out loud.

---

## Table of contents

1. [Mental model: what happens when you run a query](#1-mental-model-what-happens-when-you-run-a-query)
2. [SQL fundamentals](#2-sql-fundamentals) (Q01–Q11)
3. [Indexes & query performance](#3-indexes--query-performance) (Q12–Q17)
4. [Transactions, isolation & locking](#4-transactions-isolation--locking) (Q18–Q24)
5. [Schema design & scaling relational databases](#5-schema-design--scaling-relational-databases) (Q25–Q31)
6. [DynamoDB](#6-dynamodb) (Q32–Q42)
7. [Caching with Redis / ElastiCache](#7-caching-with-redis--elasticache) (Q43–Q45)
8. [Scenario & debugging questions](#8-scenario--debugging-questions) (Q46–Q51)
9. [Cheat sheet](#9-cheat-sheet)

---

## 1. Mental model: what happens when you run a query

**The one idea everything else follows from:** a database is a program that stores data durably and answers questions about it. You describe *what* you want ("the 20 newest orders of user 7"); the database decides *how* to get it, using indexes if they exist, and guarantees that concurrent users and crashes don't corrupt the data.

Think of a library. The books are the table. The card catalogue sorted by author is an index: without it you'd read every shelf. The librarian who decides the quickest way to find your book is the query planner. The lending rules that stop two people taking the same last copy are transactions and locks.

```flow
pipeline: What happens when you run a query
App borrows a connection > From a pool; opening a new connection is expensive, so connections are reused.
Parser > The SQL text becomes a syntax tree. Syntax errors are caught here.
Planner / optimizer > Chooses the cheapest plan, for example "use the index on orders(user_id) or scan every row?", based on table statistics.
Executor > Runs the plan, reading table pages (the heap) and index pages from memory, or from disk if they are not cached.
Write-ahead log > Changes are written to a log first, so committed data survives a crash.
Rows returned > The result goes back to the app and the connection returns to the pool.
```

**Three ideas explain most database interview questions:**
1. **Indexes** decide whether a query touches 10 rows or 10 million.
2. **Transactions and isolation** decide what concurrent users can see and overwrite.
3. **Access patterns** decide the schema, especially in DynamoDB, where you design tables *around the queries*, not around the entities.

**Relational vs DynamoDB in one picture:**
```
PostgreSQL / Aurora                         DynamoDB
─────────────────────                       ─────────────────────────────
flexible queries (JOIN, GROUP BY, ad hoc)   only fast lookups by the keys you designed
schema enforced, normalised                 schemaless items, denormalised
scale up + read replicas                    scales horizontally automatically (partitions)
"what questions will I ask?" → decide later "what questions will I ask?" → decide BEFORE designing
```

---

## 2. SQL fundamentals

### Q01. What is a relational database?

**Short answer:** A **relational database** stores data in **tables**. A table is a grid: each **row** is one record (one user, one order) and each **column** is one attribute with a fixed type (a name, a date, an amount). Tables are linked by **keys**: a **primary key** uniquely identifies a row, and a **foreign key** in one table points at the primary key of another. You read and change data with **SQL (Structured Query Language)**.

**How it works:**
1. A table has a **schema**: column names, types and rules (for example `NOT NULL`). The database refuses data that breaks the schema.
2. The **primary key** (often `id`) can never repeat or be empty.
3. A **foreign key** (`orders.user_id`) must match an existing `users.id`, so you can't create an order for a user who doesn't exist.
4. Instead of repeating a user's name in every order, you store it once in `users` and **join** the tables when you query.
5. A **transaction** groups several changes so they succeed or fail together (Q18).

**Example:**
```
users                       orders
id | name   | email         id | user_id | total | status
1  | Asha   | asha@x.com    10 | 1       | 500   | paid
2  | Ravi   | ravi@x.com    11 | 1       | 200   | paid
3  | Meena  | meena@x.com   12 | 2       | 900   | new
```

**What happens, step by step:**
1. `users.id` is the primary key: ids 1, 2, 3 are unique.
2. `orders.user_id` is a foreign key to `users.id`. Order 10 belongs to Asha (user 1).
3. Inserting `orders (13, user_id = 99, …)` fails with a foreign-key violation because there is no user 99.
4. To show "Asha's total spend" you don't copy her name into orders; you query `orders` filtered by `user_id = 1` and sum `total`: 700.
5. If Asha changes her email, you update one row in `users`, and every order automatically "sees" the new value.

**Common mistake → fix:** storing the user's name and email in every order row "for convenience". When the email changes you must update thousands of rows, and some will be missed, leaving contradicting copies. Store each fact once and reference it by key (normalisation, Q26).

**Interview answer:** "A relational database stores data in tables of rows and typed columns, with primary keys identifying rows and foreign keys linking tables so references stay valid. You query with SQL and combine tables with joins, and the database enforces the schema and constraints and offers transactions for consistency."

**Follow-ups:**
- *What is a schema?* The definition of tables, columns, types and constraints. Changing it later is a migration (Q31).
- *What is SQL vs a database?* SQL is the language; PostgreSQL, MySQL, SQL Server are databases that speak it.

---

### Q02. What is PostgreSQL, and how do Amazon RDS and Aurora relate to it?

**Short answer:** **PostgreSQL** ("Postgres") is a free, open-source relational database known for correctness, rich SQL and extensions. **Amazon RDS (Relational Database Service)** runs PostgreSQL (or MySQL, etc.) for you as a **managed service**: AWS handles servers, backups, patching and failover. **Amazon Aurora** is AWS's own cloud-built database that is compatible with PostgreSQL (and MySQL): the same SQL and drivers, but with a different storage layer that is shared by the writer and its read replicas.

**How it works:**
1. **Self-managed Postgres:** you run it on a server and handle backups, upgrades and failover yourself.
2. **RDS for PostgreSQL:** a managed Postgres instance; you choose the size and AWS does operations. Standby and read replicas each have their own copy of the data.
3. **Aurora PostgreSQL-compatible:** a *cluster* made of one **writer** instance and up to **15 Aurora Replicas**, all attached to one cluster volume that spans multiple Availability Zones (AZs, separate data-centre groups in a region). Replicas read the same storage, so replica lag is usually small. Aurora fails over to a replica automatically.
4. Your application code talks standard PostgreSQL either way; the differences are operations, scaling and cost.

**Example:**
```
Application  ──►  postgresql://app:***@my-cluster.cluster-abc.eu-west-1.rds.amazonaws.com:5432/orders

writer endpoint  → the primary instance (reads + writes)
reader endpoint  → spreads read-only connections across the Aurora Replicas
```

**What happens, step by step:**
1. The app writes through the **writer endpoint**; Aurora writes to the shared cluster volume (replicated across AZs).
2. A read-only query via the **reader endpoint** goes to one of the replicas, which reads the same volume. It might lag the writer by a short time (Q29).
3. The writer instance crashes. Aurora promotes a replica to writer and moves the writer endpoint, typically within tens of seconds (the exact time varies).
4. The application reconnects (its pool detects the broken connections) and continues. With plain self-managed Postgres, a human or your own failover tooling would have to do this.

**Common mistake → fix:** hard-coding an instance's own hostname instead of the cluster writer endpoint. After a failover that hostname may now be a read-only replica, and writes fail with "cannot execute INSERT in a read-only transaction". Always connect through the cluster endpoints, and make the connection pool reconnect on failure.

**Interview answer:** "PostgreSQL is an open-source relational database. RDS runs it as a managed service, so AWS handles backups, patching and failover. Aurora is AWS's PostgreSQL-compatible engine with a shared, multi-AZ storage volume: one writer and up to 15 replicas on the same storage, with automatic failover. My application code is the same standard PostgreSQL; the difference is operations and scaling."

**Follow-ups:**
- *When would you self-manage Postgres?* When you need extensions or settings a managed service doesn't allow, or are outside AWS. Most teams prefer the managed option.
- *What is Aurora Serverless?* An Aurora mode that scales compute capacity up and down automatically with load.

---

### Q03. What are the basic SQL statements?

**Short answer:** Four statements cover most day-to-day data work: `INSERT` adds rows, `SELECT` reads rows, `UPDATE` changes rows, `DELETE` removes rows. `CREATE TABLE` defines a table and its column types. `WHERE` chooses *which* rows, `ORDER BY` sorts, and `LIMIT` caps how many come back. The most dangerous typo in SQL is an `UPDATE` or `DELETE` without a `WHERE`.

**How it works:**
1. `CREATE TABLE` declares columns, types and constraints.
2. `INSERT INTO t (cols) VALUES (…)` adds a row; columns you omit get their default or `NULL`.
3. `SELECT cols FROM t WHERE condition ORDER BY col LIMIT n` reads rows that match.
4. `UPDATE t SET col = value WHERE condition` changes matching rows.
5. `DELETE FROM t WHERE condition` removes matching rows.
6. Use **parameters** (`$1`, `:id`), never string concatenation, to insert user values safely.

**Example:**
```sql
CREATE TABLE orders (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users (id),
  total      numeric(12,2) NOT NULL CHECK (total >= 0),
  status     text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO orders (user_id, total) VALUES (1, 500.00), (1, 200.00), (2, 900.00);

SELECT id, total FROM orders WHERE user_id = 1 ORDER BY created_at DESC LIMIT 10;

UPDATE orders SET status = 'paid' WHERE id = 1;

DELETE FROM orders WHERE status = 'new' AND created_at < now() - interval '90 days';
```

**What happens, step by step:**
1. `CREATE TABLE` makes an empty table. `id` is generated automatically (1, 2, 3…).
2. The `INSERT` adds three rows with ids 1 to 3; `status` is `'new'` and `created_at` is the current time for each, from the defaults.
3. The `SELECT` returns the two rows of user 1, newest first, at most 10: `(id 2, total 200.00)` and `(id 1, total 500.00)` if row 2 was created later.
4. The `UPDATE` changes exactly one row (id 1) to `paid`. The database reports `UPDATE 1`.
5. Running `UPDATE orders SET status = 'paid'` without a `WHERE` would report `UPDATE 3`: every row changed.
6. The `DELETE` removes only rows that are both `new` and older than 90 days.

**Common mistake → fix:** `DELETE FROM orders;` or building SQL with string concatenation (`"... WHERE name = '" + name + "'"`), which allows **SQL injection** (a user types `' OR 1=1 --` and reads everything). Always write the `WHERE`, run risky changes first as a `SELECT` with the same `WHERE`, do them inside a transaction you can roll back, and pass values as bound parameters:
```python
await session.execute(text("SELECT * FROM users WHERE name = :name"), {"name": name})
```

**Interview answer:** "INSERT adds rows, SELECT reads them, UPDATE changes them and DELETE removes them, with WHERE choosing which rows and ORDER BY and LIMIT shaping reads. CREATE TABLE defines columns, types and constraints. I always include a WHERE on writes, test it with a SELECT first, and pass user input as bound parameters to prevent SQL injection."

**Follow-ups:**
- *`SELECT *` or named columns?* Name the columns you need: less data transferred, and index-only scans become possible (Q13).

---

### Q04. How do `GROUP BY` and aggregate functions work?

**Short answer:** An **aggregate function** (`COUNT`, `SUM`, `AVG`, `MIN`, `MAX`) turns many rows into one value. `GROUP BY` splits the rows into groups first, so you get one result row per group: "total spend **per user**". Every column in the `SELECT` must either be in the `GROUP BY` or be wrapped in an aggregate.

**How it works:**
1. Rows that pass `WHERE` are collected.
2. `GROUP BY user_id` puts rows with the same `user_id` into one group.
3. Each aggregate is calculated per group.
4. Without `GROUP BY`, the whole result is a single group (`SELECT COUNT(*) FROM orders` returns one row).
5. Aggregates ignore `NULL`s, except `COUNT(*)`, which counts rows (Q09).
6. `HAVING` filters groups afterwards (Q06).

**Example:**
```sql
SELECT user_id,
       COUNT(*)   AS orders,
       SUM(total) AS spend,
       AVG(total) AS avg_order
FROM orders
WHERE status = 'paid'
GROUP BY user_id
ORDER BY spend DESC;
```

**What happens, step by step:** with the `orders` table from Q01 (rows `(10, user 1, 500, paid)`, `(11, user 1, 200, paid)`, `(12, user 2, 900, new)`):
1. `WHERE status = 'paid'` keeps orders 10 and 11 (order 12 is `new`).
2. `GROUP BY user_id` makes one group: user 1 with two rows.
3. `COUNT(*)` = 2, `SUM(total)` = 700, `AVG(total)` = 350.
4. The result is one row: `(1, 2, 700, 350)`. User 2 doesn't appear at all, because all their rows were filtered out.

**Common mistake → fix:** selecting a column that is neither grouped nor aggregated:
```sql
SELECT user_id, status, SUM(total) FROM orders GROUP BY user_id;   -- ❌ error
```
PostgreSQL rejects it: `status` could have different values within one group, so it doesn't know which to show. Add it to `GROUP BY` (one row per user and status) or aggregate it (`MAX(status)`, `array_agg(DISTINCT status)`).

**Interview answer:** "Aggregates collapse many rows into one value, and GROUP BY defines the groups, one output row per group. Every selected column must be grouped or aggregated. WHERE filters rows before grouping and HAVING filters the groups after aggregating."

**Follow-ups:**
- *`COUNT(*)` vs `COUNT(col)` vs `COUNT(DISTINCT col)`?* All rows; rows where col is not NULL; distinct non-NULL values.

---

### Q05. What are the types of JOIN?

**Short answer:** A **JOIN** combines rows from two tables where a condition matches (usually a foreign key equals a primary key). **INNER JOIN** keeps only matching rows. **LEFT JOIN** keeps every row from the left table and fills `NULL` where the right table has no match. **RIGHT JOIN** is the mirror image. **FULL OUTER JOIN** keeps unmatched rows from both sides. **CROSS JOIN** pairs every row with every row.

**How it works:** for each left row, the database finds right rows where the `ON` condition is true. Inner join drops left rows with no match; left join keeps them with `NULL`s on the right side. The `ON` condition decides *how rows match*; `WHERE` then filters the joined result.

**Example:** `users` (Asha 1, Ravi 2, Meena 3) and `orders` (10: user 1, total 500; 11: user 1, 200; 12: user 2, 900).
```sql
-- INNER: only users who have orders
SELECT u.name, o.total FROM users u JOIN orders o ON o.user_id = u.id;

-- LEFT: all users, orders if any
SELECT u.name, o.total FROM users u LEFT JOIN orders o ON o.user_id = u.id;

-- Anti-join: users with NO orders
SELECT u.id, u.name
FROM users u LEFT JOIN orders o ON o.user_id = u.id
WHERE o.id IS NULL;
```

```flow
trace: INNER vs LEFT JOIN on users and orders
users: Asha, Ravi, Meena. orders: Asha has 2, Ravi has 1 > Meena has no orders.
INNER JOIN gives Asha 500, Asha 200, Ravi 900 > Only rows with a match on both sides, so Meena disappears.
LEFT JOIN gives the same rows plus **Meena with NULL** > Every left row is kept, with NULL where there is no match.
LEFT JOIN with WHERE o.id IS NULL gives **Meena** > The anti-join: users that have no orders.
```

**What happens, step by step:**
1. Asha (id 1) matches orders 10 and 11 → two result rows.
2. Ravi (id 2) matches order 12 → one row.
3. Meena (id 3) matches nothing. INNER drops her; LEFT keeps `(Meena, NULL)`.
4. The anti-join then keeps only rows where the right side is `NULL`: Meena.

**Common mistake → fix:** a condition on the right table in `WHERE` silently turns a LEFT JOIN into an INNER JOIN:
```sql
SELECT u.name, o.total
FROM users u LEFT JOIN orders o ON o.user_id = u.id
WHERE o.status = 'paid';                       -- ❌ Meena's row has o.status NULL → removed
-- ✅ put it in the ON clause to keep unmatched users:
... LEFT JOIN orders o ON o.user_id = u.id AND o.status = 'paid'
```

**Interview answer:** "INNER JOIN returns matching rows only; LEFT keeps all left rows with NULLs where there's no match; FULL OUTER keeps unmatched rows from both sides; CROSS pairs everything. LEFT JOIN plus WHERE right.id IS NULL finds rows with no match. Conditions on the right table belong in ON, otherwise the LEFT JOIN behaves like an INNER JOIN."

**Follow-ups:**
- *How does the database run a join?* Nested loop, hash join or merge join, chosen by the planner based on sizes and indexes (Q15). An index on the join column matters.

---

### Q06. `WHERE` vs `HAVING`, and the logical order of a query

**Short answer:** `WHERE` filters **rows before grouping**; `HAVING` filters **groups after aggregation**. SQL is *written* starting with `SELECT`, but *evaluated* in a different order, and that order explains rules like "you can't use a `SELECT` alias in `WHERE`".

**How it works:** the logical evaluation order is `FROM`/`JOIN`, then `WHERE`, `GROUP BY`, `HAVING`, `SELECT`, `ORDER BY`, `LIMIT`. (The planner may physically execute differently, but the result must behave as if it followed this order.)

```flow
pipeline: Logical order of a SELECT
FROM and JOIN > Build the combined set of rows.
WHERE > Filter individual rows. Aggregates are not allowed here because groups do not exist yet.
GROUP BY > Form the groups.
HAVING > Filter groups. Aggregates are allowed here.
SELECT > Compute the output columns and aliases. This is why a SELECT alias cannot be used in WHERE.
ORDER BY > Sort. Aliases are allowed here because SELECT has already run.
LIMIT > Keep the first n rows.
```

**Example:** customers with more than 3 paid orders this year.
```sql
SELECT user_id, COUNT(*) AS n, SUM(total) AS spend
FROM orders
WHERE status = 'paid' AND created_at >= '2026-01-01'   -- row filter
GROUP BY user_id
HAVING COUNT(*) > 3                                     -- group filter
ORDER BY spend DESC;                                    -- alias allowed here
```

**What happens, step by step:** suppose user 1 has 5 paid orders and 2 cancelled; user 2 has 2 paid orders.
1. `WHERE` removes the cancelled rows (and anything before 2026).
2. `GROUP BY user_id` makes groups: user 1 (5 rows), user 2 (2 rows).
3. `HAVING COUNT(*) > 3` keeps user 1 only.
4. `SELECT` computes `n = 5` and `spend`. `ORDER BY spend DESC` sorts.

**Common mistake → fix:** using a `HAVING` for a plain row condition (`HAVING status = 'paid'`) or an aggregate in `WHERE` (`WHERE COUNT(*) > 3` → error). Row conditions go in `WHERE` (also faster: fewer rows are grouped); aggregate conditions go in `HAVING`.

**Interview answer:** "WHERE filters rows before grouping, HAVING filters groups after aggregation. Logically the order is FROM, WHERE, GROUP BY, HAVING, SELECT, ORDER BY, LIMIT, which is why a SELECT alias can't be used in WHERE but can in ORDER BY."

**Follow-ups:**
- *Is that also the physical order?* No. The planner may reorder as long as results are equivalent, for example pushing filters down before joins.

---

### Q07. Subqueries vs CTEs (`WITH`)

**Short answer:** A **subquery** is a query inside another query. A **CTE (Common Table Expression)** gives an intermediate result a name using `WITH`, so a complex query can be read top to bottom in steps. **Recursive CTEs** can walk hierarchies such as org charts or folder trees. In modern PostgreSQL, a simple CTE is usually inlined into the main query, so performance is about the same as a subquery.

**How it works:**
1. `WITH recent AS (SELECT …)` defines a named temporary result that exists only for this statement.
2. The main query selects from `recent` like a table.
3. Several CTEs can build on each other.
4. `WITH RECURSIVE` has an anchor query (the starting rows) and a recursive part that repeats until no new rows appear.

**Example:**
```sql
WITH recent AS (
  SELECT user_id, SUM(total) AS spend
  FROM orders
  WHERE created_at > now() - interval '30 days'
  GROUP BY user_id
)
SELECT u.name, r.spend
FROM recent r JOIN users u ON u.id = r.user_id
WHERE r.spend > 1000;
```
Recursive example (all reports below manager 1):
```sql
WITH RECURSIVE team AS (
  SELECT id, name, manager_id FROM employees WHERE id = 1
  UNION ALL
  SELECT e.id, e.name, e.manager_id FROM employees e JOIN team t ON e.manager_id = t.id
)
SELECT * FROM team;
```

**What happens, step by step:**
1. `recent` is computed: user 1 spent 1,500 in the last 30 days, user 2 spent 300.
2. The main query joins it to `users` for names.
3. `WHERE r.spend > 1000` keeps only Asha: result `(Asha, 1500)`.
4. In the recursive version: round 1 returns employee 1; round 2 returns people whose `manager_id = 1`; round 3 returns their reports; it stops when a round adds no rows.

**Common mistake → fix:** assuming a CTE is always a separate "optimisation fence" (true before PostgreSQL 12) or always materialised. Since PostgreSQL 12 a non-recursive CTE referenced once is inlined; you can force the old behaviour with `WITH x AS MATERIALIZED (…)` if you need it to run once. Don't use a CTE to "make it faster"; use it to make it readable, and check the plan (Q15).

**Interview answer:** "A CTE names an intermediate result so a complex query reads in steps; a subquery nests it inline. They usually perform the same because modern Postgres inlines simple CTEs. Recursive CTEs are the standard way to walk hierarchies like org charts or folder trees."

**Follow-ups:**
- *Can a CTE contain `INSERT`/`UPDATE`?* Yes in PostgreSQL (data-modifying CTEs with `RETURNING`), handy for "insert and use the new id in the next statement".

---

### Q08. What are window functions?

**Short answer:** A **window function** calculates a value **across a set of related rows without collapsing them** into one row (unlike `GROUP BY`). It is used for ranking, running totals, and "latest row per group". You write `function() OVER (PARTITION BY group ORDER BY sort)`: `PARTITION BY` defines the groups, `ORDER BY` the order inside each group.

**How it works:**
1. Each row keeps its identity; the function looks at the other rows in its partition.
2. `ROW_NUMBER()` numbers rows 1, 2, 3 in the given order (no ties).
3. `RANK()` gives ties the same number and skips the next ones (1, 2, 2, 4); `DENSE_RANK()` doesn't skip (1, 2, 2, 3).
4. `SUM(x) OVER (PARTITION BY g ORDER BY d)` is a running total.
5. `LAG(x)` / `LEAD(x)` read the previous/next row's value.
6. You can't filter on a window function in the same `WHERE`; wrap it in a subquery or CTE.

**Example:**
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

```flow
trace: ROW_NUMBER picks the latest order per user
partition user = Asha, newest first: 05-03 gets rn **1**, 04-20 gets rn 2 > Numbering restarts for each user.
partition user = Ravi: 05-01 gets rn **1** > Each user's newest row gets 1.
WHERE rn = 1 returns Asha 05-03 and Ravi 05-01 > Rows are not collapsed like in GROUP BY, so you keep the full row.
```

**What happens, step by step:** for orders `(Asha, 04-20, 200)`, `(Asha, 05-03, 500)`, `(Ravi, 05-01, 900)`:
1. Partitions: Asha (2 rows), Ravi (1 row).
2. Within Asha, ordered newest first: 05-03 → rn 1, 04-20 → rn 2. Ravi: 05-01 → rn 1.
3. The outer `WHERE rn = 1` keeps `(Asha, 05-03, 500)` and `(Ravi, 05-01, 900)`.
4. The running total for Asha: 04-20 → 200; 05-03 → 700.

| Function | Example with ties | Notes |
|---|---|---|
| `ROW_NUMBER()` | 1,2,3,4 | unique, arbitrary among ties unless ordered fully |
| `RANK()` | 1,2,2,4 | gaps after ties |
| `DENSE_RANK()` | 1,2,2,3 | no gaps; use for "second-highest salary per department" |

**Common mistake → fix:** using `GROUP BY` + `MAX(created_at)` to get "the latest row", then being unable to get the other columns of that row. Use `ROW_NUMBER()` (or `DISTINCT ON (user_id)` in PostgreSQL) to keep the whole row.

**Interview answer:** "Window functions compute across related rows without collapsing them: OVER with PARTITION BY and ORDER BY. I use ROW_NUMBER to pick the latest row per group, RANK or DENSE_RANK for rankings with ties, SUM OVER for running totals and LAG or LEAD to compare with the previous row. Filtering on the result needs a subquery or CTE."

**Follow-ups:**
- *`DISTINCT ON`?* PostgreSQL shorthand: `SELECT DISTINCT ON (user_id) * FROM orders ORDER BY user_id, created_at DESC` returns the first row per user.

---

### Q09. How does `NULL` behave?

**Short answer:** `NULL` means "unknown or missing", not zero or empty text. Any comparison with `NULL` (`= NULL`, `<> NULL`) gives *unknown*, which acts like false in a `WHERE`. So `NULL = NULL` is **not** true: use `IS NULL` / `IS NOT NULL`. Aggregates ignore `NULL`s (`COUNT(col)` skips them, `COUNT(*)` doesn't), and `NOT IN (subquery)` returns nothing if the subquery contains a `NULL`: prefer `NOT EXISTS`.

**How it works:** SQL uses three-valued logic: true, false, unknown. `WHERE` keeps only rows where the condition is **true**. `NULL AND true` is unknown; `NULL OR true` is true. `x NOT IN (1, NULL)` expands to `x <> 1 AND x <> NULL`; the second part is never true, so no row qualifies.

**Example:** `users.phone` is `NULL` for Meena.
```sql
SELECT * FROM users WHERE phone = NULL;        -- ❌ returns 0 rows
SELECT * FROM users WHERE phone IS NULL;       -- ✅ Meena
SELECT COUNT(*), COUNT(phone) FROM users;      -- 3 and 2
SELECT * FROM users WHERE id NOT IN (SELECT user_id FROM orders);
```

```flow
trace: NULL surprises
NULL = NULL is **unknown**, not true > A WHERE clause keeps only rows where the condition is true, so none match. Use IS NULL.
COUNT(*) is 3 but COUNT(phone) is 2 > Aggregates other than COUNT(*) skip NULL values.
x NOT IN (1, NULL) returns **no rows** > Comparing x with NULL is unknown for every row, so nothing is true.
NOT EXISTS behaves as expected > It tests whether a matching row exists and is not confused by NULL.
```

**What happens, step by step:** suppose `orders.user_id` contains `1, 1, 2, NULL` (a guest order).
1. `SELECT … WHERE id NOT IN (1, 1, 2, NULL)`: for user 3, `3 <> 1 AND 3 <> 1 AND 3 <> 2 AND 3 <> NULL` → the last term is unknown, so the whole condition is unknown → user 3 is excluded.
2. Result: zero rows, although Meena (3) has no orders.
3. Rewriting with `NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id)` ignores the `NULL` row and returns Meena.

**Common mistake → fix:** `WHERE status <> 'paid'` and expecting rows with `status IS NULL` to be included. They are not (the comparison is unknown). Use `status IS DISTINCT FROM 'paid'` or `COALESCE(status, '') <> 'paid'`, or better, make the column `NOT NULL` with a default.

**Interview answer:** "NULL means unknown, so comparisons with it are unknown, not true; I use IS NULL. Aggregates skip NULLs except COUNT star. NOT IN with a subquery that returns a NULL matches nothing, so I use NOT EXISTS. And I prefer NOT NULL columns with defaults to avoid three-valued logic surprises."

**Follow-ups:**
- *`COALESCE`?* Returns the first non-NULL argument: `COALESCE(phone, 'n/a')`.

---

### Q10. `DELETE` vs `TRUNCATE` vs `DROP`; `UNION` vs `UNION ALL`

**Short answer:** `DELETE` removes selected rows (it can have a `WHERE`, fires row triggers, and can be rolled back). `TRUNCATE` empties the whole table very quickly. `DROP TABLE` removes the table itself, including its structure and indexes. `UNION` combines two result sets and removes duplicates; `UNION ALL` combines them and keeps everything, which is faster because there's no de-duplication.

**How it works:**

| Statement | Removes | `WHERE`? | Speed on big tables | Notes |
|---|---|---|---|---|
| `DELETE FROM t WHERE …` | chosen rows | yes | slow for many rows (row by row, creates dead rows to clean up) | normal choice |
| `TRUNCATE t` | all rows | no | very fast | in PostgreSQL it is transactional and can be rolled back; takes a strong lock |
| `DROP TABLE t` | table and data | no | fast | schema gone |

**Example:**
```sql
DELETE FROM sessions WHERE expires_at < now();          -- clean expired rows
TRUNCATE TABLE staging_import;                           -- empty a scratch table
DROP TABLE old_reports;                                  -- structure gone too

SELECT email FROM newsletter_users
UNION                                                    -- removes duplicates
SELECT email FROM shop_users;

SELECT order_id FROM paid_orders
UNION ALL                                                -- keeps all rows, no dedup cost
SELECT order_id FROM refunded_orders;
```

**What happens, step by step:**
1. If `asha@x.com` is in both lists, `UNION` returns her once (it sorts or hashes to find duplicates).
2. `UNION ALL` would return her twice and skip that extra work.
3. `DELETE` on 50 million rows takes a long time and leaves 50 million dead row versions for `VACUUM` to clean up (Q23); `TRUNCATE` releases the storage at once.
4. `DROP TABLE old_reports` fails if another table has a foreign key to it unless you add `CASCADE`; be careful, because `CASCADE` removes dependent objects.

**Common mistake → fix:** using `UNION` "just in case" on large results, paying for a sort/hash when duplicates are impossible. Use `UNION ALL` unless you really need de-duplication.

**Interview answer:** "DELETE removes chosen rows and is transactional; TRUNCATE empties the whole table fast; DROP removes the table itself. UNION removes duplicates at the cost of a sort or hash, UNION ALL keeps everything and is cheaper, so I default to UNION ALL when duplicates can't occur or are wanted."

**Follow-ups:**
- *Does `TRUNCATE` reset identity counters?* Only with `TRUNCATE … RESTART IDENTITY`.

---

### Q11. What is an upsert, and why is it safer than check-then-insert?

**Short answer:** An **upsert** is "insert this row, or if it already exists, update it", done as **one atomic statement**. In PostgreSQL it is `INSERT … ON CONFLICT (key) DO UPDATE …`, which requires a unique constraint on the conflict columns. It avoids the race where two requests both check "does it exist?", both see "no", and both insert.

**How it works:**
1. Define a unique constraint or primary key (`job_id`).
2. `ON CONFLICT (job_id) DO UPDATE SET …` tells the database what to do if inserting would violate it.
3. `EXCLUDED` refers to the row you tried to insert.
4. `ON CONFLICT DO NOTHING` skips the insert silently if the key exists (useful for idempotent event handling).
5. The database serialises concurrent attempts on the same key using the unique index.

**Example:**
```sql
INSERT INTO job_status (job_id, status, updated_at)
VALUES ($1, 'RUNNING', now())
ON CONFLICT (job_id) DO UPDATE
SET status = EXCLUDED.status, updated_at = EXCLUDED.updated_at;
```

```flow
sequence: Check-then-insert race vs upsert
actors: Request A, Database, Request B
Request A -> Database: SELECT job 7 and finds nothing
Request B -> Database: SELECT job 7 and finds nothing
Request A -> Database: INSERT job 7 succeeds
Request B -> Database: INSERT job 7 fails with a unique violation
> This is the race. Both requests saw "missing" before either wrote. The fix is one atomic INSERT … ON CONFLICT backed by a unique constraint.
```

**What happens, step by step:**
1. Request A runs the upsert for job 7: no row exists, so the row is inserted with status `RUNNING`.
2. Request B runs the same statement a moment later: the unique index on `job_id` finds the existing row, so instead of failing it runs the `DO UPDATE` part and sets the same status and a newer `updated_at`.
3. Exactly one row exists for job 7 and neither request errors.
4. If both arrive at exactly the same instant, the unique index makes one wait for the other, so the end state is the same.

**Common mistake → fix:** "SELECT then INSERT if missing" in application code, without a unique constraint. Under concurrency you get duplicates (or errors). Add the unique constraint first, then use `ON CONFLICT`; the constraint is the real guard, the upsert makes the handling clean.

**Interview answer:** "An upsert is one atomic statement, INSERT … ON CONFLICT DO UPDATE in Postgres, relying on a unique constraint. It removes the check-then-insert race where two requests both see the row missing and both insert. I use DO NOTHING for idempotent event handling and DO UPDATE when the latest values should win."

**Follow-ups:**
- *Is there a standard SQL version?* `MERGE` is in the SQL standard and in PostgreSQL 15+, but `ON CONFLICT` is the usual choice for simple upserts.

---

## 3. Indexes & query performance

### Q12. What is an index, and how does a B-tree work?

**Short answer:** An **index** is a separate sorted structure that maps column values to row locations, so the database can find rows without reading the whole table, like the index at the back of a book. The default index type is a **B-tree**: a shallow, balanced tree (usually 3 to 4 levels even for millions of rows) that supports fast equality lookups and ordered range scans. The price: every `INSERT`, `UPDATE` and `DELETE` must also update the index, and the index takes space.

**How it works:**
1. The tree has a **root** page, **internal** pages and **leaf** pages. Internal pages hold ranges that tell you which child to follow.
2. Leaf pages hold the sorted key values with pointers to the table rows, and are linked left to right, so a range (`BETWEEN a AND b`) is "find `a`, then walk right until `b`".
3. A lookup reads one page per level: about 3 to 4 page reads, instead of scanning every page of the table.
4. Without an index the database does a **sequential scan** (reads every row). With a suitable index it does an **index scan** (or index-only scan).
5. In PostgreSQL, primary keys and `UNIQUE` constraints create an index automatically; foreign keys do **not**, so index them yourself if you join or delete on them.

**Example:**
```sql
CREATE INDEX idx_orders_user_id ON orders (user_id);

SELECT * FROM orders WHERE user_id = 70;
SELECT * FROM orders WHERE created_at BETWEEN '2026-10-01' AND '2026-10-31';
```

```flow
pipeline: Looking up user_id = 70 in a B-tree index
Root page [50 | 100] > 70 is between 50 and 100, so follow the middle pointer.
Internal page [60 | 70 | 80] > Narrow down to the leaf page that holds 70.
Leaf page > Sorted keys with row pointers. The entry for 70 is found here.
Fetch the table row > About 3 to 4 page reads instead of scanning millions of rows. For a range, walk the linked leaf pages to the end of the range.
```

**What happens, step by step:** `orders` has 5,000,000 rows.
1. Without the index: `WHERE user_id = 70` reads all pages of the table (a sequential scan), maybe 50,000 pages, hundreds of milliseconds or more.
2. With the index: the database walks root, internal, leaf (3 page reads), finds the pointers for the 20 rows of user 70, and reads those rows' pages. Total is a few dozen page reads, often under 1 ms when cached.
3. Insert a new order: the row is added to the table **and** an entry is inserted into the index (and every other index on the table). Ten indexes mean ten extra writes per insert.

**Common mistake → fix:** indexing every column "to be safe". Each extra index slows writes, uses memory and storage, and many are never used. Index the columns that appear in your real `WHERE`, `JOIN` and `ORDER BY`, then check usage (`pg_stat_user_indexes`) and drop the unused ones.

**Interview answer:** "An index is a sorted structure, by default a B-tree, mapping column values to row locations. A lookup walks a shallow tree in a few page reads instead of scanning the table, and range queries walk the linked leaves. The cost is slower writes and extra storage, so I index real query patterns, remember that foreign keys aren't indexed automatically in Postgres, and drop unused indexes."

**Follow-ups:**
- *Other index types in Postgres?* Hash (equality only), GIN (arrays, JSONB, full text), GiST/SP-GiST (geometry, ranges), BRIN (huge, naturally ordered tables).
- *Is an index always faster?* No. For a query that returns most of the table, a sequential scan is cheaper (Q14).

---

### Q13. What are composite indexes and the leftmost-prefix rule?

**Short answer:** A **composite index** covers several columns, such as `(user_id, status, created_at)`. It is sorted by the first column, then by the second within each first-column value, and so on, like a phone book sorted by surname then first name. It helps queries that filter on the **leftmost** columns (`user_id`, or `user_id` + `status`, or all three) but not on later columns alone (`status` alone).

**How it works:**
1. The index entries are ordered by `user_id`; ties are ordered by `status`; ties of those by `created_at`.
2. A query that fixes `user_id` can jump to that section; adding `status` narrows further.
3. Within one `(user_id, status)` section the entries are already sorted by `created_at`, so `ORDER BY created_at DESC LIMIT 20` needs no separate sort.
4. A query on `status` alone can't jump anywhere: the matching entries are scattered across every `user_id` section.
5. **Column order rule of thumb:** equality columns first, then the range or sort column.
6. A **covering index** contains every column the query needs (`INCLUDE (total)`), so PostgreSQL can answer from the index alone (an **index-only scan**) without visiting the table.

**Example:**
```sql
CREATE INDEX idx_orders_user_status_date ON orders (user_id, status, created_at);

SELECT * FROM orders WHERE user_id = 7;                                         -- uses index
SELECT * FROM orders WHERE user_id = 7 AND status = 'paid';                     -- uses index
SELECT * FROM orders WHERE user_id = 7 AND status = 'paid'
ORDER BY created_at DESC LIMIT 20;                                              -- index, no sort
SELECT * FROM orders WHERE status = 'paid';                                     -- cannot use it well

-- covering: also store total in the index so the table isn't touched
CREATE INDEX idx_orders_cover ON orders (user_id, created_at DESC) INCLUDE (total);
```

```flow
trace: Leftmost prefix on the index (user_id, status, created_at)
WHERE user_id = 7 **uses the index** > Like a phone book sorted by surname: you can find the surname quickly.
WHERE user_id = 7 AND status = 'paid' also uses it > Surname plus first name.
Adding ORDER BY created_at DESC LIMIT 20 needs **no extra sort** > Within that prefix the rows are already in created_at order.
WHERE status = 'paid' alone cannot use it well > You cannot skip the first column, like searching a phone book by first name only.
```

**What happens, step by step:** `orders` has 5M rows, user 7 has 400 orders, 30 of them paid.
1. The query `user_id = 7 AND status = 'paid' ORDER BY created_at DESC LIMIT 20` walks to the `(7, 'paid')` section of the index.
2. The entries there are sorted by `created_at`; reading backwards from the end gives the 20 newest immediately.
3. It reads 20 index entries and 20 table rows and stops. No sort step, no scan of the other 399,970 rows.
4. With the index `(status, user_id, created_at)` instead, the same query still works but the index is less useful for queries filtering only on `user_id`. Column order should reflect your most common filters.

**Common mistake → fix:** creating one single-column index per column and expecting the database to combine them as efficiently. It can combine them (bitmap scans), but a single composite index matching the query's equality + sort pattern is far faster. Design composite indexes from your hot queries.

**Interview answer:** "A composite index is sorted by its columns in order, so it helps queries that filter on a leftmost prefix, not on later columns alone. I put equality columns first and the range or sort column last, so the index also provides the ordering and avoids a sort. INCLUDE columns make it covering for index-only scans."

**Follow-ups:**
- *Does the order of conditions in `WHERE` matter?* No; the planner reorders them. The order of columns in the index is what matters.
- *Partial index?* `CREATE INDEX … WHERE status = 'new'` indexes only the rows you query, keeping it small.

---

### Q14. When does the database not use your index?

**Short answer:** The planner skips an index when it can't use it or when it estimates a sequential scan is cheaper. Typical reasons: a **function** or expression on the indexed column, a **leading wildcard** in `LIKE '%abc'`, a **type mismatch** that forces a cast, **low selectivity** (the query returns most of the table), **stale statistics**, or a condition that doesn't match the index's leftmost columns.

**How it works:**
1. An index stores the raw column value. If the query transforms the column (`lower(email)`), the stored value doesn't match, so the index is useless unless it was built on that same expression.
2. A B-tree is sorted from the first character, so `LIKE 'abc%'` can use it but `LIKE '%abc'` can't.
3. The planner estimates costs using statistics. If it expects to read 30% of the rows, jumping around via the index is slower than reading the table in order.
4. `ANALYZE` refreshes the statistics; `autovacuum` does it automatically in the background, but a bulk load can leave them stale.

**Example:**
```sql
SELECT * FROM users WHERE lower(email) = 'asha@x.com';          -- ❌ index on email unused
CREATE INDEX idx_users_email_lower ON users (lower(email));      -- ✅ expression index

SELECT * FROM users WHERE name LIKE '%sha';                       -- ❌ leading wildcard
CREATE EXTENSION pg_trgm;
CREATE INDEX idx_users_name_trgm ON users USING gin (name gin_trgm_ops);   -- ✅ supports it

SELECT * FROM users WHERE is_active = true;                       -- 95% of rows: scan is fine
```

| Cause | Why the index is unusable | Fix |
|---|---|---|
| `WHERE lower(email) = …` | stored values aren't lower-cased | expression index on `lower(email)` |
| `LIKE '%abc'` | can't seek without the first characters | trigram (`pg_trgm`) or full-text index |
| Type mismatch / implicit cast | column is converted for every row | compare with the right type |
| Low selectivity | index would touch most pages | nothing: a scan is the right plan |
| Stale statistics | planner misjudges row counts | `ANALYZE table` |
| `OR` across different columns | one index can't serve both | separate indexes or `UNION` |

**What happens, step by step:**
1. `SELECT … WHERE lower(email) = 'asha@x.com'` on 2M users with only an index on `email`: the planner must compute `lower(email)` for every row → sequential scan, about 400 ms.
2. After creating the expression index, the same query seeks into it → about 0.2 ms.
3. `WHERE is_active = true` matching 1.9M of 2M rows: reading the index and then 1.9M table rows in random order is slower than one sequential pass, so the planner correctly picks the scan.
4. After a bulk import of 10M rows, queries suddenly slow down: the statistics still say the table has 100 rows. `ANALYZE orders;` fixes the estimates and the plan flips back.

**Common mistake → fix:** forcing the issue by disabling scans (`SET enable_seqscan = off`) in production. That hides the real cause and breaks other queries. Find out why with `EXPLAIN` (Q15), then fix the query, index or statistics.

**Interview answer:** "An index is skipped when the query can't match it, like a function on the column, a leading wildcard or a type cast, or when the planner estimates a scan is cheaper because the query returns much of the table. I fix it with expression or trigram indexes, matching types, fresh statistics through ANALYZE, and I confirm with EXPLAIN rather than forcing the planner."

**Follow-ups:**
- *Why might a small table ignore the index?* Reading 3 pages sequentially is cheaper than an index lookup, so for tiny tables a scan is correct.

---

### Q15. How do you read `EXPLAIN ANALYZE`?

**Short answer:** `EXPLAIN` shows the plan the database *would* use; `EXPLAIN ANALYZE` actually **runs** the query and adds real timings and row counts. Read it from the innermost node outward and look for: a **Seq Scan on a big table**, **estimated rows far from actual rows**, a **Sort or Hash that spills to disk**, and a **nested loop over many rows**. The slowest node with the largest actual time is where to fix first.

**How it works:**
1. Each line is a plan node (scan, join, sort) with `cost` (the planner's unit estimate), `rows` (estimated) and, with `ANALYZE`, `actual time` and actual `rows`.
2. Child nodes feed their parents; the top node's actual time is the total.
3. `loops=N` means the node ran N times (multiply time by loops).
4. `Buffers` (with `EXPLAIN (ANALYZE, BUFFERS)`) shows how many pages came from cache or disk.
5. **Warning:** `EXPLAIN ANALYZE` executes the statement, so wrap `INSERT`/`UPDATE`/`DELETE` in a transaction and `ROLLBACK`.

**Example:** before and after adding the index from Q13.
```
EXPLAIN ANALYZE SELECT * FROM orders WHERE user_id = 7 ORDER BY created_at DESC LIMIT 20;

-- Before the index
Limit  (actual time=812.4..812.4 rows=20)
  ->  Sort  (actual time=812.4..812.4 rows=20)  Sort Method: top-N heapsort
        ->  Seq Scan on orders  (actual time=0.1..790.2 rows=400 loops=1)
              Filter: (user_id = 7)   Rows Removed by Filter: 4,999,600

-- After CREATE INDEX ... (user_id, created_at DESC)
Limit  (actual time=0.05..0.09 rows=20)
  ->  Index Scan using idx_orders_user_date on orders  (actual time=0.05..0.08 rows=20)
        Index Cond: (user_id = 7)
```

**What happens, step by step:**
1. The "before" plan scans all 5,000,000 rows (4,999,600 removed by the filter) in about 790 ms, then sorts the 400 matches: total 812 ms.
2. The fix target is the Seq Scan node: it has the biggest time and "Rows Removed by Filter" is huge.
3. After the composite index, the database seeks to user 7, reads backwards 20 entries (already sorted), and returns after 0.09 ms. The Sort node is gone.
4. Check that estimates (`rows=`) are close to actual. If the plan said `rows=1` and actual was `rows=100000`, run `ANALYZE`.

**Common mistake → fix:** running `EXPLAIN ANALYZE` on a tiny dev table and concluding the query is fine. Plans depend on data volume and distribution; check against production-sized data (or a recent copy), and use `pg_stat_statements` to find which queries cost the most in real traffic.

**Interview answer:** "EXPLAIN ANALYZE runs the query and shows the plan with actual times and row counts. I look for the slowest node, sequential scans on big tables, estimates far from actuals, sorts or hashes spilling to disk and nested loops over many rows. Then I fix the index, query or statistics and re-run to confirm. For writes I wrap it in a transaction and roll back."

**Follow-ups:**
- *How do you find slow queries in the first place?* `pg_stat_statements` (top queries by total time), the slow-query log and APM traces.

---

### Q16. What is the N+1 query problem?

**Short answer:** N+1 happens when you load a list with **1** query and then run **1 more query per item** (N queries) to fetch related data. It's invisible with 5 rows and a disaster with 500, because each query costs a network round trip. Fix it by fetching the related data in bulk: a `JOIN`, or a second query with `WHERE id IN (…)` (eager loading).

**How it works:**
1. ORMs (Object-Relational Mappers such as SQLAlchemy) load relationships **lazily**: `order.user` runs a query the first time you touch it.
2. In a loop over 100 orders, that's 100 extra queries.
3. Each query has overhead (round trip, parsing, locking a pooled connection), so 101 queries of 1 ms is 100+ ms, and it multiplies across concurrent users.
4. Eager loading (`selectinload`, `joinedload`) fetches all related rows in one extra query (or one joined query).
5. The same pattern exists in APIs: calling a service once per item instead of one batch call.

**Example:**
```python
# ❌ N+1: 1 query for orders + 1 query per order for its user
orders = session.scalars(select(Order).limit(100)).all()
for o in orders:
    print(o.user.name)               # lazy load → 100 extra queries

# ✅ 2 queries total, however many orders
orders = session.scalars(
    select(Order).options(selectinload(Order.user)).limit(100)
).all()
```

```flow
sequence: N+1 queries vs eager loading
actors: App, Database
App -> Database: SELECT * FROM orders LIMIT 100
App -> Database: SELECT * FROM users WHERE id = 1
App -> Database: SELECT * FROM users WHERE id = 2, repeated for each of the 100 orders
> That is 101 round trips: fine for 5 rows, terrible for 500.
App -> Database: FIX: SELECT * FROM users WHERE id IN (the 100 user ids)
> selectinload needs 2 queries in total, whatever the page size.
```

**What happens, step by step:**
1. The first query returns 100 orders in 2 ms.
2. In the ❌ version, the loop runs `SELECT … FROM users WHERE id = ?` 100 times at about 1.5 ms each: 150 ms of mostly waiting.
3. In the ✅ version, `selectinload` collects the distinct `user_id` values (say 60 users) and runs one `WHERE id IN (…60 ids…)` query: about 3 ms.
4. Total drops from about 152 ms to about 5 ms, and the database sees 2 queries instead of 101.

**Common mistake → fix:** noticing N+1 only in production load. Catch it early: log queries per request in tests, assert a maximum query count, and use APM traces: many identical queries with different parameters inside one request is the signature.

**Interview answer:** "N+1 is one query for a list plus one query per item for related data. It's caused by lazy loading in ORMs or per-item service calls, and it multiplies round trips. I fix it with eager loading, either a join or an IN query via selectinload, or a batch endpoint, and I detect it by counting queries per request in tests and tracing."

**Follow-ups:**
- *`joinedload` or `selectinload`?* `joinedload` duplicates parent columns for each child row (fine for many-to-one); `selectinload` runs a second query and is better for one-to-many collections.

---

### Q17. How do OFFSET and keyset (cursor) pagination differ?

**Short answer:** `OFFSET 100000 LIMIT 20` makes the database find and **throw away** 100,000 rows before returning 20, so deep pages are slow, and rows shift if data is inserted meanwhile (you can see an item twice or miss one). **Keyset pagination** remembers the last row's sort key and continues from it with an index (`WHERE (created_at, id) < (last_ts, last_id)`), so every page costs about the same and the position is stable.

**How it works:**
1. Offset: the database walks `offset + limit` rows in order and discards the first `offset`.
2. Keyset: the first page is a normal `ORDER BY … LIMIT 20`. Remember the last row's `(created_at, id)`. The next page adds `WHERE (created_at, id) < (:last_created_at, :last_id)` and uses the same ordering.
3. The index `(user_id, created_at DESC, id DESC)` lets the database seek straight to the starting position.
4. A unique **tie-breaker** (`id`) is required so rows with equal timestamps are neither repeated nor skipped.
5. Trade-off: you can go "next/previous" but cannot jump to "page 5,000".

**Example:**
```sql
-- page 1
SELECT * FROM orders WHERE user_id = 7
ORDER BY created_at DESC, id DESC LIMIT 20;

-- next page: pass the last row's (created_at, id) back as an opaque cursor
SELECT * FROM orders
WHERE user_id = 7 AND (created_at, id) < ($1, $2)
ORDER BY created_at DESC, id DESC LIMIT 20;
```

```flow
trace: OFFSET vs keyset at page 5,000
OFFSET 100000 LIMIT 20 reads **100,020 rows** and discards 100,000 > It gets slower with every page you go deeper.
meanwhile 10 new orders are inserted at the top > Every position shifts by 10, so page 5,001 repeats 10 rows from page 5,000.
keyset WHERE (created_at, id) < last seen LIMIT 20 reads **20 rows** > The index seeks straight to the position.
stable while data changes > The cursor is a position in the data, not a count of rows.
```

**What happens, step by step:**
1. User opens page 1: rows 1 to 20, the last is `(2026-10-20 10:00:00, id 9812)`.
2. Offset version for page 2: `OFFSET 20 LIMIT 20`; if 3 orders arrive before the click, rows shift and the user sees three items again.
3. Keyset version for page 2: `WHERE (created_at, id) < ('2026-10-20 10:00:00', 9812)` → the next 20 older rows, no matter what was added at the top.
4. Page 5,000 costs the same as page 2: an index seek plus 20 rows.

**Common mistake → fix:** keyset on a non-unique column alone (`WHERE created_at < :last`). Two orders with the same timestamp straddling a page boundary get skipped. Always add a unique tie-breaker to both the `ORDER BY` and the cursor condition.

**Interview answer:** "OFFSET reads and discards all earlier rows, so deep pages are slow, and it's unstable when data changes. Keyset pagination uses the last row's sort key with an index to continue from that position, so each page costs the same and doesn't skip or repeat rows. I use a unique tie-breaker like id and return an opaque cursor; the trade-off is no jumping to arbitrary page numbers."

**Follow-ups:**
- *Do you still need `COUNT(*)` for "page X of Y"?* Counting big tables is slow; show "has more" or an estimate instead.

---

## 4. Transactions, isolation & locking

### Q18. What is a transaction, and what does ACID mean?

**Short answer:** A **transaction** groups several statements into one unit of work: `BEGIN`, run the statements, then `COMMIT` to make all changes permanent, or `ROLLBACK` to undo all of them. **ACID** describes the guarantees: **Atomicity** (all or nothing), **Consistency** (constraints still hold afterwards), **Isolation** (concurrent transactions don't see each other's half-finished work, to a chosen degree) and **Durability** (committed data survives a crash).

**How it works:**
1. `BEGIN` starts the transaction; changes are visible only to it until commit.
2. If anything fails, or you `ROLLBACK`, the database discards the changes.
3. `COMMIT` first flushes the change to the **write-ahead log (WAL)** on disk, and only then reports success. After a crash the database replays the log, so committed changes are not lost (durability).
4. Constraints (`CHECK`, foreign keys) are verified, and a violation aborts the transaction (consistency).
5. In PostgreSQL every statement outside an explicit transaction is its own tiny transaction (autocommit).

| Letter | Meaning | Example |
|---|---|---|
| **A**tomicity | all statements commit or none | debit and credit both happen or neither |
| **C**onsistency | rules hold after commit | `CHECK (balance >= 0)` blocks an overdraft |
| **I**solation | concurrent transactions don't interfere (Q20) | one transfer can't see another's half-done state |
| **D**urability | committed means it survives a crash | WAL flushed before "COMMIT" returns |

**Example:**
```sql
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 'A';
UPDATE accounts SET balance = balance + 100 WHERE id = 'B';
COMMIT;
```
```python
async with session.begin():                 # BEGIN … COMMIT, or ROLLBACK on exception
    await debit(session, "A", 100)
    await credit(session, "B", 100)         # an exception here undoes the debit too
```

```flow
sequence: A money transfer inside one transaction
actors: App, Database, WAL
App -> Database: BEGIN
App -> Database: UPDATE accounts SET balance = balance - 100 WHERE id = A
App -> Database: UPDATE accounts SET balance = balance + 100 WHERE id = B
App -> Database: COMMIT
Database -> WAL: flush the log record to disk before answering
Database --> App: committed, both updates are visible together
> If the server crashed after the first UPDATE but before COMMIT, neither change would survive. After COMMIT, both survive a crash.
```

**What happens, step by step:** accounts A = 500 and B = 100.
1. After `BEGIN`, the first `UPDATE` sets A to 400 (visible only inside this transaction).
2. The second `UPDATE` sets B to 200.
3. `COMMIT` writes the WAL record to disk; only then does the database answer "OK". Now other sessions see A = 400, B = 200.
4. If the second `UPDATE` had failed (say B doesn't exist, or a `CHECK` failed), the transaction aborts and A returns to 500: no money disappears.

**Common mistake → fix:** doing two related writes in separate autocommitted statements (or separate sessions), so a failure in between leaves half the work done (money debited, never credited). Wrap related writes in one transaction. Also remember a transaction covers only one database: it can't include an S3 upload or a queue message (Q24).

**Interview answer:** "A transaction bundles statements so they commit or roll back together. ACID is atomicity, all or nothing; consistency, constraints hold; isolation, concurrent transactions don't see each other's partial work; and durability, committed data survives crashes because the write-ahead log is flushed before commit returns. I put related writes in one transaction and keep it short."

**Follow-ups:**
- *What does the WAL do for performance?* Appending to a log is a sequential write, cheaper than updating many table pages immediately; the table pages are written later in the background.

---

### Q19. What is MVCC, and how does PostgreSQL let readers and writers coexist?

**Short answer:** **MVCC (Multi-Version Concurrency Control)** means PostgreSQL keeps **multiple versions of a row** instead of overwriting it in place. An `UPDATE` creates a new row version and marks the old one as ended; each transaction sees the versions that were committed as of its snapshot. As a result **readers don't block writers and writers don't block readers**. Old, no-longer-visible versions are cleaned up later by **VACUUM**.

**How it works:**
1. Every row version carries the transaction IDs that created and (if any) deleted it.
2. A transaction's snapshot defines which transaction IDs count as committed. In Read Committed each *statement* takes a fresh snapshot; in Repeatable Read the snapshot is taken once at the first statement.
3. `UPDATE` = mark the old version deleted + insert a new version. `DELETE` = mark deleted.
4. Rows nobody can see any more are **dead tuples**. **VACUUM** (run automatically by autovacuum) reclaims their space for reuse.
5. A long-running transaction keeps old snapshots alive, so VACUUM can't remove versions it might still need (Q23).

**Example:**
```sql
-- Session 1
BEGIN;
UPDATE accounts SET balance = 400 WHERE id = 'A';     -- creates a new row version (not yet committed)

-- Session 2 (meanwhile)
SELECT balance FROM accounts WHERE id = 'A';           -- returns 500, is not blocked

-- Session 1
COMMIT;

-- Session 2
SELECT balance FROM accounts WHERE id = 'A';           -- now returns 400
```

**What happens, step by step:**
1. Row A is version v1 (balance 500).
2. Session 1 updates it: PostgreSQL creates v2 (balance 400) and marks v1 as superseded by this transaction. v2 is invisible to others until commit.
3. Session 2's read sees v1 (still the latest committed version) and isn't blocked.
4. After commit, new snapshots see v2. v1 becomes a dead tuple once no transaction can still need it, and autovacuum later frees its space.
5. Two sessions trying to `UPDATE` the *same* row do still conflict: the second waits for the first to finish (Q21).

**Common mistake → fix:** assuming `UPDATE` rewrites rows in place and so is "free". Heavy updates create many dead tuples; if VACUUM falls behind (often because of long transactions), tables and indexes **bloat** and queries slow down. Keep transactions short, keep autovacuum healthy, and avoid updating a row more often than necessary.

**Interview answer:** "PostgreSQL uses MVCC: an update writes a new row version and keeps the old one, and each transaction reads the versions visible to its snapshot, so readers don't block writers. Dead versions are cleaned up by VACUUM, and long transactions delay that cleanup and cause bloat. Writers to the same row still wait for each other."

**Follow-ups:**
- *Is MVCC unique to Postgres?* No; MySQL InnoDB, Oracle and others use it too, with different implementation details (undo logs instead of in-table old versions).

---

### Q20. What are isolation levels, and which anomalies do they prevent?

**Short answer:** **Isolation** controls what a transaction can see of other transactions running at the same time. Stronger levels prevent more **anomalies** (surprising results) but cost more blocking or retries. PostgreSQL's default is **Read Committed**; **Repeatable Read** gives each transaction a stable snapshot; **Serializable** makes the result equal to running transactions one at a time, and may abort one with a **serialization failure** that your code must retry.

**How it works:**

| Anomaly | What happens |
|---|---|
| Dirty read | you read another transaction's **uncommitted** change, which then rolls back |
| Non-repeatable read | you read a row twice in one transaction and get different values |
| Phantom read | you re-run a range query and **new rows** appear |
| Lost update | two transactions read the same value, both write; one write disappears |
| Write skew | two transactions each check a rule, then update different rows, together breaking the rule |

| Level | Prevents | Notes |
|---|---|---|
| Read Uncommitted | (PostgreSQL treats it as Read Committed) | never shows uncommitted data in Postgres |
| **Read Committed** (default) | dirty reads | each statement sees what was committed when it began |
| **Repeatable Read** | + non-repeatable reads and phantoms (snapshot taken at first statement) | may fail with `40001`, retry the transaction |
| **Serializable** | everything: as if one at a time | may fail with `40001`; retry the **whole** transaction |

Defaults differ: PostgreSQL, Oracle and SQL Server default to Read Committed; MySQL InnoDB defaults to Repeatable Read.

**Example:** a lost update under Read Committed (two agents increment a ticket counter).
```sql
-- both sessions
SELECT count FROM tickets WHERE id = 1;           -- both read 5
-- T1:
UPDATE tickets SET count = 6 WHERE id = 1;
-- T2 (after T1 commits):
UPDATE tickets SET count = 6 WHERE id = 1;        -- overwrites with its own 5+1: one increment lost
```

```flow
sequence: A lost update under Read Committed
actors: T1, Row count, T2
T1 -> Row count: SELECT count and gets 5
T2 -> Row count: SELECT count and gets 5
T1 -> Row count: UPDATE count = 6
T2 -> Row count: UPDATE count = 6
> Both calculated 5 + 1 from the same old value, so one increment is lost. Fixes: UPDATE count = count + 1, SELECT … FOR UPDATE, a version check, or Serializable with retries.
```

**What happens, step by step:**
1. T1 and T2 each read `count = 5` into the application.
2. T1 writes 6 and commits. T2 then writes 6 (its own `5 + 1`) and commits. The final value is 6, but two increments happened: it should be 7.
3. Fix A: `UPDATE tickets SET count = count + 1 WHERE id = 1` runs the read and write as one atomic statement. T2 waits for T1's row lock, then re-reads the committed 6 and sets 7.
4. Fix B: `SELECT … FOR UPDATE` first (T2 waits and then reads 6). Fix C: Serializable detects the conflict, aborts one transaction with `40001` and you retry it.

**Common mistake → fix:** switching to Serializable but not handling `40001`, so users see random 500 errors. Under Repeatable Read or Serializable the application **must** catch serialization failures (SQLSTATE `40001`) and retry the entire transaction from `BEGIN`. Deadlocks (`40P01`) should be retried the same way.

**Interview answer:** "Isolation levels trade correctness against concurrency. PostgreSQL defaults to Read Committed, where each statement sees committed data, which prevents dirty reads but allows lost updates and non-repeatable reads. Repeatable Read gives a stable snapshot and Serializable gives results equal to a serial order, but both can abort with serialization failure 40001 and my code must retry the whole transaction. For simple counters I use atomic updates or row locks instead."

**Follow-ups:**
- *What is write skew?* Two doctors both check "at least 2 on call" and both go off call: each updated a different row. Only Serializable (or an explicit lock on a shared row) prevents it.

---

### Q21. What are row locks, `SELECT … FOR UPDATE`, and deadlocks?

**Short answer:** When a transaction changes a row, it takes a **row lock** that other writers must wait for until it commits or rolls back. `SELECT … FOR UPDATE` takes that lock on rows you only read, so nobody can change them before you write. A **deadlock** is two transactions each waiting for a lock the other holds; PostgreSQL detects it (after `deadlock_timeout`, 1 second by default) and aborts one with error `40P01` ("deadlock detected"). Avoid deadlocks by locking rows in a consistent order and keeping transactions short.

**How it works:**
1. `UPDATE`/`DELETE` lock the affected rows automatically.
2. `SELECT … FOR UPDATE` locks the selected rows for update; `FOR SHARE` blocks writers but allows other readers-with-share.
3. `FOR UPDATE SKIP LOCKED` skips rows locked by others instead of waiting: perfect for job queues where many workers each grab different pending jobs.
4. `NOWAIT` fails immediately if the row is locked.
5. A deadlock needs a cycle: T1 holds A and wants B; T2 holds B and wants A. The victim is rolled back; the other proceeds.

**Example:**
```sql
-- worker claims up to 10 pending jobs without blocking other workers
BEGIN;
SELECT id FROM jobs WHERE status = 'PENDING'
ORDER BY created_at LIMIT 10
FOR UPDATE SKIP LOCKED;
-- … UPDATE jobs SET status = 'RUNNING' WHERE id = ANY(:ids); COMMIT;
```

```flow
sequence: How a deadlock happens
actors: T1, Account A, Account B, T2
T1 -> Account A: UPDATE takes the lock on A
T2 -> Account B: UPDATE takes the lock on B
T1 -> Account B: wants B and waits for T2
T2 -> Account A: wants A and waits for T1
> Each transaction waits for the other, so neither can ever continue. This is a deadlock.
T2 --> T2: the database detects the cycle and aborts T2 with deadlock detected (40P01)
> Fixes: lock rows in the same order everywhere (for example ascending id), keep transactions short, and retry the aborted transaction.
```

**What happens, step by step:** transfers A to B and B to A at the same time.
1. T1 (A to B) updates A first; T2 (B to A) updates B first.
2. T1 then needs B, which T2 holds, so it waits. T2 needs A, held by T1, so it waits.
3. After about 1 second PostgreSQL finds the cycle and aborts one (say T2): `ERROR: deadlock detected`. T1 proceeds and commits.
4. The application retries T2 and it succeeds. With a fixed order ("always lock the lower account id first"), T2 would simply have waited for T1 from the start, and no deadlock could occur.

**Common mistake → fix:** treating "deadlock detected" as a database bug. It is a design issue in the application: two code paths locking the same rows in different orders. Sort the rows by key before updating, update fewer rows per transaction, index the `WHERE` columns so fewer rows are locked, and add retry-with-backoff for `40P01`.

**Interview answer:** "Writes take row locks held until commit. SELECT FOR UPDATE locks rows I read so I can safely update them, and SKIP LOCKED lets many workers pull different jobs from one table. A deadlock is a cycle of lock waits; Postgres aborts one transaction with 40P01. I prevent them by locking in a consistent order, keeping transactions short and small, and I retry the victim."

**Follow-ups:**
- *Do plain `SELECT`s take locks?* No; thanks to MVCC they just read a snapshot.
- *Advisory locks?* Application-defined named locks (`pg_advisory_lock`) for coordination such as "only one worker runs this job".

---

### Q22. What is the difference between pessimistic and optimistic concurrency?

**Short answer:** **Pessimistic** concurrency assumes conflicts are likely, so it **locks first** (`SELECT … FOR UPDATE`) and others wait. **Optimistic** concurrency assumes conflicts are rare: it takes no lock, but adds a **version number** to the row and makes the update conditional (`WHERE version = n`). If someone else saved first, the update affects 0 rows, and you tell the user or retry. Choose pessimistic for short, hot, contended operations; optimistic where users read, think for a while, then save (forms, editors).

**How it works:**

| | Pessimistic | Optimistic |
|---|---|---|
| How | lock rows before changing them | no lock; compare a `version` column when updating |
| Best when | conflicts frequent, transactions short | conflicts rare, there is user think-time between read and write |
| Failure mode | waiting, deadlocks, lock timeouts | update matches 0 rows, so reload or retry |
| Holds a lock during user think-time? | would be terrible, never do this | no |

**Example:**
```sql
UPDATE documents
SET body = $1, version = version + 1
WHERE id = $2 AND version = $3;          -- 0 rows updated means someone else saved first
```
```python
result = await session.execute(
    update(Document).where(Document.id == doc_id, Document.version == expected)
    .values(body=new_body, version=Document.version + 1))
if result.rowcount == 0:
    raise HTTPException(409, "Document changed since you loaded it")
```

**What happens, step by step:** two editors open document 9 at version 4.
1. Alice saves: `WHERE id = 9 AND version = 4` matches; the row becomes version 5. `rowcount = 1`.
2. Bob saves with `version = 4`: the row is already version 5, so zero rows match. `rowcount = 0` → the API returns `409 Conflict` (or `412` with ETags).
3. Bob's UI reloads version 5, shows the differences, and he saves again with `version = 5` → success, version 6.
4. With the pessimistic alternative, Alice would hold a row lock while editing for 10 minutes and Bob (and other writes) would be blocked. That is why it is only used for short operations like "decrement stock".

**Common mistake → fix:** doing the version check in application code (`if row.version == expected: …`) in one statement and the update in another. A change can slip in between. The check and the write must be the same `UPDATE … WHERE version = :expected`.

**Interview answer:** "Pessimistic locks the row first with SELECT FOR UPDATE and suits short, contended operations. Optimistic uses a version column and an UPDATE that only succeeds if the version still matches; zero rows updated means a conflict, which I return as 409 or 412 so the client reloads. It's the database side of HTTP ETags and fits UIs where users take time between reading and saving."

**Follow-ups:**
- *Alternative to a version column?* A `updated_at` timestamp works but is less precise; a version integer or hash is safer.

---

### Q23. Why are long transactions dangerous?

**Short answer:** A transaction that stays open for a long time holds its **locks** (blocking other writers), keeps an **old snapshot** that stops PostgreSQL's **VACUUM** from removing dead row versions (causing bloat), holds a **connection** from a limited pool, and can delay replicas. Never call an LLM, an HTTP API, or wait for a human inside a database transaction. Do the slow work first, then open a short transaction to write.

**How it works:**
1. Locks taken by `UPDATE` and `FOR UPDATE` are held until `COMMIT`/`ROLLBACK`.
2. VACUUM can only remove a dead row version if **no** open transaction could still need to see it. One transaction open for an hour pins everything that died since it started.
3. Dead tuples accumulate: tables and indexes grow (**bloat**), scans get slower, disk usage rises.
4. A connection stuck "idle in transaction" is wasted pool capacity; enough of them and new requests can't get a connection.
5. Settings that protect you: `statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout`.

**Example:** the dangerous pattern and the safe one.
```python
# ❌ lock held for the whole LLM call
async with session.begin():
    order = await session.get(Order, 7, with_for_update=True)     # row lock taken
    summary = await llm.summarise(order.notes)                    # 20 seconds
    order.summary = summary

# ✅ read, release, slow work, short write with a version check
order = await session.get(Order, 7)                               # short read
summary = await llm.summarise(order.notes)                        # no lock, no open transaction
async with session.begin():
    res = await session.execute(update(Order).where(Order.id == 7, Order.version == order.version)
                                .values(summary=summary, version=Order.version + 1))
    if res.rowcount == 0: raise Conflict()
```

```flow
trace: One long transaction hurts everyone
BEGIN; UPDATE order 7 (row lock taken) > Fine so far.
the app calls an LLM for 20 s inside the transaction > The lock and the connection are held the whole time.
other requests touching order 7 are **blocked for 20 s** > Timeouts pile up, and the pool runs out of connections.
VACUUM cannot remove row versions newer than this transaction's start > Dead tuples accumulate and the table bloats.
fix: read, commit, do the slow work, then a short write with a version check > Never wait for networks or people inside a transaction.
```

**What happens, step by step:**
1. At 10:00:00 the transaction locks order 7 and starts a 20 s LLM call.
2. At 10:00:03 another request tries to update order 7 and waits; so do 40 more by 10:00:15, each holding a pooled connection.
3. The pool (size 20) is now exhausted: unrelated requests get "timeout waiting for connection".
4. At 10:00:20 the call returns, the transaction commits, and the queue drains, but users already saw errors.
5. With the safe pattern, the lock lasts a few milliseconds.

**Common mistake → fix:** leaving a transaction open across a user prompt or an `await` on an external service. Use `idle_in_transaction_session_timeout` (for example 30 s) as a safety net, and structure code as read → compute → short write.

**Interview answer:** "Long transactions hold locks, block writers, tie up pooled connections, and keep old snapshots alive so VACUUM can't clean dead rows, which bloats tables. I never call external services or wait for users inside a transaction: I read, release, do the slow work, then write in a short transaction with an optimistic version check, and I set statement, lock and idle-in-transaction timeouts as guardrails."

**Follow-ups:**
- *How do you find them?* Query `pg_stat_activity` for rows with `state = 'idle in transaction'` or old `xact_start`.

---

### Q24. How do you keep data consistent across services when there's no distributed transaction?

**Short answer:** One ACID transaction covers one database. You can't make "update the database **and** publish a message **and** upload to S3" atomic. Use the **transactional outbox**: write the event to an `outbox` table in the **same** database transaction as the business change, and let a separate relay publish pending rows to the queue and mark them sent. Consumers must be **idempotent** (safe to run twice), because delivery is at least once. For multi-step business flows use a **saga**: a series of local transactions with compensating actions if a later step fails.

**How it works:**
1. In one transaction: update the order and insert an outbox row `(id, event_type, payload, sent = false)`. Both commit or neither.
2. A relay process (or change-data-capture) reads unsent rows, publishes them to the queue, then marks them sent.
3. If the relay crashes after publishing but before marking, it publishes again later: duplicates are possible, so consumers deduplicate by event ID.
4. **Saga:** Order service reserves stock, then charges payment; if payment fails, a compensating step releases the stock. There is no global rollback; each service undoes its own work.

**Example:**
```sql
BEGIN;
UPDATE orders SET status = 'PAID' WHERE id = 42;
INSERT INTO outbox (id, topic, payload) VALUES (gen_random_uuid(), 'order.paid', '{"order_id": 42}');
COMMIT;
```

```flow
sequence: Database change plus event without a distributed transaction
actors: Service, Database, Relay, Queue
Service -> Database: one transaction updates order 42 and inserts an outbox row
Relay -> Database: read unsent outbox rows
Relay -> Queue: publish event order.paid for order 42
Relay -> Database: mark the outbox row as sent
> If publishing fails, the row stays unsent and the relay retries later. Consumers deduplicate by event id because delivery is at least once.
```

**What happens, step by step:**
1. The service marks order 42 `PAID` and inserts the outbox row in one transaction. If the process crashes before commit, neither exists.
2. The relay finds the unsent row and publishes `order.paid` to the queue.
3. The relay crashes before marking it sent. On restart it publishes the same event again.
4. The consumer (shipping service) sees event id `e-17` twice; it records processed IDs, so it ships once.
5. Without the outbox (update database, then publish), a crash between the two steps loses the event forever: the order is paid but nothing ships.

**Common mistake → fix:** "update the database, then send the message" in sequence, assuming both succeed. A crash in between leaves the systems inconsistent. Use the outbox, and make consumers idempotent (unique constraint on event ID or an upsert).

**Interview answer:** "A database transaction can't include a queue or another service. I use the transactional outbox: write the event row in the same transaction as the change, and a relay publishes it with retries. Delivery is at least once, so consumers dedupe by event id. For multi-service workflows I use sagas with compensating actions instead of trying for a distributed transaction."

**Follow-ups:**
- *Two-phase commit?* Exists (`PREPARE TRANSACTION`) but is rarely used across services because of blocking and operational risk.

---

## 5. Schema design & scaling relational databases

### Q25. How do you choose column data types in PostgreSQL?

**Short answer:** Pick the most specific type that fits, because the type is your first line of validation and affects storage and index speed. Use `bigint` (or `uuid`) for IDs, `numeric(12,2)` for money, `timestamptz` for points in time, `text` for strings, `boolean` for flags, `jsonb` for genuinely flexible documents, and enums or `CHECK` constraints for fixed sets of values. Never use floating point for money.

**How it works:**

| Need | Use | Why |
|---|---|---|
| Whole numbers | `integer` (about ±2.1 billion), `bigint` (about ±9.2 × 10^18) | pick `bigint` for IDs that may grow |
| Money, exact decimals | `numeric(12,2)` (or integer cents) | `real`/`double precision` give rounding errors |
| Timestamps | `timestamptz` | stores an absolute instant (UTC internally) and shows it in the session time zone |
| Text | `text` | in PostgreSQL `text` and `varchar(n)` perform the same; use `CHECK (length(x) <= n)` if you need a limit |
| True/false | `boolean` | not `0/1` or `'Y'/'N'` |
| Flexible nested data | `jsonb` | indexable with GIN; but you lose type checks and foreign keys on inner fields |
| Fixed set of values | `text` + `CHECK`, or an enum type | keeps junk out |
| Unique identifiers | `uuid` | generated outside the database or with `uuidv7()` (PostgreSQL 18) |

**Example:**
```sql
CREATE TABLE payments (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),         -- PostgreSQL 18; time-ordered
  order_id   bigint NOT NULL REFERENCES orders (id),
  amount     numeric(12,2) NOT NULL CHECK (amount > 0),
  currency   char(3) NOT NULL,
  status     text NOT NULL CHECK (status IN ('pending','paid','failed','refunded')),
  meta       jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
```

**What happens, step by step:**
1. `SELECT 0.1::float + 0.2::float` returns `0.30000000000000004`; `SELECT 0.1::numeric + 0.2::numeric` returns exactly `0.3`. Totals of money columns would drift with floats.
2. Inserting `amount = -5` fails the `CHECK`. Inserting `status = 'payed'` (typo) fails the `CHECK` instead of silently storing junk.
3. `created_at` set from a server in Mumbai (`'2026-10-27 10:00:00+05:30'`) and read from London is the same instant, shown as `05:30:00+00`. With `timestamp` (no time zone) the offset would be lost and meanings would differ per client.
4. Searching `meta @> '{"channel":"web"}'` is fast with a GIN index; but a field you filter on constantly should be a real column.

**Common mistake → fix:** using `timestamp without time zone` and storing local times, then having daylight-saving or multi-region bugs. Store `timestamptz`, convert for display in the application. Another: putting everything into one `jsonb` column "to stay flexible", which pushes validation and joins into application code. Use columns for the stable core and `jsonb` for truly variable extras.

**Interview answer:** "I choose the most specific type: bigint or uuid for keys, numeric for money, never floats; timestamptz for instants; text with CHECK constraints for limits and fixed values; boolean for flags; and jsonb only for genuinely variable data. The types and constraints are my first line of defence against bad data."

**Follow-ups:**
- *Why not `serial`?* `GENERATED … AS IDENTITY` is the modern standard replacement for `serial`.

---

### Q26. What are normalisation and denormalisation?

**Short answer:** **Normalisation** means storing each fact **once**, so an update changes one place and the copies can't disagree. **Denormalisation** means deliberately **copying** data to make reads faster or simpler, accepting that you must keep the copies in sync. Start roughly normalised (3NF) for transactional systems; denormalise specific hot read paths with read models, materialised views or caches.

**How it works:**
- **1NF:** each column holds one atomic value, no repeating groups (no `tags = 'a,b,c'` column; use a separate table).
- **2NF:** every non-key column depends on the whole primary key (matters for composite keys).
- **3NF:** non-key columns depend only on the key, not on each other (don't store `customer_city` in `orders`; it depends on the customer).
- Normalising causes **joins** at read time; denormalising removes joins at the price of **update anomalies**: change in one place, forget another.

**Example:**
```
Unnormalised: orders(id, customer_name, customer_city, product1, product2)
    problems: customer data repeated; product1/product2 repeating group

Normalised:   customers(id, name, city)
              orders(id, customer_id → customers.id)
              order_items(order_id → orders.id, product_id → products.id, qty)
```

```flow
trace: Normalising an orders table
orders(id, customer_name, customer_city, product1, product2) > Repeated columns and duplicated customer data.
1NF: one product per row in order_items(order_id, product_id) > No repeating groups.
3NF: customers(id, name, city) and orders(customer_id) > The city is stored once, so a move updates one row.
denormalise on purpose for hot reads > A read model, a materialised view or a cache, refreshed from the source of truth.
```

**What happens, step by step:**
1. In the unnormalised table, customer Asha moves from Pune to Mumbai. You must update every one of her 120 order rows; if one update fails or a row is missed, the data contradicts itself.
2. In the normalised design, you update one `customers` row; every order shows the new city through the join.
3. The "orders per city" report now needs a join, which is cheap with the right indexes.
4. If a dashboard runs that report 1,000 times a second, you might add a `city_order_counts` materialised view refreshed every minute: a deliberate denormalisation.

**Common mistake → fix:** denormalising early "for speed" without measuring. You pay with consistency bugs and complexity before you have a performance problem. Normalise first, measure with `EXPLAIN` (Q15), then denormalise specific queries, and keep a single source of truth.

**Interview answer:** "Normalisation stores each fact once to avoid update anomalies; denormalisation copies data deliberately to speed up reads. I model transactional data in about third normal form, then add materialised views, read models or caches for measured hot paths, and I always know which copy is the source of truth and how copies are refreshed."

**Follow-ups:**
- *Does DynamoDB follow this?* No; DynamoDB designs are denormalised by default because there are no joins (Q36).

---

### Q27. What are keys and constraints?

**Short answer:** **Constraints** are rules the database enforces on every write: `PRIMARY KEY` (unique, non-null identity), `FOREIGN KEY` (the referenced row must exist), `UNIQUE` (no duplicates), `NOT NULL`, and `CHECK` (a custom condition). They are the **last line of defence**: application code can have bugs and race conditions, but the database will refuse invalid data regardless of which service writes it.

**How it works:**
1. **Primary key:** one per table. Use a surrogate key (`bigint` identity or `uuid`) so the key never needs to change. Random UUIDv4 values scatter inserts across the B-tree (more page splits, worse cache use); **time-ordered UUIDv7** values (built in as `uuidv7()` from PostgreSQL 18) append mostly at the end, so they behave like sequential keys.
2. **Foreign key:** `REFERENCES parent (id)`, with `ON DELETE` behaviour: `RESTRICT`/`NO ACTION` (block), `CASCADE` (delete children), or `SET NULL`. PostgreSQL does not index the referencing column automatically: add the index.
3. **UNIQUE:** also creates an index; the basis for upserts and idempotency (Q11).
4. **CHECK:** `CHECK (total >= 0)`.
5. A violation raises an error with a code (for example `23505` unique violation, `23503` foreign-key violation) that the application can catch and map to `409`/`422`.

**Example:**
```sql
CREATE TABLE orders (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id  bigint NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  ref      text   NOT NULL UNIQUE,
  total    numeric(12,2) NOT NULL CHECK (total >= 0)
);
CREATE INDEX idx_orders_user_id ON orders (user_id);        -- FK columns need their own index
```

**What happens, step by step:**
1. `INSERT … user_id = 99` where no user 99 exists → `ERROR 23503: violates foreign key constraint`. No orphan order is created.
2. Two requests insert `ref = 'INV-1001'` concurrently: one succeeds, the other gets `23505`; the application treats it as "already exists" and returns the existing row.
3. `DELETE FROM users WHERE id = 1` while user 1 has orders → blocked by `ON DELETE RESTRICT`. With `CASCADE` it would delete the orders too.
4. Without the index on `orders.user_id`, that delete check (and every join on `user_id`) would scan the whole orders table.

**Common mistake → fix:** relying on the application alone to keep data valid ("we always check first"). Two concurrent requests, a second service, or a manual script bypass the check. Put invariants in the database as constraints, and let the application handle the resulting error.

**Interview answer:** "Primary keys give rows identity, foreign keys keep references valid, UNIQUE prevents duplicates even under races, NOT NULL and CHECK encode business rules. They're the last line of defence against application bugs. I index foreign key columns myself, and I prefer time-ordered ids like UUIDv7 over random UUIDv4 to keep B-tree inserts efficient."

**Follow-ups:**
- *Natural key vs surrogate key?* Natural keys (email, ISBN) can change or be reused; surrogate keys are stable. Keep a `UNIQUE` constraint on the natural key anyway.

---

### Q28. What is connection pooling, and how do you size it?

**Short answer:** Opening a database connection is expensive: TCP handshake, TLS, authentication, and in PostgreSQL a dedicated server process per connection. A **connection pool** keeps a set of open connections and lends them to requests, so most requests skip that cost. But the database can only handle so many connections (`max_connections`), so pools must be **sized from the database limit downward**: pool size × workers × containers must stay below it, or use a pooler such as PgBouncer or **RDS Proxy** to multiplex many clients onto few connections.

**How it works:**
1. The app asks the pool for a connection; if one is free it's returned immediately, otherwise the request waits (up to a timeout) or a new one is opened up to the maximum.
2. After the query the connection returns to the pool, not closed.
3. Each worker process has its **own** pool, so the totals multiply.
4. Each Postgres connection costs memory (several MB) and context switching, so hundreds or thousands of connections hurt performance even if they are idle.
5. Poolers sit between apps and the database: PgBouncer, or the managed **RDS Proxy**, which also speeds up failover and helps bursty clients such as Lambda functions.
6. SQLAlchemy knobs: `pool_size`, `max_overflow`, `pool_timeout`, `pool_pre_ping=True` (test a connection before use), `pool_recycle`.

**Example:** (illustrative numbers)
```
Database max_connections            = 200  (leave ~20 for admin, migrations, monitoring → 180 usable)
ECS tasks × workers per task        = 10 × 4 = 40 worker processes
Pool per worker                     = 4  →  40 × 4 = 160 connections   ✅ under 180

Unplanned: pool 10 per worker       = 400 connections  ❌ over the limit
Lambda at 1,000 concurrent runs × 1 connection each = 1,000  ❌ → put RDS Proxy in front
```

```flow
trace: Connection arithmetic
10 tasks × 4 workers × pool 10 = **400 connections** > Every worker process has its own pool, so the numbers multiply.
the database allows about 200 connections > Past that, new connections fail with "too many connections".
size from the database down: 180 usable ÷ 40 workers = pool of 4 > Leave headroom for admin tools, migrations and deploy overlap.
bursty clients such as Lambda use a proxy > RDS Proxy multiplexes thousands of clients onto a few database connections.
```

**What happens, step by step:**
1. Traffic grows; autoscaling adds tasks from 10 to 20. With pool 10 and 4 workers that is 800 potential connections against a 200 limit.
2. New tasks fail health checks with `FATAL: sorry, too many clients already`; the existing tasks keep running but the scale-out makes the outage worse.
3. Recomputing: pool 4 × 4 workers × 20 tasks = 320, still over. Options: smaller pools, fewer workers per task, a pooler like PgBouncer/RDS Proxy, or a bigger instance with a higher limit.
4. With a pooler in transaction mode, 320 app connections map onto about 50 server connections.

**Common mistake → fix:** sizing the pool "as big as possible so we never wait". More connections than CPU cores can use gives no extra throughput and adds memory and lock contention; requests just queue inside the database instead of the pool. A pool of a few connections per worker is usually enough when queries are fast and transactions are short (Q23).

**Interview answer:** "A pool reuses open connections to avoid connect cost, but the database has a hard connection limit, so I size from the database downward: pool size times workers times containers, with headroom for deploys and admin. For bursty clients like Lambda, or many containers, I put a pooler like PgBouncer or RDS Proxy in front. Pre-ping and recycle settings handle dead connections after failover."

**Follow-ups:**
- *What's the catch with transaction-mode poolers?* Session-level features (session variables, prepared-statement behaviour, advisory locks held across transactions) don't work as expected.

---

### Q29. What are read replicas, and what is replication lag?

**Short answer:** A **read replica** is a copy of the primary database that receives its changes continuously and serves read-only queries, spreading read load. Replication is usually **asynchronous**, so a replica can be behind the primary by milliseconds or seconds (**replication lag**). The classic bug is **read-your-writes**: a user saves something, the next page load reads from a replica that hasn't received it yet, and the user sees old data.

**How it works:**
1. Every change on the primary is written to the WAL (write-ahead log); replicas receive and replay it.
2. In PostgreSQL streaming replication, replicas are slightly behind; long-running queries on a replica or a heavy write burst increase lag.
3. In Aurora, replicas read the same shared storage volume, so lag is usually very small, but not zero because replicas have to refresh cached pages.
4. Applications route writes (and reads that must be fresh) to the primary and tolerant reads to replicas, via separate endpoints (writer endpoint vs reader endpoint).

**Example:**
```python
# after a write, read your own data from the primary for a short window
async def get_profile(user_id: str, recently_wrote: bool):
    engine = primary_engine if recently_wrote else replica_engine
    async with AsyncSession(engine) as s:
        return await s.get(Profile, user_id)
```

```flow
sequence: Read-your-writes with a lagging replica
actors: User, API, Primary, Replica
User -> API: save profile with new display name
API -> Primary: UPDATE profile
Primary --> API: committed
User -> API: reload the profile page
API -> Replica: SELECT profile where the replica is 200 ms behind
Replica --> User: OLD display name is shown
> The change had committed on the primary but not yet reached the replica. Fix: read the user's own data from the primary for a short time after a write, or return the updated object in the write response.
```

**What happens, step by step:**
1. 10:00:00.000 the primary commits the new name.
2. 10:00:00.050 the user's browser reloads; the API reads from the replica, which is 200 ms behind. It still has the old name.
3. The user thinks the save failed and clicks Save again (a duplicate write).
4. With the fix, the save response already contains the new profile, and for the next 5 seconds this user's reads go to the primary. By then the replica has caught up (10:00:00.200).

**Common mistake → fix:** sending *all* reads to replicas, including reads right after writes and reads inside write flows ("check balance then withdraw"). Decisions based on stale data cause wrong results. Use replicas only for reads that tolerate staleness (reports, lists, search), and the primary for read-after-write and for anything that feeds a write.

**Interview answer:** "Read replicas copy the primary asynchronously and serve read-only queries to scale reads. Because of replication lag, a user may not see their own write, so I read recent writes and any data that drives a write from the primary, return the updated object in the write response, and use replicas for staleness-tolerant reads. Replicas also help with failover but aren't backups."

**Follow-ups:**
- *Do replicas help with write scaling?* No; all writes still go to one primary. For that you need sharding or a database designed to scale writes (Q30).

---

### Q30. Partitioning vs sharding: what's the difference?

**Short answer:** **Partitioning** splits one big table into smaller pieces **inside one database** (for example one partition per month), so queries can skip irrelevant pieces and old data can be dropped cheaply. **Sharding** splits data across **several separate database servers** by a shard key (for example `tenant_id`), which scales **writes** beyond one machine but makes cross-shard queries and transactions hard. Exhaust simpler options first.

**How it works:**

| | Partitioning (one database) | Sharding (many databases) |
|---|---|---|
| What | one logical table stored as several partitions (range, list or hash) | rows spread across servers by a shard key |
| Gains | partition pruning (skip irrelevant partitions), instant `DROP PARTITION` for old data, smaller indexes | write and storage capacity beyond one machine |
| Costs | low; queries should include the partition key | cross-shard joins/transactions, rebalancing, hot shards, much more operational complexity |

**Example:**
```sql
CREATE TABLE events (
  id bigint GENERATED ALWAYS AS IDENTITY,
  created_at timestamptz NOT NULL,
  payload jsonb,
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE events_2026_10 PARTITION OF events
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');

-- retention: drop a whole month instantly instead of a slow DELETE
DROP TABLE events_2026_01;
```

**What happens, step by step:**
1. `SELECT … FROM events WHERE created_at >= '2026-10-20'` only touches `events_2026_10`; the planner prunes the other months.
2. Deleting January's data is `DROP TABLE events_2026_01`: instant, with no dead rows for VACUUM, compared with a `DELETE` of 50 million rows.
3. For sharding by `tenant_id` across 4 servers, tenant `t-42` always lives on shard `hash(t-42) mod 4`. Single-tenant queries hit one server. A report over all tenants must query all four and merge, and a transaction touching tenants on different shards has no ACID guarantee.
4. If one tenant is huge, its shard becomes hot while others sit idle (**hot shard**).

**Common mistake → fix:** jumping to sharding because "the table is big". Usually the real fixes are cheaper: add the right indexes, fix queries (Q15), cache, add read replicas, partition by time, move to a bigger instance. Shard only when write volume or data size truly exceeds one machine, or pick a database built for horizontal scale (DynamoDB, Aurora Limitless, or a distributed SQL database).

**Interview answer:** "Partitioning splits a table within one database, for example by month, which gives partition pruning and cheap retention. Sharding spreads data across multiple servers by a shard key to scale writes, at the cost of cross-shard queries, transactions, rebalancing and hot shards. I exhaust indexing, caching, replicas, partitioning and bigger instances before sharding, or choose a database designed to scale out."

**Follow-ups:**
- *What makes a good shard key?* High cardinality, evenly distributed load, and present in most queries (often tenant id).

---

### Q31. How do you run schema migrations with zero downtime?

**Short answer:** During a deployment, old and new versions of your application run **side by side** against the same database, so every migration must work with both. Use **expand → migrate → contract**: first add the new structure without breaking the old code (expand), then move the data and the code (migrate), and only when no old code remains remove the old structure (contract). Never rename or drop something in the same release that stops using it.

**How it works:**
1. **Expand:** add the new column (nullable or with a default), table or index. Old code ignores it.
2. **Migrate:** deploy code that writes both old and new columns and reads the old; backfill existing rows in small batches; switch reads to the new column.
3. **Contract:** after all old application versions are gone and nothing reads the old column, stop writing it and drop it in a later release.
4. Risky operations on big tables: adding `NOT NULL` without a default (rewrites or scans the table), long-running `ALTER TABLE` holding strong locks, normal `CREATE INDEX` (blocks writes; use `CREATE INDEX CONCURRENTLY`).
5. Tools: Alembic, Flyway, Liquibase run versioned migration scripts exactly once per database.

**Example:** rename `fullname` to `display_name`.
```sql
-- release 1 (expand)
ALTER TABLE users ADD COLUMN display_name text;
-- app now writes BOTH columns, reads fullname

-- release 2 (migrate): backfill in batches
UPDATE users SET display_name = fullname
WHERE id IN (SELECT id FROM users WHERE display_name IS NULL LIMIT 1000);
-- repeat until 0 rows; app now reads display_name

-- release 3 (contract), after all old versions are retired
ALTER TABLE users DROP COLUMN fullname;

-- index without blocking writes
CREATE INDEX CONCURRENTLY idx_users_display_name ON users (display_name);
```

```flow
pipeline: Renaming a column without downtime
Expand > Add display_name. The app writes both columns and still reads fullname.
Backfill > Copy fullname into display_name in batches of 1,000 rows, so no long lock is taken.
Switch reads > The app reads display_name. Old app versions still write fullname during the overlap.
Contract > When no old version runs: stop writing fullname, then drop the column in a later release.
```

**What happens, step by step:**
1. Release 1: the new column exists (all `NULL`). Old instances keep working because they never reference it.
2. The backfill runs 1,000 rows at a time with short transactions; 5M users take a few minutes, with no long lock.
3. Release 2 reads `display_name`. During the rolling deploy, instances still on release 1 write only `fullname`; release 2 instances write both, so both columns stay in sync.
4. A week later, with no old instance running (check deployment history), release 3 drops `fullname`. If you had dropped it in release 2, the remaining release-1 instances would start failing with "column fullname does not exist".

**Common mistake → fix:** a single migration that renames the column while the old code is still running. The moment it runs, old instances error out. Also `ALTER TABLE … ADD COLUMN … NOT NULL DEFAULT …` was historically a table rewrite; PostgreSQL 11 and later handle constant defaults without rewriting, but other operations (changing a type) still can. Check the lock and rewrite behaviour in the docs, and test migrations on production-sized data. Run migrations once per deploy, not from every container at startup.

**Interview answer:** "Because old and new code overlap during a deploy, I use expand, migrate, contract: add the new column, write both while backfilling in small batches, switch reads, and drop the old column only after every old version is gone. I use CREATE INDEX CONCURRENTLY, avoid long locks, test on production-sized data, and run migrations once per deploy with a tool like Alembic."

**Follow-ups:**
- *What about rollbacks?* Keep migrations backward-compatible so you can roll back the code without rolling back the schema.

---

## 6. DynamoDB

### Q32. What is DynamoDB, and how is it different from a relational database?

**Short answer:** **Amazon DynamoDB** is a fully managed, serverless **NoSQL key-value and document database**. You don't manage servers, patches or storage: you create a **table**, and DynamoDB spreads it across many machines automatically and answers key-based requests in single-digit milliseconds at almost any scale. The trade-off: it is built for lookups by **primary key**; there are no joins, and you must decide your access patterns *before* designing the table.

**How it works:**
1. A **table** holds **items** (like rows). Each item is a set of **attributes** (like columns), but items in one table can have different attributes: only the key attributes are required.
2. Every item is identified by its **primary key**: a **partition key** alone, or a partition key + **sort key** (Q33).
3. You work with a small API: `PutItem`, `GetItem`, `UpdateItem`, `DeleteItem` for single items; `Query` (items sharing a partition key) and `Scan` (whole table) for sets; `BatchGetItem`/`BatchWriteItem` and `TransactWriteItems` for groups.
4. Capacity is either **on-demand** (pay per request) or **provisioned** (you set read/write capacity), Q39.
5. Access is over HTTPS with AWS credentials (IAM), so there are no database connections to pool, which suits Lambda.

| | Relational (PostgreSQL) | DynamoDB |
|---|---|---|
| Model | tables, fixed schema, relations | tables of flexible items, key-based |
| Queries | any SQL, joins, aggregates | `GetItem`, `Query` by key, filters; no joins |
| Scaling | scale up, read replicas | horizontal, automatic |
| Design starts from | entities | **access patterns** |
| Transactions | rich, multi-statement | limited (up to 100 items, Q37) |

**Example:**
```python
import boto3
table = boto3.resource("dynamodb").Table("Orders")

table.put_item(Item={"PK": "CUST#42", "SK": "ORDER#2026-10-20#B07", "total": 120, "status": "NEW"})
resp = table.get_item(Key={"PK": "CUST#42", "SK": "ORDER#2026-10-20#B07"})
print(resp["Item"]["status"])                     # NEW
```

**What happens, step by step:**
1. `put_item` sends the item over HTTPS. DynamoDB hashes `CUST#42` to choose a partition and stores the item there (replicated across three Availability Zones in the Region).
2. `get_item` with the same full key hashes to the same partition and returns the item directly, typically in single-digit milliseconds.
3. Asking "all orders with status NEW across all customers" has no key to hash: it would need a `Scan` of the whole table, or an index designed for that question (Q35).
4. There is no connection pool, no server to size, and no schema change needed to add a `coupon_code` attribute to new items.

**Common mistake → fix:** designing DynamoDB tables like SQL tables (one per entity) and expecting ad hoc queries and joins. You end up with scans and many round trips. List the access patterns first and design keys around them (Q36), or choose a relational database if the queries are unpredictable (Q42).

**Interview answer:** "DynamoDB is a serverless key-value and document database: items in tables, identified by a partition key and optional sort key, accessed with GetItem and Query at single-digit-millisecond latency and scaling horizontally without servers to manage. There are no joins or ad hoc queries, so I design from the access patterns first. It's great for known, key-based workloads like sessions, job state and idempotency records."

**Follow-ups:**
- *Is it schemaless?* Only the key attributes are fixed; other attributes can vary per item, but your application still needs a consistent shape.
- *Do I connect with a driver and a pool?* No; it's an HTTPS API authenticated with IAM.

---

### Q33. What are partition keys, sort keys and items?

**Short answer:** Every DynamoDB item has a **partition key**, which DynamoDB hashes to decide which physical partition stores the item, and optionally a **sort key**, which orders the items inside that partition. You can efficiently fetch by key only: `GetItem` (exact full key) or `Query` (one partition key, plus a condition on the sort key such as `begins_with` or `between`).

**How it works:**
1. The partition key value goes through a hash; the result picks the partition. Items with the same partition key live together.
2. Within a partition, items are stored sorted by sort key, so range queries on the sort key are cheap.
3. The full primary key (partition + sort) must be unique per item.
4. Choose a partition key with many distinct values and even traffic (Q38); put "what you want to range over" in the sort key (dates, versions, types).
5. **Limits** (current quotas): an item is at most **400 KB** (including attribute names), partition key value at most 2,048 bytes, sort key value at most 1,024 bytes, one `Query` or `Scan` call returns at most **1 MB** (continue with `LastEvaluatedKey`), `BatchGetItem` up to 100 items / 16 MB, `BatchWriteItem` up to 25 put/delete requests / 16 MB. Batches are not transactions: handle `UnprocessedItems`.

**Example:**
```
Table: Orders      PK = customer_id      SK = order_date#order_id
┌───────────┬───────────────────┬───────┬────────┐
│ PK        │ SK                │ total │ status │
├───────────┼───────────────────┼───────┼────────┤
│ CUST#42   │ 2026-10-01#A12    │ 500   │ PAID   │   ← one partition holds all of
│ CUST#42   │ 2026-10-20#B07    │ 120   │ NEW    │     customer 42's orders, sorted by date
│ CUST#77   │ 2026-09-15#C33    │ 900   │ PAID   │
└───────────┴───────────────────┴───────┴────────┘
```
```python
from boto3.dynamodb.conditions import Key
r = table.query(KeyConditionExpression=Key("PK").eq("CUST#42") & Key("SK").begins_with("2026-10"))
```

```flow
pipeline: How DynamoDB finds items for Query PK = CUST#42 and SK begins_with 2026-10
Hash the partition key > hash(CUST#42) points to one partition. No other partition is touched.
Find the sort-key range > Items in that partition are sorted by SK, so the 2026-10 section is located directly.
Read matching items > Both October orders (A12 and B07) are returned, in sort order.
Return up to 1 MB > If more data matched, a LastEvaluatedKey lets you continue.
```

**What happens, step by step:**
1. DynamoDB hashes `CUST#42` and goes to its partition.
2. It positions at the first sort key that begins with `2026-10`: `2026-10-01#A12`, then reads `2026-10-20#B07`, and stops at the first key that doesn't match.
3. It returns those two items; the read cost depends on the size of items read (not the table size).
4. `GetItem(PK=CUST#42, SK=2026-10-20#B07)` returns just the second item.
5. A query for "all orders with total > 400 across customers" can't use the key; it would need a Scan or an index.

**Common mistake → fix:** a low-variety partition key like `status` or a date: millions of items share one key, so one partition takes all traffic and throttles (Q38). Use a high-cardinality key (customer id, job id) and put status or dates in the sort key or an index.

**Interview answer:** "The partition key is hashed to pick the physical partition, and the optional sort key orders items within it, which enables efficient range queries with begins_with or between. I can fetch only by key with GetItem or Query, so I choose a high-cardinality partition key and put the range dimension in the sort key. I also keep in mind the 400 KB item limit and the 1 MB per Query page."

**Follow-ups:**
- *What goes in S3 instead?* Large payloads: store them in S3 and keep the pointer (key) in the item.

---

### Q34. What is the difference between Query and Scan?

**Short answer:** **Query** reads items of **one partition key** (optionally narrowed by sort key): fast and cheap. **Scan** reads the **entire table** (or index) and then filters: slow and expensive, because you pay for everything it reads. A `FilterExpression` is applied **after** reading, so it shrinks the response but **not** the cost.

**How it works:**
1. Query uses the key to go directly to one partition, then to a range within it.
2. Scan walks every partition page by page (1 MB per call) and returns items; with a filter it still reads (and bills for) all of them.
3. Read capacity consumed is based on the **size of data read**, rounded up per item.
4. If a production code path needs Scan, an access pattern is missing from your key design: add a **GSI** (Q35) or restructure keys.
5. Scans are acceptable for rare admin jobs, small tables, exports (or use the S3 export feature instead).

**Example:**
```python
# ✅ Query: one partition
table.query(KeyConditionExpression=Key("PK").eq("CUST#42"))

# ❌ Scan with a filter: reads the whole table first
table.scan(FilterExpression=Attr("status").eq("NEW"))
```

```flow
trace: Query vs Scan on a table of 10 million items
Query PK = CUST#42 reads **about 20 items** > It goes straight to one partition.
Scan with FilterExpression status = NEW reads **10 million items** and returns 300 > The filter runs after the read, so you pay for everything read.
capacity used: Query tiny, Scan enormous > A Scan can also use up the table's throughput and slow down real traffic.
a production path needs a Scan > The key design is missing an access pattern, so add a GSI.
```

**What happens, step by step:**
1. Query: reads about 20 items of 1 KB each, roughly 20 KB total, costing about 3 read units with eventual consistency (20 KB ÷ 4 KB ÷ 2, rounded up).
2. Scan: reads 10M × 1 KB ≈ 10 GB across thousands of 1 MB pages, costing about 1.3 million read units, and takes minutes. The filter then discards 99.997% of it.
3. Create a GSI with `PK = status`, `SK = created_at` (with sharding if few statuses, Q38) and the same question becomes a Query returning only the 300 items.

**Common mistake → fix:** adding a `FilterExpression` to a Query and assuming it makes it cheaper. A filter on a Query only removes items after they were read from the partition (still within the 1 MB page limit), so a Query for a big partition with a selective filter can return empty pages while still reading a lot. Put the filtered attribute into the key (sort key or GSI) so the key condition does the narrowing.

**Interview answer:** "Query reads one partition key's items, optionally a sort-key range, so cost depends on what it returns. Scan reads the whole table and filters afterwards, so you pay for everything it reads. Filters don't reduce read cost. If a hot path needs Scan, the design is missing an access pattern and I add a GSI or change the keys."

**Follow-ups:**
- *Can Scan be parallelised?* Yes, with segments (`Segment`/`TotalSegments`), but it still reads everything.

---

### Q35. What are GSIs and LSIs?

**Short answer:** A **secondary index** gives you a second way to query a table by different keys. A **Global Secondary Index (GSI)** has its own partition key and sort key (any attributes) and can be added at any time; it is updated **asynchronously** from the table, so reads from it are **eventually consistent only**. A **Local Secondary Index (LSI)** keeps the **same partition key** with a different sort key, must be created **with the table**, and supports strongly consistent reads.

**How it works:**

| | GSI (Global) | LSI (Local) |
|---|---|---|
| Keys | any new partition key + optional sort key | same partition key, different sort key |
| Created | any time | only when the table is created |
| Consistency | eventually consistent reads only | eventual or strong |
| Capacity | its own (separate throughput) | shares the table's |
| Default quota | 20 per table (adjustable) | 5 per table |
| Size limit | none | item collection (all items with one partition key, including the LSI) ≤ 10 GB |

1. DynamoDB copies the projected attributes of each item into the index, keyed differently (`KEYS_ONLY`, `INCLUDE` chosen attributes, or `ALL`).
2. Writes to the table propagate to GSIs in the background, normally within a short time. If a GSI can't keep up (throttled), it can slow or throttle writes to the table.
3. Queries on the index use the index's key schema; items missing the index key attributes are not in the index (a "sparse index", handy for "only the NEW ones").

**Example:**
```
Need: "find order by order_id" (customer id unknown)
→ GSI1: PK = order_id → returns the item

Need: "all orders with status NEW, oldest first"
→ GSI2: PK = status, SK = created_at
   careful: only a few statuses = hot partition, so shard the key: "NEW#0" … "NEW#9" (Q38)
```
```python
table.query(IndexName="GSI1", KeyConditionExpression=Key("order_id").eq("B07"))
```

```flow
pipeline: Adding a GSI for a new access pattern
New need > Find an order by order_id without knowing the customer.
Create GSI1 with PK = order_id > Any attributes can be the index keys; existing items are backfilled.
DynamoDB keeps it up to date asynchronously > Each write to the table is copied to the index shortly afterwards.
Query the index > Reads are eventually consistent, so a just-written item may briefly be missing.
```

**What happens, step by step:**
1. The table has items keyed `CUST#42 / ORDER#…`. Looking up by `order_id` alone would need a Scan.
2. You create `GSI1` with `PK = order_id`. DynamoDB backfills it from existing items.
3. A new order is written at 10:00:00.000; the table confirms. The GSI entry appears a moment later (typically milliseconds).
4. A `Query` on `GSI1` at 10:00:00.001 may not return it yet. If the app needs read-your-writes, read from the table by its full key instead, or return the new item from the write call.

**Common mistake → fix:** a GSI with a low-cardinality key (like `status`). All writes for `NEW` hit one index partition; it throttles and, because index writes are part of table writes, back-pressures the table. Use a high-cardinality key, or add a shard suffix.

**Interview answer:** "A GSI is a second key schema over the same data: any keys, added any time, with its own capacity, but eventually consistent. An LSI keeps the same partition key with another sort key, must be created with the table, shares capacity, can be strongly consistent but limits an item collection to 10 GB. I create indexes only for real access patterns, use sparse and sharded keys, and watch for GSI throttling that back-pressures writes."

**Follow-ups:**
- *What does projection do?* It chooses which attributes are copied into the index; fewer attributes means smaller, cheaper indexes.

---

### Q36. What is access-pattern-first design, and what is single-table design?

**Short answer:** In SQL you model entities and can write any query later. In DynamoDB you **list every access pattern first** ("get a job by ID", "list a user's jobs newest first"), then choose keys so each pattern is one `GetItem` or one `Query`. **Single-table design** stores several entity types in **one table** with generic key names (`PK`, `SK`) so related items share a partition and can be fetched together in one call, a "join" done by key design.

**How it works:**
1. Write the access patterns, with expected volume and consistency needs.
2. Choose `PK`/`SK` values so items that are read together share a `PK`, and prefix the values with the entity type (`JOB#123`, `STEP#001`).
3. Use GSIs for the remaining patterns (a different key view of the same items).
4. Denormalise: duplicate values (for example the job's title on each step) when it avoids a second read, and decide how copies are updated.
5. Trade-off: single-table is fast and cheap but harder to read and evolve; separate tables are fine when entities aren't fetched together.

**Example:**
```
Access patterns for a job service:
1. get a job by id                    → PK = JOB#<id>,       SK = META
2. list a job's steps in order        → PK = JOB#<id>,       SK = STEP#<n>
3. list a user's jobs, newest first   → GSI1PK = USER#<u>,   GSI1SK = <created_at>
4. idempotency check                  → PK = IDEMP#<key>,    SK = IDEMP   (TTL 24 h)

Item JOB#123 / META    {status: RUNNING, owner: u1, GSI1PK: USER#u1, GSI1SK: 2026-10-27T09:00Z}
Item JOB#123 / STEP#1  {tool: "ocr", status: DONE}
Item JOB#123 / STEP#2  {tool: "extract", status: RUNNING}
```

```flow
trace: Single-table design for a job service
PK = JOB#123, SK = **META** holds the status and owner > One item collection per job.
PK = JOB#123, SK = **STEP#1**, **STEP#2** are stored next to it, sorted > Steps live in the same partition as the job.
Query PK = JOB#123 returns the job and all its steps in **one call** > A join done by key design.
GSI1PK = USER#u1 sorted by GSI1SK = created_at lists the user's jobs, newest first > A second access pattern served by an index.
```

**What happens, step by step:**
1. `Query(PK = "JOB#123")` returns three items in sort order: `META`, `STEP#1`, `STEP#2`, so the API builds the job view from one request of a few KB.
2. `Query(PK = "JOB#123", SK begins_with "STEP#")` returns just the steps.
3. `Query(IndexName = GSI1, GSI1PK = "USER#u1", ScanIndexForward = False, Limit = 20)` returns the user's 20 newest jobs.
4. Adding a new pattern later ("jobs by status") means a new GSI and a backfill, which is why you think of patterns up front.

**Common mistake → fix:** starting with entity diagrams and discovering later that a core query needs a Scan. Write the access patterns down first, check that each is a single-key read, and revisit the design when a new pattern arrives. If patterns are unknowable, prefer a relational database.

**Interview answer:** "In DynamoDB I enumerate the access patterns first and design keys so each is one GetItem or Query. With single-table design I store related entities under the same partition key with typed sort keys, so one Query returns a job and its steps, and I add GSIs for other views. It's fast and cheap but harder to evolve, so I only use it when entities are read together."

**Follow-ups:**
- *Can you change keys later?* Not on an existing table; you migrate to a new table or add a GSI, which is why upfront design matters.

---

### Q37. How do conditional writes, atomic counters and transactions work?

**Short answer:** DynamoDB has no locks you hold between calls. Instead a write can carry a **condition** (`ConditionExpression`) that must be true or the write fails with `ConditionalCheckFailedException`. That gives you **idempotency** (`attribute_not_exists(PK)`) and **optimistic locking** (`version = :expected`). **Atomic counters** use `ADD`/`SET x = x + :n` in a single update. **Transactions** (`TransactWriteItems`) make up to 100 item changes all-or-nothing.

**How it works:**
1. The condition is evaluated atomically with the write on the item's partition: no race between check and write.
2. Failed condition → no change, exception raised; your code decides (return the stored result, reload and retry, or report a conflict).
3. `UpdateExpression="ADD views :one"` increments server-side; no read-modify-write.
4. `TransactWriteItems`: up to **100 unique items** and **4 MB**, no two actions on the same item, same Region and account; transactional reads and writes cost **twice** the normal capacity. Transactions are not supported across Regions in global tables.

**Example:**
```python
# create only if new (idempotency / dedupe)
table.put_item(
    Item={"PK": f"IDEMP#{key}", "SK": "IDEMP", "result": "...", "ttl": expires_epoch},
    ConditionExpression="attribute_not_exists(PK)",
)

# optimistic lock
table.update_item(
    Key={"PK": "JOB#123", "SK": "META"},
    UpdateExpression="SET #s = :new, version = version + :one",
    ConditionExpression="version = :expected",
    ExpressionAttributeNames={"#s": "status"},
    ExpressionAttributeValues={":new": "DONE", ":one": 1, ":expected": 4},
)

# atomic counter
table.update_item(Key={"PK": "PAGE#home", "SK": "STATS"},
                  UpdateExpression="ADD views :one", ExpressionAttributeValues={":one": 1})
```

```flow
sequence: Conditional write for idempotency
actors: Request 1, DynamoDB, Request 2
Request 1 -> DynamoDB: PutItem IDEMP#k1 with condition attribute_not_exists(PK)
DynamoDB --> Request 1: success, so do the work and store the result
Request 2 -> DynamoDB: PutItem IDEMP#k1 with the same condition
DynamoDB --> Request 2: ConditionalCheckFailedException
> The key already exists, so request 2 returns the stored result instead of repeating the work. The same mechanism with version equals expected gives optimistic locking.
```

**What happens, step by step:**
1. Request 1 writes `IDEMP#k1`; the condition passes (item absent), so the item is created.
2. Request 2, retrying the same operation, tries the same put; the item exists, the condition fails, nothing is written, and the exception tells the code "someone already did this".
3. For the version update: the item is at `version = 4`. The update with `:expected = 4` succeeds and sets version 5. A second writer who also read version 4 now fails the condition and must reload.
4. For "create order + decrement stock", use `TransactWriteItems` with a `Put` for the order and an `Update` on stock with `ConditionExpression="stock >= :qty"`; both happen or neither does.

**Common mistake → fix:** read-modify-write for counters or status (`get_item`, add 1 in Python, `put_item`). Two concurrent requests lose an update. Use `ADD`/`SET x = x + :n` or a conditional update.

**Interview answer:** "DynamoDB writes can carry conditions that are evaluated atomically, giving me idempotency with attribute_not_exists and optimistic locking with a version check; a failed condition raises ConditionalCheckFailedException. Counters use server-side ADD. For multi-item atomicity, TransactWriteItems handles up to 100 items and 4 MB in one Region, at double the capacity cost."

**Follow-ups:**
- *Does a retry of a conditional write double-apply?* A condition makes retries safe; for transactions you can pass a `ClientRequestToken` for idempotency.

---

### Q38. What are hot partitions, and how do you avoid throttling?

**Short answer:** DynamoDB spreads items across partitions by the hash of the partition key, and each partition can deliver at most about **3,000 read units and 1,000 write units per second**. If most traffic hits one key (a **hot key**, such as today's date or one viral item), that partition throttles with `ProvisionedThroughputExceededException` (or throttling errors in on-demand mode) even if the table overall has plenty of unused capacity. Fix it with higher-cardinality keys, **write sharding**, caching hot reads, and SDK retries with backoff.

**How it works:**
1. Total table throughput is divided among partitions; adaptive capacity moves some capacity to busier partitions, but it can't push a single partition past its ceiling.
2. Good keys: customer id, job id, device id (many values, evenly used).
3. Bad keys: dates, status flags, a tenant id of one giant tenant, a constant.
4. **Write sharding:** append a random or calculated suffix: `PK = "2026-10-27#" + random(0..9)` spreads writes over 10 partitions; reads then query all 10 and merge.
5. Cache hot reads in front (DynamoDB Accelerator, DAX, or ElastiCache).
6. Diagnose with CloudWatch metrics and **Contributor Insights** (most accessed and throttled keys).

**Example:**
```
Bad key:  PK = "2026-10-27"            → every write today goes to ONE partition (limit ~1,000 WCU/s)
Better:   PK = f"2026-10-27#{random.randint(0, 9)}"   → 10 partitions share the load
Read:     query all 10 suffixes (in parallel) and merge the results
```

```flow
trace: A hot partition and write sharding
PK = "2026-10-27" (today) means all writes hit **one partition** > The ceiling is about 1,000 write units per second per partition.
throttling while the rest of the table is idle > Other partitions have spare capacity that this key cannot use.
PK = "2026-10-27#" plus a random 0 to 9 spreads writes over **10 partitions** > Roughly 10 times the write ceiling for this logical key.
reads query all 10 suffixes and merge > The price of spreading writes.
```

**What happens, step by step:**
1. A logging service writes 4,000 items per second, all with today's date as partition key. One partition can take about 1,000 per second, so about 3,000 writes per second are throttled and retried.
2. CloudWatch shows `WriteThrottleEvents` rising while consumed capacity for the table is well below provisioned.
3. After sharding with 10 suffixes, each shard sees about 400 writes per second: under the ceiling.
4. The read side now issues 10 queries (one per suffix, in parallel) and merges; reads are slightly more work, writes no longer throttle.

**Common mistake → fix:** increasing provisioned capacity to "fix" throttling when the cause is one hot key. Adding capacity doesn't raise a single partition's ceiling. Change the key design (or shard), and check Contributor Insights to prove which key is hot.

**Interview answer:** "Each partition has a throughput ceiling of roughly 3,000 reads and 1,000 writes per second, so one hot key can throttle while the table is idle. I use high-cardinality partition keys, shard hot keys with suffixes and merge on read, cache hot reads with DAX or ElastiCache, use on-demand or autoscaling for spikes, and retry with backoff. Contributor Insights shows which keys are hot."

**Follow-ups:**
- *Does on-demand mode eliminate this?* No; it removes capacity planning but per-partition limits still apply.

---

### Q39. How do capacity modes and read/write capacity units work?

**Short answer:** DynamoDB bills reads and writes in units. One **read unit** = one strongly consistent read per second of an item up to **4 KB** (or two eventually consistent reads). One **write unit** = one write per second of an item up to **1 KB**. Transactional reads and writes cost **double**. **On-demand** mode charges per request with no planning, which suits spiky or unknown traffic; **provisioned** mode (optionally with auto scaling) is cheaper for steady, predictable traffic.

**How it works:**
1. Sizes are rounded **up** per item: a 6 KB item read strongly consistent costs 2 read units; a 2.5 KB write costs 3 write units.
2. Eventually consistent reads cost half of strongly consistent reads (Q40); transactional ones twice.
3. A `Query` that returns many items costs the total size read, rounded up (summed across items for the call).
4. **Provisioned:** you set read and write units per second; exceeding them throttles (burst capacity helps briefly). Auto scaling adjusts the setting with some delay.
5. **On-demand:** no setting; DynamoDB adapts to traffic. You can switch from provisioned to on-demand up to 4 times in a rolling 24 hours.
6. Default quotas are per-table limits (for example 40,000 read and 40,000 write units per table) and are adjustable.

**Example:** (illustrative; check current pricing for costs)
```
Item size 6 KB, strongly consistent GetItem   → ceil(6/4) = 2 read units
Item size 6 KB, eventually consistent GetItem → 1 read unit
Item size 2.5 KB PutItem                      → ceil(2.5/1) = 3 write units
Item size 2.5 KB in TransactWriteItems        → 6 write units  (2 × 3)

Steady traffic: 500 strongly consistent reads/s of 6 KB items → 500 × 2 = 1,000 read units/s provisioned
```

**What happens, step by step:**
1. The app reads one 6 KB item with a strongly consistent `GetItem`: 6 ÷ 4 = 1.5, rounded up to 2 read units.
2. The same read with `ConsistentRead=False` costs 1 read unit.
3. 500 such strongly consistent reads per second need 1,000 read units/s. With provisioned capacity set to 800, about 20% of the requests are throttled at peak (after burst capacity runs out).
4. Switching to on-demand (or raising provisioned capacity / enabling auto scaling) removes the throttling; on-demand costs more per request for steady traffic but nothing for idle time.

**Common mistake → fix:** choosing provisioned mode for an unpredictable workload and getting throttled at the first spike (or on-demand for a perfectly flat high-volume workload and overpaying). Start with on-demand if unsure; move steady workloads to provisioned with auto scaling once the pattern is clear, and keep items small (large items multiply unit cost).

**Interview answer:** "A read unit is one strongly consistent read of up to 4 KB per second, half that cost for eventually consistent, and a write unit is one write of up to 1 KB per second; transactions double both. Sizes round up per item. On-demand charges per request and suits spiky or unknown traffic; provisioned with auto scaling is cheaper for steady load. Item size and consistency choices directly drive cost."

**Follow-ups:**
- *What is burst capacity?* Unused provisioned capacity is retained briefly and can absorb short spikes, but don't depend on it.

---

### Q40. What are DynamoDB's consistency options?

**Short answer:** By default reads are **eventually consistent**: a read right after a write might not return it yet, but will soon. You can request a **strongly consistent** read (`ConsistentRead=True`) on a table or LSI to get the latest committed data, at twice the read cost and slightly higher latency. **GSIs and DynamoDB Streams are always eventually consistent.** For global tables, the default is multi-Region eventual consistency (MREC); multi-Region strong consistency (MRSC) is an option.

**How it works:**
1. Writes are durably stored (replicated across multiple Availability Zones) before DynamoDB returns success.
2. An eventually consistent read may hit a replica that has not yet applied the latest write; it is cheaper and uses less capacity.
3. A strongly consistent read goes to the up-to-date copy and reflects all earlier successful writes.
4. Indexes (GSI) are updated asynchronously, so even strongly consistent reads aren't available on them.
5. DynamoDB provides read-committed isolation: you never see uncommitted or failed writes.

**Example:**
```python
table.get_item(Key=key)                          # eventually consistent (default), 0.5 read unit per 4 KB
table.get_item(Key=key, ConsistentRead=True)     # strongly consistent, 1 read unit per 4 KB
table.query(IndexName="GSI1", ConsistentRead=True, ...)   # ValidationException: not supported on a GSI
```

**What happens, step by step:**
1. The app writes `status = DONE` and gets success.
2. It immediately calls `get_item` (default): there is a small chance it returns `RUNNING` (the old value) from a replica that hasn't caught up.
3. With `ConsistentRead=True` it always returns `DONE`.
4. A `Query` on a GSI always may lag. If the UI needs read-your-writes after an update, read the base item by key with a strongly consistent read, or return the new item data from the write call.

**Common mistake → fix:** reading a just-written item through a GSI and treating "not found" as "write failed". Index propagation is asynchronous. Read from the table by primary key, or retry briefly, for read-after-write needs.

**Interview answer:** "DynamoDB reads are eventually consistent by default; strongly consistent reads are available on tables and LSIs at double the read cost; GSIs and Streams are always eventually consistent. For read-after-write I use a strongly consistent GetItem on the base table, and I avoid treating a missing GSI entry as a failed write."

**Follow-ups:**
- *Does a strongly consistent read work across Regions in a global table?* Only with multi-Region strong consistency (MRSC); with the default mode, replication between Regions is eventual.

---

### Q41. What are TTL and DynamoDB Streams?

**Short answer:** **TTL (Time To Live)** automatically deletes items after an expiry time you store in an attribute, at no write cost: great for sessions, idempotency keys and cache entries. Deletion is **not instant**; it typically happens within a few days after expiry. **DynamoDB Streams** is an ordered, 24-hour log of item changes (create, update, delete) that you can consume (for example with Lambda) to trigger events, update search indexes, or write audit trails.

**How it works:**
1. **TTL:** enable TTL on the table and name an attribute holding the expiry as a **Number in Unix epoch seconds**. A background process deletes expired items without consuming write capacity. Items that are expired but not yet deleted still appear in reads, so filter them out when exactness matters.
2. **Streams:** enable a stream and choose the view: `KEYS_ONLY`, `NEW_IMAGE`, `OLD_IMAGE` or `NEW_AND_OLD_IMAGES`. Records are kept for **24 hours**; order is guaranteed **per item** (per primary key), not across the table.
3. A Lambda **event source mapping** reads shards in order and invokes your function with batches of records. TTL deletions also appear in the stream, marked as service deletions.
4. Handlers must be idempotent: records can be retried, and a failing batch blocks that shard until it succeeds or is routed away.

**Example:**
```python
import time
table.put_item(Item={"PK": f"IDEMP#{key}", "SK": "IDEMP", "result": r,
                     "ttl": int(time.time()) + 24 * 3600})         # expires in 24 h

# Lambda handler for a stream with NEW_AND_OLD_IMAGES
def handler(event, context):
    for rec in event["Records"]:
        if rec["eventName"] == "MODIFY":
            old, new = rec["dynamodb"]["OldImage"], rec["dynamodb"]["NewImage"]
            if old["status"]["S"] != "DONE" and new["status"]["S"] == "DONE":
                publish_job_done(new["PK"]["S"])
```

**What happens, step by step:**
1. The idempotency item is written with `ttl` = now + 24 h. For 24 h, repeated requests with the same key find it.
2. At expiry nothing happens immediately. Within a few days DynamoDB deletes it for free. Between expiry and deletion, a read would still return it, so the code also checks `ttl > now` when it matters.
3. When a job item changes to `DONE`, the stream record carries old and new images; the Lambda sees the transition and publishes a notification once per change.
4. The stream keeps the record for 24 hours; if the Lambda is down longer than that, those changes are lost to the consumer, so alarm on iterator age.

**Common mistake → fix:** relying on TTL for exact expiry (such as "session ends at precisely 30 minutes") or storing the TTL as a string or in milliseconds. TTL ignores non-Number values and expects seconds. Treat TTL as garbage collection; enforce exact expiry in your read logic.

**Interview answer:** "TTL deletes expired items for free based on an epoch-seconds Number attribute, but deletion can lag by days, so reads should also check expiry. Streams give a 24-hour, per-item-ordered change log that I consume with Lambda for events, search indexing or audit; handlers need to be idempotent. Together they cover cleanup and reactive workflows without polling."

**Follow-ups:**
- *Outbox with DynamoDB?* Write the event item in a transaction with the business item, and let a Streams-triggered Lambda publish it.

---

### Q42. DynamoDB or Aurora PostgreSQL: how do you choose?

**Short answer:** Choose **DynamoDB** when the access patterns are known and key-based, you need massive scale with almost no operations and single-digit-millisecond latency, or you run serverless code that shouldn't manage connections. Choose **Aurora/RDS PostgreSQL** when queries are ad hoc or reporting-heavy, you need joins and rich transactions, strong relational integrity, or your data model will change unpredictably. Many systems use both.

**How it works:**

| Choose DynamoDB when | Choose Aurora/RDS PostgreSQL when |
|---|---|
| access patterns are known and key-based | queries are ad hoc, reporting, join-heavy |
| massive scale, no capacity or server management | strong relational integrity and complex transactions |
| serverless/Lambda: no connection limits to manage | the team knows SQL and the data model will evolve |
| e.g. job status, sessions, idempotency keys, agent state | e.g. billing, users/organisations, analytics-lite |

Common split: PostgreSQL for core business data; DynamoDB for high-volume key-value state. For vector search: Aurora with **pgvector** keeps embeddings next to relational data and SQL filters; DynamoDB also supports **vector indexes** (current default quotas: 5 per table, up to 4,096 dimensions, top-K up to 100 per `SearchVectors` request; check the quotas page before relying on them).

**Example:**
```
Question: "Show total revenue per product category per month, by region"  → PostgreSQL (GROUP BY, JOINs)
Question: "Get the status of job 123"                                      → DynamoDB (GetItem, ~5 ms, scales to millions/s)
Question: "Has this idempotency key been seen? (24 h)"                     → DynamoDB (conditional put + TTL)
Question: "Transfer 100 between accounts, never negative"                  → PostgreSQL (ACID, CHECK)
```

**What happens, step by step:**
1. A platform stores tenants, users, documents metadata and billing in Aurora because they need joins, constraints and flexible reporting.
2. The same platform stores job progress and idempotency keys in DynamoDB: millions of small writes per day, always accessed by ID, expiring automatically with TTL.
3. A Lambda function that handles bursts reads/writes DynamoDB directly; it would need RDS Proxy to talk to Postgres safely (Q28).
4. A new finance report needs a three-table join with filters; it runs in Postgres in seconds, whereas in DynamoDB it would require pre-built aggregates or an export to an analytics system.

**Common mistake → fix:** choosing DynamoDB because it "scales" when the product's queries are still unknown, then rebuilding with GSIs and scans each time requirements change. Or choosing Postgres for a workload of billions of simple key lookups that needs no joins, and paying for a large cluster. Match the database to the access pattern and consistency needs.

**Interview answer:** "DynamoDB for known, key-based access at huge scale with no servers to manage, such as job state, sessions and idempotency records. Aurora PostgreSQL for ad hoc queries, joins, reporting, strong integrity and evolving data models. In practice I often use both: Postgres for the core relational data and DynamoDB for high-volume key-value state, and I explain each choice by access pattern, consistency need and scale."

**Follow-ups:**
- *Can DynamoDB do SQL?* PartiQL gives a SQL-like syntax over the same key-based operations; it doesn't add joins or remove the need for key design.

---

## 7. Caching with Redis / ElastiCache

### Q43. What is a cache, and when should you use one?

**Short answer:** A **cache** is a fast, temporary copy of data that is slow or expensive to get from its original source (a database query, a remote API call, a heavy computation). Reading from memory (for example Redis, which answers in well under a millisecond) is much quicker than running a query. The cost is **staleness**: the copy can be out of date, so every cache needs a rule for when entries expire or are removed.

**How it works:**
1. The application checks the cache first. A **hit** returns the stored value; a **miss** goes to the source of truth.
2. On a miss, the result is stored in the cache with a **TTL** (time to live) so it eventually expires.
3. When the underlying data changes, you **invalidate** (delete) the cached entry, or accept staleness up to the TTL.
4. Caches are bounded: when memory is full an **eviction policy** (for example least recently used) removes entries.
5. Good candidates: data that is read often and changes rarely (product catalogue, user profile, configuration). Bad candidates: data that must always be exact (account balance during a transfer) or that is rarely re-read.

**Example:**
```python
async def get_product(pid: str):
    cached = await redis.get(f"product:{pid}")
    if cached:
        return json.loads(cached)                       # hit: ~0.5 ms
    row = await db.fetch_product(pid)                   # miss: ~15 ms
    await redis.set(f"product:{pid}", json.dumps(row), ex=300)   # expire in 5 minutes
    return row
```

**What happens, step by step:**
1. First request for product 9: cache miss → database query (15 ms) → stored in Redis for 300 s.
2. The next 1,000 requests within 5 minutes are hits at about 0.5 ms each, so the database does 1 query instead of 1,001.
3. The price changes in the database at minute 2. Without invalidation, users see the old price until minute 5.
4. To avoid that, the update code also runs `redis.delete("product:9")`, so the next read reloads the fresh row.

**Common mistake → fix:** caching data that differs per user under a shared key (`"dashboard"`), so one user sees another's data. Include everything that changes the result in the key (`dashboard:{tenant}:{user}`), and never cache authorisation decisions longer than you can tolerate being wrong.

**Interview answer:** "A cache is a fast temporary copy of slow or expensive data, checked before the source. A hit saves the query; a miss loads from the source and stores it with a TTL. The trade-off is staleness, so I choose TTLs and invalidate on writes, include tenant and user in keys, and use caches for read-heavy, slowly changing data, not for data that must always be exact."

**Follow-ups:**
- *Cache vs read replica?* A replica gives fresh-ish SQL reads at database speed; a cache gives much faster answers for specific, pre-computed keys.

---

### Q44. What are the common caching patterns, and what is a cache stampede?

**Short answer:** **Cache-aside** (most common): the app reads the cache, on a miss reads the database and fills the cache. **Write-through**: writes go to the database and the cache together. **Write-behind**: writes go to the cache and are flushed to the database later (fast, but data can be lost). A **cache stampede** happens when a popular key expires and hundreds of requests all miss at once and hit the database together.

**How it works:**

| Pattern | How | Watch out |
|---|---|---|
| **Cache-aside** | read cache → miss → read DB → write cache with TTL | stale data until TTL; stampede |
| Write-through | write DB and cache together | slower writes; caches data that may never be read |
| Write-behind | write cache, flush to DB later | data loss if the cache fails before flushing |

- On update with cache-aside, **delete** the key rather than updating it; the next read repopulates it, which avoids races where an older value overwrites a newer one.
- Stampede defences: a **single-flight lock** (one request refreshes while others wait or get the stale value), **jittered TTLs** (random extra seconds so keys don't all expire together), **early refresh** in the background.

**Example:**
```python
async def get_user(uid: str):
    key = f"user:{uid}"
    if (hit := await redis.get(key)):
        return json.loads(hit)
    # single-flight: only one request rebuilds the entry
    if await redis.set(f"lock:{key}", "1", nx=True, ex=10):
        try:
            user = await db.fetch_user(uid)
            ttl = 300 + random.randint(0, 60)               # jitter
            await redis.set(key, json.dumps(user), ex=ttl)
            return user
        finally:
            await redis.delete(f"lock:{key}")
    await asyncio.sleep(0.05)                               # others wait briefly, then retry
    return await get_user(uid)
```

```flow
sequence: A cache stampede and the single-flight fix
actors: 1,000 requests, Cache, Database
1,000 requests -> Cache: GET the hot key which has just expired
Cache --> 1,000 requests: miss for all 1,000
1,000 requests -> Database: 1,000 identical queries arrive at once and overload it
> This is the stampede. The key was cheap to read but expensive to rebuild, and everyone rebuilt it together.
1,000 requests -> Cache: FIX: one request takes a lock and rebuilds, the other 999 wait or use the stale value
Cache --> 1,000 requests: after the rebuild, all get the fresh value from the cache
```

**What happens, step by step:**
1. The home-page data key expires at 10:00:00 while 1,000 requests per second are arriving.
2. Without protection, all 1,000 requests in that second miss and each runs a 200 ms query; the database receives 1,000 concurrent queries and slows to seconds.
3. With the lock, one request wins `SET NX`, queries once (200 ms), and writes the value with a TTL of, say, 337 s (300 + jitter). The others sleep 50 ms and then hit the cache.
4. Because TTLs include random jitter, thousands of similar keys don't all expire at the same instant either.

**Common mistake → fix:** updating the cache value in the write path and the database separately (two writes, no atomicity), so a failure leaves them different, or an older write lands after a newer one. Prefer "write the database, then delete the cache key", and accept that the next read repopulates it.

**Interview answer:** "I use cache-aside: check the cache, on a miss read the database and store with a TTL, and on writes update the database then delete the key. A stampede happens when a hot key expires and many requests rebuild it at once, so I use a single-flight lock or serve stale while one request refreshes, add jitter to TTLs and refresh early. Write-through and write-behind trade write latency and durability."

**Follow-ups:**
- *What if Redis goes down?* The app should fall back to the database (with rate limits to protect it), not fail.

---

### Q45. What else is Redis used for?

**Short answer:** Besides caching, Redis (an in-memory data store; ElastiCache runs Valkey or Redis OSS) is used for **rate limiting**, **sessions**, **distributed locks**, **leaderboards** (sorted sets), **pub/sub and streams** (lightweight messaging), counters, and short-term memory for applications such as chatbots. **Amazon ElastiCache** is a managed cache; **Amazon MemoryDB** is Redis-compatible and durable, so it can serve as a primary database.

**How it works:**
1. **Rate limiting:** `INCR key` plus `EXPIRE` for a fixed window, or a token bucket implemented in a Lua script so the check and update are atomic.
2. **Sessions:** store session data under a random ID with a TTL.
3. **Distributed locks:** `SET lock:resource token NX PX 30000` (set only if absent, expire after 30 s). Locks can expire while work is still running, so use fencing tokens (a counter the protected resource checks) for correctness-critical work.
4. **Leaderboards:** sorted sets (`ZADD`, `ZREVRANGE`) rank millions of entries quickly.
5. **Pub/sub and streams:** broadcast messages to subscribers or keep consumer-group streams.
6. **Persistence:** Redis can snapshot or log to disk, but treat a cache as disposable unless you use a durable offering.

**Example:**
```python
# fixed-window rate limit: 60 requests per minute per user
key = f"rl:{user_id}:{int(time.time() // 60)}"
count = await redis.incr(key)
if count == 1:
    await redis.expire(key, 60)
if count > 60:
    raise HTTPException(429, headers={"Retry-After": "30"})

# leaderboard
await redis.zadd("scores", {"asha": 1200, "ravi": 900})
top = await redis.zrevrange("scores", 0, 9, withscores=True)
```

**What happens, step by step:**
1. The user's 1st request in this minute: `INCR` returns 1; the key expires in 60 s.
2. Requests 2 to 60 increment and pass; request 61 gets `count = 61` and receives `429`.
3. `ZADD` stores scores; `ZREVRANGE 0 9` returns the top 10 in order, in logarithmic time.
4. For a lock with a 30 s expiry, if the holder pauses for 40 s (garbage collection, network), the lock expires and a second worker enters; a fencing token lets the database reject the late writes of the first holder.

**Common mistake → fix:** using Redis as the only copy of important data on a cache-only service (data disappears on failover, eviction or restart). Keep the source of truth in a durable database, or use a durable service such as MemoryDB for primary data.

**Interview answer:** "Redis is an in-memory store used for caching and also rate limiting with atomic INCR and EXPIRE or Lua token buckets, sessions with TTLs, distributed locks with SET NX PX and fencing tokens, leaderboards with sorted sets, and pub/sub or streams for light messaging. ElastiCache is a managed cache; MemoryDB is durable and can be a primary database."

**Follow-ups:**
- *Redis or DynamoDB for rate limits?* Redis is faster and supports atomic scripts; DynamoDB works without servers but each check is a billable write.

---

## 8. Scenario & debugging questions

### Q46. An endpoint got slow as the table grew to 50 million rows. What do you do?

**Short answer:** Find the exact slow query, look at its plan, and fix the biggest cost: usually a missing or unusable index, an `OFFSET` pagination, an N+1 pattern, or fetching too many columns. Measure before and after each change.

**Step by step:**
1. **Find the query.** APM traces or `pg_stat_statements` (order by total time) show which statement dominates. Copy the exact SQL with real parameter values.
2. **Run `EXPLAIN (ANALYZE, BUFFERS)`** (inside a transaction you roll back if it writes). Look for: Seq Scan on the big table, "Rows Removed by Filter" in the millions, a Sort spilling to disk, estimates far from actuals (Q15).
3. **Fix the access path.** Add a composite index that matches the query: equality columns first, then the sort column, e.g. `(user_id, status, created_at)`. In production use `CREATE INDEX CONCURRENTLY` so writes aren't blocked (Q13, Q31).
4. **Fix the query shape.** Replace `OFFSET` with keyset pagination (Q17), select only needed columns, add a missing `LIMIT`, avoid functions on indexed columns (Q14).
5. **Check N+1** in the calling code: many identical small queries per request (Q16).
6. **Refresh statistics** (`ANALYZE`) if estimates are wrong after bulk loads.
7. **Then scale around it:** caching (Q43), read replicas for staleness-tolerant reads (Q29), time partitioning (Q30).
8. **Re-measure** with the same query and confirm with production metrics.

**Example:**
```
Before: Seq Scan on orders (rows=50,000,000) → Sort → Limit 20      actual time 4,100 ms
Fix:    CREATE INDEX CONCURRENTLY idx_orders_user_date ON orders (user_id, created_at DESC);
After:  Index Scan using idx_orders_user_date … rows=20              actual time 0.12 ms
```

**What happens, step by step:**
1. `pg_stat_statements` shows `SELECT … FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20` accounts for 62% of database time.
2. The plan shows a sequential scan reading all 50M rows (4.1 s) and removing 49,999,600 by the filter.
3. The index is created concurrently (a few minutes, no write blocking). The same plan now reads 20 index entries: 0.12 ms.
4. The endpoint's p95 drops from 4.3 s to 25 ms; database CPU falls by half; monitoring confirms.

**Common mistake → fix:** adding indexes on every column or caching the slow query without ever reading the plan. The cache hides the problem until a miss; extra indexes slow writes. Read the plan first.

**Interview answer:** "I find the dominant query with pg_stat_statements or traces, run EXPLAIN ANALYZE to see why it's slow, then add a composite index matching the filter and sort, built concurrently. I switch to keyset pagination, select fewer columns, fix N+1 and refresh statistics. Only after that do I add caching, replicas or partitioning, and I measure before and after."

**Follow-ups:**
- *Index built but not used?* Check types, functions on the column, stale statistics (Q14).

---

### Q47. "Deadlock detected" errors appear under load. How do you fix them?

**Short answer:** A deadlock means two transactions are waiting for each other's row locks. PostgreSQL aborts one with `ERROR: deadlock detected` (SQLSTATE `40P01`). The cause is almost always two code paths locking the same rows **in different orders**. Fix by locking in one consistent order, shrinking transactions, indexing the `WHERE` columns so fewer rows are locked, and retrying the aborted transaction with backoff.

**Step by step:**
1. **Read the database log.** PostgreSQL logs both statements, the processes and the locks involved when it detects a deadlock. Identify the two queries.
2. **Find the two code paths.** Search the codebase for those statements. Typical case: a transfer A to B and a transfer B to A, or two batch jobs updating overlapping row sets in different orders.
3. **Impose a global lock order.** Sort the keys (for example ascending account id) and `SELECT … FOR UPDATE` them in that order before updating (Q21).
4. **Make transactions smaller and faster.** Fewer rows per transaction, no external calls inside (Q23).
5. **Index the filter columns.** An `UPDATE … WHERE status = 'x'` without an index scans and locks more rows than needed.
6. **Retry.** Catch `40P01` (and `40001`), roll back, retry the whole transaction with jittered backoff, a limited number of times.

**Example:**
```python
async def transfer(session, from_id, to_id, amount):
    first, second = sorted([from_id, to_id])             # consistent lock order
    async with session.begin():
        await session.execute(select(Account).where(Account.id.in_([first, second]))
                              .order_by(Account.id).with_for_update())
        await session.execute(update(Account).where(Account.id == from_id)
                              .values(balance=Account.balance - amount))
        await session.execute(update(Account).where(Account.id == to_id)
                              .values(balance=Account.balance + amount))
```

**What happens, step by step:**
1. Before: T1 locks A then wants B; T2 locks B then wants A. After 1 second PostgreSQL aborts T2 with `40P01`; the user sees an error.
2. After sorting: both transfers lock `min(A, B)` first. T2 now waits for T1 to finish on the first lock and never holds B while waiting for A. No cycle exists.
3. Remaining rare deadlocks (from other code paths) are caught by the retry wrapper, which re-runs the transaction after 50 to 200 ms of jittered delay.
4. The error rate drops from dozens per minute to zero.

**Common mistake → fix:** wrapping the failing function in a blind retry without fixing the order. It hides the symptoms but wastes work and keeps latency high under load. Fix the order, then keep the retry as protection.

**Interview answer:** "I read the database log to see the two statements, find the code paths that touch the same rows in opposite order, and lock rows in a consistent order, for example ascending id with SELECT FOR UPDATE. I keep transactions short, index the filter columns to lock fewer rows, and retry the aborted transaction with backoff on 40P01."

**Follow-ups:**
- *Is it always row locks?* Usually, but also unique-index waits, foreign-key checks, or explicit table locks from migrations.

---

### Q48. Users don't see their own update right after saving. Why?

**Short answer:** The write went to the primary, but the following read came from somewhere that hasn't caught up: a **read replica** with replication lag, a **cache** that wasn't invalidated, or a **DynamoDB GSI** or eventually consistent read. Fix it by reading your own recent writes from the source of truth, invalidating the cache on write, and returning the updated object in the write response so the UI doesn't need to re-read.

**Step by step:**
1. **Reproduce and time it.** Does the data appear after 1 second? After the cache TTL? Never? A delay of milliseconds points to replication or a GSI; a delay equal to the TTL points to the cache.
2. **Check where the read goes.** Log the database endpoint (writer or reader) for the read. If it is the reader endpoint, replication lag (Q29) is the likely cause.
3. **Check the cache.** Is the key deleted after the update? Does the key include everything it should (tenant, user)?
4. **Check DynamoDB.** Is the read from a GSI (always eventually consistent) or an eventually consistent `GetItem`? (Q40)
5. **Fix by cause.** Replica: read from the primary for a short window after a write, or per request for read-your-writes endpoints. Cache: delete the key after commit. DynamoDB: strongly consistent read on the base table.
6. **Make the UI robust.** Return the updated resource from `PUT`/`PATCH` and update local state with it.

**Example:**
```python
@app.patch("/v1/profile", response_model=ProfileOut)
async def update_profile(body: ProfilePatch, user: CurrentUser, db: PrimarySession, cache: CacheDep):
    profile = await apply_patch(db, user.id, body)       # written on the primary
    await db.commit()
    await cache.delete(f"profile:{user.id}")             # invalidate after commit
    return profile                                       # the UI uses this, not a re-read
```

**What happens, step by step:**
1. The user renames their profile at 10:00:00; the primary commits.
2. The page reloads at 10:00:00.05; the API reads from a replica 200 ms behind and returns the old name.
3. With the fix, the `PATCH` response already contains the new name, the cache key is deleted, and for 5 seconds this user's profile reads use the primary.
4. By 10:00:00.2 the replica has the new data; later reads can go back to it.

**Common mistake → fix:** telling users to refresh, or disabling the replica for all traffic. The first is a poor experience; the second removes the read scaling. Target the specific read-after-write paths.

**Interview answer:** "A missing update right after saving is a read from a stale copy: a lagging replica, an uninvalidated cache, or an eventually consistent DynamoDB read or GSI. I identify which with timing and logging, then read recent writes from the primary or with a strongly consistent read, invalidate the cache after commit, and return the updated object in the write response."

**Follow-ups:**
- *How long should the primary-read window be?* Longer than typical replication lag, such as a few seconds, tuned from lag metrics.

---

### Q49. DynamoDB throttles requests even though the table looks mostly idle. Why?

**Short answer:** Throttling is applied per partition and per index, not per table average. A **hot partition key** (one key taking most of the traffic) or a **GSI with a low-cardinality key** can hit its ceiling (about 1,000 writes and 3,000 reads per second per partition) while the table's total consumed capacity looks low. Prove which key is hot, then spread the load or cache.

**Step by step:**
1. **Confirm throttling.** CloudWatch: `ReadThrottleEvents` / `WriteThrottleEvents` and `ThrottledRequests`, split by table and by each GSI. Compare consumed capacity to provisioned.
2. **Find the hot key.** Turn on CloudWatch Contributor Insights for the table and indexes: it lists the most accessed and most throttled keys.
3. **Check GSIs.** A throttled GSI back-pressures writes to the base table. Look at the GSI's own metrics and key cardinality.
4. **Fix by cause.** One popular item: cache reads (DAX or ElastiCache) and shard writes. A date or status as the partition key: change to a high-cardinality key or add a shard suffix (Q38). GSI with `status` as partition key: shard it or use a sparse index.
5. **Use retries with backoff.** The AWS SDKs retry throttling errors automatically; make sure not to disable that and add jitter.
6. **Capacity mode.** On-demand adapts to spikes faster but does not remove per-partition limits.

**Example:**
```
Contributor Insights: top throttled partition keys
  PK = "2026-10-27"      share of write throttles: 97%
→ cause: today's date as partition key
→ fix:  PK = "2026-10-27#" + shard (0..9) on writes; query all 10 shards on reads
```

**What happens, step by step:**
1. Dashboards show 30% average utilisation but a stream of `WriteThrottleEvents`.
2. Contributor Insights shows a single key takes 97% of the throttled writes.
3. The key is a date used as partition key for a logging table: all today's writes hit one partition (limit about 1,000 per second).
4. After adding a random 0 to 9 suffix, the load splits across 10 partitions and the throttles vanish. Readers now query ten suffixes in parallel.

**Common mistake → fix:** raising provisioned capacity repeatedly. It raises the table-level number, not the single partition's ceiling, so you pay more and still throttle. Fix the key distribution.

**Interview answer:** "Throttling is per partition and per index, so one hot key or a low-cardinality GSI key can throttle while the table is idle. I check throttle metrics for the table and each GSI, use Contributor Insights to find the hot key, then fix the design: higher-cardinality keys, write sharding, sparse or sharded GSI keys, cached hot reads, and SDK retries with backoff. More capacity alone doesn't help."

**Follow-ups:**
- *Does adaptive capacity solve it?* It helps with uneven distribution up to a point, but not a single key beyond one partition's limit.

---

### Q50. Lambda functions exhaust Postgres connections during a traffic spike. What do you do?

**Short answer:** Each concurrent Lambda execution environment opens its own database connection, so 1,000 concurrent invocations means up to 1,000 connections to a database that may only allow 200. Put a connection pooler in front (**RDS Proxy**), cap the function's **reserved concurrency**, buffer writes through a queue (SQS), reuse the connection across invocations, or move the high-volume state to DynamoDB, which needs no connections.

**Step by step:**
1. **Confirm the symptom.** Database metrics show `DatabaseConnections` hitting the limit; Lambda logs show `FATAL: too many connections` or timeouts at spike time.
2. **Check the code.** Is the connection created *inside* the handler on every invocation (wasteful: reconnects each time) or *outside* (reused while the environment lives)? Create it outside the handler.
3. **Add RDS Proxy.** It pools and multiplexes many client connections onto a small number of database connections and speeds failover; Lambda connects to the proxy endpoint.
4. **Cap concurrency.** Set reserved concurrency (for example 50) on the function so it can never create more connections than the database can serve; excess invocations are throttled and retried.
5. **Smooth the burst.** Put SQS between producers and the Lambda; the event source mapping's maximum concurrency controls the rate.
6. **Reconsider the store.** High-volume key-value state (job status, idempotency keys) fits DynamoDB with no connection limits (Q42).
7. **Close idle connections** and set sensible timeouts so frozen environments don't hold connections.

**Example:**
```python
import os, psycopg

# created ONCE per execution environment, outside the handler
conn = psycopg.connect(os.environ["PROXY_DSN"], autocommit=True)

def handler(event, context):
    with conn.cursor() as cur:
        cur.execute("INSERT INTO events (id, payload) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                    (event["id"], event["payload"]))
```

```flow
sequence: A Lambda burst exhausting Postgres, and the proxy fix
actors: Lambdas, RDS Proxy, Postgres
Lambdas -> Postgres: 1,000 concurrent invocations open 1,000 connections directly
Postgres --> Lambdas: too many connections, new invocations fail
> The database allows about 200 connections. Without a pooler each Lambda environment holds its own.
Lambdas -> RDS Proxy: the same 1,000 invocations connect to the proxy instead
RDS Proxy -> Postgres: multiplexes them onto about 50 database connections
> Reserved concurrency, an SQS buffer, or moving the state to DynamoDB are alternative or additional fixes.
```

**What happens, step by step:**
1. A spike raises concurrent invocations from 20 to 1,000 within seconds; each new environment opens a connection.
2. At about 200 connections Postgres refuses new ones; invocations fail and retry, adding more load.
3. With RDS Proxy, the Lambdas hold cheap connections to the proxy; the proxy uses roughly 50 database connections, sharing them between short transactions.
4. Reserved concurrency of 300 caps the maximum; extra events wait in SQS instead of failing.

**Common mistake → fix:** opening and closing a connection inside every invocation. Under load that multiplies connection churn and latency. Create the connection (or client) outside the handler and let the proxy handle pooling.

**Interview answer:** "Each concurrent Lambda environment holds its own connection, so a spike can exceed the database's connection limit. I put RDS Proxy in front to multiplex connections, create the connection outside the handler to reuse it, cap reserved concurrency, smooth bursts with SQS, and for high-volume key-value state I move it to DynamoDB, which has no connection limits."

**Follow-ups:**
- *Does RDS Proxy have downsides?* Extra cost and latency, and some session features (like pinned connections with session state) reduce multiplexing.

---

### Q51. Design the storage for an agentic document-processing platform.

**Short answer:** Use the right store for each access pattern: a relational database for core business data that needs integrity and ad hoc queries, DynamoDB for high-volume key-based state, object storage for large files, a vector store for embeddings, Redis for hot caches and short-lived locks. For each store, state the access pattern, consistency need, scale and how tenant isolation is enforced.

**How it works:**
1. **Aurora PostgreSQL:** tenants, users, document metadata, access control lists, billing. Relational integrity, joins, reporting. Isolation by `tenant_id` in every query (and optionally row-level security).
2. **DynamoDB:** job status and steps, idempotency keys (TTL 24 h), rate-limit counters, session index. Key-based, high volume. Isolation by tenant-prefixed keys and IAM leading-key conditions.
3. **S3:** raw documents, extracted JSON, large tool outputs; the databases store pointers. Isolation by key prefix per tenant and bucket policies; presigned URLs for access.
4. **Vector store:** chunk embeddings with `tenant_id` and `document_id` filters (pgvector in Aurora, OpenSearch, or other vector stores).
5. **Redis:** hot caches, short-lived locks, semantic cache. Disposable.
6. **Agent state / checkpoints:** the orchestration framework's own durable store (Postgres or DynamoDB), keyed by thread id and tenant.

**Example:**
```
Aurora PostgreSQL   tenants, users, documents(metadata, status, s3_key), billing
DynamoDB            PK=JOB#<id>  SK=META|STEP#<n>   (+GSI USER#<id> by created_at)
                    PK=IDEMP#<tenant>#<key>         TTL 24 h
S3                  s3://docs/<tenant>/<document>/raw.pdf , extracted.json
Vector store        embeddings(tenant_id, document_id, chunk_id, vector)  filtered by tenant
Redis               cache:<tenant>:…  lock:<job>
```

**What happens, step by step:**
1. A user uploads a PDF: the API creates a `documents` row (Postgres), a presigned S3 upload, and a `JOB#j1` item (DynamoDB, status `PENDING`) with an idempotency item.
2. A worker processes it: updates `JOB#j1` steps in DynamoDB (cheap, frequent writes), writes extracted JSON to S3, and stores embeddings with the tenant's id.
3. The user asks a question: the API searches vectors filtered by `tenant_id`, loads the document metadata from Postgres, and caches the answer's context in Redis.
4. A finance report on usage per tenant per month is a SQL query against Postgres; it never touches DynamoDB.
5. Tenant isolation is checked at each layer, so a missing filter in one store doesn't expose another tenant's data.

**Common mistake → fix:** putting everything in one store: job progress as Postgres rows updated many times per second (bloat, lock contention), or relational reporting data in DynamoDB (scans and exports). Match each workload to the store that fits, and keep one source of truth per fact.

**Interview answer:** "Aurora PostgreSQL for tenants, users, document metadata and billing; DynamoDB for job state, idempotency keys with TTL and counters; S3 for files with pointers in the databases; a vector store with tenant filters for embeddings; Redis for disposable caches and locks. I justify each by access pattern, consistency and scale, and describe how tenant isolation is enforced in every store: row filters, key prefixes, IAM conditions and per-tenant S3 prefixes."

**Follow-ups:**
- *How do you keep Postgres and DynamoDB consistent?* Treat each fact as owned by one store, and sync through events (outbox, Streams), not distributed transactions (Q24).

---

## 9. Cheat sheet

| Concept | Remember |
|---|---|
| Relational DB | Tables of typed rows; primary keys identify, foreign keys link; SQL |
| RDS / Aurora | Managed PostgreSQL; Aurora = shared multi-AZ storage, writer + up to 15 replicas |
| Basic SQL | INSERT / SELECT / UPDATE / DELETE; always a WHERE on writes; bind parameters |
| GROUP BY | One row per group; select only grouped or aggregated columns |
| JOINs | INNER = matches; LEFT = all left + NULLs; right-table filters go in `ON` |
| WHERE vs HAVING | Rows before grouping vs groups after |
| NULL | Unknown; use `IS NULL`; `NOT IN` + NULL matches nothing, use `NOT EXISTS` |
| Window functions | Rank, running total, latest per group without collapsing rows |
| Upsert | `INSERT … ON CONFLICT` on a unique constraint, atomic |
| B-tree index | Sorted, O(log n), helps `=` and ranges; costs writes |
| Composite index | Leftmost prefix; equality first, then range/sort; `INCLUDE` for covering |
| EXPLAIN ANALYZE | Seq Scan, rows removed, bad estimates, sort spills |
| N+1 | Eager load or batch |
| Keyset pagination | `WHERE (k, id) < last ORDER BY k, id LIMIT n` |
| Transaction / ACID | BEGIN … COMMIT; WAL for durability |
| MVCC | New row versions; readers don't block writers; VACUUM cleans up |
| Isolation | Postgres default Read Committed; Repeatable Read/Serializable can fail with 40001 → retry |
| Locks | `FOR UPDATE`, `SKIP LOCKED` for queues; deadlock 40P01 → same order + retry |
| Optimistic lock | `UPDATE … WHERE version = n`; 0 rows = conflict |
| Long transactions | Block writers, bloat tables, hold connections; no network calls inside |
| Outbox | Event row in same transaction; relay publishes; consumers idempotent |
| Types | numeric for money, timestamptz, text, jsonb sparingly |
| Normalisation | Each fact once; denormalise only for measured hot reads |
| Constraints | PK, FK, UNIQUE, CHECK, NOT NULL; index FK columns yourself |
| Pooling | pool × workers × containers < max connections; RDS Proxy for bursts |
| Replicas | Async; lag causes read-your-writes bugs |
| Partition vs shard | One DB split by key vs many servers; shard last |
| Migrations | Expand → migrate → contract; `CREATE INDEX CONCURRENTLY` |
| DynamoDB keys | Hash of PK picks partition, SK orders; item ≤ 400 KB; Query page ≤ 1 MB |
| Query vs Scan | Query one partition; Scan = design smell; filters do not cut cost |
| GSI vs LSI | GSI any keys, eventual; LSI same PK, create-time only, strong reads |
| Single-table | Access patterns first; typed PK/SK; one Query returns related items |
| Conditional write | Idempotency and optimistic locking; transactions up to 100 items / 4 MB |
| Hot partition | ~1,000 writes / 3,000 reads per second per partition; shard keys |
| Capacity | 1 read unit = 4 KB strong; 1 write unit = 1 KB; eventual = half; transactions = double |
| TTL / Streams | TTL free, lags up to days; Streams 24 h, per-item order |
| Cache-aside | Read cache, miss → DB → set with TTL; delete on write; jitter + single-flight |
| Redis | Cache, rate limits, locks (fencing), sorted sets, pub/sub |

## Official references

- PostgreSQL docs (indexes, EXPLAIN, MVCC, transaction isolation): https://www.postgresql.org/docs/current/
- PostgreSQL transaction isolation: https://www.postgresql.org/docs/current/transaction-iso.html
- PostgreSQL explicit locking and deadlocks: https://www.postgresql.org/docs/current/explicit-locking.html
- PostgreSQL UUID functions (`uuidv7`, PostgreSQL 18): https://www.postgresql.org/docs/current/functions-uuid.html
- Amazon Aurora: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/
- RDS Proxy: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html
- DynamoDB developer guide: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/
- DynamoDB best practices (partition keys, GSIs): https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html
- DynamoDB constraints (item size, transactions, batch, Query limits): https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Constraints.html
- DynamoDB quotas (indexes, vector indexes): https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ServiceQuotas.html
- DynamoDB partition key design: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html
- DynamoDB read consistency: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html
- DynamoDB TTL and Streams: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html · https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html
- SQLAlchemy asyncio: https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html
- ElastiCache: https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/
