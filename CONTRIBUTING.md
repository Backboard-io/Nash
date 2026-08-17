# Contributing to Nash

Thanks for your interest in contributing! Nash is an open-source project under
the [MIT License](LICENSE). Issues, discussions, and pull requests are welcome.

> Please read this whole file before opening your first PR. It is short.

---

## Code of Conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting security issues

Do **not** open a public GitHub issue for security vulnerabilities. Follow the
private disclosure process in [SECURITY.md](SECURITY.md).

## Project layout

| Path | What it is |
|------|------------|
| `api/` | Active Flask backend (Python 3.11+). Entry: `api.app:create_app`. |
| `client/` | React + Vite frontend (forked from LibreChat). |
| `packages/data-provider`, `packages/client` | Shared frontend packages used by `client/`. |
| `docs/` | Architecture and operational docs. |

> When in doubt, treat the Flask app under `api/` as the canonical backend.

## Local development

### Prerequisites

- Python **3.11+**
- Node **20+** and npm 11+
- [`uv`](https://docs.astral.sh/uv/) for the Python toolchain
- Docker Desktop running (required — `make dev` brings up a DynamoDB Local sidecar)

### One-command start

```bash
cp .env.example .env          # configure your keys
make dev                      # installs deps, builds frontend, starts API + UI
```

The API runs on http://localhost:3080 and the frontend on http://localhost:3090.
Logs stream to `/tmp/nash-api.log` and `/tmp/nash-frontend.log`.

### DynamoDB Local commands

`make dev` brings up DynamoDB Local automatically. These targets are escape
hatches for the API-only flow (`make backend`) or for troubleshooting:

```bash
make dynamo-up        # start the container on :8100
make dynamo-init      # create the `nash` table
make dynamo-down      # stop and remove
```

### Useful Make targets

```bash
make install     # install JS + Python dependencies (uses uv + npm)
make build       # build the frontend
make backend     # run the Flask API only
make frontend    # run the Vite dev server only
make test        # run the supported test suite
make clean       # stop DynamoDB Local + remove __pycache__
```

## Tests

```bash
make test            # default suite — fast, hermetic, gates CI
make test-extended   # opt-in: slower integration tests that hit the full app
make test-frontend   # Jest tests under client/ (slow)
```

`make test` runs the pytest suite (everything not marked `extended`) plus the
two BYOK suites (`tests/test_byok.py`, `tests/test_byok_e2e.py`). It should complete in a
few seconds and is what CI gates on.

`make test-extended` runs the integration tests that boot the full Flask app
and exercise routes end-to-end. They are slower and a couple of them are
flagged as known issues — please check the file headers for status.

Playwright e2e tests under `e2e/` require a running app and are not part of
either `make test` or CI.

When adding code, add tests where it is reasonable. We do not require 100%
coverage but new behavior should have at least a smoke test.

## Coding style

- Python: keep imports sorted, prefer type hints, follow the patterns already
  in `api/services/` and `api/routes/`. Don't add comments that just restate
  the code.
- TypeScript / React: follow existing component conventions in `client/src/`
  and the shared `packages/`.
- Don't commit generated artifacts (`dist/`, `.turbo/`, coverage, logs).
- Don't commit secrets. Real secrets belong in `.env` only — which is
  `.gitignored`. Use `.env.example` to document any new variables.

## Branches and pull requests

1. Fork the repository and create a topic branch from `main`.
2. Keep PRs focused — one logical change per PR is much easier to review.
3. Reference any related issue (`Fixes #123`) in the description.
4. Make sure `make test` passes locally before requesting review.
5. Be patient — maintainers are usually a small team. Friendly pings are fine
   if a PR has gone quiet for more than a week.

## Adding a new environment variable

1. Add a placeholder line to [.env.example](.env.example) with a short comment.
2. Read it through Pydantic settings in [api/config.py](api/config.py) when it
   is server-side.
3. Frontend env vars must be prefixed `VITE_`. Anything else is **not** exposed
   to the browser bundle by design (see [client/vite.config.ts](client/vite.config.ts)).
4. Document it in the README only if external users need to set it.

## Releasing (maintainers)

- Keep `package.json` (root) and `pyproject.toml` versions in sync.
- Tag releases with `vX.Y.Z`.
- Update [CHANGELOG.md](CHANGELOG.md) when one exists.

Thanks again for contributing!
