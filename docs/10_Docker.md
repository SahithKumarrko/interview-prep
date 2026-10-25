# Docker: Interview Preparation

> **Updated:** 24 October 2026 · **Level:** containers basics → Dockerfile mastery → security & production on ECS
> **How to use:** *Short answer* = what you say first. *Explanation / Example* = intuition and code. *Pitfall / Follow-up* = where interviewers dig.

---

## Table of contents

1. [Mental model: what a container really is](#1-mental-model-what-a-container-really-is)
2. [Fundamentals](#2-fundamentals) (Q01–Q08)
3. [Dockerfile in depth](#3-dockerfile-in-depth) (Q09–Q18)
4. [Networking, storage, Compose](#4-networking-storage-compose) (Q19–Q23)
5. [Runtime behaviour: signals, health, resources](#5-runtime-behaviour-signals-health-resources) (Q24–Q27)
6. [Security & supply chain](#6-security--supply-chain) (Q28–Q33)
7. [Scenario & debugging questions](#7-scenario--debugging-questions) (Q34–Q39)
8. [Cheat sheet](#8-cheat-sheet)

---

## 1. Mental model: what a container really is

**A container is just a normal Linux process with isolation and limits** — not a mini-VM.

```
 ┌──────────────────────── Virtual machines ───────────────────┐   ┌──────────────────────── Containers ─────────────────────────┐
 │  App A      App B                                          │   │  App A        App B        App C                            │
 │  Libs       Libs                                           │   │  Libs         Libs         Libs     ← image layers           │
 │  Guest OS   Guest OS   ← full kernel each (GBs, slow boot)  │   │ ───────────── container runtime (containerd/runc) ─────────  │
 │ ───────── Hypervisor ─────────                              │   │  Host OS kernel  ← SHARED (MBs, starts in ms)                │
 │  Hardware                                                   │   │  Hardware                                                    │
 └─────────────────────────────────────────────────────────────┘   └──────────────────────────────────────────────────────────────┘
```

Linux features that make a container:
- **Namespaces** — what the process can *see*: own PID tree, network stack, mount points, hostname, users.
- **cgroups** — what it can *use*: CPU, memory, I/O limits.
- **Union filesystem (overlayfs)** — image layers stacked read-only + one thin writable layer.
- **Capabilities, seccomp, AppArmor/SELinux** — what it's *allowed to do* (syscalls, privileges).

**Docker architecture:**
```flow
sequence: What actually runs when you type docker run
actors: docker CLI, dockerd, containerd, runc, Registry
docker CLI -> dockerd: REST API: run nginx
dockerd -> Registry: pull image (if missing)
Registry --> dockerd: layers
dockerd -> containerd: create container
containerd -> runc: start process
> runc sets up namespaces (isolation) and cgroups (limits), then starts your process. A container is just an isolated Linux process.
runc --> docker CLI: container running
```

**Image → container lifecycle:**
```flow
pipeline: Image to container lifecycle
Dockerfile > Instructions, each creating a layer.
build > Produces an image: read-only layers with an ID/digest.
push → registry > ECR, Docker Hub or the GitLab registry.
run > Container = image layers + a thin writable layer + a process + config.
created → running → stopped > Stopping keeps the writable layer.
removed > The writable layer is deleted. Anything not in a volume is lost.
```

---

## 2. Fundamentals

### Q01. Container vs VM

**Short answer:** A VM virtualises **hardware** and runs a full guest OS kernel; a container virtualises the **OS** — processes share the host kernel, isolated by namespaces and limited by cgroups. Containers are lighter and start faster; VMs give stronger isolation. (Fargate/AgentCore/Lambda add microVM isolation underneath containers for multi-tenant safety.)

```flow
pipeline: Container vs VM, layer by layer
Hardware > Same physical machine.
VM: hypervisor → full guest OS per VM > Strong isolation, GBs, boots in tens of seconds.
Container: one host kernel > Shared by all containers.
Namespaces + cgroups > Each container is an isolated, limited process. MBs, starts in milliseconds.
```

---

### Q02. Image vs container

**Short answer:** An **image** is an immutable template (layers + metadata: entrypoint, env, user). A **container** is a running (or stopped) instance of an image with its own writable layer. Many containers can run from one image.

```flow
pipeline: Image vs container
Image > Read-only layered template (like a class).
docker run > Adds a thin writable layer + config + a process.
Container > A running instance (like an object). Many containers can share one image.
Remove container > Writable layer is gone; the image stays.
```

```bash
docker build -t api:1.4.0 .
docker run -d --name api1 -p 8000:8000 api:1.4.0
docker run -d --name api2 -p 8001:8000 api:1.4.0     # same image, separate container
docker ps; docker logs -f api1; docker exec -it api1 sh; docker stop api1; docker rm api1
```

---

### Q03. Registries, repositories, tags and digests

**Short answer:** A registry stores images (`123456789012.dkr.ecr.ap-south-1.amazonaws.com/api`). A **tag** (`:1.4.0`, `:latest`) is a **movable** label. A **digest** (`@sha256:ab12…`) is the content hash — **immutable**. Deploy by digest (or immutable tags) so "what's running" is unambiguous.

```flow
trace: Tags move, digests don't
push app:1.4  →  digest sha256:**aa11** > A tag is a name pointing at a digest.
push app:1.4 again (rebuilt)  →  sha256:**bb22** > The same tag now points somewhere else.
pull app@sha256:aa11  →  always the original image > A digest is the content hash: immutable.
deploy by digest (or immutable tags in ECR) > What you tested is what runs.
```

```bash
aws ecr get-login-password | docker login --username AWS --password-stdin $ECR
docker tag api:1.4.0 $ECR/api:git-3f9c2ab
docker push $ECR/api:git-3f9c2ab        # prints digest sha256:...
```
**ECR features:** private repos, IAM auth, **tag immutability**, image scanning (basic / enhanced with Inspector), lifecycle policies (delete old images), replication, pull-through cache.

---

### Q04. `.dockerignore`

**Short answer:** Excludes files from the **build context** sent to the builder → faster builds, smaller images, no secrets leaking into layers, better cache hits.

```flow
pipeline: What .dockerignore saves
docker build . > Sends the build context to the builder.
.dockerignore filters > .git, node_modules, .env, test data excluded.
Smaller context > Faster builds, better cache hits.
No secrets in the image > `.env` never gets COPY'd by accident.
```

```
.git
.venv
node_modules
__pycache__/
*.pyc
.env
tests/
dist/
```

---

### Q05. Image layers and build cache

**Short answer:** Each filesystem-changing instruction (`RUN`, `COPY`, `ADD`) creates a layer. Docker reuses a cached layer if the instruction **and its inputs** are unchanged; once a layer changes, **all later layers rebuild**. So: put rarely-changing steps first (install dependencies), frequently-changing steps last (copy source).

```flow
trace: Layer cache: why order matters
FROM python:3.13-slim  ✓ cached > Each instruction is a layer, cached by its inputs.
COPY requirements.txt + RUN pip install  ✓ **cached** > Dependencies change rarely, so this expensive layer is reused.
COPY . .  ✗ rebuilt (code changed) > Code changes every commit.
if COPY . . came first → pip install **rebuilds every time** > Put rarely-changing steps first.
```

```dockerfile
# ❌ any code change reinstalls all dependencies
COPY . .
RUN pip install -r requirements.txt

# ✅ dependencies cached until requirements change
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
```
**Pitfall:** deleting files in a later layer doesn't shrink the image — the earlier layer still contains them. Clean up **in the same `RUN`**.

---

### Q06. Ports: `EXPOSE` vs publishing

`EXPOSE 8000` is **documentation/metadata** only. `-p 8080:8000` actually **publishes** host port 8080 → container port 8000. In ECS/awsvpc you set `containerPort` in the task definition; the ENI gets the port directly.

```flow
sequence: EXPOSE vs publishing a port
actors: Browser, Host :8080, Container :8000
Browser -> Host :8080: request
Host :8080 -> Container :8000: forwarded by -p 8080:8000
> `EXPOSE 8000` is only documentation. `-p` (or the ECS port mapping) actually opens the path.
Container :8000 --> Browser: response
```

---

### Q07. Essential CLI for debugging

```flow
pipeline: Debugging a container from the CLI
docker ps -a > Is it running? Exit code?
docker logs > What did it print?
docker inspect > Config, env, mounts, State.OOMKilled.
docker exec -it … sh > Look around inside a running container.
docker stats > Live CPU and memory.
```

```bash
docker logs --tail 100 -f <c>          # stdout/stderr
docker inspect <c>                     # config, state, exit code, OOMKilled, mounts, network
docker exec -it <c> sh                 # shell into running container
docker run --rm -it --entrypoint sh img # start image with a shell instead of its entrypoint
docker stats                           # live CPU/mem
docker history img; docker image inspect img   # layers and metadata
docker system df; docker system prune  # disk usage / cleanup
```

---

### Q08. Docker vs containerd vs Podman vs OCI

**OCI** standards define image format and runtime spec, so images built by Docker run on containerd (Kubernetes/ECS), Podman (daemonless, rootless) etc. Docker Desktop/Engine is one implementation; ECS and EKS use containerd under the hood.

```flow
pipeline: Who does what in the container stack
OCI specs > Standard image + runtime formats everyone follows.
Docker / Podman CLI > Build and manage containers. Podman runs daemonless and rootless.
containerd > Manages images and container lifecycles (also used by Kubernetes, ECS).
runc > Low-level runtime that creates the namespaces and cgroups.
```

---

## 3. Dockerfile in depth

### Q09. Core instructions

| Instruction | Purpose |
|---|---|
| `FROM` | base image (pin version, ideally digest) |
| `WORKDIR` | set working directory (creates it) |
| `COPY` | copy files from build context (`--chown`, `--from=stage`) |
| `ADD` | like COPY + URL download + tar extraction — prefer `COPY` |
| `RUN` | execute at **build** time → new layer |
| `ENV` | environment variable in image (build + runtime) |
| `ARG` | build-time variable only |
| `USER` | run subsequent steps/container as this user |
| `EXPOSE` | document port |
| `ENTRYPOINT` | the executable |
| `CMD` | default arguments (or default command) |
| `HEALTHCHECK` | container health command |
| `LABEL` | metadata (version, source repo) |

---

### Q10. `CMD` vs `ENTRYPOINT`, exec vs shell form

**Short answer:** `ENTRYPOINT` defines the program; `CMD` provides default args that `docker run img <args>` replaces. **Exec form** (`["uvicorn", "app:app"]`) runs the process directly as PID 1 and receives signals. **Shell form** (`uvicorn app:app`) wraps it in `/bin/sh -c` → the shell is PID 1 and may not forward `SIGTERM` → no graceful shutdown.

```flow
trace: ENTRYPOINT + CMD and signals
ENTRYPOINT ["uvicorn"]  CMD ["app:app", "--port", "8000"] > The command is ENTRYPOINT + CMD.
docker run img --port 9000  →  overrides **CMD** only > Arguments replace CMD; ENTRYPOINT stays.
shell form: CMD uvicorn app:app  →  PID 1 is **/bin/sh** > The shell doesn't forward SIGTERM, so the app is SIGKILLed after the timeout.
exec form (JSON array)  →  PID 1 is **uvicorn** > Receives SIGTERM and shuts down gracefully.
```

```dockerfile
ENTRYPOINT ["uvicorn", "app.main:app", "--host", "0.0.0.0"]
CMD ["--port", "8000"]
# docker run img --port 9000  → overrides CMD only
```

---

### Q11. `ARG` vs `ENV`

`ARG` exists only during build (`--build-arg VERSION=1.4`), `ENV` persists into the running container. **Neither is for secrets** — both are visible in image history/metadata. Use BuildKit secret mounts for build secrets and Secrets Manager at runtime.

```flow
pipeline: ARG vs ENV
ARG > Build-time only (versions, flags). Visible in image history: never secrets.
ENV > Set in the image and at runtime for every container.
Runtime config > Pass with `-e` / the ECS task definition instead of baking it in.
Secrets > Neither: use BuildKit secret mounts at build, Secrets Manager at runtime.
```

---

### Q12. Multi-stage builds

**Short answer:** Use one stage with compilers/build tools, then copy only the results into a small runtime stage → smaller image, fewer vulnerabilities, no build tools in production.

```flow
pipeline: Multi-stage build
Stage "builder" > Full toolchain: compilers, dev dependencies, build the app / wheels.
Stage "runtime" > Fresh slim base image.
COPY --from=builder > Only the built artifacts.
Final image > No compilers or dev tools: much smaller and fewer vulnerabilities.
```

```dockerfile
# syntax=docker/dockerfile:1
FROM python:3.13-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project      # deps only → cached layer
COPY src/ ./src/
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev

FROM python:3.13-slim AS runtime
RUN useradd --create-home --uid 10001 appuser
WORKDIR /app
COPY --from=builder --chown=appuser:appuser /app /app
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
USER 10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"
ENTRYPOINT ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```
Frontend example: `node` stage runs `vite build` → `nginx:alpine` stage copies `dist/`.

---

### Q13. BuildKit features: cache mounts, secret mounts, multi-platform

```flow
pipeline: BuildKit features in one build
--mount=type=cache > pip/npm cache persists between builds: faster installs.
--mount=type=secret > A token is available for one RUN step and never stored in a layer.
--platform linux/amd64,linux/arm64 > Multi-architecture image (needed for Graviton).
Remote cache > Cache from the registry in CI.
```

```dockerfile
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt   # persistent pip cache
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci                       # secret NOT stored in layer
```
```bash
docker build --secret id=npmrc,src=$HOME/.npmrc .
docker buildx build --platform linux/amd64,linux/arm64 -t $IMG --push .   # multi-arch
```
**ARM64 matters on AWS:** Graviton (ECS/Lambda) is cheaper; AgentCore Runtime requires ARM64. Building on an x86 laptop needs `--platform linux/arm64` (QEMU emulation or native ARM builders).

---

### Q14. Choosing a base image

```flow
pipeline: Choosing a base image
Official slim (python:3.13-slim) > Good default: small, glibc, easy.
Distroless > No shell or package manager: tiny attack surface; harder to debug.
Alpine > Very small but musl libc: some Python wheels break or compile slowly.
Pin by digest + rebuild regularly > Get security patches deliberately.
```

| Base | Size | Notes |
|---|---|---|
| `python:3.13` | large | has compilers; for builder stage |
| `python:3.13-slim` | medium | Debian minimal; good default |
| `python:3.13-alpine` | small | musl libc → many Python wheels must compile; sometimes slower/buggy |
| distroless / Chainguard / Docker Hardened Images | very small | no shell/package manager → fewer CVEs; debugging harder |
| `scratch` | empty | static binaries (Go) |

Pin versions (`python:3.13.7-slim-bookworm` or `@sha256:`), rebuild regularly for patches.

---

### Q15. Reducing image size and vulnerabilities

Multi-stage, slim/distroless base, `--no-install-recommends` and clean apt lists in the same `RUN`, no dev dependencies, `.dockerignore`, remove build tools, scan and fix, pin + rebuild weekly.

```flow
pipeline: Shrinking an image and its CVEs
Slim / distroless base > Fewer packages.
Multi-stage build > No build tools in the final image.
.dockerignore + no caches > `pip install --no-cache-dir`.
Scan > Trivy / Inspector; fix or upgrade.
Rebuild often > Pick up base image patches.
```

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends libpq5 \
    && rm -rf /var/lib/apt/lists/*
```

---

### Q16. Running as non-root

**Short answer:** By default containers run as root (UID 0). If an attacker escapes the app, root in the container makes escalation easier. Create a user, `USER 10001`, own only needed files, and in ECS also set `readonlyRootFilesystem` and drop capabilities.

```flow
pipeline: Running as non-root
Create user in Dockerfile > `RUN useradd -u 10001 app`.
Own only what's needed > `COPY --chown=app` for writable paths.
USER app > The process runs unprivileged.
Read-only root FS > Writes go to a tmp volume. A compromised app can't modify the system.
```

**Pitfall:** non-root can't bind ports < 1024 — use 8000/8080.

---

### Q17. Reproducible builds

Pin base image digests, lockfiles (`uv.lock`, `package-lock.json`), pinned tool versions, `--frozen`/`npm ci`, no `apt-get upgrade` of unpinned packages in app images (rebuild base instead), build in CI not laptops.

```flow
pipeline: Reproducible image builds
Pin base by digest > Not just `python:3.13`.
Lockfile installs > Exact dependency versions.
No `latest`, no curl | sh > Every input is versioned.
Same build → same result > Tested image = deployed image.
```

---

### Q18. Labels and metadata

```dockerfile
LABEL org.opencontainers.image.source="https://gitlab.example.com/payments/api" \
      org.opencontainers.image.revision="$GIT_SHA"
```
Helps trace a running image back to its commit.

---

## 4. Networking, storage, Compose

### Q19. Docker networking modes

```flow
sequence: Two containers on a user-defined bridge network
actors: api container, Docker DNS, db container
api container -> Docker DNS: resolve "db"
Docker DNS --> api container: 172.18.0.3
api container -> db container: connect db:5432
> Containers on the same user-defined network find each other by name. host mode shares the host's network; none has no networking.
```

| Mode | Behaviour |
|---|---|
| `bridge` (default) | private network on host; containers reach each other by **name** on user-defined bridges; publish ports to reach from host |
| `host` | shares host network stack (no isolation, no port mapping) |
| `none` | no networking |
| `overlay` | multi-host (Swarm) |
| **ECS `awsvpc`** | each task gets its **own ENI** and private IP in your VPC; security groups per task |

```bash
docker network create app-net
docker run -d --network app-net --name db postgres:16
docker run -d --network app-net -e DB_HOST=db api:1.4     # "db" resolves via Docker DNS
```

---

### Q20. Volumes vs bind mounts vs tmpfs

```flow
pipeline: Where container data can live
Container writable layer > Lost when the container is removed.
Named volume > Managed by Docker; survives containers. Use for databases in dev.
Bind mount > A host folder mapped in; great for live code in dev.
tmpfs > In memory only; for secrets/scratch that must never touch disk.
```

| | Volume | Bind mount | tmpfs |
|---|---|---|---|
| Managed by | Docker (`docker volume`) | you (host path) | memory |
| Use | persistent data (DB in dev) | live-reload source code in dev | temp secrets/scratch |
| Portability | good | host-dependent | — |

In production on ECS/Fargate: containers are **ephemeral**; persist data in RDS/DynamoDB/S3 or EFS volumes, not container disk.

---

### Q21. Docker Compose for local development

```flow
pipeline: docker compose up
Read compose.yaml > Services, networks, volumes.
Create network > Services reach each other by name.
Start in dependency order > `depends_on` with health checks (db healthy → api starts).
Mount code + env > Live reload in development.
```

```yaml
# compose.yaml
services:
  api:
    build: .
    ports: ["8000:8000"]
    env_file: .env.local
    depends_on:
      db: { condition: service_healthy }
    develop:
      watch:
        - { action: sync, path: ./src, target: /app/src }   # compose watch: live sync
  db:
    image: postgres:16
    environment: { POSTGRES_PASSWORD: dev }
    healthcheck: { test: ["CMD", "pg_isready"], interval: 5s }
    volumes: [pgdata:/var/lib/postgresql/data]
volumes: { pgdata: {} }
```
`docker compose up -d`, `docker compose logs -f api`, `docker compose down -v`.

---

### Q22. Local vs production configuration (12-factor)

Same image everywhere; configuration via **environment variables** and secrets injected at runtime (ECS task definition `secrets` from Secrets Manager/SSM). Don't bake environment-specific config or secrets into images. Log to **stdout/stderr** (collected by awslogs/FireLens).

```flow
pipeline: One image, many environments
Same image > Built once.
Config from environment > Env vars / config service, not baked in.
Secrets injected at runtime > From Secrets Manager.
Logs to stdout > Collected by the platform.
```

---

### Q23. Containers are ephemeral — implications

Anything written to the container filesystem disappears when the task is replaced. Store state externally; design for being killed at any time (graceful shutdown, idempotent work, retries).

```flow
pipeline: Designing for disposable containers
Any task can die anytime > Deploys, scale-in, spot reclaim.
No local state > Data in S3/DB, sessions in Redis.
Fast startup + graceful shutdown > Handle SIGTERM.
Idempotent work > A restarted task can safely redo it.
```

---

## 5. Runtime behaviour: signals, health, resources

### Q24. SIGTERM and graceful shutdown

**Short answer:** `docker stop` / ECS sends **SIGTERM** to PID 1, waits a grace period (Docker default 10 s; ECS `stopTimeout` default 30 s, max 120 s on Fargate), then **SIGKILL**. Your app must catch SIGTERM: stop accepting new work, finish in-flight requests, close connections, exit.

```flow
pipeline: Graceful shutdown on ECS
Deploy / scale-in > ECS decides to stop a task.
Deregister from ALB > No new requests; in-flight ones continue during the deregistration delay.
SIGTERM > Sent to PID 1 in the container. Your app must handle it (exec form CMD, or an init like tini).
App drains > Stop accepting work, finish in-flight requests, close connections, flush logs.
SIGKILL after stopTimeout > Anything still running is killed hard.
```
Requirements: exec-form `ENTRYPOINT` (app is PID 1) or an init (`tini`, `docker run --init`, ECS `initProcessEnabled`) that forwards signals and reaps zombies. Uvicorn/Gunicorn handle SIGTERM gracefully.

```python
import signal, asyncio
stop = asyncio.Event()
signal.signal(signal.SIGTERM, lambda *_: stop.set())   # worker loop checks stop.is_set()
```

---

### Q25. Docker `HEALTHCHECK` vs ECS vs ALB health checks

```flow
pipeline: Three health checks, three jobs
Docker HEALTHCHECK > Local/Compose signal; ignored by ECS unless defined in the task definition.
ECS container health check > Unhealthy container → ECS replaces the task.
ALB target group health check > Unhealthy target → stops receiving traffic (and ECS replaces it).
Keep them cheap and honest > Liveness shouldn't depend on downstream services.
```

| Check | Who runs it | Effect if failing |
|---|---|---|
| Dockerfile `HEALTHCHECK` | Docker engine | marks container unhealthy (Docker itself doesn't restart it) |
| ECS container `healthCheck` (task definition) | ECS agent, inside the container | ECS replaces the task (essential container) |
| ALB target group health check | load balancer → HTTP path | stops routing traffic; ECS replaces unhealthy targets |

Keep `/health` cheap (liveness); a separate readiness check can test dependencies. Use `startPeriod` / health-check grace period for slow starts. (ECS ignores the Dockerfile HEALTHCHECK — define it in the task definition.)

---

### Q26. Resource limits (CPU, memory)

```flow
trace: Hitting the memory limit
limit 512 MiB, usage 300 MiB  ✓ > The cgroup limit is enforced by the kernel.
traffic spike  →  **510 MiB** > No swap; close to the edge.
allocation beyond 512  →  kernel **OOM-kills** the process > Exit code 137, OOMKilled = true.
fix: right-size limit, bound caches, stream data, fewer workers > CPU limits throttle instead of kill.
```

```bash
docker run --memory=512m --cpus=1.0 api:1.4
```
Exceeding memory → process **OOM-killed** (exit code **137**, `OOMKilled: true`). CPU limit → throttling (slower), not a kill. In ECS: task-level CPU/memory (Fargate) plus container `memory` (hard) / `memoryReservation` (soft). Python services: set worker counts based on memory, watch for leaks.

---

### Q27. Exit codes you should recognise

```flow
pipeline: Reading an exit code
0 > Normal exit.
1 > Application error: read the logs.
127 > Command not found: wrong CMD/PATH.
137 > SIGKILL: OOM or killed after stop timeout.
143 > SIGTERM: graceful stop requested.
```

| Code | Meaning |
|---|---|
| 0 | clean exit (for a web server, unexpected — something told it to stop) |
| 1 | application error (check logs) |
| 126 / 127 | command not executable / not found (bad ENTRYPOINT, missing binary, wrong arch) |
| 137 | SIGKILL — OOM or killed after stop timeout |
| 139 | segfault (native lib, wrong architecture) |
| 143 | SIGTERM received and exited |

"exec format error" = image built for a different CPU architecture (amd64 vs arm64).

---

## 6. Security & supply chain

### Q28. Container security layers

```
 Build:   minimal pinned base → no secrets in layers → scan (Trivy/Inspector) → SBOM → sign (Cosign)
 Registry: private ECR, tag immutability, scan on push, lifecycle policy, only CI can push
 Deploy:  verify signature/digest, least-privilege task role, secrets from Secrets Manager
 Runtime: non-root, read-only root FS, drop Linux capabilities, no privileged mode,
          no docker.sock mounts, seccomp default, resource limits, private subnets + SGs,
          GuardDuty runtime monitoring
```

---

### Q29. Why never mount `/var/run/docker.sock` or use `--privileged`?

The Docker socket gives **root on the host** (start any container with host mounts). `--privileged` disables most isolation. Both turn a container compromise into a host compromise.

```flow
pipeline: Why docker.sock / --privileged = root on the host
Mount /var/run/docker.sock > The container can talk to the Docker daemon.
Start a new container > With the host's / mounted, or --privileged.
Escape > Read/write anything on the host.
Rule > Never in production; use rootless builders (Kaniko/BuildKit) in CI.
```

---

### Q30. Secrets: what not to do

❌ `ENV API_KEY=...`, ❌ `COPY .env`, ❌ `ARG TOKEN` used in `RUN` (visible in history), ❌ secrets in image labels. ✅ BuildKit `--mount=type=secret` for build time; ✅ ECS `secrets` (Secrets Manager/SSM) or fetch at startup via the task role for runtime.

```flow
pipeline: Secrets: wrong vs right
ENV / ARG with a secret ✗ > Visible in image history and `docker inspect`.
COPY .env ✗ > Baked into a layer forever.
Build secret mount ✓ > `--mount=type=secret` during the build only.
Runtime injection ✓ > ECS `secrets` from Secrets Manager, or fetched by the app.
```

---

### Q31. SBOM, scanning and signing

```flow
pipeline: Supply-chain checks for an image
Build > In CI from pinned inputs.
SBOM > List every package inside.
Scan > Known CVEs; fail on critical.
Sign > Cosign / Notation.
Verify at deploy > Only signed, scanned images run.
```

- **SBOM** (Software Bill of Materials, SPDX/CycloneDX via Syft or `docker buildx --sbom`): lists every package → answer "are we affected by CVE-X?" quickly.
- **Scanning** (Trivy, Grype, ECR enhanced scanning/Inspector): finds known CVEs; gate CI on critical/high with fix available.
- **Signing** (Cosign/Sigstore, AWS Signer for ECR): proves the image came from your pipeline; verify before deploy.
- **Provenance** (SLSA attestations): how/where it was built.

---

### Q32. Image tags: why not `latest`?

`latest` is just a mutable default tag — you can't tell what's running, rollbacks are ambiguous, and nodes may cache different versions. Use commit-SHA tags + digests; enable ECR tag immutability.

```flow
trace: Why `latest` bites
deploy app:latest  →  digest **aa11** > Tuesday.
someone pushes a new latest  →  **bb22** > Wednesday.
ECS replaces a task  →  pulls **bb22** > Two versions now run side by side, untested.
use app:3f2a9c1 (SHA) + ECR tag immutability > Every task runs the same, known image.
```

---

### Q33. Offline-friendly / air-gapped secure image

Mirror base images and packages into an internal registry/artifact repository (ECR pull-through cache, CodeArtifact), pin digests, vendor wheels, build with no internet (`--network=none` for steps), scan and sign internally.

```flow
pipeline: Building for an air-gapped environment
Mirror base images + packages > Internal registry and package proxy.
Build with no internet > Everything resolved from mirrors.
Scan + sign > Before transfer.
Transfer by approved channel > Verify signatures on arrival.
```

---

## 7. Scenario & debugging questions

### Q34. Container crash-loops. How do you debug?

```flow
pipeline: Debugging a crash-looping container
Read the logs > `docker logs` / CloudWatch: is there an error at startup?
Inspect exit state > `docker inspect` → `State.ExitCode`, `OOMKilled`.
Decode the exit code > 137 → killed (often memory); 127 → command not found; "exec format error" → wrong CPU architecture.
Run it interactively > `docker run --rm -it --entrypoint sh img`, then start the app by hand.
Check the environment > Env vars and secrets present? Config paths? Permissions (can non-root write to /app)? Dependencies reachable (DB DNS)?
```

---

### Q35. Works locally but ECS can't pull the image (`CannotPullContainerError`)

```flow
pipeline: CannotPullContainerError on ECS
Image URI + tag exist? > Typos, deleted tag, wrong region.
Execution role permissions > ecr:GetAuthorizationToken, BatchGetImage, GetDownloadUrlForLayer.
Network path > Private subnet needs NAT or ECR (api + dkr) + S3 gateway endpoints.
Architecture > arm64 image on x86 tasks (or vice versa).
```

- **Network:** task in private subnet with no NAT and no **VPC endpoints** for ECR (`ecr.api`, `ecr.dkr`) + **S3 gateway endpoint** (layers are stored in S3) + CloudWatch Logs endpoint.
- **Permissions:** task **execution role** lacks `ecr:GetAuthorizationToken`, `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer` (use `AmazonECSTaskExecutionRolePolicy`).
- **Image reference:** wrong tag/digest/region/account; repository policy for cross-account.
- **Architecture:** ARM image on X86 task (or vice versa) → task fails after pull.

---

### Q36. ECS task stops after ~30 s with "unhealthy"

App binds `127.0.0.1` instead of `0.0.0.0`; wrong port; health-check path returns 404/redirect; app slower to start than grace period/`startPeriod`; health check command missing in image (`curl` not installed in slim/distroless); security group blocks ALB → task port; dependency failure making `/health` fail.

```flow
pipeline: Task killed as "unhealthy" after ~30 s
Health check path/port right? > Does /health exist on that port?
App startup slower than the check? > Add a health-check grace period / startPeriod.
Container listening on 0.0.0.0? > Not 127.0.0.1.
Dependency in liveness check? > DB down shouldn't kill every task.
```

---

### Q37. Build is slow in CI

No layer cache between runners → use registry cache (`--cache-from/--cache-to type=registry`), order instructions for cache, cache mounts for package managers, smaller build context (`.dockerignore`), native ARM builders instead of emulation.

```flow
pipeline: Speeding up CI image builds
Order layers for cache > Dependencies before code.
Registry cache > `--cache-from` / BuildKit remote cache.
Cache mounts > For pip/npm.
Smaller context > .dockerignore.
```

---

### Q38. Image is 2.5 GB

`docker history` to see which layers are large → compilers and dev deps (multi-stage), CUDA/torch where not needed (CPU wheels), caches left in layers (clean in same RUN or cache mounts), copying `.git`/data folders (`.dockerignore`).

```flow
pipeline: From 2.5 GB to a small image
Inspect layers > `docker history` / dive: what's big?
Multi-stage > Drop compilers, caches, test data.
Slim base > Not the full OS image.
Remove model files / data > Download at runtime or mount instead.
```

---

### Q39. Container gets OOM-killed under load

Measure per-worker memory; reduce workers or increase memory; fix leaks (unbounded caches); stream large files instead of loading; set Python `MALLOC_ARENA_MAX` for glibc fragmentation if needed; add memory alarms.

```flow
pipeline: OOM-killed under load
Confirm > Exit 137, OOMKilled, memory graph rising with traffic.
Per-request memory > Big payloads loaded whole? Too many workers?
Fix > Stream, bound caches, fewer workers per task, right-size the limit.
Protect > Concurrency limits / backpressure so load can't exceed capacity.
```

---

## 8. Cheat sheet

| Concept | One-liner |
|---|---|
| Container | process + namespaces + cgroups + layered FS |
| Image vs container | template vs running instance + writable layer |
| Tag vs digest | movable label vs immutable hash |
| Layers | cache until changed; order deps before source |
| Multi-stage | build tools in builder, small runtime |
| CMD vs ENTRYPOINT | args vs executable; use exec form |
| ARG vs ENV | build-time vs runtime; neither for secrets |
| BuildKit | cache mounts, secret mounts, multi-arch |
| Non-root | `USER 10001`, read-only FS, drop caps |
| SIGTERM | PID 1 must handle it; grace period then SIGKILL |
| Health | Docker vs ECS vs ALB checks differ |
| Exit 137 | OOM / SIGKILL; 127 bad command; exec format = arch |
| Networking | bridge DNS by name; ECS awsvpc = ENI per task |
| Supply chain | pin, scan, SBOM, sign, immutable ECR tags |

## Official references

- https://docs.docker.com/get-started/docker-overview/
- Dockerfile reference: https://docs.docker.com/reference/dockerfile/
- Build best practices: https://docs.docker.com/build/building/best-practices/
- BuildKit secrets: https://docs.docker.com/build/building/secrets/
- Amazon ECR: https://docs.aws.amazon.com/AmazonECR/latest/userguide/what-is-ecr.html
