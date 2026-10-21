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
  assert.equal(r.volumeUtilisation, 0.5) // 500 of the 1000 items that fit: volume use follows count, not geometricCount
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
      assert.throws(
        () => planContainerLoad(input),
        { name: 'RangeError', message: new RegExp(`^${group}\\.${field} must be a finite number > 0, got `) },
        `${group}.${field}=${String(v)}`,
      )
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

// --- extreme magnitudes ---------------------------------------------------------------------
// Counts that cannot be exact integers throw; volumes that overflow or underflow are still computed.

const box3 = (a: number, b: number, c: number, maxPayloadKg = 1e9) => ({ length: a, width: b, height: c, maxPayloadKg })
const item3 = (a: number, b: number, c: number, weightKg = 1) => ({ length: a, width: b, height: c, weightKg })

test('counts that cannot be represented exactly throw RangeError instead of returning Infinity or NaN', () => {
  const cases: [string, PlanInput, RegExp][] = [
    ['reported: container 1e200, item 1e-300 (grid ratio overflows to Infinity)',
      { container: box3(1e200, 1e200, 1e200), item: item3(1e-300, 1e-300, 1e-300, 1e-300) }, /grid length count/],
    ['grid ratio is Infinity or unsafe on a fitting orientation (previously NaN)',
      { container: box3(1e200, 1, 1), item: item3(1e-300, 2, 1) }, /grid length count/],
    ['grid count finite but above 2^53', { container: box3(1e20, 1, 1), item: item3(1, 1, 1) }, /grid length count/],
    ['payload ratio overflows to Infinity (previously payloadCount Infinity)',
      { container: box3(100, 100, 100, 1e308), item: item3(10, 10, 10, 1e-10) }, /payload count/],
    ['payload ratio finite but above 2^53 (previously payloadCount 1e301)',
      { container: box3(100, 100, 100, 1e300), item: item3(10, 10, 10, 0.1) }, /payload count/],
  ]
  for (const [name, input, message] of cases) {
    assert.throws(() => planContainerLoad(input), { name: 'RangeError', message }, name)
  }
})

test('each axis count is checked and named when the other axes are non-zero', () => {
  assert.throws(() => planContainerLoad({ container: box3(1e20, 1, 1), item: item3(1, 1, 1) }), { name: 'RangeError', message: /^grid length count/ })
  assert.throws(() => planContainerLoad({ container: box3(1, 1e20, 1), item: item3(1, 1, 1) }), { name: 'RangeError', message: /^grid width count/ })
  assert.throws(() => planContainerLoad({ container: box3(1, 1, 1e20), item: item3(1, 1, 1) }), { name: 'RangeError', message: /^grid layer count/ })
})

test('item count (product of safe axis counts) must itself be a safe integer', () => {
  // 2^26 x 2^26 x 2 = 2^53 items: every axis is safe, the product is not.
  const side = 2 ** 26
  assert.throws(
    () => planContainerLoad({ container: box3(side, side, 2, 1e300), item: item3(1, 1, 1, 1e290) }),
    { name: 'RangeError', message: /^item count/ },
  )
  assert.throws(
    () => planContainerLoad({ container: box3(1e6, 1e6, 1e6, 1e300), item: item3(1, 1, 1, 1e290) }),
    { name: 'RangeError', message: /^item count/ },
  )
  // 2^26 x 2^26 x 1 = 2^52 is fine, and geometry-limited by a payload cap that is itself safe.
  const r = planContainerLoad({ container: box3(side, side, 1, Number.MAX_SAFE_INTEGER), item: item3(1, 1, 1, 1) })
  assert.equal(r.count, 2 ** 52)
  assert.equal(r.limitedBy, 'geometry')
  assert.equal(r.volumeUtilisation, 1)
})

test('an unsafe axis does not matter in an orientation where another axis already gives zero', () => {
  // 'any': the orientation that puts the 0.001 side along the 1e14 axis has 1e17 layers, but 0 along the others.
  const r = planContainerLoad({ container: box3(0.001, 0.001, 1e14, 1e15), item: item3(0.001, 0.001, 1), rotation: 'any' })
  assert.equal(r.count, 1e14)
  assert.deepEqual(r.orientation, { length: 0.001, width: 0.001, height: 1 })
  // Nothing fits, one axis is huge, still a valid answer of 0 and an exact reported grid.
  const none = planContainerLoad({ container: box3(0.001, 0.001, 1e14), item: item3(0.001, 0.5, 0.5), rotation: 'any' })
  assert.equal(none.count, 0)
  assert.deepEqual(none.grid, { along: 1, across: 0, layers: 2e14 })
})

test('when nothing fits the reported grid must still be exact, so an unsafe reported axis throws', () => {
  assert.throws(
    () => planContainerLoad({ container: box3(1e20, 1, 1), item: item3(1, 2, 2) }),
    { name: 'RangeError', message: /^grid length count/ },
  )
})

test('payload count at the safe-integer limit; beyond it is a documented false rejection', () => {
  const geometry = { container: box3(10, 10, 10, Number.MAX_SAFE_INTEGER), item: item3(5, 5, 5, 1) }
  const ok = planContainerLoad(geometry)
  assert.equal(ok.payloadCount, Number.MAX_SAFE_INTEGER)
  assert.equal(ok.count, 8)
  assert.equal(ok.limitedBy, 'geometry')
  // Geometry would limit the count to 8 here too, but payloadCount (2^53) cannot be reported exactly.
  assert.throws(
    () => planContainerLoad({ ...geometry, container: box3(10, 10, 10, 2 ** 53) }),
    { name: 'RangeError', message: /^payload count/ },
  )
})

test('totalWeightKg that rounds to Infinity at the double limit throws', () => {
  assert.throws(
    () => planContainerLoad({ container: box3(10, 10, 10, Number.MAX_VALUE), item: item3(1, 1, 1, Number.MAX_VALUE / 3) }),
    { name: 'RangeError', message: /totalWeightKg/ },
  )
})

test('volume overflow and underflow are computed through per-axis ratios, not rejected', () => {
  // container volume overflows (1e309), item volume does not: 1.8 items fit per axis, so 1 item.
  const big = planContainerLoad({ container: box3(1e103, 1e103, 1e103, 10), item: item3(0.55e103, 0.55e103, 0.55e103) })
  assert.equal(big.count, 1)
  assert.ok(Math.abs(big.volumeUtilisation - 0.55 ** 3) < 1e-12, `got ${big.volumeUtilisation}`)
  // item volume underflows to 0 (1e-324), container volume is subnormal: 10 items, payload-limited.
  const small = planContainerLoad({ container: box3(1e-107, 1e-107, 1e-107, 10), item: item3(1e-108, 1e-108, 1e-108, 1) })
  assert.equal(small.count, 10)
  assert.equal(small.limitedBy, 'payload')
  assert.ok(Math.abs(small.volumeUtilisation - 10 * 0.1 ** 3) < 1e-12, `got ${small.volumeUtilisation}`)
  // 3e150 cube container, 1e150 cube item: volume overflows for both, answer is the same as at 3 / 1.
  const huge = planContainerLoad({ container: box3(3e150, 3e150, 3e150, 1000), item: item3(1e150, 1e150, 1e150) })
  assert.equal(huge.count, 27)
  assert.ok(Math.abs(huge.volumeUtilisation - 1) < 1e-12)
  // dimensions near Number.MAX_VALUE
  const max = planContainerLoad({ container: box3(1e308, 1e308, 1e308, 1000), item: item3(5e307, 5e307, 5e307) })
  assert.equal(max.count, 8)
  assert.ok(Math.abs(max.volumeUtilisation - 1) < 1e-12)
})

test('scaling every length by a power of two (exact in binary) leaves counts and utilisation unchanged', () => {
  // 3 x 3 x 3 container, 2 x 2 x 2 item: 1 item, 8/27 of the volume. 2^-1060 and 2^1000 push the volumes
  // into subnormal and overflow territory while the dimensions themselves stay exact.
  for (const e of [-1060, -600, 0, 600, 1000]) {
    const k = 2 ** e
    const r = planContainerLoad({ container: box3(3 * k, 3 * k, 3 * k, 10), item: item3(2 * k, 2 * k, 2 * k, 1) })
    assert.equal(r.count, 1, `scale 2^${e}`)
    assert.ok(Math.abs(r.volumeUtilisation - 8 / 27) < 1e-13, `scale 2^${e}: ${r.volumeUtilisation}`)
    const full = planContainerLoad({ container: box3(2 * k, 2 * k, 2 * k, 100), item: item3(k, k, k, 1) })
    assert.equal(full.count, 8, `scale 2^${e}`)
    assert.ok(Math.abs(full.volumeUtilisation - 1) < 1e-13, `scale 2^${e}: ${full.volumeUtilisation}`)
  }
})

test('utilisation near Number.MAX_VALUE is computed, not rejected', () => {
  // Two items fit along the length; count x item volume slightly exceeds MAX_VALUE because of the tolerance.
  const b = Math.cbrt((Number.MAX_VALUE * (1 - 1e-10)) / 2)
  const f = 1 + 4e-10
  const r = planContainerLoad({ container: box3(2 * b, b, b), item: item3(b * f, b * f, b * f) })
  assert.equal(r.count, 2)
  // Expected from the geometry alone: the two items use (1 + 4e-10)^3 of the container volume.
  assert.ok(Math.abs(r.volumeUtilisation - f ** 3) < 1e-12, `got ${r.volumeUtilisation}`)
})

test('large but representable inputs still work', () => {
  const r = planContainerLoad({ container: box3(1e5, 1e5, 1e5, 1e16 / 2), item: item3(1, 1, 1) })
  assert.equal(r.count, 1e15) // 1e5 x 1e5 x 1e5, below 2^53
  assert.equal(r.volumeUtilisation, 1)
})

// --- orientation order and the reported grid --------------------------------------------------

test('non-cube tie keeps the as-given footprint and reports its grid', () => {
  // 100 x 50 as given: 10 x 20 = 200; turned: 20 x 10 = 200. Tie, so the as-given orientation wins.
  const r = planContainerLoad({ container: box3(1000, 1000, 100), item: item3(100, 50, 100) })
  assert.equal(r.count, 200)
  assert.deepEqual(r.orientation, { length: 100, width: 50, height: 100 })
  assert.deepEqual(r.grid, { along: 10, across: 20, layers: 1 })
})

test("'any' orientations are tried in a fixed order: (l,w,h) (w,l,h) (l,h,w) (h,l,w) (w,h,l) (h,w,l)", () => {
  // Item 1 x 2 x 3 in a 6 x 6 x 1 container: only the two orientations with height 1 fit, and they tie at 6.
  const late = planContainerLoad({ container: box3(6, 6, 1), item: item3(1, 2, 3), rotation: 'any' })
  assert.equal(late.count, 6)
  assert.deepEqual(late.orientation, { length: 2, width: 3, height: 1 }) // (w,h,l) comes before (h,w,l)
  assert.deepEqual(late.grid, { along: 3, across: 2, layers: 1 })
  // In a 6 x 6 x 2 container four orientations tie at 12; the earliest of them is (l,h,w).
  const mid = planContainerLoad({ container: box3(6, 6, 2), item: item3(1, 2, 3), rotation: 'any' })
  assert.equal(mid.count, 12)
  assert.deepEqual(mid.orientation, { length: 1, width: 3, height: 2 })
  // Distinct sides: a container equal to one permutation fits exactly that orientation and no other,
  // which pins down what each position in the list means.
  const perms: [number, number, number][] = [[2, 3, 5], [3, 2, 5], [2, 5, 3], [5, 2, 3], [3, 5, 2], [5, 3, 2]]
  for (const [i, [a, b, c]] of perms.entries()) {
    const r = planContainerLoad({ container: box3(a, b, c), item: item3(2, 3, 5), rotation: 'any' })
    assert.equal(r.count, 1, `orientation ${i}`)
    assert.deepEqual(r.orientation, { length: a, width: b, height: c }, `orientation ${i}`)
  }
})

test('count zero reports the first orientation and its real grid', () => {
  const r = planContainerLoad({ container: box3(900, 900, 300), item: item3(300, 300, 900) })
  assert.equal(r.count, 0)
  assert.equal(r.geometricCount, 0)
  assert.deepEqual(r.orientation, { length: 300, width: 300, height: 900 })
  assert.deepEqual(r.grid, { along: 3, across: 3, layers: 0 })
  assert.equal(r.volumeUtilisation, 0)
  assert.equal(r.totalWeightKg, 0)
})

// --- validation messages and error types ------------------------------------------------------

test('error types and messages for malformed input', () => {
  assert.throws(() => planContainerLoad(null as never), { name: 'TypeError', message: /input must be/ })
  assert.throws(() => planContainerLoad('x' as never), { name: 'TypeError', message: /input must be/ })
  assert.throws(() => planContainerLoad({ item: base().item } as never), { name: 'TypeError', message: /input must be/ })
  assert.throws(() => planContainerLoad({ container: base().container } as never), { name: 'TypeError', message: /input must be/ })
  assert.throws(() => planContainerLoad(base({ rotation: 'spin' as never })), { name: 'RangeError', message: /rotation must be 'upright' or 'any', got spin/ })
  assert.throws(() => planContainerLoad(base({ rotation: '' as never })), { name: 'RangeError', message: /rotation must be/ })
  // A truthy non-object container passes the presence check and fails on its fields, with RangeError.
  assert.throws(() => planContainerLoad({ container: 5, item: base().item } as never), { name: 'RangeError', message: /container\.length must be/ })
})

test('rotation null or undefined means upright', () => {
  const upright = planContainerLoad(base())
  assert.deepEqual(planContainerLoad(base({ rotation: undefined })), upright)
  assert.deepEqual(planContainerLoad(base({ rotation: null as never })), upright)
})

test('the README example result is unchanged (ordinary-input regression)', () => {
  const r = planContainerLoad({ container: box3(12000, 2300, 2400, 26000), item: item3(1200, 1000, 1100, 450) })
  assert.deepEqual(r, {
    count: 40,
    geometricCount: 40,
    payloadCount: 57,
    limitedBy: 'geometry',
    orientation: { length: 1200, width: 1000, height: 1100 },
    grid: { along: 10, across: 2, layers: 2 },
    volumeUtilisation: 0.7971014492753623,
    payloadUtilisation: 0.6923076923076923,
    totalWeightKg: 18000,
  })
})

// --- tolerance at large quotients ---------------------------------------------------------------
// Exact decimal fixtures: weights and lengths are m/1000 with integer m, and the capacity is k x that value
// written out exactly, so the correct answer is k with no tolerance involved. BigInt builds the decimals.

const milli = (n: bigint): number => Number(`${n / 1000n}.${(n % 1000n).toString().padStart(3, '0')}`)

function lcg(seed: number) {
  let s = seed
  return (lo: number, hi: number): number => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff
    return lo + (s % (hi - lo))
  }
}

test('exact decimal payload fits are counted at large quotients (1e6 to 1e11 items)', () => {
  const rnd = lcg(2026)
  for (let i = 0; i < 1500; i++) {
    const k = BigInt(rnd(1_000_000, 1_000_000_000)) * BigInt(rnd(1, 100)) // 1e6 .. 1e11
    const m = BigInt(rnd(1, 1001))
    const r = planContainerLoad({ container: box3(1e6, 1e6, 1e6, milli(k * m)), item: item3(10, 10, 10, milli(m)) })
    assert.equal(r.payloadCount, Number(k), `payload ${milli(k * m)} / weight ${milli(m)}`)
  }
})

test('exact decimal geometric fits are counted at large quotients', () => {
  const rnd = lcg(7)
  for (let i = 0; i < 500; i++) {
    const k = BigInt(rnd(1_000_000, 1_000_000_000)) * BigInt(rnd(1, 100))
    const d = BigInt(rnd(1, 1001)) + 1000n // item length 1.001 .. 2.000, longer than the 1-wide container, so no turning
    const r = planContainerLoad({ container: box3(milli(k * d), 1, 1, 1e15), item: item3(milli(d), 1, 1, 1) })
    assert.equal(r.geometricCount, Number(k), `length ${milli(k * d)} / item ${milli(d)}`)
  }
})

test('real shortfalls are not counted at large quotients', () => {
  const rnd = lcg(99)
  for (let i = 0; i < 1500; i++) {
    const m = BigInt(rnd(2, 501))
    const k = BigInt(rnd(1_000_000, 100_000_000)) // k x m stays below 1e11, so shortfalls are far above rounding noise
    const j = BigInt(rnd(1, Number(m))) // capacity is j/1000 kg short, i.e. j/m of an item
    if (Number(j) / Number(m) < 2e-3) continue
    const r = planContainerLoad({ container: box3(1e6, 1e6, 1e6, milli(k * m - j)), item: item3(10, 10, 10, milli(m)) })
    assert.equal(r.payloadCount, Number(k) - 1, `short by ${j}/${m} of an item`)
  }
})

test('the large-quotient tolerance is capped: it never rounds up by a large fraction of an item', () => {
  // q = 999999999999999.6 items. A tolerance proportional to q without the cap would be about 0.9 here.
  const r = planContainerLoad({ container: box3(1e6, 1e6, 1e6, 999999999999999.6), item: item3(1000, 1000, 1000, 1) })
  assert.equal(r.payloadCount, 999999999999999)
})

test('below q of about 1e6 the tolerance is the fixed 1e-9 (ordinary inputs unchanged)', () => {
  const at = (shortfall: number) => planContainerLoad({ container: box3(1000 - shortfall * 100, 100, 100), item: item3(100, 100, 100) })
  // 10 items per row. 5e-10 items short is still absorbed; 5e-9 items short is a real shortfall.
  assert.equal(at(5e-10).geometricCount, 10)
  assert.equal(at(5e-9).geometricCount, 9)
})

// --- tolerance bounds (pin both sides of every constant) ---------------------------------------

const unitCube = (maxPayloadKg: number): PlanInput => ({ container: box3(1, 1, 1, maxPayloadKg), item: item3(1, 1, 1, 1) })

test('fixed tolerance: 5e-10 items short counts, 1.5e-9 items short does not', () => {
  const at = (shortfall: number) => planContainerLoad({ container: box3(3 - shortfall, 5, 5), item: item3(1, 5, 5) }).count
  assert.equal(at(5e-10), 3)
  assert.equal(at(1.5e-9), 2)
})

test('relative tolerance is a few ulps of the quotient: about 3 ulps counts, about 6 ulps does not', () => {
  // ulp(1e10) is 1.9e-6, so 5.7e-6 is 3 ulps and 1.2e-5 is about 6 ulps.
  assert.equal(planContainerLoad(unitCube(1e10 - 5.7e-6)).payloadCount, 1e10)
  assert.equal(planContainerLoad(unitCube(1e10 - 1.2e-5)).payloadCount, 1e10 - 1)
  // Onset: at q = 1e8 the fixed 1e-9 is below one ulp (1.5e-8); 5e-8 short (about 3 ulps) is absorbed.
  assert.equal(planContainerLoad(unitCube(1e8 - 5e-8)).payloadCount, 1e8)
  // A shortfall of 1e-14 relative at q = 1e9 is a real shortfall, not rounding noise.
  assert.equal(planContainerLoad(unitCube(1e9 * (1 - 1e-14))).payloadCount, 1e9 - 1)
})

test('tolerance cap: exact fits are recovered up to q of a few 1e12, and never rounded up by a visible fraction of an item', () => {
  assert.equal(planContainerLoad({ container: box3(1, 1, 1, 1175182322025.036), item: item3(1, 1, 1, 0.676) }).payloadCount, 1738435387611) // exact decimal fit at q = 1.7e12
  assert.equal(planContainerLoad(unitCube(1e12 - 5e-4)).payloadCount, 1e12) // 5e-4 items short at q = 1e12 counts
  assert.equal(planContainerLoad(unitCube(9999999999999.996)).payloadCount, 9999999999999) // 4e-3 items short at q = 1e13 does not
})

// --- guards that need an input of their own ----------------------------------------------------

test('zero layers short-circuits an orientation even when its length axis is unsafe', () => {
  // Orientation (1,10,40) has 1.9e16 along the length (unsafe) and 0 layers; (40,1,10) fits 4.75e15 items.
  const r = planContainerLoad({ container: box3(1.9e16, 10, 10, 1e9), item: item3(1, 10, 40), rotation: 'any' })
  assert.equal(r.count, 1e9)
  assert.equal(r.geometricCount, 4.75e15)
  assert.deepEqual(r.orientation, { length: 40, width: 1, height: 10 })
})

test('the reported grid must be exact on every axis when nothing fits', () => {
  const item = item3(1, 1, 1)
  assert.throws(() => planContainerLoad({ container: box3(0.5, 1e20, 1), item }), { name: 'RangeError', message: /^grid width count/ })
  assert.throws(() => planContainerLoad({ container: box3(0.5, 1, 1e20), item }), { name: 'RangeError', message: /^grid layer count/ })
})

test('count zero gives zero volume utilisation even when the per-axis ratio would overflow', () => {
  const r = planContainerLoad({ container: box3(1e-10, 1, 1, 10), item: item3(1e300, 1e300, 1e300) })
  assert.equal(r.count, 0)
  assert.equal(r.volumeUtilisation, 0)
})

test('the ratio path uses the orientation the item is placed in', () => {
  // Item 1e100 x 1e-250 x 1e-250 only fits turned. Volumes underflow, so the ratio path runs: 1 item fills it.
  const r = planContainerLoad({ container: box3(1e-250, 1e100, 1e-250, 10), item: item3(1e100, 1e-250, 1e-250), rotation: 'any' })
  assert.equal(r.count, 1)
  assert.deepEqual(r.orientation, { length: 1e-250, width: 1e100, height: 1e-250 })
  assert.ok(Math.abs(r.volumeUtilisation - 1) < 1e-12, `got ${r.volumeUtilisation}`)
})

test('utilisation is accurate when an intermediate product is subnormal but the volume is normal', () => {
  // length x width is 3e-324 (subnormal, lossy) here, then multiplied back into the normal range by a 1e160 height.
  const r = planContainerLoad({ container: box3(2.1e-161, 1e-162, 1e160, 1e6), item: item3(3e-162, 1e-162, 1e160) })
  assert.equal(r.count, 7)
  assert.ok(Math.abs(r.volumeUtilisation - 1) < 1e-12, `got ${r.volumeUtilisation}`)
  const r2 = planContainerLoad({
    container: box3(1.7790410016129193e-160, 1.8620224747032886e-161, 1.3515133746833695e160, 143934434.34512854),
    item: item3(6.412926850362681e-161, 4.148041592485857e-164, 3.452360354251469e159, 425.463179673544),
  })
  // exact: count x (l/L) x (w/W) x (h/H) with the integer count reported
  const exact = r2.count * (6.412926850362681e-161 / 1.7790410016129193e-160) * (4.148041592485857e-164 / 1.8620224747032886e-161) * (3.452360354251469e159 / 1.3515133746833695e160)
  assert.ok(Math.abs(r2.volumeUtilisation - exact) / exact < 1e-12, `got ${r2.volumeUtilisation}, expected about ${exact}`)
})

test('a subnormal item volume next to a normal container volume stays accurate to 1e-14', () => {
  // 1e9 items of 5e-106 in a 1e-100 cube: each item uses (5e-6)^3 = 1.25e-16 of the volume.
  const r = planContainerLoad({ container: box3(1e-100, 1e-100, 1e-100, 1e9), item: item3(5e-106, 5e-106, 5e-106) })
  assert.equal(r.count, 1e9)
  assert.ok(Math.abs(r.volumeUtilisation - 1.25e-7) / 1.25e-7 < 1e-14, `got ${r.volumeUtilisation}`)
})

test('orientation order ties: as-given before rotated, and the middle pair of the rotated list', () => {
  const cube = planContainerLoad({ container: box3(6, 6, 6), item: item3(1, 2, 3), rotation: 'any' }) // all six tie at 36
  assert.deepEqual(cube.orientation, { length: 1, width: 2, height: 3 })
  assert.deepEqual(cube.grid, { along: 6, across: 3, layers: 2 })
  const none = planContainerLoad({ container: box3(1, 1, 1), item: item3(2, 3, 4), rotation: 'any' }) // nothing fits
  assert.deepEqual(none.orientation, { length: 2, width: 3, height: 4 })
  assert.deepEqual(none.grid, { along: 0, across: 0, layers: 0 })
  // (h,l,w) = (3,2,1) and (w,h,l) = (1,3,2) both fill 3 x 6 x 2 with 6 items; (h,l,w) comes first.
  const middle = planContainerLoad({ container: box3(3, 6, 2), item: item3(2, 1, 3), rotation: 'any' })
  assert.equal(middle.count, 6)
  assert.deepEqual(middle.orientation, { length: 3, width: 2, height: 1 })
})

test('a subnormal item base product (length x width) is not used even when the item and container volumes are normal', () => {
  // 1e-155 x 1e-155 = 1e-310 is subnormal and loses about 3e-15 here; the height 1e100 brings the volume back to normal.
  const r = planContainerLoad({ container: box3(1e-152, 1e-152, 3e100, 1e9), item: item3(1e-155, 1e-155, 1e100) })
  assert.equal(r.count, 3_000_000)
  assert.deepEqual(r.grid, { along: 1000, across: 1000, layers: 3 })
  assert.ok(Math.abs(r.volumeUtilisation - 1) < 1e-15, `got ${r.volumeUtilisation}`)
})

test('a subnormal container base product is not used even when the item is turned and its own base product is normal', () => {
  // Container 1e-160 x 1e-160 has a subnormal base (1e-320, about 5e-4 relative error); the item as given has a normal one.
  const r = planContainerLoad({ container: box3(1e-160, 1e-160, 1e300, 1e9), item: item3(1e299, 1e-161, 1e-161), rotation: 'any' })
  assert.equal(r.count, 1000)
  assert.deepEqual(r.orientation, { length: 1e-161, width: 1e-161, height: 1e299 })
  assert.ok(Math.abs(r.volumeUtilisation - 1) < 1e-12, `got ${r.volumeUtilisation}`)
})
