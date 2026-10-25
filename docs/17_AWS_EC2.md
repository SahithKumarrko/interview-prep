# Amazon EC2: Interview Preparation

> **Updated:** 24 October 2026 · **Level:** instance basics → storage, networking, scaling → hardening & incident response
> **How to use:** *Short answer* = what you say first. *Explanation / Example* = intuition and config. *Pitfall / Follow-up* = where interviewers dig.

---

## Table of contents

1. [Mental model: what makes up an EC2 instance](#1-mental-model-what-makes-up-an-ec2-instance)
2. [Fundamentals](#2-fundamentals) (Q01–Q08)
3. [Storage](#3-storage) (Q09–Q11)
4. [Networking & access](#4-networking--access) (Q12–Q16)
5. [Pricing models](#5-pricing-models) (Q17–Q18)
6. [Auto Scaling & high availability](#6-auto-scaling--high-availability) (Q19–Q24)
7. [Security & operations](#7-security--operations) (Q25–Q29)
8. [Scenario & debugging questions](#8-scenario--debugging-questions) (Q30–Q35)
9. [Cheat sheet](#9-cheat-sheet)

---

## 1. Mental model: what makes up an EC2 instance

**EC2 = rent virtual servers.** You pick the image, size, network and storage; AWS runs it on the Nitro hypervisor. You're responsible for the OS and everything above it.

```
 ┌──────────────────────────── EC2 instance (i-0abc…) ────────────────────────────┐
 │  AMI (OS + software)  ── what boots                                            │
 │  Instance type m7g.large ── 2 vCPU Graviton, 8 GiB RAM, network up to 12.5 Gbps │
 │  Root EBS volume (gp3) + extra EBS volumes / instance store (ephemeral NVMe)    │
 │  ENI: private IP 10.0.11.20 (+ public IP / Elastic IP), Security Groups          │
 │  Instance profile → IAM role → temporary creds via IMDSv2 (169.254.169.254)      │
 │  User data (cloud-init script at first boot)                                     │
 │  Placement: Region → AZ → (placement group)                                     │
 └─────────────────────────────────────────────────────────────────────────────────┘
        ▲ managed via                 ▲ access via                ▲ observed via
   Launch Template + ASG       SSM Session Manager (no SSH)    CloudWatch agent, Inspector
```

**Instance lifecycle:**
```flow
pipeline: EC2 instance states
pending > Booting from the AMI; user data runs on first boot.
running > Billed for compute.
stopping → stopped > EBS-backed only: disk kept, no compute charge, public IP changes on restart. (Or hibernate: RAM saved to EBS.)
shutting-down > Terminate requested.
terminated > Root EBS deleted by default; instance store data is always lost.
```

---

## 2. Fundamentals

### Q01. What is EC2 and when do you choose it?

**Short answer:** Resizable virtual machines with full OS control. Choose EC2 when you need: specific OS/kernel/drivers, GPUs or special hardware, long-running stateful software (legacy apps, databases you self-manage), licensing tied to hosts, or maximum cost control at steady high load. Otherwise prefer managed compute (Fargate, Lambda, AgentCore) to avoid OS management.

```flow
pipeline: When EC2 is the right choice
Need OS-level control? > Custom kernels, agents, licensing.
Special hardware? > GPUs, high memory, local NVMe.
Long-running, steady load? > Cheaper with Savings Plans.
Otherwise > Prefer Fargate/Lambda to avoid patching servers.
```

---

### Q02. What is an AMI?

**Short answer:** Amazon Machine Image — template with root volume snapshot, boot settings, architecture (x86_64/arm64) and permissions. Sources: AWS (Amazon Linux 2023, Ubuntu, Windows), Marketplace, or your **golden AMIs** built with **EC2 Image Builder**/Packer (pre-hardened, patched, agents installed). AMIs are regional — copy to other regions for DR.

```flow
pipeline: Golden AMI pipeline
Base AMI > Amazon Linux / Ubuntu.
Install + harden > Patches, agents, CIS settings (EC2 Image Builder / Packer).
Test + scan > Inspector.
Publish AMI > Versioned; launch templates point to it.
Rebuild regularly > New patches → new AMI → instance refresh.
```

---

### Q03. Instance families and naming

```flow
trace: Decoding an instance type name
m7g.2xlarge > Read left to right.
**m** = family (general purpose; c compute, r memory, g/p GPU) > What it's optimised for.
**7** = generation;  **g** = Graviton (ARM); i Intel; a AMD > Newer generations are usually cheaper per performance.
**2xlarge** = size (8 vCPU, 32 GiB for m7g) > Each size step doubles resources.
```

```
 m7g.2xlarge
 │││   └── size (vCPU/RAM scale: large=2 vCPU … 2xlarge=8 vCPU)
 ││└── attribute: g = Graviton (ARM), i = Intel, a = AMD, d = local NVMe, n = network-optimised
 │└── generation (newer = better price/performance)
 └── family
```
| Family | For |
|---|---|
| **t** (burstable, CPU credits) | dev, low steady CPU — watch credit exhaustion (or unlimited mode) |
| **m** general purpose | web/app servers |
| **c** compute optimised | CPU-heavy (batch, encoding) |
| **r / x** memory optimised | caches, in-memory DBs |
| **i / d** storage optimised | high IOPS local NVMe |
| **g / p / inf / trn** accelerated | GPUs (inference/training), Inferentia, Trainium |

**Graviton** (ARM) typically gives ~20–40% better price/performance — need arm64 builds.

---

### Q04. User data and cloud-init

Script/cloud-config that runs **once at first boot** (by default) as root: install packages, pull config, join cluster, start services. Keep it small (use golden AMIs for heavy setup), idempotent, no secrets in plain text (user data is readable via IMDS/console) — fetch secrets from Secrets Manager using the instance role.

```flow
pipeline: First boot of an instance
Launch from AMI > With a launch template.
cloud-init runs user data > Install, configure, start services (first boot only by default).
Fetch config/secrets > Via the instance role, not hard-coded.
Register / health > Joins target group or ECS cluster when ready.
```

```bash
#!/bin/bash
set -euo pipefail
dnf install -y amazon-cloudwatch-agent
aws ssm get-parameter --name /app/prod/config --query Parameter.Value --output text > /etc/app/config.json
systemctl enable --now app
```

---

### Q05. Instance profile and IAM role

An **instance profile** attaches an IAM role to an instance; the SDK automatically gets temporary, auto-rotated credentials from the **Instance Metadata Service**. Never store access keys on instances.

```flow
sequence: How code on EC2 gets AWS credentials
actors: App (SDK), IMDS, STS, S3
App (SDK) -> IMDS: get role credentials (169.254.169.254)
IMDS --> App (SDK): temporary credentials from the instance profile's role
App (SDK) -> S3: signed request
> Rotated automatically before expiry; no access keys on disk.
```

---

### Q06. IMDSv2 — why enforce it?

**Short answer:** IMDS (169.254.169.254) exposes metadata and **role credentials**. IMDSv1 is a simple GET → an **SSRF** bug in your app could fetch credentials (Capital One breach pattern). **IMDSv2** requires a session token obtained via a PUT with a hop limit — blocks most SSRF and open-proxy attacks.

```flow
sequence: IMDSv2 session token
actors: App, IMDS, Attacker via SSRF
App -> IMDS: PUT /latest/api/token (TTL header)
IMDS --> App: session token
App -> IMDS: GET credentials with X-aws-ec2-metadata-token
IMDS --> App: credentials
Attacker via SSRF -> IMDS: simple GET (can't send PUT / custom header)
IMDS --> Attacker via SSRF: 401: no token
> Enforce IMDSv2 (HttpTokens=required) and hop limit 1 so containers/SSRF can't steal role credentials.
```

```bash
TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
curl -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id
```
Enforce `HttpTokens=required` in launch templates (new default for many AMIs), set hop limit 1 (2 for containers on the host if needed), and enforce org-wide via SCP / account default.

---

### Q07. Launch templates and versioning

Launch template = versioned config (AMI, type, SGs, IAM profile, user data, IMDS options, EBS, tags). ASGs reference a template **version** (`$Latest`/`$Default`/explicit). Versioning gives rollback and controlled rollouts (instance refresh).

```flow
pipeline: Launch template versions
v1, v2, v3 > Each change (AMI, type, user data) is a new version.
ASG uses $Latest or a pinned version > Pinning is safer.
Instance refresh > Rolls instances to the new version.
Roll back > Point back to the previous version.
```

---

### Q08. Placement groups

```flow
pipeline: Placement groups
Cluster > Packed in one AZ: lowest latency, highest throughput (HPC). Single-AZ risk.
Spread > Each instance on separate hardware: max 7 per AZ, for critical nodes.
Partition > Groups on separate racks: Kafka, Cassandra, HDFS.
```

| Type | Behaviour | Use |
|---|---|---|
| **Cluster** | instances close together in one AZ | low-latency HPC, distributed training |
| **Spread** | each instance on distinct hardware (max 7 per AZ) | small number of critical instances |
| **Partition** | groups on separate racks | Kafka, HDFS, Cassandra (rack awareness) |

---

## 3. Storage

### Q09. EBS vs instance store

```flow
pipeline: EBS vs instance store
EBS > Network disk; survives stop/start; snapshots; can detach.
Instance store > Physically attached NVMe: very fast, but lost on stop/terminate/hardware failure.
Use instance store for > Caches, scratch, replicated data.
Use EBS for > Anything you need to keep.
```

| | **EBS** | **Instance store** |
|---|---|---|
| Type | network block storage | physically attached NVMe |
| Persistence | survives stop/start; snapshots to S3 | **lost on stop/terminate/hardware failure** |
| Scope | one AZ (attach to instances in that AZ) | that instance |
| Use | root disks, databases, durable data | caches, scratch, buffers, temp data |

---

### Q10. EBS volume types

```flow
pipeline: Picking an EBS volume type
gp3 > Default SSD; set IOPS/throughput independently of size.
io2 / io2 Block Express > Very high, consistent IOPS for databases.
st1 > Throughput-optimised HDD for big sequential reads.
sc1 > Cold HDD; cheapest.
```

| Type | Notes |
|---|---|
| **gp3** | default SSD; baseline 3,000 IOPS / 125 MB/s, provision more independently of size; cheaper than gp2 |
| **io2 Block Express** | very high IOPS, durability, multi-attach; critical databases |
| st1 / sc1 | throughput HDD / cold HDD for big sequential data |

Encrypt by default (account setting, KMS). Performance limited also by **instance EBS bandwidth**.

---

### Q11. Snapshots and AMI protection

EBS snapshots are incremental, stored in S3 (regional), copyable cross-region/account. Protect with: encryption (CMK), no public sharing (block public access for snapshots/AMIs), **Recycle Bin** retention rules for accidental deletes, AWS Backup plans with vault lock, lifecycle policies (Data Lifecycle Manager).

```flow
pipeline: Snapshots and protection
Snapshot > Incremental, stored in S3 (managed).
Automate > Data Lifecycle Manager / AWS Backup schedules.
Copy cross-region/account > DR and ransomware protection.
Lock / recycle bin > Prevent deletion; recover accidental deletes.
```

---

## 4. Networking & access

### Q12. Private IP, public IP, Elastic IP

```flow
pipeline: Instance addressing
Private IP > Stays for the instance's life.
Public IP (auto-assigned) > Changes on stop/start.
Elastic IP > Static public IP you own; charged (public IPv4 is billed).
Better > Put instances behind a load balancer and use DNS.
```

- **Private IP** — fixed for the instance's life, used inside the VPC.
- **Public IP** — auto-assigned from AWS pool, **changes on stop/start**.
- **Elastic IP** — static public IPv4 you own and can remap (charged; AWS bills public IPv4 addresses hourly). Prefer load balancers/DNS over EIPs for apps.

---

### Q13. Security groups on EC2

Stateful virtual firewall on ENIs: allow rules only, reference other SGs (e.g., app SG allows 8080 from ALB SG). No SSH from `0.0.0.0/0`. Outbound restricted where possible.

```flow
sequence: Security group referencing another SG
actors: ALB (sg-alb), App instance (sg-app), DB (sg-db)
ALB (sg-alb) -> App instance (sg-app): 8080 allowed: sg-app inbound source = sg-alb
App instance (sg-app) -> DB (sg-db): 5432 allowed: sg-db inbound source = sg-app
> Rules follow roles, not IP addresses, so scaling and IP changes need no rule edits.
```

---

### Q14. Key pairs vs better access options

Key pairs = SSH public key injected at launch (private key download once). Problems: key sharing, rotation, open port 22. Better: **SSM Session Manager** (no inbound ports, IAM-controlled, sessions logged to S3/CloudWatch), **EC2 Instance Connect** (short-lived keys pushed via API), EC2 Instance Connect Endpoint for private instances.

```flow
sequence: Shell access without SSH keys
actors: Engineer, SSM Session Manager, Instance (SSM agent)
Engineer -> SSM Session Manager: start-session (IAM authorised)
SSM Session Manager -> Instance (SSM agent): open channel (agent connects outbound)
Instance (SSM agent) --> Engineer: shell
> No inbound port 22, no keys to leak, every session logged.
```

---

### Q15. Network performance constraints

Each instance type has network bandwidth limits ("up to" = burst with credits), packets-per-second limits, EBS bandwidth limits, and connection tracking limits (security groups track connections — very high connection counts can hit `conntrack` allowances). Enhanced networking (ENA) is standard on modern types. Check `NetworkIn/Out`, ENA allowance-exceeded metrics (`bw_out_allowance_exceeded`, `conntrack_allowance_exceeded`).

```flow
pipeline: Network performance limits
Instance size > Bandwidth scales with size ("up to" = burst).
Per-flow limit > A single connection is capped (~5 Gbps outside placement groups).
ENA / enhanced networking > Required for high throughput.
Packets per second > Small packets hit PPS limits first.
```

---

### Q16. EC2 status checks vs application readiness

```flow
pipeline: Healthy instance ≠ healthy app
System status check > AWS hardware/host problem.
Instance status check > OS problem (boot, network config).
App health check (ALB / ASG) > Is the service actually responding?
Act on each > Auto-recover for system; replace for app failures.
```

- **System status check** — AWS hardware/network problem → stop/start moves to new host (or auto-recover).
- **Instance status check** — OS problem (kernel panic, network misconfig) → reboot/fix.
- **Attached EBS status check**.
- **ELB / ASG health checks** — is the **application** responding? An instance can pass EC2 checks while the app is dead → configure ASG `HealthCheckType=ELB` so it replaces instances failing the app health check.

---

## 5. Pricing models

### Q17. On-Demand vs Savings Plans vs Reserved vs Spot

```flow
pipeline: Pricing models
On-Demand > Pay per second, no commitment.
Savings Plans > 1–3 year $/hour commitment, big discount, flexible.
Reserved Instances > Specific type/region commitment.
Spot > Up to ~90% off; can be reclaimed with 2 minutes' notice.
Mix > Baseline on Savings Plans, bursts on On-Demand, batch on Spot.
```

| Model | Discount | Commitment | Use |
|---|---|---|---|
| **On-Demand** | 0% | none | spiky, short-term, unknown |
| **Savings Plans** (Compute / EC2 Instance) | up to ~66–72% | $/hour for 1 or 3 yrs; Compute SP also covers Fargate & Lambda | steady baseline |
| **Reserved Instances** | similar | specific instance type/region (capacity reservation option) | legacy/specific needs |
| **Spot** | up to ~90% | none; **can be reclaimed with 2-minute notice** | fault-tolerant batch, CI runners, stateless workers |
| On-Demand Capacity Reservations | 0% | reserve capacity in an AZ | guaranteed capacity (e.g., events, GPUs) |

---

### Q18. Using Spot safely

Diversify instance types/AZs (ASG mixed instances policy, `price-capacity-optimized` allocation), handle interruption notices (EventBridge / IMDS `spot/instance-action`) to drain work, checkpoint jobs, keep an on-demand base capacity, capacity rebalancing.

```flow
sequence: Spot interruption handled gracefully
actors: AWS, Instance, ASG, Queue
AWS -> Instance: interruption notice (2 minutes)
Instance -> Instance: stop taking work, checkpoint progress
Instance -> Queue: return unfinished job (or release lock)
ASG -> ASG: capacity rebalancing launches a replacement
Queue -> ASG: new instance resumes the job
```

---

## 6. Auto Scaling & high availability

### Q19. Auto Scaling groups

**Short answer:** An ASG keeps a fleet between min/max/desired across AZs, replaces unhealthy instances, registers with target groups, and scales by policies.

```flow
cycle: Auto Scaling group keeping capacity
Desired count > e.g. 4 instances across 3 AZs.
Health checks > EC2 + ELB checks.
Replace unhealthy > Terminate and launch from the launch template.
Scale with policy > Up/down on metrics or schedule.
exit > Continuous: the ASG always works back to the desired count.
```

```
 ASG (min 2, desired 3, max 10, subnets in AZ-a/b/c, launch template v12)
   ├─ target tracking: CPU 50%  or ALB RequestCountPerTarget 1000
   ├─ health check type: ELB, grace period 300 s
   ├─ instance refresh: rolling replace to new template version (min healthy 90%)
   ├─ lifecycle hooks: on launch (bootstrap) / on terminate (drain, upload logs)
   └─ warm pool: pre-initialised stopped instances for faster scale-out
```

---

### Q20. Scaling policies

Target tracking (simplest), step scaling, scheduled, **predictive scaling** (ML forecast for daily cycles). Scale on the metric that reflects load (requests per target, queue depth per instance) rather than only CPU.

```flow
pipeline: Scaling policies
Target tracking > Keep CPU at 50% (simplest, recommended).
Step scaling > Bigger steps for bigger breaches.
Scheduled > Known daily peaks.
Predictive > Forecast and scale ahead of demand.
```

---

### Q21. Graceful termination and draining

Scale-in/instance refresh → ALB **deregistration delay** drains connections → **lifecycle hook** (`autoscaling:EC2_INSTANCE_TERMINATING`) gives time to finish jobs/flush logs → instance terminates. Use instance **scale-in protection** for instances doing critical work. Apps should handle SIGTERM on shutdown.

```flow
sequence: Scale-in with a lifecycle hook
actors: ASG, ALB, Instance, Hook handler
ASG -> ALB: deregister instance (connection draining)
ASG -> Instance: Terminating:Wait (lifecycle hook)
Hook handler -> Instance: finish jobs, flush logs, upload data
Hook handler -> ASG: CompleteLifecycleAction
ASG -> Instance: terminate
```

---

### Q22. Resilient multi-AZ EC2 service

ASG across ≥3 AZs behind ALB, stateless instances (sessions in ElastiCache/DynamoDB, files in S3/EFS), data in Multi-AZ RDS, golden AMI + immutable deployments (instance refresh / blue-green ASGs), health checks with auto replacement, alarms, regular AZ-failure tests.

```flow
pipeline: A resilient multi-AZ EC2 service
ALB across 3 AZs > Health-checked targets.
ASG across 3 AZs > Min capacity survives losing one AZ.
Stateless instances > State in RDS Multi-AZ, S3, ElastiCache.
Immutable deploys > New AMI + instance refresh.
```

---

### Q23. EC2-backed ECS cluster design

ECS-optimised AMI (or Bottlerocket), ASG **capacity provider** with managed scaling + managed termination protection, mixed instances (on-demand base + Spot), instance draining on scale-in, ENI trunking for awsvpc density, IMDSv2 with hop limit restrictions so tasks use **task roles** not the instance role, CloudWatch/Container Insights, or simply use **ECS Managed Instances** to let AWS handle this.

```flow
pipeline: EC2-backed ECS cluster
ASG of ECS-optimised AMIs > Instances join the cluster.
Capacity provider with managed scaling > Adds instances when tasks can't place.
Managed termination protection > Instances with tasks aren't killed.
Drain on scale-in > Tasks move before termination.
```

---

### Q24. Deploying new versions on EC2

Options: in-place (CodeDeploy agent, Ansible) — simple but mutable; **immutable**: bake new AMI → new launch template version → instance refresh or blue/green ASG behind the ALB → rollback by reverting template version. Immutable infra is safer and reproducible.

```flow
pipeline: Deploying a new version to EC2
Bake new AMI > Or new app artifact.
Update launch template version > Pinned.
Instance refresh / blue-green ASG > Replace instances gradually with health checks.
Roll back > Previous launch template version.
```

---

## 7. Security & operations

### Q25. Patching and hardening

Golden AMIs rebuilt regularly (Image Builder pipelines with CIS hardening), **SSM Patch Manager** with maintenance windows and patch baselines, **Inspector** vulnerability scanning, minimal packages, IMDSv2, no SSH (Session Manager), encrypted EBS, least-privilege instance role, CloudWatch agent for logs/metrics, GuardDuty, AWS Config compliance rules.

```flow
pipeline: Patching and hardening
Hardened golden AMI > CIS baseline.
SSM Patch Manager > Scheduled patching with baselines.
Inspector > Continuous vulnerability scanning.
Replace, don't patch in place > Immutable AMIs where possible.
```

---

### Q26. Systems Manager (SSM) toolbox

Session Manager (shell access), Run Command (run scripts across fleets), Patch Manager, State Manager (enforce config), Parameter Store, Inventory, Automation runbooks (e.g., isolate instance). Requires SSM agent + instance role with `AmazonSSMManagedInstanceCore` + network path (endpoints or NAT).

```flow
pipeline: The SSM toolbox
Session Manager > Shell without SSH.
Run Command > Same command across a fleet.
Patch Manager > OS patching.
Parameter Store > Config/secrets.
Inventory + State Manager > What's installed; enforce config.
```

---

### Q27. Monitoring EC2

Default metrics: CPU, network, disk I/O, status checks (5-min; 1-min with detailed monitoring). **Memory and disk space need the CloudWatch agent.** Alarms: status check failed (auto-recover action), CPU credit balance (t-family), disk usage, app metrics.

```flow
pipeline: Monitoring an instance
Built-in metrics > CPU, network, disk I/O, status checks.
CloudWatch agent > Memory and disk space (not built-in!).
Logs > App and system logs to CloudWatch.
Alarms > Status check failed, disk filling, CPU credits (burstable).
```

---

### Q28. Incident response for a compromised instance

```flow
pipeline: Incident response for a compromised instance
Contain > Don't terminate (that destroys evidence). Swap in an isolation security group, detach from the ASG/target group, revoke role sessions (deny with an `aws:TokenIssueTime` condition).
Preserve > EBS snapshots, memory capture if possible, logs: CloudTrail, VPC Flow Logs, GuardDuty findings.
Investigate > What did the role credentials access (CloudTrail)? Any lateral movement?
Eradicate & recover > Rebuild from a clean golden AMI, rotate every secret the instance could read, patch the root cause.
Lessons learned > Automate it: GuardDuty → EventBridge → Lambda / SSM Automation.
```

---

### Q29. EC2 vs Fargate vs Lambda — decision

```flow
pipeline: EC2 vs Fargate vs Lambda
Lambda > Short event-driven work, zero ops, spiky.
Fargate > Containers without servers, long-running services.
EC2 > OS control, GPUs, special hardware, cheapest at steady scale.
Decide by > Ops effort vs control vs cost profile.
```

| Choose EC2 when | Choose Fargate/ECS when | Choose Lambda when |
|---|---|---|
| need OS/kernel control, GPUs, special hardware, licensing, very steady high load with Savings Plans, legacy software | containerised services without managing servers | short event-driven tasks, spiky traffic, glue |

---

## 8. Scenario & debugging questions

### Q30. Instance is running but unreachable (SSH or app)

Path check: correct IP (public IP changed after stop/start?) → route table (public subnet → IGW; private → via bastion/SSM) → **security group** inbound rule for your IP/port → NACL (stateless — ephemeral ports outbound) → OS firewall → service actually listening on `0.0.0.0:port` (`ss -lntp`) → status checks / system log / EC2 serial console for boot issues. Use **Reachability Analyzer** to test the network path.

```flow
pipeline: Instance running but unreachable
Status checks > Instance-level failure?
Security group + NACL > Port allowed from your source?
Route + public IP > Public subnet with IGW route? Or reach it via SSM.
Service listening? > On 0.0.0.0 and the right port; OS firewall.
```

---

### Q31. CPU stays low but endpoint latency spikes

Not CPU-bound — look at: t-instance **CPU credits** exhausted (throttled — CPU metric may look capped), EBS throughput/IOPS limits or burst balance (gp2), network bandwidth/PPS/conntrack allowances exceeded, memory pressure/swap, GC pauses, thread/connection pool exhaustion, downstream dependency latency (traces), DNS resolution issues.

```flow
pipeline: CPU low, latency high
Waiting on I/O > Disk (EBS IOPS/throughput limits) or network.
Burst credits exhausted > t-family or gp2 throttled.
Dependency slow > DB, external APIs.
Threads/connections saturated > Pools full while CPU idles.
```

---

### Q32. ASG keeps replacing instances in a loop

ELB health check failing because the app needs longer to start than the **health check grace period**, user data failing (check `/var/log/cloud-init-output.log`), wrong health check path, missing IAM permissions to fetch config/secrets at boot, AMI broken. Suspend `ReplaceUnhealthy` temporarily to debug.

```flow
pipeline: ASG replaces instances in a loop
New instance fails health check > Why?
Grace period too short > App not ready before checks start.
Bad AMI / user data > Service never starts.
Health check path wrong > ALB marks every instance unhealthy.
```

---

### Q33. Migrate a legacy EC2 API to ECS

Containerise (Dockerfile, externalise config/secrets, logs to stdout, stateless — move local files to S3/EFS, sessions to Redis), build in CI, deploy ECS service behind the same ALB (new target group), shift traffic with weighted listener rules (10% → 100%), monitor, keep EC2 ASG for rollback, then decommission.

```flow
pipeline: Migrating a legacy EC2 API to ECS
Containerise > Dockerfile; config via env; logs to stdout.
Externalise state > Sessions, files → Redis/S3/DB.
Run on ECS in parallel > Same ALB, weighted target groups.
Shift traffic gradually > Compare metrics.
Decommission EC2 > After stable.
```

---

### Q34. Spot instances interrupted mid-job

Handle 2-minute notice (stop taking work, checkpoint), make jobs resumable/idempotent, queue-based work distribution so another worker picks up, diversify instance types, keep on-demand base.

```flow
pipeline: Spot interruptions mid-job
Checkpoint progress > Regularly, to S3/DB.
Handle the 2-minute notice > Stop and save.
Queue-based work > Unfinished jobs return to the queue.
Diversify > Many instance types/AZs; capacity-optimised allocation.
```

---

### Q35. Reduce EC2 costs

Right-size (Compute Optimizer), Graviton, Savings Plans for baseline, Spot for flexible workloads, auto scaling + schedules (turn off dev at night), gp3 instead of gp2, delete unattached EBS/old snapshots/unused EIPs, VPC endpoints to cut NAT data charges.

```flow
pipeline: Reducing EC2 cost
Right-size > Compute Optimizer recommendations.
Graviton > Better price/performance.
Savings Plans > For the steady baseline.
Spot > For interruptible work.
Turn off idle > Schedules for dev/test; delete unattached EBS and old snapshots.
```

---

## 9. Cheat sheet

| Concept | One-liner |
|---|---|
| AMI | boot template; golden AMIs via Image Builder |
| Instance type | family + generation + attributes + size; Graviton = `g` |
| t-family | burstable CPU credits |
| EBS vs instance store | durable network disk vs ephemeral local NVMe |
| gp3 | default; IOPS/throughput independent of size |
| Public vs Elastic IP | changes on stop vs static (paid) |
| Access | SSM Session Manager > SSH keys |
| IMDSv2 | token-based metadata; blocks SSRF credential theft |
| Instance profile | IAM role creds via IMDS |
| Pricing | On-Demand, Savings Plans, RIs, Spot (2-min notice) |
| ASG | min/max/desired, multi-AZ, ELB health checks, instance refresh, lifecycle hooks |
| Status checks | system (AWS) vs instance (OS) vs ELB (app) |
| Compromise | isolate SG, snapshot, revoke creds, rebuild |

## Official references

- https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/concepts.html
- Instance types: https://aws.amazon.com/ec2/instance-types/
- IMDSv2: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html
- Auto Scaling: https://docs.aws.amazon.com/autoscaling/ec2/userguide/what-is-amazon-ec2-auto-scaling.html
- EBS volume types: https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volume-types.html
- Incident response guide: https://docs.aws.amazon.com/security-ir/latest/userguide/
