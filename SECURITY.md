# Security Policy

Aurora takes the security of its web application, command-line tools, development workflows, and users seriously.

This document explains which versions are supported, how to report vulnerabilities responsibly, and how sensitive information must be handled.

## Supported versions

Aurora is under active development.

Security fixes are normally applied to the latest code on the protected `master` branch and, where applicable, the latest published Aurora CLI release.

| Component | Support status |
| --- | --- |
| Aurora web application on `master` | Supported |
| Latest published `@kin666/aurora-cli` release | Supported |
| Active pull-request branches | Evaluated when relevant |
| Older commits, abandoned branches, or forks | Not normally supported |

Support for a specific historical version is not guaranteed unless it is explicitly documented.

## Reporting a vulnerability

Do not report security vulnerabilities through a public issue, pull request, discussion, commit message, or application screenshot.

Use GitHub's private vulnerability reporting option from the repository's **Security** section when it is available.

When private vulnerability reporting is unavailable, create a public issue titled:

    Security contact request

Do not include technical vulnerability details, credentials, reproduction steps, secrets, user information, or screenshots in that issue. Its only purpose should be to request a private communication channel from the repository maintainer.

## Information to include

A useful private security report should contain:

- A clear description of the vulnerability
- The affected Aurora component
- The affected branch, release, route, command, or file
- Reproduction steps or a minimal proof of concept
- The expected behavior
- The observed behavior
- The potential security impact
- Relevant operating-system, browser, Node.js, or dependency versions
- Suggested remediation, when available
- Whether the issue has been disclosed anywhere else

Provide enough information for the maintainers to reproduce and assess the issue without exposing unrelated sensitive data.

## Sensitive information

Never include real secrets in a security report, test fixture, pull request, commit, log, screenshot, or terminal transcript.

Sensitive information includes:

- TMDB API tokens
- OpenAI API keys
- Firebase credentials
- Authentication tokens
- Session cookies
- Passwords
- Private keys
- Personal information
- Populated `.env` files
- Private repository credentials
- Deployment credentials
- GitHub tokens
- npm access tokens

Use clearly fake placeholders such as:

    TMDB_API_TOKEN=redacted
    OPENAI_API_KEY=redacted

Redact authenticated URLs, request headers, cookies, and query parameters before sharing logs.

## Responsible testing

Security research involving Aurora must follow these rules:

- Test only systems, accounts, data, and environments you own or are authorized to test
- Avoid accessing, modifying, downloading, or deleting another person's data
- Do not perform denial-of-service or resource-exhaustion testing
- Do not use phishing, social engineering, spam, or physical attacks
- Do not introduce malware or persistent access
- Do not intentionally disrupt the application, CI workflows, package registry, or third-party services
- Stop testing if sensitive information or unauthorized access is encountered
- Report the issue privately as soon as practical

Testing against TMDB, YouTube, OpenAI, Firebase, GitHub, npm, or another third-party service must also comply with that provider's policies and authorization requirements.

## Scope

Security reports may cover:

- The Aurora Next.js web application
- API routes
- Authentication and authorization behavior
- User-controlled data handling
- My List and Continue Watching persistence
- AI-assistant request handling
- TMDB integration
- Video-player integration
- Aurora CLI commands
- CLI project generation
- Dependency and package configuration
- GitHub Actions workflows
- Repository security configuration
- Accidental secret exposure
- Unsafe logging
- Build, release, and publication processes

Issues that exist entirely within an external service should normally be reported to that service. Aurora integration problems that expose Aurora users or credentials may still be reported to this repository.

## Disclosure process

Reporters should allow maintainers reasonable time to investigate, reproduce, remediate, test, and release a correction before publishing vulnerability details.

Maintainers may:

1. Confirm receipt of the report
2. Request additional reproduction information
3. Assess severity and affected components
4. Develop and validate a correction
5. Coordinate release timing
6. Publish an advisory when appropriate
7. Credit the reporter when requested and appropriate

Do not publicly disclose an unresolved vulnerability without first attempting responsible private coordination.

## Security requirements for contributors

Contributors must:

- Keep secrets in ignored environment files
- Use placeholder credentials in documentation and examples
- Avoid logging tokens, cookies, authenticated URLs, or complete API responses containing sensitive data
- Stage only intended files
- Never commit `node_modules`, build output, test reports, or populated environment files
- Review dependency changes before committing lockfile updates
- Run the relevant validation commands before opening a pull request
- Use protected pull requests instead of pushing directly to `master`

Stage exact files with commands such as:

    git add -- path/to/file

Do not use broad staging commands such as:

    git add .

## Accidental secret exposure

When a secret is exposed:

1. Revoke or rotate it immediately
2. Remove it from the current working tree
3. Determine whether it entered Git history, logs, artifacts, releases, or package publications
4. Remove or invalidate exposed copies
5. Review access logs when available
6. Document the remediation privately
7. Add preventive controls where appropriate

Deleting a secret from the latest file does not remove it from previous Git commits. Rotation is still required.

## Security updates

Security-related changes must follow the protected pull-request workflow and pass all required Aurora Web CI and Aurora CLI CI checks before merging, except when repository administrators must take immediate containment action.
