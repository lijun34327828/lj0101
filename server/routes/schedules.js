const express = require('express');
const dayjs = require('dayjs');
const { run, get, all } = require('../db');

const router = express.Router();

async function getWaitlistCount(scheduleId) {
  const result = await get(`
    SELECT COUNT(*) as count FROM waitlist
    WHERE schedule_id = ? AND status = 1
  `, [scheduleId]);
  return result ? result.count : 0;
}

router.get('/', async (req, res) => {
  const { date, route_id, factory_id } = req.query;
  let sql = `
    SELECT s.*, r.name as route_name, r.start_point, r.end_point,
           r.factory_id, f.name as factory_name,
           v.plate_number, v.driver_name
    FROM schedules s
    LEFT JOIN routes r ON s.route_id = r.id
    LEFT JOIN factories f ON r.factory_id = f.id
    LEFT JOIN vehicles v ON s.vehicle_id = v.id
    WHERE 1=1
  `;
  const params = [];
  if (date) {
    sql += ' AND s.schedule_date = ?';
    params.push(date);
  }
  if (route_id) {
    sql += ' AND s.route_id = ?';
    params.push(route_id);
  }
  if (factory_id) {
    sql += ' AND r.factory_id = ?';
    params.push(factory_id);
  }
  sql += ' ORDER BY s.schedule_date, s.departure_time';
  const schedules = await all(sql, params);
  
  for (const s of schedules) {
    s.remaining_seats = s.capacity - s.booked_count;
    s.waitlist_count = await getWaitlistCount(s.id);
  }
  
  res.json({ code: 0, data: schedules });
});

router.get('/:id', async (req, res) => {
  const schedule = await get(`
    SELECT s.*, r.name as route_name, r.start_point, r.end_point,
           r.factory_id, f.name as factory_name,
           v.plate_number, v.driver_name
    FROM schedules s
    LEFT JOIN routes r ON s.route_id = r.id
    LEFT JOIN factories f ON r.factory_id = f.id
    LEFT JOIN vehicles v ON s.vehicle_id = v.id
    WHERE s.id = ?
  `, [req.params.id]);
  if (!schedule) {
    return res.json({ code: 404, message: '班次不存在' });
  }
  const waitlistCount = await getWaitlistCount(req.params.id);
  const scheduleWithRemaining = {
    ...schedule,
    remaining_seats: schedule.capacity - schedule.booked_count,
    waitlist_count: waitlistCount
  };
  res.json({ code: 0, data: scheduleWithRemaining });
});

router.post('/', async (req, res) => {
  const { route_id, vehicle_id, schedule_date, departure_time, capacity } = req.body;
  if (!route_id || !schedule_date || !departure_time) {
    return res.json({ code: 400, message: '参数不完整' });
  }
  const route = await get('SELECT * FROM routes WHERE id = ?', [route_id]);
  if (!route) {
    return res.json({ code: 404, message: '线路不存在' });
  }
  const result = await run(`
    INSERT INTO schedules (route_id, vehicle_id, schedule_date, departure_time, capacity)
    VALUES (?, ?, ?, ?, ?)
  `, [route_id, vehicle_id || null, schedule_date, departure_time, capacity || route.capacity]);
  res.json({ code: 0, data: { id: result.lastID } });
});

router.put('/:id', async (req, res) => {
  const { vehicle_id, capacity, status } = req.body;
  const result = await run(`
    UPDATE schedules SET
      vehicle_id = COALESCE(?, vehicle_id),
      capacity = COALESCE(?, capacity),
      status = COALESCE(?, status)
    WHERE id = ?
  `, [vehicle_id, capacity, status, req.params.id]);
  if (result.changes === 0) {
    return res.json({ code: 404, message: '班次不存在' });
  }
  res.json({ code: 0, message: '更新成功' });
});

router.delete('/:id', async (req, res) => {
  const result = await run('DELETE FROM schedules WHERE id = ?', [req.params.id]);
  if (result.changes === 0) {
    return res.json({ code: 404, message: '班次不存在' });
  }
  res.json({ code: 0, message: '删除成功' });
});

router.post('/batch/generate', async (req, res) => {
  const { route_id, start_date, end_date, vehicle_id } = req.body;
  if (!route_id || !start_date || !end_date) {
    return res.json({ code: 400, message: '参数不完整' });
  }
  const route = await get('SELECT * FROM routes WHERE id = ?', [route_id]);
  if (!route) {
    return res.json({ code: 404, message: '线路不存在' });
  }
  let count = 0;
  const start = dayjs(start_date);
  const end = dayjs(end_date);
  for (let d = start; d.isBefore(end) || d.isSame(end, 'day'); d = d.add(1, 'day')) {
    const dateStr = d.format('YYYY-MM-DD');
    try {
      const r = await run(`
        INSERT OR IGNORE INTO schedules (route_id, vehicle_id, schedule_date, departure_time, capacity)
        VALUES (?, ?, ?, ?, ?)
      `, [route_id, vehicle_id || null, dateStr, route.departure_time, route.capacity]);
      if (r.changes > 0) count++;
    } catch (e) {}
    if (route.return_time) {
      try {
        const r2 = await run(`
          INSERT OR IGNORE INTO schedules (route_id, vehicle_id, schedule_date, departure_time, capacity)
          VALUES (?, ?, ?, ?, ?)
        `, [route_id, vehicle_id || null, dateStr, route.return_time, route.capacity]);
        if (r2.changes > 0) count++;
      } catch (e) {}
    }
  }
  res.json({ code: 0, message: `生成了${count}个班次`, data: { count } });
});

module.exports = router;
