// Coze API调用脚本 - 使用官方SDK
const { CozeAPI } = require('@coze/api');

class CozeAPIClient {
  constructor(apiToken, baseURL = 'https://api.coze.cn') {
    this.client = new CozeAPI({
      token: apiToken,
      baseURL: baseURL
    });
  }

  // 调用工作流 - 使用官方SDK (修复后)
  async runWorkflow(workflowId, parameters = {}) {
    try {
      // 正确的API调用方式: create(params, options)
      const params = {
        workflow_id: workflowId,
        is_async:true,
        parameters: parameters
      };

      const response = await this.client.workflows.runs.create(params);

      console.log(`✓ 工作流启动响应: ${JSON.stringify(response)}`);

      return {
        success: true,
        data: response,
        statusCode: 200
      };
    } catch (error) {
      console.error(`❌ 工作流启动失败: ${error.message}`);
      return {
        success: false,
        error: error.message,
        statusCode: error.status || 500
      };
    }
  }

  // 获取工作流执行结果 - 使用官方SDK (修复后)
  async getWorkflowResult(workflowId, runId) {
    try {
      // 正确的API调用方式: history(workflowId, executeId, options)
      const response = await this.client.workflows.runs.history(workflowId, runId, {});

      console.log(`✓ 工作流状态查询响应: ${JSON.stringify(response)}`);

      return {
        success: true,
        data: response,
        statusCode: 200
      };
    } catch (error) {
      console.error(`❌ 获取工作流结果失败: ${error.message}`);
      return {
        success: false,
        error: error.message,
        statusCode: error.status || 500
      };
    }
  }

  // 获取热点资讯（完整流程）- 优化使用官方SDK
  async getHotNews(workflowId = null, parameters = {}) {
    try {
      const targetWorkflowId = workflowId || process.env.COZE_WORKFLOW_ID || '7554238030879113267';

      console.log('=== 开始获取热点资讯 ===');
      console.log(`工作流ID: ${targetWorkflowId}`);
      console.log(`参数: ${JSON.stringify(parameters)}`);

      // 第一步：启动工作流
      console.log('步骤1: 启动Coze工作流...');
      const runResult = await this.runWorkflow(targetWorkflowId, parameters);

      if (!runResult.success) {
        throw new Error(`启动工作流失败: ${runResult.error}`);
      }

      // 根据官方SDK响应结构获取runId
      const runId = runResult.data?.execute_id;
      if (!runId) {
        // 如果工作流是同步执行的，直接使用返回的数据
        if (runResult.data?.data) {
          try {
            const parsedData = JSON.parse(runResult.data.data);
            if (parsedData.output) {
              console.log('✓ 工作流同步执行成功，获取到热点数据');
              return {
                success: true,
                data: runResult.data,
                content: parsedData.output,
                runId: 'sync-execution',
                executionTime: new Date().toISOString()
              };
            }
          } catch (parseError) {
            console.log('✓ 工作流同步执行成功，返回原始数据');
            return {
              success: true,
              data: runResult.data,
              content: runResult.data.data,
              runId: 'sync-execution',
              executionTime: new Date().toISOString()
            };
          }
        }

        console.error('完整响应结构:', JSON.stringify(runResult, null, 2));
        throw new Error('无法从响应中获取工作流运行ID或数据');
      }

      console.log(`✓ 工作流启动成功，运行ID: ${runId}`);

      // 第二步：等待并获取结果
      console.log('步骤2: 等待工作流执行完成...');
      let attempts = 0;
      const maxAttempts = 180; // 180次，每次10秒，总计30分钟

      while (attempts < maxAttempts) {
        attempts++;
        console.log(`检查工作流状态 (${attempts}/${maxAttempts})...`);

        // 等待60秒
        await new Promise(resolve => setTimeout(resolve, 60000));

        const result = await this.getWorkflowResult(targetWorkflowId, runId);

        if (result.success) {
          // 修复：API返回的是 execute_status 而不是 status
          const responseData = Array.isArray(result.data) ? result.data[0] : result.data;
          const status = responseData?.execute_status || result.data?.status || result.data?.data?.status;
          console.log(`当前状态: ${status}`);

          if (status === 'Success' || status === 'succeeded') {
            console.log('✓ 工作流执行成功');

            // 修复：正确解析输出内容
            let content = null;
            const responseData = Array.isArray(result.data) ? result.data[0] : result.data;

            if (responseData?.output) {
              try {
                const outputData = JSON.parse(responseData.output);
                content = outputData.Output || outputData.output || responseData.output;
              } catch (parseError) {
                content = responseData.output;
              }
            }

            const outputs = result.data?.outputs || result.data?.data?.outputs;
            const resultData = result.data?.result || result.data?.data?.result;

            return {
              success: true,
              data: result.data,
              content: content || outputs || resultData,
              runId: runId,
              executionTime: new Date().toISOString()
            };
          } else if (status === 'failed') {
            const errorCode = result.data?.error_code || result.data?.data?.error_code;
            const errorMsg = result.data?.message || result.data?.data?.message;
            throw new Error(`工作流执行失败 [${errorCode}]: ${errorMsg}`);
          } else if (status === 'running' || status === 'pending' || status === 'Running') {
            console.log('→ 工作流执行中，继续等待...');
            continue;
          } else {
            console.log(`未知状态: ${status}，继续等待...`);
            continue;
          }
        } else {
          throw new Error(`获取工作流结果失败: ${result.error}`);
        }
      }

      throw new Error(`工作流执行超时，已等待${maxAttempts * 10}秒`);

    } catch (error) {
      console.error('❌ 获取热点资讯失败:', error.message);
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
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