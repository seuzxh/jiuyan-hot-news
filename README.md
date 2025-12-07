# 每日热点定时推送

通过GitHub Action功能，每天定时调用Coze工作流，并将工作流获取的热点板块内容推送至飞书。

## 功能特性

- ✅ 定时自动执行（每2小时）
- ✅ 调用Coze热点资讯工作流API
- ✅ 智能格式化消息内容
- ✅ 推送至飞书webhook机器人
- ✅ 完整的错误处理和日志记录
- ✅ 支持测试模式

## 项目结构

```
Jiuyan_Hot_News/
├── .github/workflows/
│   └── daily-hot-news.yml    # GitHub Action工作流配置
├── scripts/
│   ├── coze_api.js          # Coze API调用脚本
│   ├── feishu_push.js       # 飞书推送脚本
│   └── main.js              # 主执行脚本
├── tasks.json               # 任务分解文件
├── progress.txt             # 项目进度记录
├── package.json             # Node.js项目配置
├── .env.example             # 环境变量示例
└── README.md                # 项目说明文档
```

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
FEISHU_WEBHOOK_URL=your_feishu_webhook_url_here
```

### 3. 本地测试

安装依赖：
```bash
npm install
```

测试模式：
```bash
npm run test
```

完整执行：
```bash
npm start
```

### 4. GitHub Actions配置

1. 在GitHub仓库中配置Secrets：
   - `COZE_API_TOKEN`: Coze API令牌
   - `COZE_WORKFLOW_ID`: Coze工作流ID（默认: 7554238030879113267）
   - `FEISHU_WEBHOOK_URL`: 飞书webhook URL

2. 推送代码到GitHub，Actions将自动运行

## API说明

### Coze热点资讯工作流调用API

#### 方法1: 使用官方SDK
```javascript
import { CozeAPI } from '@coze/api';

const apiClient = new CozeAPI({
  token: 'your_token_here',
  baseURL: 'https://api.coze.cn'
});

const res = await apiClient.workflows.runs.create({
  workflow_id: '7554238030879113267',
});
```

#### 方法2: 使用curl
```bash
curl -X POST 'https://api.coze.cn/v1/workflow/run' \
-H "Authorization: Bearer your_token_here" \
-H "Content-Type: application/json" \
-d '{
  "workflow_id": "7554238030879113267"
}'
```

### 飞书推送Webhook

- **机器人URL**: `https://open.feishu.cn/open-apis/bot/v2/hook/d8125625-0cc3-457f-8c40-f1d7850584ce`
- **支持格式**: JSON格式，支持富文本消息
- **消息类型**: `rich_text` 富文本格式

## GitHub Actions配置

- **触发频率**: 每2小时（UTC时间 0 */2 * * *）
- **运行环境**: Ubuntu latest
- **Node.js版本**: 18
- **支持手动触发**: `workflow_dispatch`

## 使用说明

### 命令行参数

```bash
# 正常执行
node scripts/main.js

# 测试模式（仅测试连接）
node scripts/main.js --test

# 详细输出模式
node scripts/main.js --verbose

# 显示帮助
node scripts/main.js --help
```

### 环境变量说明

| 变量名 | 必需 | 说明 | 默认值 |
|--------|------|------|--------|
| `COZE_API_TOKEN` | 是 | Coze API访问令牌 | - |
| `COZE_WORKFLOW_ID` | 是 | Coze工作流ID | 7554238030879113267 |
| `FEISHU_WEBHOOK_URL` | 是 | 飞书webhook地址 | - |
| `SEND_ERROR_NOTIFICATION` | 否 | 是否发送错误通知 | false |

### 错误处理

项目包含完整的错误处理机制：

1. **环境变量检查**: 启动前验证所有必需的环境变量
2. **API调用错误**: 捕获并记录Coze API调用失败
3. **网络错误**: 处理网络连接问题
4. **数据格式错误**: 安全处理JSON解析错误
5. **飞书推送失败**: 记录推送失败原因

### 日志记录

- 控制台实时输出
- `progress.log` 文件记录
- GitHub Actions日志
- 支持详细模式输出

## 开发说明

### 添加新功能

1. 在 `tasks.json` 中添加新任务
2. 实现对应功能脚本
3. 更新 `main.js` 主执行逻辑
4. 编写测试用例
5. 更新文档

### 代码规范

- 使用ES6+语法
- 完整的错误处理
- 详细的注释说明
- 统一的日志格式

## 故障排除

### 常见问题

1. **GitHub Actions不执行**
   - 检查工作流文件语法
   - 确认仓库启用了Actions
   - 检查Secrets配置

2. **Coze API调用失败**
   - 验证API Token有效性
   - 检查工作流ID是否正确
   - 确认API访问权限

3. **飞书推送失败**
   - 验证webhook URL有效性
   - 检查消息格式
   - 确认机器人权限

4. **环境变量问题**
   - 确认Secrets名称正确
   - 检查环境变量拼写
   - 验证值的有效性

### 调试步骤

1. 本地运行测试模式
2. 检查GitHub Actions日志
3. 查看 `progress.log` 文件
4. 使用详细模式输出

## 许可证

MIT License

## 贡献

欢迎提交Issues和Pull Requests！

## 更新日志

### v1.0.0
- 初始版本发布
- 支持定时调用Coze工作流
- 支持飞书消息推送
- 完整的错误处理机制
- 支持本地测试模式