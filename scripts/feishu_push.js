// 飞书推送脚本 (修复版)
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
              if (jsonData.code === 0 || jsonData.StatusCode === 0) {
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

    // 构建文本消息内容
    let content = `🔥 **热点资讯推送** 📅 ${timeString}\n\n`;

    // 解析并格式化热点内容
    try {
      let newsContent = '';

      // 获取原始内容
      if (newsData.content) {
        newsContent = typeof newsData.content === 'string' ? newsData.content : JSON.stringify(newsData.content);
      } else if (newsData.outputs) {
        newsContent = typeof newsData.outputs === 'string' ? newsData.outputs : JSON.stringify(newsData.outputs);
      } else if (newsData.result) {
        newsContent = typeof newsData.result === 'string' ? newsData.result : JSON.stringify(newsData.result);
      } else {
        newsContent = JSON.stringify(newsData);
      }

      // 检查是否包含markdown表格，如果是则转换为段落格式
      if (newsContent.includes('|') && newsContent.includes('---')) {
        content += this.convertMarkdownTableToStructuredFormat(newsContent);
      } else {
        // 如果不是表格格式，直接使用原内容
        content += newsContent.replace(/\n{3,}/g, '\n\n').trim();
      }

    } catch (error) {
      console.error('格式化消息失败:', error);
      content += `\n❌ 消息格式化失败，原始数据：\n${JSON.stringify(newsData, null, 2)}`;
    }

    // 添加尾部信息
    content += `\n\n🤖 由 GitHub Actions 自动推送 | ${now.toLocaleString('zh-CN')}`;

    // 构建post消息
    const message = {
      msg_type: "post",
      content: {
        post: {
          zh_cn: {
            title: "🔥 热点资讯推送",
            content: [
              [
                {
                  tag: "text",
                  text: content
                }
              ]
            ]
          }
        }
      }
    };

    return message;
  }

  // 将markdown表格转换为结构化段落格式
  convertMarkdownTableToStructuredFormat(tableContent) {
    try {
      // 按行分割内容
      const lines = tableContent.split('\n');
      let result = '';

      // 查找表格开始位置（找到第一个 | --- | 行）
      let tableStartIndex = -1;
      let tableEndIndex = -1;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('---') && lines[i].includes('|')) {
          tableStartIndex = i;
          break;
        }
      }

      // 查找表格结束位置
      if (tableStartIndex > -1) {
        for (let i = tableStartIndex + 1; i < lines.length; i++) {
          if (!lines[i].includes('|') && lines[i].trim()) {
            tableEndIndex = i;
            break;
          }
        }
      }

      // 如果没有找到表格，返回原内容
      if (tableStartIndex === -1) {
        return tableContent;
      }

      // 保留表格前的内容（如标题等）
      if (tableStartIndex > 0) {
        result += lines.slice(0, tableStartIndex).join('\n') + '\n\n';
      }

      // 提取表格数据行
      const tableLines = tableEndIndex > -1
        ? lines.slice(tableStartIndex + 1, tableEndIndex)
        : lines.slice(tableStartIndex + 1);

      // 解析每一行表格数据
      tableLines.forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine.includes('|') && trimmedLine.startsWith('|')) {
          // 分割列，并过滤空字符串
          const columns = trimmedLine.split('|')
            .map(col => col.trim())
            .filter(col => col !== '');

          // 检查列数量，应该至少有5列（序号、行业、概念、驱动、个股）
          if (columns.length >= 5) {
            const index = columns[0];
            const industry = columns[1];
            const concept = columns[2];
            const coreDriver = columns[3];
            const stocks = columns[4];

            // 验证数据有效性
            if (industry && concept && coreDriver && stocks) {
              // 为不同行业选择合适的emoji
              const industryEmoji = this.getIndustryEmoji(industry);

              // 构建结构化的段落格式
              result += `${industryEmoji}【${industry}】\n`;
              result += `✨ 核心驱动：${coreDriver}\n`;
              result += `💡 热点概念：${concept}\n`;
              result += `📈 相关推荐个股：${stocks}\n\n`;
            }
          }
        }
      });

      // 添加风险提示部分（如果有）
      if (tableEndIndex > -1 && tableEndIndex < lines.length - 1) {
        const remainingContent = lines.slice(tableEndIndex).join('\n').trim();
        if (remainingContent) {
          result += `\n${remainingContent}`;
        }
      }

      return result.trim();

    } catch (error) {
      console.error('表格格式转换失败:', error);
      // 如果转换失败，返回原始内容
      return tableContent;
    }
  }

  // 根据行业类型获取对应的emoji
  getIndustryEmoji(industry) {
    const emojiMap = {
      '航天': '🚀',
      '商业航天': '🚀',
      '卫星互联网': '🌐',
      '人工智能': '🤖',
      '端侧AI': '🤖',
      '具身机器人': '🤖',
      '量子技术': '⚛️',
      '量子科技': '⚛️',
      '机器人': '🦾',
      '人形机器人': '🦾',
      '能源': '⚡',
      '储能': '🔋',
      '氢能': '🔋',
      '燃气轮机': '⚙️',
      '消费': '🛒',
      '商品消费': '🛒',
      '服务消费': '🎭',
      '金融': '💰',
      '大金融': '💰',
      '可回收火箭': '🔄'
    };

    // 查找匹配的emoji
    for (const [key, emoji] of Object.entries(emojiMap)) {
      if (industry.includes(key)) {
        return emoji;
      }
    }

    // 默认emoji
    return '📊';
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