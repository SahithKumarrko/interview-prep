# Comprehensive Interview Handbook

**Updated:** 25 October 2026 · **928 questions** across 22 subjects · basics → advanced → production scenarios

This is an engineering-focused interview preparation bank for the listed tech stack, checked against current official documentation (React 19.2, Vite 8, LangChain/LangGraph v1, MCP spec 2026-07-28, current AgentCore services, Terraform 1.x/AWS provider v6).

> These markdown files are the source for the web app in the repository root (`index.html`). After editing them, run `python tools/build_data.py` to refresh `data/`.

## How each file is organised

Every file has the same structure:

1. **Mental model** — a diagram and plain-language explanation of how the technology works *before* any questions.
2. **Sections from basics to advanced**, each question with:
   - **Short answer** — what you say in the first 30 seconds.
   - **Explanation / Example** — intuition, diagrams, runnable code or config.
   - **Pitfall / Follow-up** — what interviewers push on next.
3. **Scenario & debugging questions** — real production problems, answered step by step.
4. **Cheat sheet** — one-line revision table.
5. **Official references** — the authoritative docs.

## Study files

| # | Subject | Questions | Highlights |
|---|---|---|---|
| 01 | [Python](01_Python.md) | 52 | memory model, OOP/MRO, decorators, generators, asyncio vs threads vs processes, GIL & free-threading, testing, production patterns |
| 02 | [React.js](02_React.md) | 46 | render/commit, hooks in depth, React 19 Actions/`useOptimistic`/`use`, 19.2 `<Activity>`/`useEffectEvent`, React Compiler, streaming UI, XSS, React + TypeScript |
| 03 | [Vite.js](03_Vite.md) | 32 | dev server vs build, Vite 8 + Rolldown, env vars, proxy vs CORS, S3+CloudFront deployment, cache-safe releases |
| 04 | [Generative AI](04_Generative_AI.md) | 55 | transformers, tokens, decoding, KV cache, reasoning models, RAG architecture, chunking, hybrid search, LoRA, evaluation, Bedrock, security |
| 05 | [Agentic AI](05_Agentic_AI.md) | 49 | agent loop, workflow vs agent patterns, tool design, HITL, memory, **MCP (2026 stateless spec)**, A2A, Agent Skills, threat model, frameworks (Strands, CrewAI, OpenAI Agents SDK…) |
| 06 | [LangChain](06_LangChain.md) | 36 | v1 `create_agent`, middleware hooks, HITL middleware, structured output strategies, LCEL, RAG, MCP adapters |
| 07 | [LangGraph](07_LangGraph.md) | 44 | super-steps & reducers, checkpointers, durability modes, `interrupt`/`Command`, `Send`, subgraphs, multi-agent, functional API |
| 08 | [Amazon Bedrock AgentCore](08_AWS_AgentCore.md) | 52 | Harness, Runtime (sessions, contract, Instances), Gateway, Identity (2LO/3LO), Memory strategies, Policy (Cedar), Evaluations, Optimization, Registry |
| 09 | [GitLab CI/CD](09_GitLab_CICD.md) | 46 | runners, rules, `needs`, components & catalog, OIDC to AWS, Terraform pipelines, supply-chain security, Git (merge vs rebase, branching, undo) |
| 10 | [Docker](10_Docker.md) | 39 | namespaces/cgroups, layers & cache, multi-stage, BuildKit secrets, SIGTERM, health checks, exit codes, security |
| 11 | [Terraform](11_Terraform.md) | 41 | state & S3 native locking, `for_each`, lifecycle, `moved`/`removed`/`import`, ephemeral & write-only secrets, `terraform test` |
| 12 | [AWS Foundations, IAM & Networking](12_AWS_Foundations.md) | 46 | VPC design, SG vs NACL, endpoints, IAM evaluation logic, KMS envelope encryption, ALB/API GW, SQS/SNS/EventBridge, DR |
| 13 | [Amazon ECS](13_AWS_ECS.md) | 37 | task def/service, Fargate vs Managed Instances vs EC2, task vs execution role, native blue/green/canary, scaling, debugging |
| 14 | [AWS Lambda](14_AWS_Lambda.md) | 41 | execution environment, invocation models, SQS partial batch, concurrency, SnapStart, durable functions, Managed Instances |
| 15 | [AWS Step Functions](15_AWS_Step_Functions.md) | 35 | Standard vs Express, JSONata & variables, `.sync`/task tokens, Distributed Map, sagas, redrive |
| 16 | [AWS Secrets Manager](16_AWS_Secrets_Manager.md) | 31 | staging labels, KMS, cross-account, 4-step rotation, alternating users, ECS/Lambda consumption, agent credentials |
| 17 | [Amazon EC2](17_AWS_EC2.md) | 35 | instance types, EBS vs instance store, IMDSv2, pricing models, ASG, hardening, incident response |
| 18 | [Architecture & System Design](18_System_Design.md) | 48 | design framework, building blocks, **full agentic AI reference architecture**, scenarios, incidents, leadership, classic designs (URL shortener, notifications, chat) |
| 19 | [Python Algorithms & Coding](19_Python_DSA_Coding.md) | 45 | pattern-recognition map + template code for every major pattern, LRU, scale problems, sorting algorithms, bits, grids, strings |
| 20 | [FastAPI & API Design](20_FastAPI_API_Design.md) | 42 | request lifecycle, DI, native SSE, idempotency keys, JWT/IDOR, production on ECS, REST vs GraphQL vs gRPC, SQLAlchemy async + Alembic |
| 21 | [Databases: SQL, PostgreSQL, DynamoDB & caching](21_Databases_SQL_DynamoDB.md) | 41 | joins, window functions, B-tree & composite indexes, EXPLAIN, isolation levels, locking, migrations, DynamoDB key/GSI design, conditional writes, hot partitions, cache-aside |
| 22 | [Design principles & patterns](22_Design_Principles_Patterns.md) | 35 | OOP, SOLID with Python examples, GoF patterns, circuit breaker, saga, outbox, CQRS, event sourcing, monolith vs microservices |

## The end-to-end picture (how the files connect)

```
 React + Vite (02, 03) ── Okta JWT ──► FastAPI on ECS (20, 13, 10) ──► AgentCore Runtime (08)
        │                                   │                              └─ LangGraph agent (07, 06, 05)
        │                                   │                                    └─ Gateway → Lambda tools (14)
        │                                   └─► Step Functions doc pipeline (15) → Textract / Bedrock (04)
        └── S3 + CloudFront                Secrets Manager (16) · IAM/VPC/KMS (12) · EC2 (17)
 Built & shipped by GitLab CI/CD (09) with Terraform (11) · designed & defended in system design (18)
```

## Preparation priorities for senior roles

1. **Own your production design:** draw React/Vite → API/auth → AgentCore/LangGraph → MCP/tools → AWS services, and explain every trust boundary (18 §3).
2. **Explain trade-offs:** ECS vs Lambda vs AgentCore Runtime, Standard vs Express Step Functions, `create_agent` vs custom LangGraph, RAG vs fine-tuning, session isolation vs durable checkpoints.
3. **Debug end to end:** trace IDs, IAM denies, retries and idempotency, stream drops, 429s, timeouts, container health, Terraform drift.
4. **Demonstrate leadership:** assumptions, threat modelling, SLOs, cost model, rollout/rollback, tests and evals, design reviews, mentoring.

## How to practise each question

Give a **60–90 second answer: definition → how it works → example → trade-off**. For scenario questions use: *requirements → architecture → security → data/state → scale/cost → failure handling → monitoring → test/rollout*. Always ask yourself: **what fails, how would I know, and how do I recover?**

## Suggested 10-session plan

| Session | Focus |
|---|---|
| 1 | Python (01) + coding patterns (19) + design principles (22) |
| 2 | React + Vite + frontend security (02, 03) |
| 3 | Generative AI + RAG + evaluation (04) |
| 4 | Agentic AI + LangChain + LangGraph (05, 06, 07) |
| 5 | AgentCore + identity + authorization (08, 16) |
| 6 | Docker + GitLab CI/CD + Terraform (10, 09, 11) |
| 7 | AWS foundations + ECS + EC2 (12, 13, 17) |
| 8 | Lambda + Step Functions + FastAPI + databases (14, 15, 20, 21) |
| 9 | System design scenarios, including failures (18) |
| 10 | Two timed mock interviews: explain your architecture, then live-debug a scenario |

## Limits

Cloud services and frameworks change quickly (AgentCore and MCP especially). The official links at the bottom of each file are authoritative. Don't memorise quotas or prices — say "I'd confirm the current limit in the docs" and focus on architecture and decision rationale.
