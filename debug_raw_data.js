// 调试原始数据格式
const FeishuPush = require('./scripts/feishu_push.js');
const CozeAPIClient = require('./scripts/coze_api.js');

async function debugData() {
  try {
    console.log('=== 调试原始数据格式 ===');

    // 初始化客户端
    const cozeAPI = new CozeAPIClient(process.env.COZE_API_TOKEN);
    const feishuPush = new FeishuPush(process.env.FEISHU_WEBHOOK_URL);

    // 获取热点数据
    const newsResult = await cozeAPI.getHotNews();

    if (!newsResult.success) {
      console.error('获取数据失败:', newsResult.error);
      return;
    }

    console.log('原始数据类型:', typeof newsResult);
    console.log('原始数据结构:', Object.keys(newsResult));

    // 查找数据内容
    let newsContent = null;
    if (newsResult.content) {
      newsContent = typeof newsResult.content === 'string' ? newsResult.content : JSON.stringify(newsResult.content);
    } else if (newsResult.outputs) {
      newsContent = typeof newsResult.outputs === 'string' ? newsResult.outputs : JSON.stringify(newsResult.outputs);
    } else if (newsResult.result) {
      newsContent = typeof newsResult.result === 'string' ? newsResult.result : JSON.stringify(newsResult.result);
    } else {
      newsContent = JSON.stringify(newsResult);
    }

    console.log('\n=== 原始内容前500字符 ===');
    console.log(newsContent.substring(0, 500));

    console.log('\n=== 是否包含表格标记 ===');
    console.log('包含管道符:', newsContent.includes('|'));
    console.log('包含分隔线:', newsContent.includes('---'));

    // 测试格式化函数
    console.log('\n=== 测试格式化函数 ===');
    const formattedMessage = feishuPush.formatHotNewsMessage(newsResult);
    const textContent = formattedMessage.content?.post?.zh_cn?.content?.[0]?.[0]?.text || 'No text content';

    console.log('格式化后内容长度:', textContent.length);
    console.log('格式化后内容:');
    console.log(textContent);

  } catch (error) {
    console.error('调试失败:', error);
  }
}

// 加载环境变量
require('fs').readFileSync('.env', 'utf8').split('\n').forEach(line => {
  const trimmedLine = line.trim();
  if (trimmedLine && !trimmedLine.startsWith('#')) {
    const [key, ...valueParts] = trimmedLine.split('=');
    if (key && valueParts.length > 0) {
      process.env[key] = valueParts.join('=');
    }
  }
});

debugData();