import { describe, expect, it } from 'vitest'
import { shallow } from 'zustand/vanilla/shallow'

describe('shallow', () => {
  it('compares primitive values', () => {
    expect(shallow(true, true)).toBe(true)
    expect(shallow(true, false)).toBe(false)

    expect(shallow(1, 1)).toBe(true)
    expect(shallow(1, 2)).toBe(false)

    expect(shallow('zustand', 'zustand')).toBe(true)
    expect(shallow('zustand', 'redux')).toBe(false)
  })

  it('compares objects', () => {
    expect(shallow({ foo: 'bar', asd: 123 }, { foo: 'bar', asd: 123 })).toBe(
      true,
    )

    expect(
      shallow({ foo: 'bar', asd: 123 }, { foo: 'bar', foobar: true }),
    ).toBe(false)

    expect(
      shallow({ foo: 'bar', asd: 123 }, { foo: 'bar', asd: 123, foobar: true }),
    ).toBe(false)
  })

  it('compares arrays', () => {
    expect(shallow([1, 2, 3], [1, 2, 3])).toBe(true)

    expect(shallow([1, 2, 3], [2, 3, 4])).toBe(false)

    expect(
      shallow([{ foo: 'bar' }, { asd: 123 }], [{ foo: 'bar' }, { asd: 123 }]),
    ).toBe(false)

    expect(shallow([{ foo: 'bar' }], [{ foo: 'bar', asd: 123 }])).toBe(false)

    expect(shallow([1, 2, 3], [2, 3, 1])).toBe(false)
  })

  it('compares Maps', () => {
    expect(
      shallow(
        new Map<string, unknown>([
          ['foo', 'bar'],
          ['asd', 123],
        ]),
        new Map<string, unknown>([
          ['foo', 'bar'],
          ['asd', 123],
        ]),
      ),
    ).toBe(true)

    expect(
      shallow(
        new Map<string, unknown>([
          ['foo', 'bar'],
          ['asd', 123],
        ]),
        new Map<string, unknown>([
          ['asd', 123],
          ['foo', 'bar'],
        ]),
      ),
    ).toBe(true)

    expect(
      shallow(
        new Map<string, unknown>([
          ['foo', 'bar'],
          ['asd', 123],
        ]),
        new Map<string, unknown>([
          ['foo', 'bar'],
          ['foobar', true],
        ]),
      ),
    ).toBe(false)

    expect(
      shallow(
        new Map<string, unknown>([
          ['foo', 'bar'],
          ['asd', 123],
        ]),
        new Map<string, unknown>([
          ['foo', 'bar'],
          ['asd', 123],
          ['foobar', true],
        ]),
      ),
    ).toBe(false)
  })

  it('compares Sets', () => {
    expect(shallow(new Set(['bar', 123]), new Set(['bar', 123]))).toBe(true)

    expect(shallow(new Set(['bar', 123]), new Set([123, 'bar']))).toBe(true)

    expect(shallow(new Set(['bar', 123]), new Set(['bar', 2]))).toBe(false)

    expect(shallow(new Set(['bar', 123]), new Set(['bar', 123, true]))).toBe(
      false,
    )
  })

  it('compares functions', () => {
    function firstFnCompare() {
      return { foo: 'bar' }
    }

    function secondFnCompare() {
      return { foo: 'bar' }
    }

    expect(shallow(firstFnCompare, firstFnCompare)).toBe(true)

    expect(shallow(secondFnCompare, secondFnCompare)).toBe(true)

    expect(shallow(firstFnCompare, secondFnCompare)).toBe(false)
  })

  it('compares URLSearchParams', () => {
    const a = new URLSearchParams({ hello: 'world' })
    const b = new URLSearchParams({ zustand: 'shallow' })
    expect(shallow(a, b)).toBe(false)
  })

  it('should work with nested arrays (#2794)', () => {
    const arr = [1, 2]
    expect(shallow([arr, 1], [arr, 1])).toBe(true)
  })
})

describe('unsupported cases', () => {
  it('date', () => {
    expect(
      shallow(
        new Date('2022-07-19T00:00:00.000Z'),
        new Date('2022-07-20T00:00:00.000Z'),
      ),
    ).not.toBe(false)
  })
})
