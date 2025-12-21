#!/usr/bin/env node

// 本地热点资讯获取脚本（不推送飞书）
const fs = require('fs');
const path = require('path');
const CozeAPIClient = require('./coze_api');

// 从 .env 文件加载环境变量
function loadEnvFile() {
  const envPath = path.join(process.cwd(), '.env');

  if (!fs.existsSync(envPath)) {
    log('error', '.env 文件不存在，请先创建 .env 文件');
    return false;
  }

  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const envLines = envContent.split('\n');

    log('info', '正在加载 .env 文件配置...');

    for (const line of envLines) {
      const trimmedLine = line.trim();

      // 跳过注释和空行
      if (!trimmedLine || trimmedLine.startsWith('#')) {
        continue;
      }

      // 解析键值对
      const equalIndex = trimmedLine.indexOf('=');
      if (equalIndex === -1) {
        continue;
      }

      const key = trimmedLine.substring(0, equalIndex).trim();
      let value = trimmedLine.substring(equalIndex + 1).trim();

      // 移除引号
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      // 只设置未定义的环境变量
      if (!process.env[key]) {
        process.env[key] = value;
        log('debug', `已设置环境变量: ${key}`);
      }
    }

    log('info', '.env 文件加载成功');
    return true;
  } catch (error) {
    log('error', `加载 .env 文件失败: ${error.message}`);
    return false;
  }
}

// 日志记录函数
function log(level, message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  console.log(logMessage);

  // 同时写入日志文件
  try {
    fs.appendFileSync('local_hot_news.log', logMessage + '\n');
  } catch (error) {
    console.error('写入日志文件失败:', error);
  }
}

// 保存获取到的热点资讯数据
function saveNewsData(newsResult) {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    // 保存原始JSON数据
    const jsonFileName = `local_hot_news_${timestamp}.json`;
    // fs.writeFileSync(jsonFileName, JSON.stringify(newsResult, null, 2), 'utf8');

    // 保存可读的文本格式
    let textContent = `=== 本地热点资讯获取结果 ===\n`;
    textContent += `获取时间: ${new Date().toLocaleString('zh-CN')}\n`;
    textContent += `数据大小: ${JSON.stringify(newsResult).length} 字符\n\n`;

    if (newsResult.data) {
      if (newsResult.data.document) {
        textContent += `【文档说明】\n${newsResult.data.document}\n\n`;
      }

      if (newsResult.data.hot_topics && newsResult.data.hot_topics.length > 0) {
        textContent += `【热点题材】\n`;
        newsResult.data.hot_topics.forEach((topic, index) => {
          textContent += `${index + 1}. ${topic.title}\n`;
          if (topic.description) {
            textContent += `   ${topic.description}\n`;
          }
          textContent += '\n';
        });
      }

      if (newsResult.data.risk_warning) {
        textContent += `【风险提示】\n${newsResult.data.risk_warning}\n\n`;
      }
    }

    const textFileName = `local_hot_news_${timestamp}.txt`;
    // fs.writeFileSync(textFileName, textContent, 'utf8');

    log('info', `热点资讯已保存到文件: ${jsonFileName} 和 ${textFileName}`);
    return { jsonFileName, textFileName };
  } catch (error) {
    log('error', `保存热点资讯失败: ${error.message}`);
    return null;
  }
}

// 环境变量检查
function checkEnvironmentVariables() {
  const requiredEnvVars = [
    'COZE_API_TOKEN',
    'COZE_WORKFLOW_ID'
  ];

  const missingVars = [];
  for (const varName of requiredEnvVars) {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  }

  if (missingVars.length > 0) {
    const errorMessage = `缺少必要的环境变量: ${missingVars.join(', ')}`;
    log('error', errorMessage);
    throw new Error(errorMessage);
  }

  log('info', '环境变量检查通过');
}

// 主执行函数
async function main() {
  log('info', '开始执行本地热点资讯获取任务');

  try {
    // 1. 加载 .env 文件
    if (!loadEnvFile()) {
      throw new Error('无法加载环境配置文件');
    }

    // 2. 检查环境变量
    checkEnvironmentVariables();

    // 3. 初始化Coze API客户端
    log('info', '初始化Coze API客户端');
    const cozeAPI = new CozeAPIClient(process.env.COZE_API_TOKEN);

    // 4. 获取热点资讯
    log('info', '开始获取热点资讯...');
    const newsResult = await cozeAPI.getHotNews();

    if (!newsResult.success) {
      throw new Error(`获取热点资讯失败: ${newsResult.error}`);
    }

    log('info', `热点资讯获取成功，数据大小: ${JSON.stringify(newsResult).length} 字符`);

    // 5. 保存获取到的数据
    const savedFiles = saveNewsData(newsResult);

    log('info', '本地热点资讯获取任务完成');

    // 输出执行摘要
    console.log('\n=== 执行摘要 ===');
    console.log(`✅ 任务状态: 成功`);
    console.log(`📅 执行时间: ${new Date().toLocaleString('zh-CN')}`);
    console.log(`📰 资讯获取: 成功`);
    console.log(`📝 数据大小: ${JSON.stringify(newsResult).length} 字符`);
    if (savedFiles) {
      console.log(`💾 数据已保存: ${savedFiles.jsonFileName}`);
      console.log(`📄 报告已保存: ${savedFiles.textFileName}`);
    }
    console.log('=================\n');

    return {
      success: true,
      message: '本地热点资讯获取任务执行成功',
      summary: {
        executionTime: new Date().toISOString(),
        newsDataSize: JSON.stringify(newsResult).length,
        savedFiles: savedFiles
      }
    };

  } catch (error) {
    log('error', `任务执行失败: ${error.message}`);
    console.error('\n=== 错误详情 ===');
    console.error(`❌ 错误信息: ${error.message}`);
    console.error(`📅 发生时间: ${new Date().toLocaleString('zh-CN')}`);
    console.error(`📍 错误位置: ${error.stack || '未知'}`);
    console.error('================\n');

    return {
      success: false,
      error: error.message,
      stack: error.stack
    };
  }
}

// 命令行参数处理
function parseArguments() {
  const args = process.argv.slice(2);
  const options = {
    verbose: false
  };

  for (const arg of args) {
    if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
本地热点资讯获取脚本（不含飞书推送）

用法: node local_main.js [选项]

选项:
  -v, --verbose  详细输出模式
  -h, --help     显示帮助信息

环境变量:
  COZE_API_TOKEN        Coze API令牌 (必需)
  COZE_WORKFLOW_ID      Coze工作流ID (必需)

功能:
  - 获取Coze热点资讯数据
  - 将数据保存到本地文件
  - 生成JSON和TXT两种格式的报告
  - 不推送飞书消息

示例:
  node local_main.js                    # 正常执行
  node local_main.js --verbose          # 详细模式
      `);
      process.exit(0);
    }
  }

  return options;
}

// 程序入口
if (require.main === module) {
  const options = parseArguments();

  main()
    .then(result => {
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error('主程序执行出错:', error);
      process.exit(1);
    });
}

module.exports = { main };