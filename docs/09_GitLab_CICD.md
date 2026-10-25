# GitLab CI/CD: L2 → L3 Interview Preparation

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

GitLab implements all three with `.gitlab-ci.yml`, environments, approvals and runners.

---

### Q02. What is `.gitlab-ci.yml`? Show a minimal pipeline.

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

---

### Q05. Artifacts vs cache

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

Better: don't store long-lived cloud keys at all — use **OIDC** (`id_tokens`) to get short-lived AWS credentials, and fetch app secrets at runtime from AWS Secrets Manager / Vault (`secrets:` keyword supports external secret managers).

**Pitfall:** masking isn't bulletproof (e.g., `echo $SECRET | base64` prints it). Restrict who can edit pipelines that run with secrets.

---

### Q07. Predefined pipeline sources

`CI_PIPELINE_SOURCE` = `push`, `merge_request_event`, `schedule`, `web`, `api`, `trigger`, `parent_pipeline`, `pipeline` … — used in `rules` to decide which jobs run where.

---

### Q08. Merge request pipelines, merged-results pipelines and merge trains

- **Branch pipeline** — runs for a push to a branch.
- **MR pipeline** — runs in the context of an MR (`merge_request_event`), can access MR variables.
- **Merged-results pipeline** — tests the result of merging the MR into the target branch.
- **Merge train** — queue of MRs; each is tested on top of the ones ahead → main never breaks from "green individually, red together" merges.

---

## 3. Controlling pipelines

### Q09. `rules` and `workflow:rules`

**Short answer:** `workflow:rules` decides **whether a pipeline is created at all**. Job `rules` decide **whether each job is added** and how (`when: on_success | manual | delayed | never`, `allow_failure`, variables). First matching rule wins. (`rules` replaced the older `only/except`.)

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

```yaml
lint:           { stage: test, script: ruff check . }
build-image:    { stage: build, script: ./build.sh }
scan-image:     { stage: test, needs: [build-image], script: trivy image $IMG }
deploy-dev:     { stage: deploy, needs: [scan-image, lint], script: ./deploy.sh dev }
```
`needs: []` = start immediately.

---

### Q11. `parallel` and `parallel:matrix`

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

---

### Q13. `resource_group` — prevent concurrent deploys

```yaml
deploy-prod:
  resource_group: production         # only one job in this group runs at a time
  environment: production
```
Prevents two pipelines from running `terraform apply` or ECS deploys against the same environment simultaneously. (`process_mode: oldest_first` to keep order.)

---

### Q14. `interruptible` and auto-cancel

`interruptible: true` + project setting "auto-cancel redundant pipelines" (or `workflow:auto_cancel:on_new_commit: interruptible`) cancels outdated pipelines when you push again. Never mark deploy jobs interruptible.

---

### Q15. Parent-child and multi-project pipelines

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

---

### Q20. Monorepo strategies

Use `rules:changes` (with `compare_to: refs/heads/main` for MRs), parent-child pipelines per service, shared components for common steps, caching per service lockfile, and a final aggregation job if needed.

---

## 5. Deployments to AWS

### Q21. OIDC federation from GitLab to AWS (no stored keys)

**Short answer:** GitLab issues a signed **ID token (JWT)** per job via `id_tokens`. AWS IAM trusts GitLab as an **OIDC identity provider**; the job calls `sts:AssumeRoleWithWebIdentity` and gets **short-lived credentials**. The IAM role trust policy restricts **which project, branch/tag and environment** may assume it.

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

---

### Q24. Terraform in GitLab safely

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

- **ECS:** register new task definition with the new image digest → update service → wait for steady state (`aws ecs wait services-stable`) → circuit breaker auto-rollback; or CodeDeploy blue/green.
- **Lambda:** publish version → shift alias traffic (CodeDeploy canary/linear) with alarms.
- **SPA:** upload hashed assets → upload `index.html` → CloudFront invalidation.

---

### Q26. Atomic and rollbackable deployments

Immutable artifacts (image digest / versioned bundle), deploy references not rebuilds, health checks and alarms gate traffic shift, keep the previous version runnable, one-click rollback (GitLab environment "re-deploy previous", ECS previous task definition, Lambda alias back), DB migrations backward-compatible (expand → migrate → contract).

---

### Q27. Promotion: build once, deploy many

Build the artifact once on main → push to registry → deploy the **same digest** to dev → staging → prod with environment-specific config injected at deploy time. Never rebuild for production.

---

## 6. Security & supply chain

### Q28. How CI/CD becomes an attack path

- Malicious MR modifies `.gitlab-ci.yml` to print secrets → protected variables + protected runners + MR pipelines from forks run without secrets.
- Compromised dependency/plugin/image runs in your job → pin versions/digests, use lockfiles, scan.
- Over-privileged deploy credentials → OIDC with narrow trust conditions, least-privilege roles per environment.
- Shared shell runners leak between projects → isolated ephemeral executors.
- Tampered artifacts → checksums, signing (Cosign/Sigstore), provenance (SLSA attestations).

---

### Q29. Types of scanning

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

---

### Q31. Signing and provenance

Sign images with Cosign using GitLab's OIDC ID token (keyless, Sigstore), generate SBOM (Syft / CycloneDX), store attestations; verify signatures at deploy time (admission policy) so only images built by your pipeline run in production.

---

### Q32. Protecting the pipeline definition itself

Protected branches + code owners for `.gitlab-ci.yml` and `ci/` folder, required approvals, compliance pipelines / pipeline execution policies enforced by the security team, pinned includes/components by version.

---

## 7. Performance & reliability

### Q33. Optimising pipeline duration

Measure first (pipeline analytics: slowest jobs). Then: `needs` DAG, `rules:changes` to skip unaffected work, caching keyed by lockfile, Docker layer/registry cache, smaller images, test splitting with `parallel`, fail-fast lint jobs first, `interruptible` + auto-cancel, autoscaling runners, avoid huge artifacts.

---

### Q34. Flaky tests and CI reliability

Track flaky tests (JUnit reports show history), quarantine them with an owner and deadline, retry only infra failures, use deterministic test data, containerised dependencies (`services:` Postgres/Redis), and timeouts.

---

### Q35. CI environment vs production parity

Use the same base image / runtime version, same build artifact, ephemeral real dependencies (Postgres container, LocalStack/moto or a sandbox AWS account), contract tests against real APIs in staging. Document known gaps (IAM, network, scale) and cover them with staging smoke tests.

---

## 8. Scenario & debugging questions

### Q36. Deployment works on `main` but fails in an MR pipeline

Likely **protected variables/OIDC role conditions** only available on protected `main`, so MR jobs lack credentials — by design. Also check `rules` (job not created), different pipeline source variables, fork MRs running without secrets. Fix: MR pipelines should run tests/plan with a read-only role, not deploy.

---

### Q37. Pipeline triggers twice for one push

Both a **branch pipeline** and an **MR pipeline** were created. Fix with `workflow:rules` (the `$CI_OPEN_MERGE_REQUESTS` pattern in Q09) or choose MR pipelines only. Also check webhooks/schedules/trigger jobs creating extra pipelines.

---

### Q38. Two pipelines deployed at once and corrupted Terraform state / ECS service

Add `resource_group` for each environment, use state locking, make deploy jobs non-interruptible, and ensure only one branch deploys to each environment.

---

### Q39. Job fails with "no space left on device" / slow runners

Runner disk full from Docker images/cache → prune policies, ephemeral autoscaled runners, smaller images, clean build directories, reduce artifact sizes.

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

```
          A ── B ── C        ← main
                     \
                      D ── E ← feature   (HEAD)
git commit on feature → new commit F after E, "feature" label moves to F; main stays at C
```
Three areas: **working directory** (your files) → `git add` → **staging area/index** → `git commit` → **repository**.

---

### Q42. Merge vs rebase vs squash

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

---

### Q45. Undoing things: `restore`, `reset`, `revert`, `reflog`

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
