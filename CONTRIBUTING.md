# Contributing

Thanks for looking. This is a small calculator, and changes should keep it small.

## Scope

- In scope: wrong counts, wrong utilisation, bad input handling, unclear documentation, missing tests.
- Out of scope: a packing optimiser, mixed item types, mixed orientations, built-in container catalogues.
  See Limitations in the README.
- No runtime dependencies. A new dependency needs a clear reason in the pull request.

## Reporting a bug

Open an issue with:

1. The exact input (`container`, `item`, `rotation`) as JSON.
2. The result you got and the result you expected, with the arithmetic that gives your expected value.
3. Your Node version (`node -v`).

A failing input is the most useful thing you can send.

## Making a change

You need Node 22.18 or newer (CI uses the latest 22.x) and npm.

```bash
npm ci
npm test
npm run typecheck
npm run build
```

- Add or update a test in `test/plan.test.ts` for every behaviour change. Tests are not type-checked by
  `npm run typecheck`, so run them as well.
- Keep the README in step with behaviour. The example output in the README is checked by a test.
- Do not commit `dist/` or `node_modules/` (both are ignored).
- Use short commit messages in the form `fix: ...`, `feat: ...`, `docs: ...`, `test: ...`.

By contributing you agree that your contribution is licensed under the MIT License in `LICENSE`.
