# AWS Lambda: L2 → L3 Interview Preparation

> **Updated:** 24 October 2026 · **Level:** execution model → event sources & concurrency → production patterns
> **How to use:** *Short answer* = what you say first. *Explanation / Example* = intuition and code. *Pitfall / Follow-up* = where interviewers dig.

---

## Table of contents

1. [Mental model: how Lambda runs your code](#1-mental-model-how-lambda-runs-your-code)
2. [Fundamentals](#2-fundamentals) (Q01–Q08)
3. [Invocation models & event sources](#3-invocation-models--event-sources) (Q09–Q15)
4. [Concurrency, scaling & cold starts](#4-concurrency-scaling--cold-starts) (Q16–Q20)
5. [Packaging, versions, configuration](#5-packaging-versions-configuration) (Q21–Q25)
6. [Security & networking](#6-security--networking) (Q26–Q29)
7. [Long-running work & newer features](#7-long-running-work--newer-features) (Q30–Q33)
8. [Observability](#8-observability) (Q34–Q35)
9. [Scenario & debugging questions](#9-scenario--debugging-questions) (Q36–Q41)
10. [Cheat sheet](#10-cheat-sheet)

---

## 1. Mental model: how Lambda runs your code

**Lambda = upload a function, AWS runs it on demand in isolated environments, scales automatically, bills per request + GB-second.**

```flow
pipeline: Cold start vs warm start
Event arrives > API Gateway, SQS, S3, EventBridge…
Free warm environment? > Yes → invoke the handler immediately (warm, fast). No → cold start.
Create microVM > Firecracker microVM for this function version.
Download code > Zip or container image.
Start runtime > Python, Node, Java…
Run INIT code > Imports, SDK clients, config — code outside the handler, which is reused later.
INVOKE handler > handler(event, context). One environment serves one request at a time.
Stay warm > Reused for later events, then frozen and eventually recycled.
```

```
 Event source ─► Lambda service ─► find a FREE warm execution environment for this function version?
 (API GW, SQS,                         │ yes ──────────────────────────────► INVOKE handler (warm, fast)
  S3, EventBridge…)                    │ no
                                       ▼
                          COLD START: create Firecracker microVM
                            1. download code / container image
                            2. start runtime (Python, Node, Java…)
                            3. run INIT code (imports, SDK clients, config)  ← outside handler
                            4. INVOKE handler(event, context)
                          environment stays warm (reused) for later events, then frozen/recycled

 One environment handles ONE request at a time (standard Lambda).
 10 concurrent requests → 10 environments.   (Lambda Managed Instances: many requests per instance)
```

**Execution environment lifecycle:**
```flow
pipeline: Execution environment lifecycle
INIT > Up to 10 s: extensions, runtime, and your global code.
INVOKE > The handler runs for one event.
INVOKE again > Reuses the warm environment; global variables survive between invokes.
Frozen between invokes > No CPU while idle; background threads pause.
SHUTDOWN > Recycled after idle time or for updates.
```
**Key implications:**
- Put expensive setup (SDK clients, DB connection, model loading) **outside the handler** → reused while warm.
- **Don't** keep per-request state in globals (another user's request may reuse the environment).
- `/tmp` persists between invocations of the same environment (512 MB–10 GB) — cache, not storage.

---

## 2. Fundamentals

### Q01. What is Lambda and when should you use it?

**Short answer:** Serverless compute that runs code in response to events — no servers, automatic scaling, pay only when running. Max **15 minutes** per invocation, memory 128 MB–10 GB.

**Good fit:** event processing (S3 uploads, SQS, EventBridge), APIs with spiky traffic, glue/automation, scheduled jobs, agent **tools** behind AgentCore Gateway, stream processing.
**Poor fit:** long-running/always-busy services (ECS cheaper/simpler), persistent connections (WebSocket servers), heavy GPU work, very latency-sensitive paths that can't tolerate cold starts.

---

### Q02. Handler, event and context

```python
import json, os, boto3
s3 = boto3.client("s3")                          # INIT: created once per environment
TABLE = os.environ["TABLE_NAME"]

def handler(event, context):
    # event: input payload — shape depends on the source (API GW, SQS, S3...)
    # context: runtime info
    print(context.aws_request_id, context.get_remaining_time_in_millis())
    body = json.loads(event.get("body") or "{}")
    return {"statusCode": 200, "body": json.dumps({"ok": True})}
```
`context` gives request ID, function name/version, memory, remaining time (use it to stop work gracefully before timeout).

---

### Q03. Memory, CPU, timeout, ephemeral storage

| Setting | Range | Notes |
|---|---|---|
| Memory | 128 MB – 10,240 MB | **CPU scales with memory** (≈1 vCPU at 1,769 MB, up to 6 vCPUs) |
| Timeout | 1 s – 900 s (15 min) | API Gateway caps synchronous HTTP at ~29–30 s anyway |
| `/tmp` | 512 MB – 10 GB | per environment |
| Payload | 6 MB sync request/response, 1 MB async event | larger → S3 pointer; response streaming allows bigger/streamed responses |
| Architecture | x86_64 or **arm64 (Graviton, ~20% cheaper)** | |

**Tuning tip:** more memory can be **cheaper** if the function finishes proportionally faster (CPU-bound). Use **AWS Lambda Power Tuning** to find the sweet spot.

---

### Q04. Execution role vs resource-based policy

| | Execution role | Resource-based policy |
|---|---|---|
| Answers | what **the function** can do (read S3, write DynamoDB, logs) | **who can invoke** the function |
| Example | `dynamodb:PutItem` on table X | allow `apigateway.amazonaws.com` / S3 / another account to `lambda:InvokeFunction` |

Event source mappings (SQS, Kinesis, DynamoDB Streams) **poll on your behalf using the execution role** — so the role needs `sqs:ReceiveMessage`, `sqs:DeleteMessage`, etc.

---

### Q05. Runtimes and container images

Managed runtimes (Python 3.12/3.13/3.14, Node.js, Java, .NET, Ruby), custom runtimes (`provided.al2023`) for Go/Rust, or **container images** up to 10 GB from ECR. Runtimes are deprecated on a schedule — keep upgrading.

---

### Q06. Layers vs container images

| | Layers | Container image |
|---|---|---|
| Packaging | zip archives (shared libs) mounted at `/opt` | full OCI image ≤ 10 GB |
| Size | function + layers ≤ 250 MB unzipped | 10 GB |
| Best for | sharing small common deps, extensions | big dependencies (ML libs), consistent local/CI builds |

Both are versioned; pin versions. Layers don't fix dependency conflicts — test the combined package.

---

### Q07. Environment variables and configuration

Environment variables (encrypted at rest with KMS; ≤ 4 KB total) for non-secret config. For **secrets**, use Secrets Manager / Parameter Store at runtime with caching (Q27). AppConfig for feature flags/dynamic config.

---

### Q08. Pricing in one line

Requests + compute duration (GB-seconds, per ms) + optional provisioned concurrency + extras (ephemeral storage > 512 MB, data transfer). arm64 is cheaper. Long waiting (e.g., on an LLM) is billed — consider Step Functions or durable functions waits for long pauses.

---

## 3. Invocation models & event sources

### Q09. Synchronous vs asynchronous vs poll-based (event source mapping)

```
 SYNCHRONOUS (RequestResponse)            ASYNCHRONOUS (Event)                  POLL-BASED (Event Source Mapping)
 API GW / ALB / SDK invoke                 S3, SNS, EventBridge, SDK Event       SQS, Kinesis, DynamoDB Streams, Kafka, MQ
 caller waits for result                   Lambda queues event internally,       Lambda service polls the source,
 errors returned to caller;                returns 202 immediately               invokes with BATCHES
 caller decides to retry                   retries 2× (configurable 0–2),        SQS: failed batch returns to queue
                                           max event age up to 6 h,              (visibility timeout) → DLQ on the queue
                                           then → on-failure destination / DLQ   Streams: retry until success/expiry,
                                                                                 bisect batch, on-failure destination
```

---

### Q10. Retries, DLQs and destinations

| Source type | Retry behaviour | Failure handling |
|---|---|---|
| Sync | none by Lambda | caller handles |
| Async | 2 retries by default (configurable), max event age | **on-failure destination** (SQS/SNS/EventBridge/Lambda/S3) — richer than legacy DLQ (includes error + context); on-success destination too |
| SQS ESM | message reappears after visibility timeout until `maxReceiveCount` | **queue's redrive DLQ** |
| Kinesis/DDB Streams | retries blocking the shard | `maximumRetryAttempts`, `bisectBatchOnFunctionError`, on-failure destination |

---

### Q11. Lambda with SQS — the important settings

- **Batch size** (up to 10,000 for standard) and **batching window** (wait up to N s to fill a batch).
- **Visibility timeout** on the queue ≥ **6× function timeout** (AWS guidance) so messages don't reappear mid-processing.
- **Maximum concurrency** on the event source mapping → cap how many concurrent functions the queue drives (protect downstream).
- **Partial batch response** (Q12) so one bad message doesn't retry the whole batch.
- **DLQ** on the source queue with `maxReceiveCount` (e.g., 5).
- FIFO queues: ordering per message group; concurrency limited by number of groups.

---

### Q12. Partial batch failure response — why it matters

**Short answer:** Without it, if 1 of 10 messages fails and the function raises, **all 10** return to the queue and are reprocessed (duplicates, wasted work, poison message loops). With `ReportBatchItemFailures`, you return only the failed message IDs.

```python
def handler(event, context):
    failures = []
    for record in event["Records"]:
        try:
            process(json.loads(record["body"]))
        except Exception:
            failures.append({"itemIdentifier": record["messageId"]})
    return {"batchItemFailures": failures}       # only these are retried
```
(Powertools `BatchProcessor` does this for you.)

---

### Q13. Idempotency — why and how

**Short answer:** Async and poll-based sources deliver **at least once**; retries happen. A handler must produce the same result if run twice with the same event.

```python
from aws_lambda_powertools.utilities.idempotency import idempotent, DynamoDBPersistenceLayer
persistence = DynamoDBPersistenceLayer(table_name="idempotency")

@idempotent(persistence_store=persistence)       # key = hash of event (or chosen field), TTL record
def handler(event, context):
    return charge_customer(event["order_id"])    # second call returns stored result, no second charge
```
Manual version: `PutItem` with `ConditionExpression="attribute_not_exists(pk)"` on the event/business ID before doing side effects.

---

### Q14. API Gateway / Function URL / ALB in front of Lambda

- **API Gateway HTTP API** — cheap, JWT authorizers, simple; **REST API** — usage plans/API keys, request validation, WAF, caching, response streaming support.
- **Function URL** — built-in HTTPS endpoint (IAM or no auth), supports **response streaming**; put CloudFront in front for custom domain/WAF.
- **ALB** — Lambda as target alongside containers.
Sync limits: ~29 s default integration timeout on API Gateway (REST regional can be increased), 6 MB payload (streaming lifts response limits).

---

### Q15. S3 → Lambda pitfalls

Recursive loops (function writes back to the same bucket/prefix that triggers it → infinite invocations; use separate prefixes/buckets; Lambda recursive-loop detection helps), events are at-least-once and unordered, large bursts → put **SQS between S3 and Lambda** for buffering and controlled concurrency.

---

## 4. Concurrency, scaling & cold starts

### Q16. Concurrency explained

**Short answer:** Concurrency = number of requests being processed **at the same moment** ≈ requests/sec × average duration (s). Example: 100 req/s × 0.5 s = 50 concurrent environments. Account default limit is typically 1,000 per region (raisable). Scaling: each function can add up to **1,000 concurrent executions every 10 seconds**.

---

### Q17. Reserved vs provisioned concurrency

| | Reserved concurrency | Provisioned concurrency |
|---|---|---|
| What | **guarantee and cap**: carves N from the account pool for this function; also max limit | **pre-initialised** warm environments (no cold start) |
| Cost | free | paid per hour + cheaper duration |
| Use | protect downstream (cap at 20 to protect DB), ensure capacity for critical function, set 0 to disable | latency-sensitive APIs, predictable traffic (schedule with Application Auto Scaling) |

---

### Q18. Cold starts — causes and mitigations

**Causes:** new environment needed (first request, scale-out, after idle, new deployment). Duration depends on runtime (Java/.NET heavier), package size, INIT work (imports, SDK clients), VPC (now fast with Hyperplane ENIs).

**Mitigations:**
- Keep package small; lazy-import heavy modules; init clients globally.
- **SnapStart** (Java, Python, .NET): snapshot the initialised environment, restore from cache → much faster cold starts (watch out for uniqueness — reseed randomness, refresh connections on restore).
- **Provisioned concurrency** for strict latency.
- arm64, more memory (more CPU for init).

---

### Q19. Throttling vs downstream rate limiting — how to tell apart

- **Lambda throttling:** `Throttles` metric > 0, `TooManyRequestsException` (429) for sync callers, async events retried; caused by concurrency limit (account/reserved).
- **Downstream throttling:** your function succeeds in starting, but calls to Bedrock/DynamoDB return `ThrottlingException` — visible in logs/traces, `Errors`/duration up, not `Throttles`.
Fix the right one: raise/reserve concurrency vs add backoff, queueing, ESM max concurrency, quota increases.

---

### Q20. Database connections in Lambda

Each concurrent environment opens its own connections → 500 concurrent functions can exhaust Postgres. Use **RDS Proxy** (connection pooling, IAM auth, faster failover), keep connections global (reuse while warm), cap concurrency, or use DynamoDB / Aurora Data API (HTTP, no connection management).

---

## 5. Packaging, versions, configuration

### Q21. Versions and aliases

**Short answer:** Publishing creates an immutable **version** (`:7`) of code+config. An **alias** (`prod`) is a pointer to a version and can **split traffic** between two versions (weighted). Event sources/API Gateway point at the alias → deploy = move alias.

```flow
pipeline: Canary release with an alias
prod alias → v7 100% > Clients always call the alias, never a version number.
Shift 10% to v8 > CodeDeploy weights the alias: 90% v7, 10% v8.
Watch alarms 5 min > Errors, throttles, duration.
Alarm? roll back > Instantly back to 100% v7.
100% v8 > Alarms stayed green, so the alias moves fully to v8.
```
`$LATEST` is mutable — don't point production at it.

---

### Q22. Deployment tooling

SAM, CDK, Terraform, Serverless Framework; CodeDeploy for canary/linear traffic shifting with alarms; GitLab CI builds artifact once, deploys versions per environment.

---

### Q23. Lambda Powertools (Python) — what it gives you

Structured logging (with correlation IDs), metrics (Embedded Metric Format), tracing (X-Ray), idempotency, batch processing (partial failures), parameters/secrets caching, event parsing/validation (Pydantic), feature flags. A strong "production readiness" signal in interviews.

---

### Q24. Extensions

Processes that run alongside your function in the environment (monitoring agents, secrets caching extension, ADOT collector). They add INIT time/memory — measure.

---

### Q25. Response streaming

Function URLs/API Gateway REST can stream responses progressively (e.g., LLM tokens) — improves time-to-first-byte and allows larger responses. Supported natively on Node.js; other runtimes via custom runtime/Lambda Web Adapter.

---

## 6. Security & networking

### Q26. Least privilege for a Lambda used as an agent tool

One function per tool with its own role scoped to exact actions/resources (e.g., `s3:GetObject` on `arn:aws:s3:::docs/tenants/*` + tag conditions), resource policy allowing only the AgentCore Gateway role to invoke, validate inputs (Pydantic) as if from an untrusted caller, authorise the **end user** passed in trusted context, reserved concurrency to cap blast radius, logs redacted.

---

### Q27. Secrets in Lambda

Fetch from Secrets Manager/Parameter Store at INIT or first use and **cache** with TTL (Powertools `parameters`, or the **AWS Parameters and Secrets Lambda Extension** serving a local HTTP cache). Don't put secrets in env vars in plain text or in code. Grant `secretsmanager:GetSecretValue` on the specific secret ARN + `kms:Decrypt`.

---

### Q28. Lambda in a VPC

Attach to private subnets + SG when it must reach private resources (RDS, internal APIs). Lambda uses shared Hyperplane ENIs (fast, not one per invocation). Outbound internet then needs NAT; AWS services need NAT or VPC endpoints. Don't attach to a VPC if not needed.

---

### Q29. Securing outbound calls

SG egress restrictions, NAT + Network Firewall / DNS Firewall allowlists, VPC endpoints with policies, timeouts on every HTTP call (shorter than function timeout), TLS verification, no user-controlled URLs (SSRF).

---

## 7. Long-running work & newer features

### Q30. Work longer than 15 minutes — options

| Option | When |
|---|---|
| **Step Functions** orchestrating many short Lambdas | multi-step workflows, waits, retries, human approval (task tokens) |
| **Lambda durable functions** | write multi-step workflow **in code inside Lambda**; state checkpointed, can wait (even long periods) without paying for compute |
| **ECS/Fargate task** | single long CPU job |
| **AWS Batch** | large batch/HPC |
| Async service APIs (Textract `StartDocumentAnalysis` + SNS) | let the service do the long work; resume on completion event |

---

### Q31. Lambda durable functions

**Short answer:** Write a long-running, multi-step workflow as ordinary code in one Lambda function. The SDK **checkpoints** each completed step; if the function is interrupted or waits for an external event (callback/approval) or a timer, it later **replays** and skips completed steps using saved results. You aren't billed for compute while waiting. Fits agent loops, approval chains, order workflows.

```python
# Conceptual shape (check the current SDK for exact names)
@durable_execution
def handler(event, ctx):
    doc = ctx.step(lambda: start_extraction(event["doc_id"]), name="extract")   # checkpointed
    approval = ctx.wait_for_callback(lambda token: notify_reviewer(doc, token), name="review")
    if approval["approved"]:
        ctx.step(lambda: publish(doc), name="publish")
```
**Same rule as LangGraph/Step Functions:** code outside steps re-runs on replay → keep side effects inside steps and make them idempotent.

**Durable functions vs Step Functions:** code-first in one function (developer-friendly, versioned with code) vs visual state machine with 200+ AWS service integrations and execution history UI.

---

### Q32. Lambda Managed Instances

Run Lambda functions on **EC2 capacity in your account** (choose instance types, incl. Graviton/specialised hardware) while AWS manages provisioning, patching and scaling; each instance handles **multiple concurrent requests** (so code must be thread/async-safe). Fits steady high-volume workloads where EC2 pricing (Savings Plans) beats per-ms billing; reduces cold starts.

---

### Q33. Tenant isolation mode

Lambda can route invocations by a **tenant ID** you supply so each execution environment only serves one tenant — isolation between customers without deploying a function per tenant. Useful for multi-tenant SaaS/agent tools processing customer data.

---

## 8. Observability

### Q34. What to monitor

Metrics: `Invocations`, `Errors`, `Throttles`, `Duration` (p95/p99 vs timeout), `ConcurrentExecutions`, `IteratorAge` (streams), `AsyncEventAge`, DLQ/destination counts, SQS `ApproximateAgeOfOldestMessage`. Logs: structured JSON (Lambda supports JSON log format + log levels natively), CloudWatch Logs Insights. Traces: X-Ray / ADOT / Application Signals. Alarms on error rate, throttles, duration near timeout, queue age.

---

### Q35. Useful Logs Insights query

```
filter @type = "REPORT"
| stats max(@maxMemoryUsed / 1024 / 1024) as maxMemMB,
        pct(@duration, 99) as p99ms,
        sum(@initDuration > 0) as coldStarts, count() as invocations by bin(1h)
```

---

## 9. Scenario & debugging questions

### Q36. Lambda times out but CPU is low

It's **waiting**, not computing: slow/blocked network call (no timeout set; VPC function without NAT/endpoint → hangs until timeout), DB connection pool waits, downstream throttling with long backoff, DNS issues. Debug with X-Ray segments for each call, logs with timestamps, and `get_remaining_time_in_millis()`. Fix: timeouts on clients, endpoints/NAT, RDS Proxy, async pattern for slow work.

---

### Q37. SQS messages processed twice

Expected with at-least-once delivery, made worse by: visibility timeout shorter than processing time, whole-batch failures without partial batch response, function timeouts after side effects. Fix: idempotency (conditional writes/Powertools), visibility timeout ≥ 6× timeout, `ReportBatchItemFailures`, FIFO + dedup where business requires.

---

### Q38. Handle spiky 300 documents/min events

```flow
pipeline: Handling spiky 300 documents/min with Lambda
S3 upload > Event via EventBridge or an S3 notification.
SQS buffer > Absorbs spikes.
Lambda (max concurrency N) > The event source mapping caps concurrency so downstream quotas aren't overrun.
Start async Textract > ClientRequestToken = document hash, so retries don't start duplicate jobs.
SNS → SQS on completion > Textract signals when it's done.
Lambda: LLM extraction > Bounded concurrency, retries with backoff.
Save to DynamoDB/S3 > Status per document. Failures → DLQ + alarm.
```
Key: buffer, cap concurrency to Textract/Bedrock quotas, idempotent starts, async service APIs instead of waiting inside Lambda.

---

### Q39. Cold starts hurt an API's p99

Measure `initDuration`; reduce package/imports; SnapStart (Python/Java/.NET); provisioned concurrency on the alias with auto scaling; arm64 + more memory; or move the API to ECS if consistently busy.

---

### Q40. A Lambda costs more than expected

Check duration × memory (Power Tuning), time spent waiting on I/O (LLM calls → maybe Step Functions waits / async), retries/recursion loops, logging volume, provisioned concurrency left on, x86 vs arm64.

---

### Q41. Async-invoked function silently drops events

Retries exhausted or max event age exceeded with no destination/DLQ configured → events lost. Configure on-failure destination, alarm on `DestinationDeliveryFailures`/`AsyncEventsDropped`, make handler errors visible.

---

## 10. Cheat sheet

| Concept | One-liner |
|---|---|
| Execution env | microVM; INIT once, many INVOKEs; one request at a time |
| Globals | reuse clients; no per-request state |
| Limits | 15 min, 10 GB memory/image, 6 MB sync payload |
| CPU | scales with memory |
| Invocation | sync (caller retries), async (2 retries + destinations), ESM (polling batches) |
| SQS | visibility ≥ 6× timeout, partial batch response, DLQ, max concurrency |
| Idempotency | at-least-once → conditional writes / Powertools |
| Concurrency | rps × duration; reserved = cap/guarantee, provisioned = warm |
| Cold start | small package, lazy imports, SnapStart, provisioned |
| Versions/aliases | immutable versions; alias traffic shifting |
| Roles | execution role = what fn can do; resource policy = who can invoke |
| DB | RDS Proxy |
| Long work | Step Functions, durable functions, ECS, async service APIs |
| New | durable functions, Managed Instances, tenant isolation |

## Official references

- https://docs.aws.amazon.com/lambda/latest/dg/welcome.html
- Execution environment: https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html
- Concurrency: https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html
- SQS: https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html
- Durable functions: https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html
- Tenant isolation: https://docs.aws.amazon.com/lambda/latest/dg/tenant-isolation.html
- Powertools for Python: https://docs.powertools.aws.dev/lambda/python/latest/
