# Java Code Review Guide

Java review focus: Java 17/21 features, Spring Boot 3 best practices, concurrency (virtual threads), JPA performance, and maintainability.

## Table of Contents

- [Modern Java Features (17/21+)](#modern-java-features-1721)
- [Stream API & Optional](#stream-api--optional)
- [Spring Boot Best Practices](#spring-boot-best-practices)
- [JPA and Database Performance](#jpa-and-database-performance)
- [Concurrency and Virtual Threads](#concurrency-and-virtual-threads)
- [Lombok Usage Guidelines](#lombok-usage-guidelines)
- [Exception Handling](#exception-handling)
- [Testing Guidelines](#testing-guidelines)
- [Review Checklist](#review-checklist)

---

## Modern Java Features (17/21+)

### Records

```java
// ❌ Traditional POJO/DTO: lots of boilerplate
public class UserDto {
    private final String name;
    private final int age;

    public UserDto(String name, int age) {
        this.name = name;
        this.age = age;
    }
    // getters, equals, hashCode, toString...
}

// ✅ Use records: concise, immutable, and semantically clear
public record UserDto(String name, int age) {
    // Compact constructor for validation
    public UserDto {
        if (age < 0) throw new IllegalArgumentException("Age cannot be negative");
    }
}
```

### Switch Expressions and Pattern Matching

```java
// ❌ Traditional switch: easy to miss break; verbose and error-prone
String type = "";
switch (obj) {
    case Integer i: // Java 16+
        type = String.format("int %d", i);
        break;
    case String s:
        type = String.format("string %s", s);
        break;
    default:
        type = "unknown";
}

// ✅ Switch expression: no fallthrough risk, forces a return value
String type = switch (obj) {
    case Integer i -> "int %d".formatted(i);
    case String s  -> "string %s".formatted(s);
    case null      -> "null value"; // Java 21 handles null
    default        -> "unknown";
};
```

### Text Blocks

```java
// ❌ Concatenated SQL/JSON strings
String json = "{\n" +
              "  \"name\": \"Alice\",\n" +
              "  \"age\": 20\n" +
              "}";

// ✅ Use text blocks: what you see is what you get
String json = """
    {
      "name": "Alice",
      "age": 20
    }
    """;
```

---

## Stream API & Optional

### Avoid Overusing Streams

```java
// ❌ Simple loops do not need Stream (performance overhead + worse readability)
items.stream().forEach(item -> {
    process(item);
});

// ✅ Use for-each directly for simple cases
for (var item : items) {
    process(item);
}

// ❌ Extremely complex Stream chain
List<Dto> result = list.stream()
    .filter(...)
    .map(...)
    .peek(...)
    .sorted(...)
    .collect(...); // Hard to debug

// ✅ Split into meaningful steps
var filtered = list.stream().filter(...).toList();
// ...
```

### Correct Optional Usage

```java
// ❌ Using Optional as a parameter or field (serialization issues, harder calls)
public void process(Optional<String> name) { ... }
public class User {
    private Optional<String> email; // Not recommended
}

// ✅ Optional only for return values
public Optional<User> findUser(String id) { ... }

// ❌ Using isPresent() + get() after choosing Optional
Optional<User> userOpt = findUser(id);
if (userOpt.isPresent()) {
    return userOpt.get().getName();
} else {
    return "Unknown";
}

// ✅ Use the functional API
return findUser(id)
    .map(User::getName)
    .orElse("Unknown");
```

---

## Spring Boot Best Practices

### Dependency Injection (DI)

```java
// ❌ Field injection (@Autowired)
// Cons: hard to test (requires reflection injection), hides too many dependencies, weak immutability
@Service
public class UserService {
    @Autowired
    private UserRepository userRepo;
}

// ✅ Constructor Injection
// Pros: dependencies are explicit, unit tests are easier (mocks), fields can be final
@Service
public class UserService {
    private final UserRepository userRepo;

    public UserService(UserRepository userRepo) {
        this.userRepo = userRepo;
    }
}
// 💡 Tip: Lombok @RequiredArgsConstructor can reduce boilerplate, but watch for circular dependencies
```

### Configuration Management

```java
// ❌ Hardcoded configuration values
@Service
public class PaymentService {
    private String apiKey = "sk_live_12345";
}

// ❌ Scattered direct @Value usage
@Value("${app.payment.api-key}")
private String apiKey;

// ✅ Type-safe configuration with @ConfigurationProperties
@ConfigurationProperties(prefix = "app.payment")
public record PaymentProperties(String apiKey, int timeout, String url) {}
```

---

## JPA and Database Performance

### N+1 Query Problem

```java
// ❌ FetchType.EAGER or lazy loading triggered in a loop
// Entity definition
@Entity
public class User {
    @OneToMany(fetch = FetchType.EAGER) // Dangerous!
    private List<Order> orders;
}

// Business code
List<User> users = userRepo.findAll(); // 1 SQL query
for (User user : users) {
    // If Lazy, this triggers N SQL queries
    System.out.println(user.getOrders().size());
}

// ✅ Use @EntityGraph or JOIN FETCH
@Query("SELECT u FROM User u JOIN FETCH u.orders")
List<User> findAllWithOrders();
```

### Transaction Management

```java
// ❌ Starting transactions in the Controller layer (holds DB connections too long)
// ❌ @Transactional on private methods does not work (AOP is bypassed)
@Transactional
private void saveInternal() { ... }

// ✅ Put @Transactional on public Service-layer methods
// ✅ Mark reads explicitly with readOnly = true (performance optimization)
@Service
public class UserService {
    @Transactional(readOnly = true)
    public User getUser(Long id) { ... }

    @Transactional
    public void createUser(UserDto dto) { ... }
}
```

### Entity Design

```java
// ❌ Lombok @Data on entities
// @Data generates equals/hashCode over all fields, which may trigger lazy loading and cause performance issues or exceptions
@Entity
@Data
public class User { ... }

// ✅ Use only @Getter and @Setter
// ✅ Custom equals/hashCode, usually based on ID
@Entity
@Getter
@Setter
public class User {
    @Id
    private Long id;

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof User)) return false;
        return id != null && id.equals(((User) o).id);
    }

    @Override
    public int hashCode() {
        return getClass().hashCode();
    }
}
```

---

## Concurrency and Virtual Threads

### Virtual Threads (Java 21+)

```java
// ❌ Traditional thread pools for many blocking I/O tasks (resource exhaustion)
ExecutorService executor = Executors.newFixedThreadPool(100);

// ✅ Use virtual threads for I/O-heavy tasks (high throughput)
// Spring Boot 3.2+ enables this with: spring.threads.virtual.enabled=true
ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();

// In virtual threads, blocking operations such as DB queries and HTTP requests consume very little OS-thread resource
```

### Thread Safety

```java
// ❌ SimpleDateFormat is not thread-safe
private static final SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd");

// ✅ Use DateTimeFormatter (Java 8+)
private static final DateTimeFormatter dtf = DateTimeFormatter.ofPattern("yyyy-MM-dd");

// ❌ HashMap can lose data under concurrency (Java 7 and earlier could even loop forever during resize; Java 8 fixed that loop but it is still not thread-safe)
// ✅ Use ConcurrentHashMap
Map<String, String> cache = new ConcurrentHashMap<>();
```

---

## Lombok Usage Guidelines

```java
// ❌ Overusing @Builder can make required fields impossible to enforce
@Builder
public class Order {
    private String id; // Required
    private String note; // Optional
}
// Caller may omit id: Order.builder().note("hi").build();

// ✅ For critical business objects, consider a hand-written Builder or constructor to enforce invariants
// Or add validation in build() (Lombok @Builder.Default, etc.)
```

---

## Exception Handling

### Global Exception Handling

```java
// ❌ try-catch everywhere that swallows exceptions or only prints logs
try {
    userService.create(user);
} catch (Exception e) {
    e.printStackTrace(); // Should not be used in production
    // return null; // Swallows the exception; callers do not know what happened
}

// ✅ Custom exceptions + @ControllerAdvice (Spring Boot 3 ProblemDetail)
public class UserNotFoundException extends RuntimeException { ... }

@RestControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(UserNotFoundException.class)
    public ProblemDetail handleNotFound(UserNotFoundException e) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, e.getMessage());
    }
}
```

---

## Testing Guidelines

### Unit Tests vs Integration Tests

```java
// ❌ Unit tests depend on a real database or external service
@SpringBootTest // Starts the entire Context; slow
public class UserServiceTest { ... }

// ✅ Unit tests use Mockito
@ExtendWith(MockitoExtension.class)
class UserServiceTest {
    @Mock UserRepository repo;
    @InjectMocks UserService service;

    @Test
    void shouldCreateUser() { ... }
}

// ✅ Integration tests use Testcontainers
@Testcontainers
@SpringBootTest
class UserRepositoryTest {
    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:15");
    // ...
}
```

---

## Review Checklist

### Basics and Standards
- [ ] Java 17/21 features are used appropriately (switch expressions, records, text blocks)
- [ ] Deprecated classes are avoided (Date, Calendar, SimpleDateFormat)
- [ ] Collection operations use Stream API or Collections methods where appropriate
- [ ] Optional is used only for return values, not fields or parameters

### Spring Boot
- [ ] Constructor injection is used instead of @Autowired field injection
- [ ] Configuration properties use @ConfigurationProperties
- [ ] Controllers have a single responsibility; business logic is in Services
- [ ] Global exception handling uses @ControllerAdvice / ProblemDetail

### Database & Transactions
- [ ] Read transactions are marked with `@Transactional(readOnly = true)`
- [ ] N+1 queries are checked (EAGER fetch or loop-triggered queries)
- [ ] Entity classes do not use @Data and implement equals/hashCode correctly
- [ ] Database indexes cover query predicates

### Concurrency & Performance
- [ ] Virtual threads are considered for I/O-heavy tasks
- [ ] Thread-safe classes are used correctly (ConcurrentHashMap vs HashMap)
- [ ] Lock granularity is reasonable; I/O is avoided inside locks

### Maintainability
- [ ] Critical business logic has sufficient unit tests
- [ ] Logging is appropriate (Slf4j, no System.out)
- [ ] Magic values are extracted to constants or enums
