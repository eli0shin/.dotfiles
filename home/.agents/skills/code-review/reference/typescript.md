# TypeScript/JavaScript Code Review Guide

> TypeScript code review guide covering the type system, generics, conditional types, strict mode, async/await patterns, and other core topics.

## Table of Contents

- [Type Safety Basics](#type-safety-basics)
- [Generic Patterns](#generic-patterns)
- [Advanced Types](#advanced-types)
- [Strict Mode Configuration](#strict-mode-configuration)
- [Async Handling](#async-handling)
- [Immutability](#immutability)
- [ESLint Rules](#eslint-rules)
- [Review Checklist](#review-checklist)

---

## Type Safety Basics

### Avoid any

```typescript
// ❌ Using any defeats type safety
function processData(data: any) {
  return data.value;  // No type checking; may crash at runtime
}

// ✅ Use proper types
type DataPayload  ={
  value: string;
}
function processData(data: DataPayload) {
  return data.value;
}

// ✅ Use unknown + type guards for unknown data
function processUnknown(data: unknown) {
  if (typeof data === 'object' && data !== null && 'value' in data) {
    return (data as { value: string }).value;
  }
  throw new Error('Invalid data');
}
```

### Type Narrowing

```typescript
// ❌ Unsafe type assertion
function getLength(value: string | string[]) {
  return (value as string[]).length;  // Fails if value is a string
}

// ✅ Use type guards
function getLength(value: string | string[]): number {
  if (Array.isArray(value)) {
    return value.length;
  }
  return value.length;
}

// ✅ Use the in operator
type Dog = { bark(): void }
type Cat = { meow(): void }

function speak(animal: Dog | Cat) {
  if ('bark' in animal) {
    animal.bark();
  } else {
    animal.meow();
  }
}
```

### Literal Types and as const

```typescript
// ❌ Type is too broad
const config = {
  endpoint: '/api',
  method: 'GET'  // Type is string
};

// ✅ Use as const to get literal types
const config = {
  endpoint: '/api',
  method: 'GET'
} as const;  // method type is 'GET'

// ✅ Use for function parameters
function request(method: 'GET' | 'POST', url: string) { ... }
request(config.method, config.endpoint);  // Correct!
```

---

## Generic Patterns

### Basic Generics

```typescript
// ❌ Repeated code
function getFirstString(arr: string[]): string | undefined {
  return arr[0];
}
function getFirstNumber(arr: number[]): number | undefined {
  return arr[0];
}

// ✅ Use generics
function getFirst<T>(arr: T[]): T | undefined {
  return arr[0];
}
```

### Generic Constraints

```typescript
// ❌ Generic has no constraint, so properties cannot be accessed
function getProperty<T>(obj: T, key: string) {
  return obj[key];  // Error: cannot index
}

// ✅ Use a keyof constraint
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}

const user = { name: 'Alice', age: 30 };
getProperty(user, 'name');  // Return type is string
getProperty(user, 'age');   // Return type is number
getProperty(user, 'foo');   // Error: 'foo' is not in keyof User
```

### Generic Defaults

```typescript
// ✅ Provide a sensible default type
type ApiResponse<T = unknown> = {
  data: T;
  status: number;
  message: string;
}

// The generic parameter can be omitted
const response: ApiResponse = { data: null, status: 200, message: 'OK' };
// Or specified explicitly
const userResponse: ApiResponse<User> = { ... };
```

### Common Generic Utility Types

```typescript
// ✅ Make good use of built-in utility types
type User = {
  id: number;
  name: string;
  email: string;
}

type PartialUser = Partial<User>;         // All properties optional
type RequiredUser = Required<User>;       // All properties required
type ReadonlyUser = Readonly<User>;       // All properties readonly
type UserKeys = keyof User;               // 'id' | 'name' | 'email'
type NameOnly = Pick<User, 'name'>;       // { name: string }
type WithoutId = Omit<User, 'id'>;        // { name: string; email: string }
type UserRecord = Record<string, User>;   // { [key: string]: User }
```

---

## Advanced Types

### Conditional Types

```typescript
// ✅ Return different types based on the input type
type IsString<T> = T extends string ? true : false;

type A = IsString<string>;  // true
type B = IsString<number>;  // false

// ✅ Extract an array element type
type ElementType<T> = T extends (infer U)[] ? U : never;

type Elem = ElementType<string[]>;  // string

// ✅ Extract a function return type (built-in ReturnType)
type MyReturnType<T> = T extends (...args: any[]) => infer R ? R : never;
```

### Mapped Types

```typescript
// ✅ Transform all properties of an object type
type Nullable<T> = {
  [K in keyof T]: T[K] | null;
};

interface User {
  name: string;
  age: number;
}

type NullableUser = Nullable<User>;
// { name: string | null; age: number | null }

// ✅ Add a prefix
type Getters<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K];
};

type UserGetters = Getters<User>;
// { getName: () => string; getAge: () => number }
```

### Template Literal Types

```typescript
// ✅ Type-safe event names
type EventName = 'click' | 'focus' | 'blur';
type HandlerName = `on${Capitalize<EventName>}`;
// 'onClick' | 'onFocus' | 'onBlur'

// ✅ API route type
type ApiRoute = `/api/${string}`;
const route: ApiRoute = '/api/users';  // OK
const badRoute: ApiRoute = '/users';   // Error
```

### Discriminated Unions

```typescript
// ✅ Use a discriminant property for type safety
type Result<T, E> =
  | { success: true; data: T }
  | { success: false; error: E };

function handleResult(result: Result<User, Error>) {
  if (result.success) {
    console.log(result.data.name);  // TypeScript knows data exists
  } else {
    console.log(result.error.message);  // TypeScript knows error exists
  }
}

// ✅ Redux Action pattern
type Action =
  | { type: 'INCREMENT'; payload: number }
  | { type: 'DECREMENT'; payload: number }
  | { type: 'RESET' };

function reducer(state: number, action: Action): number {
  switch (action.type) {
    case 'INCREMENT':
      return state + action.payload;  // payload type is known
    case 'DECREMENT':
      return state - action.payload;
    case 'RESET':
      return 0;  // No payload here
  }
}
```

---

## Strict Mode Configuration

### Recommended tsconfig.json

```json
{
  "compilerOptions": {
    // ✅ Required strict options
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "useUnknownInCatchVariables": true,

    // ✅ Additional recommended options
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "noPropertyAccessFromIndexSignature": true
  }
}
```

### Impact of noUncheckedIndexedAccess

```typescript
// tsconfig: "noUncheckedIndexedAccess": true

const arr = [1, 2, 3];
const first = arr[0];  // Type is number | undefined

// ❌ Direct use may fail
console.log(first.toFixed(2));  // Error: may be undefined

// ✅ Check first
if (first !== undefined) {
  console.log(first.toFixed(2));
}

// ✅ Or use a non-null assertion when certain
console.log(arr[0]!.toFixed(2));
```

---

## Async Handling

### Promise Error Handling

```typescript
// ❌ Not handling async errors
async function fetchUser(id: string) {
  const response = await fetch(`/api/users/${id}`);
  return response.json();  // Network errors are not handled
}

// ✅ Handle errors properly
async function fetchUser(id: string): Promise<User> {
  try {
    const response = await fetch(`/api/users/${id}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to fetch user: ${error.message}`);
    }
    throw error;
  }
}
```

### Promise.all vs Promise.allSettled

```typescript
// ❌ Promise.all fails everything if one promise fails
async function fetchAllUsers(ids: string[]) {
  const users = await Promise.all(ids.map(fetchUser));
  return users;  // One failure fails the whole operation
}

// ✅ Promise.allSettled gets all results
async function fetchAllUsers(ids: string[]) {
  const results = await Promise.allSettled(ids.map(fetchUser));

  const users: User[] = [];
  const errors: Error[] = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      users.push(result.value);
    } else {
      errors.push(result.reason);
    }
  }

  return { users, errors };
}
```

### Race Condition Handling

```typescript
// ❌ Race condition: an older request may overwrite a newer one
function useSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);

  useEffect(() => {
    fetch(`/api/search?q=${query}`)
      .then(r => r.json())
      .then(setResults);  // An older request may return later!
  }, [query]);
}

// ✅ Use AbortController
function useSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/search?q=${query}`, { signal: controller.signal })
      .then(r => r.json())
      .then(setResults)
      .catch(e => {
        if (e.name !== 'AbortError') throw e;
      });

    return () => controller.abort();
  }, [query]);
}
```

---

## Immutability

### Readonly and ReadonlyArray

```typescript
// ❌ Mutable parameters may be modified accidentally
function processUsers(users: User[]) {
  users.sort((a, b) => a.name.localeCompare(b.name));  // Mutates the original array!
  return users;
}

// ✅ Use readonly to prevent mutation
function processUsers(users: readonly User[]): User[] {
  return [...users].sort((a, b) => a.name.localeCompare(b.name));
}

// ✅ Deep readonly
type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K];
};
```

### Immutable Function Parameters

```typescript
// ✅ Use as const and readonly to protect data
function createConfig<T extends readonly string[]>(routes: T) {
  return routes;
}

const routes = createConfig(['home', 'about', 'contact'] as const);
// Type is readonly ['home', 'about', 'contact']
```

---

## ESLint Rules

### Recommended @typescript-eslint Rules

```javascript
// eslint.config.js (flat config, typescript-eslint v8)
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  // Rulesets that require type information; equivalent to the old recommended-requiring-type-checking
  tseslint.configs.recommendedTypeChecked,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Let typed rules automatically find the relevant tsconfig
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ✅ Type safety
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',

      // ✅ Best practices
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // ✅ Code style
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
    },
  },
);
```

### Common ESLint Error Fixes

```typescript
// ❌ no-floating-promises: promises must be handled
async function save() { ... }
save();  // Error: unhandled Promise

// ✅ Handle explicitly
await save();
// Or
save().catch(console.error);
// Or ignore explicitly
void save();

// ❌ no-misused-promises: cannot use a Promise in a non-async position
const items = [1, 2, 3];
items.forEach(async (item) => {  // Error!
  await processItem(item);
});

// ✅ Use for...of
for (const item of items) {
  await processItem(item);
}
// Or Promise.all
await Promise.all(items.map(processItem));
```

---

## Review Checklist

### Type System
- [ ] No `any` usage (use `unknown` + type guards instead)
- [ ] Interfaces and type definitions are complete and meaningfully named
- [ ] Generics are used to improve reuse
- [ ] Union types are narrowed correctly
- [ ] Utility types are used well (Partial, Pick, Omit, etc.)

### Generics
- [ ] Generics have appropriate constraints (`extends`)
- [ ] Generic parameters have sensible defaults
- [ ] Avoid over-generalizing with generics (KISS principle)

### Strict Mode
- [ ] tsconfig.json enables `strict: true`
- [ ] noUncheckedIndexedAccess is enabled
- [ ] No @ts-ignore (use @ts-expect-error instead)

### Async Code
- [ ] async functions handle errors
- [ ] Promise rejections are handled correctly
- [ ] No floating promises (unhandled promises)
- [ ] Concurrent requests use Promise.all or Promise.allSettled
- [ ] Race conditions are handled with AbortController

### Immutability
- [ ] Function parameters are not mutated directly
- [ ] Spread syntax is used to create new objects/arrays
- [ ] Consider using readonly modifiers

### ESLint
- [ ] @typescript-eslint/recommended is used
- [ ] No ESLint warnings or errors
- [ ] consistent-type-imports is used
