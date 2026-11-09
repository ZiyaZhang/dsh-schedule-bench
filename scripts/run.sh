#!/usr/bin/env bash
# Runs the bench tasks against two DSH checkouts, one run at a time.
#
# Usage: scripts/run.sh <run-id> [task:label ...]
#   default order: t1:old t1:new t2:new t2:old t3:old t3:new t4:new t4:old
# Environment:
#   BENCH_OLD, BENCH_NEW  absolute paths of the two built checkouts (pnpm install && pnpm run build:artifacts)
#   BENCH_ENV_FILE        file with DEEPSEEK_API_KEY (and optionally DEEPSEEK_BASE_URL); read only for t2
#   BENCH_BASE_URL        overrides DEEPSEEK_BASE_URL for t2
#   BENCH_SAMPLES         t2 samples per run (default 5)
#   BENCH_NODE_BIN        directory holding node >= 24 and pnpm (default: first on PATH)
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
run_id="${1:?run id required}"
shift || true
order=("$@")
if [ ${#order[@]} -eq 0 ]; then order=(t1:old t1:new t2:new t2:old t3:old t3:new t4:new t4:old); fi
out_dir="$root/results/$run_id"
mkdir -p "$out_dir/logs"
if [ -n "${BENCH_NODE_BIN:-}" ]; then export PATH="$BENCH_NODE_BIN:$PATH"; fi

for item in "${order[@]}"; do
  task="${item%%:*}"
  label="${item##*:}"
  case "$label" in
    old) checkout="${BENCH_OLD:?}" ;;
    new) checkout="${BENCH_NEW:?}" ;;
    *) echo "unknown label $label" >&2; exit 2 ;;
  esac
  commit="$(git -C "$checkout" rev-parse HEAD)"
  cp "$root/bench/sched-bench.e2e.ts" "$checkout/apps/web/tests/sched-bench.e2e.ts"
  log="$out_dir/logs/$task-$label.log"
  echo "$(date -u +%FT%TZ) start $task $label ${commit:0:11}"
  (
    cd "$checkout"
    unset DSH_SNAPSHOT DEEPSEEK_API_KEY DEEPSEEK_BASE_URL
    export BENCH_TASK="$task" BENCH_LABEL="$label" BENCH_COMMIT="$commit"
    export BENCH_OUT="$out_dir/$task-$label.json" BENCH_FIXTURES="$root/tasks/t2-morning"
    if [ "$task" = "t2" ]; then
      set -a
      # shellcheck disable=SC1090
      . "${BENCH_ENV_FILE:?t2 needs BENCH_ENV_FILE}"
      set +a
      if [ -n "${BENCH_BASE_URL:-}" ]; then export DEEPSEEK_BASE_URL="$BENCH_BASE_URL"; fi
      export DSH_SNAPSHOT=record
      unset HTTPS_PROXY HTTP_PROXY ALL_PROXY https_proxy http_proxy all_proxy
      export NO_PROXY="*" no_proxy="*"
    fi
    pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/sched-bench.e2e.ts > "$log" 2>&1
  ) && status=ok || status=failed
  # A copy left in apps/web/tests breaks the checkout's next build:artifacts (the Web client compiler picks it up).
  rm -f "$checkout/apps/web/tests/sched-bench.e2e.ts"
  echo "$(date -u +%FT%TZ) end   $task $label $status"
done
