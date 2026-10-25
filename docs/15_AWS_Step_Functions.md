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

```flow
pipeline: Document workflow, state by state
StartExecution({docId}) > A Standard workflow starts.
RegisterJob > DynamoDB PutItem with a condition: claims the job once (idempotent).
StartOCR > Textract + `.waitForTaskToken`: the workflow pauses at no cost until Textract's completion event calls SendTaskSuccess.
ExtractFields (Map) > For each page chunk (MaxConcurrency 10): LLM extraction with Retry on throttling (backoff + jitter).
CheckQuality (Choice) > Confidence < 0.8 → HumanReview with a task token; a reviewer approves in the UI.
SaveResults > Store the output.
Succeed > Any error along the way is caught → MarkFailed + notify → Fail.
```

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

```flow
pipeline: What Step Functions takes off your hands
You define states > JSON/YAML (ASL) or the visual designer.
It runs them in order > Branches, loops, parallel work.
It remembers progress > Every step's input/output saved.
It retries and catches errors > Declaratively, per state.
It waits for free > Hours or days for callbacks, without running compute.
```

**When not:** a single short function, very high-frequency trivial event processing (cost), or logic that's simpler as code (consider Lambda durable functions).

---

### Q02. Standard vs Express workflows

```flow
pipeline: Standard or Express?
Long-running, needs exact-once steps and audit history? > Standard: up to 1 year, priced per state transition.
High-volume, short (≤5 min), event processing? > Express: priced by requests + duration; at-least-once (async).
Synchronous API need? > Express synchronous.
Mix > Express child workflows inside a Standard parent.
```

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

```flow
pipeline: The state types
Task > Do work: call a service or Lambda.
Choice > Branch on data.
Parallel / Map > Fixed branches at once / same steps per item.
Wait > Pause for a time or until a timestamp.
Pass / Succeed / Fail > Shape data, end successfully, end with an error.
```

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

```flow
pipeline: The minimal JSONata state machine, running
StartExecution({docId}) > Input available as `$states.input`.
Task: call the service > Arguments built with JSONata from the input.
Assign / Output > Save values as variables; shape the output from `$states.result`.
Next state or End > Execution succeeds with the final output.
```

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

```flow
pipeline: Ways to start an execution
API / SDK > StartExecution from your app.
EventBridge rule or Pipe > On an event (file uploaded, message queued).
API Gateway > HTTP request → execution (Express sync for request/response).
Scheduler > Cron-style schedule.
Parent workflow > Nested execution.
```

---

### Q06. Idempotent workflow starts

**Short answer:** Standard executions use a unique **execution `name`** per state machine (reusing the same name for a running/recent execution is rejected/returns the existing one). Use a business key (`doc-<hash>`) as the name so duplicate events don't start duplicate workflows. Express doesn't dedupe — make steps idempotent.

```flow
sequence: Idempotent start by execution name
actors: Event source, Step Functions
Event source -> Step Functions: StartExecution(name = doc-hash-ab12)
Step Functions --> Event source: started
Event source -> Step Functions: duplicate event: same name
Step Functions --> Event source: same input → returns the existing execution (no second run)
> Standard workflows: names are unique for 90 days; the same name with DIFFERENT input fails with ExecutionAlreadyExists. Express workflows don't deduplicate this way.
```

```python
sfn.start_execution(stateMachineArn=ARN, name=f"doc-{doc_hash}", input=json.dumps({"docId": doc_id}))
# ExecutionAlreadyExists → already started → safe to ignore
```

---

### Q07. Timeouts

`TimeoutSeconds` on Task states (and the whole machine), **`HeartbeatSeconds`** for callback/activity tasks (worker must send heartbeats, otherwise `States.HeartbeatTimeout`). Always set timeouts on callback tasks — otherwise a lost token waits up to a year.

```flow
pipeline: Timeouts at every level
State TimeoutSeconds > A task that hangs fails instead of waiting forever.
HeartbeatSeconds > Callback tasks must check in regularly.
Execution timeout > Whole workflow limit.
Catch States.Timeout > Route to cleanup / alert.
```

---

## 3. Data flow: JSONata, variables, JSONPath

### Q08. JSONPath vs JSONata

**Short answer:** Two query languages for moving/transforming data between states.
- **JSONPath (original):** `InputPath` → `Parameters` → (task) → `ResultSelector` → `ResultPath` → `OutputPath`. Powerful but confusing; limited transformations (intrinsic functions like `States.Format`).
- **JSONata (newer, recommended for new workflows):** fields `Arguments` (what to send) and `Output` (what to pass on) using `{% expression %}`, with rich transformations (math, string, filtering, dates) and `$states.input`, `$states.result`, `$states.context`.

```flow
pipeline: JSONata data flow (the simpler model)
State input > Available as `$states.input`.
Arguments > Build exactly what the task receives with JSONata expressions.
Task runs > The service call.
Output > Shape what goes to the next state from `$states.result` (and save values with `Assign` variables). The older JSONPath model needed five fields for this: InputPath, Parameters, ResultSelector, ResultPath, OutputPath.
```

```
 JSONPath data flow                                        JSONata data flow
 input ─InputPath─► Parameters ─► TASK ─► ResultSelector   input ─► Arguments ─► TASK ─► Output
      ─► ResultPath (merge into input) ─► OutputPath ─►         ($states.input)   ($states.result)
```
Set `"QueryLanguage": "JSONata"` at top level or per state.

---

### Q09. Variables (`Assign`)

**Short answer:** States can store values in **variables** with `Assign`, and later states can read them (`$docId`) — no need to thread everything through each state's output.

```flow
trace: Variables with Assign
state A: Assign {jobId: $states.result.id} > Save a value once.
state B, C … > They don't need to pass jobId along in their outputs.
state D: uses $jobId > Read it directly later in the workflow.
less payload juggling > Than the old ResultPath/OutputPath plumbing.
```

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

```flow
pipeline: Handling big data within the payload limit
Payload limit 256 KB > Per state input/output.
Store large data in S3 > Documents, extracted JSON.
Pass references > Bucket + key in the state.
Distributed Map reads from S3 directly > For large item sets.
```

---

### Q11. Context object

`$states.context` (JSONata) / `$$` (JSONPath): execution ID/name, start time, state name, retry count, task token (`$states.context.Task.Token`), Map item index/value. Use execution name/ID as an idempotency key for downstream calls.

```flow
pipeline: Useful context object fields
Execution id / name > For idempotency keys and logs.
State name + entered time > Tracing.
Task token > `$states.context.Task.Token` for callbacks.
Map item index / value > Inside Map iterations.
```

---

## 4. Error handling

### Q12. `Retry` and `Catch`

**Short answer:** `Retry` re-attempts a failed state for matching errors with backoff; `Catch` routes to a fallback state when retries are exhausted or for non-retryable errors, optionally keeping error info.

```flow
trace: Retry then Catch
Task fails: ThrottlingException > Matches a Retry rule.
retry 1 after 2 s, retry 2 after 4 s, retry 3 after 8 s (+ jitter) > IntervalSeconds, BackoffRate, MaxAttempts.
still failing → **Catch** States.ALL > Retries exhausted.
→ MarkFailed state (error info saved via Assign/Output) > Compensate, alert, or continue on a fallback path.
```

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

```flow
sequence: Saga: compensating when a later step fails
actors: Workflow, Inventory, Payments, Shipping
Workflow -> Inventory: ReserveInventory
Workflow -> Payments: ChargePayment
Workflow -> Shipping: CreateShipment
Shipping --> Workflow: fails
> No global transaction exists, so undo the completed steps in reverse order.
Workflow -> Payments: RefundPayment (compensation)
Workflow -> Inventory: ReleaseInventory (compensation)
> Compensations must be idempotent, retried and logged.
```

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

```flow
pipeline: Redrive after a fix
Execution fails at step 6 of 10 > Steps 1–5 succeeded.
Fix the cause > Code, permissions, quota.
Redrive > Restarts from the failed step with the same input.
Steps 1–5 not repeated > No duplicate side effects from earlier steps (Standard, within the redrive window).
```

---

## 5. Integration patterns

### Q15. Three service integration patterns

```flow
sequence: The three integration patterns
actors: Step Functions, Service
Step Functions -> Service: REQUEST-RESPONSE: start it, move on immediately
Step Functions -> Service: RUN A JOB (.sync): start, wait until it finishes
Service --> Step Functions: job complete (Step Functions polls/listens for you)
Step Functions -> Service: CALLBACK (.waitForTaskToken): send a token, pause
Service --> Step Functions: SendTaskSuccess(token) whenever ready (hours later)
```

| Pattern | Resource suffix | Behaviour |
|---|---|---|
| **Request Response** | (none) `arn:aws:states:::sqs:sendMessage` | call API, move on immediately |
| **Run a Job (.sync)** | `arn:aws:states:::ecs:runTask.sync` | start a job and **wait until it completes** (ECS, Batch, Glue, CodeBuild, nested Step Functions, Bedrock jobs…) |
| **Wait for Callback (.waitForTaskToken)** | `arn:aws:states:::sqs:sendMessage.waitForTaskToken` | pass a **task token** to an external worker/human; pause until `SendTaskSuccess/Failure(token)` |

Also **AWS SDK integrations** (`arn:aws:states:::aws-sdk:dynamodb:getItem`, thousands of APIs) and **HTTP Task** (call any HTTPS API with EventBridge connection auth).

---

### Q16. Task tokens and the callback pattern (human approval)

```flow
sequence: Human approval with a task token
actors: Step Functions, Notifier, Reviewer, Your API
Step Functions -> Notifier: WaitForApproval (.waitForTaskToken) sends {token, docId, summary}
> The execution pauses with no compute cost. Set HeartbeatSeconds/TimeoutSeconds so it can't wait forever.
Notifier -> Notifier: store token in DynamoDB, email reviewer
Reviewer -> Your API: clicks Approve
Your API -> Your API: verify reviewer identity + permission
Your API -> Step Functions: SendTaskSuccess(token, {approved: true, by: "u7"})
Step Functions -> Step Functions: resumes at the next state
```
**Security:** the task token is a capability — store it server-side, never expose it to untrusted clients, verify the approver before calling `SendTaskSuccess`.

---

### Q17. Orchestrating asynchronous Textract

Textract async APIs (`StartDocumentAnalysis`) finish later and notify SNS. Pattern:
```flow
sequence: Waiting for an async Textract job without polling
actors: Step Functions, Lambda, Textract, SNS
Step Functions -> Lambda: task with .waitForTaskToken
Lambda -> Textract: startDocumentAnalysis(ClientRequestToken, NotificationChannel=SNS)
> ClientRequestToken makes retries start the same job, not a new one.
Lambda -> Lambda: store JobId → task token mapping
> The workflow is now paused at no cost.
Textract -> SNS: job complete
SNS -> Lambda: notification (JobId)
Lambda -> Step Functions: look up token → SendTaskSuccess
Step Functions -> Textract: fetch results (paginated GetDocumentAnalysis) → save to S3
> Alternative: a polling loop (Wait + GetDocumentAnalysis + Choice). Simpler, but more state transitions.
```
Alternative: polling loop with `Wait` + `GetDocumentAnalysis` + `Choice` (simpler, more transitions).

---

### Q18. Calling Bedrock / LLMs from Step Functions

Optimised integration `arn:aws:states:::bedrock:invokeModel` (and Converse via SDK integration) — good for **deterministic, bounded** LLM steps (classify, extract, summarise) with Retry on throttling. Store large prompts/outputs in S3.

```flow
sequence: Bedrock call from a workflow
actors: Step Functions, Bedrock
Step Functions -> Bedrock: bedrock:invokeModel (optimised integration)
Bedrock --> Step Functions: ThrottlingException
Step Functions -> Step Functions: Retry with backoff + jitter
Step Functions -> Bedrock: retry
Bedrock --> Step Functions: completion → validate JSON in next state
> Keep large prompts/results in S3; set Map concurrency to fit the model quota.
```

---

### Q19. Should an LLM agent loop live in Step Functions?

**Short answer:** Usually **not the inner reasoning loop** — agent loops are dynamic, chatty (many transitions = cost, payload limits), and better handled by LangGraph/Strands/AgentCore. **Do** use Step Functions to orchestrate the **business process around the agent**: start job, call agent (AgentCore/Lambda), human approval with task tokens, compensation, notifications. Express workflows can work for short bounded loops.

```flow
pipeline: Where an agent loop belongs
Fixed, auditable business process > Step Functions orchestrates.
Open-ended reasoning loop > LangGraph/agent runtime handles it.
Combine > Step Functions calls the agent as one task (or the agent starts workflows as tools).
Why > State machines suit known steps; agents suit unknown steps.
```

---

## 6. Parallelism: Parallel, Map, Distributed Map

### Q20. Parallel vs Map

```flow
pipeline: Parallel vs Map
Parallel > A FIXED set of different branches at once (OCR + virus scan + metadata).
Map > The SAME steps for each item in a list (every page).
Join > Both wait for all branches/items; one failure fails the state unless caught.
Map concurrency > Limit to protect downstream quotas.
```

- **Parallel** — a **fixed** set of different branches (e.g., OCR + virus scan + metadata extraction at once); waits for all; output = array of branch outputs; if one branch fails (uncaught), the state fails.
- **Map** — same sub-workflow for **each item** of an array (dynamic count).

---

### Q21. Map concurrency controls

`MaxConcurrency` (inline Map default 0 = as many as possible, practically limited ~40) caps parallel iterations → protect rate-limited downstreams (Bedrock, Textract). Combine with Retry + jitter. `ToleratedFailurePercentage/Count` lets a Map succeed when some items fail.

```flow
pipeline: Controlling Map concurrency
MaxConcurrency > How many items run at once (0 = as many as possible).
Size to the bottleneck > Bedrock TPM, Textract TPS, DB connections.
Tolerated failure % > Distributed Map can continue despite some failures.
Batch items > ItemBatcher to reduce transitions.
```

---

### Q22. Distributed Map

**Short answer:** Map mode for **massive scale**: each item (or batch) runs as a **child workflow execution** (Express or Standard), up to **10,000 parallel** child executions, reading items directly from **S3** (objects list, CSV/JSON/JSONL, manifest) and writing results to S3. Use for processing millions of documents/records.

```flow
pipeline: Distributed Map over millions of items
ItemReader > Reads an S3 inventory/CSV/JSON list directly.
Child executions > Batches run as separate child workflows, massively parallel.
Concurrency + failure tolerance > Controlled limits.
ResultWriter > Results written back to S3, not into the payload.
```

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

```flow
pipeline: Nested workflow pitfalls
Parent starts child (.sync) > Waits for it.
Child failure > Must be caught and handled in the parent.
Duplicate starts > Use deterministic child names.
Costs + quotas > Transitions add up; Express children for high-volume inner loops.
```

---

## 7. Operations: versions, testing, security, cost

### Q24. Versions and aliases

Publish immutable **versions** of a state machine; **aliases** point to versions and can split traffic (e.g., 90/10) for safe rollout. In-flight executions keep running on the version they started with.

```flow
pipeline: Versions and aliases for safe releases
Publish version > Immutable definition.
Alias "prod" → v3 > Callers use the alias.
Weighted routing > 90% v3 / 10% v4 canary.
Shift or roll back > Running executions keep their version.
```

---

### Q25. Testing state machines

**TestState API** — test a single state (with mocked input/permissions) without deploying; Step Functions Local / mocked service integrations for local tests; unit-test Lambda code separately; integration tests in a sandbox account; validate ASL with `aws stepfunctions validate-state-machine-definition`.

```flow
pipeline: Testing state machines
TestState API > Test one state with mock input (and mocked service results).
Local / mock testing > Paths through Choice states.
Integration test in a sandbox account > Real services.
Validate definitions in CI > Lint ASL; check IAM.
```

---

### Q26. IAM for Step Functions

The state machine's **execution role** must allow each integration (`lambda:InvokeFunction` on specific ARNs, `dynamodb:PutItem`, `ecs:RunTask` + `iam:PassRole` for task roles, `events:PutRule` etc. for `.sync`). Callers need `states:StartExecution`. Callback workers need `states:SendTaskSuccess/Failure/Heartbeat`. Least privilege per state machine.

```flow
pipeline: IAM for a workflow
Execution role > What the state machine can call (specific Lambdas, tables, models).
Who can start it > states:StartExecution on that state machine.
Callback senders > states:SendTaskSuccess for the approval API.
Least privilege > Resource ARNs, no wildcards.
```

---

### Q27. Preventing secrets leakage in execution history

Execution history stores **inputs/outputs of every state** (visible to anyone with `states:GetExecutionHistory`). Don't pass secrets or raw PII through state data — pass references; fetch secrets inside tasks (Lambda/HTTP Task with EventBridge connections storing credentials in Secrets Manager); encrypt with customer-managed KMS keys; restrict console/API access; for Express, control logging level (`includeExecutionData`).

```flow
pipeline: Keeping secrets out of execution history
History records inputs/outputs > Visible in console and logs.
Never pass secrets as data > Tasks fetch secrets themselves.
Pass references > Secret ARNs, S3 keys.
Restrict history access > IAM + log level settings.
```

---

### Q28. Cost considerations

Standard: **per state transition** — chatty loops (polling every 5 s for an hour) and big Maps get expensive → use callbacks instead of polling, batch items, use Express children for high-volume steps. Express: per request + duration × memory — cheap for short, high-volume. Waiting in Standard is free of compute; waiting in Lambda isn't.

```flow
trace: Standard vs Express cost for 1M orders
Standard: 1M × 10 transitions = 10M × $0.025/1k ≈ **$250** > Per state transition.
Express: 1M × 2 s × 64 MB-ish ≈ **tens of dollars** > Per request + duration.
long waits cost nothing on Standard > But are impossible on Express (5 min max).
(illustrative prices) > Pick by duration and volume.
```

---

### Q29. Observability

Console execution graph + event history (Standard), CloudWatch metrics (`ExecutionsFailed`, `ExecutionsTimedOut`, `ExecutionThrottled`), CloudWatch Logs (Express and optional for Standard), X-Ray tracing, EventBridge events on execution status changes → alerts.

```flow
pipeline: Observing workflows
Execution history / graph > Exactly which state failed and why.
CloudWatch metrics > Failed, timed-out, throttled executions.
X-Ray tracing > Across Lambda and services.
Logs (level ERROR/ALL) > Express needs CloudWatch Logs for history.
```

---

## 8. Scenario & debugging questions

### Q30. A workflow failed — how do you troubleshoot?

Open the execution → find the failed state → read **error + cause** → check the input to that state → check the downstream service logs (Lambda logs via request ID) → common causes: `States.Permissions` (execution role), payload > 256 KB (`States.DataLimitExceeded`), JSONata/JSONPath expression error, timeout, throttling without retry. Fix → **redrive** from failure.

```flow
pipeline: Troubleshooting a failed execution
Open the execution graph > Find the red state.
Read the error + cause > Service error, timeout, IAM denial, bad input.
Check that state's input > Data shape wrong?
Fix + redrive > Or re-run with corrected input.
```

---

### Q31. A Standard execution is stuck "Running" for days in a callback state

The task token was never returned: worker crashed, SNS/SQS message lost or went to DLQ, token not stored correctly, approver never acted. Fix: set `TimeoutSeconds` + `HeartbeatSeconds`, alert on long-running executions, DLQ monitoring for the callback queue, admin path to `SendTaskFailure`.

```flow
pipeline: Execution stuck in a callback state
Token delivered? > Did the message/email with the token get sent?
Token stored correctly? > Lookup by job id works?
Callback sent? > Approver API called SendTaskSuccess/Failure?
Prevent > TimeoutSeconds + HeartbeatSeconds so it fails instead of hanging.
```

---

### Q32. Resilient Textract pipeline for 300 requests/min

```flow
pipeline: Resilient Textract pipeline for 300 requests/min
S3 upload → EventBridge > Event for every new document.
SQS buffer > Smooths bursts.
Start execution (name = doc hash) > The same document can't start two executions.
Register job > DynamoDB conditional write.
Textract async start > ClientRequestToken makes the start idempotent.
Wait for callback > Task token; timeout 30 min.
Map over pages > MaxConcurrency sized to the Bedrock quota.
LLM extraction > Retry with backoff on throttling.
Validate > Low confidence → human review token.
Save + publish > S3/DynamoDB, then EventBridge "DocumentProcessed". Catch → mark failed + DLQ + alarm; redrive after the fix.
```
Talk about quotas (Textract TPS, Bedrock tokens/min), concurrency caps, idempotency, payload references, cost (transitions).

---

### Q33. Users want a synchronous API that runs a 3-step workflow in < 10 s

Express workflow with `StartSyncExecution` via API Gateway direct integration; steps with short timeouts; return result directly. If it may exceed API Gateway timeout, switch to async (202 + polling/websocket).

```flow
sequence: Synchronous API with an Express workflow
actors: Client, API Gateway, Express workflow, Services
Client -> API Gateway: POST /quote
API Gateway -> Express workflow: StartSyncExecution
Express workflow -> Services: validate → price → save (each with timeouts)
Express workflow --> API Gateway: output in ~2 s
API Gateway --> Client: 200 + result
> Keep total under API Gateway's integration timeout; anything longer → async with a job id.
```

---

### Q34. A Map over 50,000 items is slow/expensive

Use **Distributed Map** with item batching, Express child workflows, S3 item reader/result writer, sensible `MaxConcurrency`, tolerate a small failure percentage, and redrive failures.

```flow
pipeline: Slow, costly Map over 50,000 items
Use Distributed Map > Child executions, high parallelism.
Batch items > Fewer transitions.
Express child workflows > Cheaper for short per-item work.
Right concurrency > Max speed the downstream allows.
```

---

### Q35. Step Functions vs Lambda durable functions vs LangGraph vs SQS workers — how do you choose?

```flow
pipeline: Choosing an orchestrator
Fixed AWS service workflow, audit, waits > Step Functions.
Code-first durable steps inside Lambda > Lambda durable functions.
Agent reasoning, HITL, LLM state > LangGraph.
Simple background jobs > SQS + workers.
```

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
