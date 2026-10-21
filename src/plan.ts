import type { Dimensions, PlanInput, PlanResult } from './types.ts'

// Absorbs float error so 0.3 / 0.1 (= 2.9999999999999996) still counts as 3.
const EPS = 1e-9

const fit = (space: number, size: number): number => Math.floor(space / size + EPS)

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
 * Throws RangeError / TypeError on invalid input.
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

  // Volumes feed the utilisation ratio. Overflow gives Infinity and underflow gives 0, so reject both.
  const itemVolume = item.length * item.width * item.height
  const containerVolume = L * W * H
  for (const [name, v] of [['item volume', itemVolume], ['container volume', containerVolume]] as const) {
    if (!Number.isFinite(v) || v <= 0) throw new RangeError(`${name} is not representable (got ${String(v)}); input magnitudes are too extreme`)
  }

  let best = { o: orientations(item, rotation)[0]!, along: 0, across: 0, layers: 0, n: -1 }
  for (const o of orientations(item, rotation)) {
    const along = safeCount('grid length count', fit(L, o.length))
    const across = safeCount('grid width count', fit(W, o.width))
    const layers = safeCount('grid layer count', fit(H, o.height))
    const n = safeCount('item count', along * across * layers)
    if (n > best.n) best = { o, along, across, layers, n }
  }

  const geometricCount = best.n
  const payloadCount = safeCount('payload count', fit(maxPayloadKg, weightKg))
  const count = Math.min(geometricCount, payloadCount)
  const result: PlanResult = {
    count,
    geometricCount,
    payloadCount,
    limitedBy: geometricCount === payloadCount ? 'both' : geometricCount < payloadCount ? 'geometry' : 'payload',
    orientation: best.o,
    grid: { along: best.along, across: best.across, layers: best.layers },
    volumeUtilisation: (count * itemVolume) / containerVolume,
    payloadUtilisation: (count * weightKg) / maxPayloadKg,
    totalWeightKg: count * weightKg,
  }
  for (const key of ['volumeUtilisation', 'payloadUtilisation', 'totalWeightKg'] as const) {
    if (!Number.isFinite(result[key])) throw new RangeError(`${key} is not representable; input magnitudes are too extreme`)
  }
  return result
}
