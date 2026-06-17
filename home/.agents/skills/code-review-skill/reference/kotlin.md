# Kotlin / Android Code Review Guide

> Kotlin/Android review guide covering coroutine scopes and cancellation, Flow pitfalls, Jetpack Compose recomposition, null safety, memory leaks, architecture layering, and sealed-class state modeling.

## Table of Contents

- [Coroutines: Scope and Cancellation](#coroutines-scope-and-cancellation)
- [Flow Pitfalls](#flow-pitfalls)
- [Jetpack Compose Recomposition](#jetpack-compose-recomposition)
- [Null Safety Patterns](#null-safety-patterns)
- [Memory Leaks](#memory-leaks)
- [Architecture: ViewModel and Repository](#architecture-viewmodel-and-repository)
- [Sealed Classes and State Management](#sealed-classes-and-state-management)
- [Review Checklist](#review-checklist)

---

## Coroutines: Scope and Cancellation

### Avoid GlobalScope

```kotlin
// ❌ GlobalScope is uncontrolled; work can continue after Activity/Fragment destruction
fun loadUser() {
    GlobalScope.launch {
        val user = api.getUser()
        updateUi(user)
    }
}

// ✅ Use viewModelScope; cancelled automatically when the ViewModel is cleared
class UserViewModel : ViewModel() {
    fun loadUser() {
        viewModelScope.launch {
            val user = repository.getUser()
            _state.value = UserState.Loaded(user)
        }
    }
}

// ✅ Use lifecycleScope in Activity/Fragment
lifecycleScope.launch {
    repeatOnLifecycle(Lifecycle.State.STARTED) {
        viewModel.state.collect { render(it) }
    }
}
```

### Do Not Swallow CancellationException

```kotlin
// ❌ Catching all exceptions can swallow cancellation
viewModelScope.launch {
    try {
        repository.sync()
    } catch (e: Exception) {
        // CancellationException is swallowed; coroutine cannot cancel correctly
        log(e)
    }
}

// ✅ Rethrow CancellationException
viewModelScope.launch {
    try {
        repository.sync()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        log(e)
    }
}

// ✅ Or use catch with ensureActive
viewModelScope.launch {
    runCatching { repository.sync() }
        .onFailure { throwable ->
            coroutineContext.ensureActive()
            log(throwable)
        }
}
```

### CPU-Bound Work Must Check Cancellation

```kotlin
// ❌ CPU-heavy work ignores cancellation and keeps running
suspend fun crunch(items: List<Item>) = withContext(Dispatchers.Default) {
    items.map { expensiveCompute(it) }
}

// ✅ Check isActive / ensureActive periodically
suspend fun crunch(items: List<Item>) = withContext(Dispatchers.Default) {
    items.mapIndexed { index, item ->
        if (index % 100 == 0) ensureActive()
        expensiveCompute(item)
    }
}

// ✅ Or yield periodically
if (index % 100 == 0) yield()
```

### Use runInterruptible for Blocking Calls

```kotlin
// ❌ Blocking I/O directly inside a coroutine blocks a pool thread
val bytes = File(path).readBytes()

// ✅ Wrap interruptible blocking calls
val bytes = withContext(Dispatchers.IO) {
    runInterruptible { File(path).readBytes() }
}
```

### Choose Dispatchers Correctly

```kotlin
// ❌ CPU-heavy work on IO wastes resources
withContext(Dispatchers.IO) { calculateHash(data) }

// ✅ CPU-heavy work uses Default; I/O uses IO
withContext(Dispatchers.Default) { calculateHash(data) }
withContext(Dispatchers.IO) { api.fetchUser() }

// ❌ I/O on Default can starve CPU work
withContext(Dispatchers.Default) { database.query() }

// ✅ I/O uses IO
withContext(Dispatchers.IO) { database.query() }
```

### Use launch vs async Intentionally

```kotlin
// ❌ async for fire-and-forget work
viewModelScope.async { analytics.track("open") }

// ✅ Use launch when no value is needed
viewModelScope.launch { analytics.track("open") }

// ✅ Use async when a result is needed and work can run in parallel
coroutineScope {
    val user = async { repository.getUser() }
    val settings = async { repository.getSettings() }
    render(user.await(), settings.await())
}
```

### Do Not Break Parent/Child Relationships with Job()

```kotlin
// ❌ Job() cuts off cancellation propagation from the parent
val scope = CoroutineScope(Dispatchers.IO + Job())

// ✅ Preserve structured concurrency
class SyncWorker(
    private val scope: CoroutineScope
) {
    fun start() = scope.launch { sync() }
}

// ✅ If a truly independent lifetime is required, manage and document it explicitly
private val job = SupervisorJob()
private val scope = CoroutineScope(Dispatchers.IO + job)
fun close() = job.cancel()
```

### Correct Use of NonCancellable

```kotlin
// ❌ Wrapping the whole coroutine in NonCancellable prevents cancellation
withContext(NonCancellable) {
    longRunningWork()
}

// ✅ Use NonCancellable only for cleanup in finally
try {
    upload()
} finally {
    withContext(NonCancellable) {
        cleanupTempFiles()
    }
}
```

---

## Flow Pitfalls

### Cold Flow vs Hot Flow Confusion

```kotlin
// ❌ Each collect reruns the flow block; cold-flow behavior misunderstood
val users = flow {
    emit(api.fetchUsers())
}

// ✅ Share data with StateFlow/SharedFlow when multiple collectors need the same stream
val users: StateFlow<List<User>> = repository.users
    .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
```

### Do Not Switch Context Inside flow {}

```kotlin
// ❌ withContext inside a flow builder violates flow context rules
val data = flow {
    withContext(Dispatchers.IO) {
        emit(api.fetch())
    }
}

// ✅ Use flowOn to switch upstream context
val data = flow {
    emit(api.fetch())
}.flowOn(Dispatchers.IO)

// ✅ Use channelFlow/callbackFlow when context switching or callbacks are required
val events = callbackFlow {
    val listener = Listener { trySend(it) }
    register(listener)
    awaitClose { unregister(listener) }
}
```

### collect Must Be Lifecycle-Aware

```kotlin
// ❌ collect in Activity/Fragment without lifecycle awareness
lifecycleScope.launch {
    viewModel.state.collect { render(it) }
}

// ✅ Fragment: use viewLifecycleOwner.lifecycleScope + repeatOnLifecycle
viewLifecycleOwner.lifecycleScope.launch {
    viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
        viewModel.state.collect { render(it) }
    }
}

// ✅ Compose: use collectAsStateWithLifecycle
val state by viewModel.state.collectAsStateWithLifecycle()
```

### Exception Transparency: Use catch

```kotlin
// ❌ Handling upstream exceptions with try-catch around collect
try {
    flow.collect { render(it) }
} catch (e: Exception) {
    showError(e)
}

// ✅ Use catch to keep exception transparency
flow
    .catch { e -> emit(UiState.Error(e)) }
    .collect { render(it) }
```

### StateFlow vs SharedFlow

```kotlin
// ❌ SharedFlow used as a fake StateFlow loses latest-value semantics
private val _state = MutableSharedFlow<UiState>()

// ✅ UI state uses StateFlow: always has a value; new subscribers get latest value
private val _state = MutableStateFlow<UiState>(UiState.Loading)
val state: StateFlow<UiState> = _state.asStateFlow()

// ✅ One-time events use SharedFlow with replay = 0
private val _events = MutableSharedFlow<UiEvent>(replay = 0)
val events = _events.asSharedFlow()

// ✅ Channel is also acceptable for one-time events
private val events = Channel<UiEvent>(Channel.BUFFERED)
val eventFlow = events.receiveAsFlow()
```

---

## Jetpack Compose Recomposition

### Unstable Parameters Cause Extra Recompositions

```kotlin
// ❌ Unstable class parameter; Compose cannot reliably know whether it changed
class UserUiModel(val name: String, val tags: List<String>)

@Composable
fun UserCard(user: UserUiModel) { ... }

// ✅ Mark immutable data or use stable collection types
data class UserUiModel(
    val name: String,
    val tags: ImmutableList<String>
)

// ✅ Or pass unstable properties as separate stable parameters
@Composable
fun UserCard(name: String, tagCount: Int) { ... }
```

### Lambda Stability and remember

```kotlin
// ❌ New lambda on every recomposition can cause child recomposition
Child(onClick = { viewModel.onClick(id) })

// ✅ remember the lambda when appropriate
val onClick = remember(id) { { viewModel.onClick(id) } }
Child(onClick = onClick)
```

### Use derivedStateOf for High-Frequency Changes

```kotlin
// ❌ Recompute/recompose on every scroll value change
val showButton = listState.firstVisibleItemIndex > 0

// ✅ Recompute only when derived result changes
val showButton by remember {
    derivedStateOf { listState.firstVisibleItemIndex > 0 }
}
```

### Do Not Run Side Effects in Composable Bodies

```kotlin
// ❌ Runs on every recomposition
@Composable
fun Screen(userId: String) {
    viewModel.load(userId)
}

// ✅ Use LaunchedEffect keyed by inputs
@Composable
fun Screen(userId: String) {
    LaunchedEffect(userId) {
        viewModel.load(userId)
    }
}

// ✅ One-time initialization uses remember
val formatter = remember { DateTimeFormatter.ISO_DATE }
```

### State Hoisting

```kotlin
// ❌ State and logic coupled inside Composable; hard to reuse and test
@Composable
fun SearchBox() {
    var query by remember { mutableStateOf("") }
    TextField(value = query, onValueChange = { query = it })
}

// ✅ State hoisting: caller owns state
@Composable
fun SearchBox(query: String, onQueryChange: (String) -> Unit) {
    TextField(value = query, onValueChange = onQueryChange)
}
```

---

## Null Safety Patterns

### Avoid Non-Null Assertion (!!)

```kotlin
// ❌ Non-null assertion throws NPE if value is null
val name = user!!.name

// ✅ Safe call + Elvis operator
val name = user?.name ?: "Unknown"

// ✅ requireNotNull gives a meaningful error message
val user = requireNotNull(user) { "User is required" }

// ✅ Early return
val user = user ?: return
```

### lateinit, nullable, and lazy

```kotlin
// ❌ lateinit for values that may legitimately be null is semantically wrong
lateinit var user: User

// ✅ lateinit only when lifecycle guarantees initialization before use
lateinit var binding: FragmentUserBinding

// ✅ Choose based on initialization timing
// lateinit: lifecycle guarantees initialization before use
// nullable: may not be initialized; requires null checks
// lazy: initialized on first access

val expensive by lazy { ExpensiveObject() } // initialized on first access; thread-safe by default
var optionalUser: User? = null              // may never be initialized
```

### Java Interop: Platform Type Leakage

```kotlin
// ❌ Java returns a platform type that may be null; Kotlin treats it as non-null
val name: String = javaApi.getName()

// ✅ Receive Java returns as nullable
val name: String? = javaApi.getName()

// ✅ Wrap Java APIs with safe Kotlin types
fun JavaApi.safeName(): String? = getName()
```

---

## Memory Leaks

### Avoid Capturing Context/View in Long-Lived Coroutines

```kotlin
// ❌ Coroutine captures Activity Context; Activity cannot be collected after destruction
class MyViewModel(private val context: Context) : ViewModel() {
    fun load() = viewModelScope.launch {
        delay(10_000)
        Toast.makeText(context, "Done", Toast.LENGTH_SHORT).show()
    }
}

// ✅ Use application context when required and keep UI work lifecycle-aware
class MyViewModel(application: Application) : AndroidViewModel(application) {
    private val appContext = application.applicationContext
}
```

### Unregister Listeners

```kotlin
// ❌ Register listener but never unregister it
override fun onResume() {
    sensorManager.registerListener(listener, sensor, delay)
}

// ✅ Unregister in onPause/onDestroyView
override fun onPause() {
    sensorManager.unregisterListener(listener)
    super.onPause()
}
```

### Cancel Custom CoroutineScope

```kotlin
// ❌ Creates a CoroutineScope but never cancels it
class Downloader {
    private val scope = CoroutineScope(Dispatchers.IO)
}

// ✅ Provide close/cancel and cancel the Job
class Downloader : Closeable {
    private val job = SupervisorJob()
    private val scope = CoroutineScope(Dispatchers.IO + job)

    override fun close() {
        job.cancel()
    }
}

// ✅ In ViewModel, prefer built-in viewModelScope; do not manage lifecycle manually
```

---

## Architecture: ViewModel and Repository

### ViewModel Does Not Expose Mutable State

```kotlin
// ❌ Exposes MutableStateFlow; callers can mutate it freely
val state = MutableStateFlow(UiState.Loading)

// ✅ Expose immutable interface; keep mutable version private
private val _state = MutableStateFlow<UiState>(UiState.Loading)
val state: StateFlow<UiState> = _state.asStateFlow()
```

### Move Business Logic into Repository / Use Case

```kotlin
// ❌ ViewModel contains data processing and business rules
class UserViewModel : ViewModel() {
    fun load() = viewModelScope.launch {
        val users = api.getUsers().filter { it.active }.sortedBy { it.name }
        _state.value = UiState.Users(users)
    }
}

// ✅ ViewModel manages state; Repository/UseCase owns business/data logic
class UserViewModel(private val getActiveUsers: GetActiveUsersUseCase) : ViewModel() {
    fun load() = viewModelScope.launch {
        _state.value = UiState.Users(getActiveUsers())
    }
}
```

### Single Source of Truth (Offline-First)

```kotlin
// ❌ ViewModel fetches from network directly; no cache, no offline behavior
val users = api.getUsers()

// ✅ Repository is the single source of truth: show local cache, then refresh from network
class UserRepository(
    private val dao: UserDao,
    private val api: UserApi,
) {
    val users: Flow<List<User>> = dao.observeUsers()

    suspend fun refresh() {
        val remote = api.getUsers()
        dao.upsert(remote)
    }
}
```

### Use Cases for Complex Business Logic

```kotlin
// ❌ Repository method names become verb phrases and responsibilities sprawl
repository.validateUserAndApplyDiscountAndCreateOrder(...)

// ✅ Use Case encapsulates complex business logic; Repository handles data access
class CreateOrderUseCase(
    private val userRepository: UserRepository,
    private val orderRepository: OrderRepository,
    private val pricingService: PricingService,
) {
    suspend operator fun invoke(command: CreateOrderCommand): Order { ... }
}
```

---

## Sealed Classes and State Management

### UI State Modeling: Make Invalid States Unrepresentable

```kotlin
// ❌ Nullable combinations can represent invalid states
data class UiState(
    val loading: Boolean,
    val data: User?,
    val error: Throwable?
)

// ✅ Sealed classes model mutually exclusive states
sealed interface UiState {
    data object Loading : UiState
    data class Loaded(val user: User) : UiState
    data class Error(val cause: Throwable) : UiState
}

// ✅ Exhaustive when in Compose
when (val state = uiState) {
    UiState.Loading -> Loading()
    is UiState.Loaded -> UserContent(state.user)
    is UiState.Error -> ErrorMessage(state.cause)
}
```

### Navigation Event Modeling

```kotlin
// ❌ Enum/string navigation events cannot carry typed parameters
enum class NavEvent { USER_DETAIL }

// ✅ Sealed classes carry type-safe parameters
sealed interface NavEvent {
    data class UserDetail(val userId: UserId) : NavEvent
    data object Back : NavEvent
}

// ✅ Handle navigation events exhaustively
when (event) {
    is NavEvent.UserDetail -> navController.navigate("users/${event.userId}")
    NavEvent.Back -> navController.popBackStack()
}
```

### Network Result Wrapping

```kotlin
// ❌ Result? or nullable loses error information
val result: User? = api.getUser()

// ✅ Sealed class preserves success and error details
sealed interface NetworkResult<out T> {
    data class Success<T>(val value: T) : NetworkResult<T>
    data class Failure(val error: Throwable) : NetworkResult<Nothing>
}

// ✅ Map to UI state in ViewModel
val state = when (val result = repository.getUser()) {
    is NetworkResult.Success -> UiState.Loaded(result.value)
    is NetworkResult.Failure -> UiState.Error(result.error)
}
```

---

## Review Checklist

### Coroutines
- [ ] `GlobalScope` is not used; `viewModelScope` / `lifecycleScope` are used instead.
- [ ] `CancellationException` is rethrown correctly and not swallowed.
- [ ] CPU-heavy work uses `Dispatchers.Default`; I/O uses `Dispatchers.IO`.
- [ ] Long-running CPU tasks call `ensureActive()` or `yield()` periodically.
- [ ] Blocking calls are wrapped with `runInterruptible` where appropriate.
- [ ] `Job()` is not used to break parent/child coroutine relationships accidentally.
- [ ] `NonCancellable` is used only for cleanup in `finally` blocks.
- [ ] `launch` is used when no value is needed; `async` is used for parallel results.

### Flow
- [ ] Cold flows (`flow {}`) and hot flows (`StateFlow`/`SharedFlow`) are used appropriately.
- [ ] `withContext` is not used inside a `flow {}` builder; `flowOn` is used instead.
- [ ] `collect` is paired with `repeatOnLifecycle` or `collectAsStateWithLifecycle`.
- [ ] Exception handling uses `.catch` rather than wrapping `collect` in `try-catch`.
- [ ] UI state uses `StateFlow`; one-time events use `SharedFlow` or `Channel`.

### Compose
- [ ] Composable parameters use stable types to avoid unnecessary recomposition.
- [ ] Lambda parameters are remembered when needed to avoid new instances every recomposition.
- [ ] Derived state uses `derivedStateOf` to avoid high-frequency recomposition.
- [ ] Side effects use `LaunchedEffect` / `SideEffect`, not direct calls in the function body.
- [ ] State is hoisted correctly; Composables are stateless and reusable where possible.

### Null Safety
- [ ] Non-null assertion `!!` is not overused; safe calls `?.` or Elvis `?:` are used.
- [ ] `lateinit` is used only for properties whose lifecycle guarantees initialization.
- [ ] Java interop return values are received as nullable when appropriate.
- [ ] `lazy` is used for expensive objects initialized on first access.

### Memory Leaks
- [ ] Coroutines do not capture short-lived `Context` / `View` objects.
- [ ] Listeners are unregistered in `onPause` / `onDestroyView`.
- [ ] Custom `CoroutineScope` instances provide a cancellation mechanism.
- [ ] Singletons do not hold `Activity` / `Fragment` references.

### Architecture
- [ ] ViewModel does not expose `MutableStateFlow` / `MutableLiveData`; immutable interfaces are exposed.
- [ ] Business logic is moved into Repository / Use Case; ViewModel only manages state.
- [ ] Offline-first is implemented with Repository as the single source of truth.
- [ ] Complex business logic is encapsulated in dedicated Use Case classes.

### Sealed Classes and State
- [ ] UI state uses sealed classes so impossible states cannot be represented.
- [ ] Navigation events use sealed classes with type-safe parameters.
- [ ] Network results use sealed wrappers and do not lose error details.
- [ ] `when` expressions cover all branches exhaustively.
