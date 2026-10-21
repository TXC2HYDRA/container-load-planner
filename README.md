# container-load-planner

Counts how many identical boxes (cartons, pallets) fit in a container on a **uniform grid**, limited by
geometry and by payload weight. Pure TypeScript, no runtime dependencies, MIT licensed.

This is a calculator, not a packing optimiser. It does not guarantee the best real-world arrangement
(see [Limitations](#limitations)).

## Install and use

Not published to npm. Copy `src/` into your project, or build and depend on the folder:

```bash
npm install ./path/to/container-load-planner   # after `npm run build` (needs typescript)
```

```ts
import { planContainerLoad } from 'container-load-planner'

const result = planContainerLoad({
  container: { length: 12000, width: 2300, height: 2400, maxPayloadKg: 26000 },
  item: { length: 1200, width: 1000, height: 1100, weightKg: 450 },
})
```

The container numbers above are illustrative, not an ISO or carrier specification. Use the inner
dimensions and payload from your carrier. Output of the example above (run on Node v22.23.3):

```json
{
  "count": 40,
  "geometricCount": 40,
  "payloadCount": 57,
  "limitedBy": "geometry",
  "orientation": { "length": 1200, "width": 1000, "height": 1100 },
  "grid": { "along": 10, "across": 2, "layers": 2 },
  "volumeUtilisation": 0.7971014492753623,
  "payloadUtilisation": 0.6923076923076923,
  "totalWeightKg": 18000
}
```

## API

One function: `planContainerLoad(input: PlanInput): PlanResult`. Types are in `src/types.ts`.

Input:

| Field | Meaning |
| --- | --- |
| `container.length`, `.width`, `.height` | Inner dimensions. Any one consistent unit; millimetres in the docs and tests. |
| `container.maxPayloadKg` | Maximum payload in kg. |
| `item.length`, `.width`, `.height` | Dimensions of one item, same unit as the container. |
| `item.weightKg` | Weight of one item in kg. |
| `rotation` | `'upright'` (default) or `'any'`. |

Output:

| Field | Meaning |
| --- | --- |
| `count` | `min(geometricCount, payloadCount)`. |
| `geometricCount` | Items that fit by geometry (best single orientation). |
| `payloadCount` | `floor(maxPayloadKg / weightKg)`. |
| `limitedBy` | `'geometry'`, `'payload'`, or `'both'` when the two counts are equal. |
| `orientation` | Item dimensions as placed: `length` along the container length, `width` along its width, `height` along its height. |
| `grid` | `{ along, across, layers }`; their product is `geometricCount`. |
| `volumeUtilisation` | `count x item volume / container volume`. About 0 to 1; can exceed 1 by a few parts in 1e9 (see Units and rounding). |
| `payloadUtilisation` | `count x weightKg / maxPayloadKg`. About 0 to 1; can exceed 1 by about 1e-9 for the same reason. |
| `totalWeightKg` | `count x weightKg`. |

## How it works

Constraints:

- **Geometric:** items must lie inside the container. Per orientation, the grid is
  `floor(L / l) x floor(W / w) x floor(H / h)`. Items are axis-aligned and never overlap.
- **Volume:** no separate check. A grid inside the container cannot meaningfully exceed its volume
  (apart from the tolerance below); `volumeUtilisation` reports how much of it is used.
- **Payload:** `count` never exceeds `floor(maxPayloadKg / weightKg)`.

Rotations: `'upright'` keeps the item's height vertical and tries the footprint as given and turned
90 degrees (2 orientations). `'any'` tries all 6 axis-aligned orientations. All items share the one
orientation that gives the highest `geometricCount`; ties go to the first orientation tried (as given).

Units and rounding:

- The code is unit-agnostic for lengths, but weights are kilograms. Do not mix units across fields.
- Counts are whole numbers (floor). Because of float error, `0.3 / 0.1` evaluates to
  `2.9999999999999996` and would floor to 2, so every floor division (each grid axis and the payload
  count) is computed as `floor(a / b + 1e-9)` and returns 3.
- The tolerance is added to the division result, which is measured in item lengths, so it is
  **relative to the item size**, not a fixed distance. Along one axis, a row of items may overhang
  the container by up to about `1e-9 x` the item's size along that axis, in total, whatever the
  number of items in the row (measured: an item of size 100 in a container short by 0.99e-7 still
  counts as fitting, short by 1.1e-7 does not; the same holds for 2 and 1000 items per row).
- Because of that small accepted overhang (and the same effect on the payload count), calculated
  volume and payload utilisation can exceed 1 slightly: up to about `1e-9` per axis, so roughly
  `3e-9` for volume when all three axes overhang.
- The tolerance is a floating-point workaround, not a physical clearance. The result is an
  approximate geometric estimate and does not guarantee that the items physically fit.
- Utilisation values are not rounded. Round them for display yourself.

Invalid input: every dimension, `maxPayloadKg` and `weightKg` must be a finite number greater than 0.
Zero, negative, `NaN`, `Infinity`, strings, `null` and `undefined` throw `RangeError`. A missing
`container` or `item`, or a non-object input, throws `TypeError`. An unknown `rotation` throws
`RangeError`. An item that does not fit gives `count: 0`, not an error.

Extreme magnitudes: finite inputs can still be unrepresentable in double precision. These throw
`RangeError` (message contains "not representable") instead of returning `Infinity`, `NaN` or a
misleading number:

- any grid count, the item count or the payload count (`floor(maxPayloadKg / weightKg)`) that is not
  a safe integer (above 2^53 - 1, or `Infinity` from an overflowing ratio, e.g. a `1e200` container
  with a `1e-300` item). This also covers a very large `maxPayloadKg` with a light item;
- an item or container volume (length x width x height) that overflows to `Infinity` or underflows
  to 0;
- a utilisation or total weight that would be non-finite.

The check is on the intermediate values, so it can also reject a case whose true answer would be 0
items (for example a grid axis that overflows while another axis does not fit). Nothing is clamped.
Inputs below this range, including all realistic container and item sizes, are unaffected.

## Limitations

- One orientation for the whole load. Mixed orientations or mixed layouts could fit more.
- Identical items only. No mixed item types.
- No stacking strength, load limits per layer, weight distribution or axle limits, fragility, or
  "this side up" constraints beyond the `'upright'` mode.
- No packaging allowance, dunnage, door or pallet-clearance margins. Subtract them from the inputs.
- Container sizes are not built in. The caller supplies them.
- The result is a planning estimate, not a loading instruction and not a guarantee of an optimal packing.
- Numerical range: counts above 2^53 - 1, and dimension products that overflow or underflow doubles,
  are rejected rather than computed (see Extreme magnitudes).

## Test and build

Tests use the Node built-in runner, so they need no install. They cover geometric fit and
boundaries, rotations, the payload cap and its boundary, invalid input, an exact BigInt reference
check on 500 pseudo-random cases, and the extreme-magnitude errors. Run on Node v22.23.3, which runs
`.ts` files directly. Other Node versions are untested.

```bash
npm test          # node --test
```

`npm run build` and `npm run typecheck` use `tsc` (TypeScript 6.0.3 as a dev dependency). Run
`npm install` first. Build output goes to `dist/`.

## License

MIT. See [LICENSE](LICENSE).
