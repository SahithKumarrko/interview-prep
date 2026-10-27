# Docker: Interview Preparation

> **Updated:** 27 October 2026 · **Level:** what a container is → images and Dockerfiles → networking, storage, Compose → security & production on ECS
> **How to use:** read the *Short answer* first, then *How it works* and the *Example* walkthrough. *Common mistake → fix* shows what goes wrong in real projects. *Interview answer* is what you can say out loud.

---

## Table of contents

1. [Mental model: what a container really is](#1-mental-model-what-a-container-really-is)
2. [Fundamentals](#2-fundamentals) (Q01–Q12)
3. [Dockerfile in depth](#3-dockerfile-in-depth) (Q13–Q24)
4. [Networking, storage, Compose](#4-networking-storage-compose) (Q25–Q29)
5. [Runtime behaviour: signals, health, resources](#5-runtime-behaviour-signals-health-resources) (Q30–Q34)
6. [Security & supply chain](#6-security--supply-chain) (Q35–Q40)
7. [Scenario & debugging questions](#7-scenario--debugging-questions) (Q41–Q46)
8. [Cheat sheet](#8-cheat-sheet)

---

## 1. Mental model: what a container really is

**The one idea everything else follows from:** a container is **not a small virtual machine**. It is an ordinary process on the host's Linux kernel that has been given its own *view* of the system (its own process list, network, filesystem) and a *budget* (CPU and memory limits). Because there is no second operating system to boot, a container starts in milliseconds and uses megabytes instead of gigabytes.

Think of an apartment building. A virtual machine is a separate house with its own foundations and plumbing. A container is an apartment: it shares the building's foundations (the host kernel), but has its own front door, walls and meter, so neighbours can't see inside or use more than their share.

Four Linux features make this work:
- **Namespaces** control what the process can *see*: its own process IDs, network stack, mount points, hostname and users.
- **cgroups** (control groups) control what it can *use*: CPU, memory, disk I/O.
- **Union filesystem (overlayfs)** stacks read-only image layers with one thin writable layer on top.
- **Capabilities, seccomp, AppArmor/SELinux** control what it is *allowed to do* (which system calls and privileges).

```flow
sequence: What actually runs when you type docker run nginx
actors: docker CLI, dockerd, containerd, runc, Registry
docker CLI -> dockerd: REST API call: run nginx
dockerd -> Registry: pull nginx if it is not already stored locally
Registry --> dockerd: image layers
dockerd -> containerd: create and start a container from the image
containerd -> runc: start the process
> runc creates the namespaces (isolation) and cgroups (limits), then starts the nginx process inside them. A container is just that isolated process.
runc --> docker CLI: container running
```

**Three rules that come straight from this model:**
1. **A container lives only as long as its main process.** When that process exits, the container stops.
2. **Everything a container writes to its own filesystem disappears when the container is removed.** Data that must survive goes in a volume or an external service (Q26, Q29).
3. **An image is the recipe's frozen result, a container is a running copy.** Build once, run many times, anywhere (Q04).

---

## 2. Fundamentals

### Q01. What is Docker, and what problem does it solve?

**Short answer:** **Docker** is a tool for packaging an application together with everything it needs to run (runtime, libraries, system tools, configuration) into one portable unit called an **image**, and for running that image as an isolated **container**. It solves "it works on my machine": the app runs the same on a laptop, in CI and in production, because it brings its own environment.

**How it works:**
1. You describe the environment in a **Dockerfile** (a text recipe, Q13).
2. `docker build` turns the recipe into an **image** (a read-only package).
3. `docker run` starts a **container** from the image: an isolated process with its own filesystem view.
4. You can push the image to a **registry** (a server that stores images, Q06) and run the identical image anywhere that has a container runtime.

**Example:**
```bash
docker run --rm python:3.13-slim python -c "print('hello from a container')"
```

**What happens, step by step:**
1. Docker looks for the image `python:3.13-slim` locally. It isn't there, so it downloads it from Docker Hub (a public registry).
2. It creates a container from the image and starts the command `python -c "print(...)"` as the container's main process.
3. The process prints `hello from a container` and exits.
4. Because the main process ended, the container stops; `--rm` tells Docker to delete the stopped container automatically. The image stays cached for next time.

**Common mistake → fix:** installing tools by hand inside a running container (`docker exec ... apt install ...`) and expecting them to be there later. The change lives only in that container's writable layer and vanishes when it is replaced. Fix: put the install step in the Dockerfile and rebuild the image.

**Interview answer:** "Docker packages an application with its dependencies into an image and runs it as an isolated container, so the environment is identical on a laptop, in CI and in production. The image is built from a Dockerfile and shared through a registry; the container is a process isolated with Linux namespaces and limited with cgroups, which is why it's far lighter than a VM."

**Follow-ups:**
- *Is Docker the only way to run containers?* No. Docker is one implementation of the open OCI standards; others include Podman and containerd (Q11).

---

### Q02. Container vs VM

**Short answer:** A **virtual machine** emulates a whole computer and runs its **own full operating system kernel** on top of a hypervisor. A **container** shares the **host's kernel** and isolates only the process, using namespaces and cgroups. Containers are smaller (megabytes) and start in milliseconds; VMs give stronger isolation because each has its own kernel. For hostile multi-tenant workloads, platforms such as AWS Fargate and Lambda run containers inside lightweight VMs (microVMs) to get both.

**How it works:**

| | Virtual machine | Container |
|---|---|---|
| What is virtualised | hardware | the operating system's view |
| Kernel | one per VM | shared with the host |
| Size | gigabytes (full OS) | megabytes (app + libraries) |
| Start time | tens of seconds | milliseconds to seconds |
| Isolation | strong (separate kernel) | weaker (shared kernel), hardened with seccomp, capabilities |
| Typical use | different operating systems, strong tenant isolation | packaging and scaling applications |

**How to choose:** use containers to package and scale your own applications; use VMs (or microVMs) when you must run untrusted code from different tenants or need a different operating system kernel.

**Example:** you need to run 20 copies of a 150 MB Python API on one 8 GB host.
- As VMs: each needs a guest OS of ~1 GB plus the app, so 20 VMs need about 23 GB. They don't fit.
- As containers: each shares the host kernel and uses roughly its own app memory (say 200 MB), so about 4 GB in total. They fit with room to spare.

**What happens, step by step:**
1. Starting a VM boots a kernel, runs init and services: ~30 seconds.
2. Starting a container creates namespaces and cgroups for one process and begins running it: well under a second.
3. If the host kernel has a security bug, every container on it is exposed. A VM's separate kernel limits the damage to that VM, which is why isolation-critical platforms add a microVM layer.

**Common mistake → fix:** assuming a container on a Linux host can run a Windows or macOS binary, or a different CPU architecture, because "it's like a VM". It shares the host kernel and CPU, so an arm64 image won't run on an amd64 host without emulation (you'll see `exec format error`, Q33). Fix: build for the target architecture (Q19). On Mac and Windows, Docker Desktop runs a small Linux VM and starts your containers inside it.

**Interview answer:** "A VM virtualises hardware and carries its own guest kernel, so it's heavy but strongly isolated. A container is a normal process on the host kernel, isolated by namespaces and limited by cgroups, so it starts in milliseconds and is megabytes in size. The trade-off is a shared kernel, so for multi-tenant isolation platforms put containers inside microVMs."

**Follow-ups:**
- *Can containers and VMs be combined?* Yes, and they usually are: containers run inside cloud VMs (EC2 instances, Fargate microVMs).

---

### Q03. What are the Docker client, daemon and Docker Engine?

**Short answer:** Docker is a **client-server** tool. The `docker` command you type is the **client (CLI)**. It sends requests over a REST API to the **daemon (`dockerd`)**, a background service that actually builds images, manages containers, networks and volumes. The daemon delegates running containers to **containerd**, which uses **runc** to create the isolated process. Together this stack is the **Docker Engine**.

**How it works:**
- `docker` (client) → `dockerd` (daemon: API, images, networks, volumes) → `containerd` (container lifecycle) → `runc` (creates namespaces and cgroups, starts the process).
- The client and daemon can be on different machines (`DOCKER_HOST`), which is why access to the daemon's socket is so powerful (Q36).
- **Docker Desktop** bundles the Engine, a Linux VM (on Mac and Windows), Compose and a GUI.

**Example:**
```bash
docker version        # shows Client and Server (Engine) sections
docker info           # storage driver, number of containers and images, cgroup version
```

**What happens, step by step:**
1. `docker version` prints the **Client** block (the CLI's version) from the local binary.
2. It then asks the daemon for the **Server** block. If the daemon isn't running, you get `Cannot connect to the Docker daemon at unix:///var/run/docker.sock`.
3. `docker info` also comes from the daemon: it reports, for example, `Containers: 3`, `Images: 12`, `Storage Driver: overlayfs`.

**Common mistake → fix:** `Cannot connect to the Docker daemon` is read as "Docker is broken". Usually the daemon just isn't running, or your user lacks permission on the socket. Fix: start the service (`sudo systemctl start docker`, or open Docker Desktop) and add your user to the `docker` group (knowing that group membership is effectively root on the host).

**Interview answer:** "The docker CLI is a client that talks to the dockerd daemon over a REST API on a Unix socket. The daemon manages images, networks and volumes, and uses containerd and runc to create the actual isolated processes. Because the daemon runs as root, access to its socket is equivalent to root on the host."

**Follow-ups:**
- *What is Podman?* A daemonless, rootless-by-default alternative that uses the same image format and a very similar CLI.

---

### Q04. Image vs container

**Short answer:** An **image** is an immutable, layered template: the filesystem plus metadata (default command, environment variables, user, exposed port). A **container** is a running (or stopped) instance of an image, with its own thin **writable layer** on top. Many containers can run from one image, like many objects from one class.

**How it works:**
1. The image's layers are read-only and shared; a hundred containers from the same image share the same layers on disk.
2. When a container starts, Docker adds one thin writable layer on top. Writes go there (copy-on-write: a file from a lower layer is copied up before it is changed).
3. Stopping a container keeps the writable layer; **removing** the container deletes it. The image is untouched.

**Example:**
```bash
docker build -t api:1.4.0 .
docker run -d --name api1 -p 8000:8000 api:1.4.0
docker run -d --name api2 -p 8001:8000 api:1.4.0    # same image, separate container
docker exec api1 touch /tmp/only-in-api1
docker exec api2 ls /tmp/only-in-api1
docker rm -f api1
```

```flow
pipeline: Image versus container
Image api:1.4.0 > Read-only layers plus metadata. Built once, never modified.
docker run creates api1 > Adds a thin writable layer, config and a running process.
docker run creates api2 > A second container from the same image has its own separate writable layer.
touch in api1 > The file is written to api1's writable layer only.
docker rm api1 > The writable layer is deleted, including the file. The image and api2 are untouched.
```

**What happens, step by step:**
1. `docker build` produces image `api:1.4.0` (say 180 MB).
2. Two `docker run` commands start containers `api1` and `api2`. Disk usage grows by only a few KB each, not 180 MB, because layers are shared.
3. `touch /tmp/only-in-api1` creates the file in api1's writable layer.
4. `ls` in api2 fails with `No such file or directory`: api2 has its own writable layer.
5. `docker rm -f api1` deletes api1 and its file. `docker images` still shows `api:1.4.0`.

**Common mistake → fix:** storing database files or uploads in the container's filesystem and losing them on the next deploy. Fix: mount a volume (Q26) or use an external service.

**Interview answer:** "An image is an immutable layered template with metadata; a container is a running instance of it with its own writable layer on top. Many containers share the image's layers, and removing a container deletes only its writable layer, which is why persistent data belongs in volumes or external services."

**Follow-ups:**
- *Can you change an image?* Not in place. You build a new image (new layers, new ID); `docker commit` snapshots a container into an image but isn't repeatable and should be avoided.

---

### Q05. What is an image layer, and how does the build cache work?

**Short answer:** Each instruction that changes the filesystem (`RUN`, `COPY`, `ADD`) produces a **layer**: a stored set of file changes. An image is a stack of layers. When you rebuild, Docker reuses a cached layer if the instruction **and everything it depends on** are unchanged. Once one layer changes, **every layer after it is rebuilt**. So put rarely changing steps (install dependencies) first and frequently changing steps (copy source code) last.

**How it works:**
- Layers are identified by a hash of their content, so identical layers are stored and downloaded once.
- For `COPY`, the cache key includes the **content** of the copied files. For `RUN`, it is the command text, so `RUN pip install -r requirements.txt` is considered unchanged even if the packages on PyPI changed.
- Deleting a file in a later layer does **not** shrink the image: the earlier layer still holds it. Clean up in the same `RUN`.

**Example:**
```dockerfile
# Slow: any code change reinstalls every dependency
FROM python:3.13-slim
WORKDIR /app
COPY . .
RUN pip install -r requirements.txt

# Fast: dependencies are cached until requirements.txt changes
FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
```

```flow
trace: Rebuilding after you edit app.py (second Dockerfile)
FROM python:3.13-slim: **cached** > The base image layer is unchanged.
COPY requirements.txt: **cached** > The file's content is identical, so the layer is reused.
RUN pip install: **cached** (about 2 seconds instead of 90) > Its inputs, the previous layer and the command, did not change.
COPY . . : **rebuilt** > app.py changed, so this layer and everything after it is new.
first Dockerfile instead > COPY . . comes first, so any edit invalidates the layer and pip install reruns every time.
```

**What happens, step by step:**
1. You edit `app.py` and run `docker build -t api .`.
2. Docker walks the instructions top to bottom, checking each against the cache. Steps 1 to 4 (base, WORKDIR, COPY requirements, pip install) match, and the output shows `CACHED`.
3. `COPY . .` sees different file content, so it runs. Only that layer (a few KB) is rebuilt: total ~3 seconds.
4. With the first Dockerfile, `COPY . .` is the third instruction. Its change invalidates `RUN pip install`, which downloads 90 seconds of packages.

**Common mistake → fix:** `RUN apt-get update` in one layer and `RUN apt-get install -y curl` in the next. The cached `update` layer goes stale and the install fails with 404 errors. Fix: combine them: `RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*`.

**Interview answer:** "Each filesystem-changing instruction creates a layer, and Docker reuses a cached layer when the instruction and its inputs are unchanged; as soon as one layer changes, all later layers rebuild. So I copy the dependency manifest and install first, and copy the source last. Deleting files in a later layer doesn't shrink the image, so cleanup has to happen in the same RUN."

**Follow-ups:**
- *How do you see layers?* `docker history <image>` lists layers and their sizes; `dive` explores them interactively.

---

### Q06. Registries, repositories, tags and digests

**Short answer:** A **registry** is a server that stores and serves images (Docker Hub, Amazon ECR, GitLab Container Registry). A **repository** is a named collection of versions of one image (`shop/api`). A **tag** (`:1.4.0`, `:latest`) is a human-friendly, **movable** label on one version. A **digest** (`@sha256:ab12…`) is the content hash of that version and is **immutable**. Deploy by digest (or by immutable tags) so "what is running" is unambiguous.

**How it works:**
- A full image name is `registry/repository:tag`, for example `123456789012.dkr.ecr.ap-south-1.amazonaws.com/api:3f2a9c1`. With no registry, Docker Hub is assumed; with no tag, `latest` is assumed.
- `docker push` uploads only the layers the registry doesn't already have, then records the tag → digest mapping.
- Pushing the same tag again **moves** the tag to the new digest. The old image becomes untagged but still exists by digest.
- Amazon ECR can enforce **tag immutability**, plus scan on push, lifecycle policies (delete old images) and pull-through cache.

**Example:**
```bash
aws ecr get-login-password --region ap-south-1 \
  | docker login --username AWS --password-stdin 123456789012.dkr.ecr.ap-south-1.amazonaws.com
docker tag api:1.4.0 123456789012.dkr.ecr.ap-south-1.amazonaws.com/api:3f2a9c1
docker push 123456789012.dkr.ecr.ap-south-1.amazonaws.com/api:3f2a9c1
```

```flow
trace: Tags move, digests do not
push api:1.4 for the first time > The registry stores the image and the tag api:1.4 points to digest sha256:**aa11**.
a teammate rebuilds and pushes api:1.4 again > The content differs, so the registry computes a new digest sha256:**bb22** and moves the tag to it.
pull api:1.4 now > You get bb22. Yesterday's pull of the same name gave you aa11.
pull api@sha256:aa11 > Always returns exactly the original image, because a digest is the hash of the content.
```

**What happens, step by step:**
1. `docker login` stores a short-lived ECR token (valid 12 hours) for that registry.
2. `docker tag` adds a second name to the same local image (no copy is made).
3. `docker push` uploads missing layers and prints `3f2a9c1: digest: sha256:ab12... size: 1573`. Record that digest.
4. Deploy configuration that references `api@sha256:ab12...` runs the same bytes forever, even if someone later pushes a different image tagged `3f2a9c1` (unless immutability forbids it).

**Common mistake → fix:** deploying `:latest` or a reused tag. Two servers pulling at different times can run different code, and a rollback has no fixed target. Fix: tag with the commit SHA, deploy by digest, and enable tag immutability in ECR.

**Interview answer:** "A registry stores images; a repository holds the versions of one image; a tag is a movable label while a digest is the immutable content hash. I tag with the commit SHA, deploy by digest, and enable immutability in ECR so what was tested is exactly what runs and rollbacks are unambiguous."

**Follow-ups:**
- *What does `docker pull nginx` fetch?* `docker.io/library/nginx:latest`, since the registry and tag defaults are Docker Hub and `latest`.

---

### Q07. How do you run a container? (`docker run` and its main flags)

**Short answer:** `docker run <image>` creates a container from an image and starts its main process. The flags you need daily: `-d` (run in the background), `--name` (give it a name), `-p host:container` (publish a port), `-e` (set an environment variable), `-v` (mount a volume or folder), `--rm` (delete when it stops), `-it` (interactive terminal), `--restart` (restart policy), `--memory` and `--cpus` (limits).

**How it works:** a container has a simple lifecycle: **created → running → (paused) → exited → removed**. `docker run` does create + start. `docker stop` sends SIGTERM then SIGKILL (Q30). An exited container still exists (with its writable layer and logs) until `docker rm`.

**Example:**
```bash
docker run -d --name db -e POSTGRES_PASSWORD=dev -v pgdata:/var/lib/postgresql/data postgres:17
docker run -d --name api -p 8080:8000 -e DB_HOST=db --memory=512m --restart unless-stopped api:1.4.0
docker ps
docker logs -f api
docker stop api && docker rm api
```

**What happens, step by step:**
1. The first command starts Postgres 17 in the background. `-v pgdata:/var/lib/postgresql/data` creates (if needed) a named volume `pgdata` and mounts it at the data folder, so the database survives container removal.
2. The second starts the API. Requests to the host's port 8080 are forwarded to port 8000 in the container (Q09). `DB_HOST=db` is visible inside as an environment variable. The kernel kills the process if it exceeds 512 MB. `unless-stopped` restarts it after crashes or a Docker restart, unless you stopped it yourself.
3. `docker ps` lists running containers (add `-a` for stopped ones).
4. `docker stop api` sends SIGTERM, waits up to 10 seconds, then SIGKILL; `docker rm api` deletes the stopped container.

**Common mistake → fix:** starting a container without `-d` and closing the terminal; the container stops because the foreground process was attached to your session. Fix: `-d` for services; use `docker run -it --rm image sh` for throwaway interactive sessions. Another classic: `docker run -p 8000:8000 image` when the app listens on `127.0.0.1` inside the container; the published port gets no traffic (Q43). The app must listen on `0.0.0.0`.

**Interview answer:** "docker run creates and starts a container from an image. The flags I use constantly are -d, --name, -p for ports, -e for environment, -v for volumes, --rm for cleanup, and --memory and --cpus for limits. The container runs only as long as its main process, stopping sends SIGTERM and then SIGKILL, and removing it deletes its writable layer."

**Follow-ups:**
- *`docker run` vs `docker start`?* `run` creates a new container each time; `start` restarts an existing stopped one.
- *Restart policies?* `no` (default), `on-failure[:max]`, `always`, `unless-stopped`.

---

### Q08. How does a container get logs, and what is the log driver?

**Short answer:** Docker captures everything the container's main process writes to **stdout** and **stderr** and stores it through a **logging driver** (default `json-file`). `docker logs` reads it back. So applications in containers should log to standard output instead of writing log files; the platform then collects the stream (CloudWatch with the `awslogs` driver on ECS, or FireLens).

**How it works:**
- `docker logs <c>` prints captured output; `-f` follows, `--tail 100` shows the last 100 lines, `--since 10m` limits by time.
- The default `json-file` driver has **no size limit** unless you configure `max-size`/`max-file`, so a chatty container can fill the host disk.
- Logs belong to the container: `docker rm` deletes them.

**Example:**
```bash
docker run -d --name api --log-opt max-size=10m --log-opt max-file=3 api:1.4.0
docker logs --tail 5 api
```
```python
# Python app: log to stdout, flush immediately
import logging, sys
logging.basicConfig(stream=sys.stdout, level=logging.INFO)
logging.info("started")        # run Python with PYTHONUNBUFFERED=1 in containers
```

**What happens, step by step:**
1. The app writes `started` to stdout. With Python's output buffering on, the text might wait in a buffer, so you see nothing for minutes. Setting `PYTHONUNBUFFERED=1` flushes each line immediately.
2. Docker's json-file driver appends a record like `{"log":"started\n","stream":"stdout","time":"..."}` to a file on the host.
3. `--log-opt max-size=10m --log-opt max-file=3` rotates files, so the container's logs never exceed ~30 MB.
4. `docker logs --tail 5 api` prints the last five lines.

**Common mistake → fix:** the app writes to `/var/log/app.log` inside the container. `docker logs` shows nothing, and the file disappears with the container. Fix: log to stdout/stderr (or symlink the file to `/dev/stdout`), and set log rotation on the daemon.

**Interview answer:** "Docker captures stdout and stderr of the main process through a logging driver, json-file by default, which docker logs reads. So containerised apps log to standard output, unbuffered, and the platform ships the stream to CloudWatch or another collector. I configure rotation, because the default driver doesn't limit size."

**Follow-ups:**
- *Where do ECS logs go?* With the `awslogs` driver, to a CloudWatch Logs group defined in the task definition.

---

### Q09. Ports: `EXPOSE` vs publishing with `-p`

**Short answer:** `EXPOSE 8000` in a Dockerfile is **documentation only**: it says which port the app is expected to use, but opens nothing. **Publishing** with `-p 8080:8000` actually maps host port 8080 to container port 8000. On Amazon ECS with `awsvpc` networking, you set `containerPort` in the task definition and the task's own network interface receives traffic directly.

**How it works:**
- Containers have their own network namespace, so a port inside is not reachable from outside unless published (or reached over a Docker network from another container, Q25).
- `-p 8080:8000` makes Docker listen on host port 8080 and forward to container port 8000. `-P` publishes every `EXPOSE`d port to random host ports.
- The app inside must listen on `0.0.0.0` (all interfaces). `127.0.0.1` means "this container only", so forwarded traffic never reaches it.

**Example:**
```bash
docker run -d --name api -p 8080:8000 api:1.4.0
curl http://localhost:8080/health
```

```flow
sequence: A request reaches a published port
actors: Browser, Docker host, Container
Browser -> Docker host: GET http://localhost:8080/health
Docker host -> Container: forwarded to port 8000 because of -p 8080:8000
> If the app inside listened on 127.0.0.1 instead of 0.0.0.0, this forwarded connection would be refused.
Container --> Docker host: 200 OK
Docker host --> Browser: 200 OK
```

**What happens, step by step:**
1. The browser connects to port 8080 on the host.
2. Docker's port mapping rule forwards the connection into the container's network namespace, port 8000.
3. The app (listening on `0.0.0.0:8000`) answers `200 OK`; the reply travels back the same way.
4. Without `-p`, `curl localhost:8080` fails with `Connection refused`, even though the Dockerfile says `EXPOSE 8000`.

**Common mistake → fix:** a dev server started as `uvicorn app:app` (binds `127.0.0.1` by default). The container is running, `-p` is set, yet `curl` resets the connection. Fix: `uvicorn app:app --host 0.0.0.0`.

**Interview answer:** "EXPOSE is metadata; only -p (or an ECS port mapping) actually opens a path from outside. The application must bind to 0.0.0.0, because the loopback address inside a container is private to that container."

**Follow-ups:**
- *Can two containers use the same container port?* Yes, they have separate network namespaces; only the host ports must differ.

---

### Q10. `.dockerignore` and the build context

**Short answer:** When you run `docker build .`, Docker first sends the whole folder (the **build context**) to the builder. `.dockerignore` lists files to leave out of that context. A small context means faster builds, better cache hits (an unrelated file change no longer invalidates `COPY . .`), a smaller image, and no accidental copying of secrets such as `.env`.

**How it works:**
- Patterns work like `.gitignore`, relative to the context root. `!pattern` re-includes a file.
- `COPY` can only copy things inside the context, and ignored files aren't there at all.
- `.git`, `node_modules`, virtual environments and build output are the usual big offenders.

**Example:**
```
# .dockerignore
.git
.venv
node_modules
__pycache__/
*.pyc
.env
tests/
dist/
```

**What happens, step by step:**
1. Without the file, `docker build .` prints `transferring context: 1.4GB` because `.git` (600 MB) and `node_modules` (800 MB) are included. The upload takes 20 seconds before any instruction runs.
2. With the file, it prints `transferring context: 3MB`: instant.
3. `COPY . .` no longer copies `.env`, so `API_KEY=...` can't end up in an image layer.
4. Editing a test file no longer changes the `COPY . .` input if `tests/` is ignored, so that layer (and everything after it) stays cached.

**Common mistake → fix:** ignoring a file the Dockerfile needs (`dist/` ignored, then `COPY dist/ /app/dist` fails with `not found`). Fix: only ignore what the build doesn't use, or re-include with `!dist/`.

**Interview answer:** "dockerignore filters what is sent to the builder as the build context. It makes builds faster, improves cache hits, keeps the image small and keeps secrets and .git out of layers. I always ignore .git, dependency folders, virtual environments and env files."

**Follow-ups:**
- *Does it affect the final image only if COPY is used?* Yes; it shrinks the context either way, but the image only contains what `COPY`/`ADD` copy.

---

### Q11. Docker vs containerd vs Podman vs OCI

**Short answer:** **OCI** (Open Container Initiative) publishes open standards for the image format and the container runtime, so an image built with one tool runs on another. **Docker** is a full tool (CLI, daemon, build). **containerd** is the lower-level runtime that manages images and container lifecycles; Kubernetes and Amazon ECS use it directly. **runc** creates the actual container process. **Podman** is a daemonless, rootless-friendly alternative with a Docker-compatible CLI.

**How it works:**

| Piece | Role |
|---|---|
| OCI image and runtime specs | the common formats everyone follows |
| Docker CLI / Podman CLI | what you type; builds and runs |
| dockerd | Docker's daemon (API, networking, volumes) |
| containerd | pulls images, manages container lifecycle |
| runc | low-level: sets up namespaces and cgroups, starts the process |

**Example:** you build with `docker build -t api:1.4.0 .` on a laptop and push to ECR. ECS (which uses containerd, not dockerd) pulls and runs the same image. Nothing about the image needs to change because both follow the OCI formats.

**What happens, step by step:**
1. Docker (BuildKit) produces an OCI-compatible image and pushes it.
2. The ECS agent pulls it with containerd.
3. containerd calls runc, which creates the namespaces and cgroups and starts your process, exactly what `docker run` does at the bottom of its stack.

**Common mistake → fix:** assuming a Kubernetes or ECS node has a Docker daemon, then mounting `/var/run/docker.sock` in a pod or task. It usually doesn't exist. Fix: don't depend on the daemon at runtime; build images in CI with BuildKit or a rootless builder instead.

**Interview answer:** "OCI defines the image and runtime standards, so images are portable across tools. Docker is the developer-facing tool; underneath, containerd manages containers and runc creates them, and that's what Kubernetes and ECS use directly. Podman is a daemonless alternative with a compatible CLI."

**Follow-ups:**
- *Why did Kubernetes drop dockershim?* It talks to containerd (or CRI-O) directly through the Container Runtime Interface; Docker-built images still work because they follow OCI.

---

### Q12. Essential CLI commands for debugging

**Short answer:** Work from outside in: is it running (`docker ps -a`), what did it print (`docker logs`), what is its configuration and state (`docker inspect`), what is it doing right now (`docker exec`, `docker stats`), and what is inside the image (`docker history`, `docker run --rm -it --entrypoint sh image`).

**How it works:**

| Question | Command |
|---|---|
| Is it running? Exit code? | `docker ps -a` |
| What did it print? | `docker logs --tail 100 -f <c>` |
| Config, env vars, mounts, state, OOM? | `docker inspect <c>` (look at `State.ExitCode`, `State.OOMKilled`) |
| Look around inside | `docker exec -it <c> sh` |
| CPU and memory live | `docker stats` |
| Start the image with a shell instead of its entrypoint | `docker run --rm -it --entrypoint sh <image>` |
| Layers and sizes | `docker history <image>` |
| Disk used / clean up | `docker system df`, `docker system prune` |

**Example:** the container `api` keeps restarting.
```bash
docker ps -a --filter name=api
docker inspect -f '{{.State.ExitCode}} {{.State.OOMKilled}}' api
docker logs --tail 20 api
```

**What happens, step by step:**
1. `docker ps -a` shows `Restarting (137) 12 seconds ago`.
2. `inspect` prints `137 true`: exit code 137 with OOMKilled true means the kernel killed it for exceeding its memory limit (Q33).
3. The last log lines show it loading a large file into memory at startup. You now know to raise the limit or stream the file.

**Common mistake → fix:** `docker exec -it <c> sh` into a crash-looping container; it exits before you can attach. Fix: read `docker logs`, then start a copy with a shell instead of the real entrypoint: `docker run --rm -it --entrypoint sh <image>`, and run the app by hand.

**Interview answer:** "I go ps -a for state and exit code, logs for output, inspect for configuration, exit code and OOMKilled, then exec or an overridden entrypoint to explore inside. stats shows live CPU and memory, and history shows what's in the image."

**Follow-ups:**
- *How do you debug a distroless image with no shell?* Use `docker debug` (Docker Desktop) or an ephemeral debug container (Kubernetes) that shares its namespaces.

---
## 3. Dockerfile in depth

### Q13. What is a Dockerfile, and what happens during `docker build`?

**Short answer:** A **Dockerfile** is a text file of instructions that describes how to build an image: start `FROM` a base image, copy files in, run commands, and set the default command. `docker build` reads it top to bottom, runs each instruction in a temporary container, saves the result as a layer, and tags the final stack as your image. The folder you build from is the **build context**.

**How it works:**
1. `docker build -t api:1.4.0 .` sends the context (`.`, minus `.dockerignore` entries) to the builder (BuildKit).
2. Each instruction runs on top of the previous layer. `FROM` picks the starting layer; `COPY` adds files from the context; `RUN` executes a command and saves what it changed.
3. Metadata instructions (`ENV`, `USER`, `ENTRYPOINT`, `EXPOSE`) change the image's configuration but add no files.
4. The result is an image with an ID; `-t` gives it a name and tag.

**Example:**
```dockerfile
FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
USER 10001
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**What happens, step by step:**
1. `FROM python:3.13-slim`: Docker pulls (or reuses) the Python base image, about 45 MB compressed.
2. `WORKDIR /app`: creates `/app` and makes it the current directory for later steps.
3. `COPY requirements.txt .`: copies one file into `/app`. A small layer.
4. `RUN pip install ...`: starts a temporary container, installs packages (say 60 MB), saves the new files as a layer.
5. `COPY . .`: copies the source code into `/app`.
6. `USER 10001` and `CMD`: record that the container runs as that user and starts uvicorn. No files change; this is metadata.
7. `docker run api:1.4.0` now starts uvicorn in a container.

**Common mistake → fix:** treating `RUN` as something that happens when the container starts. `RUN` executes at **build** time. Starting commands belong in `CMD`/`ENTRYPOINT`. A `RUN service nginx start` in a Dockerfile starts nothing in the final container.

**Interview answer:** "A Dockerfile is the build recipe. docker build sends the build context to BuildKit, which executes each instruction on top of the previous layer, saves the filesystem changes as layers, and records metadata such as the user and default command. RUN is build time; CMD and ENTRYPOINT define what runs when a container starts."

**Follow-ups:**
- *Can you build without a Dockerfile name?* Use `-f path/to/Dockerfile`; the context is still the directory you pass last.

---

### Q14. The core Dockerfile instructions

**Short answer:** About a dozen instructions cover almost every Dockerfile. Know which ones run at **build** time (`RUN`, `COPY`, `ADD`, `ARG`) and which describe **runtime** behaviour (`ENV`, `USER`, `ENTRYPOINT`, `CMD`, `EXPOSE`, `HEALTHCHECK`).

**How it works:**

| Instruction | Purpose |
|---|---|
| `FROM` | base image (pin the version, ideally the digest); also starts a new stage |
| `WORKDIR` | set the working directory (creates it) |
| `COPY` | copy files from the build context (`--chown`, `--from=stage`) |
| `ADD` | like COPY, plus URL download and tar extraction. Prefer `COPY` |
| `RUN` | execute at **build** time, creating a layer |
| `ENV` | environment variable, in the image and at runtime |
| `ARG` | build-time variable only (Q16) |
| `USER` | user for later steps and for the container (Q21) |
| `EXPOSE` | document a port (Q09) |
| `ENTRYPOINT` / `CMD` | what the container runs (Q15) |
| `HEALTHCHECK` | command to test container health (Q31) |
| `LABEL` | metadata such as source repo and commit (Q23) |

**Example:** `COPY` vs `ADD`:
```dockerfile
COPY app.tar.gz /tmp/        # copies the file as is
ADD app.tar.gz /app/         # copies AND unpacks the archive into /app
ADD https://example.com/tool /usr/bin/tool   # downloads, but no checksum and not cached well
```

**What happens, step by step:**
1. `COPY` places `app.tar.gz` in `/tmp` untouched. You decide what to do with it.
2. `ADD` auto-extracts local tar archives, so `/app` receives the unpacked files. That implicit behaviour surprises people.
3. `ADD <url>` downloads at build time with no integrity check, so a changed remote file silently changes your image. Use `curl` with a checksum in a `RUN` instead, or a multi-stage `COPY --from`.

**Common mistake → fix:** `ADD` for ordinary files. It does hidden extra things. Fix: `COPY` unless you specifically want archive extraction.

**Interview answer:** "FROM picks the base, WORKDIR sets the directory, COPY brings files in, RUN executes commands at build time and creates layers, ENV and ARG hold runtime and build-time variables, USER drops privileges, and ENTRYPOINT with CMD define the start command. I prefer COPY over ADD because ADD does implicit extraction and downloads."

**Follow-ups:**
- *`COPY --chown`?* Sets file ownership during the copy, avoiding an extra `chown` layer that duplicates the files.

---

### Q15. `CMD` vs `ENTRYPOINT`, exec form vs shell form

**Short answer:** `ENTRYPOINT` defines **the program** the container runs; `CMD` provides **default arguments** (or a default command) that `docker run image <args>` replaces. **Exec form** (`["uvicorn", "app:app"]`) runs your program directly as PID 1, so it receives signals. **Shell form** (`uvicorn app:app`) wraps it in `/bin/sh -c`, so the shell is PID 1 and **does not pass signals on**, which breaks graceful shutdown.

**How it works:**
- The final command is `ENTRYPOINT` + `CMD`. If there is no `ENTRYPOINT`, `CMD` alone is the command.
- `docker run img --port 9000` replaces `CMD` only. `--entrypoint` replaces the entrypoint.
- The shell form also ignores `CMD` and `docker run` arguments when used in `ENTRYPOINT`.

**Example:**
```dockerfile
ENTRYPOINT ["uvicorn", "app.main:app", "--host", "0.0.0.0"]
CMD ["--port", "8000"]
```
```bash
docker run api:1.4.0                 # uvicorn app.main:app --host 0.0.0.0 --port 8000
docker run api:1.4.0 --port 9000     # uvicorn app.main:app --host 0.0.0.0 --port 9000
```

```flow
trace: ENTRYPOINT plus CMD, and signals
Dockerfile has ENTRYPOINT uvicorn and CMD --port 8000 > The default command is the two joined together.
docker run api --port 9000 > Arguments after the image name replace CMD only. ENTRYPOINT stays.
shell form CMD uvicorn app:app > PID 1 is **/bin/sh**, and uvicorn is its child process.
docker stop sends SIGTERM to PID 1 > The shell does not forward it, so uvicorn never hears it and Docker sends SIGKILL after 10 seconds.
exec form CMD ["uvicorn", "app:app"] > PID 1 is **uvicorn**, which receives SIGTERM and shuts down cleanly.
```

**What happens, step by step:**
1. Plain `docker run api:1.4.0` starts `uvicorn app.main:app --host 0.0.0.0 --port 8000`.
2. Adding `--port 9000` swaps only the `CMD` part, so the server listens on 9000.
3. With shell form, `docker exec api ps` shows `1 sh -c uvicorn ...` and `7 uvicorn ...`. `docker stop` takes the full 10 seconds, then kills hard: in-flight requests are cut.
4. With exec form, the stop completes in a second or two after uvicorn drains.

**Common mistake → fix:** `CMD python app.py` (shell form) in production, or `CMD ["sh", "-c", "python app.py"]`. Shutdown always takes the full timeout and requests are dropped. Fix: exec form, or in a shell wrapper script use `exec python app.py` so the real process replaces the shell.

**Interview answer:** "ENTRYPOINT is the executable and CMD supplies default arguments that docker run can override. I always use exec form so my process is PID 1 and receives SIGTERM; shell form puts /bin/sh in front, which swallows signals and causes slow, ungraceful shutdowns."

**Follow-ups:**
- *When use only CMD?* For images meant to be run with different commands (`docker run python:3.13 python script.py`).

---

### Q16. `ARG` vs `ENV`

**Short answer:** `ARG` is a **build-time** variable (`docker build --build-arg VERSION=1.4`) that doesn't exist in the running container. `ENV` is set in the image and **persists into every running container**. **Neither is a safe place for secrets**: both can be read from the image's metadata and history. Use BuildKit secret mounts at build time and runtime injection (Q37) for secrets.

**How it works:**
- `ARG VERSION=dev` declares a variable with a default; `--build-arg VERSION=1.4.0` overrides it. It is visible to later `RUN` lines.
- `ENV APP_ENV=production` bakes a default into the image; `docker run -e APP_ENV=staging` overrides it per container.
- `docker history` shows the `ARG`/`ENV` values used for each step.

**Example:**
```dockerfile
ARG PYTHON_VERSION=3.13
FROM python:${PYTHON_VERSION}-slim
ARG GIT_SHA=unknown
ENV APP_ENV=production
LABEL org.opencontainers.image.revision=$GIT_SHA
```
```bash
docker build --build-arg GIT_SHA=3f2a9c1 -t api:1.4.0 .
docker run --rm -e APP_ENV=staging api:1.4.0 env | grep APP_ENV
```

**What happens, step by step:**
1. The first `ARG` (before `FROM`) is used only to pick the base image tag: `python:3.13-slim`. ARGs declared before `FROM` aren't available after it unless you redeclare them.
2. `ARG GIT_SHA` after `FROM` receives `3f2a9c1`, which is recorded into the label.
3. `ENV APP_ENV=production` is part of the image config.
4. The run command overrides it, so `env` prints `APP_ENV=staging`. `GIT_SHA` is not in the environment, because ARG values aren't passed to the running container.

**Common mistake → fix:** `ARG NPM_TOKEN` then `RUN npm ci` using it. The token ends up in `docker history`. Fix: `RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci` (Q19).

**Interview answer:** "ARG exists only during the build; ENV persists into the container. Both are visible in image metadata, so neither is for secrets. For build secrets I use BuildKit secret mounts, and for runtime secrets I inject them from Secrets Manager at start. Runtime configuration is passed as environment variables instead of being baked in."

**Follow-ups:**
- *Why redeclare ARG after FROM?* Each build stage has its own scope; only ARGs before the first FROM are global to the FROM lines.

---

### Q17. Multi-stage builds

**Short answer:** A **multi-stage build** uses several `FROM` lines in one Dockerfile. Early stages have compilers and build tools and produce the application; the last stage starts from a clean, small base and **copies in only the results**. The final image has no build tools, so it is smaller and has fewer vulnerabilities.

**How it works:**
- `FROM image AS builder` names a stage. `COPY --from=builder /src/result /app` copies files from it.
- Only the **last stage** (or the one chosen with `--target`) becomes the final image. Earlier stages are discarded, though their layers stay in the build cache.
- It replaces the old trick of cleaning up inside one giant `RUN`.

**Example:**
```dockerfile
# syntax=docker/dockerfile:1
FROM python:3.13-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project
COPY src/ ./src/
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev

FROM python:3.13-slim AS runtime
RUN useradd --create-home --uid 10001 appuser
WORKDIR /app
COPY --from=builder --chown=appuser:appuser /app /app
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
USER 10001
EXPOSE 8000
ENTRYPOINT ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

```flow
pipeline: Multi-stage build
Stage builder starts FROM python:3.13-slim > It gets the uv tool, then installs dependencies from the lockfile and builds the app into /app/.venv. This stage can be large.
Stage runtime starts FROM python:3.13-slim again > A fresh, small base with none of the builder's tools or caches.
COPY --from=builder /app /app > Only the finished application and its virtual environment cross over.
Final image > Contains the runtime stage plus /app. The builder stage is discarded.
```

**What happens, step by step:**
1. The builder stage installs dependencies. Because `pyproject.toml` and `uv.lock` are copied before the source, this expensive layer is cached until dependencies change (Q05).
2. The cache mount keeps uv's download cache between builds without putting it into any layer.
3. The runtime stage starts clean, creates user `appuser` (UID 10001), and copies `/app` from the builder with the right ownership.
4. The result is about 140 MB; a single-stage image with the uv binary, caches and git headers might be 450 MB.

**Common mistake → fix:** copying the whole builder filesystem (`COPY --from=builder / /`). That brings back everything you wanted to leave behind. Fix: copy specific paths only (the virtualenv or compiled binary).

**Interview answer:** "A multi-stage build uses one stage with the toolchain to build the app and a clean final stage that copies in only the build output. Build tools, caches and source don't ship, so the image is smaller and has fewer CVEs. I order the builder stage so dependencies are cached separately from source, and I copy specific paths into the runtime stage."

**Follow-ups:**
- *Frontend example?* A `node` stage runs `vite build`; a final `nginx:alpine` stage copies only `dist/`.
- *Build only one stage?* `docker build --target builder .`, useful for running tests in the build stage.

---

### Q18. How do you choose a base image?

**Short answer:** The base image decides your image's size, security patch rate and debugging experience. A good default is the official **slim** variant (`python:3.13-slim`): small, uses glibc, and works with prebuilt packages. **Distroless** images remove the shell and package manager for a tiny attack surface but are harder to debug. **Alpine** is very small but uses musl instead of glibc, which can break or slow Python and other native packages. Pin the version (ideally the digest) and rebuild regularly.

**How it works:**

| Base | Size | Notes |
|---|---|---|
| `python:3.13` | large (~1 GB) | has compilers; use for builder stages |
| `python:3.13-slim` | medium | Debian minimal; good default |
| `python:3.13-alpine` | small | musl libc; many wheels must compile, occasional bugs |
| Distroless / Chainguard / Docker Hardened Images | very small | no shell or package manager, fewer CVEs, harder debugging |
| `scratch` | empty | static binaries (Go, Rust) |

**How to choose:** start with `-slim`; move to distroless/hardened images once the app is stable and you have another way to debug; use Alpine only if every dependency is known to work on musl; use `scratch` for static binaries.

**Example:** a service uses `numpy` and `psycopg`.
```dockerfile
FROM python:3.13.7-slim-bookworm      # pinned minor and OS release
# On alpine, numpy has no musl wheel for some versions: pip compiles it (5+ minutes, needs gcc)
```

**What happens, step by step:**
1. On `-slim`, `pip install numpy` downloads a prebuilt manylinux wheel in seconds.
2. On `-alpine`, pip may find no musl-compatible wheel, installs a compiler toolchain, and compiles for minutes. The image can end up *larger* than the slim version after the toolchain is added.
3. Pinning `3.13.7-slim-bookworm` means a rebuild next month picks up the same Python and Debian release. You upgrade deliberately and rebuild weekly to get OS patches.

**Common mistake → fix:** `FROM python:latest` or an unpinned `python:3`. The Python version changes under you and a new major release breaks the build on a Friday. Fix: pin an exact tag, or a digest (`python@sha256:...`) plus a scheduled rebuild.

**Interview answer:** "I default to the official slim image pinned to an exact version, use full images only in builder stages, consider distroless or hardened images for a minimal attack surface when I have another debugging path, and avoid Alpine for Python because musl often means compiling wheels. I rebuild regularly so base patches arrive deliberately."

**Follow-ups:**
- *Pin by tag or digest?* A digest is fully reproducible but won't update itself; use a bot (Renovate or Dependabot) to bump it.

---

### Q19. BuildKit features: cache mounts, secret mounts and multi-platform builds

**Short answer:** **BuildKit** is Docker's modern build engine (the default builder). Three features matter in practice. **Cache mounts** (`RUN --mount=type=cache`) keep a package cache between builds without storing it in the image. **Secret mounts** (`RUN --mount=type=secret`) make a secret available for one `RUN` step without writing it to any layer. **Multi-platform builds** (`--platform linux/amd64,linux/arm64`) produce one image tag that works on both x86 and ARM machines.

**How it works:**
- A cache mount is local to the builder. It is **not** exported by `--cache-to`, so on CI runners that start fresh each time, cache mounts start empty (use registry layer cache for those, Q44).
- A secret mount appears at `/run/secrets/<id>` (or as an environment variable with `env=`) only during that instruction; writes to the mount are discarded.
- Multi-platform builds use native builders or QEMU emulation; the registry stores a manifest list pointing to each architecture's image.

**Example:**
```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    --mount=type=secret,id=npmrc,target=/root/.npmrc \
    npm ci
```
```bash
docker build --secret id=npmrc,src=$HOME/.npmrc -t web:1.0 .
docker buildx build --platform linux/amd64,linux/arm64 -t registry.example.com/web:1.0 --push .
```

**What happens, step by step:**
1. `npm ci` runs with `/root/.npm` mounted from the builder's persistent cache: the second build downloads almost nothing.
2. `/root/.npmrc` (containing the private registry token) is mounted read-only for this step only. After the step, it is gone; `docker history` and the layer contents don't contain the token.
3. The second command builds two images (amd64 and arm64) and pushes them under one tag. A Graviton ECS task pulls the arm64 variant automatically; an x86 laptop pulls amd64.
4. Building arm64 on an x86 laptop uses emulation, which is slow; CI with native ARM runners is faster.

**Common mistake → fix:** building on an Apple Silicon laptop (arm64) and deploying to x86 Fargate tasks, or the reverse. The task starts and dies with `exec format error`. Fix: `--platform` matching the target, or a multi-platform image.

**Interview answer:** "BuildKit gives me cache mounts to persist package caches between builds, secret mounts so tokens never land in a layer, and multi-platform builds that publish one tag for amd64 and arm64. I make sure the platform matches where it will run, and use registry-backed layer cache in CI where cache mounts would start empty."

**Follow-ups:**
- *Does `docker buildx build --sbom=true --provenance=mode=max` exist?* Yes, BuildKit can attach an SBOM and provenance attestation to the image (Q38).

---

### Q20. How do you reduce image size and vulnerabilities?

**Short answer:** Ship less. Use a slim or distroless base, a multi-stage build so compilers and caches stay behind, install without recommended extras and clean package lists in the **same** `RUN`, skip dev dependencies, use `.dockerignore`, then scan and rebuild often. Fewer packages means a smaller download and fewer known vulnerabilities (CVEs).

**How it works:** find what is big first with `docker history` or `dive`, then fix the biggest layer. The usual causes are build tools in the final image, package caches, copied data folders and `.git`, and over-large base images.

**Example:**
```dockerfile
FROM python:3.13-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends libpq5 \
 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
```

**What happens, step by step:**
1. `apt-get update` downloads package indexes (~30 MB) into `/var/lib/apt/lists/`.
2. `--no-install-recommends` installs only `libpq5`, not the suggested extras (saves ~100 MB).
3. `rm -rf /var/lib/apt/lists/*` runs in the **same** layer, so the 30 MB of indexes never become part of the image. In a separate `RUN rm`, the earlier layer would still hold them.
4. `--no-cache-dir` stops pip storing its download cache (~60 MB) in the layer.
5. A scan (Trivy or ECR) then reports fewer packages and CVEs.

**Common mistake → fix:** `RUN apt-get install ...` then `RUN rm -rf /var/lib/apt/lists/*` as separate steps. The files are gone from the view, but the earlier layer still stores them, so the size doesn't drop. Fix: one `RUN` with `&&`, or a multi-stage build.

**Interview answer:** "I inspect layers with docker history, then use a slim or distroless base, multi-stage builds, no-install-recommends with cleanup in the same RUN, no dev dependencies, dockerignore, and no cached downloads. I scan with Trivy or ECR and rebuild regularly to pick up base-image patches."

**Follow-ups:**
- *Large ML images?* Use CPU-only PyTorch wheels when you don't need CUDA, and download model weights at runtime or mount them instead of baking them in.

---

### Q21. Running as a non-root user

**Short answer:** By default, a container's process runs as **root (UID 0)** inside the container. If an attacker breaks out of the app or the container, root makes the next step easier. Create an unprivileged user, switch to it with `USER`, give it ownership of only the paths it must write, and (on ECS or Kubernetes) also set a read-only root filesystem and drop Linux capabilities.

**How it works:**
- `RUN useradd --uid 10001 app` creates the user; `USER 10001` switches to it for later instructions and for the running container. A numeric UID lets orchestrators verify "non-root" without reading `/etc/passwd`.
- Non-root users can't bind ports below 1024, so use 8000/8080.
- `COPY --chown=app:app` sets ownership during copy.

**Example:**
```dockerfile
FROM python:3.13-slim
RUN useradd --create-home --uid 10001 app
WORKDIR /app
COPY --chown=app:app . .
USER 10001
CMD ["python", "-m", "app"]
```
```bash
docker run --rm --read-only --tmpfs /tmp --cap-drop ALL api:1.4.0
```

**What happens, step by step:**
1. The app runs as UID 10001. `docker exec api id` prints `uid=10001(app)`.
2. Writing to `/etc/passwd` fails with `Permission denied`, and with `--read-only` writing anywhere except `/tmp` fails.
3. `--cap-drop ALL` removes Linux capabilities the app doesn't need.
4. If an attacker gets code execution in the app, they can't install packages, change system files or use privileged operations, which limits the damage.

**Common mistake → fix:** switching to non-root and then the app crashes with `PermissionError: /app/data` because the directory is owned by root. Fix: create writable paths in the Dockerfile and `chown` them (or use `COPY --chown`), or mount a writable volume or tmpfs.

**Interview answer:** "I create an unprivileged user with a numeric UID, set USER, give it ownership of only the paths it must write, and in the runtime add a read-only root filesystem and dropped capabilities. It's cheap defence in depth: a compromise of the app doesn't become root inside the container."

**Follow-ups:**
- *Does non-root fully prevent container escapes?* No, but it removes a major class; combine with seccomp, no privileged mode and no docker.sock mounts (Q36).

---

### Q22. How do you make builds reproducible?

**Short answer:** A reproducible build produces the same result from the same inputs. Pin every input: base image **digest**, language and OS package versions, dependencies via **lockfiles** (`uv.lock`, `package-lock.json`) installed with `--frozen`/`npm ci`, and tool versions. Build in CI, not on laptops, and rebuild on a schedule so updates arrive deliberately instead of by surprise.

**How it works:**
- Mutable references (`latest`, `python:3`, `pip install requests`) change over time without any change in your repository.
- Lockfile installs fail if the lockfile doesn't match the manifest, which catches drift.
- Avoid `apt-get upgrade` in app images; update the base image instead.
- `curl | sh` installers fetch whatever is current; download a pinned version and verify its checksum.

**Example:**
```dockerfile
FROM python:3.13.7-slim-bookworm@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
```
(The digest shown is a placeholder; use the one from your registry.)

**What happens, step by step:**
1. The base is pinned by digest: Docker pulls exactly those bytes, even if the tag has moved on.
2. `uv sync --frozen` installs exactly the versions in `uv.lock` and errors if `pyproject.toml` disagrees.
3. Rebuilding in six months gives the same dependency set. When you *want* updates, a bot opens an MR that bumps the digest and lockfile, CI tests it, and you merge deliberately.

**Common mistake → fix:** `pip install -r requirements.txt` with unpinned lines (`fastapi`). A new release changes behaviour in a rebuild nobody asked for. Fix: pin versions and use hashes or a lockfile.

**Interview answer:** "I pin the base image by digest, install from lockfiles with frozen flags, pin tool versions, avoid latest and curl-pipe-shell installers, and build in CI. Updates arrive through bot-opened merge requests, so changes are deliberate and tested rather than accidental."

**Follow-ups:**
- *Are builds ever bit-for-bit identical?* Rarely by default (timestamps, file ordering); tools like `SOURCE_DATE_EPOCH` and BuildKit's reproducible options help if you need it.

---

### Q23. Labels and image metadata

**Short answer:** `LABEL` adds key-value metadata to an image. The standard **OCI labels** (`org.opencontainers.image.source`, `.revision`, `.version`, `.created`) let you trace any running image back to its repository and exact commit, which matters during an incident and for supply-chain tooling.

**How it works:** labels are stored in the image config; `docker inspect <image>` shows them, and registries, scanners and dashboards read them. Pass the commit in through a build argument.

**Example:**
```dockerfile
ARG GIT_SHA
ARG BUILD_DATE
LABEL org.opencontainers.image.source="https://gitlab.example.com/payments/api" \
      org.opencontainers.image.revision="$GIT_SHA" \
      org.opencontainers.image.created="$BUILD_DATE"
```
```bash
docker build --build-arg GIT_SHA=$(git rev-parse HEAD) --build-arg BUILD_DATE=$(date -u +%FT%TZ) -t api:1.4.0 .
docker inspect -f '{{ index .Config.Labels "org.opencontainers.image.revision" }}' api:1.4.0
```

**What happens, step by step:**
1. The build receives the full commit SHA and timestamp as arguments.
2. They are recorded as labels on the image config; no files change.
3. During an incident, `docker inspect` on the running image (or a registry UI) prints the revision, so you can open that exact commit.

**Common mistake → fix:** placing `ARG GIT_SHA` high in the Dockerfile. A changing value invalidates the cache for every later layer (Q05). Fix: declare it near the end, just before `LABEL`.

**Interview answer:** "I label images with the OCI standard keys for source repo, revision and build time, passed in as build args, so any running image can be traced to a commit. I put those args late in the Dockerfile so they don't bust the layer cache."

**Follow-ups:**
- *Where else is provenance stored?* In attestations attached by BuildKit or signing tools (Q38).

---

### Q24. Putting it together: a production-ready Dockerfile for a Python API

**Short answer:** A good production Dockerfile combines everything above: a pinned slim base, multi-stage build, dependencies installed before source for caching, a non-root user, exec-form entrypoint, a health check that matches the platform, and no secrets or dev tools in the image.

**How it works:** read the file top to bottom and ask for each line: does it help caching, size, security or correctness?

**Example:**
```dockerfile
# syntax=docker/dockerfile:1
FROM python:3.13.7-slim-bookworm AS builder
WORKDIR /app
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt
COPY src/ ./src/

FROM python:3.13.7-slim-bookworm AS runtime
RUN useradd --create-home --uid 10001 app
WORKDIR /app
COPY --from=builder /opt/venv /opt/venv
COPY --from=builder --chown=app:app /app/src ./src
ENV PATH="/opt/venv/bin:$PATH" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
USER 10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"]
ENTRYPOINT ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**What happens, step by step:**
1. **Builder:** creates a virtualenv, installs requirements (cached until `requirements.txt` changes), copies source.
2. **Runtime:** a fresh slim image gets only the virtualenv and source, owned by an unprivileged user (UID 10001).
3. `PYTHONUNBUFFERED=1` makes logs appear immediately (Q08).
4. `HEALTHCHECK` runs every 30 seconds; failures during the first 20 seconds (`--start-period`) don't count; three consecutive failures mark the container `unhealthy`.
5. `ENTRYPOINT` in exec form makes uvicorn PID 1, so `docker stop` shuts down gracefully.

**Common mistake → fix:** a `HEALTHCHECK` that runs `curl` in an image that has no `curl`. It always fails, so the container reports unhealthy forever. Fix: use a tool that exists (here Python's own stdlib), or install the minimal tool deliberately.

**Interview answer:** "Pinned slim base, a builder stage for dependencies and a lean runtime stage, requirements copied before source for caching, a non-root numeric user, unbuffered logging, a health check using a tool that exists in the image, and an exec-form entrypoint so signals work. No secrets, no dev dependencies, nothing floating."

**Follow-ups:**
- *What would you add for ECS?* Define the health check in the task definition too (ECS ignores the Dockerfile `HEALTHCHECK`, Q31).

---

## 4. Networking, storage, Compose

### Q25. Docker networking: bridge, host, none and container-to-container names

**Short answer:** By default each container sits on a private **bridge** network. On a **user-defined** bridge network, containers find each other by **container name** through Docker's built-in DNS; on the default bridge they don't. `host` mode shares the host's network stack (no isolation, no port mapping), and `none` has no networking. On Amazon ECS with `awsvpc` mode, each task gets its own network interface and private IP in your VPC.

**How it works:**
- Create a network (`docker network create app-net`) and attach containers to it. Docker runs a DNS resolver on that network that answers container names.
- Publishing ports (`-p`) is for traffic coming from **outside** the host. Container to container traffic on the same network doesn't need it.

| Mode | Behaviour |
|---|---|
| `bridge` (default) | private network on the host; use user-defined bridges for name resolution |
| `host` | shares the host network stack; no isolation |
| `none` | no networking |
| `overlay` | multi-host networking (Swarm) |
| ECS `awsvpc` | each task gets its own ENI and private IP; security groups per task |

**Example:**
```bash
docker network create app-net
docker run -d --network app-net --name db -e POSTGRES_PASSWORD=dev postgres:17
docker run -d --network app-net -e DB_HOST=db --name api api:1.4.0
```

```flow
sequence: The api container connects to the db container by name
actors: api container, Docker DNS, db container
api container -> Docker DNS: what is the address of db?
Docker DNS --> api container: 172.18.0.2
api container -> db container: connect to 172.18.0.2 port 5432
> Both containers are on app-net. The db port was never published to the host because only other containers need it.
db container --> api container: connection accepted
```

**What happens, step by step:**
1. Both containers join `app-net`. Docker gives them private IPs, for example `172.18.0.2` for `db`.
2. The API's code connects to host `db`. The embedded DNS resolves the name to `172.18.0.2`.
3. The connection goes over the bridge to port 5432. No `-p` is needed.
4. From your laptop, `psql -h localhost` fails because the port was never published: reachable by containers on the network, not from outside.

**Common mistake → fix:** connecting to `localhost:5432` from the API container. Localhost is the API container itself. Fix: use the service/container name (`db`). Another: relying on names on the **default** bridge, where DNS by name doesn't work; use a user-defined network (Compose does this automatically).

**Interview answer:** "Containers on a user-defined bridge network resolve each other by name via Docker's DNS, and only traffic from outside the host needs published ports. Host mode shares the host's network and none disables networking. On ECS with awsvpc, each task has its own ENI and security group, so tasks talk to each other over the VPC."

**Follow-ups:**
- *Why is `localhost` a common bug?* Each container has its own network namespace, so its loopback is private.

---

### Q26. Volumes vs bind mounts vs tmpfs

**Short answer:** A container's own filesystem is temporary. To keep or share data: a **named volume** (managed by Docker, survives container removal, ideal for databases), a **bind mount** (a host folder mapped in, great for live-editing code in development), or **tmpfs** (memory only, for scratch data or secrets that must never touch disk).

**How it works:**

| | Volume | Bind mount | tmpfs |
|---|---|---|---|
| Managed by | Docker (`docker volume ...`) | you (a host path) | memory |
| Survives container removal | yes | yes (it's your folder) | no |
| Use | database files, persistent app data | live-reload source in development | scratch space, temporary secrets |
| Portability | good (no host path needed) | tied to the host's folder layout | n/a |

On ECS/Fargate containers are ephemeral too: keep state in RDS, DynamoDB, S3, or mount EFS, not in the container disk.

**Example:**
```bash
docker run -d --name db -v pgdata:/var/lib/postgresql/data -e POSTGRES_PASSWORD=dev postgres:17
docker exec db psql -U postgres -c "CREATE TABLE t(id int); INSERT INTO t VALUES (1);"
docker rm -f db
docker run -d --name db2 -v pgdata:/var/lib/postgresql/data -e POSTGRES_PASSWORD=dev postgres:17
docker exec db2 psql -U postgres -c "SELECT * FROM t;"
```

**What happens, step by step:**
1. The first run creates volume `pgdata` and Postgres writes its data files into it.
2. The table and row are saved in the volume (not in the container's writable layer).
3. `docker rm -f db` deletes the container and its writable layer, but the volume remains (`docker volume ls` still shows `pgdata`).
4. `db2` mounts the same volume, finds the existing database, and `SELECT` returns the row `1`.
5. Without `-v`, step 4 would show `relation "t" does not exist`; the data died with the first container.

**Common mistake → fix:** `docker compose down -v` (or `docker volume prune`) casually run to "clean up"; it deletes the database volume. Fix: use `down` without `-v` unless you really want to wipe the data, and back up volumes that matter.

**Interview answer:** "Volumes are Docker-managed storage that outlives containers, so I use them for databases; bind mounts map a host folder and suit live code reloading in dev; tmpfs is memory-only for scratch data. In production on ECS, containers are ephemeral, so durable state goes to RDS, S3 or EFS."

**Follow-ups:**
- *Why not bind mounts in production?* They depend on host paths and permissions, which breaks portability and scheduling.

---

### Q27. Docker Compose for local development

**Short answer:** **Docker Compose** lets you define a multi-container application (API, database, cache) in one file, `compose.yaml`, and start it all with `docker compose up`. It creates a shared network (services reach each other by service name), the volumes, and starts services in dependency order. It is ideal for local development and integration tests; for production use a platform such as ECS or Kubernetes.

**How it works:**
- `services:` defines containers (an `image:` to pull, or `build:` to build).
- `depends_on` with `condition: service_healthy` waits for the dependency's **health check** to pass, not just for its container to start.
- `develop.watch` (Compose Watch) syncs source changes into the running container for live reload.
- Common commands: `docker compose up -d`, `logs -f api`, `down` (add `-v` to delete volumes).

**Example:**
```yaml
# compose.yaml
services:
  api:
    build: .
    ports: ["8000:8000"]
    environment:
      DB_HOST: db
    depends_on:
      db:
        condition: service_healthy
    develop:
      watch:
        - action: sync
          path: ./src
          target: /app/src
  db:
    image: postgres:17
    environment:
      POSTGRES_PASSWORD: dev
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 10
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

```flow
pipeline: What docker compose up does with this file
Read compose.yaml > Two services (api, db) and one named volume (pgdata).
Create a project network > Both services join it, so api can reach the database at the hostname db.
Start db and wait > Postgres starts. The health check runs pg_isready every 5 seconds until it succeeds.
Start api when db is healthy > depends_on with service_healthy holds the API back until the database accepts connections.
Watch the source folder > Edits under ./src are synced into /app/src in the running container.
```

**What happens, step by step:**
1. `docker compose up --build` builds the `api` image and creates network `<project>_default`.
2. `db` starts. For the first ~3 seconds `pg_isready` fails; Compose shows db as `starting`, then `healthy`.
3. Only then does `api` start; it connects to host `db` successfully on its first attempt.
4. You edit `src/handlers.py`; Compose Watch copies it into the container immediately.
5. `docker compose down` removes containers and the network; `pgdata` stays. `down -v` would delete it.

**Common mistake → fix:** `depends_on: [db]` alone. Compose waits for the container to *start*, not for Postgres to be ready, so the API crashes with `connection refused`. Fix: a health check on `db` and `condition: service_healthy`.

**Interview answer:** "Compose describes a multi-container app in one file: services, networks and volumes. up creates a network where services find each other by name and starts them in dependency order; with health checks and service_healthy, the API waits for a ready database. I use it for local dev and integration tests, with Compose Watch for live reload."

**Follow-ups:**
- *Compose in production?* Possible for small single-host setups, but for scaling, rolling deploys and self-healing use ECS or Kubernetes.

---

### Q28. Local vs production configuration (12-factor)

**Short answer:** Build **one image** and run it everywhere; the only thing that differs between environments is **configuration**, injected at runtime through environment variables and secrets. Don't bake environment-specific values or secrets into the image. Log to stdout. These ideas come from the "twelve-factor app" guidelines.

**How it works:**
- Same image digest in dev, staging and production (build once, deploy many).
- Non-secret config: environment variables (`LOG_LEVEL`, `DB_HOST`).
- Secrets: injected at start by the platform (ECS task definition `secrets` from Secrets Manager or SSM Parameter Store), or fetched by the app using its task role.
- Logs: stdout/stderr, collected by the platform (Q08).

**Example (ECS task definition fragment):**
```json
"containerDefinitions": [{
  "name": "api",
  "image": "123456789012.dkr.ecr.ap-south-1.amazonaws.com/api@sha256:ab12...",
  "environment": [{ "name": "LOG_LEVEL", "value": "INFO" }],
  "secrets": [{ "name": "DB_PASSWORD",
                "valueFrom": "arn:aws:secretsmanager:ap-south-1:123456789012:secret:prod/db-AbCdEf" }]
}]
```

**What happens, step by step:**
1. The image is identical in staging and production; only the task definition differs.
2. At task start, ECS fetches the secret value (using the task execution role) and injects it as environment variable `DB_PASSWORD`.
3. The app reads `os.environ["DB_PASSWORD"]`. The secret was never in the image, the Git repo or the task definition's plain text.
4. Rotating the secret needs a new task start, not a new image build.

**Common mistake → fix:** a separate image per environment (`COPY config.prod.json`). You test one artifact and ship another. Fix: one image, config from the environment.

**Interview answer:** "One image everywhere, and configuration injected at runtime: environment variables for plain settings, and secrets pulled from Secrets Manager or SSM by the platform at start. Logs go to stdout. That keeps the tested artifact identical to the deployed one and makes secret rotation independent of builds."

**Follow-ups:**
- *Config files?* Mount them as a volume or ConfigMap-like secret, or fetch them at startup, rather than baking them in.

---

### Q29. Containers are ephemeral: what does that mean for design?

**Short answer:** A container can be stopped and replaced at any moment (deploys, scaling in, a crashed host, spot reclaim), and its filesystem goes with it. So design the application to be **stateless**, keep state outside (database, S3, Redis), shut down gracefully on SIGTERM, make work **idempotent** (safe to repeat), and start quickly.

**How it works:**
- **No local state:** user uploads to S3, sessions in Redis, data in RDS.
- **Graceful shutdown:** finish in-flight requests when told to stop (Q30).
- **Idempotent jobs:** a job that was half-done when the container died may run again.
- **Fast start and health checks:** so replacements take traffic quickly (Q31).

**Example:** an upload endpoint saves files to `/app/uploads`.

**What happens, step by step:**
1. User A uploads `report.pdf`; it is written to the container's disk on task 1.
2. A deploy replaces task 1 with task 2. The file is gone.
3. With two tasks behind a load balancer, even without a deploy, user A's next request may hit task 2, which never had the file.
4. Fix: save to S3 and store the object key in the database. Any task can serve the file, and tasks can be replaced freely.

**Common mistake → fix:** keeping in-memory sessions or a local SQLite file in a service that runs more than one copy. Users are logged out at random and data diverges. Fix: external session store and database.

**Interview answer:** "Containers are disposable, so I keep them stateless: durable data in managed stores, shutdown handled on SIGTERM, idempotent work and quick startup with honest health checks. That lets the platform deploy, scale and heal by simply replacing containers."

**Follow-ups:**
- *What about databases in containers?* Fine for dev; in production prefer managed services, or use volumes with a clear backup strategy.

---
## 5. Runtime behaviour: signals, health, resources

### Q30. SIGTERM and graceful shutdown

**Short answer:** When Docker or ECS stops a container, it sends **SIGTERM** (a "please stop" signal) to the container's main process (PID 1), waits a **grace period**, then sends **SIGKILL** (a hard kill that cannot be caught). Docker's default grace period is 10 seconds; ECS's `stopTimeout` defaults to 30 seconds and can be raised to at most 120 seconds on Fargate. Your app must catch SIGTERM, stop accepting new work, finish in-flight requests, close connections and exit.

**How it works:**
1. The platform decides to stop the task (deploy, scale-in, node drain).
2. It stops sending new traffic: the load balancer deregisters the target and finishes existing requests during its deregistration delay.
3. SIGTERM is delivered to PID 1. This works only if your app **is** PID 1 (exec form, Q15) or an init process forwards it (Q34).
4. The app drains and exits with code 0 or 143.
5. If the process is still alive when the grace period ends, SIGKILL ends it immediately, dropping whatever was in flight.

**Example:**
```python
import asyncio, signal

stop = asyncio.Event()

def handle_sigterm(*_):
    stop.set()                      # tell the worker loop to finish and exit

signal.signal(signal.SIGTERM, handle_sigterm)

async def worker():
    while not stop.is_set():
        job = await next_job(timeout=1)
        if job:
            await process(job)      # finish the job in hand before exiting
```
(Uvicorn and Gunicorn already handle SIGTERM for web requests; custom workers need code like this.)

```flow
pipeline: Graceful shutdown on ECS
ECS decides to stop task 7 > A deploy is replacing it with a newer version.
Load balancer deregisters the task > No new requests arrive. Requests already running continue during the deregistration delay.
SIGTERM reaches PID 1 > The app begins shutting down. This only works if the app is PID 1 or an init process forwards the signal.
App drains > It finishes in-flight requests, closes database connections and flushes logs, then exits with code 0.
SIGKILL at stopTimeout > If the app is still running after 30 seconds, ECS kills it hard and unfinished work is lost.
```

**What happens, step by step:**
1. At t = 0 s, ECS marks the task as draining and sends SIGTERM. A request that started 2 s earlier is still running.
2. The app sets `stop`, stops taking new jobs, and finishes the current request at t = 4 s.
3. It closes the database pool and exits with code 0 at t = 5 s. Total shutdown: 5 seconds, no errors for users.
4. Had the app ignored SIGTERM (or been behind `sh -c`), nothing would happen until t = 30 s, when SIGKILL ends it mid-request.

**Common mistake → fix:** a long request or job that takes longer than `stopTimeout`. It is killed at the deadline. Fix: raise `stopTimeout` (up to the platform maximum), keep requests short, and make long jobs checkpoint or restartable.

**Interview answer:** "On stop, the platform sends SIGTERM to PID 1, waits for the grace period, 10 seconds in Docker, 30 seconds by default on ECS, then SIGKILLs. So I use exec-form entrypoints or an init process so the signal reaches the app, and the app stops accepting work, finishes in-flight requests, closes connections and exits within the timeout."

**Follow-ups:**
- *Can you change the stop signal?* Yes, with `STOPSIGNAL` in the Dockerfile or `--stop-signal`.
- *Exit code after a clean SIGTERM?* 143 (128 + 15) if the process dies from the signal; 0 if it handles it and exits normally.

---

### Q31. Docker `HEALTHCHECK` vs ECS container health check vs load balancer health check

**Short answer:** A **health check** is a small command or HTTP probe that tells the platform whether a container is working. Three different mechanisms exist and they do different things: Docker's `HEALTHCHECK` (marks the container `healthy`/`unhealthy`, but Docker itself doesn't restart it), the **ECS container health check** (defined in the task definition; an unhealthy essential container makes ECS replace the task), and the **load balancer target group health check** (an unhealthy target stops receiving traffic, and ECS replaces it). **ECS ignores the Dockerfile's `HEALTHCHECK`.**

**How it works:**

| Check | Who runs it | Effect when failing |
|---|---|---|
| Dockerfile `HEALTHCHECK` | Docker engine, inside the container | status shows `unhealthy`; Compose can wait on it |
| ECS container `healthCheck` | ECS agent, inside the container | ECS stops and replaces the task (if the container is essential) |
| ALB target group check | load balancer calls an HTTP path | target gets no traffic; ECS replaces unhealthy targets |

Docker's defaults for `HEALTHCHECK` are `--interval=30s --timeout=30s --start-period=0s --retries=3`. The command exits `0` for healthy, `1` for unhealthy. Failures during `--start-period` don't count toward retries, which gives slow-starting apps time.

Keep the check cheap and honest: a **liveness** check (`/health`) should say "the process works", not fail because the database is briefly down. Otherwise one database blip makes the platform kill every task at once.

**Example:**
```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"]
```

**What happens, step by step:**
1. The container starts at t = 0. The app needs 15 seconds to load a model.
2. At t = 30 s the first check runs (after one interval) and returns exit code 0: status `healthy`.
3. If the app later hangs, three consecutive failures (90 seconds) change the status to `unhealthy`, visible in `docker ps`.
4. On plain Docker nothing else happens. On ECS the task-definition health check (or the ALB check) is what triggers a replacement; the Dockerfile one is ignored.

**Common mistake → fix:** relying on the Dockerfile `HEALTHCHECK` for ECS self-healing. ECS never reads it, so a hung container stays in service. Fix: define `healthCheck` in the task definition and a target group health check on the load balancer, and set a grace period (`healthCheckGracePeriodSeconds`) for slow starts.

**Interview answer:** "Docker's HEALTHCHECK only sets a status; ECS ignores it. On ECS the container health check in the task definition makes ECS replace the task, and the ALB target group check removes the target from rotation. I keep liveness checks cheap and independent of downstream services, and add start periods and grace periods for slow starts."

**Follow-ups:**
- *Liveness vs readiness?* Liveness: should the process be restarted? Readiness: should it receive traffic right now? A readiness check may test dependencies.

---

### Q32. Resource limits: CPU and memory

**Short answer:** Without limits a container can use as much of the host as it likes. **Memory limits** are hard: exceed them and the kernel **OOM-kills** the process (exit code 137, `OOMKilled: true`). **CPU limits** are soft: the container is **throttled** (slowed), not killed. Set both deliberately, based on measurement.

**How it works:**
- Docker: `--memory=512m` and `--cpus=1.0`. These use cgroups.
- ECS on Fargate: task-level CPU and memory (fixed size combinations) plus container-level `memory` (hard limit) and `memoryReservation` (soft limit).
- Python/Node services: memory grows with worker count, payload size and caches; set the number of workers from the memory available.

**Example:**
```bash
docker run -d --name api --memory=512m --cpus=1.0 api:1.4.0
docker stats --no-stream api
```

```flow
trace: Hitting the memory limit
limit is 512 MiB, usage 300 MiB > The limit is enforced by the kernel using cgroups, and usage is below it.
traffic spike: usage reaches **500 MiB** > Close to the limit. There is no swap to absorb more.
a request loads a 100 MiB file into memory > The process asks for memory beyond 512 MiB.
the kernel OOM-kills the process > The container exits with code **137** and docker inspect shows OOMKilled true.
fix > Stream large files, bound caches, use fewer workers per container, or raise the limit based on measurement.
```

**What happens, step by step:**
1. Normal load: `docker stats` shows `300MiB / 512MiB`.
2. A spike brings it to 500 MiB. Nothing visible happens yet.
3. A request reads a 100 MiB upload into a Python `bytes` object. Total demand 600 MiB exceeds 512 MiB.
4. The kernel's OOM killer terminates the process instantly (SIGKILL: no handlers run, no graceful shutdown). The container exits with 137; with `--restart` or ECS it restarts, and the user sees a failed request.
5. If it were only the CPU limit, the app would just run slower under load, with no crash.

**Common mistake → fix:** setting the limit to the average usage. Peaks cause OOM kills. Fix: measure peak usage under realistic load, add headroom (for example 25 to 30 percent), and cap concurrency so load can't exceed capacity.

**Interview answer:** "Memory limits are hard: exceed them and the kernel OOM-kills the process with exit 137. CPU limits throttle instead of killing. I size from measured peak usage plus headroom, bound caches and concurrency, stream large data instead of loading it, and on ECS use the task-level limits plus the container hard and soft memory settings."

**Follow-ups:**
- *Why does `docker stats` show less than the limit but I still get OOM?* A short spike between samples, or non-heap memory (native libraries, thread stacks, page cache counted in the cgroup).

---

### Q33. Exit codes you should recognise

**Short answer:** When a container's main process ends, its **exit code** tells you why. `0` is a clean exit, `1` is an application error, `126`/`127` mean the command can't run or isn't found, `137` means SIGKILL (often out of memory, or killed after the stop timeout), `139` is a segmentation fault, and `143` means it exited because of SIGTERM. Codes above 128 mean "128 + signal number".

**How it works:**

| Code | Meaning | First thing to check |
|---|---|---|
| 0 | clean exit | for a web server it is unexpected: something told it to stop, or it ran a one-shot command |
| 1 | application error | `docker logs` |
| 126 / 127 | command not executable / not found | ENTRYPOINT path, missing binary, wrong architecture |
| 137 | SIGKILL (128 + 9) | `docker inspect` for `OOMKilled`; or killed after the stop timeout |
| 139 | segfault (128 + 11) | native library, architecture mismatch |
| 143 | SIGTERM (128 + 15) | normal result of `docker stop` |

`exec format error` in the logs means the image was built for a different CPU architecture (arm64 vs amd64).

**Example:**
```bash
docker ps -a --format '{{.Names}}  {{.Status}}'
docker inspect -f '{{.State.ExitCode}} oom={{.State.OOMKilled}}' api
```
Output: `api  Exited (137) 3 minutes ago` and `137 oom=true`.

**What happens, step by step:**
1. 137 = 128 + 9: the process died from signal 9 (SIGKILL).
2. `OOMKilled=true` tells you the sender was the kernel's out-of-memory killer, not `docker stop`.
3. So the action is a memory fix (Q32). If `oom=false` and the stop was slow, the SIGTERM wasn't handled and the grace period ended (Q30).

**Common mistake → fix:** treating every non-zero code as "app bug". 143 after a deploy is normal, and 137 with `oom=false` points to shutdown handling. Fix: read the code first, then logs.

**Interview answer:** "Exit 0 is clean, 1 is an application error, 127 is command not found, 137 is SIGKILL which I check against OOMKilled, 139 is a segfault, and 143 is SIGTERM. Codes above 128 are 128 plus the signal number. An exec format error means a CPU architecture mismatch."

**Follow-ups:**
- *Exit code 125?* The Docker daemon itself failed to run the container (for example a bad flag).

---

### Q34. What is PID 1, and why use an init process?

**Short answer:** The first process in a container is **PID 1**. Linux treats PID 1 specially: it has **no default signal handlers** (SIGTERM does nothing unless your code handles it) and it must **reap zombie processes** (finished child processes that nobody collected). An ordinary app often does neither. A tiny **init** process such as `tini` (`docker run --init`, ECS `initProcessEnabled`) runs as PID 1, forwards signals to your app and reaps zombies.

**How it works:**
- Without an init, a Python app running as PID 1 that doesn't install a SIGTERM handler ignores `docker stop` until SIGKILL.
- Apps that spawn subprocesses (shell scripts, headless browsers) leave zombies behind if PID 1 never waits on them; they fill the process table over time.
- With an init: PID 1 = `tini`, child = your app. SIGTERM goes to `tini`, which passes it on.

**Example:**
```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python", "worker.py"]
```
or simply `docker run --init api:1.4.0`.

**What happens, step by step:**
1. `tini` starts as PID 1 and launches `python worker.py` as its child.
2. `docker stop` sends SIGTERM to `tini`; `tini` forwards it to Python. If Python handles it, the worker shuts down cleanly.
3. If the worker had spawned `chromium` for screenshots and those children exit, `tini` collects their exit status, so no zombies pile up.

**Common mistake → fix:** a shell script as ENTRYPOINT that starts the app without `exec`: the script stays PID 1 and swallows signals. Fix: end the script with `exec "$@"` so the app replaces the shell, or add an init.

**Interview answer:** "PID 1 in a container doesn't get default signal handling and must reap zombies. If my app is PID 1 in exec form and handles SIGTERM, that's fine; otherwise I use a small init like tini via docker run --init or ECS initProcessEnabled, which forwards signals and reaps children."

**Follow-ups:**
- *Do all images need tini?* No, only when the app doesn't handle signals or spawns child processes.

---

## 6. Security & supply chain

### Q35. Container security layers

**Short answer:** Container security is **defence in depth**: protect every stage, because no single control is enough. At **build**: minimal pinned base, no secrets in layers, scanning, SBOM and signing. In the **registry**: private repository, immutable tags, scan on push, only CI can push. At **deploy**: verify signatures and digests, least-privilege roles, secrets from a secrets manager. At **runtime**: non-root, read-only filesystem, dropped capabilities, no privileged mode, no `docker.sock`, resource limits, private networking and monitoring.

**How it works:**

| Stage | Controls |
|---|---|
| Build | minimal pinned base; secret mounts; scan (Trivy or Inspector); SBOM; sign (Cosign) |
| Registry | private ECR; tag immutability; scan on push; lifecycle policy; push only from CI |
| Deploy | verify signature and digest; task role with least privilege; secrets injected at start |
| Runtime | non-root user; read-only root filesystem; drop capabilities; no `--privileged`; seccomp default profile; CPU and memory limits; security groups; runtime threat detection (for example GuardDuty) |

**Example (hardened run):**
```bash
docker run -d --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges \
  --user 10001 --memory 512m --pids-limit 200 api@sha256:ab12...
```

**What happens, step by step:**
1. The image was built from a pinned slim base with no secrets and was scanned; the digest is what we run.
2. `--user 10001` and `--cap-drop ALL` remove root and capabilities; `no-new-privileges` stops privilege escalation through setuid binaries.
3. `--read-only` plus a tmpfs for `/tmp` means an attacker who gets code execution can't modify the system or persist files.
4. `--pids-limit` and `--memory` blunt fork bombs and memory exhaustion.

**Common mistake → fix:** focusing only on image scanning. A clean image run as root with docker.sock mounted is still a weak setup. Fix: treat the four stages as one checklist.

**Interview answer:** "I layer controls across build, registry, deploy and runtime: pinned minimal images with scanning and signing, private immutable registries, signature verification and least-privilege roles at deploy, and at runtime non-root, read-only filesystem, dropped capabilities, resource limits and network isolation."

**Follow-ups:**
- *Rootless Docker?* Runs the daemon and containers without root on the host, so a container escape lands as an unprivileged user.

---

### Q36. Why never mount `/var/run/docker.sock` or use `--privileged`?

**Short answer:** The Docker socket is the daemon's API. Anything that can talk to it can start a new container with the host's filesystem mounted, which is **root on the host**. `--privileged` switches off most container isolation (all capabilities, access to host devices). Either turns a container compromise into a host compromise.

**How it works:**
1. A container with `/var/run/docker.sock` mounted can run `docker run -v /:/host ...`.
2. The new container sees the host's whole disk under `/host` and can read or modify anything, including other containers' secrets and SSH keys.
3. `--privileged` gives the container nearly everything root on the host has.

**Example:** a CI job mounts the socket "to build images".
```bash
docker run -v /var/run/docker.sock:/var/run/docker.sock ci-image docker build .
```

```flow
pipeline: Why mounting the Docker socket equals root on the host
Container has the docker.sock mounted > It can send any command to the host's Docker daemon.
It starts a new container with the host root mounted > docker run -v /:/host alpine, started through the socket.
Inside that container, chroot /host > The attacker now sees and can change every file on the host.
Result > Full host compromise from a single compromised build job or app.
```

**What happens, step by step:**
1. A malicious dependency runs inside the CI container.
2. It calls the mounted socket: `docker run --rm -v /:/host alpine cat /host/etc/shadow`.
3. The daemon, running as root, happily mounts the host's `/`, so the password hashes print.
4. The attacker could just as well read the runner's cloud credentials or plant a backdoor.

**Common mistake → fix:** "Docker-in-Docker is the only way to build images in CI". Fix: use rootless builders (BuildKit rootless, Buildah, Kaniko-style tools) and isolated ephemeral runners; if a daemon is unavoidable, run it in a throwaway VM, not on shared hosts.

**Interview answer:** "The Docker socket lets a container create new containers with the host filesystem mounted, which is root on the host, and --privileged removes most isolation. I never use either in production, and for CI image builds I use rootless builders on ephemeral runners."

**Follow-ups:**
- *Read-only socket mount?* Doesn't help: read-only applies to the socket file, not the API calls through it.

---

### Q37. Secrets: what not to do, and what to do instead

**Short answer:** Anything you put into an image layer, `ENV`, `ARG`, label or `COPY`'d file can be read by anyone who can pull or inspect the image. **Don't:** `ENV API_KEY=...`, `COPY .env .`, `ARG TOKEN` used in `RUN`. **Do:** BuildKit secret mounts for build-time secrets (Q19), and for runtime, inject secrets when the container starts (ECS `secrets` from Secrets Manager or SSM, or the app fetching them using its task role).

**How it works:** image layers are permanent and shareable. `docker history` shows commands and build args; `docker save` exposes every layer's files. A secret deleted in a later layer still exists in the earlier one.

**Example:**
```dockerfile
# Wrong
ARG GITHUB_TOKEN
RUN git clone https://$GITHUB_TOKEN@github.com/org/private.git

# Right
RUN --mount=type=secret,id=github_token \
    git clone https://$(cat /run/secrets/github_token)@github.com/org/private.git
```
```bash
docker build --secret id=github_token,env=GITHUB_TOKEN -t app:1.0 .
docker history --no-trunc app:1.0     # first Dockerfile would print the token here
```

**What happens, step by step:**
1. Wrong version: the token is part of the command line stored in the layer history. Anyone with the image runs `docker history` and copies it.
2. Right version: BuildKit mounts the secret at `/run/secrets/github_token` for this one step only and discards it afterwards.
3. `docker history` shows the command text with `$(cat ...)` but no token, and the layer files don't contain it.
4. At runtime, the application's secrets arrive as environment variables or files from Secrets Manager, never from the image.

**Common mistake → fix:** deleting the secret in a later `RUN rm .env`. The file is still in the earlier layer. Fix: never write it into a layer at all (secret mount), and rotate any secret that was baked into a pushed image.

**Interview answer:** "Secrets don't go in ENV, ARG, labels or copied files, because layers and history are readable. For build secrets I use BuildKit secret mounts, which exist only for one step; for runtime I inject from Secrets Manager or SSM at task start. If a secret was ever baked into a pushed image, I rotate it."

**Follow-ups:**
- *Is an environment variable at runtime safe enough?* It's visible to the process and to `docker inspect` for admins; for higher sensitivity, fetch at startup into memory using the task role.

---

### Q38. SBOM, scanning and signing

**Short answer:** Three controls that answer "what is in this image, is it vulnerable, and did we build it?". An **SBOM** (software bill of materials) lists every package in the image, so you can answer "are we affected by CVE-X?" in minutes. **Scanning** (Trivy, Grype, ECR enhanced scanning with Inspector) compares those packages with known vulnerabilities. **Signing** (Cosign/Sigstore, AWS Signer) proves the image came from your pipeline; deploys then **verify** the signature.

**How it works:**
1. Build the image in CI from pinned inputs; generate an SBOM (Syft, or BuildKit's `--sbom=true`).
2. Scan; fail the pipeline on critical or high findings that have a fix available.
3. Sign the image digest, and optionally attach provenance (how and where it was built).
4. At deploy time, a policy checks the signature and refuses unsigned or unscanned images.

**Example:**
```bash
docker buildx build --sbom=true --provenance=mode=max -t $IMG --push .
trivy image --severity CRITICAL,HIGH --exit-code 1 --ignore-unfixed $IMG
cosign sign --yes $IMG@$DIGEST
cosign verify $IMG@$DIGEST --certificate-identity-regexp '.*' --certificate-oidc-issuer https://gitlab.example.com
```
(In production, pin the certificate identity to your project and branch rather than a wildcard.)

```flow
pipeline: Supply-chain checks for an image
Build in CI > Pinned inputs produce the image and its digest.
Generate an SBOM > Every package in the image is listed.
Scan > Known vulnerabilities are matched. Critical findings that have a fix fail the pipeline.
Sign > The digest is signed, so the registry holds proof of where the image came from.
Verify at deploy > Only signed, scanned images are allowed to run.
```

**What happens, step by step:**
1. The build pushes `api@sha256:ab12…` with an SBOM attestation listing 214 packages.
2. Trivy finds `openssl 3.0.11` with a critical CVE fixed in `3.0.13`. With `--exit-code 1` the pipeline fails.
3. You rebuild on a patched base image; the scan passes; Cosign signs the digest.
4. Deploy verifies the signature. An image pushed by hand, without the pipeline's identity, fails verification and does not run.

**Common mistake → fix:** scanning once at build and never again. New CVEs are published daily against images that are already deployed. Fix: scheduled rescans (ECR continuous scanning) and regular rebuilds.

**Interview answer:** "I generate an SBOM for every image, scan for known CVEs and fail on fixable critical ones, sign the digest keylessly, and verify the signature at deploy time. Continuous rescans catch vulnerabilities published after the build, and the SBOM lets me answer which services are affected by a new CVE."

**Follow-ups:**
- *SBOM formats?* SPDX and CycloneDX.

---

### Q39. Why not use the `latest` tag?

**Short answer:** `latest` is just the tag Docker uses when you don't give one; it carries no promise of being newest or stable. It is **mutable**, so what it points to changes without any change in your config. You can't tell what is running, rollbacks have no fixed target, and different machines may hold different versions. Use immutable identifiers: commit-SHA tags and digests, and enable tag immutability in ECR.

**How it works:** a tag is a pointer from a name to a digest. Pushing again moves the pointer. Nodes cache images, so nodes that pulled `latest` last week keep the old one, while a node created today pulls the new one.

**Example:** an ECS service references `api:latest`.

```flow
trace: How latest causes a mixed fleet
Tuesday: deploy api:latest > The tag points to digest sha256:**aa11**. All tasks run aa11.
Wednesday: CI pushes a new build as latest > The tag now points to sha256:**bb22**. Running tasks are unchanged.
a task crashes and ECS starts a replacement > The replacement pulls latest and gets **bb22**.
the fleet now runs two versions side by side > The bb22 build was never deployed deliberately or tested together with aa11 tasks.
fix: deploy api@sha256:aa11, or tag api:3f2a9c1 with ECR tag immutability > Every task runs the same, known image, and rollback means pointing back at it.
```

**What happens, step by step:**
1. On Tuesday all three tasks pull and run `aa11`.
2. On Wednesday CI pushes a new image under `latest`. Nothing restarts, so tasks stay on `aa11`.
3. One task fails a health check; its replacement pulls `latest` and runs `bb22`.
4. Now behaviour differs between requests depending on which task answers, and logs can't tell you which version produced a bug.
5. With digests, step 3 would have started `aa11` again.

**Common mistake → fix:** pushing `latest` plus a version tag and deploying `latest` anyway. Fix: deploy by digest or SHA tag; if you want a `latest` for convenience, never reference it from production config.

**Interview answer:** "latest is a mutable default tag, so it can silently change what's running and makes rollback ambiguous. I tag with the commit SHA, deploy by digest, and turn on ECR tag immutability, so every task runs the identical, known image."

**Follow-ups:**
- *Does Kubernetes `imagePullPolicy` matter here?* Yes: `Always` re-pulls the tag on each pod start; with digests the policy doesn't matter.

---

### Q40. How do you build secure images for an offline or air-gapped environment?

**Short answer:** An air-gapped environment has no internet access. So every input must come from **internal mirrors**: base images in an internal registry, packages from an internal package proxy, everything pinned by digest or version. Build with no internet, scan and sign internally, move artifacts across the boundary through an approved channel, and verify signatures on arrival.

**How it works:**
1. Mirror base images into an internal registry (ECR pull-through cache, Harbor, Artifactory) and packages into an internal repository (CodeArtifact, Nexus, a PyPI mirror).
2. Pin everything by digest and lockfile, vendor wheels if needed.
3. Build with the network off for steps that should not fetch anything (`RUN --network=none`).
4. Scan, produce an SBOM, and sign. Export with `docker save` or `skopeo copy`, transfer, then verify signatures and digests on the other side.

**Example:**
```dockerfile
# syntax=docker/dockerfile:1
FROM registry.internal.example.com/base/python@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
COPY wheels/ /wheels/
RUN --network=none pip install --no-index --find-links=/wheels -r requirements.txt
```
(The digest shown is a placeholder.)

**What happens, step by step:**
1. The base comes from the internal registry by digest, a previously approved copy.
2. Wheels were downloaded and scanned on a connected staging system and copied into `wheels/`.
3. `--network=none` guarantees the install step cannot fetch anything: if a dependency is missing, the build fails instead of quietly reaching out.
4. The finished image is scanned, signed and exported; on the other side the signature is verified before it is loaded into the production registry.

**Common mistake → fix:** a `RUN pip install` without `--no-index` in an offline build: it hangs on network timeouts or fails confusingly. Fix: `--network=none` plus `--no-index` so failures are immediate and explicit.

**Interview answer:** "Mirror every input internally, base images and packages, pin by digest and lockfile, build with the network disabled, scan and sign internally, transfer through an approved channel and verify signatures on arrival. The network-none build step proves nothing is being fetched implicitly."

**Follow-ups:**
- *How do you get security patches?* Through a scheduled import pipeline on a connected system that refreshes mirrors after scanning.

---

## 7. Scenario & debugging questions

### Q41. A container crash-loops. How do you debug it?

**Short answer:** A crash loop means the main process keeps exiting and the platform keeps restarting it. Find out **how** it exits (exit code, OOM), **what it said** (logs), then reproduce it interactively and check the environment.

**Steps to diagnose:**
1. **Read the logs:** `docker logs --tail 50 <c>` (or CloudWatch). Look for a stack trace or message at startup: missing env var, cannot connect to DB, port in use.
2. **Check the exit state:** `docker inspect -f '{{.State.ExitCode}} {{.State.OOMKilled}}' <c>`. The code tells you the class of problem (Q33): 1 = app error, 127 = command not found, 137 with `OOMKilled=true` = out of memory, `exec format error` in logs = wrong architecture.
3. **Run it interactively:** `docker run --rm -it --entrypoint sh <image>`, then start the app by hand and watch it fail. (A restarting container can't be exec'd into reliably.)
4. **Check the environment:** are all required env vars and secrets present (`env`)? Do config files exist at the expected paths? Can the non-root user write where the app writes? Is the database hostname resolvable and reachable (`getent hosts db`)?
5. **Check recent change:** compare the image digest with the last working one; a bad dependency or base image update is a frequent cause.

**Example:** `docker ps -a` shows `Restarting (1) 5 seconds ago`. Logs end with `KeyError: 'DB_PASSWORD'`.

**Fix:** the secret wasn't injected after a rename in the task definition (`DB_PASS` vs `DB_PASSWORD`). Correct the name, redeploy; the app starts and stays up.

**Common mistake → fix:** adding `--restart always` to "fix" the crashes. It only hides them behind a loop. Fix: find the exit cause and make the app fail loudly with a clear message.

**Interview answer:** "I check the logs first, then exit code and OOMKilled from inspect, decode the code, and reproduce it by running the image with a shell entrypoint. Then I verify the environment: env vars and secrets, file permissions for the non-root user, and reachability of dependencies. Finally I compare against the last known good image."

**Follow-ups:**
- *Exit 0 but keeps restarting?* The process finished normally (a one-shot command); a long-running service must stay in the foreground.

---

### Q42. Works locally but ECS fails with `CannotPullContainerError`

**Short answer:** The ECS agent couldn't download the image. Check, in order: does the image reference exist, can the task's **execution role** read from ECR, can the task's subnet **reach** ECR, and does the image architecture match the task.

**Steps to diagnose:**
1. **Image reference:** does `account.dkr.ecr.region.amazonaws.com/repo:tag` exist in that region and account? `aws ecr describe-images --repository-name api --image-ids imageTag=3f2a9c1`. Typos, deleted tags (lifecycle policy!), wrong region.
2. **Execution role permissions:** it needs `ecr:GetAuthorizationToken`, `ecr:BatchGetImage` and `ecr:GetDownloadUrlForLayer` (the managed `AmazonECSTaskExecutionRolePolicy` has them). For cross-account images, the repository policy must allow the role.
3. **Network path:** a task in a private subnet needs a NAT gateway, or VPC endpoints for `ecr.api` and `ecr.dkr`, **plus an S3 gateway endpoint** (image layers are stored in S3) and a CloudWatch Logs endpoint if logging.
4. **Architecture:** an arm64 image on an x86 task (or the reverse) typically pulls but fails to start; see `exec format error`.
5. **Docker Hub rate limits** for public images: pull through ECR's pull-through cache.

**Example:** the error is `CannotPullContainerError: ... dial tcp ...: i/o timeout` for a task in a private subnet.

**What it means:** a timeout (not "access denied", not "not found") points to the network path: no NAT or endpoint. Adding the three endpoints (ecr.api, ecr.dkr, S3 gateway) fixes it.

**Common mistake → fix:** granting `ecr:*` to the *task role*. Image pulls use the **execution role**, not the task role. Fix: put pull permissions on the execution role.

**Interview answer:** "I read the exact error: not found means a wrong reference or tag; access denied means the execution role or repository policy; a timeout means no network path, so I check NAT or ECR and S3 endpoints in the private subnet. Then I check architecture mismatch. The execution role pulls the image, not the task role."

**Follow-ups:**
- *Why S3 endpoint for ECR?* Image layers are served from S3.

---

### Q43. The ECS task stops after about 30 seconds as "unhealthy"

**Short answer:** The load balancer (or ECS) health check is failing, so the task is killed and replaced, repeatedly. The causes are usually: the app is bound to `127.0.0.1`, the wrong port or path, a slow startup, a missing health-check tool in the image, a blocked security group, or a dependency making `/health` fail.

**Steps to diagnose:**
1. **Which check failed?** ECS service events say `(service api) ... failed ELB health checks` (target group) or the task stop reason says `Task failed container health checks`.
2. **Port and path:** the target group's port and path must match the container (`/health` exists and returns 200, not a redirect or 404). Test from inside: `curl -i localhost:8000/health`.
3. **Bind address:** the app must listen on `0.0.0.0`, not `127.0.0.1` (Q09).
4. **Startup time:** the app takes 45 seconds to start but checks begin at 10. Add `healthCheckGracePeriodSeconds` (service) and `startPeriod` (container health check).
5. **Health-check command exists:** a container health check running `curl` fails forever if `curl` isn't installed in the slim or distroless image.
6. **Security group:** the load balancer's security group must be allowed to reach the task's port.
7. **Dependency coupling:** if `/health` checks the database and the database is down, every task fails and gets killed together. Keep liveness cheap.

```flow
pipeline: Checking an unhealthy ECS task
Which health check failed? > The service events and the task stop reason tell you whether the load balancer or the container check failed.
Does the path respond on that port? > Run curl against /health from inside the container. It must return 200.
Is the app listening on 0.0.0.0? > A server bound to 127.0.0.1 is unreachable from the load balancer.
Is the grace period long enough? > Startup time must be shorter than the grace period plus the retries.
Does /health depend on downstream services? > Remove those dependencies from the liveness check.
```

**Example:** events show the target failing with `Health checks failed with these codes: [404]`. The app serves `/healthz`, but the target group checks `/health`. Fixing the path to `/healthz` makes it pass.

**Common mistake → fix:** raising the unhealthy threshold or interval to make the error go away. The root cause stays. Fix: find the specific cause with the steps above.

**Interview answer:** "I read which check failed, then verify the path and port by curling from inside the container, confirm the app binds 0.0.0.0, compare startup time against the grace and start periods, make sure the check tool exists in the image, check security groups, and keep liveness independent of dependencies."

**Follow-ups:**
- *Why does a short grace period loop forever?* The task is killed before it ever becomes healthy, so the replacement hits the same timing and is killed too.

---

### Q44. Docker builds are slow in CI

**Short answer:** In CI each job often starts on a fresh machine with an empty local cache, so every build starts from scratch. Fix it by making the cache **portable** (store layers in the registry), ordering the Dockerfile for cache reuse, shrinking the build context, and building natively for the target architecture.

**Steps to diagnose:**
1. **Read the build output:** which steps say `CACHED` and which run? Time each long step.
2. **Is the cache available?** If every build re-pulls the base image and reinstalls dependencies, the cache isn't shared between runners.
3. **Is the layer order right?** Dependencies before source (Q05).
4. **How big is the context?** `transferring context: 1.2GB` means a missing `.dockerignore` (Q10).
5. **Emulation?** Building arm64 on x86 runners with QEMU can be 5 to 10 times slower.

**Fix (examples):**
```bash
docker buildx build \
  --cache-from type=registry,ref=registry.example.com/api:buildcache \
  --cache-to   type=registry,ref=registry.example.com/api:buildcache,mode=max \
  -t registry.example.com/api:$CI_COMMIT_SHA --push .
```
- Registry cache: layers pulled from the registry on the next runner, so `pip install` shows `CACHED`.
- Cache mounts for package managers (they only help when the builder persists; with fresh runners rely on the registry cache).
- `.dockerignore` for a small context; native ARM runners for arm64 images.

**What happens:** before, a build took 7 minutes (3 for dependencies, 2 for context upload, 2 for the rest); after, 1.5 minutes: cached dependencies, 3 MB context and unchanged layers skipped (illustrative numbers).

**Common mistake → fix:** `--no-cache` in CI "to be safe". Every build then pays full price. Fix: use the cache, and invalidate deliberately by changing lockfiles or by a scheduled clean rebuild to pick up OS patches.

**Interview answer:** "I check which steps are cached, then fix the biggest cost: a shared registry-backed cache for ephemeral runners, dependencies before source in the Dockerfile, a small build context through dockerignore, cache mounts for package managers, and native builders instead of emulation. I avoid no-cache and instead schedule a clean rebuild for patches."

**Follow-ups:**
- *`mode=max`?* Exports cache for all layers, including intermediate stages, not just the final image's layers.

---

### Q45. The image is 2.5 GB. How do you shrink it?

**Short answer:** Find where the size is, then remove it: build tools left in the final image, package caches, large copied data, and an oversized base. Use `docker history` or `dive` to see the biggest layers.

**Steps to diagnose and fix:**
1. **Inspect layers:** `docker history --no-trunc --format '{{.Size}}\t{{.CreatedBy}}' api:1.4.0 | sort -h | tail`. The biggest lines are your targets.
2. **Build tools and compilers** in the final image → multi-stage build (Q17).
3. **Heavy libraries you don't need:** a GPU build of PyTorch (about 2 GB with CUDA) on a CPU-only service → install the CPU wheels.
4. **Caches** left in layers (`pip` cache, `apt` lists) → `--no-cache-dir`, cleanup in the same `RUN`, or cache mounts.
5. **Data and history copied in:** `.git`, datasets, model files → `.dockerignore`; download models at startup or mount them.
6. **Base image:** a full `python:3.13` (about 1 GB) → `-slim` or distroless.

```flow
pipeline: From 2.5 GB to a small image
Inspect layers with docker history > Find the few layers that make up most of the size.
Multi-stage build > Compilers, headers and caches stay in the builder stage.
Slim base image > Replace the full OS image with a slim variant.
Right-sized dependencies > CPU wheels instead of CUDA builds when no GPU is used.
Move data out > Models and datasets are mounted or downloaded at startup, not baked in.
```

**Example:** `docker history` shows a 1.9 GB layer from `pip install torch` (CUDA build) and a 600 MB layer from `COPY . .` that includes a local `data/` folder. Switching to the CPU wheel index and ignoring `data/` brings the image to about 700 MB (illustrative).

**Common mistake → fix:** adding `RUN rm -rf /data` after `COPY . .`. The earlier layer still stores the data, so the image doesn't shrink. Fix: don't copy it (`.dockerignore`) or use a multi-stage build.

**Interview answer:** "I look at docker history or dive to find the large layers, then fix the cause: multi-stage builds to drop build tools, a slim base, CPU-only wheels where there's no GPU, cleanup in the same RUN, dockerignore for data and .git, and models downloaded at runtime instead of baked in."

**Follow-ups:**
- *Does small size matter beyond downloads?* Yes: faster pulls on scale-out, faster deploys, and a smaller attack surface.

---

### Q46. A container gets OOM-killed under load. What do you do?

**Short answer:** The container exceeded its memory limit and the kernel killed it (exit 137, `OOMKilled=true`). Confirm it, find what uses memory per request or per worker, then reduce usage or raise the limit, and add protection so load can't exceed capacity.

**Steps to diagnose:**
1. **Confirm:** `docker inspect -f '{{.State.OOMKilled}} {{.State.ExitCode}}' <c>` or ECS stop reason `OutOfMemoryError: Container killed due to memory usage`. A memory graph that climbs with traffic confirms it.
2. **Memory per worker:** processes × memory each. Four workers at 300 MB is 1.2 GB; a 1 GB limit will fail under full load.
3. **Memory per request:** are large uploads or query results loaded whole into memory?
4. **Leak or growth:** does memory keep growing even at constant load? Unbounded caches, global lists, unclosed resources.
5. **Fix:** stream large payloads, bound caches (max size or TTL), reduce workers per container or add containers, raise the limit based on measured peak plus headroom.
6. **Protect:** limit concurrency or queue (backpressure), return 429/503 instead of accepting unlimited work, set alarms on memory utilisation.

```flow
pipeline: OOM-killed under load
Confirm the kill > Exit code 137 with OOMKilled true, and memory rising with traffic in the graph.
Measure memory per worker and per request > Multiply by concurrency to compare with the limit.
Reduce usage > Stream large files, bound caches, use fewer workers per task.
Right-size the limit > Use measured peak plus headroom, not the average.
Add backpressure > Cap concurrency so a traffic spike cannot exceed capacity.
```

**Example:** 4 uvicorn workers, each peaking at 280 MB when a 50 MB CSV is parsed in memory. Peak demand is about 1.1 GB against a 1 GB limit. Streaming the CSV in chunks drops each worker to about 120 MB (480 MB total), and a 2 GB limit adds headroom (illustrative numbers).

**Common mistake → fix:** only raising the limit each time it happens. The leak or unbounded request eventually exceeds any limit. Fix: find the cause first, then size.

**Interview answer:** "I confirm the OOM kill via exit 137 and OOMKilled, then measure memory per worker and per request. I fix the cause by streaming large data, bounding caches and reducing workers per container, size the limit from measured peak plus headroom, and add concurrency limits and memory alarms so spikes degrade gracefully instead of killing the container."

**Follow-ups:**
- *Why not swap?* Swap hides memory pressure and makes latency unpredictable; containers on Fargate don't use it.

---

## 8. Cheat sheet

| Concept | Remember |
|---|---|
| Container | a process with namespaces (see), cgroups (use) and a layered filesystem; shares the host kernel |
| Image vs container | immutable template vs running instance with a writable layer |
| Client / daemon | `docker` CLI talks to `dockerd`, which uses containerd and runc |
| Tag vs digest | movable label vs immutable content hash; deploy by digest |
| Layers and cache | a change rebuilds all later layers; dependencies before source |
| `.dockerignore` | smaller context, better cache, no secrets or `.git` |
| ENTRYPOINT vs CMD | executable vs default args; always exec form |
| ARG vs ENV | build-time vs runtime; neither is for secrets |
| Multi-stage | build tools in the builder, only results in the final image |
| BuildKit | cache mounts, secret mounts, multi-platform |
| Base image | pinned slim by default; distroless for minimal; Alpine rarely for Python |
| Ports | EXPOSE is documentation; `-p` publishes; bind `0.0.0.0` |
| Networking | user-defined bridge: DNS by name; ECS awsvpc: ENI per task |
| Storage | volume (persistent), bind mount (dev), tmpfs (memory); containers are ephemeral |
| Compose | multi-container dev; `depends_on` with `service_healthy` |
| Logs | stdout/stderr, unbuffered; configure rotation |
| SIGTERM | PID 1 must handle it; then SIGKILL after 10 s (Docker) or 30 s (ECS default) |
| PID 1 | no default signal handlers, reaps zombies; use exec form or `--init` |
| Health checks | Dockerfile HEALTHCHECK is ignored by ECS; ALB and ECS checks act |
| Limits | memory is hard (OOM, 137); CPU throttles |
| Exit codes | 0 clean, 1 app, 127 not found, 137 SIGKILL/OOM, 139 segfault, 143 SIGTERM |
| Security | non-root, read-only FS, drop capabilities, never docker.sock or privileged |
| Secrets | not in ENV/ARG/layers; BuildKit secret mounts; inject at runtime |
| Supply chain | pin, scan, SBOM, sign, verify, immutable tags |
| `latest` | mutable; use SHA tags and digests |

## Official references

- https://docs.docker.com/get-started/docker-overview/
- Dockerfile reference: https://docs.docker.com/reference/dockerfile/
- Build best practices: https://docs.docker.com/build/building/best-practices/
- BuildKit secrets: https://docs.docker.com/build/building/secrets/
- Build cache backends: https://docs.docker.com/build/cache/backends/
- Compose file reference: https://docs.docker.com/reference/compose-file/
- `docker stop` reference: https://docs.docker.com/reference/cli/docker/container/stop/
- Amazon ECR: https://docs.aws.amazon.com/AmazonECR/latest/userguide/what-is-ecr.html
- Amazon ECS task definition parameters: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html
