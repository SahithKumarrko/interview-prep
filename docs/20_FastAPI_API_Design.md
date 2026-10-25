# FastAPI & API Design: L2 → L3 Interview Preparation

> **Updated:** 24 October 2026 · **Level:** HTTP & REST basics → FastAPI internals → secure, resilient production APIs
> **How to use:** *Short answer* = what you say first. *Explanation / Example* = intuition and code. *Pitfall / Follow-up* = where interviewers dig.

---

## Table of contents

1. [Mental model: request lifecycle in FastAPI](#1-mental-model-request-lifecycle-in-fastapi)
2. [HTTP & REST fundamentals](#2-http--rest-fundamentals) (Q01–Q07)
3. [FastAPI core](#3-fastapi-core) (Q08–Q16)
4. [Async, streaming & background work](#4-async-streaming--background-work) (Q17–Q22)
5. [Security](#5-security) (Q23–Q28)
6. [Production readiness](#6-production-readiness) (Q29–Q34)
7. [Scenario & debugging questions](#7-scenario--debugging-questions) (Q35–Q40)
8. [API styles & databases in FastAPI](#8-api-styles--databases-in-fastapi) (Q41–Q42)
9. [Cheat sheet](#9-cheat-sheet)

---

## 1. Mental model: request lifecycle in FastAPI

**FastAPI = Starlette (ASGI web toolkit) + Pydantic (validation) + type-hint-driven dependency injection + automatic OpenAPI docs.** It runs on an ASGI server such as **Uvicorn**.

```
 Client ──HTTP──► ALB ──► Uvicorn worker (event loop)
                              │ ASGI
                              ▼
            ┌──────────────── Middleware stack (outer → inner) ───────────────┐
            │ CORS · request-id/trace · GZip · auth context · timing/logging   │
            └───────────────────────────────┬──────────────────────────────────┘
                                            ▼
                         Router: match method + path → path operation
                                            ▼
            Dependencies resolved (Depends): get_db session, get_current_user (JWT),
            authorise resource, rate-limit … (cached per request, yield = cleanup)
                                            ▼
            Request parsing & validation (Pydantic): path/query/header/body → 422 on error
                                            ▼
            Your endpoint function (async def or def → threadpool)
                                            ▼
            response_model validation/serialisation → JSON / StreamingResponse / SSE
                                            ▼
            Exception handlers (HTTPException, custom) · background tasks after response
```

**`async def` vs `def` endpoints:**
```
 async def endpoint → runs ON the event loop → must only await non-blocking I/O
 def endpoint       → FastAPI runs it in a THREADPOOL → OK for blocking libraries (boto3, requests)
```

---

## 2. HTTP & REST fundamentals

### Q01. HTTP methods and their semantics

| Method | Purpose | Safe | Idempotent |
|---|---|---|---|
| GET | read | ✅ | ✅ |
| POST | create / action / start job | ❌ | ❌ (make it so with idempotency keys) |
| PUT | replace whole resource at known URI | ❌ | ✅ |
| PATCH | partial update | ❌ | not necessarily |
| DELETE | remove | ❌ | ✅ (second delete → 404 or 204, state unchanged) |

**Safe** = no side effects; **idempotent** = repeating gives the same server state.

---

### Q02. Status codes you must know

| Code | Meaning | Typical use |
|---|---|---|
| 200 OK | success with body | GET, PATCH |
| 201 Created | resource created (+ `Location` header) | POST create |
| 202 Accepted | accepted for **async** processing | start a job → return job ID |
| 204 No Content | success, no body | DELETE |
| 400 Bad Request | malformed request / business rule violation | |
| 401 Unauthorized | **not authenticated** (missing/invalid token) | |
| 403 Forbidden | authenticated but **not allowed** | |
| 404 Not Found | doesn't exist (or hide existence from unauthorised users) | |
| 409 Conflict | version conflict, duplicate, invalid state transition | |
| 412 Precondition Failed | `If-Match` ETag mismatch | optimistic locking |
| 422 Unprocessable Content | validation failed (FastAPI default for Pydantic errors) | |
| 429 Too Many Requests | rate limited (+ `Retry-After`) | |
| 500 Internal Server Error | bug | |
| 502 / 503 / 504 | bad upstream / unavailable (overload, maintenance) / upstream timeout | proxies, ALB |

---

### Q03. REST resource design

Nouns not verbs (`/documents/{id}`), plural collections, nested only for ownership (`/conversations/{id}/messages`), actions that don't fit CRUD as sub-resources (`POST /jobs/{id}:cancel` or `POST /jobs/{id}/cancel`), consistent error format (RFC 9457 Problem Details), versioning strategy (`/v1/` path or header), use HTTP semantics (status codes, caching headers).

```json
{ "type": "https://api.example.com/errors/insufficient-quota", "title": "Quota exceeded",
  "status": 429, "detail": "Tenant t-42 used 100% of daily tokens", "instance": "/v1/chat" }
```

---

### Q04. Idempotency keys

**Short answer:** For non-idempotent operations (POST create, charge, start job), the client sends a unique `Idempotency-Key` header; the server stores key → result (with request hash) and returns the **same result** for retries instead of executing again.

```python
@app.post("/v1/jobs", status_code=202)
async def create_job(body: JobIn, idem_key: Annotated[str, Header(alias="Idempotency-Key")],
                     user: CurrentUser, db: DB):
    existing = await db.get_idempotency(user.tenant_id, idem_key)
    if existing:
        if existing.request_hash != hash_body(body):
            raise HTTPException(422, "Idempotency-Key reused with different payload")
        return existing.response                         # replay stored response
    job = await db.create_job(user, body)                # in same transaction:
    await db.save_idempotency(user.tenant_id, idem_key, hash_body(body), job.as_response(), ttl_hours=24)
    return job.as_response()
```
Race-safe with a unique constraint/conditional write on `(tenant, key)`.

---

### Q05. Pagination and filtering

| Style | How | Pros/cons |
|---|---|---|
| Offset | `?limit=50&offset=100` | simple; slow on big offsets; items shift when data changes |
| **Cursor / keyset** | `?limit=50&cursor=<opaque>` (encodes last sort key) | stable, fast (uses index); can't jump to page N |

Always cap `limit`, whitelist sortable/filterable fields, return `next_cursor`, apply tenant filter server-side.

---

### Q06. Optimistic concurrency (ETags)

Return `ETag: "v7"` with a resource; client updates with `If-Match: "v7"`; server updates only if version matches (`UPDATE … WHERE id=? AND version=7`), else **412** (or 409). Prevents lost updates when two users edit simultaneously.

---

### Q07. API versioning & backward compatibility

Additive changes are safe (new optional fields, new endpoints). Breaking changes (remove/rename field, change type/meaning) need a new version or a deprecation period. Old frontend bundles (cached SPAs) may call your API for days → keep backward compatibility, use tolerant readers (ignore unknown fields), deprecate with `Deprecation`/`Sunset` headers and monitoring of old version usage.

---

## 3. FastAPI core

### Q08. FastAPI and ASGI vs WSGI

**Short answer:** **WSGI** (Flask, Django classic) is synchronous: one request per worker thread at a time. **ASGI** supports async — one worker can handle many concurrent I/O-bound requests, plus WebSockets and streaming. FastAPI is ASGI; run with Uvicorn (or Gunicorn managing Uvicorn workers, or `fastapi run`).

---

### Q09. Pydantic request validation and response models

```python
from typing import Annotated, Literal
from fastapi import FastAPI, Query, Path
from pydantic import BaseModel, Field, field_validator

class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    document_ids: list[str] = Field(default_factory=list, max_length=20)
    mode: Literal["fast", "accurate"] = "fast"

    @field_validator("document_ids")
    @classmethod
    def unique_ids(cls, v): 
        if len(set(v)) != len(v): raise ValueError("duplicate document ids")
        return v

class ChatOut(BaseModel):
    conversation_id: str
    answer: str
    citations: list[str]

app = FastAPI()

@app.post("/v1/conversations/{conv_id}/messages", response_model=ChatOut)
async def chat(conv_id: Annotated[str, Path(pattern=r"^c_[a-z0-9]{20}$")],
               body: ChatIn,
               verbose: Annotated[bool, Query()] = False) -> ChatOut:
    ...
```
Invalid input → automatic **422** with field-level errors. `response_model` filters output (don't leak internal fields like `owner_id`, `api_key`). Pydantic v2 (Rust core) is fast; use `model_config = ConfigDict(extra="forbid")` to reject unknown fields.

---

### Q10. Dependency injection (`Depends`)

**Short answer:** Declare what an endpoint needs; FastAPI builds it per request, caches it within the request, supports nesting, and runs cleanup for `yield` dependencies. Great for DB sessions, auth, authorisation, pagination params, and **test overrides**.

```python
async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session                         # cleanup after response

async def get_current_user(token: Annotated[str, Depends(oauth2_scheme)]) -> User:
    return verify_jwt(token)                  # raises 401

async def get_owned_conversation(conv_id: str, user: Annotated[User, Depends(get_current_user)],
                                 db: Annotated[AsyncSession, Depends(get_db)]) -> Conversation:
    conv = await db.get(Conversation, conv_id)
    if not conv or conv.tenant_id != user.tenant_id or conv.owner_id != user.id:
        raise HTTPException(404)              # don't reveal existence
    return conv

CurrentUser = Annotated[User, Depends(get_current_user)]
OwnedConversation = Annotated[Conversation, Depends(get_owned_conversation)]

@app.get("/v1/conversations/{conv_id}")
async def read(conv: OwnedConversation): return conv

# tests
app.dependency_overrides[get_current_user] = lambda: User(id="u1", tenant_id="t1")
```

---

### Q11. Lifespan: startup and shutdown

```python
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http = httpx.AsyncClient(timeout=10)       # shared clients/pools created once
    app.state.redis = redis.asyncio.from_url(REDIS_URL)
    yield
    await app.state.http.aclose()                        # graceful shutdown (SIGTERM)
    await app.state.redis.aclose()

app = FastAPI(lifespan=lifespan)
```
(Replaces deprecated `@app.on_event("startup")`.)

---

### Q12. Routers and project structure

```
app/
├── main.py            # create app, middleware, include routers, lifespan
├── api/v1/            # routers: conversations.py, documents.py, jobs.py
├── core/              # config (pydantic-settings), security, logging
├── services/          # business logic (no FastAPI imports) → testable
├── repositories/      # DB access
├── schemas/           # Pydantic models
└── tests/
```
`app.include_router(conversations.router, prefix="/v1", tags=["conversations"], dependencies=[Depends(get_current_user)])`.

---

### Q13. Error handling

Raise `HTTPException(status_code, detail)` for expected errors; register custom exception handlers to map domain exceptions → HTTP (and a Problem Details format); a catch-all handler logs the stack trace with request ID and returns a generic 500 (never leak internals).

```python
@app.exception_handler(QuotaExceeded)
async def quota_handler(request: Request, exc: QuotaExceeded):
    return JSONResponse(status_code=429, headers={"Retry-After": "60"},
                        content={"title": "Quota exceeded", "status": 429})
```

---

### Q14. Middleware — where to use it

Cross-cutting concerns for **every** request: request ID / trace context, access logging & timing, CORS, GZip, security headers, (coarse) auth context. Keep business authorisation in dependencies (endpoint-specific). Pure ASGI middleware is faster than `BaseHTTPMiddleware` and safer for streaming.

```python
@app.middleware("http")
async def request_id(request: Request, call_next):
    rid = request.headers.get("x-request-id", uuid4().hex)
    structlog.contextvars.bind_contextvars(request_id=rid)
    response = await call_next(request)
    response.headers["x-request-id"] = rid
    return response
```

---

### Q15. OpenAPI and docs

FastAPI generates an OpenAPI 3 schema from your types → Swagger UI (`/docs`), ReDoc (`/redoc`). Benefits: contract for frontend, client SDK generation (TypeScript types), contract testing, API gateway import. In production you may disable or protect `/docs`. Document error responses with `responses={404: {...}}`.

---

### Q16. Settings and configuration

```python
from pydantic_settings import BaseSettings, SettingsConfigDict
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="APP_")
    database_url: str
    okta_issuer: str
    okta_audience: str
    bedrock_model_id: str
settings = Settings()        # validated at startup → fail fast on missing config
```

---

## 4. Async, streaming & background work

### Q17. Blocking calls in async endpoints

**Short answer:** In `async def`, a blocking call (boto3, `requests`, `time.sleep`, sync DB driver, heavy CPU) **freezes the event loop** → every request on that worker stalls. Options: use async libraries (httpx, asyncpg, aioboto3), run blocking code in a thread (`await asyncio.to_thread(...)` / `run_in_threadpool`), make the endpoint `def` (FastAPI uses a threadpool, default ~40 threads), or offload CPU work to a process/worker queue.

```python
@app.get("/v1/documents/{doc_id}/text")
async def get_text(doc_id: str):
    obj = await asyncio.to_thread(s3.get_object, Bucket=BUCKET, Key=doc_id)   # ✅ not blocking loop
    return {"text": obj["Body"].read().decode()}
```

---

### Q18. Server-Sent Events (SSE) for LLM streaming

**Short answer:** SSE = one-way server→client stream over plain HTTP (`text/event-stream`), auto-reconnect in browsers with `Last-Event-ID`. Ideal for token streaming. FastAPI has native SSE support (`fastapi.sse.EventSourceResponse` + `ServerSentEvent`); `StreamingResponse` also works.

```python
from collections.abc import AsyncIterable
from fastapi.sse import EventSourceResponse, ServerSentEvent

@app.post("/v1/conversations/{conv_id}/stream", response_class=EventSourceResponse)
async def stream(conv: OwnedConversation, body: ChatIn, request: Request) -> AsyncIterable[ServerSentEvent]:
    seq = 0
    async for ev in agent.astream(conv.thread_id, body.message):     # LangGraph / AgentCore stream
        if await request.is_disconnected():
            await agent.cancel(conv.thread_id); break                # stop paying for tokens
        seq += 1
        yield ServerSentEvent(event=ev.type, data=ev.payload, id=f"{conv.id}:{seq}")
    yield ServerSentEvent(event="done", data={"ok": True})
```
Production details: heartbeat comments every ~15 s (keep proxies/ALB from idling out), disable proxy buffering, auth on the endpoint, per-user concurrent stream limit, persist events if you want resume-after-reconnect. (Browser `EventSource` only supports GET without custom headers → use `fetch` streaming for POST + Authorization header.)

---

### Q19. WebSockets vs SSE

| | SSE | WebSocket |
|---|---|---|
| Direction | server → client | bidirectional |
| Protocol | HTTP (works through most proxies, HTTP/2 multiplexing) | upgrade to WS |
| Reconnect | built-in (`Last-Event-ID`) | you implement |
| Use | token streaming, progress updates | chat with interrupts, voice, collaborative editing |

---

### Q20. `BackgroundTasks` — and its limits

`BackgroundTasks` runs a function **after the response is sent, in the same process**. Fine for small fire-and-forget work (send an email, write an audit log). **Not** for important or long work: lost if the container restarts/scales in, no retries, no visibility, consumes the web worker. Use a durable queue (SQS + worker), Step Functions, or Celery/RQ for real jobs.

---

### Q21. Resilient async jobs API

```
 POST /v1/jobs (Idempotency-Key) → validate + authZ → insert job PENDING → enqueue (outbox/SQS) → 202 {job_id, status_url}
 GET  /v1/jobs/{id}              → status, progress, result links (presigned), error
 GET  /v1/jobs/{id}/events (SSE) → live progress
 POST /v1/jobs/{id}/cancel       → idempotent cancel
 Worker: claim job with conditional update, process, heartbeat progress, retries with backoff, DLQ, final state
```
Server is the source of truth; clients can refresh/reconnect any time.

---

### Q22. Uploads without proxying file bytes

Return a **presigned S3 URL** (POST policy with `content-length-range`, content-type, server-chosen key under the tenant prefix, short expiry); browser uploads directly to S3; S3 event triggers validation/scanning; API marks it ready. Avoids tying up API workers and request size limits. If you must accept uploads in FastAPI, stream (`UploadFile` spools to disk), enforce size limits, validate magic bytes.

---

## 5. Security

### Q23. Authentication vs authorisation in an API

**Authentication** (who are you): validate the **JWT** from Okta/Cognito — signature against IdP JWKS (cache keys, handle rotation via `kid`), `iss`, `aud`, `exp`/`nbf`, allowed algorithms (never `none`), scopes. **Authorisation** (may you do this): role/scope checks + **resource-level** ownership/tenant checks in dependencies or service layer, on every request.

```python
jwks_client = jwt.PyJWKClient(f"{settings.okta_issuer}/v1/keys", cache_keys=True)

def verify_jwt(token: str) -> User:
    try:
        key = jwks_client.get_signing_key_from_jwt(token).key
        claims = jwt.decode(token, key, algorithms=["RS256"],
                            audience=settings.okta_audience, issuer=settings.okta_issuer)
    except jwt.PyJWTError:
        raise HTTPException(401, headers={"WWW-Authenticate": "Bearer"})
    return User(id=claims["sub"], tenant_id=claims["tenant"], groups=claims.get("groups", []))
```

---

### Q24. IDOR — a request selects another tenant's document ID

**Insecure Direct Object Reference:** changing `/documents/123` → `/documents/124` returns someone else's data. Defend: always load resources **scoped by tenant/owner from the token** (`WHERE id = ? AND tenant_id = ?`), return 404 for not-owned, unguessable IDs (UUIDs) as defence-in-depth (not a substitute), central authorisation helpers, automated cross-tenant negative tests, apply the same to document IDs passed into RAG/agent tools.

---

### Q25. CORS — secure configuration

```python
app.add_middleware(CORSMiddleware,
    allow_origins=["https://app.example.com"],       # exact origins, not "*" with credentials
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
    max_age=600)
```
CORS protects browsers' users, not your API — attackers using curl ignore it. Prefer same-origin (CloudFront routes `/api/*`) to avoid CORS entirely.

---

### Q26. SSRF and file upload security

**SSRF:** endpoints/tools that fetch user-supplied URLs (web fetch tool, webhook, "import from URL") can be abused to reach internal services or the metadata endpoint. Defend: allowlist domains/schemes, resolve DNS and block private/link-local IP ranges (re-check after redirects), no redirects or limited, egress through a proxy, IMDSv2, timeouts and size limits.
**Uploads:** size limits, type validation by content (not extension), malware scan, store outside web root (S3), random keys, never execute/parse with unsafe libraries, sanitise filenames when displaying.

---

### Q27. Rate limiting and quotas

Per user/tenant/IP limits (token bucket in Redis, or API Gateway usage plans/WAF rate rules), separate limits for expensive endpoints (LLM chat) and **token budgets** per tenant, return 429 + `Retry-After`, limit concurrent streams, protect login endpoints against brute force.

---

### Q28. Other API security essentials

HTTPS only (HSTS), security headers, input size limits (body, list lengths), output encoding, no secrets in logs/errors, dependency scanning, least-privilege IAM for the service, audit logs for sensitive actions, OWASP API Security Top 10 (BOLA/IDOR, broken auth, excessive data exposure, lack of rate limiting, BFLA, mass assignment — use explicit Pydantic input models, SSRF, misconfiguration, inventory, unsafe consumption of third-party APIs).

---

## 6. Production readiness

### Q29. Making FastAPI production-ready on ECS

- Run: `uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers N` (or `fastapi run`), or Gunicorn + Uvicorn workers; workers ≈ CPU cores; container exec-form entrypoint.
- Graceful shutdown on SIGTERM (Uvicorn drains in-flight; lifespan closes pools); `stopTimeout` and ALB deregistration delay aligned.
- `--proxy-headers` / `--forwarded-allow-ips` behind ALB for correct client IP/scheme.
- Connection pools sized: DB pool per worker × workers × tasks ≤ DB max connections (or RDS Proxy).
- Timeouts on every outbound call; retries with backoff only for idempotent operations.
- Structured JSON logs, OpenTelemetry tracing, metrics (RED: rate, errors, duration).
- Health endpoints, autoscaling on request count/latency, non-root container, secrets from Secrets Manager.

---

### Q30. Health, liveness and readiness

- **Liveness** (`/health/live`): process is alive and event loop responsive — no dependency calls. Failing → restart.
- **Readiness** (`/health/ready`): can serve traffic (DB reachable, config loaded, warm-up done). Failing → stop routing traffic, don't restart.
- **Startup**: allow slow initialisation (ECS `startPeriod`, ALB grace period).

ALB target health should usually use a cheap readiness check; avoid deep checks that make all tasks fail together when a shared dependency blips (cascading failure).

---

### Q31. OpenTelemetry instrumentation

Auto-instrument FastAPI, httpx, SQLAlchemy, boto3/botocore (ADOT/OTel SDK); propagate W3C `traceparent` to downstream (AgentCore, Lambda tools); add span attributes (tenant pseudonymised, model ID, token counts, tool names); export via OTel collector sidecar to X-Ray/CloudWatch or other backends; correlate log lines with trace ID; sample (always keep errors).

---

### Q32. Testing FastAPI

```python
from fastapi.testclient import TestClient     # or httpx.AsyncClient with ASGITransport for async tests

def test_cannot_read_other_tenants_conversation(db_with_two_tenants):
    app.dependency_overrides[get_current_user] = lambda: User(id="u1", tenant_id="t1")
    client = TestClient(app)
    r = client.get("/v1/conversations/c_of_tenant_t2")
    assert r.status_code == 404
```
Unit tests for services, API tests with dependency overrides, contract tests against OpenAPI (schemathesis), integration with real Postgres in a container, load tests (k6/Locust) including SSE.

---

### Q33. Schema changes without breaking older frontends

Additive fields only; keep old fields until usage drops (monitor); new required input fields get defaults; expand-migrate-contract for DB; version endpoints for breaking changes; generate TypeScript types from OpenAPI so the frontend sees changes in CI.

---

### Q34. Performance tuning

Profile first; async I/O end to end; connection pooling and keep-alive (shared `httpx.AsyncClient`); avoid N+1 DB queries; cache hot reads; `orjson` responses; GZip for big JSON; offload CPU work; right number of workers; avoid huge Pydantic models in hot loops (or use `model_construct` for trusted data).

---

## 7. Scenario & debugging questions

### Q35. An SSE stream works locally but drops through the ALB after ~60 s idle

ALB **idle timeout** (default 60 s) closes connections with no bytes flowing — e.g., while the agent is thinking or waiting for a tool. Fix: send heartbeat comments every 15–30 s and/or raise ALB idle timeout; check CloudFront origin read/keep-alive timeouts; disable proxy buffering; ensure deploys don't cut streams (deregistration delay + client reconnect with `Last-Event-ID`).

---

### Q36. The API returns 401 on every request after an Okta change

Check what changed: **issuer** URL (custom authorization server vs org), **audience**, signing keys rotated and JWKS cache stale or JWKS URL wrong, algorithm, clock skew, token now missing a claim you require (`groups`, custom `tenant`), access token vs ID token sent by the SPA. Decode a token (safely, locally) and compare claims with your config; log the validation error reason (not the token).

---

### Q37. p99 latency spikes but p50 is normal

Event-loop blocking by occasional sync calls/CPU work, GC pauses, DB pool exhaustion under bursts, cold paths (first call to a model, cache misses), slow downstream for some tenants (bigger prompts), retries. Check traces of slow requests, event-loop lag metrics, pool wait time.

---

### Q38. Clients get duplicate jobs when the network flakes

Clients retry POST on timeout → duplicate jobs. Require `Idempotency-Key`, enforce with a unique constraint, return the original 202 response on retry.

---

### Q39. Memory grows steadily in the API containers

Unbounded in-process caches, accumulating background tasks, large responses held in memory instead of streamed, per-request clients not closed (create shared clients in lifespan), Pydantic models of huge payloads. Use `tracemalloc`/memray, fix, add memory alarms; recycle workers (`--limit-max-requests`) as a stopgap.

---

### Q40. Design the chat API for an agentic app (endpoints)

```
POST   /v1/conversations                         create (server-generated id, owner = token sub)
GET    /v1/conversations?cursor=                 list own conversations
GET    /v1/conversations/{id}                    read (ownership check)
POST   /v1/conversations/{id}/messages/stream    send message → SSE stream (token/tool/approval/done)
GET    /v1/conversations/{id}/approvals          pending approvals
POST   /v1/approvals/{approval_id}/decision      approve/reject (approver authZ, Idempotency-Key)
POST   /v1/uploads                               presigned upload URL
POST   /v1/jobs  · GET /v1/jobs/{id} · GET /v1/jobs/{id}/events   async document jobs
```
Cross-cutting: JWT auth, tenant scoping, rate limits/token budgets, Problem Details errors, OpenAPI, tracing.

---

## 8. API styles & databases in FastAPI

### Q41. REST vs GraphQL vs gRPC vs WebSockets/SSE

| | REST | GraphQL | gRPC | WebSockets / SSE |
|---|---|---|---|---|
| Shape | resources + HTTP verbs | one endpoint; client asks for exact fields | typed RPC methods from `.proto` files, binary (Protobuf) over HTTP/2 | long-lived connection; server pushes |
| Strengths | simple, cacheable (HTTP caching), universal | no over/under-fetching; one round trip for nested data | fast, strongly typed, streaming, code-gen clients | real-time updates, token streaming |
| Weaknesses | over/under-fetching, many round trips | caching harder, query cost control (depth limits), N+1 in resolvers | not browser-native (needs gRPC-Web/proxy), harder to debug | connection management, scaling sticky connections |
| Typical use | public/partner APIs, CRUD | complex UIs aggregating many entities | internal service-to-service | chat, notifications, LLM streaming (Q18–Q19) |

```
REST:    GET /users/42            GET /users/42/orders?limit=5
GraphQL: POST /graphql   { user(id: 42) { name orders(limit: 5) { id total } } }
gRPC:    rpc GetUser(GetUserRequest) returns (User);
```
**Interview stance:** REST + OpenAPI for the React ↔ FastAPI API; SSE for streaming tokens; gRPC only where internal latency/throughput justifies it; GraphQL when many clients need flexible aggregated reads.

---

### Q42. Using a relational database from FastAPI (SQLAlchemy 2.0 async + Alembic)

**Short answer:** Create **one async engine** (connection pool) at startup, give each request its **own session** through a dependency, keep transactions short, and manage schema changes with **Alembic** migrations.

```python
# db.py
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

engine = create_async_engine(settings.database_url,          # postgresql+asyncpg://...
                             pool_size=10, max_overflow=5, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

class Base(DeclarativeBase): ...

class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[str] = mapped_column(primary_key=True)
    tenant_id: Mapped[str] = mapped_column(index=True)
    status: Mapped[str]

async def get_session():
    async with SessionLocal() as session:      # one session per request
        yield session                          # closed automatically after the response

# routes.py
from typing import Annotated
SessionDep = Annotated[AsyncSession, Depends(get_session)]

@router.post("/jobs", status_code=201)
async def create_job(body: JobIn, session: SessionDep, user: CurrentUser):
    job = Job(id=new_id(), tenant_id=user.tenant_id, status="PENDING")
    async with session.begin():                # commit on success, rollback on error
        session.add(job)
    return JobOut.model_validate(job, from_attributes=True)

@router.get("/jobs/{job_id}")
async def get_job(job_id: str, session: SessionDep, user: CurrentUser):
    job = await session.scalar(
        select(Job).where(Job.id == job_id, Job.tenant_id == user.tenant_id))   # tenant filter = IDOR guard
    if not job:
        raise HTTPException(404)
    return JobOut.model_validate(job, from_attributes=True)
```
Dispose the engine in the lifespan shutdown (`await engine.dispose()`).

**Alembic (migrations):**
```bash
alembic init -t async migrations                     # async template
alembic revision --autogenerate -m "add jobs table"  # diff models vs DB → migration file (REVIEW it!)
alembic upgrade head                                 # apply (run as a separate CI/CD step or one-off task)
```
**Pitfalls:**
- Implicit lazy-loading of relationships fails in async (raises `MissingGreenlet`) — use `selectinload()` (avoids N+1 too, 21 Q12) or `AsyncAttrs` + `await obj.awaitable_attrs.rel`.
- Don't run migrations from every app container at startup (race between tasks) — run once per deploy.
- Write migrations backward-compatible (expand → migrate → contract, 21 Q25).
- Size pools from the DB's `max_connections` ÷ number of tasks (21 Q22).

---

## 9. Cheat sheet

| Concept | One-liner |
|---|---|
| API styles | REST default; GraphQL flexible reads; gRPC internal; SSE streaming |
| DB in FastAPI | one async engine; session per request via `Depends`; Alembic migrations once per deploy |
| FastAPI | Starlette + Pydantic + DI + OpenAPI on ASGI (Uvicorn) |
| ASGI vs WSGI | async many-concurrent vs sync one-per-worker |
| `async def` | never block the loop; `to_thread` or `def` endpoint |
| Validation | Pydantic → 422; `response_model` filters output |
| `Depends` | per-request DI, nesting, `yield` cleanup, test overrides |
| Lifespan | create/close shared clients |
| Status codes | 201 create, 202 async, 401 authN, 403 authZ, 409 conflict, 422 validation, 429 rate |
| Idempotency | `Idempotency-Key` + unique constraint |
| Pagination | cursor/keyset for large data |
| Concurrency | ETag + `If-Match` → 412 |
| SSE | `EventSourceResponse`; heartbeats; ALB idle timeout |
| BackgroundTasks | in-process, not durable → use queues |
| Uploads | presigned S3, not through API |
| AuthN | verify JWT signature, iss, aud, exp via JWKS |
| AuthZ | resource-level tenant/owner checks every request (IDOR) |
| CORS | exact origins; same-origin best |
| Health | liveness shallow, readiness meaningful |

## Official references

- FastAPI docs: https://fastapi.tiangolo.com/
- Dependencies: https://fastapi.tiangolo.com/tutorial/dependencies/
- Server-Sent Events: https://fastapi.tiangolo.com/tutorial/server-sent-events/
- Lifespan events: https://fastapi.tiangolo.com/advanced/events/
- Pydantic v2: https://docs.pydantic.dev/
- RFC 9110 HTTP semantics: https://www.rfc-editor.org/rfc/rfc9110 · RFC 9457 Problem Details: https://www.rfc-editor.org/rfc/rfc9457
- OWASP API Security Top 10: https://owasp.org/API-Security/
- SQLAlchemy asyncio extension: https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html
- Alembic cookbook (async template `alembic init -t async`): https://alembic.sqlalchemy.org/en/latest/cookbook.html
