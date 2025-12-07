// Coze API调用脚本
const https = require('https');
const http = require('http');

class CozeAPI {
  constructor(apiToken, baseURL = 'https://api.coze.cn') {
    this.apiToken = apiToken;
    this.baseURL = baseURL;
  }

  // 调用工作流
  async runWorkflow(workflowId) {
    const url = `${this.baseURL}/v1/workflow/run`;
    const data = JSON.stringify({
      workflow_id: workflowId
    });

    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;

      const req = protocol.request(url, options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          try {
            const jsonData = JSON.parse(responseData);

            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({
                success: true,
                data: jsonData,
                statusCode: res.statusCode
              });
            } else {
              resolve({
                success: false,
                error: jsonData,
                statusCode: res.statusCode
              });
            }
          } catch (error) {
            reject({
              success: false,
              error: `解析响应失败: ${error.message}`,
              statusCode: res.statusCode,
              rawData: responseData
            });
          }
        });
      });

      req.on('error', (error) => {
        reject({
          success: false,
          error: `请求失败: ${error.message}`
        });
      });

      req.write(data);
      req.end();
    });
  }

  // 获取工作流执行结果
  async getWorkflowResult(workflowId, runId) {
    const url = `${this.baseURL}/v1/workflow/retrieve?workflow_id=${workflowId}&run_id=${runId}`;

    const options = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json'
      }
    };

    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;

      const req = protocol.request(url, options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          try {
            const jsonData = JSON.parse(responseData);

            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({
                success: true,
                data: jsonData,
                statusCode: res.statusCode
              });
            } else {
              resolve({
                success: false,
                error: jsonData,
                statusCode: res.statusCode
              });
            }
          } catch (error) {
            reject({
              success: false,
              error: `解析响应失败: ${error.message}`,
              statusCode: res.statusCode,
              rawData: responseData
            });
          }
        });
      });

      req.on('error', (error) => {
        reject({
          success: false,
          error: `请求失败: ${error.message}`
        });
      });

      req.end();
    });
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

      const runId = runResult.data.data?.id;
      if (!runId) {
        throw new Error('无法获取工作流运行ID');
      }

      console.log(`工作流启动成功，运行ID: ${runId}`);

      // 第二步：等待并获取结果（最多等待30次，每次间隔2秒）
      let attempts = 0;
      const maxAttempts = 30;

      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒

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

  const cozeAPI = new CozeAPI(apiToken);

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

module.exports = CozeAPI;