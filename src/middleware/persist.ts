import { Store, UnknownState, StoreInitializer, TagStore } from '../vanilla'
import { thenablify, Thenable } from './utils'

// ============================================================================
// Types

type Persist =
  < T extends UnknownState
  , S extends Store<T>
  , U = T
  >
    ( storeInitializer:
      & ( ( set: (S & PersistStore<T>)['setState']
          , get: (S & PersistStore<T>)['getState']
          , store: S & PersistStore<T>
          ) =>
            T
        )
      & TagStore<S>
    , options: PersistOptions<T, U>
    ) =>
      StoreInitializer<T, S & PersistStore<T, U>>

interface PersistOptions<T extends UnknownState, U>
  {
    /** Name of the storage (must be unique) */
    name: string
    
    /**
     * A function returning a storage.
     * The storage must fit `window.localStorage`'s api (or an async version of it).
     * For example the storage could be `AsyncStorage` from React Native.
     *
     * @default () => localStorage
     */
    getStorage?: () => PersistentStorage

    /**
     * Use a custom serializer.
     * The returned string will be stored in the storage.
     *
     * @default JSON.stringify
     */
    serialize?:
      (storageValue: PersistentStorageValue<U>) => MaybePromise<string>

    /**
     * Use a custom deserializer.
     * Must return an object matching PersistentStorageValue<State>
     *
     * @param serializedString The storage's current value.
     * @default JSON.parse
     */
    deserialize?:
      (serializedString: string) => MaybePromise<PersistentStorageValue<T>>

    /**
     * Filter the persisted value.
     *
     * @param state The state's value
     */
    partialize?: (state: T) => U
    
    /**
     * A function returning another (optional) function.
     * The main function will be called before the state rehydration.
     * The returned function will be called after the state rehydration or when an error occurred.
     */
    onRehydrateStorage?:
      (state: T) =>
        void | ((state?: T, error?: unknown) => void)

    /**
     * If the stored state's version mismatch the one specified here, the storage will not be used.
     * This is useful when adding a breaking change to your store.
     */
    version?: number

    /**
     * A function to perform persisted state migration.
     * This function will be called when persisted state versions mismatch with the one specified here.
     */
    migrate?:
      (persistedState: unknown, version: number) => MaybePromise<T>

    /**
     * A function to perform custom hydration merges when combining the stored state with the current one.
     * By default, this function does a shallow merge.
     */
    merge?:
      (persistedState: unknown, currentState: T) => T
  }

interface PersistentStorage
  { getItem: (name: string) => string | null | Promise<string | null>
  , setItem: (name: string, value: string) => void | Promise<void>
  , removeItem: (name: string) => void | Promise<void>
  }

interface PersistentStorageValue<T>
  { state: T
  , version?: number
  }

interface PersistStore<T extends UnknownState, U = T>
  { persist:
      { setOptions: (options: O.Partial<PersistOptions<T, U>>) => void
      , clearStorage: () => void
      , rehydrate: () => Thenable<void>
      , hasHydrated: () => boolean
      , onHydrate: (listener: (state: T) => void) => () => void
      , onFinishHydration: (listener: (state: T) => void) => () => void
      }
  }




// ============================================================================
// Implementation

type EState = { __isState: true }
type ESelectedState = { __isSelectedState: true }
type EPersistentStorageName = string & { __isPersistentStorageName: true }
type EPersistentStorageValue =
  { state: ESelectedState
  , version?: number & { __isPersistentStorageValueVersion: true } 
  }

type EPersist =
    ( storeInitializer: StoreInitializer<EState, Store<EState>>
    , options: EPersistOptions
    ) =>
    StoreInitializer<EState, Store<EState> & EPersistStore>

interface EPersistOptions
  { name: EPersistentStorageName
  , getStorage?: () => EPersistentStorage
  , serialize?:
      (storageValue: EPersistentStorageValue) =>
        MaybePromise<E.Serialized<EPersistentStorageValue>>
  , deserialize?:
      (serializedString: E.Serialized<EPersistentStorageValue>) =>
        MaybePromise<EPersistentStorageValue>
  , partialize?: (state: EState) => ESelectedState
  , onRehydrateStorage?:
      (state: EState) =>
        void | ((state?: EState, error?: unknown) => void)
  , version?: EPersistentStorageValue['version']
    migrate?:
      ( persistedState: EPersistentStorageValue['state']
      , version: EPersistentStorageValue['version']
      ) =>
        MaybePromise<EPersistentStorageValue['state']>
    merge?:
      ( persistedState: EPersistentStorageValue['state']
      , currentState: EState
      ) =>
        EState
  }

interface EPersistentStorage
  { getItem: (name: EPersistentStorageName) =>
      MaybePromise<E.Serialized<EPersistentStorageValue> | null>
  , setItem:
      ( name: EPersistentStorageName
      , value: E.Serialized<EPersistentStorageValue>
      ) =>
        MaybePromise<void>
  , removeItem: (name: EPersistentStorageName) => MaybePromise<void>
  }

interface EPersistStore
  { persist:
      { setOptions: (options: O.Partial<EPersistOptions>) => void
      , clearStorage: () => void
      , rehydrate: () => Thenable<void>
      , hasHydrated: () => boolean
      , onHydrate: (listener: (state: EState) => void) => () => void
      , onFinishHydration: (listener: (state: EState) => void) => () => void
      }
  }

const persistImpl: EPersist = (storeInitializer, _options) => (parentSet, parentGet, parentStore) => {
  let options = { ...defaultOptions, ..._options }

  let persistentStorage = tryElse(options.getStorage, () => undefined)
  const persistentStorageGetItem = () =>
    persistentStorage!.getItem(options.name)
  const persistentStorageSetItem = (serializedState: E.Serialized<EPersistentStorageValue>) =>
    persistentStorage!.setItem(options.name, serializedState)
  const persistentStorageRemoveItem = () =>
    persistentStorage!.removeItem(options.name)
  
  if (!persistentStorage) {
    return storeInitializer(
      (...a) => {
        console.warn(messages.noPersistentStorage(options.name))
        parentSet(...a)
      },
      parentGet, 
      update(parentStore, 'setState', setState => (...a) => {
        console.warn(messages.noPersistentStorage(options.name))
        setState(...a)
      })
    )
  }
 
  const updatePersistentStorage = () =>
    thenablify(options.serialize)({
      state: options.partialize({ ...parentGet() }),
      version: options.version
    })
    .then(persistentStorageSetItem)
    .throw()
  

  const initialState = storeInitializer(
    (...a) => {
      parentSet(...a)
      updatePersistentStorage()
    },
    parentGet, 
    update(parentStore, 'setState', setState => (...a) => {
      setState(...a)
      updatePersistentStorage()
    })
  )
  let initialStateFromPersistentStorage: EState | undefined

  let hasHydrated = false
  const hydrationEmitter = emitter(new Set<(state: EState) => void>())
  const finishHydrationEmitter = emitter(new Set<(state: EState) => void>())

  const hydrate = () => {
    hasHydrated = false
    hydrationEmitter.emit(parentGet())
    const postRehydrationCallback = options.onRehydrateStorage?.(parentGet()) || undefined

    return thenablify(persistentStorageGetItem)()
    .then(serialized => serialized !== null ? options.deserialize(serialized) : null)
    .then(storageValue => {
      if (storageValue === null) return storageValue
      if (storageValue.version === undefined) return storageValue.state
      if (storageValue.version === options.version) return storageValue.state
      if (!options.migrate) {
        console.error(messages.couldNotMigrate())
        return undefined
      }

      return options.migrate(storageValue.state, storageValue.version)
    })
    .then(migratedState => {
      initialStateFromPersistentStorage = options.merge(migratedState!, initialState)

      parentSet(initialStateFromPersistentStorage, true)
      return updatePersistentStorage()
    })
    .then(() => {
      postRehydrationCallback?.(initialStateFromPersistentStorage)
      hasHydrated = true
      finishHydrationEmitter.emit(initialStateFromPersistentStorage!)
    })
    .catch(error => postRehydrationCallback?.(undefined, error))
  }

  (parentStore as Store<EState> & EPersistStore).persist = {
    setOptions: (newOptions) => {
      options = { ...options, ...newOptions }
      if (options.getStorage) persistentStorage = options.getStorage()
    },
    clearStorage: persistentStorageRemoveItem,
    rehydrate: hydrate,
    hasHydrated: () => hasHydrated,
    onHydrate: hydrationEmitter.listen,
    onFinishHydration: finishHydrationEmitter.listen
  }

  hydrate()
  return initialStateFromPersistentStorage || initialState
}
const persist = persistImpl as unknown as Persist

type EPersistDefaultedOptions =
  O.Required<O.ExcludeKey<EPersistOptions, 'name' | 'onRehydrateStorage' | 'migrate'>>

const defaultOptions: EPersistDefaultedOptions = {
  getStorage: (() => localStorage) as unknown as EPersistDefaultedOptions['getStorage'],
  serialize: JSON.stringify as unknown as EPersistDefaultedOptions['serialize'],
  deserialize: JSON.parse as unknown as EPersistDefaultedOptions['deserialize'],
  partialize: (<T>(x: T) => x) as unknown as EPersistDefaultedOptions['partialize'],
  version: 0 as EPersistDefaultedOptions['version'],
  merge: (persistedState, currentState) => ({
    ...currentState,
    ...persistedState,
  })
}

const messages = {
  noPersistentStorage: (name: EPersistentStorageName) =>
    `[zustand persist middleware] Unable to update item '${name}', ` +
    `the given storage is currently unavailable.`,
  couldNotMigrate: () =>
    `[zustand persist middleware] State loaded from storage couldn't be migrated ` +
    `since no migrate function was provided`
}




// ============================================================================
// Utilities

const tryElse = <T, U>(result: () => T, fallback: (e: unknown) => U) => {
  let r: T | U
  try { r = result() }
  catch (e) { r = fallback(e) }
  return r
}

const update =
  <T, K extends keyof T>(t: T, k: K, replacer: (original: T[K]) => T[K]) => {
    const original = t[k]
    Object.assign(t, { k: replacer(original) })
    return t
  }

const emitter = <L extends (...a: never[]) => void>(listeners: Set<L>) => {
  return ({
    emit: (...a: Parameters<L>) => listeners.forEach(f => f(...a)),
    listen: (listener: L) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  })
}

type MaybePromise<T> =
  T | Promise<T>

namespace E {
  export type Serialized<T> = { __serialized: T }
}

namespace O {
  export type Unknown =
    object

  export type Partial<T extends O.Unknown> =
    { [K in keyof T]?: T[K] }

  export type ExcludeKey<T extends O.Unknown, K extends keyof T> =
    { [P in U.Exclude<keyof T, K>]: T[P]
    }

  export type Required<T> =
    { [K in keyof T]-?: U.Exclude<T[K], undefined>
    }
}

namespace U {
  export type Exclude<T, U> =
    T extends U ? never : T
}




// ============================================================================
// Exports

export { persist, PersistOptions, PersistStore }
