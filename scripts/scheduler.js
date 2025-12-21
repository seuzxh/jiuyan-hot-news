#!/usr/bin/env node

// 本地热点资讯定时调度器
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

// 导入本地主函数
const { main: localMain } = require('./local_main');

// 日志记录函数
function log(level, message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] [SCHEDULER] ${message}`;
  console.log(logMessage);

  // 同时写入调度器日志文件
  try {
    fs.appendFileSync('scheduler.log', logMessage + '\n');
  } catch (error) {
    console.error('写入调度器日志文件失败:', error);
  }
}

// 任务执行状态
let isTaskRunning = false;
let lastExecutionTime = null;
let executionCount = 0;
let successCount = 0;
let errorCount = 0;

// 执行热点资讯获取任务
async function executeHotNewsTask() {
  if (isTaskRunning) {
    log('warning', '上一个任务仍在执行中，跳过本次执行');
    return;
  }

  isTaskRunning = true;
  executionCount++;
  const executionId = `#${executionCount}`;

  log('info', `开始执行热点资讯获取任务 ${executionId}`);

  try {
    const startTime = new Date();
    const result = await localMain();
    const endTime = new Date();
    const duration = (endTime - startTime) / 1000; // 转换为秒

    lastExecutionTime = endTime;

    if (result.success) {
      successCount++;
      log('info', `任务 ${executionId} 执行成功，耗时 ${duration.toFixed(2)} 秒`);

      // 输出统计信息
      console.log(`\n📊 执行统计: 成功 ${successCount}/${executionCount} 次，失败 ${errorCount} 次\n`);
    } else {
      errorCount++;
      log('error', `任务 ${executionId} 执行失败: ${result.error}`);
    }

  } catch (error) {
    errorCount++;
    log('error', `任务 ${executionId} 执行异常: ${error.message}`);
  } finally {
    isTaskRunning = false;
  }
}

// 显示当前状态
function showStatus() {
  console.log('\n=== 调度器状态 ===');
  console.log(`📅 启动时间: ${new Date(startTime).toLocaleString('zh-CN')}`);
  console.log(`⏰ 当前时间: ${new Date().toLocaleString('zh-CN')}`);
  console.log(`🔄 执行次数: ${executionCount}`);
  console.log(`✅ 成功次数: ${successCount}`);
  console.log(`❌ 失败次数: ${errorCount}`);
  console.log(`🏃 当前状态: ${isTaskRunning ? '正在执行' : '空闲'}`);
  if (lastExecutionTime) {
    console.log(`🕐 上次执行: ${new Date(lastExecutionTime).toLocaleString('zh-CN')}`);
  }
  console.log(`⏱️  下次执行: ${getNextExecutionTime()}`);
  console.log('=================\n');
}

// 获取下次执行时间
function getNextExecutionTime() {
  const now = new Date();
  const nextExecution = new Date(now);

  // 计算下一个5分钟的整点时间
  const minutes = now.getMinutes();
  const nextMinutes = Math.ceil((minutes + 1) / 5) * 5;

  if (nextMinutes >= 60) {
    nextExecution.setHours(now.getHours() + 1);
    nextExecution.setMinutes(nextMinutes - 60);
  } else {
    nextExecution.setMinutes(nextMinutes);
  }

  nextExecution.setSeconds(0);
  nextExecution.setMilliseconds(0);

  return nextExecution.toLocaleString('zh-CN');
}

// 优雅关闭处理
function handleShutdown() {
  log('info', '正在关闭调度器...');

  if (cronTask) {
    cronTask.stop();
  }

  console.log('\n=== 最终统计 ===');
  console.log(`总运行时间: ${Math.round((Date.now() - startTime) / 1000 / 60)} 分钟`);
  console.log(`总执行次数: ${executionCount}`);
  console.log(`成功次数: ${successCount}`);
  console.log(`失败次数: ${errorCount}`);
  console.log(`成功率: ${executionCount > 0 ? ((successCount / executionCount) * 100).toFixed(2) : 0}%`);
  console.log('================\n');

  log('info', '调度器已关闭');
  process.exit(0);
}

// 命令行参数处理
function parseArguments() {
  const args = process.argv.slice(2);
  const options = {
    interval: '*/5 * * * *', // 默认每5分钟
    immediate: false,
    statusOnly: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      console.log(`
本地热点资讯定时调度器

用法: node scheduler.js [选项]

选项:
  -h, --help              显示帮助信息
  -i, --interval <cron>   设置执行间隔 (默认: "*/5 * * * *", 每5分钟)
  -n, --now               立即执行一次任务
  -s, --status            只显示当前状态
  --immediate             启动时立即执行一次

Cron表达式示例:
  "*/5 * * * *"           每5分钟执行一次
  "*/10 * * * *"          每10分钟执行一次
  "0 */1 * * *"           每小时执行一次
  "0 9,12,17 * * *"       每天9点、12点、17点执行

环境变量:
  需要在 .env 文件中配置 COZE_API_TOKEN 和 COZE_WORKFLOW_ID

日志文件:
  - scheduler.log         调度器运行日志
  - local_hot_news.log    任务执行日志

示例:
  node scheduler.js                     # 每5分钟执行一次
  node scheduler.js --interval "*/10 * * * *"  # 每10分钟执行一次
  node scheduler.js --now               # 立即执行一次
  node scheduler.js --status            # 显示状态
      `);
      process.exit(0);
    } else if (arg === '--interval' || arg === '-i') {
      if (i + 1 < args.length) {
        options.interval = args[++i];
      } else {
        console.error('错误: --interval 需要一个 cron 表达式参数');
        process.exit(1);
      }
    } else if (arg === '--now' || arg === '-n') {
      options.statusOnly = false;
      options.immediate = true;
    } else if (arg === '--status' || arg === '-s') {
      options.statusOnly = true;
    } else if (arg === '--immediate') {
      options.immediate = true;
    }
  }

  return options;
}

// 主程序
let startTime;
let cronTask;

async function main() {
  const options = parseArguments();
  startTime = Date.now();

  // 设置信号处理
  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);

  log('info', '本地热点资讯定时调度器启动');
  log('info', `执行间隔: ${options.interval}`);

  if (options.statusOnly) {
    showStatus();
    return;
  }

  // 验证 cron 表达式
  if (!cron.validate(options.interval)) {
    log('error', `无效的 cron 表达式: ${options.interval}`);
    process.exit(1);
  }

  // 显示启动信息
  console.log('\n🚀 本地热点资讯定时调度器');
  console.log(`⏰ 执行间隔: ${options.interval}`);
  console.log(`🕐 启动时间: ${new Date().toLocaleString('zh-CN')}`);
  console.log(`📅 下次执行: ${getNextExecutionTime()}`);
  console.log('按 Ctrl+C 退出\n');

  // 立即执行一次（如果指定）
  if (options.immediate) {
    log('info', '启动时立即执行一次任务');
    await executeHotNewsTask();
  }

  // 设置定时任务
  cronTask = cron.schedule(options.interval, async () => {
    await executeHotNewsTask();
  }, {
    scheduled: false
  });

  // 启动定时任务
  cronTask.start();
  log('info', '定时任务已启动');

  // 定期显示状态（每30分钟）
  setInterval(() => {
    showStatus();
  }, 30 * 60 * 1000);

  // 保持程序运行
  log('info', '调度器正在运行中，按 Ctrl+C 退出');
}

// 程序入口
if (require.main === module) {
  main()
    .catch(error => {
      console.error('调度器启动失败:', error);
      process.exit(1);
    });
}

module.exports = { main };