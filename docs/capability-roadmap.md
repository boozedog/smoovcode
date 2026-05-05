# Capability roadmap

The common agent request is "give me more commands." The smoovcode answer should usually be "add the workflow as a typed capability."

## Project workflows

Instead of exposing package managers or raw task runners directly, add project-aware capabilities:

- `project.install()`
- `project.check()`
- `project.test({ filter? })`
- `project.build()`
- `project.run({ script })`

For this repository those capabilities should route through Vite+ (`vp`) rather than direct `npm`, `pnpm`, `vitest`, or `vite` calls.

## Git write workflows

Prefer typed Git write capabilities over raw Git commands:

- `git.createBranch({ name })`
- `git.commit({ message, paths? })`
- `git.restore({ paths })`
- `git.applyPatch({ patch })`

Git writes should be approval-gated and should never bypass repository signing policy.

## GitHub write workflows

Prefer typed GitHub capabilities:

- `github.createPr({ title, body, base?, head? })`
- `github.commentIssue({ number, body })`
- `github.commentPr({ number, body })`

These should be approval-gated because they affect external systems.

## Better project inspection

The sandboxed command tool could eventually be replaced or de-emphasized with typed inspection capabilities:

- `project.list({ path })`
- `project.read({ path, offset?, limit? })`
- `project.findFiles({ paths?, glob? })`
- `project.searchText({ pattern, paths?, glob? })`
- `project.stat({ path })`

This would reduce the model's tendency to assume it has a real shell.

## Capability checklist

Before adding a capability, define:

- safety class: read, write, or external,
- input schema and validation,
- timeout and output cap,
- filesystem root and path policy,
- whether user approval is required,
- how the UI should render the call and result,
- tests for validation, failures, and successful execution.
