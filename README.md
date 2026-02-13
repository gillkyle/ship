# Ship

A CLI for committing, pushing, and opening PRs — with LLM-generated commit messages, branch names, and PR descriptions.

## Requirements

- [Bun](https://bun.sh)
- [GitHub CLI](https://cli.github.com/) (`gh`)

## Install

```bash
bun install
```

To make `ship` available globally:

```bash
bun link
```

## Usage

```bash
ship              # Interactive mode — prompts through each step
ship setup        # Configure API keys
```

### Autonomous modes

Skip all prompts by passing a goal flag:

| Command               | What it does                              |
|------------------------|------------------------------------------|
| `ship --local`         | Stage, commit locally, stop               |
| `ship --push`          | Stage, commit, push                       |
| `ship --push --stack`  | Stage, split into stacked commits, push   |
| `ship --pr`            | Stage, commit, push, open PR              |
| `ship --pr --stack`    | Stage, split into stacked commits, open PR|

- `--local`, `--push`, and `--pr` are mutually exclusive.
- `--stack` requires `--push` or `--pr`. The LLM groups changed files into logical, atomic commits automatically.
- Autonomous modes require an API key (see below).

## Configuration

Run `ship setup` to save API keys to `~/.config/ship/config.json`.

Supported providers (in priority order):

1. **Groq** — uses `moonshotai/kimi-k2-instruct`
2. **Anthropic** — uses `claude-haiku-4-5`

Keys can also be set via environment variables: `GROQ_API_KEY`, `ANTHROPIC_API_KEY`.

If no key is configured, interactive mode falls back to manual input for commit messages and PR details.

## How it works

1. **Preflight** — checks for `gh`, inspects git state (branch, staged/unstaged/untracked files, remote status)
2. **File selection** — pick all or individual files to include (auto modes include everything)
3. **LLM generation** — diffs are sent to the configured provider to generate a branch name, commit message, PR title, and PR body
4. **Commit** — creates a branch (if on main) and commits
5. **Push / PR / Merge** — depending on mode, pushes, creates a PR via `gh`, and optionally merges with squash
