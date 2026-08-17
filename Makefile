.PHONY: dev install build dynamo-up dynamo-down dynamo-init test test-py test-e2e test-extended test-frontend backend frontend lint clean

# ============================================================
# One-command dev (build frontend + start everything)
# ============================================================

define DEV_SCRIPT
set -euo pipefail

# uv installs to ~/.local/bin or ~/.cargo/bin — often missing from PATH in GUI terminals
export PATH="$${HOME}/.local/bin:$${HOME}/.cargo/bin:$${PATH}"

if ! command -v uv >/dev/null 2>&1; then
  echo "ERROR: uv is not installed (install: curl -LsSf https://astral.sh/uv/install.sh | sh)"
  exit 1
fi

echo "=== Nash (local dev) ==="

# Free ports
lsof -ti:3080 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti:3090 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1

echo "→ uv sync"
uv sync --quiet

echo "→ npm install"
npm install --silent --no-audit --no-fund >/dev/null 2>&1 || npm install --no-audit --no-fund

# Build shared packages the client imports at compile time
if [ ! -d "packages/data-provider/dist" ] || [ ! -d "packages/client/dist" ]; then
  echo "→ building shared packages (one-time)"
  npx turbo run build \
    --filter=librechat-data-provider \
    --filter=@librechat/client >/dev/null 2>&1 || {
      echo "  Shared package build failed. Run: npx turbo run build --filter=librechat-data-provider"
      exit 1
    }
fi

# DynamoDB Local — required by the state service.
echo "→ ensuring DynamoDB Local on :8100"
if ! docker info >/dev/null 2>&1; then
  echo "  Docker daemon not reachable. Start Docker Desktop and re-run."
  exit 1
fi
if docker ps --filter 'name=^nash-dynamodb$$' --format '{{.Names}}' | grep -q '^nash-dynamodb$$'; then
  echo "  already running"
elif docker ps -a --filter 'name=^nash-dynamodb$$' --format '{{.Names}}' | grep -q '^nash-dynamodb$$'; then
  docker start nash-dynamodb >/dev/null
  echo "  started existing container"
else
  docker run -d --name nash-dynamodb -p 8100:8000 \
    amazon/dynamodb-local:1.25.0 \
    -jar DynamoDBLocal.jar -sharedDb -inMemory >/dev/null
  echo "  created new container"
fi
for i in {1..20}; do
  if nc -z localhost 8100 2>/dev/null; then
    break
  fi
  if [ $$i -eq 20 ]; then
    echo "  DynamoDB Local did not accept connections on :8100 in time"
    exit 1
  fi
  sleep 0.5
done

# Start Flask dev server. NOTE: the Flask CLI loads .env into OS env vars
# (which boto3 needs for AWS creds), and OS env outranks pydantic's env_file
# chain — so .env.local overrides do NOT apply under this launcher. Put local
# values in .env itself when running via make dev.
echo "→ starting API on :3080"
FLASK_DEBUG=0 uv run flask --app "api.app:create_app" run \
  --host 0.0.0.0 --port 3080 --no-reload --no-debugger \
  >/tmp/nash-api.log 2>&1 &
API_PID=$$!

for i in {1..30}; do
  if curl -fsS --max-time 1 http://127.0.0.1:3080/health >/dev/null 2>&1; then
    echo "  API ready (pid $$API_PID)"
    break
  fi
  if ! kill -0 $$API_PID 2>/dev/null; then
    echo "  API crashed. Logs:"
    tail -n 50 /tmp/nash-api.log
    exit 1
  fi
  sleep 0.5
done

echo "→ starting frontend on :3090"
npm run frontend >/tmp/nash-frontend.log 2>&1 &
FE_PID=$$!
sleep 2

if ! kill -0 $$FE_PID 2>/dev/null; then
  echo "  Frontend crashed. Logs:"
  tail -n 50 /tmp/nash-frontend.log
  exit 1
fi
echo "  Frontend running (pid $$FE_PID)"

echo ""
echo "  ready → http://localhost:3090"
echo "  logs  → tail -f /tmp/nash-api.log  (or /tmp/nash-frontend.log)"
echo ""

trap "kill $$API_PID $$FE_PID 2>/dev/null; exit 0" INT TERM
wait
endef
export DEV_SCRIPT

dev:
	@bash -c "$$DEV_SCRIPT"

# ============================================================
# Components
# ============================================================

install:
	npm install
	uv sync
	uv pip install "moto[dynamodb]" pytest
	@echo "All dependencies installed"

build:
	npm run build
	@echo "Frontend built"

backend:
	AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local \
		DYNAMO_ENDPOINT=http://localhost:8100 \
		.venv/bin/python -m api.app

frontend:
	npm run frontend

dynamo-up:
	@if docker ps --filter 'name=^nash-dynamodb$$' --format '{{.Names}}' | grep -q '^nash-dynamodb$$'; then \
		:; \
	elif docker ps -a --filter 'name=^nash-dynamodb$$' --format '{{.Names}}' | grep -q '^nash-dynamodb$$'; then \
		docker start nash-dynamodb >/dev/null; \
	else \
		docker run -d --name nash-dynamodb -p 8100:8000 amazon/dynamodb-local:1.25.0 -jar DynamoDBLocal.jar -sharedDb -inMemory >/dev/null; \
	fi
	@sleep 2
	@echo "DynamoDB Local running on :8100"

dynamo-init:
	@AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local \
		DYNAMO_ENDPOINT=http://localhost:8100 DYNAMO_TABLE=nash \
		.venv/bin/python -c "from api.services.dynamo_service import ensure_table; ensure_table(); print('DynamoDB table ready')" \
		2>/dev/null || echo "DynamoDB table init skipped (run make dynamo-up first)"

dynamo-down:
	@docker stop nash-dynamodb 2>/dev/null; docker rm nash-dynamodb 2>/dev/null; true
	@echo "DynamoDB Local stopped"

# ============================================================
# Tests
# ============================================================
# `make test`          → default supported suite (fast, hermetic)
# `make test-py`       → pytest-discovered tests under tests/ (default markers)
# `make test-e2e`      → BYOK end-to-end script (mocked AWS via moto)
# `make test-extended` → slow / network-bound integration tests (opt-in)
# `make test-frontend` → Jest tests in client/ (run separately, slow)

test: test-py test-e2e

test-py:
	.venv/bin/python -m pytest tests/ -v --ignore=tests/test_byok_e2e.py

test-e2e:
	.venv/bin/python tests/test_byok_e2e.py

test-extended:
	.venv/bin/python -m pytest -m extended tests/ -v

test-frontend:
	npm test -w client -- --watchAll=false

# ============================================================
# Cleanup
# ============================================================

clean: dynamo-down
	@find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null; true
	@echo "Cleaned"
