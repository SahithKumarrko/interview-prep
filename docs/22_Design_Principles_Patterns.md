# Software Design: OOP, SOLID, Design Patterns & Microservice Patterns: Interview Preparation

> **Updated:** 27 October 2026 · **Level:** OOP basics → SOLID → classic patterns in Python → distributed and microservice patterns → design-review scenarios
> **How to use:** read the *Short answer* first, then *How it works* and the *Example*. The *What happens, step by step* section runs the code with real values. *Common mistake → fix* shows how the idea is misused. *Interview answer* is what you can say out loud.

---

## Table of contents

1. [Mental model: why design principles exist](#1-mental-model-why-design-principles-exist)
2. [OOP & core principles](#2-oop--core-principles) (Q01–Q06)
3. [SOLID](#3-solid) (Q07–Q12)
4. [Classic design patterns in Python](#4-classic-design-patterns-in-python) (Q13–Q25)
5. [Microservice & distributed-system patterns](#5-microservice--distributed-system-patterns) (Q26–Q38)
6. [Scenario & design-review questions](#6-scenario--design-review-questions) (Q39–Q43)
7. [Cheat sheet](#7-cheat-sheet)

---

## 1. Mental model: why design principles exist

**All of these principles answer one question: when requirements change, how much code do I have to touch, and how much can break?**

Software is never finished. A new payment provider, a new file type, a new report: each is a **change request**. Good design makes the common changes small and safe. Bad design makes a small request touch twenty files, because everything knows the details of everything else.

Think of a house with standard plumbing connectors. When a tap breaks, you replace the tap, not the walls, because the tap and the pipe agree on a small standard interface. Software design is mostly about choosing those small agreed interfaces.

```flow
trace: The same change request in a tangled design and in a decoupled design
request: "support a second payment provider" > Both designs get the same request.
tangled: OrderService calls provider A's SDK directly in 14 places > The provider's details (request format, error codes, retries) are spread through the business logic.
tangled result: edit 14 places, retest everything, risk breaking order logic > A change in one area breaks another.
decoupled: OrderService calls a small PaymentGateway interface > Business code only knows "charge(amount)".
decoupled result: add one new class that implements PaymentGateway, choose it in configuration > Order logic is untouched and its tests still pass.
```

**Two words to know first:**
- **Coupling** = how much one module depends on the internal details of another. Lower is better.
- **Cohesion** = how focused a module is on one job. Higher is better.

Patterns are **named, proven shapes** for common problems: vocabulary for design discussions, not goals in themselves. The right question is never "which pattern can I use?" but "what change am I trying to make cheap?".

---

## 2. OOP & core principles

### Q01. What is object-oriented programming, and what is a class?

**Short answer:** **Object-oriented programming (OOP)** is a way of organising code around **objects**: bundles of **data** (attributes) and the **behaviour** (methods) that works on that data. A **class** is the blueprint; an **object** (instance) is one thing built from it. The point is to keep related data and rules together so that other code uses a small public surface and cannot easily break the rules.

**How it works:** instead of passing loose dictionaries to many functions that each re-check the rules ("is the balance enough? is the amount positive?"), you put the data and the rules in one class. Callers say `account.withdraw(50)` and the class guarantees that its own **invariants** (facts that must always be true, such as "balance never goes negative") hold.

**Example:**
```python
class Account:
    def __init__(self, owner: str, balance: int = 0):
        self.owner = owner
        self._balance = balance          # leading underscore: "internal, use the methods"

    def deposit(self, amount: int) -> None:
        if amount <= 0:
            raise ValueError("amount must be positive")
        self._balance += amount

    def withdraw(self, amount: int) -> None:
        if amount > self._balance:
            raise ValueError("insufficient funds")
        self._balance -= amount

    @property
    def balance(self) -> int:
        return self._balance             # read-only view

acct = Account("Asha", 100)
acct.deposit(50)
try:
    acct.withdraw(500)
except ValueError as e:
    print(e)                             # insufficient funds
print(acct.balance)                      # 150
```

**What happens, step by step:**
1. `Account("Asha", 100)` creates an object whose `_balance` is 100.
2. `deposit(50)` checks that 50 is positive, then raises the balance to 150.
3. `withdraw(500)` checks `500 > 150`, so it raises `ValueError`; the balance stays 150. The rule lives in one place, so no caller can forget it.
4. `acct.balance` reads the value through a property; assigning `acct.balance = 5` would fail because no setter exists.

**Common mistake → fix:** a "data bag" class with public fields and the rules scattered across callers (`acct.balance -= 500` in one file, a different check in another). Move the rule into a method so there is one source of truth.

**Interview answer:** "OOP organises code into objects that bundle data with the behaviour that operates on it. A class is the blueprint and an instance is one object. The benefit is that a class protects its own invariants behind a small public interface, so callers can't put it into an invalid state, and I can change the internals without changing the callers."

**Follow-ups:**
- *Is Python strictly object-oriented?* Everything is an object, but you can also write plain functions; use classes when data and rules belong together.
- *What are `__init__` and `self`?* `__init__` sets up a new object, and `self` is the object a method is working on (see the Python course for details).

---

### Q02. What are the four pillars of OOP?

**Short answer:** **Encapsulation** (keep data with its behaviour and hide the internals), **abstraction** (expose *what* something does, hide *how*), **inheritance** (a class reuses and extends another), **polymorphism** (the same call behaves differently depending on the object's type). Interviewers use these as vocabulary; the real skill is knowing when each helps and when it hurts (inheritance most often).

| Pillar | Meaning | Python example |
|---|---|---|
| Encapsulation | data and rules together, internals hidden | `_balance` changed only through `deposit()` |
| Abstraction | callers use *what*, not *how* | `storage.save(doc)`: the caller doesn't know whether it's disk or cloud |
| Inheritance | a subclass reuses and extends a base class | `class SavingsAccount(Account)` |
| Polymorphism | one call, different behaviour per type | `for acc in accounts: acc.monthly_fee()` |

**Example:**
```python
class Account:
    def __init__(self, balance=0):
        self._balance = balance
    def monthly_fee(self) -> int:
        return 5

class SavingsAccount(Account):               # inheritance
    def monthly_fee(self) -> int:            # overrides the base behaviour
        return 0

class PremiumAccount(Account):
    def monthly_fee(self) -> int:
        return 15

accounts = [Account(), SavingsAccount(), PremiumAccount()]
print([a.monthly_fee() for a in accounts])   # [5, 0, 15]
print(sum(a.monthly_fee() for a in accounts))  # 20
```

**What happens, step by step:**
1. The list holds three different classes, but the loop treats them all as "an account".
2. For each object, `a.monthly_fee()` looks up the method on that object's own class: `Account` → 5, `SavingsAccount` → 0, `PremiumAccount` → 15. That lookup is **polymorphism**.
3. The caller never wrote `if isinstance(a, SavingsAccount)`. Adding a `StudentAccount` class means adding a class, not editing the loop.
4. Encapsulation shows in `_balance`; abstraction shows in the fact that callers only know `monthly_fee()`.

**Common mistake → fix:** using inheritance just to reuse a few lines of code (`class Report(DatabaseConnection)`). A report is not a connection; it *uses* one. Prefer composition (Q04) unless the relationship is truly "is-a".

**Interview answer:** "Encapsulation keeps data and its rules together; abstraction exposes what an object does and hides how; inheritance lets a subclass reuse and extend a base class; polymorphism means one call does different things depending on the object's type, so callers don't branch on types. In practice I lean on polymorphism through small interfaces and use inheritance sparingly."

**Follow-ups:**
- *Duck typing?* Python doesn't require a shared base class: any object with the right methods works (Protocols describe this, Q06).

---

### Q03. What are coupling and cohesion?

**Short answer:** **Coupling** is how much a module depends on the details of other modules; **cohesion** is how closely the parts inside a module belong together. Aim for **low coupling and high cohesion**: modules that each do one job and talk to each other through small, stable interfaces. Almost every design principle in this course is a way to lower coupling or raise cohesion.

**How it works:**
- High coupling shows up as "I changed one thing and five other places broke", or "I can't test this without a database and a network".
- Low cohesion shows up as classes named `Manager` or `Utils` that do unrelated things, so they change for many unrelated reasons.

**Example:**
```python
# HIGH coupling: the checkout code knows the details of one payment SDK
import requests

class Checkout:
    def pay(self, amount_cents):
        r = requests.post("https://api.pay-a.example/v1/charges",
                          json={"amount": amount_cents, "currency": "usd"}, timeout=5)
        return r.json()["id"]

# LOW coupling: it knows only a tiny interface; details live in an adapter
class PaymentGateway:                           # the small agreed interface
    def charge(self, amount_cents: int) -> str: ...

class Checkout2:
    def __init__(self, gateway: PaymentGateway):
        self.gateway = gateway
    def pay(self, amount_cents: int) -> str:
        return self.gateway.charge(amount_cents)

class FakeGateway(PaymentGateway):
    def charge(self, amount_cents):
        return f"fake-{amount_cents}"

print(Checkout2(FakeGateway()).pay(2500))       # fake-2500
```

**What happens, step by step:**
1. `Checkout` builds the HTTP request itself: URL, JSON shape, response parsing. Changing provider means rewriting `Checkout`, and testing it needs the network.
2. `Checkout2` only calls `gateway.charge(...)`. Real provider details live in one adapter class.
3. In the test, `FakeGateway` returns `"fake-2500"` instantly, with no network. Lower coupling made the class both easier to change and easier to test.

**Common mistake → fix:** reducing coupling by adding layers with no purpose (an interface with one implementation that never changes). Decouple along lines where change is actually likely or where testing needs a seam (a network call, a database, the clock).

**Interview answer:** "Coupling is how much modules know about each other's internals, and cohesion is how focused each module is. I want low coupling, so that changing one part doesn't ripple, and high cohesion, so that each module changes for one reason. I get there by depending on small interfaces, injecting dependencies, and splitting classes that mix unrelated jobs."

**Follow-ups:**
- *How do you spot high coupling?* A change that touches many files, and tests that need many real systems running.

---

### Q04. Composition over inheritance

**Short answer:** Prefer building objects **from** other objects ("has-a") over deep class hierarchies ("is-a"). Inheritance ties the child to the parent's internals and creates a class for every combination of features; **composition** lets you combine small parts at run time and swap any of them.

**How it works:** with inheritance, `RetryingCachingClient` needs its own class, and so does every other combination. With composition, each feature is a small wrapper that holds another client and exposes the same method, so you stack wrappers in any order.

**Example:**
```python
class PaymentClient:                                  # the real thing
    def charge(self, cents: int) -> str:
        return f"charged-{cents}"

class LoggingClient:                                  # same interface, adds logging
    def __init__(self, inner):
        self.inner = inner
    def charge(self, cents: int) -> str:
        print(f"charging {cents}")
        return self.inner.charge(cents)

class RetryingClient:                                 # same interface, adds retries
    def __init__(self, inner, attempts=3):
        self.inner, self.attempts = inner, attempts
    def charge(self, cents: int) -> str:
        for attempt in range(1, self.attempts + 1):
            try:
                return self.inner.charge(cents)
            except TimeoutError:
                if attempt == self.attempts:
                    raise

client = RetryingClient(LoggingClient(PaymentClient()))
print(client.charge(500))
```

```flow
trace: Wrapping behaviours around a client
PaymentClient() > The core object that does the real work.
LoggingClient(PaymentClient()) > Adds logging without touching the original class.
RetryingClient(LoggingClient(PaymentClient())) > Adds retries on top. Any order, any subset: no new class per combination.
client.charge(500) > Runs retry layer, then logging layer ("charging 500" is printed), then the real client.
return value > "charged-500" travels back out through the layers unchanged.
```

**What happens, step by step:**
1. `client.charge(500)` enters `RetryingClient`, which calls `self.inner.charge(500)` inside a `try`.
2. That inner object is `LoggingClient`: it prints `charging 500`, then calls the real client.
3. `PaymentClient` returns `"charged-500"`, which each layer returns to its caller, so the final value is `charged-500`.
4. If the real client raised `TimeoutError`, the retry layer would call again up to 3 times and re-raise on the last failure. Moving the logging layer outside the retry layer would log every attempt instead of once; swapping layers is a one-line change.

**Common mistake → fix:** a hierarchy such as `Client → RetryingClient → CachingRetryingClient → ...`. Each combination needs a class and the parent's internals leak into the child. Use wrappers as above. Keep inheritance for genuine "is-a" with a stable base, such as exception hierarchies or framework base classes.

**Interview answer:** "Composition builds behaviour by combining small objects that share an interface, while inheritance builds it by extending a parent. Composition avoids a class explosion, keeps parts independently testable, and lets me change behaviour at run time. I use inheritance for true is-a relationships with a stable base and composition for everything else."

**Follow-ups:**
- *Mixins?* Small base classes that add one capability; fine for simple cases, but they can create tangled method-resolution order, so wrappers are often clearer.

---

### Q05. DRY, KISS and YAGNI

**Short answer:** **DRY** (Don't Repeat Yourself): each piece of *knowledge* should have one home. **KISS** (Keep It Simple): choose the simplest design that meets today's requirements. **YAGNI** (You Aren't Gonna Need It): don't build for imagined future needs. The common trap is applying DRY too eagerly: merging code that only *looks* similar.

**How it works:** duplication of *knowledge* (a tax rate written in five places) causes bugs when one copy is updated and the others aren't. Duplication of *coincidentally similar code* is harmless until the two copies need to diverge; forcing them into one function then adds flags and `if` branches. A useful rule of thumb: the first time, just write it; the second time, copy it and notice; the third time, when the shape is clear, extract it.

**Example:**
```python
# Same KNOWLEDGE in two places: bug waiting to happen
def price_with_tax(p):   return p * 1.18
def invoice_total(items): return sum(i * 1.18 for i in items)

# One home for the knowledge
TAX_RATE = 0.18
def with_tax(amount: float) -> float:
    return amount * (1 + TAX_RATE)

# Similar-looking code that is NOT the same knowledge:
def validate_username(s): return 3 <= len(s) <= 20
def validate_note(s):     return 3 <= len(s) <= 20   # coincidence; notes may soon allow 500 chars
```

**What happens, step by step:**
1. The tax rate `1.18` appears twice; when the rate changes to 0.20, someone updates one and forgets the other, and invoices disagree with prices.
2. `TAX_RATE` makes the rate one fact in one place.
3. `validate_username` and `validate_note` share the same bounds today by accident. If you merge them into `validate_text(s)`, then when notes need 500 characters you add a parameter, then another; the merged function becomes the tangled thing DRY was meant to avoid.

**Common mistake → fix:** a "wrong abstraction". Merging two things that only look alike creates coupling that breaks when they diverge. The fix is to **duplicate first**, and extract only when you are sure they represent the same knowledge.

**Interview answer:** "DRY means one source of truth for each piece of knowledge, not eliminating every repeated line. KISS and YAGNI say to build the simplest thing that meets today's needs. A wrong abstraction is worse than a little duplication, so I tolerate duplication until the third use makes the real shape clear."

**Follow-ups:**
- *Rule of three?* Wait for three occurrences before abstracting.

---

### Q06. Interfaces in Python: ABC vs Protocol

**Short answer:** Python has no `interface` keyword. An **ABC** (abstract base class) is **nominal**: a class must inherit from it and implement its `@abstractmethod`s, or Python refuses to create instances. A **`Protocol`** is **structural**: any class with matching methods fits, with no inheritance; a type checker (mypy, pyright) verifies it. Use Protocols for the "ports" your business code depends on, and ABCs when you want shared base behaviour plus enforced subclassing.

**Example:**
```python
from abc import ABC, abstractmethod
from typing import Protocol

class Notifier(Protocol):                       # structural: just a shape
    def send(self, to: str, text: str) -> None: ...

class EmailNotifier:                            # no inheritance needed
    def send(self, to: str, text: str) -> None:
        print(f"email to {to}: {text}")

def alert(n: Notifier, user: str) -> None:
    n.send(user, "job finished")

alert(EmailNotifier(), "asha@example.com")      # type-checks and runs

class Exporter(ABC):                            # nominal: must inherit
    def run(self, data):                        # shared skeleton
        return self.render(data).upper()
    @abstractmethod
    def render(self, data) -> str: ...

class CsvExporter(Exporter):
    def render(self, data) -> str:
        return ",".join(map(str, data))

print(CsvExporter().run([1, 2, 3]))             # 1,2,3
# Exporter()   -> TypeError: Can't instantiate abstract class Exporter ...
```

**What happens, step by step:**
1. `EmailNotifier` never mentions `Notifier`, but it has a matching `send`, so a type checker accepts it wherever a `Notifier` is expected.
2. `CsvExporter` inherits `run` from the ABC and supplies `render`. Forgetting `render` makes `CsvExporter()` fail immediately with `TypeError`.
3. At run time Python doesn't check the Protocol at all; the safety comes from the type checker, so run it in CI.

**How to choose:** a function needs "something with these methods" (especially third-party classes) → Protocol. A family of your own classes with shared logic and a required hook → ABC.

**Common mistake → fix:** forcing third-party classes to inherit from your ABC just to satisfy a type. Define a Protocol with only the methods you call.

**Interview answer:** "ABCs enforce a hierarchy through inheritance and fail at instantiation if methods are missing; Protocols describe a shape and any matching class fits, checked statically. I use Protocols for the ports that business code depends on, since third-party classes and test fakes fit without inheriting, and ABCs when subclasses share a template of behaviour."

**Follow-ups:**
- *`@runtime_checkable`?* Lets `isinstance` check that the methods exist, but not their signatures.

---

## 3. SOLID

**SOLID is five principles for writing classes and modules that are easy to change.** The letters stand for Single responsibility, Open/closed, Liskov substitution, Interface segregation and Dependency inversion. They are guidelines, not laws: each one trades some simplicity for easier change, so apply them where change actually happens. The examples below use one domain: orders and payments.

### Q07. S: Single Responsibility Principle (SRP)

**Short answer:** A class should have **one reason to change**. If a payment rule change, a database change and an email wording change all force edits to the same class, it has three responsibilities. Split it so that each class changes for one kind of reason, and let a small coordinator wire them together.

**How it works:** ask of each class, "who might ask me to change this?" If the answer is several different people or concerns (finance, operations, marketing), split by that. This is *not* "one method per class"; a class can have many methods if they all serve one purpose.

**Example:**
```python
from dataclasses import dataclass

@dataclass
class Order:
    id: str
    total_cents: int

# ❌ one class changes when pricing rules, storage, or email wording changes
class OrderProcessorBad:
    def total_with_tax(self, order): ...
    def save_to_db(self, order): ...
    def send_receipt_email(self, order): ...

# ✅ separate reasons to change, plus a tiny coordinator
class TaxCalculator:
    def total_with_tax(self, order: Order) -> int:
        return round(order.total_cents * 1.18)

class OrderRepository:
    def __init__(self): self.rows = {}
    def save(self, order: Order, total: int) -> None:
        self.rows[order.id] = total

class ReceiptSender:
    def send(self, order: Order, total: int) -> str:
        return f"Receipt for {order.id}: {total / 100:.2f}"

class PlaceOrder:
    def __init__(self, tax, repo, sender):
        self.tax, self.repo, self.sender = tax, repo, sender
    def __call__(self, order: Order) -> str:
        total = self.tax.total_with_tax(order)
        self.repo.save(order, total)
        return self.sender.send(order, total)

place = PlaceOrder(TaxCalculator(), OrderRepository(), ReceiptSender())
print(place(Order("o1", 10_000)))        # Receipt for o1: 118.00
```

**What happens, step by step:**
1. `PlaceOrder` asks `TaxCalculator` for the total: `10000 * 1.18` → `11800`.
2. It tells `OrderRepository` to store it, then asks `ReceiptSender` for the message: `Receipt for o1: 118.00`.
3. If the tax rule changes, only `TaxCalculator` is edited; if storage moves to a real database, only `OrderRepository`; if the receipt wording changes, only `ReceiptSender`. Each can be tested alone.

**Common mistake → fix:** splitting too far, into dozens of one-method classes with no clear owner, or the opposite, a `Manager` class that does everything. Split along **reasons to change** you can actually name, not by line count.

**Interview answer:** "SRP says a class should have one reason to change, meaning one concern or stakeholder. I split classes along those lines, for example separating pricing rules, persistence and notifications, and connect them with a thin coordinator. That keeps changes local and each part easy to test."

**Follow-ups:**
- *How do you know a class does too much?* Its name needs "and" or "Manager", its tests need lots of setup, or unrelated changes keep landing in it.

---

### Q08. O: Open/Closed Principle (OCP)

**Short answer:** Software should be **open for extension, closed for modification**: add new behaviour by adding new code, not by editing a growing `if/elif` chain that already works. A common Python form is a **registry** (a dict from a key to a handler), or polymorphism.

**Example:**
```python
# ❌ every new file type edits this function (and risks breaking the old branches)
def extract_bad(doc):
    if doc["type"] == "pdf":   return "pdf text"
    elif doc["type"] == "docx": return "docx text"
    # add "xlsx" -> edit here again

# ✅ registry: a new type = a new function + one registration line
EXTRACTORS = {}

def register(kind):
    def deco(fn):
        EXTRACTORS[kind] = fn
        return fn
    return deco

@register("pdf")
def extract_pdf(doc): return f"pdf text of {doc['name']}"

@register("docx")
def extract_docx(doc): return f"docx text of {doc['name']}"

def extract(doc):
    try:
        return EXTRACTORS[doc["type"]](doc)
    except KeyError:
        raise ValueError(f"no extractor for {doc['type']}") from None

@register("xlsx")                       # added later, in a new file; extract() is unchanged
def extract_xlsx(doc): return f"xlsx text of {doc['name']}"

print(extract({"type": "xlsx", "name": "q3.xlsx"}))    # xlsx text of q3.xlsx
```

```flow
sequence: Open/closed with a registry
actors: New module, Registry, extract()
New module -> Registry: @register("xlsx") adds extract_xlsx
> Adding a type adds code; no existing function is edited.
extract() -> Registry: look up EXTRACTORS["xlsx"]
Registry --> extract(): extract_xlsx
> The dispatcher is closed for modification. The old pdf and docx handlers cannot be broken by this change.
```

**What happens, step by step:**
1. At import time each `@register(...)` call stores its function in `EXTRACTORS`.
2. `extract({"type": "xlsx", ...})` looks up `"xlsx"` in the dict and calls the function: `xlsx text of q3.xlsx`.
3. An unknown type raises a clear `ValueError` rather than silently returning `None`.
4. The dispatcher `extract` never changed when xlsx support was added.

**Common mistake → fix:** designing extension points for changes that never come. OCP pays off where new variants arrive regularly (file types, payment methods, rules). For a two-branch `if` that is stable, leave the `if`; add the registry when the third variant appears.

**Interview answer:** "OCP means adding behaviour by adding code rather than editing tested code. In Python I use a registry or polymorphism: a dispatcher looks up a handler, and a new variant registers itself. The existing handlers can't be broken by the change. I apply it where variants keep arriving, not everywhere."

**Follow-ups:**
- *Link to Strategy?* A registry of interchangeable functions is the Strategy pattern (Q17).

---

### Q09. L: Liskov Substitution Principle (LSP)

**Short answer:** A subclass must be usable anywhere its parent is expected **without surprising the caller**: it must accept at least the same inputs, return the same kind of output, and not raise errors the parent's callers don't expect. If code that works with `Storage` breaks when given `ReadOnlyStorage`, the subclass violates the contract.

**How it works:** the parent's **contract** (what it promises) is what callers rely on. A subclass may do more (accept a wider range of input, promise more) but never less. A giveaway of a violation: a subclass that overrides a method just to raise `NotImplementedError`, or that checks `isinstance` in callers.

**Example:**
```python
class Storage:
    def save(self, key: str, data: bytes) -> None:
        self.data = getattr(self, "data", {})
        self.data[key] = data

class ReadOnlyStorage(Storage):
    def save(self, key, data):
        raise NotImplementedError("read only")    # ❌ breaks callers of Storage

def archive(store: Storage, items: dict) -> None:
    for k, v in items.items():
        store.save(k, v)

archive(Storage(), {"a": b"1"})                   # fine
try:
    archive(ReadOnlyStorage(), {"a": b"1"})
except NotImplementedError as e:
    print("LSP violation:", e)                    # LSP violation: read only

# ✅ fix: split the abstractions so read-only storage never claims to be a writer
class Reader:
    def load(self, key: str) -> bytes: ...
class Writer:
    def save(self, key: str, data: bytes) -> None: ...
class DiskStore(Reader, Writer): ...
class ReadOnlyStore(Reader): ...
```

```flow
trace: A Liskov violation
archive(store: Storage) calls store.save(k, v) > The function was written against the Storage contract: "save works".
archive(Storage()) > Saves the item. Works.
archive(ReadOnlyStorage()) > Raises **NotImplementedError** for the same call. The subclass broke the contract that callers rely on.
fix: separate Reader and Writer > ReadOnlyStore is only a Reader, so it can't be passed where a Writer is required. The type checker catches it.
```

**What happens, step by step:** the first `archive` call stores the bytes. The second call reaches `ReadOnlyStorage.save`, which raises, so any code written for `Storage` needs special cases for this subclass, which defeats polymorphism. After the split, passing a `ReadOnlyStore` to a function that needs a `Writer` is flagged before the code runs.

**Common mistake → fix:** the textbook example: `Square(Rectangle)`. Setting `width` on a square must also set `height`, so code that sets width and height independently and expects `area == w * h` breaks. The fix is not to inherit: model both as separate shapes implementing a common `area()` interface.

**Interview answer:** "LSP says a subclass must honour the parent's contract so that code written for the parent works unchanged with any subclass. Overriding a method to throw `NotImplementedError`, or narrowing accepted inputs, breaks it. When I notice that, I usually split the interface so the subclass only claims what it can really do."

**Follow-ups:**
- *Contract rules?* Subclass methods may weaken preconditions and strengthen postconditions, but not the reverse.

---

### Q10. I: Interface Segregation Principle (ISP)

**Short answer:** Clients shouldn't be forced to depend on methods they don't use. Prefer several **small, focused interfaces** over one fat one. A function that only reads should ask for a `Reader`, not a `FullStorage` with ten methods; it becomes easier to fake in tests and gives callers less power than they need (least privilege).

**Example:**
```python
from typing import Protocol

class DocReader(Protocol):
    def get(self, doc_id: str) -> bytes: ...

class DocWriter(Protocol):
    def put(self, doc_id: str, data: bytes) -> None: ...

class InMemoryDocs:                              # implements both
    def __init__(self): self.d = {}
    def get(self, doc_id): return self.d[doc_id]
    def put(self, doc_id, data): self.d[doc_id] = data

def word_count(reader: DocReader, doc_id: str) -> int:   # needs only read
    return len(reader.get(doc_id).split())

class ReadOnlyFake:                              # a tiny fake is enough for the test
    def get(self, doc_id): return b"one two three"

print(word_count(ReadOnlyFake(), "x"))           # 3
```

**What happens, step by step:**
1. `word_count` declares that it needs only `get`. Its type says it cannot write.
2. The test passes a three-line fake with just `get`; with a fat `DocStore` interface the fake would have to implement `put`, `delete`, `list` and more.
3. The real `InMemoryDocs` also satisfies `DocReader`, so production code works too.

**Common mistake → fix:** one big `Repository` interface for everything, so each new method forces every implementation and every fake to change. Split by how clients use it. The same idea applies to tools given to software agents or scripts: a narrow `read_ticket` capability is safer than a `ticket_admin` with forty operations.

**Interview answer:** "ISP says depend on the smallest interface you need. I split fat interfaces into focused ones, such as reader and writer, so callers only see what they use, fakes are tiny, and permissions follow least privilege. In Python, Protocols make that cheap."

**Follow-ups:**
- *Relation to SRP?* SRP is about why a class changes; ISP is about what each client sees of it.

---

### Q11. D: Dependency Inversion Principle (DIP)

**Short answer:** High-level business logic should depend on **abstractions** (small interfaces), not on concrete infrastructure such as a specific SDK or database. The infrastructure code implements the abstraction. In normal dependency direction the business code would import the SDK; "inverting" it means the SDK adapter imports (conforms to) the interface owned by the business code. It is usually combined with **dependency injection** (Q12).

**Example:**
```python
from typing import Protocol

class PaymentGateway(Protocol):                     # owned by the business layer
    def charge(self, customer_id: str, cents: int) -> str: ...

class Checkout:                                     # business logic: no SDK imports
    def __init__(self, gateway: PaymentGateway):
        self.gateway = gateway
    def pay(self, customer_id: str, cents: int) -> str:
        if cents <= 0:
            raise ValueError("amount must be positive")
        return self.gateway.charge(customer_id, cents)

class HttpGateway:                                  # infrastructure adapter
    def charge(self, customer_id, cents):
        # real code would call the provider's HTTP API here
        return f"txn-http-{customer_id}-{cents}"

class FakeGateway:                                  # test double
    def __init__(self): self.calls = []
    def charge(self, customer_id, cents):
        self.calls.append((customer_id, cents))
        return "txn-test"

fake = FakeGateway()
assert Checkout(fake).pay("c1", 4999) == "txn-test"
assert fake.calls == [("c1", 4999)]
print(Checkout(HttpGateway()).pay("c1", 4999))      # txn-http-c1-4999
```

```flow
sequence: Dependency inversion with injection
actors: Composition root, Checkout, PaymentGateway (interface), HttpGateway or FakeGateway
Composition root -> HttpGateway or FakeGateway: create the concrete gateway
Composition root -> Checkout: Checkout(gateway=...)
Checkout -> PaymentGateway (interface): gateway.charge("c1", 4999)
PaymentGateway (interface) -> HttpGateway or FakeGateway: whichever was injected runs
> Business code knows only the interface. Production injects the real adapter; tests inject a fake with no network.
```

**What happens, step by step:**
1. Startup code (the **composition root**) creates a concrete gateway and passes it into `Checkout`.
2. `Checkout.pay` validates the amount and calls `charge` on whatever object it was given.
3. With `FakeGateway`, the test asserts both the return value `txn-test` and the recorded call `("c1", 4999)`, with no mocking library and no network.
4. Switching provider means writing a new adapter and changing one line at startup; `Checkout` is untouched.

**Common mistake → fix:** creating the dependency inside the business class (`self.gateway = HttpGateway()` in `__init__`). Now every test hits the real system or needs monkey-patching, and swapping the provider edits the business class. Accept the dependency as a parameter.

**Interview answer:** "DIP means business logic depends on interfaces it owns, not on concrete SDKs; adapters implement those interfaces. I pass dependencies in through constructors, so the app wires real implementations at startup and tests pass fakes. This makes the core fast to test and lets me change providers without touching business rules."

**Follow-ups:**
- *Is DIP the same as dependency injection?* No: DIP is the design rule (depend on abstractions); injection is one technique to supply the implementation (Q12).

---

### Q12. What is dependency injection, and do you need a framework?

**Short answer:** **Dependency injection (DI)** means a class receives the things it depends on (database, clock, HTTP client) from the outside, usually as constructor arguments, instead of creating them itself. The place where everything is created and connected, near the start of the program, is the **composition root**. In Python you rarely need a DI framework: constructor arguments plus a small `build_app()` function are enough, and web frameworks such as FastAPI offer `Depends` for per-request dependencies.

**How it works:** a class that calls `datetime.now()` or `requests.get()` directly is hard to test, because you can't control time or the network. A class that takes a `clock` or `http` argument can be handed a fake one.

**Example:**
```python
from datetime import datetime, timezone

class TokenService:
    def __init__(self, clock=lambda: datetime.now(timezone.utc), ttl_seconds=3600):
        self.clock, self.ttl = clock, ttl_seconds        # injected clock

    def is_expired(self, issued_at: datetime) -> bool:
        return (self.clock() - issued_at).total_seconds() > self.ttl

issued = datetime(2026, 10, 27, 9, 0, tzinfo=timezone.utc)

at_10 = TokenService(clock=lambda: datetime(2026, 10, 27, 9, 59, tzinfo=timezone.utc))
at_11 = TokenService(clock=lambda: datetime(2026, 10, 27, 10, 1, tzinfo=timezone.utc))
print(at_10.is_expired(issued), at_11.is_expired(issued))    # False True

def build_app():                                    # composition root
    return TokenService()                           # real clock in production
```

**What happens, step by step:**
1. The token was issued at 09:00 with a one-hour lifetime (3,600 s).
2. The first service has a fake clock reading 09:59 → 3,540 s elapsed → not expired (`False`).
3. The second reads 10:01 → 3,660 s elapsed → expired (`True`).
4. The test needed no `sleep` and no patching of `datetime`; production uses the default real clock.

**Common mistake → fix:** a "service locator" or global container that classes pull dependencies from (`Container.get("db")`). The dependencies become invisible in the signature, and tests must set up global state. Prefer explicit constructor parameters.

**Interview answer:** "Dependency injection means passing a class what it needs, such as a database client or clock, instead of letting it construct them. I wire real objects in one composition root at startup, and tests pass fakes. In Python that's usually just constructor arguments; I only add a framework like FastAPI's `Depends` where the web layer needs per-request dependencies."

**Follow-ups:**
- *Constructor vs setter injection?* Constructor injection makes dependencies required and visible, so it's the default.

---
## 4. Classic design patterns in Python

### Q13. What is a design pattern, and how are they grouped?

**Short answer:** A **design pattern** is a named, reusable solution shape for a problem that keeps appearing in software design, such as "how do I choose between interchangeable algorithms at run time?" (Strategy). The best-known catalogue is from the "Gang of Four" (GoF) book, which groups 23 patterns into three families: **creational** (how objects are created), **structural** (how objects are combined) and **behavioural** (how objects interact and share responsibility). Patterns give teams a shared vocabulary; they are not code to copy.

**How it works:** each pattern has a **problem**, a **structure** and **trade-offs**. Many classic patterns were written for languages without first-class functions or flexible modules, so in Python several shrink to a function, a dict or a module.

| Family | Question it answers | Examples in this course |
|---|---|---|
| Creational | Who creates the object, and which class? | Singleton, Factory, Builder |
| Structural | How do I combine or adapt objects? | Adapter, Facade, Decorator, Repository |
| Behavioural | How do objects cooperate? | Strategy, Observer, Command, Chain of Responsibility, Template Method |

**Example (the same idea three ways): "choose a sorting rule at run time":**
```python
# GoF-style: a Strategy class hierarchy
class ByPrice:
    def key(self, item): return item["price"]
class ByName:
    def key(self, item): return item["name"]

# Pythonic: a strategy is just a function
def by_price(item): return item["price"]

items = [{"name": "pen", "price": 5}, {"name": "ink", "price": 3}]
print(sorted(items, key=ByPrice().key)[0]["name"])   # ink
print(sorted(items, key=by_price)[0]["name"])        # ink
```

**What happens, step by step:** both versions pass a "how to compare" behaviour into `sorted`. The class version needs a class and an instance; the function version needs only the function, because functions are objects in Python. Both are the Strategy pattern; the second is simply shorter.

**Common mistake → fix:** starting a design by picking patterns ("let's use a Factory and an Observer here") instead of starting from the problem. Patterns added without a need create indirection and make the code harder to read. Write the simple version, feel the pain (a growing `if` chain, a hard-to-test dependency), then apply the pattern that removes that specific pain.

**Interview answer:** "A design pattern is a named solution to a recurring design problem, which gives teams shared vocabulary. The classic ones fall into creational, structural and behavioural families. In Python many collapse into functions, dicts or modules, so I choose a pattern because of a concrete problem, such as a growing if-chain or a hard-to-test dependency, not to show off."

**Follow-ups:**
- *Which patterns do you use most in Python?* Strategy (functions), Factory, Adapter, Decorator (both the pattern and `@decorator`), Observer and Repository.

---

### Q14. Singleton, and why it's usually just a module

**Short answer:** The **Singleton** pattern ensures a class has **exactly one instance** and gives global access to it (for example one configuration object or one connection pool). In Python, a **module is already a singleton** because it is imported once, so a module-level object, or a cached factory function (`functools.cache`), is the idiomatic version. Singletons are global state, so prefer creating one object at startup and *injecting* it.

**Example:**
```python
from functools import cache

class Settings:
    def __init__(self):
        print("loading settings")          # runs once
        self.timeout = 5

@cache
def get_settings() -> Settings:
    return Settings()

a = get_settings()
b = get_settings()
print(a is b)                              # True: the same object
```

```flow
trace: A Singleton the Python way
get_settings() first call > @cache finds no stored result, runs Settings(), prints "loading settings" and stores the object.
get_settings() second call > @cache returns the stored object. Settings() is not run again.
a is b > **True**: both names refer to the same object.
in tests > Call get_settings.cache_clear() to reset it, or better, inject a Settings object so no global is needed.
```

**What happens, step by step:** the first call creates `Settings` (and prints once). The second call finds the cached result keyed by the (empty) arguments and returns it. `a is b` is `True`.

**Common mistake → fix:** hard-coding a global and mutating it across threads and tests: `CONFIG["timeout"] = 1` in one test leaks into the next, and concurrent mutation races. Create the object once at startup (for example in an application's startup hook), pass it to the classes that need it, and treat it as read-only.

**Interview answer:** "A singleton guarantees a single instance with global access. In Python a module-level object or an `lru_cache`'d factory gives that for free, since modules are imported once. The danger is hidden global state that makes tests order-dependent and concurrent mutation unsafe, so I'd rather build it once at startup and inject it."

**Follow-ups:**
- *Thread-safe singleton?* A module-level object created at import time is safe; lazy creation needs a lock or `functools.cache` (`functools.cache` does not lock the factory, so two racing threads can both build an object; create eagerly or add a lock if that matters).

---

### Q15. Factory (and Abstract Factory)

**Short answer:** A **Factory** is a function or class whose job is to decide **which concrete class to create** and hand it back, so callers depend on the interface rather than on a specific class. An **Abstract Factory** creates a whole **family** of related objects that must match (for example a cloud storage client plus its matching queue client, or their local fakes).

**Example:**
```python
class EmailNotifier:
    def send(self, msg): return f"email: {msg}"

class SmsNotifier:
    def send(self, msg): return f"sms: {msg}"

class ConsoleNotifier:
    def send(self, msg): return f"console: {msg}"

def make_notifier(kind: str):
    match kind:
        case "email":   return EmailNotifier()
        case "sms":     return SmsNotifier()
        case "console": return ConsoleNotifier()
        case _:         raise ValueError(f"unknown notifier {kind!r}")

settings = {"notifier": "sms"}                  # comes from configuration
notifier = make_notifier(settings["notifier"])
print(notifier.send("job done"))                # sms: job done
```

**What happens, step by step:**
1. Configuration says `"sms"`.
2. `make_notifier("sms")` matches the second case and returns an `SmsNotifier`.
3. The caller calls `.send(...)` and never imports or names `SmsNotifier`. Switching to email is a configuration change.
4. An unknown value fails immediately with a clear error instead of producing `None` that breaks later.

**Abstract Factory:** if switching from "cloud" to "local" must change *several* objects at once (storage, queue, secrets), a factory returns the whole matching set:
```python
def make_backends(env: str):
    if env == "local":
        return {"storage": "LocalDisk()", "queue": "InMemoryQueue()"}
    return {"storage": "CloudBucket()", "queue": "CloudQueue()"}
```

**Common mistake → fix:** a factory with an ever-growing `match` that needs editing for every new class (it violates OCP, Q08). Use a registry dict that new classes add themselves to, once variants multiply.

**Interview answer:** "A factory centralises the decision of which concrete class to build, so callers depend only on the interface and configuration picks the implementation. An abstract factory builds a family of matching objects together, for example all the cloud backends or all the local fakes. I keep it as a simple function and move to a registry if variants keep growing."

**Follow-ups:**
- *Factory vs constructor?* A constructor always builds its own class; a factory can return different classes, cached instances, or fakes.

---

### Q16. Builder

**Short answer:** A **Builder** constructs a complex object **step by step**, often with a fluent (chainable) interface, and validates it when `build()` is called. In Python, keyword arguments and dataclasses with defaults remove most of the need; a builder is still useful when an object has many optional parts, ordering rules or validation that should happen once at the end.

**Example:**
```python
from dataclasses import dataclass, field

@dataclass(frozen=True)
class Request:
    url: str
    method: str
    headers: dict
    timeout: float

class RequestBuilder:
    def __init__(self, url: str):
        self._url = url
        self._method = "GET"
        self._headers = {}
        self._timeout = 5.0

    def method(self, m: str) -> "RequestBuilder":
        self._method = m
        return self

    def header(self, k: str, v: str) -> "RequestBuilder":
        self._headers[k] = v
        return self

    def timeout(self, seconds: float) -> "RequestBuilder":
        self._timeout = seconds
        return self

    def build(self) -> Request:
        if self._method in ("POST", "PUT") and "Content-Type" not in self._headers:
            raise ValueError("POST/PUT needs a Content-Type header")
        return Request(self._url, self._method, dict(self._headers), self._timeout)

req = (RequestBuilder("https://api.example.com/jobs")
       .method("POST").header("Content-Type", "application/json").timeout(10).build())
print(req.method, req.timeout)          # POST 10
```

**What happens, step by step:**
1. `RequestBuilder(url)` starts with defaults (GET, no headers, 5 s).
2. Each chained call changes one setting and returns the builder itself, so calls can be chained.
3. `build()` is the single place where the whole combination is validated (a POST needs a content type) and an immutable `Request` is produced.
4. Without the header, `build()` would raise `ValueError` before any invalid request object could exist.

**Common mistake → fix:** writing a builder for an object with three fields. `Request(url, method="POST", timeout=10)` is clearer. Use builders for complex, multi-step, validated construction (query builders, graph or pipeline definitions that end with `compile()`).

**Interview answer:** "A builder assembles a complex object in steps, usually with a fluent interface, and validates and freezes it in `build()`. Python's keyword arguments and dataclasses cover simple cases, so I reach for a builder when there are many optional parts, ordering constraints, or cross-field validation, as with query builders or workflow graph definitions."

**Follow-ups:**
- *Why make the product immutable?* So a built object can't be changed into an invalid state later.

---

### Q17. Strategy

**Short answer:** **Strategy** defines a family of interchangeable algorithms behind one interface and lets the caller pick one at run time. In Python a strategy is often just a **function** passed as an argument or looked up in a dict. It removes `if/elif` chains over "which way to do it".

**Example:**
```python
def flat_discount(total):   return total - 5
def percent_discount(total): return total * 0.9
def no_discount(total):     return total

STRATEGIES = {"flat": flat_discount, "percent": percent_discount, "none": no_discount}

def checkout(total: float, strategy: str = "none") -> float:
    return STRATEGIES[strategy](total)

print(checkout(100, "flat"))       # 95
print(checkout(100, "percent"))    # 90.0
print(checkout(100))               # 100
```

**What happens, step by step:**
1. The caller passes the amount and a strategy name.
2. `STRATEGIES[strategy]` returns the function; calling it with the total gives the discounted price: 100 − 5 = 95, or 100 × 0.9 = 90.0.
3. Adding a "loyalty" discount means adding one function and one dictionary entry; `checkout` is unchanged.

**Other examples:** retry and backoff policies, pricing rules, routing to a cheap or a strong model, compression algorithms, sorting keys.

**Common mistake → fix:** implementing a full class hierarchy with one method each when a function would do. Use classes only when a strategy needs its own state or several methods.

**Interview answer:** "Strategy puts interchangeable algorithms behind one interface so the caller can choose at run time, replacing if/elif chains. In Python I usually pass functions or look them up in a dict, which also gives me the Open/Closed benefit: a new strategy is new code, not an edit to the caller."

**Follow-ups:**
- *Strategy vs State?* Strategy is chosen by the client; State changes by itself as the object's situation changes.

---

### Q18. Observer (publish/subscribe)

**Short answer:** **Observer** lets one object (the **subject** or publisher) announce that something happened, and any number of other objects (**subscribers**) react, without the publisher knowing who they are. Inside one process this is callbacks or an event bus; across services it becomes **pub/sub messaging** (a topic with subscribers). It decouples "something happened" from "what to do about it".

**Example:**
```python
from collections import defaultdict

class EventBus:
    def __init__(self):
        self._subs = defaultdict(list)

    def subscribe(self, event: str, handler) -> None:
        self._subs[event].append(handler)

    def publish(self, event: str, payload: dict) -> None:
        for handler in list(self._subs[event]):
            try:
                handler(payload)
            except Exception as e:                    # one bad subscriber must not stop the others
                print(f"handler {handler.__name__} failed: {e}")

def send_email(p):     print("email for job", p["job_id"])
def update_dashboard(p): print("dashboard updated for", p["job_id"])
def broken(p):         raise RuntimeError("boom")

bus = EventBus()
bus.subscribe("job.completed", send_email)
bus.subscribe("job.completed", broken)
bus.subscribe("job.completed", update_dashboard)
bus.publish("job.completed", {"job_id": "j42"})
```

```flow
sequence: Observer through an event bus
actors: Job service, EventBus, Email, Dashboard
Email -> EventBus: subscribe("job.completed")
Dashboard -> EventBus: subscribe("job.completed")
Job service -> EventBus: publish("job.completed", job_id j42)
EventBus -> Email: send_email(payload)
EventBus -> Dashboard: update_dashboard(payload)
> The job service never imported Email or Dashboard. Adding a third subscriber changes nothing in the publisher.
```

**What happens, step by step:** `publish` calls the three handlers in subscription order: `email for job j42`; the broken one raises, is caught and reported (`handler broken failed: boom`); then `dashboard updated for j42` still runs, because errors are isolated per handler. Across services, the bus becomes a message broker, and delivery is usually **at least once**, so subscribers must be idempotent (Q30).

**Common mistake → fix:** subscribers that run slow work inline, blocking the publisher, or an exception in one subscriber that aborts the rest. Isolate failures (as above), and for slow or unreliable reactions put the event on a queue and process it asynchronously.

**Interview answer:** "Observer lets a publisher notify subscribers without knowing them, so features like email or dashboards can be added without editing the publisher. In-process it's an event bus or callbacks; between services it's pub/sub. I isolate subscriber failures, keep handlers fast or queue them, and make cross-service consumers idempotent."

**Follow-ups:**
- *Memory leaks?* Subscribers that never unsubscribe stay alive via the bus; unsubscribe on teardown or use weak references.

---

### Q19. Adapter

**Short answer:** An **Adapter** converts one interface into the one your code expects, like a travel plug adapter. You wrap a third-party class or legacy API so that it matches the interface your business code depends on, keeping vendor details out of your core logic.

**Example:**
```python
class VendorSmsClient:                                # third-party: awkward interface
    def dispatch(self, phone_number: str, body: str, flash: bool = False) -> dict:
        return {"status": "queued", "to": phone_number, "len": len(body)}

class Notifier:                                       # the interface our code expects
    def send(self, to: str, text: str) -> bool: ...

class SmsAdapter(Notifier):
    def __init__(self, client: VendorSmsClient):
        self.client = client
    def send(self, to: str, text: str) -> bool:
        result = self.client.dispatch(phone_number=to, body=text)
        return result["status"] == "queued"

n = SmsAdapter(VendorSmsClient())
print(n.send("+911234567890", "your code is 4821"))   # True
```

**What happens, step by step:**
1. Business code calls `send(to, text)`: the interface it knows.
2. The adapter translates: it renames the arguments, calls `dispatch`, and converts the vendor's dict response into the simple `True`/`False` our code wants.
3. If the vendor changes its API, only `SmsAdapter` changes. If we switch vendors, we write another adapter.

**Common mistake → fix:** letting vendor types leak through (returning the vendor's response dict to business code). Convert to your own types at the boundary. This protective layer is also called an **anti-corruption layer** when it shields a clean model from a messy legacy one (Q37).

**Interview answer:** "An adapter wraps a class with an incompatible interface so it fits the interface my code expects. I use it for vendor SDKs and legacy systems, translating names, types and errors at the boundary, so a vendor change or swap affects one class rather than the whole codebase."

**Follow-ups:**
- *Adapter vs Decorator?* An adapter changes the interface; a decorator keeps the same interface and adds behaviour (Q21).

---

### Q20. Facade

**Short answer:** A **Facade** is one simple entry point in front of a complicated set of subsystems. Callers make one call (`ingest(file)`) and the facade coordinates the many steps behind it (store, extract text, split, index). It reduces what callers must know; it does not forbid using the subsystems directly.

**Example:**
```python
class Storage:
    def upload(self, name): return f"stored/{name}"
class TextExtractor:
    def extract(self, path): return "some words in the file"
class Chunker:
    def split(self, text): return text.split()
class Index:
    def __init__(self): self.items = []
    def add(self, chunks): self.items.extend(chunks)

class DocumentService:                                  # the facade
    def __init__(self):
        self.storage, self.extractor = Storage(), TextExtractor()
        self.chunker, self.index = Chunker(), Index()

    def ingest(self, filename: str) -> int:
        path = self.storage.upload(filename)
        text = self.extractor.extract(path)
        chunks = self.chunker.split(text)
        self.index.add(chunks)
        return len(chunks)

svc = DocumentService()
print(svc.ingest("report.pdf"))     # 4
```

**What happens, step by step:** `ingest("report.pdf")` uploads (`stored/report.pdf`), extracts the text (`"some words in the file"`), splits it into 4 chunks, adds them to the index and returns 4. The caller wrote one line and knows nothing about the four subsystems.

**Common mistake → fix:** a facade that grows into a "god class" with every operation. Keep it thin: orchestration only, with real logic in the subsystems. Facade vs Adapter: a facade simplifies a subsystem, an adapter converts an interface.

**Interview answer:** "A facade offers one simple method in front of several subsystems, hiding the order and wiring of the steps. It lowers coupling because callers depend on the facade only. I keep it thin, with orchestration but no business logic, so it doesn't turn into a god class."

**Follow-ups:**
- *Where do you see facades?* Service classes in layered apps, SDK helper clients, `requests.get()` over urllib's complexity.

---

### Q21. Decorator pattern (vs Python's `@decorator`)

**Short answer:** The **Decorator pattern** wraps an object to add behaviour while keeping the **same interface**, so a caller can't tell the difference (the logging and retrying clients in Q04 are decorators). Python's `@decorator` syntax applies the same idea to **functions**: logging, timing, retries, caching, access checks.

**Example:**
```python
import functools, time

def timed(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        try:
            return fn(*args, **kwargs)
        finally:
            print(f"{fn.__name__} took {(time.perf_counter() - start) * 1000:.0f} ms")
    return wrapper

@timed
def fetch_report(n):
    time.sleep(0.05)
    return n * 2

print(fetch_report(21))
```

```flow
trace: A function decorator wrapping a call
@timed def fetch_report > At definition time Python runs fetch_report = timed(fetch_report), so the name now points to the wrapper.
fetch_report(21) > The wrapper runs first and records the start time.
the original fetch_report(21) runs > It was captured in the wrapper's closure. It sleeps 50 ms and returns **42**.
finally block > Prints "fetch_report took 50 ms" whether the call returned or raised.
caller receives 42 > The same return value as the undecorated function: the interface is unchanged.
```

**What happens, step by step:** output is `fetch_report took 50 ms` (approximately) followed by `42`. The caller used the same name and arguments as before; the timing was added from outside. `functools.wraps` keeps the original `__name__` and docstring.

**Common mistake → fix:** a wrapper that forgets `return` or doesn't pass `*args, **kwargs`, silently returning `None` or breaking on other signatures. Always forward arguments and return the result, and use `functools.wraps`.

**Interview answer:** "The decorator pattern adds behaviour by wrapping an object that has the same interface, so features stack without subclassing. Python's `@decorator` is the same idea for functions; the decorator runs once at definition time and the wrapper runs on every call. I use it for cross-cutting concerns like timing, retries, caching and auth checks."

**Follow-ups:**
- *Class decorators?* `@dataclass` and `@functools.total_ordering` take a class and return a modified class.

---

### Q22. Repository and Unit of Work

**Short answer:** A **Repository** is a collection-like interface for loading and saving domain objects (`orders.get(id)`, `orders.add(order)`) that hides how they're stored. A **Unit of Work** groups several changes into one **transaction** that commits or rolls back together. Together they keep SQL out of business logic and let tests use an in-memory repository.

**Example:**
```python
from dataclasses import dataclass
from typing import Protocol

@dataclass
class Order:
    id: str
    status: str = "NEW"

class OrderRepo(Protocol):
    def get(self, order_id: str) -> Order | None: ...
    def add(self, order: Order) -> None: ...

class InMemoryOrderRepo:
    def __init__(self): self.rows = {}
    def get(self, order_id): return self.rows.get(order_id)
    def add(self, order): self.rows[order.id] = order

class UnitOfWork:
    def __init__(self):
        self.orders = InMemoryOrderRepo()
        self.committed = False
    def __enter__(self): return self
    def __exit__(self, exc_type, exc, tb):
        if exc_type is not None:
            self.rollback()
        return False
    def commit(self): self.committed = True
    def rollback(self): self.committed = False

def mark_paid(uow: UnitOfWork, order_id: str) -> None:
    with uow:
        order = uow.orders.get(order_id)
        if order is None:
            raise KeyError(order_id)
        order.status = "PAID"
        uow.commit()

uow = UnitOfWork()
uow.orders.add(Order("o1"))
mark_paid(uow, "o1")
print(uow.orders.get("o1").status, uow.committed)    # PAID True
```

```flow
sequence: A use case with a repository and a unit of work
actors: Use case, UnitOfWork, OrderRepo, Database
Use case -> UnitOfWork: with uow (starts a transaction)
Use case -> OrderRepo: get("o1")
OrderRepo -> Database: SELECT the order
Use case -> Use case: order.status = "PAID"
Use case -> UnitOfWork: commit()
UnitOfWork -> Database: one transaction, or a rollback if an error occurred
> Business code never sees SQL. Tests swap in the in-memory repository.
```

**What happens, step by step:** `mark_paid` enters the unit of work, loads order `o1`, changes its status and commits: the output is `PAID True`. If the `KeyError` branch were hit, `__exit__` would see the exception and roll back instead. With a real database, the repository would use a session and the unit of work would own the transaction.

**Common mistake → fix:** a repository that returns database rows or query objects, so SQL details leak into business code. Return domain objects. Also avoid a repository method per query (`find_by_x_and_y_and_z`); keep a small interface and put complex reporting queries in separate read code (Q35).

**Interview answer:** "A repository hides persistence behind a collection-like interface so business code deals with domain objects, and a unit of work makes a group of changes one atomic transaction. They let me test business logic with an in-memory repository and change databases without touching the use cases. SQLAlchemy's `Session` is already a unit of work."

**Follow-ups:**
- *Do you need a repository over an ORM?* Not always; it's worth it when you want to test without a database or isolate a swappable storage.

---

### Q23. Command

**Short answer:** The **Command** pattern turns a request into an **object** that holds everything needed to perform an action (what to do and with which data), so you can queue it, log it, retry it, require approval, or undo it later. A job placed on a task queue is a command; so is a button's "action" record in an undo stack.

**Example:**
```python
from dataclasses import dataclass

@dataclass(frozen=True)
class Refund:
    order_id: str
    amount_cents: int

class RefundHandler:
    def __init__(self, limit_cents=10_000):
        self.limit, self.log = limit_cents, []
    def handle(self, cmd: Refund) -> str:
        if cmd.amount_cents > self.limit:
            return "needs approval"
        self.log.append(cmd)
        return f"refunded {cmd.amount_cents} on {cmd.order_id}"

handler = RefundHandler()
queue = [Refund("A12", 5_000), Refund("B77", 50_000)]     # commands waiting in a queue
print([handler.handle(c) for c in queue])
# ['refunded 5000 on A12', 'needs approval']
```

**What happens, step by step:**
1. Each request is created as a `Refund` object with all the data needed. Because the object exists on its own, it can sit in a queue, be saved, or be inspected.
2. The handler processes them later: the first is under the 10,000 limit and runs; the second exceeds it, so it returns `needs approval` without any change.
3. Because the commands are plain data, you can log them, replay them, or add an `undo` method per command.

**Common mistake → fix:** executing actions inline from many places, so policies (validation, approval, audit logging) must be repeated everywhere. Funnel actions through command objects and one handler. The same idea applies to tool calls made by automated agents: when each call is a command object you can validate it and require approval before executing.

**Interview answer:** "Command turns an action into an object holding its parameters, so it can be queued, logged, retried, approved or undone, and the code that issues it is decoupled from the code that executes it. Task-queue jobs and undo stacks are commands, and funnelling actions through command handlers gives me one place for validation and auditing."

**Follow-ups:**
- *Command vs Strategy?* A command represents *a request to do something* (with its data); a strategy represents *a way of doing it*.

---

### Q24. Chain of Responsibility (middleware)

**Short answer:** **Chain of Responsibility** passes a request through a series of handlers; each one may handle it, modify it, or pass it on, and any handler may stop the chain. **Middleware** in web frameworks is this pattern: authentication → rate limit → logging → the endpoint.

**Example:**
```python
def auth(request, next_handler):
    if "user" not in request:
        return "401 unauthorised"            # stops the chain
    return next_handler(request)

def rate_limit(request, next_handler):
    if request.get("calls", 0) > 100:
        return "429 too many requests"
    return next_handler(request)

def logging_mw(request, next_handler):
    response = next_handler(request)
    print("handled", request["path"], "->", response)
    return response

def endpoint(request):
    return "200 ok"

def build_chain(middlewares, final):
    handler = final
    for mw in reversed(middlewares):                 # wrap from the inside out
        handler = (lambda mw, nxt: lambda req: mw(req, nxt))(mw, handler)
    return handler

app = build_chain([logging_mw, auth, rate_limit], endpoint)
print(app({"path": "/jobs", "user": "asha", "calls": 3}))
print(app({"path": "/jobs"}))
```

```flow
pipeline: A request moving through middleware
Request arrives > It enters the first handler in the chain.
logging_mw > Calls the next handler, then logs the result on the way back out.
auth > Rejects a request with no user (401) and stops the chain, otherwise passes it on.
rate_limit > Rejects over-limit callers (429), otherwise passes it on.
endpoint > Does the real work and returns "200 ok". The response travels back through the handlers in reverse.
```

**What happens, step by step:**
1. First request: logging calls auth, auth sees `user`, passes to rate_limit (3 calls is under 100), which reaches the endpoint → `200 ok`; logging prints `handled /jobs -> 200 ok`.
2. Second request: auth finds no `user` and returns `401 unauthorised` without calling the rest, and logging still records it on the way out.
3. Reordering or adding a handler is a change to the list only.

**Common mistake → fix:** wrong order (rate limiting before authentication lets anonymous traffic consume your quota, or logging placed after a handler that stops the chain misses those requests). Think about the order deliberately and test rejected paths.

**Interview answer:** "Chain of Responsibility passes a request through handlers that can each process it, modify it or stop it. Web middleware is the everyday example: logging, authentication, rate limiting, then the endpoint. It keeps cross-cutting concerns out of business code and makes them composable, though order matters and should be tested."

**Follow-ups:**
- *How is it different from a decorator?* Decorators wrap to add behaviour while always delegating; chain handlers may decide to stop and answer themselves.

---

### Q25. Template Method

**Short answer:** **Template Method** defines the fixed skeleton of an algorithm in a base class and lets subclasses fill in specific steps. The base class controls the order ("fetch, extract, split, index"); each subclass supplies what varies ("how to extract from a PDF vs HTML"). In Python, passing the varying step as a function (Strategy) is often simpler.

**Example:**
```python
from abc import ABC, abstractmethod

class Ingestor(ABC):
    def run(self, source: str) -> list[str]:        # the fixed skeleton
        raw = self.fetch(source)
        text = self.extract(raw)                    # varies per subclass
        return self.chunk(text)

    def fetch(self, source: str) -> str:            # shared step
        return f"<raw:{source}>"

    @abstractmethod
    def extract(self, raw: str) -> str: ...

    def chunk(self, text: str) -> list[str]:        # shared step
        return text.split()

class HtmlIngestor(Ingestor):
    def extract(self, raw: str) -> str:
        return raw.strip("<>").replace("raw:", "html text from ")

print(HtmlIngestor().run("page.html"))
# ['html', 'text', 'from', 'page.html']
```

**What happens, step by step:** `run` fixes the order. It calls the shared `fetch` (`<raw:page.html>`), then the subclass's `extract` (`html text from page.html`), then the shared `chunk`, which splits on whitespace. A new `PdfIngestor` only implements `extract`; it cannot accidentally change the order of the steps.

**Function alternative:**
```python
def ingest(source, extract):                  # extract is passed in
    return extract(f"<raw:{source}>").split()
```

**Common mistake → fix:** many tiny hooks and deep subclass chains that nobody can follow (the "yo-yo problem": reading one method means jumping up and down the hierarchy). If only one step varies, pass it as a function.

**Interview answer:** "Template Method fixes the algorithm's skeleton in a base class and lets subclasses override specific steps, which guarantees the order and shares common code. In Python I use it when several steps vary or the shared flow is substantial; if only one step varies I pass a function instead, which is simpler."

**Follow-ups:**
- *Template Method and the Hollywood principle?* "Don't call us, we'll call you": the base class calls the subclass's hooks.

---
## 5. Microservice & distributed-system patterns

### Q26. What is a microservice, and what changes when a system is distributed?

**Short answer:** A **microservice** is a small, independently deployable service that owns one business capability and its own data, and talks to other services over the network (HTTP, gRPC or messages). Splitting a system this way lets teams deploy and scale parts separately, but it turns every function call between parts into a **network call**, and networks fail, are slow, and deliver messages late or twice. Most distributed-system patterns exist to cope with that.

**How it works:** in a single program, `payments.charge()` either returns or raises. Across a network there is a third outcome: **you don't know**. The request may have been lost before arriving, the service may have done the work but the reply was lost, or it may still be running. That uncertainty is the root of timeouts, retries, idempotency, sagas and outboxes.

```flow
sequence: The three outcomes of a remote call
actors: Orders, Payments
Orders -> Payments: charge(order o1, 50.00)
Payments -> Payments: charges the card
Payments --> Orders: reply is lost (network fault)
> Orders sees only a timeout. The card WAS charged, but Orders cannot tell that from "the request never arrived".
Orders -> Payments: retry the same charge with idempotency key o1
Payments --> Orders: already done, here is the earlier result
> An idempotency key makes the retry safe: the second call returns the first result instead of charging twice.
```

**Example (the cost of a call that isn't local):**
```python
import random

def local_call():
    return "ok"                                   # in-process: always returns or raises

def remote_call(failure_rate=0.3):
    r = random.random()
    if r < failure_rate:
        raise TimeoutError("no reply")            # may or may not have been executed!
    return "ok"

random.seed(7)
results = []
for _ in range(5):
    try:
        results.append(remote_call())
    except TimeoutError:
        results.append("timeout")
print(results)    # a mix of "ok" and "timeout" for the same call
```

**What happens, step by step:** the same call succeeds in some iterations and times out in others, with nothing wrong in the caller's code. Every caller of a remote service therefore needs a timeout, a decision about retrying (only safe if the operation is idempotent), and a fallback, which are the patterns in the next questions.

**Common mistake → fix:** splitting a system into services but keeping a chatty design where one user request makes ten synchronous calls in a chain. Availability multiplies: ten services at 99.9% each give roughly 99.0% overall. Reduce the chain, aggregate in one place (Q29), or make steps asynchronous (Q30).

**Interview answer:** "A microservice is an independently deployable service that owns one capability and its data. Its price is that calls between services go over a network, where they can fail, be slow, or leave you not knowing whether the work happened. So I design for it with timeouts, idempotent operations, retries with backoff, circuit breakers and eventual consistency, and I only split when there's a concrete reason."

**Follow-ups:**
- *What are the fallacies of distributed computing?* Assuming the network is reliable, latency is zero, bandwidth is infinite, the network is secure, topology doesn't change, and so on.

---

### Q27. Monolith vs modular monolith vs microservices

**Short answer:** A **monolith** is one deployable application. A **modular monolith** is still one deployable but has strict internal module boundaries, each module owning its own data and talking to others through defined interfaces. **Microservices** are many independently deployable services. Start with a modular monolith and extract a service only when there's a concrete reason: a different scaling profile, release cadence, team ownership, or security boundary.

| | Monolith | Modular monolith | Microservices |
|---|---|---|---|
| Deploy | one unit | one unit with strong internal boundaries | many independent units |
| Strengths | simple to build, test and run; real transactions | simple plus clean boundaries; easy to split later | independent deploys and scaling, team autonomy, fault isolation |
| Weaknesses | tangles as it grows | needs discipline to keep boundaries | network failures, distributed data, operations and observability cost |

```flow
pipeline: A sensible path from monolith to services
Monolith > One deployable. Simple until modules reach into each other's tables and tangle.
Modular monolith > Enforce boundaries inside: each module has a public interface and owns its tables. No cross-module SQL.
A concrete reason appears > For example CPU-heavy workers need different scaling, or one team needs its own release schedule.
Extract that one module > Behind a queue or API, with its own data and contract tests.
Measure > Did it solve the problem? Only then consider the next extraction.
```

**Example (boundaries inside a monolith):**
```python
# billing/api.py : the ONLY thing other modules may import from billing
def invoice_total(order_id: str) -> int: ...

# orders/service.py
from billing.api import invoice_total          # allowed: public interface
# from billing.models import InvoiceRow        # forbidden: reaching into billing's internals
```

**What happens, step by step:** `orders` calls `billing` through its small public function, never through its tables. If billing is later extracted into a service, only the body of `invoice_total` changes (it makes an HTTP call instead); callers are untouched. Tools such as import-linter can fail the build when a module imports another's internals.

**Common mistake → fix:** "microservices first" for a small team and an unclear domain. The result is a distributed monolith: many deployables that must still be released together, with all the network costs and none of the independence. Microservices are an organisational scaling tool, not a default.

**Interview answer:** "I'd start with a modular monolith: one deployable but with enforced boundaries and per-module data ownership. I extract a service when there's a concrete reason, such as a different scaling profile, release cadence, team ownership or isolation need. Microservices buy independence at the price of distributed-systems complexity, so they have to earn their place."

**Follow-ups:**
- *Signs you split too early?* Services that always deploy together, share a database, or can't be tested without each other.

---

### Q28. Domain-Driven Design basics: bounded contexts

**Short answer:** **Domain-Driven Design (DDD)** organises software around the business domain and its language. A **bounded context** is an area of the system inside which each term has one precise meaning and its own model. "Order" means a cart in *Sales*, a pick list in *Warehouse* and a billable invoice line in *Billing*. Service boundaries usually follow bounded contexts, and each context owns its data (**database per service**): others use its API or events, never its tables.

**How it works:** different parts of a business use the same word differently. Forcing one shared `Order` class on everybody makes it huge and every team's change risks breaking every other. Separate models per context stay small; translation happens at the boundary.

**Example:**
```python
from dataclasses import dataclass

# Sales context: an order is a customer's intention to buy
@dataclass
class SalesOrder:
    id: str
    items: list[str]
    customer_id: str

# Billing context: the same real-world thing, modelled for money
@dataclass
class Invoice:
    order_ref: str
    amount_cents: int
    tax_cents: int

def to_invoice(order: SalesOrder, prices: dict[str, int]) -> Invoice:   # translation at the boundary
    subtotal = sum(prices[i] for i in order.items)
    return Invoice(order_ref=order.id, amount_cents=subtotal, tax_cents=round(subtotal * 0.18))

print(to_invoice(SalesOrder("o1", ["pen", "ink"], "c9"), {"pen": 500, "ink": 1500}))
# Invoice(order_ref='o1', amount_cents=2000, tax_cents=360)
```

**What happens, step by step:** `SalesOrder` knows about items and customers but nothing about tax. `Invoice` knows about money but not about customers' carts. `to_invoice` is the translation point: it sums the item prices (500 + 1500 = 2000) and computes tax (360). Each model can change independently as long as the translation is updated.

**Common mistake → fix:** one giant shared "domain model" library imported by every service, which couples them all. Share *contracts* (API schemas, event definitions), not internal models.

**Interview answer:** "A bounded context is a part of the system with its own model and vocabulary, because the same word, like 'order', means different things to sales, warehouse and billing. I draw service boundaries along those contexts, give each its own data, and translate at the edges through APIs or events instead of sharing tables or one giant model."

**Follow-ups:**
- *What is an aggregate?* A cluster of objects treated as one unit for consistency, with one root object through which all changes go.

---

### Q29. API Gateway and Backend-for-Frontend (BFF)

**Short answer:** An **API gateway** is a single entry point at the edge of a system that handles routing, authentication, rate limiting, TLS and request validation before traffic reaches services. A **Backend-for-Frontend (BFF)** is a small backend built for one kind of client (web or mobile) that **aggregates** calls to several services and shapes the response for that screen, so the UI makes one call instead of six.

```flow
sequence: A BFF aggregating calls for a dashboard screen
actors: Browser, BFF, Profile service, Jobs service, Billing service
Browser -> BFF: GET /dashboard
BFF -> Profile service: get user
BFF -> Jobs service: recent jobs
BFF -> Billing service: current plan
> The BFF can make these three calls in parallel and handle a slow or failed one by returning a partial page.
BFF --> Browser: one response shaped for this screen
> One round trip for the browser. Auth, shaping and caching for this client live in one place.
```

**Example:**
```python
import asyncio

async def get_user():   await asyncio.sleep(0.05); return {"name": "Asha"}
async def get_jobs():   await asyncio.sleep(0.08); return [{"id": "j1"}, {"id": "j2"}]
async def get_plan():   await asyncio.sleep(0.02); raise TimeoutError("billing slow")

async def dashboard():
    user, jobs, plan = await asyncio.gather(
        get_user(), get_jobs(), get_plan(), return_exceptions=True)
    return {
        "user": user,
        "jobs": jobs,
        "plan": "unavailable" if isinstance(plan, Exception) else plan,   # degrade gracefully
    }

print(asyncio.run(dashboard()))
# {'user': {'name': 'Asha'}, 'jobs': [{'id': 'j1'}, {'id': 'j2'}], 'plan': 'unavailable'}
```

**What happens, step by step:** the three downstream calls start together, so the total time is about the slowest one (≈ 80 ms) rather than the sum (150 ms). `return_exceptions=True` turns billing's failure into a value instead of failing the whole request, and the BFF replies with the plan marked `unavailable`.

**Common mistake → fix:** putting business logic in the gateway or BFF, so it becomes a new monolith. Keep the gateway for cross-cutting concerns (auth, limits, routing) and the BFF for aggregation and shaping only.

**Interview answer:** "An API gateway is the single front door that handles routing, authentication, rate limiting and TLS. A BFF is a thin backend per client type that fans out to services in parallel and returns one response shaped for that screen, degrading gracefully when one dependency fails. Neither should contain core business rules."

**Follow-ups:**
- *Gateway vs service mesh?* The gateway handles north-south (client to system) traffic; a service mesh manages east-west (service to service) concerns like mTLS and retries.

---

### Q30. Sync vs async communication, and idempotent consumers

**Short answer:** **Synchronous** calls (HTTP, gRPC) are simple and give an immediate answer, but they couple availability: if the callee is down, so is the caller. **Asynchronous** communication (queues, events) decouples services in time, buffers spikes and isolates failures, but results are **eventually consistent** and messages are usually delivered **at least once**, so every consumer must be **idempotent**: processing the same message twice must have the same effect as once.

**How it works:** to make a consumer idempotent, give each message a unique ID and record IDs you've already processed, ideally **in the same transaction** as the side effect. A duplicate is then recognised and skipped.

**Example:**
```python
processed: set[str] = set()                 # in production: a table with a unique constraint
balance = {"acct": 100}

def handle_payment_event(event: dict) -> str:
    if event["id"] in processed:
        return "duplicate ignored"
    balance["acct"] += event["amount"]
    processed.add(event["id"])               # same transaction as the update in a real system
    return "applied"

e = {"id": "evt-1", "amount": 50}
print(handle_payment_event(e), handle_payment_event(e), balance)
# applied duplicate ignored {'acct': 150}
```

```flow
sequence: Sync coupling vs async decoupling
actors: Orders, Payments, Queue, Email service
Orders -> Payments: SYNC charge (Orders waits and fails if Payments is down)
Payments --> Orders: ok
Orders -> Queue: ASYNC publish order.placed
> Orders is done as soon as the message is stored. It does not care whether Email is up.
Queue -> Email service: deliver when Email is ready (maybe twice)
> The consumer must be idempotent because delivery is at least once.
```

**What happens, step by step:** the first call adds 50 and records `evt-1`. The queue redelivers the same event, but the ID is already in `processed`, so nothing changes: the balance stays 150. Without the check, a redelivery would pay twice.

**How to choose:** need the answer now to continue (login, price check)? → synchronous. Work can finish later (email, report, indexing) or must survive downstream outages? → asynchronous.

**Common mistake → fix:** recording the processed ID *before* doing the work, then crashing: the message is marked done but the effect never happened. Record the ID and apply the effect atomically (one database transaction, or a unique-constraint insert), so either both happen or neither.

**Interview answer:** "Synchronous calls are simple but couple availability and latency; asynchronous messaging decouples and absorbs spikes at the cost of eventual consistency and at-least-once delivery. Because duplicates happen, consumers must be idempotent: I dedupe on a message or operation ID stored atomically with the side effect. I choose sync when the caller needs the answer to proceed and async otherwise."

**Follow-ups:**
- *Exactly-once delivery?* Practically it's at-least-once delivery plus idempotent processing.

---

### Q31. Timeouts and retries: how do you call another service safely?

**Short answer:** Every remote call needs a **timeout**, because without one a stuck dependency holds your threads or connections forever. Retry only **transient** failures (timeouts, connection errors, HTTP 429 and 503), only for **idempotent** operations, with **exponential backoff plus jitter** (randomness) and a cap on attempts, so retries help a recovering service instead of swamping it.

**How it works:** if a service is overloaded and a thousand clients all retry immediately, the retries create more load and keep it down (a **retry storm**). Backoff spreads retries over time; jitter stops clients from retrying in lockstep; a retry budget stops retries multiplying across layers (3 layers × 3 attempts = 27 calls).

**Example:**
```python
import random, time

class Transient(Exception): pass

def call_with_retry(fn, attempts=4, base=0.1, cap=2.0, sleep=time.sleep):
    for attempt in range(1, attempts + 1):
        try:
            return fn()
        except Transient:
            if attempt == attempts:
                raise
            delay = random.uniform(0, min(cap, base * 2 ** (attempt - 1)))   # "full jitter"
            sleep(delay)

calls = {"n": 0}
def flaky():
    calls["n"] += 1
    if calls["n"] < 3:
        raise Transient("503")
    return "ok"

waits = []
print(call_with_retry(flaky, sleep=waits.append), calls["n"], len(waits))   # ok 3 2
```

```flow
trace: Retrying flaky() with exponential backoff and jitter
attempt 1 fails with Transient (503) > The error is transient and attempts remain, so wait a random time between 0 and 0.1 s.
attempt 2 fails with Transient > Wait a random time between 0 and 0.2 s: the upper bound doubles each round, capped at 2 s.
attempt 3 succeeds > Returns **"ok"** after 3 calls and 2 waits.
if attempt 4 had also failed > The error is re-raised to the caller, who can use a fallback or give up.
```

**What happens, step by step:** `waits` collects the two sleep durations instead of really sleeping, so the example runs instantly and prints `ok 3 2`. A non-transient error such as `ValueError` is not caught by the `except Transient`, so it fails immediately (retrying a bad request won't fix it).

**Common mistake → fix:** retrying non-idempotent operations (charging a card) without an idempotency key, which can double-charge when the first attempt actually succeeded but the reply was lost. Send an idempotency key so the server can recognise repeats (Q26), and retry at only one layer.

**Interview answer:** "Every remote call gets a timeout. I retry only transient errors on idempotent operations, with exponential backoff, jitter, a maximum number of attempts and respect for `Retry-After`, and I retry at one layer only to avoid multiplying load. For writes I pass an idempotency key so repeated requests are safe."

**Follow-ups:**
- *Total deadline?* Pass a deadline down so each layer knows how much time remains and doesn't retry past it.

---

### Q32. Circuit breaker and bulkhead

**Short answer:** A **circuit breaker** stops calling a dependency that is clearly failing, so you fail fast (or use a fallback) instead of piling up slow requests. It has three states: **closed** (calls flow, failures are counted), **open** (calls fail immediately), and **half-open** (after a cool-down, a few trial calls test recovery). A **bulkhead** isolates resources (separate thread pools or concurrency limits per dependency) so one slow dependency cannot use up every worker.

```flow
cycle: Circuit breaker states
CLOSED > Calls go through normally. Consecutive failures are counted.
OPEN > After too many failures, calls fail instantly without touching the dependency. A fallback or a clear error is returned.
HALF-OPEN > After a cool-down period, let a few trial calls through.
exit > If the trial calls succeed the breaker closes again; if they fail it re-opens and the cool-down restarts.
```

**Example:**
```python
import time

class CircuitOpenError(Exception): pass

class CircuitBreaker:
    def __init__(self, threshold=3, cooldown=30.0, clock=time.monotonic):
        self.threshold, self.cooldown, self.clock = threshold, cooldown, clock
        self.fails, self.opened_at = 0, None

    def call(self, fn):
        if self.opened_at is not None:
            if self.clock() - self.opened_at < self.cooldown:
                raise CircuitOpenError("failing fast")        # OPEN
            # cool-down over: HALF-OPEN, allow this one trial call
        try:
            result = fn()
        except Exception:
            self.fails += 1
            if self.fails >= self.threshold or self.opened_at is not None:
                self.opened_at = self.clock()                 # (re)open
            raise
        self.fails, self.opened_at = 0, None                  # success: CLOSED
        return result

now = [0.0]
cb = CircuitBreaker(threshold=2, cooldown=10, clock=lambda: now[0])
def down(): raise ConnectionError("dependency down")
def up():   return "ok"

for _ in range(2):
    try: cb.call(down)
    except ConnectionError: pass
try: cb.call(up)
except CircuitOpenError as e: print("t=0:", e)           # t=0: failing fast
now[0] = 11
print("t=11:", cb.call(up))                              # t=11: ok  (trial succeeds, closes)
```

**What happens, step by step:**
1. Two failures reach the threshold, so the breaker opens at `t=0`.
2. At `t=0` a call to a *healthy* function is still rejected with `failing fast`: the breaker doesn't try, protecting the struggling dependency and giving callers an instant answer.
3. At `t=11` the 10-second cool-down has passed, so one trial call is allowed. It succeeds, the failure count resets and the breaker closes (`ok`).
4. If the trial had failed, `opened_at` is set again and the cool-down restarts.

**Bulkhead example:** `asyncio.Semaphore(10)` around calls to the slow recommendation service means at most 10 requests can be stuck there; the other workers still serve the rest of the application.

**Common mistake → fix:** opening the breaker but returning a bare exception to users. Pair it with a **fallback**: cached data, a default, a degraded feature, or a clear "try again later". For systems built on external model providers, the fallback may be a cheaper backup model.

**Interview answer:** "A circuit breaker counts failures and, past a threshold, opens so calls fail instantly instead of queueing behind a sick dependency; after a cool-down it goes half-open and lets trial calls decide whether to close again. A bulkhead limits the resources any one dependency can consume. Together with timeouts and retries they stop a local failure from becoming a system-wide outage, and I always define the fallback behaviour."

**Follow-ups:**
- *Per what do you keep a breaker?* Per dependency (and sometimes per endpoint), so one bad endpoint doesn't block healthy ones.

---

### Q33. Saga pattern (distributed transactions)

**Short answer:** A **saga** completes a business transaction that spans several services by splitting it into a sequence of **local transactions**, each with a **compensating action** that undoes it if a later step fails. There is no global lock and no two-phase commit; instead, on failure you run the compensations for the completed steps in reverse order. Compensations must be **idempotent**.

```flow
sequence: A saga for booking a trip, with a failure
actors: Saga, Flights, Hotels, Payments
Saga -> Flights: reserve flight
Flights --> Saga: ok
Saga -> Hotels: reserve hotel
Hotels --> Saga: ok
Saga -> Payments: charge card
Payments --> Saga: failed
> No global transaction exists, so the saga must undo what already succeeded, in reverse order.
Saga -> Hotels: cancel hotel (compensation)
Saga -> Flights: cancel flight (compensation)
```

**Example:**
```python
def run_saga(steps):
    done = []
    for name, action, compensate in steps:
        try:
            action()
            done.append((name, compensate))
        except Exception as e:
            print(f"{name} failed: {e}")
            for done_name, comp in reversed(done):        # undo in reverse order
                comp()
                print(f"compensated {done_name}")
            return "rolled back"
    return "completed"

def reserve_flight(): print("flight reserved")
def cancel_flight():  pass
def reserve_hotel():  print("hotel reserved")
def cancel_hotel():   pass
def charge_card():    raise RuntimeError("card declined")
def refund():         pass

print(run_saga([("flight", reserve_flight, cancel_flight),
                ("hotel", reserve_hotel, cancel_hotel),
                ("payment", charge_card, refund)]))
```

**What happens, step by step:** output order: `flight reserved`, `hotel reserved`, `payment failed: card declined`, `compensated hotel`, `compensated flight`, then `rolled back`. The payment step failed, so only the two completed steps are compensated, newest first. The payment itself needs no compensation because it never completed.

| Style | How | Trade-off |
|---|---|---|
| Orchestration | a coordinator (workflow engine) calls each step and compensation | clear flow and one place to see state; the coordinator is a dependency |
| Choreography | each service reacts to events and emits the next one | loose coupling; the overall flow is hard to see and debug |

**Common mistake → fix:** assuming compensation perfectly reverses a step. An email can't be unsent and a shipped parcel can't be un-shipped. Order steps so the irreversible or hardest-to-undo ones come last, and make compensations idempotent and retryable, since the compensation itself may fail or be repeated.

**Interview answer:** "A saga replaces a distributed transaction with a sequence of local transactions, each paired with a compensating action. If a step fails, I run the compensations of the completed steps in reverse. It can be orchestrated by a coordinator, which is easier to follow, or choreographed through events, which is more decoupled. Compensations must be idempotent, and irreversible steps should come last."

**Follow-ups:**
- *Why not two-phase commit?* It holds locks across services and blocks if the coordinator fails, so it scales and survives poorly across independent services.

---

### Q34. Transactional outbox

**Short answer:** The **dual-write problem**: a service must update its database *and* publish an event, but these are two systems, so one can succeed while the other fails (the database is updated but the event is lost, or the reverse). The **transactional outbox** fixes it: write the event into an **outbox table in the same database transaction** as the business change, and have a separate **relay** read the outbox and publish the events, marking them sent. Delivery is at least once, so consumers must be idempotent.

```flow
sequence: Transactional outbox
actors: Order service, Database, Relay, Message broker, Consumer
Order service -> Database: BEGIN; UPDATE orders to PAID; INSERT outbox row; COMMIT
> Both changes commit together or neither does. There is no window where the order is paid but the event is lost.
Relay -> Database: poll for unsent outbox rows
Relay -> Message broker: publish order.paid
Relay -> Database: mark the row as sent
Message broker -> Consumer: deliver (at least once)
Consumer -> Consumer: dedupe by event id, then process
> If the relay crashes after publishing but before marking sent, the event is published again, which the consumer's dedupe handles.
```

**Example (runnable with SQLite):**
```python
import sqlite3, json, uuid

db = sqlite3.connect(":memory:")
db.executescript("""
CREATE TABLE orders(id TEXT PRIMARY KEY, status TEXT);
CREATE TABLE outbox(id TEXT PRIMARY KEY, type TEXT, payload TEXT, sent INTEGER DEFAULT 0);
INSERT INTO orders VALUES ('o1', 'NEW');
""")

def mark_paid(order_id):
    with db:                                              # one transaction
        db.execute("UPDATE orders SET status='PAID' WHERE id=?", (order_id,))
        db.execute("INSERT INTO outbox(id, type, payload) VALUES (?,?,?)",
                   (str(uuid.uuid4()), "order.paid", json.dumps({"order_id": order_id})))

published = []
def relay_once():
    rows = db.execute("SELECT id, type, payload FROM outbox WHERE sent=0").fetchall()
    for id_, type_, payload in rows:
        published.append((type_, payload))                # stands in for broker.publish(...)
        with db:
            db.execute("UPDATE outbox SET sent=1 WHERE id=?", (id_,))

mark_paid("o1")
relay_once(); relay_once()                                # second run finds nothing new
print(db.execute("SELECT status FROM orders").fetchone(), published)
# ('PAID',) [('order.paid', '{"order_id": "o1"}')]
```

**What happens, step by step:**
1. `mark_paid` updates the order and inserts the outbox row inside one transaction: both are saved or neither.
2. `relay_once` finds the unsent row, "publishes" it, then marks it sent.
3. Running the relay again finds no unsent rows, so nothing is published twice in this run. If the process crashed between publish and mark, the next run would publish again, which is why consumers dedupe by the event `id`.

**Common mistake → fix:** publishing to the broker inside the request handler right after the database commit ("commit, then publish"). If the process dies between the two, the event is lost forever and other services never learn of the change. Use the outbox, or change-data-capture (CDC) from the database log, and monitor outbox lag (age of the oldest unsent row).

**Interview answer:** "The outbox solves the dual write: I insert the event into an outbox table in the same transaction as the state change, and a relay publishes unsent rows and marks them sent, either by polling or via CDC. That gives at-least-once delivery without losing events, so consumers must be idempotent. I monitor how old the oldest unsent row is."

**Follow-ups:**
- *Inbox pattern?* The mirror image on the consumer side: store processed message IDs in the same transaction as the side effect.

---

### Q35. CQRS (Command Query Responsibility Segregation)

**Short answer:** **CQRS** uses **separate models for writing (commands) and reading (queries)**. The write side keeps validated, normalised data and enforces the rules; one or more **read models** are shaped for fast queries (denormalised, searchable) and are updated from events. Use it when reads and writes have very different shapes or load (dashboards, search). The cost is eventual consistency between the sides and more parts, so don't use it for simple CRUD.

```flow
sequence: CQRS with a write model and a read model
actors: Client, Write model, Projector, Read model
Client -> Write model: command: PlaceOrder
> Validated and stored in the normalised write store.
Write model -> Projector: event: OrderPlaced
Projector -> Read model: update the denormalised summary row
Client -> Read model: query: customer order summary
Read model --> Client: fast answer, possibly a moment behind the writes
> Eventually consistent: a read right after a write may not show it yet.
```

**Example:**
```python
orders = {}                         # write model: normalised, validated
summary = {}                        # read model: one ready-made row per customer
events = []

def place_order(order_id, customer, amount_cents):          # command
    if amount_cents <= 0:
        raise ValueError("amount must be positive")
    orders[order_id] = {"customer": customer, "amount": amount_cents}
    events.append(("OrderPlaced", customer, amount_cents))

def project():                                              # runs after commands (async in real systems)
    while events:
        _, customer, amount = events.pop(0)
        row = summary.setdefault(customer, {"orders": 0, "total": 0})
        row["orders"] += 1
        row["total"] += amount

def customer_summary(customer):                             # query: no joins, no computation
    return summary.get(customer, {"orders": 0, "total": 0})

place_order("o1", "asha", 2000)
place_order("o2", "asha", 500)
print(customer_summary("asha"))      # {'orders': 0, 'total': 0}   <- read model is behind
project()
print(customer_summary("asha"))      # {'orders': 2, 'total': 2500}
```

**What happens, step by step:** the two commands write to `orders` and queue two events. The first query returns zeros because the projector hasn't run yet: this is the **eventual consistency** window. After `project()` consumes the events, the summary shows 2 orders totalling 2,500. Queries never join or aggregate; the read model is already shaped as the screen needs.

**Common mistake → fix:** adopting CQRS for a basic CRUD admin screen, or forgetting that users may see stale data right after writing. If the UI needs read-your-writes, return the new state from the command response, or read from the write side for that one request.

**Interview answer:** "CQRS separates the model that handles commands from the models that serve queries. The write side enforces rules on normalised data and emits events; read models are denormalised projections kept up to date from those events. It suits very different read and write shapes or scale, at the price of eventual consistency and extra moving parts, so I wouldn't use it for plain CRUD."

**Follow-ups:**
- *Does CQRS require event sourcing?* No; they combine well (Q36) but each works alone.

---

### Q36. Event sourcing

**Short answer:** **Event sourcing** stores the **sequence of events** that happened (`OrderPlaced`, `ItemAdded`, `OrderPaid`) as the source of truth, and derives the current state by **replaying** them. Nothing is updated or deleted in place. You gain a complete audit trail, the ability to rebuild state at any past moment, and new read models from old events. Costs: event schema versioning, replay time (reduced with snapshots) and harder ad hoc queries (usually solved by pairing with CQRS read models).

**Example:**
```python
from dataclasses import dataclass

@dataclass(frozen=True)
class Event:
    kind: str
    data: dict

def apply(state: dict, event: Event) -> dict:
    if event.kind == "OrderPlaced":
        return {"status": "placed", "items": [], "paid": 0}
    if event.kind == "ItemAdded":
        return {**state, "items": state["items"] + [event.data["item"]]}
    if event.kind == "OrderPaid":
        return {**state, "status": "paid", "paid": event.data["cents"]}
    return state

def replay(events):
    state = {}
    for e in events:
        state = apply(state, e)
    return state

log = [Event("OrderPlaced", {}), Event("ItemAdded", {"item": "pen"}),
       Event("ItemAdded", {"item": "ink"}), Event("OrderPaid", {"cents": 2000})]
print(replay(log))                    # {'status': 'paid', 'items': ['pen', 'ink'], 'paid': 2000}
print(replay(log[:3]))                # state as it was before payment
```

```flow
trace: Rebuilding state by replaying events
OrderPlaced > state = status placed, items [], paid 0.
ItemAdded(pen) > state = status placed, items **[pen]**.
ItemAdded(ink) > state = status placed, items **[pen, ink]**.
OrderPaid(2000) > state = status **paid**, items [pen, ink], paid **2000**. This is the current state, derived from the log.
replay only the first three events > Gives the state before payment: time travel for free.
```

**What happens, step by step:** `replay` folds the events through `apply`, each returning a new state. Replaying all four gives the paid order. Replaying `log[:3]` shows exactly what the order looked like before payment, which is how you debug "how did we get here?" or build a new report from old history.

**Common mistake → fix:** treating events as mutable or changing their format casually. Events are facts about the past: never edit them. When the schema must change, version events (`OrderPlacedV2`) and upcast old ones on read. Use **snapshots** (saved state every N events) so replay stays fast.

**Interview answer:** "With event sourcing the append-only event log is the source of truth, and current state is the result of replaying it. It gives a full audit trail, time travel and the ability to build new read models later. The trade-offs are event versioning, replay cost (mitigated with snapshots) and awkward queries, which is why it's usually paired with CQRS projections and used only where history really matters."

**Follow-ups:**
- *Where do you see something similar?* Database write-ahead logs, Git commits, and ledgers in accounting.

---

### Q37. Strangler fig, sidecar and anti-corruption layer

**Short answer:** Three structural patterns for evolving systems. **Strangler fig**: migrate a legacy system piece by piece by putting a router in front of it, sending one capability at a time to a new implementation, until the old system can be removed. **Sidecar**: a helper process or container deployed beside the main application and sharing its lifecycle (log shipper, proxy, metrics collector). **Anti-corruption layer (ACL)**: a translation layer that stops a messy legacy or vendor model from leaking into your clean model.

```flow
pipeline: Strangler fig migration step by step
Put a router in front of the legacy system > All traffic still reaches the old system, so nothing changes for users.
Build one capability in the new service > For example "invoice PDF generation".
Route that path to the new service > Gradually (a percentage of traffic), with metrics to compare behaviour.
Repeat capability by capability > The legacy system handles less and less.
Remove the legacy system > When no routes point to it. An anti-corruption layer translates between old and new models until then.
```

**Example (the router and the ACL):**
```python
LEGACY_ROUTES_MOVED = {"/invoices/pdf"}            # capabilities already migrated

def route(path: str) -> str:
    return "new-service" if path in LEGACY_ROUTES_MOVED else "legacy"

def legacy_to_domain(row: dict) -> dict:           # anti-corruption layer
    return {
        "customer_id": row["CUST_NO"].strip(),
        "active": row["STAT_CD"] == "A",
        "balance_cents": int(round(float(row["BAL_AMT"]) * 100)),
    }

print(route("/invoices/pdf"), route("/orders"))    # new-service legacy
print(legacy_to_domain({"CUST_NO": " 0042 ", "STAT_CD": "A", "BAL_AMT": "12.50"}))
# {'customer_id': '0042', 'active': True, 'balance_cents': 1250}
```

**What happens, step by step:** the router sends the migrated path to the new service and everything else to the legacy one; moving the next capability is adding one entry. The ACL converts cryptic legacy column names and types (`STAT_CD == "A"`, `"12.50"` as text) into the clean model (`active=True`, `balance_cents=1250`), so the legacy vocabulary never reaches your new code.

**Common mistake → fix:** a "big-bang rewrite" that replaces everything at once, which delivers no value until the end and often fails. Strangle incrementally. Also: sidecars add resource use and another failure point per instance, so use them for generic concerns, not business logic.

**Interview answer:** "Strangler fig migrates a legacy system gradually: a router sends one capability at a time to the new implementation until the old one can be retired. A sidecar is a helper container beside the app for generic concerns like proxying, logging or metrics. An anti-corruption layer translates between a legacy or vendor model and my clean one so its concepts don't leak into my code."

**Follow-ups:**
- *How do you verify the new path is equivalent?* Run both and compare results ("shadow traffic") before switching.

---

### Q38. The Twelve-Factor App

**Short answer:** The **Twelve-Factor App** is a checklist for building services that deploy and scale cleanly in containers and the cloud. The headline ideas: keep **config in the environment** (not in code), run **stateless processes** (state lives in databases or object storage), make processes **disposable** (fast start, graceful shutdown), treat **logs as event streams** written to stdout, and keep dev and production as similar as possible.

| # | Factor | In practice |
|---|---|---|
| 1 | Codebase | one repo per app, many deploys |
| 2 | Dependencies | declared explicitly and isolated (lockfile, virtual environment, image) |
| 3 | Config | in environment variables, not in code |
| 4 | Backing services | databases, queues and caches are attached resources swapped by changing config |
| 5 | Build, release, run | strictly separated stages; releases are immutable |
| 6 | Processes | stateless and share-nothing; state goes to a backing service |
| 7 | Port binding | the app serves itself on a port |
| 8 | Concurrency | scale out by running more processes |
| 9 | Disposability | fast startup and graceful shutdown on SIGTERM |
| 10 | Dev/prod parity | keep environments as similar as possible |
| 11 | Logs | write to stdout as a stream; the platform collects it |
| 12 | Admin processes | one-off tasks (migrations) run as separate short-lived processes |

**Example (config from the environment, graceful shutdown):**
```python
import os, signal

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///local.db")   # factor 3
running = True

def on_sigterm(signum, frame):                    # factor 9: stop taking work, finish, exit
    global running
    running = False

signal.signal(signal.SIGTERM, on_sigterm)
print("using", DATABASE_URL)
```

**What happens, step by step:** the same container image runs in every environment because only the `DATABASE_URL` variable differs (factors 3 and 10). When the orchestrator wants to stop the instance, it sends `SIGTERM`; the handler flips `running` so the main loop finishes in-flight work and exits cleanly instead of being killed mid-request (factor 9).

**Common mistake → fix:** storing session data or uploaded files on the container's local disk. The next instance (or a restarted one) doesn't have them. Keep state in a database, cache or object store so any instance can serve any request.

**Interview answer:** "The twelve-factor methodology makes services easy to deploy and scale: configuration in environment variables, stateless disposable processes with graceful shutdown, dependencies declared explicitly, backing services as swappable resources, logs to stdout, and dev and prod kept alike. It's the baseline for containerised services."

**Follow-ups:**
- *Why does stateless matter?* So a load balancer can send any request to any instance and an instance can be killed and replaced at any time.

---

## 6. Scenario & design-review questions

### Q39. Refactor a 2,000-line `service.py` that does everything

**Short answer:** Don't rewrite it. First **lock in current behaviour with tests**, then extract one responsibility at a time behind a small interface, one pull request per extraction, with behaviour unchanged each time.

**Steps:**
1. **Add characterisation tests**: tests that record what the code does today, even if it's ugly. Check: they pass before you touch anything. Result: a safety net that tells you immediately if a refactor changes behaviour.
2. **Map the responsibilities** by reading and grouping functions: HTTP handling, authentication, prompt or rule building, calls to external providers, persistence, notifications. Result: the list of reasons this file changes (Q07).
3. **Pick the easiest, most independent responsibility** (usually a pure calculation or a notification sender) and extract it to its own module or class. Check: tests still pass; the diff only moves code.
4. **Put a small Protocol in front of each external dependency** (provider client, repository, notifier) and pass it in through the constructor (Q11, Q12). Result: tests can use fakes instead of real systems.
5. **Replace `if kind == ...` chains with a registry or strategy** (Q8, Q17).
6. **Repeat**, one extraction per pull request. Stop when each module has one reason to change; don't chase perfection.

**Example (one step):**
```python
# before: inside the 2,000-line file
def process(job):
    ...
    if job["kind"] == "invoice": total = sum(job["lines"]) * 1.18
    elif job["kind"] == "refund": total = -sum(job["lines"])
    ...

# after step 3 and 5: extracted, with the behaviour pinned by a test
HANDLERS = {
    "invoice": lambda lines: sum(lines) * 1.18,
    "refund":  lambda lines: -sum(lines),
}
def compute_total(kind: str, lines: list[float]) -> float:
    return HANDLERS[kind](lines)

assert compute_total("invoice", [100]) == 118.0
assert compute_total("refund", [100]) == -100
```

**What happens, step by step:** the characterisation test captured the old outputs (118.0 for an invoice of 100 and −100 for a refund). The extracted `compute_total` reproduces them, so the pull request can be merged with confidence. The next pull request moves persistence out.

**Common mistake → fix:** a big-bang rewrite in a branch for three months, or refactoring and changing behaviour in the same pull request, so reviewers can't tell regressions from intentional changes. Keep refactors behaviour-preserving and small.

**Interview answer:** "I'd start with characterisation tests to pin current behaviour, then identify the responsibilities and extract them incrementally behind small interfaces, injecting dependencies so tests use fakes. Conditional chains become registries. Each step is a small pull request with unchanged behaviour. The aim is that each module has one reason to change, not a perfect architecture."

**Follow-ups:**
- *How do you sequence the extractions?* Start with the least entangled and most pain-causing; leave the core flow for last.

---

### Q40. "Should we split our application into microservices?"

**Short answer:** Ask what problem it would solve before deciding. If the pain is code that's tangled, fix module boundaries first (a modular monolith). Split a service only for a concrete reason, and split the one part with the clearest boundary.

**Steps:**
1. **Name the pain.** Are parts scaling differently (CPU-heavy workers vs I/O-heavy API)? Are teams blocked by one release train? Is there a security or compliance boundary? Result: a specific, measurable reason, or the realisation that there isn't one.
2. **Try to fix it inside the monolith.** Enforce module boundaries, give modules their own tables, add a queue for background work. Check: does the pain go away? Often it does.
3. **If not, pick one candidate** with a clear boundary and its own data (for example, document-processing workers behind a queue).
4. **Define the contract** (API or event schema) and add contract tests, so both sides can change independently.
5. **Accept the new costs:** network failure handling (timeouts, retries, breakers), observability across services, distributed data consistency (outbox, saga), deployment pipelines.
6. **Measure whether it helped** (deploy frequency, incident count, cost) before extracting a second service.

| Reason to split | Keep as one deployable if |
|---|---|
| Very different scaling profile | load is similar everywhere |
| Independent release cadence for a team | one team owns everything |
| Isolation of a risky or sensitive component | no such requirement |
| Different technology needs | one stack is fine |

**What happens, step by step:** suppose report generation is CPU-heavy and starves the API. Step 3 moves it to a worker process that reads jobs from a queue and writes results to its own storage; the API only enqueues and polls status. Autoscaling now treats the two differently, and a report crash no longer takes down the API. The rest of the application stays a monolith.

**Common mistake → fix:** splitting by technical layer ("a database service", "a validation service") or by org-chart fashion. Split by business capability and data ownership, otherwise every feature needs changes in several services.

**Interview answer:** "I'd ask what problem splitting solves. If it's tangled code, I'd modularise first. A real reason, such as a different scaling profile, release cadence, security boundary or team ownership, justifies extracting one service with the clearest boundary, its own data and contract tests. I'd weigh the new costs in network failures, observability and consistency, and measure the benefit before splitting further."

**Follow-ups:**
- *What's a distributed monolith?* Services that must be deployed together or share a database: all the cost, none of the benefit.

---

### Q41. Add a new provider (payment, email or model API) without touching business logic

**Short answer:** Put an interface in front of the provider (DIP), write one adapter per provider (Adapter), choose the adapter from configuration (Factory), wrap it with timeouts, retries and a circuit breaker (Decorator/composition), and verify the new provider with a test suite or shadow traffic before moving real traffic.

**Steps:**
1. **Define the port**: a small Protocol that names only what the business needs (`charge(customer_id, cents) -> str`). Result: business code depends on this, not an SDK.
2. **Write the adapter** for the new provider: translate arguments, responses and errors into the port's types (Q19).
3. **Register it in the factory** by name (Q15) and select it via configuration.
4. **Wrap it** with the same resilience layers as the others (timeout, retry on transient errors, breaker, optional fallback to the old provider) (Q4, Q31, Q32).
5. **Test**: run the contract tests that every adapter must pass, then send a small percentage of traffic through it (canary) or mirror requests ("shadow") and compare results.
6. **Switch gradually** via configuration and keep the old adapter for fast rollback.

**Example:**
```python
from typing import Protocol

class PaymentGateway(Protocol):
    def charge(self, customer_id: str, cents: int) -> str: ...

class OldProvider:
    def charge(self, customer_id, cents): return f"old-{customer_id}-{cents}"

class NewProvider:
    def charge(self, customer_id, cents):
        # translate to the vendor's format, call it, translate the reply back
        return f"new-{customer_id}-{cents}"

GATEWAYS = {"old": OldProvider, "new": NewProvider}

def make_gateway(name: str) -> PaymentGateway:
    return GATEWAYS[name]()

def contract_test(gateway: PaymentGateway) -> None:          # every adapter must pass this
    ref = gateway.charge("c1", 100)
    assert isinstance(ref, str) and ref

for name in GATEWAYS:
    contract_test(make_gateway(name))
print(make_gateway("new").charge("c9", 2500))                # new-c9-2500
```

**What happens, step by step:** the shared `contract_test` runs against both adapters, so a new provider can't join without meeting the same expectations. The business code calls `make_gateway(settings.payment_provider)`; flipping the setting from `"old"` to `"new"` changes the provider with no edits to business logic.

**Common mistake → fix:** letting the new provider's response types and error codes leak into business code, so switching again is as hard as the first time. Translate them to your own types at the adapter. Also, don't cut over all traffic at once.

**Interview answer:** "I define a Protocol for what the business needs, write an adapter for the new provider that translates types and errors, select it from config through a factory, wrap it with timeout, retry and circuit-breaker layers, and prove it with shared contract tests and a canary or shadow rollout before switching traffic, keeping the old adapter for rollback."

**Follow-ups:**
- *What if the providers differ in capabilities?* Expose only the common subset in the port, and add optional capabilities as separate small interfaces (ISP).

---

### Q42. Two services must stay consistent: an order's status in the database and a notification event

**Short answer:** This is the dual-write problem (Q34). Use the **transactional outbox**: write the status change and the event row in one transaction; a relay publishes the event; consumers are **idempotent**; you monitor outbox lag and run a reconciliation job to catch any drift.

**Steps:**
1. **Identify the two writes** that must agree: the status update in the database and the event to the broker. Check: could one succeed and the other fail? Yes, so a plain "commit, then publish" is unsafe.
2. **Add an outbox table** and insert the event in the same transaction as the status change. Result: either both exist or neither.
3. **Run a relay** (poller or change-data-capture) that publishes unsent rows with retries and marks them sent. Result: no lost events; possible duplicates.
4. **Make consumers idempotent** by deduplicating on the event ID (Q30). Result: duplicates are harmless.
5. **Monitor and reconcile**: alert when the oldest unsent outbox row is older than a threshold; run a periodic job comparing database state to what consumers have, and repairing differences. Result: drift is detected instead of silently growing.

```flow
pipeline: Keeping order status and notifications consistent
Status change and outbox row in one transaction > The database guarantees both are saved or neither.
Relay publishes unsent rows > Retries on failure and marks rows sent after the broker accepts them.
Consumers dedupe by event id > Redelivery is expected and harmless.
Monitor outbox lag and reconcile > Alert if the oldest unsent row is too old; a scheduled job compares and repairs drift.
```

**What happens, step by step:** the order moves to `PAID` and the row `order.paid` is stored with it. If the broker is down for ten minutes, the status is still correct, the outbox rows accumulate, the lag alert fires, and when the broker returns the relay publishes everything in order. The notification service dedupes by ID in case the relay re-sent an event.

**Common mistake → fix:** relying on "publish after commit" and hoping failures are rare. A crash between the two steps loses the event without any error. Make the guarantee structural, not statistical.

**Interview answer:** "It's the dual-write problem, so I'd use a transactional outbox: the status change and the event row commit together, a relay publishes with retries, and consumers dedupe by event ID since delivery is at least once. I'd alert on outbox lag and run a reconciliation job as a safety net."

**Follow-ups:**
- *When is eventual consistency unacceptable?* When the user must see an immediate, guaranteed result (for example, a payment authorisation), keep that step synchronous and transactional in one service.

---

### Q43. How do you avoid over-engineering in a design review?

**Short answer:** Tie every abstraction to a **current requirement** or a **likely, cheap-to-support change**. A pattern is justified by the change it makes easy, so name that change. Count the moving parts, prefer boring and managed building blocks, and ask "what is the simplest version we could ship and measure?".

**Steps (questions to ask of any design):**
1. **Which requirement needs this layer/abstraction/service?** If you can't name one, it's speculative (YAGNI, Q5).
2. **How likely is the change it protects against, and how cheap is it to support later?** If the change is unlikely or easy to make later, drop it.
3. **How many moving parts does it add?** Each new service, queue or interface adds deployment, monitoring, failure modes and onboarding cost.
4. **Is there a boring alternative?** A function instead of a class hierarchy; a database table instead of a new message system; a library instead of a service.
5. **Can we ship the simple version and measure?** Put in the seam (an interface, a boundary) that makes the extension possible, but don't build the extension yet.

| Smell in a design | Simpler question to ask |
|---|---|
| An interface with exactly one implementation and no test need | do we need it yet? |
| A new microservice for a small feature | would a module do? |
| An event bus for two components | would a function call do? |
| "In case we need to swap the database" | is a swap realistic? Is the cost of swapping later acceptable? |

**Example:**
```python
# Over-engineered for a rule that has one variant and no history of change
from abc import ABC
class DiscountStrategy(ABC): ...
class NoDiscountStrategy(DiscountStrategy): ...
class DiscountStrategyFactory: ...

# Enough, until a second rule actually exists
def discount(total: float) -> float:
    return total * 0.9 if total > 1000 else total
```

**What happens, step by step:** the simple function is five lines and easy to test. When a second discount type genuinely appears, the function can be turned into a Strategy or a registry in a few minutes, with the existing test as a safety net. The upfront framework would have cost more and might have guessed the wrong shape.

**Common mistake → fix:** the opposite error, calling every abstraction over-engineering and letting a 2,000-line function grow. The test is not "fewer classes" but "does each piece of structure pay for itself with a change it makes cheap?".

**Interview answer:** "I justify each abstraction by the change it makes cheap and the requirement that needs it today. I count moving parts, prefer boring tools, and ask what the simplest shippable version is. I leave a clean seam for likely extensions but don't build them until they're needed, and I'd rather refactor into a pattern when a second use appears than guess early."

**Follow-ups:**
- *How do you push back respectfully?* Ask the "which requirement?" and "what change does this make cheap?" questions, and offer a simpler alternative with a clear trigger for upgrading.

---

## 7. Cheat sheet

| Concept | One-liner |
|---|---|
| Coupling / cohesion | depend on little; each module does one thing |
| Composition over inheritance | combine small parts; inherit only for true is-a |
| DRY / KISS / YAGNI | one home per fact; simplest thing; don't build for imagined needs |
| SRP | one reason to change |
| OCP | extend by adding code (registry), not editing if/elif |
| LSP | subclasses keep the parent's contract |
| ISP | small, focused interfaces |
| DIP and DI | logic depends on abstractions; inject implementations |
| Singleton | in Python a module object or cached factory; inject it |
| Factory | choose the concrete class from config |
| Builder | step-by-step construction, validate in build() |
| Strategy | swap algorithms (often just functions) |
| Observer | publish events to subscribers |
| Adapter / Facade | convert an interface / simplify a subsystem |
| Decorator | wrap with the same interface to add behaviour |
| Repository / Unit of Work | hide the database; one transaction per use case |
| Command / Chain | requests as objects; middleware chains |
| Template Method | fixed skeleton, subclass fills steps |
| Microservice | independent deployable that owns its data; pay the network tax |
| Modular monolith | one deployable with enforced module boundaries; the default start |
| Bounded context | a model and vocabulary per business area |
| Idempotent consumer | dedupe by message id, atomically with the effect |
| Retry | transient only, backoff + jitter, idempotent operations |
| Circuit breaker | fail fast when a dependency is down; keep a fallback |
| Saga | local transactions plus compensations |
| Outbox | event row in the same transaction; relay publishes |
| CQRS | separate write and read models |
| Event sourcing | the event log is the source of truth |
| Strangler fig | migrate capability by capability behind a router |
| Twelve-factor | config in env, stateless, disposable, logs to stdout |

## Official references

- Refactoring Guru (patterns with examples): https://refactoring.guru/design-patterns
- Martin Fowler on microservices, CQRS, event sourcing and the strangler fig: https://martinfowler.com/microservices/
- microservices.io pattern catalogue (saga, outbox, API gateway): https://microservices.io/patterns/
- The Twelve-Factor App: https://12factor.net/
- Python `abc` and `typing.Protocol`: https://docs.python.org/3/library/abc.html · https://docs.python.org/3/library/typing.html
- AWS Prescriptive Guidance, cloud design patterns: https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/introduction.html
