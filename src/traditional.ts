import React from 'react'
// eslint-disable-next-line import/extensions
import useSyncExternalStoreExports from 'use-sync-external-store/shim/with-selector'
import { createStore } from './vanilla.ts'
import type {
  ExtractState,
  Mutate,
  StateCreator,
  StoreApi,
  StoreMutatorIdentifier,
} from './vanilla.ts'

const { useSyncExternalStoreWithSelector } = useSyncExternalStoreExports

type ReadonlyStoreApi<T> = Pick<
  StoreApi<T>,
  'getState' | 'getInitialState' | 'subscribe'
>

const identity = <T>(arg: T): T => arg

export function useStoreWithEqualityFn<S extends ReadonlyStoreApi<unknown>>(
  api: S,
): ExtractState<S>

export function useStoreWithEqualityFn<S extends ReadonlyStoreApi<unknown>, U>(
  api: S,
  selector: (state: ExtractState<S>) => U,
  equalityFn?: (a: U, b: U) => boolean,
): U

export function useStoreWithEqualityFn<TState, StateSlice>(
  api: ReadonlyStoreApi<TState>,
  selector: (state: TState) => StateSlice = identity as any,
  equalityFn?: (a: StateSlice, b: StateSlice) => boolean,
) {
  const slice = useSyncExternalStoreWithSelector(
    api.subscribe,
    api.getState,
    api.getInitialState,
    selector,
    equalityFn,
  )
  React.useDebugValue(slice)
  return slice
}

export type UseBoundStoreWithEqualityFn<S extends ReadonlyStoreApi<unknown>> = {
  (): ExtractState<S>
  <U>(
    selector: (state: ExtractState<S>) => U,
    equalityFn?: (a: U, b: U) => boolean,
  ): U
} & S

type CreateWithEqualityFn = {
  <T, Mos extends [StoreMutatorIdentifier, unknown][] = []>(
    initializer: StateCreator<T, [], Mos>,
    defaultEqualityFn?: <U>(a: U, b: U) => boolean,
  ): UseBoundStoreWithEqualityFn<Mutate<StoreApi<T>, Mos>>
  <T>(): <Mos extends [StoreMutatorIdentifier, unknown][] = []>(
    initializer: StateCreator<T, [], Mos>,
    defaultEqualityFn?: <U>(a: U, b: U) => boolean,
  ) => UseBoundStoreWithEqualityFn<Mutate<StoreApi<T>, Mos>>
}

const createWithEqualityFnImpl = <T>(
  createState: StateCreator<T, [], []>,
  defaultEqualityFn?: <U>(a: U, b: U) => boolean,
) => {
  const api = createStore(createState)

  const useBoundStoreWithEqualityFn: any = (
    selector?: any,
    equalityFn = defaultEqualityFn,
  ) => useStoreWithEqualityFn(api, selector, equalityFn)

  Object.assign(useBoundStoreWithEqualityFn, api)

  return useBoundStoreWithEqualityFn
}

export const createWithEqualityFn = (<T>(
  createState: StateCreator<T, [], []> | undefined,
  defaultEqualityFn?: <U>(a: U, b: U) => boolean,
) =>
  createState
    ? createWithEqualityFnImpl(createState, defaultEqualityFn)
    : createWithEqualityFnImpl) as CreateWithEqualityFn
