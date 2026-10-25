# LangGraph: L2 → L3 Interview Preparation

> **Updated:** 24 October 2026 (LangGraph **v1.x**) · **Level:** graph basics → persistence & HITL → multi-agent → production
> **How to use:** *Short answer* = what you say first. *Explanation / Example* = intuition and code. *Pitfall / Follow-up* = where interviewers dig.

---

## Table of contents

1. [Mental model: how LangGraph executes](#1-mental-model-how-langgraph-executes)
2. [Fundamentals: state, nodes, edges](#2-fundamentals-state-nodes-edges) (Q01–Q09)
3. [Persistence: checkpointers, threads, store](#3-persistence-checkpointers-threads-store) (Q10–Q15)
4. [Human-in-the-loop: interrupt & Command](#4-human-in-the-loop-interrupt--command) (Q16–Q19)
5. [Control flow: parallelism, Send, subgraphs, multi-agent](#5-control-flow-parallelism-send-subgraphs-multi-agent) (Q20–Q26)
6. [Streaming, errors, functional API](#6-streaming-errors-functional-api) (Q27–Q31)
7. [Production engineering](#7-production-engineering) (Q32–Q38)
8. [Scenario & debugging questions](#8-scenario--debugging-questions) (Q39–Q44)
9. [Cheat sheet](#9-cheat-sheet)

---

## 1. Mental model: how LangGraph executes

**LangGraph = a state machine for LLM apps.** You define a shared **state**, **nodes** (functions that read state and return updates) and **edges** (which node runs next). Unlike a simple chain, graphs can **loop**, **branch**, run **in parallel**, **pause for humans**, and **resume after crashes**.

**A typical agent graph:**
```flow
pipeline: One run through the example graph
START > Input enters the graph with a thread_id.
classify > A deterministic or LLM router decides the path.
Route (conditional edge) > Simple question → direct answer. Needs tools → agent. Risky action → approval gate.
agent ⇄ tools loop > The agent calls tools and loops back until no tool calls remain.
approval gate > `interrupt()` pauses here and saves state; a human approves later.
execute > Runs only after approval.
END > Every path ends here; each step was checkpointed along the way.
```

```
                 ┌──────────────┐
      START ───► │  classify    │  (deterministic or LLM router)
                 └──────┬───────┘
          conditional   │
        ┌───────────────┼──────────────────────┐
        ▼               ▼                      ▼
  ┌──────────┐   ┌─────────────┐        ┌─────────────┐
  │ direct   │   │  agent      │◄──┐    │ approval    │  ← interrupt(): pause, wait for human
  │ answer   │   │  (LLM)      │   │    │ gate        │
  └────┬─────┘   └─────┬───────┘   │    └──────┬──────┘
       │      tool calls? │ yes    │           │ approved
       │               ▼          │           ▼
       │         ┌──────────┐     │    ┌─────────────┐
       │         │  tools   │─────┘    │ execute     │
       │         └──────────┘  (loop)  └──────┬──────┘
       │               │ no more tools        │
       └───────────────┴──────────┬───────────┘
                                  ▼
                                 END
```

**Execution engine (Pregel-style "super-steps"):**
```flow
cycle: Super-steps: how LangGraph executes
Run scheduled nodes > All nodes scheduled for this step run (in parallel if there are several).
Collect updates > Each node returns a partial state update.
Apply reducers > Updates are merged into state with each key's reducer (e.g. append messages).
Save checkpoint > State + next nodes are persisted for this thread_id.
Follow edges > Normal and conditional edges schedule the next nodes.
exit > No nodes left (END), an `interrupt()`, or `recursion_limit` reached.
```
**Why super-steps matter:** nodes in the same step run in parallel and don't see each other's updates until the step ends; a checkpoint after each step lets you resume, time-travel and pause.

**Persistence layer:**
```
 graph.invoke(input, config={"configurable": {"thread_id": "conv-42"}})
                         │
                         ▼
   ┌─────────────────── Checkpointer (Postgres / Redis / SQLite / DynamoDB-based) ─────────────┐
   │ thread "conv-42":  ckpt-1 ─► ckpt-2 ─► ckpt-3 (interrupted, waiting for approval) ...       │
   │   each checkpoint = full state values + next nodes + pending writes + metadata              │
   └────────────────────────────────────────────────────────────────────────────────────────────┘
   ┌─────────────────── Store (long-term memory, shared across threads) ─────────────────────────┐
   │ namespace ("users", "u1", "prefs") → {"format": "csv"}   (optionally vector-searchable)       │
   └────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Fundamentals: state, nodes, edges

### Q01. What is LangGraph and what problem does it solve?

**Short answer:** A low-level orchestration framework for **stateful, long-running, controllable** agents and workflows. It gives you explicit control flow (cycles, branches, parallelism) plus built-in **persistence, human-in-the-loop, streaming and durable execution**. It mixes deterministic code and LLM decisions in one graph.

**Why not just a while-loop?** You could write one, but you'd have to build checkpointing, resume-after-crash, pause/approve, streaming of intermediate steps, parallel fan-out, and time-travel debugging yourself.

---

### Q02. What is `StateGraph` and what is state?

**Short answer:** `StateGraph(State)` is the graph builder. **State** is a typed schema (TypedDict, dataclass or Pydantic) shared by all nodes. Nodes receive the current state and return a **partial update** (only the keys they change).

```python
from typing import Annotated, TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages

class State(TypedDict):
    messages: Annotated[list, add_messages]   # reducer: append/merge messages
    route: str                                # no reducer: last write wins
    documents: list[dict]
```

---

### Q03. Nodes and edges

**Short answer:** **Nodes** are functions (sync/async) or runnables: `def node(state) -> dict`. **Edges** define what runs next: normal edges (always), **conditional edges** (a function picks the next node), and special `START`/`END`.

```python
def classify(state: State) -> dict:
    q = state["messages"][-1].content
    return {"route": "rag" if "policy" in q.lower() else "direct"}

def rag(state: State) -> dict: ...
def direct(state: State) -> dict: ...

builder = StateGraph(State)
builder.add_node("classify", classify)
builder.add_node("rag", rag)
builder.add_node("direct", direct)
builder.add_edge(START, "classify")
builder.add_conditional_edges("classify", lambda s: s["route"], {"rag": "rag", "direct": "direct"})
builder.add_edge("rag", END)
builder.add_edge("direct", END)
graph = builder.compile()
```
The mapping dict `{"rag": "rag", ...}` documents **allowed destinations** — good for safety and graph visualisation.

---

### Q04. How do reducers work?

**Short answer:** A reducer decides how a node's update merges into existing state for a key. **Without a reducer, the new value overwrites.** With `Annotated[list, operator.add]`, lists concatenate. `add_messages` appends new messages, updates messages with the same ID, and handles removals.

```python
import operator
class State(TypedDict):
    evidence: Annotated[list[dict], operator.add]   # parallel branches can each append
    summary: str                                    # overwrite

# Custom reducer: merge + dedupe by id
def merge_by_id(old: list[dict], new: list[dict]) -> list[dict]:
    seen = {d["id"]: d for d in old}
    seen.update({d["id"]: d for d in new})
    return list(seen.values())
```
**Pitfall:** two parallel nodes writing the same key **without** a reducer → `InvalidUpdateError` (LangGraph can't know which value wins).

---

### Q05. `MessagesState` and message handling

**Short answer:** A prebuilt state with `messages: Annotated[list[AnyMessage], add_messages]`. Extend it with your own fields.

```python
from langgraph.graph import MessagesState
class AgentState(MessagesState):
    selected_doc_ids: list[str]
    plan: list[str]
```
Remove messages by returning `RemoveMessage(id=...)` (useful for trimming history).

---

### Q06. Compile, invoke, stream

```python
graph = builder.compile(checkpointer=saver, store=store)   # validates wiring, attaches persistence
result = graph.invoke({"messages": [("user", "hi")]}, config={"configurable": {"thread_id": "t1"}})
for update in graph.stream(inputs, config, stream_mode="updates"): ...
await graph.ainvoke(...)
graph.get_graph().draw_mermaid_png()       # visualise
```
Compile-time options also include `interrupt_before/after=[...]` (static breakpoints, mostly for debugging).

---

### Q07. The ReAct agent loop in LangGraph (build it yourself)

```python
from langgraph.prebuilt import ToolNode, tools_condition

model_with_tools = model.bind_tools(tools)

def agent(state: MessagesState):
    return {"messages": [model_with_tools.invoke(state["messages"])]}

b = StateGraph(MessagesState)
b.add_node("agent", agent)
b.add_node("tools", ToolNode(tools))            # executes tool_calls, returns ToolMessages
b.add_edge(START, "agent")
b.add_conditional_edges("agent", tools_condition)   # → "tools" if tool_calls else END
b.add_edge("tools", "agent")                    # the loop
graph = b.compile(checkpointer=saver)
```
(LangChain's `create_agent` gives you this prebuilt plus middleware.)

---

### Q08. Recursion limit

**Short answer:** Every run has a `recursion_limit` (max super-steps; default 25-ish depending on version) to stop infinite loops. Exceeding it raises `GraphRecursionError`. Set per run: `config={"recursion_limit": 50}`. Also add your own business limits (e.g., `iterations` counter in state) for graceful exits.

---

### Q09. Config and runtime context

**Short answer:** `config["configurable"]` carries run settings such as `thread_id`. **Runtime context** (`context_schema`) passes trusted, per-run dependencies (user ID, tenant, DB clients) to nodes — not part of persisted state, not visible to the model.

```python
from dataclasses import dataclass
from langgraph.runtime import Runtime

@dataclass
class Ctx:
    user_id: str
    tenant_id: str

def fetch(state: State, runtime: Runtime[Ctx]):
    docs = search(state["messages"][-1].content, tenant=runtime.context.tenant_id)
    return {"documents": docs}

graph = StateGraph(State, context_schema=Ctx)...compile()
graph.invoke(inputs, config, context=Ctx(user_id="u1", tenant_id="t1"))
```

---

## 3. Persistence: checkpointers, threads, store

### Q10. What is a checkpointer?

**Short answer:** A checkpointer saves a **snapshot of graph state after every super-step**, keyed by `thread_id`. It enables: conversation memory, human-in-the-loop (pause/resume), fault tolerance (resume after crash), and time travel (replay/fork past states).

| Checkpointer | Use |
|---|---|
| `InMemorySaver` | tests/notebooks only (lost on restart) |
| `SqliteSaver` | local/dev |
| `PostgresSaver` / `AsyncPostgresSaver` | production standard |
| Redis, MongoDB, community DynamoDB/AgentCore Memory savers | other production options |

```python
from langgraph.checkpoint.postgres import PostgresSaver
with PostgresSaver.from_conn_string(DB_URI) as saver:
    saver.setup()                      # create tables once
    graph = builder.compile(checkpointer=saver)
```

---

### Q11. What is a `thread_id`?

**Short answer:** The key that groups checkpoints into one conversation/workflow. Same thread ID → continue where it left off. It is **not** an auth token: your API must verify the user owns the thread before invoking.

```python
@app.post("/chat/{conversation_id}")
def chat(conversation_id: str, body: Msg, user=Depends(current_user)):
    conv = db.get_conversation(conversation_id)
    if conv is None or conv.owner_id != user.id:
        raise HTTPException(403)                      # check BEFORE touching the graph
    return graph.invoke({"messages": [("user", body.text)]},
                        {"configurable": {"thread_id": conv.thread_id}})
```
Use server-generated, unguessable IDs (UUIDs).

---

### Q12. Checkpointer vs store (short-term vs long-term memory)

| | Checkpointer | Store |
|---|---|---|
| Scope | one thread | across threads/users |
| Content | full graph state per step | arbitrary JSON items by namespace + key |
| Use | conversation, approvals, recovery | user preferences, learned facts, shared knowledge |
| Search | by thread / checkpoint id | by namespace, key; optional semantic (vector) search |

```python
def remember(state, runtime: Runtime[Ctx]):
    ns = ("users", runtime.context.user_id, "prefs")
    runtime.store.put(ns, "export_format", {"value": "csv"})
    prefs = runtime.store.search(ns)
```

---

### Q13. Durability modes

**Short answer:** Controls **when checkpoints are written**: `"exit"` (only when the run ends/interrupts — fastest, no mid-run crash recovery), `"async"` (write in background while next step runs — default-ish balance, tiny risk on crash), `"sync"` (write before next step — safest, slower).

```python
graph.invoke(inputs, config, durability="sync")    # long, critical workflows
```

---

### Q14. Inspecting state and time travel

```python
snap = graph.get_state(config)              # values, next nodes, tasks, interrupts
for s in graph.get_state_history(config):   # all checkpoints, newest first
    print(s.config["configurable"]["checkpoint_id"], s.next)

# Fork: edit a past state and continue from there
past = list(graph.get_state_history(config))[3]
new_cfg = graph.update_state(past.config, {"route": "rag"})
graph.invoke(None, new_cfg)                 # None input = resume from that checkpoint
```
Use for debugging incidents — in an **isolated environment with side-effecting tools disabled**, because replay may re-run nodes. Model outputs may differ on replay; record model/prompt/tool versions in metadata.

---

### Q15. Durable execution and replay — what re-runs?

**Short answer:** On resume (after crash or interrupt), LangGraph restarts from the last checkpoint — the **interrupted/failed node runs again from its beginning**. Completed nodes in earlier steps are not re-run. So any side effect inside a node that can re-run must be **idempotent**, or isolated (separate node / `@task` in the functional API whose result is cached in the checkpoint).

```flow
pipeline: Why side effects can run twice after a crash
Node "submit" starts > It calls Textract (a real side effect).
Crash before checkpoint > The node's result was never saved.
Resume > LangGraph replays from the last checkpoint, so "submit" runs again.
Second Textract job > Duplicate side effect.
Fix > Use an idempotency key (ClientRequestToken), or create the job_id in an earlier node so it's in state before the side effect.
```

---

## 4. Human-in-the-loop: interrupt & Command

### Q16. How does `interrupt()` work?

**Short answer:** Calling `interrupt(payload)` inside a node **pauses the graph**, saves state via the checkpointer, and returns `payload` to the caller. Later you resume with `Command(resume=value)` on the same `thread_id`; `interrupt()` then **returns `value`** and the node continues. Requires a checkpointer.

```flow
sequence: interrupt() and resume across hours and processes
actors: Caller, Graph, Checkpointer, Human
Caller -> Graph: invoke(input, thread_id)
Graph -> Graph: node "approve" calls interrupt({action, args})
Graph -> Checkpointer: save state
Graph --> Caller: returns __interrupt__ payload
> The run ends cleanly. Nothing is waiting in memory, so it can resume hours later on another pod.
Caller -> Human: show the request in the UI
Human --> Caller: approves
Caller -> Graph: invoke(Command(resume={approved: True}), same thread_id)
Graph -> Checkpointer: load state
Graph -> Graph: node "approve" re-runs from the top
> This time `interrupt()` returns {approved: True} instead of pausing. Code before `interrupt()` runs again, so keep it idempotent.
```

```python
from langgraph.types import interrupt, Command

def approval(state: State):
    decision = interrupt({"action": "refund", "amount": state["amount"], "customer": state["cid"]})
    if decision["approved"]:
        return Command(goto="execute_refund", update={"approved_by": decision["user"]})
    return Command(goto="notify_rejected")

# first call → pauses
out = graph.invoke({"amount": 500, "cid": "c9"}, cfg)
out["__interrupt__"]      # [Interrupt(value={...})]
# later, from the approval API (after verifying approver identity!)
graph.invoke(Command(resume={"approved": True, "user": "mgr-7"}), cfg)
```

---

### Q17. The #1 interrupt pitfall: code before `interrupt()` runs twice

**Short answer:** On resume, the node restarts from the beginning, so **everything before `interrupt()` executes again**. Don't put non-idempotent side effects before an interrupt; put them in a previous node, after the interrupt, or make them idempotent.

```python
def bad(state):
    job = textract.start_job(state["doc"])    # ❌ runs again on resume → duplicate job
    ok = interrupt("approve?")
    ...

def good_prepare(state):                       # separate node → checkpointed before pause
    return {"job_id": textract.start_job(state["doc"], client_token=state["doc_hash"])}
def good_approve(state):
    ok = interrupt({"job_id": state["job_id"]})
```
Other rules: multiple interrupts in one node are matched **by order** — don't reorder them conditionally; don't wrap `interrupt()` in a bare `try/except` (it works by raising a special exception); payloads must be JSON-serialisable.

---

### Q18. What is `Command` used for?

**Short answer:** `Command` combines **state update + routing** in one return value, and is also how you **resume** an interrupt.

```python
def planner(state) -> Command[Literal["research", "answer"]]:
    plan = make_plan(state)
    return Command(update={"plan": plan}, goto="research" if plan else "answer")
```
Also `Command(graph=Command.PARENT, goto="other_agent")` to jump from a subgraph to a node in the parent graph (multi-agent handoffs).

---

### Q19. Common HITL patterns

| Pattern | How |
|---|---|
| Approve / reject an action | interrupt with proposed action → route on decision |
| Edit state | interrupt returns edited args → node uses them |
| Review tool calls | interrupt inside tool wrapper (or `HumanInTheLoopMiddleware` in LangChain) |
| Ask the user for missing info | interrupt with a question → resume with answer |
| Multi-step approvals | several interrupt nodes; each approval stored in state for audit |

**Security:** LangGraph pauses and resumes; **your API** must authenticate the approver, check their permission, bind the approval to the exact action, and log it.

---

## 5. Control flow: parallelism, Send, subgraphs, multi-agent

### Q20. Parallel branches (fan-out / fan-in)

**Short answer:** If a node has edges to several nodes, they run **in the same super-step in parallel**. A node with edges from several branches runs after the step in which they complete. Use reducers to merge their outputs.

```python
b.add_edge(START, "search_jira")
b.add_edge(START, "search_confluence")          # both run in parallel
b.add_edge(["search_jira", "search_confluence"], "synthesize")   # waits for BOTH (join)
# state: evidence: Annotated[list, operator.add]
```
**Pitfall:** branches of **different lengths** — if one path has two nodes and the other one, a plain edge would fire the join too early. Use the list-form edge above or `defer=True` on the join node to wait until all pending branches finish.

---

### Q21. Map-reduce with `Send`

**Short answer:** When the number of parallel tasks is **dynamic** (one per document), a conditional edge returns a list of `Send(node, per_item_state)`. Each runs the node with its own input; results merge via a reducer.

```python
from langgraph.types import Send

class State(TypedDict):
    doc_ids: list[str]
    summaries: Annotated[list[str], operator.add]

def fan_out(state: State):
    return [Send("summarize", {"doc_id": d}) for d in state["doc_ids"]]   # bounded list!

def summarize(item: dict):
    return {"summaries": [summarize_doc(item["doc_id"])]}

b.add_conditional_edges(START, fan_out, ["summarize"])
b.add_edge("summarize", "combine")
```
Bound the fan-out (max items, concurrency via `max_concurrency` in config) to respect rate limits.

---

### Q22. What happens when multiple edges enter a node?

**Short answer:** It depends on wiring. With separate `add_edge("a","c")` and `add_edge("b","c")`, `c` is triggered in the next step after **whichever** of a/b ran in that step — if a and b are in the same step, `c` runs **once** with both updates merged. If they finish in different steps, `c` may run **twice**. For an explicit "wait for all", use `add_edge(["a","b"], "c")` or `defer=True`. Test the compiled graph.

---

### Q23. Subgraphs

**Short answer:** A compiled graph used as a node in another graph — for modularity, team ownership and separate state. Two ways:
1. **Shared keys:** add the compiled subgraph directly as a node; overlapping state keys pass through.
2. **Different schema:** call the subgraph inside a node function and map parent state ↔ subgraph input/output.

```python
deposits_graph = deposits_builder.compile()
def call_deposits(state: Parent):
    out = deposits_graph.invoke({"query": state["question"], "account_id": state["acct"]})
    return {"answer": out["result"]}
parent.add_node("deposits", call_deposits)
```
Subgraphs can have their own checkpoints/interrupts (namespaced under the parent thread).

---

### Q24. Multi-agent architectures in LangGraph

```
 SUPERVISOR                                   SWARM / HANDOFFS
 ┌────────────┐                               ┌─────────┐  Command(goto="billing",
 │ supervisor │──► picks next agent           │ triage  │──────── graph=PARENT) ──► ┌─────────┐
 └─┬────┬───┬─┘    (tool call / route)        └─────────┘                           │ billing │
   ▼    ▼   ▼                                      ▲                                └────┬────┘
 [research][coder][writer] ──► report back         └─────────── handoff back ─────────────┘
```
- **Supervisor** (`langgraph-supervisor` or hand-built): central LLM routes to worker agents (each a subgraph), aggregates results. Most controllable.
- **Swarm/handoffs** (`langgraph-swarm` or `Command(goto=..., graph=Command.PARENT)`): agents transfer control directly; the active agent is remembered in state.
- **Hierarchical**: supervisors of supervisors.

Give each agent **its own tools and minimal context**; pass only what the next agent needs.

---

### Q25. Conditional routing strategies

Deterministic checks (regex, metadata, permissions) where possible; LLM routing with **structured output constrained to an enum** of destinations otherwise; always a fallback route (e.g., "clarify" or "human") and an explicit path for sensitive actions (approval).

```python
class Route(BaseModel):
    destination: Literal["rag", "sql", "human"]
router = model.with_structured_output(Route)
```

---

### Q26. Planner–executor–verifier graph with context pruning

```flow
cycle: Planner–executor–verifier with pruning
planner > Writes a typed plan into state.
executor > Runs each step with bounded tools (`Send` fans out per step).
verifier > Checks evidence and citations.
fail & < 3 rounds > Back to the planner with the verifier's feedback.
exit > Pass → pruner summarises (keeping IDs and approvals) → answer → END.
```
State keeps `plan`, `evidence` (reducer), `iterations`, `approvals`; pruner replaces bulky tool outputs with summaries + references stored in S3.

---

## 6. Streaming, errors, functional API

### Q27. Streaming modes

| `stream_mode` | Emits |
|---|---|
| `"values"` | full state after each step |
| `"updates"` | only what each node returned |
| `"messages"` | LLM tokens + metadata (which node) |
| `"custom"` | your events via `get_stream_writer()` / `runtime.stream_writer` (e.g., "OCR 3/10 pages") |
| `"debug"` | detailed execution events |

```python
for mode, chunk in graph.stream(inputs, cfg, stream_mode=["updates", "messages", "custom"]):
    ...
# subgraphs=True to include subgraph events
```
Translate into a stable client protocol (`status`, `token`, `tool_result`, `approval_needed`, `done`) — don't leak internal state or secrets to the browser.

---

### Q28. Error handling and retries

**Short answer:** Attach a `RetryPolicy` to nodes for **transient** errors; route permanent errors to an error-handling path; record error class in state.

```python
from langgraph.types import RetryPolicy
b.add_node("call_api", call_api,
           retry_policy=RetryPolicy(max_attempts=3, initial_interval=1.0, backoff_factor=2.0,
                                    retry_on=(TimeoutError, ConnectionError)))
```
Inside nodes: catch `403`-style errors and return `{"error": "access_denied"}` → conditional edge to a "denied" node (don't retry authorisation failures). Interrupts are control flow, not errors.

---

### Q29. Node caching

`b.add_node("embed", embed_fn, cache_policy=CachePolicy(ttl=3600))` + `compile(cache=InMemoryCache())` — skip re-running expensive deterministic nodes for identical inputs.

---

### Q30. Functional API (`@entrypoint`, `@task`)

**Short answer:** An alternative to explicit graphs: write normal Python control flow; `@entrypoint` gives persistence/interrupts/streaming; `@task` marks units whose results are **checkpointed**, so on resume completed tasks aren't re-executed — good place for side effects.

```python
from langgraph.func import entrypoint, task

@task
def extract(doc_id: str) -> dict: return textract_extract(doc_id)

@entrypoint(checkpointer=saver)
def workflow(doc_ids: list[str]) -> list[dict]:
    futures = [extract(d) for d in doc_ids]         # tasks run in parallel
    results = [f.result() for f in futures]
    ok = interrupt({"review": results})             # pause for human review
    return results if ok else []
```
Choose Graph API for visualisable, complex topologies; Functional API to add durability/HITL to existing procedural code.

---

### Q31. Static vs dynamic breakpoints

`compile(interrupt_before=["tools"])` pauses before a node every time — handy for debugging. `interrupt()` inside a node is **dynamic** (conditional, carries a payload) — the production HITL mechanism.

---

## 7. Production engineering

### Q32. Deploying LangGraph

Options: your own FastAPI service on ECS/EKS with a Postgres checkpointer; **LangSmith Deployment** (Agent Server: threads, runs, cron, streaming APIs); **Amazon Bedrock AgentCore Runtime** (serverless, per-session microVM isolation; framework-agnostic). In all cases, the checkpointer must be **durable and external** — container memory is ephemeral.

---

### Q33. LangGraph on AgentCore Runtime — how do the layers fit?

```flow
sequence: LangGraph on AgentCore Runtime
actors: Client, AgentCore Runtime, LangGraph, Checkpointer, Gateway
Client -> AgentCore Runtime: invoke(session_id) + JWT/IAM
> Inbound auth is checked; the session maps to its own isolated microVM.
AgentCore Runtime -> LangGraph: run your container's entrypoint
LangGraph -> Checkpointer: load state by thread_id
> Postgres or an AgentCore Memory–backed saver.
LangGraph -> Gateway: tool calls over MCP
> Outbound credentials come from AgentCore Identity.
LangGraph -> Checkpointer: save checkpoints
LangGraph --> Client: stream response
> Traces go to AgentCore Observability (OpenTelemetry) throughout.
```
Runtime **session isolation** ≠ graph **persistence**: a session's microVM can end (idle timeout/max lifetime), but the checkpointer restores the conversation. Your backend maps verified user → session ID and → thread ID.

---

### Q34. Large message state — trade-offs

Big histories increase tokens/cost, latency, serialisation and checkpoint storage, and raise privacy exposure. Strategies: trim/summarise (keep recent turns verbatim), store large tool outputs in S3 and keep references in state, keep exact structured facts (IDs, approvals, amounts) in dedicated fields.

---

### Q35. Preventing cross-user access to checkpoints

Server-generated unguessable thread IDs; ownership check before every `invoke/get_state/update_state`; never accept client thread IDs blindly; namespace stores by verified user/tenant; encrypt the checkpoint DB (and optionally use an encrypted serializer); audit access; retention policy.

---

### Q36. State schema changes across deployments

Threads can outlive a deployment (a thread paused for approval last week resumes on new code). Make schema changes backward compatible: add fields with defaults, don't rename/remove keys abruptly, migrate old checkpoints if needed, and **test resuming from real old checkpoints** before release. Also don't rename/remove nodes that paused threads may be waiting in.

---

### Q37. Testing graphs (not only nodes)

- Unit-test node functions (pure input → update).
- Test routing functions and reducers directly.
- Integration tests with fake/mocked models (deterministic tool calls) and an `InMemorySaver`.
- Test interrupt → resume, crash → resume (run with checkpointer, kill, resume), parallel merges, recursion limits.
- Trajectory evals: expected node path / tool calls for golden scenarios (LangSmith).

---

### Q38. Tracing and sensitive data

LangSmith/OTel traces capture every node, model call and tool call. Redact PII and secrets at capture (masking functions, hide inputs/outputs), sample traces, set retention, restrict access. Don't log `Authorization` headers, account numbers or approval payloads with personal data.

---

## 8. Scenario & debugging questions

### Q39. The graph repeats an expensive tool call after a supervisor approves

The tool call sits **before `interrupt()`** in the same node, so it re-ran on resume. Move it into a previous node (checkpointed) or a `@task`, or make it idempotent with a stored operation ID / client token.

---

### Q40. "InvalidUpdateError: can receive only one value per step"

Two parallel nodes updated the same key without a reducer. Find the branches (trace / `get_state`), then either give the key a reducer (`Annotated[list, operator.add]` or custom merge) or write to separate keys (`jira_results`, `confluence_results`).

---

### Q41. A conversation loses context after a redeploy

Likely `InMemorySaver` in production, or thread ID not stable (generated per request), or a different DB/schema after deploy. Fix: durable checkpointer, persistent thread ID mapping in your DB, migration tests.

---

### Q42. The agent hits `GraphRecursionError`

Look at the trace: agent ↔ tools loop not converging (tool errors returned unhelpfully, model keeps retrying). Fix tool error messages, add an iteration counter with a graceful exit route, cap tool calls, improve prompt stop criteria; raise the limit only if the task genuinely needs more steps.

---

### Q43. Migrate a monolithic "one giant prompt" agent to LangGraph

Extract pure tools → define typed state → split into nodes (classify → retrieve → act → validate) → add checkpointer and approval nodes → run old and new side by side on the same eval set and traces → staged rollout with metrics.

---

### Q44. Design: document Q&A agent with approval for write actions

State: `messages`, `selected_doc_ids` (authorised server-side), `evidence`, `proposed_action`, `approval`. Nodes: `authorize_docs` → `retrieve` (filter by IDs) → `agent` (read tools only) → if write proposed → `approval` (interrupt) → `execute` (idempotent, re-check permission) → `respond`. Postgres checkpointer, streaming of tokens + status events, traces with redaction.

---

## 9. Cheat sheet

| Concept | One-liner |
|---|---|
| StateGraph | typed state + nodes + edges; compile → run |
| Node | `state → partial update` |
| Reducer | how updates merge; none = overwrite; `add_messages`, `operator.add` |
| Conditional edge | function returns next node name(s) |
| Super-step | parallel nodes, then reduce, then checkpoint |
| Checkpointer | snapshot per step per `thread_id`; Postgres in prod |
| Store | long-term memory across threads, namespaced |
| Durability | `exit` / `async` / `sync` |
| `interrupt()` | pause + persist; resume with `Command(resume=…)`; node re-runs from top |
| `Command` | update + goto; resume; jump to parent graph |
| `Send` | dynamic fan-out (map-reduce) |
| Join | `add_edge(["a","b"], "c")` or `defer=True` |
| Subgraph | modular graph as a node |
| Streaming | values / updates / messages / custom / debug |
| RetryPolicy | per-node transient retries |
| Functional API | `@entrypoint` + `@task` (tasks checkpointed) |
| Safety | thread_id ≠ auth; idempotent side effects; redact traces |

## Official references

- Overview: https://docs.langchain.com/oss/python/langgraph/overview
- Graph API: https://docs.langchain.com/oss/python/langgraph/graph-api
- Persistence: https://docs.langchain.com/oss/python/langgraph/persistence
- Durable execution: https://docs.langchain.com/oss/python/langgraph/durable-execution
- Interrupts: https://docs.langchain.com/oss/python/langgraph/interrupts
- Functional API: https://docs.langchain.com/oss/python/langgraph/functional-api
- Streaming: https://docs.langchain.com/oss/python/langgraph/streaming
