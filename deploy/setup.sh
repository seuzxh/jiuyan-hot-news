#!/usr/bin/env bash
# 一次性 Setup：创建/复用 Environment 与云端 Agent，ID 保存到 deploy/ids.env（本地文件，不入库）。
# 用法：bash deploy/setup.sh
# 前置：ZHIPUAI_API_KEY 环境变量或 deploy/.zhipuai-key 文件；deploy/.github-token 文件（fine-grained PAT）
set -euo pipefail
cd "$(dirname "$0")/.."

KEY="${ZHIPUAI_API_KEY:-$(cat deploy/.zhipuai-key 2>/dev/null || true)}"
[[ -n "$KEY" ]] || { echo "✗ 缺少智谱 API Key：设置 ZHIPUAI_API_KEY，或写入 deploy/.zhipuai-key（单行，勿提交）" >&2; exit 1; }
GTOKEN="$(cat deploy/.github-token 2>/dev/null || true)"
[[ -n "$GTOKEN" ]] || { echo "✗ 缺少 GitHub 令牌：写入 deploy/.github-token（fine-grained PAT，仅 jiuyan-hot-news 仓库 contents 读写）" >&2; exit 1; }

BASE_URL="https://agent-api.bigmodel.cn/api/agent/managed"
H=(-H "Authorization: Bearer $KEY" -H "zai-version: 2026-05-26" -H "zai-beta: managed-agents-2026-09-22")

# node 做 JSON 提取/构造（Git Bash 无 jq；项目必有 node）
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

# ---- Environment：按名复用，无则新建 ----
ENVIRONMENT_ID=""
if [[ -f deploy/ids.env ]]; then source deploy/ids.env; fi
if [[ -z "${ENVIRONMENT_ID:-}" ]]; then
  ENVIRONMENT_ID=$(api GET '/v1/environments?limit=100' \
    | jget "((o.data||[]).find(e=>e.name==='jyc-pipeline-env'&&!e.archived_at)||{}).id")
fi
if [[ -z "$ENVIRONMENT_ID" ]]; then
  echo "→ 创建 Environment: jyc-pipeline-env (cloud / unrestricted)"
  ENVIRONMENT_ID=$(api POST /v1/environments -H 'content-type: application/json' \
    -d '{"name":"jyc-pipeline-env","config":{"type":"cloud","networking":{"type":"unrestricted"}}}' \
    | jget 'o.id')
else
  echo "→ 复用 Environment: $ENVIRONMENT_ID"
fi

# ---- Agent：ids.env 里已有则更新提示词，否则新建（body 由 build-json.mjs 生成，纯 ASCII + @file 传输，防编码破坏） ----
node deploy/build-json.mjs agent
if [[ -z "${AGENT_ID:-}" ]]; then
  echo "→ 创建 Agent: jyc-hot-news-pipeline (glm-5.3-flash + agent_toolset_20260601)"
  AGENT_ID=$(api POST /v1/agents -H 'content-type: application/json' --data-binary @deploy/.tmp/agent-body.json | jget 'o.id')
else
  echo "→ 更新 Agent: $AGENT_ID 的系统提示词"
  api POST "/v1/agents/$AGENT_ID" -H 'content-type: application/json' --data-binary @deploy/.tmp/agent-body.json >/dev/null
fi

printf 'ENVIRONMENT_ID=%s\nAGENT_ID=%s\n' "$ENVIRONMENT_ID" "$AGENT_ID" > deploy/ids.env
echo "✓ Setup 完成 → deploy/ids.env"
echo "  下一步: bash deploy/run-task.sh \"<任务>\"  # 冒烟测试"
