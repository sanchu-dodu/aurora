# Aurora

Aurora is an AI-powered streaming discovery platform built with a Next.js web application and a companion command-line interface.

The project combines movie and TV discovery, trailer playback, personal viewing features, automated testing, and developer tooling in one repository.

## Project status

Aurora is under active development.

The application currently focuses on content discovery and trailer playback. TMDB supplies movie and TV metadata, while available trailers are played through YouTube.

Aurora does not obtain or host full copyrighted movies from TMDB.

## Roadmap

Aurora CLI is evolving into the secure execution engine and local control plane for Aurora Technologies, including Aurora Stream, Aurora Security, Aurora AI, Aurora Cloud, and future business solution packs.

See the [Aurora Technologies Platform Roadmap](ROADMAP.md) for the current architecture, security gates, product tracks, and phased delivery plan.

## Features

- Trending, popular, top-rated, upcoming, and now-playing discovery
- Movie and TV browsing
- Movie detail pages
- Search
- My List persistence
- Continue Watching
- Top Ten content sections
- YouTube trailer playback
- Custom player controls
- Cinema mode
- Play, pause, mute, and seek controls
- AI assistant and recommendation route
- Responsive Next.js interface
- Aurora CLI developer toolkit
- Playwright end-to-end smoke tests
- Protected GitHub pull-request workflow
- Automated Web and CLI continuous integration

## Repository structure

| Path | Purpose |
| --- | --- |
| `web/` | Aurora Next.js streaming application |
| `aurora-cli/` | Aurora command-line toolkit |
| `.github/workflows/` | GitHub Actions CI workflows |
| `.github/pull_request_template.md` | Pull-request template |
| `.codex/` | Local development skills and resources |
| `CONTRIBUTING.md` | Contribution and repository workflow guide |

## Technology stack

### Web application

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS 4
- TMDB API
- React YouTube
- Playwright
- ESLint

### Aurora CLI

- Node.js 22.15 or newer
- TypeScript
- Commander
- Chalk
- Inquirer
- Ora
- Zod
- fs-extra

The published CLI package is:

    @kin666/aurora-cli

## Requirements

Install:

- Git
- Node.js 22 or Node.js 24
- npm
- GitHub CLI, recommended for pull-request operations

## Clone the repository

    git clone https://github.com/sanchu-dodu/aurora.git
    cd aurora

## Web application setup

Move into the web directory:

    cd web

Install dependencies:

    npm ci

Create:

    web/.env.local

Add your TMDB token:

    TMDB_API_TOKEN=your_token_here

Never commit the real token or the `.env.local` file.

Start the development server:

    npm run dev

The application normally starts at:

    http://localhost:3000

## Web commands

Run these commands from the `web` directory.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js development server |
| `npm run lint` | Run ESLint |
| `npx tsc --noEmit` | Run TypeScript validation |
| `npm run build` | Create a production build |
| `npm run start` | Start the production server |
| `npm run test:e2e` | Run Playwright smoke tests |
| `npm run test:e2e:headed` | Run Playwright with a visible browser |
| `npm run test:e2e:ui` | Open the Playwright interface |
| `npm run test:e2e:report` | Open the latest Playwright report |

## Aurora CLI setup

Move into the CLI directory:

    cd aurora-cli

Install dependencies:

    npm ci

Run the CLI from TypeScript:

    npm run dev -- --help

Build the CLI:

    npm run build

Run the CLI tests:

    npm test

Run complete release validation:

    npm run release:check

Use the published package:

    npx @kin666/aurora-cli --help

The installed executable is:

    aurora

## Validation

Before submitting web changes, normally run:

    cd web
    npm run lint
    npx tsc --noEmit
    npm run build
    npm run test:e2e

Before submitting CLI changes, normally run:

    cd aurora-cli
    npm run release:check

Check repository formatting:

    git diff --check

## Continuous integration

Aurora uses two GitHub Actions workflows:

- Aurora Web CI
- Aurora CLI CI

Every pull request to `master` must pass five required checks:

1. `Lint, build, and smoke tests`
2. `ubuntu-latest / Node.js 22`
3. `ubuntu-latest / Node.js 24`
4. `windows-latest / Node.js 22`
5. `windows-latest / Node.js 24`

## Development workflow

The `master` branch is protected. Do not push directly to it.

Create a focused development branch:

    git switch master
    git fetch origin
    git pull --ff-only origin master
    git switch -c type/short-description

Stage exact files:

    git add -- path/to/file

Do not use:

    git add .

Commit and push:

    git commit -m "Describe the change"
    git push --set-upstream origin your-branch-name

Create a pull request:

    gh pr create --base master --head your-branch-name

Watch required checks:

    gh pr checks PR_NUMBER --repo sanchu-dodu/aurora --required --watch

## Contributing

Read `CONTRIBUTING.md` before making changes.

The contribution guide contains:

- Environment setup
- Development commands
- Branch naming
- Exact-file staging
- Testing requirements
- Security requirements
- Pull-request workflow
- Post-merge cleanup

## Security

Never commit:

- TMDB tokens
- API keys
- Passwords
- Private keys
- Populated `.env` files
- `node_modules`
- `.next`
- `dist`
- Playwright reports
- Test result directories
- Other generated artifacts

Do not print secret tokens or authenticated request URLs in logs.
