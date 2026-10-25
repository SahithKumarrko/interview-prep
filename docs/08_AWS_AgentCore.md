# Amazon Bedrock AgentCore: L2 → L3 Interview Preparation

> **Updated:** 24 October 2026 · **Level:** what each service does → how they connect → security & production design
> **How to use:** *Short answer* = what you say first. *Explanation / Example* = intuition. *Pitfall / Follow-up* = where interviewers dig.
> AgentCore evolves quickly — numbers below (session limits, ports) are from the current AWS docs; always say "I'd confirm in the docs for our region".

---

## Table of contents

1. [Mental model: AgentCore as an "agent operating platform"](#1-mental-model-agentcore-as-an-agent-operating-platform)
2. [Overview & Harness](#2-overview--harness) (Q01–Q05)
3. [Runtime](#3-runtime) (Q06–Q15)
4. [Gateway](#4-gateway) (Q16–Q21)
5. [Identity & authentication](#5-identity--authentication) (Q22–Q26)
6. [Memory](#6-memory) (Q27–Q30)
7. [Built-in tools: Code Interpreter & Browser](#7-built-in-tools-code-interpreter--browser) (Q31–Q32)
8. [Policy, Observability, Evaluations, Optimization, Registry, Payments](#8-policy-observability-evaluations-optimization-registry-payments) (Q33–Q39)
9. [Architecture, security & trade-offs](#9-architecture-security--trade-offs) (Q40–Q45)
10. [Scenario & debugging questions](#10-scenario--debugging-questions) (Q46–Q52)
11. [Cheat sheet](#11-cheat-sheet)

---

## 1. Mental model: AgentCore as an "agent operating platform"

Building an agent locally is easy. Running it for thousands of users needs: isolated compute per user, secure tool access, user identity + OAuth tokens to third-party systems, memory, guardrails/policy, tracing and evaluation. **AgentCore = a set of modular, managed AWS services that provide this production layer for agents built with *any* framework (LangGraph, Strands, CrewAI, LlamaIndex, OpenAI Agents SDK, Google ADK, custom) and *any* model (Bedrock, OpenAI, Gemini, …).** Use one service or all of them.

```
                         ┌───────────────────────── Amazon Bedrock AgentCore ─────────────────────────┐
  Users / apps           │                                                                            │
 ┌──────────────┐  JWT   │  ┌─────────────────────────── RUN ───────────────────────────────┐          │
 │ React app    │──────► │  │ HARNESS  – managed agent loop from config (model+prompt+tools)│          │
 │ Slack / API  │ SigV4  │  │ RUNTIME  – host YOUR agent/MCP/A2A server; microVM per session │          │
 └──────────────┘        │  │            (or Instances on EC2 for multi-day/GPU sessions)   │          │
                         │  └───────┬───────────────────────────────┬───────────────────────┘          │
                         │          │ tools                         │ remember                         │
                         │  ┌───────▼───────────── CONNECT ────┐ ┌──▼──────────── STATE ────────┐       │
                         │  │ GATEWAY – APIs/Lambda/OpenAPI/    │ │ MEMORY – short-term events +  │       │
                         │  │   Smithy/MCP servers → one MCP    │ │   long-term extracted records │       │
                         │  │   endpoint; A2A/HTTP passthrough; │ └───────────────────────────────┘       │
                         │  │   model routing; semantic tool    │                                         │
                         │  │   search                          │ ┌──────────── BUILT-IN TOOLS ────┐       │
                         │  │ POLICY – Cedar rules checked on   │ │ CODE INTERPRETER (sandbox)     │       │
                         │  │   every tool call at the Gateway  │ │ BROWSER (managed cloud browser)│       │
                         │  └───────────────────────────────────┘ └───────────────────────────────┘       │
                         │  ┌──────────────────────── SECURE ──────────────────────────────────┐         │
                         │  │ IDENTITY – inbound auth (JWT from Okta/Entra/Cognito, IAM),       │         │
                         │  │   workload identities, token vault for outbound OAuth/API keys    │         │
                         │  └──────────────────────────────────────────────────────────────────┘         │
                         │  ┌──────────────────────── OPERATE / IMPROVE ───────────────────────┐         │
                         │  │ OBSERVABILITY (OTel → CloudWatch) · EVALUATIONS · OPTIMIZATION    │         │
                         │  │ (A/B tests, prompt/tool-description recommendations) · REGISTRY   │         │
                         │  │ (catalog of agents/MCP servers/skills) · PAYMENTS (x402/MPP)      │         │
                         │  └──────────────────────────────────────────────────────────────────┘         │
                         └────────────────────────────────────────────────────────────────────────────┘
                                         │                         │
                                Bedrock / other LLMs      Your systems (Jira, S3, DBs, SaaS)
```

**AgentCore vs "Bedrock Agents" (the older feature):** Bedrock Agents is a configured agent inside Bedrock with action groups and knowledge bases. AgentCore is a broader, framework-agnostic platform where you bring your own agent code (Runtime) or use a managed loop (Harness), plus independent services for tools, identity, memory, policy and observability.

---

## 2. Overview & Harness

### Q01. What is Amazon Bedrock AgentCore?

**Short answer:** An agentic platform of **modular, serverless services** for deploying and operating agents securely at scale — with any framework and any model. Core services: **Harness, Runtime, Gateway, Identity, Memory, Code Interpreter, Browser, Observability, Policy, Evaluations**, plus newer ones: **Optimization, Registry, Payments**. Pricing is consumption-based.

```flow
pipeline: AgentCore services along an agent's life
Build > Harness (config) or your own framework code.
Run > Runtime: isolated session microVMs.
Connect > Gateway turns APIs/Lambda into MCP tools; Policy checks each call.
Secure > Identity: inbound auth, outbound tokens.
Remember > Memory: short-term events, long-term records.
Operate > Observability, Evaluations, Optimization, Registry.
```

**Interview framing:** "AgentCore doesn't replace LangGraph — LangGraph decides *what the agent does*; AgentCore provides *where it runs securely, how it reaches tools, who it acts as, what it remembers, and how we observe and govern it*."

---

### Q02. What is AgentCore Harness?

**Short answer:** A **managed agent loop defined by configuration**: you declare model, system prompt, tools (Gateway, MCP servers, inline functions, built-in Browser/Code Interpreter), skills and memory; AgentCore runs the loop (powered by **Strands Agents**). Each session runs in an isolated microVM (on Runtime) with its own filesystem and shell.

```flow
pipeline: AgentCore Harness from config to running agent
Declare config > Model, system prompt, tools (Gateway / MCP), memory.
Create harness > A versioned, managed agent loop.
Invoke > AgentCore runs the loop: model → tools → observe.
Iterate > Change config, publish a new version. No agent code to host.
```

**Notable features:** switch model providers mid-session without losing context; attach skills (Git, S3 or curated AWS catalog); bring your own container image; mount S3 Files/EFS for shared data; lifecycle hooks; immutable versions + named endpoints (instant rollback); `InvokeHarness` state in Step Functions; **export to Strands code** when config isn't enough. No separate harness charge.

---

### Q03. Harness vs code-based Runtime — when to choose which?

```flow
pipeline: Harness or Runtime?
Standard agent loop fits? > Harness: fastest, no code to host.
Custom control flow, framework or libraries? > Runtime with your LangGraph/Strands code.
Hosting MCP/A2A servers? > Runtime.
Long, heavy or GPU sessions? > Runtime Instances.
```

| | Harness | Runtime (your code) |
|---|---|---|
| You write | configuration (model, prompt, tools, skills) | the agent itself (LangGraph, Strands, custom) |
| Orchestration | managed Strands loop | **you** control graph, state, routing, HITL |
| Speed to production | fastest | more work |
| Custom control flow, multi-agent graphs, deterministic steps | limited (hooks) | full |
| Good for | standard tool-using assistants, coding/data-analysis/research agents | complex workflows, existing LangGraph code, strict custom logic |

**Rule:** Start with Harness if a standard agent loop fits; use Runtime when you need a custom graph (e.g., LangGraph with approvals and parallel branches). Harness can be exported to code if you outgrow it.

---

### Q04. How do the services fit together for one request?

```flow
sequence: One request through AgentCore
actors: User, React/API, Runtime, Agent, Memory, Gateway, Tool
User -> React/API: log in with Okta → JWT
React/API -> Runtime: InvokeAgentRuntime(runtimeArn, sessionId, payload)
> Inbound auth validates the JWT (issuer, audience, client) or IAM SigV4.
Runtime -> Agent: route to this session's microVM
> A microVM is created on the first call for the session.
Agent -> Memory: load context
Agent -> Gateway: tool call (MCP)
> Gateway checks the agent's token; the Policy engine evaluates the call with Cedar rules → allow or deny.
Gateway -> Tool: call with outbound credentials
> From the Identity token vault: OAuth for this user, an API key, or IAM. Targets: Lambda, OpenAPI, MCP servers, SaaS.
Agent -> Memory: write events
Agent --> User: stream response
> Every step emits OTel spans to Observability; Evaluations score sampled sessions.
```

---

### Q05. How do you develop and deploy to AgentCore?

**Short answer:** Use the **AgentCore CLI / SDK** (`bedrock-agentcore` Python SDK + starter toolkit). Wrap your agent with `BedrockAgentCoreApp`, test locally, then deploy (direct code upload or container image in ECR). Infrastructure-as-code: CloudFormation / CDK / Terraform AWS provider resources.

```flow
pipeline: From local agent to deployed runtime
Wrap entrypoint > `BedrockAgentCoreApp` + `@app.entrypoint`.
Test locally > Same contract on your machine.
Configure > CLI / starter toolkit: execution role, auth, protocol.
Deploy > Container image (ECR) or direct code upload → new version.
Point endpoint > Release by moving an endpoint to the version; IaC via CloudFormation/CDK/Terraform.
```

```python
# app.py – minimal LangGraph agent on AgentCore Runtime
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from my_graph import graph               # compiled LangGraph with durable checkpointer

app = BedrockAgentCoreApp()

@app.entrypoint
def invoke(payload, context):
    # context.session_id = runtime session id (routing), NOT user authentication
    cfg = {"configurable": {"thread_id": payload["thread_id"]}}
    result = graph.invoke({"messages": [("user", payload["prompt"])]}, cfg)
    return {"answer": result["messages"][-1].content}

if __name__ == "__main__":
    app.run()       # serves the HTTP contract locally on :8080 (/invocations, /ping)
```
```bash
agentcore configure --entrypoint app.py     # or `agentcore create` with newer CLI
agentcore launch                            # build (ARM64), push, create runtime + endpoint
agentcore invoke '{"prompt": "hello", "thread_id": "t-1"}'
```

---

## 3. Runtime

### Q06. What is AgentCore Runtime?

**Short answer:** Secure, serverless hosting for agents **and** tools (MCP servers, A2A servers). Key properties:
- **Session isolation:** each session gets a **dedicated microVM** (isolated CPU, memory, filesystem); terminated and memory sanitised afterwards.
- **Long sessions:** up to **8 hours** per lifecycle on microVMs (up to **14 days** on Instances).
- **Framework/model agnostic.**
- **Protocols:** HTTP, MCP, A2A, AG-UI; HTTP streaming (SSE) and WebSocket bidirectional streaming.
- **Payloads up to 100 MB** (multimodal).
- **Consumption pricing** — CPU billed for active processing (I/O wait while waiting for the LLM is typically not charged).
- Built-in identity (inbound/outbound auth) and observability.

```flow
sequence: Session isolation in Runtime
actors: User A, User B, Runtime, microVM A, microVM B
User A -> Runtime: invoke(session=sA)
Runtime -> microVM A: dedicated microVM for sA
User B -> Runtime: invoke(session=sB)
Runtime -> microVM B: separate microVM for sB
> Separate CPU, memory and filesystem per session; wiped when the session ends.
```

---

### Q07. Runtime building blocks: agent runtime, versions, endpoints, sessions

```flow
trace: Releasing and rolling back with versions and endpoints
deploy  →  versions V1, V2, **V3** > Every update creates an immutable version.
endpoint "prod" → **V2** > Clients call the endpoint, not a version.
release: move "prod" → **V3** > Instant switch.
rollback: move "prod" → **V2** > Just as instant. "DEFAULT" always tracks the latest.
```

```
 Agent Runtime (ARN)  ── a deployed agent
   ├── Version 1, 2, 3 …   (immutable; each deploy/update creates a new version)
   ├── Endpoint "DEFAULT"  → latest version
   └── Endpoint "prod"     → Version 2   (point to Version 3 to release, back to 2 to roll back)

 Session (runtimeSessionId) ── one user conversation → its own microVM
```

---

### Q08. Session lifecycle

**Short answer:** First invoke with a new `runtimeSessionId` provisions a microVM. States:
- **Active** — processing a request/command, or background work signalled by `/ping` returning `HealthyBusy`.
- **Idle** — finished, waiting for next call (state kept in memory/disk).
- **Stopped** — microVM terminated due to **idle timeout (default 15 min)**, **max lifetime (default 8 h)**, `StopRuntimeSession` API, or failed health checks.

The **next invoke with the same session ID** provisions a fresh microVM — in-memory state and local disk are gone **unless** you configured **session storage** (persistent filesystem directory) or keep state externally (AgentCore Memory, LangGraph checkpointer in Postgres/DynamoDB, S3).

```flow
pipeline: Runtime session lifecycle
invoke(s1) > First call for session s1.
Provision microVM > A dedicated, isolated microVM is created for this session.
Active > Processing requests.
Idle > No requests. Still alive, state in memory.
Stopped > After 15 minutes idle, or 8 hours maximum lifetime. In-memory state is gone.
invoke(s1) again > Gets a brand-new microVM, so durable state must live in Memory or a checkpointer.
```
**Session ID rules:** unique per user/conversation, **at least 33 characters** (e.g., UUID), reuse it for follow-ups (stickiness avoids cold starts). A brief `409 RetryableConflictException` can occur while a session is being provisioned/stopped — retry with backoff.

---

### Q09. Who maps sessions to users?

**Short answer:** **You do.** AgentCore does **not** enforce session-to-user mapping. Your backend must store `user → session IDs`, check ownership before invoking, and limit sessions per user. The session header is a routing key, **not authentication**.

```flow
sequence: Your backend owns the user ↔ session mapping
actors: User, Your API, Mapping table, Runtime
User -> Your API: message (JWT, conversation c1)
Your API -> Mapping table: c1 belongs to this user? → session id s-c1
Your API -> Runtime: InvokeAgentRuntime(sessionId = s-c1)
> AgentCore doesn't check that a session belongs to a user. If you let clients choose session IDs, one user could reach another's session.
```

```python
@app.post("/chat/{conv_id}")
def chat(conv_id: str, body: Msg, user=Depends(verify_okta_jwt)):
    conv = db.conversations.get(conv_id)
    if not conv or conv.user_id != user.sub:
        raise HTTPException(403)
    resp = agentcore.invoke_agent_runtime(
        agentRuntimeArn=RUNTIME_ARN, qualifier="prod",
        runtimeSessionId=conv.runtime_session_id,       # server-generated UUID-based, ≥33 chars
        payload=json.dumps({"prompt": body.text, "thread_id": conv.thread_id}).encode(),
    )
    return StreamingResponse(resp["response"], media_type="text/event-stream")
```

---

### Q10. Runtime service contract (what your container must implement)

```flow
sequence: The Runtime service contract
actors: AgentCore Runtime, Your container
AgentCore Runtime -> Your container: start (listen on 0.0.0.0:8080, ARM64 image)
AgentCore Runtime -> Your container: GET /ping
Your container --> AgentCore Runtime: {"status": "Healthy"} (or HealthyBusy)
AgentCore Runtime -> Your container: POST /invocations (payload + session headers)
Your container --> AgentCore Runtime: JSON response or SSE stream
> MCP servers use port 8000 /mcp; A2A uses 9000. The SDK implements this contract for you.
```

| Protocol | Port | Paths | Format |
|---|---|---|---|
| **HTTP** | 8080 | `POST /invocations`, `GET /ping`, `/ws` (WebSocket) | JSON / SSE / WebSocket |
| **MCP** | 8000 | `/mcp` | JSON-RPC (MCP Streamable HTTP) |
| **A2A** | 9000 | `/` | JSON-RPC 2.0 + Agent Card discovery |
| **AG-UI** | 8080 | `/invocations` (SSE), `/ws` | AG-UI event stream |

Also: listen on `0.0.0.0`, `/ping` returns health (`Healthy` / `HealthyBusy` for background work), container image for **ARM64** (Graviton). The SDK's `BedrockAgentCoreApp` implements the HTTP contract for you.

**Session header by protocol:** HTTP/A2A/AG-UI use `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id`; MCP uses `Mcp-Session-Id`.

---

### Q11. Which protocol to expose?

```flow
pipeline: Which protocol to expose
Your app calls the agent > HTTP (/invocations).
Hosting tools for other agents > MCP.
Agents delegating to your agent > A2A.
Realtime / bidirectional > WebSocket.
```

- **HTTP** — your own app/backend calls the agent (most common).
- **MCP** — you're hosting **tools** for other agents (an MCP server on Runtime; also put behind Gateway).
- **A2A** — your agent is a peer other agents delegate tasks to (Agent Card discovery).
- **AG-UI** — interactive agent ↔ frontend event protocol (streaming UI state, tool progress).

---

### Q12. MicroVMs vs Instances (capacity providers)

```flow
pipeline: microVM vs Instances
microVM per session > Strong isolation, fast start, auto-cleanup; time-limited sessions.
Instances (capacity on EC2) > Long-running (days), GPUs, bigger machines.
Trade-off > Instances give weaker per-session isolation, so design tenancy carefully.
```

| | microVM (default) | Instances |
|---|---|---|
| Infrastructure | fully managed, serverless | AWS-managed **EC2 instances in your account** via capacity providers |
| Session length | up to 8 h per lifecycle | up to 14 days |
| Isolation | one microVM per session | agents may **share an instance** (shared filesystem/resources) |
| Extras | instant scale, pay per use | persistent multi-day sessions, **GPU** workloads, multiple collaborating agents |

Choose Instances for long-running research/coding agents or GPU needs; accept weaker per-session isolation and more capacity planning.

---

### Q13. Long-running and asynchronous agents

The agent can return quickly and continue work in a background thread/task; it signals "still busy" via `/ping` → `HealthyBusy`, keeping the session active (up to max lifetime). Pattern: invoke → agent starts job → returns job ID → client polls/streams status → agent writes results to S3/DB. For multi-hour or multi-day workflows, also persist checkpoints externally so a stopped session can resume. Runtime **platform V2** starts agents from snapshots for faster, more consistent cold starts.

```flow
sequence: Async work that outlives the request
actors: Caller, Runtime, Agent
Caller -> Runtime: invoke("research X")
Runtime -> Agent: start
Agent --> Caller: quick reply: "started, job j1"
Agent -> Agent: background task keeps working
Runtime -> Agent: GET /ping
Agent --> Runtime: HealthyBusy (keeps the session alive)
Agent -> Agent: done → report Healthy, store results
> Results are written to storage or sent via a callback; the session can then idle out.
```

---

### Q14. Streaming responses

Return a generator from your entrypoint → Runtime streams SSE to the caller; or use WebSocket (`/ws`) for bidirectional streaming (voice, interactive). Your API can forward the stream to the browser with stable event types.

```flow
sequence: Streaming from Runtime
actors: Client, Runtime, Agent
Client -> Runtime: invoke (accept SSE)
Runtime -> Agent: call entrypoint
Agent --> Runtime: yield token
Runtime --> Client: SSE event
Agent --> Runtime: yield token … done
Runtime --> Client: stream closes
> Return a generator from your entrypoint. Use WebSocket (/ws) for two-way streaming.
```

---

### Q15. Runtime vs LangGraph checkpointing — two different layers

```flow
pipeline: Two state layers
microVM memory > Fast, but gone after 15 min idle or 8 h.
LangGraph checkpointer (Postgres / Memory-backed) > Durable conversation + workflow state by thread_id.
AgentCore Memory > Durable events and long-term records per user.
Rule > Anything that must survive the session lives outside the microVM.
```

| Layer | Provides | Lifetime |
|---|---|---|
| Runtime session | isolated compute + in-memory/disk state | until idle timeout / max lifetime |
| Session storage (optional) | persistent directory across stop/resume | session validity |
| LangGraph checkpointer (Postgres, DynamoDB/AgentCore Memory-based saver) | graph state, interrupts, recovery | as long as you keep it |
| AgentCore Memory | conversation events + long-term facts | configurable expiry |

**Pitfall:** relying on `InMemorySaver` inside the microVM — after 15 idle minutes the conversation (and any pending approval) is gone.

---

## 4. Gateway

### Q16. What is AgentCore Gateway?

**Short answer:** A managed **AI gateway** — a single secure entry point for agent traffic. Its main job: turn **APIs, Lambda functions and existing services into MCP tools** and aggregate existing MCP servers behind **one MCP endpoint**. It also does **HTTP passthrough** (including A2A to other agents) and **inference routing** across model providers. It handles **inbound auth** (who may call the gateway) and **outbound auth** (credentials to each target), plus semantic tool search, interceptors and Policy enforcement.

```flow
sequence: A tool call through Gateway
actors: Agent, Gateway, Policy, Lambda tool
Agent -> Gateway: tools/call get_invoice (MCP + token)
Gateway -> Gateway: inbound auth: token valid for this gateway?
Gateway -> Policy: allowed for this principal + args?
Policy --> Gateway: ALLOW
Gateway -> Lambda tool: invoke (outbound IAM role)
Lambda tool --> Agent: result
```

```
                  Agent (any framework, MCP client)
                         │  MCP over Streamable HTTP + JWT (inbound auth)
                         ▼
 ┌──────────────────────── AgentCore Gateway ─────────────────────────────┐
 │ inbound authorizer (JWT: Cognito/Okta/Entra; or IAM)                    │
 │ interceptors (inspect / transform / reject requests & responses)        │
 │ Policy engine (Cedar) – evaluates every tools/call                      │
 │ semantic tool search ("x_amz_bedrock_agentcore_search")                 │
 │                                                                         │
 │ MCP targets (aggregated into one virtual MCP server):                   │
 │   • Lambda function        • OpenAPI spec      • Smithy model           │
 │   • API Gateway REST stage • remote MCP server • 1-click integrations   │
 │     (Salesforce, Slack, Jira, Asana, Zendesk …) • built-in connectors   │
 │ HTTP targets (passthrough, e.g. A2A agents)   Inference targets (LLMs)   │
 │                                                                         │
 │ outbound auth per target: IAM role (SigV4) │ OAuth (2LO/3LO) │ API key   │
 │   (credentials from AgentCore Identity token vault)                     │
 └─────────────────────────────────────────────────────────────────────────┘
```

---

### Q17. How does Gateway convert an API into tools?

```flow
pipeline: Turning an API into MCP tools with Gateway
Create gateway > Choose the inbound authorizer (JWT or IAM).
Add a target > Upload an OpenAPI/Smithy spec, or point at a Lambda with a tool schema.
Attach credential provider > Outbound auth: API key, OAuth client, or IAM role.
Operations become tools > Each operation is exposed as an MCP tool, named like `targetName___operationName`.
Agents call the gateway > `tools/list` and `tools/call` on the gateway URL. The agent never sees the backend credentials.
```

```python
# Agent side (LangChain MCP adapters) – the agent only knows the gateway URL
client = MultiServerMCPClient({"gw": {"transport": "streamable_http", "url": GATEWAY_URL,
                                      "headers": {"Authorization": f"Bearer {agent_token}"}}})
tools = await client.get_tools()
```

---

### Q18. Inbound vs outbound auth on Gateway

**Short answer:**
- **Inbound** = "May this caller (agent/user) use the gateway?" — validate a JWT (issuer, audience/allowed clients, scopes) or IAM SigV4.
- **Outbound** = "With what credentials does the gateway call the target?" — IAM role, OAuth token (machine 2LO or user-delegated 3LO), or API key from the token vault.

```flow
pipeline: Inbound vs outbound auth on Gateway
Inbound: who is calling? > Validate the agent's/user's JWT (issuer, audience, client) or IAM.
Policy / interceptors > Fine-grained decision per tool call.
Outbound: how Gateway calls the target > IAM role, API key, or OAuth token from Identity.
Target > Sees Gateway's credentials, never the agent's raw secrets.
```

They are independent: a valid inbound token doesn't mean the target will accept the call, and vice versa. Debug them separately.

---

### Q19. Semantic tool search

With hundreds of tools, putting all definitions in the prompt wastes tokens and confuses the model. Gateway can expose a built-in **search tool**: the agent searches by task description and gets only relevant tools. Cheaper, faster, better tool selection.

```flow
sequence: Semantic tool search
actors: Agent, Gateway, Tool index
Agent -> Gateway: x_amz_bedrock_agentcore_search("refund an order")
Gateway -> Tool index: semantic search over 300 tool descriptions
Tool index --> Gateway: top 5 relevant tools
Gateway --> Agent: just those 5 definitions
Agent -> Gateway: call the chosen tool
> Only relevant tools enter the prompt: fewer tokens, better choices.
```

---

### Q20. Interceptors and fine-grained access control

**Interceptors** (e.g., Lambda) run at the Gateway boundary to inspect/transform/reject requests and responses: redact PII, add headers, filter tools per user, log. **Fine-grained access control** can filter which tools a caller sees/uses based on token claims. These complement, not replace, authorisation inside the target system.

```flow
pipeline: Interceptors at the Gateway boundary
Request arrives > Tool call with arguments.
Request interceptor (Lambda) > Inspect, rewrite, enrich or reject: e.g. add tenant scope, block fields.
Target runs > If allowed.
Response interceptor > Redact PII, trim output before the agent sees it.
```

---

### Q21. Gateway vs a custom MCP server

```flow
pipeline: Gateway + custom MCP server together
Custom MCP server > Your own tool logic.
Host on Runtime (MCP protocol) > Isolated, scalable.
Add as Gateway target > Gets inbound auth, policy, search, observability.
Agents see one endpoint > With all tools, managed and custom.
```

| Use Gateway when | Use a custom MCP server when |
|---|---|
| wrapping existing REST/Lambda/SaaS APIs as tools quickly | tool logic is custom (multi-step, stateful handles, streaming) |
| you want central inbound/outbound auth, policy, audit, tool search | you need protocol features Gateway doesn't expose |
| many teams share tools | single team, simple internal tool |

They combine well: host the custom MCP server on **Runtime** (MCP protocol) and add it as a **Gateway target**.

---

## 5. Identity & authentication

### Q22. What is AgentCore Identity?

**Short answer:** Identity and credential management **for agents**. It provides:
- **Inbound auth** for Runtime/Gateway: JWT authorizer (OIDC discovery URL, allowed audiences/clients) for Cognito, Okta, Entra ID, Auth0…, or IAM SigV4.
- **Workload identities** — each agent gets its own identity.
- **Credential providers + token vault** — securely store OAuth client configs/API keys and the tokens obtained, so agent code never handles raw secrets.
- **Outbound OAuth flows:** **2LO** (client credentials, agent acts as itself) and **3LO** (authorization code, user consents and the agent acts **on behalf of the user**), with consent portal support.

```flow
pipeline: What AgentCore Identity handles
Inbound auth > JWT authorizers (Okta, Entra, Cognito) or IAM for Runtime/Gateway.
Workload identity > The agent's own identity.
Token vault > Stores OAuth tokens / API keys for outbound calls.
2LO / 3LO flows > Machine credentials or user-consented tokens.
```

---

### Q23. 2LO vs 3LO (machine vs user-delegated)

```flow
sequence: 3LO: the agent acts as the user
actors: User, Agent, AgentCore Identity, Google/Slack/GitHub
Agent -> AgentCore Identity: need a token for this user
AgentCore Identity --> User: consent URL
User -> Google/Slack/GitHub: sign in + consent in browser
Google/Slack/GitHub --> AgentCore Identity: token for the USER (stored in token vault)
Agent -> Google/Slack/GitHub: "read MY calendar" with the user's token
> The API enforces the user's own permissions. 2LO is different: the agent uses its own client_id/secret and acts as a service identity (internal APIs, batch jobs).
```

```
 2LO (machine-to-machine)                        3LO (on behalf of a user)
 agent ─client_id/secret─► IdP ─► token          user ─consents in browser─► IdP ─► token for USER
 acts as the agent's service identity            agent acts with the USER's permissions in Google/Slack/GitHub
 use: internal APIs, batch jobs                   use: "read MY calendar", "post as ME"
```
3LO is better for least privilege: the downstream system enforces the user's own permissions.

```python
from bedrock_agentcore.identity.auth import requires_access_token

@requires_access_token(provider_name="google", scopes=["calendar.readonly"], auth_flow="USER_FEDERATION")
async def list_events(*, access_token: str):
    # token fetched from the vault for the current user; if no consent yet, an auth URL is returned to the user
    return await google_calendar.list(access_token)
```

---

### Q24. Integrating Okta / Entra ID / Cognito

Configure the Runtime (or Gateway) inbound **JWT authorizer** with the IdP's OIDC discovery URL and allowed audiences/client IDs. Runtime validates signature, issuer, audience and expiry. Your app still maps verified claims (sub, groups) to permissions; pass needed claims to tools via trusted context, never via the prompt.

```flow
sequence: Okta-protected agent invocation
actors: User, React, Okta, AgentCore Runtime
User -> Okta: sign in (OIDC + PKCE)
Okta --> React: access token (JWT)
React -> AgentCore Runtime: invoke + Bearer JWT
AgentCore Runtime -> Okta: (cached) discovery + signing keys
AgentCore Runtime -> AgentCore Runtime: check issuer, audience/client, expiry, signature
AgentCore Runtime --> React: response (or 401/403)
```

---

### Q25. Keep identities distinct (avoid confusion)

```flow
pipeline: Four identities, never mixed
End user > Okta sub + groups: who is asking.
Backend API role (IAM) > Calls InvokeAgentRuntime.
Agent execution role (IAM) > What the agent's code may touch in AWS.
Workload / outbound credentials > What the agent may do in Jira, Slack…
```

```
 End user (Okta sub, groups)        ── who is asking
 Backend API role (IAM)             ── calls InvokeAgentRuntime
 Runtime execution role (IAM)       ── what the agent code can touch in AWS (Bedrock, Memory, S3…)
 Agent workload identity            ── the agent's identity for outbound OAuth
 Gateway inbound principal          ── who calls the gateway
 Target credentials (OAuth/API key) ── what the tool call can do downstream
```
Least privilege for each. The execution role should **not** have broad S3/DB access "just in case" — any code in the session (including prompt-injected behaviour) can use it.

---

### Q26. Pass user context to the agent safely

Validate the user at the edge; pass identity as **verified claims** (JWT propagated via allowlisted headers, or your backend's signed context). Tools authorise against those claims. Never let the model supply `user_id`.

```flow
pipeline: Passing user context safely
Validate at the edge > Your API verifies the JWT.
Forward verified claims > Allowlisted header / forwarded JWT, set by your server.
Agent reads claims from request context > Never from the prompt or model output.
Use for authZ + memory namespace > actorId = verified user sub.
```

---

## 6. Memory

### Q27. What does AgentCore Memory provide?

**Short answer:** Managed memory for agents.
- **Short-term memory:** raw conversation **events** (turns, tool results) per `actorId` + `sessionId` — for multi-turn context.
- **Long-term memory:** asynchronously **extracted records** stored in **namespaces** — via strategies.

```flow
sequence: Short-term events become long-term memory
actors: Agent, Short-term events, Extraction strategy, Long-term records
Agent -> Short-term events: CreateEvent(actorId=u1, sessionId=s9, "I prefer window seats")
Short-term events -> Extraction strategy: async extraction
> Runs in the background with the strategies you configured: user preference, semantic facts, summaries.
Extraction strategy -> Long-term records: /users/u1/preferences → "prefers window seats"
Agent -> Long-term records: next session: RetrieveMemoryRecords(namespace, "seat preference")
Long-term records --> Agent: "prefers window seats"
```

---

### Q28. Long-term memory strategies

```flow
pipeline: Long-term memory strategies
Events written > Raw conversation turns (short-term).
Strategies extract async > Semantic facts, user preferences, session summaries, or your custom prompt.
Records in namespaces > E.g. /users/{actorId}/preferences.
Retrieve by query > Relevant records injected into the next session. Extraction takes a little time.
```

| Strategy | Extracts |
|---|---|
| **Semantic** | facts/knowledge from conversations |
| **Summary** | running summaries of sessions |
| **User preference** | user likes/choices/settings |
| **Episodic** | experiences/episodes (what happened, outcome) for learning from past interactions |
| **Built-in with overrides / custom** | your own extraction/consolidation prompts and model |
| **Self-managed** | you run extraction yourself; Memory stores the results |

Extraction is **asynchronous** (records appear shortly after events). Memory is encrypted (optionally with your KMS key); events have configurable expiry.

---

### Q29. Memory with LangGraph

Use the AgentCore Memory **checkpointer/store integrations** for LangGraph (short-term → checkpoints/events, long-term → store) or call the Memory APIs from nodes. Namespace by verified user/tenant.

```flow
pipeline: AgentCore Memory with LangGraph
Short-term > Memory-backed checkpointer / events per session.
Long-term > Memory-backed store for cross-session records.
actorId > The verified user.
Graph unchanged > Swap the saver/store; nodes stay the same.
```

---

### Q30. Isolating and auditing memory

Derive `actorId` from the **verified identity**, never from model output; namespace per tenant/user; IAM conditions to restrict which namespaces a runtime role can access; validate extracted facts (could be poisoned via injection); support user deletion; set retention; audit with CloudTrail.

```flow
pipeline: Isolating and auditing memory
actorId from verified identity > Never from the model.
Namespace per tenant/user > Paths like /tenants/t1/users/u1/…
IAM conditions > Restrict which namespaces a role can read/write.
CloudTrail + retention > Audit access; delete per user on request.
```

---

## 7. Built-in tools: Code Interpreter & Browser

### Q31. Code Interpreter

A managed **sandbox** where agents run Python/JavaScript/TypeScript for calculations, data analysis, charts and file processing. Session-based, isolated, with configurable network mode (sandbox/no internet vs public). Use it instead of `exec()` in your agent container. Data uploaded is untrusted — keep network restricted for sensitive data.

```flow
sequence: Agent uses Code Interpreter
actors: Agent, Code Interpreter sandbox
Agent -> Code Interpreter sandbox: start session
Agent -> Code Interpreter sandbox: run Python: load CSV, compute stats, plot
Code Interpreter sandbox --> Agent: stdout, files (chart.png)
Agent -> Code Interpreter sandbox: stop session
> Isolated sandbox: untrusted, model-written code never runs inside your service.
```

---

### Q32. Browser

A managed, isolated **cloud browser** the agent can drive (Playwright, Browser Use, Nova Act) to navigate sites, fill forms and extract information; supports live view and session recording for audit. Risks: web pages contain **indirect prompt injection**; restrict domains, avoid giving it credentials it doesn't need, require approval for form submissions with side effects.

```flow
sequence: Agent drives the managed Browser
actors: Agent, Browser session, Website
Agent -> Browser session: start (isolated cloud browser)
Agent -> Browser session: Playwright / Nova Act: open page, fill form
Browser session -> Website: real browser traffic
Website --> Browser session: page content
Browser session --> Agent: extracted data / screenshot
> Live view and recordings for audit; page content is untrusted input.
```

---

## 8. Policy, Observability, Evaluations, Optimization, Registry, Payments

### Q33. AgentCore Policy

**Short answer:** Deterministic authorisation **outside the agent's code**. You create a **policy engine**, write policies in **Cedar** (or natural language that's translated to Cedar and validated with automated reasoning, or the Cedar-compatible **Dogwood** language), and associate it with a **Gateway**. Every tool call through the gateway is evaluated against principal, tool, resource and **input parameters**. Supports **temporal policies** (session history: "approval must precede transfer", "max 3 refunds per session", running budget) and **guardrail signals** (e.g., prompt-attack score) as conditions. Decisions are logged to CloudWatch.

```flow
sequence: AgentCore Policy on a tool call
actors: Agent, Gateway, Policy engine
Agent -> Gateway: refund(order=A12, amount=900)
Gateway -> Policy engine: evaluate (principal, action, resource, context)
Policy engine -> Policy engine: Cedar rule: refunds above 500 → forbid for role "agent"
Policy engine --> Gateway: DENY
Gateway --> Agent: error: not permitted
> Deterministic, outside the agent's code, logged for audit.
```

```cedar
// Only users in the "refund-approvers" group may issue refunds, and only up to 500
permit (
  principal,
  action == AgentCore::Action::"billing___issue_refund",
  resource
) when {
  principal.getTag("groups") like "*refund-approvers*" &&
  context.input.amount <= 500
};
```
(Exact entity/attribute names depend on the gateway schema — the service validates policies against tool schemas.)

**Why it matters:** prompt injection can make the model *request* anything; policy at the gateway makes sure it can only *do* what's allowed.

---

### Q34. Observability

Runtime, Gateway, Memory and tools emit **OpenTelemetry** traces/metrics/logs into **CloudWatch** (GenAI observability dashboards): sessions, traces, spans for model calls and tool calls, latency, tokens, errors. Instrument your framework with OTel/OpenInference (ADOT) for agent-internal spans; correlate with your API's trace ID. Redact sensitive payloads.

```flow
pipeline: Observability path
Runtime, Gateway, Memory, tools > Emit OpenTelemetry spans, metrics, logs.
CloudWatch > GenAI observability dashboards.
One trace per request > API → agent → gateway → tool.
Alarms > Errors, latency, token spend.
```

---

### Q35. Evaluations

Managed evaluation of agent quality on **sessions, traces and spans** (Strands, LangGraph via OTel/OpenInference): built-in evaluators (correctness, helpfulness, goal success, tool selection/parameter accuracy, faithfulness, harmfulness…) and custom LLM-judge or code evaluators; **online** (sample production traffic) and **on-demand** (datasets). Results land in CloudWatch.

```flow
pipeline: Evaluations
Collect traces > Sessions, traces and spans via OTel.
Built-in / custom evaluators > Helpfulness, correctness, tool selection, safety.
Online (sampled) or on-demand > Score production traffic or test sets.
Dashboards + alarms > Catch quality regressions.
```

---

### Q36. Optimization

Builds on Evaluations: analyses traces to generate **recommendations** (system prompt, tool descriptions), packages them as versioned configuration bundles, and runs **A/B tests** (traffic splitting through Gateway) with statistical significance per session.

```flow
cycle: Optimization loop
Analyse traces > Using evaluation results.
Recommendations > Better system prompt, tool descriptions.
Package as versions > Testable configuration changes.
A/B test > Compare against the current version.
exit > Promote the winner; repeat as behaviour drifts.
```

---

### Q37. Registry

A central **catalog** of agents, MCP servers, tools, skills and custom resources across the organisation, with publish → review → approve workflow and hybrid semantic/keyword search. Helps governance ("only approved MCP servers") and reuse.

```flow
pipeline: Registry lifecycle
Publish > Agent, MCP server, tool or skill metadata.
Review > Owners and security approve.
Approved in catalog > Discoverable across the organisation.
Reuse > Teams find existing agents/tools instead of rebuilding.
```

---

### Q38. Payments

Lets agents pay for paid APIs/MCP servers/content via the **x402** and **Machine Payments Protocol (MPP)** with wallet providers, spending limits and observability. Relevant mainly for agents consuming paid third-party services; always set spending caps.

```flow
sequence: An agent paying for an API call
actors: Agent, Paid API, Wallet provider
Agent -> Paid API: request
Paid API --> Agent: 402 Payment Required (price, terms)
Agent -> Wallet provider: pay within spend limits (x402 / MPP)
Wallet provider --> Agent: payment proof
Agent -> Paid API: retry with proof
Paid API --> Agent: content
```

---

### Q39. Managed knowledge/retrieval with agents

Expose retrieval as a tool: a Bedrock Knowledge Base (via a Lambda/OpenAPI target or integration) behind Gateway, or your own retriever MCP server. Same rules as any RAG: ACL filtering by verified identity, freshness, evaluation.

```flow
pipeline: Retrieval as a governed tool
Knowledge Base > Bedrock KB or your search service.
Exposed via Gateway > Lambda / OpenAPI target.
Filter by user > Tenant + ACL filters from verified identity.
Agent calls "search_docs" > Gets only allowed chunks, with citations.
```

---

## 9. Architecture, security & trade-offs

### Q40. End-to-end reference architecture (React → API → AgentCore → tools)

```flow
sequence: Walk one chat request through the reference architecture
actors: User, React, FastAPI (ECS), AgentCore Runtime, Gateway, Tools
User -> React: OIDC login via Okta → JWT
React -> FastAPI (ECS): HTTPS/SSE + JWT
FastAPI (ECS) -> FastAPI (ECS): verify JWT, rate-limit, check conversation ownership
> Maps the user to their session/thread; conversations live in DynamoDB.
FastAPI (ECS) -> AgentCore Runtime: InvokeAgentRuntime
> LangGraph agent in a per-session microVM; checkpoints in Aurora, Memory keyed by the user's sub.
AgentCore Runtime -> Gateway: MCP + workload token
Gateway -> Gateway: inbound JWT, Cedar policy, PII-redacting interceptor
Gateway -> Tools: IAM → Lambda · OAuth 3LO → Jira · API key → internal API
Tools --> React: results stream back up the chain
> One trace ID across API → Runtime → Gateway → tools.
```

```
 ┌─────────┐  OIDC login   ┌────────┐
 │  User   │──────────────►│ Okta   │
 └────┬────┘               └────────┘
      │ JWT
 ┌────▼──────────────┐  HTTPS/SSE  ┌──────────────────────────┐
 │ React (CloudFront)│────────────►│ FastAPI on ECS (ALB)      │  verify JWT, rate-limit,
 └───────────────────┘             │  conversation ownership   │  map user→session/thread,
                                   │  DynamoDB: conversations  │  approvals API
                                   └────────────┬──────────────┘
                                                │ InvokeAgentRuntime (IAM SigV4 or forwarded JWT)
                                   ┌────────────▼──────────────┐
                                   │ AgentCore Runtime          │  microVM per session
                                   │  LangGraph agent           │  checkpointer → Aurora Postgres
                                   │  execution role (least     │  Memory (actorId = user sub)
                                   │  privilege)                │
                                   └────────────┬──────────────┘
                                                │ MCP + workload token
                                   ┌────────────▼──────────────┐
                                   │ AgentCore Gateway          │  inbound JWT, Policy (Cedar),
                                   │                            │  interceptor (PII redaction)
                                   └──┬─────────┬──────────┬────┘
                                      │IAM      │OAuth 3LO │API key
                                   Lambda    Jira (as user) internal REST API
                                   (S3/Textract)
 Observability: OTel spans API → Runtime → Gateway → tools, one trace ID; Evaluations on sampled sessions
```

---

### Q41. Shared responsibility model

**AWS:** infrastructure, microVM isolation, service availability, managed auth plumbing, encryption at rest.
**You:** agent code and dependencies (container supply chain), execution-role permissions, session↔user mapping, tool authorisation, Cedar policies, prompt-injection defences, data classification/retention, secrets in the token vault (not env vars), what you log.

```flow
pipeline: Shared responsibility for agents
AWS > Infrastructure, microVM isolation, availability, auth plumbing, encryption at rest.
You: identity mapping > Users ↔ sessions, authorisation.
You: tools + policies > Least privilege, Cedar rules, approvals.
You: data + prompts > What is stored, retention, prompt-injection defences, evaluation.
```

---

### Q42. Limits of microVM isolation

Isolation protects **sessions from each other**. It does **not** stop code inside a session from using the session's IAM role and network access. If a prompt-injected agent can call `s3:GetObject` on `*`, isolation won't help. Combine with least-privilege roles, VPC/egress controls, Gateway Policy, and approval for sensitive tools.

```flow
pipeline: What microVM isolation does and doesn't stop
Stops > One session reading another session's memory or files.
Doesn't stop > Code inside a session using that session's credentials.
Prompt injection > Can still trigger the agent's allowed tools.
So add > Least-privilege roles, policy on tool calls, approvals.
```

---

### Q43. ECS/Lambda vs AgentCore Runtime

```flow
pipeline: Where each piece usually runs
FastAPI on ECS > The BFF: auth, ownership, rate limits.
Agents on AgentCore Runtime > Per-session isolation, identity, memory.
Tools as Lambda behind Gateway > Least privilege, scale to zero.
Heavy batch pipelines > Step Functions / ECS workers.
```

| Choose | When |
|---|---|
| **AgentCore Runtime** | per-user isolated, stateful agent sessions; long reasoning (minutes–hours); agent protocols (MCP/A2A/AG-UI); want built-in identity/observability; spiky traffic with I/O-wait-friendly billing |
| **ECS/Fargate** | always-on APIs, background workers, full control of networking/runtime, existing platform; can still host agents |
| **Lambda** | short (≤15 min) stateless tool functions, event handlers — e.g., Gateway Lambda targets |

Common: FastAPI on ECS as the BFF, agents on AgentCore Runtime, tools as Lambda behind Gateway.

---

### Q44. Governing changes (models, prompts, tools, policies)

Version everything (Runtime versions/endpoints, Harness versions, Gateway target schemas, Cedar policies, prompts); deploy via CI/CD with IaC; run Evaluations as a release gate; canary via endpoint switching or Optimization A/B tests; roll back by pointing the endpoint at the previous version; review custom images and skills for supply-chain risk.

```flow
pipeline: Governing agent changes
Version everything > Runtime versions, Harness versions, prompts, tool schemas, policies.
Evaluate before release > Eval suite on the candidate.
Staged rollout > Endpoint per environment; canary.
Audit + rollback > Who changed what; move endpoints back instantly.
```

---

### Q45. Evaluating a new AgentCore feature before adopting

Check: GA vs preview, region availability, quotas, pricing model, IAM/auth details, observability, compliance (data residency, logging of content), exit path (portability of your agent code), and run a benchmark of your real workload vs current architecture.

```flow
pipeline: Vetting a new AgentCore feature
GA or preview? > Preview = no production SLA.
Region + quotas + pricing > Available where you run? Limits fit?
Security model > IAM, auth, data handling, logging.
Prototype + eval > Measure against your use case.
Exit plan > How hard is it to switch away?
```

---

## 10. Scenario & debugging questions

### Q46. An AgentCore invocation returns 403, but the agent works locally

Separate **caller** denies from **tool** denies:
1. CloudTrail: is `InvokeAgentRuntime` denied? Check caller IAM policy (`bedrock-agentcore:InvokeAgentRuntime` on the right runtime ARN + endpoint qualifier, correct region).
2. If JWT inbound auth: issuer/discovery URL, audience/client ID allowed, token expired, using SigV4 vs bearer token correctly.
3. If the error comes from inside the agent: the **execution role** lacks permissions (Bedrock model access, Memory, S3) — check logs.
4. If a tool fails: Gateway inbound/outbound auth or Policy deny.

```flow
pipeline: 403 on invoke, works locally
CloudTrail: InvokeAgentRuntime denied? > Caller's IAM policy, resource policy, SCPs.
JWT authorizer? > Issuer, audience/client ID, expiry, token type (access vs ID).
Tool-level 403? > Agent execution role or Gateway outbound credentials.
Network / VPC config > Endpoints, security groups for VPC mode.
```

---

### Q47. A user sees another user's previous conversation

**Severity-1 incident.** Contain (disable feature/route), then inspect: backend session/thread mapping (reused or client-supplied IDs?), caches keyed without user, Memory `actorId` derived from untrusted input, LangGraph `thread_id` ownership checks. Fix with server-generated IDs + ownership checks, add regression tests, assess impact, notify per policy.

```flow
pipeline: User sees another user's conversation
Contain > Disable the feature or route now (severity 1).
Session/thread mapping > Client-chosen session IDs? Missing ownership check?
Caches > Cache keys without user/tenant?
Memory namespaces > actorId taken from the model or request body?
Fix + verify + notify > Patch, test cross-user access, follow the incident process.
```

---

### Q48. A Gateway tool is listed but every call fails with auth errors

Test layer by layer: inbound token valid for gateway? → Policy decision (CloudWatch logs: deny?) → outbound credential provider configured (OAuth scopes, client secret, 3LO consent completed for this user?) → target accepts the credential (call it directly) → tool schema/endpoint correct. Use correlation IDs; never log tokens.

```flow
pipeline: Gateway tool listed but every call fails auth
Inbound token valid for the gateway? > Audience/issuer.
Policy decision > CloudWatch logs: denied by Cedar?
Outbound credentials > Credential provider configured? OAuth token present for this user?
Target permissions > Lambda resource policy / API key scope.
```

---

### Q49. After 20 minutes of inactivity, the agent "forgets" the conversation and a pending approval

Idle timeout (15 min default) stopped the microVM; state lived only in process memory (`InMemorySaver`). Fix: durable checkpointer (Postgres/DynamoDB/AgentCore Memory saver) keyed by a stable `thread_id`; optionally tune idle timeout or use session storage. Approvals stored durably in your DB.

```flow
trace: Agent forgets after 20 minutes idle
t=0: conversation + pending approval held **in microVM memory** > State lived only inside the session.
t=15 min idle: session stopped, microVM destroyed > Idle timeout.
t=20 min: invoke → **new microVM, empty state** > Memory and approval are gone.
fix: durable checkpointer + AgentCore Memory; approvals stored in your DB > Then a new microVM resumes from saved state.
```

---

### Q50. Cold-start latency complaints

Reuse session IDs for follow-ups (stickiness), keep images small, lazy-load heavy libraries, use Runtime platform V2 (snapshot start), pre-warm sessions for known users if justified, stream early status events to the UI.

```flow
pipeline: Reducing cold-start latency
Reuse session IDs > Follow-ups hit the warm microVM.
Smaller image > Faster pull and start.
Lazy-load heavy libraries > Import inside functions where possible.
Stream early > Send a first token or status quickly.
```

---

### Q51. Agent costs are higher than expected

Check CloudWatch: session durations (agents left in `HealthyBusy`?), token usage per session, tool loops, oversized prompts (enable semantic tool search instead of listing all tools), Memory extraction strategies running on every event, Browser/Code Interpreter sessions not stopped. Add budgets and limits in the agent loop.

```flow
pipeline: Agent cost higher than expected
Session durations > Agents stuck in HealthyBusy?
Tokens per session > Long histories, big tool outputs.
Tool loops > Repeated calls.
Model choice > Expensive model for simple steps.
Fix > Summarise, cap steps, route models, end sessions.
```

---

### Q52. How would you migrate an existing LangGraph app on ECS to AgentCore?

Keep the graph; wrap with `BedrockAgentCoreApp`; move checkpointer to a managed durable store; expose tools via Gateway instead of in-process clients with broad credentials; set inbound JWT auth; move secrets/OAuth to Identity; add OTel instrumentation; run both stacks in parallel on the same eval set; shift traffic gradually via the backend.

```flow
pipeline: Migrating a LangGraph app from ECS to AgentCore
Keep the graph > No rewrite.
Wrap with BedrockAgentCoreApp > Entrypoint calls graph.invoke/stream.
Move state out > Durable checkpointer (Postgres / Memory-backed).
Tools behind Gateway > With Identity for outbound auth.
Cut over gradually > BFF routes a share of users; compare metrics.
```

---

## 11. Cheat sheet

| Service | One-liner |
|---|---|
| Harness | config-defined managed agent loop (Strands), microVM per session |
| Runtime | host your agent/MCP/A2A/AG-UI server; microVM per session; ≤8 h (Instances ≤14 days); 100 MB payloads |
| Session | ≥33-char ID; idle 15 min / max 8 h default; **you** map users→sessions |
| Contract | HTTP :8080 `/invocations` `/ping`; MCP :8000 `/mcp`; A2A :9000 `/`; ARM64 |
| Gateway | APIs/Lambda/OpenAPI/Smithy/MCP → one MCP endpoint; inbound + outbound auth; tool search |
| Identity | JWT inbound auth, workload identity, token vault, OAuth 2LO/3LO |
| Memory | short-term events + long-term strategies (semantic, summary, preference, episodic, custom) |
| Code Interpreter / Browser | managed sandboxes for code and web |
| Policy | Cedar rules on every Gateway tool call; temporal & guardrail conditions |
| Observability | OTel → CloudWatch |
| Evaluations / Optimization | score sessions; A/B test prompt/tool-description changes |
| Registry / Payments | catalog of agents/tools/skills; agent micropayments |
| Golden rules | session ID ≠ auth; durable state outside microVM; least-privilege execution role; policy outside the model |

## Official references

- What is AgentCore: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html
- Runtime: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agents-tools-runtime.html
- Sessions: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-sessions.html
- Service contract: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-service-contract.html
- Harness: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/harness.html
- Gateway: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway.html
- Identity: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/identity.html
- Memory: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory.html
- Policy: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy.html
