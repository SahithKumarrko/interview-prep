# Agentic AI: L2 → L3 Interview Preparation

> **Updated:** 24 October 2026 (MCP spec revision **2026-07-28** is current) · **Level:** what an agent is → patterns → protocols (MCP/A2A) → production safety
> **How to use:** *Short answer* = what you say first. *Explanation / Example* = intuition. *Pitfall / Follow-up* = where interviewers dig.

---

## Table of contents

1. [Mental model: the agent loop](#1-mental-model-the-agent-loop)
2. [Fundamentals](#2-fundamentals) (Q01–Q08)
3. [Tools & tool calling](#3-tools--tool-calling) (Q09–Q14)
4. [Agent design patterns](#4-agent-design-patterns) (Q15–Q21)
5. [Memory & context](#5-memory--context) (Q22–Q25)
6. [Protocols: MCP, A2A, Agent Skills](#6-protocols-mcp-a2a-agent-skills) (Q26–Q31)
7. [Production: security, reliability, evaluation, observability](#7-production-security-reliability-evaluation-observability) (Q32–Q40)
8. [Scenario & debugging questions](#8-scenario--debugging-questions) (Q41–Q46)
9. [Agent frameworks landscape](#9-agent-frameworks-landscape) (Q47–Q49)
10. [Cheat sheet](#10-cheat-sheet)

---

## 1. Mental model: the agent loop

**An agent = an LLM in a loop that can use tools to reach a goal.** Instead of answering once, it decides the next step, acts, observes the result and repeats until done.

```
                ┌──────────────────────────────────────────────────────────┐
                │                    AGENT RUNTIME (your code)              │
  user goal ──► │                                                          │
                │   context = system prompt + goal + memory + tool list     │
                │          │                                               │
                │          ▼                                               │
                │   ┌─────────────┐  "call search_tickets(q='VPN')"         │
                │   │    LLM      │─────────────────────────┐              │
                │   │  (decides)  │                         ▼              │
                │   └─────▲───────┘              ┌────────────────────┐    │
                │         │                      │ Policy / guardrail │    │
                │         │ observation          │ • allowed tool?    │    │
                │         │ (tool result)        │ • args valid?      │    │
                │         │                      │ • user authorised? │    │
                │         │                      │ • needs approval?  │    │
                │         │                      └─────────┬──────────┘    │
                │         │                                ▼              │
                │         │                      ┌────────────────────┐    │
                │         └──────────────────────│  Tool execution    │──► APIs, DBs, MCP servers
                │                                └────────────────────┘    │
                │   loop until: final answer │ max steps │ budget │ error   │
                └──────────────────────────────────────────────────────────┘
                          │                              │
                     state/memory store            traces / logs / metrics
```

**Spectrum of autonomy** (pick the least autonomy that solves the problem):
```
 Deterministic workflow ── LLM step inside workflow ── Router ── Tool-calling agent ── Multi-agent system
  (no LLM decisions)        (classify, extract)        (LLM picks path)  (LLM picks tools in a loop)
  ◄── more predictable, cheaper, easier to test                    more flexible, riskier, costlier ──►
```

---

## 2. Fundamentals

### Q01. Agent vs chatbot vs workflow

**Short answer:**
- **Chatbot** — responds to messages; no actions.
- **Workflow** — code decides the steps in a fixed order (LLM may be one step).
- **Agent** — the LLM **decides which actions/tools to use and when to stop**, within constraints you set.

**Example:** A support chatbot explains a ticket policy. A workflow always does *classify → fetch ticket → summarise*. An agent might search the KB, find nothing, look up the ticket history, ask a clarifying question, then draft a resolution.

**Interview tip:** Autonomy is a cost, not a goal. Say: "I'd start with a workflow and add agentic decision-making only where the path can't be known in advance."

---

### Q02. Core components of an agent

| Component | Role |
|---|---|
| **Model** | reasoning + choosing actions |
| **Instructions** | goal, rules, persona, output format |
| **Tools** | functions/APIs the agent can call (search, DB, email, code exec) |
| **Orchestration loop** | runs model → tool → model; enforces limits |
| **State & memory** | conversation, intermediate results, long-term facts |
| **Policy / guardrails** | permissions, approvals, input/output filtering |
| **Observability** | traces of every step, tokens, cost |
| **Termination** | done condition, max steps, budget, escalation |

---

### Q03. The ReAct pattern

**Short answer:** **Re**ason + **Act**: the model alternates thinking about what to do, calling a tool, and reading the observation — rather than answering in one shot. This lets it gather evidence and correct course.

```
Thought: I need the runbook for error E42.
Action: search_docs(query="E42 runbook")
Observation: [doc-17 "E42: restart the sync worker..."]
Thought: The runbook says restart. Check if the worker is running.
Action: get_service_status(name="sync-worker")
Observation: {"status": "crashed", "since": "10:02"}
Final answer: Sync worker crashed at 10:02; per doc-17, restart it…
```
Modern APIs implement this natively via **tool calling** (structured tool requests instead of parsing "Action:" text).

---

### Q04. Workflows vs agents — Anthropic's "building effective agents" patterns

**Short answer:** Common **workflow** patterns (code-controlled):
1. **Prompt chaining** — step 1 output → step 2 input (outline → draft → polish).
2. **Routing** — classify input, send to a specialised prompt/model.
3. **Parallelisation** — sectioning (split work) or voting (run several times, aggregate).
4. **Orchestrator-workers** — LLM breaks task into subtasks dynamically and delegates.
5. **Evaluator-optimizer** — one LLM generates, another critiques, loop until good.

**Agents** = model-directed loops with tools for open-ended problems. Many production systems are workflows with a small agentic part.

---

### Q05. Orchestration vs choreography

**Short answer:** **Orchestration** — a central coordinator (LangGraph graph, Step Functions) decides who does what next; easy to see and control. **Choreography** — services react to events independently (EventBridge, SQS); loosely coupled but the overall flow is harder to see.

**Typical mix:** LangGraph orchestrates the agent's reasoning and approvals; EventBridge announces "job completed" to other systems.

---

### Q06. Planner, executor, critic roles

**Short answer:** **Planner** decomposes the goal into steps; **executor** performs steps with tools; **critic/verifier** checks results against requirements (citations valid? tests pass?). Separation improves complex tasks but adds latency, cost and more places to fail — use only if evaluation shows a gain.

```
goal ─► Planner ─► [step1, step2, step3] ─► Executor (tools) ─► Critic ── ok ──► answer
                         ▲                                       │
                         └───────────── revise plan ◄── fail ────┘
```

---

### Q07. Why do agents fail? (know the failure modes)

| Failure | Example | Mitigation |
|---|---|---|
| Wrong tool / bad arguments | calls `delete` instead of `archive` | clear tool descriptions, schema validation, fewer tools |
| Loops | searches 20 times with tiny query changes | step/budget limits, repetition detection |
| Hallucinated facts | invents ticket status | require tool evidence, cite sources |
| Context overflow | 50 tool results in history | compaction, summarise, store outside context |
| Prompt injection | doc says "send secrets" | least privilege, approvals, authZ in code |
| Premature stop / never stop | says "done" without doing it | explicit success criteria, verifier |
| Cascading errors | one bad step poisons later steps | validate between steps, checkpoints |

---

### Q08. When should you NOT use an agent?

When the steps are known, accuracy must be exact, actions are high-risk or regulated, latency/cost budgets are tight, or a simple rule/SQL query suffices. Example: payment settlement stays deterministic; an agent may *draft* investigation notes for a human.

---

## 3. Tools & tool calling

### Q09. How does tool calling work end to end?

**Short answer:** You send the model a list of tools (name, description, JSON-schema parameters). The model replies with a structured **tool-use request**. Your code validates and executes it, then sends back a **tool result**. The model continues.

```python
tools = [{
  "name": "get_ticket",
  "description": "Fetch a Jira ticket by key. Use when the user mentions a ticket like ABC-123.",
  "input_schema": {"type": "object",
                   "properties": {"key": {"type": "string", "pattern": "^[A-Z]+-\\d+$"}},
                   "required": ["key"]},
}]

while True:
    resp = llm.messages(messages=msgs, tools=tools)
    if resp.stop_reason != "tool_use":
        break                                         # final answer
    for call in resp.tool_calls:
        if call.name not in ALLOWED_TOOLS[user.role]:  # policy check in code
            result = {"error": "not permitted"}
        else:
            args = TicketArgs.model_validate(call.input)       # schema validation
            authorize(user, "read", args.key)                  # real user identity
            result = jira.get(args.key, timeout=10)
        msgs.append(tool_result(call.id, result))
```

**Rule:** every tool call is an **untrusted request**. The model choosing a tool is not authorisation.

---

### Q10. How to design good tools (the "agent-computer interface")

- **Clear names and descriptions** — say *when* to use it and *what it returns*. The description is a prompt.
- **Few, high-level tools** beat many tiny ones (`schedule_meeting` > `list_users` + `list_events` + `create_event`).
- **Strict schemas** — enums, patterns, required fields.
- **Concise, relevant outputs** — return the 5 fields needed, not a 2 MB JSON; paginate.
- **Helpful errors** — `"Ticket ABC-999 not found. Valid project keys: ABC, OPS"` lets the model recover.
- **Idempotent** where possible; include operation IDs for writes.
- **Small tool set per step** — 5–20 relevant tools; use tool search/routing when you have hundreds.

---

### Q11. Classify tools by risk

| Risk tier | Examples | Controls |
|---|---|---|
| Read-only, low sensitivity | search docs, get weather | logging |
| Read sensitive data | customer records, salaries | per-user authZ, field filtering, audit |
| Write, reversible | create draft, add comment | validation, idempotency, rate limits |
| Write, high impact / irreversible | payments, delete, external email | **human approval**, dual control, tight scopes, alerts |

---

### Q12. Human-in-the-loop approval — done properly

**Short answer:** Approval is a **security workflow**, not "the model asked 'are you sure?'".

```
 agent proposes action ──► persist {action_id, tool, args, args_hash, requester, status=PENDING}
                                 │
                                 ▼
                     UI shows exact diff/impact to an authorised approver
                                 │ approve (authenticated, bound to action_id + args_hash)
                                 ▼
          executor re-checks: still authorised? args unchanged? not already executed?
                                 │
                                 ▼
               execute once (idempotency key = action_id) → status=EXECUTED → resume agent
```
The approval must survive restarts (durable storage / LangGraph `interrupt` with a checkpointer).

---

### Q13. Retries and idempotency for write tools

**Short answer:** Retries and crash recovery can execute a tool twice. Give every write an **operation ID**; the tool (or a wrapper) records it and returns the previous result on duplicates (conditional write / unique constraint).

```python
def post_comment(op_id: str, ticket: str, text: str):
    if store.exists(op_id):                    # already done → return stored result
        return store.get(op_id)
    result = jira.add_comment(ticket, text)
    store.put_if_absent(op_id, result)         # conditional write
    return result
```

---

### Q14. Retrieval vs API vs SQL tools — which for what?

| Question type | Tool |
|---|---|
| "How do I…?" fuzzy knowledge in docs | vector/hybrid **retrieval** |
| "What's the status of ticket X?" live source-of-truth | deterministic **API** call |
| "How many tickets breached SLA last month?" | **SQL / analytics** tool (read-only role, row limits, query validation) |

Never answer live status from embeddings — they're a stale snapshot.

---

## 4. Agent design patterns

### Q15. Single agent vs multi-agent

**Short answer:** Start with **one agent + good tools**. Split into multiple agents when domains have different **permissions, prompts, owners or evaluation**, or when the tool set is too big for one context. Multi-agent adds latency, token cost and coordination bugs.

---

### Q16. Multi-agent topologies

```
 Supervisor (hierarchical)          Swarm / handoff (peer-to-peer)         Sequential pipeline
        ┌──────────┐                 ┌───────┐    handoff   ┌───────┐      A ─► B ─► C
        │Supervisor│                 │Agent A│ ───────────► │Agent B│
        └─┬──┬──┬──┘                 └───────┘ ◄─────────── └───────┘
          │  │  │                         active agent talks to user
        ┌─▼┐┌▼─┐┌▼─┐
        │A ││B ││C │  workers report back
        └──┘└──┘└──┘
```
- **Supervisor**: central router delegates and aggregates — easiest to control.
- **Handoff/swarm**: the active agent transfers control (with context) to a specialist.
- **Parallel workers**: fan-out independent subtasks, then join.
- **Agents-as-tools**: a sub-agent exposed as a tool to a parent agent.

---

### Q17. Handoffs: what must be passed?

A handoff transfers control **and** a minimal, authorised context: the task, relevant IDs, verified user identity/permissions (not raw secrets), and provenance. Bound recursion depth to prevent agents bouncing tasks forever.

---

### Q18. Sequential vs parallel vs hierarchical

Follow the **dependency graph**: dependent steps → sequential; independent lookups (Jira + Confluence + logs) → parallel with timeouts and a join; many specialties → hierarchical. Every parallel branch needs timeout, cancellation and a merge rule.

---

### Q19. Preventing infinite loops and runaway cost

Hard limits enforced **in code**:
- max iterations / tool calls (per run and per tool)
- token and dollar budget per task
- wall-clock timeout
- repetition detection (same tool + similar args N times → stop)
- recursion limit for sub-agents
- a graceful exit: "I couldn't find X; here's what I tried" or escalate to a human.

---

### Q20. Reflection / self-critique

The agent (or a second model) reviews its output against criteria and revises. Works best with **objective feedback** — running tests, validating a schema, checking a citation — rather than "is this good?" self-assessment.

---

### Q21. Plan-and-execute vs ReAct

**ReAct** decides one step at a time (adaptive, more LLM calls). **Plan-and-execute** writes a full plan first, then executes steps (cheaper models can execute; re-plan on failure). Plan-and-execute suits long multi-step tasks with predictable structure; ReAct suits exploratory tasks.

---

## 5. Memory & context

### Q22. Short-term vs long-term memory

```
 ┌───────────────── Short-term (per session/thread) ─────────────────┐
 │ conversation messages, tool results, current plan, approval state  │
 │ stored in: graph state + checkpointer (Postgres/Redis/DynamoDB),    │
 │            AgentCore Memory short-term events                       │
 └─────────────────────────────────────────────────────────────────────┘
 ┌───────────────── Long-term (across sessions) ──────────────────────┐
 │ semantic: facts ("user prefers CSV exports")                        │
 │ episodic: past experiences ("last time this error was fixed by…")   │
 │ procedural: learned instructions/skills                             │
 │ stored in: vector store / key-value store, namespaced by user/tenant │
 └─────────────────────────────────────────────────────────────────────┘
```
Memory is **not** the source of truth for business data (ticket status, balances) and must never bypass authorisation.

---

### Q23. Context engineering for agents

What the model sees each step decides success. Techniques:
- **Select** — only relevant tools, documents and memories for this step.
- **Compress** — summarise old turns, trim verbose tool output.
- **Isolate** — give sub-agents their own focused context; return only the result.
- **Externalise** — keep big artifacts (files, full logs) in storage; pass a reference/ID.
- **Preserve critical facts** in structured state (IDs, approvals, amounts) — never only inside a summary.

---

### Q24. Context compaction — how?

When history approaches the limit: replace old tool outputs with short summaries, summarise older dialogue, keep the latest N turns verbatim, keep structured facts, and store full logs for audit/retrieval. Re-fetch details on demand ("just-in-time" retrieval).

---

### Q25. Memory safety across users/tenants

Namespace every memory by verified tenant/user, check ACLs on every read/write, set retention/TTL, allow users to view/delete memories, and treat retrieved memories as **data, not instructions** (an attacker can plant a "memory" via injection).

---

## 6. Protocols: MCP, A2A, Agent Skills

### Q26. What is MCP (Model Context Protocol)?

**Short answer:** An open standard (originated by Anthropic, now governed in the open with the Linux Foundation's Agentic AI Foundation) for connecting AI applications to tools and data. Like "USB-C for AI": build an MCP server once, and any MCP-compatible client (Claude, IDEs, agent frameworks, AgentCore Gateway) can use it.

**Architecture:**
```
 ┌────────────────────── HOST (AI app: IDE, chat app, agent) ──────────────────────┐
 │                                                                                  │
 │   LLM  ◄──►  MCP Client A ──────────────┐     MCP Client B ─────────────┐         │
 │            (one client per server)      │                               │         │
 └─────────────────────────────────────────┼───────────────────────────────┼─────────┘
                                           │ JSON-RPC 2.0                  │
                           stdio (local process)             Streamable HTTP (remote, OAuth)
                                           │                               │
                               ┌───────────▼──────────┐       ┌────────────▼───────────┐
                               │ MCP Server: Git       │       │ MCP Server: Jira        │
                               │  tools: git_log, diff │       │  tools: get_issue,      │
                               │  resources: repo://…  │       │         create_issue    │
                               └───────────────────────┘       │  resources: jira://…    │
                                                               │  prompts: triage_bug    │
                                                               └─────────────────────────┘
```

**Server primitives:**
| Primitive | Controlled by | What |
|---|---|---|
| **Tools** | model | callable functions (`get_issue`) with JSON-schema input/output |
| **Resources** | application | read-only context data addressed by URI (`file://`, `jira://ABC-1`) |
| **Prompts** | user | reusable prompt templates (slash commands) |

**Client features:** elicitation (server asks user for input), and older roots/sampling (now deprecated — see Q27).

**Transports:** **stdio** for local servers (launched as a subprocess); **Streamable HTTP** for remote servers (with OAuth 2.1-based authorization). The old HTTP+SSE transport is deprecated.

---

### Q27. What changed in recent MCP spec revisions?

**Short answer (2026-07-28 revision — biggest change since launch):**
- **Stateless protocol:** the `initialize` handshake and protocol sessions (`Mcp-Session-Id`) are removed. Every request carries protocol version and client capabilities in `_meta`. Servers expose `server/discover` for capabilities. → Remote MCP servers scale horizontally like normal stateless HTTP services; cross-call state uses explicit handles passed as tool arguments.
- **Multi Round-Trip Requests (MRTR):** instead of the server sending requests to the client (sampling, elicitation), the server returns `resultType: "input_required"` and the client retries with the answers.
- **Tasks** (long-running operations, introduced in 2025-11-25) moved to an official **extension**; extensions framework added.
- **Cacheable list results** (`ttlMs`, `cacheScope`), deterministic tool ordering (helps prompt caching), OpenTelemetry trace propagation via `_meta`.
- **Deprecated:** Roots, Sampling, Logging; HTTP+SSE transport; Dynamic Client Registration (in favour of Client ID Metadata Documents).
- Authorization hardening (issuer validation, credentials bound to issuer).

**Interview framing:** "Earlier versions were stateful sessions; the 2026 spec made MCP stateless so remote servers fit load balancers and serverless. I'd check which protocol version our SDK and gateway support."

---

### Q28. MCP security concerns

- **Tool poisoning:** malicious tool descriptions with hidden instructions → only install trusted servers, review/pin versions.
- **Prompt injection via tool results** → treat results as untrusted data.
- **Over-privileged servers / token passthrough** → server should use its own scoped credentials or properly delegated tokens; don't forward the user's broad token to downstream APIs.
- **Confused deputy** → enforce per-user authorisation inside the server.
- **Local servers run code on your machine** → sandbox, least privilege.
- Use a gateway (e.g., **AgentCore Gateway**) for central auth, allowlisting and audit.

---

### Q29. What is A2A (Agent2Agent protocol)?

**Short answer:** An open protocol (started by Google, now a Linux Foundation project) for **agents to talk to other agents** across vendors/frameworks. An agent publishes an **Agent Card** (JSON describing skills, endpoint, auth). Clients send **tasks/messages**; the remote agent works (possibly long-running, streaming updates) and returns **artifacts**.

```
 Your orchestrator agent ── discovers Agent Card ──► Travel agent (other team/vendor)
                         ── send task "book flight" ─►  works opaquely (own tools, own model)
                         ◄── status updates / artifacts ─
```

---

### Q30. MCP vs A2A vs plain HTTP APIs

| | MCP | A2A | HTTP/REST |
|---|---|---|---|
| Connects | agent ↔ **tools/data** | agent ↔ **agent** | any client ↔ service |
| Other side is | a deterministic capability | an autonomous agent (opaque reasoning) | a service |
| Unit of work | tool call / resource read | task with lifecycle, messages, artifacts | request/response |

They complement each other: an agent uses MCP for its tools and A2A to delegate to other agents; both run over HTTP.

---

### Q31. What are Agent Skills?

**Short answer:** A packaging format (introduced by Anthropic, published as an open standard) for giving agents reusable know-how: a folder with a `SKILL.md` (name, description, instructions) plus optional scripts and resources. The agent loads only the short description at first and reads the full skill **only when relevant** ("progressive disclosure") — saving context. Skills teach *how* to do a task; MCP gives *access* to systems.

---

## 7. Production: security, reliability, evaluation, observability

### Q32. Carrying identity through an agent chain (avoid confused deputy)

**Short answer:** Authenticate the user at the entry point; propagate **verified** identity (signed token or trusted context) to tools; each tool authorises the **end user** for the specific resource. Use service credentials scoped to minimum permissions. Never trust a `user_id` the model wrote.

```
 Browser ─JWT─► API (verify Cognito/Okta token) ─► Agent runtime (user context attached)
             ─► Gateway (inbound auth, tool allowlist per role)
             ─► Tool (OAuth token for *this user* via token vault, or scoped service role + user check)
```
**Confused deputy:** a privileged agent tricked into doing something the user isn't allowed to do. Fix: authorise as the user, not as the agent.

---

### Q33. Agent threat model — trust boundaries

```
 [User input] ─untrusted─┐
 [Retrieved docs/web] ───┼──► LLM ──► proposed actions ──► [Policy gate] ──► tools ──► external systems
 [Tool outputs] ─────────┤                                     ▲
 [Memory] ───────────────┘                         deterministic checks, approvals
```
Threats: direct/indirect prompt injection, data exfiltration (via tool calls, URLs, markdown images), privilege misuse, SSRF via fetch tools, excessive agency, memory poisoning, secrets in logs, runaway cost (DoS). Controls: least privilege, policy outside the model, sandboxed code execution, egress allowlists, approvals, redaction, budgets, red-team tests.

---

### Q34. Policy enforcement outside the model

Deterministic policy layer (code, OPA/Cedar policies, or **AgentCore Policy**) intercepts every tool call: is this tool allowed for this user, with these arguments, in this context? Prompts saying "never do X" are guidance; the gate is enforcement.

```cedar
// Example Cedar-style policy: only managers may approve refunds above 1000
permit(principal in Role::"manager", action == Action::"approve_refund", resource)
when { resource.amount > 1000 };
```

---

### Q35. Durable execution for agents

Checkpoint state at each step so a crash/redeploy resumes from the last checkpoint instead of restarting. Durable state ≠ exactly-once side effects: a step may re-run after a crash, so writes need idempotency keys. Tools: LangGraph checkpointers, Step Functions, Temporal, Lambda durable functions.

---

### Q36. Evaluating agents

| Level | What to check |
|---|---|
| Tool level | right tool chosen, valid arguments |
| Step / trajectory | sensible sequence, no loops, efficient path |
| Outcome | task success (did the ticket get correctly updated?) |
| Safety | refuses disallowed actions, resists injection test cases, respects approvals |
| Efficiency | steps, tokens, cost, latency |

Use deterministic checks where possible (final DB state, schema validity), LLM judges with rubrics for open-ended quality, human review samples, and run the suite in CI on every prompt/model/tool change. AgentCore Evaluations / LangSmith / Ragas / DeepEval can help.

---

### Q37. What should an agent trace contain?

Per run: correlation/trace ID, user/tenant (pseudonymised), model + prompt version, each LLM call (tokens, latency), each tool call (name, redacted args, result size, latency, error class), policy decisions, approvals, final outcome, total cost. Store in OpenTelemetry-compatible backend; restrict access; set retention.

---

### Q38. Cost control

Budgets per run, model routing (small model for routing/extraction, large for reasoning), prompt caching for static system prompt + tools, limit tool output size, compaction, cap iterations, cache deterministic tool results.

---

### Q39. One general agent vs specialised agents — decision criteria

Specialise when: different permission domains (Deposits vs Investments), different data/tool sets, different owners, separate evaluation/compliance needs, or too many tools for one context. Otherwise keep one agent — fewer moving parts.

---

### Q40. Long-running agents and async UX

If tasks take minutes: return `202 Accepted` + job ID, run the agent asynchronously (queue/worker, AgentCore async/long sessions, Step Functions), stream progress events, persist state, allow cancel, notify on completion.

---

## 8. Scenario & debugging questions

### Q41. The model called a sensitive tool without approval. How do you make that impossible?

Put the gate **outside the model**: the tool executor rejects any call to a sensitive tool unless a stored approval record exists for that exact `action_id` + args hash, approved by an authorised identity. Log the attempt, add an eval case, and review why the model tried (prompt/tool description).

---

### Q42. The agent keeps searching with slightly different queries

Detect repeated similar calls; cap per-tool attempts; improve tool feedback ("0 results; try filter X"); give an explicit exit ("if 2 searches return nothing, ask the user or say not found"); add a trajectory test.

---

### Q43. Build an agent pipeline handling 100–300 document requests per minute

```
 Client ─► API (auth, validation, quota) ─► 202 + job_id
              │ put file in S3, job row in DynamoDB
              ▼
           SQS queue ─► Step Functions / workers (bounded concurrency to Textract & LLM)
              │            ├─ OCR (async Textract jobs, SNS completion)
              │            ├─ LLM extraction/agent reasoning (rate-limited, retries w/ backoff)
              │            └─ validation + human review queue for low confidence
              ▼
           results in S3/DynamoDB ─► progress events (SSE/WebSocket) ─► client
           failures ─► DLQ + alarms
```
Never keep the HTTP request open for minutes; bound concurrency to downstream quotas; idempotent job processing.

---

### Q44. Recover an agent after a crash mid-way through a multi-step action

Load the last checkpoint → for each step after it, check external state using operation IDs (did the Jira comment get posted?) → skip completed side effects → re-validate permissions → continue, or ask for fresh approval if the context changed.

---

### Q45. A web page the agent browsed told it to email internal documents. What protections should have stopped it?

Email tool limited to internal domains + approval for external sends; agent session had no access to unrelated documents (least privilege); output filter blocked unexpected outbound URLs; untrusted web content was labelled as data; the attempt was logged and alerted. Add this as a red-team regression test.

---

### Q46. How do you explain to stakeholders why the agent shouldn't be fully autonomous?

Quantify: error rate on eval set, impact of a wrong action, reversibility. Propose graduated autonomy: read-only → draft for human → auto-execute low-risk actions with audit → expand based on measured accuracy.

---

## 9. Agent frameworks landscape

### Q47. Which agent frameworks should you know, and how do they differ?

**Short answer:** They all wrap the same loop (model → tool calls → observe → repeat). They differ in **how much control you get over the flow**, **state/durability**, **multi-agent style**, and **where they deploy best**.

| Framework | Style | Strengths | Watch out |
|---|---|---|---|
| **LangGraph** (07) | explicit graph of nodes/edges with typed state | full control, checkpoints, `interrupt` HITL, durable, any model | more code; you design the flow |
| **LangChain `create_agent`** (06) | prebuilt agent loop + middleware (built on LangGraph) | fast start, middleware hooks, huge integration library | drop to LangGraph for custom flows |
| **Strands Agents** (AWS, open source) | **model-driven**: give a model + tools + prompt, the model plans the loop | very little code, Bedrock-first but multi-provider, MCP tools, multi-agent (agents-as-tools, Swarm, Graph), first-class AgentCore deploy | less explicit control of each step than a hand-built graph |
| **CrewAI** | role-based "crew" of agents with tasks | quick multi-agent prototypes | harder to make deterministic |
| **Microsoft Agent Framework** (direct successor to AutoGen + Semantic Kernel, same teams) | agents + graph/functional **workflows**; opinionated "Harness Agent" for long multi-step tasks | .NET and Python (Go in public preview); many model providers (Foundry, Azure OpenAI, OpenAI, Anthropic, Ollama…); MCP tools, middleware, telemetry | newer; migration guides exist from SK/AutoGen |
| **OpenAI Agents SDK** | lightweight agents, handoffs, guardrails | simple handoff model, tracing | best with OpenAI models |
| **Google ADK** | code-first agents, multi-agent hierarchies | Gemini/Vertex integration | — |
| **Amazon Bedrock Agents** | fully managed, configured (not coded) agent | no infra, action groups + knowledge bases | less flexible; AgentCore is the code-first path |

**Key point for AgentCore:** AgentCore Runtime is **framework-agnostic** — LangGraph, Strands, CrewAI, etc. all run there as a container that follows the service contract (08 Q10). The framework decides *how the agent thinks*; AgentCore decides *where/how securely it runs*.

---

### Q48. What does a Strands agent look like?

```python
from strands import Agent, tool
from strands.models import BedrockModel

@tool
def get_ticket(ticket_id: str) -> dict:
    """Fetch a support ticket by its ID (e.g. 'INC-1234')."""   # docstring = tool description
    return jira.get(ticket_id)

model = BedrockModel(model_id=MODEL_ID, temperature=0.2, max_tokens=2000)
agent = Agent(model=model, tools=[get_ticket],
              system_prompt="You triage support tickets. Never change ticket status.")
result = agent("Summarise INC-1234 and suggest the owning team.")
```
Multi-agent options: **agents as tools** (an orchestrator agent calls specialist agents like tools), **Swarm** (agents hand off to each other), **Graph** (`GraphBuilder` with explicit nodes/edges — closer to LangGraph).

**Compare with LangGraph:** in Strands, the model drives the loop and you add tools; in LangGraph, you draw the loop and the model fills in the decisions. Use Strands for tool-using assistants where the model's planning is enough; LangGraph when you need exact control (approval gates, retries per node, resumable long workflows).

---

### Q49. How do you choose a framework in a design discussion?

Ask: (1) Do we need explicit, auditable control flow and durable HITL? → LangGraph. (2) Mostly "LLM + tools" with minimal code on AWS? → Strands or `create_agent`. (3) Is the team/stack already on one ecosystem? (4) Model portability needs? (5) Observability (OpenTelemetry support) and test tooling? (6) Maturity and breaking-change rate. **Keep business logic and tools framework-independent** (plain functions/MCP servers), so switching frameworks is a contained change.

---

## 10. Cheat sheet

| Concept | One-liner |
|---|---|
| Frameworks | LangGraph = explicit graph; Strands = model-driven loop; AgentCore runs any of them |
| Agent | LLM in a loop choosing tools until goal/limit |
| Autonomy | least autonomy that works; workflows first |
| ReAct | reason → act → observe, repeat |
| Tool call | model *requests*; code validates, authorises, executes |
| Tool design | clear descriptions, few high-level tools, concise outputs, helpful errors |
| HITL | durable approval bound to exact action + approver identity |
| Idempotency | operation IDs for every write |
| Loops | max steps, budgets, repetition detection, graceful exit |
| Memory | short-term (thread) vs long-term (namespaced, ACL'd); not source of truth |
| Context engineering | select, compress, isolate, externalise |
| MCP | agent ↔ tools/data; tools/resources/prompts; stdio or Streamable HTTP; stateless since 2026-07-28 |
| A2A | agent ↔ agent; Agent Card, tasks, artifacts |
| Skills | packaged instructions loaded on demand |
| Security | policy outside the model; least privilege; untrusted inputs |
| Eval | tool → trajectory → outcome → safety → cost |

## Official references

- Anthropic, Building effective agents: https://www.anthropic.com/engineering/building-effective-agents
- MCP specification: https://modelcontextprotocol.io/specification · changelog: https://modelcontextprotocol.io/specification/2026-07-28/changelog
- A2A protocol: https://a2a-protocol.org/
- Agent Skills: https://agentskills.io/
- Strands Agents: https://strandsagents.com/
- Microsoft Agent Framework overview: https://learn.microsoft.com/en-us/agent-framework/overview/
- AWS agentic AI guidance: https://docs.aws.amazon.com/prescriptive-guidance/latest/agentic-ai-foundations/
- OWASP Agentic AI threats: https://genai.owasp.org/
