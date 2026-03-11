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
      const webhookURL = this.webhookURL || process.env.FEISHU_WEBHOOK_URL;
      if (!webhookURL) {
        reject(new Error('Webhook URL is not defined'));
        return;
      }
      const protocol = webhookURL.startsWith('https') ? https : http;

      const req = protocol.request(webhookURL, options, (res) => {
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
    // 使用北京时间（UTC+8）格式化时间
    const timeString = now.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Shanghai'
    });

    // 解析并格式化热点内容
    try {
      let newsContent = this.extractNewsContent(newsData);

      // 检查是否是新的结构化JSON格式
      if (newsContent.includes('热点题材列表')) {
        const items = this.parseStructuredNews(newsContent);
        return this.buildInteractiveMessage(items, timeString);
      }

      // 检查是否包含markdown表格
      if (newsContent.includes('|') && newsContent.includes('---')) {
        const items = this.parseTableNews(newsContent);
        return this.buildInteractiveMessage(items, timeString);
      }

      // 其他格式直接显示
      return this.buildTextMessage(newsContent, timeString);

    } catch (error) {
      console.error('格式化消息失败:', error);
      return this.buildTextMessage('内容解析失败，请稍后重试', timeString);
    }
  }

  // 解析结构化JSON数据
  parseStructuredNews(content) {
    try {
      const data = JSON.parse(content);
      if (data.热点题材列表 && Array.isArray(data.热点题材列表)) {
        return data.热点题材列表.map(item => ({
          industry: item['关联行业 / 领域'] || '',
          concept: item['热点概念（平台内高频讨论主题）'] || '',
          driver: item['核心驱动（事件 / 趋势 / 数据）'] || '',
          stocks: item['相关推荐个股（若有）'] || ''
        }));
      }
    } catch (e) {
      console.log('JSON解析失败，尝试其他方式');
    }
    return [];
  }

  // 解析表格格式数据
  parseTableNews(tableContent) {
    const items = [];
    const lines = tableContent.split('\n');

    for (const line of lines) {
      if (line.includes('|') && line.startsWith('|') && !line.includes('---')) {
        const columns = line.split('|').map(col => col.trim()).filter(col => col !== '');
        if (columns.length >= 5) {
          items.push({
            industry: columns[1],
            concept: columns[2],
            driver: columns[3],
            stocks: columns[4]
          });
        }
      }
    }
    return items;
  }

  // 构建交互式消息（使用飞书卡片格式）
  buildInteractiveMessage(items, timeString) {
    // 构建内容文本
    let contentText = `📅 ${timeString}\n\n`;

    items.slice(0, 10).forEach((item, index) => {
      const emoji = this.getIndustryEmoji(item.industry);
      contentText += `${index + 1}. ${emoji} ${item.industry}\n`;
      contentText += `   💡 ${item.concept}\n`;
      if (item.stocks) {
        contentText += `   📈 ${item.stocks}\n`;
      }
      contentText += '\n';
    });

    contentText += '⚠️ 仅供参考，不构成投资建议';

    const message = {
      msg_type: "interactive",
      card: {
        header: {
          title: {
            tag: "plain_text",
            content: "🔥 今日热点题材 Top 10"
          },
          template: "blue"
        },
        elements: [
          {
            tag: "markdown",
            content: contentText
          },
          {
            tag: "note",
            elements: [
              {
                tag: "plain_text",
                content: "数据来源：韭菜公社"
              }
            ]
          }
        ]
      }
    };

    return message;
  }

  // 构建纯文本消息（备用）
  buildTextMessage(content, timeString) {
    return {
      msg_type: "post",
      content: {
        post: {
          zh_cn: {
            title: "🔥 今日热点题材",
            content: [
              [
                {
                  tag: "text",
                  text: `📅 ${timeString}\n\n${content}\n\n⚠️ 仅供参考，不构成投资建议`
                }
              ]
            ]
          }
        }
      }
    };
  }

  // 增强的内容提取函数
  extractNewsContent(newsData) {
    console.log('开始提取新闻内容...');

    // 尝试多种可能的数据结构
    let newsContent = '';

    // 1. 直接从 content 字段获取
    if (newsData.content) {
      console.log('找到 content 字段');
      newsContent = typeof newsData.content === 'string' ? newsData.content : JSON.stringify(newsData.content);

      // 尝试解析嵌套的 JSON
      newsContent = this.tryParseNestedJson(newsContent);
      if (newsContent && newsContent.trim()) {
        return this.normalizeContent(newsContent);
      }
    }

    // 2. 从 outputs 字段获取
    if (newsData.outputs) {
      console.log('找到 outputs 字段');
      newsContent = typeof newsData.outputs === 'string' ? newsData.outputs : JSON.stringify(newsData.outputs);
      newsContent = this.tryParseNestedJson(newsContent);
      if (newsContent && newsContent.trim()) {
        return this.normalizeContent(newsContent);
      }
    }

    // 3. 从 result 字段获取
    if (newsData.result) {
      console.log('找到 result 字段');
      newsContent = typeof newsData.result === 'string' ? newsData.result : JSON.stringify(newsData.result);
      newsContent = this.tryParseNestedJson(newsContent);
      if (newsContent && newsContent.trim()) {
        return this.normalizeContent(newsContent);
      }
    }

    // 4. 从 data 字段的 output 字段获取
    if (newsData.data && newsData.data.output) {
      console.log('找到 data.output 字段');
      newsContent = typeof newsData.data.output === 'string' ? newsData.data.output : JSON.stringify(newsData.data.output);
      newsContent = this.tryParseNestedJson(newsContent);
      if (newsContent && newsContent.trim()) {
        return this.normalizeContent(newsContent);
      }
    }

    // 5. 最后尝试整个对象序列化
    console.log('尝试整个对象序列化');
    newsContent = JSON.stringify(newsData);
    newsContent = this.tryParseNestedJson(newsContent);

    return this.normalizeContent(newsContent) || '未能提取到有效内容';
  }

  // 标准化内容格式
  normalizeContent(content) {
    if (!content || typeof content !== 'string') {
      return content;
    }

    // 转换转义的换行符为真正的换行符
    let normalized = content
      .replace(/\\n/g, '\n')
      .replace(/\\\\n/g, '\n')
      .replace(/\\"/g, '"');

    console.log('内容标准化完成，换行符数量:', (normalized.match(/\n/g) || []).length);
    return normalized;
  }

  // 尝试解析嵌套的 JSON
  tryParseNestedJson(content) {
    try {
      // 首先尝试直接解析
      const parsed = JSON.parse(content);

      // 如果是对象且有 output 字段
      if (typeof parsed === 'object' && parsed !== null) {
        if (parsed.Output || parsed.output) {
          const innerContent = parsed.Output || parsed.output;
          if (typeof innerContent === 'string') {
            // 再次尝试解析内层 JSON
            try {
              const innerParsed = JSON.parse(innerContent);
              // 检查是否是新的格式（包含文档说明和热点题材列表）
              if (innerParsed.文档说明 && innerParsed.热点题材列表) {
                return this.formatNewStructuredJson(innerParsed);
              }
              return innerParsed.output || innerParsed.Output || innerContent;
            } catch {
              // 如果内层 JSON 解析失败，但包含表格标记，直接返回
              if (innerContent.includes('|') && innerContent.includes('---')) {
                return innerContent;
              }
              return innerContent;
            }
          }
        }

        // 如果有 nested 字段
        if (parsed.output) {
          return parsed.output;
        }
      }

      // 如果包含表格标记，直接返回
      if (typeof content === 'string' && content.includes('|') && content.includes('---')) {
        return content;
      }

      return content;

    } catch (error) {
      console.log('JSON 解析失败，返回原始内容:', error.message);
      return content;
    }
  }

  // 格式化新的结构化JSON数据
  formatNewStructuredJson(data) {
    let result = '';

    // 标题已在消息头部显示，不需要重复添加

    // 处理热点题材列表
    if (data.热点题材列表 && Array.isArray(data.热点题材列表)) {
      data.热点题材列表.forEach((item, index) => {
        // 获取行业emoji
        const industry = item['关联行业 / 领域'] || '';
        const industryEmoji = this.getIndustryEmoji(industry);

        // 格式化每个热点题材
        result += `${item.序号}. ${industryEmoji} ${industry}\n`;
        result += `💡 热点概念：${item['热点概念（平台内高频讨论主题）'] || ''}\n`;
        result += `⚡ 核心驱动：${item['核心驱动（事件 / 趋势 / 数据）'] || ''}\n`;
        result += `📈 相关推荐个股：${item['相关推荐个股（若有）'] || ''}\n`;
        result += `${'─'.repeat(30)}\n\n`;
      });
    }

    // 不添加风险提示，保持内容简洁

    return result.trim();
  }

  // 将markdown表格转换为结构化段落格式
  convertMarkdownTableToStructuredFormat(tableContent) {
    try {
      // 首先清理内容，移除开头的JSON数据
      let cleanContent = this.cleanContent(tableContent);

      // 按行分割内容
      const lines = cleanContent.split('\n');
      let result = '';

      // 查找表格开始位置（找到第一个 | --- | 行）
      let tableStartIndex = -1;
      let tableEndIndex = -1;
      let headerLine = '';

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('---') && lines[i].includes('|')) {
          tableStartIndex = i;
          // 获取表头行
          if (i > 0) {
            headerLine = lines[i - 1];
          }
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
        return cleanContent;
      }

      // 保留表格前的内容（如标题等）
      if (tableStartIndex > 0) {
        result += lines.slice(0, tableStartIndex - 1).join('\n') + '\n\n';
      }

      // 标题已在消息头部显示，不需要重复添加

      // 提取表格数据行
      const tableLines = tableEndIndex > -1
        ? lines.slice(tableStartIndex + 1, tableEndIndex)
        : lines.slice(tableStartIndex + 1);

      // 解析每一行表格数据
      tableLines.forEach((line, lineIndex) => {
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

              // 构建更清晰的结构化段落格式
              result += `${index}. ${industryEmoji} ${industry}\n`;
              result += `💡 热点概念：${concept}\n`;
              result += `⚡ 核心驱动：${coreDriver}\n`;
              result += `📈 相关推荐个股：${stocks}\n`;
              result += `${'─'.repeat(30)}\n\n`;
            }
          }
        }
      });

      // 不添加风险提示部分，保持内容简洁

      return result.trim();

    } catch (error) {
      console.error('表格格式转换失败:', error);
      // 如果转换失败，返回原始内容
      return tableContent;
    }
  }

  // 清理内容，移除开头的JSON数据
  cleanContent(content) {
    if (!content || typeof content !== 'string') {
      return content;
    }

    // 查找第一个 "output" 字段的内容
    const outputMatch = content.match(/"output":\s*"([^"]*(?:\\.[^"]*)*)"/);
    if (outputMatch && outputMatch[1]) {
      // 提取并解义输出内容
      let extractedContent = outputMatch[1];
      // 处理转义字符
      extractedContent = extractedContent
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
      return extractedContent;
    }

    // 如果找到 "# Top 10" 开头，直接返回该部分
    const titleMatch = content.match(/# Top 10 热点题材整理清单[\s\S]*/);
    if (titleMatch) {
      return titleMatch[0];
    }

    return content;
  }

  // 根据行业类型获取对应的emoji
  getIndustryEmoji(industry) {
    const emojiMap = {
      '航天': '🚀',
      '商业航天': '🚀',
      '卫星互联网': '🛰️',
      '人工智能': '🤖',
      '端侧AI': '🤖',
      '具身机器人': '🦾',
      '量子技术': '⚛️',
      '量子科技': '⚛️',
      '机器人': '🦾',
      '人形机器人': '🦾',
      '能源': '⚡',
      '储能': '🔋',
      '氢能': '🔋',
      '燃气轮机': '⚙️',
      '消费': '🛒',
      '商品消费': '🛍️',
      '服务消费': '🎭',
      '金融': '💰',
      '大金融': '💰',
      '可回收火箭': '🔄',
      '芯片': '💻',
      '半导体': '💻',
      '医药': '💊',
      '生物医药': '💊',
      '医疗': '🏥',
      '汽车': '🚗',
      '新能源汽车': '🚗',
      '光伏': '☀️',
      '风电': '💨',
      '军工': '🛡️',
      '地产': '🏢',
      '钢铁': '🔩',
      '有色': '⚱️',
      '化工': '🧪',
      '农业': '🌾',
      '食品': '🍎',
      '饮料': '🥤',
      '纺织': '👔',
      '通信': '📡',
      '软件': '💾',
      '游戏': '🎮',
      '教育': '📚',
      '物流': '🚚',
      '交通': '🚄',
      '零售': '🏪',
      '旅游': '✈️',
      '传媒': '📺',
      '环保': '🌱',
      '新材料': '🧪',
      '5G': '📶',
      '6G': '📶',
      '云计算': '☁️',
      '大数据': '📊',
      '区块链': '🔗',
      '元宇宙': '🥽',
      'VR': '🥽',
      'AR': '🥽'
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

      // 记录实际推送的内容到文件
      try {
        const fs = require('fs');
        const pushContent = {
          timestamp: new Date().toISOString(),
          originalDataSize: JSON.stringify(newsData).length,
          formattedMessage: message,
          messageSize: JSON.stringify(message).length,
          textContent: message.content?.post?.zh_cn?.content?.[0]?.[0]?.text || 'No text content'
        };

        fs.writeFileSync('last_push_content.json', JSON.stringify(pushContent, null, 2), 'utf8');
        console.log('推送内容已保存到 last_push_content.json');

        // 单独保存文本内容便于查看
        const textContent = pushContent.textContent;
        fs.writeFileSync('last_push_text.txt', textContent, 'utf8');
        console.log('推送文本内容已保存到 last_push_text.txt');

      } catch (logError) {
        console.error('保存推送内容失败:', logError.message);
      }

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
}

module.exports = FeishuPush;