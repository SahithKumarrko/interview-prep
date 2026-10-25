# Amazon EC2: L2 → L3 Interview Preparation

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
```
 pending → running ⇄ stopping/stopped (EBS-backed: disk kept, no compute charge, public IP changes)
               │  ⇄ hibernate (RAM saved to EBS)
               └─► shutting-down → terminated (root EBS deleted by default; instance store always lost)
```

---

## 2. Fundamentals

### Q01. What is EC2 and when do you choose it?

**Short answer:** Resizable virtual machines with full OS control. Choose EC2 when you need: specific OS/kernel/drivers, GPUs or special hardware, long-running stateful software (legacy apps, databases you self-manage), licensing tied to hosts, or maximum cost control at steady high load. Otherwise prefer managed compute (Fargate, Lambda, AgentCore) to avoid OS management.

---

### Q02. What is an AMI?

**Short answer:** Amazon Machine Image — template with root volume snapshot, boot settings, architecture (x86_64/arm64) and permissions. Sources: AWS (Amazon Linux 2023, Ubuntu, Windows), Marketplace, or your **golden AMIs** built with **EC2 Image Builder**/Packer (pre-hardened, patched, agents installed). AMIs are regional — copy to other regions for DR.

---

### Q03. Instance families and naming

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

---

### Q06. IMDSv2 — why enforce it?

**Short answer:** IMDS (169.254.169.254) exposes metadata and **role credentials**. IMDSv1 is a simple GET → an **SSRF** bug in your app could fetch credentials (Capital One breach pattern). **IMDSv2** requires a session token obtained via a PUT with a hop limit — blocks most SSRF and open-proxy attacks.

```bash
TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
curl -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id
```
Enforce `HttpTokens=required` in launch templates (new default for many AMIs), set hop limit 1 (2 for containers on the host if needed), and enforce org-wide via SCP / account default.

---

### Q07. Launch templates and versioning

Launch template = versioned config (AMI, type, SGs, IAM profile, user data, IMDS options, EBS, tags). ASGs reference a template **version** (`$Latest`/`$Default`/explicit). Versioning gives rollback and controlled rollouts (instance refresh).

---

### Q08. Placement groups

| Type | Behaviour | Use |
|---|---|---|
| **Cluster** | instances close together in one AZ | low-latency HPC, distributed training |
| **Spread** | each instance on distinct hardware (max 7 per AZ) | small number of critical instances |
| **Partition** | groups on separate racks | Kafka, HDFS, Cassandra (rack awareness) |

---

## 3. Storage

### Q09. EBS vs instance store

| | **EBS** | **Instance store** |
|---|---|---|
| Type | network block storage | physically attached NVMe |
| Persistence | survives stop/start; snapshots to S3 | **lost on stop/terminate/hardware failure** |
| Scope | one AZ (attach to instances in that AZ) | that instance |
| Use | root disks, databases, durable data | caches, scratch, buffers, temp data |

---

### Q10. EBS volume types

| Type | Notes |
|---|---|
| **gp3** | default SSD; baseline 3,000 IOPS / 125 MB/s, provision more independently of size; cheaper than gp2 |
| **io2 Block Express** | very high IOPS, durability, multi-attach; critical databases |
| st1 / sc1 | throughput HDD / cold HDD for big sequential data |

Encrypt by default (account setting, KMS). Performance limited also by **instance EBS bandwidth**.

---

### Q11. Snapshots and AMI protection

EBS snapshots are incremental, stored in S3 (regional), copyable cross-region/account. Protect with: encryption (CMK), no public sharing (block public access for snapshots/AMIs), **Recycle Bin** retention rules for accidental deletes, AWS Backup plans with vault lock, lifecycle policies (Data Lifecycle Manager).

---

## 4. Networking & access

### Q12. Private IP, public IP, Elastic IP

- **Private IP** — fixed for the instance's life, used inside the VPC.
- **Public IP** — auto-assigned from AWS pool, **changes on stop/start**.
- **Elastic IP** — static public IPv4 you own and can remap (charged; AWS bills public IPv4 addresses hourly). Prefer load balancers/DNS over EIPs for apps.

---

### Q13. Security groups on EC2

Stateful virtual firewall on ENIs: allow rules only, reference other SGs (e.g., app SG allows 8080 from ALB SG). No SSH from `0.0.0.0/0`. Outbound restricted where possible.

---

### Q14. Key pairs vs better access options

Key pairs = SSH public key injected at launch (private key download once). Problems: key sharing, rotation, open port 22. Better: **SSM Session Manager** (no inbound ports, IAM-controlled, sessions logged to S3/CloudWatch), **EC2 Instance Connect** (short-lived keys pushed via API), EC2 Instance Connect Endpoint for private instances.

---

### Q15. Network performance constraints

Each instance type has network bandwidth limits ("up to" = burst with credits), packets-per-second limits, EBS bandwidth limits, and connection tracking limits (security groups track connections — very high connection counts can hit `conntrack` allowances). Enhanced networking (ENA) is standard on modern types. Check `NetworkIn/Out`, ENA allowance-exceeded metrics (`bw_out_allowance_exceeded`, `conntrack_allowance_exceeded`).

---

### Q16. EC2 status checks vs application readiness

- **System status check** — AWS hardware/network problem → stop/start moves to new host (or auto-recover).
- **Instance status check** — OS problem (kernel panic, network misconfig) → reboot/fix.
- **Attached EBS status check**.
- **ELB / ASG health checks** — is the **application** responding? An instance can pass EC2 checks while the app is dead → configure ASG `HealthCheckType=ELB` so it replaces instances failing the app health check.

---

## 5. Pricing models

### Q17. On-Demand vs Savings Plans vs Reserved vs Spot

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

---

## 6. Auto Scaling & high availability

### Q19. Auto Scaling groups

**Short answer:** An ASG keeps a fleet between min/max/desired across AZs, replaces unhealthy instances, registers with target groups, and scales by policies.

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

---

### Q21. Graceful termination and draining

Scale-in/instance refresh → ALB **deregistration delay** drains connections → **lifecycle hook** (`autoscaling:EC2_INSTANCE_TERMINATING`) gives time to finish jobs/flush logs → instance terminates. Use instance **scale-in protection** for instances doing critical work. Apps should handle SIGTERM on shutdown.

---

### Q22. Resilient multi-AZ EC2 service

ASG across ≥3 AZs behind ALB, stateless instances (sessions in ElastiCache/DynamoDB, files in S3/EFS), data in Multi-AZ RDS, golden AMI + immutable deployments (instance refresh / blue-green ASGs), health checks with auto replacement, alarms, regular AZ-failure tests.

---

### Q23. EC2-backed ECS cluster design

ECS-optimised AMI (or Bottlerocket), ASG **capacity provider** with managed scaling + managed termination protection, mixed instances (on-demand base + Spot), instance draining on scale-in, ENI trunking for awsvpc density, IMDSv2 with hop limit restrictions so tasks use **task roles** not the instance role, CloudWatch/Container Insights, or simply use **ECS Managed Instances** to let AWS handle this.

---

### Q24. Deploying new versions on EC2

Options: in-place (CodeDeploy agent, Ansible) — simple but mutable; **immutable**: bake new AMI → new launch template version → instance refresh or blue/green ASG behind the ALB → rollback by reverting template version. Immutable infra is safer and reproducible.

---

## 7. Security & operations

### Q25. Patching and hardening

Golden AMIs rebuilt regularly (Image Builder pipelines with CIS hardening), **SSM Patch Manager** with maintenance windows and patch baselines, **Inspector** vulnerability scanning, minimal packages, IMDSv2, no SSH (Session Manager), encrypted EBS, least-privilege instance role, CloudWatch agent for logs/metrics, GuardDuty, AWS Config compliance rules.

---

### Q26. Systems Manager (SSM) toolbox

Session Manager (shell access), Run Command (run scripts across fleets), Patch Manager, State Manager (enforce config), Parameter Store, Inventory, Automation runbooks (e.g., isolate instance). Requires SSM agent + instance role with `AmazonSSMManagedInstanceCore` + network path (endpoints or NAT).

---

### Q27. Monitoring EC2

Default metrics: CPU, network, disk I/O, status checks (5-min; 1-min with detailed monitoring). **Memory and disk space need the CloudWatch agent.** Alarms: status check failed (auto-recover action), CPU credit balance (t-family), disk usage, app metrics.

---

### Q28. Incident response for a compromised instance

1. **Contain:** don't terminate (evidence). Replace SGs with an isolation SG (no inbound/outbound), detach from ASG/target group (set standby / protect from scale-in), revoke role sessions (deny policy with `aws:TokenIssueTime` condition).
2. **Preserve:** EBS snapshots, memory capture if possible, collect logs (CloudTrail, VPC Flow Logs, GuardDuty findings).
3. **Investigate:** what was accessed with the role credentials (CloudTrail), lateral movement.
4. **Eradicate & recover:** rebuild from a clean golden AMI, rotate any secrets the instance could read, patch root cause.
5. **Lessons learned:** automate with SSM Automation / GuardDuty → EventBridge → Lambda.

---

### Q29. EC2 vs Fargate vs Lambda — decision

| Choose EC2 when | Choose Fargate/ECS when | Choose Lambda when |
|---|---|---|
| need OS/kernel control, GPUs, special hardware, licensing, very steady high load with Savings Plans, legacy software | containerised services without managing servers | short event-driven tasks, spiky traffic, glue |

---

## 8. Scenario & debugging questions

### Q30. Instance is running but unreachable (SSH or app)

Path check: correct IP (public IP changed after stop/start?) → route table (public subnet → IGW; private → via bastion/SSM) → **security group** inbound rule for your IP/port → NACL (stateless — ephemeral ports outbound) → OS firewall → service actually listening on `0.0.0.0:port` (`ss -lntp`) → status checks / system log / EC2 serial console for boot issues. Use **Reachability Analyzer** to test the network path.

---

### Q31. CPU stays low but endpoint latency spikes

Not CPU-bound — look at: t-instance **CPU credits** exhausted (throttled — CPU metric may look capped), EBS throughput/IOPS limits or burst balance (gp2), network bandwidth/PPS/conntrack allowances exceeded, memory pressure/swap, GC pauses, thread/connection pool exhaustion, downstream dependency latency (traces), DNS resolution issues.

---

### Q32. ASG keeps replacing instances in a loop

ELB health check failing because the app needs longer to start than the **health check grace period**, user data failing (check `/var/log/cloud-init-output.log`), wrong health check path, missing IAM permissions to fetch config/secrets at boot, AMI broken. Suspend `ReplaceUnhealthy` temporarily to debug.

---

### Q33. Migrate a legacy EC2 API to ECS

Containerise (Dockerfile, externalise config/secrets, logs to stdout, stateless — move local files to S3/EFS, sessions to Redis), build in CI, deploy ECS service behind the same ALB (new target group), shift traffic with weighted listener rules (10% → 100%), monitor, keep EC2 ASG for rollback, then decommission.

---

### Q34. Spot instances interrupted mid-job

Handle 2-minute notice (stop taking work, checkpoint), make jobs resumable/idempotent, queue-based work distribution so another worker picks up, diversify instance types, keep on-demand base.

---

### Q35. Reduce EC2 costs

Right-size (Compute Optimizer), Graviton, Savings Plans for baseline, Spot for flexible workloads, auto scaling + schedules (turn off dev at night), gp3 instead of gp2, delete unattached EBS/old snapshots/unused EIPs, VPC endpoints to cut NAT data charges.

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
