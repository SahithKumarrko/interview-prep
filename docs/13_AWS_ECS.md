# Amazon ECS: L2 → L3 Interview Preparation

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

**ECS vs EKS:** ECS is simpler and AWS-native; EKS gives Kubernetes APIs/ecosystem and portability at higher operational complexity.

---

### Q02. Task definition, task, service

**Short answer:**
- **Task definition** — immutable, versioned JSON blueprint (`family:revision`): containers, images, CPU/memory, ports, env, secrets, roles, logging, health checks, volumes.
- **Task** — a running instance of a task definition (one or more containers that start together on the same host, share network namespace in awsvpc).
- **Service** — long-running controller that maintains `desiredCount` tasks, replaces unhealthy ones, integrates with load balancers and handles deployments.

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

```
strategy: FARGATE base=2 weight=1, FARGATE_SPOT weight=3
→ first 2 tasks on on-demand Fargate, remaining tasks 1:3 on-demand:spot
```

---

### Q05. `RunTask` vs a service

**Short answer:** **Service** for long-running processes (APIs, queue consumers). **`RunTask`** for one-off/finite jobs: migrations, batch jobs, per-customer isolated workers, scheduled jobs (EventBridge Scheduler), or Step Functions `ecs:runTask.sync` (waits for completion).

---

### Q06. ECS Express Mode

A simplified way to deploy a web app/API from a container image: ECS sets up the service, ALB (shared where possible), HTTPS, autoscaling and networking with sensible defaults — useful for quick, standard web services; you can still customise the underlying resources.

---

### Q07. Multiple containers in one task (sidecars)

Containers in the same task share the network namespace (`localhost`), can share volumes, and start/stop together. Use for sidecars: log router (FireLens/Fluent Bit), OTel collector, Envoy/Service Connect proxy. `dependsOn` controls start order (e.g., app waits for sidecar `HEALTHY`). Mark only critical containers `essential: true` — if an essential container stops, the whole task stops.

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

| Option | How | When |
|---|---|---|
| **Service Connect** | managed Envoy sidecar + Cloud Map namespace; call `http://orders:8080`; retries, timeouts, metrics | ECS-to-ECS microservices |
| **Cloud Map service discovery** | DNS records (A/SRV) per task | simple DNS-based discovery |
| **Internal ALB** | L7 routing, health checks | shared entry point, non-ECS clients |
| **VPC Lattice** | cross-VPC/account service networking with IAM auth | multi-account platforms |

---

### Q12. Secure network egress

Tasks in private subnets; outbound via NAT (with egress filtering via Network Firewall if needed) or **VPC endpoints** only; SGs restrict outbound to required destinations; endpoint policies limit which buckets/secrets are reachable; DNS Firewall for domain allowlists.

---

### Q13. Public IP on Fargate tasks?

Only if in a public subnet with `assignPublicIp=ENABLED` (needed there to pull images without NAT). Production pattern: private subnets + NAT/endpoints; only the ALB is public.

---

## 4. IAM, secrets & configuration

### Q14. Task role vs task execution role

**Short answer:**
| Role | Used by | For |
|---|---|---|
| **Task execution role** | ECS agent / Fargate | pull image from ECR, write logs to CloudWatch, fetch secrets/params referenced in the task definition |
| **Task role** | **your application code** | call AWS APIs at runtime (S3, DynamoDB, Bedrock, SQS) |

Mixing them up is a classic bug: putting `s3:GetObject` on the execution role → app gets AccessDenied. The SDK in the container gets task-role credentials from the container credentials endpoint (`AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`).

---

### Q15. Environment variables and secrets injection

- `environment` — plain config (non-secret).
- `secrets` — reference **Secrets Manager** (whole secret or a JSON key) or **SSM Parameter Store**; injected as env vars at task start (execution role needs `secretsmanager:GetSecretValue` + `kms:Decrypt`).
- `environmentFiles` — env file in S3.

**Pitfall:** secrets injected at start **don't update** when rotated — tasks need a new deployment (or the app fetches the secret at runtime with caching).

---

### Q16. Task-level security hardening

Non-root `user`, `readonlyRootFilesystem: true` (+ tmpfs/ephemeral volume for scratch), drop Linux capabilities, no privileged mode, least-privilege task role per service, ECR image scanning, GuardDuty ECS runtime monitoring, ECS Exec access restricted and logged.

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

---

### Q21. Who owns what: Terraform vs CI deployments

Two common patterns:
1. **Terraform owns everything**; CI passes the new image tag/digest as a variable and runs apply.
2. **Terraform owns infrastructure**, CI registers new task definitions and updates the service (`aws ecs update-service` / ECS deploy action); Terraform uses `lifecycle { ignore_changes = [task_definition, desired_count] }`.

Pick one owner per attribute; otherwise Terraform "reverts" deployments or autoscaling.

---

## 6. Scaling, placement & capacity

### Q22. Service Auto Scaling

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

---

### Q24. Task placement (EC2/Managed Instances)

Placement **strategies**: `spread` (by AZ/instance — HA), `binpack` (by memory/CPU — cost), `random`. **Constraints**: `distinctInstance`, `memberOf` (instance type/attribute expressions). Fargate spreads across AZs automatically.

---

### Q25. Why tasks fail to place or start

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

---

### Q27. Logging options

`awslogs` driver → CloudWatch Logs (simple); **FireLens** (Fluent Bit sidecar) → route/filter logs to CloudWatch, S3, OpenSearch, third parties. Log JSON to stdout; include request/trace IDs; set retention.

---

### Q28. Debugging inside a running task: ECS Exec

`aws ecs execute-command --cluster prod --task <id> --container app --interactive --command "/bin/sh"` — uses SSM; requires `enableExecuteCommand` on the service and task role SSM permissions. Restrict with IAM and log sessions (KMS + CloudWatch/S3).

---

### Q29. Scheduled and event-driven tasks

EventBridge Scheduler (cron/rate) or EventBridge rules → `RunTask`; Step Functions `ecs:runTask.sync` for orchestrated jobs (waits for completion, captures exit code); S3 event → SQS → worker service scaling on backlog.

---

## 8. Choosing compute

### Q30. ECS vs Lambda vs AWS Batch vs AgentCore Runtime vs EKS

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

---

### Q32. Image runs in Docker locally but not on ECS

Architecture mismatch (arm64 vs x86) → `exec format error`; app binds `localhost` not `0.0.0.0`; missing env vars/secrets that existed in local `.env`; read-only root FS blocks writes to `/tmp` (add volume); non-root user permissions; health check uses a tool not in the image; no network route to dependencies; task role permissions differ from your local credentials.

---

### Q33. Tasks keep restarting with "Task failed ELB health checks"

App slow to boot (raise grace period/`startPeriod`), wrong health check path/port/success codes (redirect 301 counts as failure unless allowed), SG doesn't allow ALB → task port, health endpoint depends on a failing downstream (make liveness shallow), container listening on different port than target group.

---

### Q34. Launch one isolated worker task per customer job

API validates and stores job → Step Functions or SQS consumer calls `RunTask` with overrides (job ID as env/command), dedicated task role scoped by tags/session policy to that customer's S3 prefix, private subnets, timeouts, results to S3, status in DynamoDB, concurrency limits (Step Functions Map `MaxConcurrency`) to protect quotas, cleanup and DLQ for failures.

---

### Q35. A deployment is stuck "in progress" for an hour

New tasks failing health checks or failing to start (look at service events and stopped tasks); `minimumHealthyPercent=100` with no spare capacity on EC2 (can't start new before stopping old); circuit breaker disabled; draining waiting on long deregistration delay. Enable circuit breaker + rollback; fix root cause.

---

### Q36. Costs are high for an ECS service

Right-size CPU/memory (Container Insights), Graviton/ARM64, Fargate Spot for workers, scale-to-zero for idle workers (min 0 with queue-based scaling), Compute Savings Plans, reduce NAT data processing via VPC endpoints, log retention and volume.

---

### Q37. Design a zero-downtime deploy for a streaming agent API

Blue/green with bake time, ALB idle timeout > max idle stream gap with heartbeats, deregistration delay long enough for in-flight streams (or clients reconnect with resume tokens), graceful SIGTERM that stops new streams and finishes current ones within `stopTimeout` (max 120 s on Fargate — so design clients to reconnect), alarm-based rollback.

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
