# container-load-planner

Counts how many identical boxes (cartons, pallets) fit in a container on a **uniform grid**, limited by
geometry and by payload weight. Pure TypeScript, no runtime dependencies, MIT licensed.

This is a calculator, not a packing optimiser. It does not guarantee the best real-world arrangement,
that the items physically fit, or numerical precision beyond what IEEE double arithmetic gives
(see [Limitations](#limitations) and [Numerical limits](#numerical-limits)).

## Install and use

Not published to npm. Two ways to use it:

- Build, then depend on the folder (needs `typescript`, see [Test and build](#test-and-build)):

  ```bash
  npm run build
  npm install ./path/to/container-load-planner   # in your project
  ```

- Or copy the `src/` files into your project. They import each other with `.ts` extensions
  (`./plan.ts`), so your toolchain must accept that: Node's built-in type stripping (enabled by default
  from Node 22.18 per Node's release notes; only 22.23.3 was tested here; Node does not strip types for
  files under `node_modules`), or TypeScript with
  `allowImportingTsExtensions` or `rewriteRelativeImportExtensions`. The built `dist/` output is plain
  JavaScript and has no such requirement.

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
| `container.length`, `.width`, `.height` | Inner dimensions. Any one consistent length unit (the examples use millimetres). |
| `container.maxPayloadKg` | Maximum payload in kg. |
| `item.length`, `.width`, `.height` | Dimensions of one item, same unit as the container. |
| `item.weightKg` | Weight of one item in kg. |
| `rotation` | `'upright'` (default; also used when omitted, `undefined` or `null`) or `'any'`. |

Output:

| Field | Meaning |
| --- | --- |
| `count` | `min(geometricCount, payloadCount)`. A planning figure, not a loading instruction. |
| `geometricCount` | Items that fit by geometry (best single orientation). |
| `payloadCount` | Items allowed by the payload alone: `floor(maxPayloadKg / weightKg + tolerance)`. The tolerance is described under [Units and rounding](#units-and-rounding). |
| `limitedBy` | `'geometry'`, `'payload'`, or `'both'` when the two counts are equal. |
| `orientation` | Item dimensions as placed: `length` along the container length, `width` along its width, `height` along its height. |
| `grid` | `{ along, across, layers }` of the chosen orientation; their product is `geometricCount`. When nothing fits, this is the first orientation tried and one or more entries are 0. |
| `volumeUtilisation` | `count x item volume / container volume`. About 0 to 1; can exceed 1 very slightly (see Units and rounding). |
| `payloadUtilisation` | `count x weightKg / maxPayloadKg`. About 0 to 1; can exceed 1 very slightly for the same reason. |
| `totalWeightKg` | `count x weightKg`. |

## How it works

Constraints:

- **Geometric:** items must lie inside the container. Per orientation, the grid is
  `floor(L / l) x floor(W / w) x floor(H / h)` (each floor with the tolerance below). Items are
  axis-aligned and never overlap.
- **Volume:** no separate check. A grid inside the container cannot meaningfully exceed its volume
  (apart from the tolerance below); `volumeUtilisation` reports how much of it is used.
- **Payload:** `count` never exceeds `payloadCount`, the payload divided by the item weight.

Rotations: `'upright'` keeps the item's height vertical and tries the footprint as given and turned
90 degrees (2 orientations). `'any'` tries all 6 axis-aligned orientations, in the order
`(l,w,h) (w,l,h) (l,h,w) (h,l,w) (w,h,l) (h,w,l)`, where `l`, `w`, `h` are the item's own sides. All
items share the one orientation that gives the highest `geometricCount`; ties go to the first
orientation tried.

### Units and rounding

- Lengths use any one consistent unit. Weights are kilograms. Do not mix units across fields.
- Counts are whole numbers (floor). Because of float error, `0.3 / 0.1` evaluates to
  `2.9999999999999996` and would floor to 2, so every floor division (each grid axis and the payload
  count) adds a small tolerance to the quotient `q = space / size` before flooring:

  `tolerance(q) = max(1e-9, min(4 x 2^-52 x q, 1e-3))`, in items.

  - For `q` up to about 1.1 million (every realistic grid axis) this is the fixed `1e-9`.
  - Above that, `1e-9` is smaller than the rounding error of the input numbers themselves (about
    `q x 2^-52`). Without growth, exact decimal fits were undercounted by 1 in roughly 10 to 13% of
    random cases from 1e7 items upward. The tolerance therefore grows in proportion to `q`: about four
    units of the last place of the inputs, or roughly 9e-16 of the axis length.
  - It is capped at `1e-3` items so it can never round up by a large fraction of an item. The cap
    applies from about `q = 1.1e12`. Measured exact-decimal fits were recovered with no undercount up
    to about 7e12 (1.2 million cases), then the undercount rate rises: about 1 in 2400 from 7e12 to
    1e13, roughly 5% from 1e13 to 3e13, and about 10% beyond, which is the same as without the fix. Above
    about 3e15 a count can be off by 1 or 2 in either direction. Treat counts above roughly 1e12 as
    approximate; above `2^53 - 1` they are rejected (see Numerical limits).
  - Inputs that differ from an exact fit by less than about 1e-15 of the axis length (written with 15
    to 16 significant digits) are treated as fits.
- The tolerance is relative to the item size, not a fixed distance, and it is a floating-point
  workaround, not a physical clearance. Along one axis a row of items may overhang the container by up
  to `tolerance(q)` item sizes in total, whatever the number of items in the row. For `q` below 1.1
  million that is about `1e-9 x` the item's size (measured: an item of size 100 in a container short by
  0.99e-7 still counts as fitting, short by 1.1e-7 does not; the same holds for 2 and 1000 items per
  row). At large `q` it is still only about 1e-15 of the axis length.
- Because of that accepted overhang (and the same effect on the payload count), calculated volume and
  payload utilisation can exceed 1 slightly: up to about `1e-9` per axis (roughly `3e-9` for volume when
  all three axes overhang) at ordinary sizes. The result is an approximate geometric estimate and does
  not guarantee that the items physically fit.
- The tolerance acts per axis, so a difference of 1 along one long axis changes `geometricCount` by the
  product of the other axis counts (and can change which orientation wins).
- Utilisation values are not rounded. Round them for display yourself.

### Invalid input

Every dimension, `maxPayloadKg` and `weightKg` must be a finite number greater than 0. Zero, negative,
`NaN`, `Infinity`, strings, `null` and `undefined` throw `RangeError` with a message of the form
`item.length must be a finite number > 0, got ...`. An unknown `rotation` (anything but `'upright'`,
`'any'`, `undefined` or `null`) throws `RangeError`.

`TypeError` is thrown when `input` is not an object or when `container` or `item` is missing or falsy.
A truthy but non-object `container` or `item` (such as `5`) passes that check and then fails the field
check with `RangeError`. An item that does not fit gives `count: 0`, not an error.

### Numerical limits

Finite, positive inputs can still be unrepresentable in double precision. Counts must stay exact
integers, so these throw `RangeError` (the message contains "not representable") instead of returning
`Infinity`, `NaN` or a misleading number:

- A grid axis count, the item count (the product of the three axis counts) or the payload count that is
  not a safe integer (above 2^53 - 1, or `Infinity` from an overflowing ratio). Axis counts are only
  checked for an orientation where all three axes are non-zero, because a zero axis already means that
  orientation holds nothing. Example: a `1e200` container with a `1e-300` item is caught by the grid
  length count check.
- The grid reported in the result, if its entries are not safe integers (this can only happen when no
  orientation fits).
- A `totalWeightKg` that would exceed `Number.MAX_VALUE`. Because of the payload tolerance this can
  happen for a total up to about 1e-9 (relative) above the payload itself.

Volumes that overflow, underflow or become subnormal are **not** rejected. `volumeUtilisation` is then
computed from per-axis ratios, which stay in range because every axis count is a safe integer. The
direct formula is used only while the length x width products and the volumes are normal doubles.
Scaling all lengths by a power of two (exact in binary) leaves the counts unchanged and the
utilisation unchanged to about 1e-13; it is not bit-identical, because the two formulas round
differently, and it assumes the scaled lengths themselves are exactly representable.

Known false rejections (a correct answer exists but is not returned):

- `maxPayloadKg / weightKg` above 2^53 - 1 (about 9e15 items) throws even when geometry limits the
  count to far fewer, for example `maxPayloadKg` 1e16 with 1 kg items. Do not use a huge number to
  mean "no payload limit"; pass a realistic bound such as the container's rated payload.
- When no orientation fits, the first orientation's grid is reported, so an unsafe axis there throws
  although the correct count is 0.
- Counts above 2^53 - 1 are never representable here, even when the true answer is that large.

Reliable handling would need an API change (for example a `payloadCount` that can be absent, or BigInt
counts), which is not implemented.

## Limitations

- One orientation for the whole load. Mixed orientations or mixed layouts could fit more.
- Identical items only. No mixed item types.
- No stacking strength, load limits per layer, weight distribution or axle limits, fragility, or
  "this side up" constraints beyond the `'upright'` mode.
- No packaging allowance, dunnage, door or pallet-clearance margins. Subtract them from the inputs.
- Container sizes are not built in. The caller supplies them.
- The result is a planning estimate, not a loading instruction, and not a guarantee of an optimal
  packing, of physical fit or of safety. Check real loads against carrier and regulatory rules.
- Results are computed in double precision. Near the tolerance boundaries (see Units and rounding) an
  item that is a hair too large can be counted, and an exact fit at counts above roughly 1e12 can be
  missed. No numerical precision is guaranteed beyond that.

## Test and build

Tests use the Node built-in runner, so they need no install. There are 49 tests: geometric fit and
boundaries, rotations and their order, the payload cap and its boundary, validation messages, an exact
BigInt reference check on 500 pseudo-random cases, exact-decimal checks of the large-quotient
tolerance (both sides of each constant), and the numerical-limit and per-axis-ratio cases at extreme
magnitudes. Run on Node v22.23.3, which runs `.ts`
files directly. Other Node versions are untested.

```bash
npm test          # node --test
```

`npm run build` and `npm run typecheck` use `tsc` (TypeScript 6.0.3 as a dev dependency). Run
`npm install` (or `npm ci`) first. They check and build `src/` only; the test files are not
type-checked. Build output goes to `dist/`.

## License

MIT. See [LICENSE](LICENSE).
