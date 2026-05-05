# Capabilities

smoovcode exposes tools in two layers: top-level tools for visible conversation events, and codemode tools for read-heavy orchestration.

## Top-level tools

### `codemode`

Runs model-authored TypeScript orchestration code in the configured executor. Use it for exploration, batching reads, filtering, summarizing, and computing an edit plan.

### `write`

Creates or overwrites a file relative to the project root. Paths are root-bounded, protected by ignore/secret deny rules, and symlink writes are rejected.

### `edit`

Performs exact string replacement in a file relative to the project root. By default the old string must occur exactly once. Paths are root-bounded, protected by ignore/secret deny rules, and symlink writes are rejected.

## Tools inside codemode

### `sh.*` sandboxed command tools

Codemode exposes reviewed `just-bash` commands as typed methods such as `sh.rg({ args: [...] })`, `sh.cat({ args: [...] })`, and `sh.find({ args: [...] })`. Each method executes one sandbox builtin with no shell parsing and no arbitrary host binaries.

These tools are useful for file/text inspection commands such as `ls`, `cat`, `rg`, `grep`, `find`, `sed`, `awk`, and `jq`. The cwd is the virtual project mount at `/projects/<folder-name>`.

Meta/arbitrary-code commands and mutation-classified commands are not exposed through `sh.*` by default.

### `astGrep`

Runs structural search over JavaScript, TypeScript, TSX, HTML, and CSS. It accepts either a source string or project-relative paths and returns structured matches.

### GitHub read capabilities

Typed wrappers around `gh` for read-only repository data:

- `gh.issue_view`
- `gh.issue_list`
- `gh.pr_view`
- `gh.pr_list`
- `gh.repo_view`

These are argv-only host process calls with timeouts, output caps, and prompts disabled.

### Git read capabilities

Typed wrappers around `git` for read-only repository data:

- `git.status`
- `git.diff`
- `git.diffStat`
- `git.log`
- `git.show`
- `git.branchList`

Path and ref inputs are validated before invoking Git.

## Current configuration

`.smoov/config.json` currently supports secret deny patterns:

```json
{
  "secrets": {
    "deny": []
  }
}
```

These patterns are layered on top of gitignore-derived rules and the built-in secret deny list.

## Design rule for new capabilities

Do not add a generic escape hatch when a typed workflow would do. Prefer narrow capabilities with schemas, timeouts, output caps, root containment, clear safety labels, and UI-visible effects.
