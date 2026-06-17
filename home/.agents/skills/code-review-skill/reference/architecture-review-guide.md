# Architecture Review Guide

Architecture review guide for evaluating whether code structure and design choices are appropriate, maintainable, and aligned with the system's boundaries.

## SOLID Principles Checklist

### S - Single Responsibility Principle (SRP)

**Checkpoints:**
- Does this class/module have only one reason to change?
- Do all methods serve the same purpose?
- Can you describe the class to a non-technical person in one sentence?

**Signals in code review:**
```text
⚠️ Class names contain generic words such as "And", "Manager", "Handler", or "Processor"
⚠️ A class exceeds 200-300 lines
⚠️ A class has more than 5-7 public methods
⚠️ Different methods operate on completely different data
```

**Review questions:**
- "What responsibilities does this class have? Can it be split?"
- "If requirement X changes, which methods change? What about requirement Y?"

### O - Open/Closed Principle (OCP)

**Checkpoints:**
- Does adding new behavior require modifying existing code?
- Can behavior be added by extension or composition?
- Are long if/else or switch chains used to handle different types?

**Signals in code review:**
```text
⚠️ switch/if-else chains handle different types
⚠️ Adding a new feature requires changing core classes
⚠️ Type checks (instanceof, typeof) are scattered through the code
```

**Review questions:**
- "If we add a new X type, which files need to change?"
- "Will this switch statement keep growing as new types are added?"

### L - Liskov Substitution Principle (LSP)

**Checkpoints:**
- Can subclasses fully replace the base class?
- Does a subclass change the expected behavior of a base method?
- Does a subclass throw exceptions the base class contract does not allow?

**Signals in code review:**
```text
⚠️ Explicit casting
⚠️ Subclass methods throw NotImplementedException
⚠️ Subclass methods are empty or only return
⚠️ Call sites using the base type need to inspect concrete types
```

**Review questions:**
- "If the subclass replaces the base class, does caller code need to change?"
- "Does this subclass behavior satisfy the base class contract?"

### I - Interface Segregation Principle (ISP)

**Checkpoints:**
- Is the interface small and focused?
- Are implementers forced to implement methods they do not need?
- Do clients depend on methods they never use?

**Signals in code review:**
```text
⚠️ Interface has more than 5-7 methods
⚠️ Implementations contain empty methods or throw NotImplementedException
⚠️ Interface names are too broad (IManager, IService)
⚠️ Different clients use only fragments of the interface
```

**Review questions:**
- "Are all methods in this interface used by every implementation?"
- "Can this large interface be split into smaller role-specific interfaces?"

### D - Dependency Inversion Principle (DIP)

**Checkpoints:**
- Do high-level modules depend on abstractions rather than concrete implementations?
- Is dependency injection used instead of directly constructing dependencies?
- Are abstractions defined by the high-level policy rather than the low-level implementation?

**Signals in code review:**
```text
⚠️ High-level modules directly instantiate low-level concrete classes
⚠️ Code imports concrete implementations instead of interfaces/abstractions
⚠️ Configuration and connection strings are hardcoded in business logic
⚠️ Unit tests are difficult to write for a class
```

**Review questions:**
- "Can this class's dependencies be replaced by mocks in tests?"
- "If we change the database/API implementation, how many places change?"

---

## Architecture Anti-Patterns

### Severe Anti-Patterns

| Anti-pattern | Signals | Impact |
|--------------|---------|--------|
| **Big Ball of Mud** | No clear module boundaries; anything can call anything | Hard to understand, modify, and test |
| **God Object** | One class has too many responsibilities, knows too much, does too much | High coupling; hard to reuse and test |
| **Spaghetti Code** | Confusing control flow, goto-like jumps, deep nesting | Hard to understand and maintain |
| **Lava Flow** | Old code nobody dares to touch; little documentation or testing | Accumulating technical debt |

### Design Anti-Patterns

| Anti-pattern | Signals | Recommendation |
|--------------|---------|----------------|
| **Golden Hammer** | Same technology/pattern used for every problem | Choose a solution that fits the problem |
| **Overengineering / Gas Factory** | Complex solution for a simple problem; excessive design patterns | Prefer YAGNI; start simple |
| **Boat Anchor** | Unused code written for possible future needs | Delete unused code; write it when needed |
| **Copy-Paste Programming** | Same logic appears in multiple places | Extract a shared method/module |

### Review comments

```markdown
🔴 [blocking] "This class has 2000 lines; split it into focused classes."
🟡 [important] "This logic is repeated in 3 places. Consider extracting a shared method."
💡 [suggestion] "This switch could become a Strategy for easier extension."
```

---

## Coupling and Cohesion Assessment

### Coupling Types (Best to Worst)

| Type | Description | Example |
|------|-------------|---------|
| **Message coupling** ✅ | Data passed through parameters | `calculate(price, quantity)` |
| **Data coupling** ✅ | Simple shared data structures | `processOrder(orderDTO)` |
| **Stamp coupling** ⚠️ | Complex structure shared but only partly used | Passing a whole User object just to read name |
| **Control coupling** ⚠️ | Flags change behavior | `process(data, isAdmin=true)` |
| **Common coupling** ❌ | Shared global variables | Multiple modules read/write the same global state |
| **Content coupling** ❌ | Directly accessing another module's internals | Mutating another class's private fields |

### Cohesion Types (Best to Worst)

| Type | Description | Quality |
|------|-------------|---------|
| **Functional cohesion** | All elements complete one task | ✅ Best |
| **Sequential cohesion** | Output of one step feeds the next | ✅ Good |
| **Communicational cohesion** | Operations use the same data | ⚠️ Acceptable |
| **Temporal cohesion** | Tasks happen at the same time | ⚠️ Weak |
| **Logical cohesion** | Logically related but functionally different | ❌ Poor |
| **Coincidental cohesion** | No clear relationship | ❌ Worst |

### Metric References

```yaml
Coupling metrics:
  CBO (Coupling Between Objects):
    good: < 5
    warning: 5-10
    danger: > 10

  Ce (Efferent Coupling):
    description: how many external classes are depended on
    good: < 7

  Ca (Afferent Coupling):
    description: how many classes depend on this class
    high value means: changes have broad impact; stability matters

Cohesion metrics:
  LCOM4 (Lack of Cohesion of Methods):
    1: single responsibility ✅
    2-3: may need splitting ⚠️
    >3: should be split ❌
```

### Review Questions

- "How many other modules does this module depend on? Can that be reduced?"
- "How many places are affected if this class changes?"
- "Do all methods in this class operate on the same data?"

---

## Layered Architecture Review

### Clean Architecture Layer Check

```text
┌─────────────────────────────────────┐
│         Frameworks & Drivers        │ ← outermost: Web, DB, UI
├─────────────────────────────────────┤
│         Interface Adapters          │ ← Controllers, Gateways, Presenters
├─────────────────────────────────────┤
│          Application Layer          │ ← Use Cases, Application Services
├─────────────────────────────────────┤
│            Domain Layer             │ ← Entities, Domain Services
└─────────────────────────────────────┘
          ↑ dependencies point inward only ↑
```

### Dependency Rule Check

**Core rule: source-code dependencies must point inward.**

```typescript
// ❌ Violates dependency rule: Domain layer depends on Infrastructure
// domain/User.ts
import { MySQLConnection } from '../infrastructure/database';

// ✅ Correct: Domain defines the interface; Infrastructure implements it
// domain/UserRepository.ts (interface)
interface UserRepository {
  findById(id: string): Promise<User>;
}

// infrastructure/MySQLUserRepository.ts (implementation)
class MySQLUserRepository implements UserRepository {
  findById(id: string): Promise<User> { /* ... */ }
}
```

### Checklist

**Layer boundary checks:**
- [ ] Does the Domain layer have external dependencies (database, HTTP, file system)?
- [ ] Does the Application layer directly manipulate the database or call external APIs?
- [ ] Do Controllers contain business logic?
- [ ] Are there cross-layer calls (UI directly calling Repository)?

**Separation of concerns checks:**
- [ ] Business logic is separated from presentation logic.
- [ ] Data access is encapsulated in a dedicated layer.
- [ ] Configuration and environment-specific code are centralized.

### Review comments

```markdown
🔴 [blocking] "The Domain entity imports a database connection, violating the dependency rule."
🟡 [important] "The Controller contains business calculations; move them to the Service layer."
💡 [suggestion] "Consider dependency injection to decouple these components."
```

---

## Design Pattern Usage Assessment

### When to Use Design Patterns

| Pattern | Good fit | Poor fit |
|---------|----------|----------|
| **Factory** | Need to create different object types determined at runtime | Only one type, or type never changes |
| **Strategy** | Algorithm must switch at runtime; multiple interchangeable behaviors | Only one algorithm, or algorithm will not change |
| **Observer** | One-to-many dependency; state changes notify many objects | A simple direct call is enough |
| **Singleton** | Truly one global instance is needed, such as configuration management | Dependency injection can pass the object |
| **Decorator** | Need to dynamically add responsibilities and avoid inheritance explosion | Responsibilities are fixed and do not need composition |

### Pattern Overuse Signals

```text
⚠️ Many interfaces/classes for a simple operation
⚠️ Pattern names appear in code but business concepts disappear
⚠️ A small change requires touching many files
⚠️ Tests need excessive mocking because the design is too abstract
```

### Review Questions

- "What concrete variability is this pattern handling?"
- "Is the pattern solving today's problem or a hypothetical future problem?"
- "Would a plain function or small object be clearer?"

---

## Module Boundaries and Dependencies

### Good Boundary Characteristics

- Clear ownership of data and behavior.
- Public API is small and stable.
- Internal details can change without affecting callers.
- Dependencies point in one direction.
- Domain language is visible in names.

### Boundary Smells

```text
⚠️ Modules import each other's internals
⚠️ Utility modules become dumping grounds
⚠️ Feature code reaches into shared state directly
⚠️ Many circular dependencies
⚠️ Public APIs expose persistence or transport details
```

### Review Questions

- "Is this module exposing only what callers need?"
- "Can internals change without breaking other modules?"
- "Is this shared abstraction actually shared, or just prematurely generalized?"

---

## Architecture Review Checklist

### 🔴 Blocking Issues

- [ ] Domain/business logic depends directly on infrastructure concerns.
- [ ] There are circular dependencies between major modules/layers.
- [ ] One class/module has multiple unrelated responsibilities and is growing rapidly.
- [ ] New behavior requires modifying central switch/if chains in many places.
- [ ] The design makes critical logic hard to unit test.

### 🟡 Important Issues

- [ ] Interfaces are too large or force unused methods on implementers.
- [ ] Concrete dependencies are constructed directly instead of injected.
- [ ] Controllers/UI contain business rules.
- [ ] Shared modules contain unrelated dumping-ground utilities.
- [ ] Copy-paste variants indicate a missing abstraction.

### 🟢 Suggestions

- [ ] Rename generic classes to domain-specific names.
- [ ] Split large modules by responsibility or use case.
- [ ] Introduce Strategy/Factory only where real variability exists.
- [ ] Add adapter/mapping layers to protect the domain model from external shapes.
- [ ] Document major architectural decisions with ADRs.

---

## Final Review Summary Template

```markdown
## Architecture Review

**Overall:** The direction is sound / needs changes / needs redesign.

**Strengths:**
- ...

**Blocking concerns:**
- ...

**Important improvements:**
- ...

**Suggested follow-ups:**
- ...
```
