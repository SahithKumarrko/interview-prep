# Terraform: L2 → L3 Interview Preparation

> **Updated:** 24 October 2026 (Terraform 1.x; AWS provider v6) · **Level:** IaC basics → state & modules → safe production workflows
> **How to use:** *Short answer* = what you say first. *Explanation / Example* = intuition and HCL. *Pitfall / Follow-up* = where interviewers dig.

---

## Table of contents

1. [Mental model: how Terraform works](#1-mental-model-how-terraform-works)
2. [Fundamentals](#2-fundamentals) (Q01–Q09)
3. [Language features](#3-language-features) (Q10–Q17)
4. [State in depth](#4-state-in-depth) (Q18–Q25)
5. [Modules & project structure](#5-modules--project-structure) (Q26–Q29)
6. [Security, testing & CI/CD](#6-security-testing--cicd) (Q30–Q35)
7. [Scenario & debugging questions](#7-scenario--debugging-questions) (Q36–Q41)
8. [Cheat sheet](#8-cheat-sheet)

---

## 1. Mental model: how Terraform works

**Terraform is declarative:** you describe the **desired end state**; Terraform computes the difference from reality and makes API calls to close the gap.

```
   *.tf files (desired state)          terraform.tfstate (what TF created & last saw)        Real AWS
  ┌──────────────────────────┐        ┌────────────────────────────────────┐        ┌─────────────────┐
  │ resource "aws_s3_bucket" │        │ aws_s3_bucket.logs:                │        │ bucket          │
  │   "logs" { ... }         │        │   id = "acme-logs", arn = ...      │        │ "acme-logs"     │
  └────────────┬─────────────┘        └──────────────────┬─────────────────┘        └────────┬────────┘
               │                                         │                                  │
               └──────────────────────┬──────────────────┴────────────── refresh (read) ────┘
                                      ▼
                          terraform plan = diff(config, state+reality)
                          + create   ~ update in-place   -/+ replace   - destroy
                                      ▼
                          terraform apply → provider plugin → AWS APIs → update state
```

**Building blocks:**
```
 Terraform CLI (core) ── builds dependency GRAPH, plans, applies in parallel
      │ gRPC
      ▼
 Providers (plugins: aws, kubernetes, gitlab, random…) ── translate resources into API calls
      │
 Backend ── where state lives (S3 with locking, HCP Terraform, GitLab-managed state)
```

**Workflow:** `init` (download providers/modules, configure backend) → `fmt` / `validate` → `plan` (preview) → `apply` (execute) → `destroy` (when needed).

---

## 2. Fundamentals

### Q01. What is Infrastructure as Code and why Terraform?

**Short answer:** IaC = defining infrastructure in version-controlled code instead of console clicks → reviewable (PRs), repeatable (same code → same environment), auditable (git history), automatable (CI/CD). Terraform: declarative HCL, huge provider ecosystem (multi-cloud + SaaS), plan before apply, state tracking, modules.

| Tool | Notes |
|---|---|
| Terraform / OpenTofu (open-source fork) | declarative HCL, multi-provider |
| CloudFormation / CDK | AWS-native; CDK uses real programming languages and synthesises CloudFormation |
| Pulumi | general-purpose languages, multi-cloud |

---

### Q02. Providers, resources and data sources

**Short answer:**
- **Provider** — plugin that talks to an API (`aws`), configured with region/credentials.
- **Resource** — something Terraform **creates and manages** (`aws_s3_bucket`).
- **Data source** — something Terraform **reads** but doesn't manage (existing VPC, latest AMI, current account ID).

```hcl
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
}

provider "aws" {
  region = "ap-south-1"
  default_tags { tags = { owner = "payments", managed_by = "terraform" } }
}

data "aws_caller_identity" "current" {}
data "aws_vpc" "main" { tags = { Name = "main" } }

resource "aws_s3_bucket" "docs" {
  bucket = "acme-docs-${data.aws_caller_identity.current.account_id}"
}
```

---

### Q03. What is Terraform state and why does it exist?

**Short answer:** State (`terraform.tfstate`, JSON) maps each resource **address** in your code (`aws_s3_bucket.docs`) to the **real object** (bucket name/ARN) and stores last-known attributes. Terraform needs it to know what it owns, to compute diffs, track dependencies, and for performance.

**Important facts:**
- State can contain **secrets** in plain text (DB passwords, keys) → store it encrypted with restricted access.
- Never keep production state locally or in git → use a **remote backend** with locking.
- Without state, Terraform would try to create everything again.

---

### Q04. `init`, `fmt`, `validate`, `plan`, `apply`

| Command | Does |
|---|---|
| `terraform init` | download providers/modules, configure backend, write `.terraform.lock.hcl` |
| `terraform fmt -check` | canonical formatting (CI check) |
| `terraform validate` | syntax and internal consistency (no API calls) |
| `terraform plan -out=tfplan` | refresh + diff; save the exact plan |
| `terraform apply tfplan` | apply exactly the reviewed plan |
| `terraform destroy` | delete everything in this state |
| `terraform output`, `state list`, `show` | inspect |

**Rule:** in CI, apply a **saved plan file** so what was reviewed is what runs.

---

### Q05. Reading a plan

```
  # aws_ecs_service.api will be updated in-place
  ~ resource "aws_ecs_service" "api" {
      ~ task_definition = "api:41" -> (known after apply)
    }
  # aws_db_instance.main must be replaced
-/+ resource "aws_db_instance" "main" {
      ~ engine_version = "15.4" -> "16.3" # forces replacement
    }
Plan: 1 to add, 1 to change, 1 to destroy.
```
Always look for **`-/+` (replace)** and **`-` (destroy)** on stateful resources (databases, buckets, EFS) and for "forces replacement" notes.

---

### Q06. Variables, locals and outputs

```hcl
variable "environment" {
  type        = string
  description = "Deployment environment"
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging or prod."
  }
}
variable "db_password" { type = string, sensitive = true }

locals {
  name_prefix = "payments-${var.environment}"          # computed once, reused
  is_prod     = var.environment == "prod"
}

output "bucket_arn" { value = aws_s3_bucket.docs.arn }
```
Inputs: `-var`, `*.tfvars`, `TF_VAR_name` env vars. `sensitive = true` hides values in CLI output (but **not** from state).

---

### Q07. The dependency graph and `depends_on`

**Short answer:** Terraform builds a graph from **references** (`aws_subnet.a.id` used in an instance → subnet first) and creates independent resources in parallel. `depends_on` adds a dependency Terraform can't infer (e.g., an IAM policy attachment that must exist before a Lambda runs). Overusing `depends_on` makes plans slower and values unknown longer.

---

### Q08. `count` vs `for_each`

**Short answer:** Both create multiple instances. `count` indexes by **number** (`[0]`, `[1]`) — removing an item from the middle shifts indexes and **recreates** the following resources. `for_each` keys by **string/map key** — stable identity. Prefer `for_each` for collections.

```hcl
# ❌ removing "b" re-creates "c" (index 2 → 1)
resource "aws_sqs_queue" "q" {
  count = length(var.names)
  name  = var.names[count.index]
}

# ✅ stable keys
resource "aws_sqs_queue" "q" {
  for_each = toset(var.names)          # or a map of objects
  name     = each.key
}

# count is still fine for on/off toggles
resource "aws_cloudwatch_dashboard" "d" { count = local.is_prod ? 1 : 0 ... }
```

---

### Q09. `lifecycle` settings

```hcl
resource "aws_db_instance" "main" {
  # ...
  lifecycle {
    prevent_destroy       = true                 # plan errors if it would be destroyed
    create_before_destroy = false
    ignore_changes        = [tags["LastBackup"]] # changed outside TF by design
    replace_triggered_by  = [aws_kms_key.db.id]
    precondition {
      condition     = var.environment != "prod" || self.multi_az
      error_message = "Prod DB must be Multi-AZ."
    }
  }
}
```
- `create_before_destroy` — build the replacement first (zero-downtime for e.g. launch templates, certs); names must not collide.
- `ignore_changes` — for attributes managed elsewhere (ECS `desired_count` by autoscaling, `task_definition` by CI deploys). Overuse hides drift.

---

## 3. Language features

### Q10. Expressions you should know

```hcl
locals {
  subnet_ids   = [for s in aws_subnet.private : s.id]                    # for expression
  by_az        = { for s in aws_subnet.private : s.availability_zone => s.id }
  public_names = [for n, cfg in var.services : n if cfg.public]          # filter
  image        = coalesce(var.image_override, "${aws_ecr_repository.api.repository_url}:${var.tag}")
}
# splat: aws_instance.web[*].id   conditional: var.x ? a : b
# functions: merge, lookup, try, can, jsonencode, templatefile, cidrsubnet, format
```

---

### Q11. Dynamic blocks

```hcl
resource "aws_security_group" "api" {
  dynamic "ingress" {
    for_each = var.allowed_cidrs
    content {
      from_port   = 443
      to_port     = 443
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
    }
  }
}
```
Use sparingly — readability suffers.

---

### Q12. Multiple accounts and regions

```hcl
provider "aws" { region = "ap-south-1" }
provider "aws" {
  alias  = "dr"
  region = "ap-southeast-1"
  assume_role { role_arn = "arn:aws:iam::222222222222:role/terraform-deploy" }
}
resource "aws_s3_bucket" "replica" { provider = aws.dr ... }

# Pass aliased providers into a module
module "dr_bucket" {
  source    = "./modules/bucket"
  providers = { aws = aws.dr }
}
```
AWS provider v6 also allows a per-resource `region` argument for multi-region within one provider configuration.

---

### Q13. Importing existing resources

**Short answer:** Bring manually created resources under Terraform management without recreating them. Modern way: `import` blocks (reviewable in plan), optionally generating config.

```hcl
import {
  to = aws_s3_bucket.legacy
  id = "acme-legacy-bucket"
}
```
```bash
terraform plan -generate-config-out=generated.tf   # draft HCL for imported resources; then clean it up
```
Then plan until there are **no changes** — confirms code matches reality.

---

### Q14. `moved` and `removed` blocks (refactoring safely)

```hcl
moved {                                  # renamed/moved into module → no destroy/recreate
  from = aws_s3_bucket.docs
  to   = module.storage.aws_s3_bucket.docs
}

removed {                                # stop managing, but DON'T delete the real resource
  from = aws_s3_bucket.old_logs
  lifecycle { destroy = false }
}
```
Replaces risky manual `terraform state mv` / `state rm` with reviewable code.

---

### Q15. Ephemeral values and write-only arguments (newer Terraform)

**Short answer:** Newer Terraform (1.10+) adds **ephemeral** variables/outputs/resources whose values are **never written to state or plan** (e.g., fetch a secret, generate a temporary token), and (1.11+) **write-only arguments** (e.g., `password_wo` on `aws_db_instance`) to send a secret to a resource without storing it in state. This closes the classic "secrets in state" problem.

```hcl
ephemeral "aws_secretsmanager_secret_version" "db" { secret_id = aws_secretsmanager_secret.db.id }

resource "aws_db_instance" "main" {
  password_wo         = ephemeral.aws_secretsmanager_secret_version.db.secret_string
  password_wo_version = 1          # bump to rotate
}
```
Alternatively let AWS manage it: `manage_master_user_password = true` (RDS stores it in Secrets Manager).

---

### Q16. Unknown values ("known after apply")

Some attributes (IDs, ARNs, IPs) exist only after creation, so the plan shows `(known after apply)`. Dependent resources may then show changes that only resolve at apply. Using unknown values in `count`/`for_each` keys causes errors ("value depends on resource attributes that cannot be determined until apply") — use static keys.

---

### Q17. Checks and validations

`variable` validation, `precondition`/`postcondition` in lifecycle, and `check` blocks (assertions reported as warnings, e.g., "health endpoint returns 200 after apply").

---

## 4. State in depth

### Q18. Remote backend with locking (S3)

**Short answer:** Store state in S3 (versioned, encrypted, private) and enable locking so two applies can't run at once. Terraform 1.10+ supports **S3 native locking** (`use_lockfile = true`, a lock object in the bucket); the older DynamoDB-table locking is deprecated.

```hcl
terraform {
  backend "s3" {
    bucket       = "acme-tfstate-prod"
    key          = "payments/api/terraform.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true          # S3-native state locking
  }
}
```
Bucket: versioning ON (recover old state), SSE-KMS, block public access, tight bucket policy, access logging. If a run crashes and leaves a lock: `terraform force-unlock <id>` only after confirming nothing is running.

---

### Q19. Drift — detection and handling

**Short answer:** Drift = real infrastructure differs from code/state (someone changed it in the console, or another tool/autoscaling did). Detect with scheduled `terraform plan -detailed-exitcode` (exit 2 = changes) or `plan -refresh-only`. Then decide: **revert** (apply code), **adopt** (update code to match), or **ignore** (`ignore_changes` if managed elsewhere). Prevent with SCPs/IAM restricting console writes, and change processes.

---

### Q20. Workspaces — and their limits

**Short answer:** CLI workspaces give multiple **state files** for the same configuration (`terraform workspace new staging`; `terraform.workspace` in code). Fine for short-lived copies (feature environments). For dev/staging/prod they're weak: same backend, same credentials, easy to apply to the wrong one, environments can't differ structurally. Prefer **separate directories/root modules per environment** (or separate accounts + state files), sharing modules.

---

### Q21. `-target` and manual state edits — risks

`-target` applies part of the graph, leaving the rest inconsistent; fine for emergencies, not routine. `terraform state rm/mv` and editing JSON can orphan or duplicate resources. Prefer `moved`/`removed`/`import` blocks; back up state (S3 versioning) before any manual operation.

---

### Q22. Splitting and migrating state

Split large states by **blast radius and lifecycle** (network, data, compute per service). Move resources between states with `removed` (destroy=false) in the old + `import` in the new, or `terraform state mv -state-out` carefully. Plan both sides to confirm no create/destroy.

---

### Q23. Sharing data between states

Use **data sources** (look up by tag/name), SSM Parameter Store outputs, or `terraform_remote_state` (reads another state's outputs — couples teams to state access). Prefer explicit published outputs (SSM) for loose coupling.

---

### Q24. State security

State may hold secrets and resource details → encrypt (SSE-KMS), restrict IAM to CI roles, enable versioning, never commit to git, use ephemeral/write-only for secrets, separate state per environment/account.

---

### Q25. `.terraform.lock.hcl`

Records exact provider versions + checksums chosen by `init`. Commit it → every machine/CI uses identical providers. Upgrade deliberately with `terraform init -upgrade`.

---

## 5. Modules & project structure

### Q26. What is a module and how do you design one?

**Short answer:** A module is a folder of `.tf` files with inputs (variables) and outputs; the root module calls child modules. Good modules have a **clear purpose**, a small set of meaningful inputs, safe defaults, outputs others need, pinned versions, and no hidden provider configuration.

```hcl
module "api_service" {
  source  = "git::https://gitlab.example.com/platform/tf-modules.git//ecs-service?ref=v2.3.0"
  name          = "api"
  image         = var.api_image
  cpu           = 512
  memory        = 1024
  desired_count = 3
  subnet_ids    = module.network.private_subnet_ids
  target_group_arn = module.alb.target_group_arns["api"]
}
```

---

### Q27. Repository layout

```
infra/
├── modules/                    # reusable, versioned
│   ├── network/  ecs-service/  rds/  agentcore-runtime/
└── live/                       # root modules = deployable units, one state each
    ├── prod/
    │   ├── network/      (backend key prod/network)
    │   ├── data/         (rds, s3)
    │   └── services/api/
    └── staging/ ...
```
Split by environment and by component lifecycle (network rarely changes; services change daily). Tools like Terragrunt or HCP Terraform Stacks help orchestrate many states.

---

### Q28. Module boundaries for ECS workloads

- **Platform module** (once per env): VPC, ECS cluster, ALB, shared security groups, log groups.
- **Service module** (per service): task definition, service, autoscaling, target group/listener rule, IAM task role, alarms.
- **Deploy concern:** CI updates the image; Terraform owns infra. Use `ignore_changes = [task_definition]` if CI registers task definitions, or let Terraform own it with the image tag as a variable — but pick **one owner**.

---

### Q29. Public registry modules — use or not?

`terraform-aws-modules/*` are well-maintained and save time, but pin versions, read the code, and wrap them in a thin internal module if you need organisational defaults (tags, encryption, logging).

---

## 6. Security, testing & CI/CD

### Q30. Handling secrets in Terraform

Don't put secrets in `.tf`/`tfvars` in git. Options in order of preference: let AWS generate/manage (RDS `manage_master_user_password`), ephemeral resources + write-only arguments, create the secret *container* in Terraform and set the value outside, `sensitive = true` (only hides output). Remember: anything in state is readable by whoever can read state.

---

### Q31. Validating beyond syntax

| Layer | Tool |
|---|---|
| Format / syntax | `terraform fmt -check`, `validate` |
| Lint | TFLint (provider-specific rules, e.g., invalid instance types) |
| Security / compliance | Checkov, Trivy (tfsec), KICS |
| Policy as code on the plan | OPA/Conftest, Sentinel (HCP), on `terraform show -json` |
| Unit/integration tests | **`terraform test`** (`*.tftest.hcl`, can mock providers), Terratest (Go) |
| Cost | Infracost on the plan |

```hcl
# tests/bucket.tftest.hcl
run "bucket_is_encrypted" {
  command = plan
  assert {
    condition     = aws_s3_bucket_server_side_encryption_configuration.docs.rule[0].apply_server_side_encryption_by_default[0].sse_algorithm == "aws:kms"
    error_message = "Bucket must use KMS encryption"
  }
}
```

---

### Q32. Secure Terraform execution in CI

OIDC short-lived credentials (no static keys); **separate roles**: read-only for `plan` on MRs, write role for `apply` only on protected branch/environment; one state lock per environment + `resource_group`; apply the saved plan; pinned providers/modules; protected `.gitlab-ci.yml`; audit with CloudTrail; restrict state bucket access to these roles.

---

### Q33. Zero-downtime replacements

When a change forces replacement: `create_before_destroy` for stateless resources (launch templates, certs, target groups — needs unique/prefix names), blue/green at the service level, for databases avoid replacement entirely (in-place modifications, snapshots, migration plans). Check the plan for `-/+` before apply.

---

### Q34. `prevent_destroy` and other guardrails for prod

`prevent_destroy` on stateful resources, deletion protection flags (RDS, ALB, DynamoDB), S3 `force_destroy = false`, plan review policies that fail on destroying tagged critical resources, IAM deny for `Delete*` on protected resources outside break-glass.

---

### Q35. Terraform vs CloudFormation/CDK — trade-offs

Terraform: multi-cloud/SaaS providers, explicit state, plan output, large community; you manage state. CloudFormation: AWS-managed state, stack rollback, StackSets, drift detection; AWS-only, sometimes slower to support new features. CDK: real languages and abstractions over CloudFormation. Pick per organisation standards and team skills.

---

## 7. Scenario & debugging questions

### Q36. Plan wants to destroy a production resource unexpectedly

**Stop — don't apply.** Read *why*: renamed resource or module path (→ `moved` block), `count` index shift (→ `for_each`), attribute that forces replacement (→ revert or plan migration), provider upgrade changed defaults (→ pin/adjust), wrong workspace/backend key (→ check `init` output), resource removed from code by mistake. Fix in code until the plan shows no destroy; add `prevent_destroy` going forward.

---

### Q37. ECS task definition changes but the service doesn't deploy new tasks

`ignore_changes = [task_definition]` on the service; the service references an old revision/data source; deployment circuit breaker rolled back (check service events); new tasks failing health checks; image tag unchanged (`latest`) so nothing new was pulled → use immutable tags / `force_new_deployment`.

---

### Q38. "Error acquiring the state lock"

Another run is active (wait) or a crashed run left the lock. Confirm in CI that no apply is running, then `terraform force-unlock <LOCK_ID>`. Prevent with `resource_group` and one pipeline per environment.

---

### Q39. Someone changed a security group in the console

`plan` shows drift. Determine if the change was an emergency fix (adopt into code via PR) or unauthorised (revert by apply, investigate via CloudTrail). Add drift detection schedule and restrict console write permissions.

---

### Q40. Provider upgrade breaks plans

Read the provider upgrade guide (major versions rename/remove arguments), upgrade in a branch with `init -upgrade`, fix deprecations, run plans for every environment and confirm no unexpected replacements, then merge the new lockfile.

---

### Q41. Bootstrap an enterprise multi-account AWS platform

```
 Management account ── AWS Organizations + IAM Identity Center (SSO) + SCPs
   ├── Security OU: log-archive (CloudTrail org trail, Config), security-tooling (GuardDuty, Security Hub)
   ├── Infrastructure OU: network (Transit Gateway, shared VPCs, DNS), shared-services (CI runners, ECR)
   └── Workloads OU: payments-dev / -staging / -prod accounts
 Tools: Control Tower / Account Factory for Terraform (AFT) to vend accounts with baselines
 Terraform: state bucket per account/env, OIDC roles per pipeline, modules for baselines
```
Explain: blast-radius isolation per account, centralised logging/security, guardrails via SCPs, automated account vending.

---

## 8. Cheat sheet

| Concept | One-liner |
|---|---|
| Declarative | describe desired state; TF diffs and converges |
| State | maps code addresses → real IDs; may contain secrets |
| Backend | S3 + `use_lockfile`, encrypted, versioned |
| Plan symbols | `+` create, `~` update, `-/+` replace, `-` destroy |
| Resource vs data | manage vs read |
| `for_each` > `count` | stable keys, no index shift |
| lifecycle | prevent_destroy, create_before_destroy, ignore_changes |
| Refactor | `moved`, `removed`, `import` blocks |
| Secrets | ephemeral + write-only, AWS-managed passwords |
| Drift | scheduled plan; revert/adopt/ignore |
| Workspaces | not for prod env separation |
| Modules | clear inputs/outputs, pinned versions |
| Testing | validate, TFLint, Checkov, `terraform test`, OPA on plan |
| CI | OIDC, plan role vs apply role, saved plan, one lock per env |

## Official references

- https://developer.hashicorp.com/terraform/docs
- State & backends: https://developer.hashicorp.com/terraform/language/state · https://developer.hashicorp.com/terraform/language/backend/s3
- Refactoring (`moved`): https://developer.hashicorp.com/terraform/language/modules/develop/refactoring
- Import blocks: https://developer.hashicorp.com/terraform/language/import
- Ephemeral & write-only: https://developer.hashicorp.com/terraform/language/manage-sensitive-data
- Tests: https://developer.hashicorp.com/terraform/language/tests
- AWS provider: https://registry.terraform.io/providers/hashicorp/aws/latest/docs
