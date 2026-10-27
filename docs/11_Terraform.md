# Terraform: Interview Preparation

> **Updated:** 27 October 2026 (Terraform 1.x; AWS provider v6) · **Level:** infrastructure-as-code basics → language → state & modules → safe production workflows
> **How to use:** read the *Short answer* first, then *How it works* and the *Example* walkthrough. *Common mistake → fix* shows what goes wrong in real projects. *Interview answer* is what you can say out loud. Version-specific features are marked with the version that introduced them.

---

## Table of contents

1. [Mental model: how Terraform works](#1-mental-model-how-terraform-works)
2. [Fundamentals](#2-fundamentals) (Q01–Q12)
3. [Language features](#3-language-features) (Q13–Q20)
4. [State in depth](#4-state-in-depth) (Q21–Q28)
5. [Modules & project structure](#5-modules--project-structure) (Q29–Q33)
6. [Security, testing & CI/CD](#6-security-testing--cicd) (Q34–Q39)
7. [Scenario & debugging questions](#7-scenario--debugging-questions) (Q40–Q45)
8. [Cheat sheet](#8-cheat-sheet)

---

## 1. Mental model: how Terraform works

**The one idea everything else follows from:** you write down the infrastructure you **want** (a bucket, a database, a network) in text files, and Terraform works out what has to change to make reality match, then makes those changes through the cloud's APIs. You describe the destination, not the steps. This is called **declarative** infrastructure as code.

Think of a thermostat. You don't tell it "turn the heater on for ten minutes"; you set 21 degrees, and it compares the room to that target and acts only when they differ. Terraform does the same for infrastructure. To compare, it needs a record of what it has already built, called **state**.

```flow
pipeline: What terraform plan and terraform apply do
stage: terraform plan
Read the configuration > The .tf files describe the desired infrastructure, for example one S3 bucket named acme-logs.
Read the state > The state file records what Terraform has already created and the real IDs.
Refresh from the cloud > Terraform asks AWS what actually exists now, so it notices changes made by hand.
Compute the difference > The plan lists + to create, ~ to update in place, -/+ to replace, - to destroy.
stage: terraform apply
Call the provider plugin > The AWS provider turns each change into AWS API calls, in dependency order and in parallel where possible.
Update the state > After each success the state file records the new real IDs and attributes.
```

**Building blocks:**
- **Terraform CLI (core):** reads your files, builds a **dependency graph**, computes the plan, and runs it.
- **Providers:** plugins (aws, kubernetes, gitlab, random …) that translate resources into API calls.
- **State and backend:** the record of what exists, and where it is stored (an S3 bucket with locking, HCP Terraform, or GitLab-managed state).

**Three rules that come straight from this model:**
1. **The plan is a preview you must read.** `-/+` (replace) and `-` (destroy) on stateful things such as databases are where outages begin.
2. **State is the memory.** If state and reality disagree (drift) or state is lost, Terraform makes wrong decisions. Protect it like production data.
3. **Terraform manages only what it created or imported.** It will not touch what it does not know about, and it will overwrite changes made by hand to what it does manage.

---

## 2. Fundamentals

### Q01. What is Infrastructure as Code, and why Terraform?

**Short answer:** **Infrastructure as Code (IaC)** means defining servers, networks, databases and permissions in version-controlled text files instead of clicking in a console. That makes infrastructure reviewable (merge requests), repeatable (the same code builds the same environment), auditable (git history) and automatable (CI/CD). **Terraform** is HashiCorp's IaC tool: declarative, uses the HCL language, works with thousands of providers (AWS, Azure, Kubernetes, SaaS products), and shows a **plan** before it changes anything.

**How it works:**
1. You write `.tf` files.
2. A teammate reviews the change in a merge request, together with the plan output.
3. The pipeline runs `terraform apply`; the infrastructure changes; the state file records the result.
4. To build a second environment you run the same code with different input values.

| Tool | Notes |
|---|---|
| Terraform / OpenTofu (open-source fork) | declarative HCL, many providers, you manage state |
| CloudFormation | AWS-native; AWS manages state; AWS only |
| AWS CDK | real programming languages that generate CloudFormation |
| Pulumi | general-purpose languages, multi-cloud |

**Example:** the whole infrastructure for a small log bucket:
```hcl
resource "aws_s3_bucket" "logs" {
  bucket = "acme-logs-prod"
}
```

**What happens, step by step:**
1. `terraform apply` sees no `aws_s3_bucket.logs` in state, so the plan says `+ create`.
2. After approval, the AWS provider calls `CreateBucket` for `acme-logs-prod`.
3. State now records `aws_s3_bucket.logs` with id `acme-logs-prod`.
4. Running `terraform apply` again prints `No changes`: the code matches reality. That property (apply twice, nothing happens the second time) is called **idempotency**.

**Common mistake → fix:** creating "just one resource" by hand in the console and later wondering why the code and reality differ. Fix: make every change through code, and restrict console write access in production.

**Interview answer:** "IaC means describing infrastructure in version-controlled code so it's reviewable, repeatable and auditable. Terraform is a declarative tool: I write the desired state in HCL, it compares that with the recorded state and the real cloud, shows a plan, and applies only the difference. Its provider ecosystem covers multiple clouds and SaaS, which is its main advantage over AWS-only tools."

**Follow-ups:**
- *Declarative vs imperative?* Declarative says what the end result should be and the tool works out the steps; imperative scripts list the steps, and re-running them can duplicate things.

---

### Q02. What is HCL, and what do Terraform files look like?

**Short answer:** **HCL** (HashiCorp Configuration Language) is the readable, JSON-like language used in `.tf` files. A file is made of **blocks** (`resource`, `variable`, `output`, `provider`, `module`, `data`, `locals`, `terraform`), each with a type, optional labels, and a body of **arguments** (`name = value`). Terraform loads **all** `.tf` files in a folder together as one **module**, so file names are for humans only.

**How it works:**
- Block syntax: `block_type "label1" "label2" { arguments }`. A `resource` has two labels: the resource type and your local name.
- Reference another thing with `<type>.<name>.<attribute>`, for example `aws_s3_bucket.logs.arn`. A reference also tells Terraform the dependency order (Q10).
- Strings use interpolation: `"logs-${var.environment}"`. Comments start with `#` or `//`.
- Common layout: `main.tf` (resources), `variables.tf`, `outputs.tf`, `versions.tf` (provider requirements).

**Example:**
```hcl
variable "environment" {
  type    = string
  default = "dev"
}

resource "aws_s3_bucket" "logs" {
  bucket = "acme-logs-${var.environment}"
  tags = {
    env = var.environment
  }
}

output "logs_bucket_arn" {
  value = aws_s3_bucket.logs.arn
}
```

**What happens, step by step:**
1. Terraform reads the three blocks and finds that the resource uses `var.environment`, so the variable must be known first.
2. With the default, the bucket name becomes `acme-logs-dev`.
3. The `output` block refers to `aws_s3_bucket.logs.arn`, an attribute that only exists after creation, so the plan shows `logs_bucket_arn = (known after apply)`.
4. After apply, the output prints `arn:aws:s3:::acme-logs-dev`.

**Common mistake → fix:** writing arguments of a single-line block with commas (`variable "x" { type = string, default = "a" }`). HCL doesn't allow commas between arguments in blocks. Fix: put each argument on its own line (commas are for lists and maps).

**Interview answer:** "HCL is Terraform's configuration language: blocks with types and labels containing arguments, plus expressions to reference other objects. Terraform merges all .tf files in a directory into one module, and references like aws_s3_bucket.logs.arn both read values and define dependency order."

**Follow-ups:**
- *Can I use JSON instead?* Yes, `.tf.json` files are supported, mostly for generated configuration.

---

### Q03. What is a provider, and how do you pin versions?

**Short answer:** A **provider** is a plugin that knows how to talk to one API (AWS, Kubernetes, GitLab, Datadog). It contributes the **resource types** and **data sources** you can use (`aws_s3_bucket`, `aws_vpc` …) and holds the connection settings (region, credentials). Terraform core itself knows nothing about AWS. You declare providers in `required_providers` with a **version constraint**, and `terraform init` downloads them and records the exact versions in `.terraform.lock.hcl` (Q28).

**How it works:**
- `required_providers` says where to get the plugin (`source = "hashicorp/aws"`, from the Terraform Registry) and which versions are acceptable.
- Version constraints: `"~> 6.0"` means any `6.x` version at or above 6.0 but below 7.0; `">= 6.2, < 7.0"` is explicit.
- The `provider "aws" {}` block configures it: region, default tags, how to authenticate (preferably from the environment or an assumed role, never hard-coded keys).
- `required_version` pins the Terraform CLI version itself.

**Example:**
```hcl
terraform {
  required_version = ">= 1.11"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = "ap-south-1"
  default_tags {
    tags = { owner = "payments", managed_by = "terraform" }
  }
}
```

**What happens, step by step:**
1. `terraform init` reads `required_providers`, downloads the newest AWS provider matching `~> 6.0` (say 6.30.0) into `.terraform/`, and writes that exact version plus checksums into `.terraform.lock.hcl`.
2. Everyone else who runs `init` (and CI) gets 6.30.0 from the lock file, even if 6.31.0 has since been released.
3. `default_tags` adds the two tags to every taggable AWS resource created by this provider, without repeating them.
4. If the code uses a feature from a newer Terraform than `required_version` allows, `init` stops with a clear message instead of failing halfway through an apply.

**Common mistake → fix:** no version constraint (`aws = { source = "hashicorp/aws" }`). A new major provider version can rename arguments and break plans on the next `init -upgrade`. Fix: constrain to a major version (`~> 6.0`) and commit the lock file.

**Interview answer:** "A provider is a plugin that maps Terraform resources to an API such as AWS. I declare providers in required_providers with a pessimistic constraint like ~> 6.0, configure region and default tags in the provider block, and commit the lock file so every machine and CI run uses identical provider versions. Credentials come from the environment or an assumed role, not from the code."

**Follow-ups:**
- *What does `~> 6.0` allow versus `~> 6.2.0`?* The first allows 6.x from 6.0; the second allows only 6.2.x patch releases.

---

### Q04. What is a resource?

**Short answer:** A **resource** block declares one piece of infrastructure that Terraform should **create and manage**: a bucket, a VPC, a database, an IAM role. Its address is `<type>.<name>` (for example `aws_s3_bucket.docs`). Terraform creates it when it appears in code, updates it when arguments change, and destroys it when the block is removed.

**How it works:**
- The **type** (`aws_s3_bucket`) comes from the provider and decides which arguments exist. The **name** (`docs`) is your local label, unique per type within the module.
- **Arguments** are inputs you set; **attributes** are values you can read, including ones set by the cloud after creation (`id`, `arn`).
- When an argument can be updated in place, Terraform updates it; when it cannot (for example an RDS engine family), Terraform plans a **replacement** (destroy and create), flagged "forces replacement".

**Example:**
```hcl
data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "docs" {
  bucket = "acme-docs-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_versioning" "docs" {
  bucket = aws_s3_bucket.docs.id
  versioning_configuration {
    status = "Enabled"
  }
}
```

**What happens, step by step:**
1. The account ID is read (Q05), say `123456789012`, giving the bucket name `acme-docs-123456789012`.
2. `aws_s3_bucket_versioning.docs` refers to `aws_s3_bucket.docs.id`, so Terraform creates the bucket first, then turns versioning on.
3. State now holds both resources under their addresses.
4. If you later rename the label `docs` to `documents` in code, Terraform sees `docs` missing and `documents` new, and plans to destroy the bucket and create a new one, unless you add a `moved` block (Q17).

**Common mistake → fix:** renaming a resource block casually. The name is part of its identity in state. Fix: use `moved { from = ...  to = ... }` for any rename or refactor.

**Interview answer:** "A resource block declares infrastructure Terraform creates and manages, addressed as type.name. I set arguments, and read attributes like arn and id from it. Terraform updates in place when it can and replaces the resource when an argument forces it, and the address is its identity in state, so renames need a moved block."

**Follow-ups:**
- *Why is versioning a separate resource?* In AWS provider v4 and later, S3 bucket settings were split into their own resources, so each setting is managed independently.

---

### Q05. What is a data source?

**Short answer:** A **data source** (`data "..." "..." {}`) **reads** information about something that already exists, or about the environment, without managing it: an existing VPC found by tag, the newest AMI, the current AWS account ID. Resources create things; data sources look things up.

**How it works:**
- Terraform runs the lookup during plan (or refresh) and exposes the result as `data.<type>.<name>.<attribute>`.
- If the lookup depends on something not created yet, it is deferred until apply and its values show as "known after apply".
- A data source never changes or deletes the object it reads.

**Example:**
```hcl
data "aws_vpc" "main" {
  tags = { Name = "main" }
}

data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }
}

resource "aws_instance" "web" {
  ami           = data.aws_ami.al2023.id
  instance_type = "t3.micro"
  subnet_id     = data.aws_subnets.private.ids[0]
}
```
(`data.aws_subnets.private` would be another lookup, e.g. subnets in the VPC above filtered by tag.)

**What happens, step by step:**
1. During plan, Terraform calls AWS `DescribeVpcs` and finds the VPC tagged `main` (id `vpc-0a1b2c`).
2. It searches for the newest Amazon Linux 2023 AMI and gets `ami-0abc123`.
3. The instance is planned with that AMI. Next month a newer AMI is released; the next plan shows the instance needs **replacement** because `ami` changed. That is a side effect of `most_recent = true`.
4. If the VPC were deleted by someone, the lookup fails and the plan errors, instead of silently continuing.

**Common mistake → fix:** `most_recent = true` on AMIs in production code, so an unrelated plan suddenly wants to replace servers. Fix: pin the AMI ID through a variable or SSM parameter that you update deliberately, or add `lifecycle { ignore_changes = [ami] }` when replacements are handled elsewhere.

**Interview answer:** "A data source reads existing information, such as a VPC, an AMI or the account ID, without managing it. Resources are created and owned by Terraform; data sources are read-only lookups, evaluated at plan time unless they depend on values only known after apply."

**Follow-ups:**
- *Data source vs import?* Data sources only read; import brings an existing object under Terraform's management so it can be changed (Q16).

---

### Q06. The core workflow: `init`, `fmt`, `validate`, `plan`, `apply`, `destroy`

**Short answer:** Every Terraform change follows the same sequence. **`init`** prepares the working folder (downloads providers and modules, configures the backend). **`fmt`** formats the code. **`validate`** checks syntax and internal consistency without calling any API. **`plan`** shows what would change. **`apply`** makes the changes and updates state. **`destroy`** deletes everything in this state. In CI, save the plan to a file and apply that exact file.

**How it works:**

| Command | Does |
|---|---|
| `terraform init` | downloads providers and modules, configures the backend, writes `.terraform.lock.hcl` |
| `terraform fmt -check -recursive` | fails if files aren't in canonical format (a CI check) |
| `terraform validate` | syntax and type checks; no cloud calls |
| `terraform plan -out=tfplan` | refreshes, diffs, and saves the exact plan |
| `terraform apply tfplan` | applies precisely the saved plan |
| `terraform destroy` | plans and deletes all resources in the state |
| `terraform output`, `state list`, `show` | inspect results and state |

`apply` with no plan file computes a fresh plan and asks for confirmation. If anything changed between the plan you read and the apply, you could approve something different from what you reviewed. A saved plan removes that gap, and Terraform refuses a saved plan whose state has since changed.

**Example:**
```bash
terraform init
terraform fmt -check -recursive
terraform validate
terraform plan -out=tfplan
terraform apply tfplan
```

**What happens, step by step:**
1. `init` downloads the AWS provider into `.terraform/` (it is a large plugin) and connects to the backend.
2. `fmt -check` exits non-zero if any file would be reformatted, failing the CI job early.
3. `validate` catches a typo like `aws_s3_buckets.logs.id` (unknown resource type) in under a second.
4. `plan -out=tfplan` prints "Plan: 2 to add, 0 to change, 0 to destroy" and saves the plan.
5. `apply tfplan` executes exactly those two creations with no prompt, because the plan was already reviewed.

**Common mistake → fix:** running `terraform apply -auto-approve` in a pipeline without a saved plan. It computes and executes a new plan that nobody reviewed. Fix: `plan -out` in one job (reviewed in the merge request), `apply tfplan` in a later protected job.

**Interview answer:** "init prepares providers, modules and backend; fmt and validate catch style and syntax problems without touching the cloud; plan previews changes; apply executes them and records state; destroy tears everything down. In CI I save the plan with -out and apply that file, so what was reviewed is exactly what runs."

**Follow-ups:**
- *Does `validate` need credentials?* No, it only checks the configuration's syntax and internal consistency.

---

### Q07. How do you read a plan?

**Short answer:** A plan lists each change with a symbol: `+` create, `~` update in place, `-/+` replace (destroy then create), `-` destroy. A summary line counts them. Read it before every apply and look hardest at any `-` and `-/+` on stateful resources (databases, buckets, file systems) and at the attribute marked `# forces replacement`.

**How it works:**
- `(known after apply)` marks values that only exist after creation (Q19).
- `(sensitive value)` hides values marked sensitive.
- `<=` marks a data source that will be read, and a note such as `# (moved from ...)` shows a `moved` block at work.

**Example:**
```
  # aws_ecs_service.api will be updated in-place
  ~ resource "aws_ecs_service" "api" {
      ~ desired_count = 2 -> 3
    }

  # aws_db_instance.main must be replaced
-/+ resource "aws_db_instance" "main" {
      ~ engine         = "postgres" -> "mysql"  # forces replacement
      ~ id             = "payments-db" -> (known after apply)
    }

Plan: 1 to add, 1 to change, 1 to destroy.
```

**What happens, step by step:**
1. The ECS service change is `~`: only `desired_count` goes from 2 to 3, an in-place update with no downtime.
2. The database is `-/+`: the engine can't change in place, so Terraform will **destroy the database and create an empty one**. The data would be gone unless you have a snapshot and a migration plan.
3. The summary "1 to add, 1 to change, 1 to destroy" counts the replacement as one add and one destroy.
4. The right response is to stop, not apply, and either revert the engine change or plan a proper migration.

**Common mistake → fix:** skimming the summary and approving because "only 1 to change". Fix: read every `-` and `-/+` and ask "what stateful thing disappears?". Add `prevent_destroy` (Q12) and deletion protection on critical resources so a careless plan errors out.

**Interview answer:** "I read plans for the symbols: plus creates, tilde updates in place, minus-slash-plus replaces, minus destroys. I check anything that destroys or replaces a stateful resource and the attribute noted as forcing replacement, and I treat known after apply values as not yet decided. If a plan destroys something unexpectedly I stop and find out why."

**Follow-ups:**
- *Can I see the plan as JSON?* Yes: `terraform show -json tfplan` feeds policy tools such as OPA and Checkov.

---

### Q08. What is Terraform state, and why does it exist?

**Short answer:** **State** (a JSON file, `terraform.tfstate`) is Terraform's record that maps each resource address in your code (`aws_s3_bucket.docs`) to the **real object** (the bucket's name and ARN), plus its last known attributes. Terraform needs it to know what it owns, to compute the difference between code and reality, and to run quickly without scanning the whole cloud. Without state, Terraform would try to create everything again.

**How it works:**
1. After each apply, Terraform writes the real IDs and attributes into state.
2. On the next plan, it reads state, refreshes each object from the cloud, and compares with your code.
3. State can contain **secrets** in plain text (database passwords, keys). Treat it as sensitive: remote backend, encryption, restricted access, never in git.
4. Local state (a file next to your code) is fine for experiments only. Real projects use a **remote backend** with locking (Q21).

**Example:** after creating a bucket, state contains (simplified):
```json
{
  "resources": [{
    "type": "aws_s3_bucket", "name": "docs",
    "instances": [{ "attributes": { "id": "acme-docs-123456789012", "arn": "arn:aws:s3:::acme-docs-123456789012" } }]
  }]
}
```

```flow
trace: Why state exists
config declares aws_s3_bucket.docs > The code only has a local name and some arguments.
state maps aws_s3_bucket.docs to id **acme-docs-123456789012** > State is the link between the name in code and the real bucket.
rename the block in code without a moved block > Terraform sees the old address gone and a new address with no state.
plan shows destroy of the old bucket and create of a new one > Without the mapping, Terraform cannot know the two blocks are the same bucket.
lose the state file > Terraform no longer knows it owns the bucket, and tries to create it again, which fails or duplicates.
```

**What happens, step by step:**
1. You apply; state records `aws_s3_bucket.docs` with id `acme-docs-123456789012`.
2. You rename the block to `documents`. On plan, Terraform looks up `aws_s3_bucket.documents` in state: nothing.
3. It also finds `aws_s3_bucket.docs` in state with no matching code, so it plans `- destroy docs` and `+ create documents`.
4. A `moved { from = aws_s3_bucket.docs  to = aws_s3_bucket.documents }` block makes the plan a pure state rename.

**Common mistake → fix:** keeping production state on a laptop or committing it to git. Another engineer applies with their own empty state and duplicates or destroys resources; secrets leak via git history. Fix: a remote, encrypted, versioned backend with locking.

**Interview answer:** "State maps resource addresses in code to the real objects and stores their attributes, so Terraform knows what it manages and can diff. It may contain secrets, so I keep it in an encrypted, versioned remote backend with locking, restrict access to CI roles, and never commit it."

**Follow-ups:**
- *What is refresh?* Reading the real objects from the cloud and updating the plan's view of state; `plan -refresh-only` shows only drift.

---

### Q09. Input variables, locals and outputs

**Short answer:** **Input variables** (`variable`) are the parameters of a configuration or module: values the caller supplies. **Locals** (`locals`) are named expressions computed inside the module to avoid repetition. **Outputs** (`output`) are values a module exposes to its caller or prints after apply (a VPC ID, a load balancer DNS name).

**How it works:**
- Variable values are loaded in this order, and later sources win: the variable's `default`, `TF_VAR_name` environment variables, `terraform.tfvars`, `*.auto.tfvars` (alphabetical), then `-var` and `-var-file` in the order given on the command line.
- `type`, `description` and `validation` make variables self-documenting and safe.
- `sensitive = true` hides the value in CLI output. It does **not** keep it out of state.
- Reference them as `var.name`, `local.name`, and (from the parent) `module.x.output_name`.

**Example:**
```hcl
variable "environment" {
  type        = string
  description = "Deployment environment"
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging or prod."
  }
}

variable "db_password" {
  type      = string
  sensitive = true
}

locals {
  name_prefix = "payments-${var.environment}"
  is_prod     = var.environment == "prod"
}

resource "aws_s3_bucket" "docs" {
  bucket = "${local.name_prefix}-docs"
}

output "bucket_arn" {
  value = aws_s3_bucket.docs.arn
}
```

**What happens, step by step:**
1. `terraform plan -var environment=qa` fails at once: `environment must be dev, staging or prod.` No resource is touched.
2. With `-var environment=prod`, `local.name_prefix` becomes `payments-prod` and `local.is_prod` is `true`.
3. The bucket is named `payments-prod-docs`; after apply, `terraform output bucket_arn` prints its ARN.
4. `db_password` shows as `(sensitive value)` in plans, but if it's used in a resource it is still written to state in plain text (Q18 shows how to avoid that).

**Common mistake → fix:** thinking `sensitive = true` protects secrets in state. It only masks CLI output. Fix: protect the state, and use ephemeral values and write-only arguments (Q18) so secrets never reach state.

**Interview answer:** "Variables are inputs with types and validation, locals are computed helper values, and outputs expose values to callers. I validate inputs early, pass values via tfvars files or TF_VAR environment variables, and remember sensitive only hides output, not state contents."

**Follow-ups:**
- *Variable files per environment?* `terraform apply -var-file=prod.tfvars`, or separate root modules per environment (Q31).

---

### Q10. The dependency graph and `depends_on`

**Short answer:** Terraform builds a **graph** from references: if an instance uses `aws_subnet.a.id`, the subnet must exist first. It creates independent resources **in parallel** and destroys in reverse order. You almost never declare order yourself. `depends_on` adds a dependency Terraform can't see (for example, an IAM policy attachment must exist before a Lambda runs), but overusing it makes plans slower and values "known after apply" for longer.

**How it works:**
- Each reference creates an edge: A uses B's attribute means B before A.
- Resources with no path between them run concurrently (default parallelism 10).
- A hidden dependency exists when one resource needs another's *effect* but doesn't read its attributes.

**Example:**
```hcl
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "a" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}

resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "fn" {
  function_name = "fn"
  role          = aws_iam_role.lambda.arn
  # ...
  depends_on = [aws_iam_role_policy_attachment.lambda_logs]
}
```

```flow
trace: The graph decides the order
aws_vpc.main has no dependencies > It is created first, with its ID known only after creation.
aws_subnet.a uses aws_vpc.main.id > The reference creates an edge, so the subnet waits for the VPC.
aws_iam_role_policy_attachment and the VPC are unrelated > They are created in parallel with the VPC.
aws_lambda_function.fn depends_on the attachment > The Lambda reads no attribute of it, so depends_on states the hidden requirement.
terraform destroy > The reverse order runs: the Lambda and subnet first, then the VPC.
```

**What happens, step by step:**
1. Terraform starts the VPC and the policy attachment at the same time.
2. When the VPC finishes, the subnet starts. The Lambda waits for its role and for the attachment.
3. If the Lambda were created before the policy attachment, it could start failing to write logs. `depends_on` guarantees the order.
4. On destroy, the order is reversed, so the VPC is never deleted while the subnet still exists.

**Common mistake → fix:** `depends_on` on a whole module "to be safe". Everything in the module becomes unknown until the dependency applies, causing needless replacements. Fix: depend on specific resources only when a hidden dependency really exists, otherwise use real references.

**Interview answer:** "Terraform infers a dependency graph from references, creates independent resources in parallel and destroys in reverse. I add depends_on only for hidden dependencies, like an IAM policy attachment that has to exist before a function runs, because overuse slows plans and defers values."

**Follow-ups:**
- *Can you see the graph?* `terraform graph | dot -Tsvg > graph.svg` (needs Graphviz).

---

### Q11. `count` vs `for_each`

**Short answer:** Both create multiple copies of a resource. **`count`** addresses copies by **number** (`[0]`, `[1]`, `[2]`), so removing an item from the middle shifts every later index and Terraform plans to **destroy and recreate** them. **`for_each`** addresses copies by a **key** (a string or map key), which stays stable. Use `for_each` for collections of distinct things, and `count` only for an on/off switch (0 or 1).

**How it works:**
- `count = length(var.names)` gives `aws_sqs_queue.q[0]`, `q[1]` …; the position is the identity.
- `for_each = toset(var.names)` or a map gives `aws_sqs_queue.q["orders"]`, `q["emails"]`; inside, `each.key` and `each.value` are available.
- Keys must be known at plan time (Q19).

**Example:**
```hcl
variable "names" {
  type    = list(string)
  default = ["orders", "emails", "reports"]
}

# Fragile
resource "aws_sqs_queue" "by_count" {
  count = length(var.names)
  name  = var.names[count.index]
}

# Stable
resource "aws_sqs_queue" "by_key" {
  for_each = toset(var.names)
  name     = each.key
}

# count as an on/off switch
resource "aws_cloudwatch_dashboard" "d" {
  count          = local.is_prod ? 1 : 0
  dashboard_name = "payments"
  dashboard_body = file("dashboard.json")
}
```

```flow
trace: Removing "orders" from the list
count: [0]=orders [1]=emails [2]=reports > The identity of each queue is its position in the list.
remove "orders" so the list is [emails, reports] > Every item moves up one position.
plan: [0] changes name to emails, [1] changes to reports, [2] **destroyed** > Queues are renamed, which for SQS means replacement, and the queue at [2] is destroyed.
for_each: ["orders"] ["emails"] ["reports"] > The identity of each queue is its key.
remove "orders" > Only the queue keyed **orders** is destroyed. emails and reports are untouched.
```

**What happens, step by step:**
1. With `count`, state holds `by_count[0]` (orders), `[1]` (emails), `[2]` (reports).
2. After removing "orders", the config wants `[0]` = emails and `[1]` = reports. Names are `ForceNew` for SQS, so `[0]` and `[1]` are replaced and `[2]` is deleted: three queues affected, and queued messages are lost.
3. With `for_each`, state holds keys `"orders"`, `"emails"`, `"reports"`. Only `"orders"` disappears from the config, so only that queue is destroyed.

**Common mistake → fix:** `count` over a list that people edit. Fix: `for_each` with stable keys; if you already used `count`, migrate with `moved { from = aws_sqs_queue.q[0]  to = aws_sqs_queue.q["orders"] }` blocks so nothing is recreated.

**Interview answer:** "count identifies instances by index, so removing an item mid-list shifts the others and causes destroy and recreate. for_each identifies them by key, so only the removed key is affected. I use for_each for collections and count only for a 0-or-1 toggle, and I migrate with moved blocks."

**Follow-ups:**
- *Can I use for_each on a list?* Only after converting it with `toset()` (unique strings) or a map via a `for` expression.

---

### Q12. `lifecycle` settings

**Short answer:** The `lifecycle` block changes how Terraform treats a resource when it plans changes. Key settings: **`create_before_destroy`** builds the replacement before removing the old one; **`prevent_destroy`** makes the plan fail if the resource would be destroyed; **`ignore_changes`** ignores differences in named attributes managed elsewhere; **`replace_triggered_by`** forces replacement when another resource changes; **`precondition`/`postcondition`** assert assumptions.

**How it works:**

| Setting | Use |
|---|---|
| `create_before_destroy = true` | zero-gap replacements (certificates, launch templates); names must not collide (use `name_prefix`) |
| `prevent_destroy = true` | stateful resources; any plan that would destroy it errors |
| `ignore_changes = [attr]` | attributes changed by autoscaling or CI (ECS `desired_count`, `task_definition`). Overuse hides drift |
| `replace_triggered_by = [...]` | recreate when a related resource changes |
| `precondition` / `postcondition` | check inputs before, or results after, the resource is applied |

**Example:**
```hcl
resource "aws_db_instance" "main" {
  identifier        = "payments-db"
  engine            = "postgres"
  instance_class    = "db.m6g.large"
  allocated_storage = 100
  multi_az          = var.environment == "prod"
  manage_master_user_password = true
  username          = "app"

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [tags["LastBackup"]]

    postcondition {
      condition     = var.environment != "prod" || self.multi_az
      error_message = "Production databases must be Multi-AZ."
    }
  }
}
```

```flow
trace: create_before_destroy on a certificate
default replacement > Terraform destroys the old certificate, then creates the new one, leaving a gap with no certificate.
create_before_destroy = true > Terraform creates the **new** certificate first.
references are repointed > The load balancer listener now uses the new certificate.
the old certificate is destroyed last > At no moment was there no certificate. This requires unique names, for example name_prefix.
```

**What happens, step by step:**
1. Someone edits the code so the database would be destroyed (for example a rename without `moved`). The plan fails: `Instance cannot be destroyed ... lifecycle.prevent_destroy is set`. That error is the safety net.
2. Because of `ignore_changes`, a backup tool writing the tag `LastBackup` does not appear as drift in every plan.
3. In `prod`, `multi_az` is `true`, so the postcondition passes after apply. In `staging`, the `||` short-circuits. If someone set `multi_az = false` in prod, the apply would error right after creation, flagging the violation.
4. Note: `self` is only allowed in `postcondition`, not `precondition`.

**Common mistake → fix:** `ignore_changes = all` to "make the plan clean". Terraform then ignores real drift on everything. Fix: list only the specific attributes owned by another system.

**Interview answer:** "lifecycle tunes planning: prevent_destroy guards stateful resources, create_before_destroy gives zero-gap replacements, ignore_changes covers attributes managed by something else such as autoscaling, replace_triggered_by links resources, and pre- and postconditions assert assumptions. I use ignore_changes narrowly because it hides drift."

**Follow-ups:**
- *Does `prevent_destroy` stop `terraform destroy`?* Yes, the plan errors; removing the block and applying (or removing the resource from state) is how you intentionally delete it.

---
## 3. Language features

### Q13. Expressions and functions you should know

**Short answer:** Terraform's expression language lets you compute values instead of hard-coding them. The ones used constantly: **`for` expressions** (reshape lists and maps), **conditionals** (`condition ? a : b`), **splat** (`aws_instance.web[*].id`), string **interpolation** (`"${var.name}-api"`), and built-in **functions** such as `merge`, `lookup`, `try`, `coalesce`, `jsonencode`, `templatefile` and `cidrsubnet`.

**How it works:**
- A `for` expression builds a list (`[for x in xs : f(x)]`) or a map (`{ for x in xs : key => value }`), optionally filtered with `if`.
- A conditional picks between two values and is the way to turn things on or off.
- Functions are pure: the same inputs give the same output, and you can try them in `terraform console`.

**Example:**
```hcl
variable "services" {
  default = {
    api    = { port = 8000, public = true }
    worker = { port = 9000, public = false }
  }
}

locals {
  public_names = [for name, cfg in var.services : name if cfg.public]
  ports        = { for name, cfg in var.services : name => cfg.port }
  replicas     = var.environment == "prod" ? 3 : 1
  subnet_ids   = [for s in aws_subnet.private : s.id]
  image        = coalesce(var.image_override, "${aws_ecr_repository.api.repository_url}:${var.tag}")
  tags         = merge(var.common_tags, { service = "payments" })
}
```

**What happens, step by step (with the services map above):**
1. `public_names` loops over both entries, keeps those with `public = true`, and returns `["api"]`.
2. `ports` builds `{ api = 8000, worker = 9000 }`.
3. In `prod`, `replicas` is `3`; otherwise `1`.
4. `coalesce` returns the first non-null, non-empty argument: with no `image_override`, the image is `<ecr-url>:<tag>`.
5. `merge` combines the two maps; later keys win on conflict.
6. You can test any of these with `terraform console`, for example `> [for n, c in var.services : n if c.public]` prints `["api"]`.

**Common mistake → fix:** using `try()` to hide every error. A typo in an attribute name silently falls back to the default. Fix: use `try` only for genuinely optional data, and validate inputs with variable `validation`.

**Interview answer:** "I use for expressions to reshape data, conditionals for toggles, splat for collecting attributes, and functions like merge, coalesce, lookup, try, jsonencode and templatefile. I test expressions in terraform console, and keep logic readable by moving complex expressions into locals."

**Follow-ups:**
- *`lookup` vs index?* `lookup(map, key, default)` returns a default for a missing key; `map[key]` errors.

---

### Q14. Dynamic blocks

**Short answer:** Some resources contain repeatable **nested blocks** (for example several `ingress` rules in a security group). A **`dynamic` block** generates those nested blocks from a list or map, so the number of rules comes from data instead of being typed out. Use it sparingly: too many dynamic blocks make plans hard to read.

**How it works:**
- `dynamic "ingress" { for_each = ... content { ... } }` generates one `ingress` block per element.
- Inside `content`, the iterator named after the block (`ingress.value`, `ingress.key`) gives the current element.

**Example:**
```hcl
variable "allowed_cidrs" {
  default = ["10.0.0.0/16", "192.168.10.0/24"]
}

resource "aws_security_group" "api" {
  name   = "api"
  vpc_id = aws_vpc.main.id

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

```flow
trace: A dynamic block generates nested blocks
var.allowed_cidrs = 10.0.0.0/16 and 192.168.10.0/24 > The data that decides how many rules exist.
dynamic ingress with for_each over the list > A template that is evaluated once per element.
element 1 produces ingress with cidr_blocks 10.0.0.0/16 > The first generated nested block.
element 2 produces ingress with cidr_blocks 192.168.10.0/24 > The second generated nested block. Adding a CIDR to the list adds a rule with no other code change.
```

**What happens, step by step:**
1. Terraform expands the dynamic block into two ordinary `ingress` blocks before building the plan.
2. The plan shows both rules, as if you had written them by hand.
3. Adding `"172.16.0.0/12"` to the variable adds a third rule; removing one deletes only that rule.

**Common mistake → fix:** a dynamic block for two fixed rules. It adds indirection with no benefit. Fix: write static blocks when the rules rarely change; use `dynamic` when the list truly varies by input.

**Interview answer:** "A dynamic block generates repeated nested blocks from a collection, so the number of rules or settings is data driven. I use it when the list really varies, and write plain blocks otherwise because dynamic blocks hurt readability."

**Follow-ups:**
- *Alternative for security group rules?* Separate `aws_vpc_security_group_ingress_rule` resources with `for_each`, which gives each rule its own stable address.

---

### Q15. Multiple accounts and regions: provider aliases

**Short answer:** One `provider "aws"` block targets one account and region. To work with another region or account, define an additional provider with an **`alias`** and select it per resource with `provider = aws.alias`, or pass it to a module with `providers = { aws = aws.alias }`. For each account the pipeline assumes a role. Since AWS provider **6.0**, most regional resources also accept a per-resource `region` argument, so multi-region setups often need no alias at all.

**How it works:**
- The default provider (no alias) is used by every resource that doesn't name another.
- `assume_role { role_arn = ... }` makes the provider work in another account using temporary credentials.
- Keep **separate state** per account and environment so a mistake has a small blast radius.

**Example:**
```hcl
provider "aws" {
  region = "ap-south-1"
}

provider "aws" {
  alias  = "dr"
  region = "ap-southeast-1"
  assume_role {
    role_arn = "arn:aws:iam::222222222222:role/terraform-deploy"
  }
}

resource "aws_s3_bucket" "replica" {
  provider = aws.dr
  bucket   = "acme-docs-replica"
}

module "dr_bucket" {
  source    = "./modules/bucket"
  providers = { aws = aws.dr }
}

# AWS provider 6.x: no alias needed for a different region
resource "aws_vpc" "peer" {
  region     = "us-west-2"
  cidr_block = "10.1.0.0/16"
}
```

**What happens, step by step:**
1. `aws_s3_bucket.replica` uses `aws.dr`: Terraform assumes the role in account `222222222222` and creates the bucket in `ap-southeast-1`.
2. `module.dr_bucket` passes that provider in, so every AWS resource inside the module goes to the DR account and region.
3. `aws_vpc.peer` sets `region` directly and is created in `us-west-2` with the default provider's credentials.
4. All of these are recorded in one state unless you split them; for production, prefer separate roots per account.

**Common mistake → fix:** defining provider blocks inside reusable modules. A module with its own provider configuration can't be removed cleanly and blocks `count`/`for_each` on the module. Fix: configure providers in the root module and pass them down.

**Interview answer:** "I use provider aliases with assume_role to target other accounts or regions, and pass them to modules through the providers argument. With AWS provider 6 many resources take a region argument directly. Providers are configured in the root, not inside modules, and each account or environment gets its own state."

**Follow-ups:**
- *How does CI authenticate to each account?* OIDC to a role in each target account, one role per environment (Q36).

---

### Q16. Importing existing resources

**Short answer:** **Importing** brings an object that already exists (created by hand, or by another tool) under Terraform's management without recreating it. The modern way is an **`import` block** (Terraform 1.5+): reviewable in the plan like any other change, and it can **generate** the matching resource code with `-generate-config-out`. After importing, adjust the code until the plan shows **no changes**.

**How it works:**
1. Write an `import { to = <address>  id = "<real id>" }` block.
2. Either write the `resource` block yourself, or run `terraform plan -generate-config-out=generated.tf` to get a draft.
3. `terraform plan` shows "1 to import" and any differences between code and the real object.
4. Edit the code until no unwanted changes remain, then `apply`. The object is now in state.

**Example:**
```hcl
import {
  to = aws_s3_bucket.legacy
  id = "acme-legacy-bucket"
}

resource "aws_s3_bucket" "legacy" {
  bucket = "acme-legacy-bucket"
}
```
```bash
terraform plan -generate-config-out=generated.tf   # only when the resource block does not exist yet
terraform plan
terraform apply
```

**What happens, step by step:**
1. The plan reports `aws_s3_bucket.legacy: Importing... [id=acme-legacy-bucket]` and `Plan: 1 to import, 0 to add, 0 to change, 0 to destroy`.
2. If your code differed from reality (say it lacked a tag the bucket has), the plan would also show `~ tags` to remove it. You'd add the tag to the code to avoid the change.
3. After `apply`, state maps `aws_s3_bucket.legacy` to the real bucket. A later `plan` should print `No changes`.
4. Once imported, you can delete the `import` block, which is only needed for the run that performs it.

**Common mistake → fix:** applying right after generating config without reading it. Generated code often includes computed or default attributes and can try to change real settings. Fix: review the generated file, trim it, and keep running `plan` until it is clean.

**Interview answer:** "I use import blocks to adopt existing resources: declare the target address and real ID, generate or write the resource block, and iterate on the plan until it shows no changes. It's reviewable and repeatable, unlike the old terraform import command, which changed state immediately."

**Follow-ups:**
- *Can an import block target a module resource?* Yes, `to = module.storage.aws_s3_bucket.logs`.

---

### Q17. `moved` and `removed` blocks: refactoring safely

**Short answer:** Terraform identifies a resource by its **address** in state. If you rename it or move it into a module, Terraform sees "old one gone, new one appeared" and plans to destroy and recreate. A **`moved`** block tells Terraform "this is the same object under a new address", so the plan only updates state. A **`removed`** block (Terraform 1.7+) with `lifecycle { destroy = false }` stops managing a resource **without deleting** the real object.

**How it works:**
- `moved { from = <old address>  to = <new address> }` also handles `count`↔`for_each` key changes and module renames.
- `removed { from = <address>  lifecycle { destroy = false } }` replaces the old `terraform state rm` command with reviewable code.
- Keep `moved` blocks in the code for a while so every state (each environment) migrates; they're harmless afterwards.

**Example:**
```hcl
moved {
  from = aws_s3_bucket.docs
  to   = module.storage.aws_s3_bucket.docs
}

removed {
  from = aws_s3_bucket.old_logs
  lifecycle {
    destroy = false
  }
}
```

```flow
trace: Moving a bucket into a module
before: state has aws_s3_bucket.docs > The old address in state, which is the real bucket acme-docs.
after the refactor, code defines module.storage.aws_s3_bucket.docs > The new address in code.
without a moved block, plan says destroy docs and create module.storage.docs > The bucket and its contents would be deleted and recreated.
with the moved block, plan says the resource has moved > Terraform only changes the address in state. The real bucket is untouched.
```

**What happens, step by step:**
1. You move the bucket's code into `modules/storage` and add the `moved` block.
2. `terraform plan` shows `# aws_s3_bucket.docs has moved to module.storage.aws_s3_bucket.docs` and `Plan: 0 to add, 0 to change, 0 to destroy`.
3. After apply, state has the new address; the bucket is the same object with the same contents.
4. For `old_logs`, the `removed` block with `destroy = false` takes the bucket out of state but leaves it in AWS, so another team can adopt it.

**Common mistake → fix:** refactoring first and checking the plan later, then approving "1 to destroy, 1 to add". Fix: always plan after a refactor, expect "0 to destroy", and add `moved`.

**Interview answer:** "moved blocks record that a resource changed address so Terraform updates state instead of destroying and recreating, and removed blocks with destroy false stop managing a resource without deleting it. They replace risky manual state mv and state rm with reviewable code, and I check that the plan shows zero destroys."

**Follow-ups:**
- *Rename a `for_each` key?* `moved { from = aws_x.y["small"]  to = aws_x.y["tiny"] }`.

---

### Q18. Ephemeral values and write-only arguments (secrets that never reach state)

**Short answer:** Normally anything Terraform sends to a resource, including a database password, is saved in state. Two newer features avoid that. **Ephemeral resources, variables and outputs** (Terraform **1.10+**) hold values that exist only for the current run and are never written to plan or state files. **Write-only arguments** (Terraform **1.11+**, for example `password_wo` on `aws_db_instance`) send a value to a resource without storing it. Pair `password_wo` with `password_wo_version`: bump the version number to push a new password.

**How it works:**
1. An `ephemeral` block fetches or generates a value for this run only (a secret from Secrets Manager, a random password).
2. A write-only argument accepts that value, passes it to the provider, and Terraform does not persist it.
3. Because the value isn't in state, Terraform can't see whether it changed. The `*_wo_version` argument is the trigger: changing it tells the provider to send the value again.
4. Alternative with no Terraform-handled secret at all: `manage_master_user_password = true` lets RDS create and rotate the password in Secrets Manager.

**Example:**
```hcl
ephemeral "random_password" "db" {
  length = 24
}

resource "aws_db_instance" "main" {
  identifier          = "payments-db"
  engine              = "postgres"
  instance_class      = "db.m6g.large"
  allocated_storage   = 100
  username            = "app"
  password_wo         = ephemeral.random_password.db.result
  password_wo_version = 1
}
```

```flow
pipeline: A password that never lands in state
Ephemeral resource generates the password > It exists only in memory during this plan or apply.
Write-only argument password_wo receives it > The AWS provider sends it to RDS when the database is created or updated.
Terraform writes state > The password is not in state or in the saved plan. Only password_wo_version is stored.
To rotate, bump password_wo_version to 2 > Terraform sends a newly generated value on that apply.
```

**What happens, step by step:**
1. During apply, `random_password.db` generates a 24-character value in memory.
2. The provider creates the database with that password. The value is **not** written to `terraform.tfstate`.
3. Searching the state for the password finds nothing; it only contains `password_wo_version = 1`.
4. Later, changing `password_wo_version` to `2` makes the provider send a freshly generated password. The new value must be stored somewhere you control (for example written to Secrets Manager in the same run through another write-only argument, or created by RDS itself).

**Common mistake → fix:** generating a password with a normal `random_password` **resource** and passing it to `password`. It is stored in state in plain text. Fix: ephemeral resource plus write-only argument, or `manage_master_user_password = true`. Also note write-only arguments cannot be read back; you need a place that records the secret for your applications.

**Interview answer:** "Ephemeral values from Terraform 1.10 exist only during a run, and write-only arguments from 1.11 let me send them to a resource without storing them in state. For an RDS password I use password_wo with password_wo_version, bumping the version to rotate, or let RDS manage the password in Secrets Manager. That keeps secrets out of state."

**Follow-ups:**
- *Where can ephemeral values be used?* Only in specific places: ephemeral outputs and variables, write-only arguments, provider configuration, and other ephemeral resources.

---

### Q19. Unknown values: "known after apply"

**Short answer:** Some attributes (IDs, ARNs, IP addresses) don't exist until the resource is created, so a plan shows `(known after apply)`. Terraform can still plan the resources that depend on them, but it **cannot use an unknown value to decide how many resources to create**: `count` and `for_each` must be determined at plan time.

**How it works:**
- References to not-yet-created attributes are "unknown" and flow through expressions.
- `for_each = aws_subnet.private[*].id` fails if those IDs aren't known yet: `The "for_each" set includes values derived from resource attributes that cannot be determined until apply`.
- Use keys that are known from the configuration (names, indexes from input variables) and let only the values be unknown.

**Example:**
```hcl
# Fails on first apply: subnet IDs are unknown, and they are the keys
resource "aws_route_table_association" "bad" {
  for_each       = toset([for s in aws_subnet.private : s.id])
  subnet_id      = each.key
  route_table_id = aws_route_table.private.id
}

# Works: keys are known names, values may be unknown
resource "aws_route_table_association" "good" {
  for_each       = aws_subnet.private
  subnet_id      = each.value.id
  route_table_id = aws_route_table.private.id
}
```
(`aws_subnet.private` is itself created with `for_each = var.private_subnets`.)

**What happens, step by step:**
1. `bad`: Terraform needs the set of keys to know how many associations exist, but the keys are subnet IDs that don't exist yet, so the plan errors.
2. `good`: the keys are the same names used to create the subnets (known from `var.private_subnets`); only `each.value.id` is unknown, which is fine.
3. Plan shows `subnet_id = (known after apply)` for each association. After the subnets are created, apply fills the values.

**Common mistake → fix:** working around the error with `-target` to create subnets first. Fix: restructure so keys come from input data, not from resource attributes.

**Interview answer:** "Values that exist only after creation are unknown at plan time and shown as known after apply. Terraform can use them as values but not to decide count or for_each, so I base those on keys known from input variables and let only the attribute values be unknown."

**Follow-ups:**
- *What does `-target` do to this?* It forces a staged apply but leaves the code fragile; better to fix the design.

---

### Q20. Validation at every level: variable validation, conditions, `check` blocks

**Short answer:** Terraform lets you assert assumptions at different points. **Variable `validation`** rejects bad inputs at plan time. **`precondition`/`postcondition`** (in `lifecycle`) check assumptions before and results after a resource is applied, and **fail** the run. **`check` blocks** run assertions (optionally using their own data source) and only **warn**, which suits continuous health assertions such as "the endpoint returns 200". **`terraform test`** runs automated tests of modules.

**How it works:**

| Mechanism | When it runs | If it fails |
|---|---|---|
| variable `validation` | plan, when input values are known | error, nothing changes |
| `precondition` | before a resource is created or updated | error |
| `postcondition` | after, can use `self` | error |
| `check` block | at the end of plan and apply | warning only |
| `terraform test` | when you run the tests | test failure in CI |

**Example:**
```hcl
variable "retention_days" {
  type = number
  validation {
    condition     = var.retention_days >= 7 && var.retention_days <= 365
    error_message = "retention_days must be between 7 and 365."
  }
}

check "api_health" {
  data "http" "api" {
    url = "https://${aws_lb.api.dns_name}/health"
  }
  assert {
    condition     = data.http.api.status_code == 200
    error_message = "API health endpoint returned ${data.http.api.status_code}."
  }
}
```

**What happens, step by step:**
1. `-var retention_days=1` fails during plan with the message above; no cloud call is made.
2. After a successful apply, the `check` block calls the endpoint. If it returns 503 while the service warms up, Terraform prints a **warning** with the message but the apply still counts as successful.
3. A `postcondition` with the same failure would have made the apply fail.

**Common mistake → fix:** using a `check` block as a deployment gate. It only warns. Fix: use pre- and postconditions to fail the run, and keep `check` for monitoring-style assertions.

**Interview answer:** "Variable validation rejects bad inputs early, preconditions and postconditions fail a run if assumptions about a resource are wrong, and check blocks warn about conditions that should hold, like a healthy endpoint, without failing the apply. For modules, terraform test adds automated assertions."

**Follow-ups:**
- *Can validation reference other variables?* In Terraform 1.9 and later, yes.

---

## 4. State in depth

### Q21. What is a backend? Remote state in S3 with locking

**Short answer:** A **backend** is where Terraform stores state and how it locks it. The default is a local file. For teams, use a **remote backend** such as S3: state is shared, versioned and encrypted, and a **lock** prevents two applies from writing at once. Terraform 1.10+ supports **S3-native locking** with `use_lockfile = true` (a lock object next to the state file); the older DynamoDB table locking is deprecated.

**How it works:**
1. On `plan` or `apply`, Terraform creates a lock object (`<key>.tflock`) in the bucket. If it already exists, the run fails with `Error acquiring the state lock`.
2. Terraform reads state, runs, writes the new state, and removes the lock.
3. Bucket versioning keeps old copies of state, so a bad write can be rolled back.
4. The IAM role running Terraform needs `s3:GetObject` and `s3:PutObject` on the state key and `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on the `.tflock` object.

**Example:**
```hcl
terraform {
  backend "s3" {
    bucket       = "acme-tfstate-prod"
    key          = "payments/api/terraform.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true
  }
}
```

```flow
sequence: Two engineers apply at the same time
actors: Engineer A, S3 backend, Engineer B
Engineer A -> S3 backend: apply: create the lock object payments/api/terraform.tfstate.tflock
S3 backend --> Engineer A: lock acquired
Engineer B -> S3 backend: apply: try to create the same lock object
S3 backend --> Engineer B: Error acquiring the state lock, held by Engineer A
> Engineer B's run stops safely. Neither run can overwrite the other's state changes.
Engineer A -> S3 backend: write the new state, then delete the lock object
```

**What happens, step by step:**
1. A starts an apply; the lock object is created with A's ID, user and time.
2. B starts an apply on the same state key at the same moment; creating the lock fails, so B stops with the error showing who holds the lock.
3. A finishes, writes state (a new object version in the versioned bucket) and releases the lock.
4. B can now rerun; its plan includes A's changes.
5. If A's runner crashed and left the lock behind, `terraform force-unlock <LOCK_ID>` removes it. Only do that after confirming no run is active.

**Common mistake → fix:** `force-unlock` as the first reaction to a lock error. If another apply is genuinely running, you've now allowed two writers and can corrupt state. Fix: check CI for running jobs and the lock owner; use `resource_group` in the pipeline so overlaps don't happen.

**Interview answer:** "A backend is where state lives. I use S3 with encryption, versioning, blocked public access and tight IAM, and use_lockfile for native locking since Terraform 1.10, replacing DynamoDB locking. Locks stop concurrent applies, versioning lets me recover a bad state, and force-unlock is a last resort after confirming nothing is running."

**Follow-ups:**
- *Other backends?* HCP Terraform, GitLab-managed Terraform state (HTTP backend), Azure Blob, GCS.

---

### Q22. Drift: detection and handling

**Short answer:** **Drift** is when real infrastructure no longer matches the code and state, because someone changed it in the console or another tool or autoscaling did. Detect it by running `terraform plan -detailed-exitcode` on a schedule (exit code **2** means changes exist) or `plan -refresh-only`. Then choose: **revert** (apply the code), **adopt** (update the code to match), or **ignore** (`ignore_changes`, when another system owns that attribute). Prevent it by restricting console write access.

**How it works:**
- On every plan, Terraform refreshes real attributes and compares them to the code. Differences appear as changes to apply.
- `-detailed-exitcode` returns 0 (no changes), 1 (error) or 2 (changes). A scheduled pipeline job can alert on 2.
- `terraform plan -refresh-only` shows only what changed outside Terraform and lets you accept it into state without touching infrastructure.

**Example:**
```bash
terraform plan -detailed-exitcode -out=drift.tfplan
echo $?     # 2 means the real infrastructure differs from the code
```

```flow
pipeline: Handling drift
Scheduled plan with detailed exit code > A nightly job runs terraform plan and exit code 2 raises an alert.
Find who changed what > CloudTrail shows the user, time and API call.
Decide > Revert it, adopt it into code, or ignore the attribute if another system owns it.
Act > Apply the code to revert, or merge a change to the code that matches the new reality.
Prevent > Remove console write access for most people and alert on manual changes.
```

**What happens, step by step:**
1. At 02:00 the nightly job runs `plan -detailed-exitcode` and exits 2: `~ aws_security_group.api: ingress rule 0.0.0.0/0:22 added`.
2. CloudTrail shows an engineer opened SSH during an incident at 22:10.
3. The incident is over, so the team reverts: the next apply removes the rule. Had it been needed permanently, they'd add it to the code through a merge request.
4. To stop repeats: console access is read-only except for break-glass roles, and alarms fire on `AuthorizeSecurityGroupIngress` calls outside the pipeline.

**Common mistake → fix:** blindly applying to "clear the drift", which may remove a hotfix that was keeping production up. Fix: understand the change first (CloudTrail), then decide.

**Interview answer:** "Drift is real infrastructure diverging from code. I detect it with a scheduled plan using detailed-exitcode, look up who made the change in CloudTrail, then revert, adopt into code or ignore if another system owns the attribute. To prevent it I restrict console writes and alert on manual changes."

**Follow-ups:**
- *Does Terraform detect resources it doesn't manage?* No; unmanaged resources are invisible to it.

---

### Q23. Workspaces and their limits

**Short answer:** **CLI workspaces** give the same configuration multiple separate **state files** (`terraform workspace new staging`, `terraform.workspace` in code). They suit short-lived copies of an identical environment. For dev, staging and production they are weak: the same backend and the same credentials, easy to apply to the wrong workspace, and environments can't differ structurally. Prefer **separate root modules or directories per environment** (ideally separate accounts and state files) that share modules.

**How it works:**
- Each workspace has its own state under the same backend (in S3: `env:/<workspace>/<key>`).
- The active workspace is invisible in the code unless you print it, which makes mistakes easy.
- Separate directories make the target explicit in the path, and let each environment have its own backend, account and variables.

**Example:**
```bash
terraform workspace new staging
terraform workspace select prod     # you must remember which one is active
terraform apply
```

**What happens, step by step:**
1. You tested in `staging`, then `select prod` and run `apply` from the same shell history. Nothing in the command says which environment it is.
2. Both environments use the same backend bucket and the same IAM role, so a wrong choice has full production impact.
3. With `live/prod/` and `live/staging/` directories, each with its own backend key and role, running from the wrong directory fails at authentication or targets the intended state, and reviewers see which path a merge request touches.

**Common mistake → fix:** using workspaces for dev/staging/prod separation. Fix: one root module per environment (and per account), sharing versioned modules; use workspaces for ephemeral per-branch copies.

**Interview answer:** "Workspaces give one configuration several state files, which is fine for temporary copies. They share backend and credentials and hide the target environment, so for dev, staging and production I use separate root modules and states, ideally in separate accounts, with shared versioned modules."

**Follow-ups:**
- *What is HCP Terraform workspace?* A different concept: a workspace there is a full unit with its own state, variables, runs and permissions.

---

### Q24. `-target` and manual state edits: risks

**Short answer:** **`-target`** applies only part of the dependency graph, leaving everything else unchanged, so the real world and your code can end up out of sync. Manual state commands (`terraform state rm`, `state mv`, editing the JSON) can orphan or duplicate resources. Use them only for emergencies. Prefer `moved`, `removed` and `import` blocks, and back up state first (S3 versioning).

**How it works:**
- `terraform apply -target=aws_instance.web` plans only that resource and its dependencies. Resources that depend on it, or that should change together, are skipped.
- `state rm` forgets an object: Terraform won't manage it, but it still exists, and a later apply may try to create a duplicate.
- Every manual change bypasses review and the plan.

**Example:**
```bash
terraform apply -target=aws_security_group.api
terraform plan          # always follow with a full plan
```

**What happens, step by step:**
1. The targeted apply updates the security group, but not the service that should be updated at the same time.
2. Nothing warns you at the end except Terraform's note "Resource targeting is in effect".
3. The next full plan shows the service changes you skipped, now mixed with whatever else changed.
4. If the targeted apply was done to get past a crash, run a full plan immediately, fix the code, and apply normally.

**Common mistake → fix:** routine use of `-target` to apply faster. Fix: split large states (Q25) so ordinary plans are fast and complete.

**Interview answer:** "Target and manual state surgery are emergency tools: target applies a subset and leaves the rest inconsistent, and state rm or mv can orphan or duplicate resources. I prefer moved, removed and import blocks, back up state first, and always follow an emergency with a full plan."

**Follow-ups:**
- *Safe use of `-replace`?* `terraform apply -replace=aws_instance.web` forces recreation of one resource and shows it in the plan, which is reviewable.

---

### Q25. Splitting and migrating state

**Short answer:** One giant state makes every plan slow and every mistake large. Split by **lifecycle and blast radius**: network (changes rarely), data stores, and each application service. Move resources between states by adding a `removed` block with `destroy = false` in the old configuration and an `import` block in the new one (or `terraform state mv -state-out` carefully). Plan both sides to confirm there are no creates or destroys.

**How it works:**
1. Decide boundaries, for example `network/`, `data/`, `services/api/`, each with its own backend key.
2. In the new stack, add `import` blocks for the existing resources and matching code.
3. In the old stack, replace the resource blocks with `removed { destroy = false }`.
4. Apply the **new** stack first (it adopts the objects), then the old one (it forgets them).

**Example:**
```hcl
# new stack: services/api/main.tf
import {
  to = aws_ecs_service.api
  id = "prod-cluster/api"
}

# old stack
removed {
  from = aws_ecs_service.api
  lifecycle {
    destroy = false
  }
}
```

**What happens, step by step:**
1. The new stack's plan: `1 to import, 0 to add, 0 to change, 0 to destroy`. Apply: the ECS service is now in the new state.
2. The old stack's plan: `aws_ecs_service.api will no longer be managed by Terraform, but will not be destroyed`. Apply: it's removed from the old state.
3. Both states now agree; the real service was never touched.
4. Apply the new stack first so the service is never unmanaged. Once both sides apply cleanly you can delete the `import` and `removed` blocks. If the old code had simply dropped the resource block without `removed`, the old stack's plan would have said `destroy` for the live service.

**Common mistake → fix:** removing a resource block from the old code without a `removed` block: the next apply destroys the real resource. Fix: always use `removed` with `destroy = false`, and read the plan before applying.

**Interview answer:** "I split state by lifecycle and blast radius, then migrate resources by importing them into the new stack and using removed blocks with destroy false in the old one, planning both sides to confirm no creates or destroys. That keeps the real resources untouched."

**Follow-ups:**
- *Tools that help?* Terragrunt or HCP Terraform Stacks orchestrate many states and their dependencies.

---

### Q26. Sharing data between stacks

**Short answer:** When stack B needs a value from stack A (a VPC ID), use loose coupling where possible: **data sources** that look the object up by tag or name, or **SSM Parameter Store** values that A publishes and B reads. `terraform_remote_state` reads another stack's **outputs** directly, but it requires read access to the whole other state file, which may contain secrets, and ties the two stacks together.

**How it works:**
- A publishes: `output "vpc_id"` (for remote_state) or `aws_ssm_parameter` resource (for SSM).
- B consumes: `data "terraform_remote_state"`, or `data "aws_ssm_parameter"`, or a direct lookup (`data "aws_vpc"` by tag).
- Prefer published, documented interfaces over reaching into someone else's state.

**Example:**
```hcl
# network stack
resource "aws_ssm_parameter" "vpc_id" {
  name  = "/platform/prod/vpc_id"
  type  = "String"
  value = aws_vpc.main.id
}

# app stack
data "aws_ssm_parameter" "vpc_id" {
  name = "/platform/prod/vpc_id"
}

resource "aws_security_group" "api" {
  vpc_id = data.aws_ssm_parameter.vpc_id.value
  name   = "api"
}
```

```flow
sequence: Sharing the VPC ID between stacks through SSM
actors: Network stack, SSM Parameter Store, App stack
Network stack -> SSM Parameter Store: apply writes /platform/prod/vpc_id = vpc-0a1b2c
App stack -> SSM Parameter Store: plan reads /platform/prod/vpc_id
SSM Parameter Store --> App stack: vpc-0a1b2c
> The app stack never needs access to the network stack's state file, and the parameter is a stable, documented contract.
```

**What happens, step by step:**
1. The network stack applies and writes the parameter.
2. The app stack's role needs only `ssm:GetParameter` on `/platform/prod/*`, not read access to the network state.
3. The security group is created in `vpc-0a1b2c`.
4. If the network team recreates the VPC, they update the parameter and the app stack's next plan picks up the new ID.

**Common mistake → fix:** `terraform_remote_state` everywhere, giving every team read access to everyone's state (and thus any secrets in it). Fix: publish selected values through SSM or data-source lookups; keep remote_state for tightly coupled stacks owned by one team.

**Interview answer:** "I share values through data sources or SSM parameters, which gives a clear contract and avoids state access. terraform_remote_state reads another stack's outputs but needs access to its state file, so I reserve it for closely related stacks."

**Follow-ups:**
- *Ordering?* The producing stack must be applied before the consumer; CI or Terragrunt dependencies enforce it.

---

### Q27. Securing state

**Short answer:** State can contain secrets and detailed resource information, so protect it as sensitive data: store it in a remote backend, **encrypt** it (SSE-KMS), **restrict access** to CI roles and a few administrators, **version** it for recovery, **never commit** it to git, use **ephemeral and write-only** values so secrets stay out of it, and keep **separate state per environment and account**.

**How it works:**

| Control | Why |
|---|---|
| Remote backend (S3) | no copies on laptops or in git |
| SSE-KMS encryption, block public access | protects data at rest |
| IAM limited to the CI roles | state read means access to any secret in it |
| Bucket versioning | recover from a bad write or deletion |
| Locking | prevents concurrent writes |
| Separate bucket or key per environment/account | smaller blast radius |

**Example (bucket policy idea):** allow `s3:GetObject`/`PutObject` on `payments/*` only to the CI apply role, and deny everyone else including most human users.

**What happens, step by step:**
1. A developer who can read the production state bucket runs `terraform show` and sees a plaintext RDS password stored by an old configuration.
2. With restricted access, this developer cannot read it; only the CI role can.
3. With write-only arguments (Q18), the password was never in state at all, which is the stronger fix.

**Common mistake → fix:** giving all engineers read access to the state bucket "for debugging". Fix: grant access through a break-glass role with audit logging, and use `plan` output in merge requests for visibility.

**Interview answer:** "State may include secrets, so I keep it in a versioned, KMS-encrypted S3 bucket with public access blocked, access limited to CI roles and a few admins, locking on, separate states per environment, and I use ephemeral and write-only values so the secrets are not stored in state in the first place."

**Follow-ups:**
- *Are `sensitive` values encrypted in state?* No; `sensitive` only hides them in CLI output.

---

### Q28. The dependency lock file: `.terraform.lock.hcl`

**Short answer:** `terraform init` writes `.terraform.lock.hcl`, which records the **exact provider versions** it selected plus checksums. Commit it, so every developer and CI run uses identical providers and a tampered download is detected. Upgrade deliberately with `terraform init -upgrade` in a merge request.

**How it works:**
- Version constraints in `required_providers` give a range; the lock file picks and freezes one version inside it.
- Checksums cover each platform's package. When developers use different platforms (macOS, Linux CI), record all of them with `terraform providers lock -platform=linux_amd64 -platform=darwin_arm64`.
- Modules are not in the lock file; pin them with versions or git refs.

**Example:**
```hcl
provider "registry.terraform.io/hashicorp/aws" {
  version     = "6.30.0"
  constraints = "~> 6.0"
  hashes = [
    "h1:...",
    "zh:...",
  ]
}
```

**What happens, step by step:**
1. First `init` selects 6.30.0 within `~> 6.0` and writes the file.
2. A teammate clones the repo and runs `init`; Terraform installs exactly 6.30.0 and verifies the checksums.
3. 6.31.0 is released; nobody gets it until someone runs `terraform init -upgrade`, reviews the new lock file in a merge request, and tests the plans.
4. If CI runs on Linux but the lock file only has macOS hashes, `init` fails the checksum check. Fix: `terraform providers lock` with all platforms.

**Common mistake → fix:** adding `.terraform.lock.hcl` to `.gitignore`. Each machine picks its own versions. Fix: commit it (ignore only the `.terraform/` folder).

**Interview answer:** "The lock file freezes the exact provider versions and checksums chosen by init. I commit it so everyone and CI use the same providers, record checksums for all platforms we use, and upgrade deliberately with init -upgrade in a reviewed change."

**Follow-ups:**
- *Why does a provider upgrade sometimes change plans?* New defaults or renamed arguments; read the upgrade guide (Q44).

---
## 5. Modules & project structure

### Q29. What is a module, and how do you call one?

**Short answer:** A **module** is a folder of `.tf` files that you can reuse like a function: it takes **inputs** (variables), creates resources, and returns **outputs**. Every Terraform configuration is already a module, called the **root module**. A `module` block in it calls a **child module** from a local path, a git URL or the Terraform Registry. Modules remove copy-paste and let you enforce standards (encryption, tags, logging) in one place.

**How it works:**
1. The child module declares `variable` blocks (its inputs) and `output` blocks (its results).
2. The caller writes `module "name" { source = ...  inputs... }`.
3. Resources inside get addresses prefixed with `module.<name>`, for example `module.logs.aws_s3_bucket.this`.
4. You read a child's result as `module.<name>.<output>`. A child cannot see the caller's variables or resources unless they are passed in.
5. `terraform init` downloads the module source; `version` (registry) or `?ref=` (git) pins it.

**Example:**
```hcl
# modules/bucket/main.tf
variable "name" {
  type = string
}
variable "versioned" {
  type    = bool
  default = true
}

resource "aws_s3_bucket" "this" {
  bucket = var.name
}

resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id
  versioning_configuration {
    status = var.versioned ? "Enabled" : "Suspended"
  }
}

output "arn" {
  value = aws_s3_bucket.this.arn
}
```
```hcl
# root module
module "logs" {
  source = "./modules/bucket"
  name   = "acme-logs-prod"
}

output "logs_arn" {
  value = module.logs.arn
}
```

**What happens, step by step:**
1. `terraform init` notes the local module `./modules/bucket`.
2. The plan shows `module.logs.aws_s3_bucket.this` and `module.logs.aws_s3_bucket_versioning.this` to create, with `versioned` defaulting to `true`.
3. After apply, `module.logs.arn` is `arn:aws:s3:::acme-logs-prod`, exposed by the root's `logs_arn` output.
4. Calling the module a second time as `module "audit"` with another name creates a separate bucket, with the same standards and no copied code.

**Common mistake → fix:** a module that reaches out to hard-coded things (a fixed VPC ID, its own `provider` block). It can't be reused and is hard to remove. Fix: take everything it needs as variables, and let the root module configure providers.

**Interview answer:** "A module is a reusable folder of Terraform with inputs, resources and outputs; the root module calls child modules with a module block. Resources inside are addressed under module.name, results come back through outputs, and I pin the version or git ref so changes to the module are deliberate."

**Follow-ups:**
- *Can modules call modules?* Yes, but keep nesting shallow; deep chains make plans hard to understand.

---

### Q30. How do you design a good module?

**Short answer:** A good module has **one clear purpose** ("an ECS service", not "everything"), a **small set of meaningful inputs** with types, descriptions, validation and safe defaults, **outputs** that callers actually need, **pinned versions**, tests, and no hidden surprises (no provider configuration, no hard-coded account IDs).

**How it works:**
- Prefer inputs that express intent (`desired_count`, `cpu`) over exposing every underlying argument.
- Default to secure choices (encryption on, public access off) and make risky choices explicit.
- Version modules with git tags or a registry and let consumers upgrade on purpose.
- Document inputs and outputs; add `terraform test` cases.

**Example:**
```hcl
module "api_service" {
  source = "git::https://gitlab.example.com/platform/tf-modules.git//ecs-service?ref=v2.3.0"

  name             = "api"
  image            = var.api_image
  cpu              = 512
  memory           = 1024
  desired_count    = 3
  subnet_ids       = module.network.private_subnet_ids
  target_group_arn = module.alb.target_group_arns["api"]
}
```

**What happens, step by step:**
1. `?ref=v2.3.0` fetches exactly that tag of the module repository; a later commit on `main` does not change this project.
2. The caller supplies only seven inputs; the module supplies task definition, service, autoscaling, IAM role and log group with company defaults.
3. A new module version `v2.4.0` is adopted by changing `ref` in a merge request, whose plan shows precisely what the upgrade changes.

**Common mistake → fix:** a module with 60 pass-through variables that mirror the resource's arguments. It adds a layer without adding value. Fix: wrap only what you standardise; if callers need full control, let them use the resource directly.

**Interview answer:** "I design modules around one purpose with a small, validated interface, secure defaults, useful outputs and pinned versions, and I test them. If a module only forwards every argument of one resource, it isn't adding value."

**Follow-ups:**
- *Semantic versioning for modules?* Yes: breaking input or output changes bump the major version.

---

### Q31. Repository layout for environments and components

**Short answer:** Separate **reusable code** (modules) from **deployable units** (root modules that each have their own state). Split deployable units by **environment** and by **component lifecycle**: networks rarely change, services change daily. Each root module gets its own backend key, variables and CI job. Tools such as Terragrunt or HCP Terraform Stacks help orchestrate many states.

**How it works:**
```
infra/
├── modules/                 # reusable, versioned
│   ├── network/
│   ├── ecs-service/
│   └── rds/
└── live/                    # one folder = one state = one deployable unit
    ├── prod/
    │   ├── network/         (backend key prod/network)
    │   ├── data/            (rds, s3)
    │   └── services/api/
    └── staging/
        └── ...
```

**Example:** `live/prod/services/api/main.tf` is small: a backend block, a provider, and a `module "api"` call using a pinned module version with prod values.

**What happens, step by step:**
1. A change to `live/prod/services/api` runs a plan for only that state, in a minute, with a role that can touch only the API service.
2. The network state is not even read, so a mistake in the API service cannot delete subnets.
3. Promoting a module change from staging to prod means bumping the same `ref` in `live/prod/...` after it works in `live/staging/...`.

**Common mistake → fix:** one giant root module for everything per environment. Plans take ten minutes, and any mistake can affect all resources. Fix: split by lifecycle and blast radius (Q25).

**Interview answer:** "I keep modules separate from live root modules, with one root per environment and per component lifecycle, each with its own state and CI job. That keeps plans fast and mistakes small, and promotions are version bumps of the same modules."

**Follow-ups:**
- *Why not copy-paste folders per environment?* The environments' root files should be thin calls to shared modules; real logic lives in the modules.

---

### Q32. Module boundaries for ECS workloads

**Short answer:** Split ECS infrastructure by who changes it and how often. A **platform** layer (once per environment: VPC, cluster, load balancer, shared security groups, log groups) rarely changes. A **service** module (per application: task definition, service, autoscaling, target group and listener rule, IAM task role, alarms) changes often. Decide **one owner** for the running image version: either Terraform or the CI pipeline, never both.

**How it works:**
- **Terraform owns the image:** the image tag is a variable; deploying means changing it and applying. Auditable, slower.
- **CI owns the image:** the pipeline registers a new task definition and updates the service. Then Terraform must not fight it: `ignore_changes = [task_definition]` on the service.

**Example:**
```hcl
resource "aws_ecs_service" "api" {
  name            = "api"
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.desired_count

  lifecycle {
    ignore_changes = [task_definition, desired_count]   # CI deploys images, autoscaling changes the count
  }
}
```

**What happens, step by step:**
1. CI registers task definition revision 42 with the new image digest and updates the service.
2. Autoscaling raises `desired_count` from 3 to 5 during load.
3. The next `terraform plan` ignores both attributes, so it doesn't try to roll the service back to revision 41 or to 3 tasks.
4. Without `ignore_changes`, Terraform would see "task_definition: 42 to 41" and revert the deploy.

**Common mistake → fix:** both Terraform and CI updating the same attribute. Deploys flip-flop. Fix: one owner, documented, and `ignore_changes` for the attribute the other system owns.

**Interview answer:** "I separate a platform module from per-service modules, and give the image version a single owner. If CI deploys, Terraform ignores task_definition and desired_count; if Terraform deploys, the tag is a variable. Mixing the two causes flip-flopping deployments."

**Follow-ups:**
- *Where do alarms and autoscaling live?* In the service module so they travel with the service.

---

### Q33. Should you use public registry modules?

**Short answer:** Well-maintained community modules (for example `terraform-aws-modules/vpc/aws`) save time and encode good practice. Use them with care: **pin the version**, read the code, understand what resources it creates, and wrap them in a thin internal module when you need organisation defaults (tags, encryption, logging). Avoid unmaintained modules for critical infrastructure.

**How it works:**
- Registry sources look like `terraform-aws-modules/vpc/aws` with a `version` constraint.
- Upgrades are plan-reviewed like provider upgrades: major versions often rename inputs.
- A wrapper module lets you change the underlying module later without touching every consumer.

**Example:**
```hcl
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 6.0"

  name = "main"
  cidr = "10.0.0.0/16"
}
```
(The version constraint is illustrative; check the module's registry page for the current major version.)

**What happens, step by step:**
1. `init` downloads the module at a version satisfying the constraint.
2. The plan shows every resource the module creates, including ones you may not expect (flow logs, route tables); you review them.
3. When the next major version is released, nothing changes until you raise the constraint and review the plan.

**Common mistake → fix:** no `version` argument, so `init -upgrade` can pull a breaking major release. Fix: always pin.

**Interview answer:** "Public modules save time but are third-party code: I pin versions, review what they create, and wrap them in a small internal module for organisational defaults so I can swap the implementation later."

**Follow-ups:**
- *How do you decide between building and reusing?* Reuse for commodity infrastructure like VPCs; write your own where your standards differ substantially.

---

## 6. Security, testing & CI/CD

### Q34. How do you handle secrets in Terraform?

**Short answer:** Never put secrets in `.tf` or `.tfvars` files in git. In order of preference: **let the service generate and manage the secret** (RDS `manage_master_user_password = true`, stored in Secrets Manager); use **ephemeral resources plus write-only arguments** so the value never reaches state (Q18); create the secret **container** in Terraform and set its value outside Terraform; `sensitive = true` only hides output. Anything that does reach state is readable by whoever can read state.

**How it works:**
- Applications should read secrets at runtime from Secrets Manager or SSM, with their task role, not receive them through Terraform outputs.
- Pass the secret's **ARN or name**, not its value, between stacks.

**Example:**
```hcl
resource "aws_db_instance" "main" {
  identifier                  = "payments-db"
  engine                      = "postgres"
  instance_class              = "db.m6g.large"
  allocated_storage           = 100
  username                    = "app"
  manage_master_user_password = true
}

output "db_secret_arn" {
  value = aws_db_instance.main.master_user_secret[0].secret_arn
}
```

```flow
pipeline: Secrets with Terraform
RDS manages the master password > manage_master_user_password creates and rotates it in Secrets Manager, so Terraform never sees the value.
Terraform outputs only the secret ARN > The ARN is not secret. It tells applications where to look.
The application reads the secret at runtime > Its task role allows secretsmanager:GetSecretValue on that one ARN.
State is still protected > It holds no password, but still holds other sensitive details.
```

**What happens, step by step:**
1. RDS creates the instance and a Secrets Manager secret holding the generated password.
2. Terraform's state contains the secret's ARN, not the password.
3. The service's task definition references that ARN in its `secrets` section; ECS injects the value when the task starts.
4. Rotation happens in Secrets Manager; no Terraform run and no code change is needed.

**Common mistake → fix:** `password = var.db_password` with the value in `prod.tfvars` committed to git. The secret is in git and in state. Fix: managed passwords, or an ephemeral value with `password_wo`.

**Interview answer:** "I avoid Terraform handling secrets at all: RDS manages its own password in Secrets Manager, applications read it at runtime, and I pass ARNs around. Where Terraform must send a value, I use ephemeral resources and write-only arguments so it isn't stored. sensitive only hides CLI output, and state is protected regardless."

**Follow-ups:**
- *What about provider credentials?* Use OIDC and assumed roles, not static keys in variables.

---

### Q35. Validating beyond syntax: lint, security, policy and tests

**Short answer:** Layer the checks, cheapest first. `fmt` and `validate` for style and syntax; **TFLint** for provider-specific mistakes (invalid instance types); **Checkov, Trivy or KICS** for security rules (no public buckets); **policy as code** (OPA/Conftest, Sentinel) on the plan's JSON; **`terraform test`** for module behaviour; **Infracost** for cost. Humans still read the plan.

**How it works:**

| Layer | Tool |
|---|---|
| Format and syntax | `terraform fmt -check`, `terraform validate` |
| Lint | TFLint |
| Security and compliance | Checkov, Trivy (includes tfsec rules), KICS |
| Policy on the plan | OPA with Conftest, Sentinel (HCP Terraform), run against `terraform show -json tfplan` |
| Tests | `terraform test` (`*.tftest.hcl`), Terratest (Go) |
| Cost | Infracost |

`terraform test` runs `run` blocks. By default each runs `command = apply` (it creates real infrastructure and destroys it afterwards); `command = plan` checks logic without creating anything. `expect_failures` tests that a validation rejects bad input, and `mock_provider` (Terraform 1.7+) avoids real API calls.

**Example:**
```hcl
# tests/bucket.tftest.hcl
mock_provider "aws" {}

variables {
  name = "acme-logs-test"
}

run "versioning_enabled_by_default" {
  command = plan

  assert {
    condition     = aws_s3_bucket_versioning.this.versioning_configuration[0].status == "Enabled"
    error_message = "Versioning must be enabled by default."
  }
}

run "rejects_empty_name" {
  command = plan

  variables {
    name = ""
  }

  expect_failures = [var.name]
}
```
(The second case assumes the module's `name` variable has a `validation` rule.)

**What happens, step by step:**
1. `terraform test` runs the first block as a plan against a mocked AWS provider; no credentials or real resources are needed.
2. The assertion reads the planned value `Enabled` and passes.
3. The second block sets `name = ""`; the variable validation fails, which is what `expect_failures` demands, so the test passes.
4. If someone changes the module default to `Suspended`, the first test fails in CI with the message above, before any merge.

**Common mistake → fix:** relying on tests that use `command = apply` against a real account on every merge request. They are slow, cost money and leave resources behind if they fail. Fix: plan-mode and mocked tests for most checks; a small number of apply tests in a sandbox account.

**Interview answer:** "I run fmt and validate, TFLint, a security scanner such as Checkov or Trivy, policy checks with OPA on the plan JSON, and terraform test for modules, usually plan-mode with mocked providers. Infracost shows cost impact, and a human still reads the plan."

**Follow-ups:**
- *Why check the plan JSON?* It contains the final intended values, including those computed from variables, which static scanners of the source can miss.

---

### Q36. Running Terraform securely in CI

**Short answer:** Use short-lived credentials from **OIDC** (no stored cloud keys) and **separate roles**: a read-only role for `plan` on merge requests, a write role for `apply` only on the protected branch and environment. Apply the **saved plan**. Allow only one apply per environment (a `resource_group` in the pipeline plus state locking), pin providers and modules, protect the pipeline file, and restrict the state bucket to these roles.

**How it works:**
1. Merge request pipeline: OIDC to the **plan** role, `terraform plan -out`, show the plan in the MR, run policy checks.
2. After merge, protected pipeline: OIDC to the **apply** role (trust policy accepts only the protected branch of this project), apply the saved plan, with manual approval for production.
3. CloudTrail records every API call with the role session name, so you can trace changes to a pipeline run.

**Example:** (see the GitLab CI/CD course for the full pipeline YAML)
```hcl
provider "aws" {
  region = "ap-south-1"
  # credentials come from the environment: AWS_ROLE_ARN and AWS_WEB_IDENTITY_TOKEN_FILE,
  # or the CI job assumes the role before running terraform
}
```

```flow
pipeline: Secure Terraform in CI
Merge request: OIDC to the read-only plan role > The plan role can read the cloud and the state but cannot change anything.
Plan, policy checks and review > The plan output appears in the merge request and policy tools inspect the plan JSON.
Merge to the protected branch > Only now can the pipeline use the apply role, because its trust policy accepts only that branch.
Apply the saved plan with approval > The exact reviewed plan runs, one apply at a time per environment.
Audit > CloudTrail and pipeline logs show who approved what and which role session made each change.
```

**What happens, step by step:**
1. A feature branch pipeline tries to assume the apply role; the trust policy's `sub` condition rejects it (`AccessDenied`).
2. The same branch can assume the plan role, so the MR gets its plan.
3. After merge, `apply` runs on `main`, assumes the apply role and executes `terraform apply tfplan`.
4. If a second pipeline starts meanwhile, it waits on the `resource_group` and the state lock.

**Common mistake → fix:** a single powerful role for both plan and apply, usable from any branch. A malicious MR can then change infrastructure by editing the pipeline. Fix: split roles and bind the write role to the protected branch.

**Interview answer:** "OIDC for short-lived credentials, a read-only role for MR plans and a write role bound to the protected branch for applies, the saved plan applied after approval, one apply at a time per environment through resource groups and state locking, pinned dependencies, and a protected pipeline definition. State bucket access is limited to those roles."

**Follow-ups:**
- *Why plan on the apply branch again?* The state or code may have moved since the MR plan; applying a stale saved plan is refused, so regenerate and review when needed.

---

### Q37. Zero-downtime replacements

**Short answer:** Some changes force Terraform to replace a resource (destroy and create). For **stateless** resources (certificates, launch templates, target groups) use `create_before_destroy` with unique names so the new one exists before the old one is removed. At the service level use blue/green deployments. For **databases**, avoid replacement entirely: use in-place modifications, snapshots and planned migrations. Check the plan for `-/+` before applying.

**How it works:**
- The default replacement order is destroy then create, which leaves a gap.
- With `create_before_destroy = true`, Terraform creates the new object, updates references, then destroys the old one. Both exist briefly, so names or unique constraints must not collide (`name_prefix`).
- Resources that depend on the replaced one are updated to point to the new one.

**Example:**
```hcl
resource "aws_acm_certificate" "api" {
  domain_name       = "api.example.com"
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}
```

**What happens, step by step:**
1. You add a subject alternative name to the certificate. That forces replacement (`-/+`).
2. Terraform creates the new certificate, waits for validation, updates the listener to use it, and only then deletes the old certificate.
3. HTTPS never has a moment without a valid certificate.
4. For `aws_launch_template`, the same pattern with `name_prefix` avoids a name collision with the old template.

**Common mistake → fix:** applying a plan with `-/+` on an `aws_db_instance` because the summary looked small. Fix: stop; revert the argument that forces replacement or plan a migration (snapshot, restore, cut over), and keep `prevent_destroy` on it.

**Interview answer:** "I look for replacements in the plan. For stateless resources I use create_before_destroy with unique or prefixed names so the new one is live before the old one goes; for services, blue/green; for databases I avoid replacement and use in-place changes or a planned migration with snapshots."

**Follow-ups:**
- *Does `create_before_destroy` spread to dependencies?* Yes, Terraform applies it to resources that the replaced one depends on, where needed.

---

### Q38. Guardrails for production: `prevent_destroy` and more

**Short answer:** Use several independent safety nets so one mistake can't delete production data: Terraform's **`prevent_destroy`** on stateful resources, **service-level deletion protection** (RDS `deletion_protection`, ALB, DynamoDB), S3 `force_destroy = false`, **policy checks** in CI that fail plans destroying tagged critical resources, **IAM deny** on `Delete*` for protected resources outside a break-glass role, and **backups** with manual approval for destructive changes.

**How it works:**
- `prevent_destroy` only protects against destroy plans in the current configuration. If someone deletes the resource block *and* its lifecycle setting, the guard disappears with it. Provider-side deletion protection still stops the API call.
- Policy checks read `terraform show -json` and block when any `resource_changes` entry has `actions` containing `"delete"` for protected types.

**Example:**
```hcl
resource "aws_db_instance" "main" {
  identifier          = "payments-db"
  deletion_protection = true
  skip_final_snapshot = false
  final_snapshot_identifier = "payments-db-final"

  lifecycle {
    prevent_destroy = true
  }
}
```

**What happens, step by step:**
1. A refactor accidentally removes the `aws_db_instance` block. The plan wants to destroy the database.
2. Because the block is gone, `prevent_destroy` (which lived in that block) no longer applies, but the CI policy check sees a `delete` action on a database and fails the pipeline.
3. Even if both were bypassed, AWS rejects the delete call because `deletion_protection = true`.
4. A final snapshot is taken if the delete is intentionally approved, so data can be restored.

**Common mistake → fix:** relying on `prevent_destroy` alone. Fix: layer it with provider-side deletion protection, CI policy and IAM restrictions.

**Interview answer:** "I layer guardrails: prevent_destroy in code, deletion protection and final snapshots in the service, a CI policy that fails plans deleting critical resources, IAM denies on delete outside break-glass, and approvals plus backups for deliberate destructive changes."

**Follow-ups:**
- *How do you intentionally delete a protected database?* Disable protections in a reviewed change, apply, then destroy, with a snapshot taken first.

---

### Q39. Terraform vs CloudFormation vs CDK

**Short answer:** **Terraform** uses HCL, supports many clouds and SaaS products through providers, shows an explicit plan, and you manage the state yourself. **CloudFormation** is AWS-native: AWS stores the state (stacks), supports rollback, StackSets and drift detection, but covers AWS only and can lag on new features. **CDK** lets you write infrastructure in a real programming language and generates CloudFormation. Choose by team skills, multi-cloud needs and existing standards.

**How it works:**

| | Terraform | CloudFormation | CDK |
|---|---|---|---|
| Language | HCL | JSON / YAML | TypeScript, Python, Java, C#, Go |
| State | you store it (S3, HCP) | AWS manages it | AWS manages it (via CloudFormation) |
| Scope | many clouds and SaaS | AWS only | AWS (mainly) |
| Preview | `plan` | change sets | `cdk diff` |
| Rollback on failure | none automatic: fix forward | automatic stack rollback | automatic (CloudFormation) |

**How to choose:** multi-cloud or SaaS resources, or an existing Terraform ecosystem, point to Terraform; an AWS-only shop that wants AWS-managed state and rollback points to CloudFormation; developers who prefer typed code and abstractions point to CDK.

**Example:** you also need to manage Datadog monitors and a GitLab project alongside AWS. Terraform handles all three with providers; CloudFormation needs custom resources.

**What happens, step by step:**
1. A failed Terraform apply leaves some resources created and state updated for them; you fix the code and apply again to converge.
2. A failed CloudFormation update rolls the stack back to the previous working state automatically.
3. This difference shapes how you plan changes: with Terraform, small, reviewed, reversible changes matter more.

**Common mistake → fix:** mixing tools on the same resources (a CloudFormation stack and Terraform both managing one bucket). Each overwrites the other's changes. Fix: assign each resource to one tool.

**Interview answer:** "Terraform is multi-cloud, declarative, with explicit plan and self-managed state; CloudFormation is AWS-native with managed state and automatic rollback; CDK writes CloudFormation from programming languages. I choose based on multi-cloud needs, team skills and existing standards, and never let two tools manage the same resource."

**Follow-ups:**
- *OpenTofu?* A community-governed fork of Terraform with a compatible workflow; the main concepts in this course apply to both.

---

## 7. Scenario & debugging questions

### Q40. The plan wants to destroy a production resource unexpectedly. What do you do?

**Short answer:** **Stop; don't apply.** A surprise destroy means the code, state or environment doesn't match what you thought. Find out why, fix the cause in code until the plan shows no unintended destroy, then apply. Add `prevent_destroy` going forward.

**Steps to diagnose:**
1. **Read the plan line:** is it `-` (destroy) or `-/+` (replace)? For a replace, which attribute says `# forces replacement`?
2. **Renamed or moved address?** The old address disappears and a new one appears. Fix with a `moved` block (Q17).
3. **`count` index shift?** An item was removed from the middle of a list. Migrate to `for_each` with `moved` blocks (Q11).
4. **Provider upgrade changed a default or renamed an argument?** Compare the lock file diff and the provider's upgrade guide (Q44).
5. **Wrong backend, workspace or variables?** Check the `init` output and `terraform workspace show`; compare the backend key and `-var-file`. A plan against an empty or wrong state wants to create everything, not destroy, but a state from another environment can destroy.
6. **Resource removed from the code by mistake?** Check the merge request diff.
7. **Intentional but unsafe?** Plan a migration (snapshot, create new, cut over) instead of a replace.

**Example:** the plan says `# aws_s3_bucket.logs will be destroyed` and `# module.storage.aws_s3_bucket.logs will be created`. Someone moved the bucket into a module without `moved`. Adding `moved { from = aws_s3_bucket.logs  to = module.storage.aws_s3_bucket.logs }` changes the plan to `0 to destroy`.

**Common mistake → fix:** approving because "the new one will have the same name". Data in the old bucket would be deleted. Fix: stop, add the `moved` block, re-plan.

**Interview answer:** "I stop and read why: a forces-replacement attribute, a renamed address or module path, a count index shift, a provider default change, or the wrong state or workspace. I fix the cause, for example with a moved block or for_each, re-plan until there is no unintended destroy, and add prevent_destroy and CI policy so it can't recur."

**Follow-ups:**
- *Plan shows destroy of everything?* Check you're using the right backend, key and credentials first.

---

### Q41. The ECS task definition changed in Terraform, but the service doesn't deploy new tasks

**Short answer:** The service must be updated to point at the new task definition revision and then actually start tasks from it. Check who owns deployments (Terraform or CI), whether `ignore_changes` hides the update, whether the deployment circuit breaker rolled it back, whether new tasks fail health checks, and whether the image tag was unchanged so nothing new was pulled.

**Steps to diagnose:**
1. **Did Terraform register a new revision?** `aws ecs describe-task-definition --task-definition api` shows the latest revision number.
2. **Which revision does the service use?** `aws ecs describe-services` shows `taskDefinition`. If it's the old one, check `lifecycle { ignore_changes = [task_definition] }`: Terraform deliberately ignores it, assuming CI deploys.
3. **Was there a deployment that failed?** Service events show "deployment failed" or "rolling back" if the circuit breaker triggered (new tasks failed health checks or couldn't start).
4. **Same image tag?** If the image reference is `api:latest` and nothing else changed, the revision may be equal and tasks aren't replaced. Use immutable tags or digests, or `force_new_deployment = true`.
5. **Who owns the deploy?** If CI and Terraform both update the service, one overwrites the other.

**Fix:** choose one owner. If Terraform owns it, remove `task_definition` from `ignore_changes` and set the image by digest through a variable. If CI owns it, accept that Terraform ignores the revision and use CI to deploy.

**Example:** `ignore_changes = [task_definition]` was added last month for CI deploys. A teammate changes the CPU in Terraform; a new revision (`api:43`) is registered, but the service still runs `api:42` because that attribute is ignored. Moving the change into the CI deploy path (or removing `ignore_changes`) fixes it.

**Common mistake → fix:** forcing a deployment by hand each time. Fix: settle ownership so the pipeline does it consistently.

**Interview answer:** "I check whether a new revision exists, which revision the service uses, whether ignore_changes on task_definition is masking the update, whether the circuit breaker rolled the deployment back or tasks fail health checks, and whether an unchanged tag means nothing new was pulled. Then I make either Terraform or CI the single owner of deployments."

**Follow-ups:**
- *`force_new_deployment`?* Makes ECS start a fresh rollout even if the task definition is unchanged.

---

### Q42. "Error acquiring the state lock"

**Short answer:** Terraform couldn't take the state lock, so either another run is active (wait for it) or a crashed run left a stale lock. Check who holds the lock and whether that run is still running. Only then, if it's stale, use `terraform force-unlock <LOCK_ID>`.

**Steps to diagnose:**
1. **Read the error:** it prints the lock ID, who created it (user and host), the operation, and when.
2. **Is that run alive?** Look at CI for a running or hung pipeline for this environment, or ask the person named. If it is running, wait.
3. **Stale lock:** if the job was killed (runner crash, cancelled pipeline) and nothing is running, remove the lock: `terraform force-unlock <LOCK_ID>`. With S3 native locking this deletes the `.tflock` object.
4. **Then rerun** a normal plan to confirm state is consistent. If the crashed apply was mid-way, the plan shows what remains.
5. **Prevent:** a `resource_group` per environment in the pipeline, non-interruptible apply jobs, and one pipeline per environment at a time.

**Example:**
```
Error: Error acquiring the state lock
Lock Info:
  ID:        0b8a1c9e-...
  Operation: OperationTypeApply
  Who:       gitlab-runner@ci-7
  Created:   2026-10-27 09:12:41 UTC
```
The pipeline for that job was cancelled at 09:13 and nothing is running, so `terraform force-unlock 0b8a1c9e-...` clears it.

**Common mistake → fix:** force-unlocking while the other apply is still running. Two writers can corrupt state. Fix: confirm first, and make apply jobs non-interruptible so cancelling a pipeline doesn't leave locks.

**Interview answer:** "I read the lock info, confirm in CI whether that run is still active, wait if it is, and only force-unlock a verified stale lock. To prevent it, apply jobs are non-interruptible with a resource group per environment so only one runs at a time."

**Follow-ups:**
- *Is state corrupted after a killed apply?* Usually not; Terraform writes state as it goes. Run a plan to see what's left.

---

### Q43. Someone changed a security group in the console. What now?

**Short answer:** The next plan shows **drift**. First find out whether the change was an emergency fix that should be kept, or unauthorised and should be reverted. Keep: add it to the code through a merge request. Revert: apply the code. Then prevent repeats with a drift schedule, read-only console access and alerts on manual changes.

**Steps:**
1. **See the drift:** `terraform plan` shows `~ ingress` with the added rule (for example `0.0.0.0/0` on port 22).
2. **Who and why:** CloudTrail event `AuthorizeSecurityGroupIngress` shows the user, time and source. Ask them.
3. **Decide:** emergency access during an incident that is over → revert; a permanently needed rule → code it.
4. **Act:** revert by `apply` (the plan removes the rule), or update the code and confirm the plan then shows `No changes`.
5. **Prevent:** remove console write permissions except break-glass, schedule the drift plan (Q22), alert on manual security group changes.

**Example:** after an outage, an engineer opened SSH from anywhere to debug. Nobody closed it. The nightly drift plan flags it; the team reviews CloudTrail, confirms the incident is over, and the next apply removes it.

**Common mistake → fix:** "fixing" the console change by hand again, so code and reality differ the other way. Fix: change through code, so the plan reflects what you want.

**Interview answer:** "The plan shows the drift. I check CloudTrail for who changed it and why, then either codify it through a merge request if it's needed or revert it with an apply if it wasn't. To prevent repeats I run scheduled drift plans, restrict console write access and alert on manual changes."

**Follow-ups:**
- *Can Terraform block console changes?* No; use IAM or Service Control Policies for that.

---

### Q44. A provider upgrade breaks plans

**Short answer:** Major provider versions can rename or remove arguments and change defaults. Upgrade deliberately: pin versions, read the upgrade guide, upgrade in a branch with `init -upgrade`, fix deprecations, plan **every** stack and check for unexpected replacements, then merge the new lock file and roll out stack by stack.

**Steps:**
1. **Pin:** `version = "~> 6.0"` plus a committed lock file, so upgrades only happen intentionally.
2. **Read the upgrade guide** for the new major version (for example the AWS provider's version 6 upgrade guide): removed arguments, new defaults, changed behaviours.
3. **Branch and upgrade:** `terraform init -upgrade`; fix errors such as `Unsupported argument`.
4. **Plan every environment** and read for changes you didn't intend: replaced resources, changed defaults.
5. **Roll out gradually:** non-production first, one stack at a time, monitoring each.

**Example:** after raising the constraint from `~> 5.0` to `~> 6.0`, `plan` reports an unsupported argument in a module and shows `~ region` appearing on resources. The upgrade guide explains the new top-level `region` argument; the module is updated and the plan returns to `No changes`.

**Common mistake → fix:** leaving the version unpinned and running `init -upgrade` in CI. A major release breaks everyone's pipeline at once. Fix: pin, commit the lock, and upgrade through a reviewed merge request.

**Interview answer:** "I pin providers and commit the lock file, so upgrades are deliberate. For a major upgrade I read the guide, upgrade in a branch with init -upgrade, fix deprecations, plan every stack and look for unintended replacements, then roll out stack by stack, starting with non-production."

**Follow-ups:**
- *Rollback?* Revert the lock file change; state written by a newer provider version may need care, so test in non-production first.

---

### Q45. How would you bootstrap an enterprise multi-account AWS platform with Terraform?

**Short answer:** Isolate workloads in **separate AWS accounts** under AWS Organizations, apply **guardrails** centrally (service control policies, organisation-wide logging and threat detection), automate **account creation** from a template, share networking through central services, and give each account/workload its own Terraform state and CI role.

**How it works (building blocks):**
1. **AWS Organizations and organisational units:** management, security, shared infrastructure, workloads.
2. **Identity:** IAM Identity Center for people; OIDC roles for pipelines.
3. **Guardrails:** service control policies, an organisation CloudTrail trail into a log-archive account, AWS Config, GuardDuty and Security Hub in a security account.
4. **Account vending:** AWS Control Tower with Account Factory for Terraform (AFT) or your own pipeline creates accounts with a baseline (logging, roles, budgets).
5. **Networking:** a shared network account with Transit Gateway or central VPCs and DNS.
6. **Workload stacks:** per account and environment, with their own state bucket or key, deployed by CI through OIDC.

```flow
pipeline: Bootstrapping a multi-account platform
Organization and organisational units > Separate accounts for management, security, shared services and workloads limit blast radius.
Guardrails > Service control policies, an organisation trail, Config and GuardDuty are applied to every account.
Account vending > A request creates a new account from a template with the baseline already applied.
Shared networking > A network account provides Transit Gateway and DNS that workload accounts attach to.
Workload stacks > Each account has its own Terraform state and a CI role reached through OIDC.
```

**Example layout:**
```
Management account: Organizations, IAM Identity Center, SCPs
 ├── Security OU:        log-archive (org CloudTrail, Config), security-tooling (GuardDuty, Security Hub)
 ├── Infrastructure OU:  network (Transit Gateway, DNS), shared-services (CI runners, ECR)
 └── Workloads OU:       payments-dev, payments-staging, payments-prod
```

**What happens, step by step:**
1. A team requests a new `payments-prod` account through the vending pipeline.
2. The account is created in the Workloads OU; SCPs and the org trail apply immediately; the baseline Terraform creates the CI deploy role and a state bucket.
3. The team's pipeline assumes that role via OIDC and deploys the network attachment and workloads.
4. A compromised workload account can't disable logging or reach other accounts, because SCPs and separate accounts are boundaries.

**Common mistake → fix:** everything in one account with environments separated only by tags or naming. A mistake or compromise affects everything, and IAM gets complicated. Fix: account-per-environment (and per sensitive workload), with central guardrails.

**Interview answer:** "I would set up AWS Organizations with OUs, central logging and security accounts, SCP guardrails and an automated account factory such as Control Tower with AFT. A shared network account provides connectivity, and each workload account has its own Terraform state and an OIDC deployment role. Accounts give blast-radius isolation, and the central guardrails give consistent security."

**Follow-ups:**
- *Where does the first Terraform run from?* A bootstrap step (manually or from a trusted pipeline) creates the state bucket and OIDC provider; after that everything is pipeline driven.

---

## 8. Cheat sheet

| Concept | Remember |
|---|---|
| Declarative | describe the desired state; Terraform diffs and converges |
| Workflow | init, fmt, validate, plan, apply (saved plan in CI), destroy |
| Provider / resource / data | plugin for an API / thing Terraform manages / read-only lookup |
| State | maps code addresses to real IDs; may hold secrets; remote, encrypted, locked |
| Plan symbols | `+` create, `~` update, `-/+` replace, `-` destroy; read every `-` and `-/+` |
| Backend | S3 with `use_lockfile` (1.10+); DynamoDB locking is deprecated |
| `for_each` over `count` | stable keys; `count` only for 0 or 1 toggles |
| lifecycle | prevent_destroy, create_before_destroy, ignore_changes (narrowly) |
| Refactor | `moved` (rename), `removed` with destroy=false (forget), `import` (adopt) |
| Secrets | managed passwords, ephemeral (1.10+) plus write-only (1.11+); `sensitive` is cosmetic |
| Unknown values | cannot drive count/for_each; use keys known at plan time |
| Validation | variable validation, pre/postconditions fail; check blocks warn |
| Drift | scheduled `plan -detailed-exitcode` (2 = changes); revert, adopt or ignore |
| Workspaces | fine for temporary copies, not for prod separation |
| Lock file | commit `.terraform.lock.hcl`; upgrade with `init -upgrade` |
| Modules | one purpose, small validated interface, pinned versions |
| Testing | validate, TFLint, Checkov/Trivy, OPA on plan JSON, `terraform test` |
| CI | OIDC, plan role vs apply role, saved plan, resource_group plus state lock |
| Guardrails | prevent_destroy, deletion protection, CI policy, IAM deny, backups |
| Provider upgrades | pin, read the guide, plan every stack, roll out gradually |

## Official references

- https://developer.hashicorp.com/terraform/docs
- Language overview: https://developer.hashicorp.com/terraform/language
- State and the S3 backend: https://developer.hashicorp.com/terraform/language/state · https://developer.hashicorp.com/terraform/language/backend/s3
- Refactoring (`moved`, `removed`): https://developer.hashicorp.com/terraform/language/modules/develop/refactoring · https://developer.hashicorp.com/terraform/language/block/removed
- Import blocks: https://developer.hashicorp.com/terraform/language/import
- Ephemeral values and write-only arguments: https://developer.hashicorp.com/terraform/language/manage-sensitive-data/ephemeral
- Checks: https://developer.hashicorp.com/terraform/language/block/check
- Tests: https://developer.hashicorp.com/terraform/language/tests
- AWS provider: https://registry.terraform.io/providers/hashicorp/aws/latest/docs · Enhanced Region Support: https://registry.terraform.io/providers/hashicorp/aws/latest/docs/guides/enhanced-region-support
