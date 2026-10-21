/** Box dimensions. Any consistent length unit works; the docs and tests use millimetres. */
export interface Dimensions {
  length: number
  width: number
  height: number
}

export interface ContainerSpec extends Dimensions {
  /** Maximum payload in kilograms. */
  maxPayloadKg: number
}

export interface ItemSpec extends Dimensions {
  /** Weight of one item in kilograms. */
  weightKg: number
}

/**
 * 'upright': height stays vertical, the footprint may turn 90 degrees (2 orientations). Default.
 * 'any': all 6 axis-aligned orientations.
 */
export type Rotation = 'upright' | 'any'

export interface PlanInput {
  container: ContainerSpec
  item: ItemSpec
  rotation?: Rotation
}

export interface PlanResult {
  /** Items to load: min(geometricCount, payloadCount). */
  count: number
  /** Items that fit by geometry alone (uniform grid, best orientation). */
  geometricCount: number
  /** Items allowed by the payload limit alone. */
  payloadCount: number
  limitedBy: 'geometry' | 'payload' | 'both'
  /** Item dimensions as placed: length along container length, width along width, height along height. */
  orientation: Dimensions
  /** Grid of the best orientation. `grid.along * grid.across * grid.layers` equals geometricCount. */
  grid: { along: number; across: number; layers: number }
  /** count * item volume / container volume, 0..1. */
  volumeUtilisation: number
  /** count * item weight / max payload, 0..1. */
  payloadUtilisation: number
  totalWeightKg: number
}
