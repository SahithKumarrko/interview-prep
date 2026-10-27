# AWS Lambda: Interview Preparation

> **Updated:** 27 October 2026 · **Level:** basics → invocation & concurrency → production patterns & newer compute types
> **How to use:** read the *Short answer* first, then *How it works* and the *Example* walkthrough. *Common mistake → fix* shows what goes wrong in real systems. *Interview answer* is what you can say out loud.

---

## Table of contents

1. [Mental model: how Lambda runs your code](#1-mental-model-how-lambda-runs-your-code)
2. [Fundamentals](#2-fundamentals) (Q01–Q09)
3. [Invocation models & event sources](#3-invocation-models--event-sources) (Q10–Q18)
4. [Concurrency, scaling & cold starts](#4-concurrency-scaling--cold-starts) (Q19–Q25)
5. [Packaging, versions & tooling](#5-packaging-versions--tooling) (Q26–Q31)
6. [Security & networking](#6-security--networking) (Q32–Q35)
7. [Long-running work & newer compute types](#7-long-running-work--newer-compute-types) (Q36–Q40)
8. [Observability](#8-observability) (Q41–Q42)
9. [Scenario & debugging questions](#9-scenario--debugging-questions) (Q43–Q48)
10. [Cheat sheet](#10-cheat-sheet)

---

## 1. Mental model: how Lambda runs your code

**The one idea everything else follows from:** you give AWS a function and say "run this when X happens". You never see a server. When an event arrives, Lambda finds (or creates) a small isolated machine called an **execution environment**, runs your code there for that one event, and then keeps the environment around for a while in case another event comes. If 50 events arrive at the same moment, Lambda runs 50 environments side by side. You pay for the number of requests and for how long your code runs, multiplied by the memory you chose.

Think of it like a taxi rank. Each taxi (environment) carries one passenger (event) at a time. When a passenger arrives and a taxi is waiting, they leave immediately (a **warm start**). When every taxi is busy, a new taxi has to be brought in and started first (a **cold start**), which takes longer. When it's quiet, idle taxis are sent away, so you don't pay for them.

```flow
pipeline: What happens when one event reaches Lambda
stage: 1. Find somewhere to run
Event arrives from API Gateway, SQS, S3… > Lambda looks for an idle, already-initialised environment for this exact function version.
Idle environment found? > Yes: skip straight to the handler (warm start). No: create a new one (cold start).
stage: 2. Cold start only
Create a Firecracker microVM, download code > Your zip or container image is loaded into a fresh, isolated micro virtual machine.
Init: start runtime and run code outside the handler > Imports, SDK clients and config are created once and kept for later events.
stage: 3. Every event
Invoke: handler(event, context) runs > One environment handles one event at a time (default compute type).
Environment is frozen, then reused or recycled > Globals and /tmp survive for the next event; AWS removes idle environments later.
```

**Three rules that come straight from this model:**
1. **Do expensive setup once, outside the handler.** SDK clients, database connections and loaded models are reused by every later event in that environment.
2. **Never keep per-request data in global variables.** The next event in that environment (possibly another user's) will see it.
3. **Every event can be delivered more than once.** Retries are built into async and queue-based invocations, so handlers must be safe to run twice (idempotent).

---

## 2. Fundamentals

### Q01. What is AWS Lambda and when should you use it?

**Short answer:** AWS Lambda is a **serverless compute service**: you upload code, connect it to something that produces events (an HTTP request, a queue message, a file upload, a schedule), and AWS runs it on demand. You don't manage servers, scaling or patching, and you pay only while code runs. The key rule: a single invocation can run for at most **15 minutes**, so Lambda suits short, event-driven work.

**How it works:**
1. You create a function (code + settings such as memory and timeout).
2. You connect a source: API Gateway, Amazon S3, Amazon SQS (Simple Queue Service), Amazon EventBridge and 200+ other AWS services can invoke Lambda.
3. Each event runs your handler in an isolated environment. Lambda adds environments when traffic grows and removes them when it drops, down to zero.
4. You're billed per request plus per millisecond of run time × configured memory.

**Example — good and poor fits:**

| Good fit | Poor fit |
|---|---|
| Resize an image when it's uploaded to S3 | A service that is busy 24/7 at steady load (containers are often cheaper) |
| An API with spiky traffic (quiet at night, busy at lunch) | Single jobs that run for hours (use ECS, AWS Batch or Step Functions) |
| Processing messages from a queue | Holding long-lived connections such as a WebSocket server |
| Scheduled clean-up jobs, glue between services | Heavy GPU work |
| A "tool" called by an AI agent | Paths that cannot tolerate occasional extra start-up latency |

**What happens, step by step (image resize):**
1. A user uploads `cat.jpg` to the `uploads` bucket.
2. S3 sends an event to the `resize-image` function.
3. Lambda starts or reuses an environment and runs the handler, which reads `cat.jpg`, makes a thumbnail and writes it to the `thumbnails` bucket. It takes 400 ms.
4. You pay for one request and 400 ms of run time. If nobody uploads for a week, you pay nothing for compute.

**Common mistake → fix:** putting a long, always-busy workload on Lambda "because serverless is cheaper". At constant high load, per-millisecond billing can cost more than a container that is always on. Fix: estimate cost at real traffic; for steady load consider ECS/Fargate or Lambda Managed Instances (see Q38).

**Interview answer:** "Lambda is AWS's serverless compute service: I give it a handler, connect an event source, and AWS runs it on demand, scales it automatically, and bills per request and per millisecond of run time. Each invocation can run for at most 15 minutes. It's ideal for event-driven, spiky or glue workloads; for long single jobs or steady 24/7 load I'd look at containers, Step Functions or Lambda Managed Instances."

**Follow-ups:**
- *Is Lambda really "serverless"?* There are servers, but AWS owns, patches and scales them; you never provision or see them.
- *What are "Event Functions"?* The AWS docs now call the classic Lambda function an **Event Function** to separate it from the newer Web Functions and MicroVMs (see Q40). The API (`CreateFunction`, `Invoke`) is unchanged.

---

### Q02. What is a Lambda function, an event and a trigger?

**Short answer:** A **function** is the Lambda resource you create: your code plus its configuration (runtime, memory, timeout, permissions). An **event** is a JSON document describing something that happened, which Lambda passes to your code as input. A **trigger** is the connection that makes a service send events to your function, for example "when a file lands in this bucket, invoke `resize-image`".

**How it works:**
- The function has a unique name and an **ARN** (Amazon Resource Name, AWS's global ID format), e.g. `arn:aws:lambda:eu-west-1:123456789012:function:resize-image`.
- Each source produces its own event shape. S3 sends bucket and key; API Gateway sends the HTTP method, path, headers and body; SQS sends a list of `Records`.
- A trigger is configured in one of two places: on the source service itself (S3 notifications, SNS subscriptions, API Gateway integrations push events to Lambda), or in Lambda as an **event source mapping** that pulls from a queue or stream (see Q11).

**Example — an S3 event (shortened):**
```json
{
  "Records": [{
    "eventName": "ObjectCreated:Put",
    "s3": {
      "bucket": { "name": "uploads" },
      "object": { "key": "photos/cat.jpg", "size": 48213 }
    }
  }]
}
```

**What happens, step by step:**
1. You add an S3 trigger on bucket `uploads`, event type "object created", prefix `photos/`.
2. Behind the scenes, S3 stores a notification rule, and Lambda adds a permission allowing `s3.amazonaws.com` to invoke the function.
3. A user uploads `photos/cat.jpg`. S3 builds the JSON above and invokes the function asynchronously.
4. Your handler reads `event["Records"][0]["s3"]["object"]["key"]` and gets `"photos/cat.jpg"`.

**Common mistake → fix:** writing a handler that assumes one record per event, e.g. `event["Records"][0]` only. S3, SQS and streams can deliver several records in one event, so the rest are silently skipped. Fix: always loop over `event["Records"]`.

**Interview answer:** "A function is my code plus configuration, identified by an ARN. An event is the JSON input describing what happened, and its shape depends on the source. A trigger connects a source to the function: push-based services like S3 or API Gateway invoke it directly, while queues and streams use an event source mapping inside Lambda that polls and sends batches."

**Follow-ups:**
- *Where do I find the event shape for a source?* The Lambda console has sample test events for each service, and the docs page for each integration shows one.

---

### Q03. What are the handler, the event and the context object?

**Short answer:** The **handler** is the one function in your code that Lambda calls for each event, e.g. `lambda_function.lambda_handler` in Python. It receives two arguments: **`event`**, the input data, and **`context`**, an object with information about this invocation such as the request ID and how many milliseconds are left before the timeout. Whatever the handler returns becomes the response for synchronous callers.

**How it works:**
- Code **outside** the handler runs once when the environment starts (the Init phase). Code **inside** runs on every event.
- `context.aws_request_id` uniquely identifies this invocation (useful in logs). `context.get_remaining_time_in_millis()` tells you how long you have left.
- For synchronous callers (API Gateway, a direct `Invoke`), the return value is sent back. For asynchronous callers (S3, EventBridge), the return value is ignored.

**Example:**
```python
import json, os, boto3

dynamodb = boto3.resource("dynamodb")                 # Init: runs once per environment
table = dynamodb.Table(os.environ["TABLE_NAME"])

def lambda_handler(event, context):                   # Invoke: runs per event
    print(f"request={context.aws_request_id} remaining_ms={context.get_remaining_time_in_millis()}")
    body = json.loads(event.get("body") or "{}")
    table.put_item(Item={"pk": body["orderId"], "status": "NEW"})
    return {"statusCode": 201, "body": json.dumps({"orderId": body["orderId"]})}
```

**What happens, step by step (two requests to a new environment, timeout 10 s):**
1. Request 1 arrives; there is no environment, so Lambda creates one and runs the top of the file: the DynamoDB resource and `table` are created.
2. Lambda calls `lambda_handler(event, context)`. `remaining_ms` prints about `9990`. The order `A1` is written; `{"statusCode": 201, ...}` goes back to API Gateway, which turns it into an HTTP 201.
3. Request 2 arrives 2 seconds later. The environment is warm, so the top of the file does **not** run again; `table` is reused. Only the handler runs, saving the time to create the client.

**Common mistake → fix:** creating clients inside the handler (`boto3.client("s3")` on every call). Every invocation pays the set-up cost again and opens new connections. Fix: create clients once at module level, as above.

**Interview answer:** "The handler is the entry point Lambda calls per event, with the event payload and a context object. The context gives me the request ID and remaining time, which I use for logging and to stop work gracefully before the timeout. Anything outside the handler runs once per environment, so that's where I create SDK clients and load configuration; the return value only matters for synchronous callers."

**Follow-ups:**
- *Can the Python handler be async?* The managed Python runtime calls a normal function; use `asyncio.run(...)` inside it if you need async code.
- *How do I avoid a hard timeout?* Check `get_remaining_time_in_millis()` in long loops and stop or checkpoint when it drops below a safety margin.

---

### Q04. What is an execution environment, and what is its lifecycle?

**Short answer:** An **execution environment** is the isolated, short-lived machine where your function runs: a Firecracker **microVM** (a very small, fast-starting virtual machine) containing the runtime, your code, any extensions and a `/tmp` disk. It goes through three phases: **Init** (start up, run code outside the handler), **Invoke** (run the handler, once per event, many times), and **Shutdown** (clean up when Lambda removes it). Between events it is **frozen**.

**How it works:**
1. **Init** has three parts: start extensions, start the runtime, run your static (outside-the-handler) code. For on-demand functions it is limited to **10 seconds**; if it doesn't finish, Lambda retries Init at the first invocation using the function timeout.
2. **Invoke** runs the handler for one event. The function timeout limits this phase.
3. After the handler returns, the environment is **frozen**: no CPU, but memory, globals and `/tmp` are kept.
4. The next event for the same version **thaws** and reuses it (a warm start).
5. **Shutdown** happens when the environment has been idle for a while, or every few hours anyway for maintenance. Extensions get up to 2,000 ms to flush data.
6. If an invocation crashes or times out, Lambda **resets** the environment; the next event triggers a fresh Init (a "suppressed init" that shows up inside the next invocation's duration).

**Example:**
```python
import time
started_at = time.time()          # Init
calls = 0                         # Init

def lambda_handler(event, context):
    global calls
    calls += 1
    return {"calls_in_this_env": calls, "env_age_s": round(time.time() - started_at)}
```

**What happens, step by step:**

```flow
trace: One environment serving three events
Init: started_at = 10:00:00, calls = 0 > Runs once, when the first event needs a new environment.
event 1 at 10:00:00: calls = **1**, env_age_s = 0 > The handler increments the global.
frozen > No CPU while idle; memory is kept.
event 2 at 10:00:30: calls = **2**, env_age_s = 30 > Warm start: the same environment is thawed, so the global still holds 1 and becomes 2.
event 3 arrives while event 2 is still running > This environment is busy, so Lambda creates a second environment, which starts again at calls = 1.
```

1. The first event creates the environment and runs Init: `calls = 0`. The handler returns `{"calls_in_this_env": 1, "env_age_s": 0}`.
2. Thirty seconds later, a second event reuses the frozen environment and returns `2, 30`.
3. If two events arrive at the same moment, the second goes to a **different** environment with its own `calls`, so you'll see `1` there. Globals are per environment, never shared across environments.

**Common mistake → fix:** using a global as a counter or cache that must be correct across the whole function ("total orders today"). Each environment has its own copy and environments are recycled without warning. Fix: keep shared state in DynamoDB, ElastiCache or similar; use globals only as a per-environment cache.

**Interview answer:** "An execution environment is a Firecracker microVM holding the runtime, my code and extensions. It goes through Init, which starts the runtime and runs my static code and is capped at 10 seconds for on-demand functions; then many Invoke phases, one event at a time, frozen in between; then Shutdown. Globals and /tmp survive between invokes in the same environment, which is why I initialise clients once, but each concurrent request gets its own environment, so globals aren't shared state."

**Follow-ups:**
- *Is Init time billed?* Yes. AWS standardised billing so the Init phase is charged as part of duration.
- *Does the 10-second Init limit always apply?* No: functions using provisioned concurrency, SnapStart or Managed Instances can initialise for longer (up to 15 minutes).
- *Do background threads keep running after the handler returns?* No. They're paused with the freeze and resume on the next invocation, so finish work before returning.

---

### Q05. What is a runtime, and should you deploy a zip file or a container image?

**Short answer:** A **runtime** is the language environment that loads your code and calls your handler: Lambda provides **managed runtimes** for Python, Node.js, Java, .NET and Ruby, and **OS-only runtimes** (`provided.al2023`) for languages like Go and Rust that compile to a binary. You can ship code as a **.zip file** (up to 250 MB unzipped, including layers) or as a **container image** (up to 10 GB) stored in Amazon ECR (Elastic Container Registry). Both use the same execution model, limits and scaling.

**How it works:**
- With a zip, you choose a managed runtime (e.g. `python3.13`) and AWS patches the runtime for you.
- With an image, you build from an AWS base image (which includes the runtime interface client) or your own base image, and you are responsible for rebuilding to pick up patches.
- AWS **deprecates** runtimes when the language version reaches end of life. After deprecation, you can no longer get security patches and later can't create or update functions on it.

**Example:**

| | Zip file | Container image |
|---|---|---|
| Max size | 50 MB zipped direct upload (larger via S3); 250 MB unzipped incl. layers | 10 GB uncompressed |
| Runtime patching | AWS patches managed runtimes automatically | You rebuild the image |
| Shared libraries | Layers (see Q26) | Image layers in your Dockerfile |
| Good for | Small/medium functions, fast iteration | Large dependencies (ML libraries), existing Docker build pipelines |

```dockerfile
FROM public.ecr.aws/lambda/python:3.13
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY app.py .
CMD ["app.lambda_handler"]
```

**What happens, step by step (image deploy):**
1. CI builds the image above and pushes it to ECR as `extract:1.4.0`.
2. You update the function to that image URI. Lambda optimises and caches the image.
3. On a cold start, Lambda loads the image layers it needs, starts the Python runtime and imports `app`.
4. `CMD` tells the runtime that the handler is `app.lambda_handler`.

**Common mistake → fix:** a zip with `numpy`, `pandas` and `scikit-learn` built on a Mac fails with "invalid ELF header". The compiled parts were built for macOS, but Lambda runs Amazon Linux. Fix: build dependencies for Linux (in a Lambda base container, or `pip install --platform manylinux2014_x86_64 --only-binary=:all:`), or switch to a container image.

**Interview answer:** "A runtime is the language environment that loads my code and calls the handler. I use managed runtimes when possible because AWS patches them, and I keep functions upgraded before runtimes are deprecated. Zip deployments are limited to 250 MB unzipped including layers, so for heavy dependencies like ML libraries I use a container image of up to 10 GB, accepting that I must rebuild it to pick up patches."

**Follow-ups:**
- *Do container images cold-start slower?* Not necessarily; Lambda caches image chunks. Start-up depends more on what your code loads than on the format.
- *x86_64 or arm64?* Arm64 (Graviton) is cheaper per GB-second and often faster; test native dependencies before switching.

---

### Q06. How do memory, CPU, timeout and ephemeral storage work?

**Short answer:** You choose **memory** from 128 MB to 10,240 MB, and Lambda gives CPU **in proportion** to memory (about one full vCPU at 1,769 MB). The **timeout** is 1 second to 900 seconds (15 minutes). The `/tmp` disk (**ephemeral storage**) is 512 MB to 10,240 MB. The key rule: more memory can be **cheaper**, because the function also gets more CPU and may finish much faster.

**How it works:**
- Cost per invocation ≈ memory (GB) × duration (seconds) × price per GB-second.
- For CPU-bound work, doubling memory roughly doubles CPU, so duration can halve. Cost stays the same and latency drops.
- For I/O-bound work (waiting on an API), more memory doesn't help; the function is waiting, not computing.
- Payload limits: **6 MB** each for synchronous request and response, **1 MB** for asynchronous events, and up to **200 MB** for streamed responses.

**Example (illustrative timings for a CPU-bound PDF parse):**

| Memory | Duration | GB-seconds per call |
|---|---|---|
| 512 MB | 4,000 ms | 0.5 × 4.0 = **2.0** |
| 1,024 MB | 1,900 ms | 1.0 × 1.9 = **1.9** |
| 2,048 MB | 1,000 ms | 2.0 × 1.0 = **2.0** |

**What happens, step by step:**
1. At 512 MB the function gets a fraction of a vCPU, so parsing takes 4 seconds and costs 2.0 GB-s.
2. At 1,024 MB it has about twice the CPU: 1.9 s and 1.9 GB-s — faster **and** slightly cheaper.
3. At 2,048 MB it takes 1 s and costs 2.0 GB-s — 4× faster than the start for the same cost.
4. Above about 1,769 MB the function has more than one vCPU; single-threaded code stops getting faster, so the curve flattens. Measure with the open-source **AWS Lambda Power Tuning** tool instead of guessing.

**Common mistake → fix:** leaving the 3-second default timeout on a function that calls a slow API, or setting 900 seconds "to be safe". The first fails randomly; the second lets a stuck call run (and bill) for 15 minutes. Fix: set the timeout a little above the real p99 duration, and give every outbound call its own shorter timeout.

**Interview answer:** "Memory is the main dial: 128 MB to about 10 GB, and CPU scales with it, reaching one vCPU around 1,769 MB. Because cost is memory times duration, giving a CPU-bound function more memory often makes it faster at the same or lower cost, so I tune with Lambda Power Tuning. The timeout goes up to 15 minutes and I set it just above real p99; /tmp is configurable from 512 MB to 10 GB."

**Follow-ups:**
- *Is `/tmp` shared between invocations?* Only within the same environment, so it's a cache, not storage.
- *What if API Gateway calls the function?* API Gateway's integration timeout (29 seconds by default) ends the HTTP request even if the function timeout is longer.

---

### Q07. What is the execution role, and how is it different from the resource-based policy?

**Short answer:** Lambda has two kinds of permissions. The **execution role** is an IAM (Identity and Access Management) role the function **assumes** when it runs; it controls what your code **can do** (read S3, write DynamoDB, write logs). The **resource-based policy** is attached to the function; it controls **who can invoke** it (API Gateway, S3, another account). Missing either one gives an "Access Denied" error at a different point.

**How it works:**
1. When an environment starts, Lambda assumes the execution role and puts temporary credentials into the environment. The AWS SDK picks them up automatically.
2. When a service like S3 wants to invoke the function, Lambda checks the function's resource-based policy for a statement allowing `lambda:InvokeFunction` for that principal.
3. **Event source mappings** are different: Lambda itself reads from SQS, Kinesis or DynamoDB Streams **using the execution role**, so the role needs `sqs:ReceiveMessage`, `sqs:DeleteMessage` and `sqs:GetQueueAttributes`.

**Example:**
```json
// Execution role policy: what the function can do
{ "Effect": "Allow",
  "Action": ["dynamodb:PutItem"],
  "Resource": "arn:aws:dynamodb:eu-west-1:123456789012:table/orders" }
```
```bash
# Resource-based policy: allow S3 bucket "uploads" to invoke the function
aws lambda add-permission --function-name resize-image \
  --statement-id s3-uploads --action lambda:InvokeFunction \
  --principal s3.amazonaws.com \
  --source-arn arn:aws:s3:::uploads --source-account 123456789012
```

```flow
sequence: Two permission checks for one upload
actors: S3, Lambda service, Function, DynamoDB
S3 -> Lambda service: invoke resize-image (object uploads/cat.jpg)
Lambda service -> Lambda service: check resource-based policy: is s3.amazonaws.com from bucket uploads allowed?
Lambda service -> Function: yes, run the handler with the execution role's credentials
Function -> DynamoDB: PutItem on table orders
DynamoDB --> Function: allowed, because the execution role grants dynamodb:PutItem on orders
> The first check decides who may call the function; the second decides what the running code may touch.
```

**What happens, step by step:** if the `add-permission` call is missing, S3's invocation is refused and the function never runs (nothing in the function's logs). If the role lacks `dynamodb:PutItem`, the function runs but the SDK raises `AccessDeniedException` inside your handler, visible in the logs.

**Common mistake → fix:** giving the execution role `"Action": "*", "Resource": "*"` to "get it working". Any bug or injected input can then touch every resource in the account. Fix: one role per function, listing only the actions and resource ARNs that function uses.

**Interview answer:** "The execution role is what the function can do; Lambda assumes it and the SDK uses its temporary credentials. The resource-based policy is who can invoke the function, such as S3, API Gateway or another account. Event source mappings poll using the execution role, so for SQS the role needs receive and delete permissions. I give each function its own least-privilege role."

**Follow-ups:**
- *How do I allow another AWS account to invoke my function?* Add a resource-based policy statement with that account as the principal; the caller also needs `lambda:InvokeFunction` in its own identity policy.

---

### Q08. How should a function get its configuration and secrets?

**Short answer:** Use **environment variables** for non-secret settings like table names and log levels (they're key-value pairs set on the function, encrypted at rest, up to 4 KB in total). Use **AWS Secrets Manager** or **Systems Manager Parameter Store** for secrets and shared configuration, fetch them at start-up or first use, and **cache** them. Never put secrets in code or in plain-text environment variables.

**How it works:**
- Environment variables are fixed for a published version and readable by anyone who can view the function's configuration.
- Secrets Manager stores encrypted secrets with rotation; Parameter Store holds hierarchical parameters (`/prod/orders/table`).
- Fetching on every invocation adds latency and API cost; caching in a global (with a time-to-live) or with the **AWS Parameters and Secrets Lambda Extension** avoids that.

**Example:**
```python
import os, time, json, boto3
TABLE = os.environ["TABLE_NAME"]                     # non-secret config
sm = boto3.client("secretsmanager")
_cache = {"value": None, "expires": 0}

def db_password():
    if time.time() > _cache["expires"]:
        resp = sm.get_secret_value(SecretId="prod/orders/db")
        _cache["value"] = json.loads(resp["SecretString"])["password"]
        _cache["expires"] = time.time() + 300        # cache for 5 minutes
    return _cache["value"]
```

**What happens, step by step:**
1. First invocation in a new environment: the cache is empty, so the function calls Secrets Manager once (around tens of milliseconds) and stores the password with an expiry 5 minutes later.
2. The next 1,000 invocations in that environment during those 5 minutes read the cached value with no API call.
3. After 5 minutes the next call refreshes it, which also picks up a rotated password.

**Common mistake → fix:** calling `get_secret_value` inside every invocation. At 200 requests per second that's 200 API calls per second, extra latency and possible throttling. Fix: cache with a TTL as above, or use Powertools `parameters` or the Lambda extension.

**Interview answer:** "Non-secret config goes in environment variables, which are encrypted at rest and limited to 4 KB. Secrets go in Secrets Manager or Parameter Store; I fetch them on first use, cache them per environment with a short TTL so rotation is picked up, and grant the role `secretsmanager:GetSecretValue` only on that secret's ARN. For dynamic feature flags I'd use AWS AppConfig."

**Follow-ups:**
- *What if the secret rotates while it's cached?* On an authentication failure, refresh the cache once and retry (see the Secrets Manager course, caching and rotation).

---

### Q09. How is Lambda priced?

**Short answer:** You pay for **requests** (a small charge per million invocations) and for **duration**, measured in **GB-seconds**: memory in GB × run time in seconds, billed per millisecond. Extras are charged separately: provisioned concurrency, ephemeral storage above 512 MB, data transfer, and features like SnapStart for Python/.NET. Arm64 (Graviton) duration is cheaper than x86.

**How it works:** the formula is `requests × request price + (memory GB × seconds × invocations) × GB-second price`. Time spent **waiting** (for an LLM, an HTTP call, a database) is billed the same as time spent computing.

**Example (illustrative prices; check the pricing page for your Region):** 3 million requests per month, 512 MB, 400 ms average, x86.

**What happens, step by step:**
1. Requests: 3,000,000 × $0.20 per million = **$0.60**.
2. GB-seconds: 3,000,000 × 0.4 s × 0.5 GB = **600,000 GB-s**.
3. Duration: 600,000 × about $0.0000167 per GB-s ≈ **$10.00**.
4. Total ≈ **$10.60** per month, before free tier, logs and data transfer. If the average duration grows to 2 s because a downstream API is slow, the duration charge becomes about $50 even though your code is doing nothing more.

**Common mistake → fix:** a function that waits 10 minutes for a long job (e.g. polling a document-analysis job) bills 10 minutes of memory for each wait. Fix: start the job asynchronously and let a completion event trigger the next function, or use a Step Functions wait / durable function wait, which doesn't bill compute while waiting.

**Interview answer:** "Lambda bills per request plus GB-seconds, which is memory times duration, billed per millisecond, with arm64 cheaper than x86. Waiting time is billed like compute, so for long waits I use asynchronous service APIs, Step Functions or durable-function waits. I tune memory with Power Tuning, because more memory sometimes lowers total cost."

**Follow-ups:**
- *Is the cold-start Init phase billed?* Yes, Init duration is billed.
- *How are Managed Instances priced?* On EC2 instance pricing plus a management fee (see Q38), not per request duration.

---
## 3. Invocation models & event sources

### Q10. What are the three ways Lambda can be invoked: synchronous, asynchronous and event source mapping?

**Short answer:** **Synchronous** (`RequestResponse`): the caller waits for the result, and if it fails the **caller** decides whether to retry (API Gateway, a direct SDK call). **Asynchronous** (`Event`): Lambda puts the event in its own internal queue, replies "202 Accepted" immediately, and **retries for you** (S3, SNS, EventBridge). **Event source mapping (poll-based)**: Lambda **reads** batches from a queue or stream and invokes your function with them (SQS, Kinesis, DynamoDB Streams, Kafka). The invocation type decides who retries, and where failed events end up.

**How it works:**

| | Synchronous | Asynchronous | Event source mapping |
|---|---|---|---|
| Typical sources | API Gateway, ALB, function URL, SDK `Invoke` | S3, SNS, EventBridge, SDK with `InvocationType=Event` | SQS, Kinesis, DynamoDB Streams, MSK/Kafka, Amazon MQ, DocumentDB |
| Caller gets | The function's result or error | 202 immediately | Nothing; Lambda is the caller |
| Retries by Lambda | None | 2 more attempts by default (configurable 0–2) | SQS: message reappears after visibility timeout; streams: retry the batch until success or expiry |
| Where failures go | Back to the caller | On-failure destination or DLQ (dead-letter queue) | SQS: the queue's own DLQ; streams: on-failure destination |
| Payload limit | 6 MB request / 6 MB response | 1 MB | 6 MB per batch |

**Example:**
```bash
# synchronous: wait for the answer
aws lambda invoke --function-name price-quote --payload '{"sku":"A1"}' \
  --cli-binary-format raw-in-base64-out out.json

# asynchronous: fire and forget, returns StatusCode 202
aws lambda invoke --function-name price-quote --invocation-type Event \
  --payload '{"sku":"A1"}' --cli-binary-format raw-in-base64-out out.json
```

```flow
sequence: The same failing function under two invocation types
actors: Caller, Lambda service, Function
Caller -> Lambda service: synchronous invoke {"sku":"A1"}
Lambda service -> Function: run handler
Function --> Caller: error returned at once; the caller must decide to retry
Caller -> Lambda service: asynchronous invoke {"sku":"A1"}
Lambda service --> Caller: 202 Accepted, event stored in Lambda's internal queue
Lambda service -> Function: attempt 1 fails; Lambda waits about 1 minute
Lambda service -> Function: attempt 2 fails; Lambda waits about 2 minutes
Lambda service -> Function: attempt 3 fails; event sent to the on-failure destination, or dropped if none
> With a synchronous call, retries are your job. With an asynchronous call, Lambda retries twice for you and then needs a destination to keep the event.
```

**What happens, step by step:** in the synchronous call, `out.json` contains the error and the CLI exit shows `FunctionError: Unhandled`. In the asynchronous call, `out.json` is empty and the response is `StatusCode: 202`, even though the function will fail three times in the background.

**Common mistake → fix:** treating a 202 from an asynchronous invoke as "it worked". It only means "queued". Fix: configure an on-failure destination and alarm on it (see Q12), or invoke synchronously if you need the result.

**Interview answer:** "Lambda has three invocation models. Synchronous: the caller waits and handles retries. Asynchronous: Lambda queues the event, returns 202 and retries twice by default before sending it to an on-failure destination or DLQ. Event source mappings: Lambda polls SQS, Kinesis, DynamoDB Streams or Kafka and invokes with batches, and failure handling is the queue's DLQ or the stream's retry and bisect settings. The model tells me who retries and where failures land."

**Follow-ups:**
- *Is an event source mapping invocation synchronous or asynchronous?* The poller invokes your function synchronously, but from the producer's point of view the whole thing is asynchronous.

---

### Q11. What is an event source mapping?

**Short answer:** An **event source mapping** (ESM) is a Lambda resource that **polls** a queue or stream for you and invokes your function with **batches** of records. You create it in Lambda (not on the source), choose a batch size and batching window, and Lambda runs the pollers. It's used for Amazon SQS, Kinesis, DynamoDB Streams, Amazon MSK and self-managed Kafka, Amazon MQ and Amazon DocumentDB.

**How it works:**
1. Lambda runs **event pollers** that read from the source using your function's execution role.
2. The poller collects records until one of three things happens: the **batch size** is reached, the **batching window** (`MaximumBatchingWindowInSeconds`, 0–300 s) expires, or the payload reaches **6 MB**.
3. It invokes your function with the batch and waits for the result.
4. On success it moves on (deletes SQS messages, or advances the stream position). On failure it follows the source's retry rules.
5. You can add **filter criteria** so only matching records invoke the function, and for SQS and Kafka you can use **provisioned mode** (a minimum and maximum number of dedicated pollers) for faster, more predictable scaling.

**Example:**
```bash
aws lambda create-event-source-mapping \
  --function-name process-orders \
  --event-source-arn arn:aws:sqs:eu-west-1:123456789012:orders \
  --batch-size 50 \
  --maximum-batching-window-in-seconds 5 \
  --function-response-types ReportBatchItemFailures \
  --filter-criteria '{"Filters":[{"Pattern":"{\"body\":{\"type\":[\"ORDER_PLACED\"]}}"}]}'
```

**What happens, step by step (12 messages arrive over 2 seconds, then the queue is quiet):**
1. The poller long-polls the `orders` queue and receives the first messages.
2. It keeps collecting because neither 50 messages nor 6 MB has been reached and the 5-second window is still open.
3. At 5 seconds the window closes with 12 messages. Messages whose body `type` isn't `ORDER_PLACED` are filtered out (and deleted from the queue); say 10 remain.
4. Lambda invokes `process-orders` once with `Records` containing 10 messages.
5. The handler returns no failures, so Lambda deletes those 10 messages from the queue.

**Common mistake → fix:** creating an SQS trigger but forgetting `sqs:ReceiveMessage`/`sqs:DeleteMessage` on the execution role. Creating the mapping fails (or it shows a permissions error), because the poller uses the function's role. Fix: attach `AWSLambdaSQSQueueExecutionRole` or equivalent scoped permissions.

**Interview answer:** "An event source mapping is a Lambda-managed poller for queues and streams like SQS, Kinesis, DynamoDB Streams and Kafka. It reads records with my function's execution role, batches them by size, time window or the 6 MB limit, invokes my function synchronously, and then deletes or checkpoints on success. I can filter events before invocation and, for SQS and Kafka, use provisioned mode for dedicated pollers."

**Follow-ups:**
- *Do filtered-out SQS messages stay in the queue?* No. Lambda deletes messages that don't match the filter, so filter only what you truly want to ignore.
- *ESM vs direct trigger?* Direct triggers (S3, SNS, API Gateway) are stored on the source and push events; an ESM is stored in Lambda and pulls.

---

### Q12. How do retries, dead-letter queues and destinations work for asynchronous invocation?

**Short answer:** For an asynchronous invocation, Lambda keeps the event in an internal queue and, if your function returns an error, **retries twice more by default** (configurable 0–2), waiting about 1 minute and then 2 minutes. Events can also wait up to **6 hours** (the default maximum event age) if the function is throttled. When retries or the maximum age run out, Lambda sends the event to an **on-failure destination** or a **dead-letter queue (DLQ)** if you set one, and **discards it otherwise**.

**How it works:**
- **Function errors** (exception, timeout): up to 2 retries.
- **Throttles (429) and system errors (5xx)**: the event goes back to the queue and is retried with exponential backoff (from 1 s up to 5 minutes) until the maximum event age, configurable from 60 seconds to 6 hours.
- **On-failure destination**: SQS, SNS, S3, another Lambda function or an EventBridge bus. It receives an **invocation record**: the original event plus the error, the condition (`RetriesExhausted` or `EventAgeExceeded`) and the attempt count.
- **On-success destination**: SQS, SNS, Lambda or EventBridge, useful for chaining.
- **DLQ** (older feature): a standard SQS queue or SNS topic that receives only the event, without error details.

**Example:**
```bash
aws lambda put-function-event-invoke-config --function-name send-receipt \
  --maximum-retry-attempts 1 \
  --maximum-event-age-in-seconds 3600 \
  --destination-config '{"OnFailure":{"Destination":"arn:aws:sqs:eu-west-1:123456789012:receipt-failures"}}'
```

**What happens, step by step (the email provider is down for 20 minutes):**
1. 10:00:00 — EventBridge invokes `send-receipt` asynchronously for order `A12`. The function raises `ConnectionError`.
2. About 10:01 — retry 1 (the only one, because we set 1). It fails again.
3. Retries are exhausted, so Lambda sends an invocation record to `receipt-failures` with `"condition": "RetriesExhausted"`, `"approximateInvokeCount": 2` and the error message.
4. An alarm on the queue depth fires; once the provider recovers, an operator (or a redrive function) replays the record.
5. Without the destination, step 3 would simply drop the event, and the only trace would be the `Errors` metric and logs.

**Common mistake → fix:** putting a DLQ on the function when the source is SQS. For an SQS event source mapping, the function's async DLQ is never used. Fix: set a redrive policy with `maxReceiveCount` on the **source queue** itself.

**Interview answer:** "For async invocations Lambda retries function errors twice by default, with about one and two minutes between attempts, and retries throttles with backoff for up to six hours of event age. Both are configurable. When an event finally fails, Lambda sends it to an on-failure destination, which carries the error details, or to a legacy DLQ, otherwise it's discarded. I always configure an on-failure destination and alarm on it, and make the handler idempotent because retries cause duplicates."

**Follow-ups:**
- *Why prefer destinations over DLQs?* Destinations support more targets and include the error and response context; DLQs hold only the event.
- *Can async events be delivered twice even without errors?* Yes. The internal queue is eventually consistent, so duplicates are possible; design for idempotency (see Q16).

---

### Q13. Which settings matter when Lambda processes an SQS queue?

**Short answer:** Five settings decide whether an SQS-driven function is reliable: the queue's **visibility timeout** (at least **6×** the function timeout), the **batch size and batching window**, **partial batch responses** so one bad message doesn't retry the whole batch, a **DLQ on the queue** with `maxReceiveCount` (AWS recommends at least 5), and **maximum concurrency** on the event source mapping to protect downstream systems.

**How it works:**
- When Lambda receives a batch, the messages stay in the queue but are **hidden** for the visibility timeout. If the function doesn't finish in time, they reappear and can be processed twice. Lambda refuses to create the mapping if the function timeout exceeds the visibility timeout; the 6× guidance leaves room for throttling retries. With a batching window, add the window to it.
- Standard queues allow a batch size up to **10,000** (with a batching window of at least 1 s above 10); FIFO queues allow up to **10**.
- By default the mapping starts with 5 concurrent invocations, adds up to 300 more per minute, and stops at **1,250** concurrent invocations per mapping. **Maximum concurrency** (2–1,000) caps it lower; **provisioned mode** raises the ceiling and scaling speed (they can't be combined).
- FIFO queues keep order **per message group**, so concurrency can't exceed the number of active message groups.

**Example:**
```yaml
# AWS SAM (illustrative)
OrdersQueue:
  Type: AWS::SQS::Queue
  Properties:
    VisibilityTimeout: 185            # 6 × 30 s timeout + 5 s batching window
    RedrivePolicy:
      deadLetterTargetArn: !GetAtt OrdersDLQ.Arn
      maxReceiveCount: 5
ProcessOrders:
  Type: AWS::Serverless::Function
  Properties:
    Timeout: 30
    Events:
      Orders:
        Type: SQS
        Properties:
          Queue: !GetAtt OrdersQueue.Arn
          BatchSize: 20
          MaximumBatchingWindowInSeconds: 5
          FunctionResponseTypes: [ReportBatchItemFailures]
          ScalingConfig: { MaximumConcurrency: 20 }
```

**What happens, step by step (a burst of 10,000 messages):**
1. Lambda starts with 5 concurrent invocations of 20 messages each.
2. The queue is still full, so it scales up, but stops at **20** concurrent invocations because of `MaximumConcurrency`. The database behind the function sees at most 20 writers.
3. Each batch is hidden for 185 s. A normal batch finishes in about 8 s and is deleted.
4. One message with a malformed body fails every time. Thanks to partial batch responses only that message returns; after 5 receives SQS moves it to `OrdersDLQ`.

**Common mistake → fix:** visibility timeout 30 s with function timeout 30 s. A batch that takes 29 s plus a throttled retry reappears while still in progress, and another environment processes it again. Fix: visibility timeout ≥ 6 × function timeout + batching window.

**Interview answer:** "For SQS I set the queue's visibility timeout to at least six times the function timeout plus the batching window, enable ReportBatchItemFailures, put a DLQ on the source queue with maxReceiveCount of at least 5, and tune batch size and window for throughput. I cap the event source mapping's maximum concurrency to protect downstream systems; by default one mapping can scale to 1,250 concurrent invocations, and provisioned mode goes beyond that. FIFO queues limit concurrency to the number of message groups."

**Follow-ups:**
- *Maximum concurrency vs reserved concurrency?* Maximum concurrency limits one queue's mapping without throttling; reserved concurrency limits the whole function and causes throttles. If you use both, reserved must be at least the sum of all mappings' maximum concurrency.

---

### Q14. What is a partial batch response, and why does it matter?

**Short answer:** By default, if your function throws an error while processing an SQS batch, **every** message in the batch becomes visible again and is retried, including the ones that succeeded. A **partial batch response** lets your function return only the IDs of the messages that failed (`batchItemFailures`), so only those are retried. You turn it on with `FunctionResponseTypes: ReportBatchItemFailures` on the event source mapping.

**How it works:**
1. Process each record in its own `try`.
2. Collect the `messageId` of each failure.
3. Return `{"batchItemFailures": [{"itemIdentifier": "<messageId>"}, ...]}`. Lambda deletes the rest. An empty list means all succeeded.
4. The same idea works for Kinesis and DynamoDB Streams, where the identifier is the sequence number.

**Example:**
```python
import json

def lambda_handler(event, context):
    failures = []
    for record in event["Records"]:
        try:
            process(json.loads(record["body"]))
        except Exception:
            failures.append({"itemIdentifier": record["messageId"]})
    return {"batchItemFailures": failures}
```

```flow
trace: A batch of 10 messages where message 7 is bad
batch received: messages 1–10 hidden in the queue > Lambda receives the batch; all 10 are invisible for the visibility timeout.
handler: 1–6 succeed, **7 fails**, 8–10 succeed > Each message has its own try, so one failure doesn't stop the loop.
return {"batchItemFailures": [{"itemIdentifier": "msg-7"}]} > The function reports exactly which message failed.
Lambda deletes 1–6 and 8–10 > Nine messages are done and will never be processed again.
message 7 reappears after the visibility timeout > Retried alone; after maxReceiveCount failures it goes to the DLQ.
```

**What happens, step by step:** without the setting (or if the handler raised instead), all 10 messages reappear, messages 1–6 and 8–10 are processed a second time (duplicate emails, double writes), and message 7 keeps dragging the others back until it hits the DLQ.

**Common mistake → fix:** returning `batchItemFailures` but forgetting to enable `ReportBatchItemFailures` on the mapping. Lambda ignores the return value and treats the batch as fully successful, so message 7 is **deleted** and lost. Fix: enable the response type, and test with one failing record. Powertools' `BatchProcessor` does both the loop and the response format for you.

**Interview answer:** "Without partial batch responses, one failing message makes the whole SQS batch return to the queue, so good messages get reprocessed. With ReportBatchItemFailures enabled on the mapping, my handler returns only the failed message IDs and Lambda deletes the rest. It must be enabled on the mapping, otherwise the return value is ignored, and I still make processing idempotent because SQS is at-least-once."

**Follow-ups:**
- *What if the handler raises an exception anyway?* The whole batch is treated as failed, even with the setting on.

---

### Q15. How does Lambda process Kinesis and DynamoDB streams, and what happens when a record fails?

**Short answer:** For streams, an event source mapping reads each **shard** (a partition of the stream) **in order** and invokes your function with batches from that shard. If a batch fails, Lambda **retries the same batch** and the shard stops moving forward until it succeeds, the records expire, or your retry limits are hit. That's why one bad record can block a shard. You control this with `MaximumRetryAttempts`, `MaximumRecordAgeInSeconds`, `BisectBatchOnFunctionError` and an on-failure destination.

**How it works:**
- Order is kept per shard, so Lambda never skips ahead within a shard on failure.
- Defaults retry until the record expires from the stream; with Kinesis' default retention that can mean a shard is blocked for a long time (AWS warns up to one week with default settings).
- `BisectBatchOnFunctionError` splits a failing batch in half and retries each half, isolating the bad record. Splitting doesn't use up retry attempts.
- When retries run out, Lambda sends **metadata** about the failed batch (shard ID, sequence numbers) to an on-failure destination (SQS, SNS, S3 or Kafka); an S3 destination also gets the full payload.
- `ParallelizationFactor` lets more than one batch per shard run at once while keeping order per partition key.
- Partial batch responses also work here (report the sequence number of the first failed record).

**Example:**
```bash
aws lambda create-event-source-mapping --function-name score-clicks \
  --event-source-arn arn:aws:kinesis:eu-west-1:123456789012:stream/clicks \
  --starting-position LATEST --batch-size 100 \
  --maximum-retry-attempts 3 --maximum-record-age-in-seconds 3600 \
  --bisect-batch-on-function-error \
  --destination-config '{"OnFailure":{"Destination":"arn:aws:sqs:eu-west-1:123456789012:clicks-failed"}}'
```

**What happens, step by step (record #57 of 100 always fails):**
1. The batch of 100 fails. Lambda bisects it into 1–50 and 51–100.
2. 1–50 succeeds. 51–100 fails and is split into 51–75 (fails) and 76–100 (succeeds).
3. Splitting continues until the single record #57 fails on its own; retries for it count up to 3.
4. After 3 retries, Lambda sends the shard ID and sequence numbers for #57 to `clicks-failed` and moves the shard forward. Total delay is seconds, not days.
5. Without these settings, the shard would retry the whole batch of 100 until the record aged out, and every later click on that shard would wait.

**Common mistake → fix:** leaving default retry settings and no destination on a stream. A single poison record stalls the shard and `IteratorAge` climbs for hours. Fix: set retry attempts and maximum record age, enable bisect, add an on-failure destination, and alarm on `IteratorAge`.

**Interview answer:** "Stream mappings process each shard in order, so a failing batch is retried and blocks that shard until it succeeds or expires. To avoid a poison record stalling a shard, I set MaximumRetryAttempts and MaximumRecordAgeInSeconds, enable BisectBatchOnFunctionError to isolate bad records, add an on-failure destination, and alarm on IteratorAge. Partial batch responses and the parallelization factor help with throughput while keeping per-key order."

**Follow-ups:**
- *What does the on-failure record contain for Kinesis to SQS?* Only metadata (shard and sequence range); you must read the records back from the stream before they expire, or use an S3 destination to get the payload.

---

### Q16. What is idempotency, and how do you make a Lambda handler idempotent?

**Short answer:** A handler is **idempotent** when running it twice with the same event has the same effect as running it once: the customer is charged once, the email is sent once. Lambda's asynchronous and poll-based invocations are **at-least-once**, so duplicates *will* happen. The fix is to give each event a stable **idempotency key** and record "I already did this" in a durable store **before or atomically with** the side effect.

**How it works:**
1. Pick a key that is the same for retries of the same business action: an order ID, a payment ID, an S3 object key + version, or a hash of the payload.
2. Atomically claim it: a DynamoDB `PutItem` with `ConditionExpression="attribute_not_exists(pk)"` succeeds only the first time.
3. If the claim fails because the key exists, return the saved result instead of redoing the work.
4. Give the record a TTL (time to live) so the table doesn't grow forever.

**Example (Powertools for AWS Lambda, Python):**
```python
from aws_lambda_powertools.utilities.idempotency import (
    DynamoDBPersistenceLayer, IdempotencyConfig, idempotent)

persistence = DynamoDBPersistenceLayer(table_name="idempotency")
config = IdempotencyConfig(event_key_jmespath="orderId", expires_after_seconds=3600)

@idempotent(persistence_store=persistence, config=config)
def lambda_handler(event, context):
    receipt = charge_card(event["orderId"], event["amount"])
    return {"orderId": event["orderId"], "receipt": receipt}
```

```flow
sequence: The same payment event delivered twice
actors: EventBridge, Function, Idempotency table, Payment API
EventBridge -> Function: {"orderId":"A12","amount":40}
Function -> Idempotency table: claim key A12 as INPROGRESS (conditional put succeeds)
Function -> Payment API: charge 40
Payment API --> Function: receipt r-881
Function -> Idempotency table: save A12 as COMPLETED with result r-881
EventBridge -> Function: same event delivered again (retry or duplicate)
Function -> Idempotency table: claim key A12
Idempotency table --> Function: already COMPLETED, return saved result r-881
> The second delivery returns the first result and never calls the payment API, so the customer is charged once.
```

**What happens, step by step:** the first call writes `A12 = INPROGRESS`, charges €40, then stores `COMPLETED` with `receipt r-881`. The duplicate call's conditional write fails, Powertools reads the stored record and returns `{"orderId":"A12","receipt":"r-881"}` without charging. If the duplicate arrives while the first is still `INPROGRESS`, Powertools raises an "already in progress" error so the retry happens later.

**Common mistake → fix:** using the Lambda `aws_request_id` as the key. Each retry of the same event gets a **new** request ID, so the check never matches. Fix: use a business identifier from the event payload.

**Interview answer:** "Async and poll-based invocations are at-least-once, so I make side-effecting handlers idempotent. I derive a key from the business event, like the order ID, claim it with a DynamoDB conditional write, store the result, and on a duplicate return the stored result instead of repeating the side effect. Powertools' idempotency utility implements this with in-progress and completed states and a TTL. Request IDs don't work as keys because they change on every retry."

**Follow-ups:**
- *What if the downstream API supports idempotency keys?* Pass your key through too (many payment APIs accept one), for defence in depth.

---

### Q17. API Gateway, function URL or Application Load Balancer: what should sit in front of a Lambda HTTP API?

**Short answer:** All three turn an HTTPS request into a synchronous Lambda invocation. **API Gateway** gives you the most API features (authorisers, throttling, usage plans and API keys, request validation, WAF). A **function URL** is a free, built-in HTTPS endpoint for one function, with IAM or no auth, and it supports response streaming. An **ALB** (Application Load Balancer) fits when you already route other targets, like containers, through a load balancer.

**How it works:**

| | API Gateway (REST / HTTP API) | Function URL | ALB |
|---|---|---|---|
| Auth | IAM, Cognito, JWT and Lambda authorisers | `AWS_IAM` or `NONE` (do auth in code) | OIDC/Cognito on listener rules |
| Throttling / quotas | Yes, per stage, method and API key | No (use reserved concurrency) | No |
| Timeout | 29 s by default for the integration | Up to the function timeout | Up to the function timeout |
| Streaming | Supported through the proxy integration | Yes | No |
| Cost | Per request | No extra charge | Hourly + capacity units |

**Example — choosing:**
1. Public partner API with API keys and per-client quotas → API Gateway REST API.
2. Internal webhook receiver for one function, verified by signature → function URL with `NONE` auth and signature check in code (put CloudFront in front for a custom domain and WAF).
3. A site where `/api/*` goes to Lambda and everything else to ECS → ALB.

**What happens, step by step (API Gateway REST, `POST /orders`):**
1. The client calls `POST /orders` with a JWT.
2. API Gateway validates the request body against the model and runs the authoriser. Invalid requests are rejected before Lambda runs, so you don't pay for them.
3. API Gateway invokes the function synchronously with the proxy event (method, path, headers, body).
4. The function returns `{"statusCode": 201, "body": "..."}` and API Gateway sends HTTP 201 to the client.
5. If the function runs longer than the integration timeout (29 s by default), the client gets a 504 even though the function may keep running.

**Common mistake → fix:** exposing a function URL with `AuthType: NONE` for an internal admin action, assuming nobody knows the URL. URLs are guessable from logs and browser history. Fix: use `AWS_IAM` auth (callers sign requests with SigV4), or validate a token or signature inside the function.

**Interview answer:** "API Gateway when I need API management features: authorisers, throttling, API keys, validation and WAF. A function URL for the simplest single-function endpoint, with IAM auth or my own auth in code, and it supports response streaming. An ALB when Lambda shares a load balancer with containers. In every case the call is synchronous with a 6 MB payload limit, and API Gateway's 29-second default timeout means long work should go asynchronous."

**Follow-ups:**
- *How do you handle work longer than 29 seconds behind an API?* Return 202 with a job ID, process asynchronously (SQS, Step Functions), and let the client poll or receive a callback.

---

### Q18. What goes wrong with S3 → Lambda, and how does recursive loop detection help?

**Short answer:** Three classic problems: **recursive loops** (the function writes back into the bucket/prefix that triggers it, so it invokes itself forever), **duplicates and no ordering** (S3 events are at-least-once and unordered), and **bursts** (a bulk upload of 50,000 files creates 50,000 invocations at once). Lambda's **recursive loop detection** stops loops through SQS, SNS, S3 and EventBridge custom buses after about **16** invocations in the same chain, but you should design them out in the first place.

**How it works:**
- Loop detection tracks a counter in tracing metadata that AWS SDKs pass along. After roughly 16 hops in one chain, Lambda stops the next invocation, sends the event to your DLQ or on-failure destination if configured, emits `RecursiveInvocationsDropped`, and emails you. You can turn it off per function with `put-function-recursion-config --recursive-loop Allow` (not recommended).
- Loops through services it can't track (for example DynamoDB) are **not** detected.
- Putting **SQS between S3 and Lambda** buffers bursts and lets you cap concurrency.

**Example (the bug):**
```python
def lambda_handler(event, context):
    for r in event["Records"]:
        key = r["s3"]["object"]["key"]                       # "photos/cat.jpg"
        thumb = make_thumbnail(download("media", key))
        s3.put_object(Bucket="media", Key=f"photos/thumb-{key.split('/')[-1]}", Body=thumb)
```
The trigger is "object created in bucket `media`, prefix `photos/`".

```flow
trace: How one upload turns into a loop
user uploads photos/cat.jpg > S3 invokes the function: invocation 1 of the chain.
function writes photos/thumb-cat.jpg > The new object matches the same prefix, so S3 invokes the function again.
function writes photos/thumb-thumb-cat.jpg > Invocation 3, 4, 5 … each creates a new matching object.
about **16** invocations in one chain > Lambda's recursive loop detection stops the next invocation and notifies you.
fix: write to thumbnails/ or another bucket > The output no longer matches the trigger, so there is exactly one invocation per upload.
```

**What happens, step by step:** without loop detection, this would run until someone noticed the bill, using up account concurrency along the way. With it, the chain stops after about 16 invocations, but you still have 16 junk objects and an alert.

**Common mistake → fix:** relying on loop detection as the design. Fix: write output to a different bucket or a prefix the trigger doesn't match, make processing idempotent (S3 can deliver an event twice), and for bulk uploads route S3 notifications to SQS (or EventBridge → SQS) with maximum concurrency on the mapping.

**Interview answer:** "With S3 triggers I watch for three things: recursive writes into the triggering prefix, at-least-once and unordered events, and bursts from bulk uploads. I write outputs to a separate bucket or prefix, make processing idempotent, and put SQS in between to buffer and cap concurrency. Lambda's recursive loop detection stops loops through SQS, SNS, S3 and EventBridge after about 16 hops, but it's a safety net, not the design."

**Follow-ups:**
- *Does loop detection cover DynamoDB Streams?* No. Loops involving services outside the supported list aren't detected; use alarms on invocations and concurrency.

---
## 4. Concurrency, scaling & cold starts

### Q19. What is concurrency, and how does Lambda scale?

**Short answer:** **Concurrency** is the number of requests your function is handling **at the same moment**. Because one environment handles one request at a time (default compute type), concurrency equals the number of busy environments. A useful estimate is **concurrency ≈ requests per second × average duration in seconds**. Each Region has an account limit (1,000 by default, raisable), and each function can add at most **1,000 environments every 10 seconds**. Requests above the limit are **throttled** (HTTP 429).

**How it works:**
- Concurrency rises with traffic **and** with duration. A slower dependency multiplies the concurrency you need.
- The account limit is shared by all functions in the Region unless you carve out reserved concurrency (see Q23).
- The scaling rate is per function, refilled continuously; unused scaling capacity doesn't accumulate.
- Synchronous callers get a `TooManyRequestsException` (429) when throttled; asynchronous events are retried for up to the maximum event age; event source mappings slow down and retry.

**Example:**
```text
Normal day:    100 req/s × 0.5 s = 50 concurrent environments
Slow database: 100 req/s × 2.0 s = 200 concurrent environments
Black Friday:  600 req/s × 2.0 s = 1,200 concurrent → above the 1,000 default limit
```

```flow
trace: The same traffic as the database slows down
100 req/s, 0.5 s each  →  **50** concurrent > Each environment is busy half a second per request, so 50 environments keep up.
100 req/s, 2.0 s each  →  **200** concurrent > Same traffic, but each request holds an environment four times longer.
600 req/s, 2.0 s each  →  needs **1,200** > More than the 1,000 account limit (shared with every other function in the Region).
200 requests per second over the limit get 429 > Synchronous callers see throttling errors; async events are queued and retried.
```

**What happens, step by step:** the spike from 50 to 1,200 is well within the scaling rate (1,000 environments per 10 seconds), so the limit hit here is the **account concurrency**, not the scaling speed. The fixes are: raise the account quota, speed up the database (which cuts concurrency directly), and reserve concurrency for this function if others might starve it.

**Common mistake → fix:** load testing with 600 requests per second against a 50 ms mock database, seeing only 30 concurrent, and concluding "we're far from the limit". Real latency of 2 s means 40× more concurrency. Fix: estimate with production-like durations and watch `ConcurrentExecutions` during the test.

**Interview answer:** "Concurrency is in-flight requests, roughly requests per second times average duration, and in standard Lambda each in-flight request occupies its own environment. The account has a Regional limit, 1,000 by default and raisable, and each function can scale by up to 1,000 environments every 10 seconds. Past the limit, invocations are throttled with 429s. Slow downstream calls increase concurrency, so latency and capacity are linked."

**Follow-ups:**
- *Is there a requests-per-second limit too?* Yes: synchronous invocations are limited to 10 × your concurrency per second, so very short functions can hit the rate limit before the concurrency limit.

---

### Q20. What is a cold start?

**Short answer:** A **cold start** is the extra delay when Lambda has to **create a new execution environment** before it can run your handler: download your code, start the runtime and run your initialisation code. A **warm start** reuses an existing idle environment and skips all of that. Cold starts happen on the first request, when traffic grows beyond the warm environments, after a new deployment, and after environments are recycled.

**How it works:**
- The steps: create the microVM → download code or image → start the runtime → run code outside the handler (Init) → run the handler.
- AWS says cold starts typically affect **under 1%** of invocations and take from **under 100 ms to over 1 second**, depending mostly on what your Init code does and the runtime.
- Cold starts are more common in quiet dev/test functions than in busy production functions, because busy functions keep environments warm.
- You can see them in the `REPORT` log line: a cold invocation includes `Init Duration`.

**Example (REPORT lines):**
```text
REPORT RequestId: 1a… Duration: 85.20 ms Billed Duration: 1,326 ms Memory Size: 1024 MB Max Memory Used: 210 MB Init Duration: 1240.50 ms
REPORT RequestId: 2b… Duration: 79.94 ms Billed Duration: 80 ms Memory Size: 1024 MB Max Memory Used: 211 MB
```

**What happens, step by step:**
1. The first request finds no environment. Init takes 1,240 ms (importing a large library and creating clients), then the handler takes 85 ms. The user waited about 1.3 s, and the billed duration includes Init.
2. The second request reuses the environment: only the 80 ms handler runs.
3. If 20 requests arrive at once tomorrow morning, up to 20 new environments may be created, so the first 20 users each pay the 1.3 s cost.

**Common mistake → fix:** a scheduled "keep-warm" ping every 5 minutes. It keeps **one** environment warm, but any burst that needs more than one still cold-starts, and it doesn't stop Lambda recycling environments. Fix: reduce Init time first; for strict latency use provisioned concurrency or SnapStart (see Q21, Q22).

**Interview answer:** "A cold start is the latency of creating a new execution environment: downloading code, starting the runtime and running my init code before the handler. It happens on first use, on scale-out, after deployments and after recycling, and shows up as Init Duration in the REPORT log. It's usually a small fraction of invocations, but it hits tail latency, so I measure it before optimising."

**Follow-ups:**
- *Does a VPC still add a big cold start?* Not since Lambda moved to shared Hyperplane network interfaces created when the function is configured; the effect is now small.

---

### Q21. How do you reduce cold-start latency?

**Short answer:** First make Init **cheaper**: smaller packages, fewer and lazier imports, and only the clients you need. Then, if you still need predictable latency, **pre-initialise**: **SnapStart** restores environments from a snapshot (Java, Python, .NET), and **provisioned concurrency** keeps a set number of environments always initialised. More memory also helps, because Init gets more CPU.

**How it works:**

| Technique | What it changes | Cost |
|---|---|---|
| Trim dependencies, import only what you use | Less to load during Init | Free |
| Lazy-load rarely used libraries inside the code path that needs them | Init skips them; the first request that needs them pays | Free |
| More memory | More CPU during Init | Higher GB-s price (often offset by faster runs) |
| SnapStart | Init runs at publish time; new environments restore from a snapshot | Free for Java; caching + restore charges for Python/.NET |
| Provisioned concurrency | N environments are initialised in advance | Paid per hour while configured |

**Example — lazy import:**
```python
import json, boto3
s3 = boto3.client("s3")                 # needed by every request

_pdf = None
def pdf_lib():
    global _pdf
    if _pdf is None:
        import pdfplumber                # heavy; only the /pdf route needs it
        _pdf = pdfplumber
    return _pdf

def lambda_handler(event, context):
    if event.get("rawPath") == "/pdf":
        return parse_pdf(pdf_lib(), event)
    return {"statusCode": 200, "body": json.dumps({"ok": True})}
```

**What happens, step by step (illustrative timings):**
1. Before: importing `pdfplumber` at the top added about 600 ms to every cold start, even for the 95% of requests that never touch PDFs.
2. After: cold starts for normal routes drop by about 600 ms. The first `/pdf` request in an environment pays the import once; later `/pdf` requests reuse `_pdf`.
3. If p99 is still too high for a user-facing API, add provisioned concurrency on the `live` alias sized to the baseline traffic.

**Common mistake → fix:** jumping straight to provisioned concurrency for a function whose Init downloads a 400 MB model from S3 on every cold start. You pay for idle capacity and still suffer whenever traffic exceeds it. Fix: shrink and optimise Init first (bundle the model in a container image or use SnapStart), then add provisioned concurrency only for the remaining gap.

**Interview answer:** "I measure Init Duration first, then reduce it: trim dependencies, lazy-load rarely used libraries, create only needed clients, and consider more memory or arm64. If the API still needs predictable latency, I use SnapStart for Java, Python or .NET, or provisioned concurrency on an alias for the baseline, scaled on a schedule or utilisation. Keep-warm pings don't fix bursts."

**Follow-ups:**
- *Which is better, SnapStart or provisioned concurrency?* SnapStart cuts most Init time at low cost; provisioned concurrency gives the lowest, most predictable latency (double-digit milliseconds) but costs money while idle. They can't be combined on the same version.

---

### Q22. What is SnapStart, and what do you have to watch out for?

**Short answer:** **SnapStart** moves the Init phase to **publish time**. When you publish a version, Lambda runs Init once, takes a **snapshot** of the initialised microVM's memory and disk, encrypts and caches it. New environments then **restore** from the snapshot instead of initialising from scratch. It supports Java 11+, Python 3.12+ and .NET 8+, works only on **published versions** (not `$LATEST`), and requires care with anything that must be **unique** per environment.

**How it works:**
1. `publish-version` → Lambda runs Init and any "before snapshot" runtime hooks → snapshot.
2. Invocation needs a new environment → **Restore** phase loads the snapshot and runs any "after restore" hooks (must finish within 10 seconds) → handler runs.
3. Because every environment starts from the **same** memory image, anything generated during Init (random seeds, unique IDs, temporary credentials, open network connections) is **copied** into every environment.
4. Not supported together with provisioned concurrency, EFS, or ephemeral storage over 512 MB.

**Example (Python, regenerate uniqueness after restore):**
```python
import uuid
from snapshot_restore_py import register_after_restore

INSTANCE_ID = str(uuid.uuid4())          # created during Init → same in every restored env!

@register_after_restore
def reset_unique_state():
    global INSTANCE_ID
    INSTANCE_ID = str(uuid.uuid4())       # each restored environment gets its own value

def lambda_handler(event, context):
    return {"instance": INSTANCE_ID}
```

**What happens, step by step:**
1. You publish version 7. Init runs once and sets `INSTANCE_ID = "a1…"`; Lambda snapshots it.
2. A burst creates three environments, each restored from the snapshot. Without the hook, all three report `"a1…"`, so anything relying on that ID being unique (log correlation, lock owner, a random token) breaks.
3. With the hook, each restore sets a new UUID: `"b7…"`, `"c2…"`, `"d9…"`.
4. Database connections opened during Init may be dead after restore; validate or reconnect in the handler (AWS SDK clients generally recover automatically).

**Common mistake → fix:** generating an encryption nonce or random seed at module level with SnapStart enabled; every environment reuses the same "random" values. Fix: generate unique values inside the handler or an after-restore hook.

**Interview answer:** "SnapStart runs Init when I publish a version, snapshots the initialised microVM, and restores new environments from it, which can turn multi-second cold starts into sub-second ones. It supports Java, Python 3.12+ and .NET 8+ on published versions only. Because every environment is a copy of the same snapshot, I regenerate unique values and re-check network connections in after-restore hooks. For Java it's free; for Python and .NET there are caching and restore charges."

**Follow-ups:**
- *Why only published versions?* The snapshot is tied to immutable code and configuration; `$LATEST` can change at any time.

---

### Q23. What is the difference between reserved concurrency and provisioned concurrency?

**Short answer:** **Reserved concurrency** is a **limit and a guarantee**: it sets aside N units of the account's concurrency for one function, and that function can never use more than N. It's free. **Provisioned concurrency** is **pre-warmed capacity**: Lambda keeps N environments initialised and ready, so requests up to N never cold-start. It costs money while configured. They solve different problems: reserved is about **how much**, provisioned is about **how fast**.

**How it works:**

| | Reserved concurrency | Provisioned concurrency |
|---|---|---|
| Purpose | Guarantee capacity and cap it | Remove cold starts for a baseline |
| Applies to | The whole function | A version or alias |
| Cost | Free | Paid per hour + reduced duration price |
| Over the setting | Throttled (429) | Extra requests use normal on-demand environments (may cold-start) |
| Special value | 0 = function can't run (emergency stop) | Scale with Application Auto Scaling (schedule or utilisation) |

You can reserve at most the account limit minus 100; the last 100 always stay available for functions without reservations.

**Example:**
```bash
# protect a fragile database: never more than 20 concurrent writers
aws lambda put-function-concurrency --function-name write-orders \
  --reserved-concurrent-executions 20

# keep 10 environments warm on the "live" alias of a user-facing API
aws lambda put-provisioned-concurrency-config --function-name checkout-api \
  --qualifier live --provisioned-concurrent-executions 10
```

**What happens, step by step:**
1. `write-orders` gets a burst needing 35 concurrent. 20 run; the other 15 are throttled. If it's fed by SQS, those messages simply wait in the queue and are picked up later. The database never sees more than 20 connections.
2. `checkout-api` receives 8 concurrent requests: all go to the 10 pre-initialised environments, so there's no cold start.
3. Traffic rises to 14 concurrent: 10 use provisioned environments, 4 use on-demand ones (which may cold-start). Nothing is throttled, because provisioned concurrency is not a cap.

**Common mistake → fix:** setting reserved concurrency of 5 on an SQS-triggered function and leaving maximum concurrency unset. The mapping scales up its pollers, invocations get throttled, and messages bounce back to the queue repeatedly, which can push them into the DLQ. Fix: use the mapping's **maximum concurrency** (and keep reserved concurrency ≥ that value), so the poller itself slows down.

**Interview answer:** "Reserved concurrency carves a fixed slice of the account limit for one function, guaranteeing it and capping it, at no cost; I use it to protect downstream systems or make sure a critical function always has capacity, and setting it to zero is an emergency stop. Provisioned concurrency keeps a number of environments initialised on a version or alias to eliminate cold starts, and it's billed while configured. Requests above provisioned concurrency spill over to on-demand; requests above reserved concurrency are throttled."

**Follow-ups:**
- *Can I use provisioned concurrency on `$LATEST`?* No; it's configured on a published version or an alias.

---

### Q24. How do you tell Lambda throttling from downstream throttling?

**Short answer:** **Lambda throttling** means Lambda refused to run your function because a concurrency limit was reached: the `Throttles` metric rises and synchronous callers get `TooManyRequestsException` (429) — your code never ran. **Downstream throttling** means your function ran but a service it called (DynamoDB, Bedrock, a partner API) refused the request: you see `ThrottlingException` or HTTP 429 **in your function's logs**, `Errors` and `Duration` go up, and `Throttles` stays at zero.

**How it works (debugging steps):**
1. **Check the `Throttles` metric** for the function. Above zero → Lambda throttling. Check `ConcurrentExecutions` against the account limit and the function's reserved concurrency.
2. **Search the logs** for `ThrottlingException`, `ProvisionedThroughputExceededException`, `Rate exceeded` or 429. Present → downstream throttling.
3. **Look at traces** (X-Ray or OpenTelemetry). The slow or failing segment names the downstream service.
4. **Check the downstream service's own metrics** (e.g. DynamoDB `ThrottledRequests`, the API's quota usage).

**Example:**
```text
Symptom: checkout errors rose from 0.1% to 6% at 12:00.
Throttles metric: 0                       → not Lambda throttling
Logs: "ThrottlingException: Rate exceeded" from bedrock-runtime InvokeModel
Duration p99: 2 s → 14 s                  → retries with backoff inside the function
```

**What happens, step by step:** traffic doubled at noon. Lambda happily scaled from 80 to 160 environments, and each called the model API, which has a fixed tokens-per-minute quota. The extra calls were throttled by the model service, the SDK retried, durations grew, and that in turn raised concurrency further.

**Fix (depends on which one):**
- Lambda throttling → raise the account quota, add reserved concurrency for the critical function, or reduce duration.
- Downstream throttling → **lower** concurrency toward that service (ESM maximum concurrency or reserved concurrency), queue the work, retry with exponential backoff and jitter, cache results, or request a higher quota.

**Common mistake → fix:** responding to downstream 429s by raising Lambda concurrency. More parallel callers make the downstream throttling worse. Fix: cap concurrency to what the dependency can accept and buffer the rest in a queue.

**Interview answer:** "If the Throttles metric is non-zero, Lambda itself refused invocations because of concurrency limits, and my code never ran. If Throttles is zero but logs show ThrottlingException or 429s from a dependency, the downstream service is limiting me. The fixes are opposite: Lambda throttling needs more or reserved concurrency, while downstream throttling needs less concurrency, queueing, backoff with jitter, or a quota increase."

**Follow-ups:**
- *Which metric shows async events waiting because of throttling?* `AsyncEventAge` rising, along with `AsyncEventsDropped` if events expire.

---

### Q25. How should a Lambda function connect to a relational database?

**Short answer:** Every concurrent environment opens its **own** database connections, so 500 concurrent invocations can mean 500+ connections, which can exhaust a PostgreSQL or MySQL server. Use **Amazon RDS Proxy** to pool and share connections, open the connection **outside the handler** so warm invocations reuse it, and **cap concurrency** to what the database can handle. Alternatives avoid connections altogether: DynamoDB, or the Aurora **Data API** over HTTPS.

**How it works:**
- RDS Proxy keeps a pool of real connections to the database and multiplexes many client connections onto them. It also supports IAM authentication and keeps connections during failover.
- Reusing a global connection avoids a TCP + TLS + auth handshake on every request.
- Reserved concurrency or ESM maximum concurrency puts an upper bound on clients.

**Example:**
```python
import os, psycopg

conn = None                                       # one connection per environment

def get_conn():
    global conn
    if conn is None or conn.closed:
        conn = psycopg.connect(host=os.environ["PROXY_ENDPOINT"], dbname="orders",
                               user="app", password=db_password(), sslmode="require",
                               connect_timeout=3)
    return conn

def lambda_handler(event, context):
    with get_conn().cursor() as cur:
        cur.execute("SELECT status FROM orders WHERE id = %s", (event["orderId"],))
        return {"status": cur.fetchone()[0]}
```

```flow
sequence: A burst of 1,000 invocations through RDS Proxy
actors: Lambda environments, RDS Proxy, PostgreSQL
Lambda environments -> RDS Proxy: up to 1,000 client connections (one per environment)
RDS Proxy -> PostgreSQL: borrow from a pool of about 50 real connections
PostgreSQL --> RDS Proxy: query results
RDS Proxy --> Lambda environments: results to each client
> The database sees about 50 connections instead of 1,000, because the proxy shares real connections between short queries.
```

**What happens, step by step:** without the proxy, the 1,000 environments would each open a connection directly. PostgreSQL's `max_connections` (say 400) would be exceeded and environments 401–1,000 would get "too many connections" errors. With the proxy, clients connect to the proxy and queries share a small pool.

**Common mistake → fix:** opening and closing a connection inside every invocation. Each call pays tens of milliseconds of handshake, and under load the database spends its time accepting connections. Fix: connect once per environment (with a check for closed connections), through RDS Proxy.

**Interview answer:** "Lambda's one-request-per-environment model means connections scale with concurrency, which can exhaust a relational database. I connect through RDS Proxy for pooling and IAM auth, keep the connection in a global so warm invocations reuse it, and cap concurrency to what the database supports. Where it fits, I avoid connections entirely with DynamoDB or the Aurora Data API."

**Follow-ups:**
- *What can stop RDS Proxy from multiplexing?* Session state like temporary tables, session variables or long transactions "pins" a client to one connection; keep transactions short.

---
## 5. Packaging, versions & tooling

### Q26. What is a Lambda layer, and when would you use a container image instead?

**Short answer:** A **layer** is a separate .zip archive of shared code or files (libraries, a custom runtime, configuration) that Lambda extracts into **`/opt`** in the execution environment. One layer can be attached to many functions, and a function can use up to **5 layers**. Layers only work with zip-based functions, and the function plus all its layers must fit in **250 MB** unzipped. For larger or more complex dependencies, package everything in a **container image** instead.

**How it works:**
- Each layer is **versioned** and immutable: `arn:aws:lambda:eu-west-1:123456789012:layer:common-utils:4`.
- Layers are extracted in order; later layers can overwrite files from earlier ones.
- For Python, files under `python/` in the layer land in `/opt/python`, which is on the import path. For Node.js, use `nodejs/node_modules/`.
- Container images don't use layers; you put shared code into a base image instead.

**Example:**
```text
common-utils-layer.zip
└── python/
    └── common/
        ├── __init__.py
        └── auth.py
```
```bash
aws lambda publish-layer-version --layer-name common-utils \
  --zip-file fileb://common-utils-layer.zip --compatible-runtimes python3.13
aws lambda update-function-configuration --function-name get-orders \
  --layers arn:aws:lambda:eu-west-1:123456789012:layer:common-utils:4
```

**What happens, step by step:**
1. `publish-layer-version` creates version 4 of `common-utils`.
2. Attaching it to `get-orders` changes the function's configuration.
3. On the next cold start, Lambda extracts the layer to `/opt`, so `/opt/python/common/auth.py` exists.
4. `from common.auth import verify_token` works in the handler because `/opt/python` is on `sys.path`.
5. Publishing version 5 later does **not** change `get-orders`; it keeps using version 4 until you update the ARN.

| | Layers | Container image |
|---|---|---|
| Size | Function + layers ≤ 250 MB unzipped | ≤ 10 GB |
| Sharing | Attach the same layer version to many functions | Share a base image |
| Updating shared code | Publish a new layer version, then update each function | Rebuild and redeploy images |
| Best for | Small shared utilities, extensions, custom runtimes | Large dependencies, existing Docker tooling |

**Common mistake → fix:** putting `requests` version 2.31 in a layer while the function bundles 2.25. Which one is imported depends on path order, so behaviour changes depending on packaging. Fix: keep each dependency in exactly one place and test the combined package; for complex dependency trees prefer a container image.

**Interview answer:** "A layer is a versioned zip of shared libraries or files that Lambda extracts into /opt; a function can use up to five, and function plus layers must stay under 250 MB unzipped. I use layers for small shared utilities and extensions, pinning exact versions. For large or conflicting dependencies, I use a container image up to 10 GB, which bundles everything and versions it as one unit."

**Follow-ups:**
- *Do layers speed up cold starts?* No. They're extracted as part of the deployment package; they help reuse, not latency.

---

### Q27. What are versions and aliases, and how do you use them to deploy safely?

**Short answer:** A **version** is an **immutable snapshot** of your function's code and configuration, numbered 1, 2, 3… created by "publish". `$LATEST` is the editable, unpublished copy. An **alias** is a **named pointer** to a version, such as `live` → 7, which callers use instead of a number. An alias can split traffic between **two** versions by weight, which lets you do canary releases and instant rollbacks.

**How it works:**
1. You update code on `$LATEST`, then `publish-version` freezes it as version 8.
2. API Gateway, event source mappings and other callers point at the alias ARN (`...:function:checkout:live`), never at a number.
3. Deploying means moving the alias. With a **routing configuration** you can send, say, 10% to version 8 and 90% to version 7.
4. Rolling back means pointing the alias back to version 7 — no rebuild, takes seconds.
5. AWS CodeDeploy can automate this (canary or linear shifting) and roll back if CloudWatch alarms fire.

**Example:**
```bash
aws lambda publish-version --function-name checkout          # → Version "8"
aws lambda update-alias --function-name checkout --name live \
  --function-version 7 \
  --routing-config '{"AdditionalVersionWeights":{"8":0.1}}'   # 90% v7, 10% v8
```

```flow
trace: Canary release of version 8 behind the live alias
live → v7 (100%) > All callers use the alias, so they don't know which version runs.
publish v8, live → v7 90% + **v8 10%** > Weighted routing sends one request in ten to the new code.
watch alarms for 10 minutes: errors, duration, throttles > CodeDeploy (or your pipeline) checks the alarms on the alias.
alarm fires → live → v7 100% > Rollback is just moving the pointer back; version 7 never changed.
no alarm → live → **v8 100%** > The alias is moved fully to the new version.
```

**What happens, step by step:** during the 10% phase, a request has a 1 in 10 chance of running version 8. The `ExecutedVersion` in the response and the log stream name show which version handled it. If version 8's error rate alarm fires, the pipeline runs `update-alias --function-version 7 --routing-config '{}'` and everyone is back on version 7.

**Common mistake → fix:** pointing production triggers at `$LATEST` (or the unqualified function name, which means `$LATEST`). Every `update-function-code` goes straight to production with no rollback point. Fix: publish versions and always point production at an alias.

**Interview answer:** "Publishing creates an immutable, numbered version of code plus configuration; $LATEST is the mutable working copy. Aliases are named pointers to versions, and all callers use the alias ARN, so a deploy is moving the alias. An alias can weight traffic across two versions, which CodeDeploy uses for canary or linear releases with alarm-based automatic rollback, and rollback is just pointing the alias back."

**Follow-ups:**
- *Can provisioned concurrency follow the alias?* Yes; configure it on the alias. When you shift the alias, plan provisioned concurrency for the new version too.
- *Can a weighted alias include `$LATEST`?* No, routing only works between published versions.

---

### Q28. How are Lambda functions usually built and deployed?

**Short answer:** Define functions and their triggers, roles and alarms as **infrastructure as code** (IaC) with **AWS SAM** (Serverless Application Model), **AWS CDK** (Cloud Development Kit), **Terraform** or the **Serverless Framework**. In CI, **build the artifact once** (a zip or an image), deploy the same artifact to each environment, publish a version, and shift an alias with **CodeDeploy** canary or linear traffic shifting guarded by alarms.

**How it works:**
1. Developer pushes to the main branch.
2. CI runs tests, builds the zip or container image, and stores it (S3 or ECR) tagged with the commit.
3. Deploy to staging from IaC; run integration tests against real AWS services.
4. Deploy the **same** artifact to production: IaC publishes a version and CodeDeploy shifts the `live` alias (e.g. `Canary10Percent5Minutes`).
5. Alarms on errors, latency and throttles decide whether to finish or roll back.

**Example (SAM):**
```yaml
CheckoutFunction:
  Type: AWS::Serverless::Function
  Properties:
    Runtime: python3.13
    Handler: app.lambda_handler
    CodeUri: src/
    AutoPublishAlias: live
    DeploymentPreference:
      Type: Canary10Percent5Minutes
      Alarms: [!Ref CheckoutErrorsAlarm]
```

**What happens, step by step:** `sam deploy` uploads the code, CloudFormation updates the function, `AutoPublishAlias` publishes a new version (say 12) and CodeDeploy points 10% of `live` at version 12 for 5 minutes. If `CheckoutErrorsAlarm` goes into ALARM, CodeDeploy points `live` back to version 11; otherwise it moves 100% to 12.

**Common mistake → fix:** rebuilding the package separately for staging and production. Different dependency resolution can ship code to production that was never tested. Fix: build once, promote the same artifact by checksum or image digest.

**Interview answer:** "I define functions, triggers, roles and alarms in IaC — SAM, CDK or Terraform — build the artifact once in CI and promote the same artifact through environments. Production deploys publish a version and shift an alias gradually with CodeDeploy, with CloudWatch alarms as automatic rollback triggers."

**Follow-ups:**
- *How do you test Lambda locally?* Unit-test the handler as a plain function with sample events; use `sam local invoke` for container-level checks, and integration-test in a real account for IAM and service behaviour.

---

### Q29. What does Powertools for AWS Lambda give you?

**Short answer:** **Powertools for AWS Lambda** is an open-source AWS toolkit (Python, TypeScript, Java, .NET) that packages production best practices as small utilities: **structured JSON logging** with request IDs, **metrics** in CloudWatch Embedded Metric Format (no API calls), **tracing**, **idempotency**, **batch processing** with partial failure responses, **parameters and secrets** with caching, and **event parsing and validation**.

**How it works:** you add decorators or middleware around the handler; each utility handles one cross-cutting concern so your handler stays focused on business logic.

**Example:**
```python
from aws_lambda_powertools import Logger, Metrics, Tracer
from aws_lambda_powertools.metrics import MetricUnit
from aws_lambda_powertools.utilities.batch import BatchProcessor, EventType, process_partial_response

logger, tracer, metrics = Logger(), Tracer(), Metrics(namespace="Orders")
processor = BatchProcessor(event_type=EventType.SQS)

def record_handler(record):
    order = record.json_body
    logger.info("processing", extra={"order_id": order["id"]})
    metrics.add_metric(name="OrdersProcessed", unit=MetricUnit.Count, value=1)

@logger.inject_lambda_context
@tracer.capture_lambda_handler
@metrics.log_metrics
def lambda_handler(event, context):
    return process_partial_response(event=event, record_handler=record_handler,
                                    processor=processor, context=context)
```

**What happens, step by step (batch of 3, one bad message):**
1. `inject_lambda_context` adds the request ID, function name and cold-start flag to every log line.
2. `process_partial_response` calls `record_handler` for each SQS record and catches exceptions per record.
3. Two records succeed, emitting two `OrdersProcessed` metrics; one raises.
4. The function returns `{"batchItemFailures": [{"itemIdentifier": "<id of bad message>"}]}`.
5. `log_metrics` flushes the metrics as one structured log line that CloudWatch turns into metrics.

**Common mistake → fix:** using `BatchProcessor` without enabling `ReportBatchItemFailures` on the event source mapping; the return value is ignored and the failed message is deleted. Fix: enable it on the mapping.

**Interview answer:** "Powertools is AWS's open-source library for Lambda best practices: structured logging with correlation IDs, EMF metrics, tracing, idempotency, batch processing with partial failures, cached parameters and secrets, and event validation. It removes a lot of boilerplate and makes production behaviour consistent across functions."

**Follow-ups:**
- *Why EMF instead of `put_metric_data`?* EMF writes metrics as log lines, so there's no extra API call or latency in the handler.

---

### Q30. What are Lambda extensions?

**Short answer:** An **extension** is a companion process that runs **inside the execution environment** next to your function, usually delivered as a layer. External extensions start during Init, can receive lifecycle events (Invoke, Shutdown) and telemetry, and can keep running briefly after your handler returns. They're used for monitoring agents, OpenTelemetry collectors, and local secret/parameter caches.

**How it works:**
1. Init: Lambda starts each extension, which registers with the **Extensions API**.
2. Invoke: the extension receives an event; your handler runs; the extension can do work (e.g. send telemetry) before signalling it's done. The **function timeout covers the whole Invoke phase**, including extension work.
3. Shutdown: the extension gets up to 2,000 ms to flush.
4. Extensions share memory, CPU, `/tmp` and credentials with your function, and add to Init time.

**Example — the AWS Parameters and Secrets Lambda Extension:**
```python
import os, json, urllib.request

def get_secret(name):
    url = f"http://localhost:2773/secretsmanager/get?secretId={name}"
    req = urllib.request.Request(url, headers={
        "X-Aws-Parameters-Secrets-Token": os.environ["AWS_SESSION_TOKEN"]})
    return json.loads(urllib.request.urlopen(req).read())["SecretString"]
```

**What happens, step by step:** the extension starts during Init and listens on `localhost:2773`. The first `get_secret` call makes the extension fetch the secret from Secrets Manager and cache it; later calls in the same environment are served from the local cache until its TTL expires.

**Common mistake → fix:** adding three monitoring extensions and seeing cold starts and duration grow. Each extension adds Init time and memory, and an extension that's slow to finish after the handler extends billed duration. Fix: measure Init and duration with and without each extension; keep only the ones you need.

**Interview answer:** "Extensions are processes that run alongside the function inside the execution environment, usually shipped as layers. They take part in the Init, Invoke and Shutdown lifecycle via the Extensions API, which makes them good for telemetry agents and local caches like the Parameters and Secrets extension. They share the function's resources and count toward its time, so I measure their overhead."

**Follow-ups:**
- *Internal vs external extensions?* Internal ones run inside the runtime process (e.g. language agents); external ones are separate processes.

---

### Q31. What is response streaming, and when would you use it?

**Short answer:** **Response streaming** lets a function send its response **in chunks as they are produced**, instead of building the whole response and returning it at the end. That improves **time to first byte** (useful for LLM tokens or large files) and raises the response limit from 6 MB to **200 MB**. It works through **function URLs**, the **`InvokeWithResponseStream`** API, and API Gateway's streaming proxy integration. Node.js managed runtimes support it natively; other languages use a custom runtime or the Lambda Web Adapter.

**How it works:**
1. Set the function URL's invoke mode to `RESPONSE_STREAM`.
2. Wrap the handler with `awslambda.streamifyResponse`, which gives you a writable `responseStream`.
3. Each `write` is sent to the client as soon as possible. The first 6 MB stream at full speed; after that the rate is capped at 2 MB/s.
4. The function is billed for its full duration even if the client disconnects.

**Example (Node.js):**
```javascript
export const handler = awslambda.streamifyResponse(async (event, responseStream) => {
  responseStream.setContentType("text/plain");
  for await (const token of callModel(event.body)) {   // e.g. tokens from an LLM
    responseStream.write(token);
  }
  responseStream.end();
});
```

```flow
sequence: Streaming model output through a function URL
actors: Browser, Function URL, Function, Model API
Browser -> Function URL: POST /chat "Summarise this"
Function URL -> Function: invoke in RESPONSE_STREAM mode
Function -> Model API: start a streaming completion
Model API --> Function: token "The"
Function --> Browser: write "The" (first byte after about 300 ms)
Model API --> Function: more tokens
Function --> Browser: write each token as it arrives
Function --> Browser: end of stream after about 6 s
> The user starts reading after about 300 ms instead of waiting 6 s for the full answer.
```

**What happens, step by step:** without streaming, the browser would wait for the whole 6-second completion before seeing anything. With streaming, the first token arrives in about 300 ms and the rest follow as they're generated; total duration and cost are the same.

**Common mistake → fix:** adding streaming to a function that runs in a VPC and is called through a function URL; function URLs don't support streaming inside a VPC. Fix: call it with `InvokeWithResponseStream` through a Lambda interface VPC endpoint, or use API Gateway's streaming integration.

**Interview answer:** "Response streaming sends the response progressively, which improves time to first byte for things like LLM tokens and allows responses up to 200 MB instead of 6 MB. It works through function URLs, InvokeWithResponseStream and API Gateway's streaming integration; Node.js supports it natively and other languages use a custom runtime or the Lambda Web Adapter. Billing covers the full duration even if the client disconnects."

**Follow-ups:**
- *Is the bandwidth unlimited?* The first 6 MB is uncapped; beyond that it's limited to 2 MB/s.

---

## 6. Security & networking

### Q32. How do you apply least privilege to a Lambda function that an AI agent calls as a tool?

**Short answer:** Treat each tool function as an **untrusted entry point with a tiny blast radius**: one function per tool, its own execution role allowing only the exact actions and resource ARNs it needs, a resource-based policy that lets **only** the agent's gateway role invoke it, strict input validation, authorisation of the **end user** passed in trusted context, reserved concurrency to cap runaway loops, and redacted logs.

**How it works (the layers of control):**
1. **Who can call it:** resource-based policy allows only the gateway's role ARN.
2. **What it can do:** execution role allows e.g. `s3:GetObject` on `arn:aws:s3:::docs/tenants/${tenant}/*` only.
3. **What it accepts:** validate input with a schema (e.g. Pydantic); reject unexpected fields and oversized values. The model may produce anything.
4. **For whom:** check that the end user (from a signed token or trusted context, never from model-generated arguments) may access the requested resource.
5. **How much:** reserved concurrency (e.g. 20) caps cost and downstream impact if an agent loops.

**Example:**
```python
from pydantic import BaseModel, Field, ValidationError

class GetDocInput(BaseModel):
    doc_id: str = Field(pattern=r"^[a-z0-9-]{8,64}$")

def lambda_handler(event, context):
    try:
        args = GetDocInput.model_validate(event["arguments"])
    except ValidationError:
        return {"error": "invalid input"}
    user = event["identity"]                       # set by the gateway, not by the model
    if not can_read(user["tenant_id"], args.doc_id):
        return {"error": "forbidden"}
    return {"text": read_doc(user["tenant_id"], args.doc_id)}
```

**What happens, step by step (prompt injection attempt):** the model is tricked into calling the tool with `doc_id = "../../other-tenant/secret"`. Validation fails the pattern and returns `invalid input`. Even if it passed, `can_read` checks the tenant from the trusted identity, and the IAM role only allows the caller's tenant prefix — three independent layers.

**Common mistake → fix:** trusting a `user_id` argument that the model filled in. A prompt can make the model supply someone else's ID. Fix: take identity only from the authenticated context the gateway passes, and authorise against it.

**Interview answer:** "One function per tool with its own minimal role, scoped to exact actions and resource ARNs; a resource policy so only the agent gateway can invoke it; schema validation of every argument because model output is untrusted; authorisation of the real end user from trusted context, not from model arguments; reserved concurrency to cap loops; and logs that don't contain sensitive data."

**Follow-ups:**
- *How do you scope access per tenant?* Use resource ARNs with a tenant prefix, plus session tags or ABAC (attribute-based access control) conditions if the role is shared.

---

### Q33. How should a Lambda function read secrets?

**Short answer:** Store secrets in **AWS Secrets Manager** (or Parameter Store `SecureString`), fetch them **at Init or first use**, **cache** them in memory with a short TTL, and grant the execution role `secretsmanager:GetSecretValue` on **that secret's ARN** only (plus `kms:Decrypt` if it uses a customer managed key). Don't put secrets in code or plain environment variables, and don't fetch them on every invocation.

**How it works:**
- In-function cache: a global variable with an expiry time (see Q08), Powertools `parameters.get_secret(..., max_age=300)`, or the AWS Secrets Manager caching library.
- Extension cache: the AWS Parameters and Secrets Lambda Extension serves secrets on `localhost:2773` (see Q30).
- Rotation: when a cached password stops working, refresh the cache once and retry, so rotation doesn't cause an outage.

**Example (Powertools):**
```python
from aws_lambda_powertools.utilities import parameters

def lambda_handler(event, context):
    api_key = parameters.get_secret("prod/partner/api-key", max_age=300)   # cached 5 min
    return call_partner(api_key, event)
```

```flow
sequence: First and later reads of a cached secret
actors: Handler, Cache, Secrets Manager
Handler -> Cache: get prod/partner/api-key (first invocation)
Cache -> Secrets Manager: GetSecretValue
Secrets Manager --> Cache: secret value, cached for 300 s
Cache --> Handler: value
Handler -> Cache: get prod/partner/api-key (next invocation, 40 s later)
Cache --> Handler: cached value, no API call
> Only the first call in each environment, and one call every 5 minutes after that, reaches Secrets Manager.
```

**What happens, step by step:** at 100 requests per second spread over 10 warm environments, uncached code would make 100 `GetSecretValue` calls per second; with a 5-minute cache it makes about 10 calls every 5 minutes.

**Common mistake → fix:** granting `secretsmanager:GetSecretValue` on `*`. Any code path (or injected input) in the function could read every secret in the account. Fix: list the specific secret ARN(s) in the policy.

**Interview answer:** "Secrets live in Secrets Manager or Parameter Store; the function reads them on first use and caches them per environment with a TTL, using Powertools, the caching library or the Parameters and Secrets extension. The role can read only the specific secret ARN and decrypt with its key. On an authentication failure I refresh the cache once, so rotation is seamless."

**Follow-ups:**
- *Are environment variables safe for secrets?* They're encrypted at rest, but anyone with `lambda:GetFunctionConfiguration` can read them in plain text, and they don't rotate.

---

### Q34. What changes when you put a Lambda function in a VPC?

**Short answer:** Attaching a function to a **VPC** (Virtual Private Cloud, your private network in AWS) lets it reach private resources like RDS databases, ElastiCache or internal APIs through **subnets** and **security groups** you choose. The catch: the function **loses default internet access**. To reach the internet it needs a **NAT gateway**, and to reach AWS services privately it needs **VPC endpoints**. Don't attach to a VPC unless the function needs private resources.

**How it works:**
- Lambda creates shared **Hyperplane ENIs** (elastic network interfaces) in your subnets when you configure the function, not per invocation, so cold-start impact is small today.
- Traffic from the function leaves through those ENIs with the security group's rules.
- Private subnets have no route to the internet unless the route table points to a NAT gateway (in a public subnet).
- Gateway endpoints (S3, DynamoDB) and interface endpoints (Secrets Manager, SQS, Bedrock, …) keep AWS API calls inside the VPC.

**Example:**
```yaml
VpcConfig:
  SubnetIds: [subnet-private-a, subnet-private-b]
  SecurityGroupIds: [sg-lambda-orders]
# sg-lambda-orders: egress 5432 to sg-postgres, egress 443 to the VPC endpoint SG
```

**What happens, step by step:**
1. The function connects to Postgres at `10.0.3.25:5432`: allowed by the security groups, works.
2. It calls `secretsmanager.eu-west-1.amazonaws.com`. If there's an interface endpoint with private DNS, the name resolves to a private IP and the call works.
3. It calls `https://api.partner.com`. With no NAT route, the TCP connection never completes; the SDK or HTTP client waits until its own timeout or the function timeout. Logs show a timeout, not an error message.

**Common mistake → fix:** adding a VPC "for security" to a function that only calls DynamoDB and a public API, then seeing every request time out. Fix: either don't attach the VPC, or add a DynamoDB gateway endpoint and a NAT gateway; and always set short client timeouts so network problems fail fast.

**Interview answer:** "I attach a function to a VPC only when it needs private resources. It then uses shared Hyperplane ENIs in my private subnets with security groups. It loses default internet access, so I add VPC endpoints for AWS services and a NAT gateway only if it must reach the internet. A classic symptom of missing routes is calls hanging until the function times out."

**Follow-ups:**
- *Do subnets need to be sized carefully?* Yes; ENIs consume IP addresses, so use subnets with enough free IPs in at least two Availability Zones.

---

### Q35. How do you secure a function's outbound calls?

**Short answer:** Make every outbound call **bounded, allowed and authenticated**: a **timeout** shorter than the function timeout on every client, an **allowlist** of destinations (never fetch arbitrary user-supplied URLs, which enables **SSRF**, server-side request forgery), credentials from Secrets Manager with least privilege, TLS verification left on, and, where needed, network egress controls (security group egress rules, NAT plus AWS Network Firewall or Route 53 DNS Firewall).

**How it works:**
- Timeouts stop one slow dependency from consuming the whole function timeout and concurrency.
- An allowlist prevents an attacker from making your function call internal endpoints or cloud metadata addresses.
- Network controls enforce the allowlist even if code is compromised.

**Example:**
```python
import requests
from urllib.parse import urlparse

ALLOWED_HOSTS = {"api.partner.com", "hooks.example-crm.com"}
session = requests.Session()

def call(url, payload, context):
    host = urlparse(url).hostname
    if host not in ALLOWED_HOSTS:
        raise ValueError(f"host not allowed: {host}")
    budget = context.get_remaining_time_in_millis() / 1000 - 1     # leave 1 s spare
    return session.post(url, json=payload, timeout=(2, min(5, budget)))
```

**What happens, step by step:** a request asks the function to call `http://169.254.169.254/...`. The host isn't in `ALLOWED_HOSTS`, so it's rejected before any network call. A legitimate call to `api.partner.com` that hangs is cut after 2 s (connect) or at most 5 s (read), and the function can return a clean error well before its own timeout.

**Common mistake → fix:** `requests.get(url)` with no timeout. The `requests` library waits indefinitely by default, so a stuck server holds the environment until the function times out. Fix: always pass `timeout=`.

**Interview answer:** "Every outbound call gets a timeout shorter than the remaining function time. Destinations are allowlisted so user input can't redirect calls, which prevents SSRF. Credentials come from Secrets Manager with least privilege, TLS verification stays on, and for strict environments I enforce egress at the network layer with security groups, NAT and a firewall."

**Follow-ups:**
- *How do you pass the deadline to downstream calls?* Compute it from `get_remaining_time_in_millis()` minus a margin, as above.

---
## 7. Long-running work & newer compute types

### Q36. What are your options when work takes longer than 15 minutes?

**Short answer:** A single Lambda invocation stops at 15 minutes, so you **split** the work or **move** it. Split it into steps coordinated by **AWS Step Functions** or **Lambda durable functions** (both can wait for long periods without paying for compute), fan it out over many items with **Step Functions Distributed Map**, hand it to an **asynchronous service API** and resume on its completion event, or run a single long job on **ECS/Fargate** or **AWS Batch**.

**How it works — how to choose:**

| Situation | Best option |
|---|---|
| Several steps, retries, waits, human approval, many AWS service calls | Step Functions |
| Same, but you'd rather write the workflow as ordinary code inside Lambda | Lambda durable functions (up to 1 year) |
| Millions of independent items (files, rows) | Step Functions Distributed Map invoking Lambda per item/batch |
| An AWS service does the slow part (e.g. Textract, Transcribe, Bedrock batch) | Start the async job; continue when its completion notification arrives |
| One long CPU/GPU job that can't be split | ECS/Fargate task or AWS Batch |
| Steady load on asynchronous/queue work up to 90 min per call | Lambda Managed Instances (longer timeout for async and ESM invocations) |

**Example — analysing a 300-page PDF:**
1. Lambda A receives the S3 upload event and calls Textract `StartDocumentAnalysis` with an SNS topic for notification. It returns in 200 ms.
2. Textract works for 6 minutes; no Lambda is running or billing.
3. Textract publishes "SUCCEEDED" to SNS → SQS → Lambda B, which fetches the results and stores them.

**What happens, step by step:** total elapsed time is about 6 minutes, but Lambda compute is about 2 seconds across both functions. If Lambda A instead polled Textract in a loop, you'd pay for 6 minutes of waiting and risk the 15-minute limit on bigger documents.

**Common mistake → fix:** a function that processes a list of 5,000 items in a loop and times out at item 3,900; on retry it starts from item 1 again. Fix: process items in parallel (SQS fan-out or Distributed Map), or checkpoint progress (durable function steps).

**Interview answer:** "Lambda caps an invocation at 15 minutes, so I either decompose or move the work. For multi-step workflows with waits and retries I use Step Functions or Lambda durable functions; for big fan-outs, Step Functions Distributed Map; for slow AWS service jobs, start them asynchronously and resume on the completion event; and for a single long job, ECS/Fargate or Batch."

**Follow-ups:**
- *Why not just raise the timeout?* 900 seconds is the hard maximum for default Lambda invocations.

---

### Q37. What are Lambda durable functions?

**Short answer:** **Durable functions** let you write a long-running, multi-step workflow as **ordinary sequential code** in one Lambda function. You wrap risky work in **steps**; the SDK **checkpoints** each completed step. When the function needs to wait (a timer, a callback such as a human approval) it **suspends without compute charges**, and when it resumes Lambda **replays** your code from the top, returning saved results for completed steps instead of running them again. One durable execution can last up to **one year**.

**How it works:**
1. Enable durable execution when **creating** the function (`--durable-config`, e.g. `{"ExecutionTimeout": 3600, "RetentionPeriodInDays": 7}`); it can't be added later.
2. Wrap the handler with `@durable_execution` (Python) or `withDurableExecution` (JavaScript/TypeScript); you receive a `DurableContext`.
3. Use operations: `step`, `wait`, `wait_for_callback` / `create_callback`, `wait_for_condition`, `invoke` (another function), `parallel`, `map`, and child contexts.
4. Invoke with a **qualified** name (version or alias). The execution is pinned to that version, so a later deploy doesn't change in-flight executions.
5. Because of replay, **code outside steps runs again** on every resume and must be deterministic: no random numbers, current time or API calls outside steps.

**Example (Python):**
```python
from aws_durable_execution_sdk_python import DurableContext, durable_execution, durable_step
from aws_durable_execution_sdk_python.config import Duration

@durable_step
def extract(step_context, doc_id):
    return start_extraction(doc_id)                     # side effect: runs once

@durable_step
def publish(step_context, doc):
    return publish_document(doc)

@durable_execution
def lambda_handler(event, context: DurableContext):
    doc = context.step(extract(event["docId"]))
    decision = context.wait_for_callback(
        submitter=lambda callback_id, ctx: notify_reviewer(doc, callback_id),
        name="review")
    if decision["approved"]:
        context.step(publish(doc))
    return {"docId": event["docId"], "approved": decision["approved"]}
```

```flow
sequence: A durable execution that waits two days for a reviewer
actors: Function, Checkpoint log, Reviewer
Function -> Function: invocation 1 runs step extract(doc-42)
Function -> Checkpoint log: save extract result
Function -> Reviewer: notify with callback id cb-7
Function -> Function: suspend; no compute is billed while waiting
Reviewer -> Checkpoint log: two days later, SendDurableExecutionCallbackSuccess(cb-7, approved=true)
Function -> Checkpoint log: invocation 2 replays from the top
Checkpoint log --> Function: extract result returned from the log, so extraction does not run again
Function -> Function: publish step runs for the first time, execution completes
> The second invocation re-runs the handler code, but completed steps return their saved results instead of repeating side effects.
```

**What happens, step by step:**
1. Invocation 1: `extract` runs and its result is checkpointed. `wait_for_callback` sends the reviewer a callback ID and the function suspends; billing stops.
2. Two days later the reviewer's system calls `SendDurableExecutionCallbackSuccess` with `{"approved": true}`.
3. Invocation 2 starts from the top. `context.step(extract(...))` finds a checkpoint and returns the stored result without calling `start_extraction`. `wait_for_callback` returns `{"approved": true}`.
4. `publish` runs for the first time and the execution completes with `{"docId": "doc-42", "approved": true}`.

**Common mistake → fix:** `created_at = datetime.now()` at the top of the handler and then using it in a step's input. On replay, `created_at` has a new value, so the code no longer matches the checkpoint log (non-deterministic). Fix: compute non-deterministic values **inside** a step so they're checkpointed once.

**Interview answer:** "Durable functions let me write a multi-step workflow as normal code in one Lambda function. Steps are checkpointed, waits and callbacks suspend the execution without compute charges, and on resume the code replays from the start using stored results for completed steps, for up to a year. The rules are the same as any replay-based engine: keep side effects inside steps, keep code outside steps deterministic, and invoke a published version or alias so in-flight executions keep their code."

**Follow-ups:**
- *Durable functions or Step Functions?* Durable functions suit workflows tightly coupled to application code, written in Python, Node.js or Java. Step Functions suits orchestrating many AWS services with a visual graph, 220+ native integrations and no code to maintain (see the Step Functions course).
- *Do durable functions support Lambda destinations?* No; use a DLQ for failed invocations.

---

### Q38. What are Lambda Managed Instances?

**Short answer:** **Lambda Managed Instances** run your Lambda functions on **EC2 instances in your own account** that Lambda provisions, patches and scales for you. You choose instance types (e.g. Graviton4, network-optimised), and you pay **EC2 pricing plus a 15% management fee**, so Savings Plans and Reserved Instances apply. Unlike default Lambda, **one execution environment handles many requests at the same time**, so your code must be thread- and concurrency-safe.

**How it works:**
1. Create a **capacity provider**: VPC, subnets, optional instance requirements and scaling settings.
2. Attach a function to it and **publish a version**. Lambda launches instances (three by default for Availability Zone resilience) and starts execution environments before marking the version active.
3. Instances scale based on **CPU utilisation**, without per-request cold starts, and scale down to the configured minimum, **not to zero**.
4. Asynchronous and most event-source-mapping invocations can run for up to **90 minutes**.
5. Isolation uses containers on EC2 Nitro instances; the capacity provider is the security boundary.

**Example — when it pays off:**

| | Default Lambda | Managed Instances |
|---|---|---|
| Traffic | Spiky, idle at night | Steady 2,000 req/s all day |
| Concurrency | 1 request per environment | Many requests per environment |
| Scaling | Per request, scales to zero | On CPU, keeps a minimum |
| Pricing | Per request + GB-seconds | EC2 instance price + 15% fee |

**What happens, step by step (steady API, illustrative):** an I/O-heavy API spends 90% of each request waiting on DynamoDB. On default Lambda, each waiting request holds its own environment and is billed for the wait. On Managed Instances, one environment serves dozens of waiting requests at once, so far fewer CPUs are needed and the cost follows EC2 pricing instead of per-request duration.

**Common mistake → fix:** moving a function that stores per-request data in a module-level variable (`current_user = ...`). With concurrent requests in one environment, requests overwrite each other's data. Fix: keep request data in local variables or request-scoped context, and make shared clients thread-safe.

**Interview answer:** "Managed Instances let Lambda run functions on EC2 capacity in my account, which Lambda manages, priced as EC2 plus a 15% management fee so my discounts apply. Each environment handles multiple concurrent requests and scales on CPU without cold starts, but doesn't scale to zero. It fits steady, high-volume or I/O-heavy workloads, and the code must be safe for concurrent requests."

**Follow-ups:**
- *Can it use tenant isolation or SnapStart?* Tenant isolation isn't supported on Managed Instances; check the docs for each feature's support.

---

### Q39. What is tenant isolation mode?

**Short answer:** **Tenant isolation mode** makes Lambda route each invocation by a **tenant ID** you supply, so an execution environment only ever serves **one tenant**. It's for multi-tenant SaaS that runs customer-supplied code or processes sensitive tenant data, and want isolation without creating a function per tenant. It must be enabled when the function is **created** (`TenantIsolationMode: PER_TENANT`), and every invocation must pass a tenant ID.

**How it works:**
1. Create the function with `--tenancy-config '{"TenantIsolationMode": "PER_TENANT"}'`.
2. Invoke with `--tenant-id blue` (CLI), `TenantId="blue"` (SDK), or map a request value to the `X-Amz-Tenant-Id` header in an API Gateway REST API.
3. Lambda looks for an idle environment already assigned to `blue`; if none, it creates one for `blue`.
4. Your code reads the tenant from `context.tenant_id`.
5. Limits: not supported with function URLs, provisioned concurrency, SnapStart or Managed Instances; HTTP APIs can't set the header. There is an extra charge when tenant environments are created, and up to 2,500 tenant-isolated environments per 1,000 of concurrency.

**Example:**
```python
import boto3, json
lambda_client = boto3.client("lambda")
lambda_client.invoke(FunctionName="run-user-script", TenantId="blue",
                     Payload=json.dumps({"script": "print(1+1)"}))
```
```python
def lambda_handler(event, context):
    tenant = context.tenant_id              # "blue"
    return run_sandboxed(tenant, event["script"])
```

```flow
trace: Which environment serves which tenant
invoke tenant blue → no environment for blue → create env-1 (blue) > A cold start, because environments are never shared across tenants.
invoke tenant green → create env-2 (green) > Green cannot land on env-1 even though env-1 is idle.
invoke tenant blue again → reuse **env-1** > Same tenant, so the warm environment and its /tmp are reused.
blue's script wrote /tmp/data.csv > Only later blue invocations can ever see that file; green's code runs in env-2.
```

**What happens, step by step:** without tenant isolation, a malicious script from tenant green could read `/tmp/data.csv` left by tenant blue in a reused environment. With it, env-1 is dedicated to blue for its whole life.

**Common mistake → fix:** assuming tenant isolation also separates **permissions**. All tenants still use the same execution role. Fix: scope data access by tenant in code and with per-tenant resource ARNs or session tags; tenant isolation separates environments, not IAM.

**Interview answer:** "Tenant isolation mode routes invocations by a tenant ID so execution environments are never reused across tenants, which protects memory and /tmp between customers without a function per tenant. It's set at creation with PER_TENANT, every invoke must carry a tenant ID, and the code reads it from the context. The trade-offs are more cold starts, an extra charge, and some unsupported features like function URLs, provisioned concurrency and SnapStart; IAM permissions are still shared."

**Follow-ups:**
- *Can I enable it on an existing function?* No; it's immutable, so create a new function.

---

### Q40. What are Lambda Web Functions and Lambda MicroVMs?

**Short answer:** Lambda now has three compute types. **Event Functions** are classic Lambda functions (a handler called per event). **Web Functions** run a normal **Node.js HTTP server** (Express, Hono, React Router) behind a built-in HTTPS endpoint, with many concurrent requests per environment and scale to zero. **MicroVMs** are dedicated, isolated environments with your own image that live up to **8 hours**, can be suspended and resumed with memory and disk preserved, and suit running untrusted user- or AI-generated code per user or job.

**How it works:**

| | Event Functions | Web Functions | MicroVMs |
|---|---|---|---|
| Programming model | Handler per event | HTTP server listening on a port | Any app or binary from your image |
| Concurrency | 1 request per environment (default) | Many per environment | Many connections per MicroVM |
| Duration | 15 min per invoke (more with durable or Managed Instances) | Up to 15 min per request (30 s default) | Up to 8 hours per MicroVM |
| Scaling | Automatic | Automatic, to zero | You create, suspend, resume, terminate via API |
| Billing | Requests + GB-seconds | Requests + active CPU + memory over environment lifetime | Per second running + snapshot storage while suspended |

**Example — choosing:**
1. Process SQS messages → Event Function.
2. Move an existing Express API to serverless without adapters → Web Function (Node.js only).
3. Give each user of a coding assistant their own sandbox that keeps files between sessions → MicroVM per user, suspended when idle.

**What happens, step by step (Web Function):** you deploy a zip with an Express app listening on its port; Lambda creates an immutable **revision** and an **endpoint** that routes to it. Under load, each environment serves many requests concurrently, so a request waiting on a database costs little CPU; when traffic stops, environments are removed.

**Common mistake → fix:** using an Event Function with a 15-minute timeout as a per-user sandbox and trying to keep state in `/tmp` between sessions. Environments are recycled, so state disappears. Fix: a MicroVM, which preserves memory and disk on suspend, or external storage.

**Interview answer:** "Lambda now offers three primitives: Event Functions for event-driven handlers, Web Functions for Node.js HTTP servers with multi-request environments and a built-in HTTPS endpoint, and MicroVMs for long-lived, isolated per-user or per-job environments up to eight hours with suspend and resume. They share the Firecracker isolation and serverless operations model; I pick based on programming model, duration and how state must persist."

**Follow-ups:**
- *Did the classic API change?* No. "Event Function" is only a new name; `CreateFunction`, `Invoke` and existing templates work as before.

---

## 8. Observability

### Q41. What should you monitor on a Lambda function?

**Short answer:** Watch four areas. **Errors and throttles** (`Errors`, `Throttles`), **latency vs timeout** (`Duration` p95/p99 compared with the configured timeout), **capacity** (`ConcurrentExecutions` vs limits), and **backlog** for asynchronous and queue sources (`AsyncEventAge`, `AsyncEventsDropped`, `IteratorAge` for streams, SQS `ApproximateAgeOfOldestMessage`, DLQ depth). Pair metrics with **structured JSON logs** and **traces**.

**How it works:**
- Lambda publishes metrics to CloudWatch automatically.
- Lambda supports JSON log format and log-level filtering natively; Powertools adds request IDs and custom fields.
- Tracing (AWS X-Ray, AWS Distro for OpenTelemetry, CloudWatch Application Signals) shows which downstream call is slow.

**Example — a sensible alarm set:**

| Alarm | Condition | Why |
|---|---|---|
| Error rate | `Errors / Invocations` above 2% for 5 minutes | Code or dependency failures |
| Throttles | `Throttles` above 0 for 5 minutes | Concurrency limits reached |
| Near timeout | p99 `Duration` above 80% of timeout | About to start timing out |
| Queue age | `ApproximateAgeOfOldestMessage` above 300 s | Consumers falling behind |
| Stream lag | `IteratorAge` above 60 s | Shard blocked or too slow |
| Failures kept | DLQ / on-failure destination depth above 0 | Events that gave up |
| Async drops | `AsyncEventsDropped` above 0 | Events discarded without processing |

**What happens, step by step (an incident):** p99 duration climbs from 900 ms to 7 s with a 10 s timeout; the near-timeout alarm fires before any errors. Traces show the time is in a call to a partner API. Logs show retries. You reduce concurrency toward the partner and enable a cached fallback before the function starts timing out.

**Common mistake → fix:** alarming only on `Errors`. A queue consumer that's throttled or falling behind produces no errors, just a growing backlog. Fix: alarm on age/backlog metrics as well.

**Interview answer:** "I alarm on error rate, throttles, p99 duration relative to timeout and concurrency near limits, plus backlog metrics for async and queue sources: AsyncEventAge and drops, IteratorAge for streams, queue age and DLQ depth. Logs are structured JSON with request and correlation IDs, and traces show which dependency is slow."

**Follow-ups:**
- *What does `Duration` exclude?* For on-demand functions, the `REPORT` line shows `Init Duration` separately; use both to see cold-start impact.

---

### Q42. How do you find cold starts, memory use and p99 latency from the logs?

**Short answer:** Every invocation writes a `REPORT` line to CloudWatch Logs with `@duration`, `@billedDuration`, `@memorySize`, `@maxMemoryUsed` and, for cold starts, `@initDuration`. **CloudWatch Logs Insights** can aggregate those fields to show cold-start counts, p99 duration and peak memory per hour.

**Example:**
```text
filter @type = "REPORT"
| stats count() as invocations,
        sum(ispresent(@initDuration)) as coldStarts,
        pct(@duration, 99) as p99ms,
        max(@maxMemoryUsed / 1024 / 1024) as maxMemMB
  by bin(1h)
```

**What happens, step by step:**
1. `filter @type = "REPORT"` keeps one summary line per invocation.
2. `ispresent(@initDuration)` is 1 for cold starts, so the sum counts them.
3. `pct(@duration, 99)` gives p99 handler time; `@maxMemoryUsed` is in bytes, so it's converted to MB.
4. Sample result for one hour: `invocations=12,000, coldStarts=84, p99ms=640, maxMemMB=410`. Cold starts are 0.7% of calls; memory peaks at 410 MB of, say, 1,024 MB configured, so there's room to test a lower setting with Power Tuning.

**Common mistake → fix:** averaging duration. A 120 ms average can hide a 3 s p99 caused by cold starts. Fix: use percentiles and look at cold starts separately.

**Interview answer:** "Lambda's REPORT log line carries duration, billed duration, memory size, max memory used and, for cold starts, init duration. With Logs Insights I filter REPORT lines and compute cold-start counts, p99 duration and peak memory per hour, which drives decisions about memory size, SnapStart or provisioned concurrency."

**Follow-ups:**
- *Why might `Init Duration` be missing for some slow requests?* After a crash, a "suppressed init" is counted inside the next invocation's duration rather than as Init Duration.

---

## 9. Scenario & debugging questions

### Q43. A function times out, but CPU usage is low. What do you check?

**Short answer:** Low CPU plus a timeout means the function is **waiting**, not computing: a network call with no timeout, a VPC function with no route to its destination, a database connection or pool wait, or a downstream service throttling with long backoffs. Find **which call** is waiting, then add timeouts and fix the route or the dependency.

**Debugging steps:**
1. **Read the log timeline** for one timed-out request ID. Check: the last log line before `Task timed out`. Meaning: the call right after that line is where it hung.
2. **Open a trace** (X-Ray / OpenTelemetry). Check: which downstream segment is open until the timeout. Meaning: that's the waiting dependency.
3. **Is the function in a VPC?** Check: subnets, route tables, NAT gateway and VPC endpoints for the service being called. Meaning: a missing route makes TCP connects hang until a timeout fires.
4. **Do clients have timeouts?** Check: HTTP client and SDK settings (`requests` has no default timeout; boto3's default read timeout is 60 s with retries). Meaning: a short function timeout is consumed by one call.
5. **Is the dependency throttling?** Check logs for 429/`ThrottlingException` and SDK retry counts. Meaning: retries with backoff can add many seconds.
6. **Database waits?** Check RDS Proxy/DB connection metrics. Meaning: a pool at its limit makes callers queue.

**Example — the fix for a VPC function calling a partner API:**
```python
import requests
session = requests.Session()
resp = session.get("https://api.partner.com/rates", timeout=(2, 5))   # connect 2 s, read 5 s
```
plus a NAT gateway route for the private subnets.

**What happens, step by step:** before the fix, the connect attempt hung for the full 30 s function timeout because there was no route; logs ended with "calling partner…". After adding NAT, the call takes 300 ms; with explicit timeouts, any future network problem fails in 2–5 s with a clear error instead of a timeout.

**Interview answer:** "Timeouts with low CPU mean the function is waiting. I check the last log line before the timeout and the trace to find the waiting call, then check VPC routing — NAT or endpoints — client timeouts, downstream throttling and connection pools. The fix is explicit short timeouts on every call, correct routing, connection reuse or RDS Proxy, and moving slow work to async patterns."

**Follow-ups:**
- *Why does boto3 sometimes take much longer than one call?* Default retries with backoff; configure `botocore.config.Config(retries=..., connect_timeout=..., read_timeout=...)`.

---

### Q44. SQS messages are being processed twice. Why, and how do you fix it?

**Short answer:** Some duplicates are **normal**: SQS standard queues and Lambda event source mappings are **at-least-once**. But frequent duplicates usually come from a **visibility timeout shorter than processing time**, **whole-batch retries** without partial batch responses, or **timeouts after a side effect** already happened. Fix the configuration and make the handler **idempotent**.

**Debugging steps:**
1. **Compare times.** Check the queue's visibility timeout vs the function timeout and the real p99 duration. Meaning: if processing can outlast visibility, messages reappear mid-processing.
2. **Check for batch failures.** Look for invocation errors and whether `ReportBatchItemFailures` is enabled. Meaning: one failing message re-delivers the whole batch.
3. **Check for timeouts.** Look for `Task timed out` in logs. Meaning: the side effect may have completed but the message wasn't deleted.
4. **Check `ApproximateReceiveCount`** in the duplicate records. Meaning: above 1 confirms redelivery rather than the producer sending twice.
5. **Check the producer.** Look for duplicate sends with different message IDs. Meaning: duplicates created upstream need business-key deduplication.

**Example fix:**
```text
Function timeout 60 s → visibility timeout 6 × 60 + 5 (batching window) = 365 s
ReportBatchItemFailures enabled
Handler: idempotency key = orderId, DynamoDB conditional write (or Powertools @idempotent)
```

**What happens, step by step (before):** visibility 30 s, function timeout 60 s, a batch takes 45 s. At 30 s the messages become visible again and a second environment starts the same batch. Both finish and both send confirmation emails. **After:** messages stay hidden for 365 s, only failed messages are retried, and the idempotency check turns any remaining duplicate into a no-op.

**Interview answer:** "Duplicates are inherent to at-least-once delivery, but frequent ones usually mean the visibility timeout is shorter than processing, whole batches are retried because partial batch responses aren't enabled, or functions time out after doing the side effect. I set visibility to six times the timeout plus the batching window, enable ReportBatchItemFailures, and make the handler idempotent on a business key. FIFO queues with deduplication help where strict once-only ordering is needed."

**Follow-ups:**
- *Does a FIFO queue remove the need for idempotency?* No. FIFO deduplicates sends within 5 minutes, but a consumer timeout can still cause redelivery.

---

### Q45. How would you design Lambda processing for a spiky stream of about 300 documents per minute?

**Short answer:** **Buffer, cap, and go asynchronous.** Put **SQS** between the upload event and the processing function so spikes queue up instead of overwhelming dependencies; set the event source mapping's **maximum concurrency** to what downstream quotas allow; start slow work (OCR, model calls) with **asynchronous service APIs** using idempotent request tokens; and track each document's status with retries, a DLQ and alarms.

**How it works:**

```flow
pipeline: Spiky document processing with bounded concurrency
stage: 1. Ingest
S3 upload of invoice-881.pdf > The object-created event goes to EventBridge or an S3 notification.
SQS intake queue > Absorbs bursts; a 2,000-file spike simply waits here.
stage: 2. Start work
Lambda starter (maximum concurrency 20) > Never more than 20 parallel starters, which keeps OCR and model quotas safe.
Textract StartDocumentAnalysis, ClientRequestToken = file hash > A retried start returns the same job instead of creating a duplicate.
stage: 3. Finish
Completion notice via SNS to an SQS queue > No Lambda waits while the OCR job runs.
Lambda extractor calls the model with backoff > Bounded concurrency again, retries with jitter on throttling.
Save result and status to DynamoDB > Failed documents go to a DLQ and raise an alarm.
```

**What happens, step by step (a spike of 2,000 uploads in 2 minutes):**
1. 2,000 messages land in the intake queue. The starter scales to 20 concurrent invocations and stops there.
2. Each starter call takes about 300 ms, so 20 workers start roughly 60 jobs per second; the queue drains in under a minute without breaching the OCR start rate (illustrative quota).
3. OCR jobs run for minutes with no Lambda billing.
4. Completion messages arrive; the extractor (also capped) processes them; status per document moves `RECEIVED → OCR_STARTED → EXTRACTED`.
5. A corrupt PDF fails 5 times and lands in the DLQ; the alarm notifies the team.

**Common mistake → fix:** S3 invoking the processing function directly and the function waiting synchronously for OCR. A spike creates 2,000 concurrent invocations that all wait and get throttled by the OCR service. Fix: the buffered, asynchronous pipeline above.

**Interview answer:** "I'd buffer uploads in SQS, process them with a Lambda whose event source mapping has maximum concurrency set from downstream quotas, and start OCR asynchronously with an idempotent client token instead of waiting inside Lambda. Completion events trigger the next step, model calls retry with backoff under a concurrency cap, status lives in DynamoDB, and failures go to a DLQ with alarms. For multi-step orchestration with visibility I could put Step Functions around it."

**Follow-ups:**
- *How do you report progress to users?* Store status per document and expose it via an API, or push updates through a WebSocket or notification service.

---

### Q46. Cold starts are hurting an API's p99 latency. What do you do?

**Short answer:** **Measure first**, then reduce Init work, then pre-initialise if still needed. Confirm with `Init Duration` that cold starts actually explain the p99; shrink the package and lazy-load heavy imports; try more memory or arm64; then add **SnapStart** (Java, Python, .NET) or **provisioned concurrency** on the alias for the baseline. If traffic is steady 24/7, consider Managed Instances or a container service.

**Debugging steps:**
1. **Quantify.** Run the Logs Insights query from Q42. Check: cold-start percentage and the Init Duration distribution. Meaning: if 1% of requests have a 2 s Init, that alone sets the p99.
2. **Profile Init.** Log timestamps around imports and client creation (or use `python -X importtime` locally). Meaning: shows which import or download dominates.
3. **Reduce it.** Remove unused dependencies, lazy-load rare ones, avoid downloading large files during Init.
4. **Tune resources.** Test higher memory (more CPU during Init) and arm64.
5. **Pre-initialise.** SnapStart, or provisioned concurrency with Application Auto Scaling on a schedule for business hours.
6. **Re-measure** p99 and cost.

**Example (illustrative):**
```text
Before: p99 2.4 s, Init Duration ~1.9 s, 1.2% cold starts
Trim imports + lazy-load pdf library → Init 0.9 s, p99 1.3 s
Provisioned concurrency 15 on "live", 08:00–20:00 → p99 280 ms during business hours
```

**What happens, step by step:** cutting Init in half halved the cold-start penalty for free. Provisioned concurrency sized to the business-hours baseline removed cold starts for most requests, and scaling it down at night limited the cost.

**Interview answer:** "I first prove cold starts are the cause using Init Duration from the REPORT logs. Then I reduce init work — fewer dependencies, lazy imports, no big downloads — and test more memory or arm64. If p99 still misses the target, I add SnapStart or provisioned concurrency on the alias, scheduled to the traffic pattern, and re-measure. For constant heavy load, an always-on option may be simpler."

**Follow-ups:**
- *Why not just set provisioned concurrency very high?* You pay for it all the time; size it to the baseline and let bursts use on-demand.

---

### Q47. A Lambda function costs much more than expected. How do you investigate?

**Short answer:** Lambda cost = requests + memory × duration (+ extras), so check each factor: **invocation count** (retries, recursive triggers, noisy events), **duration** (time spent waiting on I/O), **memory** (over-provisioned), and **extras** (provisioned concurrency left on, large ephemeral storage, verbose CloudWatch logging, data transfer).

**Debugging steps:**
1. **Invocations trend.** Check: `Invocations` vs business volume. Meaning: a jump without more business events suggests retries, a loop (check `RecursiveInvocationsDropped`) or an unfiltered trigger.
2. **Duration.** Check p50/p99 and traces. Meaning: long durations with low CPU = paying to wait (move to async/Step Functions/durable waits; add timeouts).
3. **Memory.** Compare `@maxMemoryUsed` with configured memory; run Power Tuning. Meaning: 3 GB configured but 300 MB used on I/O-bound code is waste.
4. **Provisioned concurrency.** Check its configuration and `ProvisionedConcurrencyUtilization`. Meaning: low utilisation = paying for idle environments.
5. **Logs.** Check CloudWatch Logs ingestion for the log group. Meaning: debug-level logs at high volume can cost more than compute.
6. **Architecture.** x86 vs arm64; steady load might be cheaper on Managed Instances.

**Example (illustrative):**
```text
Invocations: 40 M/month, expected 8 M → S3 trigger had no prefix filter; function also fired on its own outputs
Duration: p50 3.1 s, of which 2.8 s waiting on a model API
Memory: 2,048 MB configured, 280 MB max used
```

**What happens, step by step:** adding a prefix filter dropped invocations to 8 M; lowering memory to 512 MB (no slowdown, since the work is I/O) cut GB-seconds by 75%; moving the model call to an asynchronous pattern removed most of the waiting time. Together, cost fell by more than 90% (illustrative).

**Interview answer:** "I break cost into requests, memory times duration, and extras. I look for unexpected invocation volume from retries, loops or unfiltered triggers; long durations that are really waiting on I/O; over-provisioned memory compared with max memory used; provisioned concurrency with low utilisation; and log volume. Then I fix the biggest factor first and re-measure."

**Follow-ups:**
- *Which tool finds the best memory size?* AWS Lambda Power Tuning, which runs the function at several memory settings and plots cost against speed.

---

### Q48. An asynchronously invoked function seems to silently lose events. What's happening?

**Short answer:** With asynchronous invocation, events are **discarded** when retries are exhausted or the **maximum event age** passes (for example while the function is throttled), and if no **on-failure destination** or **DLQ** is configured, nothing records them. Configure a destination, alarm on drops, and make failures visible.

**Debugging steps:**
1. **Check `Errors`.** Meaning: function errors lead to two retries by default and then discard.
2. **Check `Throttles` and `AsyncEventAge`.** Meaning: throttled events wait in the internal queue; if the age exceeds the maximum event age (default 6 hours, or less if configured) they're dropped.
3. **Check `AsyncEventsDropped`.** Meaning: confirms events were discarded without processing.
4. **Check the event invoke configuration** (`get-function-event-invoke-config`). Meaning: shows retry attempts, maximum age and destinations; often `MaximumRetryAttempts: 0` or a short maximum age was set.
5. **Check `DestinationDeliveryFailures` / `DeadLetterErrors`.** Meaning: a destination exists but Lambda can't write to it (permissions, FIFO target, size).
6. **Check the handler.** Meaning: code that catches all exceptions and returns success "hides" failures from Lambda entirely.

**Example fix:**
```bash
aws lambda put-function-event-invoke-config --function-name notify-customer \
  --maximum-retry-attempts 2 --maximum-event-age-in-seconds 21600 \
  --destination-config '{"OnFailure":{"Destination":"arn:aws:sqs:eu-west-1:123456789012:notify-failures"}}'
```
Plus an alarm on the `notify-failures` queue depth and on `AsyncEventsDropped`.

**What happens, step by step:** previously, a reserved concurrency of 2 throttled a burst; events aged past a 1-hour maximum age that someone had set and were silently dropped. Now throttled events can wait up to 6 hours, anything that still fails lands in `notify-failures` with the error and attempt count, and the team is alerted.

**Interview answer:** "Async invocations drop events after retries or maximum event age run out, and without an on-failure destination or DLQ there's no record. I check Errors, Throttles, AsyncEventAge and AsyncEventsDropped, review the event invoke config, and confirm the handler isn't swallowing exceptions. The fix is an on-failure destination with alarms, sensible retry and age settings, enough concurrency, and an idempotent handler for replays."

**Follow-ups:**
- *What happens to async events when reserved concurrency is 0?* Lambda sends new events straight to the DLQ or on-failure destination without retries.

---

## 10. Cheat sheet

| Concept | Remember |
|---|---|
| Lambda | Serverless functions run on events; pay per request + GB-second; 15 min max per invoke |
| Execution environment | Firecracker microVM; Init once (10 s cap on-demand), many Invokes one at a time, then Shutdown |
| Globals and /tmp | Reused while warm; cache clients there; never store per-request data |
| Handler | `handler(event, context)`; return value matters only for sync callers |
| Limits | Memory 128 MB–10 GB (CPU scales, 1 vCPU ≈ 1,769 MB); /tmp 512 MB–10 GB; 6 MB sync, 1 MB async, 200 MB streamed |
| Packages | Zip ≤ 250 MB unzipped incl. up to 5 layers; container image ≤ 10 GB |
| Permissions | Execution role = what the function can do; resource policy = who can invoke |
| Invocation | Sync (caller retries) · Async (2 retries, 6 h max age, destinations) · ESM (Lambda polls batches) |
| SQS | Visibility ≥ 6× timeout (+ window); ReportBatchItemFailures; DLQ on the queue, maxReceiveCount ≥ 5; max concurrency 2–1,000 |
| Streams | In order per shard; set retries + max record age, bisect, on-failure destination; watch IteratorAge |
| Idempotency | At-least-once → business key + conditional write (Powertools) |
| Concurrency | ≈ req/s × duration; 1,000 default account limit; +1,000 environments per 10 s per function |
| Reserved vs provisioned | Reserved = cap + guarantee (free); provisioned = pre-warmed (paid) |
| Cold starts | Trim Init, lazy imports, more memory, SnapStart (Java/Python/.NET), provisioned concurrency |
| Versions/aliases | Immutable versions; alias weights for canary; never point prod at $LATEST |
| VPC | Private access via Hyperplane ENIs; internet needs NAT; AWS APIs via endpoints |
| Long work | Step Functions, durable functions (≤ 1 year, checkpoint + replay), async service APIs, ECS/Batch |
| Newer compute | Managed Instances (EC2 + 15% fee, multi-concurrency), Web Functions (Node.js HTTP servers), MicroVMs (≤ 8 h sandboxes), tenant isolation (PER_TENANT) |
| Recursive loops | Detected via SQS/SNS/S3/EventBridge after ~16 hops; design them out anyway |

## Official references

- What is Lambda: https://docs.aws.amazon.com/lambda/latest/dg/welcome.html
- Quotas: https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html
- Execution environment lifecycle: https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html
- Scaling and concurrency: https://docs.aws.amazon.com/lambda/latest/dg/scaling-behavior.html · https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html
- Async error handling and destinations: https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-error-handling.html · https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-retain-records.html
- Event source mappings and SQS: https://docs.aws.amazon.com/lambda/latest/dg/invocation-eventsourcemapping.html · https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html
- Recursive loop detection: https://docs.aws.amazon.com/lambda/latest/dg/invocation-recursion.html
- SnapStart: https://docs.aws.amazon.com/lambda/latest/dg/snapstart.html
- Response streaming: https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html
- Durable functions: https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html · https://docs.aws.amazon.com/durable-execution/
- Managed Instances: https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances.html
- Tenant isolation: https://docs.aws.amazon.com/lambda/latest/dg/tenant-isolation.html
- Web Functions: https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html
- Powertools for AWS Lambda (Python): https://docs.powertools.aws.dev/lambda/python/latest/
