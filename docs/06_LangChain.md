# LangChain: L2 → L3 Interview Preparation

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

**Rule of thumb:** standard tool-calling agent → `create_agent`. Custom branching, parallel steps, multi-agent graphs, complex approvals → LangGraph, using LangChain components inside nodes.

---

### Q02. Chat models and messages

**Short answer:** A chat model wrapper exposes any provider through one interface (`invoke`, `stream`, `batch`, async versions). Input/output are **messages** with roles.

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

```python
model_with_tools = model.bind_tools([get_ticket])
ai = model_with_tools.invoke("What's the status of OPS-12?")
ai.tool_calls     # [{'name': 'get_ticket', 'args': {'key': 'OPS-12'}, 'id': 'call_1'}]
```
You must run the tool and send a `ToolMessage` back yourself — that loop is exactly what `create_agent` automates.

---

### Q07. Structured output with a plain model

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

```python
from langchain.agents.structured_output import ToolStrategy
agent = create_agent(model, tools=[lookup_customer], response_format=ToolStrategy(TriageResult))
res = agent.invoke({"messages": [("user", email_text)]})
res["structured_response"]     # TriageResult(...)
```

---

### Q15. Short-term memory in agents

Short-term memory = the `messages` (and other state) of a **thread**, persisted by the checkpointer and keyed by `thread_id`. Long histories need trimming/summarisation middleware. Custom state fields: extend `AgentState` via `state_schema` or middleware state.

---

### Q16. Long-term memory

Use a LangGraph **store** (`InMemoryStore`, `PostgresStore`, with optional vector search) passed as `store=` to `create_agent`; tools/middleware read/write namespaced items like `("users", user_id, "prefs")`. Namespace by verified identity.

---

### Q17. Streaming from agents

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

1. API receives `doc_ids` from the user; **authorise** each against user/tenant on the server.
2. Pass allowed IDs into the retriever **filter** (pre-retrieval), not into the prompt text.
3. Retrieve → rerank → generate with citations (`doc_id`, page).
4. If evidence is weak, answer "not found in selected documents".

---

### Q21. Choosing a vector store integration

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

---

### Q23. Stale content after a document update

Trace: did the change trigger re-ingestion? Did old chunks get **deleted** (stable IDs per chunk, upsert/delete by source ID)? Any cache with long TTL? Is the retriever pointed at the new index? Use a **record manager / indexing API** (dedupe + cleanup by source) and set a freshness SLO.

---

## 5. Production engineering

### Q24. Retries, fallbacks and timeouts

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

---

### Q27. Tool-output (indirect) prompt injection

Tool results may contain malicious instructions. Mitigations: authorise every action in code (`wrap_tool_call`), allowlist tools per user, HITL for sensitive tools, truncate/strip active content from results, label provenance, PII middleware, and red-team tests.

---

### Q28. Observability with LangSmith (or OpenTelemetry)

Set `LANGSMITH_TRACING=true` + API key → every run, model call, tool call, token count, latency and error is traced as a tree. Use it for debugging, datasets and evaluations (offline + online). Configure **redaction** (hide inputs/outputs or mask PII) and retention; OTel export lets you feed enterprise tooling.

---

### Q29. Versioning and testing chains/agents

Treat as versioned config: model ID, prompt, tool schemas, splitter settings, embedding model, retriever params. Tests: unit tests for tools (pure functions), fake chat models (`GenericFakeChatModel`) for deterministic agent-flow tests, eval datasets for quality, regression gates in CI.

---

### Q30. Using MCP tools in LangChain

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

---

### Q33. The agent never calls your new tool

Verify the tool is actually in the agent's tool list (MCP connection/auth succeeded?); test the tool directly; inspect the trace — is it in the model request? Improve name/description ("Use this when…"); check for too many similar tools; check middleware isn't filtering it; confirm the model supports tool calling.

---

### Q34. Duplicate tool calls / duplicated side effects

Causes: retries (middleware or client), graph resume replaying a node, model calling twice, client reconnect re-submitting. Fix: distinguish retries from new requests (idempotency key per operation), make write tools idempotent, inspect traces for which layer repeated.

---

### Q35. Agent cost exploded in production

Check traces for: long message history (add summarisation), huge tool outputs (truncate), loops (add call limits), big system prompt not cached, expensive model used for trivial steps (route). Add per-run budgets.

---

### Q36. When do you move from `create_agent` to a custom LangGraph graph?

When you need explicit multi-step control flow (fixed stages, branching, parallel fan-out), multiple agents with handoffs, custom state beyond messages, complex approval workflows, or deterministic steps mixed with LLM steps. Keep LangChain models/tools/retrievers inside the graph's nodes.

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
