# Contributing to Notron

First off, thank you for taking the time to contribute! 🎉

The following is a set of guidelines for contributing to Notron. These are mostly guidelines, not rules. Use your best judgment, and feel free to propose changes to this document in a pull request.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Commit Conventions](#commit-conventions)
- [Style Guides](#style-guides)
- [Reporting Bugs](#reporting-bugs)
- [Feature Requests](#feature-requests)

## Code of Conduct

This project and everyone participating in it is governed by the [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior.

## Getting Started

1. Fork the repository and clone it locally.
2. Install dependencies with [Bun](https://bun.sh):

   ```bash
   bun install
   ```

3. Run the development server:

   ```bash
   bun run tauri dev
   ```

4. Create your feature branch from `main`:

   ```bash
   git checkout -b feat/my-amazing-feature
   ```

## Development Workflow

1. Keep your changes focused. Each pull request should address a single issue or feature.
2. Keep branches up to date with the upstream `main` branch before opening a PR.
3. Write tests where applicable and ensure existing tests pass.
4. Run the type checker before committing:

   ```bash
   bun run check
   ```

5. Open a pull request against the `main` branch and fill out the PR template.

### Commit Conventions

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat: introduce a new feature`
- `fix: fix a bug`
- `docs: update documentation`
- `refactor: refactor code without changing behavior`
- `perf: improve performance`
- `test: add or update tests`
- `chore: routine tasks, dependency updates`

Consider adding a scope for readability, e.g. `feat(editor): add word wrap toggle`.

## Style Guides

### TypeScript / Svelte

- Follow the existing patterns in the codebase.
- Prefer Svelte 5 **runes** over legacy reactive statements.
- Use the existing store/util conventions under `src/lib/`.

### Rust

- Run `cargo fmt` to format your code.
- Follow the existing module and command patterns under `src-tauri/src/`.
- Handle errors explicitly; avoid silent `unwrap()` where recoverable.

## Reporting Bugs

Open an issue with the **Bug Report** template and include:

- A clear and descriptive title.
- Steps to reproduce the behavior.
- Expected and actual results.
- Environment details (OS, Notron version, terminal output if relevant).
- Screenshots or logs, if helpful.

## Feature Requests

Suggestions are always welcome. Open an issue with the **Feature Request** template and describe:

- The problem your feature solves.
- The proposed behavior/solution.
- Any alternatives you considered.

## Recognition

Contributors are acknowledged in the release notes. Every pull request matters — thank you for helping improve Notron!