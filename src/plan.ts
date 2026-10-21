import type { Dimensions, PlanInput, PlanResult } from './types.ts'

// Every floor division (grid axis counts, payload count) adds a tolerance to the quotient q = space / size,
// measured in items, so float error cannot lose an exact fit (0.3 / 0.1 is 2.9999999999999996, not 3).
// - Below q of about 1.1e6 the tolerance is the fixed 1e-9.
// - Above that, 1e-9 is smaller than the rounding error of the inputs themselves (about q x 2^-52), so it
//   grows as 4 x Number.EPSILON x q, i.e. a few ulps of the inputs, and is capped at 1e-3 items.
const ABS_TOL = 1e-9
const REL_TOL = 4 * Number.EPSILON
const MAX_TOL = 1e-3

// Smallest positive normal double. Products below it lose precision (subnormal) or underflow to 0.
const MIN_NORMAL = 2.2250738585072014e-308

function fit(space: number, size: number): number {
  const q = space / size
  return Math.floor(q + Math.max(ABS_TOL, Math.min(q * REL_TOL, MAX_TOL)))
}

function positive(name: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite number > 0, got ${String(value)}`)
  }
  return value
}

// Counts must stay exact integers. Larger values (or Infinity, from a ratio that overflows) mean the
// inputs differ too much in magnitude for double precision.
function safeCount(name: string, n: number): number {
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`${name} is not representable (got ${String(n)}); input magnitudes are too extreme`)
  }
  return n
}

function orientations({ length: l, width: w, height: h }: Dimensions, rotation: string): Dimensions[] {
  const upright: [number, number, number][] = [[l, w, h], [w, l, h]]
  const rest: [number, number, number][] = [[l, h, w], [h, l, w], [w, h, l], [h, w, l]]
  const list = rotation === 'any' ? [...upright, ...rest] : upright
  return list.map(([length, width, height]) => ({ length, width, height }))
}

/**
 * Uniform-grid container load: every item shares one orientation, packed on a regular grid.
 * Picks the orientation with the most items (first one wins ties), then caps by payload.
 * Throws RangeError / TypeError on invalid input, and RangeError when a count or the total weight
 * cannot be represented exactly in double precision. Nothing is clamped.
 */
export function planContainerLoad(input: PlanInput): PlanResult {
  if (!input || typeof input !== 'object' || !input.container || !input.item) {
    throw new TypeError('input must be { container, item, rotation? }')
  }
  const rotation = input.rotation ?? 'upright'
  if (rotation !== 'upright' && rotation !== 'any') {
    throw new RangeError(`rotation must be 'upright' or 'any', got ${String(rotation)}`)
  }
  const { container: c, item: it } = input
  const L = positive('container.length', c.length)
  const W = positive('container.width', c.width)
  const H = positive('container.height', c.height)
  const maxPayloadKg = positive('container.maxPayloadKg', c.maxPayloadKg)
  const item: Dimensions = {
    length: positive('item.length', it.length),
    width: positive('item.width', it.width),
    height: positive('item.height', it.height),
  }
  const weightKg = positive('item.weightKg', it.weightKg)

  let best = { o: orientations(item, rotation)[0]!, along: 0, across: 0, layers: 0, n: -1 }
  for (const o of orientations(item, rotation)) {
    const along = fit(L, o.length)
    const across = fit(W, o.width)
    const layers = fit(H, o.height)
    // A zero axis means nothing fits in this orientation, whatever the other axes overflow to.
    const n =
      along === 0 || across === 0 || layers === 0
        ? 0
        : safeCount(
            'item count',
            safeCount('grid length count', along) * safeCount('grid width count', across) * safeCount('grid layer count', layers),
          )
    if (n > best.n) best = { o, along, across, layers, n }
  }
  // Only matters when no orientation fits: the reported grid must still be exact.
  const grid = {
    along: safeCount('grid length count', best.along),
    across: safeCount('grid width count', best.across),
    layers: safeCount('grid layer count', best.layers),
  }

  const geometricCount = best.n
  const payloadCount = safeCount('payload count', fit(maxPayloadKg, weightKg))
  const count = Math.min(geometricCount, payloadCount)

  const totalWeightKg = count * weightKg
  if (!Number.isFinite(totalWeightKg)) throw new RangeError('totalWeightKg is not representable; input magnitudes are too extreme')

  // count x item volume / container volume. The products are only used while every step of them (the
  // length x width partial product and the full volume) is a normal double; otherwise (overflow,
  // underflow, subnormal) use the equivalent product of per-axis ratios, which stays in range because
  // every axis count is a safe integer, so each ratio is at least 1/2^53.
  let volumeUtilisation = 0
  if (count > 0) {
    const itemBase = item.length * item.width
    const containerBase = L * W
    const itemVolume = itemBase * item.height
    const containerVolume = containerBase * H
    const used = count * itemVolume
    const normal = (v: number) => v >= MIN_NORMAL && Number.isFinite(v)
    volumeUtilisation =
      normal(itemBase) && normal(containerBase) && normal(itemVolume) && normal(containerVolume) && Number.isFinite(used)
        ? used / containerVolume
        : count * (best.o.length / L) * (best.o.width / W) * (best.o.height / H)
  }

  return {
    count,
    geometricCount,
    payloadCount,
    limitedBy: geometricCount === payloadCount ? 'both' : geometricCount < payloadCount ? 'geometry' : 'payload',
    orientation: best.o,
    grid,
    volumeUtilisation,
    payloadUtilisation: totalWeightKg / maxPayloadKg,
    totalWeightKg,
  }
}
