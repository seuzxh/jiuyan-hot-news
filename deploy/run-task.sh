#!/usr/bin/env bash
# Runtime：创建一个 Session 执行一次任务，SSE 先开后发，轮询历史到 idle。
# 用法：bash deploy/run-task.sh "任务内容"    # 缺省=标准管线轮次
#   WAIT_SECONDS=1800 可调总等待（一轮管线约 10-20 分钟）
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/ids.env

KEY="${ZHIPUAI_API_KEY:-$(cat deploy/.zhipuai-key 2>/dev/null || true)}"
[[ -n "$KEY" ]] || { echo "✗ 缺少智谱 API Key（ZHIPUAI_API_KEY 或 deploy/.zhipuai-key）" >&2; exit 1; }

TASK="${1:-执行本轮韭研热点管线（标准流程）。}"
WAIT_SECONDS="${WAIT_SECONDS:-1800}"
BASE_URL="https://agent-api.bigmodel.cn/api/agent/managed"
H=(-H "Authorization: Bearer $KEY" -H "zai-version: 2026-05-26" -H "zai-beta: managed-agents-2026-09-22")
jget() { node -e "const o=JSON.parse(require('fs').readFileSync(0,'utf8'));const v=($1);process.stdout.write(String(v??''))"; }
api() {
  local method="$1" path="$2" response
  shift 2
  if ! response=$(curl --fail-with-body -sS --connect-timeout 10 --max-time 60 \
    -X "$method" "$BASE_URL$path" "${H[@]}" "$@"); then
    printf 'API failed: %s %s\n%s\n' "$method" "$path" "$response" >&2
    exit 1
  fi
  printf '%s' "$response"
}

# 1. 建 Session（不带 initial_events）
SESSION_ID=$(api POST /v1/sessions -H 'content-type: application/json' \
  -d "{\"agent\":\"$AGENT_ID\",\"environment_id\":\"$ENVIRONMENT_ID\",\"title\":\"jyc $(date +%m%d-%H%M)\"}" \
  | jget 'o.id')
echo "SESSION_ID=$SESSION_ID"

# 2. 先开 SSE（后台留档），再发任务（任务体经 build-json.mjs 转 \uXXXX 纯 ASCII，@file 传输防编码破坏）
mkdir -p deploy/.tmp
run_dir=$(mktemp -d "deploy/.tmp/run.XXXXXX")
echo "Run logs: $run_dir"
SSE_PID=''
cleanup() { [[ -n "$SSE_PID" ]] && { kill "$SSE_PID" 2>/dev/null || true; wait "$SSE_PID" 2>/dev/null || true; }; }
trap cleanup EXIT
: >"$run_dir/stream.headers"
curl --fail-with-body -NsS --connect-timeout 10 --max-time "$((WAIT_SECONDS + 60))" \
  -D "$run_dir/stream.headers" "$BASE_URL/v1/sessions/$SESSION_ID/events/stream" "${H[@]}" \
  >"$run_dir/stream.log" 2>"$run_dir/stream.err" &
SSE_PID=$!
deadline=$((SECONDS + 15))
until grep -qi '^content-type: *text/event-stream' "$run_dir/stream.headers"; do
  if ! kill -0 "$SSE_PID" 2>/dev/null || (( SECONDS >= deadline )); then
    cat "$run_dir/stream.err" >&2; echo "SSE 不可用，任务未发送。SESSION_ID=$SESSION_ID" >&2; exit 1
  fi
  sleep 0.2
done

printf '%s' "$TASK" > deploy/.tmp/task.txt
node deploy/build-json.mjs events deploy/.tmp/task.txt
api POST "/v1/sessions/$SESSION_ID/events" -H 'content-type: application/json' --data-binary @deploy/.tmp/events-body.json >/dev/null
echo "任务已提交，跟踪中（最长 ${WAIT_SECONDS}s）…"

# 3. 轮询历史到 session.status_idle（每 10s；SSE 仅留档）
deadline=$((SECONDS + WAIT_SECONDS))
while :; do
  events=$(api GET "/v1/sessions/$SESSION_ID/events?order=desc&limit=100")
  printf '%s' "$events" >"$run_dir/events.json"
  reason=$(printf '%s' "$events" | jget "(o.data||[]).find(e=>e.type==='session.status_idle')?.stop_reason?.type")
  if [[ -n "$reason" ]]; then
    echo "──── Agent 汇报 ────"
    printf '%s' "$events" | node -e '
      const o=JSON.parse(require("fs").readFileSync(0,"utf8"));
      for (const e of (o.data||[]).filter(x=>x.type==="agent.message").reverse())
        for (const c of e.content||[]) if (c.type==="text") console.log(c.text);'
    echo "──── end · stop_reason=$reason ────"
    [[ "$reason" == "end_turn" ]] || { echo "⚠ 非正常结束，检查 $run_dir/events.json；续查: SESSION_ID=$SESSION_ID" >&2; exit 2; }
    exit 0
  fi
  if (( SECONDS >= deadline )); then
    echo "本地等待超时（云端可能仍在跑）。续查: SESSION_ID=$SESSION_ID · 日志: $run_dir" >&2
    exit 3
  fi
  sleep 10
done
