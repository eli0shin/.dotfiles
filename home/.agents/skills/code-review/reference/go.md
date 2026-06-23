# Go Code Review Guide

A code review checklist based on the official Go guides, Effective Go, and community best practices.

## Quick Review Checklist

### Must Check
- [ ] Errors are handled correctly (not ignored, with context)
- [ ] goroutines have an exit path (avoid leaks)
- [ ] context is passed and canceled correctly
- [ ] Receiver type choice is appropriate (value/pointer)
- [ ] Code is formatted with `gofmt`

### Frequent Issues
- [ ] Loop variable capture issues (Go < 1.22)
- [ ] nil checks are complete
- [ ] maps are initialized before use
- [ ] defer usage inside loops
- [ ] Variable shadowing

---

## 1. Error Handling

### 1.1 Never Ignore Errors

```go
// ❌ Bad: error ignored
result, _ := SomeFunction()

// ✅ Good: handle the error
result, err := SomeFunction()
if err != nil {
    return fmt.Errorf("some function failed: %w", err)
}
```

### 1.2 Error Wrapping and Context

```go
// ❌ Bad: loses context
if err != nil {
    return err
}

// ❌ Bad: using %v loses the error chain
if err != nil {
    return fmt.Errorf("failed: %v", err)
}

// ✅ Good: use %w to preserve the error chain
if err != nil {
    return fmt.Errorf("failed to process user %d: %w", userID, err)
}
```

### 1.3 Use errors.Is and errors.As

```go
// ❌ Bad: direct comparison cannot handle wrapped errors
if err == sql.ErrNoRows {
    // ...
}

// ✅ Good: use errors.Is (supports error chains)
if errors.Is(err, sql.ErrNoRows) {
    return nil, ErrNotFound
}

// ✅ Good: use errors.As to extract a specific type
var pathErr *os.PathError
if errors.As(err, &pathErr) {
    log.Printf("path error: %s", pathErr.Path)
}
```

### 1.4 Custom Error Types

```go
// ✅ Recommended: define sentinel errors
var (
    ErrNotFound     = errors.New("not found")
    ErrUnauthorized = errors.New("unauthorized")
)

// ✅ Recommended: custom errors with context
type ValidationError struct {
    Field   string
    Message string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation error on %s: %s", e.Field, e.Message)
}
```

### 1.5 Handle Each Error Once

```go
// ❌ Bad: both logging and returning (double handling)
if err != nil {
    log.Printf("error: %v", err)
    return err
}

// ✅ Good: only return it and let the caller decide
if err != nil {
    return fmt.Errorf("operation failed: %w", err)
}

// ✅ Or: log and handle it without returning
if err != nil {
    log.Printf("non-critical error: %v", err)
    // Continue with fallback logic
}
```

---

## 2. Concurrency and Goroutines

### 2.1 Avoid Goroutine Leaks

```go
// ❌ Bad: goroutine can never exit
func bad() {
    ch := make(chan int)
    go func() {
        val := <-ch // Blocks forever; nobody sends
        fmt.Println(val)
    }()
    // Function returns; goroutine leaks
}

// ✅ Good: use context or a done channel
func good(ctx context.Context) {
    ch := make(chan int)
    go func() {
        select {
        case val := <-ch:
            fmt.Println(val)
        case <-ctx.Done():
            return // Graceful exit
        }
    }()
}
```

### 2.2 Channel Usage Guidelines

```go
// ❌ Bad: sending to a nil channel (blocks forever)
var ch chan int
ch <- 1 // Blocks forever

// ❌ Bad: sending to a closed channel (panic)
close(ch)
ch <- 1 // panic!

// ✅ Good: sender closes the channel
func producer(ch chan<- int) {
    defer close(ch) // Sender is responsible for closing
    for i := 0; i < 10; i++ {
        ch <- i
    }
}

// ✅ Good: receiver detects closure
for val := range ch {
    process(val)
}
// Or
val, ok := <-ch
if !ok {
    // channel is closed
}
```

### 2.3 Use sync.WaitGroup

```go
// ❌ Bad: Add inside the goroutine
var wg sync.WaitGroup
for i := 0; i < 10; i++ {
    go func() {
        wg.Add(1) // Race condition!
        defer wg.Done()
        work()
    }()
}
wg.Wait()

// ✅ Good: Add before starting the goroutine
var wg sync.WaitGroup
for i := 0; i < 10; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        work()
    }()
}
wg.Wait()
```

### 2.4 Avoid Capturing Loop Variables (Go < 1.22)

```go
// ❌ Bad (Go < 1.22): capturing the loop variable
for _, item := range items {
    go func() {
        process(item) // All goroutines may use the same item
    }()
}

// ✅ Good: pass as a parameter
for _, item := range items {
    go func(it Item) {
        process(it)
    }(item)
}

// ✅ Go 1.22+: default behavior is fixed; each iteration creates a new variable
```

### 2.5 Worker Pool Pattern

```go
// ✅ Recommended: limit concurrency
func processWithWorkerPool(ctx context.Context, items []Item, workers int) error {
    jobs := make(chan Item, len(items))
    results := make(chan error, len(items))

    // Start workers
    for w := 0; w < workers; w++ {
        go func() {
            for item := range jobs {
                results <- process(item)
            }
        }()
    }

    // Send jobs
    for _, item := range items {
        jobs <- item
    }
    close(jobs)

    // Collect results
    for range items {
        if err := <-results; err != nil {
            return err
        }
    }
    return nil
}
```

---

## 3. Context Usage

### 3.1 Context as the First Parameter

```go
// ❌ Bad: context is not the first parameter
func Process(data []byte, ctx context.Context) error

// ❌ Bad: context is stored in a struct
type Service struct {
    ctx context.Context // Do not do this!
}

// ✅ Good: context is the first parameter and named ctx
func Process(ctx context.Context, data []byte) error
```

### 3.2 Propagate Instead of Creating a New Root Context

```go
// ❌ Bad: creating a new root context in the call chain
func middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ctx := context.Background() // Loses the request context!
        process(ctx)
        next.ServeHTTP(w, r)
    })
}

// ✅ Good: get it from the request and propagate it
func middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ctx := r.Context()
        ctx = context.WithValue(ctx, key, value)
        process(ctx)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

### 3.3 Always Call the cancel Function

```go
// ❌ Bad: cancel is not called
ctx, cancel := context.WithTimeout(parentCtx, 5*time.Second)
// Missing cancel() call; resources may leak

// ✅ Good: use defer to guarantee the call
ctx, cancel := context.WithTimeout(parentCtx, 5*time.Second)
defer cancel() // Call it even if the timeout fires
```

### 3.4 Respond to Context Cancellation

```go
// ✅ Recommended: check context during long-running operations
func LongRunningTask(ctx context.Context) error {
    for {
        select {
        case <-ctx.Done():
            return ctx.Err() // Returns context.Canceled or context.DeadlineExceeded
        default:
            // Do a small unit of work
            if err := doChunk(); err != nil {
                return err
            }
        }
    }
}
```

### 3.5 Distinguish Cancellation Reasons

```go
// ✅ Distinguish cancellation reasons using ctx.Err()
if err := ctx.Err(); err != nil {
    switch {
    case errors.Is(err, context.Canceled):
        log.Println("operation was canceled")
    case errors.Is(err, context.DeadlineExceeded):
        log.Println("operation timed out")
    }
    return err
}
```

---

## 4. Interface Design

### 4.1 Accept Interfaces, Return Structs

```go
// ❌ Not recommended: accept a concrete type
func SaveUser(db *sql.DB, user User) error

// ✅ Recommended: accept an interface (decoupled, easy to test)
type UserStore interface {
    Save(ctx context.Context, user User) error
}

func SaveUser(store UserStore, user User) error

// ❌ Not recommended: return an interface
func NewUserService() UserServiceInterface

// ✅ Recommended: return a concrete type
func NewUserService(store UserStore) *UserService
```

### 4.2 Define Interfaces at the Consumer

```go
// ❌ Not recommended: define the interface in the implementation package
// package database
type Database interface {
    Query(ctx context.Context, query string) ([]Row, error)
    // ... 20 methods
}

// ✅ Recommended: define the minimal required interface in the consumer package
// package userservice
type UserQuerier interface {
    QueryUsers(ctx context.Context, filter Filter) ([]User, error)
}
```

### 4.3 Keep Interfaces Small and Focused

```go
// ❌ Not recommended: a large, all-purpose interface
type Repository interface {
    GetUser(id int) (*User, error)
    CreateUser(u *User) error
    UpdateUser(u *User) error
    DeleteUser(id int) error
    GetOrder(id int) (*Order, error)
    CreateOrder(o *Order) error
    // ... more methods
}

// ✅ Recommended: small, focused interfaces
type UserReader interface {
    GetUser(ctx context.Context, id int) (*User, error)
}

type UserWriter interface {
    CreateUser(ctx context.Context, u *User) error
    UpdateUser(ctx context.Context, u *User) error
}

// Compose interfaces
type UserRepository interface {
    UserReader
    UserWriter
}
```

### 4.4 Avoid Overusing Empty Interfaces

```go
// ❌ Not recommended: overusing interface{}
func Process(data interface{}) interface{}

// ✅ Recommended: use generics (Go 1.18+)
func Process[T any](data T) T

// ✅ Recommended: define a concrete interface
type Processor interface {
    Process() Result
}
```

---

## 5. Receiver Type Choice

### 5.1 When to Use Pointer Receivers

```go
// ✅ When the receiver needs to be modified
func (u *User) SetName(name string) {
    u.Name = name
}

// ✅ When the receiver contains synchronization primitives such as sync.Mutex
type SafeCounter struct {
    mu    sync.Mutex
    count int
}

func (c *SafeCounter) Inc() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.count++
}

// ✅ When the receiver is a large struct (avoid copy overhead)
type LargeStruct struct {
    Data [1024]byte
    // ...
}

func (l *LargeStruct) Process() { /* ... */ }
```

### 5.2 When to Use Value Receivers

```go
// ✅ When the receiver is a small immutable struct
type Point struct {
    X, Y float64
}

func (p Point) Distance(other Point) float64 {
    return math.Sqrt(math.Pow(p.X-other.X, 2) + math.Pow(p.Y-other.Y, 2))
}

// ✅ When the receiver is an alias of a primitive type
type Counter int

func (c Counter) String() string {
    return fmt.Sprintf("%d", c)
}

// ✅ When the receiver is a map, func, or chan (already reference-like)
type StringSet map[string]struct{}

func (s StringSet) Contains(key string) bool {
    _, ok := s[key]
    return ok
}
```

### 5.3 Consistency Principle

```go
// ❌ Not recommended: mixing receiver types
func (u User) GetName() string   // Value receiver
func (u *User) SetName(n string) // Pointer receiver

// ✅ Recommended: if any method needs a pointer receiver, use pointers for all methods
func (u *User) GetName() string { return u.Name }
func (u *User) SetName(n string) { u.Name = n }
```

---

## 6. Performance Optimization

### 6.1 Preallocate Slices

```go
// ❌ Not recommended: dynamic growth
var result []int
for i := 0; i < 10000; i++ {
    result = append(result, i) // Multiple allocations and copies
}

// ✅ Recommended: preallocate when the size is known
result := make([]int, 0, 10000)
for i := 0; i < 10000; i++ {
    result = append(result, i)
}

// ✅ Or initialize directly
result := make([]int, 10000)
for i := 0; i < 10000; i++ {
    result[i] = i
}
```

### 6.2 Avoid Unnecessary Heap Allocations

```go
// ❌ May escape to the heap
func NewUser() *User {
    return &User{} // Escapes to the heap
}

// ✅ Consider returning by value (when applicable)
func NewUser() User {
    return User{} // May be allocated on the stack
}

// Check escape analysis
// go build -gcflags '-m -m' ./...
```

### 6.3 Use sync.Pool to Reuse Objects

```go
// ✅ Recommended: use sync.Pool for objects created/destroyed frequently
var bufferPool = sync.Pool{
    New: func() interface{} {
        return new(bytes.Buffer)
    },
}

func ProcessData(data []byte) string {
    buf := bufferPool.Get().(*bytes.Buffer)
    defer func() {
        buf.Reset()
        bufferPool.Put(buf)
    }()

    buf.Write(data)
    return buf.String()
}
```

### 6.4 String Concatenation Optimization

```go
// ❌ Not recommended: concatenating with + inside loops
var result string
for _, s := range strings {
    result += s // Creates a new string every time
}

// ✅ Recommended: use strings.Builder
var builder strings.Builder
for _, s := range strings {
    builder.WriteString(s)
}
result := builder.String()

// ✅ Or use strings.Join
result := strings.Join(strings, "")
```

### 6.5 Avoid interface{} Conversion Overhead

```go
// ❌ interface{} in a hot path
func process(data interface{}) {
    switch v := data.(type) { // Type assertions have overhead
    case int:
        // ...
    }
}

// ✅ Use generics or concrete types in hot paths
func process[T int | int64 | float64](data T) {
    // Type is known at compile time, with no runtime overhead
}
```

---

## 7. Testing

### 7.1 Table-Driven Tests

```go
// ✅ Recommended: table-driven tests
func TestAdd(t *testing.T) {
    tests := []struct {
        name     string
        a, b     int
        expected int
    }{
        {"positive numbers", 1, 2, 3},
        {"with zero", 0, 5, 5},
        {"negative numbers", -1, -2, -3},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            result := Add(tt.a, tt.b)
            if result != tt.expected {
                t.Errorf("Add(%d, %d) = %d; want %d",
                    tt.a, tt.b, result, tt.expected)
            }
        })
    }
}
```

### 7.2 Parallel Tests

```go
// ✅ Recommended: run independent test cases in parallel
func TestParallel(t *testing.T) {
    tests := []struct {
        name  string
        input string
    }{
        {"test1", "input1"},
        {"test2", "input2"},
    }

    for _, tt := range tests {
        tt := tt // Go < 1.22 requires a copy
        t.Run(tt.name, func(t *testing.T) {
            t.Parallel() // Mark as parallelizable
            result := Process(tt.input)
            // assertions...
        })
    }
}
```

### 7.3 Use Interfaces for Mocks

```go
// ✅ Define an interface for testing
type EmailSender interface {
    Send(to, subject, body string) error
}

// Production implementation
type SMTPSender struct { /* ... */ }

// Test mock
type MockEmailSender struct {
    SendFunc func(to, subject, body string) error
}

func (m *MockEmailSender) Send(to, subject, body string) error {
    return m.SendFunc(to, subject, body)
}

func TestUserRegistration(t *testing.T) {
    mock := &MockEmailSender{
        SendFunc: func(to, subject, body string) error {
            if to != "test@example.com" {
                t.Errorf("unexpected recipient: %s", to)
            }
            return nil
        },
    }

    service := NewUserService(mock)
    // test...
}
```

### 7.4 Test Helper Functions

```go
// ✅ Mark helper functions with t.Helper()
func assertEqual(t *testing.T, got, want interface{}) {
    t.Helper() // Error reports show the caller location
    if got != want {
        t.Errorf("got %v, want %v", got, want)
    }
}

// ✅ Use t.Cleanup() to clean up resources
func TestWithTempFile(t *testing.T) {
    f, err := os.CreateTemp("", "test")
    if err != nil {
        t.Fatal(err)
    }
    t.Cleanup(func() {
        os.Remove(f.Name())
    })
    // test...
}
```

---

## 8. Common Pitfalls

### 8.1 Nil Slice vs Empty Slice

```go
var nilSlice []int     // nil, len=0, cap=0
emptySlice := []int{}  // not nil, len=0, cap=0
made := make([]int, 0) // not nil, len=0, cap=0

// ✅ JSON encoding differences
json.Marshal(nilSlice)   // null
json.Marshal(emptySlice) // []

// ✅ Recommended: explicitly initialize when JSON needs an empty array
if slice == nil {
    slice = []int{}
}
```

### 8.2 Map Initialization

```go
// ❌ Bad: uninitialized map
var m map[string]int
m["key"] = 1 // panic: assignment to entry in nil map

// ✅ Good: initialize with make
m := make(map[string]int)
m["key"] = 1

// ✅ Or use a literal
m := map[string]int{}
```

### 8.3 Defer in Loops

```go
// ❌ Potential issue: defer runs only when the function returns
func processFiles(files []string) error {
    for _, file := range files {
        f, err := os.Open(file)
        if err != nil {
            return err
        }
        defer f.Close() // All files close only when the function returns!
        // process...
    }
    return nil
}

// ✅ Good: use a closure or extract a function
func processFiles(files []string) error {
    for _, file := range files {
        if err := processFile(file); err != nil {
            return err
        }
    }
    return nil
}

func processFile(file string) error {
    f, err := os.Open(file)
    if err != nil {
        return err
    }
    defer f.Close()
    // process...
    return nil
}
```

### 8.4 Shared Slice Backing Arrays

```go
// ❌ Potential issue: slices share the backing array
original := []int{1, 2, 3, 4, 5}
slice := original[1:3] // [2, 3]
slice[0] = 100         // Mutates original!
// original becomes [1, 100, 3, 4, 5]

// ✅ Good: copy explicitly when an independent copy is needed
slice := make([]int, 2)
copy(slice, original[1:3])
slice[0] = 100 // Does not affect original
```

### 8.5 String Substring Memory Leaks

```go
// ❌ Potential issue: substring keeps the whole backing array alive
func getPrefix(s string) string {
    return s[:10] // Still references the full backing array of s
}

// ✅ Good: create an independent copy (Go 1.18+)
func getPrefix(s string) string {
    return strings.Clone(s[:10])
}

// ✅ Before Go 1.18
func getPrefix(s string) string {
    return string([]byte(s[:10]))
}
```

### 8.6 Interface Nil Trap

```go
// ❌ Trap: nil checks on interfaces
type MyError struct{}
func (e *MyError) Error() string { return "error" }

func returnsError() error {
    var e *MyError = nil
    return e // The returned error is not nil!
}

func main() {
    err := returnsError()
    if err != nil { // true! interface{type: *MyError, value: nil}
        fmt.Println("error:", err)
    }
}

// ✅ Good: return nil explicitly
func returnsError() error {
    var e *MyError = nil
    if e == nil {
        return nil // Explicitly return nil
    }
    return e
}
```

### 8.7 Time Comparison

```go
// ❌ Not recommended: compare time.Time directly with ==
if t1 == t2 { // May fail because of monotonic clock differences
    // ...
}

// ✅ Recommended: use the Equal method
if t1.Equal(t2) {
    // ...
}

// ✅ Compare time ranges
if t1.Before(t2) || t1.After(t2) {
    // ...
}
```

---

## 9. Code Organization

### 9.1 Package Naming

```go
// ❌ Not recommended
package common   // Too broad
package utils    // Too broad
package helpers  // Too broad
package models   // Grouped by type

// ✅ Recommended: name by feature
package user     // User-related functionality
package order    // Order-related functionality
package postgres // PostgreSQL implementation
```

### 9.2 Avoid Circular Dependencies

```go
// ❌ Circular dependency
// package a imports package b
// package b imports package a

// ✅ Solution 1: extract shared types into a separate package
// package types (shared types)
// package a imports types
// package b imports types

// ✅ Solution 2: decouple with interfaces
// package a defines the interface
// package b implements the interface
```

### 9.3 Exported Identifier Guidelines

```go
// ✅ Export only necessary identifiers
type UserService struct {
    db *sql.DB // Private
}

func (s *UserService) GetUser(id int) (*User, error) // Public
func (s *UserService) validate(u *User) error         // Private

// ✅ internal packages restrict access
// internal/database/... can only be imported by code in the same project
```

---

## 10. Tools and Checks

### 10.1 Required Tools

```bash
# Formatting (required)
gofmt -w .
goimports -w .

# Static analysis
go vet ./...

# Race detection
go test -race ./...

# Escape analysis
go build -gcflags '-m -m' ./...
```

### 10.2 Recommended Linter

```bash
# golangci-lint (integrates multiple linters)
golangci-lint run

# Common checks
# - errcheck: checks unhandled errors
# - gosec: security checks
# - ineffassign: ineffective assignments
# - staticcheck: static analysis
# - unused: unused code
```

### 10.3 Benchmark Tests

```go
// ✅ Performance benchmark
func BenchmarkProcess(b *testing.B) {
    data := prepareData()
    b.ResetTimer() // Reset the timer

    for i := 0; i < b.N; i++ {
        Process(data)
    }
}

// Run benchmark
// go test -bench=. -benchmem ./...
```

---

## References

- [Effective Go](https://go.dev/doc/effective_go)
- [Go Code Review Comments](https://go.dev/wiki/CodeReviewComments)
- [Go Common Mistakes](https://go.dev/wiki/CommonMistakes)
- [100 Go Mistakes](https://100go.co/)
- [Go Proverbs](https://go-proverbs.github.io/)
- [Uber Go Style Guide](https://github.com/uber-go/guide/blob/master/style.md)
