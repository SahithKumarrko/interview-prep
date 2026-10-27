# AWS Foundations, IAM & Networking: Interview Preparation

> **Updated:** 27 October 2026 · **Level:** what AWS is → accounts, VPC & IAM → load balancing, storage, messaging → resilient, secure design
> **How to use:** read the *Short answer* first, then *How it works* and the *Example* walkthrough. *Common mistake → fix* shows what goes wrong in real setups. *Interview answer* is what you can say out loud.

---

## Table of contents

1. [Mental model: the layers of an AWS application](#1-mental-model-the-layers-of-an-aws-application)
2. [Getting started: AWS, accounts & global infrastructure](#2-getting-started-aws-accounts--global-infrastructure) (Q01–Q06)
3. [Networking: VPC](#3-networking-vpc) (Q07–Q18)
4. [IAM & security](#4-iam--security) (Q19–Q31)
5. [Load balancing, DNS, edge](#5-load-balancing-dns-edge) (Q32–Q37)
6. [Storage & databases (essentials)](#6-storage--databases-essentials) (Q38–Q41)
7. [Integration: SQS, SNS, EventBridge](#7-integration-sqs-sns-eventbridge) (Q42–Q47)
8. [Observability](#8-observability) (Q48–Q50)
9. [Resilience, DR & Well-Architected](#9-resilience-dr--well-architected) (Q51–Q54)
10. [Scenario & debugging questions](#10-scenario--debugging-questions) (Q55–Q59)
11. [Cheat sheet](#11-cheat-sheet)

---

## 1. Mental model: the layers of an AWS application

**The one idea everything else follows from:** AWS is a huge set of building blocks that you rent by the hour, by the request or by the gigabyte. Almost every application is built from the same few layers: a **network** you own (the VPC), **compute** that runs your code (EC2, containers, Lambda), **data** stores (S3, databases), **messaging** between parts (queues, events), and two cross-cutting layers that touch everything: **IAM** (who is allowed to do what) and **observability** (what is happening right now, and who did what).

Think of it like renting space in a secure office building. The building (a Region) has several separate wings with their own power (Availability Zones). You rent a private floor (a VPC) and divide it into rooms (subnets). Some rooms face the street (public subnets with a load balancer), most do not (private subnets with your app and database). Badges (IAM) decide who can open which door, and cameras (CloudWatch, CloudTrail) record what happens.

Here is one request travelling through those layers:

```flow
sequence: Follow one request into the VPC
actors: User, Route 53, CloudFront, ALB (public), ECS task (private), RDS (data)
User -> Route 53: resolve app.example.com
> DNS returns the address of the CloudFront distribution closest to the user.
User -> CloudFront: HTTPS request for /api/orders
> TLS is terminated at the edge with an ACM certificate, and WAF rules inspect the request. Static files would be served straight from S3.
CloudFront -> ALB (public): /api/* forwarded to the load balancer
> The ALB has nodes in the public subnets of every Availability Zone.
ALB (public) -> ECS task (private): forwarded to one healthy target on port 8000
> Tasks have no public IP. Their security group only accepts traffic from the ALB's security group.
ECS task (private) -> RDS (data): SQL query on port 5432
> The database sits in private data subnets. A standby copy in another Availability Zone is kept in sync for failover.
ECS task (private) --> User: JSON response back through the ALB and CloudFront
```

The same layout drawn as boxes (three Availability Zones, three subnet tiers):

```
                                 Internet users
                                       │
                         Route 53 (DNS) │ app.example.com
                                       ▼
                    CloudFront (CDN, TLS via ACM, WAF) ── S3 (static web app)
                                       │ /api/*
 ┌──────────────────────────────── Region ap-south-1 ─── VPC 10.0.0.0/16 ─────────────────────────────────┐
 │   AZ-a                                   AZ-b                                   AZ-c                    │
 │  ┌──────────────────────┐              ┌──────────────────────┐              ┌──────────────────────┐   │
 │  │ PUBLIC subnet        │              │ PUBLIC subnet        │              │ PUBLIC subnet        │   │
 │  │  ALB node            │              │  ALB node            │              │  ALB node            │   │
 │  ├──────────────────────┤              ├──────────────────────┤              ├──────────────────────┤   │
 │  │ PRIVATE app subnet   │              │ PRIVATE app subnet   │              │ PRIVATE app subnet   │   │
 │  │  ECS tasks / EC2     │              │  ECS tasks / EC2     │              │  ECS tasks / EC2     │   │
 │  ├──────────────────────┤              ├──────────────────────┤              ├──────────────────────┤   │
 │  │ PRIVATE data subnet  │              │ PRIVATE data subnet  │              │ PRIVATE data subnet  │   │
 │  │  RDS primary         │◄─ sync repl ─►  RDS standby         │              │  ElastiCache         │   │
 │  └──────────────────────┘              └──────────────────────┘              └──────────────────────┘   │
 │   Internet gateway · NAT gateway (outbound only) · VPC endpoints: S3, ECR, Secrets Manager, Logs ...      │
 └─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
   Cross-cutting: IAM (who can do what) · KMS (encryption keys) · CloudWatch / CloudTrail / X-Ray (observe and audit)
```

**Three rules that come straight from this picture:**
1. **Spread everything across at least two Availability Zones.** One data centre problem should never take the whole application down.
2. **Keep things private by default.** Only the load balancer faces the internet. Apps and databases live in private subnets and are reached through security group rules that name the caller.
3. **Every API call is checked by IAM.** Services do not trust each other because they are "inside AWS". A container reading S3 needs a role that allows it, every single time.

---

## 2. Getting started: AWS, accounts & global infrastructure

### Q01. What is AWS, and how do you work with it?

**Short answer:** AWS (Amazon Web Services) is a cloud provider: it rents you computers, storage, networks and ready-made services over the internet, and you pay for what you use instead of buying hardware. Everything in AWS is an **API** (a web endpoint you send signed requests to). The web console, the command-line tool (CLI), the language SDKs and infrastructure-as-code tools are all just different ways of calling those same APIs.

**How it works:**
1. Each service (S3, EC2, SQS …) exposes HTTPS API operations such as `s3:PutObject` or `ec2:RunInstances`.
2. Every request is **signed** with your credentials using a scheme called SigV4 (Signature Version 4), so AWS knows who is calling.
3. IAM checks whether that identity is allowed to perform that action on that resource (see Q20).
4. The service does the work and returns a response, and many services also write an audit record to CloudTrail.

The four common ways to send those requests:

| Tool | What it is | Good for |
|---|---|---|
| **Management Console** | the website | learning, looking around, one-off fixes |
| **AWS CLI** | `aws` command in a terminal | scripts, quick checks |
| **SDKs** (boto3, AWS SDK for JavaScript, Java …) | libraries in your code | applications calling AWS |
| **Infrastructure as code** (CloudFormation, CDK, Terraform) | files that describe resources | creating and changing real environments repeatably |

**Example:** the same "list my S3 buckets" call three ways.
```bash
aws s3api list-buckets --query "Buckets[].Name"
```
```python
import boto3
s3 = boto3.client("s3")
print([b["Name"] for b in s3.list_buckets()["Buckets"]])
```
```yaml
# CloudFormation: declare a bucket instead of calling CreateBucket yourself
Resources:
  ReportsBucket:
    Type: AWS::S3::Bucket
```

**What happens, step by step (the CLI call):**
1. The CLI finds credentials: environment variables, then the `~/.aws` files, then (on AWS compute) the role attached to the machine or container.
2. It builds an HTTPS request to the S3 endpoint and signs it with SigV4 using those credentials.
3. S3 receives it, IAM confirms the caller is allowed `s3:ListAllMyBuckets`, and S3 returns the list, for example `["acme-reports", "acme-logs"]`.
4. If the credentials are missing you get `Unable to locate credentials`; if they are valid but not allowed you get `AccessDenied`.

**Common mistake → fix:** building production environments by clicking in the console. Nobody can review it, repeat it in another account, or see what changed. Fix: use the console to explore, but create real environments with infrastructure as code that goes through code review.

**Interview answer:** "AWS is a cloud provider where every service is an API. The console, the CLI, the SDKs and tools like CloudFormation or Terraform are just different clients of those signed API calls. Each call is authenticated with SigV4, authorised by IAM and usually logged in CloudTrail. For real environments I use infrastructure as code so changes are reviewed and repeatable."

**Follow-ups:**
- *What is CloudFormation vs CDK vs Terraform?* CloudFormation is AWS's native template engine; CDK lets you write CloudFormation in a programming language; Terraform is a third-party tool that works across many providers.
- *Where does the CLI get credentials on an EC2 instance?* From the instance's IAM role through the instance metadata service; no keys are stored on disk.

---

### Q02. What are Regions, Availability Zones and edge locations?

**Short answer:** A **Region** is a geographic area, such as `ap-south-1` (Mumbai) or `eu-west-1` (Ireland), with its own independent copy of most AWS services. Each Region contains several **Availability Zones** (AZs): separate groups of data centres with their own power, cooling and networking, connected to each other by fast private links. **Edge locations** are smaller sites in many cities used by CloudFront, Route 53 and WAF to be close to users. The key rule: run important workloads in **at least two AZs**.

**How it works:**
- Regions are isolated from each other. Data you put in a Region stays there unless you copy it out, which matters for data residency laws.
- AZs in a Region are kilometres apart so a fire or flood rarely hits two, but close enough for single-digit millisecond latency between them, so you can replicate data synchronously.
- AZ names like `ap-south-1a` are mapped to physical zones differently per account. To compare across accounts, use the **AZ ID** (for example `aps1-az1`).
- Edge locations do not run your servers; they cache content and answer DNS close to users.

How to choose a Region:

| Factor | Question to ask |
|---|---|
| Compliance | Must the data stay in a country? |
| Latency | Where are most users? |
| Service availability | Is the service (or model, or instance type) offered there? |
| Cost | Prices differ between Regions. |

**Example:** a web API for users in India is deployed in `ap-south-1` across three AZs: `ap-south-1a`, `ap-south-1b`, `ap-south-1c`. Its static files are cached by CloudFront at edge locations in several Indian cities.

**What happens, step by step (one AZ fails):**
1. Normal day: the load balancer spreads traffic across 6 app servers, 2 in each AZ.
2. AZ `ap-south-1b` loses power. Its 2 servers stop answering health checks.
3. Within a few health-check intervals, the load balancer stops sending traffic to them. The remaining 4 servers in `1a` and `1c` serve all users.
4. Auto scaling notices fewer healthy servers and launches replacements in the healthy AZs.
5. If everything had been in `1b` only, the whole application would have been down for the length of the outage.

**Common mistake → fix:** putting the database, a single NAT gateway or a single "special" server in one AZ while the rest is spread out. That one piece becomes the single point of failure. Fix: check every tier (load balancer, compute, database, NAT, caches) for multi-AZ placement.

**Interview answer:** "A Region is an isolated geographic area; an Availability Zone is one or more separate data centres inside it with independent power and networking; edge locations are CloudFront and Route 53 sites close to users. I pick a Region by compliance, latency, service availability and cost, and I deploy every tier across at least two, ideally three, AZs so one data centre failure doesn't cause an outage."

**Follow-ups:**
- *Multi-AZ or multi-Region?* Multi-AZ protects against data centre failures and is the default for production. Multi-Region protects against a whole Region failing and costs much more; use it when the business needs it (see Q52).
- *What are Local Zones and Outposts?* Local Zones put some AWS services in a city for very low latency; Outposts put AWS hardware in your own data centre.

---

### Q03. What is an AWS account, and what is the root user?

**Short answer:** An **AWS account** is a container for resources and a billing boundary: every resource lives in exactly one account, and nothing in one account can touch another unless you explicitly allow it. The **root user** is the email address that created the account and has unlimited power over it, including closing it. You lock the root user away with MFA (multi-factor authentication) and never use it for daily work.

**How it works:**
- Each account has a 12-digit ID, for example `111122223333`. Resource names (ARNs, Amazon Resource Names) include it: `arn:aws:iam::111122223333:role/app`.
- Accounts are a hard **isolation boundary**: separate IAM, separate resources, separate service quotas. That is why companies use many accounts (dev, staging, prod) instead of one big one (see Q05).
- The root user cannot be limited by normal IAM policies in its own account. Only a few tasks need it (for example changing some account settings or restoring access).

**Example:** a safe first-day setup for a new account.
```text
1. Sign in as root → enable MFA on root → do NOT create root access keys.
2. Set up IAM Identity Center (or an admin role) for people.
3. Turn on CloudTrail and a billing budget alarm.
4. Log out of root. Store its credentials in a safe place.
```

**What happens, step by step (someone leaks a root access key):**
1. A developer once created root access keys and committed them to a public repository.
2. Within minutes, automated scanners find the key and start launching large instances for crypto mining.
3. Because it is root, no policy can stop it: the attacker can also delete logs and change billing details.
4. With the setup above there are no root keys to leak, and people use short-lived role credentials instead.

**Common mistake → fix:** using the root user (or one shared admin user) for everyday work. Fix: root with MFA in a vault; individual sign-in through IAM Identity Center with temporary credentials.

**Interview answer:** "An account is the isolation and billing boundary for AWS resources. The root user is the account owner with unlimited rights, so I enable MFA on it, never create access keys for it, and use it only for the few tasks that require it. Everyday access goes through federated sign-in and roles with temporary credentials."

**Follow-ups:**
- *Can an SCP restrict the root user?* Yes, in member accounts of AWS Organizations, service control policies also restrict root (but not in the management account).

---

### Q04. What is the shared responsibility model?

**Short answer:** Security is split between AWS and you. AWS secures **"of" the cloud**: buildings, hardware, the virtualisation layer and the internals of managed services. You secure **"in" the cloud**: who has access (IAM), your data and its encryption, network rules, and your code. Where the line sits depends on the service: the more managed it is, the more AWS does.

**How it works:**

| Layer | EC2 (virtual server) | ECS on Fargate (containers) | Lambda (functions) |
|---|---|---|---|
| Physical data centre, hardware | AWS | AWS | AWS |
| Host OS and hypervisor | AWS | AWS | AWS |
| Guest OS patching | **You** | AWS | AWS |
| Container image and its libraries | You (if used) | **You** | AWS runtime, **you** for your packages |
| Network rules (security groups) | **You** | **You** | **You** (if in a VPC) |
| IAM permissions, data, encryption choices | **You** | **You** | **You** |

**Example:** the same "OpenSSL vulnerability" news on three platforms. On EC2 you must patch the OS packages. On Fargate the host is patched by AWS, but you must rebuild your container image if it bundles OpenSSL. On Lambda AWS patches the runtime, but you must update any library you packaged yourself.

**What happens, step by step (an S3 data leak):**
1. A team makes a bucket public to share a file quickly.
2. Someone finds the bucket and downloads customer data.
3. This is the customer's responsibility: AWS ran S3 exactly as configured. The fix is in the customer's half: Block Public Access, least-privilege policies, monitoring.

**Common mistake → fix:** assuming "managed" means "secured". Managed services still need correct IAM, encryption and network settings. Fix: list for each service which layers are yours and check them.

**Interview answer:** "AWS is responsible for security of the cloud: facilities, hardware, hypervisor and managed service internals. I'm responsible for security in the cloud: IAM, data, encryption, network configuration and application code. The line moves with the service: on EC2 I patch the OS, on Fargate and Lambda AWS does, but I always own permissions, data and my own dependencies."

**Follow-ups:**
- *Who is responsible for a misconfigured security group?* You are; configuration is always on the customer side.

---

### Q05. How do you structure multiple AWS accounts?

**Short answer:** Use **AWS Organizations** to group many accounts, usually one per environment and workload (dev, staging, prod) plus shared accounts for security, logging and networking. Separate accounts limit the **blast radius** (how much one mistake or attacker can affect), keep bills apart, and let you apply **SCPs** (service control policies): organisation-wide guardrails that cap what anyone in an account can do. People sign in once through **IAM Identity Center** and pick the account and role they need.

**How it works:**
1. The **management account** owns the organisation and billing. You run no workloads in it.
2. Accounts are grouped into **OUs** (organisational units), for example `Security`, `Workloads/Prod`, `Workloads/NonProd`.
3. SCPs attached to an OU set the maximum permissions for every account below it. They do not grant anything; they only limit (see Q23).
4. A **log archive** account receives CloudTrail and Config logs from all accounts, so a compromised workload account cannot delete its own audit trail.
5. IAM Identity Center maps groups of people to **permission sets** (for example `ReadOnly` in prod, `Developer` in dev) and gives them short-lived credentials.

```flow
pipeline: A typical multi-account layout
stage: Organisation root
Management account > Owns billing and the organisation. No workloads run here.
stage: Shared accounts
Security and log archive > Central CloudTrail, GuardDuty and audit logs that workload accounts cannot delete.
Shared networking > Transit Gateway and shared VPC pieces used by every workload account.
stage: Workload accounts
dev, staging and prod per application > A mistake in dev cannot touch prod, and each bill is separate.
SCPs on the Workloads OU > Guardrails such as "only ap-south-1 and eu-west-1" apply to every account below.
```

**Example:** an SCP that blocks all Regions except two (simplified).
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "DenyOtherRegions",
    "Effect": "Deny",
    "NotAction": ["iam:*", "organizations:*", "sts:*", "cloudfront:*", "route53:*", "support:*"],
    "Resource": "*",
    "Condition": { "StringNotEquals": { "aws:RequestedRegion": ["ap-south-1", "eu-west-1"] } }
  }]
}
```

**What happens, step by step:**
1. A developer with `AdministratorAccess` in the dev account tries to launch an instance in `us-east-1`.
2. IAM evaluates the request. The identity policy allows it, but the SCP on the dev account's OU has a matching `Deny` because `us-east-1` is not in the list.
3. Explicit deny wins: the call fails with `AccessDenied`, even for an administrator.
4. Global services (IAM, CloudFront, Route 53) are excluded with `NotAction`, because their API calls are made through `us-east-1`.

**Common mistake → fix:** one big account for everything, with environments separated only by naming. A wrong `terraform destroy` or a leaked key affects production. Fix: separate accounts per environment, guardrails as SCPs, and centralised logs.

**Interview answer:** "I use AWS Organizations with separate accounts per workload and environment, plus security, log-archive and shared-networking accounts. Accounts limit blast radius and separate billing. SCPs on OUs act as guardrails that even admins can't bypass, such as allowed Regions or 'never disable CloudTrail'. People sign in through IAM Identity Center with permission sets and temporary credentials, not IAM users."

**Follow-ups:**
- *What is Control Tower?* A service that sets up this multi-account landing zone (accounts, guardrails, logging) for you.
- *What is an RCP?* A resource control policy: like an SCP but applied to resources (for example "S3 buckets in this org can only be accessed by principals in this org").

---

### Q06. What compute options does AWS offer?

**Short answer:** There are three main ways to run code. **EC2** gives you a virtual server where you control the operating system. **Containers** run on **ECS** (AWS's own container orchestrator) or **EKS** (managed Kubernetes), either on EC2 instances you manage or on **Fargate**, where AWS runs the servers for you. **Lambda** runs a function per event and you never see a server. The less you manage, the less control you have and the more limits you accept.

**How it works:**

| Option | You manage | Billing | Limits to know | Typical use |
|---|---|---|---|---|
| **EC2** | OS, patching, scaling setup | per second while running | none on runtime | special OS needs, GPUs, legacy apps |
| **ECS / EKS on EC2** | instances + containers | instances | you run the cluster capacity | many containers, cost control at scale |
| **ECS / EKS on Fargate** | containers only | per task vCPU and memory per second | fixed CPU/memory combinations | long-running APIs and workers without servers |
| **Lambda** | function code | per request + duration | 15-minute maximum run time | event handlers, spiky light traffic |

**How to choose:** start with the most managed option that fits. If a job can finish in under 15 minutes and is triggered by events, Lambda. If it is a long-running service, streams responses or needs steady capacity, containers on Fargate. Drop to EC2 only when you need OS control, special hardware, or the lowest cost at large steady scale.

**Example:** an order system. The REST API runs on ECS Fargate behind a load balancer (long-lived connections, steady traffic). When an order file lands in S3, a Lambda function validates it (short, event-driven). A nightly GPU report job runs on EC2 Spot instances (special hardware, cheap interruptible capacity).

**What happens, step by step (a traffic spike from 10 to 500 requests per second):**
1. Lambda: AWS starts more function copies automatically within seconds, up to your account's concurrency limit.
2. ECS Fargate: service auto scaling sees CPU rise, raises the desired task count, and new tasks start in about a minute.
3. EC2: the Auto Scaling group launches new instances, which must boot and start the app, often a few minutes.
4. The lesson: more managed options usually scale faster but cost more per unit of work at steady high load.

**Common mistake → fix:** picking Lambda for a job that sometimes runs 20 minutes. It is killed at 15 minutes. Fix: use Fargate (or Step Functions to split the job) for long work.

**Interview answer:** "AWS compute ranges from EC2, where I manage the OS, to containers on ECS or EKS, either on my own instances or on Fargate, to Lambda, which runs a function per event with a 15-minute limit. I choose the most managed option that fits the runtime, traffic shape and hardware needs: Lambda for short event-driven work, Fargate for long-running services, EC2 when I need OS control, GPUs or the lowest steady-state cost."

**Follow-ups:**
- *What is App Runner or Elastic Beanstalk?* Higher-level services that deploy a web app for you on top of containers or EC2.

---

## 3. Networking: VPC

### Q07. What is a VPC?

**Short answer:** A **VPC** (Virtual Private Cloud) is your own private network inside one AWS Region. You choose its IP address range (written in CIDR notation, for example `10.0.0.0/16`), divide it into subnets, and decide how traffic flows in and out. Resources like EC2 instances, containers, databases and load balancers are launched into it and get private IP addresses from that range.

**How it works:**
- **CIDR** (Classless Inter-Domain Routing) notation says how big the range is: `/16` means the first 16 bits are fixed, leaving 16 bits, so 2^16 = 65,536 addresses. `/24` leaves 8 bits = 256 addresses. A VPC can be between `/16` and `/28`.
- A VPC spans **all AZs of its Region**, but each **subnet** lives in exactly one AZ (see Q08).
- By default nothing outside can reach anything inside. You add an **internet gateway**, a **NAT gateway**, **VPC endpoints**, peering and so on to open specific paths.
- Inside the VPC, every subnet can reach every other subnet through the built-in `local` route. What actually gets through is then decided by security groups (see Q10).
- Every account has a **default VPC** in each Region with public subnets, convenient for experiments but not recommended for production.

**Example:**
```bash
aws ec2 create-vpc --cidr-block 10.0.0.0/16 --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=orders-prod}]'
aws ec2 create-subnet --vpc-id vpc-0abc --cidr-block 10.0.1.0/24 --availability-zone ap-south-1a
```

**What happens, step by step:**
1. The VPC `orders-prod` is created with 65,536 private addresses (`10.0.0.0` to `10.0.255.255`). It also gets a main route table with one route: `10.0.0.0/16 → local`.
2. The subnet `10.0.1.0/24` is created in `ap-south-1a`. It has 256 addresses, but AWS reserves 5 (network address, VPC router, DNS, one for future use, broadcast), leaving **251** usable.
3. An instance launched in that subnet gets, say, `10.0.1.25`. It can reach any other address in `10.0.0.0/16` (security groups permitting), but nothing on the internet yet, because there is no internet gateway.

**Common mistake → fix:** picking `172.31.0.0/16` (the default VPC range) or the same `10.0.0.0/16` for every VPC. Later, when you need to connect VPCs or the office network, overlapping ranges cannot be routed. Fix: plan unique ranges per VPC from the start (see Q15).

**Interview answer:** "A VPC is my private network in a Region, defined by a CIDR block like 10.0.0.0/16. I split it into subnets, one AZ each, and control traffic with route tables, gateways and security groups. Nothing is reachable from outside unless I add a path such as an internet gateway or a load balancer, and I plan non-overlapping CIDR ranges so VPCs can be connected later."

**Follow-ups:**
- *Can a VPC span Regions?* No. One VPC lives in one Region; you connect Regions with peering or Transit Gateway.
- *Can you add more addresses later?* Yes, you can add secondary CIDR blocks to a VPC.

---

### Q08. What are subnets and route tables, and what makes a subnet public or private?

**Short answer:** A **subnet** is a slice of the VPC's address range in **one AZ**. A **route table** is a list of rules ("traffic for this destination goes to that target") attached to subnets. A subnet is **public** if its route table sends internet traffic (`0.0.0.0/0`) to an **internet gateway**; otherwise it is **private**. Nothing else makes a subnet public: it is purely the route.

**How it works:**
1. Each subnet is associated with exactly one route table (the VPC's main table if you don't choose one).
2. When a packet leaves an instance, the VPC router looks for the **most specific matching route** (longest prefix). `10.0.0.0/16 → local` beats `0.0.0.0/0` for internal traffic.
3. Public subnet: `0.0.0.0/0 → igw-…`. Instances also need a public IP to be reachable from the internet.
4. Private subnet: `0.0.0.0/0 → nat-…` (outbound only, see Q09) or no default route at all (fully isolated).

**Example:**
```
 Public subnet route table          Private app subnet route table
 10.0.0.0/16 → local                10.0.0.0/16 → local
 0.0.0.0/0   → igw-123              0.0.0.0/0   → nat-abc     (outbound only)
                                    pl-s3       → vpce-s3     (S3 gateway endpoint)
```

**What happens, step by step (an app in `10.0.11.20`, private subnet, calls three places):**
1. To the database at `10.0.21.5`: matches `10.0.0.0/16 → local`. Delivered inside the VPC.
2. To S3: the destination IPs are in the S3 prefix list `pl-s3`, which is more specific than `0.0.0.0/0`, so traffic goes to the S3 gateway endpoint and never touches the NAT.
3. To `api.github.com` (`140.82.x.x`): only `0.0.0.0/0` matches, so it goes to the NAT gateway, which forwards it to the internet gateway. The reply comes back through the same NAT.
4. Someone on the internet tries to connect to `10.0.11.20`: impossible. Private addresses are not routable on the internet and the instance has no public IP.

```flow
trace: Route lookup for three destinations from 10.0.11.20
to 10.0.21.5 → matches **10.0.0.0/16 → local** > Internal traffic always stays inside the VPC through the local route.
to an S3 address → matches **pl-s3 → vpce-s3** > The S3 prefix list is more specific than 0.0.0.0/0, so the free gateway endpoint wins.
to 140.82.112.3 → only **0.0.0.0/0 → nat-abc** matches > Internet traffic leaves through the NAT gateway, which hides the private address.
inbound from the internet → **no path** > The instance has no public IP, so nothing outside can start a connection.
```

**Common mistake → fix:** giving an instance a public IP in a private subnet and expecting it to be reachable. Without an internet gateway route, replies cannot get out, so it still is not reachable. Equally, putting databases in a public subnet "because security groups protect it" removes one layer of defence. Fix: public subnets only for load balancers (and zonal NAT gateways); everything else private.

**Interview answer:** "A subnet is a piece of the VPC range in one AZ, and its route table decides where packets go using the most specific match. A subnet is public only because its route table sends 0.0.0.0/0 to an internet gateway. I put only load balancers in public subnets; apps and databases go in private subnets that reach the internet outbound through NAT and reach AWS services through endpoints."

**Follow-ups:**
- *Why three tiers (public, app, data)?* Different route tables and security rules per tier. The data tier often has no internet route at all.

---

### Q09. Internet gateway vs NAT gateway

**Short answer:** An **internet gateway** (IGW) connects the VPC to the internet in both directions, for resources that have public IPs in public subnets. A **NAT gateway** (Network Address Translation) lets resources in **private** subnets start **outbound** connections (download packages, call external APIs) while staying unreachable from the internet. NAT translates the private source address into its own public address and translates replies back.

**How it works:**
- IGW: one per VPC, highly available, free. It does one-to-one translation between an instance's public IP and its private IP.
- NAT gateway: charged **per hour and per GB processed**. A **zonal** NAT gateway lives in one public subnet in one AZ and needs an Elastic IP; for high availability you create one per AZ and point each private subnet at the NAT in its own AZ.
- A newer **regional** NAT gateway mode spans AZs automatically: you create one per VPC, it does not need a public subnet, and it expands to the AZs where your workloads have network interfaces. Private NAT (to other networks, not the internet) still needs zonal mode.
- Only **outbound-initiated** connections work through NAT. Replies are allowed back; new inbound connections are not.

```flow
sequence: Inbound through the IGW, outbound through NAT
actors: Internet, IGW, ALB (public subnet), NAT gateway, App (private subnet)
Internet -> IGW: HTTPS request to the ALB's public IP
IGW -> ALB (public subnet): delivered, because the public subnet routes 0.0.0.0/0 to the IGW
App (private subnet) -> NAT gateway: outbound call to api.payments.example
> The app's route table sends 0.0.0.0/0 to the NAT. Its source address 10.0.11.20 is replaced by the NAT's public IP.
NAT gateway -> IGW: packet now comes from the NAT's Elastic IP
IGW -> Internet: out to the payment provider
Internet --> App (private subnet): reply comes back through the IGW and NAT to 10.0.11.20
> Nothing on the internet can start a new connection to the app. NAT only lets replies back in.
```

**Example:** a private ECS service pulls 2 GB of container images per deployment from ECR, 20 times a day, through a NAT gateway: 40 GB per day of NAT data processing charges (illustrative). Adding an S3 gateway endpoint and ECR interface endpoints moves that traffic off the NAT.

**What happens, step by step (zonal NAT, one AZ fails):**
1. Three private subnets (AZ a, b, c) all route `0.0.0.0/0` to a single NAT in AZ a, to save money.
2. AZ a has an outage. The NAT goes with it.
3. Apps in AZ b and c are healthy but every outbound call times out. One AZ failure has taken down outbound connectivity in all three.
4. Fix: one zonal NAT per AZ with per-AZ route tables, or a regional NAT gateway that keeps AZ affinity automatically. This also avoids cross-AZ data charges.

**Common mistake → fix:** sending heavy AWS-service traffic (S3, ECR, CloudWatch Logs) through NAT. It works but you pay NAT processing per GB. Fix: VPC endpoints (see Q12).

**Interview answer:** "An internet gateway gives public-subnet resources two-way internet access. A NAT gateway lets private resources make outbound connections without being reachable inbound. NAT charges per hour and per GB, so I send AWS service traffic through VPC endpoints instead, and I avoid a single zonal NAT shared by all AZs: either one NAT per AZ or the regional NAT gateway mode that spans AZs automatically."

**Follow-ups:**
- *What about IPv6?* Use an **egress-only internet gateway**: IPv6 addresses are public, and it allows outbound-only IPv6 like NAT does for IPv4.
- *NAT instance vs NAT gateway?* A NAT instance is an EC2 you manage yourself; the managed NAT gateway is the normal choice today.

---

### Q10. What is a security group?

**Short answer:** A **security group** is a virtual firewall attached to a network interface (an instance, a container task, a load balancer, a database). It contains **allow** rules only: which traffic may come in and which may go out, by protocol, port and source. It is **stateful**: if a request is allowed in, the reply is allowed out automatically. Its most powerful feature is that a rule's source can be **another security group**, meaning "anything wearing that group's badge".

**How it works:**
1. A new security group has **no inbound rules** (everything in is blocked) and one outbound rule allowing all traffic.
2. When a packet arrives, AWS checks the rules of every security group on that network interface. If any rule allows it, it is let in. There are no deny rules and no rule order.
3. The connection is tracked, so the return traffic is allowed without an outbound rule (stateful).
4. Changing a rule takes effect within seconds for new connections, without a restart.

**Example:** a three-tier app where each tier only trusts the tier in front of it.
```
 alb-sg:  inbound 443  from 0.0.0.0/0     ← anyone may reach the load balancer
 app-sg:  inbound 8000 from alb-sg        ← only the ALB may reach the app
 db-sg:   inbound 5432 from app-sg        ← only app instances may reach the database
```

**What happens, step by step:**
1. A user connects to the ALB on 443. `alb-sg` allows it.
2. The ALB opens a connection to an app task at `10.0.11.20:8000`. The source is the ALB's network interface, which has `alb-sg`, so `app-sg`'s rule matches. Allowed.
3. The app connects to the database on 5432. Its interface has `app-sg`, so `db-sg` allows it.
4. A developer's laptop on the VPN tries `10.0.21.5:5432` directly. Its traffic is not from an interface with `app-sg`, so it is dropped silently, and the client sees a **timeout**, not "refused".
5. When the app scales from 3 to 30 tasks, no rule changes: every new task gets `app-sg` and is allowed automatically. IP-based rules would need constant updates.

**Common mistake → fix:** opening the database to the VPC range (`10.0.0.0/16`) or worse `0.0.0.0/0` "to make it work". Every compromised machine in the VPC can now reach it. Fix: reference the caller's security group as the source.

**Interview answer:** "A security group is a stateful, allow-only firewall attached to network interfaces. Return traffic is automatically allowed, and there are no deny rules. I chain them by reference: the ALB group allows 443 from the internet, the app group allows the app port only from the ALB group, and the database group allows 5432 only from the app group, which keeps working however many instances I add."

**Follow-ups:**
- *Blocked traffic: timeout or refused?* Timeout. A security group drops packets silently. "Connection refused" means you reached the host but nothing listens on the port (see Q57).
- *How many groups per interface?* Five by default, adjustable through Service Quotas.

---

### Q11. Security groups vs network ACLs

**Short answer:** Both filter traffic, at different levels. A **security group** is attached to a network interface, is **stateful** and has allow rules only. A **network ACL** (access control list, NACL) is attached to a **subnet**, is **stateless** (replies must be allowed explicitly) and has numbered **allow and deny** rules evaluated in order. Security groups are your main firewall; NACLs are a coarse extra layer, for example to block an IP range.

**How it works:**

| | Security group | Network ACL |
|---|---|---|
| Attached to | network interface (instance, task, RDS, ALB …) | subnet |
| Stateful? | **yes**: replies allowed automatically | **no**: replies need their own rule |
| Rule types | allow only | allow **and deny** |
| Evaluation | all rules, any match allows | lowest-numbered matching rule wins |
| Can reference other groups? | yes | no, only CIDR ranges |
| Default | deny all inbound, allow all outbound | default NACL allows all both ways |

**Example:** a custom NACL on a public subnet that serves HTTPS.
```
 Inbound                                   Outbound
 100  ALLOW  TCP 443        0.0.0.0/0      100  ALLOW  TCP 1024-65535  0.0.0.0/0   ← replies to clients
  90  DENY   ALL            203.0.113.0/24  *   DENY   ALL
  *   DENY   ALL
```

```flow
sequence: One HTTPS request through a NACL and a security group
actors: Client, NACL (subnet), Security group, Instance
Client -> NACL (subnet): request to port 443 from client port 51514
> Inbound rule 100 allows TCP 443. Rule 90 would have denied it first if the client were in 203.0.113.0/24.
NACL (subnet) -> Security group: passed to the instance's network interface
Security group -> Instance: inbound rule allows 443, and the connection is now tracked
Instance --> Security group: reply leaves; allowed automatically because the group is stateful
Security group --> NACL (subnet): the NACL does not remember the request
NACL (subnet) --> Client: outbound rule must allow TCP 1024-65535, because the reply goes to client port 51514
> Without that outbound ephemeral-port rule, the request gets in but the reply is dropped, and the client sees a timeout.
```

**What happens, step by step:**
1. The client at `198.51.100.7:51514` sends to port 443. The NACL checks inbound rules in number order: rule 90 (deny `203.0.113.0/24`) does not match, rule 100 (allow 443) matches. Passed.
2. The security group allows 443 and records the connection.
3. The reply goes from port 443 to `198.51.100.7:51514`. The security group lets it out (stateful).
4. The NACL is stateless, so it checks outbound rules: rule 100 allows ports 1024–65535. Passed.
5. If the outbound rule were missing, step 4 would hit the final `*` deny and the client would time out.

**Common mistake → fix:** tightening a NACL to "only 443 out" and breaking every reply, because replies go to random high (ephemeral) ports. Fix: allow 1024–65535 for return traffic, or leave NACLs open and use security groups as the main control.

**Interview answer:** "Security groups are stateful, allow-only and attached to network interfaces, and can reference other groups, so they're my primary firewall. NACLs are stateless subnet-level rules with numbered allows and denies, useful for coarse guardrails like blocking a known bad IP range. Because NACLs are stateless, I must allow return traffic on ephemeral ports explicitly."

**Follow-ups:**
- *Which is checked first for inbound traffic?* The NACL (at the subnet edge), then the security group (at the interface).

---

### Q12. How do private resources reach AWS services?

**Short answer:** AWS service APIs (S3, ECR, Secrets Manager, SQS …) have public endpoints, so a private subnet with no internet route cannot reach them. There are two options: send traffic out through a **NAT gateway** to the public endpoints, or add **VPC endpoints** so traffic goes to the service privately, without NAT. Gateway endpoints (S3 and DynamoDB only) are free; interface endpoints (most other services) cost per hour and per GB but remove NAT data charges and let you restrict access with endpoint policies.

**How it works:**

| Path | How it works | Cost | Use when |
|---|---|---|---|
| **NAT gateway** | outbound to the public service endpoint | per hour + per GB | you need the internet anyway, low AWS traffic |
| **Gateway endpoint** (S3, DynamoDB) | a route table entry using the service prefix list | **free** | always, for S3 and DynamoDB from private subnets |
| **Interface endpoint** (PrivateLink) | a network interface with a private IP in your subnet; private DNS points the service name at it | per hour per AZ + per GB | no-internet subnets, high traffic, compliance |

**How to choose:** add the S3 (and DynamoDB, if used) gateway endpoint to every VPC because it is free. Add interface endpoints for services with heavy traffic or when subnets must have no internet path at all. Keep NAT only for genuine internet destinations.

**Example:** an ECS service on Fargate in subnets with **no NAT** needs these endpoints to start:
```
 com.amazonaws.ap-south-1.ecr.api         (interface)  ← image manifest calls
 com.amazonaws.ap-south-1.ecr.dkr         (interface)  ← Docker registry API
 com.amazonaws.ap-south-1.s3              (gateway)    ← ECR stores image layers in S3
 com.amazonaws.ap-south-1.logs            (interface)  ← awslogs log driver
 com.amazonaws.ap-south-1.secretsmanager  (interface)  ← only if the task uses secrets
```

**What happens, step by step (a task pulls its image):**
1. The ECS agent asks `api.ecr.ap-south-1.amazonaws.com` for an auth token. Private DNS on the `ecr.api` endpoint resolves it to `10.0.11.200`, the endpoint's private IP.
2. It fetches the image manifest from the registry through the `ecr.dkr` endpoint.
3. It downloads the layers, which are stored in S3, through the S3 gateway endpoint route.
4. Logs flow to CloudWatch through the `logs` endpoint.
5. If the S3 gateway endpoint were missing, steps 1–2 would succeed but step 3 would hang, and the task would fail with an image pull timeout. This is the most common gap.

**Common mistake → fix:** adding the ECR endpoints but forgetting the S3 gateway endpoint (layers come from S3), or forgetting to allow port 443 inbound on the interface endpoint's security group from the tasks. Fix: the full list above and a security group on the endpoints allowing 443 from the app security group.

**Interview answer:** "Private subnets reach AWS APIs either through NAT to the public endpoints or through VPC endpoints. I always add the free S3 and DynamoDB gateway endpoints and add interface endpoints for services like ECR, CloudWatch Logs and Secrets Manager when traffic is heavy or the subnets must have no internet route. For ECS without NAT, the classic set is ecr.api, ecr.dkr, the S3 gateway endpoint and logs."

**Follow-ups:**
- *Does a gateway endpoint work from on-premises?* No, only from inside the VPC. On-premises access to S3 privately needs an S3 interface endpoint.

---

### Q13. How do interface endpoints (PrivateLink) and endpoint policies work?

**Short answer:** An **interface endpoint** puts a network interface with a private IP into your subnets that acts as a private doorway to an AWS service (or another company's service). With **private DNS** turned on, the normal service hostname, for example `secretsmanager.ap-south-1.amazonaws.com`, resolves to that private IP, so your code needs no changes. An **endpoint policy** is a resource policy on the endpoint that limits what can be done through it, which is a useful data-exfiltration control.

**How it works:**
1. You create the endpoint in one subnet per AZ and attach a security group allowing 443 from your apps.
2. AWS creates private DNS records for the service name inside your VPC.
3. Calls go to the endpoint IP, cross the AWS network via **PrivateLink**, and reach the service. No NAT and no internet.
4. The endpoint policy is evaluated in addition to IAM: both must allow the call.
5. **PrivateLink** also lets you publish your own service (behind a Network Load Balancer) to other VPCs or accounts, even if their IP ranges overlap with yours.

```flow
sequence: A Secrets Manager call through an interface endpoint
actors: Task, VPC DNS, Endpoint ENI, Secrets Manager
Task -> VPC DNS: resolve secretsmanager.ap-south-1.amazonaws.com
VPC DNS --> Task: 10.0.11.200 (the endpoint's private IP, because private DNS is on)
Task -> Endpoint ENI: HTTPS GetSecretValue for prod/db
> The endpoint's security group must allow port 443 from the task's security group.
Endpoint ENI -> Secrets Manager: over PrivateLink, inside the AWS network
> The endpoint policy is checked here as well as the task role's IAM policy.
Secrets Manager --> Task: secret value returned. No NAT and no internet were involved.
```

**Example:** an S3 endpoint policy that only allows access to the organisation's own buckets.
```json
{
  "Statement": [{
    "Effect": "Allow",
    "Principal": "*",
    "Action": ["s3:GetObject", "s3:PutObject"],
    "Resource": "*",
    "Condition": { "StringEquals": { "aws:ResourceOrgID": "o-abc123" } }
  }]
}
```

**What happens, step by step:**
1. An app with a broad role (`s3:*` on `*`) uploads to `acme-reports`, a bucket in the organisation: the endpoint policy condition matches and the upload works.
2. Malware on the same host tries to upload data to `attacker-bucket` in another account. IAM allows it (`s3:*`), but the endpoint policy denies it because the bucket's org ID differs.
3. Because the subnet has no NAT, the S3 endpoint is the only way out, so the exfiltration is blocked.

**Common mistake → fix:** creating an interface endpoint but leaving private DNS off, so the service name still resolves to public IPs and traffic tries to go through a NAT that doesn't exist (timeout). Fix: enable private DNS (and the VPC's DNS support and DNS hostnames settings).

**Interview answer:** "An interface endpoint is a private IP in my subnets that fronts an AWS service through PrivateLink. With private DNS the normal hostname resolves to it, so code is unchanged and no NAT is needed. I attach a security group to it and an endpoint policy, for example allowing S3 access only to buckets in my organisation, which helps stop data exfiltration."

**Follow-ups:**
- *How do you force access through an endpoint?* Add a bucket policy condition `aws:SourceVpce` (or `aws:SourceVpc`) that denies requests not coming through it.

---

### Q14. How do you connect VPCs to each other and to on-premises networks?

**Short answer:** **VPC peering** links two VPCs directly (one to one, not transitive). **Transit Gateway** is a regional hub that many VPCs, VPNs and Direct Connect links attach to, with central route tables. **Site-to-Site VPN** is an encrypted tunnel over the internet to your data centre; **Direct Connect** is a dedicated private line. **PrivateLink** exposes one service instead of a whole network, and **VPC Lattice** connects services across VPCs and accounts with built-in auth.

**How it works:**

| Option | Shape | Transitive? | Overlapping CIDRs? | Use |
|---|---|---|---|---|
| **VPC peering** | 1:1 | no | not allowed | a few VPCs |
| **Transit Gateway** | hub-and-spoke | yes | not allowed | many VPCs + on-premises |
| **Site-to-Site VPN** | tunnel over internet | via TGW | n/a | quick, encrypted on-premises link |
| **Direct Connect** | dedicated line | via gateway | n/a | steady bandwidth, consistent latency |
| **PrivateLink** | consumer → one service | n/a | **allowed** | share one service across accounts |
| **VPC Lattice** | service network | n/a | allowed | service-to-service with IAM auth |

**Example:** VPC A (`10.1.0.0/16`) is peered with B (`10.2.0.0/16`), and B is peered with C (`10.3.0.0/16`).

**What happens, step by step:**
1. A can reach B and B can reach C, once both sides add routes and security groups allow it.
2. A cannot reach C through B. Peering is **not transitive**; you would need a third peering A–C.
3. With 10 VPCs, full peering means 45 connections. A Transit Gateway needs 10 attachments and central route tables.
4. If C had also used `10.1.0.0/16`, no peering or TGW route could connect it to A. Only PrivateLink (one service) would work.

**Common mistake → fix:** a VPN as the only path to on-premises for a critical system. Fix: Direct Connect with a VPN as backup, or two Direct Connect locations.

**Interview answer:** "For a couple of VPCs I use peering, which is one-to-one and non-transitive. For many VPCs and on-premises I use a Transit Gateway as the hub, connected to the data centre with Site-to-Site VPN or Direct Connect. When I only need to share one service, especially across accounts with overlapping CIDRs, PrivateLink is cleaner because it exposes a service, not a network."

**Follow-ups:**
- *Does peering work across Regions and accounts?* Yes, both are supported.

---

### Q15. How do you plan CIDR ranges?

**Short answer:** Give every VPC (in every account and Region, and the office network) a **unique, non-overlapping** range, because overlapping ranges can never be routed to each other. Leave room to grow: a `/16` per VPC and generous subnets (for example `/20` for app subnets), because containers, Lambda functions, load balancers and endpoints all consume IP addresses. Manage the ranges centrally, for example with **VPC IPAM** (IP Address Manager).

**How it works:**
1. Reserve a big block for the organisation, for example `10.0.0.0/8`, and make sure on-premises uses something else.
2. Carve it per Region and account (IPAM pools can do this automatically).
3. Inside each VPC, size subnets by tier and AZ: small public subnets, large private app subnets, medium data subnets.
4. Remember 5 addresses are reserved in each subnet.

**Example:**

| Subnet | AZ a | AZ b | AZ c | Size |
|---|---|---|---|---|
| Public | 10.20.0.0/24 | 10.20.1.0/24 | 10.20.2.0/24 | 251 usable each |
| Private app | 10.20.16.0/20 | 10.20.32.0/20 | 10.20.48.0/20 | 4,091 usable each |
| Private data | 10.20.64.0/22 | 10.20.68.0/22 | 10.20.72.0/22 | 1,019 usable each |

**What happens, step by step (why app subnets are big):**
1. An ECS service runs 300 Fargate tasks across 3 AZs: about 100 per AZ, each using one IP.
2. During a rolling deployment the old and new tasks run side by side, so peak usage is about 200 per AZ.
3. Add Lambda functions in the VPC, interface endpoints and load balancer nodes, and a `/24` (251 usable) would be close to full.
4. A `/20` per AZ (4,091 usable) leaves plenty of headroom for growth and deployments.

**Common mistake → fix:** every team creating `10.0.0.0/16`. Two years later they need to connect, and they cannot. Fix: central allocation (IPAM or at least a shared spreadsheet) from day one.

**Interview answer:** "I allocate non-overlapping ranges for every VPC and on-premises network from a central plan, usually with VPC IPAM, because overlapping ranges can't be peered or routed. Each VPC gets something like a /16, and app subnets are large, around /20 per AZ, because each container task and Lambda ENI uses an address and deployments temporarily double the count."

**Follow-ups:**
- *Ran out anyway?* Add a secondary CIDR to the VPC and create new subnets from it.

---

### Q16. What is an ENI, and why does IP exhaustion happen?

**Short answer:** An **ENI** (elastic network interface) is a virtual network card. It has a private IP address from a subnet, security groups, and optionally a public IP. Every EC2 instance, every ECS task in `awsvpc` mode, every Lambda function attached to a VPC (through shared ENIs), every load balancer node, every RDS instance and every interface endpoint uses at least one. When a subnet has no free addresses left, new resources simply fail to start.

**How it works:**
- An ENI is created in one subnet (so one AZ) and takes one of its free addresses.
- In ECS with `awsvpc` network mode, each task gets its **own** ENI, so each task uses one IP.
- On EC2, instance types limit how many ENIs and IPs an instance can have; **prefix delegation** assigns blocks of `/28` addresses to an ENI so more containers fit per instance.

```flow
trace: A /24 subnet running out of addresses during a deployment
subnet 10.0.11.0/24 → **251** usable addresses > 256 minus the 5 that AWS reserves.
steady state: 180 tasks + 10 other ENIs → **61 free** > Each Fargate task in awsvpc mode holds one ENI with one IP.
deployment starts 180 new tasks before stopping old ones → needs **180**, only 61 free > Rolling deployments run old and new tasks side by side for a while.
**121** tasks fail with "insufficient free addresses" > The deployment stalls even though CPU and memory were fine.
fix: bigger or extra subnets, or a lower maximumPercent > Plan for peak usage during deployments, not the average.
```

**Example:** a service with 180 tasks in one `/24` subnet per AZ and `maximumPercent: 200`.

**What happens, step by step:** shown in the trace above. The key detail is step 3: ECS tries to start a full new set before draining the old one, so address use briefly doubles.

**Common mistake → fix:** sizing subnets from the steady-state count. Fix: size for peak (deployments, scale-out, failover from another AZ), monitor free addresses (the `AvailableIpAddressCount` on the subnet), and spread tasks across several subnets.

**Interview answer:** "An ENI is a virtual network card with an IP from a subnet. Many things create ENIs: EC2 instances, every awsvpc ECS task, VPC Lambda, load balancers, endpoints. In awsvpc mode each task uses an address, and deployments temporarily double that, so small subnets run out and tasks fail to place. I size subnets for peak usage and monitor free addresses."

**Follow-ups:**
- *Does Lambda use one ENI per invocation?* No. VPC Lambda uses shared Hyperplane ENIs per subnet and security group combination, so it uses far fewer IPs than it used to.

---

### Q17. What are VPC Flow Logs, and how do you use them?

**Short answer:** **VPC Flow Logs** record metadata about IP traffic: source and destination address and port, protocol, bytes, and whether it was **ACCEPT**ed or **REJECT**ed by security groups or NACLs. They do not record the content of packets. You turn them on for a VPC, subnet or single ENI and send them to CloudWatch Logs, S3 or Firehose. Use them to debug connection timeouts and for security investigations.

**How it works:**
1. Flow logs are collected in aggregation windows (up to 10 minutes by default, or 1 minute), so they are not instant.
2. Each record describes one flow in that window.
3. `REJECT` means a security group or NACL dropped it. **No record at all** means the packet never reached that ENI (wrong route, wrong DNS, wrong IP).

**Example:** a default-format record.
```
2 111122223333 eni-0a1b2c 10.0.11.20 10.0.21.5 49152 5432 6 12 840 1730000000 1730000060 REJECT OK
```
Fields: version, account, ENI, source IP, destination IP, source port, destination port, protocol (6 = TCP), packets, bytes, start, end, **action**, log status.

**What happens, step by step (debugging "app can't reach the DB"):**
1. Enable flow logs on the database's ENI and reproduce the problem.
2. Search for `10.0.11.20 → 10.0.21.5 port 5432`. The record above shows `REJECT`.
3. REJECT on the destination ENI means the database's security group (or the subnet NACL) is blocking. Checking `db-sg` shows it allows 5432 only from `10.0.12.0/24`, not from the app's security group.
4. Change the rule to "5432 from `app-sg`". The next record shows `ACCEPT` and the app connects.
5. If there had been no record, the packet never arrived: check the route tables and the IP the app resolved.

**Common mistake → fix:** expecting flow logs to show HTTP paths or payloads. They are network metadata only. Fix: for request-level detail, use load balancer access logs or application logs.

**Interview answer:** "VPC Flow Logs capture metadata about each flow: addresses, ports, bytes and ACCEPT or REJECT. I use them when something times out: a REJECT points at a security group or NACL, and no record at all means the traffic never reached that interface, so I look at routing or DNS. They don't contain payloads, so for HTTP-level detail I use access logs."

**Follow-ups:**
- *How do you query them at scale?* Send to S3 and query with Athena, or use CloudWatch Logs Insights.

---

### Q18. How does DNS work inside a VPC?

**Short answer:** Every VPC has a built-in DNS server, the **Route 53 Resolver**, at the VPC's base address plus two (for `10.0.0.0/16`, that is `10.0.0.2`). It answers public names, names in **private hosted zones** you attach to the VPC (for example `db.internal.example`), and the private names of interface endpoints. **Resolver endpoints** and forwarding rules connect it to on-premises DNS in both directions.

**How it works:**
1. An instance asks the resolver for a name.
2. If a private hosted zone associated with the VPC matches the name, its record is returned.
3. If an interface endpoint with private DNS covers the name (for example `sqs.ap-south-1.amazonaws.com`), the endpoint's private IP is returned.
4. If a **forwarding rule** matches (for example `corp.example.com`), the query goes through an outbound resolver endpoint to the on-premises DNS servers.
5. Otherwise the resolver answers from public DNS.

**Example:** `orders-db.internal.example` is an alias in a private hosted zone pointing to the RDS endpoint.

**What happens, step by step:**
1. The app resolves `orders-db.internal.example`. The private hosted zone answers with the RDS hostname, which resolves to `10.0.21.5`.
2. The database fails over to the standby in another AZ. RDS updates its DNS record to the new primary `10.0.22.9`.
3. The app's next lookup (after the short time-to-live, TTL) gets `10.0.22.9`. No config change was needed.
4. If the app had hard-coded `10.0.21.5`, it would keep connecting to the old address and fail.

**Common mistake → fix:** apps or JVMs caching DNS forever, so they never see a failover. Fix: respect DNS TTLs (for Java, set `networkaddress.cache.ttl` to a small value) and always connect by hostname.

**Interview answer:** "Each VPC has the Route 53 Resolver at base plus two. It serves private hosted zones for internal names, the private DNS names of interface endpoints, and public DNS, and with resolver endpoints and forwarding rules it integrates with on-premises DNS. I always connect by hostname and keep DNS caching short so failovers like RDS Multi-AZ are picked up."

**Follow-ups:**
- *Why does an interface endpoint need 'DNS support' and 'DNS hostnames' enabled on the VPC?* Private DNS for endpoints relies on both settings; without them names resolve to public IPs.

---

## 4. IAM & security

### Q19. What is IAM? Users, groups, roles and policies

**Short answer:** **IAM** (Identity and Access Management) is the AWS service that decides **who** can do **what** to **which** resources. Its building blocks are: **users** (a long-lived identity for one person or program), **groups** (a set of users that share permissions), **roles** (an identity anyone trusted can temporarily "put on", with no permanent password or keys), and **policies** (JSON documents that list what is allowed or denied). Modern practice: humans sign in through federation, workloads use roles, and IAM users with long-lived access keys are avoided.

**How it works:**
1. Every API call is made by a **principal** (a user, a role session, or an AWS service).
2. The principal is authenticated (see Q20), then IAM collects every policy that applies.
3. Policies are **attached** to identities (what this identity may do) or to resources (who may use this resource).
4. By default everything is denied. A request succeeds only if some policy allows it and nothing explicitly denies it.

| Identity | Credentials | Use it for |
|---|---|---|
| **IAM user** | password and/or long-lived access keys | rare cases: break-glass access, legacy tools that can't use roles |
| **IAM group** | none (just a container) | attaching the same policies to many users |
| **IAM role** | temporary credentials from STS | applications on AWS, CI/CD pipelines, cross-account access, human federation |
| **Federated identity** | your company login (SAML/OIDC) mapped to a role | all human access |

**Example:** a minimal identity policy attached to the role used by a reporting service.
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:GetObject"],
    "Resource": "arn:aws:s3:::acme-reports/monthly/*"
  }]
}
```

**What happens, step by step:**
1. The reporting service runs on ECS with a task role carrying that policy.
2. It calls `GetObject` on `acme-reports/monthly/2026-09.csv`. The action and resource match the `Allow`: success.
3. It calls `GetObject` on `acme-reports/payroll/2026-09.csv`. Nothing allows that path, so it is **implicitly denied**: `AccessDenied`.
4. It calls `PutObject` on the monthly path. Not listed, so also denied. The service can read reports but never change them.

**Common mistake → fix:** creating an IAM user per application and putting its access keys in environment variables or code. Keys never expire, get copied around and leak. Fix: give the application a role (instance profile, ECS task role, Lambda execution role) so it gets auto-rotating temporary credentials.

**Interview answer:** "IAM controls who can do what in AWS. Principals are users, roles or services; permissions come from JSON policies attached to identities or resources, and everything is denied by default. I avoid IAM users with access keys: people sign in through IAM Identity Center, and workloads use roles that hand out temporary credentials automatically."

**Follow-ups:**
- *Is IAM regional?* No, IAM is global within an account.
- *Managed vs inline policy?* A managed policy is a standalone, reusable policy object (AWS-managed or customer-managed); an inline policy is embedded in one identity and deleted with it. Prefer customer-managed policies.

---

### Q20. Authentication vs authorisation in IAM

**Short answer:** **Authentication** answers "who are you?": AWS checks the request's signature to identify the principal. **Authorisation** answers "are you allowed to do this?": IAM evaluates all relevant policies for that principal, action, resource and request context. Both happen on **every** API call.

**How it works:**
1. **Authenticate:** the SDK signs the request with SigV4 using an access key ID, a secret key and, for temporary credentials, a session token. AWS recomputes the signature; if it doesn't match or the token has expired, the request fails (`InvalidClientTokenId`, `ExpiredToken`, `SignatureDoesNotMatch`).
2. **Build the context:** principal ARN, action (`s3:GetObject`), resource ARN, and condition values such as source IP, time, tags, VPC endpoint, whether MFA was used.
3. **Authorise:** evaluate identity policies, resource policies, guardrails and denies (see Q23).
4. **Decide:** allow, or `AccessDenied` (often with a message saying which policy type denied it).

```flow
sequence: Authentication then authorisation on one call
actors: App (role session), S3 front end, IAM evaluation
App (role session) -> S3 front end: GetObject acme-reports/monthly/2026-09.csv, signed with SigV4
S3 front end -> S3 front end: authenticate: signature valid, session token not expired
> The principal is now known: arn:aws:sts::111122223333:assumed-role/reports-task/abc123.
S3 front end -> IAM evaluation: may this principal do s3:GetObject on this object ARN?
IAM evaluation --> S3 front end: allowed (identity policy allows, nothing denies)
S3 front end --> App (role session): 200 OK with the file
```

**Example:** the same role makes two calls. `GetObject` on `monthly/2026-09.csv` succeeds; `DeleteObject` on it fails with `AccessDenied`.

**What happens, step by step:**
1. Both calls pass authentication: same valid credentials.
2. Authorisation differs: `s3:GetObject` is allowed by the policy, `s3:DeleteObject` is not mentioned anywhere, so it is implicitly denied.
3. The error tells you which half failed: signature/token errors are authentication; `AccessDenied` is authorisation.

**Common mistake → fix:** debugging an `ExpiredToken` error by adding permissions. Expiry is an authentication issue. Fix: let the SDK refresh credentials (use the default credential chain instead of copying keys once at startup).

**Interview answer:** "Authentication proves identity: AWS verifies the SigV4 signature made with the caller's access key and session token. Authorisation then evaluates every relevant policy for that principal, action, resource and context. Both happen on every single API call. Signature or token errors mean an authentication problem; AccessDenied means a policy problem."

**Follow-ups:**
- *Where do I see the decision?* CloudTrail records the call with an `errorCode` such as `AccessDenied`, and the error message often names the policy type that denied it.

---

### Q21. What does an IAM policy look like?

**Short answer:** A policy is a JSON document with one or more **statements**. Each statement has an **Effect** (`Allow` or `Deny`), the **Action**s it covers (`s3:GetObject`), the **Resource** ARNs they apply to, and optional **Conditions** (extra checks like "only over TLS" or "only for this tag"). Resource-based policies also have a **Principal** saying who the statement applies to.

**How it works:**
- `Action` and `Resource` support wildcards (`s3:Get*`, `arn:aws:s3:::acme-docs/*`).
- `Condition` uses operators (`StringEquals`, `IpAddress`, `Bool`, `ArnLike` …) on condition keys (`aws:SourceIp`, `aws:PrincipalTag/team`, `aws:SecureTransport` …). All conditions in a statement must be true.
- `Version` must be `"2012-10-17"`, the current policy language version (it is not a date you update).

**Example:**
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

**What happens, step by step (three requests from a role tagged `team=payments`):**
1. `GetObject` on `acme-docs/tenants/t-42/invoice.pdf` over HTTPS: action, resource and both conditions match → **allowed**.
2. Same object over plain HTTP: `aws:SecureTransport` is `false`, so the statement does not apply → implicit deny.
3. `GetObject` on `acme-docs/tenants/t-43/invoice.pdf`: resource does not match `t-42/*` → implicit deny.
4. A role tagged `team=risk` asking for the `t-42` object: the tag condition fails → implicit deny.

**Common mistake → fix:** granting `s3:ListBucket` on `arn:aws:s3:::acme-docs/*`. Listing is a **bucket** action, so it needs the bucket ARN without `/*`. Fix:
```json
{ "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::acme-docs",
  "Condition": { "StringLike": { "s3:prefix": "tenants/t-42/*" } } }
```

**Interview answer:** "A policy has statements with Effect, Action, Resource and optional Condition, plus Principal in resource-based policies. Wildcards and condition keys like aws:SecureTransport, source VPC endpoint or principal tags let me narrow access. A classic gotcha is bucket-level versus object-level ARNs: ListBucket needs the bucket ARN, GetObject needs bucket/*."

**Follow-ups:**
- *What are NotAction and NotResource?* "Everything except these". Useful in Deny statements (like the Region SCP in Q05) but risky in Allow statements because they grant a lot.

---

### Q22. What is an IAM role?

**Short answer:** An **IAM role** is an identity with permissions but **no permanent credentials**. Someone or something trusted **assumes** it and receives **temporary credentials** that expire automatically. A role has two policies: a **trust policy** (who may assume it) and **permissions policies** (what it may do once assumed). Roles are how EC2 instances, ECS tasks, Lambda functions, CI pipelines, other accounts and federated humans get AWS access.

**How it works:**
1. The trust policy is a resource policy on the role. Its `Principal` names an AWS service (`ecs-tasks.amazonaws.com`), an account, a role, or an identity provider.
2. A trusted principal calls STS (`AssumeRole` and its variants, see Q24). For AWS services this happens behind the scenes.
3. STS returns an access key, a secret key and a session token, valid for 15 minutes up to the role's maximum session duration (1 to 12 hours, default 1 hour).
4. The caller uses those to sign requests. Permissions = the role's permissions policies (optionally narrowed by a session policy).
5. Before expiry, the SDK automatically fetches fresh credentials.

**Example:** a role for ECS tasks of the reporting service.
```json
// Trust policy: only ECS tasks may assume this role
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "ecs-tasks.amazonaws.com" },
    "Action": "sts:AssumeRole",
    "Condition": { "StringEquals": { "aws:SourceAccount": "111122223333" } }
  }]
}
```
The permissions policy is the read-only S3 policy from Q19.

**What happens, step by step:**
1. ECS starts a task whose task definition has `taskRoleArn: arn:aws:iam::111122223333:role/reports-task`.
2. ECS assumes the role on the task's behalf (allowed by the trust policy) and serves the temporary credentials to the container through a local credentials endpoint.
3. boto3 in the container finds them automatically through the default credential chain. No keys in code or environment variables.
4. Around expiry, the SDK refreshes them. If someone copies the credentials out, they stop working within hours.
5. If a developer tries `aws sts assume-role` on this role from a laptop, it fails: the trust policy only trusts the ECS service.

**Common mistake → fix:** a trust policy with `"Principal": {"AWS": "*"}` or a whole account without conditions, so far more principals can assume the role than intended. Fix: trust exactly the service, role ARN or identity provider, and add conditions (`aws:SourceAccount`, `sts:ExternalId`, OIDC `sub` claims).

**Interview answer:** "A role is an identity without long-lived credentials. Its trust policy says who can assume it, its permission policies say what it can do, and assuming it through STS returns temporary credentials that the SDK refreshes automatically. Every workload on AWS gets its own role: instance profiles for EC2, task roles for ECS, execution roles for Lambda, and OIDC-trusted roles for CI pipelines."

**Follow-ups:**
- *What is an instance profile?* The container that attaches a role to an EC2 instance; the instance gets credentials from the instance metadata service.
- *What is a service-linked role?* A role pre-defined by an AWS service (for example for Auto Scaling) that the service uses to act in your account; you can't edit its permissions.

---

### Q23. What policy types exist, and how does IAM evaluate them?

**Short answer:** Several policy types can apply to one request: **identity-based** policies (on the user or role), **resource-based** policies (on the bucket, key, queue …), **permissions boundaries** (a cap on what an identity's policies can grant), **SCPs and RCPs** (organisation-wide caps on accounts and resources), and **session policies** (a cap on one role session). The rule: an **explicit Deny anywhere wins**; every applicable cap must allow the action; then an identity or resource policy must actually grant it; otherwise the default is deny.

**How it works:**

| Policy type | Attached to | Grants access? | Purpose |
|---|---|---|---|
| **Identity-based** | user, group, role | yes | what this principal can do |
| **Resource-based** | S3 bucket, KMS key, SQS queue, Lambda function, role trust policy | yes | who can use this resource, including other accounts |
| **Permissions boundary** | user or role | no, only limits | maximum the identity policies can grant |
| **SCP** (service control policy) | account or OU | no, only limits | maximum for principals in the account |
| **RCP** (resource control policy) | account or OU | no, only limits | maximum for resources in the account |
| **Session policy** | an AssumeRole call | no, only limits | narrow one session |

```flow
pipeline: How IAM evaluates one request (stop at the first decision)
Explicit Deny in any policy? > If any applicable statement says Deny for this action and resource, the answer is DENIED. Deny always wins.
SCPs and RCPs allow it? > Organisation guardrails must allow the action, otherwise DENIED.
Resource policy allows it (same account)? > In the same account, a resource policy that names the principal directly is usually enough to ALLOW.
Identity policy allows it? > If neither the identity policy nor a resource policy allows the action, the result is an implicit DENY.
Permissions boundary and session policy allow it? > If one of these caps exists and does not allow the action, DENIED. Otherwise ALLOWED.
```

**Example:** a developer role has `AdministratorAccess` but also a permissions boundary that only allows `s3:*`, `dynamodb:*` and `logs:*`.

**What happens, step by step:**
1. The developer calls `s3:PutObject`. No deny; SCP allows; boundary allows `s3:*`; identity policy allows everything → **allowed**.
2. The developer calls `iam:CreateUser`. No deny; SCP allows; boundary does **not** include `iam:*` → **denied**, even though the identity policy is administrator. The effective permissions are the **intersection** of identity policy and boundary.
3. A role in another account calls `GetObject` on a bucket here. For **cross-account** access, both the caller's identity policy (in their account) **and** the bucket policy (here) must allow it.

**Common mistake → fix:** believing a permissions boundary or SCP grants access. They only limit. A boundary allowing `s3:*` on a role with no identity policy gives zero access. Fix: always pair caps with real grants.

**Interview answer:** "IAM gathers every applicable policy. An explicit deny anywhere wins. SCPs, RCPs, permissions boundaries and session policies are caps that must all allow the action but never grant anything themselves. Then an identity or resource policy has to allow it; within one account either is enough, cross-account both sides must allow. If nothing allows it, it's an implicit deny."

**Follow-ups:**
- *Why is KMS special?* A KMS key policy must allow access, either directly or by delegating to IAM with the account root principal; identity policies alone are not enough otherwise.

---

### Q24. How do STS AssumeRole and temporary credentials work?

**Short answer:** **STS** (Security Token Service) is the service that hands out temporary credentials. A principal calls `AssumeRole` (or `AssumeRoleWithWebIdentity` for OIDC tokens, `AssumeRoleWithSAML` for SAML), STS checks the role's trust policy, and returns an access key, secret key and session token that expire after 15 minutes to 12 hours (default 1 hour). They are better than long-lived keys: they expire on their own, nothing needs rotating, and CloudTrail shows which session did what.

**How it works:**
1. The caller must be allowed to call `sts:AssumeRole` on the role (by its identity policy), and the role's trust policy must trust the caller. Within one account, the trust policy naming the caller directly is enough.
2. The caller passes a `RoleSessionName` (shows up in CloudTrail), optionally `DurationSeconds` (900 to the role's maximum, up to 43,200), session tags, a session policy and an `ExternalId`.
3. **Role chaining** (using role credentials to assume another role) is limited to a 1-hour session.

```flow
sequence: A CI pipeline deploying without stored AWS keys
actors: CI job, CI identity provider, STS, Deploy role
CI job -> CI identity provider: request an OIDC token for this job
CI identity provider --> CI job: signed JWT with claims such as project=orders and ref=main
CI job -> STS: AssumeRoleWithWebIdentity(deploy role ARN, JWT)
STS -> STS: check the role's trust policy against the token's issuer, audience and sub claim
> Only jobs from the orders project on the main branch match the condition, so feature branches cannot deploy to prod.
STS --> CI job: access key, secret key, session token valid for 1 hour
CI job -> Deploy role: run the deployment with the temporary credentials
> No AWS key is stored in the CI system. CloudTrail shows the session name for every call.
```

**Example:** assuming a role from the CLI.
```bash
aws sts assume-role \
  --role-arn arn:aws:iam::444455556666:role/audit-read \
  --role-session-name asha-audit \
  --duration-seconds 3600
```

**What happens, step by step:**
1. STS checks that the caller in account `111122223333` is allowed `sts:AssumeRole` on that ARN, and that `audit-read`'s trust policy trusts that caller.
2. It returns credentials starting with `ASIA…` (temporary keys), plus a session token and `Expiration` one hour later.
3. Calls made with them appear in CloudTrail as `assumed-role/audit-read/asha-audit`.
4. After one hour every call fails with `ExpiredToken` until the caller assumes the role again (SDK credential providers do this automatically).

**Common mistake → fix:** storing CI/CD secrets as long-lived IAM user keys. Fix: OIDC federation as in the diagram, with trust conditions on the repository and branch claims.

**Interview answer:** "STS issues temporary credentials when a trusted principal assumes a role: AssumeRole for AWS principals, AssumeRoleWithWebIdentity for OIDC such as CI pipelines, AssumeRoleWithSAML for corporate SSO. The trust policy decides who may assume, sessions last 15 minutes to 12 hours, and role chaining is capped at an hour. Because the credentials expire and CloudTrail records the session name, they're far safer than access keys."

**Follow-ups:**
- *Access key prefixes?* `AKIA` is a long-lived user key; `ASIA` is a temporary STS key.

---

### Q25. How do you achieve least privilege in practice?

**Short answer:** **Least privilege** means each identity gets only the permissions it needs for its job, on only the resources it needs, and nothing more. In practice: one role per workload, specific actions and resource ARNs instead of `*`, conditions to narrow further, then use **IAM Access Analyzer** and CloudTrail to find and remove unused permissions, with SCPs and permissions boundaries as an outer fence.

**How it works:**

```flow
cycle: The least-privilege loop
Start narrow > Grant only the actions the workload obviously needs, on its own resource ARNs.
Observe real usage > CloudTrail and IAM Access Analyzer show which actions were actually used over weeks.
Tighten > Remove unused actions, replace wildcards with ARNs, add conditions such as source VPC or tags.
Guard the edges > SCPs and permissions boundaries cap what any policy in the account can ever grant.
exit > Repeat on a schedule, because applications change and permissions drift.
```

**Example:** a document-processing worker before and after.
```json
// Before: works, but can delete any table and read any bucket in the account
{ "Effect": "Allow", "Action": ["s3:*", "dynamodb:*"], "Resource": "*" }

// After
{ "Effect": "Allow", "Action": ["s3:GetObject"], "Resource": "arn:aws:s3:::acme-uploads/incoming/*" },
{ "Effect": "Allow", "Action": ["dynamodb:PutItem", "dynamodb:UpdateItem"],
  "Resource": "arn:aws:dynamodb:ap-south-1:111122223333:table/documents" }
```

**What happens, step by step:**
1. The worker was given the broad policy during development.
2. After four weeks, Access Analyzer's policy generation (based on CloudTrail) shows it only ever called `s3:GetObject` on `acme-uploads/incoming/*` and `PutItem`/`UpdateItem` on `documents`.
3. The policy is replaced with the "after" version and deployed through a pipeline.
4. Later, a bug in a dependency tries to `DeleteTable`. It fails with `AccessDenied` instead of destroying data.

**Common mistake → fix:** one shared "app role" for many services or tools. Compromising any one of them gives access to everything. Fix: separate roles per service or per tool, each scoped to its own resources.

**Interview answer:** "I start narrow with specific actions and ARNs per workload role, add conditions where useful, and then use CloudTrail and IAM Access Analyzer to generate policies from actual usage and flag unused permissions. SCPs and permissions boundaries act as outer guardrails. I review regularly because least privilege drifts as the application changes."

**Follow-ups:**
- *What else does Access Analyzer do?* Finds resources shared outside your account or organisation, validates policies against best practices, and reports unused roles, keys and permissions.

---

### Q26. What are the cross-account access patterns?

**Short answer:** There are two main ways to let a principal in account A use something in account B. **Role assumption:** B creates a role that trusts A, and A's principal assumes it (the most common). **Resource policy:** B's resource (S3 bucket, KMS key, SQS queue) names A's principal directly. In both cases **both sides must allow**: A's identity policy must permit the action, and B's trust or resource policy must permit A.

**How it works:**

| Pattern | B creates | A needs | Caller acts as | Good for |
|---|---|---|---|---|
| **Role assumption** | role with trust policy naming A's role | `sts:AssumeRole` on B's role | B's role (B owns the permissions) | broad or multi-service access |
| **Resource policy** | bucket/key/queue policy naming A's role | permission on B's resource ARN | itself (A's role) | one resource, simple sharing |

Conditions to add: `aws:PrincipalOrgID` (only principals in your organisation), `sts:ExternalId` (third parties; protects against the **confused deputy** problem, where a vendor is tricked into using its access on behalf of another customer), and specific role ARNs instead of the whole account.

**Example:** a reporting role in A (`111122223333`) reads a bucket in B (`444455556666`) via a bucket policy.
```json
{
  "Effect": "Allow",
  "Principal": { "AWS": "arn:aws:iam::111122223333:role/reports-task" },
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::b-shared-data/*"
}
```

**What happens, step by step:**
1. `reports-task` in A calls `GetObject` on `b-shared-data/x.csv`.
2. A's side: its identity policy must allow `s3:GetObject` on `arn:aws:s3:::b-shared-data/*`. If it does not, the call is denied even though B allows it.
3. B's side: the bucket policy names the role, so it allows.
4. If the object is encrypted with a customer-managed KMS key in B, B's **key policy** must also allow `kms:Decrypt` for A's role, and A's identity policy must allow it too. This third check is the usual surprise.

**Common mistake → fix:** a trust policy that trusts the whole account `arn:aws:iam::111122223333:root` with no conditions, meaning any principal in A whose admin grants `sts:AssumeRole` can use it. Fix: trust the specific role ARN and add `aws:PrincipalOrgID` or `sts:ExternalId`.

**Interview answer:** "Cross-account access is either role assumption, where the target account owns a role that trusts the caller, or a resource policy that names the caller directly. Either way both sides must allow: the caller's identity policy and the target's trust or resource policy, plus the KMS key policy if encryption is involved. I trust specific role ARNs and add conditions like PrincipalOrgID or ExternalId."

**Follow-ups:**
- *Who pays and who sees the logs?* With role assumption, calls appear in CloudTrail of the target account as the assumed role, and the source account logs the AssumeRole call.

---

### Q27. What is ABAC (attribute-based access control)?

**Short answer:** **ABAC** grants access by comparing **tags** instead of listing specific resources. A single policy says "you may use a resource if its `project` tag equals your `project` tag". When a new team or project appears, you tag its roles and resources and the same policy works without edits. The traditional alternative, listing ARNs per role, is called RBAC (role-based access control).

**How it works:**
1. Principals carry tags (on the role, or as **session tags** passed at sign-in or AssumeRole).
2. Resources carry tags.
3. The policy uses conditions such as `aws:ResourceTag/project` and `aws:PrincipalTag/project`, with policy variables like `${aws:PrincipalTag/project}`.
4. You must stop people from changing tags themselves, or they could tag their way into anything.

**Example:**
```json
{
  "Effect": "Allow",
  "Action": ["secretsmanager:GetSecretValue"],
  "Resource": "*",
  "Condition": { "StringEquals": { "aws:ResourceTag/project": "${aws:PrincipalTag/project}" } }
}
```

```flow
trace: One ABAC policy, three requests
role tag project=**atlas**, secret tag project=**atlas** → ALLOW > The resource tag equals the principal tag, so the condition is true.
same role, secret tag project=**zeus** → DENY > The tags differ, so nothing allows the call and it is implicitly denied.
new team role tag project=**nova**, secret tag project=**nova** → ALLOW > The new team works with no policy change at all.
user tries to retag the zeus secret as atlas → DENY > A separate statement denies tagging changes, so nobody can tag their way in.
```

**What happens, step by step:** shown in the trace above. The fourth step relies on an extra deny such as "deny `secretsmanager:TagResource` unless you are the platform admin role".

**Common mistake → fix:** using ABAC but allowing `*:TagResource` broadly. Fix: deny tag changes on protected keys (with `aws:TagKeys` conditions) for everyone except an admin role, and require tags at creation (`aws:RequestTag`).

**Interview answer:** "ABAC compares principal tags with resource tags, for example project equals project, so one policy scales to many teams without editing ARNs. Session tags let federated users carry attributes like team or tenant. The critical control is protecting the tags themselves: people must not be able to change the tags that grant access."

**Follow-ups:**
- *Do all services support ABAC?* No. Check the service's "authorization based on tags" support in its IAM documentation.

---

### Q28. What is KMS, and how does envelope encryption work?

**Short answer:** **KMS** (Key Management Service) creates and stores encryption keys and performs cryptographic operations with them; the keys themselves never leave KMS unencrypted. **Envelope encryption** is how large data is encrypted: KMS gives you a **data key**, you encrypt the data locally with that data key, and you store the data key **encrypted by the KMS key** next to the data. To read it, you ask KMS to decrypt the small data key, then decrypt the data locally.

**How it works:**
- A **KMS key** (formerly called a CMK) is used to wrap (encrypt) data keys. Encrypt/Decrypt directly with a KMS key only works for small data (up to 4 KB).
- Access to a key is controlled by its **key policy** plus IAM, and every use is logged in CloudTrail.
- Key types by ownership: **AWS owned** (invisible, used by services for you), **AWS managed** (`aws/s3`, created by a service, rotated yearly, policy not editable), **customer managed** (you control the key policy, rotation and cross-account sharing).
- Automatic rotation for customer managed keys is optional, every 365 days by default with a configurable period; old key material is kept so old data still decrypts.

```flow
sequence: Envelope encryption of one file
actors: App, KMS, S3
App -> KMS: GenerateDataKey with key alias/orders
KMS --> App: plaintext data key + the same data key encrypted under alias/orders
App -> App: encrypt report.pdf locally with the plaintext data key (AES-256), then delete the plaintext key from memory
App -> S3: store the encrypted file together with the encrypted data key
> The encrypted data key is useless without KMS, so it is safe to store next to the data.
App -> KMS: later: Decrypt(encrypted data key)
> KMS checks the key policy and IAM, and logs the call in CloudTrail.
KMS --> App: plaintext data key, used to decrypt report.pdf locally
```

**Example:** S3 does this for you with SSE-KMS.
```bash
aws s3 cp report.pdf s3://acme-reports/ --sse aws:kms --sse-kms-key-id alias/orders
```

**What happens, step by step:**
1. S3 calls `GenerateDataKey` on `alias/orders` on your behalf, encrypts the object with the data key, and stores the encrypted data key in the object's metadata.
2. A reader with `s3:GetObject` but **no** `kms:Decrypt` on that key gets `AccessDenied`. Two permissions are needed.
3. If the key is disabled or scheduled for deletion, every object encrypted with it becomes unreadable. A deleted key means permanently lost data, which is why deletion has a 7–30 day waiting period.
4. **S3 Bucket Keys** reduce cost: S3 uses a bucket-level key to make data keys, cutting KMS requests for busy buckets.

**Common mistake → fix:** granting S3 access cross-account but using the AWS managed `aws/s3` key, whose policy you cannot change, so the other account can never decrypt. Fix: use a customer managed key and allow the other account in its key policy.

**Interview answer:** "KMS holds keys that never leave it in plaintext and controls their use through key policies and IAM, with every call logged. For real data it uses envelope encryption: generate a data key, encrypt locally, store the data key encrypted under the KMS key. Services like S3, EBS and RDS do this transparently. I use customer managed keys when I need control over the policy, rotation or cross-account access."

**Follow-ups:**
- *Why not send the whole file to KMS?* Direct encryption is limited to 4 KB, and sending every byte over the network would be slow and costly.

---

### Q29. How do you store secrets and configuration?

**Short answer:** Never put secrets in code, images or plain environment files. Use **AWS Secrets Manager** for secrets that need rotation (database passwords, API keys), and **SSM Parameter Store** (part of AWS Systems Manager) for configuration and simpler secrets (`SecureString` parameters are encrypted with KMS). Applications read them at start-up or runtime using their IAM role, so access is controlled and logged.

**How it works:**

| | Secrets Manager | Parameter Store |
|---|---|---|
| Built for | secrets | config values and simple secrets |
| Encryption | always KMS | optional (`SecureString`) |
| Automatic rotation | yes (built-in for RDS and others, Lambda for custom) | no |
| Cross-account sharing | yes (resource policy) | advanced tier only |
| Cost | per secret per month + per API call | standard tier free (values up to 4 KB); advanced tier paid (8 KB) |

**How to choose:** a database password or third-party key that should rotate → Secrets Manager. Feature flags, URLs, non-rotating settings → Parameter Store.

**Example:** an ECS task definition injecting both into environment variables at start.
```json
"secrets": [
  { "name": "DB_PASSWORD", "valueFrom": "arn:aws:secretsmanager:ap-south-1:111122223333:secret:prod/orders/db-AbCdEf" },
  { "name": "FEATURE_FLAGS", "valueFrom": "arn:aws:ssm:ap-south-1:111122223333:parameter/orders/flags" }
]
```

**What happens, step by step:**
1. When the task starts, ECS uses the task **execution** role to read the secret and the parameter (it needs `secretsmanager:GetSecretValue`, `ssm:GetParameters` and `kms:Decrypt` if a customer key is used).
2. The values are set as environment variables in the container. The task definition itself only contains ARNs.
3. Secrets Manager rotates the password every 30 days. Running tasks keep the old value until they restart, so the rotation must keep both old and new passwords valid for a while, or the app must re-read the secret on authentication failure.

**Common mistake → fix:** putting `DB_PASSWORD=...` in the plain `environment` section of a task definition or a Dockerfile `ENV`. Anyone who can describe the task definition or pull the image can read it. Fix: `secrets` with ARNs, and least-privilege access to those ARNs.

**Interview answer:** "Secrets never go in code or images. I use Secrets Manager for credentials that need rotation and Parameter Store for configuration and simple encrypted values. Applications get them through their IAM role, either injected at start-up, like ECS secrets, or fetched at runtime with caching. With rotation, I make sure the app handles the change, either by re-reading the secret or by dual-valid credentials during rotation."

**Follow-ups:**
- *How do you avoid calling Secrets Manager on every request?* Cache the value in memory with a TTL (AWS provides caching clients and a Lambda extension).

---

### Q30. Which other security services should you know?

**Short answer:** Know what each one is for, in one sentence. **CloudTrail** records API calls; **GuardDuty** detects threats from logs; **Security Hub** gathers findings in one place; **AWS Config** records resource configuration over time and checks rules; **Inspector** scans for software vulnerabilities; **Macie** finds sensitive data in S3; **WAF** and **Shield** protect web apps from attacks and DDoS; **IAM Access Analyzer** finds external and unused access.

**How it works:**

| Need | Service | Example finding |
|---|---|---|
| Who did what? | **CloudTrail** | `DeleteBucket` by `assumed-role/ops/asha` at 10:02 |
| Is something malicious happening? | **GuardDuty** | instance talking to a known crypto-mining server |
| What changed in config, is it compliant? | **AWS Config** | security group opened 22 to `0.0.0.0/0` |
| Are my images or hosts vulnerable? | **Inspector** | critical CVE in an ECR image |
| Where is personal data? | **Macie** | credit card numbers in a bucket |
| One dashboard for all findings | **Security Hub** | aggregated and prioritised findings |
| Web attacks, DDoS | **WAF**, **Shield** | SQL injection blocked at the ALB |
| Unintended sharing, unused access | **IAM Access Analyzer** | bucket readable by another account |

**Example:** a detection-and-response chain.

**What happens, step by step:**
1. A developer's leaked temporary credentials are used from an unusual country.
2. GuardDuty raises a finding about anomalous API use and sends it to Security Hub and EventBridge.
3. An EventBridge rule triggers automation that revokes the role's sessions and notifies the security team.
4. CloudTrail shows exactly which calls the attacker made, so the team can assess the impact.

**Common mistake → fix:** enabling these services in one account only. Fix: enable them organisation-wide with a delegated administrator in the security account.

**Interview answer:** "CloudTrail for API audit, Config for configuration history and rules, GuardDuty for threat detection, Inspector for vulnerabilities, Macie for sensitive data in S3, Security Hub to aggregate findings, WAF and Shield at the edge, and Access Analyzer for unintended or unused access. I enable them across the whole organisation and route findings through EventBridge to automation and alerts."

**Follow-ups:**
- *Config vs CloudTrail?* CloudTrail records the API call; Config records the resulting state of the resource over time.

---

### Q31. How do you apply defence in depth to a sensitive internal application?

**Short answer:** **Defence in depth** means several independent layers of protection, so one failure does not expose everything. For an internal application handling sensitive data, put controls at each layer: **identity** (SSO, MFA, short-lived roles, least privilege), **network** (private subnets, security group chaining, endpoints, no public databases), **data** (KMS encryption, TLS, backups), **application** (input validation, per-resource authorisation), and **detection and response** (CloudTrail, GuardDuty, alarms, runbooks).

**How it works:**

| Layer | Controls |
|---|---|
| Edge | CloudFront or ALB with WAF, TLS only, Shield |
| Identity | Identity Center with MFA, temporary credentials, least-privilege roles, SCP guardrails |
| Network | private subnets, security groups referencing security groups, VPC endpoints with policies, no public IPs |
| Data | KMS customer managed keys, TLS in transit, Macie, AWS Backup, S3 Object Lock where required |
| Application | authentication at the ALB or app, authorisation per record, secrets from Secrets Manager, dependency scanning |
| Detect and respond | organisation CloudTrail, GuardDuty, Security Hub, Config rules, alarms with runbooks |

**Example:** an attacker steals an employee's laptop session cookie for the app.

**What happens, step by step:**
1. **Edge:** the request comes from an unusual location; WAF rate rules and geo rules may block or challenge it.
2. **Application:** even if it gets through, the app checks that the user may see each record, so the attacker sees only that user's data, not everything.
3. **Network:** the attacker cannot reach the database directly; it has no public address and only accepts the app's security group.
4. **Data:** a database snapshot copied out is encrypted with a KMS key the attacker cannot use.
5. **Detection:** unusual access patterns trigger alarms, and CloudTrail plus app logs show what was accessed.

**Common mistake → fix:** relying on "it's internal, only reachable on the VPN" as the only control. One compromised VPN laptop then has full access. Fix: authenticate and authorise every request as if it came from the internet (a zero-trust mindset).

**Interview answer:** "I layer independent controls: WAF and TLS at the edge; SSO with MFA and least-privilege roles for identity; private subnets, security group chaining and endpoint policies for the network; KMS encryption, TLS and backups for data; per-request authorisation in the app; and CloudTrail, GuardDuty and alarms with runbooks for detection and response. The point is that no single failure exposes the data."

**Follow-ups:**
- *How do you prove it works?* Config rules and Security Hub standards for continuous checks, plus regular penetration tests and game days.

---

## 5. Load balancing, DNS, edge

### Q32. What is a load balancer, and what are listeners, target groups and health checks?

**Short answer:** A **load balancer** is a managed front door that receives client connections and spreads them across several backend servers, so no single server is overloaded and broken servers are skipped. In AWS's Elastic Load Balancing, a **listener** waits on a port and protocol (for example HTTPS 443), **rules** on the listener decide where each request goes, a **target group** is the set of backends (instances, IP addresses or Lambda functions), and **health checks** regularly test each target so only healthy ones get traffic.

**How it works:**
1. The load balancer has a DNS name (for example `orders-alb-123.ap-south-1.elb.amazonaws.com`) that resolves to nodes in each AZ you enabled.
2. A listener on 443 terminates TLS using an ACM certificate.
3. Listener rules match on path, host name, headers and so on, then forward to a target group.
4. The target group health-checks every target (for an ALB the defaults are: every 30 s, 5 s timeout, 5 successes to become healthy, 2 failures to become unhealthy, expecting HTTP 200).
5. Requests go only to healthy targets. When a target is removed, **deregistration delay** (default 300 s) lets in-flight requests finish before it stops receiving traffic.

```flow
sequence: One request through listener, rule and target group
actors: Client, Listener HTTPS 443, Rule, Target group orders-tg, Task 10.0.11.20
Client -> Listener HTTPS 443: GET /api/orders/42 (TLS terminated with the ACM certificate)
Listener HTTPS 443 -> Rule: does the path match /api/*?
Rule --> Listener HTTPS 443: yes, forward to orders-tg
Listener HTTPS 443 -> Target group orders-tg: pick a healthy target
> Targets that failed 2 health checks in a row on /healthz are skipped.
Target group orders-tg -> Task 10.0.11.20: request forwarded to port 8000
Task 10.0.11.20 --> Client: 200 OK with the order JSON, through the load balancer
```

**Example:**
```bash
aws elbv2 create-target-group --name orders-tg --protocol HTTP --port 8000 \
  --vpc-id vpc-0abc --target-type ip --health-check-path /healthz
aws elbv2 create-listener --load-balancer-arn <alb-arn> --protocol HTTPS --port 443 \
  --certificates CertificateArn=<acm-arn> \
  --default-actions Type=forward,TargetGroupArn=<orders-tg-arn>
```

**What happens, step by step (a target goes bad):**
1. Three tasks are healthy and share traffic.
2. Task `10.0.11.20` runs out of memory and `/healthz` starts timing out.
3. After 2 failed checks (about 60 s with a 30 s interval) it is marked unhealthy and receives no new requests.
4. ECS (or the Auto Scaling group) sees the unhealthy target and replaces it.
5. The new task must pass 5 consecutive checks (about 2.5 minutes at defaults) before it gets traffic. Lowering the interval or threshold makes this faster.

**Common mistake → fix:** a health check path that calls the database and every dependency. When the database has a short blip, **all** targets fail health checks at once and get replaced, turning a small problem into a full outage. Fix: keep the load balancer health check shallow ("is this process able to serve?") and monitor dependencies separately.

**Interview answer:** "A load balancer spreads traffic across healthy backends. Listeners accept connections on a port and protocol, rules route requests to target groups, and target groups health-check their members so traffic only goes to healthy ones. Deregistration delay drains in-flight requests when a target leaves. I keep health checks shallow so a dependency blip doesn't take every target out at once."

**Follow-ups:**
- *What is cross-zone load balancing?* Each load balancer node spreads traffic across targets in all AZs, not just its own. It is on by default for ALB.

---

### Q33. ALB vs NLB vs Gateway Load Balancer

**Short answer:** The **Application Load Balancer** (ALB) works at layer 7 (HTTP): it understands URLs, headers and cookies and can route by path or host. The **Network Load Balancer** (NLB) works at layer 4 (TCP/UDP): it forwards connections without reading them, gives static IPs and handles extreme throughput with very low latency. The **Gateway Load Balancer** (GWLB) sends traffic transparently through third-party security appliances such as firewalls.

**How it works:**

| | **ALB** (layer 7) | **NLB** (layer 4) | **GWLB** |
|---|---|---|---|
| Protocols | HTTP/1.1, HTTP/2, gRPC, WebSocket | TCP, UDP, TLS | all IP traffic (GENEVE encapsulation) |
| Routing | path, host, header, query, method rules | by port | to appliance fleet |
| Features | TLS termination, OIDC/Cognito auth, WAF, sticky sessions, redirects | static or Elastic IPs per AZ, preserves client IP, PrivateLink services | inline inspection |
| Security groups | yes | yes (optional) | n/a |
| Typical use | web apps, REST APIs, microservices | non-HTTP protocols, fixed IPs for allowlists, PrivateLink | firewalls, intrusion detection |

**How to choose:** HTTP(S) traffic → ALB. Needs fixed IP addresses, non-HTTP protocols, millions of connections or to be exposed through PrivateLink → NLB. Inserting a firewall appliance fleet → GWLB.

**Example:** one company, three load balancers. The customer website and API sit behind an ALB with path rules (`/api/*` → API service, `/*` → web service). A partner integration that requires fixed IPs for the partner's firewall allowlist uses an NLB with one Elastic IP per AZ. A central inspection VPC routes all internet-bound traffic through firewall appliances behind a GWLB.

**What happens, step by step (why the partner can't use the ALB):**
1. The partner's firewall only allows outbound connections to a fixed list of IPs.
2. ALB IP addresses change as AWS scales its nodes, so they cannot be allowlisted.
3. An NLB keeps one static IP per AZ (optionally your own Elastic IPs). The partner allowlists those 3 addresses.
4. If HTTP routing is still needed, the NLB can forward to an ALB as its target.

**Common mistake → fix:** using an NLB for a web app and then needing path routing, authentication or WAF. Fix: choose ALB for HTTP; put an NLB in front only when static IPs or PrivateLink are needed.

**Interview answer:** "ALB is layer 7: it reads HTTP and routes by path, host or header, terminates TLS, supports WebSockets and gRPC, and integrates with WAF and OIDC auth. NLB is layer 4: TCP and UDP pass-through with static IPs, client IP preservation, very high throughput, and it's the front for PrivateLink services. GWLB is for inserting firewall appliances transparently. For a normal web API I use an ALB."

**Follow-ups:**
- *What is the ALB idle timeout?* 60 seconds by default, adjustable from 1 to 4,000 seconds. Streaming or long requests need either a longer timeout or regular data on the connection.

---

### Q34. API Gateway vs ALB

**Short answer:** **API Gateway** is a managed API front door charged **per request**, with built-in authentication, throttling, API keys, usage plans and request validation; it is the natural partner for Lambda. An **ALB** is charged per hour plus capacity units, has no request-management features of its own, but supports long-running requests and steady high traffic cheaply; it is the natural partner for containers and EC2. The biggest practical difference is the **integration timeout**: API Gateway defaults to a 29-second maximum.

**How it works:**

| | API Gateway (REST / HTTP API) | ALB |
|---|---|---|
| Pricing | per request (plus data) | per hour + LCU (load balancer capacity unit) |
| Built-in features | authorizers (JWT, Cognito, IAM, Lambda), throttling, usage plans, API keys, request validation, caching (REST) | path/host routing, OIDC auth, WAF |
| Timeout | REST: 50 ms–29 s by default; can be raised above 29 s for Regional and private REST APIs (may reduce your account throttle quota). HTTP APIs: up to 30 s | idle timeout 60 s default, up to 4,000 s |
| Payload | 10 MB | no small fixed limit |
| Account throttle | 10,000 requests per second per Region by default (burst 5,000) | scales with LCUs |
| Best for | Lambda APIs, public APIs needing keys and quotas, spiky traffic | containers/EC2, streaming, long requests, high steady traffic |

**How to choose:** serverless backend or need API products (keys, quotas, per-client throttles) → API Gateway. Container backend, long or streaming responses, or high constant traffic where per-request pricing gets expensive → ALB.

**Example:** a report endpoint that takes about 45 seconds to generate.

**What happens, step by step:**
1. Behind a REST API with default settings, API Gateway gives up at 29 s and returns `504 Gateway Timeout`, even though the backend finishes at 45 s.
2. Options: raise the integration timeout for a Regional REST API (accepting a possible throttle reduction), or move to an ALB with an idle timeout above 45 s, or, best, make the endpoint asynchronous: return `202 Accepted` with a job ID, process in the background, and let the client poll or receive a notification.
3. At 50 million requests a month of steady traffic, compare the per-request API Gateway bill with an ALB's hourly plus LCU cost; the ALB is often cheaper at high constant volume (illustrative; check current pricing).

**Common mistake → fix:** building long, synchronous operations behind API Gateway and fighting the timeout. Fix: asynchronous job pattern, or an ALB for genuinely long-lived connections such as server-sent events.

**Interview answer:** "API Gateway is per-request and brings auth, throttling, usage plans and validation, which is ideal for Lambda and public APIs, but integrations default to a 29-second limit and payloads cap at 10 MB. An ALB is per-hour and suits containers, long or streaming connections and high steady traffic. For slow operations I prefer an async pattern with a job ID regardless of the front door."

**Follow-ups:**
- *REST API vs HTTP API?* HTTP APIs are cheaper and simpler (JWT auth, Lambda/HTTP integrations); REST APIs have more features (usage plans, API keys, request validation, caching, WAF).

---

### Q35. How do Route 53, TLS and ACM certificates fit together?

**Short answer:** **Route 53** is AWS's DNS service: it hosts your domain's records and can route users by weight, latency, geography or health. **ACM** (AWS Certificate Manager) issues free public TLS certificates that renew automatically and attaches them to load balancers, CloudFront and API Gateway. An **alias record** points a name (even the bare domain, `example.com`) at an AWS resource like an ALB or CloudFront at no query cost. Certificates for CloudFront must be created in `us-east-1`.

**How it works:**
1. You request a certificate for `app.example.com` in ACM and prove ownership with **DNS validation** (ACM gives you a CNAME record to add; with Route 53 one click does it).
2. ACM renews automatically as long as that validation record stays in place.
3. You attach the certificate to the ALB listener (certificate in the ALB's own Region) or CloudFront (certificate in `us-east-1`, because CloudFront is a global service configured from there).
4. You create an alias record `app.example.com → d111.cloudfront.net` (or the ALB).

Routing policies:

| Policy | Use |
|---|---|
| Simple | one answer |
| Weighted | 90 % to v1, 10 % to v2 |
| Latency | send users to the lowest-latency Region |
| Failover | primary plus secondary with health checks |
| Geolocation / geoproximity | by user location |

```flow
pipeline: What has to exist for https://app.example.com to work
Route 53 hosted zone for example.com > Holds the records. The domain's name servers must point at this zone.
ACM certificate for app.example.com in us-east-1 > Validated through a DNS CNAME record and renewed automatically while that record exists.
CloudFront distribution using that certificate > Terminates TLS at the edge and forwards /api/* to the ALB.
Second ACM certificate in ap-south-1 on the ALB > Each Regional resource needs a certificate in its own Region.
Alias record app.example.com pointing at CloudFront > Users resolve the name, connect over HTTPS, and the certificate matches the name.
```

**Example:** a failover record pair: `api.example.com` primary → ALB in `ap-south-1` with a health check; secondary → ALB in `ap-southeast-1`.

**What happens, step by step:**
1. Route 53 health checkers call `https://api.example.com/healthz` on the primary every 30 s.
2. The primary Region fails; 3 consecutive checks fail (default threshold).
3. Route 53 starts answering DNS queries with the secondary ALB.
4. Clients switch as their cached DNS answers expire (the record's TTL, for example 60 s). Clients that cache DNS longer keep failing until they re-resolve.

**Common mistake → fix:** creating the CloudFront certificate in the application's Region; it simply does not appear in the CloudFront console. Fix: request it in `us-east-1`.

**Interview answer:** "Route 53 hosts DNS and routes by weight, latency, geography or failover with health checks; alias records point names, including the zone apex, at ALBs or CloudFront for free. ACM issues free, auto-renewing certificates via DNS validation. A certificate must live in the same Region as the load balancer, and in us-east-1 for CloudFront."

**Follow-ups:**
- *Alias vs CNAME?* A CNAME cannot be used at the zone apex and costs per query; an alias can, and queries to AWS targets are free.

---

### Q36. What does CloudFront do?

**Short answer:** **CloudFront** is AWS's CDN (content delivery network): a global network of edge locations that cache your content close to users and forward the rest to your **origin** (S3, an ALB, any HTTP server). It reduces latency and origin load, terminates TLS at the edge, supports HTTP/2 and HTTP/3, integrates with WAF and Shield, and can keep S3 buckets private using **origin access control** (OAC).

**How it works:**
1. A distribution has one or more **origins** and **cache behaviours** matched by path (`/api/*` → ALB, default `*` → S3).
2. Each behaviour has a **cache policy** (what forms the cache key and how long to cache) and an **origin request policy** (what to forward).
3. On a **miss**, the edge fetches from the origin and caches according to `Cache-Control` and the policy. On a **hit**, it answers directly.
4. OAC lets CloudFront sign requests to a private S3 bucket so the bucket never needs to be public.

```flow
sequence: A cache miss followed by a cache hit
actors: User A, User B, Edge location Mumbai, Origin S3
User A -> Edge location Mumbai: GET /assets/app-a1b2.js
Edge location Mumbai -> Origin S3: MISS, fetch the file (signed with origin access control)
Origin S3 --> Edge location Mumbai: file with Cache-Control max-age=31536000
Edge location Mumbai --> User A: file delivered and now cached at this edge
User B -> Edge location Mumbai: same URL a minute later
Edge location Mumbai --> User B: HIT, served from the edge without touching S3
> The file name contains a content hash, so a new build gets a new name and the long cache time is safe.
```

**Example:** a single-page web app in S3 plus an API on an ALB behind one distribution: `/assets/*` cached for a year (hashed file names), `index.html` cached for 60 s, `/api/*` not cached and all headers and cookies forwarded.

**What happens, step by step (a deployment):**
1. The new build uploads `app-c3d4.js` and a new `index.html` that references it.
2. Users with the cached old `index.html` keep loading `app-a1b2.js`, which still exists, so nothing breaks.
3. Within 60 s the old `index.html` expires at the edges; users get the new one and load `app-c3d4.js`.
4. No invalidation is needed. Invalidations are for emergencies, not every deployment.

**Common mistake → fix:** caching API responses that depend on the user's login because the cache key ignores the `Authorization` header or cookie. One user's data is then served to others. Fix: disable caching for personalised paths (`CachingDisabled` policy) or include the right values in the cache key.

**Interview answer:** "CloudFront caches content at edge locations close to users and forwards misses to origins like S3 or an ALB. I set path-based behaviours: long caching for hashed static assets, short for index.html, none for personalised API calls. I keep S3 buckets private with origin access control and attach WAF at the distribution."

**Follow-ups:**
- *Signed URLs vs signed cookies?* Signed URLs protect one file; signed cookies cover many files, for example a whole video stream.

---

### Q37. What is AWS WAF?

**Short answer:** **AWS WAF** (web application firewall) inspects HTTP requests before they reach your app and blocks, allows, counts or challenges them based on rules. It attaches to CloudFront, ALB, API Gateway and some other services. Typical rules: AWS **managed rule groups** (common exploits like SQL injection and cross-site scripting, known bad inputs, bots), **rate-based** rules (limit requests per IP), IP allow/deny lists and geo rules.

**How it works:**
1. You create a **web ACL** (a list of rules) and associate it with the resource.
2. Rules are evaluated in **priority order**. The first rule with a terminating action (allow, block, CAPTCHA/challenge) decides; `count` only records a match.
3. If no rule decides, the web ACL's default action applies.
4. Logs (to CloudWatch Logs, S3 or Firehose) show which rule matched each request.

**Example:** a web ACL on an ALB.
```
 Priority 0  AWSManagedRulesCommonRuleSet      → Block
 Priority 1  AWSManagedRulesKnownBadInputsRuleSet → Block
 Priority 2  RateLimit: 1,000 requests per 5 minutes per IP → Block
 Default action: Allow
```

**What happens, step by step:**
1. A request with `?id=1' OR '1'='1` arrives. The common rule set matches its SQL injection pattern → blocked with 403. The app never sees it.
2. A scraper sends 3,000 requests in 5 minutes from one IP. After it passes 1,000 in the window, the rate-based rule blocks it until its rate drops.
3. A normal request matches no rule → default allow.

**Common mistake → fix:** enabling managed rule groups straight in block mode; some rules (for example body size limits) block legitimate uploads. Fix: start in **count** mode, review logs for false positives, add exclusions, then switch to block.

**Interview answer:** "WAF is a layer 7 firewall attached to CloudFront, ALB or API Gateway. A web ACL evaluates rules in priority order: managed rule groups for common exploits and bad bots, rate-based rules per IP, IP and geo lists. I roll new rules out in count mode, check the logs for false positives, then switch them to block."

**Follow-ups:**
- *WAF vs Shield?* WAF filters application requests; Shield protects against network-level DDoS (Standard is automatic and free, Advanced adds response team support and cost protection).

---

## 6. Storage & databases (essentials)

### Q38. What is S3?

**Short answer:** **S3** (Simple Storage Service) is object storage: you store files ("objects") in containers called **buckets** and fetch them over an HTTPS API by their **key** (their full name, like `invoices/2026/10/inv-881.pdf`). It holds virtually unlimited data, single objects up to about 50 TB, and is designed for 99.999999999 % ("eleven nines") durability. It is not a disk you mount and not a database; you read and write whole objects.

**How it works:**
- **Bucket names** are globally unique (`acme-invoices-prod`). A bucket lives in one Region.
- There are no real folders: `invoices/2026/10/` is just a **prefix** of the key. Consoles display prefixes as folders.
- Data is stored redundantly across multiple AZs (except One Zone classes).
- Reads after writes are **strongly consistent**: after a successful `PutObject`, the next `GetObject` or `List` sees it.
- Objects are private by default. New buckets have **Block Public Access** on, ACLs disabled and default encryption (SSE-S3) on.
- Uploads of large files use **multipart upload** (parts up to 5 GiB, up to 10,000 parts).

**Example:**
```bash
aws s3 cp inv-881.pdf s3://acme-invoices-prod/invoices/2026/10/inv-881.pdf
aws s3 ls s3://acme-invoices-prod/invoices/2026/10/
```
```python
url = boto3.client("s3").generate_presigned_url(
    "get_object",
    Params={"Bucket": "acme-invoices-prod", "Key": "invoices/2026/10/inv-881.pdf"},
    ExpiresIn=300)
```

**What happens, step by step:**
1. `cp` sends `PutObject` for key `invoices/2026/10/inv-881.pdf`. S3 encrypts it with SSE-S3, stores it across AZs and returns an ETag.
2. `ls` lists keys starting with that prefix; the new file appears immediately (strong consistency).
3. The Python code creates a **presigned URL**: a link signed with the role's credentials, valid for 300 seconds. A browser can download the file with it without any AWS credentials.
4. After 5 minutes the link returns `AccessDenied` (expired). It also stops working early if the signing role's temporary credentials expire first.

**Common mistake → fix:** treating S3 like a file system, for example appending to a log file by downloading, changing and re-uploading it from several writers at once; writes overwrite each other. Fix: write new objects (one per event or batch) or use a real file system (EFS) or database.

**Interview answer:** "S3 is object storage: buckets hold objects addressed by key, accessed over an HTTPS API, with eleven nines of durability, strong read-after-write consistency and objects up to about 50 TB. Buckets are private and encrypted by default. I use presigned URLs to let browsers upload or download directly without passing data through my servers."

**Follow-ups:**
- *Is S3 regional or global?* Bucket names are global, but each bucket and its data live in one Region.

---

### Q39. How do you protect and manage data in S3?

**Short answer:** Combine **access controls** (Block Public Access, bucket policies, IAM, ownership enforced with ACLs disabled), **encryption** (SSE-S3 by default, SSE-KMS for control and audit), **recovery** (versioning, replication, Object Lock for write-once retention), and **cost management** (storage classes and lifecycle rules that move or delete data as it ages).

**How it works:**

| Concern | Feature | What it does |
|---|---|---|
| Never public | Block Public Access | overrides any policy or ACL that would make data public |
| Who can access | bucket policy + IAM | e.g. only one role, only through a VPC endpoint, only over TLS |
| Encryption | SSE-S3 (default) / SSE-KMS | at rest; KMS adds key policies and CloudTrail records per use |
| Accidental delete | Versioning | a delete adds a "delete marker"; old versions stay recoverable |
| Ransomware/compliance | Object Lock | write once, read many (WORM) for a retention period |
| Disaster recovery | Replication (same or cross Region) | copies new objects to another bucket |
| Cost | Storage classes + Lifecycle | move to cheaper classes, expire old data |

Storage classes, from hot to cold: **Standard** → **Intelligent-Tiering** (moves objects automatically by access) → **Standard-IA** (infrequent access, 30-day minimum) → **Glacier Instant Retrieval** → **Glacier Flexible Retrieval** (minutes to hours to restore) → **Glacier Deep Archive** (cheapest, hours to restore). **Express One Zone** is a high-performance single-AZ class.

**Example:** a lifecycle rule for logs.
```json
{
  "Rules": [{
    "ID": "logs-tiering",
    "Filter": { "Prefix": "logs/" },
    "Status": "Enabled",
    "Transitions": [
      { "Days": 30,  "StorageClass": "STANDARD_IA" },
      { "Days": 90,  "StorageClass": "GLACIER" }
    ],
    "Expiration": { "Days": 365 },
    "NoncurrentVersionExpiration": { "NoncurrentDays": 30 }
  }]
}
```

**What happens, step by step (one log file written on 1 January):**
1. Days 0–29: Standard, frequently read for debugging.
2. Day 30: moved to Standard-IA, lower storage price, but a retrieval fee per GB.
3. Day 90: moved to Glacier Flexible Retrieval; reading it now requires a restore that takes minutes to hours.
4. Day 365: deleted. With versioning on, the delete creates a delete marker, and the hidden old version is removed 30 days later by the noncurrent rule.

**Common mistake → fix:** turning on versioning without a noncurrent-version expiration rule. Every overwrite keeps the old copy forever and storage cost grows silently. Fix: always pair versioning with noncurrent-version lifecycle rules.

**Interview answer:** "I keep Block Public Access on, control access with bucket policies and IAM, often requiring TLS and a VPC endpoint, and use SSE-KMS where I need key control and audit. Versioning plus Object Lock protects against deletes and ransomware, replication covers DR, and lifecycle rules move data through storage classes and expire it, including old versions."

**Follow-ups:**
- *How do you let users upload directly from the browser?* Generate a presigned PUT URL (or presigned POST with size and type conditions) from the backend.

---

### Q40. Which database should you choose?

**Short answer:** Pick by data shape and access pattern. **Relational** data with joins and transactions → **RDS** or **Aurora** (managed PostgreSQL/MySQL). **Key-value** access at any scale with single-digit millisecond latency → **DynamoDB**. **Caching**, sessions and rate limits → **ElastiCache** (Valkey/Redis or Memcached). **Search** → **OpenSearch**. **Analytics** over large data → **Redshift** or **Athena** on S3.

**How it works:**

| Need | Service | Key traits |
|---|---|---|
| Transactions, joins, SQL | RDS / Aurora | Multi-AZ standby, read replicas, you size instances (or Aurora Serverless v2) |
| Known access patterns, huge scale | DynamoDB | partition key design, on-demand or provisioned capacity, conditional writes, TTL, Streams |
| Microsecond reads, ephemeral data | ElastiCache / MemoryDB | in-memory; MemoryDB is durable |
| Full-text and vector search | OpenSearch | indexes, relevance ranking |
| Vectors at low cost | S3 Vectors, Aurora PostgreSQL with pgvector | embeddings storage and similarity search |
| Analytics | Redshift, Athena | columnar scans over lots of data |

**How to choose:** if you don't yet know your query patterns or need ad-hoc queries and joins, start relational. If you know exactly how you'll read the data (by user ID, by order ID) and need predictable performance at any scale, DynamoDB.

**Example:** an order system uses Aurora PostgreSQL for orders and payments (transactions across tables), DynamoDB for per-user shopping carts (simple key lookups, huge scale), and ElastiCache for session tokens and rate limiting.

**What happens, step by step (Aurora Multi-AZ failover):**
1. The writer instance fails.
2. Aurora promotes a replica in another AZ, typically within a minute or so.
3. The cluster endpoint DNS name now points to the new writer.
4. Apps that reconnect by hostname with a short DNS cache recover automatically; those caching the old IP keep failing (see Q18).

**Common mistake → fix:** choosing DynamoDB for an app that needs flexible reporting queries, then scanning whole tables. Fix: relational for ad-hoc queries, or export DynamoDB data to S3 and query with Athena.

**Interview answer:** "I choose by access pattern: Aurora or RDS for relational and transactional data, DynamoDB for known key-based access at scale, ElastiCache for caching and sessions, OpenSearch for search, Redshift or Athena for analytics. If query patterns are unclear or need joins I start relational; if they're known and scale is huge, DynamoDB. (The Databases course covers SQL, indexing and DynamoDB key design in depth.)"

**Follow-ups:**
- *RDS Multi-AZ vs read replica?* Multi-AZ is a standby for availability (not readable in the classic setup); read replicas are for scaling reads and are asynchronous.

---

### Q41. EBS vs EFS vs S3

**Short answer:** **EBS** (Elastic Block Store) is a virtual hard disk attached to one EC2 instance in one AZ. **EFS** (Elastic File System) is a shared network file system (NFS) that many instances, containers and Lambda functions in many AZs can mount at once. **S3** is object storage accessed through an API, not mounted as a normal disk. Choose by how the data is accessed.

**How it works:**

| | EBS | EFS | S3 |
|---|---|---|---|
| Type | block device (a disk) | shared file system (NFS) | objects via HTTPS API |
| Attached to | one instance (Multi-Attach only for special io2 cases) | many clients at once | anything with credentials |
| Scope | one AZ | Region (multi-AZ) | Region |
| Size | you provision it (maximum depends on volume type) | grows automatically | unlimited |
| Good for | OS disk, databases on EC2 | shared content, home dirs, containers needing shared files | backups, data lakes, static files, uploads |
| Backup | snapshots (stored in S3) | AWS Backup | versioning, replication |

**How to choose:** one server needs a fast disk → EBS. Many servers need the same files with normal file operations → EFS. Anything else, especially large or long-lived data → S3.

**Example:** a web app with 4 instances needs user-uploaded images. Storing them on each instance's EBS volume means an image uploaded to instance 1 is missing on instances 2–4.

**What happens, step by step:**
1. With EBS: a user uploads to instance 1; the next request lands on instance 3 → 404 for the image.
2. With EFS mounted on all 4: every instance sees the same file immediately.
3. With S3 (usually best): the app writes to S3 and serves images through CloudFront; instances stay stateless and can be replaced freely.

**Common mistake → fix:** storing state on an instance's local disk in an Auto Scaling group; scale-in deletes the instance and its data. Fix: keep instances stateless; put shared files in S3 or EFS and data in databases.

**Interview answer:** "EBS is a block disk for a single instance in one AZ, EFS is a shared NFS file system across instances and AZs, and S3 is API-based object storage that's virtually unlimited and cheapest for durable data. I keep compute stateless and put shared or long-lived data in S3, using EFS only when software genuinely needs a shared POSIX file system."

**Follow-ups:**
- *Can ECS Fargate tasks use EFS?* Yes, EFS volumes can be mounted into Fargate tasks.

---

## 7. Integration: SQS, SNS, EventBridge

### Q42. What is SQS?

**Short answer:** **SQS** (Simple Queue Service) is a managed message queue. A **producer** sends messages to the queue; a **consumer** later polls the queue, receives messages, processes them and deletes them. The queue sits between them as a buffer, so the producer doesn't wait for the consumer, a traffic spike just makes the queue longer instead of overloading workers, and a failed message is retried automatically.

**How it works:**
1. `SendMessage` stores the message (up to 1 MiB) redundantly. It is kept for 4 days by default (configurable from 1 minute to 14 days).
2. A consumer calls `ReceiveMessage` (up to 10 messages per call). Received messages become **invisible** to other consumers for the **visibility timeout** (default 30 s, maximum 12 hours).
3. If the consumer finishes, it calls `DeleteMessage` with the receipt handle. Done.
4. If it crashes or takes too long, the message becomes visible again and another consumer gets it: a retry.
5. **Standard** queues: nearly unlimited throughput, at-least-once delivery, best-effort order. **FIFO** queues: ordered per message group, with deduplication.

**Example:** an upload service puts a job on a queue and returns immediately; a worker processes it.
```python
sqs = boto3.client("sqs")
sqs.send_message(QueueUrl=Q, MessageBody=json.dumps({"doc_id": "d-17"}))

while True:
    resp = sqs.receive_message(QueueUrl=Q, MaxNumberOfMessages=10, WaitTimeSeconds=20)
    for m in resp.get("Messages", []):
        process(json.loads(m["Body"]))
        sqs.delete_message(QueueUrl=Q, ReceiptHandle=m["ReceiptHandle"])
```

**What happens, step by step:**
1. The API sends `{"doc_id": "d-17"}` and responds to the user in milliseconds.
2. The worker's `receive_message` waits up to 20 s (**long polling**) and gets the message. It is now hidden for 30 s.
3. `process` takes 8 s and succeeds; `delete_message` removes it permanently.
4. Suppose a burst of 10,000 uploads arrives: the queue grows to 10,000 messages and workers drain it at their own pace. Nothing is lost and nothing is overloaded; auto scaling on queue depth can add workers.

**Common mistake → fix:** deleting the message **before** processing ("so it isn't processed twice"). If the worker crashes mid-way, the job is lost forever. Fix: delete only after successful processing, and make processing idempotent (see Q46).

**Interview answer:** "SQS is a managed queue that decouples producers from consumers. Consumers poll, a received message is hidden for the visibility timeout, and they delete it after successful processing; if they don't, it reappears and is retried. That gives buffering for spikes and automatic retries. Standard queues are at-least-once, so consumers must be idempotent; FIFO queues add ordering per group and deduplication."

**Follow-ups:**
- *What if the payload is larger than 1 MiB?* Store it in S3 and send a pointer (the extended client libraries do this for you).

---

### Q43. What are SNS and EventBridge?

**Short answer:** **SNS** (Simple Notification Service) is **publish/subscribe**: a publisher sends a message to a **topic**, and SNS pushes a copy to every **subscriber** (SQS queues, Lambda functions, HTTPS endpoints, email, SMS). **EventBridge** is an **event bus**: services publish events (JSON describing something that happened), and **rules** match events by their content and send them to **targets**. SNS is about fast fan-out to known subscribers; EventBridge is about routing by content, with AWS and SaaS events built in, schedules, and archive/replay.

**How it works:**
- **SNS:** create topic → add subscriptions (optionally with a **filter policy** so a subscriber only gets matching messages) → `Publish`. Delivery is push, with retries per protocol.
- **EventBridge:** events arrive on a bus (the default bus receives AWS service events, like "EC2 instance stopped"). Each **rule** has an **event pattern**; matching events go to its targets (up to 5 per rule), optionally transformed. **Archive and replay** let you re-send past events. **EventBridge Scheduler** runs targets on cron or one-off schedules.

**Example:** an `OrderPlaced` event.
```json
{
  "source": "orders.service",
  "detail-type": "OrderPlaced",
  "detail": { "orderId": "o-881", "total": 4200, "country": "IN" }
}
```
EventBridge rule pattern for large Indian orders:
```json
{ "source": ["orders.service"], "detail-type": ["OrderPlaced"],
  "detail": { "country": ["IN"], "total": [{ "numeric": [">=", 1000] }] } }
```

**What happens, step by step:**
1. The order service calls `PutEvents` with the event above.
2. EventBridge checks every rule on the bus. The "large IN orders" rule matches (`country = IN`, `total 4200 ≥ 1000`), so its target, a fraud-check queue, receives the event.
3. A separate "all orders" rule also matches and sends it to an analytics Firehose stream.
4. An order with `total: 300` matches only the second rule.
5. With SNS instead, the publisher would send to an `orders` topic and every subscriber would get every message unless each subscription had its own filter policy.

**Common mistake → fix:** subscribing a Lambda function directly to SNS for critical work. If the function is throttled or failing for a long time, deliveries can eventually be dropped after retries. Fix: SNS → SQS → consumer (the queue buffers), with a dead-letter queue.

**Interview answer:** "SNS is pub/sub: publish once to a topic and every subscriber gets a pushed copy, optionally filtered. EventBridge is an event bus where rules match events by content and route them to targets, with built-in AWS and SaaS events, scheduling and archive/replay. I use SNS for simple high-throughput fan-out, often into SQS queues, and EventBridge for content-based routing between services."

**Follow-ups:**
- *What is EventBridge Pipes?* A point-to-point connection from a source (like SQS or DynamoDB Streams) to a target, with optional filtering and enrichment, without writing glue code.

---

### Q44. SQS vs SNS vs EventBridge vs Kinesis

**Short answer:** **SQS** is a queue: each message is processed by one consumer, pulled when ready. **SNS** is pub/sub: each message is pushed to every subscriber. **EventBridge** routes events by content to many targets. **Kinesis Data Streams** is an ordered, replayable stream that several applications can read independently, built for high-volume data like clickstreams.

**How it works:**

| | **SQS** | **SNS** | **EventBridge** | **Kinesis Data Streams** |
|---|---|---|---|---|
| Pattern | queue, point-to-point | pub/sub fan-out | event bus with content rules | ordered stream |
| Delivery | consumer **pulls** | **push** to subscribers | **push** to targets | consumers read by position |
| Each message goes to | one consumer | every subscriber | every matching rule's targets | every consumer app (each tracks its own position) |
| Retry / failure | visibility timeout, DLQ | per-protocol retries, DLQ | retries, DLQ, archive and replay | consumers re-read from a position |
| Ordering | FIFO queues | FIFO topics | not guaranteed | per shard |
| Retention | up to 14 days | none (delivered or failed) | archive (optional) | 24 h default, up to 365 days |

**How to choose:**
- "Do this job once, eventually" → SQS.
- "Tell several systems at once" → SNS (often into SQS queues).
- "Route events by what's in them, between many services or from AWS/SaaS" → EventBridge.
- "Continuous high-volume data that several consumers process in order and may replay" → Kinesis (or MSK, managed Kafka).

**Example:** order placed → SNS topic `order-events` → three SQS queues (`billing`, `shipping`, `email`), each with its own worker.

```flow
sequence: Fan-out with SNS into separate SQS queues
actors: Orders service, SNS order-events, SQS billing, SQS shipping, SQS email
Orders service -> SNS order-events: Publish OrderPlaced o-881
SNS order-events -> SQS billing: copy 1
SNS order-events -> SQS shipping: copy 2
SNS order-events -> SQS email: copy 3
> Each queue buffers its own copy. If the email worker is down for an hour, its messages wait while billing and shipping continue.
SQS email --> Orders service: nothing; the publisher never waits for consumers
```

**What happens, step by step:**
1. One `Publish` call; SNS writes a copy into each of the three queues.
2. The billing and shipping workers process immediately.
3. The email worker is being redeployed; its 500 messages wait in `email`, and are processed when it returns.
4. If SNS had pushed directly to three HTTP services, the email service's downtime would have meant failed deliveries.

**Common mistake → fix:** using one SQS queue shared by billing, shipping and email consumers, expecting each to see every message. A queue gives each message to **one** consumer, so each service sees only some orders. Fix: fan-out with SNS or EventBridge into one queue per consumer.

**Interview answer:** "SQS is a pull queue where each message is handled once by one consumer; SNS pushes a copy to every subscriber; EventBridge routes events to targets by matching their content and adds archive/replay and SaaS integrations; Kinesis is an ordered, replayable stream that multiple apps read independently. A common pattern is SNS or EventBridge fanning out into one SQS queue per consumer for buffering and retries."

**Follow-ups:**
- *Is EventBridge slower than SNS?* EventBridge typically has somewhat higher latency and lower default throughput quotas than SNS; SNS fits very high-volume, low-latency fan-out.

---

### Q45. SQS in depth: visibility timeout, DLQs, long polling and FIFO

**Short answer:** The settings that make or break an SQS consumer: the **visibility timeout** must be longer than processing time (or be extended while working); a **dead-letter queue** (DLQ) with `maxReceiveCount` catches "poison" messages that keep failing; **long polling** (`WaitTimeSeconds` up to 20) avoids paying for empty receives; and **FIFO** queues give ordering per `MessageGroupId` and deduplication, at lower throughput than standard queues.

**How it works:**
- **Visibility timeout** (default 30 s, max 12 h): if processing may take 2 minutes, set it to more than that, or call `ChangeMessageVisibility` periodically as a heartbeat.
- **Receive count:** every receive increments `ApproximateReceiveCount`. When it exceeds the source queue's `maxReceiveCount`, SQS moves the message to the DLQ. After fixing the bug you **redrive** messages back.
- **Long polling:** the receive call waits until a message arrives or the wait ends, instead of returning empty immediately.
- **Delay:** messages can be delayed up to 15 minutes.
- **FIFO:** ordered within a `MessageGroupId`; deduplication within a 5-minute window via `MessageDeduplicationId` or content hash.

```flow
sequence: A slow worker causes a duplicate, then a poison message goes to the DLQ
actors: SQS orders-q, Worker A, Worker B, DLQ orders-dlq
Worker A -> SQS orders-q: ReceiveMessage
SQS orders-q --> Worker A: message M1, hidden for 30 s
Worker A -> Worker A: processing takes 45 s
SQS orders-q --> Worker B: at 30 s M1 becomes visible again and Worker B receives it
> Both workers now process M1. Without idempotency, the order is charged twice.
Worker A -> SQS orders-q: DeleteMessage at 45 s (the old receipt handle may no longer delete the new delivery)
Worker B -> SQS orders-q: message M2 fails on every attempt
SQS orders-q -> DLQ orders-dlq: after the 5th receive (maxReceiveCount = 5), M2 is moved to the DLQ
> An alarm on DLQ depth tells the team. After the fix, M2 is redriven back to orders-q.
```

**Example:**
```bash
aws sqs set-queue-attributes --queue-url $Q --attributes '{
  "VisibilityTimeout": "180",
  "ReceiveMessageWaitTimeSeconds": "20",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:ap-south-1:111122223333:orders-dlq\",\"maxReceiveCount\":\"5\"}"
}'
```

**What happens, step by step (after the fix):**
1. Visibility timeout is now 180 s, well above the 45 s processing time, so M1 is no longer redelivered while still being worked on.
2. Long polling is 20 s on the queue by default, so idle workers make about 3 receive calls a minute instead of hundreds.
3. M2 still fails, now 5 times, then lands in `orders-dlq`, where it stops blocking capacity and triggers an alarm.

**Common mistake → fix:** a Lambda consumer with a function timeout of 5 minutes and the queue's visibility timeout at 30 s; every slow message is processed several times. Fix: AWS recommends the visibility timeout be at least six times the function timeout for Lambda event source mappings.

**Interview answer:** "I set the visibility timeout above the worst-case processing time or extend it as a heartbeat, attach a DLQ with a maxReceiveCount around 3 to 5 and alarm on its depth, use long polling to cut empty receives, and make consumers idempotent because standard queues are at-least-once. When ordering matters, a FIFO queue with message group IDs keeps per-entity order and deduplicates within five minutes."

**Follow-ups:**
- *What metric shows a consumer falling behind?* `ApproximateAgeOfOldestMessage`; queue depth alone doesn't show how long work is waiting.

---

### Q46. What is idempotency, and how do you implement it in AWS integrations?

**Short answer:** An operation is **idempotent** if doing it twice has the same effect as doing it once. In AWS, retries and at-least-once delivery mean the same message, event or request **will** sometimes arrive more than once, so handlers must be safe to repeat. The usual technique: give each operation a unique **idempotency key** (message ID, event ID, client request ID), record it with a **conditional write**, and skip work whose key was already recorded.

**How it works:**
1. Pick a key that is the same on every retry of the same logical operation (for example `orderId + "charge"`, or the event ID). A newly generated UUID per attempt is useless.
2. Before doing the work, try to insert the key with a condition "only if it does not exist" (DynamoDB `attribute_not_exists`, or a SQL unique constraint).
3. If the insert succeeds, do the work and store the result. If it fails, the work was already done (or is in progress): return the stored result or skip.
4. Many AWS APIs accept their own token for this: `ClientToken` on EC2 `RunInstances`, `ClientRequestToken` on Secrets Manager and others.
5. Add an expiry (DynamoDB TTL) so keys don't accumulate forever.

```flow
sequence: An idempotent consumer receiving the same event twice
actors: SQS, Consumer, DynamoDB processed-events, Payment API
SQS -> Consumer: event e-77 (charge order o-881)
Consumer -> DynamoDB processed-events: PutItem e-77 if attribute_not_exists(pk)
DynamoDB processed-events --> Consumer: success, this is the first time
Consumer -> Payment API: charge 4,200 with idempotency key o-881-charge
SQS -> Consumer: e-77 delivered again after a visibility timeout
Consumer -> DynamoDB processed-events: PutItem e-77 if attribute_not_exists(pk)
DynamoDB processed-events --> Consumer: ConditionalCheckFailedException, already processed
> The consumer deletes the duplicate message without charging again.
```

**Example:**
```python
try:
    table.put_item(
        Item={"pk": event_id, "status": "done", "ttl": int(time.time()) + 7 * 86400},
        ConditionExpression="attribute_not_exists(pk)")
except table.meta.client.exceptions.ConditionalCheckFailedException:
    return  # duplicate: already handled
charge(order_id, amount, idempotency_key=f"{order_id}-charge")
```

**What happens, step by step:** see the diagram. Note the gap: if the consumer crashes **after** writing the key but **before** charging, the retry would skip the charge. Robust versions write status `in_progress` first, then `done` after the work, and treat a stale `in_progress` as retryable. Powertools for AWS Lambda's idempotency utility implements exactly this.

**Common mistake → fix:** "check then write" in two separate calls (`GetItem`, then `PutItem` if missing). Two concurrent duplicates both see "missing" and both process. Fix: a single conditional write, which is atomic.

**Interview answer:** "Because AWS delivery is at-least-once and clients retry, handlers must be idempotent. I use a stable idempotency key per logical operation and claim it with an atomic conditional write, for example DynamoDB attribute_not_exists, with an in-progress state and a TTL. Downstream calls carry their own idempotency keys, and for AWS APIs I pass ClientToken-style parameters."

**Follow-ups:**
- *Doesn't FIFO give exactly-once?* FIFO deduplicates sends within 5 minutes and processes in order, but your side effects (database writes, payments) still need idempotency if the consumer fails mid-way.

---

### Q47. Choreography with events vs orchestration with Step Functions

**Short answer:** In **choreography**, each service reacts to events on its own (for example via EventBridge), and nobody controls the whole flow. In **orchestration**, a central workflow, typically **AWS Step Functions**, calls each step in order and handles retries, timeouts, branches and compensation. Choreography gives loose coupling; orchestration gives visibility and control for multi-step processes.

**How it works:**

| | Choreography (EventBridge, SNS) | Orchestration (Step Functions) |
|---|---|---|
| Who knows the flow? | nobody; it's spread across services | the state machine definition |
| Coupling | loose: add a consumer without touching the producer | the workflow knows every step |
| Errors and retries | each service handles its own | declared per step (`Retry`, `Catch`) |
| Visibility | assemble from logs and traces | each execution shows every step and its input/output |
| Good for | independent reactions to a fact | ordered business processes, sagas with compensation |

**How to choose:** if the steps must happen in order and failures need undoing (refund if shipping fails), orchestrate. If several teams simply need to react to "order placed" in their own way, choreograph. A common hybrid: an orchestrated workflow that publishes an event when it finishes.

**Example:** order fulfilment in Step Functions: `ReserveStock` → `ChargePayment` → `CreateShipment`, with `Catch` on `CreateShipment` → `RefundPayment` → `ReleaseStock`.

**What happens, step by step:**
1. The execution starts with `{"orderId": "o-881"}`.
2. `ReserveStock` and `ChargePayment` succeed.
3. `CreateShipment` fails 3 times (retry with backoff), then the `Catch` routes to `RefundPayment` and `ReleaseStock` (compensation).
4. The console shows exactly where it failed and with what input. In a choreographed version you would reconstruct this from logs in three services.
5. On success, the last step publishes `OrderFulfilled` to EventBridge so email and analytics react independently.

**Common mistake → fix:** chains of events where service A's event triggers B, whose event triggers C, whose failure must undo A. Nobody owns the end-to-end flow and failures leave inconsistent data. Fix: orchestrate the transactional core, choreograph the side reactions.

**Interview answer:** "Choreography means services react to events independently, which is loosely coupled but hard to see end-to-end. Orchestration with Step Functions puts the flow in one state machine with explicit retries, timeouts and compensation, and shows each execution step by step. I orchestrate multi-step business transactions and use events for independent side effects, often emitting an event when the workflow completes."

**Follow-ups:**
- *Standard vs Express workflows?* Standard workflows run up to a year with exactly-once step execution and full history; Express workflows are for high-volume, short (up to 5 minutes) executions with at-least-once semantics.

---

## 8. Observability

### Q48. What is CloudWatch? Metrics, logs and alarms

**Short answer:** **CloudWatch** is AWS's monitoring service. **Metrics** are numbers over time (CPU %, request count, queue depth), sent automatically by AWS services or published by your app. **Logs** are text lines from your applications and services, stored in **log groups** and searchable with **Logs Insights**. **Alarms** watch a metric against a threshold and act when it is breached: notify through SNS, trigger auto scaling, or run an automated action.

**How it works:**
1. AWS services publish metrics into **namespaces** (`AWS/ApplicationELB`, `AWS/SQS`), with **dimensions** identifying the resource (`LoadBalancer=app/orders-alb/…`). Standard resolution is 1 minute; custom metrics can go down to 1 second (high resolution).
2. Apps write logs to stdout or a log agent; they land in a log group, split into log streams (one per container or instance). Retention is "never expire" by default, so set one.
3. An alarm evaluates a statistic (average, sum, p99) over a **period**, and goes to `ALARM` when **M out of N** periods breach (for example 3 out of 5 one-minute periods).
4. States: `OK`, `ALARM`, `INSUFFICIENT_DATA`. Choose how missing data is treated (as breaching, not breaching, ignore).

**Example:** alarm on ALB 5xx errors from targets.
```bash
aws cloudwatch put-metric-alarm --alarm-name orders-5xx \
  --namespace AWS/ApplicationELB --metric-name HTTPCode_Target_5XX_Count \
  --dimensions Name=LoadBalancer,Value=app/orders-alb/50dc6c495c0c9188 \
  --statistic Sum --period 60 --evaluation-periods 5 --datapoints-to-alarm 3 \
  --threshold 25 --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching --alarm-actions arn:aws:sns:ap-south-1:111122223333:oncall
```

```flow
trace: The orders-5xx alarm over five minutes
10:00 → 4 errors, 10:01 → 30 errors > One breaching minute out of the last five. Still OK, because 3 are needed.
10:02 → **41** errors > Two breaching minutes out of five. Still OK; a short blip does not page anyone.
10:03 → **38** errors > Three breaching minutes out of five, so the state changes to ALARM.
SNS topic oncall notified > The on-call engineer is paged once, on the state change, not every minute.
10:07 → errors back under 25 for long enough > Fewer than 3 of the last 5 minutes breach, so the alarm returns to OK and can send a recovery notice.
```

**What happens, step by step:** shown in the trace above. The "3 out of 5" setting is what filters single-minute spikes.

**Common mistake → fix:** alarming on averages for latency. An average of 200 ms can hide 5 % of users waiting 8 s. Fix: alarm on p95/p99 (`TargetResponseTime` with an extended statistic like `p99`).

**Interview answer:** "CloudWatch collects metrics from AWS services and apps, stores logs in log groups searchable with Logs Insights, and evaluates alarms that notify or act when a metric breaches a threshold for M out of N periods. I alarm on percentiles for latency, set log retention explicitly, and send alarms to SNS for paging or to scaling policies."

**Follow-ups:**
- *How do you publish custom metrics cheaply?* The Embedded Metric Format: write structured JSON log lines and CloudWatch extracts metrics from them.
- *Logs Insights example?* `fields @timestamp, msg | filter level = "ERROR" | stats count() by bin(5m)`.

---

### Q49. CloudWatch vs CloudTrail vs X-Ray / OpenTelemetry

**Short answer:** They answer different questions. **CloudWatch** (metrics, logs, alarms): "how is the system behaving?" **CloudTrail**: "who called which AWS API, when and from where?" for audit and security. **X-Ray** or **OpenTelemetry** traces (viewed in CloudWatch, for example with Application Signals): "where did this one request spend its time across services?"

**How it works:**

| Tool | Question | Data | Example |
|---|---|---|---|
| CloudWatch Metrics + Alarms | how much, how fast, is it healthy? | numbers per minute | p99 latency 2.4 s |
| CloudWatch Logs | what did the code say? | log lines | `ERROR payment declined order=o-881` |
| CloudTrail | who changed or accessed AWS resources? | API call records | `DeleteSecurityGroup` by role `ops` at 10:02 |
| X-Ray / OpenTelemetry (ADOT) | which hop is slow? | traces made of spans | 1.9 s of 2.4 s spent in the payment API call |

CloudTrail notes: the console's **Event history** shows the last 90 days of management events for free; for longer retention, data events (like S3 object reads) and organisation-wide logging, create a **trail** to S3 (or use CloudTrail Lake).

**Example:** users report slow checkouts at 10:05.

**What happens, step by step:**
1. **Metrics:** the `TargetResponseTime` p99 alarm fired at 10:03; error rate is normal.
2. **Traces:** a slow trace shows 1.9 s inside the call to the payment provider.
3. **Logs:** filtering logs by that trace ID shows retries to the provider with `429 Too Many Requests`.
4. **CloudTrail:** checking for changes around 10:00 shows someone modified the NAT gateway route at 09:58, routing traffic through a different, rate-limited egress IP. Root cause found.

**Common mistake → fix:** relying on CloudTrail for application debugging, or on app logs for security audit. Fix: use each for its purpose and correlate with a shared request/trace ID.

**Interview answer:** "CloudWatch metrics and alarms tell me something is wrong, traces with X-Ray or OpenTelemetry tell me where in the request path, logs tell me what the code saw, and CloudTrail tells me who changed what in AWS. I propagate a trace ID through logs so I can jump between them, and keep an organisation-wide CloudTrail trail in a separate log account."

**Follow-ups:**
- *Management vs data events?* Management events are control-plane calls (create, delete, modify); data events are high-volume resource operations like S3 `GetObject` or Lambda `Invoke`, logged only if you enable them.

---

### Q50. What should you alarm on?

**Short answer:** Alarm first on **symptoms users feel**: error rate, high-percentile latency, availability. Then on **saturation** that predicts trouble: queue age, CPU/memory, connection pools, throttling, free IPs, disk. Then on **dependencies**, **cost anomalies** and **security findings**. Every alarm must be actionable, have an owner and link to a runbook; everything else is a dashboard metric, not a page.

**How it works:**

| Category | Example alarms |
|---|---|
| User symptoms | 5xx rate above 1 % for 5 min, p99 latency above 2 s, synthetic check failing |
| Saturation | SQS `ApproximateAgeOfOldestMessage` above 10 min, memory above 85 %, DB connections near max |
| Dependencies | payment provider error rate, `ThrottlingException` counts |
| Cost and security | AWS Budgets / Cost Anomaly Detection, GuardDuty high-severity findings |

Reduce noise with **composite alarms** (page only if both error rate and latency are bad), **M of N** datapoints, and SLO-based **burn-rate** alerts (page when the error budget is being consumed too fast).

**Example:** an SLO of 99.9 % successful requests over 30 days allows about 43 minutes of full outage (0.1 % of 43,200 minutes).

**What happens, step by step:**
1. A fast burn-rate alert pages when errors would consume 2 % of the monthly budget in 1 hour.
2. At 10:00 an incident causes 5 % errors. The burn rate is 50 times normal; the alert fires within minutes.
3. A slow leak of 0.2 % errors doesn't page at night but triggers a ticket from a slower 6-hour burn-rate alert.
4. CPU at 80 % with normal latency triggers nothing; it is a dashboard metric, not a page.

**Common mistake → fix:** dozens of CPU and memory alarms that page at night while users are fine; people learn to ignore pages. Fix: page on user-facing symptoms, ticket on early-warning saturation, and delete alarms nobody acts on.

**Interview answer:** "I page on user-facing symptoms like error rate, p99 latency and synthetic availability, ideally as SLO burn-rate alerts, and raise lower-urgency alerts on saturation signals like queue age, memory and connection pools. Composite alarms and M-of-N evaluation cut noise. Every page has an owner and a runbook; if nobody acts on an alarm, I delete it."

**Follow-ups:**
- *What are CloudWatch Synthetics canaries?* Scripts that call your endpoints or click through pages on a schedule, so you detect outages before users report them.

---

## 9. Resilience, DR & Well-Architected

### Q51. How do you design for high availability across AZs?

**Short answer:** Run every tier in at least two, preferably three, Availability Zones, keep compute **stateless**, let health checks remove and replace broken parts automatically, and keep enough spare capacity that the remaining AZs can carry the full load if one fails. Look for hidden single-AZ pieces: one NAT gateway, one database instance, one special EC2.

**How it works:**

| Tier | Multi-AZ setup |
|---|---|
| Load balancer | enabled in subnets in 3 AZs |
| Compute | ECS service or Auto Scaling group spread across 3 AZs |
| Database | RDS/Aurora Multi-AZ with automatic failover; DynamoDB is multi-AZ by design |
| Cache | ElastiCache with replicas in other AZs and automatic failover |
| Outbound | NAT per AZ or regional NAT gateway |
| State | sessions in a cache or database, files in S3 |

**Capacity rule (N+1 across AZs):** if you need 6 tasks to serve peak and run in 3 AZs, losing one AZ leaves two-thirds. To survive, run 9 (3 per AZ), or scale fast enough.

**Example:** an API with peak need of 6 tasks, running 9 tasks across 3 AZs.

**What happens, step by step (AZ b fails):**
1. 3 tasks in AZ b stop responding; the ALB marks them unhealthy within about a minute.
2. 6 tasks in AZ a and c keep serving full peak traffic, so users see no outage.
3. ECS starts replacement tasks in the healthy AZs.
4. The Aurora writer was in AZ b, so Aurora fails over to the replica in AZ a; apps reconnect by DNS after a brief error spike.
5. **AWS Fault Injection Service** experiments can rehearse exactly this so you trust it before the real event.

**Common mistake → fix:** running exactly the capacity needed spread across AZs (6 tasks, 2 per AZ). Losing an AZ drops capacity to 4 just as traffic shifts; the remaining tasks overload. Fix: provision headroom per AZ or scale proactively.

**Interview answer:** "Every tier spans at least two, ideally three, AZs: load balancer, stateless compute, Multi-AZ database, replicated cache, and NAT per AZ. Health checks remove failed targets and orchestration replaces them. I size for losing one AZ, which with three AZs means about 50 % headroom on top of peak, and I test it with fault injection."

**Follow-ups:**
- *What is zonal shift?* A feature (Application Recovery Controller) that moves load balancer traffic away from an impaired AZ on demand or automatically.

---

### Q52. What are the disaster recovery strategies?

**Short answer:** **Disaster recovery** (DR) is how you recover when a whole Region or system is lost. Two numbers drive the design: **RTO** (recovery time objective: how long you may be down) and **RPO** (recovery point objective: how much data, measured in time, you may lose). The four strategies, from cheapest and slowest to most expensive and fastest: **backup and restore**, **pilot light**, **warm standby**, and **multi-site active/active**.

**How it works:**

| Strategy | What runs in the DR Region | RTO / RPO (typical) | Cost |
|---|---|---|---|
| **Backup & restore** | only backups (snapshots, S3 copies) | hours / hours | lowest |
| **Pilot light** | data replicated; app infrastructure defined but off or minimal | tens of minutes / minutes | low |
| **Warm standby** | a scaled-down full copy running | minutes / seconds to minutes | medium |
| **Multi-site active/active** | full capacity serving traffic in both | near zero / near zero | highest |

Tools: AWS Backup with cross-Region copies, Aurora Global Database, DynamoDB global tables, S3 Cross-Region Replication, Route 53 failover records, and infrastructure as code to rebuild quickly.

**How to choose:** let the business set RTO and RPO per system, then pick the cheapest strategy that meets them. A reporting tool may accept backup & restore; a payment API may need warm standby.

**Example:** a payments API requires RTO 15 minutes and RPO 1 minute. Chosen: warm standby in a second Region with Aurora Global Database (replication lag typically under a second) and 2 tasks running instead of 20.

**What happens, step by step (primary Region outage):**
1. Health checks and alarms detect the outage; the team (or automation) decides to fail over. Region-level failover is usually a deliberate decision.
2. Aurora Global Database's secondary is promoted to writer.
3. The ECS service in the DR Region scales from 2 to 20 tasks.
4. Route 53 failover (or a manual record change) points `api.example.com` at the DR ALB.
5. Total time is about 10–15 minutes, data loss under a minute: within the targets. This only holds if it has been **practised**.

**Common mistake → fix:** backups that have never been restored. During a real incident the restore fails or takes ten times longer than expected. Fix: scheduled restore tests and DR game days with measured RTO and RPO.

**Interview answer:** "DR starts from RTO and RPO per system. Backup and restore is cheapest with hours of downtime; pilot light keeps data replicated with minimal infrastructure; warm standby runs a scaled-down copy for minutes of RTO; active/active serves from both Regions for near-zero RTO at the highest cost. I pick the cheapest option that meets the targets and test failover regularly."

**Follow-ups:**
- *Is Multi-AZ a DR strategy?* It's high availability for data centre failures within a Region. DR usually means surviving loss of a Region or of the data itself (corruption, deletion), which needs backups or cross-Region copies.

---

### Q53. What is the Well-Architected Framework?

**Short answer:** The **AWS Well-Architected Framework** is a set of best practices and review questions for cloud workloads, organised into **six pillars**: **operational excellence**, **security**, **reliability**, **performance efficiency**, **cost optimisation** and **sustainability**. Teams use it (often with the Well-Architected Tool) to review a design, find high-risk issues and plan improvements.

**How it works:**

| Pillar | Core question | Example practice |
|---|---|---|
| Operational excellence | can we run and improve it? | infrastructure as code, runbooks, post-incident reviews |
| Security | is it protected? | least privilege, encryption, traceability |
| Reliability | does it recover and scale? | multi-AZ, backups tested, quotas monitored |
| Performance efficiency | right resources, used well? | right instance types, caching, measure and evolve |
| Cost optimisation | paying only for value? | right-sizing, Savings Plans, Graviton, lifecycle rules |
| Sustainability | minimal environmental impact? | high utilisation, efficient regions and hardware |

**Lenses** add domain-specific questions (serverless, generative AI, SaaS, and others).

**Example:** a review of a single-AZ app on one EC2 instance with a password in its user data script.

**What happens, step by step:**
1. **Reliability** flags a high risk: single instance, single AZ, no tested backups.
2. **Security** flags a high risk: secret in user data, visible to anyone who can describe the instance.
3. **Cost** notes the instance is 10 % utilised.
4. The improvement plan: Auto Scaling group across 2 AZs with a smaller instance type, secret moved to Secrets Manager, AWS Backup plan with a restore test.

**Common mistake → fix:** treating the review as a one-off checkbox. Fix: re-review after major changes and track the high-risk items like any other backlog.

**Interview answer:** "Well-Architected is AWS's best-practice framework with six pillars: operational excellence, security, reliability, performance efficiency, cost optimisation and sustainability. I use it as a structured design review to find high-risk issues, for example single points of failure or secrets in user data, and track improvements over time, adding lenses like serverless or generative AI where relevant."

**Follow-ups:**
- *Which pillar was added most recently?* Sustainability, added in 2021.

---

### Q54. How do service quotas and throttling affect your design?

**Short answer:** Every AWS account has **quotas** (limits), such as the number of vCPUs of On-Demand instances, concurrent Lambda executions, or API requests per second, and many APIs **throttle** (reject with `ThrottlingException` or HTTP 429) when you call them too fast. Design for it: know your quotas, request increases before you need them, retry with **exponential backoff and jitter**, and smooth bursts with queues, batching and caching.

**How it works:**
1. **Service Quotas** console/API shows current values and usage for many quotas, and many quotas publish usage metrics to CloudWatch so you can alarm at, say, 80 %.
2. Some quotas are adjustable (request an increase, sometimes takes days), some are fixed.
3. AWS SDKs retry throttled calls automatically (`standard` or `adaptive` retry modes) with backoff.
4. **Exponential backoff with jitter:** wait about 100 ms, 200 ms, 400 ms … but randomised, so thousands of clients don't retry in lockstep.

**Example:** a nightly job starts 5,000 Lambda invocations at once in an account whose Lambda concurrency quota is 1,000.

**What happens, step by step:**
1. The first 1,000 run; the other 4,000 synchronous invocations are throttled with `TooManyRequestsException` (429).
2. Without retries they fail. With naive immediate retries, they all hit the limit again together.
3. Redesign: put the 5,000 work items in SQS and let the Lambda event source mapping consume them with a **maximum concurrency** of, say, 500, leaving room for other functions.
4. The job takes longer but finishes reliably, and the API functions sharing the account are never starved.

**Common mistake → fix:** discovering a quota during a launch or incident (for example, not enough vCPU quota to scale out). Fix: load-test, check Service Quotas for the expected peak, request increases ahead of time, and alarm on quota usage.

**Interview answer:** "Quotas and API rate limits are part of the design. I check Service Quotas against expected peaks and request increases early, alarm on quota usage, use SDK retries with exponential backoff and jitter, and smooth bursts with queues, batching and caching so throttling degrades into slower processing instead of failures."

**Follow-ups:**
- *Why jitter?* Without randomness, every throttled client retries at the same moment and creates a new spike (the "thundering herd").

---

## 10. Scenario & debugging questions

### Q55. An ECS task can't read from S3 even though an IAM policy says "Allow". What do you check?

**Short answer:** An `AccessDenied` despite an Allow means either the Allow isn't on the identity actually making the call, it doesn't match the exact action or resource, or something else denies or fails to allow (bucket policy, SCP, permissions boundary, KMS key policy, VPC endpoint policy). A **timeout** instead of AccessDenied points to the network, not IAM. Check in this order.

**Step by step:**
1. **Read the exact error and CloudTrail event.** *How:* find the `GetObject` (data events must be enabled) or the error message, which often names the policy type that denied it ("explicit deny in a service control policy", "no identity-based policy allows"). *Means:* tells you which layer to look at.
2. **Which identity made the call?** *How:* log `sts.get_caller_identity()` from inside the task. *Means:* if it shows the **execution** role or no role, `taskRoleArn` is missing or the SDK isn't using container credentials. The app uses the **task role**; the execution role is only for pulling images, logs and start-up secrets.
3. **Does the Allow match exactly?** *How:* compare the action and ARN. `s3:GetObject` needs `arn:aws:s3:::bucket/*`; `s3:ListBucket` needs `arn:aws:s3:::bucket`. *Means:* a missing `/*` is a very common cause.
4. **Any explicit deny?** *How:* check the bucket policy (for example a `Deny` unless `aws:SourceVpce` matches or `aws:SecureTransport` is true), SCPs, permissions boundary on the role. *Means:* any matching Deny wins over every Allow.
5. **Is the object encrypted with a customer managed KMS key?** *How:* `head-object` shows `ServerSideEncryption: aws:kms` and the key ID. *Means:* the role also needs `kms:Decrypt`, and the key policy must allow it.
6. **Cross-account bucket or object ownership?** *How:* check the bucket's account. *Means:* the bucket policy must allow the role too, and with ACLs disabled the bucket owner owns all objects.
7. **VPC endpoint policy.** *How:* look at the S3 gateway endpoint's policy. *Means:* a restrictive endpoint policy denies buckets not listed.
8. **If it's a timeout instead:** no NAT and no S3 gateway endpoint in the task's subnets, or a security group/NACL blocking outbound 443.

**Example fix bundle:** add `taskRoleArn` to the task definition, correct the resource to `arn:aws:s3:::acme-reports/*`, and add `kms:Decrypt` on the bucket's key to the task role (and the role to the key policy).

**Interview answer:** "First I read the exact error and CloudTrail record, then confirm the caller identity from inside the task, because a missing task role is the classic cause. Then I check that the action and ARN match exactly, look for explicit denies in the bucket policy, SCPs or boundaries, check KMS permissions for encrypted objects, the endpoint policy and cross-account ownership. A timeout instead of AccessDenied sends me to the network: NAT, gateway endpoint, security groups."

---

### Q56. An internal API sometimes times out under load. How do you find the cause?

**Short answer:** Intermittent timeouts under load almost always come from something running out: connections, threads, CPU, a dependency's rate limit, NAT ports, or IP addresses. Measure **where** the time goes before changing anything, using load balancer metrics, traces and per-dependency latency.

**Step by step:**
1. **Where does it time out?** *How:* ALB metrics: `TargetResponseTime`, `HTTPCode_ELB_5XX_Count` (504 means the target was too slow; 502/503 mean no healthy target or bad response), `RejectedConnectionCount`. *Means:* ELB-generated 504s point at slow targets; 503s at no healthy targets.
2. **Is the app saturated?** *How:* ECS/EC2 CPU and memory, thread or event-loop lag, number of in-flight requests per task. *Means:* high CPU means scale out or optimise; low CPU but high latency means waiting on something.
3. **Which dependency is slow?** *How:* traces (X-Ray/OpenTelemetry) per request. *Means:* the slow span names the culprit: database, external API, another service.
4. **Pools exhausted?** *How:* database `DatabaseConnections` vs maximum, app connection pool wait time. *Means:* requests queue for a connection; add a pool limit per task that fits the database, or RDS Proxy.
5. **Throttling?** *How:* look for 429s or `ThrottlingException` from DynamoDB or other AWS APIs, and the dependency's own limits. *Means:* add backoff, caching, or request quota increases.
6. **NAT limits?** *How:* NAT gateway `ErrorPortAllocation` and `PacketsDropCount`. *Means:* too many simultaneous connections to one destination; reuse connections (keep-alive), add NAT IPs, or use VPC endpoints.
7. **Timeouts and retries consistent?** *How:* compare client timeout, ALB idle timeout, app timeout and dependency timeouts. *Means:* a 30 s client timeout calling a service with 3 retries of 20 s each produces piles of abandoned work.

**Example fix bundle:** connection pool capped at 10 per task with RDS Proxy, HTTP keep-alive for outbound calls, 2-second timeouts with one retry and jitter on the dependency, and auto scaling on request count per target instead of CPU.

**Interview answer:** "I measure before fixing: ALB metrics to see whether targets are slow or missing, traces to find the slow dependency, then check connection pools, throttling, NAT port allocation errors and timeout/retry budgets. Typical fixes are right-sized pools or RDS Proxy, keep-alive, proper timeouts with backoff, caching or queueing, and scaling on the metric that actually saturates."

---

### Q57. "Connection timed out" vs "AccessDenied" vs "Connection refused": what does each tell you?

**Short answer:** Each error points at a different layer. **Timeout:** packets got no reply at all, so it's a **network path** problem (security group, NACL, route, missing NAT or endpoint, wrong IP). **AccessDenied (403):** you reached the service and it said no, so it's **IAM or a resource policy**. **Connection refused:** you reached the host but **nothing is listening** on that port. **DNS errors** (`NXDOMAIN`, "could not resolve host"): the name itself failed.

**How it works:**

| Symptom | Layer | Typical causes | First check |
|---|---|---|---|
| Timeout | network | security group/NACL drop, no route, no NAT/endpoint, wrong IP | VPC Flow Logs (REJECT or no record), route tables |
| Connection refused | host/app | app not started, wrong port, listening on 127.0.0.1 only | `ss -ltnp` on the host, container port mapping |
| AccessDenied / 403 | authorisation | missing Allow, explicit Deny, KMS, endpoint policy | CloudTrail error, policy simulator |
| DNS failure | name resolution | private DNS off, wrong hosted zone, resolver rules | `dig` from inside the VPC |

**Example:** a task calling Secrets Manager.

**What happens, step by step:**
1. `ConnectTimeoutError` after 60 s → the task's subnet has no NAT and no Secrets Manager endpoint, or the endpoint's security group doesn't allow 443 from the task. Network layer.
2. After adding the endpoint: `AccessDeniedException ... is not authorized to perform secretsmanager:GetSecretValue` → network is fine now; the role needs permission. IAM layer.
3. Calling an internal service on port 8080: `Connection refused` → the host is reachable but the service listens on 8000. App layer.

**Common mistake → fix:** opening security groups wider in response to an AccessDenied, or editing IAM in response to a timeout. Fix: read the error type first, then work on the matching layer.

**Interview answer:** "A timeout means the packets never got a reply, so I look at security groups, NACLs, routes, NAT and endpoints, using flow logs. Connection refused means I reached the host but nothing listens on that port. AccessDenied means the network is fine and a policy said no, so I go to CloudTrail and IAM. DNS errors mean the name didn't resolve, often private DNS or hosted zone issues."

---

### Q58. Design secure cross-account access for a central platform that calls resources in team accounts

**Short answer:** Give the central platform's workload its own role, and have each team account own a narrowly scoped role that **trusts only that platform role** (plus organisation and tag conditions). The platform assumes the team role with STS when it needs to act, passing **session tags** about the end user or tenant for ABAC. Each team controls and can revoke its own role, and CloudTrail in both accounts records every call.

**How it works:**
1. **Platform side:** role `platform-worker` in account `111122223333`, allowed `sts:AssumeRole` only on `arn:aws:iam::*:role/platform-access` and only within the organisation.
2. **Team side:** role `platform-access` in each team account, trust policy naming `platform-worker` exactly, with `aws:PrincipalOrgID` and required session tags; permissions only for the specific actions the platform needs.
3. **Session tags:** the platform passes `tenant=t-42` and `user=asha`; team policies use them (`aws:PrincipalTag/tenant`) to scope resources.
4. **Guardrails:** SCPs prevent anyone in team accounts from widening the trust to `*` or removing CloudTrail.

```flow
sequence: Central platform acting in a team account
actors: Platform worker role, STS, Team role platform-access, Team S3 bucket
Platform worker role -> STS: AssumeRole platform-access in 444455556666, session tags tenant=t-42 and user=asha
STS -> STS: trust policy check: caller is exactly platform-worker, in our organisation, tags present
STS --> Platform worker role: credentials valid for 15 minutes
Platform worker role -> Team S3 bucket: GetObject tenants/t-42/data.json
> The team role only allows objects whose prefix matches the tenant session tag, so tenant t-43's data is out of reach.
Team S3 bucket --> Platform worker role: object returned, and CloudTrail in both accounts records the session name and tags
```

**Example:** team role permissions policy using the tag.
```json
{ "Effect": "Allow", "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::team-a-data/tenants/${aws:PrincipalTag/tenant}/*" }
```

**What happens, step by step:** see the diagram. If the team decides to stop the integration, it deletes or edits its role; the platform cannot override that.

**Interview answer:** "The platform has its own role, and each team account owns a narrowly scoped role that trusts only that exact role ARN, with PrincipalOrgID and required session tags. The platform assumes it with short sessions and passes tenant and user as session tags, which team policies use for ABAC. Teams keep control and can revoke trust, SCPs stop trust policies being widened, and CloudTrail in both accounts gives a full audit trail."

---

### Q59. How do you present an AWS design trade-off in an interview?

**Short answer:** Use a fixed structure: state the **requirements** that matter (latency, scale, cost, compliance, team skills), offer **two or three realistic options**, compare them on **security, reliability, cost, operability and performance** with numbers where you can, **choose** and explain why, then name the **risks and how you'd validate** the choice (load test, cost estimate, proof of concept).

**How it works:**
1. Requirements: "Steady 300 requests per second, some responses stream for up to 2 minutes, team knows containers."
2. Options: API Gateway + Lambda vs ALB + ECS Fargate.
3. Comparison table (below).
4. Decision with the deciding factor.
5. Risks, mitigations and what would change your mind.

**Example:**

| Criterion | API Gateway + Lambda | ALB + ECS Fargate |
|---|---|---|
| 2-minute streaming responses | awkward: 29 s default integration timeout (raisable only for Regional and private REST APIs) | natural fit; ALB idle timeout up to 4,000 s |
| Cost at steady 300 rps | per-request pricing adds up at constant load | hourly cost, cheaper at steady volume (illustrative) |
| Scaling for spikes | very fast | about a minute per scale-out step |
| Operations | no servers or images | images, tasks, deployments to manage |

**What happens, step by step (the spoken answer):**
1. "The deciding requirement is long streaming responses with steady traffic."
2. "That favours ALB + ECS: no 29-second limit by default, and cheaper at constant load."
3. "The risk is slower scale-out for sudden spikes. I'd mitigate with a minimum task count and step scaling, and validate with a load test at 3 times expected peak."
4. "If traffic were spiky and requests short, I'd switch to API Gateway + Lambda."

**Interview answer:** "I state the requirements that drive the decision, give two or three realistic options, compare them on security, reliability, cost, operability and performance with rough numbers, choose and say what decided it, then name the risks, mitigations and how I'd validate, plus what would make me change my mind."

---

## 11. Cheat sheet

| Topic | Remember |
|---|---|
| Region / AZ | Region = isolated area; AZ = separate data centres; run in at least 2–3 AZs |
| Account | isolation and billing boundary; root user locked away with MFA |
| VPC / subnet | VPC = private network in a Region; subnet = one AZ; 5 IPs reserved per subnet |
| Public subnet | route 0.0.0.0/0 → internet gateway; nothing else makes it public |
| NAT gateway | outbound-only for private subnets; per-hour + per-GB; per AZ or regional mode |
| Security group vs NACL | stateful, ENI, allow-only, can reference SGs vs stateless, subnet, allow + deny, ordered |
| Endpoints | gateway (S3, DynamoDB, free) vs interface (PrivateLink, private DNS, per hour) |
| IAM identities | users (avoid keys), groups, roles (temporary credentials), federation for humans |
| Role | trust policy (who) + permission policies (what); STS sessions 15 min–12 h, chaining 1 h |
| IAM evaluation | explicit Deny wins → SCP/RCP/boundary/session caps must allow → identity or resource Allow → else deny |
| Cross-account | caller's identity policy AND target's trust/resource policy (AND KMS key policy) |
| KMS | envelope encryption; key policy controls use; direct encrypt only up to 4 KB |
| Secrets | Secrets Manager (rotation) vs Parameter Store (config, SecureString) |
| Load balancer | listener → rule → target group → health check; deregistration delay 300 s default |
| ALB vs NLB | layer 7 routing, WAF, auth vs layer 4, static IPs, PrivateLink |
| API Gateway vs ALB | per-request, auth/throttling, 29 s default timeout, 10 MB vs hourly, long/streaming |
| S3 | objects by key, ~50 TB max object, strong consistency, private + encrypted by default |
| SQS | 1 MiB messages, 4-day default retention (max 14), visibility timeout 30 s default (max 12 h), DLQ |
| SNS / EventBridge | push fan-out to subscribers / content-based routing, schedules, archive + replay |
| Idempotency | stable key + atomic conditional write |
| Observability | metrics (how much), logs (what), traces (where), CloudTrail (who) |
| DR | backup & restore → pilot light → warm standby → active/active; set RTO/RPO first |

## Official references

- AWS global infrastructure: https://aws.amazon.com/about-aws/global-infrastructure/
- Amazon VPC user guide: https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html
- Regional NAT gateways: https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateways-regional.html
- IAM user guide: https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html
- IAM policy evaluation logic: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html
- STS AssumeRole: https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html
- KMS concepts and key rotation: https://docs.aws.amazon.com/kms/latest/developerguide/rotate-keys.html
- Elastic Load Balancing: https://docs.aws.amazon.com/elasticloadbalancing/
- API Gateway quotas: https://docs.aws.amazon.com/apigateway/latest/developerguide/limits.html
- Amazon S3 objects: https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingObjects.html
- SQS quotas: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html
- Amazon EventBridge: https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-what-is.html
- Amazon CloudWatch: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/WhatIsCloudWatch.html
- AWS CloudTrail: https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-user-guide.html
- Well-Architected Framework: https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html
