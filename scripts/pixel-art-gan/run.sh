#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Small Gods — Pixel Art GAN: push to Kaggle, wait, download model
#
# Usage:
#   ./run.sh setup           # install kaggle CLI, prompt for API token
#   ./run.sh push            # push kernel to Kaggle and start GPU run
#   ./run.sh status          # check if run is complete
#   ./run.sh download        # download generator.onnx + generator_int8.onnx
#   ./run.sh all             # push → wait → download in one shot
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

KERNEL_DIR="$(cd "$(dirname "$0")" && pwd)"
KERNEL_ID_FILE="$KERNEL_DIR/.kernel_id"
OUTPUT_DIR="$KERNEL_DIR/output"
POLL_INTERVAL=30   # seconds between status checks

# ── Helpers ──────────────────────────────────────────────────────────────────

die()  { echo "ERROR: $*" >&2; exit 1; }
info() { echo "▶ $*"; }

require_kaggle() {
    command -v kaggle &>/dev/null || die "kaggle CLI not found. Run: ./run.sh setup"
    [[ -f ~/.kaggle/kaggle.json ]] || die "~/.kaggle/kaggle.json not found. Run: ./run.sh setup"
}

kernel_id() {
    [[ -f "$KERNEL_ID_FILE" ]] || die "No kernel ID found. Run: ./run.sh push first"
    cat "$KERNEL_ID_FILE"
}

# ── Commands ─────────────────────────────────────────────────────────────────

cmd_setup() {
    info "Installing kaggle CLI..."
    pip install --quiet --upgrade kaggle onnxruntime

    echo ""
    echo "Next: generate your Kaggle API token"
    echo "  1. Go to https://www.kaggle.com/settings"
    echo "  2. Scroll to 'API' section → click 'Create New Token'"
    echo "  3. This downloads kaggle.json"
    echo ""
    read -rp "Paste the path to your downloaded kaggle.json: " TOKEN_PATH
    TOKEN_PATH="${TOKEN_PATH/#\~/$HOME}"
    [[ -f "$TOKEN_PATH" ]] || die "File not found: $TOKEN_PATH"

    mkdir -p ~/.kaggle
    cp "$TOKEN_PATH" ~/.kaggle/kaggle.json
    chmod 600 ~/.kaggle/kaggle.json

    # Extract and update kernel-metadata.json with real username
    KAGGLE_USER=$(python3 -c "import json; d=open('$HOME/.kaggle/kaggle.json').read(); print(json.loads(d)['username'])")
    METADATA="$KERNEL_DIR/kernel-metadata.json"
    # Replace placeholder USERNAME with real username
    sed -i.bak "s/USERNAME/$KAGGLE_USER/g" "$METADATA" && rm "${METADATA}.bak"

    info "Setup complete. Username: $KAGGLE_USER"
    info "Kernel ID will be: $KAGGLE_USER/small-gods-pixel-art-gan"
}

cmd_push() {
    require_kaggle

    # Read kernel id from metadata and save it
    KAGGLE_USER=$(python3 -c "import json; d=open('$HOME/.kaggle/kaggle.json').read(); print(json.loads(d)['username'])")
    KID="$KAGGLE_USER/small-gods-pixel-art-gan"
    echo "$KID" > "$KERNEL_ID_FILE"

    info "Pushing kernel: $KID"
    kaggle kernels push -p "$KERNEL_DIR"

    info "Kernel pushed. Run './run.sh status' to check progress."
    info "Or run './run.sh all' to wait and auto-download when done."
    echo ""
    echo "  Watch online: https://www.kaggle.com/$KID"
}

cmd_status() {
    require_kaggle
    KID=$(kernel_id)
    STATUS=$(kaggle kernels status "$KID" 2>&1)
    echo "$STATUS"
    # Extract just the status word for scripting
    echo "$STATUS" | grep -oE '"(running|complete|error|queued|cancelAcknowledged)"' | tr -d '"' || true
}

cmd_wait() {
    require_kaggle
    KID=$(kernel_id)
    info "Polling status of $KID every ${POLL_INTERVAL}s..."
    while true; do
        RAW=$(kaggle kernels status "$KID" 2>&1)
        STATE=$(echo "$RAW" | grep -oE '"(running|complete|error|queued|cancelAcknowledged)"' | tr -d '"' || echo "unknown")
        TIMESTAMP=$(date '+%H:%M:%S')
        echo "  [$TIMESTAMP] $STATE"
        case "$STATE" in
            complete)
                info "Kernel finished successfully."
                return 0
                ;;
            error|cancelAcknowledged)
                echo "$RAW"
                die "Kernel ended with state: $STATE"
                ;;
        esac
        sleep "$POLL_INTERVAL"
    done
}

cmd_download() {
    require_kaggle
    KID=$(kernel_id)
    mkdir -p "$OUTPUT_DIR"
    info "Downloading outputs from $KID → $OUTPUT_DIR"
    kaggle kernels output "$KID" -p "$OUTPUT_DIR"

    echo ""
    echo "Downloaded files:"
    ls -lh "$OUTPUT_DIR"/*.onnx 2>/dev/null || echo "  (no .onnx files found yet)"
    ls -lh "$OUTPUT_DIR"/*.pt   2>/dev/null || echo "  (no .pt checkpoints found)"
}

cmd_all() {
    cmd_push
    echo ""
    cmd_wait
    echo ""
    cmd_download
    echo ""
    info "All done. Your model is in: $OUTPUT_DIR"
}

# ── Dispatch ─────────────────────────────────────────────────────────────────

COMMAND="${1:-help}"
case "$COMMAND" in
    setup)    cmd_setup ;;
    push)     cmd_push ;;
    status)   cmd_status ;;
    wait)     cmd_wait ;;
    download) cmd_download ;;
    all)      cmd_all ;;
    *)
        echo "Usage: $0 {setup|push|status|wait|download|all}"
        echo ""
        echo "  setup     Install kaggle CLI and configure API token"
        echo "  push      Push training script to Kaggle and start GPU run"
        echo "  status    Check current kernel run status"
        echo "  wait      Poll until run completes"
        echo "  download  Download generator.onnx and checkpoints"
        echo "  all       Push + wait + download in one shot"
        ;;
esac
