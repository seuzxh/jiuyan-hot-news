# 每日热点定时推送

## 描述
通过 GitHub Action 功能，每天定时调用 Coze 工作流，并将工作流获取的热点板块内容推送至飞书。

## 功能特性

- ✅ 每日定时推送（北京时间 8:00、12:00、20:00）
- ✅ 调用 Coze 热点资讯工作流 API
- ✅ 智能格式化消息内容（飞书卡片格式）
- ✅ 推送至飞书 webhook 机器人
- ✅ 支持多种工作流输出格式（Markdown 表格和结构化 JSON）

## 项目结构

```
jiuyan-hot-news/
├── .github/workflows/
│   └── daily-hot-news.yml    # GitHub Action 工作流配置
├── scripts/
│   ├── coze_api.js          # Coze API 调用脚本
│   ├── feishu_push.js       # 飞书推送脚本
│   └── main.js              # 主执行脚本
├── package.json             # Node.js 项目配置
├── .env.example             # 环境变量示例
└── README.md                # 项目说明文档
```

## 定时执行时间

| 时段 | UTC 时间 | 北京时间 |
|------|----------|----------|
| 早上 | 0:00 | 8:00 |
| 中午 | 4:00 | 12:00 |
| 晚上 | 12:00 | 20:00 |

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/username/jiuyan-hot-news.git
cd jiuyan-hot-news
```

### 2. 配置环境变量

复制环境变量示例文件：
```bash
cp .env.example .env
```

编辑 `.env` 文件，填入真实配置：
```env
COZE_API_TOKEN=your_coze_api_token_here
COZE_WORKFLOW_ID=7554238030879113267
FEISHU_WEBHOOK_URL=your_feishu_webhook_url_here
```

### 3. 本地测试

安装依赖：
```bash
npm install
```

运行推送：
```bash
node scripts/main.js
```

## 环境变量说明

| 变量名 | 必需 | 说明 | 默认值 |
|--------|------|------|--------|
| `COZE_API_TOKEN` | 是 | Coze API 访问令牌 | - |
| `COZE_WORKFLOW_ID` | 是 | Coze 工作流 ID | 7554238030879113267 |
| `FEISHU_WEBHOOK_URL` | 是 | 飞书 webhook 地址 | - |
| `SEND_ERROR_NOTIFICATION` | 否 | 是否发送错误通知 | false |

## 许可证

MIT License
