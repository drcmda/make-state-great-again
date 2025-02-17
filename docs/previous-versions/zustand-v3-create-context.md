---
title: createContext from zustand/context
nav: 21
---

A special `createContext` is provided since v3.5,
which avoids misusing the store hook.

> **Note**: This function is deprecated in v4 and will be removed in v5. See [Migration](#migration).

```jsx
import create from 'zustand'
import createContext from 'zustand/context'

const { Provider, useStore } = createContext()

const createStore = () => create(...)

const App = () => (
  <Provider createStore={createStore}>
    ...
  </Provider>
)

const Component = () => {
  const state = useStore()
  const slice = useStore(selector)
  ...
```

## createContext usage in real components

```jsx
import create from "zustand";
import createContext from "zustand/context";

// Best practice: You can move the below createContext() and createStore to a separate file(store.js) and import the Provider, useStore here/wherever you need.

const { Provider, useStore } = createContext();

const createStore = () =>
  create((set) => ({
    bears: 0,
    increasePopulation: () => set((state) => ({ bears: state.bears + 1 })),
    removeAllBears: () => set({ bears: 0 })
  }));

const Button = () => {
  return (
      {/** store() - This will create a store for each time using the Button component instead of using one store for all components **/}
    <Provider createStore={createStore}>
      <ButtonChild />
    </Provider>
  );
};

const ButtonChild = () => {
  const state = useStore();
  return (
    <div>
      {state.bears}
      <button
        onClick={() => {
          state.increasePopulation();
        }}
      >
        +
      </button>
    </div>
  );
};

export default function App() {
  return (
    <div className="App">
      <Button />
      <Button />
    </div>
  );
}
```

## createContext usage with initialization from props

```tsx
import create from 'zustand'
import createContext from 'zustand/context'

const { Provider, useStore } = createContext()

export default function App({ initialBears }) {
  return (
    <Provider
      createStore={() =>
        create((set) => ({
          bears: initialBears,
          increase: () => set((state) => ({ bears: state.bears + 1 })),
        }))
      }
    >
      <Button />
    </Provider>
  )
}
```

## Migration

Discussion: https://github.com/pmndrs/zustand/discussions/1276

Here's the new context usage with v4 API.

```jsx
import { createContext, useContext, useState } from 'react'
import { createStore, useStore } from 'zustand'

const StoreContext = createContext(null)

const StoreProvider = ({ children }) => {
  const [store] = useState(() =>
    createStore((set) => ({
      // ...
    }))
  )
  return (
    <StoreContext.Provider value={store}>
      {children}
    </StoreContext.Provider>
  )
}

const useStoreInContext = (selector) => {
  const store = useContext(StoreContext)
  if (!store) {
    throw new Error('Missing StoreProvider')
  }
  return useStore(store, selector)
}
```

Or reach out to some third-party libraries that provide Zustand v3-like APIs:

- <https://github.com/charkour/zustand-di>
- <https://github.com/arvinxx/zustand-utils>
