#!/usr/bin/env node

// 每日热点推送主执行脚本
const fs = require('fs');
const path = require('path');
const CozeAPIClient = require('./coze_api');
const FeishuPush = require('./feishu_push');

// 从 .env 文件加载环境变量
function loadEnvFile() {
  const envPath = path.join(process.cwd(), '.env');

  if (!fs.existsSync(envPath)) {
    log('info', '.env 文件不存在，跳过本地配置加载');
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
    fs.appendFileSync('progress.log', logMessage + '\n');
  } catch (error) {
    console.error('写入日志文件失败:', error);
  }
}

// 检查当前时间是否在指定的推送时间内
function shouldPushToFeishu() {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();

  log('info', `当前UTC时间: ${utcHour.toString().padStart(2, '0')}:${utcMinute.toString().padStart(2, '0')}`);

  // 推送时间：UTC 8:30, 12:00, 20:00 (对应北京时间 16:30, 20:00, 次日4:00)
  const is830 = utcHour === 8 && utcMinute === 30;
  const is1200 = utcHour === 12 && utcMinute === 0;
  const is2000 = utcHour === 20 && utcMinute === 0;

  const shouldPush = is830 || is1200 || is2000;

  if (shouldPush) {
    log('info', '✅ 当前时间在指定推送时间内，将执行飞书推送');
  } else {
    log('info', '❌ 当前时间不在指定推送时间内，将跳过飞书推送');
  }

  return shouldPush;
}

// 环境变量检查
function checkEnvironmentVariables() {
  const requiredEnvVars = [
    'COZE_API_TOKEN',
    'COZE_WORKFLOW_ID',
    'FEISHU_WEBHOOK_URL'
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
  log('info', '开始执行每日热点推送任务');

  try {
    // 1. 加载 .env 文件（如果存在）
    loadEnvFile();

    // 2. 检查环境变量
    checkEnvironmentVariables();

    // 3. 初始化API客户端
    log('info', '初始化API客户端');
    const cozeAPI = new CozeAPIClient(process.env.COZE_API_TOKEN);
    const feishuPush = new FeishuPush(process.env.FEISHU_WEBHOOK_URL);

    // 4. 获取热点资讯（每次都执行）
    log('info', '开始获取热点资讯');
    const newsResult = await cozeAPI.getHotNews();

    if (!newsResult.success) {
      throw new Error(`获取热点资讯失败: ${newsResult.error}`);
    }

    log('info', `热点资讯获取成功，数据大小: ${JSON.stringify(newsResult).length} 字符`);

    // 5. 检查是否需要推送到飞书
    const shouldPush = shouldPushToFeishu();
    let pushResult = null;
    let stepsCompleted = ['环境变量检查', '获取热点资讯'];

    if (shouldPush) {
      // 6. 推送到飞书
      log('info', '开始推送到飞书');
      pushResult = await feishuPush.pushHotNews(newsResult);

      if (!pushResult.success) {
        throw new Error(`推送到飞书失败: ${pushResult.error}`);
      }

      log('info', '飞书推送成功');
      stepsCompleted.push('推送到飞书');
    } else {
      log('info', '跳过飞书推送步骤');
    }

    log('info', '每日热点推送任务完成');

    // 输出执行摘要
    console.log('\n=== 执行摘要 ===');
    console.log(`✅ 任务状态: 成功`);
    console.log(`📅 执行时间: ${new Date().toLocaleString('zh-CN')}`);
    console.log(`📰 资讯获取: 成功`);
    console.log(`📱 飞书推送: ${shouldPush ? '成功' : '跳过'}`);
    console.log(`📝 数据大小: ${JSON.stringify(newsResult).length} 字符`);
    console.log('=================\n');

    return {
      success: true,
      message: '每日热点推送任务执行成功',
      summary: {
        executionTime: new Date().toISOString(),
        newsDataSize: JSON.stringify(newsResult).length,
        stepsCompleted: stepsCompleted,
        feishuPushSkipped: !shouldPush
      }
    };

  } catch (error) {
    log('error', `任务执行失败: ${error.message}`);
    console.error('\n=== 错误详情 ===');
    console.error(`❌ 错误信息: ${error.message}`);
    console.error(`📅 发生时间: ${new Date().toLocaleString('zh-CN')}`);
    console.error(`📍 错误位置: ${error.stack || '未知'}`);
    console.error('================\n');

    // 发送错误通知到飞书（如果配置了的话）
    try {
      if (process.env.FEISHU_WEBHOOK_URL && process.env.SEND_ERROR_NOTIFICATION === 'true') {
        const feishuPush = new FeishuPush(process.env.FEISHU_WEBHOOK_URL);
        const errorMessage = {
          msg_type: "text",
          content: {
            text: `❌ 每日热点推送任务失败\n\n错误信息: ${error.message}\n发生时间: ${new Date().toLocaleString('zh-CN')}`
          }
        };

        await feishuPush.sendMessage(errorMessage);
        log('info', '错误通知已发送到飞书');
      }
    } catch (notifyError) {
      log('error', `发送错误通知失败: ${notifyError.message}`);
    }

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
    test: false,
    verbose: false
  };

  for (const arg of args) {
    if (arg === '--test' || arg === '-t') {
      options.test = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
每日热点推送脚本

用法: node main.js [选项]

选项:
  -t, --test     运行测试模式（仅测试连接，不执行完整流程）
  -v, --verbose  详细输出模式
  -h, --help     显示帮助信息

环境变量:
  COZE_API_TOKEN        Coze API令牌 (必需)
  COZE_WORKFLOW_ID      Coze工作流ID (必需，默认: 7554238030879113267)
  FEISHU_WEBHOOK_URL    飞书webhook URL (必需)
  SEND_ERROR_NOTIFICATION  是否发送错误通知 (可选，默认: false)

示例:
  node main.js                    # 正常执行
  node main.js --test             # 测试模式
  node main.js --verbose          # 详细模式
      `);
      process.exit(0);
    }
  }

  return options;
}

// 测试模式函数
async function runTestMode() {
  log('info', '进入测试模式');

  try {
    // 1. 加载 .env 文件（如果存在）
    loadEnvFile();

    // 2. 检查环境变量
    checkEnvironmentVariables();

    // 3. 测试Coze API连接
    log('info', '测试Coze API连接');
    const cozeAPI = new CozeAPIClient(process.env.COZE_API_TOKEN);
    console.log('Coze API配置正常，Token已设置');

    // 4. 测试飞书推送
    log('info', '测试飞书推送连接');
    const feishuPush = new FeishuPush(process.env.FEISHU_WEBHOOK_URL);
    const testResult = await feishuPush.sendTestMessage();

    if (testResult.success) {
      log('info', '测试完成，所有连接正常');
      console.log('\n✅ 测试结果: 所有连接正常，可以执行完整流程');
      return { success: true, message: '测试通过' };
    } else {
      throw new Error(`飞书测试失败: ${testResult.error}`);
    }

  } catch (error) {
    log('error', `测试失败: ${error.message}`);
    console.error(`\n❌ 测试失败: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// 程序入口
if (require.main === module) {
  const options = parseArguments();

  if (options.test) {
    runTestMode()
      .then(result => {
        process.exit(result.success ? 0 : 1);
      })
      .catch(error => {
        console.error('测试执行出错:', error);
        process.exit(1);
      });
  } else {
    main()
      .then(result => {
        process.exit(result.success ? 0 : 1);
      })
      .catch(error => {
        console.error('主程序执行出错:', error);
        process.exit(1);
      });
  }
}

module.exports = { main, runTestMode };