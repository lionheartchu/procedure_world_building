# Residual Ecology

An exploratory procedural ecology and art/research prototype. Prioritize thoughtful implementation, experiential quality, and creative iteration, with basic correctness and safety.

## Working style

- Treat my prompt as the brief. Infer reasonable implementation details and proceed; ask when an unresolved choice would materially change the direction or scope.
- Think through the relevant mechanisms and dependencies. Explain important trade-offs briefly, without a mandatory planning template or number of alternatives.
- Choose a coherent solution that achieves the intended experience. Make supporting changes when needed; avoid unrelated cleanup or speculative infrastructure.
- Read code and documentation selectively. Use current code for implementation facts and my latest decisions for direction. Consult `docs/architecture.md` and `PROJECT_DIRECTION.md` when useful; older plans are context, not fixed specifications.

## Project judgment

- Keep procedural causes and seeded generation intentional. Distinguish autonomous behavior, precomputed history, replay, and visual animation.
- Evaluate visual and interaction changes at the scale and viewpoint people will experience. Spatial coherence and movement matter alongside the appearance of individual forms.
- Preserve unrelated views and experiments. Existing architecture and aesthetics can evolve when the task calls for it.

## Verification

- Use a small, focused check of the affected behavior, with a build or targeted lint check when relevant. For rendering or navigation changes, inspect the affected browser view and basic controls when available.
- One successful focused pass is normally enough. Expand only for a failed check, a concrete unresolved risk, or an explicit request for broader verification.
- Do not default to exhaustive regression matrices, pixel comparisons, or new test infrastructure. Temporary diagnostics are fine; keep disposable artifacts out of the repo.
- Check access and failure behavior carefully when touching authentication, storage, or user data.

Commands in `react-app/`: `npm run dev`, `npm run build`, `npm run lint`.

## Boundaries and completion

- Protect uncommitted work, secrets, and user data. Do not commit, push, deploy, or perform destructive git/data operations unless requested.
- Stop when the requested outcome works and relevant checks are complete. Briefly report what changed, what was actually checked, and any meaningful limitations; be clear when visual behavior remains unverified.
- Update documentation when requested or when a change makes an existing statement misleading. Avoid generating a report or study document for every small iteration.

