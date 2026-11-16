# Data configuration

## Git repositories

`git-repositories.yaml` opts repositories into the public Git feed. Run
`bun run sync:git` to import it, or `bun run sync:git /path/to/manifest.yaml`
to use another manifest. The YAML document is a list of repository objects:

```yaml
- id: days
  github: ohnsh/days-next
  path: ${REPOS_ROOT}/days-next
  defaultBranch: main
  refs: [main, prototype/git-activity]
  commitUrl: https://github.com/ohnsh/days-next/commit/{sha}

- id: server-project
  remote: user@server:/srv/git/project.git
  authors:
    emails: [you@example.com]
```

- `id` (required): unique, nonempty, stable repository identity used in
  `git:<id>:<sha>` IDs and feed grouping.
- Exactly one of `path` and `remote` is required, as a nonempty string:
  - `path`: repository root, absolute or relative to the **manifest's directory**.
    Local repositories are read without fetching or modifying the working tree.
    Supports `$VARIABLE` and `${VARIABLE}` substitutions, such as
    `${REPOS_ROOT}/days-next`. Set variables in the shell or `.dev.vars`; shell
    values take precedence. Unset or empty variables abort sync. Expansion applies
    only to `path`, with no shell execution or shell default-value syntax.
  - `remote`: Git transport URL, including `user@host:/path/repo.git` or `ssh://…`.
    Remotes are fetched into owned bare caches under `.data/git-repositories/`.
    SSH uses your normal keys/config and noninteractive authentication.
- `defaultBranch` (optional): nonempty branch name, such as `main`. Otherwise,
  remote entries discover the remote's symbolic HEAD; local entries use
  `origin/HEAD` to identify the corresponding local branch, or a bare repository's
  symbolic HEAD. A working checkout's current branch is not assumed to be its
  default. If discovery fails, specify this field.
- `refs` (optional): nonempty list of branch names or full `refs/heads/…` /
  `refs/remotes/…` names. Omission selects only the default branch. An explicit
  list **must include the default branch**, alongside every desired topic branch.
  Short names mean local branches, including in remote caches. Explicit
  remote-tracking refs work for local paths; set `defaultBranch` to the matching
  full remote-tracking ref when using that mode.
- `commitUrl` (optional): HTTP(S) viewer template containing `{sha}`. Without it,
  titles render without links. The importer does not check whether local/unpushed
  commits exist in the viewer.
- `github` (optional): GitHub `owner/repo` identity replaced by this Git entry,
  matched case-insensitively against GitHub items' repository groups. Configuring
  it suppresses that repository's entire GitHub history in feeds, day pages, and
  individual-item reads, even before the first Git sync. GitHub database rows are
  retained; removing the mapping restores visibility. No identity is inferred
  from `id`, `path`, `remote`, or `commitUrl`. Commit and deploy mapping changes;
  invalid identities fail configuration and Git imports.
- `authors` (optional): object with optional `names` and `emails` lists of nonempty
  strings, matched exactly and case-insensitively with OR semantics. Omission
  retains the personal GitHub author name/domain rules in `src/lib/sources.ts`;
  an empty object or only empty lists matches nobody. Author dates are mapped to
  **America/Chicago**.

Use `[]` for an empty manifest. Removing repositories or refs, or rewriting history,
requires an explicit force scope; see [Git import operation](../../agent-notes/usage.md#git-repository-prototype).

## Poster overrides

Edit `poster-overrides.yaml`, then commit and deploy to change a day's camera posters:

```yaml
'2026-11-01':
  time: '14:00'
  cameras:
    apartment: '16:30'
'2026-10-31':
  cameras:
    apartment: '13:15'
```

- Dates match the day pages. All times are 24-hour `HH:mm` in **America/Chicago**.
- Use view IDs from VOD's `/api/views`, not display names. The YAML key remains `cameras`.
- A camera time takes priority over the day's `time`. Both fields are optional.
- Overrides select the first available recording poster at or after the time. If none
  exists, they use the latest earlier poster for that day. They select existing posters,
  not exact video frames, and do not change the playback start position.
- Remove an override to restore automatic selection: three-hour blocks today, or the first
  poster at/after noon for previous days.
- Invalid dates, times, or fields fail during Astro configuration (including builds).
- Existing page caches may delay when a deployed override appears.
- On daylight-saving transitions, nonexistent times move forward by the gap; repeated
  times use the earlier occurrence.
