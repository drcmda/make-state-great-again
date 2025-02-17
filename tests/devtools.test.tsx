import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { devtools, redux } from 'zustand/middleware'
import { createStore } from 'zustand/vanilla'
import type { StoreApi } from 'zustand/vanilla'

type TupleOfEqualLengthH<
  Arr extends unknown[],
  T,
  Acc extends T[],
> = Arr extends [unknown, ...infer Rest]
  ? TupleOfEqualLengthH<Rest, T, [T, ...Acc]>
  : Acc
type TupleOfEqualLength<Arr extends unknown[], T> = number extends Arr['length']
  ? T[]
  : TupleOfEqualLengthH<Arr, T, []>

type Connection = {
  subscribers: ((message: unknown) => void)[]
  api: {
    subscribe: Mock<any>
    unsubscribe: Mock<any>
    send: Mock<any>
    init: Mock<any>
    error: Mock<any>
    dispatch?: Mock<any>
  }
}
const namedConnections = new Map<string | undefined, Connection>()
const unnamedConnections = new Map<string, Connection>()

function assertAllAreDefined<T>(arr: (T | undefined)[]): asserts arr is T[] {
  if (arr.some((e) => e === undefined)) {
    throw new Error()
  }
}
function getNamedConnectionApis<Keys extends (string | undefined)[]>(
  ...keys: Keys
) {
  const apis = keys.map((k) => namedConnections.get(k)?.api)
  assertAllAreDefined(apis)
  return apis as TupleOfEqualLength<Keys, Connection['api']>
}
function getNamedConnectionSubscribers<Keys extends (string | undefined)[]>(
  ...keys: Keys
) {
  const subscribers = keys.map((k) => {
    const subs = namedConnections.get(k)?.subscribers
    if (subs?.length !== 1) throw new Error()
    return subs[0]
  })
  assertAllAreDefined(subscribers)
  return subscribers as TupleOfEqualLength<
    Keys,
    Connection['subscribers'][number]
  >
}
function getUnnamedConnectionApis<Keys extends string[]>(...keys: Keys) {
  const apis = keys.map((k) => unnamedConnections.get(k)?.api)
  assertAllAreDefined(apis)
  return apis as TupleOfEqualLength<Keys, Connection['api']>
}
function getUnnamedConnectionSubscribers<Keys extends string[]>(...keys: Keys) {
  const subscribers = keys.map((k) => {
    const subs = unnamedConnections.get(k)?.subscribers
    if (!subs) {
      throw new Error()
    }
    return subs[0]
  })
  assertAllAreDefined(subscribers)
  return subscribers as TupleOfEqualLength<
    Keys,
    Connection['subscribers'][number]
  >
}

function getKeyFromOptions(options: any): string | undefined {
  let key: string | undefined = options?.name
  if (options?.testStore) {
    key = `${options?.name}|${options?.testStore}`
  }
  return key
}

const extensionConnector = {
  connect: vi.fn((options: any) => {
    const key = getKeyFromOptions(options)
    //console.log('options', options)
    const areNameUndefinedMapsNeeded =
      options.testConnectionId !== undefined && options?.name === undefined
    const connectionMap = areNameUndefinedMapsNeeded
      ? unnamedConnections
      : namedConnections
    const subscribers: Connection['subscribers'] = []
    const api = {
      subscribe: vi.fn((f: (m: unknown) => void) => {
        subscribers.push(f)
        return () => {}
      }),
      unsubscribe: vi.fn(),
      send: vi.fn(),
      init: vi.fn(),
      error: vi.fn(),
    }
    connectionMap.set(
      areNameUndefinedMapsNeeded ? options.testConnectionId : key,
      {
        subscribers,
        api,
      },
    )
    return api
  }),
}
;(window as any).__REDUX_DEVTOOLS_EXTENSION__ = extensionConnector

beforeEach(() => {
  vi.resetModules()
  extensionConnector.connect.mockClear()
  namedConnections.clear()
  unnamedConnections.clear()
})

it('connects to the extension by passing the options and initializes', async () => {
  const options = { name: 'test', foo: 'bar' }
  const initialState = { count: 0 }
  createStore(devtools(() => initialState, { enabled: true, ...options }))

  expect(extensionConnector.connect).toHaveBeenLastCalledWith(options)

  const [conn] = getNamedConnectionApis(options.name)
  expect(conn.init).toHaveBeenLastCalledWith(initialState)
})

describe('If there is no extension installed...', () => {
  let savedConsoleWarn: any
  beforeEach(() => {
    savedConsoleWarn = console.warn
    console.warn = vi.fn()
    ;(window as any).__REDUX_DEVTOOLS_EXTENSION__ = undefined
  })
  afterEach(() => {
    console.warn = savedConsoleWarn
    ;(window as any).__REDUX_DEVTOOLS_EXTENSION__ = extensionConnector
  })

  it('does not throw', async () => {
    expect(() => {
      createStore(devtools(() => ({ count: 0 })))
    }).not.toThrow()
  })

  it('does not warn', async () => {
    createStore(devtools(() => ({ count: 0 })))
    expect(console.warn).not.toBeCalled()
  })
})

describe('When state changes...', () => {
  it("sends { type: setStateName || 'anonymous`, ...rest } as the action with current state", async () => {
    const options = {
      name: 'testOptionsName',
      enabled: true,
    }
    const api = createStore(devtools(() => ({ count: 0, foo: 'bar' }), options))

    api.setState({ count: 10 }, false, 'testSetStateName')
    const [connection] = getNamedConnectionApis(options.name)
    expect(connection.send).toHaveBeenLastCalledWith(
      { type: 'testSetStateName' },
      { count: 10, foo: 'bar' },
    )

    api.setState({ count: 15 }, false, {
      type: 'testSetStateName',
      payload: 15,
    })
    expect(connection.send).toHaveBeenLastCalledWith(
      { type: 'testSetStateName', payload: 15 },
      { count: 15, foo: 'bar' },
    )

    api.setState({ count: 5, foo: 'baz' }, true)
    expect(connection.send).toHaveBeenLastCalledWith(
      { type: 'anonymous' },
      { count: 5, foo: 'baz' },
    )
  })
})

describe('When state changes with automatic setter inferring...', () => {
  it("sends { type: setStateName || 'setCount`, ...rest } as the action with current state", async () => {
    const options = {
      name: 'testOptionsName',
      enabled: true,
      inferActionName: true,
    }

    const api = createStore(
      devtools(
        (set) => ({
          count: 0,
          setCount: (newCount: number) => {
            set({ count: newCount })
          },
        }),
        options,
      ),
    )
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    api.getState().setCount(10)
    const [connection] = getNamedConnectionApis(options.name)
    expect(connection.send).toHaveBeenLastCalledWith(
      { type: 'Object.setCount' },
      { count: 10, setCount: expect.any(Function) },
    )
  })
})

describe('when it receives a message of type...', () => {
  describe('ACTION...', () => {
    it('does nothing', async () => {
      const initialState = { count: 0 }
      const api = createStore(devtools(() => initialState, { enabled: true }))
      const setState = vi.spyOn(api, 'setState')

      const [subscriber] = getNamedConnectionSubscribers(undefined)
      subscriber({
        type: 'ACTION',
        payload: '{ "type": "INCREMENT" }',
      })

      expect(api.getState()).toBe(initialState)
      expect(setState).not.toBeCalled()
    })

    it('unless action type is __setState', async () => {
      const initialState = { count: 0 }
      const api = createStore(devtools(() => initialState, { enabled: true }))

      const [connectionSubscriber] = getNamedConnectionSubscribers(undefined)
      connectionSubscriber({
        type: 'ACTION',
        payload: '{ "type": "__setState", "state": { "foo": "bar" } }',
      })

      expect(api.getState()).toStrictEqual({ ...initialState, foo: 'bar' })
    })

    it('does nothing even if there is `api.dispatch`', async () => {
      const initialState = { count: 0 }
      const api = createStore(devtools(() => initialState, { enabled: true }))
      ;(api as any).dispatch = vi.fn()
      const setState = vi.spyOn(api, 'setState')

      const [connectionSubscriber] = getNamedConnectionSubscribers(undefined)
      connectionSubscriber({
        type: 'ACTION',
        payload: '{ "type": "INCREMENT" }',
      })

      expect(api.getState()).toBe(initialState)
      expect(setState).not.toBeCalled()
      expect((api as any).dispatch).not.toBeCalled()
    })

    it('dispatches with `api.dispatch` when `api.dispatchFromDevtools` is set to true', async () => {
      const initialState = { count: 0 }
      const api = createStore(devtools(() => initialState, { enabled: true }))
      ;(api as any).dispatch = vi.fn()
      ;(api as any).dispatchFromDevtools = true
      const setState = vi.spyOn(api, 'setState')

      const [connectionSubscriber] = getNamedConnectionSubscribers(undefined)
      connectionSubscriber({
        type: 'ACTION',
        payload: '{ "type": "INCREMENT" }',
      })

      expect(api.getState()).toBe(initialState)
      expect(setState).not.toBeCalled()
      expect((api as any).dispatch).toHaveBeenLastCalledWith({
        type: 'INCREMENT',
      })
    })

    it('does not throw for unsupported payload', async () => {
      const initialState = { count: 0 }
      const api = createStore(devtools(() => initialState, { enabled: true }))
      ;(api as any).dispatch = vi.fn()
      ;(api as any).dispatchFromDevtools = true
      const setState = vi.spyOn(api, 'setState')
      const originalConsoleError = console.error
      console.error = vi.fn()

      const [connectionSubscriber] = getNamedConnectionSubscribers(undefined)
      expect(() => {
        connectionSubscriber({
          type: 'ACTION',
          payload: 'this.increment()',
        })
      }).not.toThrow()

      expect(console.error).toHaveBeenLastCalledWith(
        '[zustand devtools middleware] Could not parse the received json',
        (() => {
          try {
            JSON.parse('this.increment()')
          } catch (e) {
            return e
          }
        })(),
      )

      expect(() => {
        connectionSubscriber({
          type: 'ACTION',
          payload: { name: 'increment', args: [] },
        })
      }).not.toThrow()

      expect(console.error).toHaveBeenLastCalledWith(
        '[zustand devtools middleware] Unsupported action format',
      )

      expect(api.getState()).toBe(initialState)
      expect(setState).not.toBeCalled()
      expect((api as any).dispatch).not.toBeCalled()

      console.error = originalConsoleError
    })
  })

  describe('DISPATCH and payload of type...', () => {
    it('RESET, it inits with initial state', async () => {
      const initialState = { count: 0 }
      const api = createStore(devtools(() => initialState, { enabled: true }))
      api.setState({ count: 1 })

      const [connection] = getNamedConnectionApis(undefined)
      connection.send.mockClear()
      const [connectionSubscriber] = getNamedConnectionSubscribers(undefined)
      connectionSubscriber({
        type: 'DISPATCH',
        payload: { type: 'RESET' },
      })

      expect(api.getState()).toStrictEqual(initialState)
      expect(connection.init).toHaveBeenLastCalledWith(initialState)
      expect(connection.send).not.toBeCalled()
    })

    it('COMMIT, it inits with current state', async () => {
      const initialState = { count: 0 }
      const api = createStore(devtools(() => initialState, { enabled: true }))
      api.setState({ count: 2 })
      const currentState = api.getState()

      const [connection] = getNamedConnectionApis(undefined)
      connection.send.mockClear()
      const [connectionSubscriber] = getNamedConnectionSubscribers(undefined)
      connectionSubscriber({
        type: 'DISPATCH',
        payload: { type: 'COMMIT' },
      })

      expect(connection.init).toHaveBeenLastCalledWith(currentState)
      expect(connection.send).not.toBeCalled()
    })

    describe('ROLLBACK...', () => {
      it('updates state without recording and inits with `message.state`', async () => {
        const initialState = { count: 0, increment: () => {} }
        const api = createStore(devtools(() => initialState, { enabled: true }))
        const newState = { foo: 'bar' }

        const [connection] = getNamedConnectionApis(undefined)
        connection.send.mockClear()
        const [connectionSubscriber] = getNamedConnectionSubscribers(undefined)
        connectionSubscriber({
          type: 'DISPATCH',
          payload: { type: 'ROLLBACK' },
          state: JSON.stringify(newState),
        })

        expect(api.getState()).toStrictEqual({ ...initialState, ...newState })
        expect(connection.init).toHaveBeenLastCalledWith({
          ...initialState,
          ...newState,
        })
        expect(connection.send).not.toBeCalled()
      })

      it('does not throw for unparsable `message.state`', async () => {
        const increment = () => {}
        const initialState = { count: 0, increment }
        const api = createStore(devtools(() => initialState, { enabled: true }))
        const originalConsoleError = console.error
        console.error = vi.fn()

        const [connection] = getNamedConnectionApis(undefined)
        connection.init.mockClear()
        connection.send.mockClear()
        const [connectionSubscriber] = getNamedConnectionSubscribers(undefined)
        connectionSubscriber({
          type: 'DISPATCH',
          payload: { type: 'ROLLBACK' },
          state: 'foobar',
        })

        expect(console.error).toHaveBeenLastCalledWith(
          '[zustand devtools middleware] Could not parse the received json',
          (() => {
            try {
              JSON.parse('foobar')
            } catch (e) {
              return e
            }
          })(),
        )
        expect(api.getState()).toBe(initialState)
        expect(connection.init).not.toBeCalled()
        expect(connection.send).not.toBeCalled()

        console.error = originalConsoleError
      })
    })

    describe('JUMP_TO_STATE...', () => {
      const increment = () => {}
      it('updates state without recording with `message.state`', async () => {
        const initialState = { count: 0, increment }
        const api = createStore(devtools(() => initialState, { enabled: true }))
        const newState = { foo: 'bar' }

        const [connection] = getNamedConnectionApis(undefined)
        connection.send.mockClear()
        const [connectionSubscriber] = getNamedConnectionSubscribers(undefined)
        connectionSubscriber({
          type: 'DISPATCH',
          payload: { type: 'JUMP_TO_STATE' },
          state: JSON.stringify(newState),
        })
        expect(api.getState()).toStrictEqual({ ...initialState, ...newState })
        expect(connection.send).not.toBeCalled()
      })

      it('does not throw for unparsable `message.state`', async () => {
        const initialState = { count: 0, increment: () => {} }
        const api = createStore(devtools(() => initialState, { enabled: true }))
        const originalConsoleError = console.error
        console.error = vi.fn()

        const [connection] = getNamedConnectionApis(undefined)
        connection.send.mockClear()
        const [connectionSubscriber] = getNamedConnectionSubscribers(undefined)
        connectionSubscriber({
          type: 'DISPATCH',
          payload: { type: 'JUMP_TO_STATE' },
          state: 'foobar',
        })

        expect(console.error).toHaveBeenLastCalledWith(
          '[zustand devtools middleware] Could not parse the received json',
          (() => {
            try {
              JSON.parse('foobar')
            } catch (e) {
              return e
            }
          })(),
        )
        expect(api.getState()).toBe(initialState)
        expect(connection.send).not.toBeCalled()

        console.error = originalConsoleError
      })
    })

    describe('JUMP_TO_ACTION...', () => {
      it('updates state without recording with `message.state`', async () => {
        const initialState = { count: 0, increment: () => {} }
        const api = createStore(devtools(() => initialState, { enabled: true }))
        const newState = { foo: 'bar' }

        const [connection] = getNamedConnectionApis(undefined)
        connection.send.mockClear()
        const [connectionSubscriber] = getNamedConnectionSubscribers(undefined)
        connectionSubscriber({
          type: 'DISPATCH',
          payload: { type: 'JUMP_TO_ACTION' },
          state: JSON.stringify(newState),
        })
        expect(api.getState()).toStrictEqual({ ...initialState, ...newState })
        expect(connection.send).not.toBeCalled()
      })

      it('does not throw for unparsable `message.state`', async () => {
        const increment = () => {}
        const initialState = { count: 0, increment }
        const api = createStore(devtools(() => initialState, { enabled: true }))
        const originalConsoleError = console.error
        console.error = vi.fn()

        const [connection] = getNamedConnectionApis(undefined)
        connection.send.mockClear()
        const [connectionSubscriber] = getNamedConnectionSubscribers(undefined)
        connectionSubscriber({
          type: 'DISPATCH',
          payload: { type: 'JUMP_TO_ACTION' },
          state: 'foobar',
        })

        expect(console.error).toHaveBeenLastCalledWith(
          '[zustand devtools middleware] Could not parse the received json',
          (() => {
            try {
              JSON.parse('foobar')
            } catch (e) {
              return e
            }
          })(),
        )
        expect(api.getState()).toBe(initialState)
        expect(connection.send).not.toBeCalled()

        console.error = originalConsoleError
      })
    })

    it('IMPORT_STATE, it updates state without recording and inits the last computedState', async () => {
      const initialState = { count: 0, increment: () => {} }
      const api = createStore(devtools(() => initialState, { enabled: true }))
      const nextLiftedState = {
        computedStates: [{ state: { count: 4 } }, { state: { count: 5 } }],
      }

      const [connection] = getNamedConnectionApis(undefined)
      connection.send.mockClear()
      const [connectionSubscriber] = getNamedConnectionSubscribers(undefined)
      connectionSubscriber({
        type: 'DISPATCH',
        payload: {
          type: 'IMPORT_STATE',
          nextLiftedState,
        },
      })
      expect(api.getState()).toStrictEqual({
        ...initialState,
        ...nextLiftedState.computedStates.slice(-1)[0]?.state,
      })
      expect(connection.send).toHaveBeenLastCalledWith(null, nextLiftedState)
    })

    it('PAUSE_RECORDING, it toggles the sending of actions', async () => {
      const api = createStore(devtools(() => ({ count: 0 }), { enabled: true }))

      api.setState({ count: 1 }, false, 'increment')
      const [connection] = getNamedConnectionApis(undefined)
      const [connectionSubscriber] = getNamedConnectionSubscribers(undefined)
      expect(connection.send).toHaveBeenLastCalledWith(
        { type: 'increment' },
        { count: 1 },
      )
      connectionSubscriber({
        type: 'DISPATCH',
        payload: { type: 'PAUSE_RECORDING' },
      })

      api.setState({ count: 2 }, false, 'increment')
      expect(connection.send).toHaveBeenLastCalledWith(
        { type: 'increment' },
        { count: 1 },
      )
      connectionSubscriber({
        type: 'DISPATCH',
        payload: { type: 'PAUSE_RECORDING' },
      })

      api.setState({ count: 3 }, false, 'increment')
      expect(connection.send).toHaveBeenLastCalledWith(
        { type: 'increment' },
        { count: 3 },
      )
    })
  })
})

describe('with redux middleware', () => {
  let api: StoreApi<{
    count: number
    dispatch: (
      action: { type: 'INCREMENT' } | { type: 'DECREMENT' },
    ) => { type: 'INCREMENT' } | { type: 'DECREMENT' }
  }>

  it('works as expected', async () => {
    api = createStore(
      devtools(
        redux(
          (
            { count },
            { type }: { type: 'INCREMENT' } | { type: 'DECREMENT' },
          ) => ({
            count: count + (type === 'INCREMENT' ? 1 : -1),
          }),
          { count: 0 },
        ),
        { enabled: true },
      ),
    )
    ;(api as any).dispatch({ type: 'INCREMENT' })
    ;(api as any).dispatch({ type: 'INCREMENT' })
    const [connection] = getNamedConnectionApis(undefined)
    const [connectionSubscriber] = getNamedConnectionSubscribers(undefined)
    connectionSubscriber({
      type: 'ACTION',
      payload: JSON.stringify({ type: 'DECREMENT' }),
    })

    expect(connection.init.mock.calls).toMatchObject([
      [{ count: 0 }] as unknown as Record<string, unknown>,
    ])
    expect(connection.send.mock.calls).toMatchObject([
      [{ type: 'INCREMENT' }, { count: 1 }] as unknown as Record<
        string,
        unknown
      >,
      [{ type: 'INCREMENT' }, { count: 2 }] as unknown as Record<
        string,
        unknown
      >,
      [{ type: 'DECREMENT' }, { count: 1 }] as unknown as Record<
        string,
        unknown
      >,
    ])
    expect(api.getState()).toMatchObject({ count: 1 })
  })

  it('[DEV-ONLY] warns about misusage', () => {
    const originalConsoleWarn = console.warn
    console.warn = vi.fn()
    ;(api as any).dispatch({ type: '__setState' as any })
    expect(console.warn).toHaveBeenLastCalledWith(
      '[zustand devtools middleware] "__setState" action type is reserved ' +
        'to set state from the devtools. Avoid using it.',
    )

    console.warn = originalConsoleWarn
  })
})

describe('different envs', () => {
  let savedConsoleWarn: any
  beforeEach(() => {
    savedConsoleWarn = console.warn
    console.warn = vi.fn()
  })
  afterEach(() => {
    console.warn = savedConsoleWarn
  })

  it('works in non-browser env', async () => {
    const originalWindow = global.window
    global.window = undefined as any

    expect(() => {
      createStore(devtools(() => ({ count: 0 }), { enabled: true }))
    }).not.toThrow()

    global.window = originalWindow
  })

  it('works in react native env', async () => {
    const originalWindow = global.window
    global.window = {} as any

    expect(() => {
      createStore(devtools(() => ({ count: 0 }), { enabled: true }))
    }).not.toThrow()

    global.window = originalWindow
  })
})

it('preserves isRecording after setting from devtools', async () => {
  const api = createStore(devtools(() => ({ count: 0 }), { enabled: true }))
  const [connection] = getNamedConnectionApis(undefined)
  const [connectionSubscriber] = getNamedConnectionSubscribers(undefined)
  connectionSubscriber({
    type: 'DISPATCH',
    payload: { type: 'PAUSE_RECORDING' },
  })
  connectionSubscriber({
    type: 'ACTION',
    payload: '{ "type": "__setState", "state": { "foo": "bar" } }',
  })

  api.setState({ count: 1 })
  expect(connection.send).not.toBeCalled()
})

/* features:
 * [] if name is undefined - use multiple devtools connections.
 * [] if name and store is defined - use connection for specific 'name'.
 * [] if two stores are connected to one 'name' group and.
 *      another connected to another 'name' group, then feature should work
 * [] check actions with this feature, for multiple stores that store prefixes are added -
 * [] - reset
 * [] - commit
 * [] - rollback
 * [] - jump to state, jump to action
 * [] - import state
 **/

describe('when redux connection was called on multiple stores with `name` undefined in `devtools` options', () => {
  it('should create separate connection for each devtools store with .connect call', async () => {
    const options1 = { foo: 'bar', testConnectionId: 'asdf' }
    const options2 = { foo: 'barr', testConnectionId: '123asd' }
    const initialState1 = { count: 0 }
    const initialState2 = { count1: 1 }

    createStore(devtools(() => initialState1, { enabled: true, ...options1 }))
    createStore(devtools(() => initialState2, { enabled: true, ...options2 }))

    expect(extensionConnector.connect).toHaveBeenNthCalledWith(1, options1)
    expect(extensionConnector.connect).toHaveBeenNthCalledWith(2, options2)
  })

  it('should call .init on each different connection object', async () => {
    const options1 = { foo: 'bar', testConnectionId: 'asdf' }
    const options2 = { foo: 'barr', testConnectionId: '123asd' }
    const initialState1 = { count: 0 }
    const initialState2 = { count1: 1 }

    createStore(devtools(() => initialState1, { enabled: true, ...options1 }))
    createStore(devtools(() => initialState2, { enabled: true, ...options2 }))

    const [conn1, conn2] = getUnnamedConnectionApis(
      options1.testConnectionId,
      options2.testConnectionId,
    )
    expect(conn1.init).toHaveBeenCalledWith(initialState1)
    expect(conn2.init).toHaveBeenCalledWith(initialState2)
  })

  describe('when `store` property was provided in `devtools` call in options', () => {
    it('should create single connection for all internal calls of .connect and `store` is not passed to .connect', async () => {
      const { devtools: newDevtools } = await import('zustand/middleware')

      const options1 = { store: 'store1123', foo: 'bar1' }
      const options2 = { store: 'store2313132', foo: 'bar2' }
      const initialState1 = { count: 0 }
      const initialState2 = { count1: 1 }

      createStore(
        newDevtools(() => initialState1, { enabled: true, ...options1 }),
      )
      createStore(
        newDevtools(() => initialState2, { enabled: true, ...options2 }),
      )

      expect(extensionConnector.connect).toHaveBeenCalledTimes(1)
      expect(extensionConnector.connect).toHaveBeenCalledWith({
        foo: options1.foo,
      })
    })

    it('should call `.init` on single connection with combined states after each `create(devtools` call', async () => {
      const { devtools: newDevtools } = await import('zustand/middleware')

      const options1 = { store: 'store12' }
      const options2 = { store: 'store21' }
      const initialState1 = { count1: 0 }
      const initialState2 = { count2: 1 }

      createStore(
        newDevtools(() => initialState1, { enabled: true, ...options1 }),
      )
      createStore(
        newDevtools(() => initialState2, { enabled: true, ...options2 }),
      )

      expect(extensionConnector.connect).toHaveBeenCalledTimes(1)
      const [connection] = getNamedConnectionApis(undefined)
      expect(connection.init).toHaveBeenCalledTimes(2)
      expect(connection.init).toHaveBeenNthCalledWith(1, {
        [options1.store]: initialState1,
      })
      expect(connection.init).toHaveBeenNthCalledWith(2, {
        [options1.store]: initialState1,
        [options2.store]: initialState2,
      })
    })
  })
})

describe('when redux connection was called on multiple stores with `name` provided in `devtools` options', () => {
  describe('when same `name` is provided to all stores in devtools options', () => {
    it('should call .connect of redux extension with `name` that was passed from `devtools` options', async () => {
      const connectionName = 'test'
      const options1 = { name: connectionName, store: 'store1123', foo: 'bar1' }
      const options2 = { name: connectionName, store: 'store1414', foo: 'bar1' }
      const initialState1 = { count: 0 }
      const initialState2 = { count: 2 }

      createStore(devtools(() => initialState1, { enabled: true, ...options1 }))
      createStore(devtools(() => initialState2, { enabled: true, ...options2 }))

      expect(extensionConnector.connect).toHaveBeenCalledTimes(1)
      expect(extensionConnector.connect).toHaveBeenCalledWith({
        foo: options1.foo,
        name: connectionName,
      })
    })
  })

  describe('when different `name` props were provided for different group of stores in devtools options', () => {
    it('should call .connect of redux extension with `name` that was passed from `devtools` options', async () => {
      const connectionNameGroup1 = 'test1'
      const connectionNameGroup2 = 'test2'
      const options1 = {
        name: connectionNameGroup1,
        store: 'store1123',
        foo: 'bar2',
      }
      const options2 = {
        name: connectionNameGroup1,
        store: 'store1232',
        foo: 'bar3',
      }
      const options3 = {
        name: connectionNameGroup2,
        store: 'store61661',
        foo: 'bar4',
      }
      const options4 = {
        name: connectionNameGroup2,
        store: 'store14632',
        foo: 'bar5',
      }
      const initialState1 = { count: 0 }
      const initialState2 = { count: 2 }
      const initialState3 = { count: 5 }
      const initialState4 = { count: 7 }

      createStore(devtools(() => initialState1, { enabled: true, ...options1 }))
      createStore(devtools(() => initialState2, { enabled: true, ...options2 }))
      createStore(devtools(() => initialState3, { enabled: true, ...options3 }))
      createStore(devtools(() => initialState4, { enabled: true, ...options4 }))

      expect(extensionConnector.connect).toHaveBeenCalledTimes(2)
      expect(extensionConnector.connect).toHaveBeenNthCalledWith(1, {
        foo: options1.foo,
        name: connectionNameGroup1,
      })
      expect(extensionConnector.connect).toHaveBeenNthCalledWith(2, {
        foo: options3.foo,
        name: connectionNameGroup2,
      })
    })

    it('should call `.init` on single connection with combined states after each `create(devtools` call', async () => {
      const { devtools: newDevtools } = await import('zustand/middleware')
      const connectionNameGroup1 = 'test1'
      const connectionNameGroup2 = 'test2'
      const options1 = {
        name: connectionNameGroup1,
        store: 'store1123',
        foo: 'bar2',
      }
      const options2 = {
        name: connectionNameGroup1,
        store: 'store1232',
        foo: 'bar3',
      }
      const options3 = {
        name: connectionNameGroup2,
        store: 'store61661',
        foo: 'bar4',
      }
      const options4 = {
        name: connectionNameGroup2,
        store: 'store14632',
        foo: 'bar5',
      }
      const initialState1 = { count: 0 }
      const initialState2 = { count: 2 }
      const initialState3 = { count: 5 }
      const initialState4 = { count: 7 }

      createStore(
        newDevtools(() => initialState1, { enabled: true, ...options1 }),
      )
      createStore(
        newDevtools(() => initialState2, { enabled: true, ...options2 }),
      )
      createStore(
        newDevtools(() => initialState3, { enabled: true, ...options3 }),
      )
      createStore(
        newDevtools(() => initialState4, { enabled: true, ...options4 }),
      )

      expect(extensionConnector.connect).toHaveBeenCalledTimes(2)
      const [connection1, connection2] = getNamedConnectionApis(
        connectionNameGroup1,
        connectionNameGroup2,
      )
      expect(connection1.init).toHaveBeenCalledTimes(2)
      expect(connection1.init).toHaveBeenNthCalledWith(1, {
        [options1.store]: initialState1,
      })
      expect(connection1.init).toHaveBeenNthCalledWith(2, {
        [options1.store]: initialState1,
        [options2.store]: initialState2,
      })
      expect(connection2.init).toHaveBeenCalledTimes(2)
      expect(connection2.init).toHaveBeenNthCalledWith(1, {
        [options3.store]: initialState3,
      })
      expect(connection2.init).toHaveBeenNthCalledWith(2, {
        [options3.store]: initialState3,
        [options4.store]: initialState4,
      })
    })

    it('preserves isRecording after setting from devtools on proper connection subscriber', async () => {
      const options1 = { name: 'asdf1' }
      const options2 = { name: 'asdf2' }
      const api1 = createStore(
        devtools(() => ({ count: 0 }), { enabled: true, ...options1 }),
      )
      createStore(
        devtools(() => ({ count: 0 }), { enabled: true, ...options2 }),
      )
      const connections = getNamedConnectionApis(options1.name, options2.name)
      const [connectionSubscriber] = getNamedConnectionSubscribers(
        options1.name,
      )
      connectionSubscriber({
        type: 'DISPATCH',
        payload: { type: 'PAUSE_RECORDING' },
      })
      connectionSubscriber({
        type: 'ACTION',
        payload: '{ "type": "__setState", "state": { "foo": "bar" } }',
      })

      api1.setState({ count: 1 })
      connections.forEach((conn) => expect(conn.send).not.toBeCalled())
    })

    describe('with redux middleware', () => {
      let api1: StoreApi<{
        count: number
        dispatch: (
          action: { type: 'INCREMENT' } | { type: 'DECREMENT' },
        ) => { type: 'INCREMENT' } | { type: 'DECREMENT' }
      }>
      let api2: StoreApi<{
        count: number
        dispatch: (
          action: { type: 'INCREMENT' } | { type: 'DECREMENT' },
        ) => { type: 'INCREMENT' } | { type: 'DECREMENT' }
      }>

      it('works as expected', async () => {
        const options1 = { testConnectionId: 'asdf' }
        const options2 = { testConnectionId: '2f' }
        api1 = createStore(
          devtools(
            redux(
              (
                { count },
                { type }: { type: 'INCREMENT' } | { type: 'DECREMENT' },
              ) => ({
                count: count + (type === 'INCREMENT' ? 1 : -1),
              }),
              { count: 0 },
            ),
            { enabled: true, ...options1 },
          ),
        )
        api2 = createStore(
          devtools(
            redux(
              (
                { count },
                { type }: { type: 'INCREMENT' } | { type: 'DECREMENT' },
              ) => ({
                count: count + (type === 'INCREMENT' ? 1 : -1),
              }),
              { count: 10 },
            ),
            { enabled: true, ...options2 },
          ),
        )
        ;(api1 as any).dispatch({ type: 'INCREMENT' })
        ;(api1 as any).dispatch({ type: 'INCREMENT' })
        ;(api2 as any).dispatch({ type: 'INCREMENT' })
        ;(api2 as any).dispatch({ type: 'INCREMENT' })
        const [connection1, connection2] = getUnnamedConnectionApis(
          options1.testConnectionId,
          options2.testConnectionId,
        )
        const [connectionSubscriber1, connectionSubscriber2] =
          getUnnamedConnectionSubscribers(
            options1.testConnectionId,
            options2.testConnectionId,
          )
        connectionSubscriber1({
          type: 'ACTION',
          payload: JSON.stringify({ type: 'DECREMENT' }),
        })
        connectionSubscriber2({
          type: 'ACTION',
          payload: JSON.stringify({ type: 'DECREMENT' }),
        })

        expect(connection1.init.mock.calls).toMatchObject([
          [{ count: 0 }] as unknown as Record<string, unknown>,
        ])
        expect(connection2.init.mock.calls).toMatchObject([
          [{ count: 10 }] as unknown as Record<string, unknown>,
        ])
        expect(connection1.send.mock.calls).toMatchObject([
          [{ type: 'INCREMENT' }, { count: 1 }] as unknown as Record<
            string,
            unknown
          >,
          [{ type: 'INCREMENT' }, { count: 2 }] as unknown as Record<
            string,
            unknown
          >,
          [{ type: 'DECREMENT' }, { count: 1 }] as unknown as Record<
            string,
            unknown
          >,
        ])
        expect(connection2.send.mock.calls).toMatchObject([
          [{ type: 'INCREMENT' }, { count: 11 }] as unknown as Record<
            string,
            unknown
          >,
          [{ type: 'INCREMENT' }, { count: 12 }] as unknown as Record<
            string,
            unknown
          >,
          [{ type: 'DECREMENT' }, { count: 11 }] as unknown as Record<
            string,
            unknown
          > as unknown as Record<string, unknown>,
        ])
        expect(api1.getState()).toMatchObject({ count: 1 })
        expect(api2.getState()).toMatchObject({ count: 11 })
      })
    })
  })
})

describe('when create devtools was called multiple times with `name` option undefined', () => {
  describe('When state changes...', () => {
    it("sends { type: setStateName || 'anonymous`, ...rest } as the action with current state, isolated from other connections", async () => {
      const options1 = {
        enabled: true,
        testConnectionId: '123',
      }
      const options2 = {
        enabled: true,
        testConnectionId: '324',
      }
      const options3 = {
        enabled: true,
        testConnectionId: '412',
      }
      const api1 = createStore(
        devtools(() => ({ count: 0, foo: 'bar' }), options1),
      )
      createStore(devtools(() => ({ count: 0, foo: 'bar1' }), options2))
      createStore(devtools(() => ({ count: 0, foo: 'bar2' }), options3))

      api1.setState({ count: 10 }, false, 'testSetStateName')
      const [connection1, connection2, connection3] = getUnnamedConnectionApis(
        options1.testConnectionId,
        options2.testConnectionId,
        options3.testConnectionId,
      )
      expect(connection1.send).toHaveBeenLastCalledWith(
        { type: 'testSetStateName' },
        { count: 10, foo: 'bar' },
      )
      expect(connection2.send).not.toBeCalled()
      expect(connection3.send).not.toBeCalled()

      api1.setState({ count: 15 }, false, {
        type: 'testSetStateName',
        payload: 15,
      })
      expect(connection1.send).toHaveBeenLastCalledWith(
        { type: 'testSetStateName', payload: 15 },
        { count: 15, foo: 'bar' },
      )
      expect(connection2.send).not.toBeCalled()
      expect(connection3.send).not.toBeCalled()

      api1.setState({ count: 5, foo: 'baz' }, true)
      expect(connection1.send).toHaveBeenLastCalledWith(
        { type: 'anonymous' },
        { count: 5, foo: 'baz' },
      )
      expect(connection2.send).not.toBeCalled()
      expect(connection3.send).not.toBeCalled()
    })
  })

  describe('when it receives a message of type...', () => {
    describe('ACTION...', () => {
      it('does nothing, connections isolated from each other', async () => {
        const options1 = { testConnectionId: '123' }
        const options2 = { testConnectionId: '231' }
        const options3 = { testConnectionId: '4342' }
        const initialState1 = { count: 0 }
        const initialState2 = { count: 2 }
        const initialState3 = { count: 3 }
        const api1 = createStore(
          devtools(() => initialState1, {
            enabled: true,
            ...options1,
          }),
        )
        const api2 = createStore(
          devtools(() => initialState2, {
            enabled: true,
            ...options2,
          }),
        )
        const api3 = createStore(
          devtools(() => initialState3, {
            enabled: true,
            ...options3,
          }),
        )
        const setState1 = vi.spyOn(api1, 'setState')
        const setState2 = vi.spyOn(api2, 'setState')
        const setState3 = vi.spyOn(api3, 'setState')

        const [subscriber] = getUnnamedConnectionSubscribers(
          options1.testConnectionId,
        )
        subscriber({
          type: 'ACTION',
          payload: '{ "type": "INCREMENT" }',
        })

        expect(api1.getState()).toBe(initialState1)
        expect(api2.getState()).toBe(initialState2)
        expect(api3.getState()).toBe(initialState3)
        expect(setState1).not.toBeCalled()
        expect(setState2).not.toBeCalled()
        expect(setState3).not.toBeCalled()
      })

      it('unless action type is __setState, connections isolated from each other', async () => {
        const options1 = { testConnectionId: 'asdf' }
        const options2 = { testConnectionId: '2f' }
        const options3 = { testConnectionId: 'd2e' }
        const initialState1 = { count: 0 }
        const initialState2 = { count: 2 }
        const initialState3 = { count: 5 }
        const api1 = createStore(
          devtools(() => initialState1, { enabled: true, ...options1 }),
        )
        const api2 = createStore(
          devtools(() => initialState2, { enabled: true, ...options2 }),
        )
        const api3 = createStore(
          devtools(() => initialState3, { enabled: true, ...options3 }),
        )

        const [connectionSubscriber] = getUnnamedConnectionSubscribers(
          options1.testConnectionId,
        )
        connectionSubscriber({
          type: 'ACTION',
          payload: '{ "type": "__setState", "state": { "foo": "bar" } }',
        })

        expect(api1.getState()).toStrictEqual({ ...initialState1, foo: 'bar' })
        expect(api2.getState()).toStrictEqual({ ...initialState2 })
        expect(api3.getState()).toStrictEqual({ ...initialState3 })
      })

      it('does nothing even if there is `api.dispatch`, connections isolated from each other', async () => {
        const options1 = { testConnectionId: 'asdf' }
        const options2 = { testConnectionId: '2f' }
        const options3 = { testConnectionId: 'd2e' }
        const initialState1 = { count: 0 }
        const initialState2 = { count: 2 }
        const initialState3 = { count: 5 }
        const api1 = createStore(
          devtools(() => initialState1, { enabled: true, ...options1 }),
        )
        const api2 = createStore(
          devtools(() => initialState2, { enabled: true, ...options2 }),
        )
        const api3 = createStore(
          devtools(() => initialState3, { enabled: true, ...options3 }),
        )
        ;(api1 as any).dispatch = vi.fn()
        ;(api2 as any).dispatch = vi.fn()
        ;(api3 as any).dispatch = vi.fn()
        const setState1 = vi.spyOn(api1, 'setState')
        const setState2 = vi.spyOn(api2, 'setState')
        const setState3 = vi.spyOn(api3, 'setState')

        const subscribers = getUnnamedConnectionSubscribers(
          options1.testConnectionId,
          options2.testConnectionId,
          options3.testConnectionId,
        )
        const testPayload = {
          type: 'ACTION',
          payload: '{ "type": "INCREMENT" }',
        }
        subscribers.forEach((sub) => sub(testPayload))

        expect(api1.getState()).toBe(initialState1)
        expect(api2.getState()).toBe(initialState2)
        expect(api3.getState()).toBe(initialState3)
        expect(setState1).not.toBeCalled()
        expect(setState2).not.toBeCalled()
        expect(setState3).not.toBeCalled()
        expect((api1 as any).dispatch).not.toBeCalled()
        expect((api2 as any).dispatch).not.toBeCalled()
        expect((api3 as any).dispatch).not.toBeCalled()
      })

      it('dispatches with `api.dispatch` when `api.dispatchFromDevtools` is set to true, connections are isolated from each other', async () => {
        const options1 = { testConnectionId: 'asdf' }
        const options2 = { testConnectionId: '2f' }
        const options3 = { testConnectionId: 'd2e' }
        const initialState1 = { count: 0 }
        const initialState2 = { count: 2 }
        const initialState3 = { count: 5 }
        const api1 = createStore(
          devtools(() => initialState1, { enabled: true, ...options1 }),
        )
        const api2 = createStore(
          devtools(() => initialState2, { enabled: true, ...options2 }),
        )
        const api3 = createStore(
          devtools(() => initialState3, { enabled: true, ...options3 }),
        )
        ;(api1 as any).dispatch = vi.fn()
        ;(api1 as any).dispatchFromDevtools = true
        ;(api2 as any).dispatch = vi.fn()
        ;(api2 as any).dispatchFromDevtools = true
        ;(api3 as any).dispatch = vi.fn()
        ;(api3 as any).dispatchFromDevtools = true
        const setState1 = vi.spyOn(api1, 'setState')
        const setState2 = vi.spyOn(api2, 'setState')
        const setState3 = vi.spyOn(api3, 'setState')

        const subscribers = getUnnamedConnectionSubscribers(
          options1.testConnectionId,
          options2.testConnectionId,
          options3.testConnectionId,
        )
        const getTestPayload = (n: number) => ({
          type: 'ACTION',
          payload: `{ "type": "INCREMENT${n}" }`,
        })
        subscribers.forEach((sub, i) => sub(getTestPayload(i + 1)))

        expect(api1.getState()).toBe(initialState1)
        expect(api2.getState()).toBe(initialState2)
        expect(api3.getState()).toBe(initialState3)
        expect(setState1).not.toBeCalled()
        expect(setState2).not.toBeCalled()
        expect(setState3).not.toBeCalled()
        expect((api1 as any).dispatch).toHaveBeenLastCalledWith({
          type: 'INCREMENT1',
        })
        expect((api2 as any).dispatch).toHaveBeenLastCalledWith({
          type: 'INCREMENT2',
        })
        expect((api3 as any).dispatch).toHaveBeenLastCalledWith({
          type: 'INCREMENT3',
        })
      })

      it('does not throw for unsupported payload, connections are isolated from each other', async () => {
        const options1 = { testConnectionId: 'asdf' }
        const options2 = { testConnectionId: '2f' }
        const options3 = { testConnectionId: 'd2e' }
        const initialState1 = { count: 0 }
        const initialState2 = { count: 2 }
        const initialState3 = { count: 5 }
        const api1 = createStore(
          devtools(() => initialState1, { enabled: true, ...options1 }),
        )
        const api2 = createStore(
          devtools(() => initialState2, { enabled: true, ...options2 }),
        )
        const api3 = createStore(
          devtools(() => initialState3, { enabled: true, ...options3 }),
        )
        ;(api1 as any).dispatch = vi.fn()
        ;(api1 as any).dispatchFromDevtools = true
        ;(api2 as any).dispatch = vi.fn()
        ;(api2 as any).dispatchFromDevtools = true
        ;(api3 as any).dispatch = vi.fn()
        ;(api3 as any).dispatchFromDevtools = true
        const setState1 = vi.spyOn(api1, 'setState')
        const setState2 = vi.spyOn(api2, 'setState')
        const setState3 = vi.spyOn(api3, 'setState')
        const originalConsoleError = console.error
        console.error = vi.fn()

        const [
          connectionSubscriber1,
          connectionSubscriber2,
          connectionSubscriber3,
        ] = getUnnamedConnectionSubscribers(
          options1.testConnectionId,
          options2.testConnectionId,
          options3.testConnectionId,
        )
        expect(() => {
          connectionSubscriber1({
            type: 'ACTION',
            payload: 'this.increment1()',
          })
        }).not.toThrow()
        expect(console.error).toHaveBeenNthCalledWith(
          1,
          '[zustand devtools middleware] Could not parse the received json',
          (() => {
            try {
              JSON.parse('this.increment1()')
            } catch (e) {
              return e
            }
          })(),
        )

        expect(() => {
          connectionSubscriber1({
            type: 'ACTION',
            payload: 'this.increment2()',
          })
        }).not.toThrow()
        expect(console.error).toHaveBeenNthCalledWith(
          2,
          '[zustand devtools middleware] Could not parse the received json',
          (() => {
            try {
              JSON.parse('this.increment2()')
            } catch (e) {
              return e
            }
          })(),
        )

        expect(() => {
          connectionSubscriber1({
            type: 'ACTION',
            payload: 'this.increment3()',
          })
        }).not.toThrow()
        expect(console.error).toHaveBeenNthCalledWith(
          3,
          '[zustand devtools middleware] Could not parse the received json',
          (() => {
            try {
              JSON.parse('this.increment3()')
            } catch (e) {
              return e
            }
          })(),
        )

        expect(() => {
          connectionSubscriber1({
            type: 'ACTION',
            payload: { name: 'increment', args: [] },
          })
        }).not.toThrow()
        expect(console.error).toHaveBeenNthCalledWith(
          4,
          '[zustand devtools middleware] Unsupported action format',
        )
        expect(() => {
          connectionSubscriber2({
            type: 'ACTION',
            payload: { name: 'increment', args: [] },
          })
        }).not.toThrow()
        expect(console.error).toHaveBeenNthCalledWith(
          5,
          '[zustand devtools middleware] Unsupported action format',
        )
        expect(() => {
          connectionSubscriber3({
            type: 'ACTION',
            payload: { name: 'increment', args: [] },
          })
        }).not.toThrow()
        expect(console.error).toHaveBeenNthCalledWith(
          6,
          '[zustand devtools middleware] Unsupported action format',
        )

        expect(api1.getState()).toBe(initialState1)
        expect(api2.getState()).toBe(initialState2)
        expect(api3.getState()).toBe(initialState3)
        expect(setState1).not.toBeCalled()
        expect(setState2).not.toBeCalled()
        expect(setState3).not.toBeCalled()
        expect((api1 as any).dispatch).not.toBeCalled()
        expect((api2 as any).dispatch).not.toBeCalled()
        expect((api3 as any).dispatch).not.toBeCalled()

        console.error = originalConsoleError
      })
    })

    describe('DISPATCH and payload of type...', () => {
      it('RESET, it inits with initial state, connections are isolated from each other', async () => {
        const options1 = { testConnectionId: 'asdf' }
        const options2 = { testConnectionId: '2f' }
        const options3 = { testConnectionId: 'd2e' }
        const initialState1 = { count: 0 }
        const initialState2 = { count: 2 }
        const initialState3 = { count: 5 }
        const api1 = createStore(
          devtools(() => initialState1, { enabled: true, ...options1 }),
        )
        const api2 = createStore(
          devtools(() => initialState2, { enabled: true, ...options2 }),
        )
        const api3 = createStore(
          devtools(() => initialState3, { enabled: true, ...options3 }),
        )
        api1.setState({ count: 1 })
        api2.setState({ count: 3 })
        api3.setState({ count: 10 })

        const connections = getUnnamedConnectionApis(
          options1.testConnectionId,
          options2.testConnectionId,
          options3.testConnectionId,
        )
        const [connection1, connection2, connection3] = connections
        connections.forEach((conn) => conn.send.mockClear())
        const subscribers = getUnnamedConnectionSubscribers(
          options1.testConnectionId,
          options2.testConnectionId,
          options3.testConnectionId,
        )
        const action = {
          type: 'DISPATCH',
          payload: { type: 'RESET' },
        }
        subscribers.forEach((sub) => sub(action))

        expect(api1.getState()).toStrictEqual(initialState1)
        expect(api1.getState()).toStrictEqual(initialState1)
        expect(api1.getState()).toStrictEqual(initialState1)
        expect(connection1.init).toHaveBeenLastCalledWith(initialState1)
        expect(connection2.init).toHaveBeenLastCalledWith(initialState2)
        expect(connection3.init).toHaveBeenLastCalledWith(initialState3)
        connections.forEach((conn) => expect(conn.send).not.toBeCalled())
      })

      it('COMMIT, it inits with current state, connections are isolated from each other', async () => {
        const options1 = { testConnectionId: 'asdf' }
        const options2 = { testConnectionId: '2f' }
        const options3 = { testConnectionId: 'd2e' }
        const initialState1 = { count: 0 }
        const initialState2 = { count: 2 }
        const initialState3 = { count: 5 }
        const api1 = createStore(
          devtools(() => initialState1, { enabled: true, ...options1 }),
        )
        const api2 = createStore(
          devtools(() => initialState2, { enabled: true, ...options2 }),
        )
        const api3 = createStore(
          devtools(() => initialState3, { enabled: true, ...options3 }),
        )
        api1.setState({ count: 1 })
        api2.setState({ count: 3 })
        api3.setState({ count: 10 })
        const currentState1 = api1.getState()
        const currentState2 = api2.getState()
        const currentState3 = api3.getState()

        const connections = getUnnamedConnectionApis(
          options1.testConnectionId,
          options2.testConnectionId,
          options3.testConnectionId,
        )
        connections.forEach((conn) => conn.send.mockClear())
        const subscribers = getUnnamedConnectionSubscribers(
          options1.testConnectionId,
          options2.testConnectionId,
          options3.testConnectionId,
        )
        const action = {
          type: 'DISPATCH',
          payload: { type: 'COMMIT' },
        }
        subscribers.forEach((sub) => sub(action))

        const [connection1, connection2, connection3] = connections
        expect(connection1.init).toHaveBeenLastCalledWith(currentState1)
        expect(connection2.init).toHaveBeenLastCalledWith(currentState2)
        expect(connection3.init).toHaveBeenLastCalledWith(currentState3)
        connections.forEach((conn) => expect(conn.send).not.toBeCalled())
      })
    })

    describe('ROLLBACK...', () => {
      it('updates state without recording and inits with `message.state, connections are isolated from each other`', async () => {
        const options1 = { testConnectionId: 'asdf' }
        const options2 = { testConnectionId: '2f' }
        const options3 = { testConnectionId: 'd2e' }
        const initialState1 = { count: 0, increment: () => {} }
        const initialState2 = { count: 2, increment: () => {} }
        const initialState3 = { count: 5, increment: () => {} }
        const api1 = createStore(
          devtools(() => initialState1, { enabled: true, ...options1 }),
        )
        const api2 = createStore(
          devtools(() => initialState2, { enabled: true, ...options2 }),
        )
        const api3 = createStore(
          devtools(() => initialState3, { enabled: true, ...options3 }),
        )
        const newState1 = { foo: 'bar1' }
        const newState2 = { foo: 'bar2' }
        const newState3 = { foo: 'bar3' }

        const connections = getUnnamedConnectionApis(
          options1.testConnectionId,
          options2.testConnectionId,
          options3.testConnectionId,
        )
        connections.forEach((conn) => conn.send.mockClear())
        const [
          connectionSubscriber1,
          connectionSubscriber2,
          connectionSubscriber3,
        ] = getUnnamedConnectionSubscribers(
          options1.testConnectionId,
          options2.testConnectionId,
          options3.testConnectionId,
        )
        connectionSubscriber1({
          type: 'DISPATCH',
          payload: { type: 'ROLLBACK' },
          state: JSON.stringify(newState1),
        })
        connectionSubscriber2({
          type: 'DISPATCH',
          payload: { type: 'ROLLBACK' },
          state: JSON.stringify(newState2),
        })
        connectionSubscriber3({
          type: 'DISPATCH',
          payload: { type: 'ROLLBACK' },
          state: JSON.stringify(newState3),
        })

        expect(api1.getState()).toStrictEqual({
          ...initialState1,
          ...newState1,
        })
        expect(api2.getState()).toStrictEqual({
          ...initialState2,
          ...newState2,
        })
        expect(api3.getState()).toStrictEqual({
          ...initialState3,
          ...newState3,
        })
        const [connection1, connection2, connection3] = connections
        expect(connection1.init).toHaveBeenLastCalledWith({
          ...initialState1,
          ...newState1,
        })
        expect(connection2.init).toHaveBeenLastCalledWith({
          ...initialState2,
          ...newState2,
        })
        expect(connection3.init).toHaveBeenLastCalledWith({
          ...initialState3,
          ...newState3,
        })
        connections.forEach((conn) => expect(conn.send).not.toBeCalled())
      })

      it('does not throw for unparsable `message.state`, connections are isolated from each other', async () => {
        const increment1 = () => {}
        const increment2 = () => {}
        const increment3 = () => {}
        const options1 = { testConnectionId: 'asdf' }
        const options2 = { testConnectionId: '2f' }
        const options3 = { testConnectionId: 'd2e' }
        const initialState1 = { count: 0, increment: increment1 }
        const initialState2 = { count: 2, increment: increment2 }
        const initialState3 = { count: 5, increment: increment3 }
        const api1 = createStore(
          devtools(() => initialState1, { enabled: true, ...options1 }),
        )
        const api2 = createStore(
          devtools(() => initialState2, { enabled: true, ...options2 }),
        )
        const api3 = createStore(
          devtools(() => initialState3, { enabled: true, ...options3 }),
        )
        const originalConsoleError = console.error
        console.error = vi.fn()

        const connections = getUnnamedConnectionApis(
          options1.testConnectionId,
          options2.testConnectionId,
          options3.testConnectionId,
        )
        connections.forEach((conn) => conn.init.mockClear())
        connections.forEach((conn) => conn.send.mockClear())
        const [
          connectionSubscriber1,
          connectionSubscriber2,
          connectionSubscriber3,
        ] = getUnnamedConnectionSubscribers(
          options1.testConnectionId,
          options2.testConnectionId,
          options3.testConnectionId,
        )
        connectionSubscriber1({
          type: 'DISPATCH',
          payload: { type: 'ROLLBACK' },
          state: 'foobar',
        })
        expect(console.error).toHaveBeenLastCalledWith(
          '[zustand devtools middleware] Could not parse the received json',
          (() => {
            try {
              JSON.parse('foobar')
            } catch (e) {
              return e
            }
          })(),
        )
        connectionSubscriber2({
          type: 'DISPATCH',
          payload: { type: 'ROLLBACK' },
          state: 'foobar1',
        })
        expect(console.error).toHaveBeenLastCalledWith(
          '[zustand devtools middleware] Could not parse the received json',
          (() => {
            try {
              JSON.parse('foobar1')
            } catch (e) {
              return e
            }
          })(),
        )
        connectionSubscriber3({
          type: 'DISPATCH',
          payload: { type: 'ROLLBACK' },
          state: 'foobar3',
        })
        expect(console.error).toHaveBeenLastCalledWith(
          '[zustand devtools middleware] Could not parse the received json',
          (() => {
            try {
              JSON.parse('foobar3')
            } catch (e) {
              return e
            }
          })(),
        )

        expect(api1.getState()).toBe(initialState1)
        expect(api2.getState()).toBe(initialState2)
        expect(api3.getState()).toBe(initialState3)
        connections.forEach((conn) => {
          expect(conn.init).not.toBeCalled()
          expect(conn.send).not.toBeCalled()
        })

        console.error = originalConsoleError
      })
    })

    describe('JUMP_TO_STATE...', () => {
      const increment1 = () => {}
      const increment2 = () => {}
      const increment3 = () => {}

      it('updates state without recording with `message.state`, connections are isolated from each other', async () => {
        const options1 = { testConnectionId: 'asdf' }
        const options2 = { testConnectionId: '2f' }
        const options3 = { testConnectionId: 'd2e' }
        const initialState1 = { count: 0, increment: increment1 }
        const initialState2 = { count: 2, increment: increment2 }
        const initialState3 = { count: 5, increment: increment3 }
        const api1 = createStore(
          devtools(() => initialState1, { enabled: true, ...options1 }),
        )
        const api2 = createStore(
          devtools(() => initialState2, { enabled: true, ...options2 }),
        )
        const api3 = createStore(
          devtools(() => initialState3, { enabled: true, ...options3 }),
        )
        const newState1 = { foo: 'bar1' }
        const newState2 = { foo: 'bar2' }
        const newState3 = { foo: 'bar3' }

        const connections = getUnnamedConnectionApis(
          options1.testConnectionId,
          options2.testConnectionId,
          options3.testConnectionId,
        )
        connections.forEach((conn) => conn.send.mockClear())
        const [
          connectionSubscriber1,
          connectionSubscriber2,
          connectionSubscriber3,
        ] = getUnnamedConnectionSubscribers(
          options1.testConnectionId,
          options2.testConnectionId,
          options3.testConnectionId,
        )
        connectionSubscriber1({
          type: 'DISPATCH',
          payload: { type: 'JUMP_TO_STATE' },
          state: JSON.stringify(newState1),
        })
        connectionSubscriber2({
          type: 'DISPATCH',
          payload: { type: 'JUMP_TO_STATE' },
          state: JSON.stringify(newState2),
        })
        connectionSubscriber3({
          type: 'DISPATCH',
          payload: { type: 'JUMP_TO_STATE' },
          state: JSON.stringify(newState3),
        })

        expect(api1.getState()).toStrictEqual({
          ...initialState1,
          ...newState1,
        })
        expect(api2.getState()).toStrictEqual({
          ...initialState2,
          ...newState2,
        })
        expect(api3.getState()).toStrictEqual({
          ...initialState3,
          ...newState3,
        })
        connections.forEach((conn) => expect(conn.send).not.toBeCalled())
      })

      it('does not throw for unparsable `message.state`, connections are isolated from each other', async () => {
        const options1 = { testConnectionId: 'asdf' }
        const options2 = { testConnectionId: '2f' }
        const options3 = { testConnectionId: 'd2e' }
        const initialState1 = { count: 0, increment: increment1 }
        const initialState2 = { count: 2, increment: increment2 }
        const initialState3 = { count: 5, increment: increment3 }
        const api1 = createStore(
          devtools(() => initialState1, { enabled: true, ...options1 }),
        )
        const api2 = createStore(
          devtools(() => initialState2, { enabled: true, ...options2 }),
        )
        const api3 = createStore(
          devtools(() => initialState3, { enabled: true, ...options3 }),
        )
        const originalConsoleError = console.error
        console.error = vi.fn()

        const connections = getUnnamedConnectionApis(
          options1.testConnectionId,
          options2.testConnectionId,
          options3.testConnectionId,
        )
        connections.forEach((conn) => conn.send.mockClear())
        const [
          connectionSubscriber1,
          connectionSubscriber2,
          connectionSubscriber3,
        ] = getUnnamedConnectionSubscribers(
          options1.testConnectionId,
          options2.testConnectionId,
          options3.testConnectionId,
        )

        connectionSubscriber1({
          type: 'DISPATCH',
          payload: { type: 'JUMP_TO_STATE' },
          state: 'foobar',
        })
        expect(console.error).toHaveBeenLastCalledWith(
          '[zustand devtools middleware] Could not parse the received json',
          (() => {
            try {
              JSON.parse('foobar')
            } catch (e) {
              return e
            }
          })(),
        )
        connectionSubscriber2({
          type: 'DISPATCH',
          payload: { type: 'JUMP_TO_STATE' },
          state: 'foobar2',
        })
        expect(console.error).toHaveBeenLastCalledWith(
          '[zustand devtools middleware] Could not parse the received json',
          (() => {
            try {
              JSON.parse('foobar2')
            } catch (e) {
              return e
            }
          })(),
        )
        connectionSubscriber3({
          type: 'DISPATCH',
          payload: { type: 'JUMP_TO_STATE' },
          state: 'foobar3',
        })
        expect(console.error).toHaveBeenLastCalledWith(
          '[zustand devtools middleware] Could not parse the received json',
          (() => {
            try {
              JSON.parse('foobar3')
            } catch (e) {
              return e
            }
          })(),
        )

        expect(api1.getState()).toBe(initialState1)
        expect(api2.getState()).toBe(initialState2)
        expect(api3.getState()).toBe(initialState3)
        connections.forEach((conn) => expect(conn.send).not.toBeCalled())

        console.error = originalConsoleError
      })
    })

    describe('JUMP_TO_ACTION...', () => {
      const increment1 = () => {}
      const increment2 = () => {}
      const increment3 = () => {}

      it('updates state without recording with `message.state`, connections are isolated from each other', async () => {
        const options1 = { testConnectionId: 'asdf' }
        const options2 = { testConnectionId: '2f' }
        const options3 = { testConnectionId: 'd2e' }
        const initialState1 = { count: 0, increment: increment1 }
        const initialState2 = { count: 2, increment: increment2 }
        const initialState3 = { count: 5, increment: increment3 }
        const api1 = createStore(
          devtools(() => initialState1, { enabled: true, ...options1 }),
        )
        const api2 = createStore(
          devtools(() => initialState2, { enabled: true, ...options2 }),
        )
        const api3 = createStore(
          devtools(() => initialState3, { enabled: true, ...options3 }),
        )
        const newState1 = { foo: 'bar1' }
        const newState2 = { foo: 'bar2' }
        const newState3 = { foo: 'bar3' }

        const connections = getUnnamedConnectionApis(
          options1.testConnectionId,
          options2.testConnectionId,
          options3.testConnectionId,
        )
        connections.forEach((conn) => conn.send.mockClear())
        const [
          connectionSubscriber1,
          connectionSubscriber2,
          connectionSubscriber3,
        ] = getUnnamedConnectionSubscribers(
          options1.testConnectionId,
          options2.testConnectionId,
          options3.testConnectionId,
        )

        connectionSubscriber1({
          type: 'DISPATCH',
          payload: { type: 'JUMP_TO_ACTION' },
          state: JSON.stringify(newState1),
        })
        connectionSubscriber2({
          type: 'DISPATCH',
          payload: { type: 'JUMP_TO_ACTION' },
          state: JSON.stringify(newState2),
        })
        connectionSubscriber3({
          type: 'DISPATCH',
          payload: { type: 'JUMP_TO_ACTION' },
          state: JSON.stringify(newState3),
        })

        expect(api1.getState()).toStrictEqual({
          ...initialState1,
          ...newState1,
        })
        expect(api2.getState()).toStrictEqual({
          ...initialState2,
          ...newState2,
        })
        expect(api3.getState()).toStrictEqual({
          ...initialState3,
          ...newState3,
        })
        connections.forEach((conn) => expect(conn.send).not.toBeCalled())
      })

      it('does not throw for unparsable `message.state`, connections are isolated from each other', async () => {
        const options1 = { testConnectionId: 'asdf' }
        const options2 = { testConnectionId: '2f' }
        const options3 = { testConnectionId: 'd2e' }
        const initialState1 = { count: 0, increment: increment1 }
        const initialState2 = { count: 2, increment: increment2 }
        const initialState3 = { count: 5, increment: increment3 }
        const api1 = createStore(
          devtools(() => initialState1, { enabled: true, ...options1 }),
        )
        const api2 = createStore(
          devtools(() => initialState2, { enabled: true, ...options2 }),
        )
        const api3 = createStore(
          devtools(() => initialState3, { enabled: true, ...options3 }),
        )
        const originalConsoleError = console.error
        console.error = vi.fn()

        const connections = getUnnamedConnectionApis(
          options1.testConnectionId,
          options2.testConnectionId,
          options3.testConnectionId,
        )
        connections.forEach((conn) => conn.send.mockClear())
        const [
          connectionSubscriber1,
          connectionSubscriber2,
          connectionSubscriber3,
        ] = getUnnamedConnectionSubscribers(
          options1.testConnectionId,
          options2.testConnectionId,
          options3.testConnectionId,
        )
        connectionSubscriber1({
          type: 'DISPATCH',
          payload: { type: 'JUMP_TO_ACTION' },
          state: 'foobar',
        })
        expect(console.error).toHaveBeenLastCalledWith(
          '[zustand devtools middleware] Could not parse the received json',
          (() => {
            try {
              JSON.parse('foobar')
            } catch (e) {
              return e
            }
          })(),
        )
        connectionSubscriber2({
          type: 'DISPATCH',
          payload: { type: 'JUMP_TO_ACTION' },
          state: 'foobar2',
        })
        expect(console.error).toHaveBeenLastCalledWith(
          '[zustand devtools middleware] Could not parse the received json',
          (() => {
            try {
              JSON.parse('foobar2')
            } catch (e) {
              return e
            }
          })(),
        )
        connectionSubscriber3({
          type: 'DISPATCH',
          payload: { type: 'JUMP_TO_ACTION' },
          state: 'foobar3',
        })
        expect(console.error).toHaveBeenLastCalledWith(
          '[zustand devtools middleware] Could not parse the received json',
          (() => {
            try {
              JSON.parse('foobar3')
            } catch (e) {
              return e
            }
          })(),
        )

        expect(api1.getState()).toBe(initialState1)
        expect(api2.getState()).toBe(initialState2)
        expect(api3.getState()).toBe(initialState3)
        connections.forEach((conn) => expect(conn.send).not.toBeCalled())

        console.error = originalConsoleError
      })

      it('IMPORT_STATE, it updates state without recording and inits the last computedState, connections are isolated from each other', async () => {
        const options1 = { testConnectionId: 'asdf' }
        const options2 = { testConnectionId: '2f' }
        const options3 = { testConnectionId: 'd2e' }
        const initialState1 = { count: 0, increment: increment1 }
        const initialState2 = { count: 2, increment: increment2 }
        const initialState3 = { count: 5, increment: increment3 }
        const api1 = createStore(
          devtools(() => initialState1, { enabled: true, ...options1 }),
        )
        const api2 = createStore(
          devtools(() => initialState2, { enabled: true, ...options2 }),
        )
        const api3 = createStore(
          devtools(() => initialState3, { enabled: true, ...options3 }),
        )
        const nextLiftedState1 = {
          computedStates: [{ state: { count: 4 } }, { state: { count: 5 } }],
        }
        const nextLiftedState2 = {
          computedStates: [{ state: { count: 20 } }, { state: { count: 8 } }],
        }
        const nextLiftedState3 = {
          computedStates: [{ state: { count: 12 } }, { state: { count: 100 } }],
        }

        const connections = getUnnamedConnectionApis(
          options1.testConnectionId,
          options2.testConnectionId,
          options3.testConnectionId,
        )
        connections.forEach((conn) => conn.send.mockClear())
        const [
          connectionSubscriber1,
          connectionSubscriber2,
          connectionSubscriber3,
        ] = getUnnamedConnectionSubscribers(
          options1.testConnectionId,
          options2.testConnectionId,
          options3.testConnectionId,
        )

        connectionSubscriber1({
          type: 'DISPATCH',
          payload: {
            type: 'IMPORT_STATE',
            nextLiftedState: nextLiftedState1,
          },
        })
        connectionSubscriber2({
          type: 'DISPATCH',
          payload: {
            type: 'IMPORT_STATE',
            nextLiftedState: nextLiftedState2,
          },
        })
        connectionSubscriber3({
          type: 'DISPATCH',
          payload: {
            type: 'IMPORT_STATE',
            nextLiftedState: nextLiftedState3,
          },
        })

        expect(api1.getState()).toStrictEqual({
          ...initialState1,
          ...nextLiftedState1.computedStates.slice(-1)[0]?.state,
        })
        expect(api2.getState()).toStrictEqual({
          ...initialState2,
          ...nextLiftedState2.computedStates.slice(-1)[0]?.state,
        })
        expect(api3.getState()).toStrictEqual({
          ...initialState3,
          ...nextLiftedState3.computedStates.slice(-1)[0]?.state,
        })
        const [connection1, connection2, connection3] = connections
        expect(connection1.send).toHaveBeenLastCalledWith(
          null,
          nextLiftedState1,
        )
        expect(connection2.send).toHaveBeenLastCalledWith(
          null,
          nextLiftedState2,
        )
        expect(connection3.send).toHaveBeenLastCalledWith(
          null,
          nextLiftedState3,
        )
      })

      it('PAUSE_RECORDING, it toggles the sending of actions, connections are isolated from each other', async () => {
        const options1 = { testConnectionId: 'asdf' }
        const options2 = { testConnectionId: '2f' }
        const options3 = { testConnectionId: 'd2e' }
        const api1 = createStore(
          devtools(() => ({ count: 0 }), { enabled: true, ...options1 }),
        )
        const api2 = createStore(
          devtools(() => ({ count: 2 }), { enabled: true, ...options2 }),
        )
        const api3 = createStore(
          devtools(() => ({ count: 4 }), { enabled: true, ...options3 }),
        )

        const newState1 = { count: 1 }
        const newState2 = { count: 12 }
        const newState3 = { count: 30 }
        api1.setState(newState1, false, 'increment')
        api2.setState(newState2, false, 'increment')
        api3.setState(newState3, false, 'increment')

        const [connection1, connection2, connection3] =
          getUnnamedConnectionApis(
            options1.testConnectionId,
            options2.testConnectionId,
            options3.testConnectionId,
          )
        const [
          connectionSubscriber1,
          connectionSubscriber2,
          connectionSubscriber3,
        ] = getUnnamedConnectionSubscribers(
          options1.testConnectionId,
          options2.testConnectionId,
          options3.testConnectionId,
        )

        expect(connection1.send).toHaveBeenLastCalledWith(
          { type: 'increment' },
          newState1,
        )
        connectionSubscriber1({
          type: 'DISPATCH',
          payload: { type: 'PAUSE_RECORDING' },
        })
        api1.setState({ count: 2 }, false, 'increment')
        expect(connection1.send).toHaveBeenLastCalledWith(
          { type: 'increment' },
          newState1,
        )
        connectionSubscriber1({
          type: 'DISPATCH',
          payload: { type: 'PAUSE_RECORDING' },
        })
        api1.setState({ count: 3 }, false, 'increment')
        expect(connection1.send).toHaveBeenLastCalledWith(
          { type: 'increment' },
          { count: 3 },
        )

        expect(connection2.send).toHaveBeenLastCalledWith(
          { type: 'increment' },
          newState2,
        )
        connectionSubscriber2({
          type: 'DISPATCH',
          payload: { type: 'PAUSE_RECORDING' },
        })
        api2.setState({ count: 2 }, false, 'increment')
        expect(connection2.send).toHaveBeenLastCalledWith(
          { type: 'increment' },
          newState2,
        )
        connectionSubscriber2({
          type: 'DISPATCH',
          payload: { type: 'PAUSE_RECORDING' },
        })
        api2.setState({ count: 3 }, false, 'increment')
        expect(connection2.send).toHaveBeenLastCalledWith(
          { type: 'increment' },
          { count: 3 },
        )

        expect(connection3.send).toHaveBeenLastCalledWith(
          { type: 'increment' },
          newState3,
        )
        connectionSubscriber3({
          type: 'DISPATCH',
          payload: { type: 'PAUSE_RECORDING' },
        })
        api3.setState({ count: 2 }, false, 'increment')
        expect(connection3.send).toHaveBeenLastCalledWith(
          { type: 'increment' },
          newState3,
        )
        connectionSubscriber3({
          type: 'DISPATCH',
          payload: { type: 'PAUSE_RECORDING' },
        })
        api3.setState({ count: 3 }, false, 'increment')
        expect(connection3.send).toHaveBeenLastCalledWith(
          { type: 'increment' },
          { count: 3 },
        )
      })
    })
  })
})

describe('when create devtools was called multiple times with `name` and `store` options defined', () => {
  describe('when `type` was provided in store state methods as option', () => {
    describe('When state changes...', () => {
      it("sends { type: setStateName || 'anonymous`, ...rest } as the action with current state", async () => {
        const options = {
          name: 'testOptionsName',
          store: 'someStore',
          enabled: true,
        }
        const api = createStore(
          devtools(() => ({ count: 0, foo: 'bar' }), options),
        )

        const testStateActionType = 'testSetStateName'

        api.setState({ count: 10 }, false, testStateActionType)
        const [connection] = getNamedConnectionApis(options.name)
        expect(connection.send).toHaveBeenLastCalledWith(
          { type: `${options.store}/${testStateActionType}` },
          { [options.store]: { count: 10, foo: 'bar' } },
        )

        api.setState({ count: 15 }, false, {
          type: testStateActionType,
          payload: 15,
        })
        expect(connection.send).toHaveBeenLastCalledWith(
          { type: `${options.store}/${testStateActionType}`, payload: 15 },
          { [options.store]: { count: 15, foo: 'bar' } },
        )

        api.setState({ count: 5, foo: 'baz' }, true)
        expect(connection.send).toHaveBeenLastCalledWith(
          { type: `${options.store}/anonymous` },
          { [options.store]: { count: 5, foo: 'baz' } },
        )
      })
    })

    describe('when it receives a message of type...', () => {
      describe('ACTION...', () => {
        it('does nothing, connections isolated from each other', async () => {
          const options1 = { testConnectionId: '123', store: 'store1' }
          const options2 = { testConnectionId: '231', store: 'store2' }
          const initialState1 = { count: 0 }
          const initialState2 = { count: 2 }
          const initialState3 = { count: 5 }
          const initialState4 = { count: 6 }
          const api1 = createStore(
            devtools(() => initialState1, {
              enabled: true,
              ...options1,
            }),
          )
          const api2 = createStore(
            devtools(() => initialState2, {
              enabled: true,
              ...options1,
            }),
          )
          const api3 = createStore(
            devtools(() => initialState3, {
              enabled: true,
              ...options2,
            }),
          )
          const api4 = createStore(
            devtools(() => initialState4, {
              enabled: true,
              ...options2,
            }),
          )
          const setState1 = vi.spyOn(api1, 'setState')
          const setState2 = vi.spyOn(api2, 'setState')
          const setState3 = vi.spyOn(api3, 'setState')
          const setState4 = vi.spyOn(api4, 'setState')

          const [subscriber] = getUnnamedConnectionSubscribers(
            options1.testConnectionId,
          )
          subscriber({
            type: 'ACTION',
            payload: '{ "type": "INCREMENT" }',
          })

          expect(api1.getState()).toBe(initialState1)
          expect(api2.getState()).toBe(initialState2)
          expect(api3.getState()).toBe(initialState3)
          expect(api4.getState()).toBe(initialState4)
          expect(setState1).not.toBeCalled()
          expect(setState2).not.toBeCalled()
          expect(setState3).not.toBeCalled()
          expect(setState4).not.toBeCalled()
        })

        it('unless action type is __setState, connections isolated from each other', async () => {
          const name1 = 'name1'
          const name2 = 'name2'
          const store1 = 'someStore1'
          const store2 = 'someStore2'
          const options1 = {
            name: name1,
            store: store1,
            testStore: store1,
          }
          const options2 = {
            name: name2,
            store: store2,
            testStore: store2,
          }
          const initialState1 = { count: 0 }
          const initialState2 = { count: 2 }
          const api1 = createStore(
            devtools(() => initialState1, { enabled: true, ...options1 }),
          )
          const api2 = createStore(
            devtools(() => initialState2, { enabled: true, ...options2 }),
          )
          const originalConsoleError = console.error
          console.error = vi.fn()

          const [connectionSubscriber] = getNamedConnectionSubscribers(
            getKeyFromOptions(options1),
          )
          connectionSubscriber({
            type: 'ACTION',
            payload:
              '{ "type": "__setState", "state": { "foo": "bar", "foo2": "bar2" } }',
          })

          expect(console.error).toHaveBeenCalledWith(
            expect.stringContaining(
              '[zustand devtools middleware] Unsupported __setState',
            ),
          )
          connectionSubscriber({
            type: 'ACTION',
            payload: `{ "type": "__setState", "state": { "${options1.store}": { "foo": "bar" } } }`,
          })

          expect(console.error).toHaveBeenCalledTimes(1)

          expect(api1.getState()).toStrictEqual({
            ...initialState1,
            foo: 'bar',
          })
          expect(api2.getState()).toStrictEqual({ ...initialState2 })

          console.error = originalConsoleError
        })

        it('does nothing even if there is `api.dispatch`, connections isolated from each other', async () => {
          const { devtools: newDevtools } = await import('zustand/middleware')

          const name1 = 'name1'
          const name2 = 'name2'
          const store1 = 'someStore1'
          const store2 = 'someStore2'
          const options1 = {
            name: name1,
            store: store1,
            testStore: store1,
          }
          const options2 = {
            name: name2,
            store: store2,
            testStore: store2,
          }
          const initialState1 = { count: 0 }
          const initialState2 = { count: 2 }
          const api1 = createStore(
            newDevtools(() => initialState1, { enabled: true, ...options1 }),
          )
          const api2 = createStore(
            newDevtools(() => initialState2, { enabled: true, ...options2 }),
          )
          ;(api1 as any).dispatch = vi.fn()
          ;(api2 as any).dispatch = vi.fn()
          const setState1 = vi.spyOn(api1, 'setState')
          const setState2 = vi.spyOn(api2, 'setState')

          const subscribers = getNamedConnectionSubscribers(
            getKeyFromOptions(options1),
            getKeyFromOptions(options2),
          )
          const testPayload = {
            type: 'ACTION',
            payload: '{ "type": "INCREMENT" }',
          }
          subscribers.forEach((sub) => sub(testPayload))

          expect(api1.getState()).toBe(initialState1)
          expect(api2.getState()).toBe(initialState2)
          expect(setState1).not.toBeCalled()
          expect(setState2).not.toBeCalled()
          expect((api1 as any).dispatch).not.toBeCalled()
          expect((api2 as any).dispatch).not.toBeCalled()
        })

        it('dispatches with `api.dispatch` when `api.dispatchFromDevtools` is set to true, connections are isolated from each other', async () => {
          const { devtools: newDevtools } = await import('zustand/middleware')
          const name1 = 'name1'
          const name2 = 'name2'
          const store1 = 'someStore1'
          const store2 = 'someStore2'
          const options1 = {
            name: name1,
            store: store1,
            testStore: store1,
          }
          const options2 = {
            name: name2,
            store: store2,
            testStore: store2,
          }
          const initialState1 = { count: 0 }
          const initialState2 = { count: 2 }
          const api1 = createStore(
            newDevtools(() => initialState1, { enabled: true, ...options1 }),
          )
          const api2 = createStore(
            newDevtools(() => initialState2, { enabled: true, ...options2 }),
          )
          ;(api1 as any).dispatch = vi.fn()
          ;(api1 as any).dispatchFromDevtools = true
          ;(api2 as any).dispatch = vi.fn()
          ;(api2 as any).dispatchFromDevtools = true
          const setState1 = vi.spyOn(api1, 'setState')
          const setState2 = vi.spyOn(api2, 'setState')

          const subscribers = getNamedConnectionSubscribers(
            getKeyFromOptions(options1),
            getKeyFromOptions(options2),
          )
          const getTestPayload = (n: number) => ({
            type: 'ACTION',
            payload: `{ "type": "INCREMENT${n}" }`,
          })
          subscribers.forEach((sub, i) => sub(getTestPayload(i + 1)))

          expect(api1.getState()).toBe(initialState1)
          expect(api2.getState()).toBe(initialState2)
          expect(setState1).not.toBeCalled()
          expect(setState2).not.toBeCalled()
          expect((api1 as any).dispatch).toHaveBeenLastCalledWith({
            type: 'INCREMENT1',
          })
          expect((api2 as any).dispatch).toHaveBeenLastCalledWith({
            type: 'INCREMENT2',
          })
        })
      })
    })
  })
})
