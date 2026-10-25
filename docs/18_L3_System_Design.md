# L3 Architecture & System Design: Interview Preparation

> **Updated:** 24 October 2026 · **Level:** design framework → building blocks → agentic AI platform designs → leadership & incidents
> **How to use:** Learn the **framework** (section 1) and practise saying each design out loud in 5, 15 and 45-minute versions. Diagrams here are what you'd draw on the whiteboard.

---

## Table of contents

1. [How to answer a system design question](#1-how-to-answer-a-system-design-question) (Q01–Q03)
2. [Core building blocks](#2-core-building-blocks) (Q04–Q14)
3. [Reference architecture: agentic AI platform on AWS](#3-reference-architecture-agentic-ai-platform-on-aws) (Q15–Q16)
4. [Design scenarios](#4-design-scenarios) (Q17–Q27)
5. [Reliability, security & cost](#5-reliability-security--cost) (Q28–Q34)
6. [Delivery, operations & leadership](#6-delivery-operations--leadership) (Q35–Q40)
7. [Incident & debugging scenarios](#7-incident--debugging-scenarios) (Q41–Q45)
8. [Classic system design problems](#8-classic-system-design-problems) (Q46–Q48)
9. [Cheat sheet](#9-cheat-sheet)

---

## 1. How to answer a system design question

### Q01. What does an L3-level answer look like?

**Short answer:** Not just "boxes and arrows". An L3 (senior/specialist) answer: clarifies requirements and constraints, proposes a simple design first, explains **trade-offs** (why X over Y), covers **failure modes**, security, data consistency, scale, cost, observability and rollout — and shows ownership ("how I'd test, launch, operate and evolve it").

**The framework (use every time):**
```flow
pipeline: The L3 system design answer, in order
Requirements > Functional (what it does) + non-functional (latency, scale, availability, compliance).
Estimates > Users, requests/s, data size, tokens/day, peak vs average. These drive your choices.
API & data model > Key endpoints/events, entities, ownership, consistency needs.
High-level design > Clients → edge → API → services → data → async.
Deep dives > The 2–3 hardest parts: streaming, idempotency, multi-tenancy, RAG quality.
Failure handling > Timeouts, retries, DLQs, degradation, DR.
Security > Identity, authorisation, data protection, threat model (prompt injection for AI).
Observability > SLIs/SLOs, traces, alarms, dashboards.
Cost & scale > Biggest cost drivers and how it scales 10×.
Rollout & evolve > Testing, canary, migration, what you'd do next.
```

---

### Q02. Gathering requirements — what to ask

| Category | Questions |
|---|---|
| Users & usage | Who uses it? How many? Peak concurrency? Read vs write ratio? |
| Functionality | Core flows? What's out of scope? Sync or async acceptable? |
| Latency | p95/p99 target? Streaming needed? |
| Data | Size, growth, retention, sensitivity (PII/financial), residency |
| Availability | SLO (99.9% = ~43 min/month downtime)? RTO/RPO? |
| Security | Auth provider (Okta), tenancy model, audit requirements |
| AI-specific | Accuracy target, which actions are allowed, human approval, cost budget per request |
| Constraints | Existing stack, team skills, deadlines, budget |

Write assumptions on the board when the interviewer doesn't answer.

---

### Q03. Back-of-the-envelope estimates

```
 300 documents/min ≈ 5/s; avg 10 pages → 50 pages/s OCR
 LLM extraction: 2k input + 500 output tokens per page → 50 × 2.5k = 125k tokens/s?? → check quota!
   (this estimate tells you you need batching / a smaller model / quota increase)
 Storage: 300/min × 60 × 24 × 2 MB ≈ 860 GB/day → S3 + lifecycle rules
 Chat: 2,000 concurrent users × 1 msg/30 s ≈ 67 req/s; each streams ~20 s → ~1,300 open streams
```
Numbers reveal the real bottleneck (often **LLM quotas and cost**, not CPU).

---

## 2. Core building blocks

### Q04. Vertical vs horizontal scaling

**Vertical** = bigger machine (simple, limited, often downtime). **Horizontal** = more instances behind a load balancer (needs **stateless** services, shared state in DB/cache). Stateless app tier + horizontally scaled; stateful tier scaled by replication/sharding/managed services.

---

### Q05. Caching

| Layer | Example | Watch out |
|---|---|---|
| Client/CDN | CloudFront for static assets, cached GET APIs | invalidation, per-user data must not be cached publicly |
| Application cache | ElastiCache/Valkey: sessions, rate limits, hot reads | cache stampede, TTLs, consistency |
| DB-level | read replicas, DAX for DynamoDB | replica lag |
| LLM-level | prompt caching, exact/semantic response cache | tenant isolation, staleness |

**Patterns:** cache-aside (read: cache → miss → DB → set), write-through, TTL + jitter, request coalescing to avoid stampedes.

---

### Q06. Databases: SQL vs NoSQL, replication, sharding

- **SQL (Aurora Postgres)** — relations, transactions, flexible queries; scale reads with replicas, writes by partitioning.
- **DynamoDB** — key-value/document at any scale; design around **access patterns**, partition key for even distribution, conditional writes for concurrency, single-digit ms.
- **Replication** — primary/replica (read scaling, failover); synchronous (no data loss, slower) vs asynchronous (lag).
- **Sharding/partitioning** — split data by key (tenant ID) → scale writes; hot partitions are the main risk.

---

### Q07. CAP and consistency models

**CAP:** during a **network partition**, a distributed store must choose **consistency** (refuse/serve errors) or **availability** (serve possibly stale data). Without partitions you trade latency vs consistency (PACELC). Practical forms: strong consistency (DynamoDB strongly consistent reads, single-primary SQL), eventual consistency (replicas, global tables), read-your-writes (route user reads to primary after a write).

**Where it matters for you:** job status (strong), dashboards/search indexes (eventual is fine), approvals/payments (strong + idempotent).

---

### Q08. Synchronous vs asynchronous communication

```flow
sequence: Sync vs async between services
actors: A, Queue, B
A -> B: SYNC: request
B --> A: response
> Simple, but A slows down or fails whenever B does.
A -> Queue: ASYNC: message
> A returns immediately. The queue absorbs bursts and retries delivery.
Queue -> B: deliver when B is ready
> Decoupled, but eventually consistent, and B must handle duplicates (idempotent consumer).
```
Use async for anything slow (OCR, LLM batch jobs), bursty, or that can retry; return `202 Accepted` + job ID.

---

### Q09. Message queues, pub/sub and event streams

SQS (work queue, at-least-once, DLQ), SNS (fan-out), EventBridge (routing rules, replay), Kinesis/MSK (ordered streams, replay, analytics). Consumers must be **idempotent**.

---

### Q10. Idempotency and exactly-once *effects*

Networks and retries mean duplicates are normal. Achieve "exactly-once effect" with **idempotency keys** + conditional writes / unique constraints, deduplicated workflow starts (Step Functions execution name), and **outbox pattern** (write DB change + event in one transaction, publish event from the outbox) to avoid "DB updated but event lost".

---

### Q11. Rate limiting algorithms

| Algorithm | Idea |
|---|---|
| **Token bucket** | bucket refills at rate r, capacity b (allows bursts) — most common |
| Leaky bucket | process at constant rate |
| Fixed window | N per minute (bursty at edges) |
| Sliding window | smoother counting |

Implement at API Gateway (usage plans), WAF rate rules, or Redis (`INCR` + TTL / Lua token bucket) per user/tenant; return **429** with `Retry-After`. For LLMs also budget **tokens** per tenant, not just requests.

---

### Q12. Load balancing & service discovery

ALB (L7 routing, health checks), NLB (L4, static IPs), Service Connect/Cloud Map for internal services; health checks + connection draining; consistent hashing for sticky data partitions.

---

### Q13. SLI, SLO, SLA and error budgets

- **SLI** — a measurement: % of requests < 2 s, % successful.
- **SLO** — target for the SLI: 99.9% of chat requests start streaming within 2 s over 28 days.
- **SLA** — external contract with penalties (looser than SLO).
- **Error budget** — 100% − SLO (0.1%); if exhausted, freeze risky releases, prioritise reliability.

AI-specific SLIs: time to first token, task success rate (eval), cost per task, approval latency.

---

### Q14. Timeouts: request timeout vs task lifecycle timeout

**Request timeout** — how long a client waits for one HTTP call (ALB idle 60 s, API Gateway ~29 s). **Task lifecycle timeout** — how long the *job* may run (Step Functions up to 1 year, AgentCore session 8 h, Lambda 15 min). Long tasks must not depend on a single open request: return 202, process async, stream/poll status. Set **timeout budgets** down the call chain (each hop shorter than its caller).

---

## 3. Reference architecture: agentic AI platform on AWS

### Q15. Design a high-level agentic AI web app using our stack

```flow
sequence: Walk one chat message through the platform
actors: React SPA, FastAPI (ECS), AgentCore Runtime, Gateway, Tools/Data
React SPA -> FastAPI (ECS): POST /api/chat + JWT (via CloudFront → ALB)
FastAPI (ECS) -> FastAPI (ECS): verify JWT, tenant + role, ownership, rate limit
FastAPI (ECS) -> AgentCore Runtime: InvokeAgentRuntime (stream)
> LangGraph agent in a per-session microVM; Postgres checkpointer; AgentCore Memory per user.
AgentCore Runtime -> Gateway: tool call (MCP, workload token)
Gateway -> Gateway: inbound JWT, Cedar policy, PII redaction
Gateway -> Tools/Data: Lambda tools · Jira via OAuth 3LO · RAG search with tenant + ACL filters
AgentCore Runtime --> React SPA: SSE stream: tokens, tool status, approval_needed
> Long document jobs go to Step Functions instead; EventBridge publishes "job.completed". One trace ID end to end.
```

```
 ┌──────────────────────────────────────────── CLIENT ─────────────────────────────────────────────┐
 │ React + Vite SPA (S3 + CloudFront, WAF, CSP) · Okta OIDC login (PKCE) → access token (JWT)       │
 └──────────────┬─────────────────────────────────────────────────────▲────────────────────────────┘
                │ HTTPS /api/* (JWT)                                    │ SSE stream (tokens, status)
 ┌──────────────▼─────────────────────────────── EDGE / API ────────────┴──────────────────────────┐
 │ CloudFront → ALB → FastAPI on ECS Fargate (private subnets, multi-AZ, autoscaling)               │
 │  • verify JWT (issuer/audience/expiry) · tenant + role from claims                               │
 │  • authorise conversation/document ownership · rate limit per user/tenant (Redis)                │
 │  • conversations, jobs, approvals in Aurora/DynamoDB · presigned S3 uploads                      │
 └──────┬────────────────────────────────┬────────────────────────────────────┬────────────────────┘
        │ InvokeAgentRuntime (stream)     │ start job (async)                   │ events
 ┌──────▼──────────────────────────┐ ┌───▼──────────────────────────────┐ ┌───▼────────────────────┐
 │ AgentCore Runtime (microVM/sess)│ │ Step Functions (Standard)         │ │ EventBridge            │
 │  LangGraph agent                │ │  doc pipeline: Textract async →   │ │ "job.completed" →      │
 │  • Postgres checkpointer        │ │  Map LLM extraction → validation  │ │ notifications, audit   │
 │  • AgentCore Memory (per user)  │ │  → human review (task token)      │ └────────────────────────┘
 │  • interrupt() for approvals    │ └───┬──────────────────────────────┘
 └──────┬──────────────────────────┘     │
        │ MCP (workload token)            │ Bedrock / Textract (quotas, retries, backoff)
 ┌──────▼──────────────────────────────────▼───────────────────────────────────────────────────────┐
 │ AgentCore Gateway: inbound JWT · Policy (Cedar) on every tool call · PII-redacting interceptor    │
 │  targets: Lambda tools (S3/Textract/DynamoDB, least-privilege roles) · Jira/Confluence (OAuth 3LO │
 │  via AgentCore Identity) · RAG search tool (OpenSearch/Bedrock KB with tenant+ACL filters)        │
 └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 DATA: S3 (docs, KMS, versioning) · Aurora Postgres (app + checkpoints) · DynamoDB (jobs, idempotency)
       OpenSearch / S3 Vectors (embeddings) · Secrets Manager (DB creds, rotation)
 OPS:  OTel traces end-to-end (one trace ID) → CloudWatch/AgentCore Observability · Evaluations on
       sampled sessions · alarms on SLOs, cost per tenant · GitLab CI (OIDC) → Terraform → ECS/AgentCore
```

**How to talk through it (2 minutes):**
1. *Edge & identity:* SPA on CloudFront, Okta login, API verifies JWT and does all authorisation.
2. *Interactive path:* API owns conversation ↔ session/thread mapping; invokes the LangGraph agent on AgentCore Runtime; streams tokens back via SSE.
3. *Tools:* only via Gateway → Cedar policy + per-user OAuth; tools are least-privilege Lambdas.
4. *Heavy work:* documents go async through Step Functions with quotas and idempotency.
5. *State:* durable checkpoints and approvals outside the microVM; memory namespaced per user.
6. *Ops:* tracing, evals, SLOs, cost controls, CI/CD with OIDC and IaC.

---

### Q16. Trust boundaries in that design (threat model view)

```
 [Browser] ─TB1─ [API] ─TB2─ [Agent runtime] ─TB3─ [Gateway/Policy] ─TB4─ [Tools/SaaS]
                  │                │                                   
                  └──TB5── [Data stores]      [LLM provider] ─TB6─ (prompts/outputs)
 TB1: authN, input validation, rate limits      TB2: trusted context only (verified claims)
 TB3: every tool call authorised (Cedar), args validated
 TB4: scoped credentials, per-user OAuth, egress control
 TB5: ownership checks, encryption, tenant partitioning
 TB6: data classification, no secrets in prompts, guardrails, logging redaction
```

---

## 4. Design scenarios

### Q17. Secure presigned S3 uploads

```flow
sequence: Secure presigned S3 upload
actors: Browser, API, S3, Scan worker
Browser -> API: POST /uploads {filename, size, contentType}
API -> API: authN/authZ, validate, create PENDING record
> The server chooses the key, e.g. tenants/{tenantId}/uploads/{uuid}. Never use the client's filename as the key.
API --> Browser: presigned PUT URL (5–15 min, size + type conditions, SSE-KMS)
Browser -> S3: PUT file directly
> The API never proxies the file bytes.
S3 -> Scan worker: S3 event → SQS
Scan worker -> Scan worker: check magic bytes, malware scan → READY / REJECTED
> Only READY files can be processed or downloaded (presigned GET after an authorisation check).
```
Bucket: Block Public Access, deny non-TLS, CORS limited to app origin, lifecycle to delete abandoned uploads.

---

### Q18. Document extraction service for 100–300 requests/minute

Requirements: async, per-document status, accuracy with human review, cost/quotas.
```flow
pipeline: Document extraction service, 100–300 requests/minute
API: 202 + job_id > Respond immediately; work happens asynchronously.
Presigned S3 upload > The file goes straight to S3.
S3 event → SQS > Buffered.
Step Functions (name = doc hash) > Duplicate events can't start duplicate runs.
Textract async > ClientRequestToken; SNS callback via task token.
Map over pages > MaxConcurrency sized to the Bedrock tokens-per-minute quota.
LLM extraction > Output validated against a Pydantic schema.
Validate + confidence > Low confidence → review queue (task token).
Save + notify > EventBridge "doc.processed" → SSE/WebSocket push to the UI. Failures: retry with jitter, Catch → FAILED + DLQ + alarm, redrive.
```
Deep-dive talking points: quotas (Textract TPS, Bedrock TPM), cost per document, idempotency, backpressure via SQS, partial page failures, evaluation set for extraction accuracy.

---

### Q19. Real-time agent response streaming

```flow
sequence: Streaming agent tokens to the browser
actors: React, CloudFront, ALB, FastAPI, Agent
React -> CloudFront: open stream (EventSource / fetch)
CloudFront -> ALB: forward (no buffering)
ALB -> FastAPI: idle timeout raised for long streams
FastAPI -> Agent: astream / AgentCore Runtime stream
Agent --> FastAPI: tokens + tool events
FastAPI --> React: event: token / tool_start / tool_result / approval_needed / error / done
> Each event has an id, so a dropped connection resumes with Last-Event-ID. Send heartbeats so proxies don't close idle streams.
```
Design points: stable event schema (UI not coupled to graph internals), heartbeats every 15 s (proxies), client reconnect with `Last-Event-ID` → server replays from persisted events or returns current state, cancellation (client abort → cancel agent run), backpressure, don't buffer in proxies (`X-Accel-Buffering: no`), auth on the stream endpoint, per-user concurrent stream limits.

---

### Q20. Multi-tenant authorisation

Tenant ID comes **only from the verified token** (or a server-side membership lookup), never from the request body. Enforce at every layer: API (resource ownership checks), data (partition key / row-level security / tenant-prefixed S3 keys + IAM conditions), retrieval (metadata filters), memory (namespaces), tools (Cedar policies with tenant attributes), caches (tenant in cache key). Test with cross-tenant negative tests in CI.

| Isolation model | Pros | Cons |
|---|---|---|
| Silo (account/stack per tenant) | strongest isolation | cost, ops overhead |
| Bridge (shared compute, separate DB/schema/index) | balanced | moderate complexity |
| Pool (shared everything, tenant column) | cheapest | strict app-level controls required |

---

### Q21. Consistency between job DB, S3 and Step Functions

No distributed transaction across them. Approach: **job record is the source of truth** with a state machine of statuses; every writer uses conditional updates (`status = RUNNING` only from `PENDING`); S3 object keys are deterministic (re-writes are idempotent); workflow start is deduped by execution name; a **reconciler** job periodically finds stuck/inconsistent jobs (e.g., RUNNING > 1 h with no execution) and repairs or alerts; outbox for events.

---

### Q22. Document RAG over live Confluence

```flow
pipeline: RAG over live Confluence with permissions
stage: Ingestion
Webhook / scheduled sync > Fetch the page and its permissions (space and page restrictions).
Parse > Keep headings and tables.
Chunk + metadata > page_id, version, space, acl_groups, updated_at.
Embed + upsert > Into a hybrid index (OpenSearch); delete chunks of removed or old versions.
stage: Query
User JWT → groups > Who is asking, and what can they see?
Hybrid search with ACL filter > Only chunks this user may read.
Rerank + answer with citations > Cite page ids.
Optional live check > Fetch the cited page as the user (3LO) to confirm access and freshness.
```
Trade-off: index freshness vs API load; permission changes must propagate quickly (re-sync ACLs separately from content). Evaluate retrieval recall on a labelled set.

---

### Q23. Cost controls for GenAI

Per-tenant token budgets and rate limits; model routing (small model for classification/extraction, large for reasoning); prompt caching (static system + tools first); limit retrieved chunks and history (summarise); cap agent iterations/tool calls; batch inference for offline jobs; cache deterministic results; dashboards for cost per request/tenant/feature; alerts on anomalies; evaluate cheaper models against the eval set before switching.

---

### Q24. Resilient agents under provider rate limits

Client-side token-bucket per model, retries with exponential backoff + jitter honoring `Retry-After`, queue non-interactive work, cross-region inference profiles / provisioned throughput for critical paths, fallback models (approved, capability-tested), circuit breaker when the provider is degraded, graceful messages to users, prioritise interactive traffic over batch.

---

### Q25. Graceful degradation when LLM providers fail

Tiered fallbacks: alternate model/region → cached answers for common questions → retrieval-only mode ("here are the relevant documents") → queue the request and notify later → clear status message. Never fall back to an unapproved provider for sensitive data. Feature flags to switch modes quickly.

---

### Q26. Secrets across React, API, agents and workers

React: **no secrets** (public bundle). API/workers: Secrets Manager (cached, rotated) via task roles. Agents: no raw secrets in prompts/state; tools obtain credentials via AgentCore Identity token vault or scoped roles. CI: OIDC to AWS, no static keys. Logs/traces redacted.

---

### Q27. Migrating a monolith to this architecture (strangler fig)

```flow
pipeline: Strangler-fig migration
Put monolith behind ALB > Add a routing layer and an observability baseline first.
Extract one capability > E.g. document processing as an async service.
Route gradually > Weighted rules or feature flags; compare metrics old vs new.
Move data ownership > Carefully, with CDC or a controlled dual-write period.
Decommission old code > Repeat capability by capability until the monolith is gone.
```
Measure success: latency, error rate, deploy frequency, cost.

---

## 5. Reliability, security & cost

### Q28. Test strategy for an AI + AWS stack

| Layer | Tests |
|---|---|
| Unit | pure functions, Pydantic schemas, routing logic, reducers |
| Contract | API schemas (OpenAPI), tool schemas, event formats |
| Integration | real Postgres/Redis containers, LocalStack/moto or sandbox AWS |
| Agent behaviour | fake LLM for deterministic flows; trajectory tests; interrupt/resume tests |
| AI quality | golden eval set (accuracy, faithfulness, tool-choice), regression thresholds |
| Security | authZ negative tests (cross-tenant), prompt-injection red-team suite, SAST/dependency/IaC scans |
| Performance | load tests (k6/Locust) with streaming, quota simulations |
| E2E | Playwright: login → upload → stream → approval |

---

### Q29. Observability with tracing

One **trace ID** from browser → API → agent → gateway → tools → AWS services (W3C `traceparent` propagated; MCP `_meta` supports trace context). Spans with attributes: tenant (pseudonymised), model, tokens, tool name, policy decision. Dashboards per SLO; logs correlated by trace ID; sampling (keep all errors); redact payloads.

---

### Q30. Threat modelling AI infrastructure (STRIDE + AI threats)

Walk the data-flow diagram (Q16) per trust boundary: **S**poofing (token validation), **T**ampering (signed artifacts, immutable images), **R**epudiation (audit logs of approvals/tool calls), **I**nformation disclosure (tenant isolation, PII in traces), **D**oS (rate limits, token budgets), **E**levation of privilege (confused deputy, over-privileged roles). Plus AI-specific: prompt injection (direct/indirect), excessive agency, data poisoning (RAG/memory), model output handling (XSS), supply chain (MCP servers, models). Output: prioritised mitigations with owners.

---

### Q31. High availability & DR for the platform

Multi-AZ everything (ECS, Aurora, ElastiCache, NAT per AZ); DR region with pilot light/warm standby (Aurora Global Database, S3 CRR, DynamoDB global tables, IaC to redeploy, AgentCore/Bedrock available in DR region?), Route 53 failover; define RTO/RPO per component; game days.

---

### Q32. Data protection & compliance

Classify data; encrypt at rest (KMS CMKs) and in transit (TLS 1.2+); minimise PII sent to LLMs (redact/pseudonymise); retention & deletion (user deletion propagates to memory, indexes, logs); data residency (region choice, cross-region inference settings); audit trails; access reviews.

---

### Q33. Backpressure and load shedding

When downstream is saturated: queue and slow intake, reject early with 429/503 + `Retry-After`, prioritise interactive over batch, bounded concurrency (semaphores, Map MaxConcurrency, SQS ESM max concurrency), circuit breakers. Better to fail fast for some than slow for all.

---

### Q34. Architecture trade-off reviews — how to be objective

Write an **ADR** (Architecture Decision Record): context, options, criteria (security, reliability, cost, latency, operability, team skills, time-to-market), evidence (benchmarks, PoC, cost model), decision, consequences, review date. Involve stakeholders; revisit when assumptions change.

---

## 6. Delivery, operations & leadership

### Q35. Release strategy for frontend, backend and agent configuration

- **Frontend:** immutable hashed assets, `index.html` no-cache, keep old chunks, feature flags.
- **Backend:** ECS blue/green or canary with alarm rollback; backward-compatible APIs (additive changes, versioning).
- **Agent config (prompts, models, tools, policies):** versioned in git, evaluated offline, released via AgentCore endpoints/versions or feature flags, canary to a % of sessions, compare eval + online metrics, instant rollback.
- **DB:** expand → migrate → contract.
- **Checkpoint/state schemas:** backward compatible — paused threads resume on new code.

---

### Q36. Incident postmortem (blameless)

Timeline (detection → mitigation → resolution), impact (users, duration, data), root cause(s) with "5 whys"/contributing factors, what went well/poorly, action items with owners and dates (prevent, detect faster, mitigate faster), shared widely. Focus on systems, not people.

---

### Q37. A teammate pushes an unsafe Terraform/CI change

Block via process (protected branches, code owners, required approvals, policy checks in CI) rather than heroics; review privately and constructively with the specific risk ("this trust policy lets any project assume the prod role"), propose a fix, pair if helpful, and turn it into a guardrail (OPA policy/check) so it can't recur. If already applied, treat as an incident.

---

### Q38. What technical leadership achievements should you present?

Use **STAR** (Situation, Task, Action, Result) with metrics: designed X reducing latency/cost by Y%; introduced eval gates/observability that caught regressions; led a migration with zero downtime; mentored N engineers; set security standards (OIDC, least privilege); handled a major incident and the follow-up improvements; influenced roadmap with ADRs/PoCs.

---

### Q39. "Design your current agentic AI platform in 5 minutes"

```flow
pipeline: Your 5-minute platform pitch
Problem & users (30 s) > Who uses it, what tasks, what scale.
Diagram (2 min) > Q15: edge/auth → API → agent runtime → gateway/tools → data → async pipeline.
Key decisions (1 min) > Why LangGraph (explicit control, HITL), why AgentCore (isolation, identity), why Step Functions for documents.
Hard problems solved (1 min) > Multi-tenant isolation, approvals exactly once, streaming, quotas and cost.
Operations & next steps (30 s) > SLOs, evals, and what you'd improve next.
```

---

### Q40. Communicating with stakeholders

Translate technical trade-offs into business terms (risk, cost, time, user impact); give options with recommendation; be explicit about uncertainty and how you'll reduce it (PoC, benchmark); regular status with metrics.

---

## 7. Incident & debugging scenarios

### Q41. A prompt injection triggered an unauthorised tool attempt

1. **Contain:** verify the policy gate blocked it (Cedar deny logged); if not, disable the tool/feature flag immediately.
2. **Investigate:** trace the session — source of injected text (document/web page), which tool/args, which identity.
3. **Assess impact:** any data accessed/exfiltrated? Other sessions with the same source?
4. **Fix:** tighten policy and tool scopes, add approval for that action, sanitise/label the source, remove the malicious content.
5. **Prevent:** add the case to the red-team eval suite; alert on policy denies spike; postmortem.

---

### Q42. After deployment p99 latency doubles while p50 is flat

Tail latency = a subset of requests is slow: cold starts / new tasks warming (JIT, caches), one bad AZ/instance, GC pauses or memory pressure, connection pool exhaustion under bursts, retries hitting a slow dependency, a new code path for specific inputs (bigger prompts, more tool calls), lock contention. Compare traces of slow vs fast requests, slice metrics by AZ/task/version/tenant, roll back if SLO burning.

---

### Q43. Customer reports a duplicate action despite one approval

Find where duplication happened: client double-submit, API retry, agent node replay after `interrupt()` (side effect before interrupt), Step Functions/queue redelivery, tool retry. Fix: idempotency key = approval/action ID enforced **in the tool/backend** with a conditional write; approval record status `EXECUTED` checked before execution; move side effects after the interrupt; add regression test; notify customer and compensate.

---

### Q44. Users intermittently see another user's data

Sev-1: contain (disable cache/feature), then check caches keyed without user/tenant, shared mutable globals in reused Lambda/ECS processes, session/thread ID collisions or client-supplied IDs, CDN caching personalised responses (`Cache-Control: private`), connection reuse bugs. Fix, test, assess exposure, follow breach-notification process.

---

### Q45. Cost spiked 3× overnight

Cost Explorer by service/usage type + tags → e.g., Bedrock tokens (agent loop bug, a tenant scripting the API, prompt caching broken by a dynamic prefix), NAT data processing (new traffic not using endpoints), CloudWatch logs (debug logging left on). Mitigate (limits, rollback), then add budgets/anomaly detection alerts per tenant/feature.

---

## 8. Classic system design problems

These generic problems are still common in interviews. Use the same framework (§1): requirements → estimates → API → data model → high-level design → deep dives → failures → trade-offs.

### Q46. Design a URL shortener (like bit.ly)

**Requirements:** create short link for a long URL; redirect fast; optional expiry/custom alias; analytics. Read-heavy (≈100 reads : 1 write).

**Estimates:** 100M new links/month ≈ 40 writes/s; 4,000 redirects/s average (peaks ×5). 7 base62 characters = 62⁷ ≈ 3.5 trillion codes — plenty.

```flow
sequence: URL shortener: create and redirect
actors: Client, Edge cache, API, Redis, DynamoDB, Analytics
Client -> API: POST /links {long_url}
API -> DynamoDB: put short_code → long_url (conditional write)
> Code from an ID generator (base62) or random 7 chars; `attribute_not_exists` prevents collisions. TTL for expiry.
Client -> Edge cache: GET /{code}
Edge cache -> API: cache miss
API -> Redis: lookup code
Redis -> DynamoDB: on miss, read item
API --> Client: 301 or 302 redirect
> 301 is cached by browsers (less load, but you lose click analytics); 302 keeps every click visible.
API -> Analytics: click event → Kinesis/SQS → analytics store
```
**Deep dives:**
- **Code generation:** (a) counter/ID service (e.g. pre-allocated ranges per server) → base62 encode: no collisions, but sequential = guessable; (b) random 7 chars + conditional write `attribute_not_exists` and retry on collision; (c) hash of URL (same URL → same code; collisions to handle).
- **301 vs 302:** 301 (permanent) is cached by browsers → less load but you lose click analytics; 302 keeps every hit visible.
- **Scale:** redirects are cacheable → CDN + Redis absorb most reads; DynamoDB scales by key.
- **Abuse:** rate limits per user, malware/phishing URL scanning, no open redirect to `javascript:` URLs.

---

### Q47. Design a notification system (email, SMS, push, in-app)

**Requirements:** many services send notifications; user preferences/opt-outs; retries; no duplicates; priority (OTP now, marketing later); templates; audit.

```flow
pipeline: A notification's journey
Service calls Notification API > With an idempotency key, so retries don't send twice.
Validate + prefs + template > Opt-outs and quiet hours checked; message rendered from a versioned template.
Log in DynamoDB > Status tracking and audit.
Publish to topic > SNS/EventBridge fans out by channel.
Per-channel queue > Email, SMS and push have separate queues, with priority queues so OTPs never wait behind marketing.
Worker → provider > SES / SMS provider / mobile push, within each provider's rate limits.
Retry → DLQ → alarm > Backoff on failure; delivery callbacks update the log.
```

```
 services ──► Notification API ──► validate + prefs + template ──► SNS/EventBridge topic
                    │ (idempotency key)                               │ fan-out by channel
                    ▼                                     ┌───────────┼────────────┐
              DynamoDB: notification log            SQS email   SQS sms    SQS push (+ priority queues)
                                                         │            │           │
                                                    worker → SES  worker → SMS  worker → mobile push
                                                         └── retries w/ backoff → DLQ → alarm
```
**Deep dives:** idempotency key per notification (dedupe on retries); separate queues per channel and priority so a marketing blast can't delay OTPs (bulkhead); per-provider rate limits; user preferences and quiet hours checked before enqueue; delivery status callbacks update the log; templates versioned; PII minimised in logs.

---

### Q48. Design a real-time chat system

**Requirements:** 1:1 and group chat, online presence, delivery/read receipts, history, offline delivery.

```flow
sequence: Delivering one chat message
actors: Sender, Gateway A, Chat service, Message store, Pub/sub, Gateway B, Recipient
Sender -> Gateway A: send over WebSocket (client message id)
Gateway A -> Chat service: forward
Chat service -> Message store: save (PK=conversation_id, SK=timestamp#msg_id)
> The client message id makes retries idempotent; the sort key gives ordering.
Chat service -> Pub/sub: publish to recipients
Pub/sub -> Gateway B: the node holding the recipient's connection
> A connection registry (Redis/DynamoDB) maps user_id → connection ids, so servers scale without sticky sessions.
Gateway B -> Recipient: push over WebSocket
> Offline? Send a push notification instead; they fetch history on reconnect.
```

```
clients ══ WebSocket ══► connection gateway (API Gateway WebSocket API / ALB + WS servers)
                              │  connection registry: user_id → connection ids (Redis/DynamoDB)
                              ▼
                        chat service ──► message store (DynamoDB: PK = conversation_id, SK = timestamp#msg_id)
                              │
                              └─► pub/sub (Redis / SNS) → gateway nodes holding recipients' connections
                                    offline recipients → push notification (Q47)
```
**Deep dives:** ordering per conversation (sort key = server timestamp + id; client-generated message id for dedupe/idempotent retry); history via `Query` by conversation with keyset pagination; presence via heartbeats with TTL; group fan-out on write (small groups) vs on read (huge channels); scaling WebSocket servers horizontally with a registry instead of sticky sessions. An AI chat assistant uses the same shape, with SSE often enough because the server is the one streaming (20 Q19).

---

## 9. Cheat sheet

| Topic | Remember |
|---|---|
| Classic designs | URL shortener (base62 + cache + 301/302), notifications (per-channel queues, idempotency), chat (WebSocket gateway + registry) |
| Framework | requirements → estimates → API/data → diagram → deep dives → failures → security → observability → cost → rollout |
| Estimates | find the real bottleneck (often LLM quota/cost) |
| Scale | stateless horizontal app tier; managed stateful tier |
| Consistency | strong for money/approvals/status; eventual for search/analytics |
| Async | 202 + job ID; queues absorb bursts; idempotent consumers |
| Idempotency | keys + conditional writes; outbox for events |
| Rate limit | token bucket; per tenant; tokens not just requests |
| SLOs | SLI → SLO → error budget; AI SLIs (TTFT, task success, cost) |
| Timeouts | request vs lifecycle; budgets down the chain |
| Multi-tenant | tenant from token only; enforce at every layer |
| AI security | injection inevitable → policy gate, least privilege, approvals |
| Degradation | fallback model → cache → retrieval-only → queue |
| Release | immutable artifacts, canary, versioned prompts/models/tools |
| Leadership | ADRs, postmortems, guardrails over heroics, STAR stories |

## References

- AWS Well-Architected (incl. Generative AI lens): https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html
- AWS Builders' Library (timeouts, retries, backoff, idempotency): https://aws.amazon.com/builders-library/
- Google SRE book (SLOs, error budgets): https://sre.google/sre-book/service-level-objectives/
- OWASP Top 10 for LLM Applications: https://genai.owasp.org/llm-top-10/
- SaaS tenant isolation strategies (AWS whitepaper): https://docs.aws.amazon.com/whitepapers/latest/saas-tenant-isolation-strategies/
