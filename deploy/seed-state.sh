#!/usr/bin/env bash
# 一次性（可重复跑，force 覆盖）：把本地 data/jycgs.db 固化为远端 agent-state 分支——云端每轮的状态起点。
# 上线切换前最后跑一次，保证云端从最新本地状态开始。
set -euo pipefail
cd "$(dirname "$0")/.."

node --input-type=module -e "import{DatabaseSync}from'node:sqlite';const d=new DatabaseSync('data/jycgs.db');d.exec('PRAGMA wal_checkpoint(TRUNCATE)');d.close();console.log('✓ WAL 已并入主库')"

git checkout -q -B agent-state-seed
git add -f data/jycgs.db
git -c user.name=jyc-agent -c user.email=jyc-agent@users.noreply.github.com \
  commit -q -m "state: seed $(date -u +%FT%TZ)" || echo "(无变更)"

# 推送：SSH(22) 常被拦，git 直连 TLS 也不稳 —— 失败自动改走 gh token + 本地代理(7897)
GH_HTTPS="https://x-access-token:$(gh auth token)@github.com/seuzxh/jiuyan-hot-news.git"
git push --force origin agent-state-seed:agent-state \
  || git -c http.proxy=http://127.0.0.1:7897 push --force "$GH_HTTPS" agent-state-seed:agent-state

git checkout -q -
git branch -qD agent-state-seed
echo "✓ agent-state 分支已更新（单提交、无历史累积）"
