---
title: TypeScript Guide
nav: 7
---

## Basic usage

The difference when using TypeScript is that instead of writing `create(...)`, you have to write `create<T>()(...)` (notice the extra parentheses `()` too along with the type parameter) where `T` is the type of the state to annotate it. For example:

```ts
import { create } from 'zustand'

interface BearState {
  bears: number
  increase: (by: number) => void
}

const useBearStore = create<BearState>()((set) => ({
  bears: 0,
  increase: (by) => set((state) => ({ bears: state.bears + by })),
}))
```

<details>
  <summary>Why can't we simply infer the type from the initial state?</summary>

  <br/>

**TLDR**: Because we just provide the information for the returned type but no information for the parameter type.

Consider this minimal version `create`:

```ts
declare const create: <T>(f: (get: () => T) => T) => T
const x = create(() => ({
  foo: 0,
  bar: '',
}))
// const x: { foo: number; bar: string; }
```

Here, if we do not provide a `get` param for `f` function, `x` can be inferred properly. However, if we provide the `get` function

```ts
declare const create: <T>(f: (get: () => T) => T) => T
const x = create((get) => ({
  foo: 0,
  bar: () => get(),
}))
// const x: unknown
```

`x` is inferred as `unknown`, why the difference? Let us walk through how TS Engine binds the type.

In the first case, the engine try to match `() => ({foo: 0, bar: ''})` and `(get: () => T) => T`. Based on the return type, the engine binds `T` with `{foo: 0, bar: ''}`, after doing that, all the constraint are met, it will not bother to match the parameter type because there is no parameter and will always match. Remember that `()=>number` is perfectly assignable to `(x:number)=>number`

In the second case, the engine tries to match `(get) => ({foo: 0, bar: ''})` and `(get: () => T) => T`, This time, the engine sees that the `get` parameter **DOES** exist, so the strategy is different from the previous one, it **must** match it. However, `get` has an implicit `any` type without other hint to match `()=>T`, so `T` is inferred as `unknown`. Now, `T` is inferred as `unknown` in the parameter type and `{foo: 0, bar: ''}` in the return type. Finally, `T` is inferred as `unknown | {foo: 0, bar: ''}` which is `unknown`.

If we provide some hints for the parameter type, it works again

```ts
const x = create((get: () => { foo: number }) => ({
  foo: 0,
  bar: '',
}))
// { foo: number; bar: string; }
```

Note that x is inferred as `{foo:number;bar:string}` rather then `{foo:number;bar:string}`.
Note that `{foo:number;bar:string} |{ foo:number } = {foo:number;bar:string}`

In the real-world scenario, we know that the creator is useful only when we have a `get` function as a parameter of it. So we have to match the second version of the signature where `T` is inferred as `unknown` for sure. To fix the problem, we have to choose to annotate the type explicitly, inferring type automatically simply will not work for the reason above.

</details>

<details>
  <summary>Why the currying `()(...)`?</summary>

  <br/>

**TLDR**: It is a workaround for [microsoft/TypeScript#10571](https://github.com/microsoft/TypeScript/issues/10571).

Imagine you have a scenario like this:

```ts
declare const withError: <T, E>(
  p: Promise<T>,
) => Promise<[error: undefined, value: T] | [error: E, value: undefined]>
declare const doSomething: () => Promise<string>

const main = async () => {
  let [error, value] = await withError(doSomething())
}
```

Here, `T` is inferred to be a `string` and `E` is inferred to be `unknown`. You might want to annotate `E` as `Foo`, because you are certain of the shape of error `doSomething()` would throw. However, you can't do that. You can either pass all generics or none. Along with annotating `E` as `Foo`, you will also have to annotate `T` as `string` even though it gets inferred anyway. The solution is to make a curried version of `withError` that does nothing at runtime. Its purpose is to just allow you annotate `E`.

```ts
declare const withError: {
  <E>(): <T>(
    p: Promise<T>,
  ) => Promise<[error: undefined, value: T] | [error: E, value: undefined]>
  <T, E>(
    p: Promise<T>,
  ): Promise<[error: undefined, value: T] | [error: E, value: undefined]>
}
declare const doSomething: () => Promise<string>
interface Foo {
  bar: string
}

const main = async () => {
  let [error, value] = await withError<Foo>()(doSomething())
}
```

This way, `T` gets inferred and you get to annotate `E`. Zustand has the same use case when we want to annotate the state (the first type parameter) but allow other parameters to get inferred.

</details>

Alternatively, you can also use `combine`, which infers the state so that you do not need to type it.

```ts
import { create } from 'zustand'
import { combine } from 'zustand/middleware'

const useBearStore = create(
  combine({ bears: 0 }, (set) => ({
    increase: (by: number) => set((state) => ({ bears: state.bears + by })),
  })),
)
```

<details>
  <summary>Be a little careful</summary>

  <br/>

We achieve the inference by lying a little in the types of `set`, `get`, and `store` that you receive as parameters. The lie is that they're typed as if the state is the first parameter, when in fact the state is the shallow-merge (`{ ...a, ...b }`) of both first parameter and the second parameter's return. For example, `get` from the second parameter has type `() => { bears: number }` and that is a lie as it should be `() => { bears: number, increase: (by: number) => void }`. And `useBearStore` still has the correct type; for example, `useBearStore.getState` is typed as `() => { bears: number, increase: (by: number) => void }`.

It isn't really a lie because `{ bears: number }` is still a subtype of `{ bears: number, increase: (by: number) => void }`. Therefore, there will be no problem in most cases. You should just be careful while using replace. For example, `set({ bears: 0 }, true)` would compile but will be unsound as it will delete the `increase` function. Another instance where you should be careful is if you use `Object.keys`. `Object.keys(get())` will return `["bears", "increase"]` and not `["bears"]`. The return type of `get` can make you fall for these mistakes.

`combine` trades off a little type-safety for the convenience of not having to write a type for state. Hence, you should use `combine` accordingly. It is fine in most cases and you can use it conveniently.

</details>

Note that we don't use the curried version when using `combine` because `combine` "creates" the state. When using a middleware that creates the state, it isn't necessary to use the curried version because the state now can be inferred. Another middleware that creates state is `redux`. So when using `combine`, `redux`, or any other custom middleware that creates the state, we don't recommend using the curried version.

If you want to infer state type also outside of state declaration, you can use the `ExtractState` type helper:

```ts
import { create, ExtractState } from 'zustand'
import { combine } from 'zustand/middleware'

type BearState = ExtractState<typeof useBearStore>

const useBearStore = create(
  combine({ bears: 0 }, (set) => ({
    increase: (by: number) => set((state) => ({ bears: state.bears + by })),
  })),
)
```

## Using middlewares

You do not have to do anything special to use middlewares in TypeScript.

```ts
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

interface BearState {
  bears: number
  increase: (by: number) => void
}

const useBearStore = create<BearState>()(
  devtools(
    persist(
      (set) => ({
        bears: 0,
        increase: (by) => set((state) => ({ bears: state.bears + by })),
      }),
      { name: 'bearStore' },
    ),
  ),
)
```

Just make sure you are using them immediately inside `create` so as to make the contextual inference work. Doing something even remotely fancy like the following `myMiddlewares` would require more advanced types.

```ts
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

const myMiddlewares = (f) => devtools(persist(f, { name: 'bearStore' }))

interface BearState {
  bears: number
  increase: (by: number) => void
}

const useBearStore = create<BearState>()(
  myMiddlewares((set) => ({
    bears: 0,
    increase: (by) => set((state) => ({ bears: state.bears + by })),
  })),
)
```

Also, we recommend using `devtools` middleware as last as possible. For example, when you use it with `immer` as a middleware, it should be `devtools(immer(...))` and not `immer(devtools(...))`. This is because`devtools` mutates the `setState` and adds a type parameter on it, which could get lost if other middlewares (like `immer`) also mutate `setState` before `devtools`. Hence using `devtools` at the end makes sure that no middlewares mutate `setState` before it.

## Authoring middlewares and advanced usage

Imagine you had to write this hypothetical middleware.

```ts
import { create } from 'zustand'

const foo = (f, bar) => (set, get, store) => {
  store.foo = bar
  return f(set, get, store)
}

const useBearStore = create(foo(() => ({ bears: 0 }), 'hello'))
console.log(useBearStore.foo.toUpperCase())
```

Zustand middlewares can mutate the store. But how could we possibly encode the mutation on the type-level? That is to say how could we type `foo` so that this code compiles?

For a usual statically typed language, this is impossible. But thanks to TypeScript, Zustand has something called a "higher-kinded mutator" that makes this possible. If you are dealing with complex type problems, like typing a middleware or using the `StateCreator` type, you will have to understand this implementation detail. For this, you can [check out #710](https://github.com/pmndrs/zustand/issues/710).

If you are eager to know what the answer is to this particular problem then you can [see it here](#middleware-that-changes-the-store-type).

### Handling Dynamic `replace` Flag

If the value of the `replace` flag is not known at compile time and is determined dynamically, you might face issues. To handle this, you can use a workaround by annotating the `replace` parameter with the parameters of the `setState` function:

```ts
const replaceFlag = Math.random() > 0.5
const args = [{ bears: 5 }, replaceFlag] as Parameters<
  typeof useBearStore.setState
>
store.setState(...args)
```

#### Example with `as Parameters` Workaround

```ts
import { create } from 'zustand'

interface BearState {
  bears: number
  increase: (by: number) => void
}

const useBearStore = create<BearState>()((set) => ({
  bears: 0,
  increase: (by) => set((state) => ({ bears: state.bears + by })),
}))

const replaceFlag = Math.random() > 0.5
const args = [{ bears: 5 }, replaceFlag] as Parameters<
  typeof useBearStore.setState
>
useBearStore.setState(...args) // Using the workaround
```

By following this approach, you can ensure that your code handles dynamic `replace` flags without encountering type issues.

## Common recipes

### Middleware that doesn't change the store type

```ts
import { create, StateCreator, StoreMutatorIdentifier } from 'zustand'

type Logger = <
  T,
  Mps extends [StoreMutatorIdentifier, unknown][] = [],
  Mcs extends [StoreMutatorIdentifier, unknown][] = [],
>(
  f: StateCreator<T, Mps, Mcs>,
  name?: string,
) => StateCreator<T, Mps, Mcs>

type LoggerImpl = <T>(
  f: StateCreator<T, [], []>,
  name?: string,
) => StateCreator<T, [], []>

const loggerImpl: LoggerImpl = (f, name) => (set, get, store) => {
  const loggedSet: typeof set = (...a) => {
    set(...(a as Parameters<typeof set>))
    console.log(...(name ? [`${name}:`] : []), get())
  }
  const setState = store.setState
  store.setState = (...a) => {
    setState(...(a as Parameters<typeof setState>))
    console.log(...(name ? [`${name}:`] : []), store.getState())
  }

  return f(loggedSet, get, store)
}

export const logger = loggerImpl as unknown as Logger

// ---

const useBearStore = create<BearState>()(
  logger(
    (set) => ({
      bears: 0,
      increase: (by) => set((state) => ({ bears: state.bears + by })),
    }),
    'bear-store',
  ),
)
```

### Middleware that changes the store type

```ts
import {
  create,
  StateCreator,
  StoreMutatorIdentifier,
  Mutate,
  StoreApi,
} from 'zustand'

type Foo = <
  T,
  A,
  Mps extends [StoreMutatorIdentifier, unknown][] = [],
  Mcs extends [StoreMutatorIdentifier, unknown][] = [],
>(
  f: StateCreator<T, [...Mps, ['foo', A]], Mcs>,
  bar: A,
) => StateCreator<T, Mps, [['foo', A], ...Mcs]>

declare module 'zustand' {
  interface StoreMutators<S, A> {
    foo: Write<Cast<S, object>, { foo: A }>
  }
}

type FooImpl = <T, A>(
  f: StateCreator<T, [], []>,
  bar: A,
) => StateCreator<T, [], []>

const fooImpl: FooImpl = (f, bar) => (set, get, _store) => {
  type T = ReturnType<typeof f>
  type A = typeof bar

  const store = _store as Mutate<StoreApi<T>, [['foo', A]]>
  store.foo = bar
  return f(set, get, _store)
}

export const foo = fooImpl as unknown as Foo

type Write<T extends object, U extends object> = Omit<T, keyof U> & U

type Cast<T, U> = T extends U ? T : U

// ---

const useBearStore = create(foo(() => ({ bears: 0 }), 'hello'))
console.log(useBearStore.foo.toUpperCase())
```

### `create` without curried workaround

The recommended way to use `create` is using the curried workaround like so: `create<T>()(...)`. This is because it enables you to infer the store type. But if for some reason you do not want to use the workaround, you can pass the type parameters like the following. Note that in some cases, this acts as an assertion instead of annotation, so we don't recommend it.

```ts
import { create } from "zustand"

interface BearState {
  bears: number
  increase: (by: number) => void
}

const useBearStore = create<
  BearState,
  [
    ['zustand/persist', BearState],
    ['zustand/devtools', never]
  ]
>(devtools(persist((set) => ({
  bears: 0,
  increase: (by) => set((state) => ({ bears: state.bears + by })),
}), { name: 'bearStore' }))
```

### Slices pattern

```ts
import { create, StateCreator } from 'zustand'

interface BearSlice {
  bears: number
  addBear: () => void
  eatFish: () => void
}

interface FishSlice {
  fishes: number
  addFish: () => void
}

interface SharedSlice {
  addBoth: () => void
  getBoth: () => void
}

const createBearSlice: StateCreator<
  BearSlice & FishSlice,
  [],
  [],
  BearSlice
> = (set) => ({
  bears: 0,
  addBear: () => set((state) => ({ bears: state.bears + 1 })),
  eatFish: () => set((state) => ({ fishes: state.fishes - 1 })),
})

const createFishSlice: StateCreator<
  BearSlice & FishSlice,
  [],
  [],
  FishSlice
> = (set) => ({
  fishes: 0,
  addFish: () => set((state) => ({ fishes: state.fishes + 1 })),
})

const createSharedSlice: StateCreator<
  BearSlice & FishSlice,
  [],
  [],
  SharedSlice
> = (set, get) => ({
  addBoth: () => {
    // you can reuse previous methods
    get().addBear()
    get().addFish()
    // or do them from scratch
    // set((state) => ({ bears: state.bears + 1, fishes: state.fishes + 1 })
  },
  getBoth: () => get().bears + get().fishes,
})

const useBoundStore = create<BearSlice & FishSlice & SharedSlice>()((...a) => ({
  ...createBearSlice(...a),
  ...createFishSlice(...a),
  ...createSharedSlice(...a),
}))
```

A detailed explanation on the slices pattern can be found [here](./slices-pattern.md).

If you have some middlewares then replace `StateCreator<MyState, [], [], MySlice>` with `StateCreator<MyState, Mutators, [], MySlice>`. For example, if you are using `devtools` then it will be `StateCreator<MyState, [["zustand/devtools", never]], [], MySlice>`. See the ["Middlewares and their mutators reference"](#middlewares-and-their-mutators-reference) section for a list of all mutators.

### Bounded `useStore` hook for vanilla stores

```ts
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

interface BearState {
  bears: number
  increase: (by: number) => void
}

const bearStore = createStore<BearState>()((set) => ({
  bears: 0,
  increase: (by) => set((state) => ({ bears: state.bears + by })),
}))

function useBearStore(): BearState
function useBearStore<T>(selector: (state: BearState) => T): T
function useBearStore<T>(selector?: (state: BearState) => T) {
  return useStore(bearStore, selector!)
}
```

You can also make an abstract `createBoundedUseStore` function if you need to create bounded `useStore` hooks often and want to DRY things up...

```ts
import { useStore, StoreApi } from 'zustand'
import { createStore } from 'zustand/vanilla'

interface BearState {
  bears: number
  increase: (by: number) => void
}

const bearStore = createStore<BearState>()((set) => ({
  bears: 0,
  increase: (by) => set((state) => ({ bears: state.bears + by })),
}))

const createBoundedUseStore = ((store) => (selector) =>
  useStore(store, selector)) as <S extends StoreApi<unknown>>(
  store: S,
) => {
  (): ExtractState<S>
  <T>(selector: (state: ExtractState<S>) => T): T
}

type ExtractState<S> = S extends { getState: () => infer X } ? X : never

const useBearStore = createBoundedUseStore(bearStore)
```

## Middlewares and their mutators reference

- `devtools` — `["zustand/devtools", never]`
- `persist` — `["zustand/persist", YourPersistedState]`<br/>
  `YourPersistedState` is the type of state you are going to persist, ie the return type of `options.partialize`, if you're not passing `partialize` options the `YourPersistedState` becomes `Partial<YourState>`. Also [sometimes](https://github.com/pmndrs/zustand/issues/980#issuecomment-1162289836) passing actual `PersistedState` won't work. In those cases, try passing `unknown`.
- `immer` — `["zustand/immer", never]`
- `subscribeWithSelector` — `["zustand/subscribeWithSelector", never]`
- `redux` — `["zustand/redux", YourAction]`
- `combine` — no mutator as `combine` does not mutate the store
