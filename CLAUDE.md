# 每日热点定时推送

## 描述
通过GitHub Action功能，每天定时调用Coze工作流，并将工作流获取的热点板块内容推送至飞书。系统支持两种工作流输出格式：
- 旧版：Markdown表格格式
- 新版：结构化JSON格式（包含文档说明、热点题材列表、风险提示等）

## coze热点资讯工作流调用API
``` javascript
// Our official coze sdk for JavaScript [coze-js](https://github.com/coze-dev/coze-js)
import { CozeAPI } from '@coze/api';

const apiClient = new CozeAPI({
  token: 'cztei_lJx8vwl5MYRGtjnxtOa1NCrWFRGUPzyabSA2JBtFNqeY6rBTFbADuCdq10WrHrjE9',
  baseURL: 'https://api.coze.cn'
});
const res = await apiClient.workflows.runs.create({
  workflow_id: '7554238030879113267',
});
```

``` bash

curl -X POST 'https://api.coze.cn/v1/workflow/run' \
-H "Authorization: Bearer cztei_lJx8vwl5MYRGtjnxtOa1NCrWFRGUPzyabSA2JBtFNqeY6rBTFbADuCdq10WrHrjE9" \
-H "Content-Type: application/json" \
-d '{
  "workflow_id": "7554238030879113267"
}'
```

## github action 说明

- github action guide URL：https://docs.github.com/zh/actions

## 飞书
我的飞书消息推送webhook机器人URL：
https://open.feishu.cn/open-apis/bot/v2/hook/d8125625-0cc3-457f-8c40-f1d7850584ce

## 任务
通过 github action，每日每两小时自动调用 coze热点资讯，并将资讯推送至飞书