const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = require('./db');

const app = express();
const PORT = 8911;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleString()}] ${req.method} ${req.url}`);
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ code: 0, message: 'ok', data: { timestamp: new Date().toISOString() } });
});

const routeRoutes = require('./routes/routes');
const scheduleRoutes = require('./routes/schedules');
const employeeRoutes = require('./routes/employees');
const reservationRoutes = require('./routes/reservations');
const adminRoutes = require('./routes/admin');
const simulateRoutes = require('./routes/simulate');
const configRoutes = require('./routes/configs');

app.use('/api/routes', routeRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/reservations', reservationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/simulate', simulateRoutes);
app.use('/api/configs', configRoutes);

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ code: 500, message: err.message || '服务器内部错误' });
});

app.use((req, res) => {
  res.status(404).json({ code: 404, message: '接口不存在' });
});

app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  企业班车管理系统 - 后端服务`);
  console.log(`  运行端口: ${PORT}`);
  console.log(`  API地址: http://localhost:${PORT}/api`);
  console.log(`========================================\n`);
});

module.exports = app;
