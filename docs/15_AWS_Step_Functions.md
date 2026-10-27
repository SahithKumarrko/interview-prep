# AWS Step Functions: Interview Preparation

> **Updated:** 27 October 2026 · **Level:** state machine basics → data flow & error handling → integration patterns & large-scale workflows
> **How to use:** read the *Short answer* first, then *How it works* and the *Example* walkthrough. *Common mistake → fix* shows what goes wrong in real workflows. *Interview answer* is what you can say out loud.

---

## Table of contents

1. [Mental model: a workflow engine with memory](#1-mental-model-a-workflow-engine-with-memory)
2. [Fundamentals](#2-fundamentals) (Q01–Q09)
3. [Data flow: JSONata, variables, JSONPath](#3-data-flow-jsonata-variables-jsonpath) (Q10–Q14)
4. [Error handling](#4-error-handling) (Q15–Q18)
5. [Integration patterns](#5-integration-patterns) (Q19–Q25)
6. [Parallelism: Parallel, Map, Distributed Map](#6-parallelism-parallel-map-distributed-map) (Q26–Q29)
7. [Operations: versions, testing, security, cost](#7-operations-versions-testing-security-cost) (Q30–Q35)
8. [Scenario & debugging questions](#8-scenario--debugging-questions) (Q36–Q42)
9. [Cheat sheet](#9-cheat-sheet)

---

## 1. Mental model: a workflow engine with memory

**The one idea everything else follows from:** a **state machine** is a flowchart that AWS runs for you. You describe the boxes (**states**) and arrows (transitions) in JSON, using the **Amazon States Language (ASL)**. Each time you start the flowchart with some input, Step Functions creates an **execution**, walks through the states one by one, passes data from each state to the next, and **remembers where it is**. If a step fails, it retries or takes the error path you defined. If a step has to wait (for a person, a timer or a long job), the execution simply pauses, for up to a year, without running any compute.

Think of it as a project manager with a checklist. The manager doesn't do the work; they call the right team (Lambda, DynamoDB, ECS, an HTTP API), write down the result, decide what's next, chase failures, and can tell you at any moment exactly which step each job is on.

```flow
pipeline: One execution of a document workflow
stage: 1. Start
StartExecution with {"docId": "d-42"} > Step Functions creates an execution and gives the input to the first state.
stage: 2. Do the steps
RegisterJob: DynamoDB PutItem > A Task state calls DynamoDB directly; no Lambda glue code needed.
StartOCR: wait for a callback > The execution pauses with a task token until the OCR job reports back. No compute is billed while it waits.
ExtractFields: Map over 12 pages > The same steps run for each page, at most 5 at a time, with retries on throttling.
CheckQuality: Choice on confidence > Confidence 0.93 is above 0.8, so the workflow skips human review.
stage: 3. Finish
SaveResults, then Succeed > The execution ends with its output. Every state's input and output stays in the execution history.
```

**Three rules that come straight from this model:**
1. **Steps should be idempotent.** Retries (and Express workflows' at-least-once execution) can run a step again.
2. **Keep state data small.** Each state's input and output is limited to 256 KiB and is stored in the history; put big data in S3 and pass references.
3. **Every wait needs a timeout.** A callback that never arrives would otherwise keep an execution open for up to a year.

---

## 2. Fundamentals

### Q01. What is AWS Step Functions and when should you use it?

**Short answer:** AWS Step Functions is a **serverless orchestration service**: it runs workflows made of steps that call AWS services, Lambda functions or HTTP APIs, and it takes care of order, branching, parallel work, retries, error paths, waiting and progress tracking. Use it when a process has **several steps that must be coordinated reliably** and you want to see exactly what happened in each run.

**How it works:**
1. You define a state machine in ASL (JSON) or draw it in **Workflow Studio**, the visual designer.
2. Something starts an execution: an API call, an EventBridge rule, API Gateway, a schedule, another workflow.
3. Step Functions runs the states, calling services directly through 220+ integrations, and stores progress after each step.
4. You see each execution as a graph with every state's input, output and errors.

**Example — good and poor fits:**

| Good fit | Poor fit |
|---|---|
| Order processing: reserve stock → charge → ship, with compensation on failure | A single short function call |
| Document pipeline: OCR → AI extraction → human review → publish | Very high-frequency trivial event handling where per-transition cost adds up (consider Express or plain Lambda) |
| ETL fan-out over 1 million S3 objects (Distributed Map) | The inner reasoning loop of an AI agent (many dynamic steps) |
| Approval flows that wait days for a person | Logic that's clearer as ordinary code (consider Lambda durable functions) |

**What happens, step by step (order workflow):**
1. Checkout calls `StartExecution` with `{"orderId": "o-881", "amount": 40}`.
2. `ReserveStock` (DynamoDB update) succeeds; `ChargeCard` (Lambda) succeeds.
3. `CreateShipment` fails with a carrier error. The `Catch` sends the workflow to `RefundCard`, then `ReleaseStock`.
4. The console shows the red `CreateShipment` state with the error message, and the two compensation steps in green.

**Common mistake → fix:** writing one large Lambda function that calls five services, retries with `while` loops and sleeps between steps. It's hard to see where it failed, it pays for idle waiting, and it hits the 15-minute limit. Fix: move the coordination into Step Functions and keep each Lambda small.

**Interview answer:** "Step Functions is AWS's serverless workflow orchestrator. I describe states in Amazon States Language and it runs them, calling AWS services directly, handling branching, parallelism, retries, catches and long waits, and keeping a visual history of each execution. I use it for multi-step processes that need reliability and auditability, like order processing, document pipelines, approvals and large fan-outs."

**Follow-ups:**
- *How is it different from a message queue?* A queue moves messages between producers and consumers; Step Functions tracks the state of a whole multi-step process.

---

### Q02. What are a state machine, a state and an execution?

**Short answer:** A **state machine** is the workflow definition: a set of named **states** and the transitions between them. A **state** is one step: do some work (Task), make a decision (Choice), wait, run things in parallel, and so on. An **execution** is one run of the state machine with a specific input; you can have thousands of executions of the same state machine running at once, each with its own data and progress.

**How it works:**
- A state machine has a `StartAt` (the first state's name) and a `States` object.
- Each state has a `Type` and either `Next` (the following state) or `End: true`.
- Starting an execution gives it a name (unique per state machine), an input, and an ARN. Its status moves from `RUNNING` to `SUCCEEDED`, `FAILED`, `TIMED_OUT` or `ABORTED`.
- Each step an execution completes is a **state transition**, which is how Standard workflows are billed.

**Example:**
```json
{
  "StartAt": "Validate",
  "States": {
    "Validate": { "Type": "Pass", "Next": "Approve?" },
    "Approve?": { "Type": "Choice",
                  "Choices": [{ "Variable": "$.amount", "NumericLessThan": 100, "Next": "AutoApprove" }],
                  "Default": "ManualReview" },
    "AutoApprove": { "Type": "Succeed" },
    "ManualReview": { "Type": "Fail", "Error": "NeedsReview" }
  }
}
```

**What happens, step by step (two executions of the same machine):**
1. Execution `exp-1` starts with `{"amount": 40}`: `Validate` → `Approve?` (40 < 100) → `AutoApprove` → status `SUCCEEDED`.
2. Execution `exp-2` starts with `{"amount": 250}`: `Validate` → `Approve?` (250 is not below 100) → `Default` → `ManualReview` → status `FAILED` with error `NeedsReview`.
3. Both executions used the same definition but kept separate data and separate histories.

**Common mistake → fix:** treating a state machine like a long-running server that "holds" data between runs. Executions are independent; nothing is shared unless you store it somewhere (DynamoDB, S3). Fix: design each execution to carry or fetch everything it needs.

**Interview answer:** "The state machine is the definition: named states and transitions written in ASL. A state is one step, like a Task, Choice, Wait or Map. An execution is one run of that definition with its own input, name, status and history, and many executions can run concurrently. Each completed step is a state transition, which is how Standard workflows are billed."

**Follow-ups:**
- *Can you change a state machine while executions are running?* Yes; running executions keep the definition they started with. Use versions and aliases to control rollouts (see Q30).

---

### Q03. What is Amazon States Language, and what does a minimal workflow look like?

**Short answer:** **Amazon States Language (ASL)** is the JSON-based language for defining Step Functions state machines: `StartAt`, a `States` map, and for each state its `Type`, what it does, and where to go next. You can write it by hand, generate it with the CDK or SAM, or draw it in Workflow Studio. New workflows should set `"QueryLanguage": "JSONata"` to use the simpler, more powerful data-transformation syntax.

**How it works:**
- `Comment` (optional), `QueryLanguage` (`JSONPath` by default, or `JSONata`), `StartAt`, `States`.
- Task states name a `Resource` (what to call) and `Arguments` (what to send).
- `{% ... %}` marks a JSONata expression; `$states.input` is the state's input and `$states.result` is the task's result.

**Example — classify a document, then branch:**
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
      "Retry": [{ "ErrorEquals": ["Lambda.TooManyRequestsException", "Lambda.ServiceException"],
                  "IntervalSeconds": 2, "BackoffRate": 2, "MaxAttempts": 4, "JitterStrategy": "FULL" }],
      "Next": "IsInvoice"
    },
    "IsInvoice": {
      "Type": "Choice",
      "Choices": [{ "Condition": "{% $states.input.type = 'invoice' %}", "Next": "ProcessInvoice" }],
      "Default": "Done"
    },
    "ProcessInvoice": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Arguments": { "FunctionName": "process-invoice", "Payload": "{% $states.input %}" },
      "End": true
    },
    "Done": { "Type": "Succeed" }
  }
}
```

**What happens, step by step (input `{"docId": "d-42"}`):**
1. `Classify` builds the payload `{"docId": "d-42"}` and invokes `classify-doc`. The Lambda integration returns `{"StatusCode": 200, "Payload": {"docId": "d-42", "type": "invoice"}, ...}`.
2. `Output` keeps only `Payload`, so the next state's input is `{"docId": "d-42", "type": "invoice"}`.
3. `IsInvoice` evaluates `type = 'invoice'` → true → `ProcessInvoice`.
4. `ProcessInvoice` receives the whole input and ends the execution with the function's result.
5. If `classify-doc` were throttled, the retrier would wait about 2, 4, 8 seconds (randomised by jitter) before giving up.

**Common mistake → fix:** forgetting `Output` on a Lambda task, so the next state receives the full integration envelope (`StatusCode`, `ExecutedVersion`, `Payload`) and the Choice condition `$states.input.type` is undefined. Fix: select `$states.result.Payload` in `Output`.

**Interview answer:** "ASL is the JSON language for state machines: StartAt, a map of named states, and for each state its type, what it calls and where it goes next. Task states name a resource such as `arn:aws:states:::lambda:invoke` and pass Arguments; with JSONata I write expressions in `{% %}` and shape results with Output. I keep definitions in source control and deploy them with CDK, SAM or Terraform."

**Follow-ups:**
- *What's the maximum definition size?* 1 MB.

---

### Q04. What are the state types?

**Short answer:** There are eight state types. **Task** does work (calls a service). **Choice** branches on data. **Parallel** runs a fixed set of branches at the same time. **Map** runs the same steps for each item in a list. **Wait** pauses for a time or until a timestamp. **Pass** passes or reshapes data without doing work. **Succeed** and **Fail** end the execution.

**How it works:**

| State | What it does | Typical use |
|---|---|---|
| Task | Calls Lambda, an AWS service, an HTTP API or an activity worker | Charge a card, run OCR, write to DynamoDB |
| Choice | Picks the next state by evaluating conditions; has a `Default` | Route invoices vs receipts |
| Parallel | Runs each branch concurrently, waits for all, outputs an array | Virus scan and thumbnail at the same time |
| Map | Runs an item processor for each element, inline or distributed | Process each page or each S3 object |
| Wait | Pauses for `Seconds` or until `Timestamp` | Retry an external check tomorrow at 09:00 |
| Pass | Outputs its input or a fixed/transformed value | Shape data, stub a step while building |
| Succeed | Ends successfully | Normal end of a branch |
| Fail | Ends with an `Error` and `Cause` | Business rule failure |

**Example:**
```json
"WaitUntilTomorrow": { "Type": "Wait", "Timestamp": "{% $states.input.retryAt %}", "Next": "CheckStatus" },
"Reject":           { "Type": "Fail", "Error": "InvalidDocument", "Cause": "Missing signature" }
```

**What happens, step by step:** an execution reaching `WaitUntilTomorrow` with `{"retryAt": "2026-10-28T09:00:00Z"}` pauses with no compute running; at 09:00 it moves to `CheckStatus`. An execution reaching `Reject` ends with status `FAILED`, error `InvalidDocument`, cause `Missing signature`, which a parent workflow or alarm can act on.

**Common mistake → fix:** a Choice state with no `Default` and data that matches no rule. The execution fails with `States.NoChoiceMatched`. Fix: always add a `Default` that goes to a sensible fallback or an explicit Fail.

**Interview answer:** "Task does work, Choice branches, Parallel runs fixed branches concurrently, Map iterates over items, Wait pauses for a duration or until a timestamp, Pass reshapes data, and Succeed and Fail end the execution. I always give Choice states a Default and use Fail states with clear error names so callers and alarms can react."

**Follow-ups:**
- *Which states can have Retry and Catch?* Task, Parallel and Map.

---

### Q05. What can a Task state call?

**Short answer:** A Task state can call five kinds of things: a **Lambda function**; an **optimised integration** with an AWS service (DynamoDB, SQS, SNS, ECS, Glue, Bedrock and others) that has special support such as `.sync`; an **AWS SDK integration** that can call almost any AWS API (`arn:aws:states:::aws-sdk:service:action`); an **HTTP Task** that calls any HTTPS API; or an **activity**, where your own worker polls for work. Calling services directly removes a lot of Lambda "glue" code.

**How it works:**

| Kind | Resource ARN example | Notes |
|---|---|---|
| Lambda | `arn:aws:states:::lambda:invoke` | Result has `Payload`, `StatusCode` |
| Optimised integration | `arn:aws:states:::dynamodb:putItem`, `arn:aws:states:::ecs:runTask.sync`, `arn:aws:states:::bedrock:invokeModel` | Supports `.sync` / `.waitForTaskToken` where available |
| AWS SDK integration | `arn:aws:states:::aws-sdk:s3:copyObject` | Parameters follow the service API; errors are named like `S3.NoSuchKey` |
| HTTP Task | `arn:aws:states:::http:invoke` | Auth via an EventBridge connection (see Q22) |
| Activity | `arn:aws:states:eu-west-1:123456789012:activity:review` | Worker polls with `GetActivityTask` (see Q21) |

**Example — write to DynamoDB without Lambda:**
```json
"RegisterJob": {
  "Type": "Task",
  "Resource": "arn:aws:states:::dynamodb:putItem",
  "Arguments": {
    "TableName": "jobs",
    "Item": { "pk": { "S": "{% $states.input.docId %}" }, "status": { "S": "RECEIVED" } },
    "ConditionExpression": "attribute_not_exists(pk)"
  },
  "Next": "StartOCR"
}
```

**What happens, step by step:** Step Functions signs and sends a `PutItem` call using the state machine's execution role. For `docId = "d-42"`, the first execution writes the item. If a duplicate execution reaches this state for the same document, DynamoDB rejects the condition and the task fails with `DynamoDB.ConditionalCheckFailedException`, which a `Catch` can route to "already registered".

**Common mistake → fix:** adding a Lambda function whose only job is `table.put_item(...)`. You pay for Lambda, maintain code and add a cold start for nothing. Fix: use the direct integration; keep Lambda for real business logic.

**Interview answer:** "A Task can invoke Lambda, use an optimised service integration like DynamoDB, SQS, ECS or Bedrock, call almost any AWS API through the SDK integration, call external HTTPS APIs with the HTTP Task, or hand work to an activity worker. I call services directly whenever there's no real logic, which removes glue Lambdas and their failure modes."

**Follow-ups:**
- *What permissions does a Task use?* The state machine's execution role, which must allow each action on each resource.

---

### Q06. Standard vs Express workflows: what's the difference and how do you choose?

**Short answer:** **Standard** workflows run for up to **1 year**, execute each step **exactly once** (unless you add Retry), keep a full execution history for 90 days, support every integration pattern, and are billed **per state transition**. **Express** workflows run for up to **5 minutes**, are **at-least-once** (asynchronous) or **at-most-once** (synchronous), keep history only in CloudWatch Logs, don't support `.sync` or callbacks, and are billed **per request and duration**, which is much cheaper for high-volume short work. The type can't be changed after creation.

**How it works:**

| | Standard | Express |
|---|---|---|
| Max duration | 1 year | 5 minutes |
| Execution semantics | Exactly-once | Async: at-least-once · Sync: at-most-once |
| Pricing | Per state transition | Per execution + duration + memory |
| History | In Step Functions for 90 days (console, API) | CloudWatch Logs only (enable logging) |
| `.sync` and `.waitForTaskToken` | Yes | No |
| Distributed Map, activities, redrive | Yes | No |
| Start rate (default) | Lower, with token-bucket limits | Much higher (thousands per second) |

**How to choose:** long, auditable, human-in-the-loop, or non-idempotent steps (payments) → Standard. High-volume, short, idempotent event processing or a synchronous API backend → Express. Often you combine them: a Standard parent with Express children for the high-volume inner work.

**Example (illustrative prices):** processing 1 million IoT messages per day, each 4 short steps, ~200 ms total.
1. Standard: about 5 transitions each → 5 million transitions per day. At an illustrative $0.025 per 1,000 transitions that's about **$125/day**.
2. Express: 1 million executions × 0.2 s at the minimum memory band → a few dollars per day (illustrative).

**What happens, step by step (Express async at-least-once):** a message triggers an execution; a rare internal failure causes the same execution to run again. If a step does `INSERT` without a key, you get two rows. With `PutItem` on a deterministic key, the second run simply overwrites with the same data. That's why Express steps must be idempotent.

**Common mistake → fix:** choosing Express for a workflow that waits for a human approval. Express can't wait more than 5 minutes and doesn't support task tokens. Fix: Standard for the approval process; Express only for short automated sub-steps.

**Interview answer:** "Standard is for long-running, auditable workflows: up to a year, exactly-once steps, full history, all integration patterns, billed per transition. Express is for high-volume, short work: up to five minutes, at-least-once when asynchronous and at-most-once when synchronous, logs in CloudWatch, billed by executions and duration, and no .sync or callbacks. I often nest Express children inside a Standard parent, and I make Express steps idempotent."

**Follow-ups:**
- *What is a synchronous Express workflow?* Started with `StartSyncExecution`; the caller waits for the result, which suits API backends (see Q39).

---

### Q07. How do you start an execution?

**Short answer:** Call the **`StartExecution`** API (or **`StartSyncExecution`** for a synchronous Express workflow) from code, the CLI, or another AWS service. Common starters are **EventBridge rules** (e.g. "object uploaded to S3"), **EventBridge Scheduler** (cron-style schedules), **EventBridge Pipes** (from SQS, Kinesis, DynamoDB Streams), **API Gateway** direct integrations, and **another state machine** (nested workflows).

**How it works:** every starter needs `states:StartExecution` on the state machine (or alias). You pass an input JSON (up to 256 KiB) and optionally a **name**, which is unique per state machine and can make starts idempotent (see Q08).

**Example:**
```python
import json, boto3
sfn = boto3.client("stepfunctions")
resp = sfn.start_execution(
    stateMachineArn="arn:aws:states:eu-west-1:123456789012:stateMachine:process-doc:prod",
    name="doc-d42-v1",
    input=json.dumps({"docId": "d-42", "bucket": "incoming", "key": "2026/10/d-42.pdf"}))
print(resp["executionArn"])
```

**What happens, step by step:**
1. The call targets the `prod` **alias**, so Step Functions picks the version that alias points to.
2. It creates execution `doc-d42-v1` and returns its ARN immediately (Standard and async Express don't wait for completion).
3. Your code can check status later with `DescribeExecution`, or react to an EventBridge "Step Functions Execution Status Change" event.

| Starter | When to use |
|---|---|
| SDK / CLI | Application code starts a process |
| EventBridge rule | React to an AWS or custom event |
| EventBridge Scheduler | Run at fixed times |
| EventBridge Pipes | Consume a queue or stream, with filtering and enrichment |
| API Gateway | HTTP endpoint that starts a workflow (Express sync for request/response) |
| Parent workflow | `states:startExecution.sync:2` to run a child and wait |

**Common mistake → fix:** starting an execution from inside a Lambda that S3 invokes directly, without a deterministic name. Duplicate S3 events start duplicate workflows. Fix: derive the execution name from the object key and version (or a content hash).

**Interview answer:** "Executions start through StartExecution or StartSyncExecution, called from code, API Gateway, EventBridge rules, Scheduler, Pipes or a parent workflow. I invoke an alias rather than a bare state machine so deployments are controlled, and I give executions deterministic names derived from a business key so duplicate events don't start duplicate workflows."

**Follow-ups:**
- *How do you get the result of an asynchronous execution?* Poll `DescribeExecution`, subscribe to the status-change event in EventBridge, or have the workflow's last step notify you.

---

### Q08. How do you make workflow starts idempotent?

**Short answer:** For **Standard** workflows, give each execution a **name derived from a business key** (e.g. `doc-<hash>`). Execution names are unique per state machine: starting again with the **same name and same input while it's running** returns the existing execution instead of starting a second one, and other reuses fail with `ExecutionAlreadyExists` (names become reusable only after the 90-day history retention). **Express** workflows don't deduplicate by name, so their steps must be idempotent.

**How it works:**
1. Producer computes a stable key: `doc-` + SHA-256 of bucket/key/version.
2. `StartExecution(name=key, input=...)`.
3. Duplicate event while running, same input → same execution ARN returned (idempotent).
4. Duplicate event with different input, or after the first finished → `ExecutionAlreadyExists`; treat as "already handled".

**Example:**
```python
import hashlib, json, boto3
from botocore.exceptions import ClientError
sfn = boto3.client("stepfunctions")

def start_once(bucket, key, version):
    name = "doc-" + hashlib.sha256(f"{bucket}/{key}/{version}".encode()).hexdigest()[:40]
    try:
        return sfn.start_execution(stateMachineArn=ARN, name=name,
                                   input=json.dumps({"bucket": bucket, "key": key}))["executionArn"]
    except ClientError as e:
        if e.response["Error"]["Code"] == "ExecutionAlreadyExists":
            return None          # already started: safe to ignore
        raise
```

```flow
sequence: The same upload event delivered twice
actors: Event handler, Step Functions
Event handler -> Step Functions: StartExecution(name = doc-9f2c…, input A)
Step Functions --> Event handler: started, execution ARN e-1
Event handler -> Step Functions: duplicate event, StartExecution(name = doc-9f2c…, input A)
Step Functions --> Event handler: still running with the same input, so ARN e-1 is returned again
Event handler -> Step Functions: a day later, same name again
Step Functions --> Event handler: ExecutionAlreadyExists, because e-1 has finished; the handler ignores it
> Only one workflow ever runs for this file, because the name is derived from the file's identity.
```

**What happens, step by step:** the first event starts `e-1`. A duplicate a few seconds later gets the same `e-1` back. A redelivery a day later gets `ExecutionAlreadyExists`, which the code treats as success. No second OCR job, no second invoice.

**Common mistake → fix:** using `uuid4()` as the execution name "to avoid collisions". Every duplicate event gets a new name and starts a new workflow. Fix: derive the name from the business identity.

**Interview answer:** "For Standard workflows I use the execution name as an idempotency key, derived from the business entity, like a document hash. A duplicate start with the same name and input while it's running returns the existing execution; otherwise it fails with ExecutionAlreadyExists, which I treat as already handled. Express doesn't deduplicate, so there I make each step idempotent, for example with conditional writes."

**Follow-ups:**
- *What's the limit on execution names?* 80 characters, no spaces or special characters like `:` or `/`, which is why a truncated hash is common.

---

### Q09. How do timeouts and heartbeats work?

**Short answer:** `TimeoutSeconds` on a Task limits how long that step may run; `TimeoutSeconds` at the top level limits the whole execution. **`HeartbeatSeconds`** on callback or activity tasks requires the worker to call `SendTaskHeartbeat` at least that often, so a dead worker is detected quickly. Without timeouts, a Standard task that never gets a response can wait for up to a **year**. Timeouts raise `States.Timeout` (or `States.HeartbeatTimeout`), which you can retry or catch.

**How it works:**
- Task `TimeoutSeconds`: measured from when the task starts.
- `HeartbeatSeconds` must be less than `TimeoutSeconds`; each heartbeat resets its clock.
- Top-level `TimeoutSeconds`: the execution fails with `States.Timeout` when exceeded.
- In JSONata states you can compute timeouts: `"TimeoutSeconds": "{% $timeout %}"`.

**Example:**
```json
"WaitForReview": {
  "Type": "Task",
  "Resource": "arn:aws:states:::sqs:sendMessage.waitForTaskToken",
  "Arguments": { "QueueUrl": "https://sqs.eu-west-1.amazonaws.com/123456789012/reviews",
                 "MessageBody": { "token": "{% $states.context.Task.Token %}", "docId": "{% $docId %}" } },
  "TimeoutSeconds": 172800,
  "HeartbeatSeconds": 3600,
  "Catch": [{ "ErrorEquals": ["States.Timeout", "States.HeartbeatTimeout"], "Next": "EscalateReview" }],
  "Next": "Publish"
}
```

**What happens, step by step:**
1. The task sends the token to the `reviews` queue and pauses.
2. The review service picks it up and sends a heartbeat every 30 minutes while the reviewer works.
3. If the review service crashes, no heartbeat arrives within 3,600 s → `States.HeartbeatTimeout` after about an hour, and the workflow goes to `EscalateReview`.
4. If heartbeats continue but nobody decides within 172,800 s (2 days) → `States.Timeout` → `EscalateReview`.

**Common mistake → fix:** a `.waitForTaskToken` task with no timeout. A lost message means the execution stays `RUNNING` for a year, counting toward open-execution limits and confusing dashboards. Fix: always set `TimeoutSeconds` (and `HeartbeatSeconds` for long work) and catch the timeout.

**Interview answer:** "TimeoutSeconds bounds a task or the whole execution; HeartbeatSeconds makes long-running callback or activity workers prove they're alive with SendTaskHeartbeat. Both raise States.Timeout-type errors that I catch to escalate or compensate. Every callback task gets a timeout, otherwise a lost token waits up to a year."

**Follow-ups:**
- *Does `States.TaskFailed` catch timeouts?* No; it matches every error except `States.Timeout`. Use `States.Timeout` explicitly or `States.ALL`.

---
## 3. Data flow: JSONata, variables, JSONPath

### Q10. How does data move between states, and what is JSONata vs JSONPath?

**Short answer:** Each state receives an **input** (JSON), does its work, and produces an **output** that becomes the next state's input. Step Functions has two languages for shaping that data. **JSONPath** is the original: five fields (`InputPath`, `Parameters`, `ResultSelector`, `ResultPath`, `OutputPath`) that each cut or merge JSON in a fixed order. **JSONata** is the newer, recommended language: you write expressions in `{% ... %}` and use just two fields, **`Arguments`** (what to send to the task) and **`Output`** (what to pass on). You choose it with `"QueryLanguage": "JSONata"`, at the top of the state machine or per state; if omitted, the default is JSONPath.

**How it works:**
- In JSONata states, `$states.input` is the original state input, `$states.result` is the task's raw result, `$states.errorOutput` is the error (inside a `Catch` only), and `$states.context` is the context object.
- `Output` and `Assign` are evaluated **in parallel** from the same values, so assigning a variable does not change `Output` (see Q11).
- JSONata needs no `.$` suffixes on keys and no separate `Path` fields (`TimeoutSecondsPath` becomes `"TimeoutSeconds": "{% $t %}"`).
- Step Functions implements JSONata 2.0.6 (everything except `$eval`; use `$parse`) and adds `$partition`, `$range`, `$hash`, `$random`, `$uuid`, `$parse`. These replace the JSONPath-only intrinsic functions like `States.ArrayPartition`.
- Runtime failures in an expression raise `States.QueryEvaluationError`, which you can catch. Expressions have a 1-second evaluation limit.

**Example — the same Lambda call in both languages:**
```json
// JSONPath
"Score": { "Type": "Task", "Resource": "arn:aws:states:::lambda:invoke",
  "Parameters": { "FunctionName": "score", "Payload": { "docId.$": "$.docId" } },
  "ResultSelector": { "score.$": "$.Payload.score" },
  "ResultPath": "$.result", "OutputPath": "$", "Next": "Decide" }

// JSONata
"Score": { "Type": "Task", "Resource": "arn:aws:states:::lambda:invoke",
  "Arguments": { "FunctionName": "score", "Payload": { "docId": "{% $states.input.docId %}" } },
  "Output": "{% $merge([$states.input, { 'result': { 'score': $states.result.Payload.score } }]) %}",
  "Next": "Decide" }
```

```flow
pipeline: Data flow of the JSONata Score state with input {"docId": "d-42"}
stage: 1. Before the call
State input is {"docId": "d-42"} > Available everywhere in the state as $states.input.
Arguments builds {"FunctionName": "score", "Payload": {"docId": "d-42"}} > The JSONata expression picks docId from the input.
stage: 2. After the call
Lambda returns {"Payload": {"score": 0.93}, "StatusCode": 200} > This raw result is available as $states.result.
Output merges the input with the score > The next state receives {"docId": "d-42", "result": {"score": 0.93}}.
```

**What happens, step by step:** `Arguments` renders `{"docId": "d-42"}` for the Lambda payload; the function returns `{"score": 0.93}`; `Output` merges the original input with that score; the `Decide` state can then test `$states.input.result.score > 0.8`. The JSONPath version reaches the same result using `ResultSelector` to pick the score and `ResultPath` to merge it into the input.

**Common mistake → fix:** mixing the two languages in one state, e.g. putting `ResultPath` in a JSONata state. Path-based fields are invalid in JSONata states and `Arguments`/`Output` are invalid in JSONPath states, so the definition fails validation. Fix: set `QueryLanguage` consistently per state; you can migrate one state at a time.

**Interview answer:** "JSONPath is the original model with five fields applied in a fixed order: InputPath, Parameters, ResultSelector, ResultPath, OutputPath. JSONata, which I use for new workflows, replaces them with Arguments for the task input and Output for the next state's input, using expressions in curly-percent braces over $states.input and $states.result. It supports real transformations like filtering and arithmetic, works with variables, and can be adopted per state."

**Follow-ups:**
- *What's the default query language?* JSONPath, unless the top-level `QueryLanguage` says JSONata.
- *Can I use variables with JSONPath?* Yes (see Q11), except in `ResultPath`.

---

### Q11. What are workflow variables (`Assign`), and how do they differ from state output?

**Short answer:** **Output** only flows to the **very next** state. **Variables** store a value once with the `Assign` field and make it readable in **any later state** (`$docId`), so you don't have to thread data through states that don't need it. Variables are scoped to the workflow, evaluated in a safe order, and limited in size.

**How it works:**
- `Assign` is available on Pass, Task, Map, Parallel, Choice and Wait states, in a Choice rule, and inside a `Catch`.
- **Evaluation order:** all expressions are evaluated first, using the values as they were **on state entry**, and only then assigned. New values are visible starting with the **next** state. With `$x=3, $a=6`, `Assign {"x": "{% $a %}", "nextX": "{% $x %}"}` leaves `$x=6, $nextX=3`.
- **Scope:** states inside a Parallel branch or Map iteration can **read** outer variables, but their own assignments live in an inner scope and vanish when the state finishes (use `Output` to pass data out). An inner scope can't reuse an outer variable's name. Distributed Map states can't read outer variables at present.
- **Limits:** a single variable up to 256 KiB, the total in one `Assign` up to 256 KiB, and all variables in an execution up to 10 MiB. You can't assign to part of a variable (`"x.y"` is invalid).
- Variable names follow Unicode identifier rules, max 80 characters.

**Example:**
```json
"RegisterJob": {
  "Type": "Task", "Resource": "arn:aws:states:::dynamodb:putItem",
  "Arguments": { "TableName": "jobs", "Item": { "pk": { "S": "{% $states.input.docId %}" } } },
  "Assign": { "docId": "{% $states.input.docId %}", "startedAt": "{% $now() %}" },
  "Output": "{% $states.input %}",
  "Next": "StartOCR"
},
"Notify": {
  "Type": "Task", "Resource": "arn:aws:states:::sns:publish",
  "Arguments": { "TopicArn": "arn:aws:sns:eu-west-1:123456789012:done",
                 "Message": "{% 'Document ' & $docId & ' started at ' & $startedAt %}" },
  "End": true
}
```

**What happens, step by step (input `{"docId": "d-42", "pages": 12}`):**
1. `RegisterJob` writes the DynamoDB item, then assigns `$docId = "d-42"` and `$startedAt = "2026-10-27T09:00:00Z"`.
2. Its `Output` is the original input; `StartOCR`, `ExtractFields` and `CheckQuality` run and don't mention `docId` at all.
3. Seven states later, `Notify` builds `"Document d-42 started at 2026-10-27T09:00:00Z"` from the variables, even though none of the intermediate outputs contained them.

**Common mistake → fix:** assigning in a Parallel branch and reading it after the Parallel finishes. Inner variables go out of scope, so `$branchResult` is undefined and the next state fails. Fix: return the value in the branch's `Output`, then read it from the Parallel state's result array (and `Assign` it in the Parallel state itself).

**Interview answer:** "Output goes only to the next state; Assign stores a value in a workflow variable I can read in any later state. All Assign expressions are evaluated with values from state entry, then assigned together, and new values appear from the next state. Parallel and Map have their own inner scope that can read outer variables but their assignments disappear when they finish, and variables are capped at 256 KiB each and 10 MiB per execution."

**Follow-ups:**
- *Do variables help with the 256 KiB payload limit?* Partly: a variable lets you skip passing big data through every state's output, but each variable is still limited to 256 KiB, so large data belongs in S3.

---

### Q12. What is the payload size limit, and how do you handle big data?

**Short answer:** The input or output of a task, state or execution can be at most **256 KiB** (as a UTF-8 string), for both Standard and Express. Exceeding it fails the state with **`States.DataLimitExceeded`**. For anything larger, store the data in **S3** (or DynamoDB) and pass a **reference** (bucket and key) through the workflow. Distributed Map can read items straight from S3 and write results back to S3.

**How it works:**
- The limit applies to what a state **produces** and what it **receives**, including the result of an SDK or Lambda call.
- `States.DataLimitExceeded` is special: `States.ALL` does **not** catch it; you must list it explicitly in `Catch` or `Retry`.
- The execution **history** is capped at 25,000 events for Standard, which is a separate limit (see Q42).

**Example:**
```json
"ExtractText": {
  "Type": "Task", "Resource": "arn:aws:states:::lambda:invoke",
  "Arguments": { "FunctionName": "extract", "Payload": { "bucket": "work", "key": "{% 'in/' & $docId & '.pdf' %}" } },
  "Output": "{% { 'docId': $docId, 'textKey': $states.result.Payload.textKey } %}",
  "Next": "Summarise"
}
```
The Lambda writes the 4 MB of extracted text to `s3://work/text/d-42.txt` and returns only `{"textKey": "text/d-42.txt"}`.

**What happens, step by step:**
1. Without the pattern, the extractor returns 4 MB of text. The state's output exceeds 256 KiB, so the execution fails with `States.DataLimitExceeded`.
2. With the pattern, the output is `{"docId": "d-42", "textKey": "text/d-42.txt"}`, about 60 bytes.
3. `Summarise` receives only the key and reads the object itself.

**Common mistake → fix:** a Map over 5,000 items with each iteration returning 100 KB; the combined result array is 500 MB. Fix: use a Distributed Map with a `ResultWriter` that writes results to S3, or have each iteration write its own output and return only a key.

**Interview answer:** "State inputs and outputs are limited to 256 KiB. For large data I store it in S3 and pass references like a bucket and key through the workflow; Lambda and tasks read and write the objects. Exceeding the limit raises States.DataLimitExceeded, which States.ALL doesn't catch, so I either avoid it by design or list it explicitly. For big fan-outs I use Distributed Map with S3 readers and writers."

**Follow-ups:**
- *Is the limit different for Express?* No, 256 KiB there too.

---

### Q13. What is the context object?

**Short answer:** The **context object** is read-only information Step Functions supplies about the current execution: the execution ID, name and start time, the state machine, the current state's name and entry time, retry count, the **task token** for callback tasks, and Map item details. In JSONata you read it as `$states.context`; in JSONPath as `$$`.

**How it works:**
- `$states.context.Execution.Id` / `.Name` / `.StartTime` / `.Input`
- `$states.context.State.Name` / `.EnteredTime` / `.RetryCount`
- `$states.context.Task.Token` inside `.waitForTaskToken` tasks
- `$states.context.Map.Item.Index` / `.Value` inside Map iterations
- The execution **name** is an excellent idempotency key for downstream calls, because retries of one execution share it.

**Example:**
```json
"ChargeCard": {
  "Type": "Task", "Resource": "arn:aws:states:::lambda:invoke",
  "Arguments": { "FunctionName": "charge",
    "Payload": { "orderId": "{% $states.input.orderId %}",
                 "idempotencyKey": "{% $states.context.Execution.Name & ':charge' %}" } },
  "Retry": [{ "ErrorEquals": ["States.Timeout"], "MaxAttempts": 2 }],
  "Next": "Ship"
}
```

**What happens, step by step (execution name `order-o881`):**
1. First attempt sends `idempotencyKey = "order-o881:charge"`; the charge function creates a payment and stores the key.
2. The call times out on the Step Functions side after the payment actually succeeded.
3. The retry sends the **same** key `order-o881:charge`; the function finds it and returns the stored payment instead of charging twice.

**Common mistake → fix:** using `$uuid()` for the idempotency key inside the retried state. Each attempt re-evaluates it and gets a new value, so retries aren't deduplicated. Fix: derive the key from stable values like the execution name, or `Assign` it once in an earlier state.

**Interview answer:** "The context object exposes execution metadata, like execution ID and name, state name and retry count, the task token for callbacks, and Map item index and value. I read it with $states.context in JSONata or $$ in JSONPath. I use the execution name as part of idempotency keys so retried calls don't repeat side effects."

**Follow-ups:**
- *How do I get the task token?* `$states.context.Task.Token`, inside a task whose Resource ends with `.waitForTaskToken`.

---

### Q14. How does the Choice state branch?

**Short answer:** A **Choice** state evaluates a list of rules in order and moves to the `Next` state of the **first rule that is true**; if none match, it goes to `Default`. In JSONata states each rule has a `Condition` expression (`{% $states.input.amount > 100 %}`). In JSONPath states each rule compares a `Variable` using operators like `NumericLessThan`, `StringEquals`, `BooleanEquals`, combined with `And`, `Or`, `Not`.

**How it works:**
- Rules are checked top to bottom; order matters when conditions overlap.
- A missing `Default` with no matching rule fails the execution with `States.NoChoiceMatched`.
- Choice states don't have Retry/Catch and never fail on their own unless a JSONata expression errors.
- Use `Assign` inside a rule to store a value only on that path.

**Example:**
```json
"CheckQuality": {
  "Type": "Choice",
  "Choices": [
    { "Condition": "{% $states.input.confidence >= 0.8 %}", "Next": "SaveResults" },
    { "Condition": "{% $states.input.confidence >= 0.5 %}", "Next": "HumanReview" }
  ],
  "Default": "RejectDocument"
}
```

**What happens, step by step:**
1. Input `{"confidence": 0.93}` → first rule true → `SaveResults`.
2. Input `{"confidence": 0.62}` → first rule false, second true → `HumanReview`.
3. Input `{"confidence": 0.2}` → no rule true → `Default` → `RejectDocument`.
4. Input `{"score": 0.9}` (field missing) → `$states.input.confidence` is undefined, so the expression errors with `States.QueryEvaluationError` instead of falling to the default. Guard with `$exists(...)` when a field is optional.

**Common mistake → fix:** ordering a broad rule first (`confidence >= 0.5`) before the narrower one (`>= 0.8`); the narrow rule is never reached and everything above 0.5 goes to review. Fix: order rules from most to least specific.

**Interview answer:** "Choice evaluates its rules in order and follows the first true one, otherwise Default. In JSONata I write Condition expressions; in JSONPath I use Variable plus comparison operators and And/Or/Not. I always provide a Default to avoid States.NoChoiceMatched, order rules from most to least specific, and guard against missing fields."

**Follow-ups:**
- *Can a Choice loop back?* Yes, a rule's `Next` can point to an earlier state, which is how polling loops are built (with a Wait state in between).

---

## 4. Error handling

### Q15. How do `Retry` and `Catch` work?

**Short answer:** If a Task, Parallel or Map state fails, Step Functions first checks its **`Retry`** rules: the first rule whose `ErrorEquals` matches the error decides how many times and how long to wait before trying again. When retries are exhausted (or no rule matches), it checks **`Catch`**: the first matching catcher moves the execution to a fallback state. If nothing matches, the whole execution fails.

**How it works:**
- `Retry` fields: `ErrorEquals` (required), `IntervalSeconds` (default **1**), `MaxAttempts` (default **3**; `0` means never retry), `BackoffRate` (default **2.0**), `MaxDelaySeconds` (caps the wait), `JitterStrategy` (`FULL` randomises each wait between 0 and the computed delay; default `NONE`).
- Wait before retry *n* = `IntervalSeconds × BackoffRate^(n-1)`, capped by `MaxDelaySeconds`.
- Counters are per retrier per state visit; a retrier that has used up its attempts for one error won't retry that error again, even if another retrier's errors intervene.
- Each retry counts as a state transition for billing.
- `Catch` fields: `ErrorEquals`, `Next`, and in JSONata `Output`/`Assign` (using `$states.errorOutput`), in JSONPath `ResultPath`.
- `States.ALL` must be **alone** in `ErrorEquals` and in the **last** retrier or catcher; first match wins. Don't retry permanent errors such as validation failures or access denied.
- Catchers don't exist for top-level execution failures; use an EventBridge rule on execution status or a parent workflow.

**Example:**
```json
"Retry": [
  { "ErrorEquals": ["Lambda.ServiceException", "Lambda.TooManyRequestsException", "States.Timeout"],
    "IntervalSeconds": 2, "BackoffRate": 2.0, "MaxAttempts": 4, "MaxDelaySeconds": 20, "JitterStrategy": "FULL" }
],
"Catch": [
  { "ErrorEquals": ["ValidationError"], "Next": "RejectDocument" },
  { "ErrorEquals": ["States.ALL"],
    "Output": "{% $merge([$states.input, {'error': $states.errorOutput}]) %}", "Next": "MarkFailed" }
]
```

```flow
trace: A throttled task: retry, retry, then catch
attempt 1 fails with Lambda.TooManyRequestsException > Matches the retrier, so Step Functions waits up to 2 s (random 0 to 2 s with FULL jitter).
attempt 2 fails after a wait of up to 4 s > The delay doubles each time: 2, 4, 8, then capped at 20 by MaxDelaySeconds.
attempt 3 fails after a wait of up to 8 s > Still the same retrier, third retry.
attempt 5 (4th retry) fails: MaxAttempts reached > The retrier is exhausted for this state visit.
Catch States.ALL matches > The execution moves to MarkFailed with the error saved in the data.
```

**What happens, step by step:** `ValidationError` never matches the retrier (not in its list), so it goes straight to the first catcher and `RejectDocument`, with no wasted retries. A `Lambda.TooManyRequestsException` is retried up to 4 times with growing, randomised waits; only if all fail does `States.ALL` route to `MarkFailed`.

**Common mistake → fix:** `{"ErrorEquals": ["States.ALL"], "MaxAttempts": 10}` as the only retrier. Permanent errors (bad input, access denied) are retried ten times, wasting time and money before the real failure shows. Fix: retry only transient errors, catch the rest.

**Interview answer:** "Retry re-runs a failed Task, Parallel or Map for matching errors with exponential backoff: IntervalSeconds defaults to 1, BackoffRate 2, MaxAttempts 3, and I add MaxDelaySeconds and FULL jitter. When retries are exhausted or the error doesn't match, Catch sends the execution to a fallback state. First match wins, States.ALL goes last and alone, and I only retry transient errors."

**Follow-ups:**
- *Should I handle Lambda service errors?* Yes. Always retry `Lambda.ServiceException`, `Lambda.SdkClientException` and `Lambda.TooManyRequestsException`, because they're transient.

---

### Q16. What are the built-in error names, and what does `States.ALL` really catch?

**Short answer:** Step Functions names errors with case-sensitive strings. Your own errors can have any name that doesn't start with `States.`. The built-in ones are: **`States.ALL`** (wildcard), **`States.TaskFailed`** (any task error except `States.Timeout`), **`States.Timeout`** (task or execution too long, or missed heartbeat), **`States.HeartbeatTimeout`**, **`States.Permissions`** (not enough IAM permissions), **`States.DataLimitExceeded`** (payload over 256 KiB), **`States.QueryEvaluationError`** (JSONata failed), **`States.ExceedToleratedFailureThreshold`** (Map failed too many items), **`States.ItemReaderFailed`**, **`States.ResultWriterFailed`**, **`States.Http.Socket`** (HTTP Task 60 s limit) and **`States.Runtime`**.

**How it works — the exceptions that surprise people:**

| Error | Catchable by `States.ALL`? | Notes |
|---|---|---|
| `States.DataLimitExceeded` | **No** | Terminal, but you can list it explicitly in `Catch`/`Retry` |
| `States.Runtime` | **No** | Not retriable; always fails the execution (e.g. a path applied to null) |
| `States.TaskFailed` | n/a | Wildcard for every task error **except** `States.Timeout` |
| Lambda unhandled errors | Yes | Reported as `Lambda.Unknown`; timeouts as `Sandbox.Timedout` in newer runtimes |

**Example:**
```json
"Catch": [
  { "ErrorEquals": ["States.DataLimitExceeded"], "Next": "StoreInS3AndContinue" },
  { "ErrorEquals": ["States.Timeout"], "Next": "EscalateSlowTask" },
  { "ErrorEquals": ["States.ALL"], "Next": "MarkFailed" }
]
```

**What happens, step by step:** a Lambda returns a 300 KiB result. The state fails with `States.DataLimitExceeded`. A catcher with only `States.ALL` would *not* catch it, and the whole execution would fail; the explicit first catcher routes it to `StoreInS3AndContinue`. A task that exceeds its 60 s `TimeoutSeconds` fails with `States.Timeout`, which `States.TaskFailed` would *not* match, so the second catcher is needed.

**Common mistake → fix:** relying on `States.ALL` as a safety net and being surprised that executions still fail with `DataLimitExceeded` or `Runtime`. Fix: handle those explicitly; fix the data shape for `Runtime` errors since they can't be retried.

**Interview answer:** "Errors are named strings; the built-in ones start with States. and include Timeout, HeartbeatTimeout, TaskFailed, Permissions, DataLimitExceeded, QueryEvaluationError and ExceedToleratedFailureThreshold. States.ALL matches almost everything but not DataLimitExceeded or Runtime, and States.TaskFailed matches every error except Timeout. I list the specific ones I need to handle and put States.ALL last."

**Follow-ups:**
- *What does a Lambda timeout look like?* In newer runtimes `Sandbox.Timedout`; match `Lambda.Unknown`, `Sandbox.Timedout` and `States.TaskFailed` to cover Lambda failures.

---

### Q17. What is the saga pattern, and how do you compensate in Step Functions?

**Short answer:** Steps that touch different services can't share one database transaction. A **saga** replaces the transaction with a sequence of steps plus **compensating actions**: if a later step fails, you run the compensations for the completed steps, **in reverse order**, to undo them (refund the payment, release the stock). In Step Functions you implement it with `Catch` on each step pointing to the compensation states.

**How it works:**
- Each forward step has a matching undo step.
- A failure at step *n* triggers undo of steps *n-1 … 1*.
- Compensations must be **idempotent** (safe to repeat) and have their own Retry, because they can fail too.
- If a compensation cannot succeed, route to a "needs manual attention" path with an alert.

**Example:**
```json
"CreateShipment": {
  "Type": "Task", "Resource": "arn:aws:states:::lambda:invoke",
  "Arguments": { "FunctionName": "create-shipment", "Payload": "{% $states.input %}" },
  "Catch": [{ "ErrorEquals": ["States.ALL"], "Next": "RefundPayment" }],
  "Next": "Done"
},
"RefundPayment": {
  "Type": "Task", "Resource": "arn:aws:states:::lambda:invoke",
  "Arguments": { "FunctionName": "refund", "Payload": { "orderId": "{% $orderId %}", "key": "{% $states.context.Execution.Name & ':refund' %}" } },
  "Retry": [{ "ErrorEquals": ["States.ALL"], "MaxAttempts": 5, "BackoffRate": 2 }],
  "Next": "ReleaseStock"
},
"ReleaseStock": { "Type": "Task", "Resource": "arn:aws:states:::dynamodb:updateItem", "Arguments": { "...": "..." }, "Next": "OrderFailed" },
"OrderFailed": { "Type": "Fail", "Error": "ShipmentFailed", "Cause": "Order cancelled and compensated" }
```

```flow
sequence: Saga: shipment fails, so earlier steps are undone in reverse
actors: Workflow, Inventory, Payments, Shipping
Workflow -> Inventory: ReserveStock(order o-881)
Workflow -> Payments: ChargeCard(40 EUR)
Workflow -> Shipping: CreateShipment
Shipping --> Workflow: error CarrierUnavailable
> There is no global transaction, so the workflow must undo what already succeeded, newest first.
Workflow -> Payments: RefundPayment(key o-881:refund)
Workflow -> Inventory: ReleaseStock(order o-881)
> Each compensation uses an idempotency key and is retried, because a failed undo would leave the order half-done.
```

**What happens, step by step:** stock is reserved and 40 EUR is charged; the carrier API fails. `Catch` routes to `RefundPayment` (retried up to 5 times), then `ReleaseStock`, then the `Fail` state ends with a clear error. If `RefundPayment` is invoked twice because of a retry, its idempotency key `o-881:refund` makes the second call a no-op.

**Common mistake → fix:** compensating in forward order or forgetting compensations for steps that succeeded before the failing one. Fix: draw the undo path from each step explicitly (each step's Catch routes to the compensation chain starting at the previous step), and test every failure point.

**Interview answer:** "A saga replaces a distributed transaction with forward steps plus compensating actions run in reverse on failure. In Step Functions each step has a Catch that routes to the compensation chain: refund the payment, release the stock, mark the order failed. Compensations must be idempotent with their own retries, and there's a manual-attention path if one can't succeed."

**Follow-ups:**
- *Why not just roll back?* The services have already committed; only a business-level undo (a refund) can reverse their effects.

---

### Q18. What is redrive, and when can you use it?

**Short answer:** **Redrive** restarts an unsuccessful **Standard** execution **from the step that failed**, with the same input, execution ARN and state machine version, keeping the results of steps that already succeeded. Use it after fixing the cause (a bug in a Lambda, a missing permission, a quota). It works for failed, aborted or timed-out executions for up to **14 days** after they ended.

**How it works:**
- Eligible: Standard only; status not `SUCCEEDED`; started on or after 15 November 2023; within the 14-day redrivable period and the 1-year maximum open time; execution history below **24,999 events** (redrive appends to the existing history).
- A redriven Task is rescheduled and run again; **retry counters reset to 0**; the task timeout and state-machine timeout reset.
- **Parallel** and **inline Map** re-run only the failed or aborted branches/iterations. **Distributed Map** redrives only the unsuccessful child executions of the Map Run. (If they failed with `States.DataLimitExceeded`, the whole state re-runs.)
- It always uses the **original definition**; if you change the state machine, start a new execution instead.
- Redrives count as state transitions for billing.
- Needs `states:RedriveExecution`; CLI: `aws stepfunctions redrive-execution --execution-arn ...`.

**Example:**
```bash
# Lambda "extract" was missing S3 permissions; fixed in IAM. Redrive the failed execution:
aws stepfunctions redrive-execution \
  --execution-arn arn:aws:states:eu-west-1:123456789012:execution:process-doc:doc-d42
```

**What happens, step by step (10-state workflow, failed at state 6):**
1. States 1–5 succeeded and charged a card in state 3.
2. State 6 failed with `States.Permissions`; you add the missing IAM permission to the execution role.
3. Redrive reschedules state 6 only, with state 5's output as input; the card is **not** charged again.
4. States 6–10 run; the execution finishes `SUCCEEDED` with a redrive count of 1.

**Common mistake → fix:** editing the state machine definition to fix a bug in a state, then redriving. The redrive still uses the *old* definition, so the bug remains. Fix: for definition changes start a new execution; redrive only for environment fixes (permissions, Lambda code behind the same ARN, quotas).

**Interview answer:** "Redrive restarts a failed, aborted or timed-out Standard execution from the failed step, keeping completed steps' results, with the same input, ARN and definition, within 14 days. Retry counters reset, Parallel and Map re-run only failed branches or iterations, and Distributed Map redrives failed child executions. I use it after fixing environment causes such as permissions or Lambda code; if the state machine definition needs changing, I start a new execution."

**Follow-ups:**
- *Does Express support redrive?* No.

---
## 5. Integration patterns

### Q19. What are the three service integration patterns?

**Short answer:** When a Task calls a service, the `Resource` ARN decides how long Step Functions waits. **Request Response** (no suffix) calls the API and moves on as soon as it gets the HTTP reply. **Run a Job** (`.sync`) starts a job and waits until it finishes (ECS, Batch, Glue, nested Step Functions, and others). **Wait for Callback** (`.waitForTaskToken`) hands a **task token** to someone else and waits until they send it back. `.sync` and `.waitForTaskToken` work only in **Standard** workflows.

**How it works:**

| Pattern | Resource suffix | Example | What the workflow waits for |
|---|---|---|---|
| Request Response | none | `arn:aws:states:::sqs:sendMessage` | The API response only |
| Run a Job | `.sync` | `arn:aws:states:::ecs:runTask.sync` | The job to reach a terminal state; Step Functions polls and listens for events |
| Wait for Callback | `.waitForTaskToken` | `arn:aws:states:::sqs:sendMessage.waitForTaskToken` | `SendTaskSuccess` or `SendTaskFailure` with the token |

- Which services support which pattern differs; for example, DynamoDB is request-response only, ECS/Fargate and Step Functions support all three, Lambda supports request-response and callbacks. AWS SDK integrations (200+ services) support request-response everywhere and callbacks in Standard.
- If a `.sync` task is aborted (the execution is stopped, or another Parallel branch fails), Step Functions makes a best effort to cancel the job; if it can't, you may keep paying the job service.
- `.sync` and `.waitForTaskToken` need extra IAM permissions on the execution role.

**Example:**
```json
"RunExtraction": {
  "Type": "Task",
  "Resource": "arn:aws:states:::ecs:runTask.sync",
  "Arguments": { "Cluster": "arn:aws:ecs:eu-west-1:123456789012:cluster/jobs",
                 "TaskDefinition": "extractor:7", "LaunchType": "FARGATE" },
  "TimeoutSeconds": 3600,
  "Next": "SaveResults"
}
```

```flow
sequence: Request response vs run a job
actors: Step Functions, SQS, ECS
Step Functions -> SQS: sendMessage (request response)
SQS --> Step Functions: HTTP 200 with a message id, so the workflow moves on at once
Step Functions -> ECS: runTask.sync starts the Fargate task
ECS --> Step Functions: task is RUNNING, and the workflow keeps waiting
ECS --> Step Functions: task STOPPED with exit code 0 after 14 minutes
> The .sync state completes only when the job ends, with no polling code in your workflow and no compute billed to you while waiting.
```

**What happens, step by step:** `sendMessage` returns in about 50 ms and the next state starts immediately, even though no consumer has read the message yet. `runTask.sync` returns after 14 minutes, when the container exits; a non-zero exit code makes the state fail with `States.TaskFailed`, which your `Catch` can handle.

**Common mistake → fix:** using `lambda:invoke` request-response for a job that takes 20 minutes. Lambda's 15-minute limit and the wait both fail the state. Fix: use a pattern designed for long jobs (`ecs:runTask.sync`, `batch:submitJob.sync`, or a callback), and set `TimeoutSeconds`.

**Interview answer:** "There are three integration patterns, chosen by the Resource suffix. Request Response continues after the HTTP reply. Run a Job, `.sync`, waits until the job finishes, for ECS, Batch, Glue, nested workflows and similar. Wait for Callback, `.waitForTaskToken`, passes a token to an external worker and pauses until it calls SendTaskSuccess or Failure. `.sync` and callbacks are Standard-only, and I always set timeouts on them."

**Follow-ups:**
- *Why use `.sync` instead of polling in a loop?* Fewer states, fewer transitions, no loop logic, and automatic cancellation when the execution is aborted.

---

### Q20. How does the callback pattern with task tokens work (human approval)?

**Short answer:** With `.waitForTaskToken`, Step Functions generates a unique **task token** for the task and pauses. Your task definition passes the token to whoever must act (a queue message, an email, a ticket). When they finish, **your code calls `SendTaskSuccess` or `SendTaskFailure` with that token**, and the workflow resumes with the data you send. While it waits, nothing runs and no compute is billed. Always set `TimeoutSeconds` (and `HeartbeatSeconds` for long work).

**How it works:**
- Get the token in the task via `$states.context.Task.Token` (JSONPath: `$$.Task.Token`).
- The workflow resumes only when `SendTaskSuccess(token, output)` or `SendTaskFailure(token, error, cause)` is called, or when a timeout fires. `SendTaskHeartbeat` resets the heartbeat clock.
- If the task times out, a **new random token** is generated, so a late response using the old token is rejected with `TaskTimedOut`.
- Tokens must be sent from principals in the **same AWS account**.
- The token is a **capability**: whoever holds it can complete the task. Store it server-side, never expose it in a browser URL, and verify the approver's identity before calling `SendTaskSuccess`.

**Example:**
```json
"WaitForApproval": {
  "Type": "Task",
  "Resource": "arn:aws:states:::sqs:sendMessage.waitForTaskToken",
  "Arguments": {
    "QueueUrl": "https://sqs.eu-west-1.amazonaws.com/123456789012/approvals",
    "MessageBody": { "token": "{% $states.context.Task.Token %}", "docId": "{% $docId %}", "summary": "{% $states.input.summary %}" }
  },
  "TimeoutSeconds": 259200,
  "Catch": [{ "ErrorEquals": ["States.Timeout"], "Next": "AutoReject" }],
  "Next": "Publish"
}
```

```flow
sequence: Human approval with a task token
actors: Step Functions, Approvals service, Reviewer
Step Functions -> Approvals service: message with taskToken T-77 and docId d-42 (workflow pauses)
> The execution is paused, not running; the 3-day timeout starts counting.
Approvals service -> Approvals service: store T-77 in a database row and email the reviewer
Reviewer -> Approvals service: clicks Approve on day 2
Approvals service -> Approvals service: check the reviewer is allowed to approve d-42
Approvals service -> Step Functions: SendTaskSuccess(T-77, {"approved": true, "by": "u7"})
Step Functions -> Step Functions: resumes at Publish with the approval data
> If nobody had acted for 259,200 seconds, States.Timeout would have routed to AutoReject.
```

**What happens, step by step:** the message carries `T-77`. Two days later `SendTaskSuccess` delivers `{"approved": true, "by": "u7"}`, which becomes the output of `WaitForApproval`, and `Publish` runs. Had the reviewer clicked on day 4, the call would fail with `TaskTimedOut` because the task already timed out on day 3 and `AutoReject` ran.

**Common mistake → fix:** emailing an approval link that contains the raw task token and calling `SendTaskSuccess` from the browser. Anyone who forwards the email can approve. Fix: send a link with an opaque ID, keep the token in your database, authenticate the approver, then call `SendTaskSuccess` from your backend.

**Interview answer:** "With `.waitForTaskToken`, Step Functions gives the task a unique token, I pass it to an external system, and the workflow pauses at no cost until `SendTaskSuccess` or `SendTaskFailure` is called with that token, or a timeout fires. I set TimeoutSeconds and Heartbeats so a lost message can't hang the execution for a year, and I treat the token as a secret capability: stored server-side, approver verified before the call."

**Follow-ups:**
- *Can the callback come from another account?* No; tokens only work from principals in the same account.

---

### Q21. What are activities and activity workers?

**Short answer:** An **activity** lets a Task state hand work to **your own worker program**, running anywhere that can call the Step Functions API (EC2, ECS, on-premises, a laptop). You create the activity (it gets an ARN) and reference it as the Task's `Resource`. The worker **long-polls** `GetActivityTask`, receives the input and a task token, does the work, and reports back with `SendTaskSuccess` or `SendTaskFailure`, sending `SendTaskHeartbeat` for long jobs. Activities are Standard-only, and the callback pattern with `.waitForTaskToken` has largely replaced them.

**How it works:**
- Step Functions waits for a worker to poll; nothing is pushed to the worker.
- Set `TimeoutSeconds` and `HeartbeatSeconds`; without a heartbeat or result in time, the task fails (`States.Timeout`/`HeartbeatTimeout`) and the token is invalidated.
- Activities are **not versioned**; make changes backward compatible or create a new activity.
- Polling latency can matter; run enough poller threads (the docs suggest tens for typical loads).

**Example:**
```json
"ManualReview": {
  "Type": "Task",
  "Resource": "arn:aws:states:eu-west-1:123456789012:activity:review-doc",
  "TimeoutSeconds": 86400, "HeartbeatSeconds": 300,
  "Next": "Publish"
}
```
```python
import boto3, json, threading, time
sfn = boto3.client("stepfunctions")
ACTIVITY = "arn:aws:states:eu-west-1:123456789012:activity:review-doc"

while True:
    task = sfn.get_activity_task(activityArn=ACTIVITY, workerName="worker-1")   # long poll
    if not task.get("taskToken"):
        continue
    token, data = task["taskToken"], json.loads(task["input"])
    try:
        result = review(data, heartbeat=lambda: sfn.send_task_heartbeat(taskToken=token))
        sfn.send_task_success(taskToken=token, output=json.dumps(result))
    except Exception as e:
        sfn.send_task_failure(taskToken=token, error="ReviewFailed", cause=str(e))
```

**What happens, step by step:** the workflow reaches `ManualReview` and waits. The worker's long poll returns `{"taskToken": "T-9", "input": "{\"docId\": \"d-42\"}"}`; it works for 40 minutes sending a heartbeat every few minutes (each must arrive within 300 s), then calls `send_task_success`. If the worker crashes after 10 minutes, no heartbeat arrives and the task fails with `States.Timeout` within 5 minutes of the last one.

**Common mistake → fix:** a worker with no heartbeats on a long job and `HeartbeatSeconds` set. It's declared dead mid-work. Fix: send heartbeats on a timer thread that's independent of the work loop.

**Interview answer:** "An activity is a way to run a task in my own worker outside AWS. The worker polls GetActivityTask with the activity ARN, gets input and a task token, and reports with SendTaskSuccess, Failure or Heartbeat. It's Standard-only and unversioned. Today I usually prefer `.waitForTaskToken` with a queue, which avoids polling workers, but activities are useful for workers that can only make outbound calls."

**Follow-ups:**
- *Who initiates the connection?* The worker, so it works behind firewalls with outbound HTTPS only.

---

### Q22. How do you call an external HTTPS API from a workflow?

**Short answer:** Use the **HTTP Task**: a Task state with `Resource: arn:aws:states:::http:invoke` and `ApiEndpoint`, `Method` and an **EventBridge connection** for authentication. The connection stores the credentials (Basic, API key, or OAuth) in Secrets Manager, so secrets never appear in your definition or history. The request is limited to **60 seconds**, and failures surface as errors like `States.Http.StatusCode.429`.

**How it works:**
- The execution role needs `states:InvokeHTTPEndpoint`, `events:RetrieveConnectionCredentials`, and `secretsmanager:GetSecretValue`/`DescribeSecret` on the connection's secret.
- `Headers`, `QueryParameters` and `RequestBody` set in both the task and the connection are **merged**; on a key clash, the **connection's value wins**.
- Authentication headers belong in the connection, not in the task. Some headers (e.g. `Authorization`, `Host`) are forbidden in the task.
- Responses with binary content types (`image/*`, `application/octet-stream`) fail with `States.Runtime`.
- Only public domain names with publicly trusted certificates are supported for private APIs; mutual TLS is not.

**Example:**
```json
"CreateInvoice": {
  "Type": "Task",
  "Resource": "arn:aws:states:::http:invoke",
  "Arguments": {
    "ApiEndpoint": "https://api.example-billing.com/v1/invoices",
    "Method": "POST",
    "Authentication": { "ConnectionArn": "arn:aws:events:eu-west-1:123456789012:connection/billing/8f1c…" },
    "RequestBody": { "customer": "{% $states.input.customerId %}", "amount": "{% $states.input.amount %}" }
  },
  "Retry": [{ "ErrorEquals": ["States.Http.StatusCode.429", "States.Http.StatusCode.503"],
              "IntervalSeconds": 1, "BackoffRate": 2, "MaxAttempts": 3, "JitterStrategy": "FULL" }],
  "Catch": [{ "ErrorEquals": ["States.Http.StatusCode.400", "States.Http.StatusCode.404"], "Next": "RejectOrder" }],
  "Next": "SendReceipt"
}
```

**What happens, step by step:** Step Functions fetches the API key from the connection's secret, adds it as a header, and POSTs the body `{"customer": "c-7", "amount": 40}`. A `503` response raises `States.Http.StatusCode.503` and is retried with jittered backoff; a `400` goes to `RejectOrder` without retrying; a success returns the response body and headers as the task result.

**Common mistake → fix:** putting an API key in `Headers` of the task so it shows up in the execution history. Fix: store it in the EventBridge connection; the history then shows the request without the secret.

**Interview answer:** "The HTTP Task calls any HTTPS API with `arn:aws:states:::http:invoke`. Authentication goes through an EventBridge connection that keeps credentials in Secrets Manager, so secrets stay out of the definition and history. Headers, query parameters and body from the connection are merged with the task's, with the connection winning. There's a 60-second limit, and I retry 429s and 5xx statuses and catch 4xx."

**Follow-ups:**
- *When would I use Lambda instead?* For complex request signing, binary responses, mTLS or calls longer than 60 seconds.

---

### Q23. How do you orchestrate an asynchronous service such as Textract?

**Short answer:** Start the job, **don't poll it from inside Lambda**, and let the workflow wait for the completion signal. Two patterns: a **callback** (store the task token with the job ID, and when the service's completion notification arrives, send `SendTaskSuccess`), or a **polling loop** (`Wait` → status call → `Choice`), which is simpler but costs more state transitions. In either case, use the service's **idempotent start token** so a retry doesn't start a second job.

**How it works (callback version):**
1. A task with `.waitForTaskToken` invokes a Lambda that calls Textract `StartDocumentAnalysis` with `ClientRequestToken` set to the document hash and a notification channel (SNS topic and role).
2. The Lambda stores `JobId → taskToken` in DynamoDB and returns; the workflow stays paused.
3. When Textract finishes it publishes to SNS; a second Lambda reads the `JobId` from the message, looks up the token and calls `SendTaskSuccess`.
4. The next state fetches the paginated results with `GetDocumentAnalysis` and writes them to S3.

**Example:**
```python
def start_job(event, context):                       # invoked by the .waitForTaskToken task
    resp = textract.start_document_analysis(
        DocumentLocation={"S3Object": {"Bucket": event["bucket"], "Name": event["key"]}},
        FeatureTypes=["TABLES", "FORMS"],
        ClientRequestToken=event["docHash"][:64],      # a retry returns the SAME job
        NotificationChannel={"SNSTopicArn": TOPIC_ARN, "RoleArn": ROLE_ARN})
    table.put_item(Item={"pk": resp["JobId"], "token": event["taskToken"]})

def on_done(event, context):                           # subscribed to the SNS topic
    msg = json.loads(event["Records"][0]["Sns"]["Message"])
    token = table.get_item(Key={"pk": msg["JobId"]})["Item"]["token"]
    if msg["Status"] == "SUCCEEDED":
        sfn.send_task_success(taskToken=token, output=json.dumps({"jobId": msg["JobId"]}))
    else:
        sfn.send_task_failure(taskToken=token, error="TextractFailed", cause=msg["Status"])
```

```flow
sequence: Waiting for Textract without polling
actors: Workflow, Start Lambda, Textract, Completion Lambda
Workflow -> Start Lambda: task with .waitForTaskToken, token T-1 and docHash ab12
Start Lambda -> Textract: StartDocumentAnalysis(ClientRequestToken = ab12, notify SNS)
Textract --> Start Lambda: JobId J-55
Start Lambda -> Start Lambda: save J-55 mapped to T-1 in DynamoDB
> The workflow is paused and nothing is billed while Textract works for several minutes.
Textract -> Completion Lambda: SNS message: J-55 SUCCEEDED
Completion Lambda -> Workflow: SendTaskSuccess(T-1)
> The workflow resumes at the next state and fetches results page by page.
```

**What happens, step by step:** if `Start Lambda` is retried after a timeout, `ClientRequestToken=ab12` makes Textract return job `J-55` again instead of starting a second, billed job. If the SNS message is lost, the task token's `TimeoutSeconds` (say 30 minutes) fails the state, and a Catch can re-check the job status once as a fallback.

**Common mistake → fix:** a Lambda that starts the job and then loops with `sleep` until it finishes. It pays for idle time and hits the 15-minute limit on big documents. Fix: the callback above, or a `Wait` + status check loop in the state machine.

**Interview answer:** "For async services I start the job with an idempotent token, such as Textract's ClientRequestToken, and let the workflow pause on a task token, which I store with the job ID. The completion notification triggers a small function that looks up the token and calls SendTaskSuccess. If I want less moving parts I use a Wait, status call and Choice loop, at the cost of more state transitions. Either way, TimeoutSeconds guards against a lost notification."

**Follow-ups:**
- *Why not `.sync`?* Textract has no `.sync` integration, so there's nothing for Step Functions to wait on itself.

---

### Q24. How do you call Amazon Bedrock models from a workflow?

**Short answer:** Use the optimised **Bedrock integration** (`arn:aws:states:::bedrock:invokeModel`) for single, bounded model calls (classify, extract, summarise), or the AWS SDK integration for other Bedrock APIs. Wrap the call in **Retry** with backoff and jitter for throttling, validate the model's output in the next state, keep big prompts and responses in S3, and size **Map concurrency** to your model quota.

**How it works:**
- Bedrock supports request-response in Standard and Express, and `.sync` and callbacks in Standard for long jobs.
- Model output is untrusted text: validate that it is the JSON shape you expect (Choice on a parsed field, or a Lambda validator) before acting on it.
- Throttling shows up as `Bedrock.ThrottlingException`-style service errors you can match in `Retry`.
- Every model call is a billable state transition plus tokens; keep the number of calls bounded.

**Example:**
```json
"ExtractFields": {
  "Type": "Task",
  "Resource": "arn:aws:states:::bedrock:invokeModel",
  "Arguments": { "ModelId": "arn:aws:bedrock:eu-west-1::foundation-model/<model-id>",
                 "Body": { "messages": [{ "role": "user", "content": "{% 'Extract the total from: ' & $states.input.text %}" }] } },
  "Retry": [{ "ErrorEquals": ["Bedrock.ThrottlingException", "Bedrock.ServiceUnavailableException"],
              "IntervalSeconds": 2, "BackoffRate": 2, "MaxAttempts": 5, "JitterStrategy": "FULL" }],
  "Next": "ValidateJson"
}
```

**What happens, step by step:** the call is throttled on the first attempt, so the retrier waits a random 0–2 s and tries again; the second attempt succeeds and returns the model's text. `ValidateJson` parses it; if the `total` field is missing, a Choice sends the item to `HumanReview` rather than saving bad data. The `<model-id>` placeholder stands for whichever model your account has enabled.

**Common mistake → fix:** a Map with `MaxConcurrency: 0` over 500 pages, all calling the model at once. The model quota is exceeded, nearly everything is throttled, and retries pile up. Fix: set `MaxConcurrency` to a value your quota supports (e.g. 5–10) and keep retries with jitter.

**Interview answer:** "I use the optimised Bedrock integration for bounded model calls, with Retry and jitter on throttling, large prompts and results in S3, and a validation step because model output is untrusted. Map concurrency is sized to the model quota. For long Bedrock jobs I use the `.sync` pattern."

**Follow-ups:**
- *What about the Converse API?* Reach it through the AWS SDK integration (`arn:aws:states:::aws-sdk:bedrockruntime:converse`).

---

### Q25. Should an AI agent's reasoning loop run inside Step Functions?

**Short answer:** Usually **not the inner reasoning loop**. Agent loops are open-ended and chatty: many model and tool calls, each a billed state transition, with payload limits and a fixed graph that doesn't suit unknown steps. Use Step Functions for the **business process around the agent**: start the job, call the agent as one task, wait for human approval with a task token, compensate on failure, notify. Step Functions can call Amazon Bedrock AgentCore through an optimised integration (request-response).

**How it works:**

| Question | Prefer Step Functions | Prefer an agent framework/runtime |
|---|---|---|
| Are the steps known in advance? | Yes | No, the model decides |
| Need audit trail per step, long waits, approvals? | Yes | Possibly via the framework's checkpoints |
| Loop count unbounded? | No | Yes |
| Cost sensitivity | Few transitions | Many model calls anyway |

Short, bounded loops (for example "try up to 3 times to get valid JSON") are fine as a Choice loop with a counter variable.

**Example — agent as one task inside a business process:**
1. `ValidateRequest` (Lambda) → 2. `RunAgent` (AgentCore or Lambda; one state, 10-minute timeout) → 3. `CheckResult` (Choice) → 4. `WaitForApproval` (`.waitForTaskToken`) → 5. `ExecuteActions` (Task) → catch → `Compensate`.

**What happens, step by step:** the agent may make 30 internal tool calls but Step Functions records one state transition for `RunAgent`. If the agent's proposed action is risky, `CheckResult` routes to a human approval step; only after approval does the workflow perform the real action, and a failure triggers compensation.

**Common mistake → fix:** modelling every agent thought as a state in a loop with growing conversation history in the state data. The payload hits 256 KiB, cost climbs with every transition, and the graph can't express what the agent decides at runtime. Fix: let the agent runtime own the loop and keep the history in its own store.

**Interview answer:** "I keep the agent's open-ended reasoning loop in an agent framework or runtime and use Step Functions for the deterministic process around it: validation, calling the agent as one task, approvals through task tokens, compensation and notifications. State machines suit known steps; agents suit unknown steps. Bounded retry loops are fine inside a state machine."

**Follow-ups:**
- *Can the agent call a workflow as a tool?* Yes, a tool can start an execution, and Express synchronous workflows work well for short, deterministic tools.

---

## 6. Parallelism: Parallel, Map, Distributed Map

### Q26. What's the difference between Parallel and Map?

**Short answer:** **Parallel** runs a **fixed set of different branches** at the same time (OCR, virus scan, metadata extraction). **Map** runs **the same steps once per item** in a list whose length is only known at run time (every page, every order line). Both wait for **all** branches or items to finish, and both return an **array** of results in input order. If one branch or iteration fails and isn't caught, the state fails and the others are stopped.

**How it works:**
- Parallel: each branch is its own mini state machine with its own `StartAt`; all get the same input; output is an array with one element per branch in the order defined.
- Map: `ItemProcessor` is the sub-workflow; `Items` (JSONata) or `ItemsPath` (JSONPath) selects the array; `ItemSelector` reshapes each item.
- Both support `Retry`, `Catch`, `Assign` and `Output`; variables assigned inside have inner scope.
- Inline Map keeps iterations inside the parent execution's history; Distributed Map (Q28) runs each as a child execution.

**Example:**
```json
"Analyse": {
  "Type": "Parallel",
  "Branches": [
    { "StartAt": "Ocr", "States": { "Ocr": { "Type": "Pass", "Output": { "text": "invoice 40 EUR" }, "End": true } } },
    { "StartAt": "Scan", "States": { "Scan": { "Type": "Pass", "Output": { "clean": true }, "End": true } } }
  ],
  "Output": "{% $merge($states.result) %}",
  "Next": "Decide"
},
"PerPage": {
  "Type": "Map",
  "Items": "{% $states.input.pages %}",
  "ItemProcessor": { "ProcessorConfig": { "Mode": "INLINE" }, "StartAt": "ExtractPage",
    "States": { "ExtractPage": { "Type": "Pass", "Output": { "page": "{% $states.input.n %}", "ok": true }, "End": true } } },
  "MaxConcurrency": 5,
  "Next": "Merge"
}
```

**What happens, step by step:** `Analyse` starts both branches together; `$states.result` is `[{"text": "invoice 40 EUR"}, {"clean": true}]`, and `$merge` turns it into `{"text": "invoice 40 EUR", "clean": true}`. `PerPage` with `pages = [{"n":1},{"n":2},{"n":3}]` runs three iterations; its output is `[{"page":1,"ok":true},{"page":2,"ok":true},{"page":3,"ok":true}]`.

**Common mistake → fix:** using Parallel to process a list by hard-coding ten identical branches. It breaks when the list has eleven items. Fix: a Map over the list.

**Interview answer:** "Parallel runs a fixed set of different branches concurrently; Map runs the same sub-workflow for every element of an array whose size is known only at run time. Both wait for everything, return an array of outputs in order, and fail as a whole if a branch or iteration fails and isn't caught. I use Parallel for different jobs on the same input and Map for the same job over many items."

**Follow-ups:**
- *Can one failed branch be tolerated?* Catch inside the branch so it returns a result, or for Map set tolerated failure thresholds.

---

### Q27. How do you control Map concurrency and failures?

**Short answer:** `MaxConcurrency` caps how many iterations run at once; use it to stay inside the quota of whatever the iterations call (Bedrock, Textract, a database). `ToleratedFailurePercentage` and `ToleratedFailureCount` let a Map succeed even if some items fail. `ItemBatcher` groups items so each iteration processes a batch, which reduces state transitions.

**How it works:**
- `MaxConcurrency: 0` (or omitted) means no limit set by you. An **inline** Map is practically limited to about 40 concurrent iterations; beyond that, use Distributed Map. A **Distributed** Map defaults to 10,000 parallel child executions.
- `ToleratedFailurePercentage` (0–100, default 0) and `ToleratedFailureCount` set how many items may fail (the percentage is failed or timed-out items ÷ total items). If either is exceeded, the state fails with `States.ExceedToleratedFailureThreshold`. Step Functions may keep running some children briefly after the threshold is crossed.
- `MaxConcurrency` and thresholds can be JSONata expressions or (JSONPath) `...Path` fields.
- Add Retry with jitter inside the iteration for throttling; the concurrency cap is the first defence.

**Example:**
```json
"ExtractPages": {
  "Type": "Map",
  "Items": "{% $states.input.pages %}",
  "MaxConcurrency": 8,
  "ItemProcessor": { "ProcessorConfig": { "Mode": "INLINE" }, "StartAt": "CallModel", "States": { "CallModel": { "...": "..." } } },
  "Next": "Merge"
}
```

**What happens, step by step (60 pages, model quota allows about 8 concurrent calls):**
1. 8 iterations start; pages 9–60 wait.
2. Each time one finishes, the next page starts, so there are never more than 8 calls in flight.
3. No throttling occurs, so no retries are needed and total time ≈ 60 ÷ 8 × (time per call).
4. With `MaxConcurrency` unset, all pages would start together, the model would throttle most, and retries with backoff would stretch the run and cost more.

**Common mistake → fix:** setting `ToleratedFailurePercentage: 100` to "make it never fail" and then not checking the results. Failed items vanish silently. Fix: tolerate a small percentage, write failures to S3/DLQ with `ResultWriter`, and alarm on them.

**Interview answer:** "MaxConcurrency limits parallel iterations so I don't exceed downstream quotas; inline Map practically tops out around 40, Distributed Map can run up to 10,000 child executions. Tolerated failure percentage or count lets a Map continue despite some failures, and ItemBatcher cuts transitions. I combine a concurrency cap with Retry and jitter, and I make failures visible rather than swallowing them."

**Follow-ups:**
- *What is the default tolerated failure?* Zero: one failed item fails the Map.

---

### Q28. What is Distributed Map?

**Short answer:** **Distributed Map** is Map mode `DISTRIBUTED` for huge workloads: each item (or batch) runs as its **own child workflow execution** with its own history, up to **10,000 in parallel**, reading items straight from **S3** (an object listing, CSV, JSON, JSON Lines, Parquet, an Athena or S3 inventory manifest) and writing results back to S3. Use it when the dataset is over 256 KiB, the history would exceed 25,000 events, or you need more than 40 concurrent iterations. It runs only in **Standard** parents; children can be Standard or Express.

**How it works:**
- `ItemReader`: `Resource` (`s3:getObject` for a file, `s3:listObjectsV2` for a prefix), `ReaderConfig` (`InputType` CSV/JSON/JSONL/PARQUET/MANIFEST, `CSVHeaderLocation`, `MaxItems` up to 100,000,000). With `Transformation: LOAD_AND_FLATTEN`, listing a prefix reads the *contents* of the files instead of their metadata. Buckets must be in the same account and Region as the state machine.
- `ItemBatcher`: `MaxItemsPerBatch` (and byte limits) so each child gets a batch.
- `ItemProcessor.ProcessorConfig`: `Mode: DISTRIBUTED`, `ExecutionType: EXPRESS` or `STANDARD`.
- `ResultWriter`: writes all child results, grouped by status, to S3 instead of returning an array (so you avoid the 256 KiB output limit).
- A **Map Run** resource tracks the whole thing; limits: 1,000 open Map Runs per account; Step Functions dispatches Express children at up to 1,000 per second and Standard children at up to 100 per second.
- Failed children can be **redriven** (see Q18).

**Example:**
```json
"ProcessAllDocs": {
  "Type": "Map",
  "ItemReader": {
    "Resource": "arn:aws:states:::s3:listObjectsV2",
    "Arguments": { "Bucket": "incoming-docs", "Prefix": "2026-10/" }
  },
  "ItemBatcher": { "MaxItemsPerBatch": 20 },
  "MaxConcurrency": 200,
  "ToleratedFailurePercentage": 2,
  "ItemProcessor": {
    "ProcessorConfig": { "Mode": "DISTRIBUTED", "ExecutionType": "EXPRESS" },
    "StartAt": "Extract",
    "States": { "Extract": { "Type": "Task", "Resource": "arn:aws:states:::lambda:invoke",
                             "Arguments": { "FunctionName": "extract-batch", "Payload": "{% $states.input %}" },
                             "End": true } }
  },
  "ResultWriter": { "Resource": "arn:aws:states:::s3:putObject",
                    "Arguments": { "Bucket": "results", "Prefix": "run-2026-10/" } },
  "End": true
}
```

**What happens, step by step (50,000 objects):**
1. Step Functions lists the prefix and groups items into batches of 20 → 2,500 batches.
2. It starts Express child executions, at most 200 at a time, each invoking `extract-batch` with 20 items.
3. If 30 of the 2,500 batches fail (1.2%), that is under the 2% threshold, so the Map Run still succeeds.
4. All child results are written under `s3://results/run-2026-10/` in files grouped by status (succeeded, failed, pending); the parent state's output is a small summary, not 50,000 results.
5. The 30 failed children can be redriven after you fix the cause.

**Common mistake → fix:** forgetting that a folder created in the S3 *console* is listed as an item, so a child execution runs for an empty "folder" key. Fix: create folders with the CLI, or skip keys ending in `/` in the processor.

**Interview answer:** "Distributed Map runs each item or batch as a child workflow execution, up to 10,000 in parallel, reading from S3 as CSV, JSON, JSONL, Parquet, manifests or an object listing, and writing results to S3 with ResultWriter. I use it for datasets over 256 KiB, histories over 25,000 events, or concurrency over 40. I batch items, use Express children for short work, set MaxConcurrency to downstream limits, tolerate a small failure percentage and redrive failed children."

**Follow-ups:**
- *Why Standard parent but Express children?* The parent needs durable history and long runtime; the children are short, high-volume and idempotent, so Express is far cheaper.

---

### Q29. What are the pitfalls of nested workflows?

**Short answer:** A parent can start a child state machine with `arn:aws:states:::states:startExecution.sync:2` (wait for the child) or without `.sync` (fire and forget). Nesting improves reuse and keeps each history small, but it adds more executions to trace, more permissions, cost multiplication, and error handling you must write on the parent side.

**How it works:**
- `.sync:2` waits and returns the child's output as parsed JSON (the older `.sync` returns it as a string).
- A child failure becomes a parent task failure: **a child `States.Timeout` appears in the parent as `States.TaskFailed`**.
- Standard children started from a Standard parent can run for a year; Express children are limited to 5 minutes.
- The parent's role needs `states:StartExecution` on the child and permission for the polling/event rules `.sync` uses.
- Pass a correlation ID so logs and traces can be joined across executions.

**Example:**
```json
"RunChild": {
  "Type": "Task",
  "Resource": "arn:aws:states:::states:startExecution.sync:2",
  "Arguments": {
    "StateMachineArn": "arn:aws:states:eu-west-1:123456789012:stateMachine:charge-flow:prod",
    "Name": "{% $states.context.Execution.Name & '-charge' %}",
    "Input": { "orderId": "{% $orderId %}", "correlationId": "{% $states.context.Execution.Id %}" }
  },
  "Catch": [{ "ErrorEquals": ["States.TaskFailed"], "Next": "ChargeFailed" }],
  "Next": "Ship"
}
```

**What happens, step by step:** the parent `order-o881` starts child `order-o881-charge` with a deterministic name, so a retry of the parent state doesn't create a second child. The parent waits; if the child fails, the parent sees `States.TaskFailed` and runs `ChargeFailed`. In the console you open the parent's graph and follow the link to the child execution to see its states.

**Common mistake → fix:** letting a Standard parent poll many Standard children with `.sync` for tiny steps; each child adds start/transition costs and a polling load. Fix: keep nesting for meaningful reusable units, and use Express children (or Distributed Map) for high-volume inner loops.

**Interview answer:** "Child state machines give modularity and reuse, started with `states:startExecution.sync:2` so the parent waits and gets JSON output. The costs are more executions to trace, extra IAM, cost multiplication, and error mapping: a child timeout surfaces as States.TaskFailed in the parent. I give children deterministic names for idempotency, pass a correlation ID, and use Express children for high-volume inner work."

**Follow-ups:**
- *How do I stop a child when the parent is stopped?* Step Functions tries to call `StopExecution` for aborted `.sync` children, but it needs the IAM permission to do so.

---
## 7. Operations: versions, testing, security, cost

### Q30. How do versions and aliases work for state machines?

**Short answer:** A **version** is a numbered, **immutable snapshot** of a state machine's definition, IAM role, logging and tracing settings. An **alias** is a named pointer (for example `PROD`) to one version, or to **two versions with traffic weights** that add up to 100. Callers start executions on the alias ARN, so a deploy is moving the alias, and a canary release is a 90/10 split. Running executions stay on the version they started with.

**How it works:**
- Publish with `PublishStateMachineVersion`, or pass `publish=true` on `CreateStateMachine`/`UpdateStateMachine`. Version numbers increase monotonically and are never reused. Up to 1,000 versions and 100 aliases per state machine (soft limits).
- Alias ARN: `arn:aws:states:REGION:ACCOUNT:stateMachine:NAME:ALIAS`; a version ARN ends in `:3`.
- When you start an execution on an alias with weights, Step Functions randomly picks a version by weight.
- An alias can point only to versions (not another alias). Starting an execution on the bare state machine ARN uses the latest revision.
- A **redriven** execution keeps its original version even if the alias has moved.

**Example:**
```bash
aws stepfunctions publish-state-machine-version \
  --state-machine-arn arn:aws:states:eu-west-1:123456789012:stateMachine:process-doc

aws stepfunctions update-state-machine-alias \
  --state-machine-alias-arn arn:aws:states:eu-west-1:123456789012:stateMachine:process-doc:PROD \
  --routing-configuration '[{"stateMachineVersionArn":"arn:aws:states:eu-west-1:123456789012:stateMachine:process-doc:3","weight":90},
                            {"stateMachineVersionArn":"arn:aws:states:eu-west-1:123456789012:stateMachine:process-doc:4","weight":10}]'
```

```flow
trace: Canary release of version 4 behind the PROD alias
PROD points to version 3 at 100% > All new executions use version 3.
publish version 4, PROD routes 90% to v3 and **10% to v4** > Each new execution randomly gets v3 or v4 by weight.
executions already running on v3 > They continue on v3; the change only affects new starts.
alarm on ExecutionsFailed fires > Move PROD back to v3 at 100%; v4's in-flight executions finish on v4.
no alarm after 30 minutes > Move PROD to v4 at 100%.
```

**What happens, step by step:** during the canary, about 1 in 10 new executions follow version 4's definition. A long-running v3 execution that started yesterday is unaffected when you flip the alias. If you roll back, v4 executions that already started finish on v4 (or you can stop them).

**Common mistake → fix:** pointing starters at the bare state machine ARN. Every `update-state-machine` changes behaviour for the next start immediately, with no rollback pointer. Fix: starters always use the alias ARN, and your pipeline publishes a version and then updates the alias.

**Interview answer:** "A version is an immutable numbered snapshot of the definition and settings; an alias points to one version or splits traffic between two. Starters use the alias ARN, so deploying is publishing a version and shifting the alias gradually, and rolling back is moving it back. In-flight executions, including redriven ones, keep the version they started on."

**Follow-ups:**
- *Can aliases split among three versions?* No, at most two.

---

### Q31. How do you test a state machine?

**Short answer:** Combine four layers. **Unit-test each state** with the **`TestState` API** (it runs one state, or one state from a full definition, with your input and optional **mocked service results or errors**, so no real calls or IAM roles are needed). **Unit-test Lambda code** on its own. **Validate** definitions in CI with `validate-state-machine-definition`. **Integration-test** the real workflow in a sandbox account.

**How it works:**
- `TestState` inspection levels: `INFO` (output, status, next state), `DEBUG` (adds how input/output processing changed the data: `afterInputPath`, `afterParameters`, `afterResultSelector`, `afterResultPath`, and for Map `afterItemSelector`, `afterItemBatcher`), `TRACE` (HTTP Task request/response).
- Since November 2025 `TestState` supports **mocks**: `--mock '{"result": "..."}'` or `{"errorOutput": {"error": "...", "cause": "..."}}`, which also lets you test **Map, Parallel, activities, `.sync` and `.waitForTaskToken`** states. With a mock, the role is optional. Mock shapes are validated against the AWS API model (`fieldValidationMode` STRICT by default).
- For errors, the response says which retrier or catcher applied (`retryIndex`, `catchIndex`), the backoff (`retryBackoffIntervalSeconds`) and `nextState`.
- You can pass a `context` and `--state-configuration '{"retrierRetryCount": 1}'` to simulate a later attempt.

**Example:**
```bash
aws stepfunctions test-state \
  --definition file://charge-state.json \
  --input '{"orderId":"o-881","amount":40}' \
  --mock '{"errorOutput":{"error":"Lambda.TooManyRequestsException","cause":"Rate exceeded"}}' \
  --state-configuration '{"retrierRetryCount":1}' \
  --inspection-level DEBUG
```

**What happens, step by step:** with a retrier of `IntervalSeconds 2, BackoffRate 2, MaxAttempts 3`, the call reports `status: RETRIABLE`, `retryIndex: 0` and `retryBackoffIntervalSeconds: 4` (2 × 2¹), proving the second retry waits 4 seconds. Raising `retrierRetryCount` to 3 shows `CAUGHT_ERROR` and the catcher's `nextState`. No Lambda was called and nothing was charged.

**Common mistake → fix:** testing only the happy path in a sandbox, so a missing `Catch` for a rare error is found in production. Fix: for every Task, mock each realistic error and assert the `nextState` and output.

**Interview answer:** "I unit-test states with the TestState API using mocked results and errors, so I can assert which Retry or Catch applies, the backoff and the data transformations without calling services. I validate definitions in CI, unit-test the Lambda code separately, and run integration tests in a sandbox account for IAM and real service behaviour."

**Follow-ups:**
- *Does the console support mocks?* The enhanced mocking is available through the CLI and SDKs, not yet the console.

---

### Q32. How does IAM work for Step Functions?

**Short answer:** There are three sets of permissions. The state machine's **execution role** controls what the workflow can call (specific Lambda ARNs, DynamoDB tables, `ecs:RunTask` plus `iam:PassRole`, and the extra events permissions that `.sync` needs). **Callers** need `states:StartExecution` on the state machine or alias. **Callback workers** need `states:SendTaskSuccess`, `SendTaskFailure` and `SendTaskHeartbeat`. Give each state machine its own least-privilege role.

**How it works:**
- The console can generate role policies from the definition, but review them.
- The role's trust policy must allow `states.amazonaws.com`.
- Distributed Map needs `states:StartExecution` and `states:DescribeExecution` on its own state machine and S3 access scoped to the dataset prefix.
- HTTP Tasks need `states:InvokeHTTPEndpoint`, `events:RetrieveConnectionCredentials` and Secrets Manager read on the connection secret.
- Redrive needs `states:RedriveExecution`; testing without mocks needs `iam:PassRole` and `states:TestState`.

**Example:**
```json
{
  "Effect": "Allow",
  "Action": "lambda:InvokeFunction",
  "Resource": [
    "arn:aws:lambda:eu-west-1:123456789012:function:classify-doc",
    "arn:aws:lambda:eu-west-1:123456789012:function:classify-doc:*"
  ]
}
```

**What happens, step by step:** the state machine invokes `classify-doc`; IAM checks the execution role against this statement and allows it. If a developer later adds a task calling `process-invoice` without updating the policy, that state fails at run time with `States.Permissions` (visible in the history), while the rest of the workflow is unaffected until it reaches that state.

**Common mistake → fix:** one shared role with `lambda:InvokeFunction` on `*` for every workflow. A bug or a compromised definition in one workflow can run any function in the account. Fix: one role per state machine, listing exact ARNs (and `:*` for versions and aliases when you invoke qualified ARNs).

**Interview answer:** "The execution role defines what the state machine can call, with exact resource ARNs, and `.sync` integrations need extra events permissions. Starters need states:StartExecution, and callback workers need SendTaskSuccess, Failure and Heartbeat. I keep one least-privilege role per state machine, scope Distributed Map's S3 access to its prefix, and expect missing permissions to show up as States.Permissions."

**Follow-ups:**
- *How do I stop anyone with a token from completing a task?* Tokens only work from the same account, but any principal with `states:SendTaskSuccess` can use one; limit that permission to your approval service.

---

### Q33. How do you keep secrets and personal data out of execution history?

**Short answer:** Step Functions records **the input and output of every state** in the execution history, visible to anyone with `states:GetExecutionHistory` or `DescribeExecution`, and (for Express or when enabled) in CloudWatch Logs. So **never pass secrets or raw personal data through state data**: pass **references** (a secret ARN, an S3 key), let tasks fetch secrets themselves, keep credentials for HTTP calls in EventBridge connections, restrict who can read history, and control logging detail.

**How it works:**
- Passing a reference means the history shows `"secretId": "prod/db"`, not the password.
- HTTP Task credentials live in the connection's Secrets Manager secret and aren't written into the state data.
- Restrict `states:GetExecutionHistory`, `states:DescribeExecution`, and the CloudWatch log group's read access.
- For CloudWatch Logs, choose the log level (`ALL`, `ERROR`, `FATAL`, `OFF`) and decide whether to include execution data (`includeExecutionData`).
- You can encrypt state machine and execution data with a customer managed KMS key; check the current documentation for exact scope before relying on it.
- Minimise personal data in names too: execution names appear in logs and consoles.

**Example:**
```json
"CallPartner": {
  "Type": "Task", "Resource": "arn:aws:states:::lambda:invoke",
  "Arguments": { "FunctionName": "call-partner",
                 "Payload": { "secretId": "prod/partner/api-key", "customerRef": "{% $states.input.customerRef %}" } },
  "Next": "Done"
}
```
The Lambda fetches the secret value itself (with caching) and the key never enters the workflow's data.

**What happens, step by step:** in the history, the `CallPartner` event shows `{"secretId": "prod/partner/api-key", "customerRef": "c-7"}`. A reviewer with read access to the history sees a pointer and an opaque ID, not the key or the customer's name and card number.

**Common mistake → fix:** a first state that receives `{"cardNumber": "4111…"}` as workflow input. It's stored in the history for 90 days and in logs. Fix: tokenise or store sensitive fields first (for example in an encrypted store) and start the workflow with a reference.

**Interview answer:** "Execution history stores every state's input and output, so I never put secrets or sensitive personal data into state data. I pass references like secret ARNs or S3 keys, let tasks fetch secrets themselves, store HTTP credentials in EventBridge connections, restrict who can read history and logs, reduce log detail where needed, and use customer managed keys for encryption where the requirement calls for it."

**Follow-ups:**
- *How long is history kept?* 90 days after a Standard execution closes; Express history exists only in CloudWatch Logs.

---

### Q34. How do you reason about Step Functions cost?

**Short answer:** **Standard** workflows are billed per **state transition** (each completed step, **including every retry**), so chatty loops and big Maps get expensive. **Express** workflows are billed per execution plus duration and memory, which suits high-volume short work. Waiting in a Standard workflow costs nothing in compute, but waiting inside a Lambda does. Reduce cost by using callbacks instead of polling, batching Map items, and putting high-volume inner loops in Express children.

**How it works (levers):**
- Replace `Wait` + status-check polling loops with `.sync` or callbacks.
- Use `ItemBatcher` so one iteration handles 20 items instead of one.
- Combine tiny sequential Pass/Task steps; use direct service integrations instead of Lambda "glue" (fewer billable Lambda invocations).
- Express for short, idempotent, high-volume work; Standard when you need exactly-once, `.sync`, callbacks or a long history.
- New accounts start with reduced transition quotas, and Standard has per-Region rate limits on transitions, which also affect throughput.

**Example (illustrative prices, for reasoning only):** a nightly job processes 50,000 documents.

| Design | Transitions | Notes |
|---|---|---|
| Standard inline per document, 8 states each | 400,000 | At an illustrative $0.025 per 1,000 → about **$10** |
| Distributed Map, batches of 20, Express children | ~2,500 child executions + parent states | Child cost per execution + duration, usually a small fraction |
| Polling every 5 s for 1 hour per document | 720 extra transitions per document | 50,000 × 720 = 36 million transitions → about **$900** |

**What happens, step by step:** the polling design looks harmless per document but multiplies: 720 loop transitions (Wait + status + Choice) per hour per document. Switching to a callback removes them entirely, leaving only the few real states.

**Common mistake → fix:** using a Standard workflow with 5 states for each of 20 million small events per day (100 million transitions). Fix: Express (or batch the events), or reconsider whether a workflow is needed.

**Interview answer:** "Standard is priced per state transition, including retries, so I avoid polling loops by using `.sync` or callbacks, batch Map items, and call services directly. Express is priced by executions and duration, so I use it for high-volume short idempotent work, often as children of a Standard parent. Compute isn't billed while a Standard execution waits, unlike waiting in Lambda."

**Follow-ups:**
- *Do retries cost money?* Yes, each retry counts as a state transition.

---

### Q35. How do you observe and alert on workflows?

**Short answer:** Use four views. The **console execution graph and event history** show exactly which state failed and why (Standard). **CloudWatch metrics** like `ExecutionsFailed`, `ExecutionsTimedOut` and `ExecutionThrottled` support alarms. **CloudWatch Logs** hold history for Express (and optionally Standard), at the level you choose. **EventBridge** emits "Step Functions Execution Status Change" events you can route to alerts or to a repair workflow. **X-Ray** tracing shows the path across Lambda and other services.

**How it works:**
- `ExecutionThrottled` reflects state-transition throttling.
- A timeout of a whole Standard execution raises `ExecutionsTimedOut`; catchers can't handle top-level failures, so subscribe to status-change events (for example `FAILED`, `TIMED_OUT`, `ABORTED`).
- Map Runs expose their own metrics and a Map Run page for per-item results.
- Add a correlation ID (the execution name) to Lambda logs to join them with the execution.
- For long waits, alarm on **executions open longer than expected** (a stuck callback).

**Example:**
```json
{
  "source": ["aws.states"],
  "detail-type": ["Step Functions Execution Status Change"],
  "detail": {
    "status": ["FAILED", "TIMED_OUT", "ABORTED"],
    "stateMachineArn": ["arn:aws:states:eu-west-1:123456789012:stateMachine:process-doc"]
  }
}
```

**What happens, step by step:** execution `doc-d42` fails at `ExtractFields`. EventBridge matches the rule and posts to an alerts topic with the execution ARN. The on-call opens the console graph, sees the red state and its `Cause`, fixes the permission, and uses redrive (see Q18). The `ExecutionsFailed` alarm also triggers a dashboard annotation.

**Common mistake → fix:** relying on `ExecutionsFailed` only, so an execution stuck for three days in a callback never alarms. Fix: alarm on the age of the oldest open execution, or on queue/DLQ depth for the callback path.

**Interview answer:** "For Standard I use the console graph and history for debugging, CloudWatch metrics such as ExecutionsFailed, TimedOut and Throttled for alarms, and EventBridge status-change events to route failures to alerts. Express needs CloudWatch Logs for history. X-Ray traces the path across services, and I propagate the execution name into downstream logs. I also alarm on executions that stay open too long."

**Follow-ups:**
- *What log level should I use?* `ERROR` or `FATAL` in production for volume and cost; `ALL` while debugging, being careful about sensitive data in the logs.

---

## 8. Scenario & debugging questions

### Q36. A workflow execution failed. How do you troubleshoot it?

**Short answer:** Open the execution, find the **red state**, read its **error and cause**, look at **that state's input**, then check the downstream service's logs. Most failures are one of: missing IAM permission, payload over 256 KiB, a bad JSONata expression or path, a timeout, or throttling without retry. Fix the cause and **redrive** (or start a new execution if the definition must change).

**Debugging steps:**
1. **Open the execution graph** (console) or call `GetExecutionHistory`. Check: which state is red, which state ran last. Meaning: tells you where the problem is, not why.
2. **Read `error` and `cause`.** Check: the exact error name. Meaning: `States.Permissions` = execution role; `States.DataLimitExceeded` = payload; `States.QueryEvaluationError` = JSONata expression; `States.Timeout` = slow/missing response; `States.Runtime` = a path or input shape problem; a service error name = the downstream service.
3. **Inspect the state input** in the history event. Check: is the data shape what the state expects (fields present, correct types)? Meaning: wrong input means the bug is in an earlier state's Output/Assign.
4. **Check the target's own logs.** For Lambda, search CloudWatch Logs by the request ID shown in the task result; for ECS, the task logs.
5. **Reproduce with `TestState`** using the recorded input and (optionally) mocks.
6. **Fix and recover.** Environment fix (IAM, quota, Lambda code) → redrive. Definition fix → start a new execution with the same input.

**Example:**
```text
State: ExtractFields   Error: States.QueryEvaluationError
Cause: "The JSONata expression '$states.input.pages[0].text' ... returned no value"
Input: {"docId": "d-42", "pages": []}
```
Meaning: the OCR step returned zero pages, so the expression for the first page's text is undefined.

**What happens, step by step:** you see the empty `pages` array in the input, trace it back to the OCR output, find the OCR job returned nothing for a scanned page, add a `Choice` that routes empty pages to `HumanReview`, publish a new version and start a new execution, because a definition change isn't picked up by redrive.

**Interview answer:** "I open the execution graph, find the red state, read the error name and cause, then check that state's input to see whether the data shape is wrong. Then I look at the target service's logs by request ID. The error name tells me the class: Permissions, DataLimitExceeded, QueryEvaluationError, Timeout or a service error. For environment fixes I redrive; for definition fixes I start a new execution."

**Follow-ups:**
- *Where is the failure when the error is `States.Runtime`?* Usually a path applied to a null or missing value; it is never retriable, so fix the data or definition.

---

### Q37. A Standard execution has been "Running" for days in a callback state. Why?

**Short answer:** The **task token was never returned**: the worker crashed, the message or notification was lost or sent to a DLQ, the token was stored incorrectly, or the approver never acted. Because there was no timeout, the task waits up to a year. Fix the immediate case by sending `SendTaskFailure` (or Success) for the stuck token or stopping the execution, and prevent it with timeouts and alarms.

**Debugging steps:**
1. **Find the state and token.** Check: the execution history for the task's scheduled event and the message that carried the token. Meaning: confirms what was supposed to happen next.
2. **Was the token delivered?** Check: the queue/topic metrics, consumer logs, and the DLQ. Meaning: a message in the DLQ or no consumption means the worker never got it.
3. **Was it stored correctly?** Check: the lookup record (e.g. `JobId → token`) in your database. Meaning: a missing or wrong record means the completion handler can't find the token.
4. **Was the callback sent?** Check: logs of the approval/completion service, and CloudTrail for `SendTaskSuccess`/`SendTaskFailure`. Meaning: an error such as `TaskTimedOut` or `InvalidToken` points to a stale or malformed token.
5. **Recover.** Call `SendTaskFailure` with a clear cause (so `Catch` runs), or `StopExecution`, then start again if safe.
6. **Prevent.** Add `TimeoutSeconds` (and `HeartbeatSeconds` for long work), a `Catch` that escalates or retries, a DLQ alarm for the callback queue, and an alarm on executions open longer than the expected maximum.

**Example:**
```bash
aws stepfunctions send-task-failure \
  --task-token "$TOKEN" --error "ManualAbort" --cause "Callback never arrived; cleaned up by operator"
```

**What happens, step by step:** the call fails the waiting task; its `Catch` routes to `EscalateReview`, which opens a ticket and notifies the owner. Had a timeout of 3 days been set, the same path would have run automatically on day 3.

**Interview answer:** "A stuck callback means the task token never came back: lost message, crashed worker, mis-stored token, or an approver who never acted. I trace delivery, storage and the callback call, then unblock it with SendTaskFailure or by stopping the execution. To prevent it, every callback task gets TimeoutSeconds and a Catch that escalates, heartbeats for long work, DLQ alarms and an alarm on long-open executions."

**Follow-ups:**
- *Can I recover the token if I didn't store it?* Not from `DescribeExecution`; read it from the execution history event's input if it was passed in the task parameters.

---

### Q38. Design a resilient pipeline for about 300 documents per minute (OCR, AI extraction, review)

**Short answer:** **Buffer, deduplicate, bound concurrency, wait without compute, and make every failure visible.** Put an SQS queue between uploads and the workflow; start executions with a name derived from the document hash; use idempotent job starts; wait for OCR with a callback; Map over pages with a concurrency cap sized to the model quota; send low-confidence results to a human; catch failures into a DLQ and alarm; redrive after fixes.

**How it works:**

```flow
pipeline: Resilient document pipeline for about 300 documents per minute
stage: 1. Intake
S3 upload of invoice-881.pdf, then EventBridge > One event per new document.
SQS queue and starter Lambda > The queue absorbs bursts; the starter calls StartExecution with name doc-ab12 (hash), so duplicates are ignored.
stage: 2. OCR without polling
RegisterJob: DynamoDB conditional put > Claims the document once (attribute_not_exists), so a duplicate can't register twice.
StartOCR with .waitForTaskToken, 30 minute timeout > Textract starts with ClientRequestToken = hash; the workflow pauses at no cost.
stage: 3. Extraction and review
ExtractFields: Map over pages, MaxConcurrency 8 > Model calls retry with backoff and jitter on throttling.
CheckQuality: Choice on confidence > Below 0.8 goes to HumanReview with a task token and a 3 day timeout.
stage: 4. Finish and failure
SaveResults, then publish DocumentProcessed > Result to S3 and DynamoDB, event to EventBridge.
Catch to MarkFailed, DLQ and alarm > A failed document is visible; redrive resumes it after the fix.
```

**Example sizing:** 300 documents/min = 5 per second. If each takes 6 minutes end to end (mostly waiting for OCR), about 1,800 executions are open at once, well inside the 1,000,000 open-execution limit. State transitions: ~15 per document → 4,500 per minute ≈ 75 per second, so check the Standard transition rate for your Region and request an increase if needed (new accounts start lower).

**What happens, step by step:** a bulk upload of 3,000 files in one minute fills the queue; the starter feeds Step Functions at its own pace. A duplicate S3 event for `invoice-881.pdf` produces the same execution name and is ignored. Textract throttles at 08:03, so extraction retries back off; no document is lost, they just take longer. One corrupt PDF fails five times, lands in `MarkFailed`, and an alarm fires; after the fix, redrive resumes from the failed state without re-running OCR.

**Common mistake → fix:** starting executions directly from every S3 event with no queue, so a burst exceeds `StartExecution` rate limits and drops starts. Fix: queue first, retry throttled starts with backoff, and request limit increases ahead of known peaks.

**Interview answer:** "I'd buffer uploads in SQS and start Standard executions with a name derived from the document hash for deduplication. The workflow registers the job with a conditional write, starts OCR with an idempotent token and waits on a callback with a timeout, maps over pages with a concurrency cap matched to the model quota and Retry with jitter, routes low-confidence results to human review, and catches failures into a DLQ with alarms. I size against state-transition and start-rate quotas and use redrive for recovery."

**Follow-ups:**
- *Express or Standard?* Standard: it needs callbacks, a human step, a long history and exactly-once registration.

---

### Q39. How do you serve a synchronous API that runs a 3-step workflow in under 10 seconds?

**Short answer:** Use an **Express** workflow started with **`StartSyncExecution`**, behind API Gateway (direct service integration) or called from Lambda. The call waits and returns the workflow's output. Keep each step's timeout short and the total below the API's timeout (API Gateway's default integration timeout is 29 seconds). If the work might take longer, switch to an asynchronous pattern: return 202 with a job ID and let the client poll or receive a callback.

**How it works:**
- Synchronous Express is **at-most-once** (it does not restart if an exception occurs), and it doesn't deduplicate by name, so make steps idempotent and let the caller retry safely.
- Express history exists only in CloudWatch Logs (turn logging on).
- Synchronous Express calls don't count against the account's Standard capacity limits and scale on demand, though surges may be throttled.
- From the console, a sync execution times out at 60 seconds; use the SDK or CLI for up to 5 minutes.

**Example:**
```json
{
  "Comment": "Quote API (Express)",
  "StartAt": "Validate",
  "TimeoutSeconds": 8,
  "States": {
    "Validate": { "Type": "Task", "Resource": "arn:aws:states:::lambda:invoke", "TimeoutSeconds": 2,
                  "Arguments": { "FunctionName": "validate", "Payload": "{% $states.input %}" },
                  "Output": "{% $states.result.Payload %}", "Next": "Price" },
    "Price":    { "Type": "Task", "Resource": "arn:aws:states:::lambda:invoke", "TimeoutSeconds": 3,
                  "Arguments": { "FunctionName": "price", "Payload": "{% $states.input %}" },
                  "Output": "{% $states.result.Payload %}", "Next": "Save" },
    "Save":     { "Type": "Task", "Resource": "arn:aws:states:::dynamodb:putItem", "TimeoutSeconds": 2,
                  "Arguments": { "TableName": "quotes", "Item": { "pk": { "S": "{% $states.input.quoteId %}" } } },
                  "Output": "{% $states.input %}", "End": true }
  }
}
```

```flow
sequence: Synchronous quote API with an Express workflow
actors: Client, API Gateway, Express workflow, Services
Client -> API Gateway: POST /quote with {"sku": "A1", "qty": 3}
API Gateway -> Express workflow: StartSyncExecution
Express workflow -> Services: validate (up to 2 s), price (up to 3 s), save to DynamoDB (up to 2 s)
Express workflow --> API Gateway: output {"quoteId": "q-9", "total": 41.7} after about 1.5 s
API Gateway --> Client: 200 OK with the quote
> The caller waits for the whole workflow; if it ran past the API's timeout, the client would get an error, so longer work must use an async job ID instead.
```

**What happens, step by step:** the three steps take 0.2, 0.9 and 0.3 seconds; total about 1.5 s and the client receives HTTP 200. If `price` hangs, its 3-second timeout fails the state, the whole 8-second execution timeout bounds the request, and API Gateway returns an error well before its 29-second limit.

**Common mistake → fix:** using a Standard workflow for this API. Standard has no synchronous start (you'd start it and poll), higher latency and per-transition cost. Fix: Express with `StartSyncExecution`.

**Interview answer:** "I'd use a synchronous Express workflow via StartSyncExecution, called from API Gateway or Lambda, with short per-state timeouts and an overall timeout below the API timeout. Sync Express is at-most-once and doesn't dedupe, so steps are idempotent and the client can retry. Anything that might run longer becomes an asynchronous workflow with a job ID and polling or a callback."

**Follow-ups:**
- *Where do I see what happened?* CloudWatch Logs, since Express doesn't keep history in Step Functions.

---

### Q40. A Map over 50,000 items is slow and expensive. What do you change?

**Short answer:** Move to **Distributed Map**, **batch** the items, run **Express** children for short work, read items from **S3** and write results with `ResultWriter`, set `MaxConcurrency` to what the downstream can take, tolerate a small failure percentage, and **redrive** failures. An inline Map over 50,000 items hits the 256 KiB payload limit, the 25,000-event history limit and about 40 concurrent iterations.

**Debugging steps:**
1. **Check the failure mode.** Check: is the execution failing with `States.DataLimitExceeded` or hitting the history limit (Q42), or just slow? Meaning: payload/history problems need Distributed Map; slowness may be only concurrency.
2. **Check concurrency.** Check: the Map's `MaxConcurrency` and the downstream's throttling metrics. Meaning: too low is slow; too high causes throttling and retries.
3. **Count transitions.** Check: transitions per item. Meaning: 50,000 × 6 states = 300,000 Standard transitions; batching 20 items per child cuts this by about 20×.
4. **Check where items come from.** Check: is a 50,000-element array passed through state data? Meaning: read from S3 with `ItemReader` instead.
5. **Check results.** Check: a huge returned array. Meaning: use `ResultWriter`.
6. **Apply and measure.**

**Example:** `ItemBatcher { MaxItemsPerBatch: 20 }`, `MaxConcurrency: 300`, `ToleratedFailurePercentage: 1`, Express children, results to `s3://results/run-42/` (full definition in Q28).

**What happens, step by step:** 50,000 items become 2,500 batches; 300 run at a time, so there are about 9 waves of children; per-child work is the Lambda call for 20 items. If the Lambda's own concurrency is the bottleneck, raising `MaxConcurrency` further only creates throttling, so tune `MaxConcurrency` to the Lambda's available concurrency.

**Interview answer:** "A 50,000-item inline Map breaks the payload and history limits and is capped at about 40 concurrent iterations. I switch to Distributed Map reading from S3, batch items so each child handles 20, use Express children for the short work, write results to S3, set MaxConcurrency to the downstream capacity, tolerate a small failure percentage, and redrive failed children."

**Follow-ups:**
- *How do I find which items failed?* The `ResultWriter` output groups results by status, and the Map Run page lists failed child executions.

---

### Q41. Step Functions, Lambda durable functions, an agent framework or SQS workers: how do you choose?

**Short answer:** Choose by **who owns the control flow**. Use **Step Functions** for visual, auditable workflows over many AWS services with long waits, approvals and declarative retries. Use **Lambda durable functions** when you'd rather write the workflow as ordinary code inside one function (checkpointed steps, waits up to a year). Use an **agent framework** when a model decides the next step at run time. Use **SQS plus workers** for simple, high-throughput background jobs with no multi-step state.

**How it works:**

| Need | Choose |
|---|---|
| Visual, auditable multi-service workflow, human approval, long waits, 220+ integrations, no code to maintain | **Step Functions** |
| Same capabilities but written in Python, Node.js or Java next to your application code, versioned with it | **Lambda durable functions** |
| LLM-driven loop with dynamic tool calls and conversation state | **Agent framework/runtime** (called as one task from a workflow if needed) |
| Independent background jobs, high throughput, simple retries | **SQS + workers** |

**Example:** order fulfilment: Step Functions orchestrates reserve → charge → ship → notify with compensation; the "ship" step calls a Lambda; a support-chat step calls an agent runtime as one task; image thumbnails are produced by SQS-driven workers outside the workflow.

**What happens, step by step:** if the product team wants to see each order's progress as a graph and auditors need history, Step Functions wins. If the engineering team needs a 6-step workflow that shares in-process helpers with the application and is already all Lambda, durable functions may be simpler. Different parts of one system can sensibly use different tools.

**Common mistake → fix:** forcing a model-driven agent loop into a state machine, or hand-building multi-step retries and waits on SQS. Fix: match the tool to who decides the steps and to how much durable state and visibility you need.

**Interview answer:** "If the steps are known and I want a graph, history, native integrations and approvals, I use Step Functions. If I want the same durability but as code inside Lambda, durable functions. If a model decides the next step, an agent framework, which I can call from a state machine as a single task. For simple independent jobs, SQS with workers is enough."

**Follow-ups:**
- *Can they be combined?* Yes, commonly: Step Functions for the process, an agent runtime for one reasoning step, SQS workers for bulk side jobs.

---

### Q42. An execution fails with a history-size error. What happened, and how do you fix it?

**Short answer:** A Standard execution's history is limited to **25,000 events**. Loops (polling every few seconds, a long `Wait` + `Choice` cycle, an inline Map with thousands of iterations) generate several events per pass and can reach the cap, which **fails the execution**. Fix by reducing events per unit of work and **splitting long-lived work across executions**: use callbacks instead of polling, a Distributed Map or child executions, or end the execution and start a fresh one.

**Debugging steps:**
1. **Count events.** Check: `GetExecutionHistory` (event count) or the console event view. Meaning: which state repeats most.
2. **Find the loop.** Check: Choice states that point backwards, inline Map sizes. Meaning: a loop of 4 states × 10 s polling for 8 hours = 11,520 events from polling alone.
3. **Choose the fix.** Polling → `.sync` or callback. Large Map → Distributed Map (children have their own histories). Endless/long-running loop → at the end of a "batch" of iterations start a **new execution** (a "continue as new" pattern) passing the carry-over state, using a deterministic name to avoid duplicates.
4. **Re-test** with realistic duration.

**Example:**
```json
"MaybeContinue": {
  "Type": "Choice",
  "Choices": [{ "Condition": "{% $states.input.iteration >= 500 %}", "Next": "StartFreshExecution" }],
  "Default": "DoOneUnit"
},
"StartFreshExecution": {
  "Type": "Task", "Resource": "arn:aws:states:::aws-sdk:sfn:startExecution",
  "Arguments": { "StateMachineArn": "arn:aws:states:eu-west-1:123456789012:stateMachine:poller:PROD",
                 "Input": { "iteration": 0, "cursor": "{% $states.input.cursor %}" } },
  "End": true
}
```

**What happens, step by step:** each unit of work produces about 20 events, so after about 1,250 units the history nears 25,000. Starting a new execution every 500 units keeps each history around 10,000 events and carries the cursor forward. Redrive can't rescue an execution that is near the cap, because it needs room for at least one more event (it requires fewer than 24,999).

**Common mistake → fix:** a "poll every 5 seconds until done" loop on a job that can take 10 hours. Fix: callback or `.sync`, which uses a handful of events.

**Interview answer:** "Standard executions are capped at 25,000 history events, so event-heavy loops can fail them. I count events to find the repeating section, then replace polling with `.sync` or callbacks, move big Maps to Distributed Map so children have their own histories, and for very long loops restart a fresh execution with the carry-over state. Redrive also needs spare capacity, so I design well below the cap."

**Follow-ups:**
- *Does Express have this limit?* No; Express history is unlimited but the execution itself is limited to 5 minutes.

---

## 9. Cheat sheet

| Concept | Remember |
|---|---|
| Step Functions | Serverless orchestrator: state machine (ASL JSON), executions, states, history |
| Standard vs Express | 1 year, exactly-once, per transition, history 90 days, `.sync` and callbacks vs 5 min, at-least-once (async) / at-most-once (sync), per execution + duration, logs only |
| State types | Task, Choice, Parallel, Map, Wait, Pass, Succeed, Fail |
| Task targets | Lambda, optimised integrations, AWS SDK integrations (200+ services), HTTP Task, activities |
| Data | JSONata: `Arguments`, `Output`, `Assign`, `$states.input/result/errorOutput/context`; JSONPath: five fields |
| Variables | `Assign` evaluates all expressions at state entry; inner Map/Parallel scope; 256 KiB each, 10 MiB total |
| Payload | 256 KiB per state input/output → pass S3 references; `States.DataLimitExceeded` isn't caught by `States.ALL` |
| History | 25,000 events (Standard); redrive needs under 24,999 |
| Retry defaults | IntervalSeconds 1, MaxAttempts 3, BackoffRate 2.0; add MaxDelaySeconds and `JitterStrategy: FULL` |
| Catch | First match wins; `States.ALL` last and alone; `States.TaskFailed` excludes `States.Timeout` |
| Integration patterns | Request Response, `.sync`, `.waitForTaskToken` (Standard only for the last two) |
| Task token | Capability; same-account only; set `TimeoutSeconds`/`HeartbeatSeconds`; verify the approver |
| Idempotent start | Execution name = business key (Standard); Express needs idempotent steps |
| Saga | Compensations in reverse, idempotent, retried |
| Redrive | Standard only, within 14 days, from the failed step, same definition |
| Parallel vs Map | Fixed different branches vs same steps per item |
| Distributed Map | Up to 10,000 child executions, S3 reader/writer, batching, tolerated failures |
| Versions/aliases | Immutable versions; alias splits up to two versions; in-flight executions keep their version |
| Testing | TestState API with mocks; validate definitions; sandbox integration tests |
| Security | Execution role least privilege; history shows all state data, so no secrets in state |
| Cost | Per transition (incl. retries) vs per execution + duration; avoid polling loops |

## Official references

- What is Step Functions: https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html
- Standard vs Express: https://docs.aws.amazon.com/step-functions/latest/dg/choosing-workflow-type.html
- JSONata: https://docs.aws.amazon.com/step-functions/latest/dg/transforming-data.html
- Variables: https://docs.aws.amazon.com/step-functions/latest/dg/workflow-variables.html
- Error handling: https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html
- Service integration patterns: https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html
- HTTP Task: https://docs.aws.amazon.com/step-functions/latest/dg/call-https-apis.html
- Activities: https://docs.aws.amazon.com/step-functions/latest/dg/concepts-activities.html
- Distributed Map: https://docs.aws.amazon.com/step-functions/latest/dg/state-map-distributed.html
- Redrive: https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html
- Versions and aliases: https://docs.aws.amazon.com/step-functions/latest/dg/concepts-state-machine-version.html
- TestState API: https://docs.aws.amazon.com/step-functions/latest/dg/test-state-isolation.html
- Quotas: https://docs.aws.amazon.com/step-functions/latest/dg/service-quotas.html
