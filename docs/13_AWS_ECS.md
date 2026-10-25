# Amazon ECS: Interview Preparation

> **Updated:** 24 October 2026 · **Level:** core concepts → networking, IAM, deployments → scaling & production debugging
> **How to use:** *Short answer* = what you say first. *Explanation / Example* = intuition and config. *Pitfall / Follow-up* = where interviewers dig.

---

## Table of contents

1. [Mental model: ECS building blocks](#1-mental-model-ecs-building-blocks)
2. [Fundamentals](#2-fundamentals) (Q01–Q08)
3. [Networking & load balancing](#3-networking--load-balancing) (Q09–Q13)
4. [IAM, secrets & configuration](#4-iam-secrets--configuration) (Q14–Q16)
5. [Deployments](#5-deployments) (Q17–Q21)
6. [Scaling, placement & capacity](#6-scaling-placement--capacity) (Q22–Q25)
7. [Operations & observability](#7-operations--observability) (Q26–Q29)
8. [Choosing compute](#8-choosing-compute) (Q30)
9. [Scenario & debugging questions](#9-scenario--debugging-questions) (Q31–Q37)
10. [Cheat sheet](#10-cheat-sheet)

---

## 1. Mental model: ECS building blocks

**ECS = AWS's container orchestrator.** You describe *what* to run (task definition) and *how many* (service); ECS keeps that many running, replaces failures, registers them with load balancers, and rolls out new versions.

```
 ┌──────────────────────────────────── ECS Cluster "prod" ──────────────────────────────────────┐
 │                                                                                              │
 │  Task Definition "api:42"  (blueprint, versioned)                                            │
 │   ├─ container "app": image ECR@sha256…, port 8000, cpu/mem, env, secrets, logs, healthCheck │
 │   ├─ container "otel-collector" (sidecar)                                                    │
 │   ├─ taskRoleArn (app permissions)   executionRoleArn (pull image, write logs, read secrets) │
 │   └─ networkMode awsvpc, cpu 1024, memory 2048, runtimePlatform ARM64                        │
 │                                                                                              │
 │  Service "api"  desiredCount=3  (keeps 3 tasks running, rolling/blue-green deploys)          │
 │     │                                                                                        │
 │     ├── Task (AZ-a, ENI 10.0.11.5) ──┐                                                        │
 │     ├── Task (AZ-b, ENI 10.0.12.9) ──┼──► registered in ALB Target Group (IP targets)          │
 │     └── Task (AZ-c, ENI 10.0.13.4) ──┘                                                        │
 │                                                                                              │
 │  Capacity: Fargate / Fargate Spot  │  ECS Managed Instances  │  EC2 Auto Scaling group (you)  │
 └──────────────────────────────────────────────────────────────────────────────────────────────┘
          ▲ control plane (AWS managed): scheduler, service controller, deployments, autoscaling
```

**Request flow for an API service:**
```flow
pipeline: Request path into an ECS service
Client > Calls api.example.com.
Route 53 > Resolves to the ALB.
ALB listener rule > HTTPS on 443; rule /api/* picks the target group.
Target group > Only healthy targets receive traffic (health check /health every 15 s).
Task ENI:8000 > With awsvpc networking every task has its own IP.
Container > Your app listening on port 8000.
```

---

## 2. Fundamentals

### Q01. What is Amazon ECS?

**Short answer:** A fully managed container orchestration service. You don't run the control plane (unlike self-managed Kubernetes); AWS schedules containers onto **Fargate** (serverless), **ECS Managed Instances** (AWS-managed EC2), or **your own EC2** instances. Deeply integrated with IAM, ALB, CloudWatch, ECR, Secrets Manager, Cloud Map.

```flow
pipeline: What ECS does for you
You define > Task definition: image, CPU/memory, ports, roles.
ECS schedules > Places tasks on Fargate or EC2 capacity.
ECS keeps them running > Replaces failed tasks to match desired count.
ECS integrates > Load balancers, autoscaling, logs, secrets, deployments.
```

**ECS vs EKS:** ECS is simpler and AWS-native; EKS gives Kubernetes APIs/ecosystem and portability at higher operational complexity.

---

### Q02. Task definition, task, service

**Short answer:**
- **Task definition** — immutable, versioned JSON blueprint (`family:revision`): containers, images, CPU/memory, ports, env, secrets, roles, logging, health checks, volumes.
- **Task** — a running instance of a task definition (one or more containers that start together on the same host, share network namespace in awsvpc).
- **Service** — long-running controller that maintains `desiredCount` tasks, replaces unhealthy ones, integrates with load balancers and handles deployments.

```flow
pipeline: Task definition → task → service
Task definition > Versioned blueprint: containers, image, CPU/memory, roles, env.
Task > A running copy of that blueprint.
Service > Keeps N tasks running, replaces failures, registers with the load balancer.
Deployment > Updating the service to a new task definition revision.
```

```json
{
  "family": "api",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024", "memory": "2048",
  "runtimePlatform": { "cpuArchitecture": "ARM64", "operatingSystemFamily": "LINUX" },
  "executionRoleArn": "arn:aws:iam::123:role/api-exec",
  "taskRoleArn": "arn:aws:iam::123:role/api-task",
  "containerDefinitions": [{
    "name": "app",
    "image": "123.dkr.ecr.ap-south-1.amazonaws.com/api@sha256:3f9c...",
    "essential": true,
    "portMappings": [{ "containerPort": 8000 }],
    "environment": [{ "name": "LOG_LEVEL", "value": "info" }],
    "secrets": [{ "name": "DB_PASSWORD", "valueFrom": "arn:aws:secretsmanager:...:secret:prod/db-AbC:password::" }],
    "healthCheck": { "command": ["CMD-SHELL", "curl -f http://localhost:8000/health || exit 1"],
                     "interval": 15, "timeout": 5, "retries": 3, "startPeriod": 30 },
    "logConfiguration": { "logDriver": "awslogs",
      "options": { "awslogs-group": "/ecs/api", "awslogs-region": "ap-south-1", "awslogs-stream-prefix": "app" } },
    "readonlyRootFilesystem": true,
    "stopTimeout": 60
  }]
}
```

---

### Q03. Fargate vs EC2 vs ECS Managed Instances

```flow
pipeline: Choosing ECS capacity
Fargate > No servers to manage; per-task billing; simplest.
ECS Managed Instances > AWS manages EC2 instances for you; pick instance types (incl. GPU); patched automatically.
EC2 capacity provider > Your own instances; full control; you patch and scale.
Decide by > Ops effort, cost at scale, special hardware.
```

| | **Fargate** | **ECS Managed Instances** | **EC2 launch type** |
|---|---|---|---|
| Servers | none to manage (microVM per task) | AWS provisions, patches and scales EC2 in your account | you manage AMIs, ASG, patching, agent |
| Instance choice | CPU/memory sizes only | choose instance families/attributes (incl. GPU) | full control |
| Isolation | strong (per-task microVM) | tasks share instances | tasks share instances |
| Pricing | per vCPU/GB-second | EC2 price + management fee | EC2 price (Spot/Savings Plans) |
| Good for | most services, spiky workloads, small teams | need specific instance types/GPUs without ops | very high steady scale, special kernels/daemons, max cost control |

**Fargate Spot** — up to ~70% cheaper, can be interrupted with a 2-minute warning → fine for fault-tolerant workers.

---

### Q04. Clusters and capacity providers

**Short answer:** A cluster is a logical grouping of services/tasks and capacity. **Capacity providers** define where tasks run (FARGATE, FARGATE_SPOT, ASG-backed or Managed Instances) and a **capacity provider strategy** splits tasks across them (`base` + `weight`). ASG capacity providers with **managed scaling** scale instances to fit pending tasks.

```flow
pipeline: Capacity provider strategy
Cluster > Logical group of services.
Capacity providers > FARGATE, FARGATE_SPOT, EC2 ASGs, Managed Instances.
Strategy (base + weight) > e.g. base 2 on FARGATE, then 1:3 FARGATE:FARGATE_SPOT.
Managed scaling > EC2 providers scale instances to fit tasks.
```

```
strategy: FARGATE base=2 weight=1, FARGATE_SPOT weight=3
→ first 2 tasks on on-demand Fargate, remaining tasks 1:3 on-demand:spot
```

---

### Q05. `RunTask` vs a service

**Short answer:** **Service** for long-running processes (APIs, queue consumers). **`RunTask`** for one-off/finite jobs: migrations, batch jobs, per-customer isolated workers, scheduled jobs (EventBridge Scheduler), or Step Functions `ecs:runTask.sync` (waits for completion).

```flow
pipeline: RunTask vs service
RunTask > Start a task once (batch job, migration); it ends when done.
Service > Long-running: keeps desired count, replaces failures, load balancer.
Scheduled RunTask > EventBridge Scheduler for cron jobs.
Choose by lifetime > Finite job → RunTask; always on → service.
```

---

### Q06. ECS Express Mode

A simplified way to deploy a web app/API from a container image: ECS sets up the service, ALB (shared where possible), HTTPS, autoscaling and networking with sensible defaults — useful for quick, standard web services; you can still customise the underlying resources.

```flow
pipeline: ECS Express Mode
Give an image > Plus minimal settings.
ECS creates the stack > Service, load balancer, scaling, networking, HTTPS URL with sensible defaults.
Running service > With best-practice config you can still customise.
Good for > Fast starts; move to explicit IaC when you need full control.
```

---

### Q07. Multiple containers in one task (sidecars)

Containers in the same task share the network namespace (`localhost`), can share volumes, and start/stop together. Use for sidecars: log router (FireLens/Fluent Bit), OTel collector, Envoy/Service Connect proxy. `dependsOn` controls start order (e.g., app waits for sidecar `HEALTHY`). Mark only critical containers `essential: true` — if an essential container stops, the whole task stops.

```flow
pipeline: One task, several containers
App container > Your service (essential).
Sidecar: log router (FireLens) > Ships logs.
Sidecar: OTel collector / proxy > Traces, metrics, mTLS.
Shared > Network namespace (localhost), volumes, lifecycle. If an essential container stops, the task stops.
```

---

### Q08. Task lifecycle and termination

```flow
pipeline: ECS task lifecycle
stage: Starting
PROVISIONING > Capacity and the network interface are prepared.
PENDING > Pulling the image, attaching the ENI.
ACTIVATING → RUNNING > Registered with the load balancer; serving traffic once healthy.
stage: Stopping
DEACTIVATING > Deregistered from the ALB; waits for the deregistration delay.
SIGTERM > Sent to each container.
Wait stopTimeout > Default 30 s (Fargate max 120 s) to drain.
SIGKILL → STOPPED > Anything still running is killed.
```
Apps must handle SIGTERM: stop accepting work, finish in-flight requests, exit. Set ALB **deregistration delay** to roughly your longest normal request (default 300 s is often too long for fast deploys, too short for long SSE streams). Fargate Spot gives 2-minute warning via SIGTERM + EventBridge event.

---

## 3. Networking & load balancing

### Q09. `awsvpc` network mode

**Short answer:** Each task gets its **own ENI** with a private IP in your subnet and its own **security groups** (required on Fargate). Pros: task-level firewall rules, VPC Flow Logs per task, IP targets for ALB. Cons: consumes subnet IPs (size subnets well); on EC2, ENI limits per instance (ENI trunking helps).

```flow
pipeline: awsvpc networking
Task starts > ECS creates an ENI in your subnet.
Task gets its own private IP > Like a small VM on the network.
Security group per task/service > Fine-grained rules.
Load balancer targets the IP > Target type "ip". Each task uses one subnet IP.
```

Other modes (EC2 only): `bridge` (Docker bridge, dynamic host ports), `host`.

---

### Q10. ALB integration: listeners, rules, target groups

```
 ALB listener :443 (ACM cert)
   ├─ rule: host=api.example.com, path=/v1/*      → target group tg-api   (ip targets, port 8000)
   ├─ rule: path=/agent/*                          → target group tg-agent
   └─ default                                       → fixed 404
 target group: health check /health, interval 15 s, healthy threshold 2, deregistration delay 30 s
```
The service's `loadBalancers` block maps container name + port to the target group; ECS registers/deregisters task IPs automatically. Set **health check grace period** so slow-starting tasks aren't killed.

**Long-lived connections (SSE/WebSocket for agent streaming):** raise ALB idle timeout (default 60 s), send heartbeats, and tune deregistration delay so deploys don't cut streams abruptly.

---

### Q11. Service-to-service communication: Service Connect vs Cloud Map vs internal ALB

```flow
sequence: Service Connect call between services
actors: orders task, Envoy proxy, Cloud Map, payments task
orders task -> Envoy proxy: http://payments:8080/charge
Envoy proxy -> Cloud Map: resolve healthy "payments" endpoints
Envoy proxy -> payments task: load-balanced request with retries/timeouts
payments task --> orders task: response
> Service Connect adds a managed proxy sidecar: discovery, retries and per-service metrics without an internal ALB.
```

| Option | How | When |
|---|---|---|
| **Service Connect** | managed Envoy sidecar + Cloud Map namespace; call `http://orders:8080`; retries, timeouts, metrics | ECS-to-ECS microservices |
| **Cloud Map service discovery** | DNS records (A/SRV) per task | simple DNS-based discovery |
| **Internal ALB** | L7 routing, health checks | shared entry point, non-ECS clients |
| **VPC Lattice** | cross-VPC/account service networking with IAM auth | multi-account platforms |

---

### Q12. Secure network egress

Tasks in private subnets; outbound via NAT (with egress filtering via Network Firewall if needed) or **VPC endpoints** only; SGs restrict outbound to required destinations; endpoint policies limit which buckets/secrets are reachable; DNS Firewall for domain allowlists.

```flow
pipeline: Controlling outbound traffic from tasks
Private subnets > No public IPs.
VPC endpoints for AWS services > ECR, S3, Secrets Manager, logs, Bedrock.
NAT for the rest > Only what's needed.
Egress filtering > Network Firewall / proxy with domain allowlists; SG egress rules.
```

---

### Q13. Public IP on Fargate tasks?

Only if in a public subnet with `assignPublicIp=ENABLED` (needed there to pull images without NAT). Production pattern: private subnets + NAT/endpoints; only the ALB is public.

```flow
pipeline: Public IP on Fargate? Usually no
Task in private subnet > No public IP.
Pull images via endpoints or NAT > ECR access still works.
Inbound via ALB in public subnets > Only the load balancer is exposed.
Public IP only > For simple demos in public subnets.
```

---

## 4. IAM, secrets & configuration

### Q14. Task role vs task execution role

**Short answer:**
| Role | Used by | For |
|---|---|---|
| **Task execution role** | ECS agent / Fargate | pull image from ECR, write logs to CloudWatch, fetch secrets/params referenced in the task definition |
| **Task role** | **your application code** | call AWS APIs at runtime (S3, DynamoDB, Bedrock, SQS) |

```flow
sequence: Execution role vs task role
actors: ECS agent, Execution role, ECR/Secrets, Your app, Task role, S3
ECS agent -> Execution role: before start: assume
Execution role -> ECR/Secrets: pull image, fetch secrets, create log stream
ECS agent -> Your app: start container
Your app -> Task role: SDK gets credentials (container credentials endpoint)
Task role -> S3: app calls AWS with the task role
> Execution role = ECS setting the task up. Task role = what your code may do.
```

Mixing them up is a classic bug: putting `s3:GetObject` on the execution role → app gets AccessDenied. The SDK in the container gets task-role credentials from the container credentials endpoint (`AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`).

---

### Q15. Environment variables and secrets injection

```flow
sequence: Secrets injected at task start
actors: ECS, Secrets Manager, Container
ECS -> Secrets Manager: GetSecretValue (execution role)
Secrets Manager --> ECS: value
ECS -> Container: start with env var DB_PASSWORD
> Read once at start: after rotation, running tasks keep the old value until replaced. Apps that must follow rotation should fetch at runtime with caching.
```

- `environment` — plain config (non-secret).
- `secrets` — reference **Secrets Manager** (whole secret or a JSON key) or **SSM Parameter Store**; injected as env vars at task start (execution role needs `secretsmanager:GetSecretValue` + `kms:Decrypt`).
- `environmentFiles` — env file in S3.

**Pitfall:** secrets injected at start **don't update** when rotated — tasks need a new deployment (or the app fetches the secret at runtime with caching).

---

### Q16. Task-level security hardening

Non-root `user`, `readonlyRootFilesystem: true` (+ tmpfs/ephemeral volume for scratch), drop Linux capabilities, no privileged mode, least-privilege task role per service, ECR image scanning, GuardDuty ECS runtime monitoring, ECS Exec access restricted and logged.

```flow
pipeline: Hardening a task
Non-root user > `user` in the task definition.
Read-only root filesystem > Writable tmp volume only.
Least-privilege task role > Only needed actions/resources.
No privileged, drop capabilities > Plus private subnets and tight SGs.
Secrets from Secrets Manager > Never plain env in the task definition.
```

---

## 5. Deployments

### Q17. Rolling deployments

**Short answer:** ECS starts new tasks with the new task definition and stops old ones, controlled by:
- `minimumHealthyPercent` — lowest % of desired tasks kept running (e.g., 100 → never drop capacity).
- `maximumPercent` — upper limit during deploy (e.g., 200 → can double temporarily).

```flow
pipeline: Rolling deployment (desired=4, min 100%, max 200%)
4 old tasks > Serving traffic.
Start 4 new > Max 200% allows 8 tasks at once.
New tasks healthy in ALB > Health checks pass; traffic now goes to both versions.
Stop old tasks > Min 100% is kept the whole time.
4 new tasks > Done with zero downtime. A circuit breaker rolls back if new tasks keep failing.
```

---

### Q18. Deployment circuit breaker and health-check grace period

**Circuit breaker** (`deploymentCircuitBreaker: {enable: true, rollback: true}`) detects a deployment whose tasks keep failing to reach steady state and **automatically rolls back** to the last working revision. **CloudWatch alarm-based rollback** can also trigger on, e.g., 5xx spikes. **Health-check grace period** ignores ALB health checks for N seconds after a task starts.

```flow
pipeline: Circuit breaker during a bad deploy
New tasks start > With the new revision.
Grace period > Health checks ignored while the app boots.
Tasks keep failing > Health checks or crashes.
Circuit breaker trips > Threshold of failed tasks reached.
Automatic rollback > Back to the last good revision.
```

---

### Q19. Blue/green, canary and linear deployments

**Short answer:** ECS now has **native blue/green** (plus **linear** and **canary** traffic shifting) built into the service: it launches the new ("green") revision alongside "blue", shifts ALB traffic (all at once, in steps, or a canary %), keeps blue for a **bake time**, and rolls back instantly on alarms. Lifecycle hooks (Lambda) can run tests at stages. Previously this required **CodeDeploy** (still supported).

```flow
pipeline: Native blue/green with a canary shift
Blue (v41) 100% > Current version takes all traffic.
Green (v42) started > New tasks start alongside.
Test listener checks > Validate green through a test listener before real users see it.
Shift 10% (canary) > A small share of real traffic.
Bake 10 min > Watch alarms. Any alarm → instant rollback to blue.
100% green > All traffic moves over.
Bake, then terminate blue > Blue is kept until the bake time passes, so rollback stays instant.
```
Use when you need fast rollback and production testing before full cutover.

---

### Q20. Zero / near-zero downtime checklist

Health checks that reflect readiness, grace period, `minimumHealthyPercent=100`, graceful SIGTERM handling, appropriate deregistration delay, backward-compatible DB migrations (expand-then-contract), immutable image digests, blue/green or canary with alarm rollback, multi-AZ spread.

```flow
pipeline: Zero-downtime checklist
Readiness check > Only send traffic when the app can serve.
Rolling min 100% / blue-green > Old tasks keep serving.
Deregistration delay > In-flight requests finish.
Graceful SIGTERM handling > Drain before exit.
Backward-compatible changes > DB/API work with old and new versions.
```

---

### Q21. Who owns what: Terraform vs CI deployments

Two common patterns:
1. **Terraform owns everything**; CI passes the new image tag/digest as a variable and runs apply.
2. **Terraform owns infrastructure**, CI registers new task definitions and updates the service (`aws ecs update-service` / ECS deploy action); Terraform uses `lifecycle { ignore_changes = [task_definition, desired_count] }`.

```flow
pipeline: Terraform vs CI responsibilities
Terraform > Cluster, service, ALB, roles, scaling, alarms.
CI pipeline > Builds image, registers task definition revision, updates service.
Avoid fighting > `ignore_changes` on task_definition in Terraform when CI deploys.
One owner per field > Otherwise the two keep undoing each other.
```

Pick one owner per attribute; otherwise Terraform "reverts" deployments or autoscaling.

---

## 6. Scaling, placement & capacity

### Q22. Service Auto Scaling

```flow
cycle: Target tracking autoscaling
Measure > Average CPU, or requests per target, or queue backlog per task.
Compare with target > e.g. CPU 60%.
Scale out fast > Above target → add tasks.
Scale in slowly > Below target for a while → remove tasks (cooldown).
exit > Continuous; set min/max task counts as guardrails.
```

| Policy | Example |
|---|---|
| **Target tracking** | keep average CPU at 60%, or `ALBRequestCountPerTarget` at 500 |
| **Step scaling** | +2 tasks when queue depth > 1000, +5 when > 5000 |
| **Scheduled** | scale to 10 at 9 am weekdays |
| **Predictive** | forecast-based scaling ahead of daily patterns |

For **queue workers**, scale on **backlog per task** (`ApproximateNumberOfMessagesVisible / running tasks`) or age of oldest message, not CPU. Set min/max, cooldowns, and remember scale-out takes time (image pull, start) — keep headroom.

---

### Q23. CPU and memory settings

Fargate: task-level CPU/memory from fixed combinations (e.g., 0.25 vCPU–16 vCPU). Container-level: `memory` (hard limit → OOM kill, exit 137) and `memoryReservation` (soft), `cpu` units (1024 = 1 vCPU; shares on EC2). Right-size using Container Insights metrics; Python: memory per worker × workers + overhead.

```flow
pipeline: Sizing CPU and memory
Task-level size > Fargate valid CPU/memory combinations.
Container limits > Hard memory limit → OOM kill when exceeded.
Measure under load > p95 memory + headroom.
Workers per task > Match to vCPUs (e.g. Uvicorn workers).
```

---

### Q24. Task placement (EC2/Managed Instances)

Placement **strategies**: `spread` (by AZ/instance — HA), `binpack` (by memory/CPU — cost), `random`. **Constraints**: `distinctInstance`, `memberOf` (instance type/attribute expressions). Fargate spreads across AZs automatically.

```flow
pipeline: Task placement on EC2 capacity
Constraints > Must: instance type, AZ, distinctInstance.
Strategies > Spread across AZs, then binpack on memory to save cost.
Resources available? > CPU, memory, ports, ENIs.
Place or wait > No fit → task stays PROVISIONING / placement fails.
```

---

### Q25. Why tasks fail to place or start

```flow
pipeline: Why tasks fail to place or start
No capacity / IPs > Subnet out of IPs, no instance fits.
Can't pull image > Execution role, NAT/endpoints, wrong tag/arch.
Can't fetch secrets > Execution role or KMS permissions.
App crashes / unhealthy > Read stopped reason + container logs.
```

| Error / symptom | Cause |
|---|---|
| "unable to place a task… no container instance met all requirements" | EC2 capacity lacks CPU/memory/ports, or constraints too strict |
| `RESOURCE:ENI` / no free IPs | subnet IP exhaustion / ENI limits |
| `CannotPullContainerError` | no route to ECR (NAT/endpoints), execution role, wrong image/arch |
| `ResourceInitializationError: unable to pull secrets` | execution role lacks secret/KMS permissions or no route to Secrets Manager |
| Essential container exited | app crash — check logs & exit code |
| Fargate capacity unavailable (Spot) | use mixed strategy with on-demand base |

`aws ecs describe-tasks` → `stoppedReason`, container `reason`/`exitCode`; service **events** tab.

---

## 7. Operations & observability

### Q26. Key metrics and alarms

Service: `CPUUtilization`, `MemoryUtilization` (Container Insights for per-task detail), running vs desired task count, deployment failures. ALB: `HTTPCode_Target_5XX_Count`, `TargetResponseTime` p95/p99, `UnHealthyHostCount`, `RequestCountPerTarget`. Workers: SQS `ApproximateAgeOfOldestMessage`, DLQ depth. Plus app-level latency/error SLOs and traces (ADOT/X-Ray, Application Signals).

```flow
pipeline: Metrics to alarm on
Service > Running vs desired count, deployment failures.
Load balancer > 5xx, target response time p99, unhealthy hosts.
Tasks > CPU/memory utilisation, OOM stops.
Work queues > Age of oldest message, backlog per task.
```

---

### Q27. Logging options

`awslogs` driver → CloudWatch Logs (simple); **FireLens** (Fluent Bit sidecar) → route/filter logs to CloudWatch, S3, OpenSearch, third parties. Log JSON to stdout; include request/trace IDs; set retention.

```flow
pipeline: Getting logs out of tasks
App writes JSON to stdout > No log files inside the container.
awslogs driver > Straight to CloudWatch Logs.
FireLens (Fluent Bit) > Route to OpenSearch, S3, third-party tools.
Correlate > trace_id in every line.
```

---

### Q28. Debugging inside a running task: ECS Exec

`aws ecs execute-command --cluster prod --task <id> --container app --interactive --command "/bin/sh"` — uses SSM; requires `enableExecuteCommand` on the service and task role SSM permissions. Restrict with IAM and log sessions (KMS + CloudWatch/S3).

```flow
sequence: ECS Exec into a running task
actors: Engineer, ECS API, SSM, Task container
Engineer -> ECS API: execute-command --interactive --command sh
ECS API -> SSM: start session (IAM + enableExecuteCommand checked)
SSM -> Task container: SSM agent in the task opens a shell
Task container --> Engineer: interactive shell
> No SSH or open ports; every session can be logged to CloudWatch/S3.
```

---

### Q29. Scheduled and event-driven tasks

EventBridge Scheduler (cron/rate) or EventBridge rules → `RunTask`; Step Functions `ecs:runTask.sync` for orchestrated jobs (waits for completion, captures exit code); S3 event → SQS → worker service scaling on backlog.

```flow
pipeline: Scheduled and event-driven tasks
EventBridge Scheduler (cron) > Nightly report.
EventBridge rule on an event > File uploaded → process it.
Target: RunTask > With overrides (env, command).
Monitor > Task exit codes, failures to DLQ / alarms.
```

---

## 8. Choosing compute

### Q30. ECS vs Lambda vs AWS Batch vs AgentCore Runtime vs EKS

```flow
pipeline: Where a workload should run
Short, event-driven, spiky > Lambda.
Long-running services, containers > ECS (Fargate/Managed Instances).
Large batch jobs with queues > AWS Batch.
Agents with per-session isolation > AgentCore Runtime.
Need Kubernetes ecosystem > EKS.
```

| Need | Choose |
|---|---|
| Long-running HTTP API, streaming, WebSockets, steady traffic | **ECS (Fargate)** |
| Event-driven short tasks (≤15 min), spiky, pay-per-request | **Lambda** |
| Large batch/HPC jobs with queues, retries, Spot, GPUs | **AWS Batch** (runs on ECS/EKS) |
| Per-user isolated **agent sessions**, agent protocols (MCP/A2A), up to 8 h sessions | **AgentCore Runtime** |
| Kubernetes ecosystem/portability, many teams with K8s skills | **EKS** |

Typical AI stack: React → ALB → FastAPI on ECS → AgentCore Runtime (agent) → Gateway → Lambda tools; ECS workers for heavy document processing.

---

## 9. Scenario & debugging questions

### Q31. An ECS API works for 10 users but fails at 200

Check: ALB 5xx (502 = task closed connection/crashed, 503 = no healthy targets, 504 = timeout); task CPU/memory saturation & OOM kills; app worker/thread/event-loop limits (one Uvicorn worker, blocking calls); DB connection pool exhaustion; downstream throttling (Bedrock/DynamoDB 429); autoscaling too slow or max too low. Fix bottleneck → tune autoscaling (request count per target) → load test.

```flow
pipeline: Works for 10 users, fails at 200
Find the bottleneck > Traces + metrics: CPU, memory, event-loop lag, pools.
Blocking calls in async code? > Freeze workers.
Pools and limits > DB connections, HTTP clients, file descriptors.
Scaling configured? > Autoscaling policy, max tasks, ALB targets.
```

---

### Q32. Image runs in Docker locally but not on ECS

Architecture mismatch (arm64 vs x86) → `exec format error`; app binds `localhost` not `0.0.0.0`; missing env vars/secrets that existed in local `.env`; read-only root FS blocks writes to `/tmp` (add volume); non-root user permissions; health check uses a tool not in the image; no network route to dependencies; task role permissions differ from your local credentials.

```flow
pipeline: Runs locally, not on ECS
Architecture > arm64 vs x86 image.
Env / secrets > Missing variables, secrets not injected.
Network > Can it reach DB/APIs from private subnets (SGs, endpoints)?
Permissions > Task role vs your local admin credentials.
Port / host > App listening on 0.0.0.0 and the mapped port.
```

---

### Q33. Tasks keep restarting with "Task failed ELB health checks"

App slow to boot (raise grace period/`startPeriod`), wrong health check path/port/success codes (redirect 301 counts as failure unless allowed), SG doesn't allow ALB → task port, health endpoint depends on a failing downstream (make liveness shallow), container listening on different port than target group.

```flow
pipeline: "Task failed ELB health checks" loop
Path + port + expected code > /health on the container port returns 200?
Startup time vs grace period > Slow boot killed early.
Security group > ALB SG allowed into the task SG on that port?
Health check too strict? > Depends on DB/LLM → one outage kills every task.
```

---

### Q34. Launch one isolated worker task per customer job

API validates and stores job → Step Functions or SQS consumer calls `RunTask` with overrides (job ID as env/command), dedicated task role scoped by tags/session policy to that customer's S3 prefix, private subnets, timeouts, results to S3, status in DynamoDB, concurrency limits (Step Functions Map `MaxConcurrency`) to protect quotas, cleanup and DLQ for failures.

```flow
sequence: One isolated task per customer job
actors: API, Step Functions, ECS RunTask, Worker task
API -> Step Functions: start job (customer c1)
Step Functions -> ECS RunTask: RunTask .sync with overrides (JOB_ID, tenant)
ECS RunTask -> Worker task: dedicated task, tenant-scoped role/session tags
Worker task --> Step Functions: exit 0 → workflow continues
> Isolation per job; Step Functions waits for completion and handles retries and timeouts.
```

---

### Q35. A deployment is stuck "in progress" for an hour

New tasks failing health checks or failing to start (look at service events and stopped tasks); `minimumHealthyPercent=100` with no spare capacity on EC2 (can't start new before stopping old); circuit breaker disabled; draining waiting on long deregistration delay. Enable circuit breaker + rollback; fix root cause.

```flow
pipeline: Deployment stuck "in progress"
New tasks healthy? > If not, they keep being replaced.
Capacity? > Not enough CPU/memory/IPs for old + new tasks.
Deployment config > min/max percent blocking progress.
Circuit breaker off? > Enable it so failures roll back instead of hanging.
```

---

### Q36. Costs are high for an ECS service

Right-size CPU/memory (Container Insights), Graviton/ARM64, Fargate Spot for workers, scale-to-zero for idle workers (min 0 with queue-based scaling), Compute Savings Plans, reduce NAT data processing via VPC endpoints, log retention and volume.

```flow
pipeline: Cutting ECS costs
Right-size tasks > Measured CPU/memory, not guesses.
Autoscale to demand > Lower min count off-peak.
Spot / Graviton > FARGATE_SPOT for interruptible work; ARM is cheaper.
Savings Plans > For the steady baseline.
Cut NAT data > VPC endpoints for AWS traffic.
```

---

### Q37. Design a zero-downtime deploy for a streaming agent API

Blue/green with bake time, ALB idle timeout > max idle stream gap with heartbeats, deregistration delay long enough for in-flight streams (or clients reconnect with resume tokens), graceful SIGTERM that stops new streams and finishes current ones within `stopTimeout` (max 120 s on Fargate — so design clients to reconnect), alarm-based rollback.

```flow
pipeline: Zero-downtime deploy for a streaming API
Blue/green with test listener > Validate before traffic.
Long deregistration delay > Let active streams finish.
SIGTERM → stop accepting, finish streams > Within stopTimeout.
Clients reconnect with Last-Event-ID > Resume on the new version.
```

---

## 10. Cheat sheet

| Concept | One-liner |
|---|---|
| Task definition | versioned blueprint (image, cpu/mem, roles, env, secrets, logs) |
| Task / Service | running copy / controller keeping N copies + deploys |
| Fargate / Managed Instances / EC2 | serverless / AWS-managed EC2 / you manage EC2 |
| awsvpc | ENI + SG per task; watch subnet IPs |
| Task role vs execution role | app's AWS calls vs pull image/logs/secrets |
| Secrets | `secrets` from Secrets Manager/SSM; injected at start |
| Rolling | min/max percent |
| Circuit breaker | auto-rollback failed deployments |
| Blue/green / canary / linear | native ECS traffic shifting with bake + alarms |
| Scaling | target tracking (CPU/requests), queue backlog per task for workers |
| Termination | deregister → SIGTERM → stopTimeout → SIGKILL |
| Debug | service events, stoppedReason, exit codes, ECS Exec |
| Choose | ECS for APIs/workers; Lambda for short events; AgentCore for agent sessions |

## Official references

- https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html
- Task definitions: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definitions.html
- Deployments (rolling, blue/green, canary, linear): https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-types.html
- IAM roles: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html
- Service auto scaling: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-auto-scaling.html
- Best practices guide: https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/intro.html
