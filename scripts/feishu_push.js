// 飞书推送脚本
const https = require('https');
const http = require('http');

class FeishuPush {
  constructor(webhookURL) {
    this.webhookURL = webhookURL;
  }

  // 推送消息到飞书
  async sendMessage(message) {
    const data = JSON.stringify(message);

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    return new Promise((resolve, reject) => {
      const protocol = this.webhookURL.startsWith('https') ? https : http;

      const req = protocol.request(this.webhookURL, options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          try {
            const jsonData = JSON.parse(responseData);

            if (res.statusCode >= 200 && res.statusCode < 300) {
              if (jsonData.code === 0) {
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

  // 格式化热点资讯消息
  formatHotNewsMessage(newsData) {
    const now = new Date();
    const timeString = now.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });

    // 构建富文本消息
    const message = {
      msg_type: "rich_text",
      content: {
        rich_text: [
          {
            tag: "text",
            text: "🔥 ",
            style: {
              bold: true
            }
          },
          {
            tag: "text",
            text: "热点资讯推送",
            style: {
              bold: true,
              font_size: "large",
              font_color: "#FF6B6B"
            }
          },
          {
            tag: "text",
            text: `\n📅 更新时间: ${timeString}\n\n`,
            style: {
              font_color: "#666666"
            }
          }
        ]
      }
    };

    // 解析并添加热点内容
    try {
      let content = '';

      // 如果有content字段，直接使用
      if (newsData.content) {
        content = typeof newsData.content === 'string'
          ? newsData.content
          : JSON.stringify(newsData.content, null, 2);
      }
      // 如果有outputs字段，尝试解析
      else if (newsData.outputs) {
        content = typeof newsData.outputs === 'string'
          ? newsData.outputs
          : JSON.stringify(newsData.outputs, null, 2);
      }
      // 如果有result字段，尝试解析
      else if (newsData.result) {
        content = typeof newsData.result === 'string'
          ? newsData.result
          : JSON.stringify(newsData.result, null, 2);
      }
      // 其他情况，序列化整个data对象
      else {
        content = JSON.stringify(newsData, null, 2);
      }

      // 清理和格式化内容
      content = content.replace(/\n{3,}/g, '\n\n').trim();

      // 分割内容为行，并添加到消息中
      const lines = content.split('\n');
      let isInCodeBlock = false;

      for (const line of lines) {
        if (line.trim().startsWith('```')) {
          isInCodeBlock = !isInCodeBlock;
          message.content.rich_text.push({
            tag: "text",
            text: line + '\n',
            style: isInCodeBlock ? {
              font_family: "monospace",
              bg_color: "#F5F5F5"
            } : {}
          });
        } else if (isInCodeBlock) {
          message.content.rich_text.push({
            tag: "text",
            text: line + '\n',
            style: {
              font_family: "monospace",
              bg_color: "#F5F5F5"
            }
          });
        } else if (line.trim()) {
          // 检测是否为标题或重要信息
          if (line.match(/^[#*]/) || line.includes('热点') || line.includes('新闻') || line.includes('资讯')) {
            message.content.rich_text.push({
              tag: "text",
              text: line + '\n',
              style: {
                bold: true,
                font_color: "#333333"
              }
            });
          } else {
            message.content.rich_text.push({
              tag: "text",
              text: line + '\n',
              style: {
                font_color: "#333333"
              }
            });
          }
        } else {
          message.content.rich_text.push({
            tag: "text",
            text: '\n'
          });
        }
      }

      // 添加尾部信息
      message.content.rich_text.push(
        {
          tag: "text",
          text: "\n",
          style: {}
        },
        {
          tag: "text",
          text: "🤖 ",
          style: {}
        },
        {
          tag: "text",
          text: "由 GitHub Actions 自动推送",
          style: {
            font_color: "#999999",
            font_size: "small"
          }
        }
      );

    } catch (error) {
      console.error('格式化消息失败:', error);

      // 发生错误时发送简化消息
      message.content.rich_text.push({
        tag: "text",
        text: `\n❌ 消息格式化失败，原始数据：\n${JSON.stringify(newsData, null, 2)}`,
        style: {
          font_color: "#FF0000"
        }
      });
    }

    return message;
  }

  // 推送热点资讯
  async pushHotNews(newsData) {
    try {
      const webhookURL = process.env.FEISHU_WEBHOOK_URL || this.webhookURL;

      if (!webhookURL) {
        throw new Error('飞书webhook URL未配置');
      }

      console.log('准备推送热点资讯到飞书...');

      const message = this.formatHotNewsMessage(newsData);
      const result = await this.sendMessage(message);

      if (result.success) {
        console.log('飞书推送成功');
        return {
          success: true,
          message: '推送成功',
          data: result.data
        };
      } else {
        throw new Error(`推送失败: ${JSON.stringify(result.error)}`);
      }

    } catch (error) {
      console.error('飞书推送失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // 发送测试消息
  async sendTestMessage() {
    const testMessage = {
      msg_type: "text",
      content: {
        text: "🧪 这是一条测试消息，用于验证飞书webhook连接是否正常。"
      }
    };

    try {
      console.log('发送测试消息...');
      const result = await this.sendMessage(testMessage);

      if (result.success) {
        console.log('测试消息发送成功');
        return { success: true, message: '测试成功' };
      } else {
        throw new Error(`测试失败: ${JSON.stringify(result.error)}`);
      }
    } catch (error) {
      console.error('测试消息发送失败:', error);
      return { success: false, error: error.message };
    }
  }
}

// 如果直接运行此文件，执行测试
if (require.main === module) {
  const webhookURL = process.env.FEISHU_WEBHOOK_URL;

  if (!webhookURL) {
    console.error('错误: 请设置环境变量 FEISHU_WEBHOOK_URL');
    process.exit(1);
  }

  const feishuPush = new FeishuPush(webhookURL);

  // 发送测试消息
  feishuPush.sendTestMessage()
    .then(result => {
      if (result.success) {
        console.log('飞书推送测试成功');
      } else {
        console.error('飞书推送测试失败:', result.error);
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('执行出错:', error);
      process.exit(1);
    });
}

module.exports = FeishuPush;