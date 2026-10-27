# LangGraph: Interview Preparation

> **Updated:** 27 October 2026 (LangGraph **v1.x**) · **Level:** graph basics → persistence & human approval → multi-agent → production
> **How to use:** read the *Short answer* first, then *How it works* and the *Example* walkthrough. *Common mistake → fix* shows what goes wrong in real code. *Interview answer* is what you can say out loud.

---

## Table of contents

1. [Mental model: how LangGraph executes](#1-mental-model-how-langgraph-executes)
2. [Fundamentals: state, nodes, edges](#2-fundamentals-state-nodes-edges) (Q01–Q11)
3. [Persistence: checkpointers, threads, store](#3-persistence-checkpointers-threads-store) (Q12–Q17)
4. [Human-in-the-loop: interrupt & Command](#4-human-in-the-loop-interrupt--command) (Q18–Q21)
5. [Control flow: parallelism, Send, subgraphs, multi-agent](#5-control-flow-parallelism-send-subgraphs-multi-agent) (Q22–Q28)
6. [Streaming, errors, caching, functional API](#6-streaming-errors-caching-functional-api) (Q29–Q33)
7. [Production engineering](#7-production-engineering) (Q34–Q40)
8. [Scenario & debugging questions](#8-scenario--debugging-questions) (Q41–Q46)
9. [Cheat sheet](#9-cheat-sheet)

---

## 1. Mental model: how LangGraph executes

**The one idea:** you describe your program as a **graph**. Boxes are **nodes** (ordinary Python functions). Arrows are **edges** (which box runs next). All boxes share one notebook called the **state**. A node reads the notebook, does its job, and returns the lines it wants to change. LangGraph merges those changes, saves a copy of the notebook (a **checkpoint**), and follows the arrows to the next box.

Think of a board game. The state is the board, each node is a player's turn, the edges are the rules for whose turn is next, and a checkpoint is a photo of the board after every turn. Because there are photos, you can stop the game, walk away for a week, and carry on from the last photo, even on a different computer.

Plain LLM code (a `while` loop) gives you none of that. Graphs add loops, branches, parallel steps, pausing for a human, resuming after a crash and step-by-step streaming.

```flow
cycle: A super-step, the unit LangGraph repeats (example: the agent node just ran)
Run the scheduled nodes > In step 3 the agent node runs and returns {"messages": [AIMessage with a tool call]}.
Merge updates with reducers > The add_messages reducer appends that message to the state's messages list.
Save a checkpoint > The new state plus "next node = tools" is stored under the thread_id.
Follow the edges > A conditional edge sees the tool call and schedules the tools node for step 4.
exit > A step schedules no nodes (END), a node calls interrupt(), or the recursion limit is reached.
```

**Three rules that follow from this model:**
1. **Nodes return updates, they don't edit state.** A node returns only the keys it changes. How the update merges is decided by that key's **reducer**.
2. **Nodes in the same step run in parallel and can't see each other's updates until the step ends.** The merge and the checkpoint happen between steps.
3. **Resuming restarts a node from its first line.** The checkpoint is taken between nodes, not in the middle of one, so code in a node that was interrupted or crashed can run again. Side effects must be safe to repeat.

---

## 2. Fundamentals: state, nodes, edges

### Q01. What is LangGraph and what problem does it solve?

**Short answer:** LangGraph is a low-level Python (and JavaScript) framework for building **stateful, long-running, controllable** agents and workflows. You lay out the steps as a graph, and the framework gives you **persistence** (saved progress), **human-in-the-loop** (pause for approval), **streaming** and **durable execution** (resume after a crash). It lets you mix fixed code and LLM decisions in one flow.

**How it works:** an LLM app is usually a loop: call the model, maybe call a tool, repeat. That loop is easy to write once, but production needs more: remember the conversation, wait two days for a manager's approval, survive a redeploy, show progress to the user, run steps in parallel. LangGraph makes each of those a built-in feature of a graph instead of code you rewrite per project.

**Example:** a refund assistant that (1) looks up the order, (2) drafts a refund, (3) waits for a manager to approve anything over 100, (4) issues the refund.

**What happens, step by step:**
1. The user asks for a refund. The graph runs `lookup` then `draft`, saving a checkpoint after each.
2. The amount is 250, so the `approval` node calls `interrupt(...)`. The run stops, state is saved, and the API returns "waiting for approval".
3. Two days later the manager approves. Your API resumes the same thread. The graph loads the saved state (it does not redo `lookup` or `draft`) and continues to `issue_refund`.
4. If the server restarted in between, nothing is lost, because state lives in the database, not in memory.

**Common mistake → fix:** using LangGraph for a single prompt-in, answer-out call. You get graph machinery with no benefit. Fix: use a plain model call or LangChain's `create_agent`; reach for LangGraph when you need explicit control flow, pausing, or durability (see the LangChain course, "When do you move from create_agent to a custom graph").

**Interview answer:** "LangGraph is a low-level orchestration framework where I model a workflow as a graph of nodes and edges over a shared state. It adds what a hand-written loop lacks: checkpointed persistence, interrupts for human approval, durable resume after crashes, streaming and parallel branches. I use it when I need control over the flow, and I can mix deterministic code and LLM steps in the same graph."

**Follow-ups:**
- *Is it tied to LangChain?* No. Nodes are plain functions; LangChain models and tools are just convenient inside them.
- *Is it only for agents?* No, also fixed pipelines such as document processing with an approval step.

---

### Q02. What is state, and what is a `StateGraph`?

**Short answer:** **State** is the shared data every node reads and updates, defined by a **schema**: a `TypedDict`, dataclass or Pydantic model. `StateGraph(State)` is the builder where you register nodes and edges, then `compile()` it into a runnable graph. Each node gets the current state and returns a **partial update**: only the keys it changes.

**How it works:**
1. You declare the keys and types in the schema. A key can carry a **reducer** (see Q05) that says how updates merge.
2. When the graph starts, your input fills the state. Keys you didn't provide are simply missing.
3. After every node, its returned dict is merged into the state. Keys the node didn't return are left untouched.

**Example:**
```python
from typing import TypedDict
from langgraph.graph import StateGraph, START, END

class State(TypedDict):
    question: str
    route: str
    answer: str

def classify(state: State) -> dict:
    route = "refund" if "refund" in state["question"].lower() else "general"
    return {"route": route}                      # only the key this node changes

def answer_refund(state: State) -> dict:
    return {"answer": "Refunds take 5 business days."}

builder = StateGraph(State)
builder.add_node("classify", classify)
builder.add_node("answer_refund", answer_refund)
builder.add_edge(START, "classify")
builder.add_edge("classify", "answer_refund")
builder.add_edge("answer_refund", END)
graph = builder.compile()

print(graph.invoke({"question": "How long do refunds take?"}))
```

**What happens, step by step:**
1. Input state: `{"question": "How long do refunds take?"}`.
2. `classify` returns `{"route": "refund"}`. State becomes `{"question": "...", "route": "refund"}`. `question` is untouched because the node didn't return it.
3. `answer_refund` returns `{"answer": "Refunds take 5 business days."}`. State now has all three keys.
4. `invoke` returns that final state dict.

**Common mistake → fix:** a node that mutates the state in place and returns nothing (`state["route"] = "refund"`). The change may be lost or invisible to checkpointing, because LangGraph only records what a node **returns**. Fix: always return the update dict.

**Interview answer:** "State is the typed schema shared by all nodes, a TypedDict, dataclass or Pydantic model. StateGraph is the builder; nodes receive the current state and return a partial update, which LangGraph merges using each key's reducer. After compile, the graph is invoked with an input state and returns the final state."

**Follow-ups:**
- *TypedDict or Pydantic?* TypedDict is lightest and fastest; Pydantic adds validation of values on input.
- *Can input and output differ from internal state?* Yes: `StateGraph(State, input_schema=..., output_schema=...)` narrows what callers send and receive.

---

### Q03. What is a node?

**Short answer:** A **node** is one step of the graph: a function (sync or async) or runnable that takes the state and returns an update. A node does one job (call the model, run a tool, check a rule). It can also accept a `config` or `runtime` parameter to read run settings and context. It's registered with `builder.add_node("name", fn)`.

**How it works:**
- If you pass only the function (`builder.add_node(fn)`), the function name becomes the node name.
- The node's return value can be a dict (state update), `None` (no change), a `Command` (update plus where to go next, see Q20), or a list of `Send` objects from a conditional edge.
- Nodes should do **one** thing. That keeps checkpoints granular: a failure in step 3 resumes at step 3 instead of redoing steps 1 and 2.

**Example:**
```python
from langgraph.graph import MessagesState

def call_model(state: MessagesState) -> dict:
    reply = model.invoke(state["messages"])          # a LangChain chat model
    return {"messages": [reply]}                     # add_messages appends it

def fetch_order(state: dict, config) -> dict:
    order_id = state["order_id"]
    return {"order": orders_api.get(order_id)}       # one side effect, one node
```

**What happens, step by step:**
1. `call_model` receives the whole `MessagesState`, calls the model with all messages, and returns a list with one new `AIMessage`.
2. The reducer appends it to `messages`.
3. `fetch_order` is a separate node, so if the model call later fails, the fetched `order` is already checkpointed and the API isn't called again.

**Common mistake → fix:** one giant node that fetches, calls the model, writes to the database and sends an email. If the email step crashes, resume re-runs the whole node, including the database write. Fix: split it into separate nodes (or `@task`s in the functional API, Q32) so each side effect is checkpointed on its own.

**Interview answer:** "A node is a function that takes the state and returns a partial update. I keep nodes small and single-purpose so each is checkpointed separately and a failure only repeats that one step. Nodes can read run configuration and runtime context, and can return a Command to update state and choose the next node at once."

**Follow-ups:**
- *Can a node be a whole graph?* Yes, that's a subgraph (Q25).

---

### Q04. What are edges, and how does routing work?

**Short answer:** **Edges** decide which node runs next. A **normal edge** always goes A → B. A **conditional edge** calls a routing function that looks at the state and returns the next node's name (or several). `START` and `END` are special names for the entry and exit points. A node can also pick the next node itself by returning a `Command(goto=...)`.

**How it works:** `add_conditional_edges("classify", route_fn, {"rag": "rag", "direct": "direct"})` runs `route_fn(state)` after `classify` finishes and uses the returned string to choose. The optional mapping dict lists the allowed destinations; it helps diagrams and catches typos at compile time. Routing functions should be **pure** (no side effects) and cheap.

**Example:**
```python
from typing import Literal

def route(state: State) -> Literal["rag", "direct"]:
    return "rag" if state["route"] == "policy" else "direct"

builder.add_edge(START, "classify")
builder.add_conditional_edges("classify", route)       # return-type hint documents destinations
builder.add_edge("rag", END)
builder.add_edge("direct", END)
```

**What happens, step by step (question "What is the leave policy?"):**
1. `START` → `classify` runs and writes `route = "policy"`.
2. The conditional edge calls `route(state)`, which returns `"rag"`.
3. `rag` runs, then its normal edge goes to `END`. `direct` never runs.
4. For "hello" the classifier writes `route = "general"`, `route` returns `"direct"`, and the other branch runs.

**Common mistake → fix:** a routing function that returns a name nobody handles (for example `"human"` when only `rag` and `direct` exist), or can return `None`. The run fails at that step. Fix: use a `Literal[...]` return type, always include a fallback destination, and test the router directly with sample states.

**Interview answer:** "Edges define control flow. Normal edges are fixed, conditional edges call a pure routing function over the state to pick the next node, and START and END mark the boundaries. A node can also return a Command to update state and choose the next node in one step. I give routers a Literal return type and a fallback route."

**Follow-ups:**
- *Router with an LLM?* Possible: use structured output constrained to an enum of destinations (Q27).

---

### Q05. How do reducers work?

**Short answer:** A **reducer** is a function `(old_value, new_value) → merged_value` attached to a state key. It decides how a node's update combines with what's already there. **With no reducer, the new value overwrites the old one.** With `Annotated[list, operator.add]` lists are concatenated; `add_messages` appends messages and replaces ones that have the same id.

**How it works:** the reducer is declared in the type: `Annotated[type, reducer_function]`. After each step, for every key that got updates, LangGraph applies the reducer to the old value and each new value. If two nodes in the same step update a key with **no** reducer, LangGraph can't know which should win and raises `InvalidUpdateError`.

**Example:**
```python
import operator
from typing import Annotated, TypedDict

class State(TypedDict):
    evidence: Annotated[list[str], operator.add]   # appends
    status: str                                    # overwrites

def search_a(state): return {"evidence": ["from A"], "status": "searching"}
def search_b(state): return {"evidence": ["from B"]}
```

```flow
trace: Merging updates into State with one reducer key and one plain key
start: evidence = **[]**, status = "new" > Initial state.
search_a returns {evidence: ["from A"], status: "searching"} > Both nodes run in the same step, so their updates are merged together.
search_b returns {evidence: ["from B"]} > A second update to the evidence key.
after the step: evidence = **["from A", "from B"]** > The operator.add reducer concatenated both lists.
after the step: status = **"searching"** > No reducer, only one node wrote it, so the value is simply replaced.
```

**What happens, step by step:**
1. Both nodes run in the same super-step and see `evidence == []`.
2. The reducer folds the updates: `[] + ["from A"] + ["from B"]`.
3. `status` was written once, so no conflict. If `search_b` had also written `status`, you'd get `InvalidUpdateError`: "can receive only one value per step".

**Common mistake → fix:** a list key with no reducer in a graph with parallel branches. Either you get `InvalidUpdateError`, or (in sequential nodes) each node **replaces** the list and earlier items vanish. Fix: `Annotated[list, operator.add]`, or a custom reducer that merges by id (below).

```python
def merge_by_id(old: list[dict], new: list[dict]) -> list[dict]:
    merged = {d["id"]: d for d in old}
    merged.update({d["id"]: d for d in new})        # same id replaces, new id appends
    return list(merged.values())
```

**Interview answer:** "A reducer defines how updates to a state key are merged. Without one the latest value overwrites. operator.add concatenates lists, add_messages appends and updates chat messages by id, and I write custom reducers for things like merge-by-id. Any key written by parallel branches needs a reducer, otherwise LangGraph raises InvalidUpdateError."

**Follow-ups:**
- *Can a node remove items?* With `add_messages`, return `RemoveMessage(id=...)`; for custom lists, write a reducer that understands deletion markers.

---

### Q06. What are `MessagesState` and `add_messages`?

**Short answer:** `MessagesState` is a ready-made state with one key, `messages`, whose reducer is `add_messages`. Chat agents need exactly this: nodes return new messages and the reducer **appends** them, **replaces** a message that has the same id, and **deletes** a message when given `RemoveMessage(id=...)`. Subclass it to add your own keys.

**How it works:** every message gets an id (generated if missing). `add_messages(old, new)` walks the new messages: unknown id → append; known id → replace in place; `RemoveMessage` → delete that id. Dict messages such as `("user", "hi")` are converted to message objects.

**Example:**
```python
from langgraph.graph import MessagesState
from langchain.messages import RemoveMessage

class AgentState(MessagesState):
    selected_doc_ids: list[str]       # extra key, overwritten on update

def trim(state: AgentState) -> dict:
    old = state["messages"][:-4]                      # everything except the last 4
    return {"messages": [RemoveMessage(id=m.id) for m in old]}
```

```flow
trace: add_messages on a thread (ids in brackets)
existing messages > Human[h1], AI[a1].
node returns [Tool[t1]] > An unknown id, so it is appended: Human[h1], AI[a1], **Tool[t1]**.
node returns [AI[a1] with edited text] > A known id, so it replaces in place: Human[h1], **AI[a1 edited]**, Tool[t1].
node returns [RemoveMessage(id=t1)] > The reducer deletes that message: Human[h1], AI[a1 edited].
```

**What happens, step by step (`trim` on a 10-message history):**
1. `old` is the first 6 messages.
2. The node returns 6 `RemoveMessage`s; the reducer deletes those ids.
3. The state keeps the last 4 messages. The checkpoint now stores only 4, so later model calls are cheaper.

**Common mistake → fix:** trimming so that a `ToolMessage` stays but the `AIMessage` with its tool call is removed. Providers reject a tool result with no matching call. Fix: remove whole turns together (the AI tool call and its tool results), or use LangChain's `trim_messages` / summarisation.

**Interview answer:** "MessagesState is a prebuilt state with a messages list reduced by add_messages, which appends new messages, updates by id and supports RemoveMessage for deletion. I extend it with extra keys and use RemoveMessage to trim history, taking care not to orphan tool results."

**Follow-ups:**
- *Why ids matter?* They let a node edit an earlier message (for example human-edited tool arguments) instead of duplicating it.

---

### Q07. What do `compile`, `invoke` and `stream` do?

**Short answer:** `builder.compile()` **checks** the graph (every node reachable, edges valid) and returns a runnable graph; this is also where you attach a **checkpointer**, a **store** and a **cache**. `graph.invoke(input, config)` runs it to the end (or to an interrupt) and returns the final state. `graph.stream(...)` yields progress while it runs. Async versions are `ainvoke` and `astream`.

**How it works:**
- Nothing runs until you call `invoke` or `stream`; `add_node` and `add_edge` only describe the graph.
- `config` carries run settings: `{"configurable": {"thread_id": "t1"}}` picks the saved conversation; `recursion_limit` is a top-level config key.
- With `version="v2"`, `invoke` returns a `GraphOutput` with `.value` (the state) and `.interrupts` (pending pauses), which is cleaner than looking for the `__interrupt__` key in the dict.

**Example:**
```python
from langgraph.checkpoint.memory import InMemorySaver

graph = builder.compile(checkpointer=InMemorySaver())
cfg = {"configurable": {"thread_id": "t1"}, "recursion_limit": 50}

out = graph.invoke({"messages": [("user", "hi")]}, cfg, version="v2")
print(out.value["messages"][-1].content, out.interrupts)

for chunk in graph.stream({"messages": [("user", "and again")]}, cfg,
                          stream_mode="updates", version="v2"):
    print(chunk["type"], list(chunk["data"]))
```

**What happens, step by step:**
1. `compile` validates wiring and stores the in-memory checkpointer.
2. First `invoke` on thread `t1`: no saved state, so the graph starts from the input. It returns the final state in `out.value`; `out.interrupts` is `()` because nothing paused.
3. The `stream` call on the same thread loads the saved messages, appends "and again", and yields one chunk per finished node, e.g. `updates ['call_model']`.

**Common mistake → fix:** forgetting `thread_id` when a checkpointer is attached. LangGraph raises an error asking for it, because it has no key to save under. Fix: always pass `{"configurable": {"thread_id": ...}}`; generate it server-side (Q13).

**Interview answer:** "compile validates the graph and attaches the checkpointer, store and cache. invoke runs it and returns final state, stream yields updates, tokens or custom events while it runs, and both have async versions. The config carries the thread_id for persistence and the recursion limit. Nothing executes before invoke or stream."

**Follow-ups:**
- *Visualise it?* `graph.get_graph().draw_mermaid()` (or `draw_mermaid_png()`).

---

### Q08. What is a super-step, and how does LangGraph decide what runs next?

**Short answer:** LangGraph runs in **super-steps**, based on Google's Pregel model. In each super-step it runs **all** nodes that are scheduled, in parallel if there are several. Then it applies their updates with the reducers, saves a checkpoint, and schedules the next nodes from the edges. The run ends when no node is scheduled.

**How it works:**
1. Step 0: the input is written to state; `START`'s edges schedule the first nodes.
2. **Run:** scheduled nodes execute against the **same snapshot** of state. They can't see each other's writes.
3. **Merge:** updates are combined with reducers into the new state.
4. **Checkpoint:** state and "what runs next" are saved (if a checkpointer is attached).
5. **Schedule:** normal and conditional edges decide the next nodes. Nothing scheduled means done.

**Example:**
```python
b.add_edge(START, "plan")
b.add_edge("plan", "search_jira")
b.add_edge("plan", "search_logs")
b.add_edge(["search_jira", "search_logs"], "summarise")
```

```flow
trace: Super-steps for the graph above (state key: evidence, with an operator.add reducer)
step 1: plan runs > It writes the plan. evidence = [].
step 2: search_jira and search_logs run together > Both see evidence = [] because neither can see the other's write.
end of step 2: merge, then checkpoint > evidence = **["J-12 matches", "log line 88"]**. The checkpoint is saved.
step 3: summarise runs > The list-form edge waited for both searches, so summarise sees both results.
no nodes scheduled > The run ends and returns the final state.
```

**What happens, step by step:** exactly the trace above. If `search_logs` raised an exception, the whole step fails and **neither** branch's update is applied; with a checkpointer, resume re-runs the failed step from the last checkpoint (the step-1 one).

**Common mistake → fix:** expecting a node in the same step to read its sibling's output (`summarise` logic placed inside `search_jira` reading `search_logs` results). It sees the old state. Fix: put dependent work in a later node; use edges to order it.

**Interview answer:** "LangGraph executes in super-steps: run every scheduled node against the same state snapshot, merge their updates through reducers, checkpoint, then schedule the next nodes from the edges. Parallel nodes can't see each other's output until the step ends, and a checkpoint exists between steps, which is what makes pause, resume and time travel possible."

**Follow-ups:**
- *What counts toward the recursion limit?* Super-steps (Q10).

---

### Q09. How do you build a ReAct agent loop yourself?

**Short answer:** A ReAct ("reason, then act") agent is two nodes in a loop: an **agent** node that calls the model with the tools bound to it, and a **tools** node that runs whatever tool calls the model requested. A conditional edge after `agent` sends the flow to `tools` if the last message has tool calls, otherwise to `END`; a normal edge sends `tools` back to `agent`. `ToolNode` and `tools_condition` are prebuilt for this.

**Example:**
```python
from langgraph.graph import StateGraph, MessagesState, START
from langgraph.prebuilt import ToolNode, tools_condition

model_with_tools = model.bind_tools(tools)

def agent(state: MessagesState) -> dict:
    return {"messages": [model_with_tools.invoke(state["messages"])]}

b = StateGraph(MessagesState)
b.add_node("agent", agent)
b.add_node("tools", ToolNode(tools))
b.add_edge(START, "agent")
b.add_conditional_edges("agent", tools_condition)   # "tools" if tool calls, else END
b.add_edge("tools", "agent")
graph = b.compile(checkpointer=saver)
```

```flow
cycle: The ReAct loop for "What is the status of OPS-12?"
agent node > The model replies with a tool call get_ticket(key="OPS-12") and no text.
tools_condition > The last message has tool calls, so the flow goes to tools.
tools node > ToolNode runs get_ticket and appends a ToolMessage with status Blocked.
back to agent > The model sees the result and writes "OPS-12 is blocked."
exit > That reply has no tool calls, so tools_condition returns END.
```

**What happens, step by step:**
1. Step 1: `agent` runs; messages = [Human, AI(tool_call)].
2. Step 2: `tools_condition` routes to `tools`; `ToolNode` runs the tool and adds [ToolMessage].
3. Step 3: `agent` runs again; the model answers in text.
4. Step 4: `tools_condition` returns `END`. Total: 3 node runs, which means 2 model calls and 1 tool call.

**Common mistake → fix:** forgetting the `tools → agent` edge. The graph runs the tools and then stops without ever showing the result to the model. Fix: add the edge that closes the loop.

**Interview answer:** "A ReAct agent is an agent node that calls the model with tools bound, a ToolNode that executes requested calls, a conditional edge that routes on whether the last message has tool calls, and an edge from tools back to agent. LangChain's create_agent builds this for you and adds middleware, so I hand-build it when I need to customise the flow."

**Follow-ups:**
- *Parallel tool calls?* `ToolNode` runs several tool calls from one `AIMessage` concurrently.

---

### Q10. What is the recursion limit?

**Short answer:** The **recursion limit** is the maximum number of super-steps one run may execute. It exists to stop infinite loops. When exceeded, LangGraph raises `GraphRecursionError`. In current versions (from 1.0.6) the default is 1000 steps; you set it per run with `config={"recursion_limit": 50}`. It is a top-level config key, **not** inside `configurable`.

**How it works:** an agent loop (`agent` → `tools` → `agent` → …) uses 2 steps per round trip, so a limit of 50 allows about 25 tool rounds. For graceful stops, add `remaining_steps: RemainingSteps` to your state; LangGraph fills it with how many steps are left, so a router can send the flow to a "wrap up" node before the error.

**Example:**
```python
from langgraph.managed import RemainingSteps
from langgraph.errors import GraphRecursionError

class State(MessagesState):
    remaining_steps: RemainingSteps

def route(state: State):
    if state["remaining_steps"] <= 2:
        return "wrap_up"                      # answer with what we have
    return tools_condition(state)

try:
    graph.invoke(inputs, {"recursion_limit": 20})
except GraphRecursionError:
    ...                                       # reactive fallback
```

**What happens, step by step (limit 20, a tool that keeps failing):**
1. Steps 1 to 17 alternate `agent` and `tools`; the model retries the failing tool each time.
2. At `remaining_steps == 2` the router sends the flow to `wrap_up`, which writes "I couldn't complete this; here is what I found".
3. The run ends normally with a partial answer. Without the router, step 21 raises `GraphRecursionError`.

**Common mistake → fix:** raising the limit to 1000 to make the error go away. The loop is still broken and now costs 50 times more. Fix: find why the loop doesn't converge (Q46), keep a realistic limit, and add a graceful exit.

**Interview answer:** "The recursion limit caps super-steps per run to stop infinite loops; exceeding it raises GraphRecursionError. It defaults to 1000 in recent versions and is set as a top-level config key per run. I set a sensible value for the task and use RemainingSteps in the state to route to a graceful wrap-up before hitting the error."

**Follow-ups:**
- *Is it a cost limit?* No: it counts steps, not tokens or money. Use call-limit middleware or a budget in state for cost.

---

### Q11. What are config and runtime context?

**Short answer:** **Config** (`config["configurable"]`) carries run settings such as `thread_id` and `checkpoint_id`. **Runtime context** (`context_schema`, passed as `context=`) carries **trusted, per-run dependencies** such as `user_id`, `tenant_id` or a database handle. Context is read-only, not saved in state, and not visible to the model, so it's the right place for identity.

**How it works:** declare a dataclass, pass it as `context_schema=` to `StateGraph`, then supply an instance in `invoke(..., context=Ctx(...))`. A node adds a `runtime: Runtime[Ctx]` parameter and reads `runtime.context`. The same `runtime` also exposes `store` and `stream_writer`.

**Example:**
```python
from dataclasses import dataclass
from langgraph.runtime import Runtime

@dataclass
class Ctx:
    user_id: str
    tenant_id: str

def fetch_docs(state: State, runtime: Runtime[Ctx]) -> dict:
    docs = search(state["question"], tenant=runtime.context.tenant_id)
    return {"documents": docs}

builder = StateGraph(State, context_schema=Ctx)
builder.add_node("fetch_docs", fetch_docs)
# ... edges ...
graph = builder.compile(checkpointer=saver)
graph.invoke({"question": "leave policy"},
             {"configurable": {"thread_id": "t1"}},
             context=Ctx(user_id="u1", tenant_id="acme"))
```

**What happens, step by step:**
1. Your API authenticates the caller and builds `Ctx(user_id="u1", tenant_id="acme")`.
2. `fetch_docs` receives it as `runtime.context`, so the search is limited to tenant `acme`.
3. The context is **not** written into the checkpoint, so it can't leak into stored state or prompts. On the next call you supply it again.

**Common mistake → fix:** putting `user_id` into the state because "it's easy". It gets checkpointed, can be edited by any node, and is often copied into prompts. Fix: identity and credentials go in `context`; state holds only what the workflow needs to remember.

**Interview answer:** "Config holds run settings like thread_id and the recursion limit. Runtime context is a typed object I pass per invocation for trusted dependencies like user and tenant IDs; nodes read it from runtime.context. It isn't persisted or shown to the model, so I use it for authorisation and for building memory namespaces."

**Follow-ups:**
- *Context vs state?* Context is input for this run only; state is what the workflow remembers and checkpoints.

---
## 3. Persistence: checkpointers, threads, store

### Q12. What is a checkpoint, and what is a checkpointer?

**Short answer:** A **checkpoint** is a saved snapshot of the graph's state after a super-step: the state values, which nodes run next, and metadata. A **checkpointer** is the component that writes and reads those snapshots, keyed by `thread_id`. It's what gives you conversation memory, human-in-the-loop pauses, crash recovery and time travel. You attach one with `builder.compile(checkpointer=...)`.

**How it works:**
1. After each super-step, the checkpointer stores a new checkpoint under the thread, linked to the previous one (a history).
2. On the next `invoke` with the same `thread_id`, the graph loads the **latest** checkpoint and continues from it.
3. Without a checkpointer the graph is stateless: every `invoke` starts from scratch and `interrupt()` can't work.

| Checkpointer | Use |
|---|---|
| `InMemorySaver` | tests and notebooks only (lost on restart) |
| `SqliteSaver` | local development |
| `PostgresSaver` / `AsyncPostgresSaver` | common production choice |
| Other database-backed savers (Redis, MongoDB, community ones) | check the maintainer and version support before depending on them |

**Example:**
```python
from langgraph.checkpoint.postgres import PostgresSaver

with PostgresSaver.from_conn_string(DB_URI) as saver:
    saver.setup()                          # create tables once, at deploy time
    graph = builder.compile(checkpointer=saver)
    cfg = {"configurable": {"thread_id": "conv-42"}}
    graph.invoke({"messages": [("user", "Refund order A12")]}, cfg)
```

```flow
trace: Checkpoints saved for thread conv-42 (the refund graph from Q01)
ckpt-1: input received > State has the user message. Next node: lookup.
ckpt-2: after lookup > State now has the order. Next node: draft.
ckpt-3: after draft **interrupt** > The amount is 250. State is saved with next node: approval, then the process can exit.
ckpt-4: after approval and issue_refund > The final state. A new invoke on conv-42 starts from here.
```

**What happens, step by step:**
1. Each arrow in the trace is a super-step boundary; a row is written to the database there.
2. At `ckpt-3` the process can crash or scale to zero; nothing is lost.
3. The approval request arrives, the API resumes thread `conv-42`, and the graph loads `ckpt-3` and carries on.

**Common mistake → fix:** using `InMemorySaver` in a deployed service with several replicas. Each replica has its own memory, so a follow-up request that lands on another replica finds an empty thread, and a restart wipes everything. Fix: use a shared database-backed checkpointer and run its `setup()` during deployment.

**Interview answer:** "A checkpoint is a snapshot of state after each super-step, and the checkpointer stores those snapshots per thread. It powers memory across turns, interrupts and resume, fault tolerance and time travel. In production I use a database-backed checkpointer such as Postgres, shared by all replicas, and never InMemorySaver."

**Follow-ups:**
- *Does the checkpoint store the runtime context?* No. Only state and execution metadata are saved.

---

### Q13. What is a `thread_id`?

**Short answer:** A **thread** is one conversation or workflow run, and the `thread_id` is the key that groups its checkpoints. The same `thread_id` continues where it stopped; a new one starts fresh. It is **not** a security token: anyone who can call your graph with a thread id can read and continue that thread, so your API must check ownership before using it.

**How it works:** your server creates a random `thread_id` (a UUID) when a conversation starts, stores `owner = user` next to it in your own database, and passes it in `config["configurable"]["thread_id"]` on each call. LangGraph itself has no idea who the user is.

**Example:**
```python
@app.post("/chat/{conversation_id}")
def chat(conversation_id: str, body: Msg, user=Depends(current_user)):
    conv = db.get_conversation(conversation_id)
    if conv is None or conv.owner_id != user.id:
        raise HTTPException(404)                  # check BEFORE touching the graph
    return graph.invoke({"messages": [("user", body.text)]},
                        {"configurable": {"thread_id": conv.thread_id}},
                        context=Ctx(user_id=user.id, tenant_id=user.tenant_id))
```

```flow
sequence: Ownership check before using a thread
actors: User B, API, Conversations table, Graph
User B -> API: POST /chat/conv-of-user-A
API -> Conversations table: who owns conv-of-user-A?
Conversations table --> API: owner is user A
API --> User B: 404 Not Found
> The graph and the checkpointer were never touched, so B cannot read or extend A's conversation.
```

**What happens, step by step:**
1. User B guesses or steals the id of user A's conversation.
2. The API looks up the owner and finds it is A, not B.
3. It answers 404 (not 403, so it doesn't confirm the id exists) and never calls `graph.invoke`.
4. For the real owner, the same call passes the check and loads thread history.

**Common mistake → fix:** accepting `thread_id` straight from the request body and passing it to the graph. Any user can read any thread. Fix: the client sends your **conversation id**; the server maps it to the `thread_id` after an ownership check. This applies to `invoke`, `get_state`, `get_state_history` and `update_state` alike.

**Interview answer:** "A thread_id groups the checkpoints of one conversation: reuse it to continue, change it to start fresh. It's only a key, not authorisation, so I generate unguessable ids on the server, store the owner in my database, and check ownership on every call that touches the graph, including state inspection and updates."

**Follow-ups:**
- *Should each HTTP request get a new thread_id?* No, only each new conversation. A new id per request means the agent forgets everything.

---

### Q14. Checkpointer vs store: short-term vs long-term memory

**Short answer:** The **checkpointer** remembers one **thread**: the full state of one conversation (short-term memory). The **store** is a separate key-value database shared **across threads**, organised by **namespaces** such as `("users", "u1", "prefs")`, optionally with vector search (long-term memory). Use the checkpointer for "what did we say earlier in this chat", and the store for "what do we know about this user".

| | Checkpointer | Store |
|---|---|---|
| Scope | one thread | all threads and users |
| What it holds | full graph state per step | JSON items by namespace and key |
| Typical use | conversation, approvals, crash recovery | preferences, learned facts, shared knowledge |
| Lookup | by `thread_id` / `checkpoint_id` | by namespace and key; optional semantic search |
| Attach with | `compile(checkpointer=...)` | `compile(store=...)` |

**Example:**
```python
def remember_and_recall(state: State, runtime: Runtime[Ctx]) -> dict:
    ns = ("users", runtime.context.user_id, "prefs")        # namespace from trusted context
    runtime.store.put(ns, "export_format", {"value": "csv"})
    prefs = {i.key: i.value for i in runtime.store.search(ns)}
    return {"prefs": prefs}

graph = builder.compile(checkpointer=saver, store=store)
```

**What happens, step by step:**
1. Monday, thread `t1`: the node saves `export_format = csv` under `("users", "u1", "prefs")`.
2. Friday, thread `t9` (new conversation, empty history): the node calls `search` on the same namespace and finds `csv`.
3. User `u2` uses namespace `("users", "u2", "prefs")` and sees nothing, because the namespace comes from `runtime.context`, not from anything the model wrote.

**Common mistake → fix:** keeping user facts only in `messages`. When history is trimmed or the user starts a new chat, the facts are gone. Fix: write durable facts to the store (and namespace them by verified user); keep the checkpointer for conversation flow.

**Interview answer:** "The checkpointer is per-thread short-term memory: full state of one conversation. The store is cross-thread long-term memory: namespaced JSON items with optional vector search. I namespace the store by verified user or tenant from runtime context, so each user's memories are isolated."

**Follow-ups:**
- *Managed option on AWS?* AgentCore Memory can back long-term memory (see the AgentCore course, Memory).

---

### Q15. What are durability modes?

**Short answer:** The `durability` setting controls **when** checkpoints are written during a run. `"exit"` saves only when the run ends, errors or interrupts: fastest, but a crash mid-run loses that run's progress. `"async"` saves in the background while the next step runs: good speed and durability, with a small risk that the latest checkpoint is missing if the process dies right then. `"sync"` writes each checkpoint before the next step starts: safest, slowest.

```flow
pipeline: Durability modes, fastest to safest
"exit" > Checkpoint only when the run exits. A crash mid-run loses the whole run's progress.
"async" > The checkpoint is written in the background while the next step runs. A crash can lose the very latest one.
"sync" > Each checkpoint is written before the next step begins. Every finished step survives a crash.
```

**Example:**
```python
graph.invoke(inputs, cfg, durability="sync")      # long, expensive, side-effecting workflow
graph.invoke(inputs, cfg, durability="exit")      # short cheap run, nothing to recover
```

**What happens, step by step (a 10-step document workflow; the process is killed during step 8):**
1. `"sync"`: steps 1 to 7 are all saved. Resume re-runs step 8 only.
2. `"async"`: steps 1 to 6 are certainly saved; step 7's write may or may not have finished. Resume re-runs step 7 or 8.
3. `"exit"`: nothing from this run was saved (the run never exited cleanly). Resume re-runs all 10 steps.

**Common mistake → fix:** choosing `"exit"` for a long workflow because it benchmarks fastest, then losing 20 minutes of paid model calls on every crash. Fix: pick the mode by the cost of redoing work. Short and cheap → `"exit"`; long, expensive or side-effecting → `"sync"`. I could not confirm the default value in the current docs, so set it explicitly for anything important.

**Interview answer:** "Durability controls when checkpoints are persisted: exit writes only at the end of the run, async writes in the background during the next step, and sync writes before moving on. It's a trade-off between latency and how much work you can lose in a crash. For long or expensive workflows I choose sync and make side effects idempotent."

**Follow-ups:**
- *Does durability help against duplicate side effects?* No. Even `sync` can't save a step that crashed halfway; use idempotency (Q17).

---

### Q16. How do you inspect state and use time travel?

**Short answer:** `graph.get_state(config)` returns the latest snapshot (values, `next` nodes, pending tasks, interrupts). `graph.get_state_history(config)` lists all checkpoints of a thread, newest first. **Replay** means invoking from an old checkpoint's config: the nodes **after** it run again. **Fork** means `update_state` on an old checkpoint to create a new branch with edited values, then `invoke(None, new_config)` to continue from there. The original history stays intact.

**How it works:** each checkpoint has an id. Passing a config that contains `checkpoint_id` to `invoke` starts from that checkpoint. Replay does **not** read cached results: model calls, API calls and interrupts fire again and may return different results. Replaying from the final checkpoint (nothing left to run) does nothing.

**Example:**
```python
history = list(graph.get_state_history(cfg))                 # newest first
before_draft = next(s for s in history if s.next == ("draft",))

# Replay: run "draft" again with the same state
graph.invoke(None, before_draft.config)

# Fork: change the order total first, then continue
fork_cfg = graph.update_state(before_draft.config, {"order_total": 80})
graph.invoke(None, fork_cfg)
```

```flow
trace: Forking the refund thread
history: ckpt-1, ckpt-2, ckpt-3, ckpt-4 > get_state_history lists them. ckpt-4 holds a wrong draft built on order_total = 250.
choose ckpt-2 > Its next node is draft, and the state still has order_total = 250.
update_state(ckpt-2, order_total=80) > Creates a new checkpoint **ckpt-2b** branching from ckpt-2. The old ckpt-3 and ckpt-4 stay in history.
invoke(None, ckpt-2b) > draft runs again with 80, then the rest of the graph, producing a new ckpt-3b and ckpt-4b.
```

**What happens, step by step:**
1. You find `ckpt-2` by looking for the snapshot whose `next == ("draft",)`.
2. `update_state` does not roll the thread back. It adds a branch, so you can compare the old and new outcomes.
3. `invoke(None, fork_cfg)` means "no new input, just continue from this checkpoint".
4. `draft` and every later node run again, including any model calls and interrupts. An approval interrupt will pause again and wait for a new resume.

**Common mistake → fix:** replaying a production thread to debug it. The replay re-runs `issue_refund` and pays out again. Fix: debug in an isolated environment with side-effecting tools stubbed or disabled, and record model, prompt and tool versions so differences can be explained.

**Interview answer:** "get_state and get_state_history let me inspect a thread's checkpoints. Time travel has two forms: replay by invoking from an earlier checkpoint, which re-executes everything after it including model calls and interrupts, and fork by editing that checkpoint with update_state and continuing from the new branch. I use it to debug and recover from bad states, in an environment where side effects are disabled."

**Follow-ups:**
- *Does replay give the same answer?* Not necessarily: models and external data change between runs.

---

### Q17. What re-runs after a crash or resume? (durable execution)

**Short answer:** On resume, LangGraph restarts from the **last saved checkpoint**. Nodes that finished in earlier steps are **not** re-run (their results are in state). The node that was interrupted or was running when the crash happened **starts again from its first line**. So anything inside a node that could run twice must be **idempotent** (safe to repeat), or moved to its own node or to a `@task` whose result is saved.

**How it works:** the checkpoint is taken after a step completes. If the process dies during step N, step N's updates were never saved, so the resume repeats step N. A side effect already performed inside that node (a charge, an email, a started job) has still happened in the outside world.

**Example:**
```python
def submit_job(state: State) -> dict:
    job_id = textract.start_job(state["doc"])        # real side effect
    return {"job_id": job_id}                         # saved only when the step completes
```

```flow
trace: A crash between the side effect and the checkpoint
step 4 starts: submit_job runs > It calls Textract. Job **J-1** is created in AWS.
the process crashes before the step ends > The update {job_id: J-1} was never saved. The last checkpoint is the one from step 3.
resume from checkpoint 3 > LangGraph schedules submit_job again from its first line.
submit_job runs again > Without protection, Textract creates a second job **J-2**. With a client token tied to the document hash, it returns J-1 again.
```

**What happens, step by step:**
1. The first run created `J-1`, but state doesn't know that.
2. On resume the node runs again. With `client_token=state["doc_hash"]` (an idempotency key), Textract recognises the repeat and returns `J-1`, so no duplicate job exists.
3. Rule of thumb: every external write gets an idempotency key derived from state that is stable across retries.

**Common mistake → fix:** assuming "the framework resumes exactly where it stopped, in the middle of my function". It doesn't; the unit of recovery is the node. Fix: keep nodes small, one side effect each, with an idempotency key; or use `@task` in the functional API (Q32), where finished tasks are not repeated on replay.

**Interview answer:** "After a crash or interrupt, execution resumes from the last checkpoint. Completed steps aren't re-run, but the node that was in progress restarts from its beginning. So I make every side effect idempotent with a key derived from stable state, and split side effects into separate nodes or tasks so their results are checkpointed before anything else happens."

**Follow-ups:**
- *Why not checkpoint mid-node?* A checkpoint captures state between nodes; local variables in the middle of a Python function can't be saved.

---

## 4. Human-in-the-loop: interrupt & Command

### Q18. How does `interrupt()` work?

**Short answer:** Calling `interrupt(payload)` inside a node **pauses the graph**: state is saved by the checkpointer, and `payload` is returned to the caller. Later you resume the same thread with `Command(resume=value)`, and the paused `interrupt(...)` call **returns `value`**, so the node continues. A checkpointer and a `thread_id` are required, and the payload must be JSON-serialisable.

**How it works:**
1. `interrupt` raises a special exception that stops the node. The run ends cleanly; nothing waits in memory.
2. With `version="v2"`, `invoke` returns a `GraphOutput`; `.interrupts` holds the pending interrupts (each with `.value` and an `.id`).
3. To resume, call `invoke(Command(resume=...), same_config)`. LangGraph loads the checkpoint and **re-runs the node from its start**; this time `interrupt()` returns the resume value instead of pausing.
4. Several interrupts in one node are matched to resume values **by order**. Parallel nodes can be resumed together with `Command(resume={interrupt_id: value, ...})`.

**Example:**
```python
from langgraph.types import interrupt, Command

def approval(state: State):
    decision = interrupt({"action": "refund", "amount": state["amount"], "order": state["order_id"]})
    if decision["approved"]:
        return Command(goto="issue_refund", update={"approved_by": decision["user"]})
    return Command(goto="notify_rejected")

out = graph.invoke({"amount": 250, "order_id": "A12"}, cfg, version="v2")
print(out.interrupts[0].value)       # {'action': 'refund', 'amount': 250, 'order': 'A12'}

# later, from the approval endpoint, after authenticating the manager
graph.invoke(Command(resume={"approved": True, "user": "mgr-7"}), cfg, version="v2")
```

```flow
sequence: Pause for a manager, resume two days later
actors: Your API, Graph, Checkpointer, Manager
Your API -> Graph: invoke(refund A12, 250), thread T
Graph -> Checkpointer: save state, next node approval
Graph --> Your API: interrupts = [{action refund, amount 250}]
> The run has ended. No process is waiting, so it can resume hours later on another server.
Your API -> Manager: show the request
Manager --> Your API: approve
Your API -> Graph: invoke(Command(resume approved=True, user mgr-7), thread T)
Graph -> Checkpointer: load the checkpoint
Graph -> Graph: approval restarts from its first line, interrupt() now returns the decision
> Command(goto issue_refund) sends the flow to the refund step.
```

**What happens, step by step:**
1. First `invoke`: `lookup` and `draft` run. `approval` calls `interrupt({...})`, and the call returns with `out.interrupts` holding the request.
2. Your API shows it in the UI; two days pass.
3. Resume: `approval` runs again from line 1. `interrupt(...)` now returns `{"approved": True, "user": "mgr-7"}`.
4. The node returns `Command(goto="issue_refund", update={"approved_by": "mgr-7"})`, so the state records who approved and the flow moves on.

**Common mistake → fix:** wrapping `interrupt()` in a bare `try/except Exception`. The pause is implemented as an exception, so you swallow it and the graph never pauses. Fix: keep `interrupt` outside broad try blocks, or catch specific exception types only.

**Interview answer:** "interrupt pauses a node, persists state through the checkpointer and returns the payload to the caller. I resume with Command(resume=value) on the same thread, and the interrupt call then returns that value. Because resume re-runs the node from the top, code before the interrupt must be idempotent. My API, not LangGraph, authenticates the approver and binds the approval to the exact action."

**Follow-ups:**
- *Two interrupts in one node?* Matched by order, so never skip or reorder them conditionally.
- *Validation loops (ask again until valid)?* Use a conditional edge back to the node, not a `while True` loop around `interrupt`.

---

### Q19. The #1 interrupt pitfall: code before `interrupt()` runs twice

**Short answer:** Because resume restarts the node from its first line, **everything before `interrupt()` executes again**. If that code charged a card or started a job, it happens twice. Put such side effects in an earlier node (so they are checkpointed before the pause), after the interrupt, or make them idempotent.

```python
def bad(state):
    job_id = textract.start_job(state["doc"])          # runs again on resume
    ok = interrupt({"approve_job": job_id})
    ...
```

```flow
trace: What the bad node does across pause and resume
first run: start_job(doc) > Textract creates job **J-1**. The state does not record it yet because the node has not finished.
first run: interrupt({"approve_job": J-1}) > The run pauses and the node's local variables are discarded.
resume: the node starts from line 1 > start_job(doc) runs again. Textract creates job **J-2**.
resume: interrupt() returns the approval > J-1 is orphaned and still billing. The node continues with J-2.
```

**The fix, in two nodes:**
```python
def prepare(state):                                    # runs once, then checkpointed
    return {"job_id": textract.start_job(state["doc"], client_token=state["doc_hash"])}

def approve(state):                                    # safe to re-run: no side effects before interrupt
    ok = interrupt({"approve_job": state["job_id"]})
    return {"approved": ok}
```

**What happens, step by step:**
1. `prepare` runs and its update `{job_id: "J-1"}` is checkpointed.
2. `approve` pauses at `interrupt`. On resume it starts again, but its only earlier work is reading `state["job_id"]`, which is harmless.
3. Exactly one job exists. The `client_token` protects even a crash inside `prepare`.

**Other interrupt rules (from the docs):**
- Don't wrap `interrupt` in a bare `try/except`.
- Don't conditionally skip or reorder `interrupt` calls inside a node: resume values match by index.
- Don't use a non-deterministic loop (`while True`) around `interrupt`; loop with a conditional edge instead.
- Payloads must be serialisable (JSON-friendly types).

**Common mistake → fix:** logging "approval requested" and sending the Slack message before the `interrupt()`, so reviewers get the message twice. Fix: send notifications from a prior node, or from your API when it sees `out.interrupts`.

**Interview answer:** "On resume the node restarts from the top, so any side effect before interrupt() repeats. I keep the code before an interrupt side-effect-free: do the side effect in a previous node whose result is checkpointed, or do it after the interrupt, and give it an idempotency key. I also never swallow the interrupt exception or reorder interrupts within a node."

**Follow-ups:**
- *Does it apply to the functional API?* The entrypoint replays from the start, but completed `@task` results are reused, so put side effects in tasks.

---

### Q20. What is `Command` used for?

**Short answer:** `Command` has three jobs. (1) Returned **from a node**, it combines a **state update** and a **routing decision**: `Command(update={...}, goto="next_node")`. (2) Passed as **input to `invoke`**, `Command(resume=value)` **resumes** an interrupt. (3) With `graph=Command.PARENT`, a node inside a subgraph can **jump to a node in the parent graph**, which is how agents hand off to each other.

**Example:**
```python
from typing import Literal
from langgraph.types import Command

def planner(state: State) -> Command[Literal["research", "answer"]]:
    plan = make_plan(state["question"])
    return Command(update={"plan": plan}, goto="research" if plan else "answer")

def billing_agent(state):
    if state["topic"] == "shipping":
        return Command(graph=Command.PARENT, goto="shipping_agent",
                       update={"handoff_reason": "customer asked about delivery"})
    ...
```

**What happens, step by step:**
1. `planner` builds a 3-step plan, so it returns `Command(update={"plan": [...]}, goto="research")`.
2. LangGraph applies the update (through reducers) and schedules `research` next. No separate conditional edge is needed.
3. In `billing_agent` (a subgraph node), the parent-level `goto` leaves the subgraph and runs `shipping_agent` in the parent graph, with the update applied to the parent state.
4. `invoke(Command(resume=...))` is the third use (Q18).

**Common mistake → fix:** returning `Command(goto="x")` where `x` is not a node (or hiding destinations so the graph drawing is wrong). Fix: annotate the return type with `Command[Literal["research", "answer"]]` so destinations are declared, and test each route.

**Interview answer:** "Command lets a node update state and choose the next node in one return value, which is handy for agents that decide their own route. The same type resumes an interrupt via Command(resume=...), and Command.PARENT lets a subgraph node jump to a node in the parent graph, which is how multi-agent handoffs are built."

**Follow-ups:**
- *Command or conditional edge?* Conditional edges keep routing separate and visible; Command suits nodes that compute the decision while doing their work.

---

### Q21. What are the common human-in-the-loop patterns?

**Short answer:** Four patterns cover most cases: **approve or reject** a proposed action, **edit** proposed values before they are used, **review** a draft before it is sent, and **ask** the user for missing information. All use `interrupt()`; the difference is what you put in the payload and what you do with the answer. LangGraph pauses and resumes; **your API** decides who may approve.

| Pattern | Payload sent out | What resume returns | What the node does |
|---|---|---|---|
| Approve / reject | the proposed action and args | `{"approved": bool}` | route to execute or reject |
| Edit | the proposed args | the corrected args | use the edited values |
| Review output | the draft | approve, or revised text | send the final text |
| Ask for input | a question | the answer | store it in state and continue |
| Multi-step approvals | one interrupt per stage | each decision | record every approver in state for audit |

**Example (edit pattern):**
```python
def confirm_email(state: State):
    edited = interrupt({"type": "review_email", "to": state["to"], "body": state["draft"]})
    return {"draft": edited["body"], "to": edited["to"]}
```

**What happens, step by step:**
1. The draft goes out in the interrupt payload; your UI shows editable fields.
2. The reviewer changes the recipient and resumes with `{"to": "ops@acme.io", "body": "..."}`.
3. The node writes those values to state; the next node sends **the edited** email.
4. For safety, `send_email` re-checks the recipient against policy, because the reviewer's input is also untrusted.

**Common mistake → fix:** trusting the resume value blindly. A forged API call could approve something else or inject values. Fix: authenticate the approver, check permission, bind the decision to the specific action (for example the hash of the proposed args), validate edited values, and write an audit record.

**Interview answer:** "I use interrupt for approve or reject, edit, review and ask-for-input patterns, putting the proposed action in the payload and routing on the answer. LangGraph only pauses and resumes. My API authenticates the approver, checks they're allowed, binds the decision to the exact proposed action, validates any edits, and stores an audit record."

**Follow-ups:**
- *In LangChain agents?* `HumanInTheLoopMiddleware` does this for tool calls (see the LangChain course, Human-in-the-loop).

---
## 5. Control flow: parallelism, Send, subgraphs, multi-agent

### Q22. How do parallel branches work (fan-out and fan-in)?

**Short answer:** If a node has edges to several nodes, those nodes run **in the same super-step, in parallel**. Their updates are merged by reducers at the end of the step. A node that must wait for several branches uses a **list-form edge**, `add_edge(["a", "b"], "join")`, which runs `join` once, after **all** listed nodes have finished.

**Example:**
```python
class State(TypedDict):
    question: str
    evidence: Annotated[list[str], operator.add]      # reducer so branches can both write
    summary: str

b.add_edge(START, "search_jira")
b.add_edge(START, "search_confluence")                # both start together
b.add_edge(["search_jira", "search_confluence"], "summarise")   # join: waits for BOTH
b.add_edge("summarise", END)
```

**What happens, step by step:**
1. Step 1: `search_jira` and `search_confluence` run in parallel, each seeing `evidence == []`.
2. End of step 1: `evidence` becomes `["JIRA: OPS-12 open", "CONF: runbook RB-7"]` (the order of the two items is not guaranteed).
3. Step 2: `summarise` runs once, with both items.
4. If `search_confluence` raised an error after `search_jira` succeeded, the whole step fails and neither update is applied; use a `RetryPolicy` (Q30) so a transient error is retried instead.

**Common mistake → fix:** branches of **different lengths**. If one path is `a → a2 → join` and the other is `b → join` with plain edges, `join` fires early after `b` and again later. Fix: use the list-form edge, or mark the join node `defer=True` so it waits until all other pending work is done.

**Interview answer:** "Edges from one node to several nodes make them run in the same super-step in parallel. Their writes are merged through reducers, so any shared key needs one. A list-form edge makes a join node wait for all branches, and defer=True handles branches of different length. A failure in any branch fails the step unless I add retries or catch the error."

**Follow-ups:**
- *Limit concurrency?* `config={"max_concurrency": N}`.

---

### Q23. How does map-reduce with `Send` work?

**Short answer:** When the **number** of parallel tasks is only known at run time (one per document), a conditional edge returns a list of `Send("node", item_state)` objects. Each `Send` runs that node once with its own private input. All results flow back through a reducer, and a later node combines them.

**Example:**
```python
from langgraph.types import Send

class State(TypedDict):
    doc_ids: list[str]
    summaries: Annotated[list[str], operator.add]
    report: str

def fan_out(state: State):
    return [Send("summarise_doc", {"doc_id": d}) for d in state["doc_ids"][:20]]   # bounded

def summarise_doc(item: dict) -> dict:
    return {"summaries": [summarise(load(item["doc_id"]))]}

b.add_conditional_edges(START, fan_out, ["summarise_doc"])
b.add_edge("summarise_doc", "combine")
```

```flow
trace: Map-reduce over three documents
input: doc_ids = **["d1", "d2", "d3"]** > The count is known only at run time.
fan_out returns three Send objects > Send("summarise_doc", {doc_id: d1}) and likewise for d2 and d3, each with its own input.
three summarise_doc tasks run in parallel > Each returns {summaries: ["summary of dN"]}.
reducer merges > summaries = **["summary d1", "summary d2", "summary d3"]**.
combine runs once > It writes the report from all three summaries.
```

**What happens, step by step:**
1. For 3 documents, three tasks are created; for 12 documents, twelve. The graph shape didn't change.
2. Each `summarise_doc` sees only its own `{"doc_id": ...}`, not the whole state.
3. Writes go to `summaries`, which has `operator.add`, so nothing conflicts.
4. `combine` runs after all tasks finish.

**Common mistake → fix:** an unbounded fan-out (a user selects 5,000 documents). You launch 5,000 model calls at once and hit rate limits. Fix: cap the list (as with `[:20]` above), batch in rounds, and set `max_concurrency` in config.

**Interview answer:** "Send is for dynamic fan-out: a conditional edge returns one Send per item, each node run gets its own input, and a reducer collects the results for a combine node. I bound the number of items and the concurrency to stay within provider limits."

**Follow-ups:**
- *Results order?* Not guaranteed; carry an id in each result if order matters.

---

### Q24. What happens when several edges enter one node?

**Short answer:** It depends on how you wire it. Separate edges `a → c` and `b → c` mean `c` is **triggered by each** of them: if `a` and `b` finish in the **same** step, `c` runs once with both updates; if they finish in **different** steps, `c` runs **twice**. To say "wait for all", use the list form `add_edge(["a", "b"], "c")` or mark `c` with `defer=True`.

| Wiring | When `c` runs |
|---|---|
| `add_edge("a", "c")` and `add_edge("b", "c")` | after whichever of `a`, `b` ran in the previous step (once per step they appear in) |
| `add_edge(["a", "b"], "c")` | once, after both `a` and `b` have completed |
| `add_node("c", fn, defer=True)` | once, after all other pending work in the graph is finished |

**Example (same-length branches vs different-length):**
```python
# a and b both start at START -> same step -> c runs once with both updates
# b has an extra node b2 -> a finishes in step 1, b2 in step 2:
#   separate edges: c runs in step 2 (after a) AND in step 3 (after b2)  <- surprise
#   list edge:      c runs once, in step 3
b.add_edge(["a", "b2"], "c")
```

**What happens, step by step (b has the extra node b2):**
1. Step 1: `a` and `b` run.
2. Step 2: `b2` runs. With separate edges, `a`'s edge already triggered `c` in step 2, so `c` runs with only `a`'s data.
3. Step 3: `b2`'s edge triggers `c` again. Two runs, two sets of side effects.
4. With the list edge, `c` waits until both `a` and `b2` are done and runs once in step 3.

**Common mistake → fix:** assuming `c` always waits for everything because "both arrows point at it". Fix: choose deliberately (list-form edge or `defer=True` for a join), and write a graph test that asserts how many times `c` runs.

**Interview answer:** "Multiple plain edges into a node trigger it each time one of them completes, so it may run more than once if the branches finish in different super-steps. For a real join I use the list form of add_edge, or defer=True. I test the compiled graph to confirm how often the join node runs."

**Follow-ups:**
- *Why defer?* It's simpler when branch lengths are dynamic, such as map-reduce.

---

### Q25. What is a subgraph, and how does it persist state?

**Short answer:** A **subgraph** is a compiled graph used as a node inside another graph. It gives you modularity, separate ownership and its own state schema. Two ways to use it: add it directly as a node when parent and child **share state keys**, or call it inside a wrapper node when the schemas **differ** and you map inputs and outputs yourself. Its persistence is set by `compile(checkpointer=...)`: `None` (default, per-invocation), `True` (per-thread memory) or `False` (stateless).

| `checkpointer=` | Mode | Behaviour |
|---|---|---|
| `None` (default) | per-invocation | each call starts fresh; interrupts and durable execution still work within the call |
| `True` | per-thread | the subgraph remembers across calls on the same thread (multi-turn memory) |
| `False` | stateless | no checkpointing: no interrupts, no durable execution |

**Example (different schemas, wrapper node):**
```python
billing_graph = billing_builder.compile()                 # own state: {query, account_id, result}

def call_billing(state: Parent) -> dict:
    out = billing_graph.invoke({"query": state["question"], "account_id": state["acct"]})
    return {"answer": out["result"]}                      # map child output -> parent update

parent.add_node("billing", call_billing)
```

**What happens, step by step:**
1. The parent reaches `billing` with `question = "Why was I charged twice?"`, `acct = "A-9"`.
2. The wrapper builds the child's input, runs the child graph (its own nodes and steps), and gets `{"result": "Duplicate charge refunded."}`.
3. It returns `{"answer": "Duplicate charge refunded."}` to the parent, which merges it.
4. With the default `checkpointer=None`, the next call to `billing` starts from empty child state. With `checkpointer=True` it would remember the earlier exchange.

**Common mistake → fix:** compiling the same stateful (`True`) subgraph and calling it several times inside one node: the calls write into the same checkpoint namespace and conflict. Fix: use the default per-invocation mode for repeated calls, and `True` only when a subgraph truly needs multi-turn memory.

**Interview answer:** "A subgraph is a compiled graph used as a node. If it shares state keys with the parent I add it directly; if the schemas differ I call it inside a wrapper node and map the data. Its persistence is controlled at compile time: per-invocation by default, per-thread with checkpointer=True for memory across calls, or stateless with False. Interrupts inside subgraphs work with the default and per-thread modes."

**Follow-ups:**
- *Inspect a subgraph's state?* `graph.get_state(config, subgraphs=True)` (per-thread mode keeps accumulated state).

---

### Q26. What multi-agent architectures exist in LangGraph?

**Short answer:** Three common shapes. **Supervisor:** one central LLM decides which worker agent runs next and aggregates results (most controllable). **Swarm / handoffs:** agents pass control directly to each other with `Command(goto=..., graph=Command.PARENT)`, and the active agent is remembered in state. **Hierarchical:** supervisors of supervisors for large systems. Give each agent its own tools and minimal context.

| | Supervisor | Swarm / handoffs |
|---|---|---|
| Who decides the next agent | a central supervisor | the current agent |
| Control and audit | high (one place to see decisions) | lower, more flexible |
| Latency | extra supervisor model call per hop | direct handoffs |
| Good for | tasks split into known specialities | conversations that move between roles |

**Example (handoff):**
```python
def triage(state: MessagesState) -> Command[Literal["billing", "shipping"]]:
    topic = classify(state["messages"][-1].content)       # "billing" or "shipping"
    return Command(goto=topic, update={"active_agent": topic})
```

**What happens, step by step ("Why was I charged twice?"):**
1. `triage` classifies the message as billing and returns `Command(goto="billing", update={"active_agent": "billing"})`.
2. The `billing` agent runs with only the billing tools and answers.
3. On the next turn, the checkpointed `active_agent` is `billing`, so the conversation continues with the same agent, unless it hands off.
4. If the user asks about delivery, `billing` returns a handoff `Command` to `shipping`.

**Common mistake → fix:** passing the full history and all tools to every agent. Cost rises, tools get confused, and a compromised agent can use everything. Fix: each agent gets only its tools, and handoffs pass only what the next agent needs (a short summary or specific fields).

**Interview answer:** "I choose a supervisor when I want central control and an audit trail, and handoffs between agents when the conversation naturally moves between roles. Each agent is usually a subgraph with its own tools and minimal context; handoffs use Command with the parent graph target. More agents means more cost and failure points, so I only split where the specialisation pays off."

**Follow-ups:**
- *Libraries?* `langgraph-supervisor` and `langgraph-swarm` provide ready-made versions of both patterns.

---

### Q27. How should you do conditional routing?

**Short answer:** Route in order of cost and certainty: **deterministic rules** first (regex, metadata, permissions: free and predictable), then a **small classifier or LLM with structured output constrained to a fixed list of destinations**, with a **fallback route** (clarify or human) for low confidence. Always route sensitive actions through an approval path, and log every routing decision so routing can be evaluated.

**Example:**
```python
from typing import Literal
from pydantic import BaseModel

class Route(BaseModel):
    destination: Literal["rag", "sql", "human"]
    confidence: float

router_llm = model.with_structured_output(Route)

def route(state: State) -> str:
    text = state["messages"][-1].content
    if text.startswith("/sql "):                      # deterministic rule first
        return "sql"
    r = router_llm.invoke(f"Choose a destination for: {text}")
    return r.destination if r.confidence >= 0.7 else "human"
```

**What happens, step by step:**
1. "/sql select count(*)…" matches the rule and goes to `sql` with no model call.
2. "What is the leave policy?" has no rule match; the LLM returns `rag` with confidence 0.93 → `rag`.
3. "hmm maybe?" returns `rag` with confidence 0.4 → below 0.7, so it goes to `human` instead of guessing.
4. Each decision, with its confidence, is logged for later accuracy checks.

**Common mistake → fix:** letting the LLM return free text like "I think it should go to the database" and matching with `if "database" in text`. Fix: constrain output to an enum via structured output, so the router can only return allowed values.

**Interview answer:** "I route with deterministic checks where possible, and use an LLM only when needed, constrained by structured output to an enum of destinations with a confidence score. Low confidence goes to a fallback like clarify or human. Sensitive actions always pass through an approval node, and I log every decision to measure routing accuracy."

**Follow-ups:**
- *Why log confidence?* To tune the threshold and spot where the router needs better examples.

---

### Q28. How do you design a planner, executor and verifier loop with context pruning?

**Short answer:** Split the work into three roles in a loop. The **planner** writes a typed plan into state. The **executor** runs each step with a limited set of tools (use `Send` to run steps in parallel). The **verifier** checks the evidence and citations. If verification fails and fewer than N rounds have been used, control returns to the planner with the verifier's feedback; otherwise a **pruner** summarises bulky tool output (keeping ids and approvals) and the final answer is written.

**Example (state and routing):**
```python
class State(TypedDict):
    question: str
    plan: list[str]
    evidence: Annotated[list[dict], operator.add]
    feedback: str
    iterations: int

def after_verify(state: State) -> Literal["planner", "prune"]:
    ok = all(e.get("cited") for e in state["evidence"])
    return "prune" if ok or state["iterations"] >= 3 else "planner"
```

```flow
cycle: Planner, executor, verifier for "Compare 2025 and 2026 refund policy"
planner > Writes a 2-step plan: read the 2025 policy, read the 2026 policy.
executor > Runs both steps in parallel and returns two evidence items.
verifier > Finds that the 2026 evidence has no citation and writes feedback "cite the policy section".
back to planner > Round 2 plans only the missing citation step (iterations = 1).
exit > Round 2 passes verification, or iterations reach 3. The pruner then summarises the evidence and the answer is written.
```

**What happens, step by step:**
1. Round 1 ends with `iterations = 1` and failed verification, so `after_verify` returns `"planner"`.
2. Round 2 re-plans with `feedback` in the prompt, runs one step, and verification passes → `"prune"`.
3. The pruner replaces 30 KB of raw tool output with a 1 KB summary plus references (document ids stored in S3 or a database), keeping approvals and ids intact.
4. If verification kept failing, round 3 would still exit via the `iterations >= 3` rule, with an honest "couldn't fully verify" answer.

**Common mistake → fix:** a verifier loop with no iteration cap, which can spin until the recursion limit. Fix: store `iterations` in state, cap it in the router, and decide what to answer when the cap is reached.

**Interview answer:** "I separate planning, execution and verification into nodes with typed state: plan, evidence with a reducer, iteration count and feedback. Executors fan out with Send, the verifier checks citations, and a router loops back to the planner with feedback up to a fixed number of rounds. A pruning step then replaces bulky outputs with summaries and references so context stays small."

**Follow-ups:**
- *Why not one agent?* Separate roles are testable, can use different models and tools, and make failures easier to locate.

---

## 6. Streaming, errors, caching, functional API

### Q29. What streaming modes exist?

**Short answer:** `graph.stream(input, config, stream_mode=...)` yields events while the graph runs. Modes: **`values`** (full state after each step), **`updates`** (only what each node returned), **`messages`** (LLM tokens with metadata about the node), **`custom`** (your own events from `get_stream_writer()`), **`checkpoints`** and **`tasks`** (need a checkpointer), and **`debug`** (everything). Pass a list to combine several. With `version="v2"` each chunk is a dict with `type`, `ns` (which subgraph) and `data`.

| `stream_mode` | You get |
|---|---|
| `"values"` | the full state after each step |
| `"updates"` | `{node_name: update}` for each finished node |
| `"messages"` | `(token_chunk, metadata)` while an LLM writes |
| `"custom"` | whatever your code sends through the stream writer |
| `"checkpoints"` / `"tasks"` | checkpoint events / task start and finish events (need a checkpointer) |
| `"debug"` | checkpoints and tasks combined, with extra metadata |

**Example:**
```python
from langgraph.config import get_stream_writer

def ocr(state: State) -> dict:
    writer = get_stream_writer()
    for i, page in enumerate(state["pages"], 1):
        text = run_ocr(page)
        writer({"status": "ocr", "done": i, "total": len(state["pages"])})
    return {"text": "..."}

for chunk in graph.stream(inputs, cfg, stream_mode=["updates", "messages", "custom"], version="v2"):
    if chunk["type"] == "custom":
        send_sse({"event": "progress", **chunk["data"]})
    elif chunk["type"] == "messages":
        token, meta = chunk["data"]
        send_sse({"event": "token", "text": token.content})
    elif chunk["type"] == "updates":
        send_sse({"event": "step", "node": next(iter(chunk["data"]))})
```

**What happens, step by step (3-page document):**
1. `custom` chunks: `{status: ocr, done: 1, total: 3}`, then 2 of 3, then 3 of 3. The UI shows a progress bar.
2. An `updates` chunk `{"ocr": {...}}` arrives when the node ends, so the UI shows step "ocr done".
3. The next node writes an answer with an LLM: `messages` chunks arrive token by token for the typing effect.

**Common mistake → fix:** forwarding raw chunks to the browser. It exposes internal node names, state and possibly secrets, and ties the front end to your graph layout. Fix: translate into a small stable protocol (`step`, `token`, `progress`, `approval_needed`, `done`, `error`) in your API, usually over server-sent events.

**Interview answer:** "stream_mode selects what I receive: updates for step progress, messages for LLM tokens, custom for progress events I emit through the stream writer, values for full state, plus checkpoints, tasks and debug for diagnostics. I combine modes in a list, include subgraph events when needed, and map everything to a stable event protocol for the client."

**Follow-ups:**
- *Streaming from subgraphs?* Pass `subgraphs=True`; each chunk's `ns` identifies where it came from.

---

### Q30. How do error handling and retries work?

**Short answer:** Attach a **`RetryPolicy`** to a node to automatically retry **transient** errors with backoff. Defaults: `max_attempts=3` (including the first), `initial_interval=0.5`s, `backoff_factor=2.0`, `max_interval=128`s, jitter on. By default it retries any exception **except** programmer-style errors (`ValueError`, `TypeError`, `RuntimeError`, `OSError` and similar), and for `requests`/`httpx` errors only on HTTP 5xx. For permanent errors, catch them in the node, write an error field to state, and route to an error path.

**Example:**
```python
from langgraph.types import RetryPolicy

builder.add_node(
    "call_api", call_api,
    retry_policy=RetryPolicy(max_attempts=4, initial_interval=1.0, backoff_factor=2.0,
                             retry_on=(TimeoutError, ConnectionError)),
)

def call_api(state: State) -> dict:
    try:
        return {"data": api.get(state["id"])}
    except PermissionDenied:
        return {"error": "access_denied"}                # permanent: do not retry

builder.add_conditional_edges("call_api", lambda s: "denied" if s.get("error") else "next")
```

**What happens, step by step:**
1. Attempt 1 raises `TimeoutError` → wait about 1s → attempt 2 raises `TimeoutError` → wait about 2s → attempt 3 succeeds. The step completes once, with one update.
2. If `PermissionDenied` is raised, the node catches it, returns `{"error": "access_denied"}`, and the conditional edge routes to the `denied` node. Retrying a permission failure would never help.
3. After the last failed attempt of a retryable error, the exception propagates and the run fails at the last checkpoint, so it can be resumed later.

**Common mistake → fix:** retrying a non-idempotent node (one that charges a card). The first attempt may have succeeded before the timeout, so the retry charges again. Fix: idempotency key (Q17), or retry only the read steps. Also note: `interrupt()` is control flow, not an error, so retry policies don't apply to it.

**Interview answer:** "I put a RetryPolicy on nodes that call flaky dependencies, restricting retry_on to transient errors, and I handle permanent errors inside the node by writing an error to state and routing to a denied or fallback path. Retried nodes must be idempotent, and interrupts are control flow rather than errors."

**Follow-ups:**
- *Node timeouts?* Recent versions have `NodeTimeoutError`, which is retryable by default; check the version you deploy.

---

### Q31. What is node caching?

**Short answer:** **Node caching** skips re-running an expensive, deterministic node when it is called again with the same input. You give the node a `CachePolicy(ttl=seconds)` and pass a cache to `compile(cache=...)` (`InMemoryCache`, or `SqliteCache`). The cache key defaults to a pickle hash of the node's input (override with `key_func`); with no `ttl`, entries never expire.

**Example:**
```python
from langgraph.types import CachePolicy
from langgraph.cache.memory import InMemoryCache

builder.add_node("embed", embed_chunk, cache_policy=CachePolicy(ttl=3600))
graph = builder.compile(cache=InMemoryCache())

graph.invoke({"chunk": "abc"})
graph.invoke({"chunk": "abc"})       # second run: cache hit
graph.invoke({"chunk": "xyz"})       # different input: computed
```

**What happens, step by step:**
1. First call: `embed("abc")` runs (say 800 ms) and the result is stored with a 1-hour TTL.
2. Second call, same input: the node is skipped and the stored result is used. In `updates` mode the chunk carries `__metadata__: {"cached": True}`.
3. Third call, different input: a different key, so the node runs.
4. After an hour the entry expires and the next call recomputes.

**Common mistake → fix:** caching a node that reads changing data or has side effects (`get_stock_price`, `send_email`). A cache hit returns an old price and silently skips the email. Fix: cache only pure, deterministic nodes, or include a version/date in the key via `key_func`.

**Interview answer:** "Node caching stores a node's result keyed by its input, so identical calls skip re-execution. I set a CachePolicy with a TTL on pure, expensive nodes like embedding or parsing, and pass a cache at compile time. I never cache nodes with side effects or time-dependent results."

**Follow-ups:**
- *Is it the same as the checkpointer?* No. Checkpoints are per thread for resume; the cache is shared by input across runs to save work.

---

### Q32. What is the Functional API (`@entrypoint` and `@task`)?

**Short answer:** The Functional API lets you write a workflow as ordinary Python (`if`, `for`, `while`) instead of nodes and edges, and still get persistence, interrupts and streaming. `@entrypoint(checkpointer=...)` marks the workflow function. `@task` marks a unit of work (typically a side effect or model call) whose **result is saved**, so on resume completed tasks are not run again. Tasks return futures, so calling several runs them in parallel.

**How it works:** on resume, the entrypoint function replays **from its beginning**, but each `@task` call is matched to its saved result by position and returns it without re-executing. This is why code outside tasks must be deterministic: no `time.time()`, `random()` or inline network calls, and don't add, remove or reorder `@task` or `interrupt` calls in code that paused workflows may replay.

**Example:**
```python
from langgraph.func import entrypoint, task
from langgraph.types import interrupt

@task
def extract(doc_id: str) -> dict:
    return textract_extract(doc_id)               # side effect, result saved

@entrypoint(checkpointer=saver)
def workflow(doc_ids: list[str]) -> list[dict]:
    futures = [extract(d) for d in doc_ids]       # run in parallel
    results = [f.result() for f in futures]
    approved = interrupt({"review": results})     # pause for a human
    return results if approved else []
```

**What happens, step by step (3 documents):**
1. Three `extract` tasks start in parallel and save their results.
2. The workflow calls `interrupt(...)` and pauses.
3. On resume, the function runs from the top, but `extract(d1..d3)` return their saved results immediately. Textract is **not** called again.
4. `interrupt` returns the human's answer and the function returns the results.

**Common mistake → fix:** doing the Textract call directly in the entrypoint body (not in a `@task`). Each resume repeats it. Fix: every side effect or non-deterministic call lives in a `@task`.

**Interview answer:** "The Functional API expresses a workflow as plain Python. @entrypoint adds persistence, interrupts and streaming, and @task wraps units of work whose results are checkpointed, so a resume replays the function but reuses finished task results. I put every side effect in a task and keep the rest deterministic. I choose the Graph API when I want an explicit, visualisable topology."

**Follow-ups:**
- *Short-term memory across calls?* The entrypoint can take a `previous` parameter and return `entrypoint.final(value=..., save=...)` to decouple what's returned from what's saved.

---

### Q33. Static vs dynamic breakpoints

**Short answer:** A **static breakpoint** is set when compiling or invoking: `interrupt_before=["tools"]` pauses before that node **every time**. It's a debugging tool; you resume with `invoke(None, config)`. A **dynamic** breakpoint is `interrupt()` inside a node: it pauses only when your logic decides, carries a payload, and returns the human's answer on resume (`Command(resume=...)`). Use dynamic interrupts for production approvals.

| | Static (`interrupt_before/after`) | Dynamic (`interrupt()`) |
|---|---|---|
| Set where | `compile(...)` or `invoke(...)` | inside a node |
| Pauses | always, at the named node | only when code calls it |
| Payload to human | none (inspect state instead) | any JSON value |
| Resume with | `invoke(None, config)` | `Command(resume=value)` |
| Use for | stepping through during development | approvals, edits, questions |

**Example:**
```python
graph = builder.compile(checkpointer=saver, interrupt_before=["tools"])   # debugging
# dynamic: pause only for large amounts
def check_amount(state):
    if state["amount"] > 100:
        decision = interrupt({"approve_amount": state["amount"]})
```

**What happens, step by step:**
1. With the static breakpoint, every run stops before `tools`. You read `graph.get_state(cfg).next` (`("tools",)`) and the pending tool call, then `graph.invoke(None, cfg)` continues.
2. With the dynamic one, a refund of 40 passes straight through; a refund of 250 pauses and returns the request payload to your API.

**Common mistake → fix:** shipping `interrupt_before` to production as the approval mechanism. Every request now stops, including harmless ones. Fix: dynamic `interrupt()` guarded by a condition.

**Interview answer:** "Static breakpoints pause before or after named nodes every time and are for debugging; dynamic interrupts are called inside a node, are conditional, carry a payload and resume with a value. I use static ones when stepping through a graph and dynamic ones for production approvals."

**Follow-ups:**
- *Both need a checkpointer?* Yes.

---

## 7. Production engineering

### Q34. How do you deploy LangGraph?

**Short answer:** There are three common routes. (1) **Your own service** (for example FastAPI on a container platform) with a shared Postgres checkpointer: full control, you operate it. (2) **LangSmith Deployment** (the Agent Server), which provides threads, runs, cron jobs and streaming APIs ready-made. (3) **A managed agent platform** such as Amazon Bedrock AgentCore Runtime, which hosts your container per session. In every case the checkpointer must be **durable and external**; container memory is temporary.

| Option | You get | You operate |
|---|---|---|
| Own service on containers | full control, any infrastructure | API, scaling, database, auth |
| LangSmith Deployment | threads, runs, background runs, streaming built in | little; vendor platform |
| AgentCore Runtime | per-session isolation, identity, observability integration | your container and its configuration |

**How to choose:** ask who must operate it, what isolation and compliance you need, and whether you already run a platform. Whatever you pick, plan the checkpointer database, thread ownership checks and migrations first.

**Example (own service, minimal):**
```python
app = FastAPI()
saver = AsyncPostgresSaver(pool)                       # shared by all replicas
graph = builder.compile(checkpointer=saver)

@app.post("/chat/{conv_id}")
async def chat(conv_id: str, body: Msg, user=Depends(current_user)):
    thread = await owned_thread(conv_id, user)          # ownership check (Q13)
    return await graph.ainvoke({"messages": [("user", body.text)]},
                               {"configurable": {"thread_id": thread}},
                               context=Ctx(user_id=user.id, tenant_id=user.tenant_id))
```

**What happens, step by step:**
1. Two replicas run behind a load balancer; both use the same Postgres.
2. Turn 1 lands on replica A; turn 2 on replica B. B loads the thread from Postgres, so the conversation continues.
3. A rolling deploy replaces both replicas; the paused approval from yesterday is still in Postgres and can resume on the new code (check state compatibility, Q38).

**Common mistake → fix:** relying on sticky sessions and in-memory state. A deploy or scale-in breaks conversations. Fix: stateless app servers, state in the database.

**Interview answer:** "I can run LangGraph in my own FastAPI service with a Postgres checkpointer, use LangSmith Deployment for a ready-made agent server, or host it on a managed runtime such as AgentCore. The constant is a durable external checkpointer and server-side thread ownership; I choose the platform by who operates it and the isolation I need."

**Follow-ups:**
- *Background or long runs?* Use a queue or the platform's background runs, and stream status from checkpoints rather than keeping a request open.

---

### Q35. How does LangGraph run on AgentCore Runtime? Do the layers overlap?

**Short answer:** AgentCore Runtime is the **hosting** layer: it runs your container for a session, with isolation, authentication and observability. LangGraph is the **orchestration** layer inside the container, and its checkpointer is the **conversation persistence** layer. They solve different problems: a Runtime session can end (idle timeout or maximum lifetime), but the checkpointer restores the conversation in the next session. Your backend maps verified user → session id and → thread id. (Details and current limits are in the AgentCore course.)

```flow
sequence: One chat turn on AgentCore Runtime with a LangGraph agent
actors: Client, AgentCore Runtime, LangGraph, Checkpointer, Gateway
Client -> AgentCore Runtime: invoke with session id and credentials
AgentCore Runtime -> LangGraph: run the agent code in the session's container
LangGraph -> Checkpointer: load the state for thread conv-42
Checkpointer --> LangGraph: saved messages
LangGraph -> Gateway: call a tool through the gateway
Gateway --> LangGraph: tool result
LangGraph -> Checkpointer: save checkpoints
LangGraph --> Client: streamed answer
> The checkpointer is external (for example Postgres), so a new session can load conv-42 even if the old container is gone.
```

**What happens, step by step:**
1. The client call is authenticated by Runtime, which routes it to the session's container.
2. The graph loads thread `conv-42` from the external checkpointer and runs, calling tools via the Gateway.
3. Checkpoints are written to the external store during the run.
4. After the session expires, a later call with a new session id but the same `thread_id` loads the same history: the conversation survives although the container did not.

**Common mistake → fix:** treating the Runtime session as the conversation store ("the session is still alive, so the history is there"). When the session ends, in-container memory is gone, and a pending approval is lost. Fix: persist with a durable checkpointer and keep the thread id mapping in your own database.

**Interview answer:** "AgentCore Runtime hosts and isolates the container per session; LangGraph orchestrates the steps inside it; the checkpointer persists the conversation externally. They're different layers: a session can expire but the thread continues in a new session because state lives in Postgres or another durable store. My backend owns the mapping from verified user to session and thread."

**Follow-ups:**
- *Why not rely on the session?* Sessions have idle and lifetime limits, and a paused approval can outlive them.

---

### Q36. How do you keep large message state manageable?

**Short answer:** Big histories raise token cost and latency, make checkpoints large and slow to serialise, and increase privacy exposure. Fix it by **trimming or summarising** old turns (keep recent ones verbatim), storing large tool outputs **outside state** (S3 or a database) and keeping only a reference, and keeping exact facts (ids, amounts, approvals) in **dedicated structured fields** that never get summarised away.

**Example:**
```python
def store_big_result(state: State) -> dict:
    result = run_report(state["query"])                      # 5 MB JSON
    key = f"reports/{state['thread_key']}/{uuid4()}.json"
    s3.put_object(Bucket=BUCKET, Key=key, Body=json.dumps(result))
    return {"report_ref": key, "report_rows": len(result["rows"]),
            "messages": [ToolMessage(f"Report stored ({len(result['rows'])} rows).", tool_call_id=state["call_id"])]}
```

**What happens, step by step:**
1. The 5 MB result goes to S3; state keeps the key and a row count, and the message history gets a one-line note.
2. Each checkpoint now stores a few hundred bytes instead of 5 MB, so each step is faster and cheaper.
3. A later node that needs the data reads it from S3 by `report_ref`, with access checked against the user.
4. The approval record (`approved_by`, `approved_amount`) stays in its own state fields, untouched by summarisation.

**Common mistake → fix:** summarising away the amount a user approved, then paying a different amount. Fix: summarise conversational text only; facts that drive actions live in structured fields.

**Interview answer:** "Large state costs tokens, latency, checkpoint storage and privacy exposure. I trim or summarise history while keeping recent turns, store big tool outputs in S3 or a database with only a reference in state, and keep IDs, amounts and approvals in structured fields so they are never lost in a summary."

**Follow-ups:**
- *Retention?* Set expiry on old threads and on the S3 objects that belong to them.

---

### Q37. How do you prevent cross-user access to checkpoints and memory?

**Short answer:** Thread ids and namespaces are only keys, so isolation is **your** job at the API layer. Generate unguessable thread ids on the server; check ownership before **every** call that touches a thread (`invoke`, `get_state`, `get_state_history`, `update_state`); build store namespaces from verified identity in runtime context; encrypt the database (and optionally use an encrypted serializer); keep audit logs and a retention policy.

**Checklist, with what each item prevents:**
1. Server-generated UUID thread ids → guessing or enumerating other users' threads.
2. Ownership table (conversation → owner) checked on every call → using someone else's id.
3. Namespace `("users", user_id, ...)` from `runtime.context`, never from model output or request body → reading another user's memories.
4. Database encryption and restricted DB credentials → leaked backups or a stolen read-only account.
5. Audit log of state reads and updates, especially `update_state` → undetected tampering with a paused approval.
6. Retention and deletion by thread/user → keeping personal data longer than needed.

**Example:**
```python
@app.get("/threads/{conv_id}/state")
def get_thread_state(conv_id: str, user=Depends(current_user)):
    conv = db.get_conversation(conv_id)
    if conv is None or conv.owner_id != user.id:
        raise HTTPException(404)
    snap = graph.get_state({"configurable": {"thread_id": conv.thread_id}})
    return redact_for_client(snap.values)
```

**What happens, step by step:**
1. User B requests user A's conversation id. The ownership check fails and the API returns 404 before the checkpointer is queried.
2. User A's own request passes and returns state with internal keys redacted.
3. An `update_state` endpoint (for admin edits) additionally requires an admin role and writes an audit record, because editing state can change what an approval node does.

**Common mistake → fix:** protecting `invoke` but forgetting a "debug" endpoint that exposes `get_state_history`. Fix: wrap graph access in one function that always checks ownership, so no route can bypass it.

**Interview answer:** "LangGraph doesn't authenticate; thread ids and namespaces are just keys. I use unguessable server-generated thread ids, check ownership on every graph call including state inspection and updates, derive memory namespaces from verified identity in runtime context, encrypt the database, and log and expire data."

**Follow-ups:**
- *Multi-tenant?* Add the tenant to the ownership check and namespace, and consider separate databases for strict isolation.

---

### Q38. How do you change the state schema safely across deployments?

**Short answer:** Threads can outlive a deployment: a thread paused for approval last week resumes on today's code. So schema changes must be **backward compatible**: add new keys with defaults, don't rename or remove keys in one step, tolerate missing fields, migrate lazily when old state is loaded, and **test resuming from real old checkpoints** before releasing. Also don't rename or remove nodes that paused threads are waiting in.

**How to do a rename safely (numbered):**
1. Release 1: add `customer_email` (new) and keep `email` (old). Code reads `state.get("customer_email") or state.get("email")` and writes both.
2. Wait until all threads started before release 1 have finished or expired.
3. Release 2: stop writing `email`; keep reading it as a fallback if needed.
4. Release 3: remove `email`.

**Example:**
```python
def send_receipt(state: State) -> dict:
    to = state.get("customer_email") or state.get("email")     # tolerate old checkpoints
    if to is None:
        return {"error": "missing_email"}
    ...
```

**What happens, step by step:**
1. A thread paused before release 1 has only `email`. On resume, `send_receipt` falls back to it and works.
2. A new thread has `customer_email`, and the same code uses it.
3. Had release 1 simply renamed the key, the old thread would hit `KeyError` on resume, after the human approved, which is the worst moment to fail.

**Common mistake → fix:** renaming a node (`approval` → `manager_approval`) while threads are paused in it. Their checkpoints point at the old name. Fix: keep the old node name (or keep an alias node that forwards) until those threads are gone.

**Interview answer:** "Because threads outlive deployments, I make state changes backward compatible: add fields with defaults, avoid renames and removals in a single release, read old shapes tolerantly, remove things only after old threads finish, keep node names that paused threads wait in, and test resuming real old checkpoints."

**Follow-ups:**
- *Functional API?* Don't add, remove or reorder `@task` or `interrupt` calls that come before the resume point in code that paused runs may replay.

---

### Q39. How do you test graphs, not just nodes?

**Short answer:** Test in layers. **Nodes** are plain functions: input state in, update out. **Routers and reducers** are pure functions you can test directly. **The whole graph** is tested with a fake chat model (scripted replies) and `InMemorySaver`, asserting the node path and final state. Then test **interrupt and resume**, **crash and resume**, parallel merges and recursion limits. Finally, run **evaluations** on a real model for quality.

**Example (graph test with a fake model):**
```python
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain.messages import AIMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

def test_refund_needs_approval():
    graph = build_graph(model=FakeToolModel(messages=iter([
        AIMessage(content="", tool_calls=[{"name": "issue_refund", "args": {"amount": 250}, "id": "c1"}]),
        AIMessage(content="Refund issued."),
    ])), checkpointer=InMemorySaver())
    cfg = {"configurable": {"thread_id": "test-1"}}

    out = graph.invoke({"messages": [("user", "refund 250")]}, cfg, version="v2")
    assert out.interrupts and out.interrupts[0].value["amount"] == 250
    assert payments.refund_count == 0                     # nothing executed yet

    out = graph.invoke(Command(resume={"approved": True, "user": "mgr-7"}), cfg, version="v2")
    assert payments.refund_count == 1                     # executed exactly once
```

**What happens, step by step:**
1. The fake model proposes a 250 refund.
2. The graph reaches the approval node and pauses; the test checks the payload and that no payment happened.
3. Resuming with approval runs the refund once; the test asserts `refund_count == 1`, which also proves the pre-interrupt code did not duplicate the side effect.
4. A crash test kills the run mid-step (raise an exception in a node), then re-invokes with `None` and checks that completed steps were not repeated.

**Common mistake → fix:** testing only with a real model. Tests become slow, costly and flaky, and cannot check "exactly once". Fix: deterministic fake-model tests for control flow, plus a smaller evaluation set on real models for quality.

**Interview answer:** "I unit-test nodes, routers and reducers directly, integration-test the compiled graph with a scripted fake model and an in-memory checkpointer, and specifically test interrupt and resume, crash and resume, parallel merges and recursion limits. Quality is measured with evaluation datasets, including trajectory checks of the expected tool calls and node path."

**Follow-ups:**
- *Test a resume from an old release?* Save checkpoints from the previous version and load them in CI against the new code.

---

### Q40. How do you handle tracing and sensitive data?

**Short answer:** Tracing (LangSmith or OpenTelemetry) records every node, model call and tool call with inputs and outputs, which is great for debugging and also a copy of your users' data. Mask PII and secrets **at capture time**, sample traces in high-volume systems, restrict who can read them, and set a retention period. Never log authorisation headers, account numbers, or approval payloads containing personal data.

**How it works:** most tracers let you hide inputs/outputs for chosen runs or provide a masking function applied before data leaves your process. Redaction in the graph itself (for example PII middleware before the model) reduces what ever reaches traces.

**Example:**
```python
import re
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")

def mask(data):
    if isinstance(data, str):
        return EMAIL.sub("[EMAIL]", data)
    if isinstance(data, dict):
        return {k: ("[REDACTED]" if k in {"authorization", "api_key"} else mask(v)) for k, v in data.items()}
    if isinstance(data, list):
        return [mask(v) for v in data]
    return data
# register `mask` with your tracing client's input/output masking hook (name depends on the tracer SDK)
```

**What happens, step by step:**
1. A user message "my email is asha@example.com" reaches the model node.
2. The tracer applies `mask` before sending the span: the trace shows "my email is [EMAIL]".
3. A tool call containing `{"authorization": "Bearer ..."}` is stored as `[REDACTED]`.
4. Traces expire after the retention period (for example 30 days; choose per policy), and only on-call engineers can open production traces.

**Common mistake → fix:** turning on full tracing in production "temporarily" and forgetting. Customer data piles up in a third-party system. Fix: decide masking, retention and access **before** enabling, and review it like any other data store.

**Interview answer:** "Traces capture everything, so I treat them as a data store: mask PII and secrets at capture time, sample, restrict access, set retention, and keep tokens and approval payloads out. I also redact before the model where I can, so sensitive data never enters prompts or traces in the first place."

**Follow-ups:**
- *What should traces contain for debugging?* Node path, tool names, timings, token counts, versions and error classes, with content masked.

---

## 8. Scenario & debugging questions

### Q41. The graph repeats an expensive tool call after a supervisor approves

**Short answer:** The expensive call sits **before `interrupt()`** in the same node, so it re-ran when the node restarted on resume. Move it into an earlier node (its result is checkpointed), or into a `@task`, or give it an idempotency key.

**Debugging steps:**
1. **Find the node.** In the trace, the repeated tool call appears twice inside the same node, once before the pause and once after the resume.
2. **Confirm the order in the code.** Is there an `interrupt(...)` below the call in that node? If yes, that is the cause.
3. **Check the cost or side effect.** Is it a read (wasted money) or a write (duplicate effect)? Writes need an idempotency key as well.
4. **Fix.** Split the node.

**Example:**
```python
# before: act() does run_query() then interrupt(); the query runs on resume as well
def query(state):                     # node 1: result checkpointed
    return {"rows": run_query(state["sql"])}

def approve(state):                   # node 2: no side effects before the interrupt
    return {"approved": interrupt({"sql": state["sql"], "row_count": len(state["rows"])})}

def act(state):                       # node 3: runs once, after approval
    return {"result": apply(state["rows"])} if state["approved"] else {}
```

```flow
trace: The repeated query, before and after the fix
before the fix: act runs run_query() then interrupt() > The query costs money once, and the run pauses.
supervisor approves, the node restarts from line 1 > run_query() runs a **second** time.
after the fix: query node finishes > The rows are in state, and a checkpoint is saved.
after the fix: approve pauses and resumes > On resume it only reads state["rows"], so the query is not repeated.
```

**What happens, step by step:** with three nodes, the query is billed once; the approval node can restart as often as needed because it does nothing expensive before the interrupt.

**Common mistake → fix:** caching the query result in a module-level variable to avoid the repeat. It disappears when the process restarts or the resume lands on another replica. Fix: keep it in state (checkpointed).

**Interview answer:** "The tool call was before interrupt in the same node, and resume restarts the node from the top. I move the expensive call into its own earlier node so its output is checkpointed, keep the approval node free of side effects, and add an idempotency key if the call is a write."

**Follow-ups:**
- *Same problem in the functional API?* Wrap the call in a `@task` so replay reuses its result.

---

### Q42. "InvalidUpdateError: can receive only one value per step". How do you fix it?

**Short answer:** Two nodes that ran in the **same super-step** both wrote the same state key, and that key has **no reducer**, so LangGraph can't decide which value wins. Either give the key a reducer, or make each branch write a different key.

**Debugging steps:**
1. **Read the error.** It names the key (for example `results`).
2. **Find the parallel nodes.** Look at the trace for nodes that ran in the same step, or at edges leaving the same node. Check `get_state(...).tasks`.
3. **Decide the meaning.** Should the writes be combined (a list) or kept apart (one result per branch)?
4. **Fix.** Combine with `Annotated[list, operator.add]` (or a custom reducer), or write to separate keys `jira_results` and `confluence_results`.

**Example:**
```python
# before
class State(TypedDict):
    results: list[str]                          # no reducer, parallel writes conflict

# after (combine)
class State(TypedDict):
    results: Annotated[list[str], operator.add]
```

**What happens, step by step:**
1. `search_a` returns `{"results": ["a1"]}` and `search_b` returns `{"results": ["b1"]}` in step 2.
2. Before the fix: two values for one key without a reducer → `InvalidUpdateError`; the step's updates are not applied.
3. After the fix: `results` becomes `["a1", "b1"]` and `summarise` runs in step 3.

**Common mistake → fix:** "fixing" it by wiring the nodes in sequence so they no longer run in parallel. It works, but you lose the speed-up and the underlying design problem remains. Fix: choose the reducer deliberately; parallel work is the point.

**Interview answer:** "It means two parallel nodes wrote the same key with no reducer. I identify the key and the nodes from the trace, then either add a reducer such as operator.add or a merge-by-id function, or split the output into separate keys per branch."

**Follow-ups:**
- *Same error in sequential nodes?* No: sequential writes just overwrite (or reduce); the error is specific to the same step.

---

### Q43. A conversation loses context after a redeploy

**Short answer:** The state didn't survive or wasn't found. Check, in order: whether production uses an in-memory checkpointer, whether the `thread_id` is stable per conversation, whether the new deployment points at the same database and schema, and whether old state fails to load after a schema change.

**Debugging steps:**
1. **Which checkpointer is in use?** Look at the compile call or config. `InMemorySaver` loses everything on restart.
2. **Is the thread id stable?** Log the `thread_id` for two turns of the same conversation. Different values → the app generates a new id per request.
3. **Is it the same database?** Compare the connection string/schema/environment between old and new deployments (a new environment variable can silently point at an empty database).
4. **Can old state load?** Call `graph.get_state(cfg)` for an old thread on the new build. An exception or empty values points to a schema or serialisation problem (Q38).
5. **Fix and prevent.** Durable checkpointer, stored conversation→thread mapping, migration tests with real old checkpoints.

**Example:**
```python
snap = graph.get_state({"configurable": {"thread_id": thread_id}})
print(bool(snap.values), len(snap.values.get("messages", [])), snap.next)
```

**What happens, step by step:** if the output is `False 0 ()` for a thread that clearly had history, the thread is not found: wrong database or id. If it raises on load, the schema changed. If it prints a normal message count, persistence is fine and the problem is elsewhere (for example the client sent the wrong conversation id).

**Common mistake → fix:** generating `uuid4()` in the request handler for `thread_id`. It "works" in demos because the client resends the full history. Fix: create the id once per conversation, store it with the conversation, and reuse it.

**Interview answer:** "I check whether the checkpointer is durable, whether the thread_id is the same across turns, whether the new deployment uses the same database and schema, and whether old checkpoints still load with the new state schema, using get_state on an affected thread. The fix is a Postgres-backed checkpointer, a stored thread mapping and migration tests."

**Follow-ups:**
- *Why did it work in staging?* Often staging ran a single replica with an in-memory saver, so it never exposed the problem.

---

### Q44. How would you migrate a monolithic "one giant prompt" agent to LangGraph?

**Short answer:** Do it in stages while keeping the old system as the baseline: extract pure tools, define typed state, split the prompt into nodes (classify → retrieve → act → validate), add a checkpointer and approval nodes, evaluate each node and the whole graph against the old agent on the same test set, then roll out gradually with metrics.

**Steps:**
1. **Extract tools** as pure, tested functions with clear schemas.
2. **Define state:** what flows between steps (question, route, evidence, proposed action, approval).
3. **Split the prompt** by responsibility: a router, a retriever, an actor with read tools, a validator. Smaller prompts are easier to test and cheaper.
4. **Add persistence and approvals:** checkpointer, `interrupt` before write actions.
5. **Evaluate:** run old and new on the same questions; compare correctness, tool errors, cost and latency per node.
6. **Roll out:** canary share of traffic, compare metrics, keep the old path as a fallback until the new one is stable.

**Example:** the old agent had one 4,000-token prompt with 14 tools and "always check permissions first". New graph: `classify` (small model, enum output) → `retrieve` → `agent` (only the 4 read tools relevant to the route) → `validate` (deterministic permission and format checks) → `approval` (interrupt for writes) → `execute`.

**What happens, step by step:**
1. Permission checks, previously a sentence in the prompt, become code in `validate`; they now always run.
2. Each request sends a short prompt with 4 tools, not 14, so cost drops and tool choice improves.
3. A failing case is located by node in the trace (the retriever missed the document) instead of "the prompt didn't work".

**Common mistake → fix:** a big-bang rewrite with no baseline. You can't tell whether the new system is better. Fix: keep the old agent running on the same eval set and compare before cutting over.

**Interview answer:** "I extract the tools, define typed state, split the prompt into router, retriever, actor and validator nodes, move rules that must always apply from the prompt into code, add a checkpointer and approvals for writes, and run old and new on the same evaluation set. Then I roll out gradually with metrics and keep the old path as fallback."

**Follow-ups:**
- *What belongs in code versus the model?* Anything that must always happen (permissions, ordering, validation) goes in code; judgment stays with the model.

---

### Q45. Design: a document Q&A agent with approval for write actions

**Short answer:** State holds `messages`, `selected_doc_ids` (authorised on the server), `evidence`, `proposed_action` and `approval`. Flow: `authorize_docs` → `retrieve` (filter by those ids) → `agent` (read-only tools) → if a write is proposed → `approval` (interrupt) → `execute` (idempotent, re-checks permission) → `respond`. Postgres checkpointer, streamed tokens and status events, masked traces.

**How it works, by node:**
1. `authorize_docs`: checks each requested id against the user and tenant from `runtime.context`; writes the allowed ids to state.
2. `retrieve`: searches only inside those ids, writes evidence with citations.
3. `agent`: answers from evidence with read-only tools; if the user asks for a change, it records a `proposed_action` (tool name, args, hash of the args) instead of executing.
4. `approval`: `interrupt({action, args, args_hash})`; resume carries the approver's decision.
5. `execute`: verifies the approver's permission and that the hash matches, calls the write tool with an idempotency key, writes an audit record.
6. `respond`: summarises the outcome with citations.

```flow
pipeline: Document Q&A agent with approved writes
Authorise doc ids > Server-side check of the user's selection against user and tenant. Only allowed ids enter state.
Retrieve and answer > Search only inside those ids and cite document and page.
Propose a write > The agent stores the tool, its args and a hash of the args in state. Nothing executes.
interrupt for approval > The run pauses. Your API authenticates the approver and resumes with the decision.
Execute once > Re-check permission, compare the args hash, call the tool with an idempotency key, write the audit log.
```

**Example scenario:** the user selects 3 documents and asks "update the contract end date to 2027-03-31 in the CRM". The agent proposes `update_crm(contract="C-88", end_date="2027-03-31")`. The manager approves. `execute` runs it once.

**What happens, step by step:**
1. `authorize_docs` drops one of the three ids the user can't read.
2. The agent proposes the CRM update; state stores its hash.
3. The manager approves; `execute` recomputes the hash of the stored args, finds a match, and updates the CRM with key `crm:C-88:end_date:2027-03-31`.
4. A retry after a timeout reuses the key and does nothing twice.

**Common mistake → fix:** letting the agent call the write tool directly "because the prompt says to ask first". Fix: write tools are not given to the agent at all; only `execute` can call them, after the approval node.

**Interview answer:** "I authorise document ids on the server, retrieve only within them, let the agent use read tools and propose writes into state, pause with interrupt for a human decision, then execute through a node that re-checks permissions, matches the approved args hash and uses an idempotency key. State persists in Postgres, progress streams to the UI and traces are masked."

**Follow-ups:**
- *Why hash the args?* So an approval can't be reused for different arguments.

---

### Q46. The agent hits `GraphRecursionError`

**Short answer:** The graph used all its allowed super-steps without finishing, which almost always means an agent ↔ tools loop that isn't converging. Read the trace to see which nodes repeat, fix the cause (unhelpful tool errors, unclear stopping rule), add a graceful exit, and only then consider a higher limit.

**Debugging steps:**
1. **Read the trace.** Which nodes alternate? Typically `agent` and `tools` 20+ times.
2. **Inspect the tool results in the loop.** If the same tool call returns the same error each time, the model has nothing new to learn and keeps retrying. Make the error message specific ("customer id must start with C-") or stop retrying that tool.
3. **Check the stopping rule.** Does the prompt say when the task is done? Does the model keep searching for "more" evidence?
4. **Check the limit.** Is `recursion_limit` set where you think it is (top-level config key, not under `configurable`)? Default in recent versions is 1000, so a very large number of steps suggests a real loop.
5. **Add safeguards.** `RemainingSteps` in state with a route to a wrap-up node, a per-tool call cap, an `iterations` counter. Raise the limit only if the task genuinely needs more steps.

**Example:**
```python
class State(MessagesState):
    remaining_steps: RemainingSteps

def route(state: State):
    if state["remaining_steps"] <= 2:
        return "wrap_up"
    return tools_condition(state)

graph.invoke(inputs, {"recursion_limit": 30, "configurable": {"thread_id": "t1"}})
```

**What happens, step by step:**
1. A tool `get_customer` returns "Error: invalid id" every time; the model rephrases the id and calls again, 14 rounds.
2. At 2 steps left the router sends the flow to `wrap_up`, which tells the user "I couldn't validate the customer id; please check it".
3. The run ends normally instead of raising, and the trace shows exactly which tool caused the loop.
4. The permanent fix is better error text and an id-format check before calling the API.

**Common mistake → fix:** raising `recursion_limit` to a huge number to silence the error. Costs multiply while the loop persists. Fix: diagnose, then cap.

**Interview answer:** "I look at the trace to see which nodes loop, usually an agent and a tool repeating because errors give the model no new information or because the stop condition is unclear. I fix the tool errors and prompt, add RemainingSteps routing for a graceful wrap-up and per-tool caps, and raise the limit only when the task really needs more steps."

**Follow-ups:**
- *Catch the exception instead?* You can catch `GraphRecursionError` at the API as a last resort, but routing to a wrap-up inside the graph gives the user a useful partial answer.

---

## 9. Cheat sheet

| Concept | One-liner |
|---|---|
| StateGraph | typed state + nodes + edges; `compile()` then `invoke` / `stream` |
| Node | `state → partial update`; keep it small, one side effect each |
| Edge types | normal, conditional (pure router), `Command(goto=...)`, `START` / `END` |
| Reducer | how updates merge; none = overwrite; `operator.add`, `add_messages`; parallel writers need one |
| Super-step | run scheduled nodes in parallel, merge, checkpoint, schedule next |
| Recursion limit | max super-steps (default 1000 from 1.0.6), top-level config key; `RemainingSteps` for graceful exit |
| Context | `context_schema` + `invoke(context=...)`; trusted identity, not persisted |
| Checkpointer | snapshot per step per `thread_id`; Postgres in production |
| `thread_id` | conversation key, not auth; check ownership on every call |
| Store | long-term memory across threads, namespaced by verified identity |
| Durability | `exit` / `async` / `sync`; set explicitly for important workflows |
| Time travel | replay re-executes after the checkpoint; fork with `update_state` then `invoke(None, ...)` |
| `interrupt()` | pause + persist; resume with `Command(resume=...)`; node restarts from its first line |
| `Command` | update + goto; resume; `Command.PARENT` for handoffs |
| `Send` | dynamic fan-out (map-reduce); bound the list |
| Join | `add_edge(["a", "b"], "c")` or `defer=True` |
| Subgraph | compiled graph as a node; `checkpointer` None / True / False |
| Streaming | values / updates / messages / custom / checkpoints / tasks / debug; `version="v2"` chunks have type, ns, data |
| RetryPolicy | max_attempts 3, initial 0.5 s, factor 2.0, max 128 s; retries 5xx not 4xx for HTTP libraries |
| Node cache | `CachePolicy(ttl)` + `compile(cache=...)`; pure nodes only |
| Functional API | `@entrypoint` + `@task`; tasks' results are reused on replay |
| Safety | idempotent side effects; ownership checks; mask traces; compatible schema changes |

## Official references

- Overview: https://docs.langchain.com/oss/python/langgraph/overview
- Graph API: https://docs.langchain.com/oss/python/langgraph/graph-api
- Persistence and checkpointers: https://docs.langchain.com/oss/python/langgraph/checkpointers
- Interrupts: https://docs.langchain.com/oss/python/langgraph/interrupts
- Time travel: https://docs.langchain.com/oss/python/langgraph/use-time-travel
- Subgraphs: https://docs.langchain.com/oss/python/langgraph/use-subgraphs
- Functional API: https://docs.langchain.com/oss/python/langgraph/functional-api
- Streaming: https://docs.langchain.com/oss/python/langgraph/streaming
- Fault tolerance and retries: https://docs.langchain.com/oss/python/langgraph/fault-tolerance
