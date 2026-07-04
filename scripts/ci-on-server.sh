#!/usr/bin/env bash
# ci-on-server.sh — Run the small-gods test suite on the Hetzner server (shared
# with pikkolo-cms-mvp production + CI; pattern adapted from that repo's
# scripts/ci-on-server.sh).
#
# Usage:
#   ./scripts/ci-on-server.sh                 # full vitest suite
#   ./scripts/ci-on-server.sh --files="tests/unit/foo.test.ts tests/unit/bar.test.ts"
#   ./scripts/ci-on-server.sh --build         # tsc + vite build instead of tests
#   ./scripts/ci-on-server.sh --workers=N     # vitest maxWorkers (default 3)
#   ./scripts/ci-on-server.sh --cpus=N        # docker CPU cap (default 3)
#   ./scripts/ci-on-server.sh --clean         # remove remote CI dir + exit
#   ./scripts/ci-on-server.sh --history       # recent run history
#
# The box has 4 shared vCPUs and runs pikkolo production — the CPU cap leaves
# headroom (raise to 4 at your own risk). node_modules persists on the server
# between runs, keyed on the package-lock hash, so only the first run (or a dep
# change) pays npm ci. The runner is DETACHED on the server: a dropped SSH
# connection doesn't kill the run; the client reconnects and keeps streaming.

set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────────
SSH_KEY="${SSH_KEY:-$HOME/.ssh/hetzner_ed25519}"
SSH_HOST="root@pikkolo.site"
# Shared ControlPath string with pikkolo's scripts so concurrent use multiplexes
# over one master connection instead of piling up pre-auth connections.
SSH_OPTS="-i $SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -o ControlMaster=auto -o ControlPath=$HOME/.ssh/cm-pikkolo-%r@%h:%p -o ControlPersist=120s"
BRANCH_SLUG=$(git branch --show-current 2>/dev/null | tr '/' '-' | tail -c 30 || echo "detached")
REMOTE_DIR="/tmp/smallgods-ci-${BRANCH_SLUG}"
REMOTE_HASH_FILE="$REMOTE_DIR/.deps.hash"
NODE_IMAGE="node:22-bookworm"
HISTORY_LOG="/var/log/smallgods-ci.log"
RUNNER_TIMEOUT=3600

log()  { echo "▶ $*"; }
ok()   { echo "✓ $*"; }
warn() { echo "⚠ $*" >&2; }
fail() { echo "✗ $*" >&2; exit 1; }

ssh_run() {
  # shellcheck disable=SC2086
  ssh $SSH_OPTS "$SSH_HOST" "$@"
}

# ── Parse flags ─────────────────────────────────────────────────────────────
TEST_FILES=""
WORKERS=3
CPUS=3
MODE="test"
CLEAN_ONLY=false
HISTORY_ONLY=false

for arg in "$@"; do
  case $arg in
    --files=*)   TEST_FILES="${arg#*=}" ;;
    --build)     MODE="build" ;;
    --workers=*) WORKERS="${arg#*=}" ;;
    --cpus=*)    CPUS="${arg#*=}" ;;
    --clean)     CLEAN_ONLY=true ;;
    --history)   HISTORY_ONLY=true ;;
    -h|--help)   head -20 "$0" | tail -17; exit 0 ;;
    *)           fail "Unknown flag: $arg" ;;
  esac
done

# ── Pre-flight ──────────────────────────────────────────────────────────────
log "Checking SSH connectivity..."
ssh_run "echo connected" > /dev/null || fail "Cannot reach $SSH_HOST"
ok "SSH reachable"

if $CLEAN_ONLY; then
  ssh_run "docker rm -f smallgods-ci-runner 2>/dev/null; rm -rf /tmp/smallgods-ci-*" || true
  ok "Remote CI dirs removed"
  exit 0
fi

if $HISTORY_ONLY; then
  log "Recent runs:"
  ssh_run "tail -20 $HISTORY_LOG 2>/dev/null" || echo "  (no history yet)"
  exit 0
fi

# ── Upload source ───────────────────────────────────────────────────────────
T_START=$SECONDS
log "Uploading source archive..."
# shellcheck disable=SC2086
git archive --format=tar HEAD | zstd -T0 -1 | \
  ssh $SSH_OPTS "$SSH_HOST" "mkdir -p $REMOTE_DIR && cd $REMOTE_DIR && find . -mindepth 1 -maxdepth 1 ! -name node_modules ! -name .deps.hash -exec rm -rf {} + && zstd -d | tar xf -"
T_UPLOAD=$((SECONDS - T_START))
ok "Source uploaded (${T_UPLOAD}s)"

# ── Dependency install (cached on lockfile hash) ────────────────────────────
LOCAL_HASH=$(sha256sum package-lock.json | cut -d' ' -f1)
REMOTE_HASH=$(ssh_run "cat $REMOTE_HASH_FILE 2>/dev/null" || echo "none")
T_START=$SECONDS
if [ "$LOCAL_HASH" != "$REMOTE_HASH" ]; then
  log "Dependencies changed — running npm ci in container (first run takes a few minutes)..."
  ssh_run "docker run --rm -v $REMOTE_DIR:/app -w /app --cpus=$CPUS -m 4g $NODE_IMAGE npm ci --no-audit --no-fund" \
    || fail "npm ci failed"
  ssh_run "echo '$LOCAL_HASH' > $REMOTE_HASH_FILE"
  T_DEPS=$((SECONDS - T_START))
  ok "Dependencies installed (${T_DEPS}s)"
else
  T_DEPS=0
  ok "Dependency cache hit — skipping npm ci"
fi

# ── Build the runner command ────────────────────────────────────────────────
if [ "$MODE" = "build" ]; then
  RUN_CMD="npm run build"
elif [ -n "$TEST_FILES" ]; then
  RUN_CMD="npx vitest run --maxWorkers=$WORKERS $TEST_FILES"
else
  RUN_CMD="npx vitest run --maxWorkers=$WORKERS"
fi

REMOTE_LOG="$REMOTE_DIR/ci.log"
REMOTE_EXIT="$REMOTE_DIR/ci-exit.code"
REMOTE_WRAPPER="$REMOTE_DIR/.ci-runner.sh"

# Detached runner: survives client SSH drops; exit code lands in a sentinel
# file. flock serializes our own runs; pikkolo CI has its own lock + stack.
WRAPPER_SRC=$(cat <<RUNNER_WRAPPER
#!/usr/bin/env bash
cd "$REMOTE_DIR" || { echo 97 > "$REMOTE_EXIT"; exit 97; }
flock -w 600 /tmp/smallgods-ci.lock \
  timeout $RUNNER_TIMEOUT docker run --rm --name smallgods-ci-runner \
    -v $REMOTE_DIR:/app -w /app --cpus=$CPUS -m 4g \
    -e CI=1 \
    $NODE_IMAGE $RUN_CMD > "$REMOTE_LOG" 2>&1
echo \$? > "$REMOTE_EXIT"
RUNNER_WRAPPER
)

log "Starting detached runner (mode: $MODE, cpus: $CPUS, workers: $WORKERS)..."
T_START=$SECONDS
# shellcheck disable=SC2086
printf '%s\n' "$WRAPPER_SRC" | ssh $SSH_OPTS "$SSH_HOST" \
  "rm -f '$REMOTE_EXIT'; : > '$REMOTE_LOG'; cat > '$REMOTE_WRAPPER' && chmod +x '$REMOTE_WRAPPER' \
   && ( setsid bash '$REMOTE_WRAPPER' >/dev/null 2>&1 </dev/null & ); echo detached" >/dev/null

# ── Poll sentinel + stream log ──────────────────────────────────────────────
set +e
POLL_DEADLINE=$((SECONDS + RUNNER_TIMEOUT + 100))
PRINTED=0
BACKOFF=2
CI_EXIT=""
while [ $SECONDS -lt $POLL_DEADLINE ]; do
  # shellcheck disable=SC2086
  SNAP=$(ssh $SSH_OPTS "$SSH_HOST" \
    "wc -l < '$REMOTE_LOG' 2>/dev/null; printf '\037'; cat '$REMOTE_EXIT' 2>/dev/null; exit 0")
  if [ $? -eq 255 ]; then
    sleep $BACKOFF
    BACKOFF=$(( BACKOFF >= 30 ? 30 : BACKOFF * 2 ))
    continue
  fi
  BACKOFF=2
  TOTAL="${SNAP%%$'\037'*}"; TOTAL="${TOTAL//[^0-9]/}"
  EXITVAL="${SNAP#*$'\037'}"; EXITVAL="${EXITVAL//[^0-9]/}"
  if [ -n "$TOTAL" ] && [ "$TOTAL" -gt "$PRINTED" ]; then
    # shellcheck disable=SC2086
    ssh $SSH_OPTS "$SSH_HOST" "sed -n '$((PRINTED + 1)),${TOTAL}p' '$REMOTE_LOG' 2>/dev/null" \
      && PRINTED=$TOTAL
  fi
  if [ -n "$EXITVAL" ]; then
    # shellcheck disable=SC2086
    FINAL_TOTAL=$(ssh $SSH_OPTS "$SSH_HOST" "wc -l < '$REMOTE_LOG' 2>/dev/null; exit 0")
    FINAL_TOTAL="${FINAL_TOTAL//[^0-9]/}"
    if [ -n "$FINAL_TOTAL" ] && [ "$FINAL_TOTAL" -gt "$PRINTED" ]; then
      # shellcheck disable=SC2086
      ssh $SSH_OPTS "$SSH_HOST" "sed -n '$((PRINTED + 1)),${FINAL_TOTAL}p' '$REMOTE_LOG' 2>/dev/null"
    fi
    CI_EXIT=$EXITVAL
    break
  fi
  sleep 3
done
set -e
T_RUN=$((SECONDS - T_START))

if [ -z "$CI_EXIT" ]; then
  warn "Gave up waiting after ${T_RUN}s — runner may still be going (check with --history / ssh)"
  CI_EXIT=124
fi
[ "$CI_EXIT" -eq 124 ] && warn "Runner timed out (${RUNNER_TIMEOUT}s cap)"

# ── History + result ────────────────────────────────────────────────────────
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
RESULT=$( [ "$CI_EXIT" -eq 0 ] && echo "PASS" || echo "FAIL" )
ssh_run "echo \"\$(date -u +%Y-%m-%dT%H:%M:%SZ) $RESULT run=${T_RUN}s upload=${T_UPLOAD}s deps=${T_DEPS}s $BRANCH_SLUG $COMMIT $MODE\" >> $HISTORY_LOG" 2>/dev/null || true

echo ""
echo "  upload ${T_UPLOAD}s · deps ${T_DEPS}s · $MODE ${T_RUN}s"
if [ "$CI_EXIT" -eq 0 ]; then
  ok "Server CI passed"
else
  fail "Server CI failed (exit $CI_EXIT)"
fi
