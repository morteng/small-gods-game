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
# Heavy asset / geometry generation on the box (the Pages deploy stays on the
# free GitHub Actions workflow — this is only for jobs too big for a 2-core
# Actions runner):
#   ./scripts/ci-on-server.sh --run="npx tsx scripts/building-preview.ts cottage --both"
#   ./scripts/ci-on-server.sh --run="npx tsx scripts/barrier-world-preview.ts" --out=.dev-grabs
#   ./scripts/ci-on-server.sh --run="node scripts/generate-painted-map.js ..." --env=.env.assets
#     --run="CMD"   run ANY command in the node container on ci-eph
#     --out=DIR     tar this output dir back to the Mac after success (default .dev-grabs)
#     --env=FILE    KEY=VAL file injected into the container (FAL_KEY, REPLICATE_*);
#                   written 0600 on the box and deleted right after the run
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
RUN_CUSTOM=""
OUT_DIR=""
ENV_FILE=""

for arg in "$@"; do
  case $arg in
    --files=*)   TEST_FILES="${arg#*=}" ;;
    --build)     MODE="build" ;;
    --run=*)     MODE="run"; RUN_CUSTOM="${arg#*=}" ;;
    --out=*)     OUT_DIR="${arg#*=}" ;;
    --env=*)     ENV_FILE="${arg#*=}" ;;
    --workers=*) WORKERS="${arg#*=}" ;;
    --cpus=*)    CPUS="${arg#*=}" ;;
    --clean)     CLEAN_ONLY=true ;;
    --history)   HISTORY_ONLY=true ;;
    -h|--help)   sed -n '6,30p' "$0"; exit 0 ;;
    *)           fail "Unknown flag: $arg" ;;
  esac
done

# --run needs a command; default its retrieval dir to the preview scratch dir.
if [ "$MODE" = "run" ]; then
  [ -n "$RUN_CUSTOM" ] || fail "--run requires a command, e.g. --run=\"npx tsx scripts/building-preview.ts cottage\""
  [ -n "$OUT_DIR" ] || OUT_DIR=".dev-grabs"
fi
[ -n "$ENV_FILE" ] && [ ! -f "$ENV_FILE" ] && fail "--env file not found: $ENV_FILE"

# ── Route CI to the shared ephemeral ci-eph box ─────────────────────────────
# small-gods has NO prod dependencies (tests, vite build, and asset/geometry
# generation all run in a node container), so ALL runs go to the shared
# `ci-eph` box that pikkolo + small-gods queue on
# via /tmp/hetzner-ci.lock — keeping the 8 GB prod box free. A Mac-side reaper
# (in the pikkolo repo) tears the box down when it's idle + unlocked. Override
# with CI_RUNNER=prod. Util modes (--clean/--history) attach to the box only if
# it already exists; they never spin one up.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CI_RUNNER="${CI_RUNNER:-auto}"
if [ "$CI_RUNNER" != prod ]; then
  # shellcheck source=./_hcloud_ephemeral.sh
  source "$SCRIPT_DIR/_hcloud_ephemeral.sh"
  if $CLEAN_ONLY || $HISTORY_ONLY; then
    _eph_ip=$(hcloud server ip "$EPH_NAME" 2>/dev/null || true)
    if [ -n "$_eph_ip" ]; then
      SSH_HOST="root@$_eph_ip"
      SSH_OPTS="$SSH_OPTS -o UserKnownHostsFile=/dev/null"
    fi
  elif eph_ensure; then
    SSH_HOST="root@$EPH_IP"
    # Ephemeral IPs get reused across boxes → skip host-key pinning for them.
    SSH_OPTS="$SSH_OPTS -o UserKnownHostsFile=/dev/null"
    ok "CI on shared ci-eph box ($EPH_IP) — prod untouched"
  else
    warn "ci-eph unavailable — falling back to $SSH_HOST for CI"
  fi
fi

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
elif [ "$MODE" = "run" ]; then
  RUN_CMD="$RUN_CUSTOM"
elif [ -n "$TEST_FILES" ]; then
  RUN_CMD="npx vitest run --maxWorkers=$WORKERS $TEST_FILES"
else
  RUN_CMD="npx vitest run --maxWorkers=$WORKERS"
fi

REMOTE_LOG="$REMOTE_DIR/ci.log"
REMOTE_EXIT="$REMOTE_DIR/ci-exit.code"
REMOTE_WRAPPER="$REMOTE_DIR/.ci-runner.sh"
REMOTE_CMD="$REMOTE_DIR/.ci-cmd.sh"    # the command runs from a FILE so &&/quotes/pipes survive
REMOTE_ENV="$REMOTE_DIR/.ci.env"       # optional secrets (--env); deleted by the wrapper after the run
ENV_ARG=""
[ -n "$ENV_FILE" ] && ENV_ARG="--env-file /app/.ci.env"

# Ship the command as a file (never interpolate it into the wrapper — a `&&`
# would otherwise break OUT of the docker run) plus any secrets env-file.
printf '%s\n' "$RUN_CMD" | ssh_run "cat > '$REMOTE_CMD'"
if [ -n "$ENV_FILE" ]; then
  # umask 077 so the secrets file lands 0600 on the shared box.
  ssh_run "umask 077; cat > '$REMOTE_ENV'" < "$ENV_FILE"
fi

# Detached runner: survives client SSH drops; exit code lands in a sentinel
# file. Shared server-wide lock (/tmp/hetzner-ci.lock) so only one heavy CI
# runner uses the 4-vCPU box at a time ACROSS projects (pikkolo + small-gods),
# not just small-gods branches. -w 2400 so a queued run outwaits the other
# project's full run instead of flock timing out and faking a failure. The
# secrets env-file is removed the instant the container exits, pass or fail.
WRAPPER_SRC=$(cat <<RUNNER_WRAPPER
#!/usr/bin/env bash
cd "$REMOTE_DIR" || { echo 97 > "$REMOTE_EXIT"; exit 97; }
flock -w 2400 /tmp/hetzner-ci.lock \
  timeout $RUNNER_TIMEOUT docker run --rm --name smallgods-ci-runner \
    -v $REMOTE_DIR:/app -w /app --cpus=$CPUS -m 4g \
    -e CI=1 ${ENV_ARG} \
    $NODE_IMAGE bash /app/.ci-cmd.sh > "$REMOTE_LOG" 2>&1
ec=\$?
rm -f "$REMOTE_ENV"
echo \$ec > "$REMOTE_EXIT"
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

# ── Retrieve generated output (--run) ───────────────────────────────────────
# Ephemeral box is reaped, so anything a generation job produced has to come
# back here. tar the output dir over one ssh; extract into the local repo
# (overwrites the local copy of that dir — .dev-grabs is scratch; a committed
# asset dir you then review + commit).
if [ "$CI_EXIT" -eq 0 ] && [ "$MODE" = "run" ] && [ -n "$OUT_DIR" ]; then
  if ssh_run "test -d '$REMOTE_DIR/$OUT_DIR'"; then
    log "Fetching $OUT_DIR from ci-eph..."
    # shellcheck disable=SC2086
    if ssh $SSH_OPTS "$SSH_HOST" "cd '$REMOTE_DIR' && tar c '$OUT_DIR' | zstd -T0 -1" | zstd -d | tar x; then
      ok "Fetched $OUT_DIR → $(pwd)/$OUT_DIR"
    else
      warn "Failed to fetch $OUT_DIR from the box"
    fi
  else
    warn "No $OUT_DIR/ on the box — the job produced nothing to fetch"
  fi
fi

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
