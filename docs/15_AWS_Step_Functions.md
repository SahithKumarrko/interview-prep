# AWS Step Functions: L2 → L3 Interview Preparation

> **Updated:** 24 October 2026 · **Level:** state machine basics → integration patterns → resilient large-scale workflows
> **How to use:** *Short answer* = what you say first. *Explanation / Example* = intuition and ASL. *Pitfall / Follow-up* = where interviewers dig.

---

## Table of contents

1. [Mental model: a workflow engine with memory](#1-mental-model-a-workflow-engine-with-memory)
2. [Fundamentals](#2-fundamentals) (Q01–Q07)
3. [Data flow: JSONata, variables, JSONPath](#3-data-flow-jsonata-variables-jsonpath) (Q08–Q11)
4. [Error handling](#4-error-handling) (Q12–Q14)
5. [Integration patterns](#5-integration-patterns) (Q15–Q19)
6. [Parallelism: Parallel, Map, Distributed Map](#6-parallelism-parallel-map-distributed-map) (Q20–Q23)
7. [Operations: versions, testing, security, cost](#7-operations-versions-testing-security-cost) (Q24–Q29)
8. [Scenario & debugging questions](#8-scenario--debugging-questions) (Q30–Q35)
9. [Cheat sheet](#9-cheat-sheet)

---

## 1. Mental model: a workflow engine with memory

**Step Functions = a managed state machine.** You describe steps (states) and transitions in **Amazon States Language (ASL, JSON)**; Step Functions runs them, remembers where each execution is, passes data between steps, and handles retries, timeouts, branching, parallelism and waiting — for up to a year.

```
                        Document processing workflow (Standard)
 StartExecution(input: {docId})
        │
        ▼
 ┌───────────────┐   Task: DynamoDB PutItem (claim job, idempotent)
 │ RegisterJob   │
 └──────┬────────┘
        ▼
 ┌───────────────┐   Task: Textract StartDocumentAnalysis + .waitForTaskToken
 │ StartOCR      │   (pauses until Textract completion event calls SendTaskSuccess)
 └──────┬────────┘
        ▼
 ┌───────────────┐   Map: for each page chunk (MaxConcurrency 10)
 │ ExtractFields │──► Lambda/Bedrock: LLM extraction  [Retry: throttling, backoff+jitter]
 └──────┬────────┘
        ▼
 ┌───────────────┐   Choice: confidence < 0.8 ?
 │ CheckQuality  │──── yes ──► HumanReview (task token → reviewer UI → SendTaskSuccess)
 └──────┬────────┘                                   │
        │ no ◄────────────────────────────────────────┘
        ▼
 ┌───────────────┐           any error ──Catch──► ┌──────────────┐ ─► Fail
 │ SaveResults   │                                │ MarkFailed   │
 └──────┬────────┘                                │ + notify     │
        ▼                                         └──────────────┘
     Succeed
```

**Why use it instead of code?** Visible execution history per run, built-in retries/catch/timeouts, durable waits (no compute billed while waiting), 200+ AWS service integrations without Lambda glue, and auditability.

---

## 2. Fundamentals

### Q01. What is Step Functions and when do you use it?

**Short answer:** A serverless orchestration service for coordinating multiple steps/services into workflows with built-in state, error handling and visual monitoring. Use for multi-step business processes, long-running jobs, human approvals, ETL/document pipelines, microservice orchestration (sagas), and fan-out processing.

**When not:** a single short function, very high-frequency trivial event processing (cost), or logic that's simpler as code (consider Lambda durable functions).

---

### Q02. Standard vs Express workflows

| | **Standard** | **Express** |
|---|---|---|
| Max duration | **1 year** | **5 minutes** |
| Execution semantics | **exactly-once** step execution (per workflow) | **at-least-once** (async) / at-most-once (sync) |
| Pricing | per **state transition** | per request + duration/memory |
| History | full execution history in console/API (90 days) | CloudWatch Logs only |
| Supports `.sync` / `.waitForTaskToken` | ✅ | ❌ (only request-response) |
| Throughput | high but lower | very high (100k+/s) |
| Use | long, auditable, human-in-loop, non-idempotent steps | high-volume, short event processing, streaming transforms, sync API backends |

**Pattern:** Standard parent orchestrates; Express children do high-volume short sub-steps (e.g., inside Distributed Map).

---

### Q03. State types

| State | Purpose |
|---|---|
| **Task** | do work: call a service (Lambda, DynamoDB, ECS, Bedrock, HTTP endpoint, any AWS SDK API) |
| **Choice** | branch based on data |
| **Parallel** | fixed set of branches run concurrently |
| **Map** | run the same steps for each item (inline or distributed) |
| **Wait** | pause for seconds or until a timestamp |
| **Pass** | pass/transform data (testing, shaping) |
| **Succeed / Fail** | end execution successfully / with error + cause |

---

### Q04. A minimal state machine (JSONata)

```json
{
  "Comment": "Classify a document",
  "QueryLanguage": "JSONata",
  "StartAt": "Classify",
  "States": {
    "Classify": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Arguments": { "FunctionName": "classify-doc", "Payload": { "docId": "{% $states.input.docId %}" } },
      "Output": "{% $states.result.Payload %}",
      "Retry": [{ "ErrorEquals": ["Lambda.TooManyRequestsException", "States.Timeout"],
                  "IntervalSeconds": 2, "BackoffRate": 2, "MaxAttempts": 4, "JitterStrategy": "FULL" }],
      "Next": "IsInvoice"
    },
    "IsInvoice": {
      "Type": "Choice",
      "Choices": [{ "Condition": "{% $states.input.type = 'invoice' %}", "Next": "ProcessInvoice" }],
      "Default": "Done"
    },
    "ProcessInvoice": { "Type": "Task", "Resource": "arn:aws:states:::lambda:invoke",
                        "Arguments": { "FunctionName": "process-invoice", "Payload": "{% $states.input %}" },
                        "End": true },
    "Done": { "Type": "Succeed" }
  }
}
```

---

### Q05. How do you start executions?

API Gateway (direct integration `StartExecution` / `StartSyncExecution` for Express), EventBridge rules (S3 upload event, schedules via EventBridge Scheduler), SDK calls from apps, other state machines (nested), SQS via EventBridge Pipes, Step Functions `InvokeHarness`-style integrations for agents.

---

### Q06. Idempotent workflow starts

**Short answer:** Standard executions use a unique **execution `name`** per state machine (reusing the same name for a running/recent execution is rejected/returns the existing one). Use a business key (`doc-<hash>`) as the name so duplicate events don't start duplicate workflows. Express doesn't dedupe — make steps idempotent.

```python
sfn.start_execution(stateMachineArn=ARN, name=f"doc-{doc_hash}", input=json.dumps({"docId": doc_id}))
# ExecutionAlreadyExists → already started → safe to ignore
```

---

### Q07. Timeouts

`TimeoutSeconds` on Task states (and the whole machine), **`HeartbeatSeconds`** for callback/activity tasks (worker must send heartbeats, otherwise `States.HeartbeatTimeout`). Always set timeouts on callback tasks — otherwise a lost token waits up to a year.

---

## 3. Data flow: JSONata, variables, JSONPath

### Q08. JSONPath vs JSONata

**Short answer:** Two query languages for moving/transforming data between states.
- **JSONPath (original):** `InputPath` → `Parameters` → (task) → `ResultSelector` → `ResultPath` → `OutputPath`. Powerful but confusing; limited transformations (intrinsic functions like `States.Format`).
- **JSONata (newer, recommended for new workflows):** fields `Arguments` (what to send) and `Output` (what to pass on) using `{% expression %}`, with rich transformations (math, string, filtering, dates) and `$states.input`, `$states.result`, `$states.context`.

```
 JSONPath data flow                                        JSONata data flow
 input ─InputPath─► Parameters ─► TASK ─► ResultSelector   input ─► Arguments ─► TASK ─► Output
      ─► ResultPath (merge into input) ─► OutputPath ─►         ($states.input)   ($states.result)
```
Set `"QueryLanguage": "JSONata"` at top level or per state.

---

### Q09. Variables (`Assign`)

**Short answer:** States can store values in **variables** with `Assign`, and later states can read them (`$docId`) — no need to thread everything through each state's output.

```json
"RegisterJob": {
  "Type": "Task",
  "Resource": "arn:aws:states:::dynamodb:putItem",
  "Arguments": { "TableName": "jobs", "Item": { "pk": { "S": "{% $states.input.docId %}" } } },
  "Assign": { "docId": "{% $states.input.docId %}", "startedAt": "{% $now() %}" },
  "Next": "StartOCR"
}
... later: "Payload": { "docId": "{% $docId %}" }
```
Scope: variables are visible in later states; Map/Parallel inner states can read outer variables but outer can't see inner assignments directly.

---

### Q10. Payload size limits and large data

Max **256 KB** payload per state input/output (and execution history event). Large data → store in **S3** (or DynamoDB) and pass a **reference** (bucket/key). Distributed Map can read items directly from S3 and write results to S3 (`ResultWriter`).

---

### Q11. Context object

`$states.context` (JSONata) / `$$` (JSONPath): execution ID/name, start time, state name, retry count, task token (`$states.context.Task.Token`), Map item index/value. Use execution name/ID as an idempotency key for downstream calls.

---

## 4. Error handling

### Q12. `Retry` and `Catch`

**Short answer:** `Retry` re-attempts a failed state for matching errors with backoff; `Catch` routes to a fallback state when retries are exhausted or for non-retryable errors, optionally keeping error info.

```json
"Retry": [
  { "ErrorEquals": ["ThrottlingException", "States.Timeout"], "IntervalSeconds": 1,
    "BackoffRate": 2.0, "MaxAttempts": 5, "MaxDelaySeconds": 30, "JitterStrategy": "FULL" },
  { "ErrorEquals": ["States.TaskFailed"], "MaxAttempts": 1 }
],
"Catch": [
  { "ErrorEquals": ["ValidationError"], "Next": "RejectDocument" },
  { "ErrorEquals": ["States.ALL"], "Output": { "error": "{% $states.errorOutput %}" }, "Next": "MarkFailed" }
]
```
Order matters: first matching retrier/catcher wins; put `States.ALL` last. Don't retry permanent errors (validation, AccessDenied).

**Built-in error names:** `States.ALL`, `States.Timeout`, `States.HeartbeatTimeout`, `States.TaskFailed`, `States.Permissions`, `States.DataLimitExceeded`, plus service errors (e.g., `Lambda.ServiceException`).

---

### Q13. Compensation (saga pattern)

**Short answer:** Distributed steps can't share one database transaction. On failure, run **compensating actions** in reverse to undo completed steps.

```
 ReserveInventory ─► ChargePayment ─► CreateShipment
        │                 │ fail            │ fail
        │                 ▼                 ▼
        │           RefundPayment ◄── CancelShipment...
        ▼
  ReleaseInventory  (compensations: idempotent, retried, logged)
```
Implement with `Catch` on each step routing to compensation states. Compensations must be idempotent.

---

### Q14. Redrive

Failed Standard executions can be **redriven** from the failed state (not from scratch) after fixing the cause — keeps completed steps' results. Distributed Map supports redrive of failed child executions.

---

## 5. Integration patterns

### Q15. Three service integration patterns

| Pattern | Resource suffix | Behaviour |
|---|---|---|
| **Request Response** | (none) `arn:aws:states:::sqs:sendMessage` | call API, move on immediately |
| **Run a Job (.sync)** | `arn:aws:states:::ecs:runTask.sync` | start a job and **wait until it completes** (ECS, Batch, Glue, CodeBuild, nested Step Functions, Bedrock jobs…) |
| **Wait for Callback (.waitForTaskToken)** | `arn:aws:states:::sqs:sendMessage.waitForTaskToken` | pass a **task token** to an external worker/human; pause until `SendTaskSuccess/Failure(token)` |

Also **AWS SDK integrations** (`arn:aws:states:::aws-sdk:dynamodb:getItem`, thousands of APIs) and **HTTP Task** (call any HTTPS API with EventBridge connection auth).

---

### Q16. Task tokens and the callback pattern (human approval)

```
 Step Functions ── state "WaitForApproval" (.waitForTaskToken, HeartbeatSeconds/TimeoutSeconds)
     │  sends {token, docId, summary} to SQS / Lambda → stores token in DynamoDB → emails reviewer
     ▼  (execution paused — no compute cost)
 Reviewer clicks Approve in app ─► API verifies reviewer identity & permission
     ─► sfn.send_task_success(taskToken=token, output='{"approved": true, "by": "u7"}')
 Step Functions resumes at next state
```
**Security:** the task token is a capability — store it server-side, never expose it to untrusted clients, verify the approver before calling `SendTaskSuccess`.

---

### Q17. Orchestrating asynchronous Textract

Textract async APIs (`StartDocumentAnalysis`) finish later and notify SNS. Pattern:
1. Task: `aws-sdk:textract:startDocumentAnalysis` with `ClientRequestToken` (idempotent) and `NotificationChannel` (SNS).
2. Store `JobId` → task token mapping (or use `.waitForTaskToken` via a Lambda that records the token).
3. SNS → Lambda: on completion, look up token → `SendTaskSuccess`.
4. Fetch results (paginated `GetDocumentAnalysis`) → save to S3.
Alternative: polling loop with `Wait` + `GetDocumentAnalysis` + `Choice` (simpler, more transitions).

---

### Q18. Calling Bedrock / LLMs from Step Functions

Optimised integration `arn:aws:states:::bedrock:invokeModel` (and Converse via SDK integration) — good for **deterministic, bounded** LLM steps (classify, extract, summarise) with Retry on throttling. Store large prompts/outputs in S3.

---

### Q19. Should an LLM agent loop live in Step Functions?

**Short answer:** Usually **not the inner reasoning loop** — agent loops are dynamic, chatty (many transitions = cost, payload limits), and better handled by LangGraph/Strands/AgentCore. **Do** use Step Functions to orchestrate the **business process around the agent**: start job, call agent (AgentCore/Lambda), human approval with task tokens, compensation, notifications. Express workflows can work for short bounded loops.

---

## 6. Parallelism: Parallel, Map, Distributed Map

### Q20. Parallel vs Map

- **Parallel** — a **fixed** set of different branches (e.g., OCR + virus scan + metadata extraction at once); waits for all; output = array of branch outputs; if one branch fails (uncaught), the state fails.
- **Map** — same sub-workflow for **each item** of an array (dynamic count).

---

### Q21. Map concurrency controls

`MaxConcurrency` (inline Map default 0 = as many as possible, practically limited ~40) caps parallel iterations → protect rate-limited downstreams (Bedrock, Textract). Combine with Retry + jitter. `ToleratedFailurePercentage/Count` lets a Map succeed when some items fail.

---

### Q22. Distributed Map

**Short answer:** Map mode for **massive scale**: each item (or batch) runs as a **child workflow execution** (Express or Standard), up to **10,000 parallel** child executions, reading items directly from **S3** (objects list, CSV/JSON/JSONL, manifest) and writing results to S3. Use for processing millions of documents/records.

```json
"ProcessAllDocs": {
  "Type": "Map",
  "ItemReader": { "Resource": "arn:aws:states:::s3:listObjectsV2",
                  "Arguments": { "Bucket": "incoming-docs", "Prefix": "2026-10/" } },
  "ItemBatcher": { "MaxItemsPerBatch": 20 },
  "MaxConcurrency": 200,
  "ToleratedFailurePercentage": 2,
  "ItemProcessor": {
    "ProcessorConfig": { "Mode": "DISTRIBUTED", "ExecutionType": "EXPRESS" },
    "StartAt": "Extract", "States": { "Extract": { "Type": "Task", "...": "..." , "End": true } }
  },
  "ResultWriter": { "Resource": "arn:aws:states:::s3:putObject",
                    "Arguments": { "Bucket": "results", "Prefix": "run-1/" } },
  "End": true
}
```

---

### Q23. Nested workflows — pitfalls

Child state machines (`states:startExecution.sync:2`) improve modularity and reuse, but: more executions to trace, limits on history size, permissions for the parent to start children, harder debugging across executions, and cost multiplication. Use clear naming and pass correlation IDs.

---

## 7. Operations: versions, testing, security, cost

### Q24. Versions and aliases

Publish immutable **versions** of a state machine; **aliases** point to versions and can split traffic (e.g., 90/10) for safe rollout. In-flight executions keep running on the version they started with.

---

### Q25. Testing state machines

**TestState API** — test a single state (with mocked input/permissions) without deploying; Step Functions Local / mocked service integrations for local tests; unit-test Lambda code separately; integration tests in a sandbox account; validate ASL with `aws stepfunctions validate-state-machine-definition`.

---

### Q26. IAM for Step Functions

The state machine's **execution role** must allow each integration (`lambda:InvokeFunction` on specific ARNs, `dynamodb:PutItem`, `ecs:RunTask` + `iam:PassRole` for task roles, `events:PutRule` etc. for `.sync`). Callers need `states:StartExecution`. Callback workers need `states:SendTaskSuccess/Failure/Heartbeat`. Least privilege per state machine.

---

### Q27. Preventing secrets leakage in execution history

Execution history stores **inputs/outputs of every state** (visible to anyone with `states:GetExecutionHistory`). Don't pass secrets or raw PII through state data — pass references; fetch secrets inside tasks (Lambda/HTTP Task with EventBridge connections storing credentials in Secrets Manager); encrypt with customer-managed KMS keys; restrict console/API access; for Express, control logging level (`includeExecutionData`).

---

### Q28. Cost considerations

Standard: **per state transition** — chatty loops (polling every 5 s for an hour) and big Maps get expensive → use callbacks instead of polling, batch items, use Express children for high-volume steps. Express: per request + duration × memory — cheap for short, high-volume. Waiting in Standard is free of compute; waiting in Lambda isn't.

---

### Q29. Observability

Console execution graph + event history (Standard), CloudWatch metrics (`ExecutionsFailed`, `ExecutionsTimedOut`, `ExecutionThrottled`), CloudWatch Logs (Express and optional for Standard), X-Ray tracing, EventBridge events on execution status changes → alerts.

---

## 8. Scenario & debugging questions

### Q30. A workflow failed — how do you troubleshoot?

Open the execution → find the failed state → read **error + cause** → check the input to that state → check the downstream service logs (Lambda logs via request ID) → common causes: `States.Permissions` (execution role), payload > 256 KB (`States.DataLimitExceeded`), JSONata/JSONPath expression error, timeout, throttling without retry. Fix → **redrive** from failure.

---

### Q31. A Standard execution is stuck "Running" for days in a callback state

The task token was never returned: worker crashed, SNS/SQS message lost or went to DLQ, token not stored correctly, approver never acted. Fix: set `TimeoutSeconds` + `HeartbeatSeconds`, alert on long-running executions, DLQ monitoring for the callback queue, admin path to `SendTaskFailure`.

---

### Q32. Resilient Textract pipeline for 300 requests/min

```
 S3 upload ─► EventBridge ─► SQS (buffer) ─► EventBridge Pipe / Lambda starts Standard execution
                                              name = doc hash (dedupe)
 Workflow: register job (DynamoDB conditional) ─► Textract async start (ClientRequestToken)
   ─► wait for SNS callback (token, timeout 30 min) ─► Map pages (MaxConcurrency to fit Bedrock quota)
   ─► LLM extraction with Retry/backoff on throttling ─► validate ─► low confidence → human review token
   ─► save to S3/DynamoDB ─► EventBridge "DocumentProcessed"
 Catch → mark failed + DLQ + alarm; redrive after fixes
```
Talk about quotas (Textract TPS, Bedrock tokens/min), concurrency caps, idempotency, payload references, cost (transitions).

---

### Q33. Users want a synchronous API that runs a 3-step workflow in < 10 s

Express workflow with `StartSyncExecution` via API Gateway direct integration; steps with short timeouts; return result directly. If it may exceed API Gateway timeout, switch to async (202 + polling/websocket).

---

### Q34. A Map over 50,000 items is slow/expensive

Use **Distributed Map** with item batching, Express child workflows, S3 item reader/result writer, sensible `MaxConcurrency`, tolerate a small failure percentage, and redrive failures.

---

### Q35. Step Functions vs Lambda durable functions vs LangGraph vs SQS workers — how do you choose?

| Need | Choose |
|---|---|
| Visual, auditable business workflow; many AWS integrations; human approval; long waits | **Step Functions** |
| Same, but code-first inside one Lambda | **Lambda durable functions** |
| LLM agent reasoning with dynamic tool loops, conversation state, HITL | **LangGraph** (on AgentCore/ECS) |
| Simple high-throughput background jobs | **SQS + workers** |

Often combined: Step Functions orchestrates the process; one step invokes a LangGraph agent.

---

## 9. Cheat sheet

| Concept | One-liner |
|---|---|
| ASL | JSON definition of states & transitions |
| Standard vs Express | 1 yr, exactly-once, per transition, history vs 5 min, at-least-once, cheap high-volume |
| States | Task, Choice, Parallel, Map, Wait, Pass, Succeed, Fail |
| JSONata | `Arguments` / `Output` / `{% %}`; `Assign` variables |
| Payload | 256 KB → pass S3 references |
| Retry/Catch | backoff + jitter for transient; catch to compensation |
| Integration patterns | request-response, `.sync`, `.waitForTaskToken` |
| Task token | capability; verify approver; set heartbeat/timeout |
| Map | MaxConcurrency, tolerated failures |
| Distributed Map | 10k parallel children, S3 reader/writer |
| Idempotent start | execution name = business key |
| Saga | compensating steps in reverse |
| Redrive | resume failed executions from failure point |
| Secrets | never in state data (history is visible) |

## Official references

- https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html
- Standard vs Express: https://docs.aws.amazon.com/step-functions/latest/dg/choosing-workflow-type.html
- JSONata & variables: https://docs.aws.amazon.com/step-functions/latest/dg/transforming-data.html
- Service integration patterns: https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html
- Distributed Map: https://docs.aws.amazon.com/step-functions/latest/dg/state-map-distributed.html
- Error handling: https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html
