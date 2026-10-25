# AWS Foundations, IAM & Networking: L2 → L3 Interview Preparation

> **Updated:** 24 October 2026 · **Level:** global infrastructure → VPC & IAM → integration services → resilient secure design
> **How to use:** *Short answer* = what you say first. *Explanation / Example* = intuition and diagrams. *Pitfall / Follow-up* = where interviewers dig.

---

## Table of contents

1. [Mental model: the layers of an AWS application](#1-mental-model-the-layers-of-an-aws-application)
2. [Global infrastructure & shared responsibility](#2-global-infrastructure--shared-responsibility) (Q01–Q03)
3. [Networking: VPC](#3-networking-vpc) (Q04–Q13)
4. [IAM & security](#4-iam--security) (Q14–Q23)
5. [Load balancing, DNS, edge](#5-load-balancing-dns-edge) (Q24–Q28)
6. [Storage & databases (essentials)](#6-storage--databases-essentials) (Q29–Q31)
7. [Integration: SQS, SNS, EventBridge](#7-integration-sqs-sns-eventbridge) (Q32–Q35)
8. [Observability](#8-observability) (Q36–Q37)
9. [Resilience, DR & Well-Architected](#9-resilience-dr--well-architected) (Q38–Q41)
10. [Scenario & debugging questions](#10-scenario--debugging-questions) (Q42–Q46)
11. [Cheat sheet](#11-cheat-sheet)

---

## 1. Mental model: the layers of an AWS application

```
                                 Internet users
                                       │
                         Route 53 (DNS) │ app.example.com
                                       ▼
                    CloudFront (CDN, TLS via ACM, WAF) ── S3 (static SPA)
                                       │ /api/*
 ┌──────────────────────────────── Region ap-south-1 ─── VPC 10.0.0.0/16 ─────────────────────────────────┐
 │                                                                                                         │
 │   AZ-a                                   AZ-b                                   AZ-c                    │
 │  ┌──────────────────────┐              ┌──────────────────────┐              ┌──────────────────────┐   │
 │  │ PUBLIC subnet        │              │ PUBLIC subnet        │              │ PUBLIC subnet        │   │
 │  │  ALB node, NAT GW    │              │  ALB node, NAT GW    │              │  ALB node, NAT GW    │   │
 │  ├──────────────────────┤              ├──────────────────────┤              ├──────────────────────┤   │
 │  │ PRIVATE app subnet   │              │ PRIVATE app subnet   │              │ PRIVATE app subnet   │   │
 │  │  ECS tasks / EC2     │              │  ECS tasks / EC2     │              │  ECS tasks / EC2     │   │
 │  ├──────────────────────┤              ├──────────────────────┤              ├──────────────────────┤   │
 │  │ PRIVATE data subnet  │              │ PRIVATE data subnet  │              │ PRIVATE data subnet  │   │
 │  │  RDS primary         │◄─ sync repl ─►  RDS standby         │              │  ElastiCache         │   │
 │  └──────────────────────┘              └──────────────────────┘              └──────────────────────┘   │
 │                                                                                                         │
 │   Internet Gateway (public subnets)     VPC endpoints: S3 (gateway), ECR, Secrets Manager, Bedrock...    │
 └─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
   Cross-cutting: IAM (who can do what) · KMS (encryption keys) · CloudWatch/CloudTrail/X-Ray (observe/audit)
```

---

## 2. Global infrastructure & shared responsibility

### Q01. Regions, Availability Zones, edge locations

**Short answer:**
- **Region** — a geographic area (e.g., `ap-south-1` Mumbai) with independent services, data stays there unless you move it. Choose by latency, data residency/compliance, service availability, cost.
- **Availability Zone** — one or more physically separate data centres in a region with independent power/network, low-latency links. **Deploy across ≥2 AZs for high availability.**
- **Edge locations** — CloudFront/Route 53/WAF points of presence close to users. (Also Local Zones, Wavelength, Outposts for special cases.)

---

### Q02. Shared responsibility model

**Short answer:** AWS secures **"of" the cloud** (hardware, facilities, hypervisor, managed service internals). You secure **"in" the cloud** (IAM, data, encryption choices, network config, OS patching on EC2, application code). The split shifts with service type: on EC2 you patch the OS; on Lambda/Fargate AWS does; on AgentCore/Bedrock you still own prompts, tool permissions and data handling.

---

### Q03. Account structure

Use **AWS Organizations** with multiple accounts (dev/staging/prod, security, logging) for blast-radius isolation, separate billing, and **SCP** guardrails. Humans log in via **IAM Identity Center** (SSO) with permission sets, not IAM users.

---

## 3. Networking: VPC

### Q04. VPC, subnets, route tables

**Short answer:**
- **VPC** — your private network in a region with a CIDR block (e.g., `10.0.0.0/16` = 65,536 addresses).
- **Subnet** — a slice of the VPC CIDR **in one AZ** (`10.0.1.0/24`). AWS reserves 5 IPs per subnet.
- **Route table** — rules deciding where traffic goes; each subnet is associated with one.
- A subnet is **public** if its route table sends `0.0.0.0/0` to an **Internet Gateway**; **private** otherwise.

```
 Public subnet route table          Private subnet route table
 10.0.0.0/16 → local                10.0.0.0/16 → local
 0.0.0.0/0   → igw-123              0.0.0.0/0   → nat-abc  (outbound only)
                                    pl-s3       → vpce-s3  (S3 gateway endpoint)
```

---

### Q05. Internet Gateway vs NAT Gateway

**Short answer:** **IGW** allows two-way internet access for resources with public IPs in public subnets. **NAT Gateway** (placed in a public subnet) lets **private** resources make **outbound** connections (download packages, call external APIs) without being reachable from the internet.

**Cost/design notes:** NAT GW charges per hour **and per GB processed** — high-volume traffic to S3/ECR through NAT gets expensive → use **VPC endpoints**. Use one NAT per AZ for resilience (a single NAT is an AZ single point of failure and adds cross-AZ data charges).

---

### Q06. Security groups vs Network ACLs

| | Security Group | Network ACL |
|---|---|---|
| Attached to | ENI (instance, task, Lambda in VPC, RDS…) | subnet |
| Stateful? | **Stateful** — return traffic automatically allowed | **Stateless** — must allow return (ephemeral ports) |
| Rules | allow only | allow **and deny**, numbered order |
| Typical use | primary firewall, reference other SGs | coarse subnet guardrails, block IP ranges |

**Best practice — SG referencing:**
```
 alb-sg:  inbound 443 from 0.0.0.0/0
 app-sg:  inbound 8000 from alb-sg        ← only the ALB can reach tasks
 db-sg:   inbound 5432 from app-sg        ← only app tasks reach the DB
```

---

### Q07. Public vs private connectivity — and how private resources reach AWS services

Private subnets have no inbound internet. To call AWS APIs (S3, ECR, Secrets Manager, Bedrock) from them: via **NAT** (traffic goes out to public endpoints) or via **VPC endpoints** (traffic stays on the AWS network, no NAT needed, can be restricted with endpoint policies).

---

### Q08. VPC endpoints and PrivateLink

| Type | Services | How |
|---|---|---|
| **Gateway endpoint** | **S3, DynamoDB** only | route table entry; **free** |
| **Interface endpoint (PrivateLink)** | most services (ECR, Secrets Manager, STS, Bedrock, CloudWatch Logs, SQS…) | ENI with private IP in your subnet; hourly + per-GB cost; private DNS |
| **PrivateLink endpoint service** | your own service behind an NLB | expose privately to other VPCs/accounts |

**Endpoint policies** restrict what can be done through the endpoint (e.g., only your org's buckets) — a data-exfiltration control.

**ECS in private subnet without NAT needs:** `ecr.api`, `ecr.dkr`, **S3 gateway** (image layers), `logs`, plus `secretsmanager`/`ssm` if used.

---

### Q09. Connecting VPCs and on-premises

| Option | Use |
|---|---|
| **VPC peering** | 1:1 between two VPCs; non-transitive; no overlapping CIDRs |
| **Transit Gateway** | hub-and-spoke for many VPCs + VPN/Direct Connect; transitive routing |
| **Site-to-Site VPN** | encrypted tunnel over internet to on-prem |
| **Direct Connect** | dedicated private line; consistent latency |
| **PrivateLink** | expose a specific service, not whole networks; overlapping CIDRs OK |
| **VPC Lattice** | service-to-service connectivity + auth across VPCs/accounts |

---

### Q10. CIDR planning

Plan non-overlapping ranges across VPCs/accounts/on-prem (peering/TGW need it). Leave room: e.g., `/16` per VPC, `/20`–`/22` per subnet (ECS awsvpc and Lambda ENIs consume IPs). Use IPAM for organisation-wide allocation.

---

### Q11. ENIs and why IP exhaustion happens

Every ECS task (awsvpc), Lambda-in-VPC hyperplane ENI, RDS, ALB node, interface endpoint uses IPs. Small subnets run out → tasks fail to start ("insufficient free addresses"). Size subnets generously.

---

### Q12. VPC Flow Logs

Capture IP traffic metadata (src/dst, port, ACCEPT/REJECT) per VPC/subnet/ENI → S3/CloudWatch. Use to debug "connection timed out" (REJECT = SG/NACL) and for security analysis.

---

### Q13. DNS inside a VPC

Route 53 Resolver provides DNS at VPC+2; private hosted zones for internal names; interface endpoints' private DNS makes `secretsmanager.ap-south-1.amazonaws.com` resolve to private IPs. Resolver endpoints for hybrid DNS with on-prem.

---

## 4. IAM & security

### Q14. Authentication vs authorisation in IAM

**Short answer:** **Authentication** — proving who you are (SSO login, access keys, role session, SigV4-signed request). **Authorisation** — deciding whether that principal may do this **action** on this **resource** under these **conditions** (policy evaluation).

**IAM identities:** users (avoid for humans/apps), groups, **roles** (assumed temporarily — preferred), federated identities (Identity Center, OIDC like GitLab, SAML).

---

### Q15. Anatomy of a policy

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "ReadTenantDocs",
    "Effect": "Allow",
    "Action": ["s3:GetObject"],
    "Resource": "arn:aws:s3:::acme-docs/tenants/t-42/*",
    "Condition": {
      "StringEquals": { "aws:PrincipalTag/team": "payments" },
      "Bool": { "aws:SecureTransport": "true" }
    }
  }]
}
```
**Principal** (who — only in resource/trust policies), **Action**, **Resource**, **Condition**, **Effect**.

---

### Q16. Policy types and how evaluation works

| Policy type | Attached to | Purpose |
|---|---|---|
| **Identity-based** | user/group/role | what this principal can do |
| **Resource-based** | resource (S3 bucket policy, KMS key policy, SQS, Lambda) | who can access this resource (incl. cross-account) |
| **Trust policy** | role | who may assume the role |
| **Permissions boundary** | user/role | **maximum** permissions the identity-based policy can grant |
| **SCP / RCP** (Organizations) | account/OU | **maximum** for all principals / resources in the account |
| **Session policy** | AssumeRole call | further restrict a session |

**Evaluation logic (simplified):**
```
 1. Explicit DENY anywhere?                      → DENY
 2. SCP / RCP / boundary / session policy allow it? (all applicable must allow) → else DENY
 3. Identity policy OR resource policy allows it? → ALLOW   (same account)
    Cross-account: BOTH the caller's identity policy AND the resource policy must allow
 4. Otherwise                                     → implicit DENY (default)
```
KMS is special: the **key policy** must allow use (identity policies alone aren't enough unless the key policy delegates to IAM).

---

### Q17. STS AssumeRole and temporary credentials

**Short answer:** A principal calls `sts:AssumeRole` (or `AssumeRoleWithWebIdentity` for OIDC, `AssumeRoleWithSAML`) and receives **temporary credentials** (access key + secret + session token, expiring in 15 min–12 h). Prefer them over long-lived access keys: auto-expiry, no secret rotation, clear audit trail (CloudTrail shows role session name).

```
 ECS task ──(task role via container credentials endpoint)──► temp creds ──► S3
 GitLab job ──(OIDC JWT)──► AssumeRoleWithWebIdentity ──► temp creds ──► deploy
 Account A role ──AssumeRole──► Account B role (trust policy allows A) ──► B resources
```

---

### Q18. Least privilege — how do you achieve it in practice?

Start from specific actions and resource ARNs; use conditions (tags, VPC endpoint, source account); separate roles per service/tool; **IAM Access Analyzer** to generate policies from CloudTrail activity and find unused permissions/external access; review regularly; permission boundaries for delegated role creation.

**Example — many agent tools on ECS:** give each tool its own task role (or Lambda role) scoped to its resources, rather than one "agent role" with `s3:*`, `dynamodb:*`.

---

### Q19. Cross-account access patterns

1. **Role assumption:** account B has a role trusting account A's role; A assumes it (most common).
2. **Resource policy:** S3/KMS/SQS policy grants account A's principal (both sides must allow).
3. Use `aws:PrincipalOrgID` conditions to allow only your organisation; `sts:ExternalId` for third parties (confused-deputy protection).

---

### Q20. ABAC (attribute-based access control)

Grant access based on **tags**: `"Condition": {"StringEquals": {"aws:ResourceTag/project": "${aws:PrincipalTag/project}"}}` → one policy scales to many teams/projects without editing per resource.

---

### Q21. KMS and envelope encryption

**Short answer:** KMS manages keys (KMS keys never leave the HSMs unencrypted). **Envelope encryption:** KMS generates a **data key**; you encrypt data locally with the data key, and store the data key **encrypted by the KMS key** next to the data. To decrypt, call KMS to decrypt the data key.

```
 GenerateDataKey(KMS key) → { plaintext data key, encrypted data key }
 encrypt file with plaintext key (AES-256) → discard plaintext key
 store: [ciphertext file] + [encrypted data key]
 decrypt: KMS.Decrypt(encrypted data key) → plaintext key → decrypt file
```
Why: large data never goes to KMS, fewer KMS calls, access controlled by key policy + CloudTrail-audited. S3/EBS/RDS/Secrets Manager do this for you with SSE-KMS. AWS-managed vs **customer-managed keys** (control key policy, rotation, cross-account).

---

### Q22. Other security services to name

| Service | Purpose |
|---|---|
| **CloudTrail** | API audit log (who did what) |
| **GuardDuty** | threat detection (malicious IPs, crypto mining, credential misuse) |
| **Security Hub** | aggregated findings + compliance standards |
| **AWS Config** | resource configuration history + rules |
| **Inspector** | vulnerability scanning (EC2, ECR images, Lambda) |
| **Macie** | find sensitive data in S3 |
| **WAF / Shield** | web exploits, DDoS |
| **Secrets Manager / SSM Parameter Store** | secrets & config |
| **IAM Access Analyzer** | external access, unused permissions, policy generation |

---

### Q23. Defence in depth for an internal bank application

```
 Identity:  SSO + MFA, short-lived roles, least privilege, SCP guardrails
 Network:   private subnets, SG referencing, no public DB, VPC endpoints with policies, WAF on ALB/CloudFront
 Data:      KMS encryption at rest, TLS in transit, Macie, backups, object lock where needed
 App:       input validation, authZ per resource, secrets from Secrets Manager, dependency scanning
 Detect:    CloudTrail org trail, GuardDuty, Security Hub, Config rules, alarms
 Respond:   runbooks, automated containment (isolate SG), forensics snapshots
```

---

## 5. Load balancing, DNS, edge

### Q24. ALB vs NLB vs Gateway LB

| | **ALB** (Layer 7) | **NLB** (Layer 4) | GWLB |
|---|---|---|---|
| Protocols | HTTP/1.1, HTTP/2, gRPC, WebSocket | TCP, UDP, TLS | IP (GENEVE) |
| Routing | path/host/header/query rules | port-based | to appliances |
| Features | TLS termination, auth (OIDC/Cognito), WAF, sticky sessions | static IPs/Elastic IPs, extreme throughput, preserve source IP, PrivateLink | firewalls/IDS inline |
| Use | web APIs, microservices, ECS | non-HTTP, ultra-low latency, PrivateLink service | security appliances |

**ALB concepts:** listener (port/protocol) → rules → **target group** (instances/IPs/Lambda) with health checks; idle timeout (default 60 s — matters for SSE/long requests).

---

### Q25. API Gateway vs ALB

| | API Gateway (REST/HTTP API) | ALB |
|---|---|---|
| Pricing | per request | per hour + LCU |
| Features | auth (JWT/Cognito/IAM/Lambda authorizers), throttling, usage plans/API keys, request validation, caching (REST), direct service integrations | routing to long-running services, WebSockets, gRPC |
| Limits | **29 s integration timeout** default (can be raised for REST regional/private APIs; HTTP APIs max 30 s), 10 MB payload | long timeouts, large payloads |
| Best for | serverless (Lambda) APIs, public APIs needing throttling/keys | containers/EC2, streaming, high steady traffic |

Agent streaming (SSE for minutes) usually fits ALB → ECS, or API Gateway REST response streaming where supported.

---

### Q26. Route 53, TLS and certificates

Route 53: domains + DNS (public/private hosted zones), **alias records** to ALB/CloudFront (free, zone apex), routing policies (simple, weighted, latency, failover, geolocation) + health checks. **ACM** issues free public TLS certs with auto-renewal (DNS validation); certificates for CloudFront must be in `us-east-1`.

```
 app.example.com ─(Route 53 alias)─► CloudFront (ACM cert us-east-1) ─► ALB (ACM cert in region) ─► ECS
```

---

### Q27. CloudFront essentials

CDN with edge caching, TLS, HTTP/2/3, WAF, origin access control for private S3, multiple origins with path behaviours (`/api/*` → ALB, default → S3), cache policies, response headers policies (CSP, HSTS), signed URLs/cookies for private content.

---

### Q28. WAF

Rules on CloudFront/ALB/API Gateway: AWS managed rule groups (OWASP common, known bad inputs, bot control), rate-based rules (per IP), geo-blocking, custom rules. Use count mode first, then block.

---

## 6. Storage & databases (essentials)

### Q29. S3 essentials

Object storage, 11 nines durability; **Block Public Access** on; bucket policies + IAM; SSE-S3/SSE-KMS (default encryption on); versioning, lifecycle rules (→ IA/Glacier), Object Lock (WORM); presigned URLs for direct browser upload/download; event notifications → Lambda/SQS/EventBridge; strong read-after-write consistency.

---

### Q30. Database choices (one-liners)

| Need | Service |
|---|---|
| Relational, transactions | RDS / **Aurora** (PostgreSQL/MySQL); Multi-AZ, read replicas |
| Key-value at any scale, single-digit ms | **DynamoDB** (partition key design, on-demand/provisioned, conditional writes, TTL, Streams) |
| Cache / sessions / rate limits | ElastiCache / MemoryDB (Valkey/Redis) |
| Search + vectors | OpenSearch |
| Vectors cheaply at scale | S3 Vectors, Aurora pgvector |
| Analytics | Redshift, Athena on S3 |

Deep dive (SQL, indexes, isolation, DynamoDB key design, caching): **21_Databases_SQL_DynamoDB.md**.

---

### Q31. EBS vs EFS vs S3

EBS = block disk for one EC2 (AZ-scoped, snapshots). EFS = shared NFS file system across AZs/instances/tasks. S3 = object storage via API, unlimited, cheapest durable store.

---

## 7. Integration: SQS, SNS, EventBridge

### Q32. SQS vs SNS vs EventBridge (vs Kinesis)

| | **SQS** | **SNS** | **EventBridge** | Kinesis Data Streams |
|---|---|---|---|---|
| Pattern | queue (pull), point-to-point | pub/sub fan-out (push) | event bus with **content-based routing rules** | ordered stream, replay |
| Consumers | one consumer group processes each message | many subscribers | many targets per rule (20+ AWS targets), SaaS sources, schedules | multiple apps read same shard data |
| Buffering/retry | yes (visibility timeout, DLQ) | retries to endpoints, DLQ | retries, DLQ, **archive & replay** | retention up to 365 days |
| Ordering | FIFO queues | FIFO topics | no guarantee | per shard |

**Common combos:** SNS → multiple SQS queues (fan-out with buffering); EventBridge rule → SQS → worker; S3 event → SQS → ECS worker.

---

### Q33. SQS deep dive (frequently asked)

- **Visibility timeout:** after a consumer receives a message, it's hidden for N seconds; if not deleted in time, it reappears (retry). Set > processing time; extend for long jobs.
- **At-least-once delivery** (standard queues) → consumers must be **idempotent**. FIFO: exactly-once processing within dedup window + ordering per message group.
- **DLQ** with `maxReceiveCount` for poison messages; redrive back after fixing.
- **Long polling** (`WaitTimeSeconds=20`) reduces empty receives/cost.
- Message size up to 1 MiB (store big payloads in S3, pass a pointer).

---

### Q34. Idempotency in AWS integrations

**Short answer:** Because of retries and at-least-once delivery, the same request/event can arrive more than once. Make handlers safe to repeat: idempotency key (request ID, event ID) stored with a **conditional write** (DynamoDB `attribute_not_exists`), unique constraints, upserts, or AWS APIs' own client tokens (`ClientRequestToken`, `ClientToken`). Powertools for Lambda has an idempotency utility.

---

### Q35. Choreography with events vs orchestration

EventBridge/SNS for loosely coupled reactions (choreography); **Step Functions** when you need a visible, controlled multi-step process with retries, timeouts and compensation (orchestration).

---

## 8. Observability

### Q36. CloudWatch vs CloudTrail vs X-Ray / OpenTelemetry

| Service | Answers |
|---|---|
| **CloudWatch Metrics & Alarms** | *how is it performing?* (latency, errors, CPU) → alarms → SNS/auto actions |
| **CloudWatch Logs** (+ Logs Insights queries) | *what did the app say?* |
| **CloudTrail** | *who called which AWS API, when, from where?* (audit, security) |
| **X-Ray / CloudWatch Application Signals / ADOT (OpenTelemetry)** | *where did the time go across services?* (distributed traces) |

```
fields @timestamp, level, request_id, msg
| filter level = "ERROR" and service = "api"
| stats count() by bin(5m)
```

---

### Q37. What to alarm on

User-facing symptoms first (error rate, p99 latency, availability via synthetics), then saturation (CPU/memory, queue age, DB connections), and cost anomalies. Use composite alarms and SLO-based alerting to reduce noise.

---

## 9. Resilience, DR & Well-Architected

### Q38. High availability across AZs

Run ≥2 (ideally 3) AZs for every tier: ALB across AZs, ECS service spread across AZs, RDS Multi-AZ, NAT per AZ, stateless app instances, health checks + auto-replacement, avoid AZ-pinned single points (one NAT, one EC2). Test by simulating AZ failure (AWS Fault Injection Service).

---

### Q39. Disaster recovery strategies

| Strategy | RTO / RPO | Cost |
|---|---|---|
| **Backup & restore** | hours / hours | lowest |
| **Pilot light** (core data replicated, infra off) | tens of minutes | low |
| **Warm standby** (scaled-down copy running) | minutes | medium |
| **Multi-site active/active** | near zero | highest |

**RTO** = how long to recover; **RPO** = how much data loss is acceptable. Tools: AWS Backup (cross-region copies), Aurora Global Database, DynamoDB global tables, S3 replication, Route 53 failover, IaC to rebuild. **Test DR regularly.**

---

### Q40. Well-Architected Framework — 6 pillars

**Operational excellence** (automate, observe, iterate) · **Security** (identity, least privilege, encryption, traceability) · **Reliability** (multi-AZ, recovery, quotas) · **Performance efficiency** (right services, measure) · **Cost optimisation** (right-size, pay for value, Graviton, Savings Plans) · **Sustainability** (efficient resource use). Lenses exist for serverless, generative AI, etc.

---

### Q41. Service quotas and throttling

Most AWS APIs have rate limits and account quotas (Lambda concurrency, Bedrock tokens/min, ENIs). Design with backoff + jitter, request quota increases early, monitor `ThrottlingException`s, and spread load (queues).

---

## 10. Scenario & debugging questions

### Q42. ECS task can't access S3 despite an IAM "Allow"

Check in order:
1. **Which role?** The app uses the **task role**, not the execution role (execution role is for pulling images/logs). Is `taskRoleArn` set? Is the SDK actually using container credentials?
2. **Explicit deny** anywhere: SCP, permissions boundary, bucket policy (e.g., requires `aws:SourceVpce` or TLS), session policy.
3. **Resource ARN** correct (`arn:aws:s3:::bucket/*` for objects vs `arn:aws:s3:::bucket` for ListBucket).
4. **KMS:** object encrypted with a CMK — key policy must allow `kms:Decrypt` for the role.
5. **Network:** private subnet without NAT/S3 gateway endpoint → timeout (not AccessDenied); endpoint policy may deny.
6. Cross-account bucket → bucket policy must also allow.
Tools: CloudTrail error event, IAM Policy Simulator, Access Analyzer.

---

### Q43. An internal API sometimes times out under load

Measure where: ALB metrics (`TargetResponseTime`, 5xx, surge queue), ECS CPU/memory, app latency per dependency (traces), DB connections/CPU, NAT GW `ErrorPortAllocation`, DynamoDB/Bedrock throttling, Lambda concurrency. Typical fixes: connection pooling, autoscaling on right metric, timeouts + retries with backoff, caching, async processing via SQS, quota increases.

---

### Q44. "Connection timed out" vs "AccessDenied" — what does each tell you?

**Timeout** = network path problem (SG, NACL, route table, missing NAT/endpoint, DNS to wrong IP). **AccessDenied** = network fine, IAM/resource policy problem. **Connection refused** = reached host but nothing listening on that port.

---

### Q45. Design secure cross-account access for a central agent platform calling team accounts

Central account role → assumes per-team roles (`sts:AssumeRole`) with trust limited to the platform role ARN + `aws:PrincipalOrgID`; team roles grant only specific tools' actions; session tags carry end-user/tenant for ABAC; CloudTrail in both accounts; SCPs prevent privilege escalation.

---

### Q46. How do you present an AWS design trade-off in an interview?

Structure: requirements (latency, scale, compliance) → 2 options → compare on **security, reliability, cost, operability, performance** → choose with reasoning → risks + mitigations → how you'd validate (load test, cost estimate). Example: "API Gateway + Lambda vs ALB + ECS for an agent API: streaming for minutes and steady load favour ALB + ECS; spiky low traffic favours Lambda."

---

## 11. Cheat sheet

| Topic | Remember |
|---|---|
| Region/AZ | ≥2 AZs for HA; region by latency/compliance |
| Public subnet | route 0.0.0.0/0 → IGW |
| NAT GW | outbound only for private; per-GB cost; one per AZ |
| SG vs NACL | stateful/ENI/allow-only vs stateless/subnet/allow+deny |
| Endpoints | gateway (S3, DynamoDB, free) vs interface (PrivateLink) |
| IAM eval | explicit deny > guardrails (SCP/boundary) > allow > default deny |
| Cross-account | caller policy AND resource policy |
| Roles | temporary creds; task role ≠ execution role |
| KMS | envelope encryption; key policy controls use |
| ALB vs NLB | L7 routing vs L4 performance/static IP |
| API GW vs ALB | per-request, auth/throttle, ~29 s vs long-lived/streaming |
| SQS | at-least-once, visibility timeout, DLQ, idempotent consumers |
| SNS / EventBridge | fan-out / content routing + replay |
| Observability | metrics (how much), logs (what), traces (where), CloudTrail (who) |
| DR | backup-restore → pilot light → warm standby → active/active |

## Official references

- Global infrastructure: https://aws.amazon.com/about-aws/global-infrastructure/
- VPC: https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html
- IAM policy evaluation: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html
- KMS concepts: https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html
- ELB: https://docs.aws.amazon.com/elasticloadbalancing/
- SQS: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html
- Well-Architected: https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html
