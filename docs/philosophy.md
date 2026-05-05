# Philosophy

smoovcode is not trying to recreate a terminal for the model. It exposes the smallest useful set of structured, auditable coding capabilities.

## Capabilities over commands

A coding agent should not need an unrestricted host shell to be useful. Instead, smoovcode gives the model explicit capabilities with narrow inputs, bounded outputs, predictable side effects, and UI-visible results.

This keeps the agent's mental model close to the product's safety model:

- inspect the project through read-oriented capabilities,
- compute plans in codemode,
- mutate files only through visible top-level tools,
- add project workflows as typed capabilities instead of raw command passthrough.

## The executor is not the boundary

Executors control where model-authored codemode runs: QuickJS, local Node.js, or another backend. They do not define whether the agent can mutate the project.

The real boundary is the capability policy: which tools are exposed, which filesystem they can see, which commands can run, and how side effects are rendered or approved.

## Visible mutations

File mutations are top-level actions. `write` and `edit` update the real working tree immediately, but they are discrete events that the UI can show, summarize, and eventually gate.

Read and orchestration can be batched inside codemode for efficiency. Mutations should stay visible unless a capability has been deliberately designed to be safe and auditable.

## No raw shell by default

The sandboxed command tool is a Unix-like file/text toolbox over the mounted project filesystem. It is not a promise that `npm`, `git commit`, `python`, or arbitrary host binaries are available.

When the agent needs project validation, package operations, Git writes, or GitHub writes, prefer purpose-built capabilities such as `project.check`, `project.test`, `git.commit`, or `github.createPr` over a generic shell escape.
