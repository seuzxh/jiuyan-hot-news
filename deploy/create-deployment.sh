#!/usr/bin/env bash
# 上线步骤（试跑通过后执行）：创建定时 Deployment，每日 08:00/12:00/20:00（北京时间）各跑一轮标准流程。
# 用法：bash deploy/create-deployment.sh
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/ids.env

KEY="${ZHIPUAI_API_KEY:-$(cat deploy/.zhipuai-key 2>/dev/null || true)}"
[[ -n "$KEY" ]] || { echo "✗ 缺少智谱 API Key（ZHIPUAI_API_KEY 或 deploy/.zhipuai-key）" >&2; exit 1; }

BASE_URL="https://agent-api.bigmodel.cn/api/agent/managed"
H=(-H "Authorization: Bearer $KEY" -H "zai-version: 2026-05-26" -H "zai-beta: managed-agents-2026-09-22")

DEPLOYMENT_ID=$(curl --fail-with-body -sS --connect-timeout 10 --max-time 60 \
  -X POST "$BASE_URL/v1/deployments" "${H[@]}" -H 'content-type: application/json' -d '{
  "name": "jyc-daily-3rounds",
  "agent": "'"$AGENT_ID"'",
  "environment_id": "'"$ENVIRONMENT_ID"'",
  "schedule": {"type": "cron", "expression": "0 8,12,20 * * *", "timezone": "Asia/Shanghai"},
  "initial_events": [{"type": "user.message", "content": [{"type": "text", "text": "执行本轮韭研热点管线（标准流程）。"}]}]
}' | node -e "const o=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(o.id)")

echo "✓ Deployment 已创建: $DEPLOYMENT_ID（cron 0 8,12,20 * * * Asia/Shanghai）"
echo "  提醒：暂停本地 ZCode 定时任务，避免双推。运行记录: GET $BASE_URL/v1/deployment_runs?deployment_id=$DEPLOYMENT_ID"
