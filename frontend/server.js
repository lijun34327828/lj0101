const express = require('express');
const path = require('path');

const app = express();
const PORT = 3911;

app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleString()}] ${req.method} ${req.url}`);
  next();
});

app.get('/', (req, res) => {
  const html = `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>企业班车管理系统</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .container {
          text-align: center;
          color: #fff;
        }
        .title {
          font-size: 42px;
          margin-bottom: 12px;
          font-weight: 700;
        }
        .subtitle {
          font-size: 18px;
          margin-bottom: 50px;
          opacity: 0.9;
        }
        .cards {
          display: flex;
          gap: 30px;
          justify-content: center;
          flex-wrap: wrap;
        }
        .card {
          background: rgba(255, 255, 255, 0.95);
          border-radius: 16px;
          padding: 40px 30px;
          width: 280px;
          text-decoration: none;
          transition: all 0.3s;
          box-shadow: 0 10px 40px rgba(0,0,0,0.2);
        }
        .card:hover {
          transform: translateY(-8px);
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        .icon {
          font-size: 60px;
          margin-bottom: 20px;
        }
        .card-title {
          font-size: 22px;
          font-weight: 600;
          color: #333;
          margin-bottom: 10px;
        }
        .card-desc {
          font-size: 14px;
          color: #666;
          line-height: 1.6;
        }
        .footer {
          margin-top: 60px;
          font-size: 13px;
          opacity: 0.7;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1 class="title">🚌 企业班车管理系统</h1>
        <p class="subtitle">智能排班 · 高效通勤 · 绿色出行</p>
        <div class="cards">
          <a href="/employee/" class="card">
            <div class="icon">👤</div>
            <div class="card-title">员工端</div>
            <div class="card-desc">在线预约班车<br>查看乘车记录<br>取消预约</div>
          </a>
          <a href="/admin/" class="card">
            <div class="icon">👨‍💼</div>
            <div class="card-title">行政端</div>
            <div class="card-desc">班次排期管理<br>乘车核销<br>运力统计分析</div>
          </a>
        </div>
        <div class="footer">
          后端服务: localhost:8911 | 前端服务: localhost:3911
        </div>
      </div>
    </body>
    </html>
  `;
  res.send(html);
});

app.use('/employee', express.static(path.join(__dirname, 'employee')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

app.use((req, res) => {
  res.status(404).send('404 - 页面不存在');
});

app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  企业班车管理系统 - 前端服务`);
  console.log(`  运行端口: ${PORT}`);
  console.log(`  首页地址: http://localhost:${PORT}/`);
  console.log(`  员工端:   http://localhost:${PORT}/employee/`);
  console.log(`  行政端:   http://localhost:${PORT}/admin/`);
  console.log(`========================================\n`);
});

module.exports = app;
