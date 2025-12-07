#!/usr/bin/env node

// 模块加载测试脚本
console.log('开始模块加载测试...');
console.log('Node.js 版本:', process.version);
console.log('当前工作目录:', process.cwd());

try {
  console.log('\n1. 测试 fs 模块...');
  const fs = require('fs');
  console.log('✓ fs 模块加载成功');

  console.log('\n2. 测试自定义模块...');

  // 测试 coze_api.js
  console.log('  加载 coze_api.js...');
  const CozeAPI = require('./scripts/coze_api');
  console.log('✓ coze_api.js 加载成功');
  console.log('  CozeAPI 类型:', typeof CozeAPI);

  // 测试 feishu_push.js
  console.log('  加载 feishu_push.js...');
  const FeishuPush = require('./scripts/feishu_push');
  console.log('✓ feishu_push.js 加载成功');
  console.log('  FeishuPush 类型:', typeof FeishuPush);

  // 测试 main.js
  console.log('  加载 main.js...');
  const main = require('./scripts/main');
  console.log('✓ main.js 加载成功');
  console.log('  main 对象:', Object.keys(main));

  console.log('\n3. 测试实例化...');

  if (process.env.COZE_API_TOKEN) {
    console.log('  创建 CozeAPI 实例...');
    const cozeAPI = new CozeAPI(process.env.COZE_API_TOKEN);
    console.log('✓ CozeAPI 实例创建成功');
  } else {
    console.log('  跳过 CozeAPI 实例化 (缺少 COZE_API_TOKEN)');
  }

  if (process.env.FEISHU_WEBHOOK_URL) {
    console.log('  创建 FeishuPush 实例...');
    const feishuPush = new FeishuPush(process.env.FEISHU_WEBHOOK_URL);
    console.log('✓ FeishuPush 实例创建成功');
  } else {
    console.log('  跳过 FeishuPush 实例化 (缺少 FEISHU_WEBHOOK_URL)');
  }

  console.log('\n✅ 所有模块测试通过！');

} catch (error) {
  console.error('\n❌ 模块加载测试失败:');
  console.error('错误类型:', error.constructor.name);
  console.error('错误信息:', error.message);
  console.error('错误堆栈:', error.stack);

  // 额外的诊断信息
  console.error('\n诊断信息:');

  try {
    console.error('  当前目录文件列表:');
    const files = fs.readdirSync('.');
    console.error('  ', files.join(', '));

    console.error('  scripts 目录文件列表:');
    const scriptFiles = fs.readdirSync('./scripts');
    console.error('  ', scriptFiles.join(', '));

  } catch (fsError) {
    console.error('  文件系统错误:', fsError.message);
  }

  process.exit(1);
}