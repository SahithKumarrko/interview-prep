# Software Design: OOP, SOLID, Design Patterns & Microservice Patterns: Interview Preparation

> **Updated:** 25 October 2026 · **Level:** OOP principles → SOLID → classic patterns in Python → distributed/microservice patterns → design review scenarios
> **How to use:** *Short answer* = your first 30 seconds. *Explanation / Example* build intuition. *Pitfall / Follow-up* = where interviewers dig deeper.

---

## Table of contents

1. [Mental model: why design principles exist](#1-mental-model-why-design-principles-exist)
2. [OOP & core principles](#2-oop--core-principles) (Q01–Q04)
3. [SOLID](#3-solid) (Q05–Q09)
4. [Classic design patterns in Python](#4-classic-design-patterns-in-python) (Q10–Q19)
5. [Microservice & distributed-system patterns](#5-microservice--distributed-system-patterns) (Q20–Q30)
6. [Scenario & design-review questions](#6-scenario--design-review-questions) (Q31–Q35)
7. [Cheat sheet](#7-cheat-sheet)

---

## 1. Mental model: why design principles exist

**All of these principles answer one question: when requirements change, how much code do I have to touch, and how much can break?**

```
           HIGH COUPLING (bad)                          LOW COUPLING, HIGH COHESION (good)
 ┌──────────┐   knows internals of   ┌──────────┐       ┌──────────┐  depends on   ┌───────────┐
 │ Agent    │──────────────────────► │ Bedrock  │       │ Agent    │─────────────► │ LLMClient │ (interface)
 │ service  │  boto3 calls, retry    │ SDK code │       │ service  │               └─────▲─────┘
 └──────────┘  logic, JSON parsing   └──────────┘       └──────────┘          ┌──────────┴─────────┐
 change provider → rewrite agent service                                 BedrockClient    FakeClient (tests)
                                                        change provider → add one class; agent untouched
```
- **Coupling** = how much one module depends on another's details. Lower is better.
- **Cohesion** = how focused one module is on one job. Higher is better.
- Patterns are **named, proven shapes** for common problems — vocabulary for design discussions, not goals in themselves.

---

## 2. OOP & core principles

### Q01. The four pillars of OOP

```flow
pipeline: The four OOP pillars on one Account class
Encapsulation > `_balance` is changed only through deposit().
Abstraction > Callers use `deposit(100)` without knowing how it's stored.
Inheritance > `SavingsAccount(Account)` reuses and extends it.
Polymorphism > `for acc in accounts: acc.monthly_fee()` — each type answers its own way.
```

| Pillar | Meaning | Python example |
|---|---|---|
| **Encapsulation** | keep data + behaviour together, hide internals | `_balance` attribute changed only via `deposit()` |
| **Abstraction** | expose *what* it does, hide *how* | `storage.save(doc)` — caller doesn't know it's S3 |
| **Inheritance** | a class reuses/extends another | `class PdfParser(Parser)` |
| **Polymorphism** | same call, different behaviour per type | `for p in parsers: p.parse(f)` |

```python
class Account:
    def __init__(self):
        self._balance = 0            # "private" by convention
    def deposit(self, amount: int) -> None:
        if amount <= 0:
            raise ValueError("amount must be positive")   # invariant protected
        self._balance += amount
    @property
    def balance(self) -> int:
        return self._balance        # read-only view
```

---

### Q02. Composition over inheritance

**Short answer:** Prefer building objects **from** other objects ("has-a") over deep class hierarchies ("is-a"). Inheritance couples the child to the parent's internals; composition lets you swap parts.

```flow
trace: Composition: wrapping behaviours around a client
BedrockClient() > The core client.
CachingClient(BedrockClient()) > Adds caching without touching the original.
RetryingClient(CachingClient(BedrockClient())) > Adds retries on top.
call invoke() → retry layer → cache layer → Bedrock > Swap or reorder layers freely; inheritance would need a class for every combination.
```

```python
# ❌ inheritance explosion: RetryingBedrockClient, CachingBedrockClient, CachingRetryingBedrockClient...
# ✅ composition: wrap behaviours around any client
class RetryingClient:
    def __init__(self, inner, attempts=3):
        self.inner, self.attempts = inner, attempts
    def invoke(self, prompt):
        for i in range(self.attempts):
            try:
                return self.inner.invoke(prompt)
            except ThrottlingError:
                time.sleep(2 ** i)
        raise

client = RetryingClient(CachingClient(BedrockClient()))
```
Use inheritance for true "is-a" with a stable base (e.g. exception hierarchies, framework base classes).

---

### Q03. DRY, KISS, YAGNI

```flow
pipeline: When to abstract duplicated code
First time > Just write it.
Second time > Duplicate it, notice the similarity.
Third time > The shape is clear: extract a shared function.
Check > Are they really the same KNOWLEDGE, or just similar-looking code that will diverge?
```

- **DRY** (Don't Repeat Yourself): one source of truth for each piece of *knowledge* (not every similar-looking line). Duplicating code twice is fine; abstract on the third time when the shape is clear.
- **KISS** (Keep It Simple): the simplest design that meets requirements.
- **YAGNI** (You Aren't Gonna Need It): don't build for imagined future needs.

**Pitfall:** wrong abstraction is worse than duplication — merging two things that only *look* alike creates coupling that breaks when they diverge.

---

### Q04. Interfaces in Python: ABC vs Protocol

Python has no `interface` keyword. **ABC** = nominal (classes must inherit and implement abstract methods; error at instantiation). **Protocol** = structural (any class with matching methods fits; checked by mypy/pyright). Use Protocols for ports like `LLMClient` so third-party classes fit without inheriting. Details in 01 Q20.

```flow
pipeline: ABC vs Protocol
ABC > Class must inherit and implement abstract methods; error at instantiation if missing.
Protocol > Any class with matching methods fits; checked by mypy/pyright.
Use Protocol for ports > Third-party classes fit without inheriting.
Use ABC > When you want shared base behaviour + enforced subclassing.
```

---

## 3. SOLID

**SOLID = five principles for classes/modules that are easy to change.** Examples use one domain: a document-processing service.

### Q05. S — Single Responsibility Principle

**Short answer:** A class should have **one reason to change** — one owner/stakeholder.

```flow
pipeline: SRP: one change, one class
Parsing rules change > Only InvoiceParser changes.
Storage moves S3 → DB > Only InvoiceRepository changes.
Email template changes > Only FinanceNotifier changes.
ProcessInvoice wires them > A small coordinator; each class has one reason to change.
```

```python
# ❌ one class changes when the parsing rules, the storage, OR the email template changes
class InvoiceProcessor:
    def parse(self, pdf): ...
    def save_to_s3(self, data): ...
    def email_finance(self, data): ...

# ✅ separate reasons to change; a small coordinator wires them
class InvoiceParser:    def parse(self, pdf) -> Invoice: ...
class InvoiceRepository: def save(self, inv: Invoice) -> None: ...
class FinanceNotifier:  def notify(self, inv: Invoice) -> None: ...

class ProcessInvoice:                      # use case / service
    def __init__(self, parser, repo, notifier): ...
    def __call__(self, pdf):
        inv = self.parser.parse(pdf); self.repo.save(inv); self.notifier.notify(inv)
```

---

### Q06. O — Open/Closed Principle

**Short answer:** Open for **extension**, closed for **modification** — add new behaviour by adding code, not by editing a growing `if/elif` chain.

```flow
sequence: Open/closed with a registry
actors: New code, Registry, extract()
New code -> Registry: @register("xlsx") class XlsxExtractor
extract() -> Registry: EXTRACTORS[doc.type]
Registry --> extract(): XlsxExtractor
> Adding a type means adding a class, not editing the dispatch function, so existing types can't break.
```

```python
# ❌ every new file type edits this function
def extract(doc):
    if doc.type == "pdf": ...
    elif doc.type == "docx": ...
    elif doc.type == "xlsx": ...      # risk of breaking pdf while adding xlsx

# ✅ registry: new type = new class + one registration line
EXTRACTORS: dict[str, Extractor] = {}
def register(kind):
    def deco(cls):
        EXTRACTORS[kind] = cls(); return cls
    return deco

@register("pdf")
class PdfExtractor:  def extract(self, doc): ...

def extract(doc):
    return EXTRACTORS[doc.type].extract(doc)
```

---

### Q07. L — Liskov Substitution Principle

**Short answer:** A subclass must be usable anywhere its parent is expected **without surprising the caller** — same contract: accepts at least the same inputs, returns the same kind of output, doesn't throw new unexpected errors.

```flow
trace: A Liskov violation
def archive(store: Storage): store.save(key, data) > Code written against the Storage contract.
archive(S3Storage())  →  ✓ saved > Fine.
archive(ReadOnlyStorage())  →  **NotImplementedError** > The subclass broke the contract callers rely on.
fix: split Reader / Writer interfaces > ReadOnlyStorage simply isn't a Writer.
```

```python
class Storage:
    def save(self, key: str, data: bytes) -> None: ...

class ReadOnlyStorage(Storage):
    def save(self, key, data):
        raise NotImplementedError     # ❌ violates LSP: code expecting Storage now breaks
```
Fix: split interfaces (`Reader`, `Writer`) so read-only storage simply doesn't claim to be a writer. Classic textbook example: Square inheriting Rectangle breaks `set_width`.

---

### Q08. I — Interface Segregation Principle

**Short answer:** Clients shouldn't depend on methods they don't use. Prefer several small interfaces over one fat one.

```flow
pipeline: Interface segregation
Fat interface > DocStore with get, put, delete, list, admin_reset…
Client only reads > But depends on all of it; fakes must implement everything.
Split > DocReader(get), DocWriter(put).
Depend on the small one > summarise(reader: DocReader). Same for agent tools: narrow tools, least privilege.
```

```python
from typing import Protocol
class DocReader(Protocol):
    def get(self, doc_id: str) -> bytes: ...
class DocWriter(Protocol):
    def put(self, doc_id: str, data: bytes) -> None: ...

def summarise(reader: DocReader, doc_id: str): ...   # needs only read → easy to fake, least privilege
```
The same idea applies to agent tools: give an agent a narrow `read_ticket` tool, not a `jira_admin` tool with 40 operations.

---

### Q09. D — Dependency Inversion Principle

**Short answer:** High-level business logic should depend on **abstractions**, not on concrete infrastructure. Infrastructure implements the abstraction. Combined with **dependency injection** (pass dependencies in, don't create them inside), this makes code testable and swappable.

```flow
sequence: Dependency inversion with injection
actors: Composition root, TicketTriage, LLMClient (Protocol), BedrockLLM / FakeLLM
Composition root -> BedrockLLM / FakeLLM: create the concrete client
Composition root -> TicketTriage: TicketTriage(llm=client)
TicketTriage -> LLMClient (Protocol): llm.complete(prompt)
LLMClient (Protocol) -> BedrockLLM / FakeLLM: whichever was injected
> Business logic knows only the interface; production injects Bedrock, tests inject a fake.
```

```python
class LLMClient(Protocol):
    def complete(self, prompt: str) -> str: ...

class TicketTriage:                                 # business logic: knows nothing about Bedrock
    def __init__(self, llm: LLMClient):
        self.llm = llm
    def triage(self, text: str) -> str:
        return self.llm.complete(f"Classify: {text}")

# production
triage = TicketTriage(BedrockLLM(model_id=...))
# test
class FakeLLM:
    def complete(self, prompt): return "billing"
assert TicketTriage(FakeLLM()).triage("charged twice") == "billing"
```
FastAPI's `Depends` (20 Q10) is DI at the framework level; "ports and adapters" / hexagonal architecture (01 Q48) is DIP at the architecture level.

---

## 4. Classic design patterns in Python

**Three families (Gang of Four):** *Creational* (how objects are made), *Structural* (how objects are combined), *Behavioural* (how objects interact). In Python many patterns are simpler because functions are first-class objects.

### Q10. Singleton — and why it's usually a module

**Short answer:** Ensures one instance (e.g. one config, one connection pool). In Python a **module is already a singleton** (imported once), so a module-level object or `functools.cache` on a factory is the idiomatic version.

```flow
trace: Singleton the Python way
get_settings() first call  →  Settings() **created** > @functools.cache on a factory.
get_settings() again  →  **same object** returned > Cached.
module-level object > Modules are imported once, so they're natural singletons.
prefer injecting it > Globals are hard to test and unsafe to mutate across threads.
```

```python
# settings.py
from functools import cache
@cache
def get_settings() -> Settings:
    return Settings()          # created once, reused everywhere
```
**Pitfall:** singletons are global state — hard to test and unsafe to mutate across threads. Prefer creating once at startup (FastAPI lifespan) and injecting.

---

### Q11. Factory (and Abstract Factory)

**Short answer:** A function/class that decides **which concrete class to create**, so callers don't hard-code it.

```flow
pipeline: Factory choosing the implementation
Config says provider = "bedrock" > From settings.
make_llm("bedrock") > match/case on the name.
Returns BedrockLLM > Callers only see LLMClient.
Unknown name > Clear error. Abstract factory = a family (storage + queue + secrets) for AWS vs local.
```

```python
def make_llm(provider: str, **kw) -> LLMClient:
    match provider:
        case "bedrock": return BedrockLLM(**kw)
        case "openai":  return OpenAILLM(**kw)
        case "fake":    return FakeLLM()
        case _: raise ValueError(f"unknown provider {provider}")

llm = make_llm(settings.llm_provider, model_id=settings.model_id)
```
LangChain's `init_chat_model("provider:model")` is a factory. **Abstract factory** = a factory for a *family* of related objects (e.g. AWS vs local: storage + queue + secrets together).

---

### Q12. Builder

**Short answer:** Constructs a complex object step by step, often with a fluent API, separating construction from the final object. Python's keyword arguments and dataclasses remove most needs for it; it's still useful for complex, validated, multi-step construction.

```flow
pipeline: Builder: StateGraph as an example
StateGraph(State) > Start the builder.
add_node / add_edge > Configure step by step.
compile(checkpointer) > build() → validated, immutable runnable.
Why > Complex objects with many optional parts and validation at the end.
```

```python
graph = StateGraph(State)                 # LangGraph's StateGraph is a builder:
graph.add_node("plan", plan)
graph.add_edge(START, "plan")
app = graph.compile(checkpointer=saver)  # build() → immutable runnable object
```

---

### Q13. Strategy

**Short answer:** Define a family of interchangeable algorithms and choose one at runtime. In Python, a strategy is often just a function passed in.

```flow
pipeline: Strategy: swapping algorithms at runtime
index_document(text, strategy="headings") > Caller picks a strategy by name.
CHUNKERS lookup > fixed / headings / semantic functions.
Run the chosen function > Same interface for all.
Add a strategy > Add a function; nothing else changes.
```

```python
def fixed_chunks(text, size=1000): ...
def by_headings(text): ...
def semantic_chunks(text): ...

CHUNKERS = {"fixed": fixed_chunks, "headings": by_headings, "semantic": semantic_chunks}

def index_document(text, strategy="headings"):
    for chunk in CHUNKERS[strategy](text):
        embed_and_store(chunk)
```
Other examples: retry/backoff policies, pricing rules, model routing (cheap vs strong model).

---

### Q14. Observer / pub-sub

**Short answer:** Subjects notify subscribers when something happens, without knowing who they are. In-process it's callbacks/event hooks; across services it becomes pub/sub (SNS, EventBridge).

```flow
sequence: Observer / event bus
actors: Job service, EventBus, Email, Dashboard
Email -> EventBus: subscribe("job.completed")
Dashboard -> EventBus: subscribe("job.completed")
Job service -> EventBus: publish("job.completed", {job_id})
EventBus -> Email: send_email(payload)
EventBus -> Dashboard: update_dashboard(payload)
> The publisher doesn't know who listens. Across services this becomes SNS/EventBridge.
```

```python
class EventBus:
    def __init__(self): self._subs: dict[str, list] = defaultdict(list)
    def subscribe(self, event, fn): self._subs[event].append(fn)
    def publish(self, event, payload):
        for fn in self._subs[event]: fn(payload)

bus.subscribe("job.completed", send_email)
bus.subscribe("job.completed", update_dashboard)
bus.publish("job.completed", {"job_id": "123"})
```
LangChain callbacks and React state subscriptions are observers.

---

### Q15. Adapter and Facade

```flow
sequence: Facade over a document pipeline
actors: Caller, DocumentService (facade), S3, Textract, Chunker, Vector store
Caller -> DocumentService (facade): ingest(file)
DocumentService (facade) -> S3: upload
DocumentService (facade) -> Textract: extract text
DocumentService (facade) -> Chunker: chunk
DocumentService (facade) -> Vector store: embed + index
DocumentService (facade) --> Caller: doc_id
> One simple call hides five subsystems. An adapter, by contrast, converts one interface into another.
```

- **Adapter:** converts one interface into the one your code expects. E.g. wrap a vendor SDK so it matches your `LLMClient` Protocol; MCP servers are adapters that turn APIs into a standard tool interface.
- **Facade:** a simple front over a complicated subsystem. E.g. `DocumentService.ingest(file)` hides upload → Textract → chunk → embed → index.

---

### Q16. Decorator pattern (vs Python `@decorator`)

**Short answer:** The pattern wraps an object to add behaviour while keeping the same interface (the `RetryingClient` in Q02). Python's `@decorator` syntax applies the same idea to **functions** — logging, retries, caching, auth checks.

```flow
trace: A Python decorator wrapping a function
@timed def fetch(): … > At definition: fetch = timed(fetch).
fetch() → wrapper starts timer > The wrapper runs first.
→ original fetch() runs > Captured in the closure.
→ wrapper logs "fetch took 120 ms" in finally > Same idea as the decorator pattern, applied to functions.
```

```python
def timed(fn):
    @functools.wraps(fn)
    def wrapper(*a, **kw):
        t = time.perf_counter()
        try: return fn(*a, **kw)
        finally: log.info("%s took %.1f ms", fn.__name__, (time.perf_counter() - t) * 1000)
    return wrapper
```

---

### Q17. Repository and Unit of Work

**Short answer:** **Repository** = a collection-like interface for loading/saving domain objects, hiding the database. **Unit of Work** = groups changes into one transaction and commits/rolls back together.

```flow
sequence: Repository + Unit of Work in a use case
actors: Use case, UnitOfWork, DocumentRepo, Database
Use case -> UnitOfWork: async with uow
Use case -> DocumentRepo: get(doc_id)
DocumentRepo -> Database: SELECT
Use case -> Use case: doc.mark_processed()
Use case -> UnitOfWork: commit()
UnitOfWork -> Database: one transaction (or rollback on error)
> Tests swap in an in-memory repository; business logic never sees SQL.
```

```python
class DocumentRepo(Protocol):
    def get(self, doc_id: str) -> Document | None: ...
    def add(self, doc: Document) -> None: ...

class SqlDocumentRepo:
    def __init__(self, session): self.session = session
    def get(self, doc_id): return self.session.get(DocumentRow, doc_id)
    def add(self, doc): self.session.add(doc)

async with uow:                      # Unit of Work wraps the session/transaction
    doc = uow.documents.get(doc_id)
    doc.mark_processed()
    await uow.commit()
```
Business logic gets tested with an in-memory repo; SQLAlchemy's `Session` is itself a unit of work.

---

### Q18. Command and Chain of Responsibility

```flow
pipeline: Chain of responsibility (middleware)
Request > Enters the chain.
Auth handler > Reject if not authenticated, else pass on.
Rate-limit handler > Reject if over quota, else pass on.
Logging handler > Record, pass on.
Endpoint > Handles it. A tool call as a Command object can be queued, approved, logged or retried.
```

- **Command:** turn a request into an object (`{"action": "refund", "order": "A12", "amount": 50}`) that can be queued, logged, retried, approved or undone. Agent **tool calls** are commands — which is why you can validate and require approval before executing them.
- **Chain of Responsibility:** pass a request along a chain of handlers, each may handle/modify/stop it. **Middleware** in FastAPI and LangChain v1 agents is this pattern (auth → rate limit → logging → handler).

---

### Q19. Template Method

**Short answer:** A base class defines the fixed steps of an algorithm; subclasses fill in specific steps.

```flow
pipeline: Template method
Ingestor.run(src) > Fixed skeleton in the base class.
fetch > Shared step.
extract (abstract) > Each subclass fills in: PDF, HTML, DOCX.
chunk → index > Shared steps. In Python, passing the varying step as a function is often simpler.
```

```python
class Ingestor(ABC):
    def run(self, src):                 # fixed skeleton
        raw = self.fetch(src)
        text = self.extract(raw)        # varies per source
        return self.index(self.chunk(text))
    @abstractmethod
    def extract(self, raw): ...
```
Python alternative: pass the varying step as a function (strategy) — often simpler.

---

## 5. Microservice & distributed-system patterns

### Q20. Monolith vs modular monolith vs microservices

```flow
pipeline: Monolith → modular monolith → microservices
Monolith > One deployable; simple until it tangles.
Modular monolith > One deployable, strict module boundaries and owned data.
Extract a service when there's a reason > Different scaling, release cadence, team, or security boundary.
Microservices > Independent deploys, at the cost of network failures, distributed data and ops overhead.
```

| | Monolith | Modular monolith | Microservices |
|---|---|---|---|
| Deploy | one unit | one unit, strong internal module boundaries | many independent units |
| Pros | simple dev, testing, transactions | simple + clean boundaries; easy to split later | independent deploy/scale, team autonomy, fault isolation |
| Cons | tangles as it grows | discipline needed | network failures, distributed data, ops/observability cost |

**Senior-level answer:** "Start modular; split a service out when there's a concrete reason — different scaling profile (GPU/agent workers vs API), different release cadence, separate team ownership, or a fault-isolation/security boundary." Microservices are an organisational scaling tool, not a default.

---

### Q21. Domain-Driven Design basics: bounded contexts

**Short answer:** Split a system by **business capability**, where each area (bounded context) has its own model and language. "Document" means a file in *Ingestion*, a set of chunks in *Search*, and a billable unit in *Billing*. Service boundaries usually follow bounded contexts; each owns its data (**database per service** — other services use its API/events, not its tables).

```flow
pipeline: "Document" in three bounded contexts
Ingestion > A file: bytes, type, upload status.
Search > A set of chunks with embeddings.
Billing > A billable unit: pages, tenant, price.
Separate models + data > Each context owns its database; others use its API/events.
```

---

### Q22. API Gateway and Backend-for-Frontend (BFF)

```flow
sequence: A BFF aggregating calls for the UI
actors: React, BFF (FastAPI), Profile svc, Jobs svc, Agent
React -> BFF (FastAPI): GET /dashboard
BFF (FastAPI) -> Profile svc: get user
BFF (FastAPI) -> Jobs svc: recent jobs
BFF (FastAPI) -> Agent: conversation summaries
BFF (FastAPI) --> React: one response shaped for this screen
> One round trip for the browser; auth and shaping in one place. An API gateway handles routing, auth and limits at the edge.
```

- **API Gateway:** single entry point → routing, auth (JWT validation), rate limits, TLS, request validation. (AWS API Gateway, ALB + middleware.)
- **BFF:** a backend tailored to one frontend (web vs mobile) that aggregates downstream calls and shapes responses, so the UI doesn't make 6 calls. A FastAPI layer between React and AgentCore is effectively a BFF.

---

### Q23. Resilience patterns: timeout, retry, circuit breaker, bulkhead

```flow
cycle: Circuit breaker states
CLOSED > Calls flow normally; failures are counted.
OPEN > Too many failures → fail fast without calling the dependency; use a fallback.
HALF-OPEN > After a cool-down, let a few trial calls through.
exit > Trial calls succeed → back to CLOSED. They fail → OPEN again.
```

```
            timeout              retry (backoff + jitter)       circuit breaker
 caller ──► every call has  ──►  only for transient,       ──►  CLOSED: calls flow
            a deadline           idempotent operations          too many failures → OPEN: fail fast
                                 with a retry budget            after cool-down → HALF-OPEN: try a few
 bulkhead: separate pools/queues/concurrency limits per dependency, so one slow dependency can't use every worker
```

```python
class CircuitBreaker:
    def __init__(self, threshold=5, cooldown=30):
        self.fails, self.threshold, self.cooldown, self.opened_at = 0, threshold, cooldown, None
    def call(self, fn, *a, **kw):
        if self.opened_at and time.monotonic() - self.opened_at < self.cooldown:
            raise CircuitOpenError("dependency unavailable")       # fail fast, use fallback
        try:
            result = fn(*a, **kw)
        except Exception:
            self.fails += 1
            if self.fails >= self.threshold:
                self.opened_at = time.monotonic()
            raise
        self.fails, self.opened_at = 0, None                       # success → close
        return result
```
**Why it matters for LLM apps:** when a model provider is degraded, a breaker switches to a fallback model or a "try later" message instead of piling up slow requests (18 Q25).

---

### Q24. Saga pattern (distributed transactions)

**Short answer:** A business transaction across services is split into **local transactions**, each with a **compensating action** that undoes it if a later step fails. No global lock or two-phase commit.

```flow
sequence: Saga: booking a trip
actors: Saga, Flights, Hotels, Payments
Saga -> Flights: reserve flight
Saga -> Hotels: reserve hotel
Saga -> Payments: charge card
Payments --> Saga: ✗ fails
> No global transaction exists, so undo the earlier steps in reverse order.
Saga -> Hotels: cancel hotel (compensation)
Saga -> Flights: cancel flight (compensation)
```
| Style | How | Trade-off |
|---|---|---|
| **Orchestration** | a coordinator (Step Functions, LangGraph) calls each step and its compensation | clear flow, central visibility; coordinator is a dependency |
| **Choreography** | each service reacts to events and emits the next | loose coupling; flow is hard to see/debug |

Compensations must be idempotent and may not perfectly undo (an email can't be unsent → design "send" as the last step). Step Functions implementation: 15 Q13.

---

### Q25. Transactional outbox

**Short answer:** Solves "I updated my DB and need to publish an event, but either could fail" (dual-write problem). Write the event into an **outbox table in the same DB transaction** as the business change; a separate relay publishes outbox rows to the queue and marks them sent.

```flow
sequence: Transactional outbox
actors: Service, Database, Relay, EventBridge, Consumer
Service -> Database: BEGIN; UPDATE order PAID; INSERT outbox(order.paid); COMMIT
Relay -> Database: poll / CDC: new outbox rows
Relay -> EventBridge: publish order.paid
Relay -> Database: mark sent
EventBridge -> Consumer: deliver (at least once)
Consumer -> Consumer: dedupe by event id → process
```

```
BEGIN;
  UPDATE orders SET status='PAID' WHERE id=12;
  INSERT INTO outbox(id, type, payload) VALUES (uuid, 'order.paid', '{...}');
COMMIT;                     ← both or neither
relay (poller or CDC / DynamoDB Streams) → EventBridge/SQS → consumers (must be idempotent: at-least-once)
```

---

### Q26. CQRS (Command Query Responsibility Segregation)

**Short answer:** Use **different models for writes (commands) and reads (queries)**. The write side keeps normalised, validated data; one or more read models are denormalised for fast queries and updated from events.

```flow
sequence: CQRS: separate write and read models
actors: Client, Write model, Projector, Read model
Client -> Write model: POST /orders
> Validated and stored in the normalised write store (e.g. Postgres).
Write model -> Projector: event: order.created
Projector -> Read model: update denormalised view
> E.g. DynamoDB, OpenSearch or a cache, shaped for fast queries.
Client -> Read model: GET /dashboard
Read model --> Client: fast read (eventually consistent)
```
Use when reads and writes have very different shapes/scale (dashboards, search). Cost: eventual consistency between sides and more moving parts — don't use it for simple CRUD.

---

### Q27. Event sourcing

**Short answer:** Store the **sequence of events** (`DocumentUploaded`, `ExtractionCompleted`, `ApprovedBy(u42)`) as the source of truth, and derive current state by replaying them. Gives a full audit trail and time travel.

```flow
trace: Event sourcing: state from events
DocumentUploaded(doc1) > Events are the source of truth, appended only.
ExtractionCompleted(doc1, 12 pages) > Never updated in place.
ApprovedBy(doc1, u42) > Full audit trail.
replay → state {status: approved, pages: 12, approver: u42} > Current state is derived; snapshots speed up replay. Read models (CQRS) answer queries.
```

Costs: event schema versioning, replay time (use snapshots), harder queries (usually paired with CQRS read models). LangGraph checkpoints are similar in spirit — a history of state snapshots you can replay or fork (07 Q14).

---

### Q28. Strangler fig, sidecar, anti-corruption layer

```flow
pipeline: Strangler fig, step by step
Router in front of legacy > All traffic still goes to the old system.
Build one capability anew > Behind the same router.
Route that path to the new service > Gradually, with metrics.
Repeat > Capability by capability.
Remove legacy > When nothing routes to it. An anti-corruption layer translates between old and new models meanwhile.
```

- **Strangler fig:** migrate a legacy system piece by piece behind a router until the old one can be removed (18 Q27).
- **Sidecar:** a helper container next to the app in the same task/pod (log router, proxy, OTel collector) — ECS sidecars (13 Q07).
- **Anti-corruption layer:** an adapter between your clean model and a messy legacy/vendor model so its concepts don't leak into your code.

---

### Q29. Sync vs async communication; idempotent consumers

Synchronous (HTTP/gRPC) is simple but couples availability — if B is down, A fails. Asynchronous (queues/events) decouples and buffers spikes but adds eventual consistency and at-least-once delivery → every consumer must be **idempotent** (dedupe by message/operation ID). See 18 Q08–Q10.

```flow
sequence: Sync coupling vs async decoupling
actors: Orders, Payments, Queue, Email
Orders -> Payments: SYNC: charge (Orders waits; fails if Payments is down)
Payments --> Orders: ok
Orders -> Queue: ASYNC: publish order.placed
Queue -> Email: deliver when Email is up
> Async isolates failures and absorbs spikes, but consumers must be idempotent and the system is eventually consistent.
```

---

### Q30. The Twelve-Factor App (headline list)

Codebase in VCS · explicit dependencies · **config in environment** · backing services as attached resources · build/release/run separated · **stateless processes** · port binding · scale by processes · **disposability** (fast start, graceful SIGTERM) · dev/prod parity · logs as event streams · admin tasks as one-off processes. Containers on ECS follow these naturally (10 Q22).

```flow
pipeline: Twelve-factor highlights in an ECS service
Config in environment > Same image everywhere.
Stateless processes > State in S3/DB/Redis.
Disposability > Fast start, graceful SIGTERM.
Logs as streams > stdout → CloudWatch.
Dev/prod parity > Same image, real dependencies in tests.
```

---

## 6. Scenario & design-review questions

### Q31. Refactor a 2,000-line `agent_service.py` that does everything

```flow
pipeline: Refactoring a 2,000-line service safely
Characterisation tests > Lock in current behaviour.
Map responsibilities > HTTP, auth, prompts, LLM, tools, persistence, notifications.
Extract behind interfaces > LLMClient, ToolRegistry, JobRepository, Notifier.
Registry instead of if/elif > For tools.
One extraction per PR > Behaviour unchanged each time.
```

1. Add characterisation tests around current behaviour first.
2. Identify responsibilities: HTTP handling, auth, prompt building, LLM calls, tool execution, persistence, notifications.
3. Extract by responsibility (SRP) behind small interfaces (ISP/DIP): `LLMClient`, `ToolRegistry`, `JobRepository`, `Notifier`.
4. Replace `if tool == ...` chains with a registry (OCP).
5. Inject dependencies at startup; tests use fakes.
6. Do it incrementally, one extraction per PR, behaviour unchanged.

---

### Q32. "Should we split our FastAPI app into microservices?"

Ask what problem it solves: Are parts scaling differently (CPU-heavy extraction vs I/O-heavy API)? Different teams blocked on one release train? Different security boundaries? If not, keep a modular monolith and fix module boundaries first. If yes, split the **one** part with the clearest boundary (e.g. document-extraction workers behind a queue), with its own data and contract tests.

```flow
pipeline: Deciding whether to split into microservices
What's the pain? > Scaling, release coupling, team conflicts, security boundary?
Can module boundaries fix it? > Usually yes: do that first.
Split one service > The clearest boundary (e.g. extraction workers behind a queue).
Own data + contract tests > Then measure whether it helped.
```

---

### Q33. Add a new LLM provider without touching business logic

Define an `LLMClient` Protocol (DIP), implement an adapter per provider (Adapter), choose via a factory from config (Factory), wrap with retry + circuit breaker + fallback (Decorator/composition), and run the eval suite against the new provider before switching traffic.

```flow
pipeline: Adding an LLM provider without touching logic
LLMClient Protocol > Business code depends on this.
New adapter > Implements it for the new provider.
Factory from config > Picks the adapter.
Decorators > Retry + circuit breaker + fallback around any client.
Eval before switching > Golden set on the new provider.
```

---

### Q34. Two services must stay consistent: job status in Postgres and a notification event

Dual-write risk → transactional outbox (Q25); consumers idempotent by event ID; monitoring on outbox lag; a reconciliation job for drift.

```flow
pipeline: Keeping job status and notifications consistent
Outbox in the same transaction > Status change + event row.
Relay publishes > With retries.
Idempotent consumers > Dedupe by event id.
Monitor + reconcile > Alert on outbox lag; nightly reconciliation.
```

---

### Q35. How do you avoid over-engineering in a design review?

Tie every abstraction to a current requirement or a likely, cheap-to-support change; count the moving parts; prefer boring managed services; ask "what's the simplest version we could ship and measure?" Patterns are justified by the change they make easy — name that change.

```flow
pipeline: Checking a design for over-engineering
Which requirement needs this abstraction? > Name it.
Is the change it enables likely and cheap to support? > If not, drop it.
Count moving parts > Fewer is better.
Simplest shippable version? > Ship, measure, then extend.
```

---

## 7. Cheat sheet

| Concept | One-liner |
|---|---|
| Coupling / cohesion | depend on little; each module does one thing |
| Composition > inheritance | wrap and combine; inherit only for true is-a |
| SRP | one reason to change |
| OCP | extend by adding code (registry), not editing if/elif |
| LSP | subclasses keep the parent's contract |
| ISP | small, focused interfaces (and tools) |
| DIP + DI | logic depends on abstractions; inject implementations |
| Singleton | in Python: module object / cached factory; inject it |
| Factory | choose concrete class from config |
| Strategy | swap algorithms (often just functions) |
| Observer | publish events to subscribers |
| Adapter / Facade | convert interface / simplify subsystem |
| Repository / UoW | hide DB; one transaction per use case |
| Command / Chain | requests as objects (tool calls); middleware chains |
| Circuit breaker | fail fast when a dependency is down |
| Saga | local txns + compensations; orchestrated or choreographed |
| Outbox | event row in same txn → relay publishes |
| CQRS | separate write and read models |
| Event sourcing | events are the source of truth |
| Microservices | split for scaling/team/isolation reasons, not by default |

## References

- Refactoring Guru (patterns with examples): https://refactoring.guru/design-patterns
- Martin Fowler — Microservices, CQRS, Event Sourcing, Strangler Fig: https://martinfowler.com/microservices/
- microservices.io pattern catalogue (saga, outbox, API gateway): https://microservices.io/patterns/
- The Twelve-Factor App: https://12factor.net/
- AWS Prescriptive Guidance — cloud design patterns: https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/introduction.html
