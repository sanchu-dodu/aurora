# Contributing to Aurora

Thank you for contributing to Aurora. This repository contains the Aurora streaming web application and Aurora CLI.

## Repository structure

- `web/` — Next.js streaming application
- `aurora-cli/` — Aurora command-line interface
- `.github/workflows/` — GitHub Actions workflows
- `.github/pull_request_template.md` — Pull-request template

## Requirements

Install:

- Git
- Node.js 22 or 24
- npm
- GitHub CLI

## Web application

Run these commands from the `web` directory:

    cd web
    npm ci
    npm run dev
    npm run lint
    npx tsc --noEmit
    npm run build
    npm run test:e2e

Create `web/.env.local` and add:

    TMDB_API_TOKEN=your_token_here

Never commit `.env.local` or expose the real token.

## Aurora CLI

Run these commands from the `aurora-cli` directory:

    cd aurora-cli
    npm ci
    npm run dev
    npm run build
    npm test
    npm run release:check

The package name is `@kin666/aurora-cli`.

## Branch workflow

The `master` branch is protected. Do not commit directly to it.

Start from an updated master branch:

    git switch master
    git fetch origin
    git pull --ff-only origin master

Create a development branch:

    git switch -c type/short-description

Recommended prefixes:

- `feature/`
- `fix/`
- `docs/`
- `test/`
- `ci/`
- `chore/`

## Staging and committing

Check your changes:

    git status --short
    git diff
    git diff --check

Stage exact files only:

    git add -- path/to/file

Do not use `git add .`.

Inspect staged changes:

    git diff --cached --name-status
    git diff --cached
    git diff --cached --check

Commit and push:

    git commit -m "Describe the change"
    git push --set-upstream origin your-branch-name

## Pull requests

Create a pull request:

    gh pr create --base master --head your-branch-name

All five required CI checks must pass before merging:

1. `Lint, build, and smoke tests`
2. `ubuntu-latest / Node.js 22`
3. `ubuntu-latest / Node.js 24`
4. `windows-latest / Node.js 22`
5. `windows-latest / Node.js 24`

Watch the checks:

    gh pr checks PR_NUMBER --repo sanchu-dodu/aurora --required --watch

## Security

Never commit:

- API tokens
- Passwords
- `.env` files containing secrets
- `node_modules`
- `.next`
- `dist`
- Playwright reports
- Generated build files

## Cleanup after merging

    git switch master
    git fetch --prune origin
    git pull --ff-only origin master
    git branch -d your-branch-name

A clean repository should show:

    ## master...origin/master
