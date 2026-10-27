# FastAPI & API Design: Interview Preparation

> **Updated:** 27 October 2026 · **Level:** HTTP & REST basics → FastAPI internals → secure, resilient production APIs
> **How to use:** read the *Short answer* first, then *How it works* and the *Example* walkthrough. *Common mistake → fix* shows what goes wrong in real code. *Interview answer* is what you can say out loud.

---

## Table of contents

1. [Mental model: the life of a request](#1-mental-model-the-life-of-a-request)
2. [HTTP & REST fundamentals](#2-http--rest-fundamentals) (Q01–Q08)
3. [FastAPI core](#3-fastapi-core) (Q09–Q21)
4. [Async, streaming & background work](#4-async-streaming--background-work) (Q22–Q27)
5. [Security](#5-security) (Q28–Q34)
6. [Production readiness](#6-production-readiness) (Q35–Q40)
7. [Scenario & debugging questions](#7-scenario--debugging-questions) (Q41–Q46)
8. [API styles & databases in FastAPI](#8-api-styles--databases-in-fastapi) (Q47–Q48)
9. [Cheat sheet](#9-cheat-sheet)

---

## 1. Mental model: the life of a request

**The one idea everything else follows from:** an API is a program that waits for HTTP requests and answers each one with an HTTP response. FastAPI's job is to take the raw request (a method, a path, some headers, maybe a JSON body), turn it into typed Python values you declared with type hints, call your function, and turn whatever you return back into a JSON response. If the input doesn't match your types, FastAPI answers with an error before your code even runs.

FastAPI is built from a few pieces: **Starlette** (the web toolkit that handles routing, requests and responses), **Pydantic** (data validation from type hints), a **dependency injection** system (`Depends`), and automatic **OpenAPI** documentation. It runs inside an **ASGI server** such as **Uvicorn**, which owns the network connections and the event loop.

Think of a restaurant: Uvicorn is the front door and the waiters, middleware is the host who greets every guest, the router finds the right table, dependencies fetch what the table needs (a menu, the guest's identity), Pydantic checks the order is valid, your function is the cook, and the response model is the plate check before food leaves the kitchen.

```flow
pipeline: What happens to POST /v1/jobs with a JSON body
stage: 1. Arrive
Uvicorn receives the bytes > The ASGI server parses HTTP and hands a request to the FastAPI app on its event loop.
Middleware runs (outer to inner) > Request ID, logging, CORS and compression wrap every request.
stage: 2. Prepare
Router matches POST /v1/jobs > It finds the path operation function registered for that method and path.
Dependencies run > For example: read the bearer token, verify it, open a database session.
Pydantic validates the input > Path, query, headers and JSON body become typed values. Invalid input returns 422 and your function never runs.
stage: 3. Run and reply
Your function runs > async def runs on the event loop; plain def runs in a worker thread.
Response model filters the output > Only declared fields are serialised to JSON, so internal fields don't leak.
Cleanup and background tasks > Code after yield in dependencies runs, then any background tasks.
```

**Three rules that come straight from this model:**
1. **Declare, don't parse.** Describe inputs with type hints and Pydantic models; FastAPI parses, validates and documents them for you.
2. **Never block the event loop.** Inside `async def`, only `await` non-blocking I/O. Blocking libraries go in plain `def` functions or `asyncio.to_thread`.
3. **Every request is untrusted.** Authenticate it, authorise access to the specific resource, validate sizes and types, and return only what the caller may see.

---

## 2. HTTP & REST fundamentals

### Q01. What is an API, and what is inside an HTTP request and response?

**Short answer:** An **API (Application Programming Interface)** is a defined way for one program to ask another program for data or actions. A web API uses **HTTP**: the client sends a **request** (a method like `GET`, a path like `/v1/jobs/42`, headers, and an optional body), and the server sends back a **response** (a status code like `200`, headers, and usually a JSON body). Everything in API design is about choosing these parts well.

**How it works:**
1. The client opens a connection (TLS for HTTPS) to the server.
2. It sends the **request line** (method + path + query string), **headers** (metadata such as `Authorization`, `Content-Type`, `Accept`) and an optional **body**.
3. The server routes the request by method and path, does the work, and replies with a **status line** (`HTTP/1.1 201 Created`), headers (`Content-Type`, `Location`, `Cache-Control`) and a body.
4. HTTP is **stateless**: each request carries everything the server needs (for example a token), so any server instance can handle it.

**Example:** creating a job.
```http
POST /v1/jobs?priority=high HTTP/1.1
Host: api.example.com
Authorization: Bearer eyJhbGciOi...
Content-Type: application/json

{"document_id": "doc_123", "kind": "extract"}
```
```http
HTTP/1.1 202 Accepted
Content-Type: application/json
Location: /v1/jobs/job_789

{"id": "job_789", "status": "PENDING"}
```

**What happens, step by step:**
1. Method `POST` says "create or start something"; the path `/v1/jobs` names the collection; `priority=high` is a **query parameter** (after `?`).
2. `Authorization` identifies the caller; `Content-Type: application/json` says the body is JSON.
3. The server validates the body, creates job `job_789`, and because the work will finish later it replies `202 Accepted` with a `Location` header pointing at where to check status.
4. The client later calls `GET /v1/jobs/job_789` and gets `{"status": "DONE", ...}`.

**Common mistake → fix:** putting everything in the URL or everything in the body, for example `GET /v1/createJob?token=eyJ...&document=doc_123`. Tokens in URLs end up in logs and browser history, and a `GET` that creates things breaks caching and retry assumptions. Use the method for the action, the path for the resource, the query string for filters, headers for metadata and credentials, and the body for the data being sent.

**Interview answer:** "An API is a contract for how programs talk to each other; a web API uses HTTP. A request has a method, a path with optional query parameters, headers like Authorization and Content-Type, and an optional body; the response has a status code, headers and a body, usually JSON. HTTP is stateless, so each request carries its own credentials, which lets any server instance handle it."

**Follow-ups:**
- *What is the difference between `Content-Type` and `Accept`?* `Content-Type` describes the body being sent; `Accept` says which formats the client wants back.
- *HTTP/1.1 vs HTTP/2?* Same methods and status codes; HTTP/2 multiplexes many requests over one connection with compressed headers.

---

### Q02. What do the HTTP methods mean, and what are "safe" and "idempotent"?

**Short answer:** Each method has an agreed meaning: `GET` reads, `POST` creates or triggers an action, `PUT` replaces a resource, `PATCH` changes part of it, `DELETE` removes it. A **safe** method doesn't change anything on the server (`GET`, `HEAD`, `OPTIONS`). An **idempotent** method gives the same final server state whether you send it once or five times (`GET`, `PUT`, `DELETE`). This matters because clients, proxies and libraries **retry** requests, and a retried non-idempotent `POST` can create duplicates.

**How it works:**

| Method | Purpose | Safe | Idempotent |
|---|---|---|---|
| GET | read | yes | yes |
| POST | create / action / start job | no | no (make it so with idempotency keys, Q05) |
| PUT | replace the whole resource at a known URL | no | yes |
| PATCH | partial update | no | not necessarily |
| DELETE | remove | no | yes |

**Example:**
```http
PUT   /v1/users/42/settings   {"theme": "dark", "language": "en"}
PATCH /v1/accounts/7          {"balance_delta": 100}
```

**What happens, step by step:**
1. `PUT` sends the full new settings. Sending it three times leaves settings as `{"theme":"dark","language":"en"}`: idempotent.
2. `PATCH` with `balance_delta: 100` sent three times (because of retries) adds 300: not idempotent.
3. A `PATCH` that sets an absolute value (`{"theme": "dark"}`) would be idempotent; it depends on the design.
4. `DELETE /v1/users/42` twice: the first returns `204`, the second `404` (or `204`), but the user is gone either way. The final state is the same, which is what idempotent means.

**Common mistake → fix:** a `GET` endpoint with side effects (`GET /v1/jobs/42/retry`). Browsers prefetch links, crawlers follow them and caches serve them, so the action fires unexpectedly. Use `POST` for anything that changes state.

**Interview answer:** "GET reads, POST creates or triggers actions, PUT replaces, PATCH partially updates, DELETE removes. Safe means no server-side change; idempotent means repeating the request leaves the same final state. GET, PUT and DELETE are idempotent, POST isn't, so for POSTs that clients may retry I add idempotency keys."

**Follow-ups:**
- *Is `HEAD` useful?* It returns headers without a body, for example to check existence or size.

---

### Q03. Which HTTP status codes must you know, and how do you choose one?

**Short answer:** The status code tells the client what happened and whether retrying could help. **2xx** means success, **4xx** means the client sent something wrong (retrying the same request won't help), **5xx** means the server or something behind it failed (retrying later might help). Pick the most specific code, and put details in a consistent error body.

**How it works:**

| Code | Meaning | Typical use |
|---|---|---|
| 200 OK | success with body | GET, PATCH |
| 201 Created | resource created (+ `Location` header) | POST create |
| 202 Accepted | accepted for **later** processing | start a job, return its ID |
| 204 No Content | success, no body | DELETE |
| 400 Bad Request | malformed request or business rule violation | |
| 401 Unauthorized | **not authenticated** (missing or invalid token) | |
| 403 Forbidden | authenticated but **not allowed** | |
| 404 Not Found | doesn't exist (or hidden from this caller) | |
| 409 Conflict | duplicate, version conflict, invalid state change | |
| 412 Precondition Failed | `If-Match` ETag mismatch (Q07) | |
| 422 Unprocessable Content | validation failed (FastAPI's default for invalid input) | |
| 429 Too Many Requests | rate limited (+ `Retry-After`) | |
| 500 Internal Server Error | unhandled bug | |
| 502 / 503 / 504 | bad upstream / unavailable or overloaded / upstream timeout | proxies, load balancers |

**Example:** a client sends `POST /v1/jobs` with `{"document_id": 123}` (a number where a string is expected) and no token.

**What happens, step by step:**
1. Authentication runs first (as a dependency): no token → `401` with `WWW-Authenticate: Bearer`.
2. With a valid token but a body that fails validation → FastAPI returns `422` with a list of field errors.
3. Valid body, but the document belongs to another tenant → `404` (don't reveal it exists).
4. Valid everything, job queued → `202` with the job ID.
5. The queue is down → `503` with `Retry-After: 30`, telling the client a retry later may work.

**Common mistake → fix:** returning `200` with `{"error": "not found"}`, or `500` for bad input. Clients, monitoring and retry logic all rely on the status code: a `200` error isn't retried or alerted on, a `500` for a typo pages the on-call engineer. Use the right class (4xx vs 5xx) and a consistent error body (for example RFC 9457 Problem Details, Q18).

**Interview answer:** "2xx is success, 4xx is the client's fault so retrying unchanged won't help, 5xx is the server's or an upstream's fault so a retry might. I use 201 with Location for creates, 202 for async jobs, 204 for deletes, 401 for unauthenticated versus 403 for not allowed, 404 to hide resources from other tenants, 409 for conflicts, 422 for validation errors and 429 with Retry-After for rate limits."

**Follow-ups:**
- *401 vs 403?* 401: "I don't know who you are" (send credentials). 403: "I know who you are, and you can't do this."

---

### Q04. What is REST, and how do you design REST resources?

**Short answer:** **REST (Representational State Transfer)** is a style for designing web APIs around **resources** (things like documents, jobs, users), each with a URL, manipulated with the standard HTTP methods and returned as representations (usually JSON). In practice: URLs are **nouns**, methods are the **verbs**, status codes carry the outcome, and every request is stateless.

**How it works:**
1. **Nouns, plural collections:** `/v1/documents`, `/v1/documents/{id}`.
2. **Methods as verbs:** `GET /documents` lists, `POST /documents` creates, `PATCH /documents/{id}` updates.
3. **Nesting only for ownership:** `/v1/conversations/{id}/messages` (messages belong to a conversation). Avoid deep chains.
4. **Actions that aren't CRUD** (create, read, update, delete) become sub-resources: `POST /v1/jobs/{id}/cancel`.
5. **Consistency:** same pagination, filtering, error format and naming everywhere; version the API (Q08).

**Example:**
```
GET    /v1/documents?status=ready&limit=20     list (filtered, paginated)
POST   /v1/documents                           create → 201 + Location
GET    /v1/documents/doc_123                   read
PATCH  /v1/documents/doc_123                   partial update
DELETE /v1/documents/doc_123                   delete → 204
POST   /v1/jobs/job_789/cancel                 action → 202
```
Error body in RFC 9457 Problem Details format:
```json
{ "type": "https://api.example.com/errors/quota-exceeded", "title": "Quota exceeded",
  "status": 429, "detail": "Tenant t-42 used 100% of today's tokens", "instance": "/v1/chat" }
```

**What happens, step by step:**
1. A client lists ready documents with `GET /v1/documents?status=ready&limit=20` and gets 20 items plus a `next_cursor`.
2. It creates one with `POST /v1/documents`; the response is `201` with `Location: /v1/documents/doc_456`.
3. It renames it with `PATCH /v1/documents/doc_456 {"title": "Q3 report"}` → `200` with the updated document.
4. It cancels a job with `POST /v1/jobs/job_789/cancel` → `202`.

**Common mistake → fix:** RPC-style URLs with verbs (`POST /getDocuments`, `POST /deleteDocument?id=…`). They ignore HTTP semantics, so caching, retries and tooling can't help, and every endpoint is a special case. Use resource URLs with the right method; keep verbs for genuine actions only.

**Interview answer:** "REST models the API as resources with URLs, uses HTTP methods as the verbs and status codes for outcomes, and keeps requests stateless. I use plural nouns, nest only for ownership, model non-CRUD actions as POST sub-resources like /jobs/{id}/cancel, and keep pagination, filtering and RFC 9457 error bodies consistent across endpoints."

**Follow-ups:**
- *Is HATEOAS required?* Strict REST includes links in responses to drive navigation; most real APIs skip it and rely on OpenAPI documentation instead.

---

### Q05. What is an idempotency key, and how do you implement one?

**Short answer:** An **idempotency key** is a unique value (for example a UUID) that the client generates once per user action and sends in an `Idempotency-Key` header. The server stores "key → result". If the same key arrives again (because the client retried after a timeout), the server returns the **stored result** instead of doing the work a second time. It turns a non-idempotent `POST` into a safe-to-retry one.

**How it works:**
1. Client creates `key = uuid4()` when the user clicks "Submit" and reuses it for every retry of that click.
2. Server, inside one transaction: try to insert `(tenant_id, key, request_hash)` with a **unique constraint**.
3. Insert succeeds → first time: do the work, store the response with the key.
4. Insert fails (key exists) → a retry: if the stored request hash matches, return the stored response; if the body differs, reject with `422` (or `409`); if the first request is still running, return `409` so the client retries later.
5. Keys expire after a while (for example 24 hours).

**Example:**
```python
@app.post("/v1/payments", status_code=201)
async def create_payment(
    body: PaymentIn,
    idem_key: Annotated[str, Header(alias="Idempotency-Key", max_length=64)],
    user: CurrentUser,
    db: SessionDep,
):
    body_hash = hashlib.sha256(body.model_dump_json().encode()).hexdigest()
    async with db.begin():
        existing = await db.get(IdempotencyRecord, (user.tenant_id, idem_key))
        if existing:
            if existing.request_hash != body_hash:
                raise HTTPException(422, "Idempotency-Key reused with a different body")
            return existing.response                      # replay, no second payment
        payment = Payment(tenant_id=user.tenant_id, amount=body.amount)
        db.add(payment)
        await db.flush()                                  # assigns payment.id
        response = {"id": payment.id, "amount": body.amount}
        db.add(IdempotencyRecord(tenant_id=user.tenant_id, key=idem_key,
                                 request_hash=body_hash, response=response))
    return response                                       # unique (tenant_id, key) stops races
```

```flow
sequence: A retry after a lost response
actors: Client, API, Database
Client -> API: POST /v1/payments with Idempotency-Key k1 and amount 50
API -> Database: insert key k1 and payment pay_1 in one transaction
API --> Client: 201 for pay_1, but the response is lost in a network timeout
Client -> API: retry POST /v1/payments with the same key k1 and same body
API -> Database: key k1 exists and the body hash matches
API --> Client: 201 for pay_1 replayed from storage
> Only one payment of 50 exists. Without the key, the retry would have charged the customer twice.
```

**What happens, step by step:**
1. First request: key `k1` is new; payment `pay_1` for 50 is created; key and response are saved in the same transaction.
2. The `201` is lost on the way back; the client times out and retries with the same key.
3. Second request finds `k1`, the body hash matches, and the stored `{"id": "pay_1", "amount": 50}` is returned.
4. If two retries arrive at exactly the same moment, both try to insert `k1`; the unique constraint lets only one win, and the other gets the stored result or a `409`.

**Common mistake → fix:** "check, then insert" without a unique constraint (`if not exists: create`). Two concurrent retries both see "not exists" and both create a payment. Enforce uniqueness in the database (unique index or a conditional write) so the race is impossible.

**Interview answer:** "The client generates one key per user action and sends it on every retry. The server stores the key with a hash of the request and the response, enforced by a unique constraint on tenant and key in the same transaction as the work. A retry with the same key and body gets the stored response; a different body is rejected; keys expire after about a day. That makes POSTs safe to retry."

**Follow-ups:**
- *Who generates the key?* The client, once per user intent. A server-generated key can't protect against the client's retries.
- *Where else is this pattern used?* Payment providers' APIs, job submission, and message consumers that deduplicate by message ID.

---

### Q06. How do you paginate and filter list endpoints?

**Short answer:** Never return an unbounded list. **Offset pagination** (`?limit=20&offset=40`) is simple but gets slow on deep pages and can skip or repeat items while data changes. **Cursor (keyset) pagination** (`?limit=20&cursor=…`) returns an opaque cursor that encodes the last item's sort key; the next query continues from there using an index, so it's fast at any depth and stable. Always cap `limit`, allowlist filter and sort fields, and apply the tenant filter on the server.

**How it works:**

| Style | Request | Database query | Pros / cons |
|---|---|---|---|
| Offset | `?limit=20&offset=40` | `ORDER BY created_at DESC LIMIT 20 OFFSET 40` | jump to any page; reads and discards 40 rows; slow at offset 100,000; shifts when rows are inserted |
| Cursor / keyset | `?limit=20&cursor=eyJ…` | `WHERE (created_at, id) < (:c, :id) ORDER BY created_at DESC, id DESC LIMIT 20` | fast and stable; can't jump to page N |

The cursor includes a unique tie-breaker (`id`) so rows with the same timestamp aren't skipped.

**Example:**
```python
class Page(BaseModel):
    items: list[DocumentOut]
    next_cursor: str | None

@app.get("/v1/documents", response_model=Page)
async def list_documents(user: CurrentUser, db: SessionDep,
                         limit: Annotated[int, Query(ge=1, le=100)] = 20,
                         cursor: str | None = None):
    q = select(Document).where(Document.tenant_id == user.tenant_id)
    if cursor:
        ts, last_id = decode_cursor(cursor)               # base64 JSON {"ts": ..., "id": ...}
        q = q.where(tuple_(Document.created_at, Document.id) < (ts, last_id))
    rows = (await db.scalars(q.order_by(Document.created_at.desc(), Document.id.desc())
                                 .limit(limit + 1))).all()
    next_cursor = encode_cursor(rows[limit - 1]) if len(rows) > limit else None
    return Page(items=rows[:limit], next_cursor=next_cursor)
```

**What happens, step by step:**
1. `GET /v1/documents?limit=20` → the query fetches 21 rows; there is a 21st, so there's a next page. The cursor encodes row 20: `{"ts": "2026-10-20T10:00:00Z", "id": "doc_120"}`.
2. `GET /v1/documents?limit=20&cursor=eyJ0cyI6…` → the query starts strictly after row 20 using the `(tenant_id, created_at, id)` index. No rows are read and thrown away.
3. A new document is inserted while the user pages; it appears at the top and doesn't shift page 2 (offset pagination would repeat one item).
4. The last page returns fewer than 21 rows → `next_cursor: null`.

**Common mistake → fix:** `limit` without a maximum (`?limit=1000000`) or sorting by any user-supplied column name. The first lets one request dump the table; the second can hit unindexed columns or become an injection risk. Cap `limit` with `Query(le=100)` and map allowed sort names to known columns.

**Interview answer:** "For large or changing data I use cursor pagination: an opaque cursor encodes the last sort key plus a unique id, and the next query uses WHERE (created_at, id) < cursor with a matching index, so it's fast at any depth and doesn't skip or duplicate rows. I cap limit, allowlist filters and sorts, and always scope by the caller's tenant on the server. Offset is fine for small admin tables that need page numbers."

**Follow-ups:**
- *Should you return a total count?* Only if cheap; `COUNT(*)` on big tables is slow, so return `has_more` or an estimate.

---

### Q07. How do ETags prevent lost updates (optimistic concurrency)?

**Short answer:** A **lost update** happens when two people edit the same thing and the second save silently overwrites the first. With **optimistic concurrency**, each version of a resource has a version tag. The server returns it in an `ETag` header; the client sends it back in `If-Match` when updating; the server applies the update only if the version still matches, otherwise it returns **412 Precondition Failed** and the client must reload and merge.

**How it works:**
1. The table has a `version` column, incremented on every update.
2. `GET` returns `ETag: "5"`.
3. `PATCH` with `If-Match: "5"` runs `UPDATE … SET …, version = version + 1 WHERE id = :id AND version = 5`.
4. One row updated → success, new `ETag: "6"`. Zero rows → someone else changed it → `412`.
5. No locks are held while the user is editing, which is why it's "optimistic".

**Example:**
```python
@app.patch("/v1/documents/{doc_id}")
async def update_doc(doc_id: str, body: DocPatch, user: CurrentUser, db: SessionDep,
                     response: Response, if_match: Annotated[str, Header()]):
    expected = int(if_match.strip('"'))
    result = await db.execute(
        update(Document)
        .where(Document.id == doc_id, Document.tenant_id == user.tenant_id,
               Document.version == expected)
        .values(**body.model_dump(exclude_unset=True), version=Document.version + 1)
        .returning(Document.version))
    new_version = result.scalar_one_or_none()
    if new_version is None:
        raise HTTPException(412, "Document changed since you loaded it")
    await db.commit()
    response.headers["ETag"] = f'"{new_version}"'
    return {"version": new_version}
```

```flow
sequence: Two editors, one document at version 5
actors: Alice, API, Bob
Alice -> API: GET /documents/d1
API --> Alice: 200 with ETag "5"
Bob -> API: GET /documents/d1
API --> Bob: 200 with ETag "5"
Bob -> API: PATCH /documents/d1 with If-Match "5"
API --> Bob: 200, the version is now 6
Alice -> API: PATCH /documents/d1 with If-Match "5"
API --> Alice: 412 Precondition Failed
> Alice's update matched zero rows because the version is no longer 5. Instead of silently overwriting Bob's change, she reloads version 6 and reapplies her edit.
```

**What happens, step by step:**
1. Alice and Bob both load version 5.
2. Bob saves first: `WHERE version = 5` matches, version becomes 6.
3. Alice saves with `If-Match: "5"`: `WHERE version = 5` matches nothing, so the API returns `412`.
4. Alice's UI reloads (version 6, with Bob's change), she reapplies her edit, and saves with `If-Match: "6"` → success, version 7.

**Common mistake → fix:** reading the version in one query and updating in another (`if doc.version == expected: doc.title = …; commit`). Another request can change the row between those two steps. Put the version check in the `UPDATE … WHERE` itself so the database checks and writes atomically.

**Interview answer:** "Each resource carries a version that I expose as an ETag. Updates send If-Match, and the UPDATE statement includes WHERE version equals the expected value and increments it. If no row matched, someone else changed it and I return 412 so the client reloads and merges. It prevents lost updates without holding locks while users edit."

**Follow-ups:**
- *Why 412 and not 409?* 412 is the standard response for a failed `If-Match` precondition; some APIs use 409 for version conflicts in the body instead of headers.

---

### Q08. How do you version an API and evolve it without breaking clients?

**Short answer:** Make **additive** changes whenever you can (new endpoints, new optional fields), because old clients ignore what they don't know. A **breaking change** (removing or renaming a field, changing its type or meaning, making an optional input required) needs a new version (`/v2/...`) or a deprecation period. Old clients live longer than you think: a browser tab opened yesterday still runs yesterday's JavaScript.

**How it works:**
1. **Safe:** add an endpoint, add an optional request field with a default, add a response field.
2. **Breaking:** remove or rename a field, change a type, tighten validation, change error formats or status codes.
3. **Tolerant reader:** clients must ignore unknown fields; servers should accept them or reject them deliberately.
4. **For breaking changes:** run `/v1` and `/v2` side by side, announce deprecation with `Deprecation` and `Sunset` headers, measure who still calls `/v1`, remove it when traffic is zero.

**Example:** renaming `name` to `title` on documents.
```python
class DocumentOut(BaseModel):
    id: str
    title: str
    name: str | None = Field(default=None, deprecated=True)   # kept for old clients

def to_out(doc) -> DocumentOut:
    return DocumentOut(id=doc.id, title=doc.title, name=doc.title)
```

**What happens, step by step:**
1. Release 1: responses include both `title` and `name` (same value). Old frontends keep reading `name`; new ones read `title`.
2. Release 2: the frontend switches to `title`. A metric (or log) counts requests from clients that still read `name`, for example by client version header.
3. After usage of the old field reaches zero (and past your support window), release 3 removes `name`.
4. If you had simply renamed it in one release, every open tab running the old bundle would show blank titles.

**Common mistake → fix:** treating "we deployed the backend and frontend together" as atomic. Cached SPAs, mobile apps and partner integrations call the new backend with old code for days. Use expand → migrate → contract: add, move clients, then remove.

**Interview answer:** "I prefer additive, backward-compatible changes: new endpoints and optional fields, with clients ignoring unknown fields. For a breaking change I either add the new field alongside the old one and remove it once usage reaches zero, or run a /v2 next to /v1 with Deprecation and Sunset headers and usage monitoring. I never assume frontend and backend deploy atomically."

**Follow-ups:**
- *Path versioning or header versioning?* Path (`/v1`) is visible and easy to route and cache; header versioning keeps URLs stable but is harder to test in a browser. Pick one and be consistent.
- *How do you catch accidental breaks?* Diff the generated OpenAPI schema in CI and fail on breaking changes.

---

## 3. FastAPI core

### Q09. What is FastAPI, and what does a minimal app look like?

**Short answer:** **FastAPI** is a Python web framework for building APIs. You write ordinary functions with type hints, attach them to a URL with a **decorator** like `@app.get("/items/{item_id}")` (a decorator is a line starting with `@` that registers or wraps the function below it), and FastAPI handles parsing, validation, JSON conversion and interactive documentation automatically. Such a function is called a **path operation**: a path plus an HTTP method.

**How it works:**
1. `app = FastAPI()` creates the application object.
2. `@app.get("/items/{item_id}")` registers the function below it for `GET` requests to that path.
3. FastAPI reads the function's **type hints** to know what to extract: `item_id: int` comes from the path, `q: str | None = None` from the query string.
4. Whatever you return (dict, list, Pydantic model) is converted to JSON.
5. It generates an OpenAPI schema and serves interactive docs at `/docs`.

**Example:**
```python
# main.py
from fastapi import FastAPI

app = FastAPI()

@app.get("/items/{item_id}")
async def read_item(item_id: int, q: str | None = None):
    return {"item_id": item_id, "q": q}
```
```bash
pip install "fastapi[standard]"   # FastAPI + Uvicorn + the fastapi CLI
fastapi dev main.py               # auto-reload, http://127.0.0.1:8000, docs at /docs
fastapi run main.py               # production mode, listens on 0.0.0.0:8000
```

**What happens, step by step:**
1. `GET /items/42?q=report` → the router matches `/items/{item_id}`; `"42"` is converted to the integer `42`; `q` is `"report"`.
2. The function returns `{"item_id": 42, "q": "report"}` and FastAPI sends it as JSON with status `200`.
3. `GET /items/abc` → `"abc"` can't become an `int`, so FastAPI returns `422` with `{"detail": [{"type": "int_parsing", "loc": ["path", "item_id"], ...}]}`. Your function never runs.
4. Opening `http://127.0.0.1:8000/docs` shows this endpoint with a "Try it out" button, generated from the same type hints.

**Common mistake → fix:** declaring two routes where a fixed path comes after a parameter path:
```python
@app.get("/users/{user_id}")
async def get_user(user_id: str): ...
@app.get("/users/me")              # ❌ never reached: "/users/me" already matched {user_id}
async def get_me(): ...
```
Routes are matched in the order they are declared. Declare `/users/me` first.

**Interview answer:** "FastAPI is a Python API framework built on Starlette and Pydantic. I write path operation functions with type hints and register them with decorators like app.get; FastAPI uses the hints to parse and validate path, query and body data, returns 422 for invalid input, serialises the result to JSON, and generates OpenAPI docs at /docs. I run it with fastapi dev locally and fastapi run or Uvicorn in production."

**Follow-ups:**
- *Why is it called "fast"?* It's fast to run (async, on Starlette and Pydantic's Rust core) and fast to write (less boilerplate, editor completion from types).

---

### Q10. What are `async`/`await` and the event loop?

**Short answer:** `async def` defines a **coroutine**: a function that can pause at an `await` while it waits for something slow (a database reply, an HTTP call) and let other code run in the meantime. The **event loop** is the scheduler that runs coroutines on a single thread: whenever one is waiting, it switches to another that is ready. This lets one process handle thousands of requests that spend most of their time waiting on I/O. It does not make CPU-heavy work faster.

**How it works:**
1. A request handler runs until it hits `await db.fetch(...)`.
2. The database call is sent; instead of sitting idle, the coroutine hands control back to the event loop.
3. The loop runs other handlers that are ready.
4. When the database reply arrives, the loop resumes the first handler right after its `await`.
5. If any code runs for a long time **without** awaiting (a blocking library call, `time.sleep`, heavy CPU), nothing else can run on that loop until it finishes.

Think of one waiter serving many tables: they take an order, hand it to the kitchen, and serve other tables while the food cooks. A waiter who stands at the kitchen door until each dish is ready (blocking) serves one table at a time.

**Example:**
```python
import asyncio, time

async def call_service(name: str, seconds: float):
    await asyncio.sleep(seconds)          # stands in for a network call
    return name

async def main():
    start = time.perf_counter()
    results = await asyncio.gather(call_service("a", 1), call_service("b", 1), call_service("c", 1))
    print(results, round(time.perf_counter() - start, 1))

asyncio.run(main())                       # ['a', 'b', 'c'] 1.0
```

**What happens, step by step:**
1. `gather` starts three coroutines. Each reaches `await asyncio.sleep(1)` and pauses.
2. The loop has nothing ready, so it waits; after about 1 second all three timers fire.
3. All three resume and return; total time is about **1.0 s**, not 3.
4. If you replaced `await asyncio.sleep(1)` with `time.sleep(1)` (blocking), each call would hold the thread: total **3.0 s**, and in a web server every other request would freeze during those seconds.

**Common mistake → fix:** forgetting `await`: `result = call_service("a", 1)` gives you a coroutine object, not `"a"`, and Python warns "coroutine was never awaited". Always `await` coroutines (or schedule them with `asyncio.create_task`).

**Interview answer:** "async def creates a coroutine that can pause at await while waiting for I/O. The event loop runs many coroutines on one thread and switches to another one whenever the current one is waiting, so one process can handle many concurrent I/O-bound requests. It's cooperative: any blocking call or long CPU work without an await freezes every other coroutine on that loop."

**Follow-ups:**
- *Concurrency vs parallelism?* Async gives concurrency (many tasks in progress, interleaved on one thread). Parallelism (tasks literally running at the same moment) needs multiple processes or threads.
- *Is async always faster?* No. For CPU-bound work it adds nothing; use processes or a worker queue.

---

### Q11. What are ASGI, WSGI and Uvicorn?

**Short answer:** **WSGI** (Web Server Gateway Interface) is the older Python standard between web servers and frameworks like Flask and classic Django: synchronous, one request per worker thread at a time. **ASGI** (Asynchronous Server Gateway Interface) is its async successor: one worker can interleave many requests on an event loop, and it supports long-lived connections like WebSockets and streaming. FastAPI is an ASGI app; **Uvicorn** is the ASGI server that runs it.

**How it works:**

| | WSGI | ASGI |
|---|---|---|
| Model | sync function per request | async callable with `receive`/`send` events |
| Concurrency per worker | one request per thread | many requests on one event loop |
| WebSockets / SSE | not natively | yes |
| Frameworks | Flask, classic Django | FastAPI, Starlette, Django (ASGI mode) |
| Servers | Gunicorn, uWSGI | Uvicorn, Hypercorn, Granian |

In production you run several **worker processes** (roughly one per CPU core) because each event loop uses one core: `fastapi run --workers 4`, `uvicorn app.main:app --workers 4`, or one process per container and scale containers.

**Example:**
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4 --proxy-headers
```

```flow
sequence: One ASGI worker interleaving two requests
actors: Request A, Event loop, Request B, Database
Request A -> Event loop: GET /jobs/1 starts its handler
Event loop -> Database: A awaits a 50 ms query
Request B -> Event loop: GET /health arrives and runs while A waits
Event loop --> Request B: 200 in 1 ms
Database --> Event loop: A's rows arrive and A resumes
Event loop --> Request A: 200 after about 50 ms
> A WSGI worker thread would have been stuck on A's query for the whole 50 ms. The ASGI loop used that time to answer B.
```

**What happens, step by step:**
1. Uvicorn starts 4 processes, each with its own event loop and its own copy of the app.
2. Request A awaits a 50 ms database query; its worker's loop is free.
3. Request B arrives on the same worker and is answered in 1 ms.
4. A resumes when its rows arrive. Per worker, thousands of I/O-bound requests can be in progress.

**Common mistake → fix:** running one Uvicorn worker on a 4-core container and wondering why CPU is at 25% while latency is high. One event loop uses one core. Run multiple workers (or more, smaller containers), and keep CPU-heavy work off the loop.

**Interview answer:** "WSGI is the synchronous standard: one request per worker thread. ASGI is the async standard, where a worker runs an event loop that interleaves many requests and supports WebSockets and streaming. FastAPI is an ASGI app and Uvicorn is the ASGI server; in production I run about one worker process per core, or one per container and scale containers."

**Follow-ups:**
- *Do you still need Gunicorn?* Not necessarily: Uvicorn has `--workers` and the `fastapi run` CLI wraps it. Gunicorn with Uvicorn workers is an older, still valid pattern.

---

### Q12. How does FastAPI read path parameters, query parameters, headers and the request body?

**Short answer:** FastAPI decides where each function parameter comes from by looking at its declaration. A name that appears in the path (`{doc_id}`) is a **path parameter**. A simple type (`int`, `str`, `bool`) not in the path is a **query parameter** (`?limit=20`). A **Pydantic model** is the JSON **body**. `Header()`, `Cookie()`, `Form()` and `File()` read those sources explicitly. Extra rules (min/max, patterns) go in `Annotated[..., Query(...)]` or `Path(...)`.

**How it works:**
1. Path: `@app.get("/documents/{doc_id}")` + `doc_id: str`.
2. Query: `limit: int = 20` (default makes it optional); `tag: list[str] = Query(default=[])` for `?tag=a&tag=b`.
3. Body: `body: DocumentIn` where `DocumentIn` is a Pydantic `BaseModel`.
4. Headers: `x_request_id: Annotated[str | None, Header()] = None` reads `X-Request-ID` (underscores become hyphens).
5. FastAPI converts strings to the declared types and validates the constraints; failures return `422`.

**Example:**
```python
from typing import Annotated
from fastapi import FastAPI, Path, Query, Header
from pydantic import BaseModel

class CommentIn(BaseModel):
    text: str
    rating: int | None = None

app = FastAPI()

@app.post("/documents/{doc_id}/comments", status_code=201)
async def add_comment(
    doc_id: Annotated[str, Path(pattern=r"^doc_[a-z0-9]+$")],
    body: CommentIn,
    notify: Annotated[bool, Query()] = False,
    x_request_id: Annotated[str | None, Header()] = None,
):
    return {"doc_id": doc_id, "text": body.text, "notify": notify, "request_id": x_request_id}
```

**What happens, step by step:**
Request: `POST /documents/doc_42/comments?notify=true` with header `X-Request-ID: r-1` and body `{"text": "Looks good", "rating": "5"}`.
1. `doc_id` = `"doc_42"`, which matches the pattern.
2. `notify` = `True` (the string `"true"` is converted to a bool).
3. The body is parsed into `CommentIn(text="Looks good", rating=5)`: Pydantic's default "lax" mode converts the string `"5"` to the int `5`.
4. `x_request_id` = `"r-1"`.
5. Response `201`: `{"doc_id": "doc_42", "text": "Looks good", "notify": true, "request_id": "r-1"}`.
6. Same request with path `/documents/42/comments` → `422`: `doc_id` doesn't match the pattern.

**Common mistake → fix:** expecting a plain `str` parameter to be read from the JSON body:
```python
@app.post("/login")
async def login(username: str, password: str): ...   # ❌ these are QUERY parameters
```
The client's JSON body is ignored and FastAPI returns `422` "field required" for the query parameters (and if the client does put them in the URL, the password ends up in logs). Use a Pydantic model (`body: LoginIn`) or `Annotated[str, Body()]` / `Form()`.

**Interview answer:** "FastAPI infers the source from the declaration: names in the path template are path parameters, simple types otherwise are query parameters, Pydantic models are the JSON body, and Header, Cookie, Form and File mark other sources. It converts strings to the declared types and enforces constraints declared with Annotated and Query or Path, returning 422 with field-level errors on failure."

**Follow-ups:**
- *Can I group query parameters into a model?* Yes: `filters: Annotated[DocFilters, Query()]` with a Pydantic model reads several query parameters at once.
- *How do you upload a file?* `file: UploadFile` (needs `python-multipart`); see Q27 for why large uploads should go direct to object storage.

---

### Q13. What is Pydantic, and how does FastAPI use it to validate requests?

**Short answer:** **Pydantic** is a Python library that validates data against classes you define with type hints. You write a `BaseModel` subclass describing the expected fields, types and rules; Pydantic checks incoming data, converts it to the right types, and raises a clear error listing every problem. FastAPI runs this automatically for request bodies and parameters and turns errors into a `422` response.

**How it works:**
1. Declare fields with types; add constraints with `Field(min_length=…, max_length=…, ge=…)`.
2. `Literal["fast", "accurate"]` restricts to exact values; `list[str]` validates every item.
3. `@field_validator` adds custom rules for one field; `@model_validator` checks combinations.
4. `model_config = ConfigDict(extra="forbid")` rejects unknown fields (the default ignores them).
5. Pydantic v2's core is written in Rust, so validation is fast.

**Example:**
```python
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator

class ChatIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str = Field(min_length=1, max_length=8000)
    document_ids: list[str] = Field(default_factory=list, max_length=20)
    mode: Literal["fast", "accurate"] = "fast"

    @field_validator("document_ids")
    @classmethod
    def unique_ids(cls, v: list[str]) -> list[str]:
        if len(set(v)) != len(v):
            raise ValueError("duplicate document ids")
        return v

@app.post("/v1/chat")
async def chat(body: ChatIn):
    return {"mode": body.mode, "docs": len(body.document_ids)}
```

**What happens, step by step:**
1. Body `{"message": "Summarise", "document_ids": ["d1", "d2"]}` → valid; `mode` defaults to `"fast"`; response `{"mode": "fast", "docs": 2}`.
2. Body `{"message": "", "mode": "slow", "is_admin": true}` → `422` with three errors in `detail`: `message` too short (`string_too_short`), `mode` not one of the literals (`literal_error`), `is_admin` not permitted (`extra_forbidden`).
3. Body with `document_ids: ["d1", "d1"]` → `422` with "Value error, duplicate document ids".
4. Your function only ever sees a valid `ChatIn` object.

**Common mistake → fix:** accepting `body: dict` (or a model with `extra="allow"`) and passing it straight to the database: `User(**body)`. A client can send `{"role": "admin"}` and set fields it should never control (**mass assignment**). Use a dedicated input model containing only client-editable fields, with `extra="forbid"`.

**Interview answer:** "Pydantic validates data against classes defined with type hints: types, constraints via Field, Literal values, custom field and model validators. FastAPI applies it to bodies and parameters and returns 422 with a structured list of every error, so handlers only receive valid objects. I use separate input models with extra forbid to prevent mass assignment."

**Follow-ups:**
- *Strict vs lax mode?* Lax (default) converts `"5"` to `5`; `ConfigDict(strict=True)` or `Field(strict=True)` rejects type mismatches.
- *How do you customise the 422 format?* Register a handler for `RequestValidationError` (Q18).

---

### Q14. What do response models and status codes do in FastAPI?

**Short answer:** A **response model** is a Pydantic model that describes what an endpoint returns. FastAPI uses it to **filter** the output (only declared fields are sent), **validate** it, and **document** it in OpenAPI. You declare it as the function's return type or with `response_model=`. The `status_code=` argument sets the success code (for example `201` for creates). Response models are your main protection against accidentally leaking internal fields.

**How it works:**
1. Your function returns an object (an ORM row, a dict, a model).
2. FastAPI converts it into the response model, dropping every field not declared there.
3. If a declared field is missing or has the wrong type, that's a server bug → `500` (your code returned bad data).
4. `response_model_exclude_none=True` removes `null` fields if you want shorter JSON.

**Example:**
```python
from pydantic import BaseModel, ConfigDict

class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)   # read from ORM object attributes
    id: str
    email: str

@app.post("/v1/users", status_code=201, response_model=UserOut)
async def create_user(body: UserIn, db: SessionDep):
    user = User(email=body.email, password_hash=hash_pw(body.password), is_admin=False)
    db.add(user)
    await db.commit()
    return user               # ORM object has password_hash and is_admin too
```

**What happens, step by step:**
1. The handler returns the `User` ORM object with `id`, `email`, `password_hash`, `is_admin`.
2. FastAPI validates it against `UserOut` using `from_attributes=True`.
3. Only `id` and `email` are serialised: the response is `201 {"id": "u_1", "email": "a@example.com"}`.
4. `password_hash` and `is_admin` never leave the server, even though the handler returned them.

**Common mistake → fix:** returning ORM objects or dicts with no response model (`return user` with no annotation and no `response_model`). FastAPI then serialises everything it can, including `password_hash`. Always declare an output model, separate from the input and database models.

**Interview answer:** "The response model, declared as the return type or response_model, is applied to whatever the handler returns: it filters to the declared fields, validates them, and documents the schema. I keep separate input, output and database models so secrets like password hashes can't leak, and set status_code explicitly, like 201 for creates and 204 for deletes."

**Follow-ups:**
- *What if I return a `Response` object directly?* FastAPI skips the response model and sends it as is, so you're responsible for its content.

---

### Q15. What is dependency injection, and how does `Depends` work?

**Short answer:** **Dependency injection** means a function declares what it needs ("a database session", "the current user") and the framework provides it, instead of the function creating it. In FastAPI you write the provider as a normal function and declare `Annotated[Session, Depends(get_db)]`. FastAPI runs the provider for each request, passes the result in, **caches** it so it runs once per request even if several parts need it, supports nested dependencies, and runs cleanup code after `yield`. Tests can swap any dependency with `app.dependency_overrides`.

**How it works:**
1. FastAPI builds a tree of dependencies from the endpoint's parameters.
2. It resolves leaves first (for example, the token from the header), then the dependencies that need them (the user), then the endpoint.
3. A dependency with `yield` is like a context manager: code before `yield` runs before the endpoint, code after runs once the response is done (close the session).
4. Dependencies can raise `HTTPException` to stop the request (`401`, `404`).

**Example:**
```python
from collections.abc import AsyncIterator
from typing import Annotated
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session                                  # closed after the response

async def get_current_user(token: Annotated[str, Depends(oauth2_scheme)]) -> User:
    return verify_jwt(token)                            # raises 401 if invalid

SessionDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]

async def get_owned_document(doc_id: str, user: CurrentUser, db: SessionDep) -> Document:
    doc = await db.get(Document, doc_id)
    if not doc or doc.tenant_id != user.tenant_id:
        raise HTTPException(404)                        # don't reveal other tenants' docs
    return doc

OwnedDocument = Annotated[Document, Depends(get_owned_document)]

@app.get("/v1/documents/{doc_id}")
async def read_document(doc: OwnedDocument, db: SessionDep):
    return doc
```

```flow
trace: Resolving GET /v1/documents/d1 for user u1 in tenant t1
oauth2_scheme reads the header: token = **eyJ…** > The leaf dependency extracts the bearer token, or returns 401 if it is missing.
get_current_user verifies it: user = **User(u1, tenant t1)** > Sub-dependencies always run before the dependencies that need them.
get_db yields: session = **Session#1** > The endpoint also asks for SessionDep, but the cached Session#1 is reused, not a second one.
get_owned_document loads d1: tenant t1 matches, doc = **Document(d1)** > The ownership check lives in one reusable dependency.
read_document returns d1, then get_db closes Session#1 > Code after yield runs when the response is finished.
```

**What happens, step by step:**
1. The token `eyJ…` is read from `Authorization: Bearer eyJ…`.
2. It's verified; the user is `u1` in tenant `t1`.
3. `get_db` opens `Session#1`. Both `get_owned_document` and the endpoint asked for `SessionDep`, but it runs once and both get `Session#1`.
4. Document `d1` belongs to `t1`, so it's returned to the endpoint.
5. After the response, the code after `yield` closes `Session#1`. If `d1` belonged to `t2`, step 4 would raise `404` and the endpoint would never run.

**Common mistake → fix:** creating clients inside each endpoint (`session = SessionLocal()` with no close, or `httpx.AsyncClient()` per request). You leak connections and duplicate auth checks across endpoints. Put creation and cleanup in `yield` dependencies (or the lifespan, Q16), and put authorisation in reusable dependencies like `OwnedDocument`.

**Interview answer:** "Depends lets an endpoint declare what it needs; FastAPI resolves the dependency tree per request, sub-dependencies first, caches each result within the request, and runs code after yield for cleanup. I use it for database sessions, the current user from the token, resource ownership checks and pagination parameters, and in tests I swap any of them with app.dependency_overrides."

**Follow-ups:**
- *How do you apply a dependency to all routes in a router?* `APIRouter(dependencies=[Depends(get_current_user)])` or the same argument on `include_router`.
- *How do you disable caching?* `Depends(dep, use_cache=False)`.

---

### Q16. What is the lifespan, and what belongs in startup and shutdown?

**Short answer:** The **lifespan** is a function that runs once when the app starts and once when it stops. Code before `yield` runs at startup (create a database engine, an HTTP client with a connection pool, load configuration or a model); code after `yield` runs at shutdown (close those clients, flush telemetry). Shared resources created here are reused by every request instead of being created per request.

**How it works:**
1. Uvicorn starts the worker and sends a "lifespan startup" event.
2. FastAPI runs your lifespan up to `yield`. If it raises, the worker fails to start, which is what you want for bad config.
3. Requests are served; handlers reach shared objects through `request.app.state` or dependencies.
4. On `SIGTERM` (a container stop), Uvicorn stops accepting new connections, finishes in-flight requests, then runs the code after `yield`.

**Example:**
```python
from contextlib import asynccontextmanager
import httpx

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http = httpx.AsyncClient(timeout=httpx.Timeout(10.0))
    app.state.engine = create_async_engine(settings.database_url, pool_size=10)
    yield
    await app.state.http.aclose()
    await app.state.engine.dispose()

app = FastAPI(lifespan=lifespan)

def get_http(request: Request) -> httpx.AsyncClient:
    return request.app.state.http
```

**What happens, step by step:**
1. Container starts → lifespan creates one `AsyncClient` (with a connection pool) and one engine with 10 pooled connections.
2. 1,000 requests reuse that client: TCP and TLS connections are kept alive and reused, so each call skips the handshake.
3. Deployment sends `SIGTERM` → Uvicorn drains in-flight requests, then the lifespan closes the client and disposes the engine, returning connections to the database cleanly.

**Common mistake → fix:** using the deprecated `@app.on_event("startup")` alongside a lifespan (FastAPI ignores `on_event` handlers when a lifespan is set), or creating `httpx.AsyncClient()` per request. Use one lifespan for all startup/shutdown work and share clients from it.

**Interview answer:** "The lifespan is an async context manager passed to FastAPI: before yield I create shared resources like the database engine and HTTP client pools, and after yield I close them. It runs once per worker, failures abort startup, and shutdown code runs after Uvicorn drains requests on SIGTERM. It replaces the old on_event startup and shutdown hooks."

**Follow-ups:**
- *Is the lifespan per process?* Yes. With 4 workers you get 4 engines, so 4 × pool size connections (Q35).

---

### Q17. How do you structure a larger FastAPI project with routers?

**Short answer:** Split endpoints into **`APIRouter`** objects, one per resource (documents, jobs, users), and include them in the main app with a prefix and tags. Keep business logic in plain Python service functions with no FastAPI imports, data access in repositories, and Pydantic schemas in their own module. This keeps endpoints thin and the logic testable.

**How it works:**
1. Each router declares its routes relative to its own prefix.
2. `app.include_router(router, prefix="/v1", tags=[...], dependencies=[...])` mounts it; shared dependencies (like auth) can be applied to the whole router.
3. Endpoints parse input, call a service, and return output models.

**Example:**
```
app/
├── main.py            # create app, lifespan, middleware, include routers
├── api/v1/
│   ├── documents.py   # router = APIRouter(prefix="/documents", tags=["documents"])
│   └── jobs.py
├── core/              # settings, security, logging
├── services/          # business logic, no FastAPI imports
├── repositories/      # database access
├── schemas/           # Pydantic input/output models
└── tests/
```
```python
# app/api/v1/documents.py
router = APIRouter(prefix="/documents", tags=["documents"])

@router.get("/{doc_id}", response_model=DocumentOut)
async def read_document(doc: OwnedDocument):
    return doc

# app/main.py
app = FastAPI(lifespan=lifespan)
app.include_router(documents.router, prefix="/v1", dependencies=[Depends(get_current_user)])
```

**What happens, step by step:**
1. The final path is `/v1` + `/documents` + `/{doc_id}` = `/v1/documents/{doc_id}`.
2. Every route in the router requires authentication because of the `include_router` dependency.
3. The OpenAPI docs group these endpoints under the "documents" tag.
4. A unit test can call `services.documents.rename(...)` directly without starting FastAPI.

**Common mistake → fix:** putting SQL queries, external calls and business rules directly in endpoint functions. The same rule is then copied into several endpoints and can only be tested through HTTP. Move it into a service function and call that from the endpoint.

**Interview answer:** "I use one APIRouter per resource with its own prefix and tags, mounted under /v1 with shared dependencies like authentication. Endpoints stay thin: validate input, call a framework-free service, return an output model. Repositories hold data access and schemas hold Pydantic models, so business logic is reusable and unit-testable."

**Follow-ups:**
- *Where do you put cross-cutting dependencies?* In `core/` or `api/deps.py`, exported as `Annotated` aliases like `CurrentUser` and `SessionDep`.

---

### Q18. How do you handle errors in FastAPI?

**Short answer:** For expected problems, raise **`HTTPException(status_code, detail)`** and FastAPI turns it into a JSON response. For your own domain errors (like `QuotaExceeded`), register an **exception handler** that maps them to a status code and a consistent error body. Unexpected exceptions become a generic `500`; log the full stack trace with the request ID, but never send internal details to the client.

**How it works:**
1. `raise HTTPException(404, "Document not found")` → `{"detail": "Document not found"}` with status 404.
2. `@app.exception_handler(QuotaExceeded)` catches that exception type anywhere in the request and returns your response.
3. `RequestValidationError` (invalid input) has a default handler returning `422`; you can override it to match your error format.
4. Anything else → Starlette's server error handling returns `500 Internal Server Error`.

**Example:**
```python
class QuotaExceeded(Exception):
    def __init__(self, tenant_id: str, retry_after: int):
        self.tenant_id, self.retry_after = tenant_id, retry_after

@app.exception_handler(QuotaExceeded)
async def quota_handler(request: Request, exc: QuotaExceeded):
    return JSONResponse(
        status_code=429,
        headers={"Retry-After": str(exc.retry_after)},
        media_type="application/problem+json",
        content={"type": "https://api.example.com/errors/quota-exceeded",
                 "title": "Quota exceeded", "status": 429,
                 "detail": "Daily token quota used", "instance": str(request.url.path)},
    )

# in a service
if usage >= limit:
    raise QuotaExceeded(tenant_id, retry_after=3600)
```

**What happens, step by step:**
1. A service deep in the call stack raises `QuotaExceeded("t-42", 3600)`.
2. FastAPI finds the registered handler for that type.
3. The client receives `429`, `Retry-After: 3600`, and a Problem Details body.
4. The service code doesn't import FastAPI or know about HTTP; the mapping lives in one place.

**Common mistake → fix:** returning exception text to clients, for example `raise HTTPException(500, str(e))`. That can leak SQL, file paths, internal hostnames or secrets. Log `logger.exception(...)` with the request ID, and return a generic message plus that request ID so support can find the log.

**Interview answer:** "I raise HTTPException for expected HTTP errors, define domain exceptions in services and map them to status codes with exception handlers using a consistent RFC 9457 Problem Details body, and customise the RequestValidationError handler if needed. Unexpected errors return a generic 500 with a request ID, while the full stack trace goes to the logs only."

**Follow-ups:**
- *Do dependencies' exceptions get handled the same way?* Yes; an exception raised in a dependency goes through the same handlers.

---

### Q19. What is middleware, and when should you use it instead of a dependency?

**Short answer:** **Middleware** is code that wraps **every** request and response: it runs before routing and after the endpoint, like layers of an onion. Use it for cross-cutting concerns that apply to everything: request IDs, access logs and timing, CORS, compression, security headers. Use **dependencies** for anything that depends on the specific route or its parameters, like authentication rules and resource ownership checks.

**How it works:**
1. Middleware added last is the **outermost**: it runs first on the way in and last on the way out.
2. Each middleware calls `call_next(request)` to pass the request inward and receives the response on the way out.
3. Middleware doesn't know which endpoint will match or what its parameters are; dependencies do.
4. `@app.middleware("http")` is easy but is built on `BaseHTTPMiddleware`; for high throughput or streaming responses, a "pure ASGI" middleware class is more efficient.

**Example:**
```python
import time, uuid, structlog

@app.middleware("http")
async def request_context(request: Request, call_next):
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex
    structlog.contextvars.bind_contextvars(request_id=rid)
    start = time.perf_counter()
    response = await call_next(request)
    response.headers["x-request-id"] = rid
    structlog.get_logger().info("request", path=request.url.path,
                                status=response.status_code,
                                ms=round((time.perf_counter() - start) * 1000))
    return response
```

**What happens, step by step:**
1. `GET /v1/documents/d1` arrives without an `x-request-id`; the middleware creates `9f2c…` and binds it to the logging context.
2. `call_next` runs routing, dependencies and the endpoint; every log line inside includes `request_id=9f2c…`.
3. The response comes back (200); the middleware adds the `x-request-id` header and logs `status=200 ms=37`.
4. If the endpoint raised `HTTPException(404)`, the middleware still sees the 404 response and logs it.

**Common mistake → fix:** doing authorisation in middleware by parsing URL paths (`if request.url.path.startswith("/admin")`). It's fragile (a new route or a path variant bypasses it) and can't see the resource being accessed. Authenticate in a dependency attached to routers, and authorise per resource in dependencies or services.

**Interview answer:** "Middleware wraps every request like an onion, so I use it for cross-cutting work: request IDs, structured access logs and timing, CORS, compression and security headers. Route-specific logic like authentication requirements and per-resource authorisation goes into dependencies, because they know the route and its parameters. For streaming or high-throughput apps I prefer pure ASGI middleware over BaseHTTPMiddleware."

**Follow-ups:**
- *In what order do `add_middleware` calls run?* The last added is outermost, so add CORS last if it must handle preflights before anything else.

---

### Q20. What is OpenAPI, and what does FastAPI generate from it?

**Short answer:** **OpenAPI** is a standard, machine-readable description (JSON or YAML) of an HTTP API: its paths, methods, parameters, request and response schemas, and authentication. FastAPI generates it automatically from your routes, type hints and Pydantic models at `/openapi.json`, and serves interactive documentation at `/docs` (Swagger UI) and `/redoc` (ReDoc). Teams use it as the contract between frontend and backend and to generate typed client code.

**How it works:**
1. FastAPI walks every route at startup and builds the schema from parameter types, models, `status_code`, `response_model`, `tags` and docstrings.
2. `responses={404: {"model": ProblemDetail}}` documents extra outcomes.
3. Tools read `/openapi.json` to generate TypeScript types or SDKs, run contract tests, or import the API into a gateway.

**Example:**
```python
@app.get("/v1/documents/{doc_id}", response_model=DocumentOut, tags=["documents"],
         responses={404: {"model": ProblemDetail, "description": "Not found or not yours"}})
async def read_document(doc: OwnedDocument):
    """Return one document owned by the caller's tenant."""
    return doc
```
```bash
npx openapi-typescript http://localhost:8000/openapi.json -o src/api/schema.d.ts
```

**What happens, step by step:**
1. `/openapi.json` contains the path `/v1/documents/{doc_id}`, the `DocumentOut` schema for 200, and `ProblemDetail` for 404.
2. The frontend generates `schema.d.ts`; `DocumentOut` becomes a TypeScript type.
3. A backend developer renames a field; regenerating types in CI makes the frontend build fail where the old field was used, instead of failing in production.

**Common mistake → fix:** leaving `/docs` and `/openapi.json` open on a public production API that should be private: it hands attackers a full map of endpoints. Disable them (`FastAPI(docs_url=None, redoc_url=None, openapi_url=None)`) or put them behind authentication; publish the schema through CI instead.

**Interview answer:** "OpenAPI is a standard machine-readable API description. FastAPI generates it from routes, type hints and Pydantic models and serves Swagger UI at /docs and ReDoc at /redoc. I use the schema as the frontend contract, generate TypeScript types from it, diff it in CI to catch breaking changes, and restrict the docs in production when the API isn't public."

**Follow-ups:**
- *Does the docs page add security?* No; the "Authorize" button is only a convenience for testing. Security comes from the dependencies.

---

### Q21. How do you manage settings and configuration?

**Short answer:** Use **`pydantic-settings`**: a `BaseSettings` class declares every setting with a type and default, and its values are read from environment variables (and optionally a `.env` file in development). Settings are validated once at startup, so a missing or malformed value stops the app immediately instead of failing on the first request. Secrets come from a secrets manager or are injected as environment variables at runtime, never baked into the image or committed.

**How it works:**
1. Declare fields: `database_url: str`, `request_timeout_s: float = 10`.
2. `SettingsConfigDict(env_prefix="APP_")` maps `APP_DATABASE_URL` to `database_url`.
3. Values are converted and validated like any Pydantic model.
4. Create the settings object once (for example with `@lru_cache`) and inject it with `Depends`, which makes it easy to override in tests.

**Example:**
```python
from functools import lru_cache
from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="APP_", env_file=".env")
    database_url: SecretStr
    auth_issuer: str
    auth_audience: str
    request_timeout_s: float = 10.0
    allowed_origins: list[str] = ["https://app.example.com"]

@lru_cache
def get_settings() -> Settings:
    return Settings()

SettingsDep = Annotated[Settings, Depends(get_settings)]
```

**What happens, step by step:**
1. The container has `APP_DATABASE_URL=postgresql+asyncpg://…`, `APP_AUTH_ISSUER=https://id.example.com`, `APP_AUTH_AUDIENCE=api`, and `APP_REQUEST_TIMEOUT_S=5`.
2. `Settings()` reads them; `request_timeout_s` becomes the float `5.0`; `allowed_origins` keeps its default.
3. `APP_AUTH_AUDIENCE` is missing in a new environment → startup fails with "Field required: auth_audience". The bad deployment never receives traffic.
4. Logging `settings` shows `database_url=SecretStr('**********')`, so the password isn't printed.

**Common mistake → fix:** reading `os.environ["X"]` all over the codebase. Missing values only fail when that line runs (maybe in production at 3 a.m.), types aren't converted, and tests must patch the environment. Centralise in one validated `Settings` class.

**Interview answer:** "I use pydantic-settings: one typed Settings class read from environment variables with a prefix, validated at startup so misconfiguration fails fast, cached and injected with Depends so tests can override it. Secrets use SecretStr so they don't appear in logs and come from a secrets manager or runtime environment, never from the image or the repository."

**Follow-ups:**
- *Why `lru_cache`?* So the environment is read and validated once, not on every request.

---

## 4. Async, streaming & background work

### Q22. Why do blocking calls inside `async def` endpoints cause trouble?

**Short answer:** An `async def` endpoint runs **on the event loop**. If it calls something that blocks the thread (`requests.get`, `time.sleep`, a synchronous database driver, `boto3`, heavy CPU work), the loop can't run anything else until the call returns, so **every other request on that worker stalls**. Fix it by using an async library, by moving the blocking call to a thread (`asyncio.to_thread`), or by declaring the endpoint with plain `def` so FastAPI runs it in its threadpool.

**How it works:**
1. `async def` handlers share one thread (the loop). They cooperate: each must `await` while waiting.
2. A blocking call never yields, so the loop is frozen for its whole duration.
3. A plain `def` endpoint is run by FastAPI in a **threadpool** (AnyIO, about 40 threads by default), so blocking inside it only blocks that thread.
4. `await asyncio.to_thread(func, *args)` does the same for one call inside an async handler.
5. CPU-heavy work (PDF parsing, embeddings) does not benefit from threads because of Python's GIL (global interpreter lock); use a process pool or a worker queue.

**Example:**
```python
import asyncio, time, boto3, httpx

s3 = boto3.client("s3")

@app.get("/bad")
async def bad():
    time.sleep(2)                               # ❌ blocks the loop for 2 s
    return "done"

@app.get("/documents/{key}/text")
async def get_text(key: str):
    obj = await asyncio.to_thread(s3.get_object, Bucket=BUCKET, Key=key)   # ✅ thread
    body = await asyncio.to_thread(obj["Body"].read)
    return {"text": body.decode()}

@app.get("/weather")
async def weather(client: HttpDep):
    r = await client.get("https://api.example.com/w")   # ✅ native async client
    return r.json()
```

```flow
trace: One blocking call freezes the whole worker
t=0 s: request A calls time.sleep(2) inside async def > The loop is now stuck inside A's call and cannot switch to anything else.
t=0.1 s to 2 s: requests B and C arrive on the same worker > They are accepted by the OS but their handlers cannot start. Even GET /health waits.
t=2 s: A finishes > Only now does the loop run B and C. Each of them waited almost 2 s for work that takes 5 ms.
fix: await asyncio.to_thread(...) or use def > The blocking call moves to a separate thread, so the loop keeps serving B and C.
```

**What happens, step by step:**
1. Request A (`/bad`) starts and sleeps 2 s without yielding.
2. B (`/health`) arrives at 0.1 s; its handler can't start, so it responds at about 2.0 s instead of 5 ms.
3. Under load, this adds up: a burst of 10 slow calls on one worker delays everything on it by up to 20 s. That's why average latency looks fine while p99 (the 99th percentile, the slowest 1%) explodes.
4. With `await asyncio.to_thread(time.sleep, 2)` the loop is free during those 2 s; B answers in 5 ms.

**Common mistake → fix:** thinking `async def` makes any code non-blocking. The keyword allows `await`; it doesn't change what the body does. Use `def` for endpoints that only use blocking libraries (simplest), and `async def` only when everything inside is awaited.

**Interview answer:** "async def endpoints run on the event loop, so a blocking call freezes every request on that worker. I use async libraries like httpx and asyncpg, or run blocking code with asyncio.to_thread, or declare the endpoint with plain def so FastAPI uses its threadpool. CPU-heavy work goes to a process pool or a queue. A symptom is fine p50 but terrible p99."

**Follow-ups:**
- *How do you detect it?* Measure event-loop lag (a periodic task that checks how late it wakes up), or run with `PYTHONASYNCIODEBUG=1` / `asyncio` debug mode to log slow callbacks.

---

### Q23. What are Server-Sent Events (SSE), and how do you stream LLM tokens with FastAPI?

**Short answer:** **Server-Sent Events (SSE)** is a standard way for a server to push a stream of messages to a browser over a normal HTTP response with `Content-Type: text/event-stream`. The connection stays open and the server writes events as they happen, which is ideal for streaming an LLM's answer token by token. The browser's `EventSource` reconnects automatically and sends the last event ID in a `Last-Event-ID` header. FastAPI supports it with `EventSourceResponse` and `ServerSentEvent`.

**How it works:**
1. The client makes a request; the server replies `200` with `text/event-stream` and does not finish the response.
2. Each event is text: optional `event:` (type), `data:` (JSON payload), `id:`; events end with a blank line.
3. FastAPI sends a keep-alive comment (a `ping`) every 15 seconds when nothing else is sent, sets `Cache-Control: no-cache`, and sets `X-Accel-Buffering: no` so Nginx doesn't buffer the stream.
4. Your endpoint is an `async` generator: each `yield` becomes one event. `data` is always JSON-encoded (a plain string is sent quoted).
5. If the client disconnects, stop the upstream work so you don't pay for unused tokens.

**Example:**
```python
from collections.abc import AsyncIterable
from fastapi.sse import EventSourceResponse, ServerSentEvent

@app.post("/v1/conversations/{conv_id}/stream", response_class=EventSourceResponse)
async def stream(conv: OwnedConversation, body: ChatIn, request: Request) -> AsyncIterable[ServerSentEvent]:
    seq = 0
    async for token in llm.astream(body.message):
        if await request.is_disconnected():
            await llm.cancel(); return                 # stop paying for tokens
        seq += 1
        yield ServerSentEvent(data={"text": token}, event="token", id=f"{conv.id}:{seq}")
    yield ServerSentEvent(data={"ok": True}, event="done")
```
Browser side (a `POST` with an `Authorization` header can't use `EventSource`, so read the stream with `fetch`):
```ts
const res = await fetch(`/api/v1/conversations/${id}/stream`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ message }),
});
const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
for (;;) { const { value, done } = await reader.read(); if (done) break; render(value); }
```

```flow
sequence: Streaming an answer over SSE
actors: Browser, FastAPI, LLM
Browser -> FastAPI: POST /v1/conversations/c1/stream with the message
FastAPI -> LLM: start a streaming completion
LLM --> FastAPI: token "Hel"
FastAPI --> Browser: event token, data {"text":"Hel"}, id c1:1
LLM --> FastAPI: token "lo"
FastAPI --> Browser: event token, data {"text":"lo"}, id c1:2
> The browser can show "Hello" while the model is still generating, so the user sees progress right away.
FastAPI --> Browser: event done
> The final event tells the client to stop reading. Idle gaps are filled with keep-alive pings every 15 s so proxies don't close the connection.
```

**What happens, step by step:**
1. The browser posts the message; FastAPI replies `200 text/event-stream` immediately.
2. The LLM yields `"Hel"`; FastAPI writes `event: token`, `data: {"text":"Hel"}`, `id: c1:1` and a blank line; the UI appends "Hel".
3. `"lo"` follows as event `c1:2`. The UI shows "Hello".
4. The user closes the tab at token 40; `request.is_disconnected()` becomes true on the next loop and the code cancels the LLM call.
5. If the connection drops and `EventSource` reconnects, it sends `Last-Event-ID: c1:40`; the server can resume from event 41 if it stored the events.

**Common mistake → fix:** buffering the stream, so the user sees nothing until the end. Causes: collecting the whole answer before `yield`, gzip middleware that buffers, or a proxy (Nginx, CDN) with response buffering on. Yield each chunk, exempt the stream from compression middleware, and disable buffering at the proxy.

**Interview answer:** "SSE is a one-way server-to-client stream over a normal HTTP response with text/event-stream; the server writes events as they're produced. In FastAPI I return EventSourceResponse from an async generator that yields ServerSentEvent objects; FastAPI adds keep-alive pings every 15 seconds and no-cache and no-buffering headers. I stop the upstream LLM call on disconnect, give events IDs so clients can resume, and use fetch streaming when I need POST or an Authorization header."

**Follow-ups:**
- *Why does SSE get cut after exactly 60 s?* A load balancer idle timeout; see the scenario about SSE dropping through the ALB.
- *Can I use `StreamingResponse` instead?* Yes, setting the media type and formatting events yourself; `EventSourceResponse` does the formatting and keep-alives for you.

---

### Q24. WebSockets or SSE: which should you use?

**Short answer:** Use **SSE** when only the server sends data (token streaming, progress updates, notifications): it is plain HTTP, reconnects automatically and passes through proxies easily. Use **WebSockets** when both sides send messages at any time over one connection (collaborative editing, voice, games, chat with interrupts). WebSockets give you full-duplex freedom but you must handle reconnects, authentication and scaling yourself.

**How it works:**

| | SSE | WebSocket |
|---|---|---|
| Direction | server to client | both ways |
| Protocol | HTTP response that stays open | HTTP `Upgrade` to the WebSocket protocol |
| Reconnect | built into `EventSource` (`Last-Event-ID`) | you implement it |
| Proxies / load balancers | work like normal HTTP; mind idle timeouts | need WebSocket support; sticky or stateful |
| Scaling | stateless per request | need to track which server holds which connection |
| Typical use | LLM tokens, job progress | collaboration, voice, bidirectional chat |

**Example:**
```python
from fastapi import WebSocket, WebSocketDisconnect

@app.websocket("/ws/rooms/{room}")
async def room(ws: WebSocket, room: str):
    await ws.accept()
    try:
        while True:
            msg = await ws.receive_text()          # client to server, any time
            await ws.send_text(f"{room}: {msg}")   # server to client, any time
    except WebSocketDisconnect:
        pass
```

**What happens, step by step:**
1. The browser sends an HTTP request with `Upgrade: websocket`; FastAPI replies `101 Switching Protocols` after `accept()`.
2. From now on both sides send frames whenever they like.
3. If a mobile client loses network, the socket closes; you must reconnect, re-authenticate and re-sync missed messages yourself.
4. With 3 API containers behind a load balancer, a message from a user on container 1 doesn't reach a user connected to container 2 unless you add a broadcast layer (for example Redis pub/sub).

**Common mistake → fix:** using WebSockets just to stream an LLM answer. You take on connection state, reconnect logic and scaling for something SSE does in plain HTTP. Choose the simplest transport that fits: SSE for one-way, WebSockets only when the client must push messages continuously.

**Interview answer:** "SSE is one-way over plain HTTP with built-in reconnect, so it's my default for token streaming and progress. WebSockets are full-duplex, which I need for collaboration, voice or interrupts, but they mean managing reconnects, authentication and cross-instance fan-out myself. Both need idle-timeout tuning at the load balancer."

**Follow-ups:**
- *How do you authenticate a WebSocket?* Browsers can't set custom headers on the WebSocket handshake, so use a short-lived token in the query string or a first message, or a cookie.

---

### Q25. What is `BackgroundTasks`, and what are its limits?

**Short answer:** `BackgroundTasks` lets an endpoint schedule a function to run **after the response has been sent**, in the same process. It suits small fire-and-forget work such as sending an email or writing an audit log. It is **not durable**: if the container restarts, scales in or crashes, the task is lost, there are no retries and no status. For important or long work, put a message on a queue (SQS, Celery, RQ) and process it in a separate worker.

**How it works:**
1. The endpoint adds a task: `background_tasks.add_task(send_email, to, subject)`.
2. FastAPI sends the response to the client.
3. Then it runs the task in the same worker process (in the event loop for `async def`, in the threadpool for `def`).
4. If the process dies, the task disappears; nothing records that it was supposed to run.

**Example:**
```python
from fastapi import BackgroundTasks

def send_welcome(email: str) -> None:
    mailer.send(email, "Welcome!")                 # small, best-effort

@app.post("/v1/signup", status_code=201)
async def signup(body: SignupIn, tasks: BackgroundTasks, db: SessionDep):
    user = await create_user(db, body)
    tasks.add_task(send_welcome, user.email)
    return {"id": user.id}
```

```flow
sequence: What BackgroundTasks does and does not guarantee
actors: Client, FastAPI worker
Client -> FastAPI worker: POST /v1/signup
FastAPI worker --> Client: 201 returned immediately
FastAPI worker -> FastAPI worker: runs send_welcome after the response
> If the container is redeployed in the next second, the email is never sent and nothing records that it was pending. Use a queue for anything that must happen.
```

**What happens, step by step:**
1. `POST /v1/signup` creates the user and schedules `send_welcome("a@example.com")`.
2. The `201` is sent; the client sees a fast response.
3. The worker then sends the email (about 300 ms).
4. If a deployment replaces the container at that moment, the task is killed halfway: no email, no retry, no log entry.
5. With a queue, the signup transaction would also write a message (or outbox row); a separate worker would retry until the email is sent.

**Common mistake → fix:** using it for long or critical jobs (report generation, billing, document processing). A 5-minute task ties up the worker's capacity, and a restart loses it. Use a durable queue and a worker, return `202` with a job ID (Q26).

**Interview answer:** "BackgroundTasks runs a function after the response in the same process, which is fine for small best-effort work like emails or audit logs. It isn't durable: restarts lose the task, there are no retries or visibility, and long tasks consume the web worker. For anything important I enqueue to SQS or a similar queue and process it in a separate worker."

**Follow-ups:**
- *How do you avoid losing a queue message if the DB commit succeeds but the enqueue fails?* The outbox pattern: write the message to an outbox table in the same transaction, and a relay publishes it.

---

### Q26. How do you design an API for long-running jobs?

**Short answer:** Don't make the client wait on one long request. Accept the work, store a **job** record, put a message on a **queue**, and immediately return **`202 Accepted`** with a job ID and a status URL. A separate **worker** processes the job and updates its status. The client polls `GET /v1/jobs/{id}` or listens to progress over SSE. The job record, not the HTTP connection, is the source of truth, so clients can refresh or reconnect at any time.

**How it works:**
1. `POST /v1/jobs` with an `Idempotency-Key` (Q05): validate, authorise, insert the job as `PENDING`.
2. Enqueue the job ID (via an outbox so the DB row and queue message can't diverge).
3. Return `202` with `{job_id, status_url}`.
4. A worker receives the message, **claims** the job with a conditional update (`PENDING` to `RUNNING` only if still `PENDING`), processes it, reports progress, and writes a final state (`DONE` or `FAILED`).
5. Failures retry with exponential backoff; messages that keep failing go to a **dead-letter queue (DLQ)** for inspection.
6. Results are stored in object storage; the API returns short-lived presigned links.

**Example:**
```
POST /v1/jobs                    → 202 {"id": "job_789", "status": "PENDING", "status_url": "/v1/jobs/job_789"}
GET  /v1/jobs/job_789            → 200 {"status": "RUNNING", "progress": 40}
GET  /v1/jobs/job_789/events     → SSE progress stream
POST /v1/jobs/job_789/cancel     → 202 (idempotent)
GET  /v1/jobs/job_789            → 200 {"status": "DONE", "result_url": "https://…presigned…"}
```

```flow
sequence: Submit, process and poll a job
actors: Client, API, Queue, Worker
Client -> API: POST /v1/jobs with Idempotency-Key k1
API -> API: validate, authorise, insert job_789 as PENDING
API -> Queue: enqueue job_789
API --> Client: 202 with job id job_789 and status_url
> The client is free after milliseconds; the work happens elsewhere.
Worker -> Queue: receive job_789
Worker -> Worker: claim with UPDATE status RUNNING WHERE status PENDING, then process
Client -> API: GET /v1/jobs/job_789
API --> Client: RUNNING, progress 40
Worker -> API: final state DONE written with result location
> A failed attempt is retried with backoff; after the maximum attempts it goes to the dead-letter queue and the job becomes FAILED.
```

**What happens, step by step:**
1. The client posts; job `job_789` exists as `PENDING`; the client receives `202` in about 20 ms.
2. The worker claims it: `UPDATE jobs SET status='RUNNING' WHERE id='job_789' AND status='PENDING'`. If the queue delivers the message twice, the second worker updates zero rows and skips it.
3. The worker updates `progress` every few seconds; the client sees 40.
4. The worker crashes at 70%; the queue's visibility timeout expires, the message is redelivered and another worker retries (the processing must be idempotent).
5. Success: status `DONE`, result URL saved. The client's next poll returns it.

**Common mistake → fix:** doing the work in the request (`await process(doc)` for 4 minutes). Load balancer and client timeouts (often 60 s) kill the request while the work continues invisibly, then the client retries and creates a duplicate. Return `202` and make the job observable.

**Interview answer:** "For long work I return 202 with a job ID. The API validates, inserts a PENDING job and enqueues through an outbox; a worker claims it with a conditional update, processes it with retries and backoff, sends poison messages to a DLQ and always writes a final state. Clients poll or stream progress, results are presigned links, and Idempotency-Keys stop duplicate submissions."

**Follow-ups:**
- *Polling or SSE?* Polling is simplest and robust; SSE gives live progress. Both read the same job record.

---

### Q27. How should file uploads work without sending the bytes through your API?

**Short answer:** Have the API return a **presigned URL**: a short-lived, signed link that lets the browser upload straight to object storage (S3). The API only authorises the upload and records the metadata; the file bytes never pass through your workers. This avoids tying up workers, request-size limits and memory use. After upload, S3 emits an event that triggers validation and scanning, and the API marks the file `READY`.

**How it works:**
1. The client asks `POST /v1/uploads` with name, size and content type.
2. The API checks permissions and limits, chooses the storage key itself (`tenant/t1/uploads/<uuid>`), and creates a **presigned POST** with conditions: `content-length-range`, exact content type, expiry of a few minutes.
3. The browser uploads directly to S3 with that policy.
4. S3 notifies a worker (event), which validates the content by magic bytes, scans for malware, and marks the record `READY` or `REJECTED`.
5. If you must accept files in FastAPI, use `UploadFile` (spools large files to disk), enforce a size limit while reading, and never trust the file name or declared content type.

**Example:**
```python
@app.post("/v1/uploads", status_code=201)
async def create_upload(body: UploadIn, user: CurrentUser, db: SessionDep):
    key = f"tenant/{user.tenant_id}/uploads/{uuid4()}"
    post = await asyncio.to_thread(
        s3.generate_presigned_post, Bucket=BUCKET, Key=key,
        Fields={"Content-Type": body.content_type},
        Conditions=[["content-length-range", 1, 50_000_000], {"Content-Type": body.content_type}],
        ExpiresIn=300)
    db.add(Upload(id=key, tenant_id=user.tenant_id, status="PENDING"))
    await db.commit()
    return {"upload_id": key, "url": post["url"], "fields": post["fields"]}
```

```flow
sequence: Direct-to-S3 upload
actors: Browser, API, S3, Worker
Browser -> API: POST /v1/uploads with name, size and content type
API --> Browser: presigned POST for key tenant/t1/uploads/u9, size limit 50 MB, valid 5 minutes
> The API never touches the file; it only signs permission for one exact key.
Browser -> S3: POST the file with the signed fields
S3 -> Worker: ObjectCreated event for u9
Worker -> Worker: check magic bytes, scan for malware
Worker -> API: mark upload u9 READY
> A file that fails validation is marked REJECTED and deleted.
```

**What happens, step by step:**
1. The browser asks to upload `report.pdf` (2 MB, `application/pdf`).
2. The API builds a presigned POST that only allows 1 byte to 50 MB, `application/pdf`, key `tenant/t1/uploads/u9`, valid for 300 s.
3. The browser uploads 2 MB straight to S3; the API worker used no memory and no connection time for it.
4. S3 fires an event; the worker sees the first bytes are `%PDF-`, scans the file, and marks `u9` as `READY`.
5. A browser trying to upload 80 MB gets an error from S3 itself because of the `content-length-range` condition.

**Common mistake → fix:** letting the client choose the key (`../../other-tenant/x`) or skipping the size condition. A malicious client can overwrite other files or fill your bucket. The server picks the key, scopes it by tenant, and signs strict conditions.

**Interview answer:** "I don't proxy upload bytes. The API authorises the upload and returns a short-lived presigned POST for a server-chosen key under the tenant prefix, with size and content-type conditions. The browser uploads straight to S3; an S3 event triggers validation by magic bytes and malware scanning, then the record becomes READY. That keeps workers free and avoids request-size limits."

**Follow-ups:**
- *Presigned PUT or POST?* POST policies can enforce size ranges; a presigned PUT can't limit the size by itself.

---

## 5. Security

### Q28. What is a JWT bearer token, and how does token-based authentication work?

**Short answer:** A **bearer token** is a credential the client sends in the header `Authorization: Bearer <token>`; whoever holds it is treated as the user. A **JWT (JSON Web Token)** is a common token format: three Base64-encoded parts (`header.payload.signature`) where the payload holds **claims** (who the user is, who issued the token, when it expires) and the signature proves it was not altered. The server verifies the signature and claims on every request; it doesn't need to look anything up in a session store.

**How it works:**
1. The user logs in with an **identity provider (IdP)** such as Okta, Cognito or Auth0, which issues an **access token** signed with its private key.
2. The client sends it on each API call in the `Authorization` header.
3. The API fetches the IdP's **public keys** (a JWKS, JSON Web Key Set, identified by the token's `kid` key ID header) and verifies the signature.
4. The API checks the claims: `iss` (issuer is who you expect), `aud` (token meant for this API), `exp` (not expired), `nbf` (not before), and the allowed signing algorithm.
5. The payload is only encoded, **not encrypted**: anyone can read it, so don't put secrets in it.

**Example:** payload of a decoded access token (illustrative):
```json
{ "iss": "https://id.example.com", "aud": "api://documents", "sub": "u1",
  "tenant": "t1", "scope": "documents:read", "exp": 1790000000 }
```
```python
import jwt   # PyJWT
jwks = jwt.PyJWKClient("https://id.example.com/.well-known/jwks.json", cache_keys=True)

def verify_jwt(token: str) -> User:
    try:
        key = jwks.get_signing_key_from_jwt(token).key
        claims = jwt.decode(token, key, algorithms=["RS256"],
                            audience="api://documents", issuer="https://id.example.com")
    except jwt.PyJWTError:
        raise HTTPException(401, headers={"WWW-Authenticate": "Bearer"})
    return User(id=claims["sub"], tenant_id=claims["tenant"])
```

**What happens, step by step:**
1. Request arrives with `Authorization: Bearer eyJhbGciOi…`.
2. PyJWT reads the header, sees `kid: "abc"`, and gets the matching public key from the cached JWKS.
3. It verifies the signature (valid), `iss` equals the configured issuer, `aud` equals `api://documents`, and `exp` is in the future.
4. The user is `u1` in tenant `t1`.
5. A token for a different API (`aud: "api://billing"`) fails the audience check, and a token altered to say `tenant: "t2"` fails the signature check; both give `401`.

**Common mistake → fix:** decoding without verifying (`jwt.decode(token, options={"verify_signature": False})`) or accepting whatever `alg` the token claims (including `none`). Anyone can then forge a token. Always verify the signature with the IdP's key, pin `algorithms=["RS256"]`, and check `iss`, `aud` and `exp`.

**Interview answer:** "A bearer token goes in the Authorization header and whoever holds it is treated as the user. A JWT is a signed token with claims. My API verifies the signature against the identity provider's cached public keys by kid, pins the algorithm, and checks issuer, audience and expiry on every request, so there's no session lookup. The payload is readable, so it never contains secrets."

**Follow-ups:**
- *How do you revoke a JWT?* Keep access tokens short-lived (minutes) and use refresh tokens; for immediate revocation keep a deny-list of token IDs.
- *Access token vs ID token?* The ID token tells the client who logged in; the API must accept access tokens meant for it.

---

### Q29. What is the difference between authentication and authorisation?

**Short answer:** **Authentication** answers "who are you?": verifying the token or credentials. **Authorisation** answers "are you allowed to do this?": checking roles, scopes, and especially whether *this user* may touch *this specific resource*. A valid login doesn't authorise everything. Authentication failure returns `401`; authorisation failure returns `403` (or `404` to hide the resource).

**How it works:**
1. Authentication runs first, in a dependency (`get_current_user`), and yields a user object.
2. Coarse authorisation: does the user have the role or scope this endpoint needs (`documents:write`)?
3. Fine-grained, **resource-level** authorisation: does this document belong to this user's tenant, and does this user have access to it?
4. The checks run on **every request on the server**; never rely on the UI hiding buttons.

**Example:**
```python
def require_scope(scope: str):
    async def checker(user: CurrentUser) -> User:
        if scope not in user.scopes:
            raise HTTPException(403, "Missing scope")
        return user
    return checker

@app.delete("/v1/documents/{doc_id}", status_code=204)
async def delete_document(doc: OwnedDocument,
                          user: Annotated[User, Depends(require_scope("documents:write"))],
                          db: SessionDep):
    await db.delete(doc)
    await db.commit()
```

**What happens, step by step:**
1. No `Authorization` header → `401` (we don't know who you are).
2. Valid token, scopes `["documents:read"]` → the `documents:write` check fails → `403`.
3. Valid token with write scope, but the document belongs to tenant `t2` while the user is in `t1` → `OwnedDocument` raises `404`.
4. Valid token, write scope, own document → deleted, `204`.

**Common mistake → fix:** checking only that the user is logged in (authentication) and then trusting the ID in the URL. That lets any logged-in user read or delete anyone's data (see IDOR in the next question). Always authorise the specific resource.

**Interview answer:** "Authentication verifies identity, here by validating the JWT, returning 401 on failure. Authorisation decides what that identity may do: role or scope checks plus resource-level ownership or tenant checks, returning 403 or 404. I do both in dependencies on every request, and resource-level checks are the ones that people forget."

**Follow-ups:**
- *RBAC vs ABAC?* Role-based: permissions come from roles. Attribute-based: decisions use attributes of the user, resource and context (tenant, owner, time). Real systems combine both.

---

### Q30. What is IDOR, and how do you prevent it?

**Short answer:** **IDOR (Insecure Direct Object Reference)**, also called BOLA (Broken Object Level Authorization), is when a user changes an ID in a request (`/documents/123` to `/documents/124`) and gets someone else's data because the server never checked ownership. Prevent it by always loading resources **scoped to the caller** (`WHERE id = :id AND tenant_id = :tenant`), taking tenant and user from the verified token rather than the request, and returning `404` for resources the caller doesn't own.

**How it works:**
1. The identity comes from the verified token, never from a header or body field the client controls.
2. Every query for a user-owned resource includes the tenant (and owner, if relevant) in the `WHERE` clause.
3. Not found and not allowed look the same (`404`), so attackers can't confirm that other IDs exist.
4. Unguessable IDs (UUIDs) are defence in depth, not a substitute for the check.
5. Apply the same rule to IDs inside bodies and to IDs passed to background jobs, search tools and agent tools.

**Example:**
```python
async def get_owned_document(doc_id: str, user: CurrentUser, db: SessionDep) -> Document:
    doc = await db.scalar(
        select(Document).where(Document.id == doc_id, Document.tenant_id == user.tenant_id))
    if doc is None:
        raise HTTPException(404)
    return doc
```

```flow
sequence: IDOR blocked by a scoped query
actors: User in tenant T1, API, Database
User in tenant T1 -> API: GET /documents/doc_t2_77 with a valid token
API -> Database: SELECT … WHERE id = doc_t2_77 AND tenant_id = T1
Database --> API: no rows
API --> User in tenant T1: 404 Not Found
> The tenant comes from the verified token. A 404 does not reveal that doc_t2_77 exists in another tenant.
```

**What happens, step by step:**
1. The user in tenant `T1` guesses or finds `doc_t2_77`, which belongs to `T2`.
2. The query includes `tenant_id = 'T1'` taken from the token, so no row matches.
3. The API returns `404`, identical to the response for a document that doesn't exist.
4. An automated test logs in as tenant `T1`, requests every ID created by tenant `T2`, and asserts `404` each time; this test runs in CI for every endpoint.

**Common mistake → fix:** `db.get(Document, doc_id)` followed by returning it, or reading `tenant_id` from a header or query parameter. The first ignores ownership; the second lets the attacker choose the tenant. Use the scoped query and the tenant from the token.

**Interview answer:** "IDOR is accessing another user's object by changing an ID because the server doesn't check ownership. I scope every query by the tenant and owner from the verified token, return 404 for anything not owned, use UUIDs only as defence in depth, centralise the check in a dependency, and add automated cross-tenant tests. The same rule applies to IDs handed to background jobs and agent tools."

**Follow-ups:**
- *Why 404 and not 403?* 403 confirms the object exists; 404 reveals nothing.

---

### Q31. How do you configure CORS securely in FastAPI?

**Short answer:** CORS (Cross-Origin Resource Sharing) is a browser rule that lets a server say which other origins may read its responses. In FastAPI you add `CORSMiddleware` with an **explicit allowlist of origins**, only the methods and headers you need, and `allow_credentials=True` only if you use cookies. Never combine `"*"` with credentials. CORS protects users' browsers, not your API: `curl` ignores it, so you still authenticate every request. Best of all: serve app and API from the same origin and need no CORS.

**How it works:**
1. The browser adds `Origin: https://app.example.com` to a cross-origin request; for non-simple requests it first sends an `OPTIONS` preflight.
2. `CORSMiddleware` answers preflights and adds `Access-Control-Allow-*` headers when the origin is in the allowlist.
3. If the origin is not in the list, no allow headers are sent and the browser blocks the page from reading the response.
4. `max_age` caches the preflight result so the browser doesn't ask before every call.

**Example:**
```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://app.example.com"],          # exact origins
    allow_credentials=True,                              # only if cookies are used
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
    max_age=600,
)
```

**What happens, step by step:**
1. `https://app.example.com` sends `OPTIONS /v1/jobs` with `Access-Control-Request-Method: POST` and `Access-Control-Request-Headers: authorization,idempotency-key`.
2. The middleware sees the origin in the allowlist and the headers in `allow_headers`, and replies `200` with the matching `Access-Control-Allow-*` headers.
3. The browser sends the real `POST`, and the page can read the response.
4. A page on `https://evil.example` gets no allow headers; its script can't read the response. (A request may still have reached the server, so state-changing endpoints must be authenticated and protected from CSRF if cookies are used.)

**Common mistake → fix:** `allow_origins=["*"]` with `allow_credentials=True`, or reflecting any `Origin` header. Browsers reject the wildcard with credentials, and reflecting lets any website make authenticated calls for logged-in users. List exact origins from configuration.

**Interview answer:** "I add CORSMiddleware with an explicit list of allowed origins from settings, only the methods and headers I need, credentials only if I use cookies, and never a wildcard with credentials. CORS only protects users' browsers, so authentication stays on every endpoint. Where possible I route app and API through one domain so CORS doesn't apply at all."

**Follow-ups:**
- *Does CORS stop CSRF?* No. CSRF is about browsers sending cookies automatically; use SameSite cookies and CSRF tokens, or bearer tokens in headers.

---

### Q32. What are SSRF and unsafe file uploads, and how do you defend against them?

**Short answer:** **SSRF (Server-Side Request Forgery)** happens when your server fetches a URL supplied by a user ("import from link", webhooks, a web-fetch tool for an AI agent) and an attacker supplies an internal address such as `http://169.254.169.254/` (the cloud metadata service, which can return credentials) or `http://localhost:5432`. Defend by allowlisting schemes and hosts, resolving DNS and blocking private IP ranges, controlling redirects, and fetching through an isolated egress path. **Unsafe uploads** let attackers store malware or oversized/disguised files; limit size, check content, scan, and store outside the web root.

**How it works:**
1. **Allowlist:** only `https`, and only approved domains when possible.
2. **Resolve and check:** resolve the host to IPs and reject loopback (`127.0.0.0/8`), private (`10/8`, `172.16/12`, `192.168/16`), link-local (`169.254/16`) and IPv6 equivalents. Check again after every redirect, and connect to the checked IP (to avoid DNS rebinding, where DNS answers differently the second time).
3. **Limit:** short timeouts, maximum response size, limited or no redirects.
4. **Isolate:** run fetches in a network segment with no access to internal services; require IMDSv2 on cloud instances so a simple GET can't read credentials.
5. **Uploads:** server-chosen random keys, size limits, content-type check by magic bytes (not extension), malware scan, never execute or unpack untrusted content with unsafe libraries, sanitise names when displaying.

**Example:**
```python
import ipaddress, socket
from urllib.parse import urlparse

ALLOWED_HOSTS = {"docs.example.com", "files.partner.com"}

def check_url(url: str) -> str:
    u = urlparse(url)
    if u.scheme != "https" or u.hostname not in ALLOWED_HOSTS:
        raise HTTPException(400, "URL not allowed")
    for info in socket.getaddrinfo(u.hostname, 443):
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise HTTPException(400, "Address not allowed")
    return url
```

**What happens, step by step:**
1. A user submits `http://169.254.169.254/latest/meta-data/` → rejected: scheme is `http`, host not on the list.
2. A user registers `evil.example` whose DNS points to `10.0.0.5` and submits `https://evil.example/x` → host not allowlisted; even if it were, the resolved IP is private and is rejected.
3. `https://docs.example.com/report.pdf` passes both checks; the fetch uses a 5 s timeout and a 20 MB cap.
4. If `docs.example.com` redirects to an internal host, the redirect target goes through `check_url` again (or redirects are disabled).

**Common mistake → fix:** validating the URL string with a regex or a blocklist of `localhost`. Attackers use `127.1`, decimal IPs (`2130706433`), IPv6, DNS names pointing to internal IPs, and redirects. Allowlist hosts, check resolved IPs, and re-check redirects.

**Interview answer:** "For SSRF I allowlist https and approved hosts, resolve DNS and block loopback, private and link-local ranges including 169.254.169.254, re-validate after redirects, set timeouts and size caps, fetch from an isolated egress path, and require IMDSv2. For uploads I enforce size limits, verify content by magic bytes, malware-scan, store under server-chosen random keys outside the web root, and sanitise filenames."

**Follow-ups:**
- *Why does IMDSv2 help?* It requires a session token obtained with a PUT request, which basic SSRF with only GET can't make.

---

### Q33. How do rate limiting and quotas work?

**Short answer:** **Rate limiting** caps how many requests a caller can make in a time window (for example 60 per minute) so one client can't overwhelm the service or brute-force logins. **Quotas** are longer-term budgets (for example 100,000 LLM tokens per tenant per day). Identify the caller by API key, user or tenant, not just IP address; when the limit is exceeded return **`429 Too Many Requests`** with a **`Retry-After`** header. Expensive endpoints, like LLM chat, get their own stricter limits, and you also limit concurrent streams.

**How it works:**
1. **Token bucket:** each caller has a bucket that holds up to `burst` tokens and refills at `rate` per second. Each request takes one token; an empty bucket means rejection.
2. State must be shared across API instances, commonly in Redis, using an atomic operation (a Lua script or `INCR` with expiry) so concurrent requests can't both pass.
3. Layers: edge limits (WAF rate rules, API Gateway usage plans) against floods; application limits per user/tenant for business rules.
4. Return `429` with `Retry-After: <seconds>`; some APIs also send `RateLimit-*` headers.

**Example:** a simple fixed-window limiter with Redis (illustrative; production often uses token bucket or sliding window):
```python
async def rate_limit(user: CurrentUser, redis: RedisDep):
    key = f"rl:{user.tenant_id}:{user.id}:{int(time.time() // 60)}"
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, 60)
    if count > 60:
        raise HTTPException(429, headers={"Retry-After": "30"})

@app.post("/v1/chat", dependencies=[Depends(rate_limit)])
async def chat(...): ...
```

**What happens, step by step:**
1. User `u1` makes request 1 in minute 29,500,000: `INCR` returns 1, the key gets a 60 s expiry, the request proceeds.
2. Requests 2 to 60 increment the counter and pass.
3. Request 61 gets count 61 and is rejected with `429` and `Retry-After: 30`.
4. A well-behaved client waits 30 s (with some random jitter) and retries; in the next minute the counter starts at 0 again.
5. A fixed window allows a burst of up to 120 requests across a window boundary (60 at the end of one minute and 60 at the start of the next); token bucket or sliding window avoids that.

**Common mistake → fix:** limiting only by IP address. Users behind one corporate NAT share an IP and get blocked together, while an attacker with many IPs gets through. Limit by authenticated identity (tenant, user, API key), and by IP only for unauthenticated endpoints like login.

**Interview answer:** "I rate-limit per tenant or user with a token bucket in Redis using atomic operations so all instances share the count, return 429 with Retry-After, apply stricter limits to expensive endpoints like LLM chat, cap concurrent streams, and add per-tenant token quotas for longer windows. Edge rate rules in the WAF or API gateway handle floods before they reach the app."

**Follow-ups:**
- *Should clients retry on 429?* Yes, after `Retry-After`, with exponential backoff and jitter so many clients don't retry at the same instant.

---

### Q34. What other API security essentials should you cover?

**Short answer:** Beyond authentication, authorisation, CORS, SSRF and rate limiting, a secure API also needs: HTTPS only, input and size limits, protection against **mass assignment**, no secrets or stack traces in responses and logs, least-privilege cloud permissions for the service, dependency scanning, and audit logs for sensitive actions. The **OWASP API Security Top 10** is the standard checklist.

**How it works:**

| Risk (OWASP API Top 10 theme) | Defence |
|---|---|
| Broken object-level authorisation (IDOR) | Scope every query by tenant/owner (Q30) |
| Broken authentication | Verify JWT signature, `iss`, `aud`, `exp`; short-lived tokens |
| Excessive data exposure | `response_model` allowlists output fields (Q14) |
| Lack of resource limits | Rate limits, body size limits, pagination caps, timeouts |
| Broken function-level authorisation | Role/scope checks on admin endpoints |
| Mass assignment | Separate input models, `extra="forbid"` (Q13) |
| Security misconfiguration | No debug mode, locked-down docs, security headers, CORS allowlist |
| SSRF | Allowlists and IP checks (Q32) |
| Improper inventory | Retire old versions, track endpoints |
| Unsafe consumption of third-party APIs | Validate and size-limit responses from upstream services |

**Example:**
```python
class UserPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: str | None = Field(default=None, max_length=80)
    # no is_admin, no tenant_id: clients can never set them

@app.patch("/v1/users/me", response_model=UserOut)
async def update_me(body: UserPatch, user: CurrentUser, db: SessionDep):
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    await db.commit()
    return user
```
Also set a maximum body size at the proxy (for example Nginx `client_max_body_size`) and a limit on list lengths in models (`max_length=20`).

**What happens, step by step:**
1. A client sends `PATCH /v1/users/me {"display_name": "Ana", "is_admin": true}`.
2. `extra="forbid"` rejects `is_admin` with `422 extra_forbidden`; the request never reaches `setattr`.
3. With the unsafe version (`for k, v in raw_dict.items(): setattr(user, k, v)`), the same request would make the user an admin.
4. The response model strips `password_hash`; the audit log records "user u1 updated profile" with the request ID, not the full body.

**Common mistake → fix:** logging full request bodies and tokens "for debugging". Logs spread to many people and systems, so passwords, tokens and personal data leak. Log IDs and metadata; redact sensitive fields; never log `Authorization` headers.

**Interview answer:** "I follow the OWASP API Top 10: HTTPS with HSTS, strict input validation and size limits, separate input models with extra forbidden to stop mass assignment, response models to prevent data exposure, rate limits and timeouts, no secrets or stack traces in responses or logs, least-privilege IAM for the service, dependency scanning, and audit logs for sensitive actions."

**Follow-ups:**
- *What is mass assignment?* Letting the client set fields it shouldn't (such as `role`) because the server copies the whole request body onto a model.

---

## 6. Production readiness

### Q35. How do you make a FastAPI service production-ready in a container?

**Short answer:** Package it as a small **non-root container**, run Uvicorn with about one worker per CPU core (or one worker per container and scale containers), handle `SIGTERM` for graceful shutdown, add health endpoints, set timeouts on every outbound call, size connection pools against the database limit, emit structured logs, traces and metrics, and keep secrets in a secrets manager. The same checklist applies on ECS, Kubernetes or any other platform.

**How it works:**
1. **Run command (exec form, so signals reach the process):** `CMD ["fastapi", "run", "app/main.py", "--workers", "2", "--proxy-headers"]` or `uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2 --proxy-headers`.
2. **Proxy headers:** behind a load balancer, `--proxy-headers` (and `--forwarded-allow-ips`) make Uvicorn trust `X-Forwarded-For/Proto` for the client IP and scheme.
3. **Graceful shutdown:** on `SIGTERM` Uvicorn stops accepting connections, finishes in-flight requests, then the lifespan closes pools. The platform's stop timeout and load-balancer deregistration delay must be longer than your longest normal request (and SSE streams need a client reconnect plan).
4. **Connection budget:** database connections used = pool size per worker × workers per container × containers. It must stay below the database's `max_connections` (or put a connection proxy in front).
5. **Timeouts and retries:** every outbound call has a timeout; retry only idempotent operations, with backoff and jitter.
6. **Observability:** JSON logs with request ID, traces, and RED metrics (Rate, Errors, Duration).
7. **Security:** non-root user, minimal image, no secrets in the image, least-privilege IAM role.

**Example:**
```dockerfile
FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
RUN useradd -r appuser
USER appuser
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--workers", "2"]
```

**What happens, step by step (budget with illustrative numbers):**
1. Database `max_connections` = 100, leaving 90 for the app. Pool size is 5 per worker, 2 workers per container → 10 connections per container.
2. Autoscaling allows up to 8 containers → 80 connections. That's under 90, so a scale-out can't exhaust the database.
3. During a deploy, old and new containers briefly run together (up to 16 containers = 160 connections), which would exceed the limit. Either reduce the pool, limit surge, or use a connection proxy.
4. A stop signal arrives; the container drains for up to the configured timeout while the load balancer stops sending new requests.

**Common mistake → fix:** multiplying workers without checking the database. Ten containers × 4 workers × pool of 10 = 400 connections against a database that allows 100: new requests fail with "too many connections" exactly when traffic grows. Compute the budget first, and use a pooler (such as PgBouncer or RDS Proxy) if you need many clients.

**Interview answer:** "A non-root slim image started with Uvicorn in exec form, workers matched to cores, proxy headers on behind the load balancer, graceful shutdown on SIGTERM with the lifespan closing pools, and the stop timeout aligned with the load balancer's drain time. I budget database connections as pool size times workers times containers, put timeouts on every outbound call, and ship JSON logs, traces and RED metrics, with secrets from a manager and least-privilege IAM."

**Follow-ups:**
- *How many workers?* Start with the number of CPU cores; scale containers rather than workers per container for simpler failure domains.

---

### Q36. What are liveness, readiness and startup probes?

**Short answer:** They are health checks the platform calls to decide what to do with your container. **Liveness**: "is the process alive and responsive?" If it fails, restart the container. **Readiness**: "can it serve traffic right now?" If it fails, stop sending requests but don't restart. **Startup**: "has it finished booting?" so slow starts aren't killed. Keep liveness shallow (no dependency calls); make readiness reflect real ability to serve.

**How it works:**
1. `/health/live` returns `200` immediately if the event loop responds. No database call.
2. `/health/ready` checks cheap, essential things: config loaded, connection pool created, perhaps a quick `SELECT 1` with a short timeout.
3. The platform polls at an interval; a few consecutive failures flip the state.
4. A load balancer's target-group health check should usually use the readiness-style endpoint, but avoid deep checks that can make every task fail together when a shared dependency blips.

**Example:**
```python
@app.get("/health/live", include_in_schema=False)
async def live():
    return {"status": "ok"}

@app.get("/health/ready", include_in_schema=False)
async def ready(request: Request):
    try:
        async with asyncio.timeout(1):
            async with request.app.state.engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
    except Exception:
        raise HTTPException(503, "database unavailable")
    return {"status": "ready"}
```

**What happens, step by step:**
1. Normal: both return `200`.
2. The database becomes unreachable for 30 s. Readiness returns `503`, so the load balancer stops routing to this task; the process stays up and reconnects when the database returns.
3. If liveness had also called the database, the platform would restart every task at the same time: a short database blip becomes a full outage with cold starts and a connection storm.
4. If every task's readiness fails together, the load balancer has no healthy targets; in that case it's better to fail open or return a clear `503`, rather than keep restarting.

**Common mistake → fix:** putting dependency checks in the liveness probe. The platform restarts healthy processes because something *else* is down, and the restarts make the incident worse. Liveness = "my process is not stuck". Dependencies belong in readiness.

**Interview answer:** "Liveness says the process is alive and not deadlocked, so it's cheap and has no dependency calls; failing it restarts the container. Readiness says it can serve traffic now, such as pool ready and database reachable with a short timeout; failing it removes it from routing without a restart. Startup gives slow boots a grace period. Deep checks in liveness cause cascading restarts."

**Follow-ups:**
- *What should the ALB health check hit?* A cheap readiness-style endpoint, with thresholds tuned so one slow response doesn't remove a task.

---

### Q37. How do you add observability with OpenTelemetry?

**Short answer:** **OpenTelemetry (OTel)** is the vendor-neutral standard for **traces**, **metrics** and **logs**. A **trace** follows one request across services as a tree of **spans** (timed operations). You enable automatic instrumentation for FastAPI, `httpx`, SQLAlchemy and AWS SDK calls, propagate the W3C `traceparent` header to downstream services, add useful span attributes (model ID, token counts, tenant pseudonym), export through a collector, and put the trace ID in every log line so you can jump from a log to its trace.

**How it works:**
1. Install the SDK and instrumentors; they wrap framework and client libraries and create spans automatically.
2. The incoming `traceparent` header continues an existing trace; outgoing HTTP clients add it, so downstream services join the same trace.
3. Spans carry attributes (`http.route`, `db.statement` off by default for privacy, custom ones).
4. Exporters send data via OTLP (OpenTelemetry Protocol) to a collector (often a sidecar), which forwards to X-Ray, CloudWatch or another backend.
5. Sampling keeps cost down; keep all errors and slow traces.

**Example:**
```python
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry import trace

FastAPIInstrumentor.instrument_app(app)
HTTPXClientInstrumentor().instrument()
tracer = trace.get_tracer(__name__)

async def run_agent(prompt: str):
    with tracer.start_as_current_span("llm.call") as span:
        span.set_attribute("llm.model", "example-model")
        reply = await llm.complete(prompt)
        span.set_attribute("llm.tokens.output", reply.usage.output_tokens)
        return reply
```

**What happens, step by step:**
1. `POST /v1/chat` arrives with no `traceparent`; OTel starts trace `4bf9…` with a root span "POST /v1/chat".
2. The handler calls the database (child span, 12 ms), then `llm.call` (child span, 1.8 s, `llm.tokens.output=312`).
3. The `httpx` call to a tool service carries `traceparent: 00-4bf9…-…-01`, so that service's spans appear in the same trace.
4. Logs contain `trace_id=4bf9…`; a slow-request alert links to the trace, which shows the 1.8 s LLM span as the culprit.

**Common mistake → fix:** attaching raw user content, tokens or full SQL parameters to spans. Telemetry is widely accessible and stored for a long time. Record sizes, IDs, model names and timings; redact or hash anything personal.

**Interview answer:** "I use OpenTelemetry: auto-instrument FastAPI, httpx, SQLAlchemy and the AWS SDK, propagate the W3C traceparent header so downstream services join the trace, add span attributes like model ID and token counts without sensitive data, export OTLP through a collector to the tracing backend, and include the trace ID in logs. Sampling keeps cost down while retaining errors and slow traces."

**Follow-ups:**
- *Which metrics matter most?* RED: request Rate, Error rate, Duration (percentiles), plus saturation such as event-loop lag and pool wait time.

---

### Q38. How do you test a FastAPI application?

**Short answer:** Test at several levels: **unit tests** for service functions (plain Python), **API tests** that call endpoints in-process with `TestClient` (or `httpx.AsyncClient` with `ASGITransport`) while replacing dependencies with fakes through `app.dependency_overrides`, **integration tests** against a real database in a container, **contract tests** against the OpenAPI schema, and **load tests** (including SSE). Authorisation tests, especially cross-tenant ones, are mandatory.

**How it works:**
1. `TestClient(app)` runs requests through the full ASGI stack without a network.
2. `app.dependency_overrides[get_current_user] = lambda: User(...)` bypasses real token verification; override the database dependency with a test session or the LLM client with a fake.
3. Clear the overrides after each test (fixture).
4. For real SQL behaviour (constraints, transactions, `FOR UPDATE`), use a real PostgreSQL in a container rather than SQLite.

**Example:**
```python
import pytest
from fastapi.testclient import TestClient

@pytest.fixture
def client():
    yield TestClient(app)
    app.dependency_overrides.clear()

def as_user(user_id: str, tenant: str):
    app.dependency_overrides[get_current_user] = lambda: User(id=user_id, tenant_id=tenant)

def test_cannot_read_other_tenants_document(client, seeded_db):
    as_user("u1", "t1")
    r = client.get("/v1/documents/doc_of_t2")
    assert r.status_code == 404

def test_validation_error(client):
    as_user("u1", "t1")
    r = client.post("/v1/chat", json={"message": ""})
    assert r.status_code == 422
```

**What happens, step by step:**
1. The fixture creates the client; `as_user("u1", "t1")` makes every request authenticate as tenant `t1` without a real token.
2. `GET /v1/documents/doc_of_t2` runs the real route, the real `OwnedDocument` dependency and the test database; the scoped query finds nothing → `404`. The test passes.
3. The empty `message` triggers Pydantic validation → `422`, and the handler isn't called.
4. After each test the overrides are cleared, so tests don't affect each other.

**Common mistake → fix:** testing only the happy path with the auth dependency overridden to a superuser. Authorisation bugs then never show up. Write explicit negative tests: no token (`401`), wrong scope (`403`), another tenant's resource (`404`).

**Interview answer:** "Unit tests for services, API tests with TestClient and dependency_overrides to fake auth, the database or the LLM client, integration tests against a real PostgreSQL container for SQL behaviour, contract tests like schemathesis against the OpenAPI schema, and load tests with k6 or Locust including SSE. I always include negative authorisation tests such as no token, wrong scope and cross-tenant access."

**Follow-ups:**
- *Why not SQLite in tests?* Different SQL dialect and locking behaviour hide bugs that PostgreSQL would show.

---

### Q39. How do you change schemas without breaking older frontends?

**Short answer:** Treat every change as a sequence of safe steps: **expand** (add the new thing next to the old), **migrate** (move clients and data), **contract** (remove the old thing once nothing uses it). This applies to API fields and to database columns. Generate frontend types from the OpenAPI schema so breaking changes show up in CI, and measure usage of the old field before deleting it.

**How it works:**
1. **Expand:** add the new response field (keep the old one); add a new nullable column; make new request fields optional with defaults.
2. **Migrate:** deploy the new frontend that uses the new field; backfill existing database rows in batches; write to both for a while.
3. **Contract:** after usage of the old field reaches zero (and your support window for cached or mobile clients has passed), remove it in a later release.
4. Use OpenAPI diffs in CI to flag removed or retyped fields.

**Example:** splitting `full_name` into `first_name` and `last_name`.
```python
class UserOut(BaseModel):
    id: str
    first_name: str
    last_name: str
    full_name: str = Field(deprecated=True)       # old field kept during the transition
```
```sql
-- release 1 (expand): additive and safe
ALTER TABLE users ADD COLUMN first_name text, ADD COLUMN last_name text;
-- release 2 (migrate): backfill in batches, app writes both
-- release 3 (contract, weeks later): drop full_name after usage reaches zero
```

**What happens, step by step:**
1. Release 1: backend returns all three fields; old frontends read `full_name`, new code can read the new ones. Nothing breaks.
2. Release 2: frontend switches to `first_name`/`last_name`; a background job fills the columns for old rows 1,000 at a time.
3. Metrics show requests still using `full_name` fell from 40% to 0.2% over two weeks (old cached tabs and an old mobile build).
4. Release 3: once the support window ends, `full_name` is removed. If it had been removed in release 1, every open tab would have shown "undefined".

**Common mistake → fix:** a one-step rename in the database and the API in the same release. Rolling deployments mean old and new code run together for minutes, and old clients live for days. Always keep both shapes alive until the old one is unused.

**Interview answer:** "I use expand, migrate, contract: add the new field or column alongside the old one, move clients and backfill data, then remove the old one after monitoring shows it's unused. I generate frontend types from OpenAPI and diff the schema in CI so breaking changes fail the build, and I assume old clients stay alive for days."

**Follow-ups:**
- *What about required new request fields?* Give them defaults, or make the server tolerate their absence for the transition period.

---

### Q40. How do you tune FastAPI performance?

**Short answer:** **Measure first**, then fix the largest cost. In I/O-bound APIs the biggest wins are usually: not blocking the event loop, fewer database round trips (fix N+1 queries and add the right indexes), reusing connections (shared `httpx` client, pooled database connections), caching hot reads, and offloading CPU-heavy work. Micro-optimisations like faster JSON serialisers come after.

**How it works:**
1. **Profile and trace:** find where time goes per request (database 120 ms, LLM 1.8 s, serialisation 2 ms).
2. **Async end to end:** async drivers and clients; `to_thread` for unavoidable blocking calls (Q22).
3. **Reuse connections:** one `httpx.AsyncClient` from the lifespan; database pool sized sensibly.
4. **Fewer queries:** eager-load relationships; fetch what you need; add indexes; paginate.
5. **Cache:** short-lived caches (Redis or in-process with a bound) for hot, rarely changing data.
6. **Serialisation and size:** return smaller payloads; GZip for large JSON; a fast JSON library if serialisation shows up in profiles.
7. **Scale:** right worker count; move CPU-bound work to workers.

**Example:** N+1 queries in a list endpoint.
```python
# ❌ 1 query for documents + 1 per document for its owner = 101 queries for 100 rows
docs = (await db.scalars(select(Document).limit(100))).all()
return [{"id": d.id, "owner": (await d.awaitable_attrs.owner).name} for d in docs]

# ✅ 1 query with a join-based eager load
docs = (await db.scalars(select(Document).options(selectinload(Document.owner)).limit(100))).all()
return [{"id": d.id, "owner": d.owner.name} for d in docs]
```

**What happens, step by step:**
1. A trace of a slow `GET /v1/documents` shows 101 database spans of about 2 ms each, 200 ms total.
2. With `selectinload`, SQLAlchemy runs 2 queries: one for documents, one `WHERE id IN (…)` for owners: about 8 ms total.
3. The endpoint drops from about 210 ms to about 20 ms at p50, and the database sees 98% fewer queries per request, which also helps under load.

**Common mistake → fix:** switching to a faster JSON library or rewriting code while the real cost is 100 sequential queries or a blocked event loop. Optimising without a trace targets the wrong thing. Find the biggest span first.

**Interview answer:** "I profile and trace to see where the time goes, then fix the biggest cost: no blocking in the event loop, shared HTTP clients and database pools, eager loading to remove N+1 queries, indexes and pagination, caching of hot reads, smaller or compressed responses, and offloading CPU work. Only then I look at serialisation, like orjson-style speedups."

**Follow-ups:**
- *Is `response_model` slow?* It adds validation and serialisation work; for very large hot responses you can return pre-built `Response` objects, but measure first.

---

## 7. Scenario & debugging questions

### Q41. An SSE stream works locally but drops through the load balancer after about 60 seconds. Why?

**Short answer:** The **idle timeout** of the application load balancer (ALB) is 60 seconds by default: if no bytes flow on a connection for that long, the ALB closes it. Locally there is no proxy, so you never see it. While an agent is "thinking" or waiting for a tool, the stream is silent, so it dies. Fix: send **keep-alive comments** regularly (FastAPI's SSE sends a ping every 15 s when idle), raise the idle timeout if needed, and let the client reconnect with `Last-Event-ID`.

**Step by step:**
1. **Confirm the pattern.** In the browser Network tab, check whether the stream ends at the same elapsed time every time (60 s) and only in the deployed environment. A constant number points to a timeout.
2. **Find the proxies in the path.** Browser → CDN → ALB → container. Each has its own idle or read timeout (ALB idle timeout, CDN origin read timeout, Nginx `proxy_read_timeout`).
3. **Check what the server sends while idle.** If nothing is written for 60 s, the connection counts as idle. Capture with `curl -N` against the deployed URL and watch for ping comments (`: ping`).
4. **Fix the silence.** Make sure the keep-alive comment is sent at an interval shorter than the shortest timeout (15 to 30 s). Check you haven't disabled or overridden it.
5. **Raise timeouts where appropriate.** ALB idle timeout (up to 4000 s), CDN origin response timeout; keep them longer than your longest expected silence.
6. **Disable buffering.** `X-Accel-Buffering: no` for Nginx; check the CDN doesn't buffer or compress the stream.
7. **Handle deployments.** A deploy also cuts streams: set a deregistration delay and make the client reconnect with `Last-Event-ID` and resume.

**Example:**
```
$ curl -N https://app.example.com/api/v1/conversations/c1/stream -H "Authorization: Bearer …" …
event: token
data: {"text":"Hel"}

: ping            ← keep-alive comment every 15 s while the model is thinking
```

```flow
trace: SSE dies at 60 s through the ALB
stream open, the agent waits for a slow tool, **0 bytes for 60 s** > The ALB sees an idle connection. Nothing is wrong with your code.
ALB idle timeout (default 60 s) reached > It closes the connection. Locally no proxy sits in between, so it never happened.
fix: a comment ": ping" every 15 s > Bytes keep the connection active, so the idle timer resets each time.
also: raise ALB and CDN timeouts, disable buffering, resume with Last-Event-ID > Defence in depth, plus recovery when a deploy cuts the stream.
```

**What happens, step by step:**
1. At t=0 the stream starts; tokens flow, then the agent calls a tool for 90 s.
2. With no pings, the ALB closes the connection at t=60 s of silence; the browser sees an error and `EventSource` reconnects, starting a new run (duplicate work).
3. With pings every 15 s, the ALB sees traffic at t=15, 30, 45… and never hits the 60 s idle limit.
4. If a deploy cuts the connection anyway, the client reconnects with `Last-Event-ID: c1:40` and the server replays events from 41.

**Common mistake → fix:** raising the ALB timeout to 1 hour and calling it done. Other hops (CDN, corporate proxies, mobile networks) have their own timeouts you don't control. Heartbeats work everywhere; timeouts are a supplement.

**Interview answer:** "A constant 60 seconds points at the ALB idle timeout, which doesn't exist locally. I confirm with curl -N that the stream goes silent, send a keep-alive comment every 15 seconds, raise ALB and CDN timeouts as a supplement, disable proxy buffering, and make the client reconnect with Last-Event-ID so deploys and network blips don't lose the stream."

**Follow-ups:**
- *Do pings count toward billing or tokens?* No; they're SSE comments that clients ignore.

---

### Q42. The API returns 401 on every request after an identity-provider change. What do you check?

**Short answer:** If every request fails after a change, the token validation settings no longer match the tokens being issued. Compare a real token's claims with your configuration: **issuer**, **audience**, **signing key**, **algorithm**, **expiry/clock**, and whether the frontend is sending the **right kind of token** (access token, not ID token). Log the *reason* validation failed (not the token itself) to see which check fails.

**Step by step:**
1. **Read the actual error.** Log the exception type from `jwt.decode` (`InvalidIssuerError`, `InvalidAudienceError`, `InvalidSignatureError`, `ExpiredSignatureError`, key not found). Each points to a different cause.
2. **Decode a token locally (without sharing it).** Inspect the header and payload: `iss`, `aud`, `kid`, `alg`, `exp`, and custom claims like `tenant` or `groups`.
3. **Issuer mismatch.** The new authorization server's URL differs (for example a custom authorization server path versus the org URL). Compare `iss` with `settings.auth_issuer` character by character (trailing slash included).
4. **Audience mismatch.** The new app or server uses a different `aud`. Update the setting or the IdP configuration.
5. **Signing key problems.** Is `kid` in the JWKS you fetch? Keys rotate; if your cache is stale refetch when you see an unknown `kid`. Check the JWKS URL points to the new server.
6. **Algorithm.** Did the algorithm change (RS256 to ES256)? Your allowlist must include it.
7. **Clock skew and expiry.** Server time drifting a few minutes causes `nbf`/`exp` failures; allow a small leeway (for example 30 s).
8. **Token type and claims.** The SPA might send the ID token; or a claim you require (`tenant`, `groups`) is missing from the new configuration.

**Example:**
```python
try:
    claims = jwt.decode(token, key, algorithms=["RS256"],
                        audience=settings.auth_audience, issuer=settings.auth_issuer, leeway=30)
except jwt.PyJWTError as e:
    logger.warning("jwt_rejected", reason=type(e).__name__)      # never log the token
    raise HTTPException(401, headers={"WWW-Authenticate": "Bearer"})
```

```flow
pipeline: Narrowing down 401s after an identity-provider change
Log the rejection reason > InvalidIssuer, InvalidAudience, InvalidSignature, Expired or key not found tells you the check that fails.
Decode a token locally > Compare iss, aud, kid, alg, exp and custom claims with your settings.
Issuer or audience differ? > The new authorization server or app uses different values; update settings or IdP.
Unknown kid or stale JWKS? > Refetch the key set on an unknown kid; check the JWKS URL.
Wrong token or missing claim? > The frontend sends the ID token, or a required claim is no longer issued.
```

**What happens, step by step:**
1. Logs show `reason=InvalidIssuerError` for 100% of requests starting at the change time.
2. The decoded token has `iss: https://id.example.com/oauth2/default`; the setting is `https://id.example.com`.
3. Update the setting (or the IdP) so they match exactly, redeploy.
4. Requests succeed. Add a startup check or test that fetches the issuer's metadata (`/.well-known/openid-configuration`) and fails fast on mismatch.

**Common mistake → fix:** loosening validation to "make it work" (`verify_aud=False`, accepting any issuer). That removes real protection and masks the cause. Find the mismatched value and correct the configuration.

**Interview answer:** "I log the validation failure reason, then decode a real token and compare iss, aud, kid, alg and exp with my settings. After an IdP change the usual culprits are a different issuer path, a different audience, a rotated or differently located JWKS, an algorithm change, clock skew, the SPA sending an ID token instead of an access token, or a missing custom claim. I fix the configuration rather than disabling checks."

**Follow-ups:**
- *How do you avoid this in future?* Read issuer and JWKS URI from the provider's discovery document, test configuration at startup, and alert on a spike in 401s.

---

### Q43. p99 latency spikes while p50 stays normal. What causes it?

**Short answer:** The median request is fine but a small share are very slow, so look for something that **occasionally** delays requests: a blocking call that freezes the event loop, connection pool exhaustion during bursts, garbage-collection pauses, cold paths (first call, cache miss), slow downstream calls for particular inputs, or retries. Examine the traces of the slowest requests and see what they share.

**Step by step:**
1. **Pull traces for requests above p99.** What do they have in common: endpoint, tenant, payload size, time of day, container?
2. **Check event-loop lag.** If all endpoints (even `/health`) slow down together at the same moments, something blocks the loop (a sync call, CPU work). Find the code with a profiler or async debug logs.
3. **Check pool wait times.** Database or HTTP pool exhausted during bursts means requests queue for a connection. Look at "time waiting for connection" and pool metrics.
4. **Look at cold paths.** Cache misses, first-use initialisation (loading a model), new containers still warming up.
5. **Look at downstreams.** One slow dependency for some inputs (a huge prompt, a tenant with 1M rows without an index).
6. **Look at retries and timeouts.** A request that times out at 10 s and succeeds on retry shows up as a 10 s tail.
7. **Fix the specific cause**, then watch p99 again.

**Example:** a trace of a slow request.
```
GET /v1/documents      total 2,340 ms
├─ wait for DB connection        2,100 ms   ← pool exhausted during a burst
├─ SELECT documents                 18 ms
└─ serialise                         5 ms
```

**What happens, step by step:**
1. The dashboard shows p50 = 35 ms, p99 = 2.4 s.
2. Slow traces all show a 2 s "wait for DB connection" span, only when a batch job runs at the top of the hour and holds connections.
3. Fixes: separate pool for batch work, shorter transactions, larger or better-managed pool (within the database budget).
4. p99 drops to 90 ms. Averages never showed the problem because 99% of requests were fine.

**Common mistake → fix:** looking at averages or p50 and concluding "latency is fine". Tails are what users with slow experiences feel and they also reveal queueing problems early. Track p95/p99 per endpoint and drill into traces.

**Interview answer:** "A fat tail with a healthy median means occasional waiting: a blocked event loop, an exhausted pool, GC pauses, cold paths, a slow dependency for certain inputs, or retries. I pull traces for the slowest requests to see the shared pattern, check event-loop lag and pool wait metrics, then fix that specific cause."

**Follow-ups:**
- *Why does queueing amplify tails?* When utilisation is high, even a small slowdown makes requests wait behind each other, and waiting time grows sharply near saturation.

---

### Q44. Clients get duplicate jobs when the network is flaky. How do you stop it?

**Short answer:** The client's first `POST` reached the server and created a job, but the response was lost; the client timed out and retried, creating a second job. Fix with **idempotency keys**: the client sends the same `Idempotency-Key` on every retry of one user action, and the server enforces uniqueness with a database constraint and returns the original response for repeats.

**Step by step:**
1. **Confirm the cause.** Look at the duplicate jobs: same user, same payload, created seconds apart? Check access logs for two `POST /v1/jobs` with the same body; check whether the first got a `502/504` or a client timeout.
2. **Require the header.** `Idempotency-Key` is mandatory on job-creating `POST`s (`422` if missing).
3. **Persist key plus request hash.** Table `idempotency(tenant_id, key, request_hash, response)` with a **unique constraint** on `(tenant_id, key)`.
4. **Handle outcomes.** New key: do the work and store the response. Seen key with the same hash: return the stored response. Seen key with a different hash: `422`. Seen key still processing: `409`, client retries later.
5. **Client side.** Generate the key once per user action (when the user clicks), reuse it for automatic retries, and store it so a page refresh during retry reuses it.
6. **Expire keys** after about 24 hours.

**Example:** the unique constraint is what makes this race-safe.
```sql
CREATE TABLE idempotency (
  tenant_id text NOT NULL, key text NOT NULL,
  request_hash text NOT NULL, response jsonb, created_at timestamptz DEFAULT now(),
  PRIMARY KEY (tenant_id, key));
```

```flow
trace: Duplicate jobs before and after the fix
before: attempt 1 creates **job_1**, response lost > The server finished the work but the client never saw the answer.
before: client retries, attempt 2 creates **job_2** > The server cannot tell it is the same user action, so the work is done twice.
after: both attempts carry Idempotency-Key **k-7f3a** > The client generated the key once for that click.
after: attempt 2 hits the unique key and returns **job_1** again > The user sees one job, and nothing is duplicated.
```

**What happens, step by step:**
1. The user clicks "Process"; the client generates `k-7f3a` and sends `POST /v1/jobs`.
2. The server inserts `(t1, k-7f3a)` and `job_1`, but the 202 is lost.
3. The client retries with the same key; the insert of the key fails on the primary key, the stored response `{"id":"job_1"}` is returned.
4. Only `job_1` exists. Two simultaneous retries are also safe: the database lets only one insert win.

**Common mistake → fix:** a "does this key exist?" `SELECT` followed by an `INSERT` in separate steps. Two concurrent retries both see "not found". Insert first and rely on the unique constraint (or a conditional write) to decide the winner.

**Interview answer:** "Duplicate jobs mean a retried POST after a lost response. I require an Idempotency-Key generated once per user action, store it with a request hash and the response under a unique constraint on tenant and key, and return the stored response for repeats, a 422 for a mismatched body and a 409 while the first request is in progress. The uniqueness is enforced by the database, so concurrent retries are safe."

**Follow-ups:**
- *Does this replace making workers idempotent?* No; queues deliver at least once, so the worker's processing must also be safe to repeat.

---

### Q45. Memory grows steadily in the API containers. How do you investigate?

**Short answer:** First decide if it is a real leak (memory rises over time without more traffic) or just load, caches filling up, or fragmentation. Then take memory snapshots at two points and compare them to see which objects grow. Typical causes in FastAPI apps: unbounded in-process caches or global lists, clients created per request and never closed, background tasks piling up, big responses built in memory instead of streamed, and unbounded queues or logging buffers.

**Step by step:**
1. **Confirm the pattern.** Plot container memory against request rate. A leak climbs even when traffic is flat; load-related growth follows traffic. A sawtooth with restarts means containers are being OOM-killed (out of memory).
2. **Check the obvious.** Global dicts or lists that only grow (`CACHE[key] = value` with no limit), per-request `httpx.AsyncClient()` or database engine creation, tasks started with `asyncio.create_task` that never finish.
3. **Take snapshots.** Use `tracemalloc` (start at boot, take a snapshot, wait, take another, compare `snapshot.compare_to`), or a profiler such as memray, in a staging copy under replayed traffic.
4. **Read the diff.** The top lines show file and line numbers with the biggest growth: for example `cache.py:42 +180 MB`.
5. **Fix.** Bound the cache (maximum size and TTL), share clients from the lifespan, stream large responses, cap queue sizes, and cancel or await tasks.
6. **Safety net.** Alarm on memory, and as a stopgap recycle workers (`--limit-max-requests N`) so a leak can't take down the container before the fix ships.

**Example:**
```python
import tracemalloc
tracemalloc.start(25)
snap1 = tracemalloc.take_snapshot()
# … replay traffic for 10 minutes …
snap2 = tracemalloc.take_snapshot()
for stat in snap2.compare_to(snap1, "lineno")[:5]:
    print(stat)       # e.g. app/cache.py:42: size=+182 MiB, count=+1,240,000
```

**What happens, step by step:**
1. Memory goes from 300 MB to 1.8 GB over 6 hours at flat traffic; the container is then killed.
2. The tracemalloc diff points at `cache.py:42`, a dict mapping each request's prompt to its response, never evicted.
3. Replace it with a size-bounded cache with TTL (for example max 10,000 entries, 10 min TTL).
4. Memory stays flat at about 350 MB. `--limit-max-requests` remains as a seatbelt.

**Common mistake → fix:** raising the container memory limit instead of finding the cause. The leak just takes longer to kill the container, and crashes become rarer and harder to debug. Treat limits as a safety net, not a fix.

**Interview answer:** "I confirm it's a real leak by plotting memory against traffic, then compare tracemalloc or memray snapshots to find what grows. In FastAPI apps it's usually unbounded caches or globals, clients created per request and never closed, pile-ups of background tasks, or large responses buffered in memory. I bound caches, share clients from the lifespan, stream big responses, and add memory alarms plus worker recycling as a safety net."

**Follow-ups:**
- *Could it be fragmentation rather than a leak?* Yes: memory rises and plateaus without growing objects; allocator settings or recycling workers help.

---

### Q46. Design the chat API for an agentic app.

**Short answer:** Model conversations as resources, send messages through a streaming endpoint, and treat human approvals and uploads as their own resources. Authenticate with a bearer token, scope everything by tenant and owner, stream with SSE, make state-changing calls idempotent, and use Problem Details errors. The server stores the conversation, so a client can refresh or reconnect at any time.

**How it works:**
1. **Conversations:** create, list (cursor-paginated), read; ID generated by the server, owner taken from the token.
2. **Messages:** `POST` a message and receive the agent's output as an SSE stream (tokens, tool status, approval requests, done).
3. **Approvals:** when the agent wants to do something sensitive, the stream emits `approval_needed`; the user decides via a separate `POST` that resumes the run. The approver's permission is checked server-side.
4. **Uploads:** presigned upload URLs (Q27).
5. **Long jobs:** the async job pattern (Q26).
6. **Cross-cutting:** JWT auth, tenant scoping, rate limits and token budgets, idempotency keys, tracing.

**Example:**
```
POST /v1/conversations                          create (server id, owner = token sub) → 201
GET  /v1/conversations?cursor=                  list own conversations
GET  /v1/conversations/{id}                     read (ownership check)
POST /v1/conversations/{id}/messages/stream     send message → SSE: token | tool | approval_needed | done
GET  /v1/conversations/{id}/approvals           pending approvals
POST /v1/approvals/{approval_id}/decision       {"approve": true}  (Idempotency-Key, approver authZ)
POST /v1/uploads                                presigned upload URL
POST /v1/jobs · GET /v1/jobs/{id} · GET /v1/jobs/{id}/events     long document jobs
```

```flow
sequence: One chat turn with an approval step
actors: React app, API, Agent
React app -> API: POST /v1/conversations → id c1
React app -> API: POST /v1/conversations/c1/messages/stream with Idempotency-Key
API -> Agent: run the turn for c1
Agent --> React app: SSE events token, token, tool status
Agent --> React app: SSE event approval_needed for action a9 and the stream pauses
> The agent will not send the email until a human approves. Approval is a separate request so the UI can take its time.
React app -> API: POST /v1/approvals/a9/decision approve true
API -> Agent: resume c1 with the decision
Agent --> React app: remaining tokens, then event done
```

**What happens, step by step:**
1. The app creates conversation `c1` (owner `u1`, tenant `t1`).
2. It sends a message; the API checks ownership, rate limit and idempotency key, then streams events.
3. The agent asks to send an email; the stream emits `approval_needed` with action `a9` and waits.
4. The user clicks Approve; the API checks the caller may approve `a9` (same tenant, right role), records the decision, and resumes. The remaining events finish with `done`.
5. If the connection drops, the client reconnects with `Last-Event-ID` or reloads `GET /v1/conversations/c1` and the pending approval list; nothing is lost.

**Common mistake → fix:** accepting `tenant_id` or `owner_id` in request bodies, or letting the approval endpoint trust the client's claim that it was approved. Take identity from the token, and check on the server that the approval exists, belongs to this tenant, and the caller may decide it.

**Interview answer:** "Resources for conversations, a streaming messages endpoint using SSE with token, tool, approval-needed and done events, separate approvals and uploads endpoints, and the job pattern for long work. Identity and tenant come from the JWT, every query is scoped, writes use idempotency keys, errors are Problem Details, and state lives on the server so clients can reconnect and resume."

**Follow-ups:**
- *Why a separate approval endpoint instead of keeping the stream bidirectional?* SSE is one-way; a plain POST is simple, idempotent, auditable and works if the stream has dropped.

---

## 8. API styles & databases in FastAPI

### Q47. REST vs GraphQL vs gRPC vs WebSockets/SSE: how do you choose?

**Short answer:** **REST** exposes resources over HTTP and is the default. **GraphQL** lets the client ask for exactly the fields it needs from one endpoint. **gRPC** is fast, strongly typed, binary RPC (remote procedure calls) between services. **WebSockets / SSE** keep a connection open so the server can push updates. Pick by who the clients are and what they need, not by fashion.

**How it works:**

| | REST | GraphQL | gRPC | WebSockets / SSE |
|---|---|---|---|---|
| Shape | resources + HTTP methods | one endpoint; client chooses fields | typed methods from `.proto` files, Protobuf over HTTP/2 | long-lived connection; server pushes |
| Strengths | simple, cacheable, universal tooling | no over/under-fetching; one round trip for nested data | fast, typed, streaming, generated clients | real-time updates, token streaming |
| Weaknesses | over/under-fetching, several round trips | harder caching, query cost control, N+1 in resolvers | not browser-native (needs gRPC-Web/proxy), harder to debug | connection management, scaling |
| Typical use | public APIs, CRUD, React to FastAPI | complex UIs aggregating many entities | internal service-to-service | chat, notifications, LLM streaming |

**Example:** the same data request.
```
REST:    GET /users/42            then   GET /users/42/orders?limit=5
GraphQL: POST /graphql   { user(id: 42) { name orders(limit: 5) { id total } } }
gRPC:    rpc GetUser(GetUserRequest) returns (User);
```

**What happens, step by step:**
1. REST: two requests, two responses; each can be cached by URL; the `user` response may include fields the screen doesn't need.
2. GraphQL: one request; the response contains exactly `name` and five `{id,total}` orders. The server must guard against huge or deeply nested queries (depth/cost limits) and N+1 resolvers.
3. gRPC: a binary call over HTTP/2 between two backend services, with generated client code and a schema that catches mismatches at build time.
4. SSE/WebSocket: after the initial request, the server pushes updates (an order status change) without the client asking again.

**Common mistake → fix:** adopting GraphQL or gRPC for a simple CRUD app with one frontend. You pay for tooling, caching and security complexity with no benefit. Start with REST + OpenAPI; add others when a concrete need appears.

**Interview answer:** "REST with OpenAPI is my default for the React to FastAPI API. I add SSE for streaming tokens and progress, consider GraphQL when many different clients need flexible aggregated reads, and use gRPC for internal service-to-service calls where latency and typed contracts matter. Each added style has costs in caching, security and operations, so I need a concrete reason."

**Follow-ups:**
- *Can FastAPI do GraphQL or gRPC?* GraphQL via libraries such as Strawberry; gRPC is usually a separate service rather than FastAPI.

---

### Q48. How do you use a relational database from FastAPI (SQLAlchemy 2.0 async and Alembic)?

**Short answer:** Create **one async engine** (it owns the connection pool) per process at startup, give each request **its own session** through a dependency, keep transactions short, always include the tenant filter in queries, and manage schema changes with **Alembic** migrations run once per deploy. The engine is shared; sessions are per request and never shared across requests.

**How it works:**
1. **Engine:** `create_async_engine("postgresql+asyncpg://…", pool_size=10, max_overflow=5, pool_pre_ping=True)`; created at startup and disposed at shutdown (lifespan).
2. **Session factory:** `async_sessionmaker(engine, expire_on_commit=False)`; a dependency yields one `AsyncSession` per request and closes it afterwards, returning the connection to the pool.
3. **Transactions:** `async with session.begin():` commits on success and rolls back on error.
4. **Models:** SQLAlchemy 2.0 `DeclarativeBase` with `Mapped[...]` typed columns.
5. **Migrations:** Alembic compares models with the database and generates revision scripts.

**Example:**
```python
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import select

engine = create_async_engine(settings.database_url, pool_size=10, max_overflow=5, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

class Base(DeclarativeBase): ...

class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[str] = mapped_column(primary_key=True)
    tenant_id: Mapped[str] = mapped_column(index=True)
    status: Mapped[str]

async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session

SessionDep = Annotated[AsyncSession, Depends(get_session)]

@router.post("/jobs", status_code=201, response_model=JobOut)
async def create_job(body: JobIn, session: SessionDep, user: CurrentUser):
    job = Job(id=new_id(), tenant_id=user.tenant_id, status="PENDING")
    async with session.begin():
        session.add(job)
    return job

@router.get("/jobs/{job_id}", response_model=JobOut)
async def get_job(job_id: str, session: SessionDep, user: CurrentUser):
    job = await session.scalar(select(Job).where(Job.id == job_id, Job.tenant_id == user.tenant_id))
    if not job:
        raise HTTPException(404)
    return job
```
```bash
alembic init -t async migrations                      # async template
alembic revision --autogenerate -m "add jobs table"   # review the generated file!
alembic upgrade head                                  # run once per deploy, not at every container start
```

```flow
sequence: One request using the async engine and a session
actors: Request, get_session, Engine pool, PostgreSQL
Request -> get_session: Depends(get_session)
get_session -> Engine pool: open an AsyncSession (a connection is borrowed lazily)
Request -> PostgreSQL: session.begin(), INSERT job_1, COMMIT
PostgreSQL --> Request: committed
get_session -> Engine pool: after the response the session closes and the connection returns
> One engine per process owns the pool; each request gets its own short-lived session. Migrations are run separately with Alembic.
```

**What happens, step by step:**
1. Startup: the engine creates a pool (up to 10 + 5 overflow connections), lazily opened.
2. `POST /jobs`: `get_session` creates a session; `session.begin()` borrows a connection, inserts `job_1` for tenant `t1`, commits.
3. `get_job("job_1")` for tenant `t2` runs `WHERE id='job_1' AND tenant_id='t2'` → no row → `404`.
4. When the response is done, the session closes and the connection goes back to the pool for the next request.
5. Deployment: CI runs `alembic upgrade head` once; containers don't race to migrate.

**Common mistake → fix:** lazy-loading relationships in async code: `job.owner.name` raises `MissingGreenlet` because it would need to run a query implicitly. Load it up front with `selectinload(Job.owner)` in the query (this also avoids N+1 queries), or use `await job.awaitable_attrs.owner`. Also don't run migrations from every container at startup; run them as one deploy step and write them backward-compatibly (expand, migrate, contract).

**Interview answer:** "One async engine per process with a sized pool, created and disposed in the lifespan; one AsyncSession per request from a yield dependency; short transactions with session.begin; every query scoped by tenant; eager loading to avoid N+1 and MissingGreenlet; and Alembic migrations generated, reviewed and run once per deploy, written to be backward-compatible. Pool sizes are budgeted against the database's max_connections."

**Follow-ups:**
- *Why `expire_on_commit=False`?* Otherwise accessing attributes after commit triggers an implicit refresh query, which fails in async code.
- *Sync or async SQLAlchemy?* Async fits `async def` endpoints; sync sessions with plain `def` endpoints are also fine and simpler.

---

## 9. Cheat sheet

| Concept | One-liner |
|---|---|
| HTTP request/response | Method + path + headers + body in; status + headers + body out; stateless |
| Methods | GET read, POST create/action, PUT replace, PATCH partial, DELETE remove; safe = no change, idempotent = repeat is harmless |
| Status codes | 201 create, 202 async, 204 delete, 401 authN, 403 authZ, 404 hide/missing, 409 conflict, 412 ETag, 422 validation, 429 rate |
| REST | Plural nouns, methods as verbs, nest for ownership, Problem Details errors |
| Idempotency | `Idempotency-Key` + unique constraint + stored response |
| Pagination | Cursor/keyset for big data; cap `limit` |
| ETag | `If-Match` + `WHERE version = n` → 412 on conflict |
| Versioning | Additive changes; expand, migrate, contract; Sunset headers |
| FastAPI | Starlette + Pydantic + Depends + OpenAPI on ASGI (Uvicorn) |
| async | Loop interleaves I/O waits; never block it; `def` endpoint or `to_thread` for blocking code |
| Params | Path in `{}`, simple types = query, Pydantic model = body |
| Pydantic | Types + constraints → 422; `extra="forbid"`; separate input/output models |
| `response_model` | Filters and documents output; stops leaks |
| `Depends` | Per-request DI, cached, `yield` cleanup, `dependency_overrides` in tests |
| Lifespan | Create/close shared clients and engine |
| Errors | HTTPException, domain exception handlers, generic 500 + request ID |
| Middleware | Cross-cutting for every request; route logic goes in dependencies |
| OpenAPI | `/docs`, generated TypeScript types, diff in CI |
| Settings | pydantic-settings, validated at startup, `SecretStr` |
| SSE | `EventSourceResponse`; keep-alive ping every 15 s; ALB idle timeout 60 s default |
| WebSocket vs SSE | Two-way vs one-way; SSE simpler to run |
| BackgroundTasks | In-process, not durable → use queues |
| Jobs | 202 + job ID + queue + worker + status endpoint |
| Uploads | Presigned S3 POST with size/type conditions |
| JWT | Verify signature, `iss`, `aud`, `exp`, pinned algorithm via cached JWKS |
| AuthZ / IDOR | Scope every query by tenant/owner from the token |
| CORS | Exact origins; same-origin best; never `*` with credentials |
| SSRF | Allowlist, block private IPs, re-check redirects, IMDSv2 |
| Rate limits | Per tenant/user in Redis; 429 + Retry-After |
| Health | Liveness shallow, readiness meaningful |
| Observability | OTel traces + `traceparent`; trace ID in logs; RED metrics |
| Testing | `TestClient` + overrides, real Postgres, negative authZ tests |
| DB | One async engine, session per request, Alembic once per deploy |

## Official references

- FastAPI docs: https://fastapi.tiangolo.com/ · Tutorial: https://fastapi.tiangolo.com/tutorial/ · Async: https://fastapi.tiangolo.com/async/
- Dependencies: https://fastapi.tiangolo.com/tutorial/dependencies/
- Server-Sent Events: https://fastapi.tiangolo.com/tutorial/server-sent-events/
- Lifespan events: https://fastapi.tiangolo.com/advanced/events/
- FastAPI CLI: https://fastapi.tiangolo.com/fastapi-cli/
- Pydantic: https://docs.pydantic.dev/ · pydantic-settings: https://docs.pydantic.dev/latest/concepts/pydantic_settings/
- RFC 9110 HTTP semantics: https://www.rfc-editor.org/rfc/rfc9110 · RFC 9457 Problem Details: https://www.rfc-editor.org/rfc/rfc9457
- OWASP API Security Top 10: https://owasp.org/API-Security/
- MDN CORS: https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
- SQLAlchemy asyncio: https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html · Alembic cookbook: https://alembic.sqlalchemy.org/en/latest/cookbook.html
- OpenTelemetry Python: https://opentelemetry.io/docs/languages/python/
