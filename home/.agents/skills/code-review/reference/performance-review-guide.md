# Performance Review Guide

Performance review guide covering frontend, backend, database, algorithmic complexity, API performance, and low-level efficiency anti-patterns.

## Table of Contents

- [Frontend Performance (Core Web Vitals)](#frontend-performance-core-web-vitals)
- [JavaScript Performance](#javascript-performance)
- [Memory Management](#memory-management)
- [Database Performance](#database-performance)
- [API Performance](#api-performance)
- [Algorithmic Complexity](#algorithmic-complexity)
- [Performance Review Checklist](#performance-review-checklist)
- [Performance Measurement Thresholds](#performance-measurement-thresholds)
- [Recommended Tools](#recommended-tools)
- [Low-Level Efficiency Anti-Patterns](#low-level-efficiency-anti-patterns)

---

## Frontend Performance (Core Web Vitals)

### 2024 Core Metrics

| Metric | Full Name | Target | Meaning |
|--------|-----------|--------|---------|
| **LCP** | Largest Contentful Paint | ≤ 2.5s | Time to render the largest content element |
| **INP** | Interaction to Next Paint | ≤ 200ms | Interaction responsiveness; replaced FID in 2024 |
| **CLS** | Cumulative Layout Shift | ≤ 0.1 | Visual layout stability |
| **FCP** | First Contentful Paint | ≤ 1.8s | Time to first content render |
| **TBT** | Total Blocking Time | ≤ 200ms | Main-thread blocking time |

### LCP Optimization Checks

```html
<!-- ❌ Lazy-loading the LCP image delays critical content -->
<img src="hero.webp" loading="lazy" />

<!-- ✅ Load the LCP image immediately -->
<img src="hero.webp" fetchpriority="high" loading="eager" />

<!-- ❌ Unoptimized image format -->
<img src="hero.png" />  <!-- PNG may be too large -->

<!-- ✅ Modern image formats + responsive sources -->
<picture>
  <source srcset="hero.avif" type="image/avif" />
  <source srcset="hero.webp" type="image/webp" />
  <img src="hero.jpg" width="1200" height="600" />
</picture>
```

**Review points:**
- [ ] Does the LCP element set `fetchpriority="high"`?
- [ ] Are WebP/AVIF formats used?
- [ ] Is there server-side rendering or static generation?
- [ ] Is the CDN configured correctly?

### FCP Optimization Checks

```html
<!-- ❌ Render-blocking CSS -->
<link rel="stylesheet" href="all.css" />

<!-- ✅ Inline critical CSS + load the rest asynchronously -->
<style>/* critical above-the-fold styles */</style>
<link rel="preload" href="rest.css" as="style" onload="this.rel='stylesheet'" />

<!-- ❌ Render-blocking fonts -->
<link href="font.css" rel="stylesheet" />

<!-- ✅ Font display optimization -->
<style>
@font-face {
  font-family: Inter;
  src: url('/inter.woff2') format('woff2');
  font-display: swap;  /* use system font first, then swap when loaded */
}
</style>
```

### INP Optimization Checks

```javascript
// ❌ Long task blocks the main thread
button.addEventListener('click', () => {
  heavySynchronousWork(); // 500ms synchronous operation
});

// ✅ Split long tasks
button.addEventListener('click', async () => {
  await scheduler.yield(); // Yield to the main thread
  await processInChunks(data); // Process in batches
});

// ✅ Use a Web Worker for expensive computation
const worker = new Worker('/worker.js');
worker.postMessage(data);
```

### CLS Optimization Checks

```css
/* ❌ Media without explicit dimensions */
img { max-width: 100%; }

/* ✅ Reserve space */
img { width: 100%; aspect-ratio: 16 / 9; }

/* ❌ Dynamic content causes layout shifts */
.banner { display: none; }
.banner.loaded { display: block; }

/* ✅ Reserve fixed height */
.banner { min-height: 120px; }
```

**CLS checklist:**
- [ ] Images/videos have width/height or aspect-ratio.
- [ ] Font loading uses `font-display: swap`.
- [ ] Dynamic content reserves space.
- [ ] Content is not inserted above existing content when avoidable.

---

## JavaScript Performance

### Code Splitting and Lazy Loading

```javascript
// ❌ Load all code at once
import AdminPanel from './AdminPanel';
import Reports from './Reports';

// ✅ Load on demand
const AdminPanel = lazy(() => import('./AdminPanel'));
const Reports = lazy(() => import('./Reports'));

// ✅ Route-level code splitting
const routes = [
  { path: '/admin', component: lazy(() => import('./routes/Admin')) },
];
```

### Bundle Size Optimization

```javascript
// ❌ Import the whole library
import _ from 'lodash';

// ✅ Import only what is needed
import debounce from 'lodash/debounce';

// ❌ Tree shaking may fail with default object exports
export default {
  fn1() {},
  fn2() {},  // unused but bundled
};

// ✅ Named exports support tree shaking
export function fn1() {}
export function fn2() {}
```

**Bundle checklist:**
- [ ] Dynamic `import()` is used for code splitting.
- [ ] Large libraries are imported on demand.
- [ ] Bundle size has been analyzed (webpack-bundle-analyzer, etc.).
- [ ] Unused dependencies are removed.

### List Rendering Optimization

```tsx
// ❌ Render a huge list
function List({ items }) {
  return items.map(item => <Row key={item.id} item={item} />); // 10,000 items = 10,000 DOM nodes
}

// ✅ Virtual list renders only visible items
import { FixedSizeList } from 'react-window';

function List({ items }) {
  return (
    <FixedSizeList height={600} itemCount={items.length} itemSize={35} width="100%">
      {({ index, style }) => <Row style={style} item={items[index]} />}
    </FixedSizeList>
  );
}
```

**Large data review points:**
- [ ] Lists over 100 items use virtual scrolling.
- [ ] Tables support pagination or virtualization.
- [ ] There is no unnecessary full rendering.

---

## Memory Management

### Common Memory Leaks

#### 1. Uncleaned Event Listeners

```tsx
// ❌ Listener remains after component unmount
useEffect(() => {
  window.addEventListener('resize', onResize);
}, []);

// ✅ Clean up listener
useEffect(() => {
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}, []);
```

#### 2. Uncleaned Timers

```tsx
// ❌ Timer is not cleaned up
useEffect(() => {
  setInterval(fetchData, 1000);
}, []);

// ✅ Clean up timer
useEffect(() => {
  const id = setInterval(fetchData, 1000);
  return () => clearInterval(id);
}, []);
```

#### 3. Closure References

```javascript
// ❌ Closure holds a large object reference
function setup(largeData) {
  return () => {
    console.log(largeData.length); // largeData cannot be collected
  };
}

// ✅ Keep only required data
function setup(largeData) {
  const length = largeData.length; // keep only what is needed
  return () => console.log(length);
}
```

#### 4. Uncleaned Subscriptions

```tsx
// ❌ WebSocket/EventSource is not closed
useEffect(() => {
  const socket = new WebSocket(url);
  socket.onmessage = handleMessage;
}, []);

// ✅ Clean up connection
useEffect(() => {
  const socket = new WebSocket(url);
  socket.onmessage = handleMessage;
  return () => socket.close();
}, []);
```

### Memory Review Checklist

- [ ] Every useEffect that allocates resources has a cleanup function.
- [ ] Event listeners are removed on component unmount.
- [ ] Timers are cleared.
- [ ] WebSocket/SSE connections are closed.
- [ ] Large objects are released promptly.
- [ ] Global variables are not accumulating data indefinitely.

### Detection Tools

| Tool | Use |
|------|-----|
| Chrome DevTools Memory | Heap snapshot analysis |
| MemLab (Meta) | Automated memory leak detection |
| Performance Monitor | Real-time memory monitoring |

---

## Database Performance

### N+1 Query Problem

```python
# ❌ N+1 problem: 1 + N queries
users = User.objects.all()  # 1 query
for user in users:
    print(user.profile.bio)  # N queries, one per user

# ✅ Eager loading: 2 queries
users = User.objects.select_related('profile')
for user in users:
    print(user.profile.bio)  # no extra queries

# ✅ Use prefetch_related for many-to-many relationships
users = User.objects.prefetch_related('groups')
```

```typescript
// TypeORM example
// ❌ N+1 problem
const users = await userRepo.find();
for (const user of users) {
  const posts = await user.posts; // queries every loop
}

// ✅ Join/load relations in one query
const users = await userRepo.find({ relations: ['posts'] });
```

### Index Optimization

```sql
-- ❌ Full table scan
SELECT * FROM users WHERE email = 'a@example.com';

-- ✅ Add index
CREATE INDEX idx_users_email ON users(email);

-- ❌ Index disabled by function operation
SELECT * FROM users WHERE LOWER(email) = 'a@example.com';

-- ✅ Range query can use index
SELECT * FROM orders WHERE created_at >= '2024-01-01';

-- ❌ Index disabled by leading wildcard
SELECT * FROM users WHERE name LIKE '%alice';

-- ✅ Prefix match can use index
SELECT * FROM users WHERE name LIKE 'alice%';
```

### Query Optimization

```sql
-- ❌ SELECT * fetches unnecessary columns
SELECT * FROM orders WHERE user_id = 123;

-- ✅ Fetch only required columns
SELECT id, status, total FROM orders WHERE user_id = 123;

-- ❌ Large table query without LIMIT
SELECT id, name FROM users ORDER BY created_at DESC;

-- ✅ Paginated query
SELECT id, name FROM users ORDER BY created_at DESC LIMIT 50 OFFSET 0;

-- ❌ Query inside a loop
SELECT * FROM users WHERE id = ?;

-- ✅ Batch query
SELECT * FROM users WHERE id IN (?, ?, ?);
```

### Database Review Checklist

🔴 Must check:
- [ ] Are there N+1 queries?
- [ ] Are WHERE-clause columns indexed?
- [ ] Is SELECT * avoided?
- [ ] Do large table queries have LIMIT/pagination?

🟡 Should check:
- [ ] Was EXPLAIN used to analyze query plans?
- [ ] Is composite index column order correct?
- [ ] Are there unused indexes?
- [ ] Are slow query logs monitored?

---

## API Performance

### Pagination

```typescript
// ❌ Return all data
app.get('/users', async (req, res) => {
  const users = await User.findAll(); // may return 100,000 rows
  res.json(users);
});

// ✅ Pagination + maximum page size
app.get('/users', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100); // max 100
  const offset = parseInt(req.query.offset) || 0;
  const users = await User.findAll({ limit, offset });
  res.json(users);
});
```

### Caching Strategy

```typescript
// ✅ Redis cache example
async function getUser(id: string) {
  // 1. Check cache
  const cached = await redis.get(`user:${id}`);
  if (cached) return JSON.parse(cached);

  // 2. Query database
  const user = await User.findByPk(id);

  // 3. Write cache with expiration
  await redis.setex(`user:${id}`, 3600, JSON.stringify(user));
  return user;
}

// ✅ HTTP cache headers
res.set({
  'Cache-Control': 'public, max-age=86400', // 24 hours
  'ETag': etag,
});
```

### Response Compression

```typescript
// ✅ Enable Gzip/Brotli compression
app.use(compression());

// ✅ Return only necessary fields
// Request: GET /users?fields=id,name,email
const fields = req.query.fields?.split(',') ?? ['id', 'name'];
const users = await User.findAll({ attributes: fields });
```

### Rate Limit Protection

```typescript
// ✅ Rate limiting
app.use(rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,            // max 100 requests
}));
```

### API Review Checklist

- [ ] List endpoints are paginated.
- [ ] Maximum page size is limited.
- [ ] Hot data is cached.
- [ ] Response compression is enabled.
- [ ] Rate limiting exists.
- [ ] Responses include only required fields.

---

## Algorithmic Complexity

### Common Complexity Comparison

| Complexity | Name | 10 items | 1,000 items | 1,000,000 items | Example |
|------------|------|----------|-------------|-----------------|---------|
| O(1) | Constant | 1 | 1 | 1 | Hash lookup |
| O(log n) | Logarithmic | 3 | 10 | 20 | Binary search |
| O(n) | Linear | 10 | 1,000 | 1,000,000 | Array traversal |
| O(n log n) | Linearithmic | 33 | 10,000 | 20,000,000 | Quicksort |
| O(n²) | Quadratic | 100 | 1,000,000 | 1,000,000,000,000 | Nested loops |
| O(2ⁿ) | Exponential | 1,024 | ∞ | ∞ | Recursive Fibonacci |

### Spotting It in Code Review

```javascript
// ❌ O(n²): nested loops
for (const user of users) {
  for (const order of orders) {
    if (order.userId === user.id) { ... }
  }
}

// ✅ O(n): use a Set/Map
const ordersByUser = new Map();
for (const order of orders) {
  const list = ordersByUser.get(order.userId) ?? [];
  list.push(order);
  ordersByUser.set(order.userId, list);
}
```

```javascript
// ❌ O(n²): includes inside a loop
const result = [];
for (const item of items) {
  if (!result.includes(item)) { // includes is O(n)
    result.push(item);
  }
}

// ✅ O(n): use a Set
const result = [...new Set(items)];
```

```javascript
// ❌ O(n) lookup: scans every time
const user = users.find(u => u.id === id);

// ✅ O(1) lookup: use a Map
const usersById = new Map(users.map(u => [u.id, u]));
const user = usersById.get(id);
```

### Space Complexity Considerations

```javascript
// ⚠️ O(n) space: creates a new array
const doubled = items.map(x => x * 2);

// ✅ O(1) space: mutate in place if allowed
for (let i = 0; i < items.length; i++) items[i] *= 2;

// ⚠️ Deep recursion may overflow the stack
function factorial(n) {
  return n * factorial(n - 1); // O(n) stack space
}

// ✅ Iterative version uses O(1) space
function factorial(n) {
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}
```

### Complexity Review Comments

- 💡 "This nested loop is O(n²), which may become a performance issue with large inputs."
- 🔴 "Array.includes() is used inside a loop, making this O(n²). Consider a Set."
- 🟡 "This recursion depth may cause stack overflow; consider iteration or tail recursion."

---

## Performance Review Checklist

### 🔴 Must Check (Blocking)

**Frontend:**
- [ ] Is the LCP image lazy-loaded? It should not be.
- [ ] Is `transition: all` used?
- [ ] Are width/height/top/left animated instead of transform/opacity?
- [ ] Are lists over 100 items virtualized?

**Backend:**
- [ ] Are there N+1 queries?
- [ ] Are list endpoints paginated?
- [ ] Is SELECT * used on large tables?

**General:**
- [ ] Are there O(n²) or worse nested loops?
- [ ] Do useEffect/event listeners have cleanup?

### 🟡 Should Check (Important)

**Frontend:**
- [ ] Is code splitting used?
- [ ] Are large libraries imported on demand?
- [ ] Are images WebP/AVIF?
- [ ] Are unused dependencies removed?

**Backend:**
- [ ] Is hot data cached?
- [ ] Are WHERE columns indexed?
- [ ] Is slow query monitoring enabled?

**API:**
- [ ] Is response compression enabled?
- [ ] Is rate limiting enabled?
- [ ] Are only required fields returned?

### 🟢 Optimization Suggestions

- [ ] Has bundle size been analyzed?
- [ ] Is a CDN used?
- [ ] Is performance monitoring in place?
- [ ] Have performance benchmarks been run?

---

## Performance Measurement Thresholds

### Frontend Metrics

| Metric | Good | Needs Improvement | Poor |
|--------|------|-------------------|------|
| LCP | ≤ 2.5s | 2.5s-4s | > 4s |
| INP | ≤ 200ms | 200ms-500ms | > 500ms |
| CLS | ≤ 0.1 | 0.1-0.25 | > 0.25 |
| FCP | ≤ 1.8s | 1.8s-3s | > 3s |
| TBT | ≤ 200ms | 200ms-600ms | > 600ms |

### Backend Metrics

| Metric | Good | Needs Improvement | Poor |
|--------|------|-------------------|------|
| API response time | < 100ms | 100-500ms | > 500ms |
| Database query | < 50ms | 50-200ms | > 200ms |
| Page load | < 3s | 3-5s | > 5s |

---

## Recommended Tools

### Frontend Performance

| Tool | Use |
|------|-----|
| [Lighthouse](https://developer.chrome.com/docs/lighthouse/) | Core Web Vitals testing |
| [WebPageTest](https://www.webpagetest.org/) | Detailed performance analysis |
| [webpack-bundle-analyzer](https://github.com/webpack-contrib/webpack-bundle-analyzer) | Bundle analysis |
| [Chrome DevTools Performance](https://developer.chrome.com/docs/devtools/performance/) | Runtime performance analysis |

### Memory Detection

| Tool | Use |
|------|-----|
| [MemLab](https://github.com/facebookincubator/memlab) | Automated memory leak detection |
| Chrome Memory Tab | Heap snapshot analysis |

### Backend Performance

| Tool | Use |
|------|-----|
| EXPLAIN | Database query plan analysis |
| [pganalyze](https://pganalyze.com/) | PostgreSQL performance monitoring |
| [New Relic](https://newrelic.com/) / [Datadog](https://www.datadoghq.com/) | APM monitoring |

---

## Low-Level Efficiency Anti-Patterns

Code-level efficiency mistakes, separate from architectural performance issues. This complements the resource-management and concurrency issues covered in [common-bugs-checklist.md](common-bugs-checklist.md).

### Unnecessary Repeated Work

- [ ] Is the same function/query called repeatedly within the same request/render?
- [ ] Are files/configs reread inside loops when they are loop-invariant?
- [ ] Can computed results be cached or passed downstream?

```python
# ❌ Loop-invariant work repeated inside the loop
for user in users:
    config = load_config()
    process(user, config)

# ✅ Move it outside the loop
config = load_config()
for user in users:
    process(user, config)
```

### Missed Concurrency Opportunities

- [ ] Are independent async operations awaited sequentially?
- [ ] Could `Promise.all` / `asyncio.gather` / `tokio::join!` run them concurrently?

```typescript
// ❌ Sequential await
const user = await fetchUser(id);
const posts = await fetchPosts(id);

// ✅ Concurrent
const [user, posts] = await Promise.all([fetchUser(id), fetchPosts(id)]);
```

### Hot Path Bloat

- [ ] Does module-level/import-time code do heavy work (file I/O, network, large object construction)?
- [ ] Does a per-request path contain initialization that can be deferred?
- [ ] Does startup code block the first request?

### Unbounded Data Structures

> Resource lifecycle bugs (unclosed connections, unremoved listeners, uncleared timers) are covered in [common-bugs-checklist.md → Resource Management](common-bugs-checklist.md#resource-management). This section focuses on capacity bounds.

- [ ] Do global dicts/lists/caches have a max size or TTL?
- [ ] Do accumulating structures (queues, logs, metrics buffers) have upper bounds?
- [ ] Are per-request objects retained by long-lived references and therefore unable to be garbage-collected?

```python
# ❌ Unbounded cache
cache = {}
def get_user(id):
    cache[id] = fetch_user(id)
    return cache[id]

# ✅ Bounded LRU
@lru_cache(maxsize=1000)
def get_user(id):
    return fetch_user(id)
```

---

## References

- [web.dev Core Web Vitals](https://web.dev/vitals/)
- [Chrome DevTools Performance](https://developer.chrome.com/docs/devtools/performance/)
- [Use The Index, Luke](https://use-the-index-luke.com/)
- [PostgreSQL EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html)
