const express = require('express');
const dayjs = require('dayjs');
const { run, get, all, db } = require('../db');

const router = express.Router();

async function generateDailyLedger(date) {
  const schedules = await all(`
    SELECT s.*, r.name as route_name, r.factory_id, f.name as factory_name
    FROM schedules s
    LEFT JOIN routes r ON s.route_id = r.id
    LEFT JOIN factories f ON r.factory_id = f.id
    WHERE s.schedule_date = ?
  `, [date]);

  for (const schedule of schedules) {
    const reservationCount = await get(`
      SELECT COUNT(*) as count FROM reservations
      WHERE schedule_id = ? AND status = 1
    `, [schedule.id]);

    const checkInCount = await get(`
      SELECT COUNT(*) as count FROM reservations
      WHERE schedule_id = ? AND status = 1 AND checked_in = 1
    `, [schedule.id]);

    const occupancyRate = schedule.capacity > 0
      ? Math.round((reservationCount.count / schedule.capacity) * 10000) / 100
      : 0;

    const existing = await get('SELECT id FROM daily_ledgers WHERE ledger_date = ? AND schedule_id = ?', [date, schedule.id]);

    if (existing) {
      await run(`
        UPDATE daily_ledgers SET
          route_name = ?, factory_id = ?, factory_name = ?,
          vehicle_id = ?, capacity = ?, reservation_count = ?,
          check_in_count = ?, occupancy_rate = ?
        WHERE id = ?
      `, [
        schedule.route_name, schedule.factory_id, schedule.factory_name,
        schedule.vehicle_id, schedule.capacity, reservationCount.count,
        checkInCount.count, occupancyRate, existing.id
      ]);
    } else {
      await run(`
        INSERT INTO daily_ledgers (
          ledger_date, route_id, route_name, factory_id, factory_name,
          schedule_id, vehicle_id, capacity, reservation_count,
          check_in_count, occupancy_rate
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        date, schedule.route_id, schedule.route_name, schedule.factory_id, schedule.factory_name,
        schedule.id, schedule.vehicle_id, schedule.capacity,
        reservationCount.count, checkInCount.count, occupancyRate
      ]);
    }
  }

  return schedules.length;
}

router.get('/ledgers', async (req, res) => {
  const { date_from, date_to, factory_id, route_id } = req.query;
  let sql = `
    SELECT dl.* FROM daily_ledgers dl
    WHERE 1=1
  `;
  const params = [];
  if (date_from) {
    sql += ' AND dl.ledger_date >= ?';
    params.push(date_from);
  }
  if (date_to) {
    sql += ' AND dl.ledger_date <= ?';
    params.push(date_to);
  }
  if (factory_id) {
    sql += ' AND dl.factory_id = ?';
    params.push(factory_id);
  }
  if (route_id) {
    sql += ' AND dl.route_id = ?';
    params.push(route_id);
  }
  sql += ' ORDER BY dl.ledger_date DESC, dl.id';
  const ledgers = await all(sql, params);
  res.json({ code: 0, data: ledgers });
});

router.post('/ledgers/generate', async (req, res) => {
  const { date } = req.body;
  const targetDate = date || dayjs().format('YYYY-MM-DD');
  const count = await generateDailyLedger(targetDate);
  res.json({ code: 0, message: `已生成${count}条台账记录`, data: { count } });
});

router.get('/ledgers/export', async (req, res) => {
  const { date_from, date_to, factory_id, route_id } = req.query;
  let sql = `
    SELECT dl.* FROM daily_ledgers dl
    WHERE 1=1
  `;
  const params = [];
  if (date_from) {
    sql += ' AND dl.ledger_date >= ?';
    params.push(date_from);
  }
  if (date_to) {
    sql += ' AND dl.ledger_date <= ?';
    params.push(date_to);
  }
  if (factory_id) {
    sql += ' AND dl.factory_id = ?';
    params.push(factory_id);
  }
  if (route_id) {
    sql += ' AND dl.route_id = ?';
    params.push(route_id);
  }
  sql += ' ORDER BY dl.ledger_date, dl.route_id';
  const ledgers = await all(sql, params);

  let csv = '\uFEFF日期,厂区,线路,班次ID,车辆ID,核定载客,预约人数,核销人数,上座率(%)\n';
  ledgers.forEach(l => {
    csv += `${l.ledger_date},${l.factory_name || '-'},${l.route_name},${l.schedule_id},${l.vehicle_id || '-'},${l.capacity},${l.reservation_count},${l.check_in_count},${l.occupancy_rate}\n`;
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="ledger_export_${dayjs().format('YYYYMMDDHHmmss')}.csv"`);
  res.send(csv);
});

router.get('/statistics/summary', async (req, res) => {
  const { date } = req.query;
  const targetDate = date || dayjs().format('YYYY-MM-DD');
  const stats = await get(`
    SELECT
      COUNT(*) as total_schedules,
      SUM(capacity) as total_capacity,
      SUM(reservation_count) as total_reservations,
      SUM(check_in_count) as total_check_ins,
      AVG(occupancy_rate) as avg_occupancy_rate
    FROM daily_ledgers
    WHERE ledger_date = ?
  `, [targetDate]);

  const byFactory = await all(`
    SELECT
      factory_id, factory_name,
      COUNT(*) as schedule_count,
      SUM(capacity) as total_capacity,
      SUM(reservation_count) as total_reservations,
      AVG(occupancy_rate) as avg_occupancy_rate
    FROM daily_ledgers
    WHERE ledger_date = ?
    GROUP BY factory_id
    ORDER BY factory_id
  `, [targetDate]);

  res.json({
    code: 0,
    data: {
      date: targetDate,
      summary: stats || {},
      by_factory: byFactory
    }
  });
});

router.get('/alerts', async (req, res) => {
  const { status } = req.query;
  let sql = 'SELECT * FROM capacity_alerts WHERE 1=1';
  const params = [];
  if (status !== undefined) {
    sql += ' AND status = ?';
    params.push(status);
  }
  sql += ' ORDER BY id DESC';
  const alerts = await all(sql, params);
  res.json({ code: 0, data: alerts });
});

router.post('/alerts/check', async (req, res) => {
  const config = await get("SELECT config_value FROM system_configs WHERE config_key = 'occupancy_threshold'");
  const threshold = config ? parseFloat(config.config_value) : 60;

  const alertDaysConfig = await get("SELECT config_value FROM system_configs WHERE config_key = 'alert_days'");
  const alertDays = alertDaysConfig ? parseInt(alertDaysConfig.config_value) : 7;

  const endDate = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
  const startDate = dayjs().subtract(alertDays, 'day').format('YYYY-MM-DD');

  const routeStats = await all(`
    SELECT
      route_id, route_name, factory_id, factory_name,
      AVG(occupancy_rate) as avg_occupancy_rate,
      COUNT(*) as days_count
    FROM daily_ledgers
    WHERE ledger_date >= ? AND ledger_date <= ?
    GROUP BY route_id
    HAVING days_count >= ? AND avg_occupancy_rate < ?
  `, [startDate, endDate, Math.ceil(alertDays * 0.6), threshold]);

  for (const stat of routeStats) {
    await run(`
      INSERT INTO capacity_alerts (
        route_id, route_name, factory_id, factory_name,
        avg_occupancy_rate, threshold, alert_type,
        period_start, period_end
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      stat.route_id, stat.route_name, stat.factory_id, stat.factory_name,
      stat.avg_occupancy_rate, threshold, 'low_occupancy',
      startDate, endDate
    ]);
  }

  res.json({
    code: 0,
    message: `检测到${routeStats.length}条低上座率告警`,
    data: { count: routeStats.length, alerts: routeStats }
  });
});

router.post('/alerts/:id/handle', async (req, res) => {
  const result = await run('UPDATE capacity_alerts SET status = 1 WHERE id = ?', [req.params.id]);
  if (result.changes === 0) {
    return res.json({ code: 404, message: '告警不存在' });
  }
  res.json({ code: 0, message: '已处理' });
});

router.get('/routes/occupancy-trend', async (req, res) => {
  const { route_id, days = 7 } = req.query;
  const endDate = dayjs();
  const startDate = endDate.subtract(days - 1, 'day').format('YYYY-MM-DD');

  let sql = `
    SELECT ledger_date, route_id, route_name,
           AVG(occupancy_rate) as avg_occupancy_rate,
           SUM(reservation_count) as total_reservations
    FROM daily_ledgers
    WHERE ledger_date >= ?
  `;
  const params = [startDate];
  if (route_id) {
    sql += ' AND route_id = ?';
    params.push(route_id);
  }
  sql += ' GROUP BY ledger_date, route_id ORDER BY ledger_date';

  const data = await all(sql, params);
  res.json({ code: 0, data });
});

module.exports = router;
