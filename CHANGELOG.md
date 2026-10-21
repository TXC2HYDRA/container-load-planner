# Changelog

This project follows [Semantic Versioning](https://semver.org/). It is not published to npm and no
release tag exists yet; versions below describe the state of `main`.

## 0.1.0 - 2026-10-21

First public version.

- `planContainerLoad`: uniform-grid load count limited by geometry and payload, with `'upright'` and
  `'any'` rotation.
- Floor tolerance that grows with the quotient (fixed 1e-9 up to about 1.1 million items per axis).
- `RangeError` for counts or total weight that double precision cannot represent exactly.
- 49 tests, GitHub Actions CI, install from GitHub with `npm install github:TXC2HYDRA/container-load-planner`.
