# LangChain: Interview Preparation

> **Updated:** 24 October 2026 (LangChain **v1.x** — `create_agent` + middleware, built on LangGraph) · **Level:** components → agents → production
> **How to use:** *Short answer* = what you say first. *Explanation / Example* = intuition and code. *Pitfall / Follow-up* = where interviewers dig.

---

## Table of contents

1. [Mental model: the LangChain ecosystem](#1-mental-model-the-langchain-ecosystem)
2. [Core building blocks](#2-core-building-blocks) (Q01–Q09)
3. [Agents: `create_agent` and middleware](#3-agents-create_agent-and-middleware) (Q10–Q17)
4. [RAG with LangChain](#4-rag-with-langchain) (Q18–Q23)
5. [Production engineering](#5-production-engineering) (Q24–Q31)
6. [Scenario & debugging questions](#6-scenario--debugging-questions) (Q32–Q36)
7. [Cheat sheet](#7-cheat-sheet)

---

## 1. Mental model: the LangChain ecosystem

LangChain is a **framework of standard interfaces + integrations** so you can swap models, vector stores and tools without rewriting your app, plus a ready-made **agent loop**.

```
 ┌──────────────────────────────── Your application ─────────────────────────────────┐
 │                                                                                    │
 │  langchain (v1)            high-level: create_agent(), middleware, structured output│
 │      │ built on                                                                    │
 │  langgraph                 low-level runtime: state graph, checkpoints, interrupts, │
 │      │                     streaming, durable execution (see 07_LangGraph.md)      │
 │  langchain-core            base interfaces: Runnable, BaseChatModel, messages,      │
 │      │                     tools, retrievers, prompts, callbacks                   │
 │  integrations              langchain-aws (Bedrock), langchain-openai,               │
 │                            langchain-anthropic, langchain-postgres, -mcp-adapters…  │
 │  langchain-classic         legacy chains (RetrievalQA, LLMChain…) moved here in v1  │
 └────────────────────────────────────────────────────────────────────────────────────┘
           │ traces                                         │ deploy
           ▼                                                ▼
       LangSmith (observability, evals, prompt hub)    LangSmith Deployment / AgentCore / your ECS
```

**What an agent built with `create_agent` looks like inside** (it compiles to a LangGraph graph):
```flow
cycle: create_agent loop with middleware hooks
before_model > Hook: trim history, inject context, enforce budgets.
Model call > wrap_model_call: retries, fallbacks, model switching.
after_model > Hook: inspect the response, guardrails, human-in-the-loop pauses.
Tool calls? > Yes → run tools (wrap_tool_call) and loop back. No → finish.
exit > No tool calls left → after_agent → END. Agent-level hooks: before_agent once at START, after_agent once at the end.
```

```
          ┌───────────────── middleware hooks ─────────────────┐
 START ─► before_agent ─► before_model ─► [ MODEL ] ─► after_model ─┐
                              ▲          (wrap_model_call)          │
                              │                                    ▼
                              │                    tool calls in response?
                              │                    ├─ yes ─► [ TOOLS ] (wrap_tool_call) ─┐
                              └────────────────────┼─────────────────────────────────────┘
                                                   └─ no ──► after_agent ─► END
```

---

## 2. Core building blocks

### Q01. LangChain vs LangGraph — what is each for?

**Short answer:** **LangChain** gives standard components (chat models, tools, retrievers, prompts) and a high-level, production-ready agent (`create_agent`) you configure with middleware. **LangGraph** is the lower-level orchestration runtime: you design the graph, state and control flow yourself, with persistence, interrupts and streaming. LangChain v1 agents **run on LangGraph**.

```flow
pipeline: How the LangChain pieces stack
LangChain components > Chat models, tools, retrievers, prompts: one interface across providers.
create_agent > A ready-made agent loop with middleware.
LangGraph > The runtime underneath: state, checkpoints, interrupts, custom graphs.
LangSmith > Tracing, evaluation, deployment around all of it.
```

**Rule of thumb:** standard tool-calling agent → `create_agent`. Custom branching, parallel steps, multi-agent graphs, complex approvals → LangGraph, using LangChain components inside nodes.

---

### Q02. Chat models and messages

**Short answer:** A chat model wrapper exposes any provider through one interface (`invoke`, `stream`, `batch`, async versions). Input/output are **messages** with roles.

```flow
sequence: One chat model call
actors: Your code, ChatModel wrapper, Provider API
Your code -> ChatModel wrapper: invoke([SystemMessage, HumanMessage])
ChatModel wrapper -> Provider API: provider-specific request format
Provider API --> ChatModel wrapper: provider response
ChatModel wrapper --> Your code: AIMessage (content, tool_calls, usage_metadata)
> Same message types for every provider, so swapping models is mostly a config change.
```

| Message | Role |
|---|---|
| `SystemMessage` | instructions |
| `HumanMessage` | user input |
| `AIMessage` | model output; may contain `tool_calls`; has `usage_metadata` |
| `ToolMessage` | result of a tool call, linked by `tool_call_id` |

```python
from langchain.chat_models import init_chat_model
from langchain.messages import SystemMessage, HumanMessage

model = init_chat_model("anthropic.claude-sonnet-...", model_provider="bedrock_converse", temperature=0)
resp = model.invoke([SystemMessage("Be concise."), HumanMessage("What is RAG?")])
print(resp.content, resp.usage_metadata)        # {'input_tokens': 18, 'output_tokens': 42, ...}
print(resp.content_blocks)                      # v1: provider-agnostic blocks (text, reasoning, tool_call, image…)
```
`init_chat_model` lets you switch providers by string/config. v1 adds **standard content blocks** so reasoning, citations and tool calls look the same across providers.

---

### Q03. Prompt templates

**Short answer:** Templates parameterise prompts so they're reusable, testable and versionable. Use `ChatPromptTemplate` with placeholders and `MessagesPlaceholder` for history.

```flow
pipeline: From template to messages
ChatPromptTemplate > System + human messages with {placeholders}.
MessagesPlaceholder > Slot for chat history.
.invoke({question, history}) > Values fill the placeholders.
List of messages > Ready for the model. Versioned and testable like code.
```

```python
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
prompt = ChatPromptTemplate.from_messages([
    ("system", "You are a support assistant for {product}. Use only the context.\n<context>{context}</context>"),
    MessagesPlaceholder("history"),
    ("human", "{question}"),
])
msgs = prompt.invoke({"product": "Payments", "context": ctx, "history": [], "question": q})
```
**Pitfall:** user/retrieved text inserted into the **system** role gains authority → keep untrusted text in clearly delimited data sections.

---

### Q04. Runnables and LCEL

**Short answer:** Almost everything in LangChain implements the **Runnable** interface: `invoke`, `batch`, `stream`, `ainvoke`, `astream`… **LCEL** (LangChain Expression Language) composes runnables with `|`, giving streaming, batching and tracing for free.

```flow
pipeline: An LCEL chain: prompt | model | parser
Input dict > {"question": "..."}
Prompt template > → messages.
Chat model > → AIMessage.
Output parser > → string or structured object.
Every step is a Runnable > So the whole chain gets invoke, batch, stream and async for free.
```

```python
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnableParallel, RunnablePassthrough

chain = prompt | model | StrOutputParser()           # prompt → model → string
chain.invoke({...}); chain.batch([{...}, {...}], config={"max_concurrency": 5})

rag = (RunnableParallel(context=retriever | format_docs, question=RunnablePassthrough())
       | rag_prompt | model | StrOutputParser())
```
Useful runnables: `RunnableLambda` (wrap a function), `RunnableParallel` (fan-out), `RunnableBranch` (if/else), `.with_retry()`, `.with_fallbacks([...])`, `.with_config(run_name=...)`.

**When to use LCEL vs agents:** LCEL for **fixed pipelines** (preprocess → prompt → model → parse). Agents/LangGraph when the model decides the path.

---

### Q05. Tools and the `@tool` decorator

**Short answer:** A tool = function + name + description + argument schema. `@tool` derives the schema from type hints and the docstring. The model sees name/description/schema and decides when to call it.

```flow
pipeline: What @tool builds from a function
Python function > With type hints and a docstring.
Name > From the function name.
Description > From the docstring. This is what the model reads to decide when to use it.
Argument schema > JSON schema from the type hints.
Tool object > Bindable to a model or agent.
```

```python
from langchain.tools import tool, ToolRuntime
from pydantic import BaseModel, Field

class TicketArgs(BaseModel):
    key: str = Field(pattern=r"^[A-Z]+-\d+$", description="Jira key like OPS-123")

@tool(args_schema=TicketArgs)
def get_ticket(key: str, runtime: ToolRuntime) -> dict:
    """Fetch a Jira ticket's status and assignee. Use when the user mentions a ticket key."""
    user = runtime.context.user_id               # trusted context injected by your app, not by the model
    authorize(user, "read", key)
    return jira.get(key, fields=["status", "assignee"])
```
`ToolRuntime` gives the tool access to state, runtime context, store and stream writer **without exposing these as model-visible arguments**.

**Pitfall:** the docstring is part of the prompt — vague descriptions → wrong tool choice.

---

### Q06. Binding tools to a model (without an agent)

```flow
sequence: bind_tools without an agent
actors: Your code, Model, Tool
Your code -> Model: model.bind_tools([get_ticket]).invoke("status of OPS-12?")
Model --> Your code: AIMessage.tool_calls = [{name: get_ticket, args: {id: OPS-12}}]
Your code -> Tool: run it yourself
Tool --> Your code: result
> No loop: you decide what happens next. Use an agent when you want the loop handled for you.
```

```python
model_with_tools = model.bind_tools([get_ticket])
ai = model_with_tools.invoke("What's the status of OPS-12?")
ai.tool_calls     # [{'name': 'get_ticket', 'args': {'key': 'OPS-12'}, 'id': 'call_1'}]
```
You must run the tool and send a `ToolMessage` back yourself — that loop is exactly what `create_agent` automates.

---

### Q07. Structured output with a plain model

```flow
pipeline: with_structured_output
Pydantic schema > E.g. Invoice(invoice_no, total, currency).
Provider-native structured output / tool call > The model is constrained to the schema.
Parse + validate > Returns an Invoice object.
Failure? > `include_raw=True` shows the raw response and the parse error.
```

```python
from pydantic import BaseModel
class Invoice(BaseModel):
    invoice_no: str
    total: float
    currency: str

extractor = model.with_structured_output(Invoice)   # uses native JSON schema or tool calling
inv = extractor.invoke(ocr_text)                    # -> Invoice instance
```
`include_raw=True` returns the raw message + parsing error for debugging.

---

### Q08. Document loaders and text splitters

**Short answer:** Loaders read sources (PDF, web, S3, Confluence) into `Document(page_content, metadata)`. Splitters chunk them for retrieval.

```flow
pipeline: Loading and splitting documents
Loader > PDF, web page, S3, Confluence → Document(page_content, metadata).
Splitter > RecursiveCharacterTextSplitter or a header-aware splitter → chunks with overlap.
Keep metadata > Source, page, section carried into every chunk.
Embed + store > Ready for retrieval.
```

```python
from langchain_text_splitters import RecursiveCharacterTextSplitter
splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=150,
                                          separators=["\n## ", "\n\n", "\n", " "])
chunks = splitter.split_documents(docs)   # metadata (source, page) copied to every chunk
```
Also `MarkdownHeaderTextSplitter` (keeps header path in metadata), token-based splitters, code-aware splitters. Always keep `source`, `page`, `tenant_id`, ACL in metadata.

---

### Q09. Output parsers

`StrOutputParser`, `JsonOutputParser`, `PydanticOutputParser`. Today, prefer **native structured output** (`with_structured_output` / `response_format`) over parsing free text. Parsing success ≠ correctness — still validate business rules.

---

## 3. Agents: `create_agent` and middleware

### Q10. How does `create_agent` work?

**Short answer:** It builds a ReAct-style tool-calling agent as a LangGraph graph: call model → if it requested tools, execute them → feed results back → repeat until the model gives a final answer (or a limit is hit). You configure model, tools, system prompt, structured output, middleware, checkpointer and context schema.

```flow
cycle: Inside create_agent
Call model > With messages and the tool list.
Tool calls? > The model asked for tools → yes, run them. No → done.
Run tools > Results appended as ToolMessages.
Back to model > With the new observations.
exit > No tool calls left (or a limit is hit) → final answer. It's compiled to a LangGraph graph, so checkpointing and streaming work.
```

```python
from dataclasses import dataclass
from langchain.agents import create_agent
from langgraph.checkpoint.memory import InMemorySaver

@dataclass
class Ctx:
    user_id: str
    tenant_id: str

agent = create_agent(
    model="anthropic:claude-sonnet-...",     # or a model instance
    tools=[get_ticket, search_runbooks],
    system_prompt="You are an on-call assistant. Cite runbook IDs.",
    context_schema=Ctx,                       # trusted per-run context
    checkpointer=InMemorySaver(),             # use Postgres/Redis saver in production
)

result = agent.invoke(
    {"messages": [{"role": "user", "content": "OPS-12 is failing, what do I do?"}]},
    config={"configurable": {"thread_id": "conv-42"}},   # conversation memory key
    context=Ctx(user_id="u1", tenant_id="t1"),
)
print(result["messages"][-1].content)
```
(`create_react_agent` from `langgraph.prebuilt` is the older equivalent; v1 recommends `langchain.agents.create_agent`.)

---

### Q11. What is middleware and why does it matter?

**Short answer:** Middleware hooks into the agent loop to customise behaviour **without forking the agent**: dynamic prompts, summarisation, approvals, PII redaction, retries, limits, model fallbacks, tool filtering. It's how you make a generic agent production-grade.

```flow
pipeline: Where middleware hooks run
before_agent > Once at the start: load user context.
before_model > Every turn: trim history, inject context, pick the model.
wrap_model_call > Around the call: retries, fallbacks.
after_model > Inspect the response: guardrails, human approval.
wrap_tool_call > Around each tool: authorisation, logging, error handling.
after_agent > Once at the end: cleanup, metrics.
```

| Hook | Runs | Typical use |
|---|---|---|
| `before_agent` / `after_agent` | once per invocation | load user profile, final audit |
| `before_model` / `after_model` | around each model call (node-style) | trim/summarise messages, check output |
| `wrap_model_call` | wraps the model call | retry, fallback model, dynamic tool selection, change prompt |
| `wrap_tool_call` | wraps each tool call | authorisation, retries, error handling, logging |

```python
from langchain.agents.middleware import wrap_tool_call, before_model

@wrap_tool_call
def enforce_permissions(request, handler):
    user = request.runtime.context.user_id
    if request.tool_call["name"] in WRITE_TOOLS and not is_editor(user):
        return ToolMessage(content="Permission denied", tool_call_id=request.tool_call["id"])
    return handler(request)                  # run the tool

@before_model
def trim_history(state, runtime):
    if len(state["messages"]) > 40:
        ...                                  # return a state update to drop/condense old messages
    return None

agent = create_agent(model, tools, middleware=[enforce_permissions, trim_history])
```

---

### Q12. Built-in middleware you should know

```flow
pipeline: A typical production middleware stack
SummarizationMiddleware > Summarise old messages near the token limit.
PII middleware > Redact or block personal data.
HumanInTheLoopMiddleware > Pause before risky tool calls.
Model/tool call limits > Stop runaway loops.
Model fallback / retry > Survive provider errors.
```

| Middleware | Purpose |
|---|---|
| `SummarizationMiddleware` | summarise old messages near a token threshold |
| `HumanInTheLoopMiddleware` | pause before chosen tool calls for approve / edit / reject |
| `PIIMiddleware` | detect & redact/mask/block emails, cards, custom patterns (input, output, tool results) |
| `ModelCallLimitMiddleware` / `ToolCallLimitMiddleware` | cap model/tool calls per run or thread (runaway protection) |
| `ModelFallbackMiddleware` | switch to a backup model on errors |
| Retry middleware (model/tool) | retry transient failures with backoff |
| LLM tool selector | pre-select relevant tools when you have many |
| Context editing | clear old tool outputs from context |
| Todo list / planning, filesystem (Deep Agents) | long-horizon task planning |

---

### Q13. Human-in-the-loop with `create_agent`

```flow
sequence: Human approval with HumanInTheLoopMiddleware
actors: User, Agent, Middleware, Reviewer
User -> Agent: "Refund order A12"
Agent -> Middleware: tool call refund(A12, 50)
Middleware --> User: interrupt: approval needed (state checkpointed)
Reviewer -> Agent: Command(resume={decisions: [approve]}) same thread_id
Agent -> Agent: tool runs, agent continues
> The reviewer can also edit the arguments or reject the call.
```

```python
from langchain.agents.middleware import HumanInTheLoopMiddleware
from langgraph.types import Command

agent = create_agent(
    model, tools=[read_data, execute_sql],
    middleware=[HumanInTheLoopMiddleware(interrupt_on={
        "execute_sql": {"allowed_decisions": ["approve", "reject"]},   # pause before running
        "read_data": False,                                             # safe, no approval
    })],
    checkpointer=postgres_saver,               # REQUIRED: pause state must persist
)
cfg = {"configurable": {"thread_id": "t-1"}}
out = agent.invoke({"messages": [("user", "Delete records older than 30 days")]}, cfg, version="v2")
out.interrupts      # shows proposed SQL for the reviewer

agent.invoke(Command(resume={"decisions": [{"type": "approve"}]}), cfg, version="v2")
```
**Production notes:** bind the decision to an authenticated reviewer in **your API**, store an audit record, and make the tool itself idempotent — the framework pauses/resumes, it doesn't know who's allowed to approve.

---

### Q14. Structured output from an agent (`response_format`)

**Short answer:** Pass a schema; result appears in `result["structured_response"]`.
- **`ProviderStrategy`** — uses provider-native schema enforcement (most reliable when supported).
- **`ToolStrategy`** — implements structure as a special tool call (works with any tool-calling model; can retry on validation error).
- Passing the schema type directly → LangChain picks the best strategy automatically.

```flow
pipeline: Structured output from an agent
response_format=Schema > Passed to create_agent.
Agent runs its tool loop > As usual.
Final answer in the schema > ProviderStrategy (native) or ToolStrategy (a synthetic tool call).
result["structured_response"] > A validated object for your code.
```

```python
from langchain.agents.structured_output import ToolStrategy
agent = create_agent(model, tools=[lookup_customer], response_format=ToolStrategy(TriageResult))
res = agent.invoke({"messages": [("user", email_text)]})
res["structured_response"]     # TriageResult(...)
```

---

### Q15. Short-term memory in agents

Short-term memory = the `messages` (and other state) of a **thread**, persisted by the checkpointer and keyed by `thread_id`. Long histories need trimming/summarisation middleware. Custom state fields: extend `AgentState` via `state_schema` or middleware state.

```flow
sequence: Short-term memory = checkpointed thread state
actors: User, Agent, Checkpointer
User -> Agent: turn 1 (thread_id=t1)
Agent -> Checkpointer: save messages for t1
User -> Agent: turn 2 (thread_id=t1)
Checkpointer --> Agent: load t1's messages
Agent --> User: answers with full context
> A different thread_id starts fresh. Use a persistent checkpointer (Postgres) in production, not InMemorySaver.
```

---

### Q16. Long-term memory

Use a LangGraph **store** (`InMemoryStore`, `PostgresStore`, with optional vector search) passed as `store=` to `create_agent`; tools/middleware read/write namespaced items like `("users", user_id, "prefs")`. Namespace by verified identity.

```flow
sequence: Long-term memory through a store
actors: Agent, Store
Agent -> Store: put(("users", u1, "prefs"), "format", "csv")
Agent -> Agent: new thread, days later
Agent -> Store: get / search(("users", u1, "prefs"))
Store --> Agent: format = csv
> Namespaced by verified user, shared across threads, optionally vector-searchable.
```

---

### Q17. Streaming from agents

```flow
pipeline: Stream modes and what each gives you
updates > State changes after each step: show progress ("searching…").
messages > LLM tokens as they're generated: typing effect.
custom > Your own events from inside tools/nodes.
values > The full state after each step: debugging.
```

```python
for chunk in agent.stream(inputs, cfg, stream_mode="updates"):   # step-by-step state updates
    print(chunk)
for token, meta in agent.stream(inputs, cfg, stream_mode="messages"):  # LLM tokens
    print(token.content, end="")
# also: stream_mode="custom" (tool progress via runtime.stream_writer), "values", "debug"
```
Map these to stable UI events (`token`, `tool_start`, `tool_result`, `approval_needed`, `done`, `error`) rather than exposing internal state.

---

## 4. RAG with LangChain

### Q18. Vector store vs retriever

**Short answer:** A **vector store** stores embeddings and does similarity search. A **retriever** is any runnable that takes a query and returns documents — it can wrap a vector store, BM25, hybrid search, a reranker, an API, or Bedrock Knowledge Bases.

```flow
pipeline: Vector store vs retriever
Query string > "VPN outage Pune".
Retriever > Any Runnable: query → list of Documents.
Backed by > A vector store, BM25, an API, or several combined.
Documents out > Same interface whatever the backend, so you can swap or chain retrievers.
```

```python
from langchain_aws import BedrockEmbeddings
from langchain_postgres import PGVector

emb = BedrockEmbeddings(model_id="amazon.titan-embed-text-v2:0")
store = PGVector(embeddings=emb, collection_name="docs", connection=PG_URL)
store.add_documents(chunks)

retriever = store.as_retriever(search_type="mmr",
                               search_kwargs={"k": 6, "fetch_k": 40, "filter": {"tenant_id": tid}})
docs = retriever.invoke("How do I rotate the DB password?")
```

---

### Q19. Two-step RAG chain vs agentic RAG

```
 Two-step RAG (deterministic)                Agentic RAG
 question ─► retrieve ─► prompt ─► LLM       question ─► agent ──(decides)──► search tool (0..n times)
  • 1 retrieval, predictable latency/cost              • can reformulate, use several sources
  • best for simple Q&A over a KB                      • more flexible, more tokens, less predictable
```
```python
from langchain.tools import tool
@tool
def search_policies(query: str) -> str:
    """Search HR policy documents. Returns passages with doc ids."""
    return format_docs(retriever.invoke(query))
agent = create_agent(model, tools=[search_policies], system_prompt="Answer from policies; cite ids.")
```

---

### Q20. Document-selective RAG (user picks specific documents)

```flow
pipeline: Document-selective RAG
Receive doc_ids > The user picks documents in the UI.
Authorise each id > On the server, against the user and tenant. Never trust the client's list.
Filter in the retriever > Pass allowed IDs as a pre-retrieval filter, not as prompt text.
Retrieve → rerank → generate > Answer with citations (doc_id, page).
Weak evidence? > Reply "not found in the selected documents" instead of guessing.
```

---

### Q21. Choosing a vector store integration

```flow
pipeline: Choosing a vector store
Filtering needs > Metadata filters for tenant and ACL?
Hybrid search > Keyword + vector in one query?
Scale + latency > Millions of vectors? p99 targets?
Operations > Managed (OpenSearch Serverless, S3 Vectors) vs self-run (pgvector on Aurora).
Isolation, backup, cost > Decide, then benchmark on your data.
```

| Store | When |
|---|---|
| FAISS / Chroma (local) | prototypes, tests, small single-node apps |
| **pgvector** (Aurora/RDS Postgres) | you already run Postgres; SQL filters + vectors together |
| **OpenSearch** | hybrid keyword + vector, large scale, filtering |
| **Amazon S3 Vectors** | very large, cost-sensitive, latency-tolerant corpora |
| Bedrock Knowledge Bases (`AmazonKnowledgeBasesRetriever`) | managed ingestion/chunking/embedding |
| Pinecone/Milvus/Weaviate | managed/specialised vector DBs |

Decide on: metadata filtering, hybrid search, scale, ops ownership, tenancy isolation, backup, cost.

---

### Q22. Rerankers and hybrid retrieval in LangChain

`EnsembleRetriever` (combine BM25 + vector with weights / RRF), `ContextualCompressionRetriever` with a reranker (Cohere/Bedrock rerank, cross-encoder) to keep only top passages, `MultiQueryRetriever` for query variants, `ParentDocumentRetriever` for small-to-big retrieval.

```flow
pipeline: EnsembleRetriever + reranking
BM25 retriever > Exact terms.
Vector retriever > Meaning.
Ensemble (RRF / weights) > Merged candidate list.
ContextualCompressionRetriever + reranker > Rescores and keeps the best few.
```

---

### Q23. Stale content after a document update

Trace: did the change trigger re-ingestion? Did old chunks get **deleted** (stable IDs per chunk, upsert/delete by source ID)? Any cache with long TTL? Is the retriever pointed at the new index? Use a **record manager / indexing API** (dedupe + cleanup by source) and set a freshness SLO.

```flow
pipeline: Tracing stale answers after a document update
Re-ingestion triggered? > Webhook / sync job actually ran?
Old chunks deleted? > Stable chunk IDs per document + delete-by-doc before upsert.
New chunks indexed? > Check the index for the new version.
Caches cleared? > Semantic or response caches may still return old answers.
```

---

## 5. Production engineering

### Q24. Retries, fallbacks and timeouts

```flow
pipeline: Retry, then fall back
Call primary model > With a timeout.
Transient error? > Retry with exponential backoff + jitter (bounded attempts).
Still failing > `with_fallbacks([backup_model])`.
Backup answers > Log which model served the request; keep prompts compatible across both.
```

```python
robust = (model.with_retry(stop_after_attempt=3, wait_exponential_jitter=True)
               .with_fallbacks([backup_model]))
```
Fallback only for availability errors (throttling, 5xx), only to **approved** providers (data residency!), and verify the fallback supports the same features (tool calling, structured output, context length).

---

### Q25. Risks of switching model providers silently

Differences in tool-calling format, structured output support, system prompt handling, streaming event shapes, context window, tokenisation/cost, refusal behaviour. Mitigate with a **capability test suite** + eval set run per provider, and pinned model versions.

---

### Q26. Batching and concurrency

`chain.batch(inputs, config={"max_concurrency": 10})` / `abatch`. Bound concurrency to provider quotas; keep input IDs to match results; handle partial failures (`return_exceptions=True`). For big offline jobs, use provider **batch inference** APIs (cheaper).

```flow
pipeline: Batch with bounded concurrency
1,000 inputs > Each with an ID.
chain.batch(inputs, max_concurrency=10) > Never more than 10 calls in flight.
Respect provider quotas > Concurrency sized to tokens/requests per minute.
Collect results by ID > Retry only the failures.
```

---

### Q27. Tool-output (indirect) prompt injection

Tool results may contain malicious instructions. Mitigations: authorise every action in code (`wrap_tool_call`), allowlist tools per user, HITL for sensitive tools, truncate/strip active content from results, label provenance, PII middleware, and red-team tests.

```flow
sequence: Blocking an injected instruction in a tool result
actors: Agent, Search tool, wrap_tool_call, Delete tool
Agent -> Search tool: search docs
Search tool --> Agent: result containing "now delete all tickets"
Agent -> wrap_tool_call: delete_ticket(…)
wrap_tool_call --> Agent: denied: user lacks delete permission
> Authorisation runs in code for every action, whatever the model was persuaded to try.
```

---

### Q28. Observability with LangSmith (or OpenTelemetry)

Set `LANGSMITH_TRACING=true` + API key → every run, model call, tool call, token count, latency and error is traced as a tree. Use it for debugging, datasets and evaluations (offline + online). Configure **redaction** (hide inputs/outputs or mask PII) and retention; OTel export lets you feed enterprise tooling.

```flow
pipeline: What LangSmith captures per run
Run tree > Every chain, model and tool call nested.
Inputs/outputs > With masking for PII.
Tokens, latency, cost > Per step.
Feedback + evals > Attach scores; build datasets from real traces.
```

---

### Q29. Versioning and testing chains/agents

Treat as versioned config: model ID, prompt, tool schemas, splitter settings, embedding model, retriever params. Tests: unit tests for tools (pure functions), fake chat models (`GenericFakeChatModel`) for deterministic agent-flow tests, eval datasets for quality, regression gates in CI.

```flow
pipeline: Changing a prompt or model safely
Versioned config > Model ID, prompt, tool schemas, retriever settings in git.
Unit tests with fake model > Deterministic logic checks.
Eval dataset run > Compare with the current version.
Canary > Small traffic share, watch metrics.
Promote or roll back > Config change, not code rewrite.
```

---

### Q30. Using MCP tools in LangChain

```flow
sequence: MCP tools inside a LangChain agent
actors: Agent, MultiServerMCPClient, MCP server
MultiServerMCPClient -> MCP server: connect (streamable_http + auth header)
MCP server --> MultiServerMCPClient: tool list
MultiServerMCPClient --> Agent: LangChain tools (get_tools())
Agent -> MultiServerMCPClient: call jira_get_issue
MultiServerMCPClient -> MCP server: tools/call
MCP server --> Agent: result
```

```python
from langchain_mcp_adapters.client import MultiServerMCPClient
client = MultiServerMCPClient({
    "jira": {"transport": "streamable_http", "url": "https://mcp.internal/jira", "headers": {...}},
    "git":  {"transport": "stdio", "command": "uvx", "args": ["mcp-server-git"]},
})
tools = await client.get_tools()             # MCP tools → LangChain tools
agent = create_agent(model, tools)
```

---

### Q31. Custom chat model wrapper — what must it handle?

Message role conversion, tool-call mapping both ways, streaming + async, `usage_metadata`, stop reasons, error mapping (rate limits → retryable), callbacks/tracing, and capability flags (tool calling, structured output). Test with the standard integration test suite.

---

## 6. Scenario & debugging questions

### Q32. `with_structured_output()` returns `None` or invalid fields

Use `include_raw=True` to see the raw response and parsing error. Check: provider/model supports the chosen method; schema is supported (some providers reject certain JSON-schema features); field descriptions are clear; output wasn't truncated (`max_tokens`). Try `method="json_schema"` vs function calling; add retries on validation errors.

```flow
pipeline: Debugging with_structured_output returning None
include_raw=True > See the raw model response and the parsing error.
Model support > Does this provider/model support native structured output?
Schema too complex? > Simplify: fewer nested unions, clear field descriptions.
Prompt mismatch > Instructions contradicting the schema.
Try ToolStrategy > Or a stronger model.
```

---

### Q33. The agent never calls your new tool

Verify the tool is actually in the agent's tool list (MCP connection/auth succeeded?); test the tool directly; inspect the trace — is it in the model request? Improve name/description ("Use this when…"); check for too many similar tools; check middleware isn't filtering it; confirm the model supports tool calling.

```flow
pipeline: The agent never calls your new tool
Is it in the tool list? > MCP connection/auth may have failed silently.
Test the tool directly > Does it work on its own?
Description > Does it clearly say when to use it?
Too many similar tools? > The model picks another one; rename or remove overlap.
Check traces > What did the model actually see?
```

---

### Q34. Duplicate tool calls / duplicated side effects

Causes: retries (middleware or client), graph resume replaying a node, model calling twice, client reconnect re-submitting. Fix: distinguish retries from new requests (idempotency key per operation), make write tools idempotent, inspect traces for which layer repeated.

```flow
pipeline: Duplicate side effects: causes and fix
Client or middleware retries > A timed-out call actually succeeded.
Graph resume replays a node > Code before interrupt runs again.
Model calls the tool twice > Same intent, two calls.
Fix: idempotency keys > Every write carries an operation ID; the tool returns the earlier result for a repeat.
```

---

### Q35. Agent cost exploded in production

Check traces for: long message history (add summarisation), huge tool outputs (truncate), loops (add call limits), big system prompt not cached, expensive model used for trivial steps (route). Add per-run budgets.

```flow
pipeline: Agent cost exploded: where to look
Message history length > Add summarisation middleware.
Tool output size > Truncate to needed fields.
Loops > Model/tool call limits.
Model choice > Route simple steps to a small model.
Prompt caching > Cache static system prompt and tools.
```

---

### Q36. When do you move from `create_agent` to a custom LangGraph graph?

When you need explicit multi-step control flow (fixed stages, branching, parallel fan-out), multiple agents with handoffs, custom state beyond messages, complex approval workflows, or deterministic steps mixed with LLM steps. Keep LangChain models/tools/retrievers inside the graph's nodes.

```flow
pipeline: When to move from create_agent to a custom graph
Fixed stages needed? > classify → retrieve → draft → verify.
Branching or parallel steps? > Fan-out / map-reduce.
Complex approvals or retries per step? > Per-node policies.
Multiple agents with handoffs? > Supervisor / swarm.
Yes to any → custom LangGraph > Otherwise create_agent + middleware is simpler.
```

---

## 7. Cheat sheet

| Concept | One-liner |
|---|---|
| LangChain v1 | components + `create_agent`; runs on LangGraph |
| Messages | System / Human / AI (tool_calls, usage) / Tool |
| `init_chat_model` | provider-agnostic model init |
| Runnable/LCEL | `prompt | model | parser`; invoke/batch/stream |
| `@tool` | schema from hints + docstring; docstring = prompt |
| `ToolRuntime` | trusted context/state/store in tools, hidden from model |
| `create_agent` | model ↔ tools loop + middleware + checkpointer |
| Middleware | before/after model & agent; wrap model/tool calls |
| HITL | `HumanInTheLoopMiddleware` + checkpointer + `Command(resume=...)` |
| Structured output | `response_format`: ProviderStrategy / ToolStrategy |
| Retriever | query → docs; wraps vector store / hybrid / KB |
| Reliability | `.with_retry`, `.with_fallbacks`, call-limit middleware |
| Legacy chains | `langchain-classic` |
| Tracing | LangSmith / OTel with redaction |

## Official references

- https://docs.langchain.com/oss/python/langchain/overview
- Agents: https://docs.langchain.com/oss/python/langchain/agents
- Middleware: https://docs.langchain.com/oss/python/langchain/middleware
- Structured output: https://docs.langchain.com/oss/python/langchain/structured-output
- Human-in-the-loop: https://docs.langchain.com/oss/python/langchain/human-in-the-loop
- v1 release notes / migration: https://docs.langchain.com/oss/python/releases/langchain-v1
