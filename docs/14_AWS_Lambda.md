# AWS Lambda: Interview Preparation

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

```flow
pipeline: Lambda in one line each
Event arrives > HTTP, queue message, file upload, schedule.
Lambda runs your handler > In a managed environment, scaled automatically.
Pay per use > Requests + GB-seconds; nothing when idle.
Good fit > Short, event-driven, spiky work (max 15 minutes).
```

**Good fit:** event processing (S3 uploads, SQS, EventBridge), APIs with spiky traffic, glue/automation, scheduled jobs, agent **tools** behind AgentCore Gateway, stream processing.
**Poor fit:** long-running/always-busy services (ECS cheaper/simpler), persistent connections (WebSocket servers), heavy GPU work, very latency-sensitive paths that can't tolerate cold starts.

---

### Q02. Handler, event and context

```flow
pipeline: Handler, event and context
Init code (outside handler) > Runs once per environment: clients, config.
handler(event, context) > Called per invocation.
event > The input (API request, SQS batch, S3 notification).
context > Request id, remaining time, function info.
Return value > Response for sync callers; ignored for async.
```

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

```flow
trace: Memory setting also buys CPU
128 MB  →  tiny CPU share, handler takes **4,000 ms** > CPU scales with memory.
1024 MB  →  ~8× CPU, **600 ms** > Faster.
cost ∝ memory × duration > 128 × 4,000 vs 1024 × 600: the bigger setting can be cheaper too.
tune with Lambda Power Tuning > Measure; don't guess.
```

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

```flow
sequence: Two kinds of Lambda permissions
actors: S3, Lambda resource policy, Function, Execution role, DynamoDB
S3 -> Lambda resource policy: may S3 invoke this function?
Lambda resource policy --> S3: yes (lambda:InvokeFunction for s3.amazonaws.com, source bucket)
S3 -> Function: invoke
Function -> Execution role: credentials
Execution role -> DynamoDB: PutItem allowed?
> Resource policy = who can CALL the function. Execution role = what the function can DO.
```

| | Execution role | Resource-based policy |
|---|---|---|
| Answers | what **the function** can do (read S3, write DynamoDB, logs) | **who can invoke** the function |
| Example | `dynamodb:PutItem` on table X | allow `apigateway.amazonaws.com` / S3 / another account to `lambda:InvokeFunction` |

Event source mappings (SQS, Kinesis, DynamoDB Streams) **poll on your behalf using the execution role** — so the role needs `sqs:ReceiveMessage`, `sqs:DeleteMessage`, etc.

---

### Q05. Runtimes and container images

Managed runtimes (Python 3.12/3.13/3.14, Node.js, Java, .NET, Ruby), custom runtimes (`provided.al2023`) for Go/Rust, or **container images** up to 10 GB from ECR. Runtimes are deprecated on a schedule — keep upgrading.

```flow
pipeline: Zip vs container image
Zip package > Up to 250 MB unzipped; managed runtimes; fastest cold start.
Container image > Up to 10 GB; your own base image and tooling.
Same execution model > Handler, limits, scaling.
Choose > Big dependencies (ML libs) or existing container workflow → image.
```

---

### Q06. Layers vs container images

```flow
pipeline: Layers vs container images
Layer > Shared zip of libraries attached to functions (up to 5).
Container image > Everything bundled in one image.
Versioning > Layers are versioned separately; images are versioned as a whole.
Prefer > Images for big or complex dependencies; layers for small shared utilities.
```

| | Layers | Container image |
|---|---|---|
| Packaging | zip archives (shared libs) mounted at `/opt` | full OCI image ≤ 10 GB |
| Size | function + layers ≤ 250 MB unzipped | 10 GB |
| Best for | sharing small common deps, extensions | big dependencies (ML libs), consistent local/CI builds |

Both are versioned; pin versions. Layers don't fix dependency conflicts — test the combined package.

---

### Q07. Environment variables and configuration

Environment variables (encrypted at rest with KMS; ≤ 4 KB total) for non-secret config. For **secrets**, use Secrets Manager / Parameter Store at runtime with caching (Q27). AppConfig for feature flags/dynamic config.

```flow
pipeline: Configuration sources
Environment variables > Non-secret settings (encrypted at rest).
Parameter Store > Shared config, versioned.
Secrets Manager > Secrets, rotation; cache in the function.
Load at init, refresh periodically > Not on every invocation.
```

---

### Q08. Pricing in one line

Requests + compute duration (GB-seconds, per ms) + optional provisioned concurrency + extras (ephemeral storage > 512 MB, data transfer). arm64 is cheaper. Long waiting (e.g., on an LLM) is billed — consider Step Functions or durable functions waits for long pauses.

```flow
trace: Estimating a Lambda bill
3M requests/month × $0.20 per 1M = **$0.60** > Request charge.
3M × 0.4 s × 0.5 GB = 600,000 GB-s > Duration × memory.
600,000 × ~$0.0000167 ≈ **$10** > Compute charge (x86; ARM cheaper).
total ≈ $10.60 (illustrative prices) > Plus data transfer, logs, provisioned concurrency if used.
```

---

## 3. Invocation models & event sources

### Q09. Synchronous vs asynchronous vs poll-based (event source mapping)

```flow
sequence: Three invocation models
actors: Caller, Lambda service, Function, SQS
Caller -> Lambda service: SYNC (API Gateway): wait for the result
Lambda service -> Function: invoke; errors go straight back to the caller
Caller -> Lambda service: ASYNC (S3, EventBridge): 202, queued internally
Lambda service -> Function: invoke; retries twice on error, then DLQ/destination
Lambda service -> SQS: POLL (event source mapping): Lambda reads batches
SQS --> Function: batch; failures return to the queue → DLQ after maxReceiveCount
```

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

```flow
pipeline: Async invocation failure handling
Event queued > Lambda's internal queue.
Invoke fails > Retry up to 2 more times (configurable 0–2) with backoff.
Retries or max event age exhausted > Without a destination, the event is discarded.
On-failure destination / DLQ > SQS, SNS, EventBridge or Lambda receives the event + error.
On-success destination > Optional: chain the next step.
```

| Source type | Retry behaviour | Failure handling |
|---|---|---|
| Sync | none by Lambda | caller handles |
| Async | 2 retries by default (configurable), max event age | **on-failure destination** (SQS/SNS/EventBridge/Lambda/S3) — richer than legacy DLQ (includes error + context); on-success destination too |
| SQS ESM | message reappears after visibility timeout until `maxReceiveCount` | **queue's redrive DLQ** |
| Kinesis/DDB Streams | retries blocking the shard | `maximumRetryAttempts`, `bisectBatchOnFunctionError`, on-failure destination |

---

### Q11. Lambda with SQS — the important settings

```flow
pipeline: Lambda + SQS settings that matter
Visibility timeout ≥ 6× function timeout > So in-flight messages aren't redelivered mid-processing.
Batch size + batching window > Throughput vs latency.
Maximum concurrency on the ESM > Protects downstream systems.
Partial batch response > Only failed messages retried.
maxReceiveCount → DLQ > Poison messages stop looping.
```

- **Batch size** (up to 10,000 for standard) and **batching window** (wait up to N s to fill a batch).
- **Visibility timeout** on the queue ≥ **6× function timeout** (AWS guidance) so messages don't reappear mid-processing.
- **Maximum concurrency** on the event source mapping → cap how many concurrent functions the queue drives (protect downstream).
- **Partial batch response** (Q12) so one bad message doesn't retry the whole batch.
- **DLQ** on the source queue with `maxReceiveCount` (e.g., 5).
- FIFO queues: ordering per message group; concurrency limited by number of groups.

---

### Q12. Partial batch failure response — why it matters

**Short answer:** Without it, if 1 of 10 messages fails and the function raises, **all 10** return to the queue and are reprocessed (duplicates, wasted work, poison message loops). With `ReportBatchItemFailures`, you return only the failed message IDs.

```flow
trace: Partial batch failure response
batch of 10, message **#7** fails > Without partial response, the whole batch counts as failed.
without: all 10 return to the queue > 9 good messages get processed again (duplicates, wasted work).
with ReportBatchItemFailures: return {batchItemFailures: [#7]} > Tell Lambda exactly which ones failed.
only **#7** retried > Eventually to the DLQ if it keeps failing.
```

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

```flow
sequence: Powertools idempotency on a retried event
actors: Event, Function, Idempotency table
Event -> Function: payment event (key = order A12)
Function -> Idempotency table: key A12 → INPROGRESS
Function -> Function: process, charge once
Function -> Idempotency table: A12 → COMPLETED + saved result
Event -> Function: same event retried
Function -> Idempotency table: A12 COMPLETED?
Idempotency table --> Function: yes → return saved result, no second charge
```

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

```flow
pipeline: What to put in front of Lambda
API Gateway > Auth, throttling, usage plans, request validation.
Function URL > Simplest HTTPS endpoint; IAM or no auth; supports streaming.
ALB > When you already have one; mix with containers behind the same LB.
Choose by > Features needed vs cost and simplicity.
```

- **API Gateway HTTP API** — cheap, JWT authorizers, simple; **REST API** — usage plans/API keys, request validation, WAF, caching, response streaming support.
- **Function URL** — built-in HTTPS endpoint (IAM or no auth), supports **response streaming**; put CloudFront in front for custom domain/WAF.
- **ALB** — Lambda as target alongside containers.
Sync limits: ~29 s default integration timeout on API Gateway (REST regional can be increased), 6 MB payload (streaming lifts response limits).

---

### Q15. S3 → Lambda pitfalls

Recursive loops (function writes back to the same bucket/prefix that triggers it → infinite invocations; use separate prefixes/buckets; Lambda recursive-loop detection helps), events are at-least-once and unordered, large bursts → put **SQS between S3 and Lambda** for buffering and controlled concurrency.

```flow
pipeline: S3 → Lambda pitfalls
Recursive trigger > Function writes back to the same bucket/prefix → infinite loop. Use separate prefixes/buckets.
Duplicates > Events can arrive more than once → idempotent processing.
Ordering > Not guaranteed.
Large files > Stream from S3; consider Step Functions for long work.
```

---

## 4. Concurrency, scaling & cold starts

### Q16. Concurrency explained

**Short answer:** Concurrency = number of requests being processed **at the same moment** ≈ requests/sec × average duration (s). Example: 100 req/s × 0.5 s = 50 concurrent environments. Account default limit is typically 1,000 per region (raisable). Scaling: each function can add up to **1,000 concurrent executions every 10 seconds**.

```flow
trace: Concurrency = requests in flight
100 requests/s × 0.5 s each  →  ~**50** concurrent environments > Concurrency ≈ rate × duration.
duration grows to 2 s  →  **200** concurrent > Slow dependencies multiply concurrency.
account limit 1,000 (default, raisable) > Shared by all functions in the region.
over the limit  →  **throttled (429)** > Reserve concurrency for critical functions.
```

---

### Q17. Reserved vs provisioned concurrency

```flow
pipeline: Reserved vs provisioned concurrency
Reserved concurrency > Guarantees AND caps how many instances this function can use. Free.
Provisioned concurrency > Keeps N environments initialised and warm: no cold starts. Costs money.
Combine > Provisioned for the latency-critical baseline, autoscaled on schedule/utilisation.
Reserved = 0 > Effectively disables the function (an emergency stop).
```

| | Reserved concurrency | Provisioned concurrency |
|---|---|---|
| What | **guarantee and cap**: carves N from the account pool for this function; also max limit | **pre-initialised** warm environments (no cold start) |
| Cost | free | paid per hour + cheaper duration |
| Use | protect downstream (cap at 20 to protect DB), ensure capacity for critical function, set 0 to disable | latency-sensitive APIs, predictable traffic (schedule with Application Auto Scaling) |

---

### Q18. Cold starts — causes and mitigations

**Causes:** new environment needed (first request, scale-out, after idle, new deployment). Duration depends on runtime (Java/.NET heavier), package size, INIT work (imports, SDK clients), VPC (now fast with Hyperplane ENIs).

```flow
pipeline: Cutting cold-start time
Smaller package > Fewer and lighter dependencies.
Lazy imports > Load heavy libraries only when needed.
More memory > More CPU during init.
SnapStart > Restore from a snapshot (Java, Python, .NET).
Provisioned concurrency > Pre-warmed environments for strict latency.
```

**Mitigations:**
- Keep package small; lazy-import heavy modules; init clients globally.
- **SnapStart** (Java, Python, .NET): snapshot the initialised environment, restore from cache → much faster cold starts (watch out for uniqueness — reseed randomness, refresh connections on restore).
- **Provisioned concurrency** for strict latency.
- arm64, more memory (more CPU for init).

---

### Q19. Throttling vs downstream rate limiting — how to tell apart

```flow
pipeline: Throttling or downstream limits?
Lambda Throttles metric > Lambda itself refused invocations (concurrency limit).
Errors with 429 from an API > Your function ran; the downstream API throttled it.
Fix Lambda throttles > Raise or reserve concurrency.
Fix downstream > Cap concurrency, queue, retry with backoff.
```

- **Lambda throttling:** `Throttles` metric > 0, `TooManyRequestsException` (429) for sync callers, async events retried; caused by concurrency limit (account/reserved).
- **Downstream throttling:** your function succeeds in starting, but calls to Bedrock/DynamoDB return `ThrottlingException` — visible in logs/traces, `Errors`/duration up, not `Throttles`.
Fix the right one: raise/reserve concurrency vs add backoff, queueing, ESM max concurrency, quota increases.

---

### Q20. Database connections in Lambda

Each concurrent environment opens its own connections → 500 concurrent functions can exhaust Postgres. Use **RDS Proxy** (connection pooling, IAM auth, faster failover), keep connections global (reuse while warm), cap concurrency, or use DynamoDB / Aurora Data API (HTTP, no connection management).

```flow
sequence: RDS Proxy absorbs a burst
actors: 1,000 Lambdas, RDS Proxy, Postgres
1,000 Lambdas -> RDS Proxy: 1,000 connections
RDS Proxy -> Postgres: reuse a pool of ~50 connections
Postgres --> RDS Proxy: results
RDS Proxy --> 1,000 Lambdas: results
> Without the proxy, 1,000 direct connections would exhaust the database. Also: open connections outside the handler.
```

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

```flow
pipeline: Deploying Lambda functions
Define in IaC > SAM / CDK / Terraform / Serverless Framework.
Build + package > Zip or image in CI.
Publish version > Immutable code + config.
Shift alias traffic > CodeDeploy canary/linear with alarms.
```

---

### Q23. Lambda Powertools (Python) — what it gives you

Structured logging (with correlation IDs), metrics (Embedded Metric Format), tracing (X-Ray), idempotency, batch processing (partial failures), parameters/secrets caching, event parsing/validation (Pydantic), feature flags. A strong "production readiness" signal in interviews.

```flow
pipeline: What Powertools adds to a handler
Logger > Structured JSON logs with request ids.
Tracer > X-Ray / OTel spans.
Metrics > CloudWatch EMF metrics without API calls.
Idempotency + batch utilities > Correct SQS/DynamoDB processing.
Parameters + validation > Cached config/secrets, event schemas.
```

---

### Q24. Extensions

Processes that run alongside your function in the environment (monitoring agents, secrets caching extension, ADOT collector). They add INIT time/memory — measure.

```flow
pipeline: Extensions in the lifecycle
INIT > Extensions start alongside the runtime.
INVOKE > They can receive events (e.g. to collect telemetry).
After the response > They can flush data before the environment freezes.
SHUTDOWN > Final flush. Common for observability agents and secret caching.
```

---

### Q25. Response streaming

Function URLs/API Gateway REST can stream responses progressively (e.g., LLM tokens) — improves time-to-first-byte and allows larger responses. Supported natively on Node.js; other runtimes via custom runtime/Lambda Web Adapter.

```flow
sequence: Lambda response streaming
actors: Client, Function URL, Function
Client -> Function URL: request
Function URL -> Function: invoke (RESPONSE_STREAM mode)
Function --> Client: first chunk immediately
Function --> Client: more chunks (e.g. LLM tokens)
Function --> Client: end of stream
> Better time to first byte for LLM output and large responses. Check the docs for current runtime support and size limits.
```

---

## 6. Security & networking

### Q26. Least privilege for a Lambda used as an agent tool

One function per tool with its own role scoped to exact actions/resources (e.g., `s3:GetObject` on `arn:aws:s3:::docs/tenants/*` + tag conditions), resource policy allowing only the AgentCore Gateway role to invoke, validate inputs (Pydantic) as if from an untrusted caller, authorise the **end user** passed in trusted context, reserved concurrency to cap blast radius, logs redacted.

```flow
pipeline: Least privilege for an agent tool Lambda
One function per tool > Small, single purpose.
Execution role scoped > Only the actions + resource ARNs that tool needs.
Who can invoke > Resource policy: only the Gateway role.
Validate inputs + user context > Authorise per user inside the function.
```

---

### Q27. Secrets in Lambda

Fetch from Secrets Manager/Parameter Store at INIT or first use and **cache** with TTL (Powertools `parameters`, or the **AWS Parameters and Secrets Lambda Extension** serving a local HTTP cache). Don't put secrets in env vars in plain text or in code. Grant `secretsmanager:GetSecretValue` on the specific secret ARN + `kms:Decrypt`.

```flow
sequence: Secrets in Lambda with caching
actors: Function, Cache (in memory / extension), Secrets Manager
Function -> Cache (in memory / extension): get db secret
Cache (in memory / extension) -> Secrets Manager: first call: GetSecretValue
Secrets Manager --> Cache (in memory / extension): value (cached with TTL)
Function -> Cache (in memory / extension): later invocations
Cache (in memory / extension) --> Function: cached value (no API call)
> On auth failure, refresh the cache once: handles rotation.
```

---

### Q28. Lambda in a VPC

Attach to private subnets + SG when it must reach private resources (RDS, internal APIs). Lambda uses shared Hyperplane ENIs (fast, not one per invocation). Outbound internet then needs NAT; AWS services need NAT or VPC endpoints. Don't attach to a VPC if not needed.

```flow
pipeline: Lambda in a VPC
Attach to private subnets > Function gets Hyperplane ENIs (shared, created ahead).
Reach RDS / internal services > Via security groups.
Internet / AWS APIs > Needs NAT or VPC endpoints (no public IP).
Cold start impact > Small today; IP/subnet capacity still matters.
```

---

### Q29. Securing outbound calls

SG egress restrictions, NAT + Network Firewall / DNS Firewall allowlists, VPC endpoints with policies, timeouts on every HTTP call (shorter than function timeout), TLS verification, no user-controlled URLs (SSRF).

```flow
pipeline: Securing outbound calls
Timeouts on every call > Shorter than the function timeout.
Allowlisted destinations > Validate URLs (no SSRF).
Credentials from Secrets Manager > Least privilege, rotated.
Egress controls > VPC + NAT/firewall when strict control is needed.
```

---

## 7. Long-running work & newer features

### Q30. Work longer than 15 minutes — options

```flow
pipeline: Work longer than 15 minutes
Split into steps > Step Functions orchestrating many Lambda calls.
Durable functions > Checkpoint + resume beyond one invocation.
Fan out > Distributed Map over many items.
Or containers > ECS/Batch for long single jobs.
```

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

```flow
sequence: Lambda durable function replay
actors: Durable function, Checkpoint store, External API
Durable function -> External API: step 1: call API
Durable function -> Checkpoint store: save step 1 result
Durable function -> Durable function: wait 2 hours (no compute billed)
Durable function -> Checkpoint store: resumed: replay code from the top
Checkpoint store --> Durable function: step 1 result returned from checkpoint (not called again)
Durable function -> External API: step 2 runs for the first time
> Same idea as LangGraph checkpoints: deterministic replay, side effects inside steps.
```

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

```flow
pipeline: Lambda Managed Instances
Same programming model > Handlers, events.
Runs on EC2 capacity you choose > Instance types, steady utilisation pricing.
Many concurrent requests per environment > Unlike standard Lambda's one-at-a-time.
Fit > Steady, high-volume workloads where per-request pricing is expensive.
```

---

### Q33. Tenant isolation mode

Lambda can route invocations by a **tenant ID** you supply so each execution environment only serves one tenant — isolation between customers without deploying a function per tenant. Useful for multi-tenant SaaS/agent tools processing customer data.

```flow
pipeline: Tenant isolation mode
Invoke with a tenant id > Per request.
Lambda routes to environments for that tenant only > Never shared between tenants.
Data in memory/tmp stays per tenant > Stronger isolation for multi-tenant SaaS.
Trade-off > More environments, more cold starts.
```

---

## 8. Observability

### Q34. What to monitor

Metrics: `Invocations`, `Errors`, `Throttles`, `Duration` (p95/p99 vs timeout), `ConcurrentExecutions`, `IteratorAge` (streams), `AsyncEventAge`, DLQ/destination counts, SQS `ApproximateAgeOfOldestMessage`. Logs: structured JSON (Lambda supports JSON log format + log levels natively), CloudWatch Logs Insights. Traces: X-Ray / ADOT / Application Signals. Alarms on error rate, throttles, duration near timeout, queue age.

```flow
pipeline: What to monitor on Lambda
Errors + throttles > Failures and refused invocations.
Duration p99 vs timeout > Getting close?
Concurrency > Near account/reserved limits?
Iterator age / queue age > Falling behind on streams/queues.
DLQ depth > Events that gave up.
```

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

```flow
pipeline: Times out, CPU low
Waiting, not computing > Slow downstream call without a timeout.
Connection setup > New DB/HTTP connection per invocation; no reuse.
VPC networking > Missing NAT/endpoint → calls hang until timeout.
Fix > Timeouts on calls, reuse clients, endpoints, async patterns.
```

---

### Q37. SQS messages processed twice

Expected with at-least-once delivery, made worse by: visibility timeout shorter than processing time, whole-batch failures without partial batch response, function timeouts after side effects. Fix: idempotency (conditional writes/Powertools), visibility timeout ≥ 6× timeout, `ReportBatchItemFailures`, FIFO + dedup where business requires.

```flow
pipeline: SQS messages processed twice
Visibility timeout too short > Message reappears while still processing.
Batch failure without partial response > Whole batch retried.
At-least-once delivery anyway > Duplicates can always happen.
Fix > Visibility ≥ 6× timeout, partial batch responses, idempotency keys.
```

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

```flow
pipeline: Fixing cold starts on an API's p99
Measure init duration > How much of p99 is cold start?
Trim package + lazy imports > Shorter init.
SnapStart / provisioned concurrency > For the latency-critical path.
Keep traffic warm > Or move to an always-on container if traffic is steady.
```

---

### Q40. A Lambda costs more than expected

Check duration × memory (Power Tuning), time spent waiting on I/O (LLM calls → maybe Step Functions waits / async), retries/recursion loops, logging volume, provisioned concurrency left on, x86 vs arm64.

```flow
pipeline: Lambda bill higher than expected
Duration × memory > Over-provisioned memory? Long waits on I/O?
Invocation count > Retries, recursive triggers, noisy events?
Provisioned concurrency > Paying for idle warm capacity?
Logs > Verbose logging costs in CloudWatch.
```

---

### Q41. Async-invoked function silently drops events

Retries exhausted or max event age exceeded with no destination/DLQ configured → events lost. Configure on-failure destination, alarm on `DestinationDeliveryFailures`/`AsyncEventsDropped`, make handler errors visible.

```flow
pipeline: Async events silently dropped
Retries exhausted > 2 retries then gone…
No on-failure destination / DLQ > …unless one is configured.
Max event age > Old events discarded while throttled.
Fix > Add on-failure destination, alarm on it, idempotent handler.
```

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
