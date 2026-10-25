# GitLab CI/CD: Interview Preparation

> **Updated:** 24 October 2026 · **Level:** pipeline basics → advanced YAML → secure deployments to AWS
> **How to use:** *Short answer* = what you say first. *Explanation / Example* = intuition and YAML. *Pitfall / Follow-up* = where interviewers dig.

---

## Table of contents

1. [Mental model: how a GitLab pipeline runs](#1-mental-model-how-a-gitlab-pipeline-runs)
2. [Fundamentals](#2-fundamentals) (Q01–Q08)
3. [Controlling pipelines](#3-controlling-pipelines) (Q09–Q16)
4. [Reuse & structure](#4-reuse--structure) (Q17–Q20)
5. [Deployments to AWS](#5-deployments-to-aws) (Q21–Q27)
6. [Security & supply chain](#6-security--supply-chain) (Q28–Q32)
7. [Performance & reliability](#7-performance--reliability) (Q33–Q35)
8. [Scenario & debugging questions](#8-scenario--debugging-questions) (Q36–Q40)
9. [Git essentials](#9-git-essentials) (Q41–Q46)
10. [Cheat sheet](#10-cheat-sheet)

---

## 1. Mental model: how a GitLab pipeline runs

```flow
pipeline: From git push to a finished job
stage: GitLab server
Trigger > Push, merge request, tag, schedule or API call.
Read .gitlab-ci.yml > Plus includes/components; `workflow:rules` decide whether a pipeline is created at all.
Create pipeline + jobs > Each job's `rules` decide whether it's included; `needs` and stages set the order.
Queue jobs > Jobs wait for a runner with matching tags. Protected deploy jobs may need manual approval.
stage: GitLab Runner
Runner picks up job > Your EC2/EKS runner or a GitLab-hosted one polls for work.
Clean container > Started from the job's `image:` (docker / kubernetes executor).
Clone + restore > Repo at the commit SHA, cache restored, artifacts from earlier jobs downloaded.
Run script > before_script + script.
Upload results > Artifacts, reports and cache; logs streamed back to GitLab.
```

```
 git push / MR / tag / schedule / API trigger
            │
            ▼
 ┌─────────────────────────── GitLab server ───────────────────────────┐
 │ reads .gitlab-ci.yml (+ includes/components) → evaluates workflow:rules│
 │ → creates PIPELINE → evaluates each job's rules → creates JOBS         │
 │                                                                       │
 │  stage: build        stage: test             stage: deploy             │
 │  ┌───────────┐       ┌──────────┐            ┌──────────────────┐       │
 │  │ build-img │──────►│ unit     │──────────► │ deploy-staging   │       │
 │  └───────────┘ needs │ lint     │            │ (environment)    │       │
 │                      │ scan     │            ├──────────────────┤       │
 │                      └──────────┘            │ deploy-prod      │       │
 │                                              │ when: manual +   │       │
 │                                              │ protected env    │       │
 │  job queue ◄─────────────────────────────────└──────────────────┘       │
 └──────┬────────────────────────────────────────────────────────────────┘
        │ runners poll for jobs (matching tags)
        ▼
 ┌──────────────── GitLab Runner (your EC2/EKS or GitLab-hosted) ─────────┐
 │ executor: docker / kubernetes / shell / docker-autoscaler               │
 │ 1. start clean container from job `image:`                              │
 │ 2. clone repo at commit SHA, restore cache, download artifacts          │
 │ 3. run before_script + script                                           │
 │ 4. upload artifacts / reports / cache, stream logs                      │
 └──────────────────────────────────────────────────────────────────────────┘
```

**Key terms:** *pipeline* = one run for a commit; *stage* = group of jobs (order); *job* = unit of work run by a runner; *runner* = agent executing jobs; *executor* = how the runner isolates the job.

---

## 2. Fundamentals

### Q01. CI vs Continuous Delivery vs Continuous Deployment

**Short answer:**
- **CI** — every change is automatically built and tested, merged often.
- **Continuous Delivery** — every passing change is *deployable*; a human approves production release.
- **Continuous Deployment** — every passing change goes to production automatically.

```flow
pipeline: CI → continuous delivery → continuous deployment
CI > Every push is built and tested automatically.
Continuous delivery > Every passing build is releasable; a human clicks deploy to prod.
Continuous deployment > Every passing build goes to prod automatically.
Same pipeline, different last gate > Choose by risk and test confidence.
```

GitLab implements all three with `.gitlab-ci.yml`, environments, approvals and runners.

---

### Q02. What is `.gitlab-ci.yml`? Show a minimal pipeline.

```flow
pipeline: What the minimal pipeline does on push
build stage > Job builds the app; artifacts passed on.
test stage > Starts when build succeeds; test jobs run in parallel.
deploy stage > Runs only on main (rules); can be manual.
Pipeline status > Shown on the commit/MR; failures block merging if required.
```

```yaml
stages: [build, test, deploy]

default:
  image: python:3.13-slim
  interruptible: true           # newer pipeline on same ref may cancel this one

variables:
  PIP_CACHE_DIR: "$CI_PROJECT_DIR/.cache/pip"

build:
  stage: build
  script:
    - pip install uv && uv sync --frozen
    - uv build
  artifacts:
    paths: [dist/]
    expire_in: 1 week

unit-tests:
  stage: test
  script:
    - uv run pytest --junitxml=report.xml --cov=app --cov-report=xml
  coverage: '/TOTAL.*\s+(\d+%)$/'
  artifacts:
    reports:
      junit: report.xml
      coverage_report: { coverage_format: cobertura, path: coverage.xml }

deploy-staging:
  stage: deploy
  script: ./deploy.sh staging
  environment: { name: staging, url: https://staging.example.com }
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

---

### Q03. Runners and executors

**Short answer:** A **runner** is a process (on your VM, Kubernetes cluster, or GitLab-hosted) that polls GitLab for jobs. The **executor** decides how a job runs:

```flow
sequence: How a runner picks up a job
actors: GitLab, Runner, Executor
Runner -> GitLab: poll for jobs (matching tags)
GitLab --> Runner: job payload + short-lived job token
Runner -> Executor: docker / kubernetes: start a clean container
Executor -> Executor: clone, restore cache, run script
Runner --> GitLab: stream logs, upload artifacts, report status
```

| Executor | Isolation | Notes |
|---|---|---|
| `docker` | container per job | most common; clean environment |
| `kubernetes` | pod per job | scales on EKS; good for many teams |
| `docker-autoscaler` / instance | VMs created on demand | replaces old docker-machine autoscaling |
| `shell` | none (runs on host) | fast but jobs share host → security risk |

**Scopes:** instance (all projects), group, or project runners; select with `tags:`. **Protected runners** only run jobs for protected branches/tags → use them for production deploys.

---

### Q04. Jobs, stages, pipelines — execution order

Stages run in order; jobs in the same stage run in parallel; a stage starts when the previous stage succeeds — **unless** you use `needs` (DAG) to start jobs as soon as their dependencies finish. A failed job fails the pipeline unless `allow_failure: true`.

```flow
trace: Stage order vs needs
stages: build → test → deploy > Default: a stage starts when the previous stage fully succeeds.
build: **build-api**, **build-web** in parallel > Jobs in the same stage run together.
test: **test-api**, **test-web** > Waits for BOTH builds, even if test-web only needs build-web.
with needs: test-web starts right after build-web > `needs` turns it into a DAG and shortens the pipeline.
```

---

### Q05. Artifacts vs cache

```flow
pipeline: Artifacts vs cache
Artifacts > Job OUTPUTS passed to later jobs in the same pipeline (build output, test reports). Guaranteed.
Cache > Speed-up INPUTS reused across pipelines (pip/npm downloads). Best effort, may be missing.
Cache key from lockfile > A new lockfile → a new cache.
Rule > Never rely on cache for correctness.
```

| | Artifacts | Cache |
|---|---|---|
| Purpose | **outputs** passed to later jobs / downloaded (build output, reports) | **speed up** jobs by reusing downloaded deps |
| Guarantee | reliable; tied to the pipeline | best-effort; may be missing |
| Example | `dist/`, `report.xml`, `plan.tfplan` | `.cache/pip`, `node_modules/.cache` |

```yaml
cache:
  key:
    files: [uv.lock]           # new cache when lockfile changes
  paths: [.cache/uv]
  policy: pull                 # most jobs only pull; one job pull-push
```
**Rule:** never rely on cache for correctness; never put secrets in artifacts (they're downloadable).

---

### Q06. CI/CD variables and secrets

**Short answer:** Variables come from YAML, project/group/instance settings, pipeline triggers, and predefined variables (`CI_COMMIT_SHA`, `CI_COMMIT_BRANCH`, `CI_PIPELINE_SOURCE`, `CI_ENVIRONMENT_NAME`, `CI_REGISTRY_IMAGE` …). For secrets set in settings:
- **Masked** (hidden in logs; "masked and hidden" can't be viewed in UI after creation).
- **Protected** (only exposed to protected branches/tags).
- **Environment-scoped** (only for `production` jobs).

```flow
pipeline: Where a variable's value comes from (later wins)
Predefined > CI_COMMIT_SHA, CI_PIPELINE_SOURCE…
.gitlab-ci.yml > Global and job-level `variables:`.
Group / project settings > Masked, protected, environment-scoped secrets.
Trigger / manual run > Highest precedence. Prefer OIDC over stored cloud keys.
```

Better: don't store long-lived cloud keys at all — use **OIDC** (`id_tokens`) to get short-lived AWS credentials, and fetch app secrets at runtime from AWS Secrets Manager / Vault (`secrets:` keyword supports external secret managers).

**Pitfall:** masking isn't bulletproof (e.g., `echo $SECRET | base64` prints it). Restrict who can edit pipelines that run with secrets.

---

### Q07. Predefined pipeline sources

`CI_PIPELINE_SOURCE` = `push`, `merge_request_event`, `schedule`, `web`, `api`, `trigger`, `parent_pipeline`, `pipeline` … — used in `rules` to decide which jobs run where.

---

### Q08. Merge request pipelines, merged-results pipelines and merge trains

```flow
trace: A merge train
MR1, MR2, MR3 added to the train > Each waits its turn to merge into main.
pipeline(main + MR1) > Tests MR1 on top of the latest main.
pipeline(main + MR1 + MR2) runs in parallel > Each tests the combined result of everything ahead of it.
MR1 passes → merged; MR2 passes → merged > If one fails, it's removed and the ones behind restart.
main is always green > No "passed on my branch, broke main" surprises.
```

- **Branch pipeline** — runs for a push to a branch.
- **MR pipeline** — runs in the context of an MR (`merge_request_event`), can access MR variables.
- **Merged-results pipeline** — tests the result of merging the MR into the target branch.
- **Merge train** — queue of MRs; each is tested on top of the ones ahead → main never breaks from "green individually, red together" merges.

---

## 3. Controlling pipelines

### Q09. `rules` and `workflow:rules`

**Short answer:** `workflow:rules` decides **whether a pipeline is created at all**. Job `rules` decide **whether each job is added** and how (`when: on_success | manual | delayed | never`, `allow_failure`, variables). First matching rule wins. (`rules` replaced the older `only/except`.)

```flow
pipeline: rules evaluation
workflow:rules > Create a pipeline at all? (avoid duplicate branch + MR pipelines)
Job rules, top to bottom > The first matching rule decides: include (when) or skip.
No rule matches > Job is not added.
Result > Only the jobs that apply to this event and these changes.
```

```yaml
workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"      # MR pipelines
    - if: $CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS
      when: never                                           # avoid duplicate branch pipeline when MR open
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
    - if: $CI_COMMIT_TAG

frontend-tests:
  script: npm test
  rules:
    - changes: [frontend/**/*]                              # only if frontend changed
```

---

### Q10. `needs` and DAG pipelines

**Short answer:** `needs` lets a job start as soon as the listed jobs finish, ignoring stage order — a **directed acyclic graph**. It also limits which artifacts are downloaded.

```flow
trace: needs builds a DAG
lint ─► test-api;  build-image ─► scan ─► deploy > Each job lists what it actually depends on.
build-image finishes  →  **scan** starts immediately > No waiting for unrelated jobs in the same stage.
test-api still running  →  scan already done > Independent paths progress in parallel.
deploy needs [test-api, scan] > Starts when both are done: shorter total time.
```

```yaml
lint:           { stage: test, script: ruff check . }
build-image:    { stage: build, script: ./build.sh }
scan-image:     { stage: test, needs: [build-image], script: trivy image $IMG }
deploy-dev:     { stage: deploy, needs: [scan-image, lint], script: ./deploy.sh dev }
```
`needs: []` = start immediately.

---

### Q11. `parallel` and `parallel:matrix`

```flow
trace: parallel: 4 splits a test suite
400 tests, one job ≈ **20 min** > Too slow.
parallel: 4  →  jobs 1/4, 2/4, 3/4, 4/4 > Each job knows CI_NODE_INDEX and CI_NODE_TOTAL.
each runs ~100 tests ≈ **5 min** > Split by timing data for balance.
parallel:matrix  →  one job per (python 3.12, 3.13) × (db pg, mysql) > Same job, different variables.
```

```yaml
test:
  parallel: 4                         # split tests into 4 jobs (CI_NODE_INDEX / CI_NODE_TOTAL)
  script: pytest --splits $CI_NODE_TOTAL --group $CI_NODE_INDEX

build:
  parallel:
    matrix:
      - SERVICE: [api, worker, agent]
        ARCH: [amd64, arm64]          # 6 jobs
  script: ./build.sh $SERVICE $ARCH
```

---

### Q12. Manual jobs, approvals and `when`

`when: manual` makes a job wait for a click; with **protected environments**, only allowed users/groups can run it, and **deployment approvals** can require N approvers. `when: delayed` + `start_in: 30 minutes` for timed rollouts.

```flow
pipeline: A gated production deploy
deploy-staging (auto) > Runs on main.
deploy-prod: when manual > Waits for a click.
Protected environment > Only allowed users/groups can run it; approvals may be required.
Deploy runs > Recorded in the environment's deployment history.
```

---

### Q13. `resource_group` — prevent concurrent deploys

```flow
trace: resource_group serialises deploys
pipeline A: deploy-prod **running** > resource_group: production.
pipeline B: deploy-prod **waiting** > Only one job in the group runs at a time.
A finishes  →  B starts > No two deploys touch the same environment or Terraform state at once.
process_mode: newest_first  →  stale queued deploys can be skipped > Optional ordering control.
```

```yaml
deploy-prod:
  resource_group: production         # only one job in this group runs at a time
  environment: production
```
Prevents two pipelines from running `terraform apply` or ECS deploys against the same environment simultaneously. (`process_mode: oldest_first` to keep order.)

---

### Q14. `interruptible` and auto-cancel

`interruptible: true` + project setting "auto-cancel redundant pipelines" (or `workflow:auto_cancel:on_new_commit: interruptible`) cancels outdated pipelines when you push again. Never mark deploy jobs interruptible.

```flow
trace: Auto-cancel redundant pipelines
push commit 1  →  pipeline 1 running > Jobs marked `interruptible: true`.
push commit 2  →  pipeline 2 starts > Same branch, newer commit.
pipeline 1's interruptible jobs **cancelled** > Saves runner time; only the latest commit matters.
deploy jobs: interruptible false > Never cancel a deploy half-way.
```

---

### Q15. Parent-child and multi-project pipelines

```flow
pipeline: Parent-child pipeline in a monorepo
Parent pipeline > Detects what changed.
trigger: include services/api/.gitlab-ci.yml > Child pipeline for api only.
Child runs its own stages > Separate, readable config per component.
strategy: depend > Parent's status reflects the child's result.
```

- **Parent-child:** `trigger: include: path/child.yml` — split a monorepo's pipeline per component; children can be **generated dynamically** by a job.
- **Multi-project (downstream):** `trigger: project: group/other-repo` — e.g., app repo triggers the deployment repo.
- `strategy: depend` makes the parent wait for and mirror the child's status.

```yaml
api-pipeline:
  trigger:
    include: services/api/.gitlab-ci.yml
    strategy: depend
  rules:
    - changes: [services/api/**/*]
```

---

### Q16. Retry, timeout, allow_failure

```flow
pipeline: retry, timeout, allow_failure
Job fails > Why?
Infrastructure flake? > `retry: when: [runner_system_failure, stuck_or_timeout_failure]` retries automatically.
Real test failure > Not retried; fix it.
timeout > Stop hung jobs early.
allow_failure: true > Only for non-blocking checks; the pipeline continues with a warning.
```

```yaml
integration-tests:
  retry:
    max: 2
    when: [runner_system_failure, stuck_or_timeout_failure]   # retry infra flakiness, not test failures
  timeout: 20m
  allow_failure:
    exit_codes: [137]
```

---

## 4. Reuse & structure

### Q17. `include`, `extends`, YAML anchors, `!reference`

```flow
pipeline: How shared CI config is assembled
include (pinned ref) > Pull templates from a central repo at a fixed version.
extends > A job inherits a hidden template job's keys.
!reference > Reuse specific sections (e.g. a script block).
Merged result > Check it in the pipeline editor's "full configuration" view.
```

```yaml
include:
  - project: platform/ci-templates
    ref: v3.2.0                       # pin a version!
    file: /python.yml
  - local: /ci/deploy.yml

.python-base:                          # hidden job (starts with .) = template
  image: python:3.13-slim
  before_script: [pip install uv, uv sync --frozen]

unit:
  extends: .python-base
  script: uv run pytest

lint:
  extends: .python-base
  script:
    - !reference [.python-base, before_script]   # reuse specific sections
    - uv run ruff check .
```

---

### Q18. CI/CD components and the CI/CD Catalog

**Short answer:** Components are **versioned, reusable pipeline building blocks** with typed **inputs**, published to the **CI/CD Catalog**. Better than copy-paste templates: semantic versions, documented inputs, discoverable.

```flow
pipeline: Using a CI/CD component
Platform team publishes > Versioned component with typed inputs to the CI/CD Catalog.
You include it > `include: component: gitlab.com/org/python-ci@1.4.0` with inputs.
Inputs validated > At pipeline creation.
Upgrade deliberately > Bump the version in a merge request.
```

```yaml
# Consumer
include:
  - component: $CI_SERVER_FQDN/platform/components/docker-build@2.1.0
    inputs:
      image_name: $CI_REGISTRY_IMAGE/api
      dockerfile: services/api/Dockerfile

# Component definition (templates/docker-build.yml in the component project)
spec:
  inputs:
    image_name: { type: string }
    dockerfile: { type: string, default: Dockerfile }
---
docker-build:
  script: docker build -f $[[ inputs.dockerfile ]] -t $[[ inputs.image_name ]]:$CI_COMMIT_SHA .
```

---

### Q19. `spec:inputs` for pipelines

Pipelines (and included files) can declare typed inputs with defaults/options, validated at pipeline creation — safer than free-form variables for manual/API-triggered pipelines (e.g., `environment: {options: [dev, staging, prod]}`).

```flow
pipeline: Pipeline with typed inputs
spec: inputs > Declare names, types, defaults, allowed options.
Run pipeline > From UI/API/trigger with values (e.g. environment: staging).
Validated at creation > Bad values rejected before any job runs.
$[[ inputs.environment ]] > Interpolated into the config.
```

---

### Q20. Monorepo strategies

Use `rules:changes` (with `compare_to: refs/heads/main` for MRs), parent-child pipelines per service, shared components for common steps, caching per service lockfile, and a final aggregation job if needed.

```flow
pipeline: Monorepo pipeline that only builds what changed
rules:changes (compare_to main) > Which folders changed in this MR?
Child pipeline per service > Only for changed services.
Shared components > Same build/test logic everywhere.
Run everything on main / nightly > Catch cross-service breakage.
```

---

## 5. Deployments to AWS

### Q21. OIDC federation from GitLab to AWS (no stored keys)

**Short answer:** GitLab issues a signed **ID token (JWT)** per job via `id_tokens`. AWS IAM trusts GitLab as an **OIDC identity provider**; the job calls `sts:AssumeRoleWithWebIdentity` and gets **short-lived credentials**. The IAM role trust policy restricts **which project, branch/tag and environment** may assume it.

```flow
sequence: OIDC from GitLab to AWS (no stored keys)
actors: GitLab job, GitLab, AWS STS, AWS
GitLab job -> GitLab: id_tokens: request JWT (aud = sts.amazonaws.com)
GitLab --> GitLab job: signed JWT (project, ref, environment claims)
GitLab job -> AWS STS: AssumeRoleWithWebIdentity(JWT, role)
AWS STS -> AWS STS: trust policy checks issuer, aud, sub = project:…:ref:main
AWS STS --> GitLab job: temporary credentials (1 h)
GitLab job -> AWS: deploy
```

```
 job ──(id_token: JWT with claims project_path, ref, ref_protected, environment)──► AWS STS
     ◄──────────────── temporary credentials (1 h) for role "deploy-prod" ─────────────────
```
```yaml
deploy-prod:
  image: amazon/aws-cli:2.17.0
  id_tokens:
    AWS_ID_TOKEN:
      aud: https://gitlab.example.com
  script:
    - >
      export $(aws sts assume-role-with-web-identity
      --role-arn $PROD_ROLE_ARN --role-session-name "gl-$CI_PIPELINE_ID"
      --web-identity-token "$AWS_ID_TOKEN" --duration-seconds 3600
      --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' --output text
      | awk '{print "AWS_ACCESS_KEY_ID="$1" AWS_SECRET_ACCESS_KEY="$2" AWS_SESSION_TOKEN="$3}')
    - aws ecs update-service --cluster prod --service api --force-new-deployment
  environment: production
```
```json
// IAM role trust policy (condition keys use the IdP host)
{ "Effect": "Allow",
  "Principal": { "Federated": "arn:aws:iam::123456789012:oidc-provider/gitlab.example.com" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": { "gitlab.example.com:aud": "https://gitlab.example.com" },
    "StringLike":   { "gitlab.example.com:sub": "project_path:payments/api:ref_type:branch:ref:main" } } }
```
**Pitfall:** a trust policy that only checks `aud` lets *any* project on that GitLab assume the role.

---

### Q22. Build and tag a Docker image properly

```flow
pipeline: Building and tagging an image
Build (BuildKit / Kaniko) > With cache from the registry.
Tag with commit SHA > Immutable, traceable: app:3f2a9c1.
Scan + SBOM > Fail on critical vulnerabilities.
Push > Record the digest (sha256:…).
Deploy by digest > Exactly the image that was tested.
```

```yaml
build-image:
  image: docker:27
  services: [docker:27-dind]           # or use Kaniko/Buildah rootless builders
  variables: { DOCKER_TLS_CERTDIR: "/certs" }
  script:
    - echo "$CI_REGISTRY_PASSWORD" | docker login -u "$CI_REGISTRY_USER" --password-stdin $CI_REGISTRY
    - docker buildx build --platform linux/arm64
        --cache-from type=registry,ref=$CI_REGISTRY_IMAGE:cache
        --cache-to type=registry,ref=$CI_REGISTRY_IMAGE:cache,mode=max
        -t $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA --push .
```
Tag with the **commit SHA** (immutable, traceable); deploy by **digest**; add semver tags on release. For ECR, log in via OIDC credentials (`aws ecr get-login-password`). Docker-in-Docker needs privileged runners — prefer rootless builders (BuildKit rootless, Kaniko, Buildah) on shared runners.

---

### Q23. Environments and protected deployments

`environment:` records deployments (history, current version, URL, rollback button). **Protected environments** restrict who can deploy; **approval rules** require sign-off; environment-scoped variables give each environment its own config; `deployment_tier` classifies (production/staging/development); `on_stop` + `auto_stop_in` for review apps.

```flow
pipeline: Environments and protected deployments
environment: production > Each deploy is recorded: version, time, who.
Protected environment > Only allowed users/groups may deploy.
Approval rules > N approvers required before the job runs.
Rollback > Re-run the previous successful deployment from the environment page.
```

---

### Q24. Terraform in GitLab safely

```flow
pipeline: Terraform in GitLab
MR: plan > `terraform plan -out=plan.tfplan` with a read-only role; plan shown in the MR.
Review > Humans read the plan; policy checks (OPA/checkov).
main: apply the saved plan > Exactly what was reviewed, with a write role.
resource_group + state lock > Only one apply at a time.
```

```yaml
plan:
  stage: plan
  script:
    - terraform init -input=false
    - terraform plan -out=plan.tfplan -input=false
    - terraform show -json plan.tfplan > plan.json      # for policy checks (OPA/Checkov) & MR widget
  artifacts: { paths: [plan.tfplan, plan.json], expire_in: 1 day }
  resource_group: tf-prod

apply:
  stage: apply
  needs: [plan]
  script: terraform apply -input=false plan.tfplan      # apply EXACTLY the reviewed plan
  when: manual
  environment: production
  resource_group: tf-prod
  rules: [{ if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH }]
```
Remote state with locking (S3 + lockfile, or GitLab-managed Terraform state), OIDC roles split into read-only plan role and apply role, pinned provider versions via lockfile, policy checks before apply.

---

### Q25. Deploying to ECS / Lambda / S3+CloudFront

```flow
pipeline: Deploying to ECS
Register task definition > New revision with the new image digest.
Update service > ECS starts a rolling or blue/green deployment.
Wait for steady state > `aws ecs wait services-stable`; health checks pass.
Watch alarms > Circuit breaker / CodeDeploy rolls back on failure.
```

- **ECS:** register new task definition with the new image digest → update service → wait for steady state (`aws ecs wait services-stable`) → circuit breaker auto-rollback; or CodeDeploy blue/green.
- **Lambda:** publish version → shift alias traffic (CodeDeploy canary/linear) with alarms.
- **SPA:** upload hashed assets → upload `index.html` → CloudFront invalidation.

---

### Q26. Atomic and rollbackable deployments

Immutable artifacts (image digest / versioned bundle), deploy references not rebuilds, health checks and alarms gate traffic shift, keep the previous version runnable, one-click rollback (GitLab environment "re-deploy previous", ECS previous task definition, Lambda alias back), DB migrations backward-compatible (expand → migrate → contract).

```flow
pipeline: Atomic, rollbackable deploy
Immutable artifact > Image digest / versioned bundle.
Deploy a reference > Point the service at the new version; never rebuild in deploy.
Health checks + alarms > Decide success automatically.
Rollback = point back > The previous version still exists.
```

---

### Q27. Promotion: build once, deploy many

Build the artifact once on main → push to registry → deploy the **same digest** to dev → staging → prod with environment-specific config injected at deploy time. Never rebuild for production.

```flow
trace: Build once, promote the same digest
build on main  →  app@sha256:**ab12** > One artifact.
dev  →  deploy ab12 ✓ tests > Same digest.
staging  →  deploy **ab12** ✓ evals + load test > Not rebuilt: what you tested is what ships.
prod  →  deploy **ab12** > Only configuration differs per environment.
```

---

## 6. Security & supply chain

### Q28. How CI/CD becomes an attack path

```flow
pipeline: How a CI pipeline gets attacked, and the guard for each
Malicious MR edits .gitlab-ci.yml > Protected variables only on protected branches; MR pipelines from forks have no secrets.
Compromised dependency > Lockfiles, pinned versions, scanning.
Shared runner abuse > Protected runners for deploy jobs; ephemeral runners.
Long-lived cloud keys > OIDC with branch-scoped trust instead.
Tampered images > Signing + verification before deploy.
```

- Malicious MR modifies `.gitlab-ci.yml` to print secrets → protected variables + protected runners + MR pipelines from forks run without secrets.
- Compromised dependency/plugin/image runs in your job → pin versions/digests, use lockfiles, scan.
- Over-privileged deploy credentials → OIDC with narrow trust conditions, least-privilege roles per environment.
- Shared shell runners leak between projects → isolated ephemeral executors.
- Tampered artifacts → checksums, signing (Cosign/Sigstore), provenance (SLSA attestations).

---

### Q29. Types of scanning

```flow
pipeline: Security scans in the pipeline
Secret detection > Leaked keys in commits.
SAST > Insecure code patterns.
Dependency scanning > Known-vulnerable packages.
Container scanning > OS and library CVEs in the image.
IaC scanning / DAST > Misconfigured Terraform; running-app tests. Enforced by security policies so teams can't remove them.
```

| Scan | Finds | GitLab feature / tool |
|---|---|---|
| **SAST** | insecure code patterns | SAST (Semgrep-based) |
| **Secret detection** | leaked keys in commits | Secret Detection (+ push protection) |
| **Dependency scanning / SCA** | vulnerable libraries | Dependency Scanning |
| **Container scanning** | OS/package CVEs in images | Container Scanning (Trivy) |
| **IaC scanning** | insecure Terraform/K8s config | IaC Scanning (KICS), Checkov, tfsec |
| **DAST** | runtime web vulnerabilities | DAST |
| **License compliance** | disallowed licenses | dependency/license reports |

Use **security policies** (scan execution / merge request approval policies) so teams can't silently remove scans.

---

### Q30. Secrets and logs in pipelines

Prefer OIDC and runtime secret fetch over stored secrets; masked + protected + environment-scoped variables; never `set -x` with secrets; don't write secrets into artifacts or Docker image layers (use BuildKit secret mounts); rotate on exposure; limit who can run pipelines on protected branches.

```flow
pipeline: Keeping secrets out of pipelines
Prefer OIDC > No stored cloud keys.
Fetch at runtime > From Secrets Manager / Vault inside the job.
Masked + protected + scoped > For any variable that must exist.
Never echo > No `set -x` around secrets; scrub logs.
Rotate on exposure > Treat any leak as compromise.
```

---

### Q31. Signing and provenance

Sign images with Cosign using GitLab's OIDC ID token (keyless, Sigstore), generate SBOM (Syft / CycloneDX), store attestations; verify signatures at deploy time (admission policy) so only images built by your pipeline run in production.

```flow
pipeline: Signing and provenance
Build image > In CI.
Generate SBOM > Syft / CycloneDX.
Sign keylessly > Cosign with the job's OIDC token (Sigstore).
Attest provenance > Which pipeline, commit and builder produced it.
Verify before deploy > Admission policy rejects unsigned images.
```

---

### Q32. Protecting the pipeline definition itself

Protected branches + code owners for `.gitlab-ci.yml` and `ci/` folder, required approvals, compliance pipelines / pipeline execution policies enforced by the security team, pinned includes/components by version.

---

## 7. Performance & reliability

### Q33. Optimising pipeline duration

Measure first (pipeline analytics: slowest jobs). Then: `needs` DAG, `rules:changes` to skip unaffected work, caching keyed by lockfile, Docker layer/registry cache, smaller images, test splitting with `parallel`, fail-fast lint jobs first, `interruptible` + auto-cancel, autoscaling runners, avoid huge artifacts.

```flow
pipeline: Making a slow pipeline fast
Measure > Pipeline analytics: slowest jobs and waiting time.
needs (DAG) > Remove stage barriers.
rules:changes > Skip work unaffected by the change.
Cache + smaller images > Faster setup.
Parallelise tests > Split by timing.
```

---

### Q34. Flaky tests and CI reliability

Track flaky tests (JUnit reports show history), quarantine them with an owner and deadline, retry only infra failures, use deterministic test data, containerised dependencies (`services:` Postgres/Redis), and timeouts.

```flow
pipeline: Handling flaky tests
Detect > JUnit report history shows intermittent failures.
Quarantine > Move to a non-blocking job, with an owner and deadline.
Fix root cause > Timing, shared state, external dependencies.
Retry only infra failures > Never hide real test failures with retries.
```

---

### Q35. CI environment vs production parity

Use the same base image / runtime version, same build artifact, ephemeral real dependencies (Postgres container, LocalStack/moto or a sandbox AWS account), contract tests against real APIs in staging. Document known gaps (IAM, network, scale) and cover them with staging smoke tests.

---

## 8. Scenario & debugging questions

### Q36. Deployment works on `main` but fails in an MR pipeline

Likely **protected variables/OIDC role conditions** only available on protected `main`, so MR jobs lack credentials — by design. Also check `rules` (job not created), different pipeline source variables, fork MRs running without secrets. Fix: MR pipelines should run tests/plan with a read-only role, not deploy.

```flow
pipeline: Works on main, fails in MR
Protected variables? > Only exposed to protected branches like main.
OIDC trust condition > Role trusts only `ref:main`.
Fork MR? > Fork pipelines get no project secrets.
Fix > Separate read-only role for MRs; deploy only from main.
```

---

### Q37. Pipeline triggers twice for one push

Both a **branch pipeline** and an **MR pipeline** were created. Fix with `workflow:rules` (the `$CI_OPEN_MERGE_REQUESTS` pattern in Q09) or choose MR pipelines only. Also check webhooks/schedules/trigger jobs creating extra pipelines.

```flow
trace: Duplicate pipelines for one push
push to branch with an open MR > Two events: a branch push and an MR update.
branch pipeline **+** MR pipeline > Both created.
workflow:rules: if MR event → run; if branch has open MR → **never** > Keep only the MR pipeline while an MR is open.
one pipeline per push > Saves runners and confusion.
```

---

### Q38. Two pipelines deployed at once and corrupted Terraform state / ECS service

Add `resource_group` for each environment, use state locking, make deploy jobs non-interruptible, and ensure only one branch deploys to each environment.

```flow
pipeline: Preventing concurrent deploy damage
resource_group per environment > One deploy at a time.
State locking > S3 lockfile / DynamoDB for Terraform.
Idempotent deploy steps > Safe to re-run.
Recover > Unlock only after confirming nothing is running; reconcile state.
```

---

### Q39. Job fails with "no space left on device" / slow runners

Runner disk full from Docker images/cache → prune policies, ephemeral autoscaled runners, smaller images, clean build directories, reduce artifact sizes.

```flow
pipeline: Runner out of disk / slow
Find the cause > Docker images, build cache, artifacts piling up.
Prune > Scheduled `docker system prune`, cache limits.
Ephemeral runners > Autoscaled, fresh disk per job.
Right-size > More disk/CPU for heavy jobs; smaller base images.
```

---

### Q40. Design an ideal pipeline for an AI service (FastAPI + LangGraph agent)

```flow
pipeline: Ideal pipeline for an AI service
stage: Merge request pipeline (parallel jobs)
Lint + type check > ruff, mypy.
Unit tests (fake LLM) > Fast, deterministic, no model calls.
Security scans > SAST, secret detection, dependency scan.
Build image (SHA) > Then container scan + SBOM.
LLM eval suite > Golden set with quality, cost and latency budgets.
Terraform plan > Read-only role + policy checks.
stage: Main branch pipeline
Push signed image > Same image promoted everywhere.
Deploy dev → tests > Automatic deploy + integration/smoke tests.
Deploy staging → eval + load > Evaluation and load tests against a real environment.
Deploy prod > Manual, protected environment, approvals, `resource_group`, canary or blue/green, auto-rollback on alarms.
```
Credentials via OIDC per environment; prompts/model IDs/tool schemas versioned with the code; eval results attached as MR reports.

---

## 9. Git essentials

### Q41. How does Git store history? (commits, branches, HEAD)

**Short answer:** A **commit** is a snapshot of the project plus a pointer to its parent commit(s), identified by a SHA hash. A **branch** is just a movable label pointing at a commit. **HEAD** points to what you have checked out. Creating a branch is cheap because it only creates a pointer.

```flow
trace: What a commit and a branch really are
commit C = snapshot + parent B + author + message → id **9f3e…** > The id is a hash of all of that.
main ──► C > A branch is just a movable pointer to a commit.
git commit  →  D (parent C);  main ──► **D** > The branch pointer moves forward.
HEAD ──► main > HEAD says which branch you're on.
```

```
          A ── B ── C        ← main
                     \
                      D ── E ← feature   (HEAD)
git commit on feature → new commit F after E, "feature" label moves to F; main stays at C
```
Three areas: **working directory** (your files) → `git add` → **staging area/index** → `git commit` → **repository**.

---

### Q42. Merge vs rebase vs squash

```flow
trace: Merge vs rebase vs squash
A ─ B ─ C (main);  B ─ D ─ E (feature) > Starting point.
merge: A ─ B ─ C ─ **M** (M has parents C and E) > True history kept; a merge commit appears.
rebase: A ─ B ─ C ─ **D′ ─ E′** > Commits replayed on top: linear, with NEW ids. Never on shared commits.
squash: A ─ B ─ C ─ **S** > All feature commits become one.
```

```
Before:     A ── B ── C          main
                 \
                  D ── E         feature

MERGE:      A ── B ── C ──── M   main      (M has two parents; true history kept)
                 \          /
                  D ── E ──

REBASE:     A ── B ── C ── D' ── E'        (feature's commits replayed on top of C; linear; NEW hashes)

SQUASH:     A ── B ── C ── S               (all feature commits become one commit S)
```
| | Merge | Rebase | Squash merge |
|---|---|---|---|
| History | true, with merge commits | linear, rewritten | one commit per MR |
| Safe on shared branches? | yes | **no** — never rebase commits others already pulled | yes (done at merge time) |
| Use for | integrating to main | updating *your own* feature branch onto latest main | clean main history per feature |

**Golden rule:** rebase only local/private commits. If you must update a pushed feature branch after rebase, use `git push --force-with-lease` (refuses if someone else pushed).

---

### Q43. Branching strategies

```flow
pipeline: Trunk-based development
Short-lived branch > Hours to two days.
MR pipeline + review > Small, easy to review.
Merge to main often > Unfinished features hidden behind flags.
main always deployable > Deploy continuously.
```

| Strategy | How | Fits |
|---|---|---|
| **Trunk-based** | short-lived branches (hours–2 days) merged to `main` often; feature flags hide unfinished work | CI/CD, frequent deploys (recommended default) |
| **GitLab Flow** | `main` + environment/release branches (`production`, `release/1.4`) | controlled promotion between environments |
| **GitFlow** | `develop`, `feature/*`, `release/*`, `hotfix/*`, `main` | versioned products with slow releases; heavy for web services |

Pair with **protected branches**, required MR approvals, required pipelines, and merge trains (Q08).

---

### Q44. Resolving merge conflicts

A conflict happens when both sides changed the same lines. Git marks them:
```
<<<<<<< HEAD
timeout = 30
=======
timeout = 60
>>>>>>> feature/longer-timeout
```
Decide the correct combined result (talk to the other author if unclear), remove the markers, run the tests, `git add`, then `git commit` (merge) or `git rebase --continue`. Reduce conflicts with small, frequent merges and clear module ownership.

```flow
pipeline: Resolving a merge conflict
Git stops and marks the file > <<<<<<< ours / ======= / >>>>>>> theirs.
Decide the combined result > Talk to the other author if unsure.
Remove markers, run tests > Make sure it actually works.
git add + commit / rebase --continue > Conflict resolved.
```

---

### Q45. Undoing things: `restore`, `reset`, `revert`, `reflog`

```flow
pipeline: Which undo to use
Uncommitted change to a file > `git restore file`.
Undo your last local commit, keep changes > `git reset --soft HEAD~1`.
Undo a commit already on main > `git revert <sha>`: a new commit that reverses it.
"Lost" commits after reset/rebase > `git reflog` to find and restore them.
```

| Command | Does | Safe on shared history? |
|---|---|---|
| `git restore file` | discard uncommitted changes to a file | yes (local only) |
| `git restore --staged file` | unstage | yes |
| `git reset --soft HEAD~1` | undo last commit, keep changes staged | local only |
| `git reset --hard <sha>` | move branch and **discard** changes | ⚠ destroys local work; never on shared branches |
| `git revert <sha>` | create a new commit that undoes an old one | **yes — the way to undo on `main`** |
| `git reflog` | log of where HEAD has been | rescue "lost" commits after a bad reset/rebase |

---

### Q46. `cherry-pick`, tags, `stash`, `bisect`

```flow
trace: git bisect finds the bad commit
v1.3 good … HEAD bad: 64 commits between > Binary search over history.
test the middle commit (32) → **bad** > The bug is in the first half.
test commit 16 → good;  24 → bad;  20 → … > Halve each time.
~6 steps  →  **first bad commit found** > log₂(64) = 6. Automate with `git bisect run ./test.sh`.
```

- **cherry-pick:** copy one commit onto another branch (e.g. a hotfix from `main` into `release/1.4`).
- **Tags:** named pointers to a release commit (`v1.4.2`, semantic versioning MAJOR.MINOR.PATCH); a tag pipeline can publish the release.
- **stash:** park uncommitted work temporarily.
- **bisect:** binary-search the history to find the commit that introduced a bug (`git bisect start; git bisect bad; git bisect good v1.3`).

**Pitfall:** a secret committed and then deleted in a later commit is still in history — rotate it first, then rewrite history if required (16 Q31).

---

## 10. Cheat sheet

| Concept | One-liner |
|---|---|
| Merge vs rebase | merge keeps history; rebase only private commits; squash for clean main |
| Undo on main | `git revert`, never `reset --hard` shared history; `reflog` to rescue |
| Branching | trunk-based + feature flags by default |
| Pipeline/stage/job | run / ordered group / unit of work |
| Runner/executor | agent that runs jobs / how it isolates them |
| `rules` / `workflow:rules` | include job / create pipeline |
| `needs` | DAG; start when deps finish |
| Artifacts vs cache | outputs (reliable) vs speed-up (best effort) |
| Variables | masked, protected, env-scoped; prefer OIDC |
| `id_tokens` | JWT for AWS `AssumeRoleWithWebIdentity` |
| Trust policy | restrict `sub` to project + ref |
| `resource_group` | one deploy at a time per env |
| Environments | deployment history, protection, approvals, rollback |
| Components | versioned reusable CI with typed inputs (Catalog) |
| Parent-child | split/dynamic pipelines; `strategy: depend` |
| Merge trains | test MRs in merge order |
| Supply chain | pin, scan, sign, SBOM, protected runners |
| Deploy | build once, deploy same digest everywhere |

## Official references

- https://docs.gitlab.com/ci/ · YAML reference: https://docs.gitlab.com/ci/yaml/
- Rules: https://docs.gitlab.com/ci/jobs/job_rules/
- Components: https://docs.gitlab.com/ci/components/
- OIDC with AWS: https://docs.gitlab.com/ci/cloud_services/aws/
- Environments: https://docs.gitlab.com/ci/environments/
- Application security: https://docs.gitlab.com/user/application_security/
