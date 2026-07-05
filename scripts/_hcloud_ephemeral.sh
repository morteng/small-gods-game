#!/usr/bin/env bash
# NOTE: canonical copy lives in pikkolo-cms-mvp/scripts/_hcloud_ephemeral.sh.
# Keep the two in sync when the lifecycle changes (this is a verbatim copy so
# small-gods and pikkolo share the SAME `ci-eph` box + queue lock).
#
# _hcloud_ephemeral.sh — ONE shared Hetzner Cloud box for off-box CI + image
# builds (infra consolidation Phase 1, Option A: nothing heavy runs on the 8 GB
# prod box).
#
# Design (user decision 2026-07-05): a SINGLE box named `ci-eph` serves ALL
# projects — pikkolo build, pikkolo CI, small-gods CI, amp later — which QUEUE on
# it via a lock. Rationale: Hetzner bills per hour, so one box amortized across
# parallel work is cheaper than N boxes each triggering their own hourly charge.
# The queue cost (a few minutes' wait) is the accepted trade.
#
# Lifecycle:
#   eph_ensure           reuse the healthy `ci-eph`, or create it. NO teardown.
#   eph_push_tree S D    ship a git tree to a per-project dir on the box.
#   eph_queued_script    run a script (stdin) under the box's queue lock, so all
#                        projects serialize; refreshes the activity marker.
#   eph_reap_if_idle N   (Mac-side, via launchd) delete `ci-eph` iff the queue
#                        lock is FREE and idle > N min. This stops the hourly bill.
#
# Teardown is owned by the Mac-side reaper, NOT a per-run trap: the box is shared,
# so one run finishing must never delete a box another run is queued on. The held
# queue lock is the "busy" signal, so NO Hetzner API token ever lives on the box —
# a compromised build cannot reach prod.
set -euo pipefail

# ── Config (env-overridable) ────────────────────────────────────────────────
EPH_NAME="${EPH_NAME:-ci-eph}"                     # FIXED, shared across all projects
EPH_IMAGE="${EPH_IMAGE:-ubuntu-24.04}"             # base image (snapshot id overrides later)
EPH_SSH_KEY_NAME="${EPH_SSH_KEY_NAME:-hetzner-navomat}"  # key registered in the project (== ~/.ssh/hetzner_ed25519)
EPH_SSH_KEY_FILE="${EPH_SSH_KEY_FILE:-$HOME/.ssh/hetzner_ed25519}"
EPH_LABEL="role=ci-eph"
EPH_QUEUE_LOCK="${EPH_QUEUE_LOCK:-/tmp/hetzner-ci.lock}"  # SHARED with ci-on-server.sh (both repos) — the queue + busy signal
EPH_ACTIVITY="${EPH_ACTIVITY:-/tmp/ci-eph.activity}"      # on the box; mtime = last time the box was in use
EPH_SSH_OPTS="-i $EPH_SSH_KEY_FILE -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=4"
EPH_IP=""   # set by eph_ensure / eph_reap_if_idle

_eph_log()  { printf '\033[36m[eph]\033[0m %s\n' "$*" >&2; }
_eph_warn() { printf '\033[33m[eph] WARN:\033[0m %s\n' "$*" >&2; }

# cloud-init: install Docker on a fresh Ubuntu box. A pre-baked snapshot that
# already has Docker makes this a fast no-op (create <60 s); we detect readiness
# by probing `docker info`, not by branching on image type.
_eph_cloud_init() {
  cat <<'CLOUDINIT'
#cloud-config
package_update: true
packages: [docker.io, docker-compose-v2, zstd]   # compose v2 plugin: CI stages use `docker compose`
runcmd:
  - systemctl enable --now docker
CLOUDINIT
}

# eph_ssh <cmd...> — run a command on the shared box (EPH_IP must be set).
eph_ssh() { ssh $EPH_SSH_OPTS "root@$EPH_IP" "$@"; }

# _eph_healthy <ip> — true if ssh is up and docker responds.
_eph_healthy() { ssh $EPH_SSH_OPTS "root@$1" 'docker info >/dev/null 2>&1'; }

# eph_ensure — set EPH_IP to a ready shared `ci-eph`. Reuse if healthy; else
# (re)create. Race-safe via the FIXED name: a duplicate create errors and we fall
# back to reusing whatever now exists.
eph_ensure() {
  local ip
  ip=$(hcloud server ip "$EPH_NAME" 2>/dev/null || true)
  if [ -n "$ip" ]; then
    if _eph_healthy "$ip"; then
      EPH_IP="$ip"; _eph_log "reusing $EPH_NAME ($EPH_IP)"
      eph_ssh "touch $EPH_ACTIVITY" 2>/dev/null || true   # mark in-use so the reaper backs off
      return 0
    fi
    _eph_warn "$EPH_NAME exists but unhealthy — recreating"
    hcloud server delete "$EPH_NAME" >/dev/null 2>&1 || true
  fi

  # Try each type across each location; the `if` context suppresses set -e so a
  # `resource_unavailable` miss falls through. cx53 -> cx43 -> cx33 degrades build
  # speed gracefully; all are vCPU-plenty.
  local types locations t l created=0
  IFS=' ' read -ra types     <<< "${EPH_TYPES:-cx53 cx43 cx33}"
  IFS=' ' read -ra locations <<< "${EPH_LOCATIONS:-fsn1 nbg1 hel1}"
  for t in "${types[@]}"; do
    for l in "${locations[@]}"; do
      _eph_log "creating $EPH_NAME ($t / $EPH_IMAGE @ $l)..."
      if hcloud server create --name "$EPH_NAME" --type "$t" --image "$EPH_IMAGE" \
          --location "$l" --ssh-key "$EPH_SSH_KEY_NAME" --label "$EPH_LABEL" \
          --user-data-from-file <(_eph_cloud_init) >/dev/null 2>&1; then
        created=1; break 2
      fi
      ip=$(hcloud server ip "$EPH_NAME" 2>/dev/null || true)
      if [ -n "$ip" ]; then _eph_warn "$EPH_NAME appeared concurrently — reusing"; created=1; break 2; fi
      _eph_warn "$t @ $l unavailable — trying next"
    done
  done
  [ "$created" = 1 ] || { _eph_warn "no capacity for [${types[*]}] in [${locations[*]}]"; return 1; }

  EPH_IP=$(hcloud server ip "$EPH_NAME")
  _eph_log "$EPH_NAME ip $EPH_IP; waiting for ssh + docker..."
  local i
  for i in $(seq 1 60); do
    if _eph_healthy "$EPH_IP"; then
      eph_ssh "touch $EPH_ACTIVITY" 2>/dev/null || true   # mark in-use so the reaper backs off
      _eph_log "ready (${i}0s)"; return 0
    fi
    sleep 10
  done
  _eph_warn "$EPH_NAME never became ready"
  return 1
}

# eph_push_tree <local-dir> <remote-dir> — ship a git tree (HEAD) to a
# per-project dir via zstd tar over one ssh. Not under the queue lock — distinct
# project dirs don't collide, and the heavy build that follows takes the lock.
eph_push_tree() {
  local src="$1" dst="$2"
  eph_ssh "mkdir -p '$dst'"
  git -C "$src" archive --format=tar HEAD | zstd -q | eph_ssh "cd '$dst' && zstd -d | tar xf -"
}

# eph_queued_script — read a shell script from stdin and run it on the box under
# the shared queue lock, so ALL projects serialize on the one box. Touches the
# activity marker at the start (inside the lock) so the reaper measures idle from
# job start; the held lock keeps the reaper off a running job regardless.
eph_queued_script() {
  { printf 'touch %s\n' "$EPH_ACTIVITY"; cat; } \
    | eph_ssh "flock $EPH_QUEUE_LOCK bash -s"
}

# eph_reap_if_idle <minutes> — Mac-side teardown. Delete `ci-eph` iff the queue
# lock is FREE (no job running/queued) AND idle > <minutes>. No-op if gone/busy.
# Intended to run from a launchd timer every few minutes.
eph_reap_if_idle() {
  local mins="${1:-15}" ip age
  ip=$(hcloud server ip "$EPH_NAME" 2>/dev/null || true)
  [ -z "$ip" ] && { _eph_log "no $EPH_NAME to reap"; return 0; }
  EPH_IP="$ip"
  if ! eph_ssh "flock -n $EPH_QUEUE_LOCK -c true" >/dev/null 2>&1; then
    _eph_log "$EPH_NAME busy (queue lock held) — not reaping"; return 0
  fi
  # A missing marker means a box mid-setup (eph_ensure hasn't stamped it yet) OR
  # a stray box we've never seen. Don't reap on this poll — stamp "first seen now"
  # and keep it; a genuinely idle box then ages out on later polls, while a box
  # that's actively being set up gets its real stamp from eph_ensure momentarily.
  age=$(eph_ssh "if [ -f $EPH_ACTIVITY ]; then echo \$(( \$(date +%s) - \$(stat -c %Y $EPH_ACTIVITY) )); else touch $EPH_ACTIVITY; echo 0; fi" 2>/dev/null || echo 0)
  if [ "${age:-0}" -ge "$((mins * 60))" ]; then
    _eph_log "$EPH_NAME idle ${age}s (>= ${mins}m) — destroying"
    hcloud server delete "$EPH_NAME" >/dev/null 2>&1 && _eph_log "destroyed $EPH_NAME"
  else
    _eph_log "$EPH_NAME idle ${age}s (< ${mins}m) — keeping"
  fi
}

# eph_destroy — force teardown now (manual/emergency).
eph_destroy() {
  if hcloud server delete "$EPH_NAME" >/dev/null 2>&1; then _eph_log "destroyed $EPH_NAME"; else _eph_log "no $EPH_NAME to destroy"; fi
}
