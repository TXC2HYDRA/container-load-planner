/** Box dimensions. Any consistent length unit works; the examples use millimetres. */
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
  /** Item count: min(geometricCount, payloadCount). A planning figure, not a loading instruction. */
  count: number
  /** Items that fit by geometry alone (uniform grid, best orientation). */
  geometricCount: number
  /** Items allowed by the payload limit alone: floor(maxPayloadKg / weightKg + tolerance). */
  payloadCount: number
  limitedBy: 'geometry' | 'payload' | 'both'
  /** Item dimensions as placed: length along container length, width along width, height along height. */
  orientation: Dimensions
  /** Grid of the best orientation. `grid.along * grid.across * grid.layers` equals geometricCount. */
  grid: { along: number; across: number; layers: number }
  /** count * item volume / container volume. About 0..1; the floor tolerance can push it slightly above 1. */
  volumeUtilisation: number
  /** count * item weight / max payload. About 0..1; the floor tolerance can push it slightly above 1. */
  payloadUtilisation: number
  /** count * item weight. */
  totalWeightKg: number
}
