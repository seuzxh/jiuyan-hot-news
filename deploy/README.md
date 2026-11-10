# 云端部署（智谱 Managed Agents）

把本地 ZCode 定时驱动的管线迁移到智谱 BigModel Managed Agents：Deployment 按 cron 触发，云端 Agent（glm-5.3-flash + 沙箱）每轮克隆仓库、跑管线、把 SQLite 状态回写到 `agent-state` 分支。设计讨论见会话记录；Agent 提示词见 [agent-system.md](agent-system.md)。

## 架构

- **触发**：Deployment cron `0 8,12,20 * * *`（Asia/Shanghai，与原本地任务一致）
- **执行**：云端沙箱（Ubuntu 24.04 / Node 22 / git 预装，出站 443）→ clone main → 从 `agent-state` 分支恢复 `data/jycgs.db` → `npm ci` → 依序跑 7 个阶段（LLM 直调，无 handoff）→ WAL checkpoint → force push 单提交回 `agent-state`
- **凭据**：`deploy/secrets.env`（飞书 webhook + GLM key）随私有仓库分发；GitHub PAT 注入 Agent 系统提示词（克隆引导用）
- **计费**：按量（不支持 Coding Plan 套餐），账号需有余额

## 一次性配置

1. **凭据三件套**（均不进对话/日志）：
   - 智谱 API Key → 环境变量 `ZHIPUAI_API_KEY` 或写入 `deploy/.zhipuai-key`（单行）
   - GitHub fine-grained PAT（仅 jiuyan-hot-news，contents 读写）→ `deploy/.github-token`（单行）
   - `cp deploy/secrets.env.example deploy/secrets.env` 填好后 **提交推送**（私有仓库）
2. `bash deploy/seed-state.sh` —— 固化当前本地数据库为 `agent-state` 起点
3. `bash deploy/setup.sh` —— 创建 Environment + Agent，ID 存 `deploy/ids.env`

## 验证与上线

```bash
# ① 冒烟：只跑 clone/依赖/crawl/prefilter，不推送不回写（验证反爬、Node 版本、npm ci）
bash deploy/run-task.sh "冒烟测试：执行标准流程第 1、2 步，然后运行 npm run crawl 和 npm run prefilter，汇报 node 版本、抓取/新增数字与异常；不要运行 score 及之后阶段，不要执行第 4 步回写，不要推送飞书。"

# ② 全流程试跑一轮（会真实推送飞书增量、真实回写状态）
bash deploy/run-task.sh

# ③ 通过后：上线 + 停本地（避免双推）
bash deploy/create-deployment.sh   # 建 cron Deployment
# 并在 ZCode 里暂停本地定时任务（automation-43054d47-936c-48d3-99d5-cb4abc16ce6c）
```

## 运维

- 查运行记录：`GET /v1/deployment_runs?deployment_id=<id>`（带 zai-version/zai-beta 头）；单轮详情/产物：`GET /v1/sessions/:id/events`、`GET /v1/files?scope_id=<session_id>`
- 改 Agent 提示词：编辑 `agent-system.md` 后清空 `deploy/ids.env` 的 `AGENT_ID=` 重跑 `setup.sh`（会新建版本/新 Agent），再更新 Deployment 的 agent 引用
- 回滚状态：`agent-state` 每轮单提交覆盖，历史不可回溯；需要时本地 `git push --force` 旧库覆盖
- 已知风险：韭研公社对云 IP 的风控（冒烟测试验证）；git 历史不累积所以无膨胀问题
