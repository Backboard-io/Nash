# Security Policy

## Reporting a Vulnerability

Please do **not** open a public issue for security vulnerabilities.

Instead, report it privately via GitHub's security advisories: go to the
repository's **Security** tab → **Report a vulnerability**. This keeps the
report visible only to the maintainers until a fix is released.

Include what you can:

- A description of the issue and its impact
- Steps to reproduce (a minimal proof of concept helps a lot)
- The affected component (backend route, frontend, session handling, etc.)

We'll acknowledge reports as quickly as we can, keep you updated on the fix,
and credit you in the release notes unless you prefer otherwise.

## Scope notes

- Nash stores each user's Backboard API key AES-256-GCM-encrypted in a
  server-side DynamoDB session; the plaintext key must never reach the
  browser after login. Anything that violates that invariant is in scope.
- Self-hosted deployments must set a unique `ENCRYPTION_KEY` — the
  placeholder value in `.env.example` is rejected outside local development
  by design. Reports about intentionally-insecure local-dev defaults are
  out of scope.
