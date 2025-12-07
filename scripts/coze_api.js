// Coze API调用脚本
const { CozeAPI } = require('@coze/api');

class CozeAPIClient {
  constructor(apiToken, baseURL = 'https://api.coze.cn') {
    this.client = new CozeAPI({
      token: apiToken,
      baseURL: baseURL
    });
  }

  // 调用工作流
  async runWorkflow(workflowId) {
    try {
      const response = await this.client.workflows.runs.create({
        workflow_id: workflowId
      });

      return {
        success: true,
        data: response,
        statusCode: 200
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        statusCode: error.status || 500
      };
    }
  }

  // 获取工作流执行结果
  async getWorkflowResult(workflowId, runId) {
    try {
      const response = await this.client.workflows.runs.retrieve({
        workflow_id: workflowId,
        run_id: runId
      });

      return {
        success: true,
        data: response,
        statusCode: 200
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        statusCode: error.status || 500
      };
    }
  }

  // 获取热点资讯（完整流程）
  async getHotNews() {
    try {
      const workflowId = process.env.COZE_WORKFLOW_ID || '7554238030879113267';

      // 第一步：启动工作流
      console.log('启动Coze工作流...');
      const runResult = await this.runWorkflow(workflowId);

      if (!runResult.success) {
        throw new Error(`启动工作流失败: ${JSON.stringify(runResult.error)}`);
      }
      console.log(`工作流启动 runWorkflow result: ${JSON.stringify(runResult)}`);

      const runId = runResult.data.data?.id;
      if (!runId) {
        throw new Error('无法获取工作流运行ID');
      }

      console.log(`工作流启动成功，运行ID: ${runId}`);

      // 第二步：等待并获取结果（最多等待30次，每次间隔2秒）
      let attempts = 0;
      const maxAttempts = 300;

      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 10000)); // 等待10秒

        console.log(`检查工作流结果 (${attempts + 1}/${maxAttempts})...`);
        const result = await this.getWorkflowResult(workflowId, runId);

        if (result.success) {
          const status = result.data.data?.status;

          if (status === 'succeeded') {
            console.log('工作流执行成功');
            return {
              success: true,
              data: result.data.data,
              content: result.data.data?.outputs || result.data.data?.result
            };
          } else if (status === 'failed') {
            throw new Error(`工作流执行失败: ${JSON.stringify(result.data.data)}`);
          } else if (status === 'running') {
            console.log('工作流仍在运行中...');
          }
        } else {
          throw new Error(`获取工作流结果失败: ${JSON.stringify(result.error)}`);
        }

        attempts++;
      }

      throw new Error('工作流执行超时');

    } catch (error) {
      console.error('获取热点资讯失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// 如果直接运行此文件，执行测试
if (require.main === module) {
  const apiToken = process.env.COZE_API_TOKEN;

  if (!apiToken) {
    console.error('错误: 请设置环境变量 COZE_API_TOKEN');
    process.exit(1);
  }

  const cozeAPI = new CozeAPIClient(apiToken);

  cozeAPI.getHotNews()
    .then(result => {
      if (result.success) {
        console.log('获取热点资讯成功:');
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.error('获取热点资讯失败:', result.error);
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('执行出错:', error);
      process.exit(1);
    });
}

module.exports = CozeAPIClient;