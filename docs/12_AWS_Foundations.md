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

```flow
sequence: Follow one request into the VPC
actors: User, Route 53, CloudFront, ALB (public), ECS task (private), RDS (data)
User -> Route 53: resolve app.example.com
User -> CloudFront: HTTPS request
> TLS with an ACM cert and WAF rules at the edge. Static files come straight from S3.
CloudFront -> ALB (public): /api/* forwarded
> The ALB has nodes in public subnets in every AZ.
ALB (public) -> ECS task (private): to a healthy target
> Tasks have no public IP. Outbound internet goes via NAT; AWS services via VPC endpoints.
ECS task (private) -> RDS (data): SQL query
> The database is in private data subnets. A standby in another AZ is kept in sync for failover.
ECS task (private) --> User: response back through ALB and CloudFront
```

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

```flow
pipeline: Region → AZ → data centre → edge
Region > A geographic area (ap-south-1). Data stays here unless you move it.
Availability Zones > 3+ isolated groups of data centres per region, low-latency links between them.
Spread across AZs > Survive one AZ failing.
Edge locations > CloudFront/Route 53 points of presence close to users.
```

---

### Q02. Shared responsibility model

**Short answer:** AWS secures **"of" the cloud** (hardware, facilities, hypervisor, managed service internals). You secure **"in" the cloud** (IAM, data, encryption choices, network config, OS patching on EC2, application code). The split shifts with service type: on EC2 you patch the OS; on Lambda/Fargate AWS does; on AgentCore/Bedrock you still own prompts, tool permissions and data handling.

```flow
pipeline: Who secures what
AWS: security OF the cloud > Hardware, facilities, hypervisor, managed service internals.
Shared by service type > EC2: you patch the OS. Lambda/Fargate: AWS does.
You: security IN the cloud > IAM, data encryption, network rules, app code, configuration.
```

---

### Q03. Account structure

Use **AWS Organizations** with multiple accounts (dev/staging/prod, security, logging) for blast-radius isolation, separate billing, and **SCP** guardrails. Humans log in via **IAM Identity Center** (SSO) with permission sets, not IAM users.

```flow
pipeline: A multi-account structure
Management account > Billing and Organizations only.
Security / log archive accounts > Central CloudTrail, GuardDuty, audit.
Shared services > Networking, CI tooling.
Workload accounts per env > dev, staging, prod separated: small blast radius.
SCP guardrails on OUs > Org-wide rules no one can bypass.
```

---

## 3. Networking: VPC

### Q04. VPC, subnets, route tables

**Short answer:**
- **VPC** — your private network in a region with a CIDR block (e.g., `10.0.0.0/16` = 65,536 addresses).
- **Subnet** — a slice of the VPC CIDR **in one AZ** (`10.0.1.0/24`). AWS reserves 5 IPs per subnet.
- **Route table** — rules deciding where traffic goes; each subnet is associated with one.
- A subnet is **public** if its route table sends `0.0.0.0/0` to an **Internet Gateway**; **private** otherwise.

```flow
pipeline: How a packet leaves a private subnet
Instance in private subnet > Sends to 8.8.8.8.
Route table lookup > Most specific match: 10.0.0.0/16 → local; 0.0.0.0/0 → NAT gateway.
NAT gateway (public subnet) > Translates to its public IP.
Internet gateway > Out to the internet. Replies come back the same way; inbound connections can't start from outside.
```

```
 Public subnet route table          Private subnet route table
 10.0.0.0/16 → local                10.0.0.0/16 → local
 0.0.0.0/0   → igw-123              0.0.0.0/0   → nat-abc  (outbound only)
                                    pl-s3       → vpce-s3  (S3 gateway endpoint)
```

---

### Q05. Internet Gateway vs NAT Gateway

**Short answer:** **IGW** allows two-way internet access for resources with public IPs in public subnets. **NAT Gateway** (placed in a public subnet) lets **private** resources make **outbound** connections (download packages, call external APIs) without being reachable from the internet.

```flow
sequence: IGW vs NAT gateway
actors: Internet, IGW, Public subnet (ALB), NAT GW, Private task
Internet -> IGW: inbound request
IGW -> Public subnet (ALB): allowed: public subnet routes 0.0.0.0/0 to the IGW
Private task -> NAT GW: outbound: call an external API
NAT GW -> IGW: source NAT to the NAT's public IP
IGW -> Internet: out
> Nothing on the internet can start a connection to the private task. NAT is per-AZ and charged per GB.
```

**Cost/design notes:** NAT GW charges per hour **and per GB processed** — high-volume traffic to S3/ECR through NAT gets expensive → use **VPC endpoints**. Use one NAT per AZ for resilience (a single NAT is an AZ single point of failure and adds cross-AZ data charges).

---

### Q06. Security groups vs Network ACLs

```flow
sequence: Stateful security group vs stateless NACL
actors: Client, NACL, Security group, Instance
Client -> NACL: request to :443
NACL -> Security group: NACL inbound rule allows 443 (checked in order)
Security group -> Instance: SG inbound allows 443
Instance --> Security group: response: automatically allowed (stateful)
Security group --> NACL: response
NACL --> Client: needs an OUTBOUND rule for ephemeral ports 1024–65535 (stateless)
> SGs attach to ENIs and only allow; NACLs attach to subnets and can deny.
```

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

```flow
pipeline: Ways a private task reaches AWS services
Via NAT gateway > Works for everything; costs per GB; traffic leaves through the internet edge.
Gateway endpoint (S3, DynamoDB) > Route table entry; free.
Interface endpoint (ECR, Secrets Manager, Bedrock…) > Private IPs in your subnets via PrivateLink.
Endpoint policies > Restrict which buckets/actions can be reached.
```

---

### Q08. VPC endpoints and PrivateLink

```flow
sequence: An interface endpoint (PrivateLink) call
actors: Task, VPC DNS, Endpoint ENI, Secrets Manager
Task -> VPC DNS: resolve secretsmanager.ap-south-1.amazonaws.com
VPC DNS --> Task: private IP of the endpoint ENI (private DNS enabled)
Task -> Endpoint ENI: HTTPS
Endpoint ENI -> Secrets Manager: over the AWS network
> No NAT, no internet. Security groups on the endpoint and endpoint policies add control.
```

| Type | Services | How |
|---|---|---|
| **Gateway endpoint** | **S3, DynamoDB** only | route table entry; **free** |
| **Interface endpoint (PrivateLink)** | most services (ECR, Secrets Manager, STS, Bedrock, CloudWatch Logs, SQS…) | ENI with private IP in your subnet; hourly + per-GB cost; private DNS |
| **PrivateLink endpoint service** | your own service behind an NLB | expose privately to other VPCs/accounts |

**Endpoint policies** restrict what can be done through the endpoint (e.g., only your org's buckets) — a data-exfiltration control.

**ECS in private subnet without NAT needs:** `ecr.api`, `ecr.dkr`, **S3 gateway** (image layers), `logs`, plus `secretsmanager`/`ssm` if used.

---

### Q09. Connecting VPCs and on-premises

```flow
pipeline: Connecting networks
VPC peering > One-to-one; no transitive routing; simple for a few VPCs.
Transit Gateway > Hub for many VPCs and on-prem; central routing.
Site-to-Site VPN > Encrypted over the internet; quick to set up.
Direct Connect > Dedicated private link; consistent bandwidth.
```

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

```flow
trace: Planning CIDRs
org range 10.0.0.0/8 → per account/region blocks > Plan centrally (IPAM) so ranges never overlap.
VPC 10.20.0.0/16 = 65,536 addresses > Room to grow.
subnets /20 per AZ per tier (4,096 each) > Public small, private app large (ECS tasks use one IP each).
AWS reserves 5 IPs per subnet > Overlapping CIDRs block peering/TGW later.
```

---

### Q11. ENIs and why IP exhaustion happens

Every ECS task (awsvpc), Lambda-in-VPC hyperplane ENI, RDS, ALB node, interface endpoint uses IPs. Small subnets run out → tasks fail to start ("insufficient free addresses"). Size subnets generously.

```flow
trace: Running out of IPs
subnet /24 = 251 usable IPs > Looks plenty.
each Fargate task (awsvpc) = **1 ENI = 1 IP** > Plus Lambda in VPC, endpoints, load balancer nodes.
deployment doubles tasks (old + new) → **IP exhaustion** > New tasks fail to place.
fix: bigger subnets, extra CIDR, prefix delegation on EC2 > Plan for peak, not average.
```

---

### Q12. VPC Flow Logs

Capture IP traffic metadata (src/dst, port, ACCEPT/REJECT) per VPC/subnet/ENI → S3/CloudWatch. Use to debug "connection timed out" (REJECT = SG/NACL) and for security analysis.

```flow
pipeline: Debugging with VPC Flow Logs
Enable on VPC/subnet/ENI > To CloudWatch Logs or S3.
Find the connection > Source/destination IP and port.
ACCEPT or REJECT? > REJECT → a security group or NACL blocked it.
No record? > Traffic never reached the ENI: routing or DNS issue. (Payload is not captured.)
```

---

### Q13. DNS inside a VPC

Route 53 Resolver provides DNS at VPC+2; private hosted zones for internal names; interface endpoints' private DNS makes `secretsmanager.ap-south-1.amazonaws.com` resolve to private IPs. Resolver endpoints for hybrid DNS with on-prem.

```flow
pipeline: Name resolution inside a VPC
App asks the VPC resolver > At VPC base + 2 (e.g. 10.0.0.2).
Private hosted zone? > Internal names like db.internal.
Endpoint private DNS? > AWS service names resolve to endpoint IPs.
Resolver rules > Forward corp.example.com to on-prem DNS; otherwise public DNS.
```

---

## 4. IAM & security

### Q14. Authentication vs authorisation in IAM

**Short answer:** **Authentication** — proving who you are (SSO login, access keys, role session, SigV4-signed request). **Authorisation** — deciding whether that principal may do this **action** on this **resource** under these **conditions** (policy evaluation).

```flow
pipeline: Authentication vs authorisation in AWS
Authenticate > Who are you? Signed request with access keys / temporary credentials (SigV4).
Identify principal > User, role session, service.
Authorise > Policies evaluated: allowed for this action + resource + conditions?
Allow or deny > Every API call, every time.
```

**IAM identities:** users (avoid for humans/apps), groups, **roles** (assumed temporarily — preferred), federated identities (Identity Center, OIDC like GitLab, SAML).

---

### Q15. Anatomy of a policy

```flow
pipeline: Reading a policy statement
Effect > Allow or Deny.
Action > e.g. s3:GetObject.
Resource > e.g. arn:aws:s3:::reports/*.
Condition > e.g. aws:PrincipalTag/team = finance, aws:SourceVpce = vpce-123.
Principal > Only in resource policies: who it applies to.
```

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
```flow
pipeline: How IAM evaluates a request (stop at the first match)
Explicit Deny anywhere? > Any policy with a matching Deny → DENIED. Deny always wins.
Guardrails allow it? > SCP, RCP, permissions boundary and session policy: every applicable one must allow, otherwise DENIED.
Identity or resource policy allows? > Same account: either one allowing is enough → ALLOWED. Cross-account: BOTH the caller's identity policy and the resource policy must allow.
Otherwise > Implicit DENY. Nothing is allowed unless something allows it.
```
KMS is special: the **key policy** must allow use (identity policies alone aren't enough unless the key policy delegates to IAM).

---

### Q17. STS AssumeRole and temporary credentials

**Short answer:** A principal calls `sts:AssumeRole` (or `AssumeRoleWithWebIdentity` for OIDC, `AssumeRoleWithSAML`) and receives **temporary credentials** (access key + secret + session token, expiring in 15 min–12 h). Prefer them over long-lived access keys: auto-expiry, no secret rotation, clear audit trail (CloudTrail shows role session name).

```flow
sequence: Getting temporary credentials (three common paths)
actors: Caller, STS, Target resource
Caller -> STS: ECS task: task role via the container credentials endpoint
STS --> Caller: temporary credentials (expire, auto-refreshed)
Caller -> STS: GitLab job: AssumeRoleWithWebIdentity(OIDC JWT)
> The role's trust policy checks the token's issuer, audience and project/branch claims. No stored AWS keys.
Caller -> STS: Account A role: AssumeRole into Account B
> B's role trust policy must allow A, and A's policy must allow sts:AssumeRole.
STS --> Caller: temporary credentials
Caller -> Target resource: call S3 / deploy / B's resources
```

---

### Q18. Least privilege — how do you achieve it in practice?

Start from specific actions and resource ARNs; use conditions (tags, VPC endpoint, source account); separate roles per service/tool; **IAM Access Analyzer** to generate policies from CloudTrail activity and find unused permissions/external access; review regularly; permission boundaries for delegated role creation.

```flow
cycle: Getting to least privilege
Start narrow > Only the actions the workload obviously needs.
Observe > CloudTrail / IAM Access Analyzer: what's actually used?
Tighten > Remove unused permissions; add resource ARNs and conditions.
Guardrails > Permission boundaries and SCPs cap what's possible.
exit > Review regularly; least privilege drifts as apps change.
```

**Example — many agent tools on ECS:** give each tool its own task role (or Lambda role) scoped to its resources, rather than one "agent role" with `s3:*`, `dynamodb:*`.

---

### Q19. Cross-account access patterns

```flow
pipeline: Cross-account access options
Role assumption > Account B role trusts account A; A's principal assumes it. Most common.
Resource policy > S3 bucket/KMS key policy grants account A directly.
Both sides must allow > Caller's identity policy AND the target's trust/resource policy.
Add conditions > ExternalId, aws:PrincipalOrgID, source account.
```

1. **Role assumption:** account B has a role trusting account A's role; A assumes it (most common).
2. **Resource policy:** S3/KMS/SQS policy grants account A's principal (both sides must allow).
3. Use `aws:PrincipalOrgID` conditions to allow only your organisation; `sts:ExternalId` for third parties (confused-deputy protection).

---

### Q20. ABAC (attribute-based access control)

Grant access based on **tags**: `"Condition": {"StringEquals": {"aws:ResourceTag/project": "${aws:PrincipalTag/project}"}}` → one policy scales to many teams/projects without editing per resource.

```flow
trace: ABAC: one policy, many teams
policy: allow if aws:PrincipalTag/project == aws:ResourceTag/project > Compare tags, not hard-coded ARNs.
role tag project=**atlas**, bucket tag project=**atlas** → ALLOW > Matching tags.
same role, bucket tag project=**zeus** → DENY > No new policy needed per project.
protect tags > Users must not be able to change their own tags.
```

---

### Q21. KMS and envelope encryption

**Short answer:** KMS manages keys (KMS keys never leave the HSMs unencrypted). **Envelope encryption:** KMS generates a **data key**; you encrypt data locally with the data key, and store the data key **encrypted by the KMS key** next to the data. To decrypt, call KMS to decrypt the data key.

```flow
sequence: Envelope encryption with KMS
actors: App, KMS, Storage
App -> KMS: GenerateDataKey(KMS key)
KMS --> App: plaintext data key + encrypted data key
> The KMS key itself never leaves KMS.
App -> App: encrypt file with the plaintext key (AES-256), then discard the plaintext key
App -> Storage: store ciphertext + encrypted data key
> They are stored together; the encrypted key is useless without KMS.
App -> KMS: later: Decrypt(encrypted data key)
> IAM and the key policy decide who may decrypt; every call is logged in CloudTrail.
KMS --> App: plaintext data key → decrypt file
```
Why: large data never goes to KMS, fewer KMS calls, access controlled by key policy + CloudTrail-audited. S3/EBS/RDS/Secrets Manager do this for you with SSE-KMS. AWS-managed vs **customer-managed keys** (control key policy, rotation, cross-account).

---

### Q22. Other security services to name

```flow
pipeline: Security services and where they fit
Detect > GuardDuty (threats), Inspector (vulnerabilities), Macie (sensitive data in S3).
Audit > CloudTrail (API calls), Config (resource configuration history).
Aggregate > Security Hub: findings in one place.
Protect > WAF, Shield, KMS, Secrets Manager.
```

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

```flow
pipeline: Defence in depth for a bank app
Edge > CloudFront + WAF + Shield, TLS.
Identity > SSO + MFA, short-lived credentials, least privilege.
Network > Private subnets, SGs, VPC endpoints, no public DBs.
Data > KMS encryption everywhere, Secrets Manager, backups.
Detection + response > CloudTrail, GuardDuty, alarms, runbooks.
```

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

```flow
pipeline: Which load balancer
ALB (layer 7) > HTTP/HTTPS routing by path/host, WebSockets, gRPC, OIDC auth.
NLB (layer 4) > TCP/UDP, static IPs, extreme throughput, PrivateLink services.
Gateway LB > Inserting third-party firewalls/appliances transparently.
```

| | **ALB** (Layer 7) | **NLB** (Layer 4) | GWLB |
|---|---|---|---|
| Protocols | HTTP/1.1, HTTP/2, gRPC, WebSocket | TCP, UDP, TLS | IP (GENEVE) |
| Routing | path/host/header/query rules | port-based | to appliances |
| Features | TLS termination, auth (OIDC/Cognito), WAF, sticky sessions | static IPs/Elastic IPs, extreme throughput, preserve source IP, PrivateLink | firewalls/IDS inline |
| Use | web APIs, microservices, ECS | non-HTTP, ultra-low latency, PrivateLink service | security appliances |

**ALB concepts:** listener (port/protocol) → rules → **target group** (instances/IPs/Lambda) with health checks; idle timeout (default 60 s — matters for SSE/long requests).

---

### Q25. API Gateway vs ALB

```flow
pipeline: API Gateway or ALB?
Serverless API, needs keys/throttling/usage plans? > API Gateway.
Containers, long requests, streaming, steady high traffic? > ALB.
Timeouts > API Gateway integration ~29 s by default; ALB much longer.
Cost model > Per request (API GW) vs per hour + LCU (ALB).
```

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

```flow
pipeline: DNS and TLS for app.example.com
Route 53 alias > app.example.com points at the CloudFront distribution.
CloudFront > Its ACM certificate must be in us-east-1 (CloudFront is global).
ALB > A separate ACM certificate in the ALB's own Region.
ECS > Traffic inside the VPC (re-encrypt to the task if required).
```

---

### Q27. CloudFront essentials

CDN with edge caching, TLS, HTTP/2/3, WAF, origin access control for private S3, multiple origins with path behaviours (`/api/*` → ALB, default → S3), cache policies, response headers policies (CSP, HSTS), signed URLs/cookies for private content.

```flow
sequence: CloudFront cache hit and miss
actors: User, Edge location, Origin (S3/ALB)
User -> Edge location: GET /assets/app-a1b2.js
Edge location -> Origin (S3/ALB): MISS: fetch from origin
Origin (S3/ALB) --> Edge location: file + Cache-Control: max-age=31536000
Edge location --> User: response (now cached at this edge)
User -> Edge location: another user, same file
Edge location --> User: HIT: served from the edge, origin not touched
```

---

### Q28. WAF

Rules on CloudFront/ALB/API Gateway: AWS managed rule groups (OWASP common, known bad inputs, bot control), rate-based rules (per IP), geo-blocking, custom rules. Use count mode first, then block.

```flow
pipeline: WAF evaluating a request
Request reaches CloudFront/ALB > WAF web ACL attached.
Rules in priority order > Managed rule groups (SQLi, XSS, bad bots), IP sets, rate limits.
First terminating match > Block, allow, or CAPTCHA/count.
Logged > Tune rules from the logs (count mode first).
```

---

## 6. Storage & databases (essentials)

### Q29. S3 essentials

Object storage, 11 nines durability; **Block Public Access** on; bucket policies + IAM; SSE-S3/SSE-KMS (default encryption on); versioning, lifecycle rules (→ IA/Glacier), Object Lock (WORM); presigned URLs for direct browser upload/download; event notifications → Lambda/SQS/EventBridge; strong read-after-write consistency.

```flow
pipeline: An S3 object's protections
Block Public Access > Account + bucket level: on.
Bucket policy + IAM > Who may read/write which prefixes.
Encryption > SSE-S3 or SSE-KMS by default.
Versioning + Object Lock > Recover deletes; WORM retention.
Lifecycle rules > Move to cheaper classes, expire old data.
```

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

```flow
pipeline: EBS vs EFS vs S3
EBS > Block disk for one instance in one AZ (like a hard drive).
EFS > Shared file system across instances, tasks and AZs (NFS).
S3 > Object storage via API: unlimited, cheapest, most durable.
Pick by access pattern > Single-instance disk, shared POSIX files, or objects.
```

---

## 7. Integration: SQS, SNS, EventBridge

### Q32. SQS vs SNS vs EventBridge (vs Kinesis)

```flow
sequence: SQS vs SNS vs EventBridge
actors: Producer, SQS, Worker, SNS, Subscribers, EventBridge, Targets
Producer -> SQS: QUEUE: one message → one consumer
SQS -> Worker: worker pulls when ready (buffering, retries)
Producer -> SNS: PUB/SUB: one message → many
SNS -> Subscribers: push to every subscriber (fan-out)
Producer -> EventBridge: EVENT BUS: routing by content
EventBridge -> Targets: rules match fields, send to targets (Lambda, SFN, SQS…)
> Kinesis/MSK for ordered, replayable high-volume streams.
```

| | **SQS** | **SNS** | **EventBridge** | Kinesis Data Streams |
|---|---|---|---|---|
| Pattern | queue (pull), point-to-point | pub/sub fan-out (push) | event bus with **content-based routing rules** | ordered stream, replay |
| Consumers | one consumer group processes each message | many subscribers | many targets per rule (20+ AWS targets), SaaS sources, schedules | multiple apps read same shard data |
| Buffering/retry | yes (visibility timeout, DLQ) | retries to endpoints, DLQ | retries, DLQ, **archive & replay** | retention up to 365 days |
| Ordering | FIFO queues | FIFO topics | no guarantee | per shard |

**Common combos:** SNS → multiple SQS queues (fan-out with buffering); EventBridge rule → SQS → worker; S3 event → SQS → ECS worker.

---

### Q33. SQS deep dive (frequently asked)

```flow
sequence: SQS visibility timeout in action
actors: SQS, Worker A, Worker B
Worker A -> SQS: ReceiveMessage
SQS --> Worker A: message M (hidden for visibility timeout, e.g. 60 s)
Worker B -> SQS: ReceiveMessage
SQS --> Worker B: M not visible → other messages only
Worker A -> Worker A: crashes before deleting M
SQS --> Worker B: after 60 s, M visible again → redelivered
> At-least-once delivery: consumers must be idempotent. After maxReceiveCount failures → DLQ.
```

- **Visibility timeout:** after a consumer receives a message, it's hidden for N seconds; if not deleted in time, it reappears (retry). Set > processing time; extend for long jobs.
- **At-least-once delivery** (standard queues) → consumers must be **idempotent**. FIFO: exactly-once processing within dedup window + ordering per message group.
- **DLQ** with `maxReceiveCount` for poison messages; redrive back after fixing.
- **Long polling** (`WaitTimeSeconds=20`) reduces empty receives/cost.
- Message size up to 1 MiB (store big payloads in S3, pass a pointer).

---

### Q34. Idempotency in AWS integrations

**Short answer:** Because of retries and at-least-once delivery, the same request/event can arrive more than once. Make handlers safe to repeat: idempotency key (request ID, event ID) stored with a **conditional write** (DynamoDB `attribute_not_exists`), unique constraints, upserts, or AWS APIs' own client tokens (`ClientRequestToken`, `ClientToken`). Powertools for Lambda has an idempotency utility.

```flow
sequence: Idempotent consumer with a DynamoDB dedupe record
actors: SQS, Consumer, DynamoDB
SQS -> Consumer: message (event_id = e-77)
Consumer -> DynamoDB: put e-77 IF attribute_not_exists
DynamoDB --> Consumer: ok → process the event
SQS -> Consumer: duplicate delivery of e-77
Consumer -> DynamoDB: put e-77 IF attribute_not_exists
DynamoDB --> Consumer: ConditionalCheckFailed → skip (already done)
```

---

### Q35. Choreography with events vs orchestration

EventBridge/SNS for loosely coupled reactions (choreography); **Step Functions** when you need a visible, controlled multi-step process with retries, timeouts and compensation (orchestration).

```flow
pipeline: Events or orchestration?
Many independent reactions to one fact? > Choreography with EventBridge: loose coupling.
Ordered steps, retries, compensation, visibility? > Orchestration with Step Functions.
Hybrid > An orchestrated workflow that emits events when done.
```

---

## 8. Observability

### Q36. CloudWatch vs CloudTrail vs X-Ray / OpenTelemetry

```flow
pipeline: CloudWatch vs CloudTrail vs X-Ray/OTel
CloudWatch > Metrics, logs, alarms: is the system healthy?
CloudTrail > Who called which AWS API, when: audit and security.
X-Ray / OpenTelemetry > Traces across services: where did this request spend time?
Use all three > Alarm → trace → logs → audit.
```

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

```flow
pipeline: What to alarm on
User-facing symptoms first > Error rate, p99 latency, availability (SLOs).
Saturation > Queue age, CPU/memory, connection pools, throttles.
Dependencies > DB, LLM provider errors and latency.
Cost + security > Budget anomalies, GuardDuty findings. Every alarm needs an owner and a runbook.
```

---

## 9. Resilience, DR & Well-Architected

### Q38. High availability across AZs

Run ≥2 (ideally 3) AZs for every tier: ALB across AZs, ECS service spread across AZs, RDS Multi-AZ, NAT per AZ, stateless app instances, health checks + auto-replacement, avoid AZ-pinned single points (one NAT, one EC2). Test by simulating AZ failure (AWS Fault Injection Service).

```flow
pipeline: Surviving an AZ failure
Load balancer across 3 AZs > Healthy targets only.
Compute spread across AZs > ECS/ASG balance tasks per AZ.
Multi-AZ database > Standby promoted automatically.
Capacity headroom > Remaining AZs can carry the load (N+1).
```

---

### Q39. Disaster recovery strategies

```flow
pipeline: DR strategies, cheapest to fastest
Backup & restore > Hours of RTO; cheapest.
Pilot light > Core data replicated, minimal infra ready; scale up on disaster.
Warm standby > Scaled-down full copy running; minutes.
Multi-site active/active > Both regions serve traffic; near-zero RTO; most expensive.
```

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

```flow
pipeline: The six Well-Architected pillars
Operational excellence > Automate, observe, learn from incidents.
Security > Identity, protection, detection.
Reliability > Recover from failure, scale, change safely.
Performance efficiency > Right resources, measure, evolve.
Cost optimisation > Pay for what you need.
Sustainability > Minimise environmental impact.
```

---

### Q41. Service quotas and throttling

Most AWS APIs have rate limits and account quotas (Lambda concurrency, Bedrock tokens/min, ENIs). Design with backoff + jitter, request quota increases early, monitor `ThrottlingException`s, and spread load (queues).

```flow
pipeline: Handling throttling and quotas
Know your quotas > Service Quotas console; request increases ahead of launches.
Client retries with backoff + jitter > SDK standard/adaptive retry modes.
Smooth the load > Queues, batching, caching.
Alarm before the limit > Usage metrics vs quota.
```

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

```flow
pipeline: ECS can't read S3 despite an Allow
Which role? > The app uses the TASK role, not the execution role.
Resource ARN right? > bucket vs bucket/* for objects.
Explicit deny anywhere? > SCP, permissions boundary, bucket policy.
KMS key policy > SSE-KMS objects also need kms:Decrypt.
Endpoint policy > A restrictive S3 gateway endpoint policy.
```

---

### Q43. An internal API sometimes times out under load

Measure where: ALB metrics (`TargetResponseTime`, 5xx, surge queue), ECS CPU/memory, app latency per dependency (traces), DB connections/CPU, NAT GW `ErrorPortAllocation`, DynamoDB/Bedrock throttling, Lambda concurrency. Typical fixes: connection pooling, autoscaling on right metric, timeouts + retries with backoff, caching, async processing via SQS, quota increases.

```flow
pipeline: Intermittent timeouts under load
Where? > Traces: which hop is slow?
Pools exhausted? > DB connections, HTTP client pool, threads.
Dependency throttling? > 429s / slow responses upstream.
Timeouts mismatched? > Client timeout shorter than server work; retries piling up.
Fix > Pool sizes, timeouts + budgets, backpressure, scale.
```

---

### Q44. "Connection timed out" vs "AccessDenied" — what does each tell you?

**Timeout** = network path problem (SG, NACL, route table, missing NAT/endpoint, DNS to wrong IP). **AccessDenied** = network fine, IAM/resource policy problem. **Connection refused** = reached host but nothing listening on that port.

```flow
pipeline: Timeout vs AccessDenied tells you which layer
Connection timed out > Network: security group, NACL, route, NAT/endpoint missing. Packets never got a reply.
AccessDenied / 403 > You reached the service; IAM/resource policy said no.
Connection refused > Reached the host but nothing listening on that port.
DNS failure > Name didn't resolve: private DNS / resolver config.
```

---

### Q45. Design secure cross-account access for a central agent platform calling team accounts

Central account role → assumes per-team roles (`sts:AssumeRole`) with trust limited to the platform role ARN + `aws:PrincipalOrgID`; team roles grant only specific tools' actions; session tags carry end-user/tenant for ABAC; CloudTrail in both accounts; SCPs prevent privilege escalation.

```flow
sequence: Central agent platform calling team accounts
actors: Agent tool role (platform), STS, Team account role, Team resource
Agent tool role (platform) -> STS: AssumeRole(team role, ExternalId, session tags: user, tenant)
STS -> STS: team role trust: only the platform role, PrincipalOrgID, tags required
STS --> Agent tool role (platform): short-lived credentials
Agent tool role (platform) -> Team resource: call with least-privilege permissions
> Each team owns its role and can revoke trust; CloudTrail in both accounts shows who did what.
```

---

### Q46. How do you present an AWS design trade-off in an interview?

Structure: requirements (latency, scale, compliance) → 2 options → compare on **security, reliability, cost, operability, performance** → choose with reasoning → risks + mitigations → how you'd validate (load test, cost estimate). Example: "API Gateway + Lambda vs ALB + ECS for an agent API: streaming for minutes and steady load favour ALB + ECS; spiky low traffic favours Lambda."

```flow
pipeline: Presenting an AWS trade-off
Requirement > What matters most here (latency, cost, ops, compliance)?
Options > Two or three realistic choices.
Compare > On those criteria, with numbers where you can.
Decide + why > And what would change your mind.
Risks + mitigation > What could go wrong and how you'd know.
```

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
