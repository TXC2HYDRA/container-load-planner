import assert from 'node:assert/strict'
import test from 'node:test'
import { planContainerLoad } from '../src/index.ts'
import type { PlanInput } from '../src/index.ts'

const base = (over: Partial<PlanInput> = {}): PlanInput => ({
  container: { length: 1000, width: 800, height: 600, maxPayloadKg: 100000 },
  item: { length: 100, width: 100, height: 100, weightKg: 1 },
  ...over,
})

test('simple grid fills the container', () => {
  const r = planContainerLoad(base())
  assert.equal(r.count, 480)
  assert.deepEqual(r.grid, { along: 10, across: 8, layers: 6 })
  assert.equal(r.volumeUtilisation, 1)
  assert.equal(r.limitedBy, 'geometry')
})

test('picks the better footprint orientation', () => {
  const r = planContainerLoad({
    container: { length: 1000, width: 600, height: 500, maxPayloadKg: 1e6 },
    item: { length: 300, width: 200, height: 500, weightKg: 1 },
  })
  assert.equal(r.count, 10) // as given: 3 x 3 = 9; turned: 5 x 2 = 10
  assert.deepEqual(r.orientation, { length: 200, width: 300, height: 500 })
})

test("'any' rotation fits what 'upright' cannot", () => {
  const input = {
    container: { length: 900, width: 900, height: 300, maxPayloadKg: 1e6 },
    item: { length: 300, width: 300, height: 900, weightKg: 1 },
  }
  const upright = planContainerLoad(input)
  assert.equal(upright.count, 0)
  assert.equal(upright.limitedBy, 'geometry')
  const any = planContainerLoad({ ...input, rotation: 'any' })
  assert.equal(any.count, 3)
  assert.equal(any.orientation.height, 300)
})

test('payload caps the count', () => {
  const r = planContainerLoad(
    base({ container: { length: 1000, width: 1000, height: 1000, maxPayloadKg: 5000 }, item: { length: 100, width: 100, height: 100, weightKg: 10 } }),
  )
  assert.equal(r.geometricCount, 1000)
  assert.equal(r.payloadCount, 500)
  assert.equal(r.count, 500)
  assert.equal(r.limitedBy, 'payload')
  assert.equal(r.payloadUtilisation, 1)
  assert.equal(r.totalWeightKg, 5000)
})

test("'both' when geometry and payload agree", () => {
  const r = planContainerLoad(base({ container: { length: 1000, width: 800, height: 600, maxPayloadKg: 480 } }))
  assert.equal(r.limitedBy, 'both')
})

test('item heavier than payload gives zero', () => {
  const r = planContainerLoad(base({ item: { length: 100, width: 100, height: 100, weightKg: 500000 } }))
  assert.equal(r.count, 0)
  assert.equal(r.limitedBy, 'payload')
})

test('float division noise does not lose an item', () => {
  const r = planContainerLoad({
    container: { length: 0.3, width: 0.1, height: 0.1, maxPayloadKg: 10 },
    item: { length: 0.1, width: 0.1, height: 0.1, weightKg: 1 },
  })
  assert.equal(r.count, 3)
})

test('ties keep the as-given orientation', () => {
  const r = planContainerLoad(base())
  assert.deepEqual(r.orientation, { length: 100, width: 100, height: 100 })
})

test('invalid input is rejected', () => {
  const bad = (n: unknown) => base({ item: { length: n as number, width: 1, height: 1, weightKg: 1 } })
  for (const v of [0, -1, NaN, Infinity, '5', null, undefined]) {
    assert.throws(() => planContainerLoad(bad(v)), RangeError, `item.length=${String(v)}`)
  }
  assert.throws(() => planContainerLoad(base({ container: { length: 1, width: 1, height: 1, maxPayloadKg: 0 } })), RangeError)
  assert.throws(() => planContainerLoad(base({ rotation: 'spin' as never })), RangeError)
  assert.throws(() => planContainerLoad(null as never), TypeError)
  assert.throws(() => planContainerLoad({ container: base().container } as never), TypeError)
})

// --- boundaries -----------------------------------------------------------------------------

const cube = (d: number, kg = 1) => ({ length: d, width: d, height: d, weightKg: kg })
const box = (d: number, maxPayloadKg = 1e9) => ({ length: d, width: d, height: d, maxPayloadKg })

test('exact geometric fit: one item equal to the container', () => {
  const r = planContainerLoad({ container: box(100), item: cube(100) })
  assert.equal(r.count, 1)
  assert.equal(r.volumeUtilisation, 1)
})

test('an item just too large for the container does not fit', () => {
  for (const d of [100.001, 100.0001]) {
    const r = planContainerLoad({ container: box(100), item: cube(d) })
    assert.equal(r.count, 0, `item edge ${d}`)
    assert.equal(r.limitedBy, 'geometry')
  }
})

test('exact payload boundary', () => {
  const container = { length: 1000, width: 1000, height: 1000, maxPayloadKg: 10 }
  assert.equal(planContainerLoad({ container, item: cube(100, 10) }).count, 1) // 10 kg item, 10 kg payload
  const short = planContainerLoad({ container: { ...container, maxPayloadKg: 9.999 }, item: cube(100, 10) })
  assert.equal(short.count, 0)
  assert.equal(short.limitedBy, 'payload')
  assert.equal(planContainerLoad({ container: { ...container, maxPayloadKg: 0.3 }, item: cube(100, 0.1) }).count, 3) // 0.3 / 0.1 float noise
})

test('every numeric field rejects zero, negative, NaN, Infinity and non-numbers', () => {
  const fields: [string, string][] = [
    ['container', 'length'], ['container', 'width'], ['container', 'height'], ['container', 'maxPayloadKg'],
    ['item', 'length'], ['item', 'width'], ['item', 'height'], ['item', 'weightKg'],
  ]
  for (const [group, field] of fields) {
    for (const v of [0, -1, NaN, Infinity, -Infinity, '5', null, undefined, {}]) {
      const input = base()
      ;(input[group as 'container' | 'item'] as unknown as Record<string, unknown>)[field] = v
      assert.throws(() => planContainerLoad(input), RangeError, `${group}.${field}=${String(v)}`)
    }
  }
})

// --- invariants against an independent oracle -----------------------------------------------
// Integer dimensions let BigInt integer division act as an exact reference, with no tolerance involved.

test('geometric count matches an exact BigInt oracle and respects the documented bounds', () => {
  let seed = 12345
  const rnd = (max: number) => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
    return 1 + (seed % max)
  }
  const perms = (a: number[]): number[][] => [[a[0]!, a[1]!, a[2]!], [a[1]!, a[0]!, a[2]!], [a[0]!, a[2]!, a[1]!], [a[2]!, a[0]!, a[1]!], [a[1]!, a[2]!, a[0]!], [a[2]!, a[1]!, a[0]!]]
  for (let i = 0; i < 500; i++) {
    const c = [rnd(400), rnd(400), rnd(400)] as [number, number, number]
    const it = [rnd(120), rnd(120), rnd(120)] as [number, number, number]
    const weightKg = rnd(50)
    const maxPayloadKg = rnd(200000)
    for (const rotation of ['upright', 'any'] as const) {
      const candidates = perms(it).slice(0, rotation === 'upright' ? 2 : 6)
      const oracle = candidates.reduce((best, p) => {
        const n = (BigInt(c[0]) / BigInt(p[0]!)) * (BigInt(c[1]) / BigInt(p[1]!)) * (BigInt(c[2]) / BigInt(p[2]!))
        return n > best ? n : best
      }, 0n)
      const r = planContainerLoad({
        container: { length: c[0], width: c[1], height: c[2], maxPayloadKg },
        item: { length: it[0], width: it[1], height: it[2], weightKg },
        rotation,
      })
      assert.equal(BigInt(r.geometricCount), oracle, `geometry ${c} / ${it} / ${rotation}`)
      assert.equal(r.payloadCount, Math.floor(maxPayloadKg / weightKg))
      assert.equal(r.count, Math.min(r.geometricCount, r.payloadCount))
      // count x item volume <= container volume, within the documented 1e-9-relative tolerance
      assert.ok(r.volumeUtilisation <= 1 + 1e-8, `volume utilisation ${r.volumeUtilisation}`)
      assert.ok(r.totalWeightKg <= maxPayloadKg * (1 + 1e-8))
      assert.equal(r.grid.along * r.grid.across * r.grid.layers, r.geometricCount)
    }
  }
})

test('a within-tolerance overhang is accepted and utilisation may exceed 1 slightly (documented)', () => {
  const r = planContainerLoad({ container: box(100 - 1e-10), item: cube(100) })
  assert.equal(r.count, 1)
  assert.ok(r.volumeUtilisation > 1 && r.volumeUtilisation < 1 + 1e-8)
})

// --- extreme magnitudes (F1 regression) -----------------------------------------------------

test('unrepresentable magnitudes throw RangeError instead of returning Infinity or NaN', () => {
  const cases: [string, PlanInput][] = [
    ['reported: container 1e200, item 1e-300 (grid ratio overflows to Infinity)',
      { container: { length: 1e200, width: 1e200, height: 1e200, maxPayloadKg: 1e9 }, item: cube(1e-300, 1e-300) }],
    ['Infinity x 0 grid (previously NaN)',
      { container: { length: 1e200, width: 1, height: 1, maxPayloadKg: 1e9 }, item: { length: 1e-300, width: 2, height: 1, weightKg: 1 } }],
    ['grid counts finite but above 2^53',
      { container: { length: 1e20, width: 1e20, height: 1e20, maxPayloadKg: 1e9 }, item: cube(1) }],
    ['container volume overflows (previously NaN utilisation)',
      { container: { length: 1e103, width: 1e103, height: 1e103, maxPayloadKg: 1e12 }, item: cube(1e100) }],
    ['volumes underflow to 0 (previously NaN utilisation)',
      { container: { length: 1e-108, width: 1e-108, height: 1e-108, maxPayloadKg: 1 }, item: cube(1e-110, 1e-3) }],
    ['payload ratio overflows to Infinity (previously payloadCount Infinity)',
      { container: { length: 100, width: 100, height: 100, maxPayloadKg: 1e308 }, item: cube(10, 1e-10) }],
    ['payload ratio finite but above 2^53 (previously payloadCount 1e301)',
      { container: { length: 100, width: 100, height: 100, maxPayloadKg: 1e300 }, item: cube(10, 0.1) }],
  ]
  for (const [name, input] of cases) {
    assert.throws(() => planContainerLoad(input), { name: 'RangeError', message: /not representable/ }, name)
  }
})

test('utilisation that would overflow near Number.MAX_VALUE throws', () => {
  // 2 items fit along the length; count x item volume slightly exceeds MAX_VALUE because of the tolerance.
  const b = Math.cbrt((Number.MAX_VALUE * (1 - 1e-10)) / 2)
  const input: PlanInput = {
    container: { length: 2 * b, width: b, height: b, maxPayloadKg: 1e9 },
    item: { length: b * (1 + 4e-10), width: b * (1 + 4e-10), height: b * (1 + 4e-10), weightKg: 1 },
  }
  assert.throws(() => planContainerLoad(input), { name: 'RangeError', message: /volumeUtilisation/ })
})

test('large but representable inputs still work', () => {
  const r = planContainerLoad({ container: { length: 1e5, width: 1e5, height: 1e5, maxPayloadKg: 1e16 / 2 }, item: cube(1) })
  assert.equal(r.count, 1e15) // 1e5 x 1e5 x 1e5, below 2^53
  assert.equal(r.volumeUtilisation, 1)
})
