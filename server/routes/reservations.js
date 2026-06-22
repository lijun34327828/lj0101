const express = require('express');
const dayjs = require('dayjs');
const { run, get, all, db } = require('../db');

const router = express.Router();

async function getCancelBeforeMinutes() {
  const config = await get("SELECT config_value FROM system_configs WHERE config_key = 'cancel_before_minutes'");
  return config ? parseInt(config.config_value) : 30;
}

async function canCancelReservation(scheduleDate, departureTime) {
  const cancelBeforeMinutes = await getCancelBeforeMinutes();
  const departureDateTime = dayjs(`${scheduleDate} ${departureTime}`);
  const now = dayjs();
  const diffMinutes = departureDateTime.diff(now, 'minute');
  return diffMinutes > cancelBeforeMinutes;
}

router.get('/', async (req, res) => {
  const { employee_id, employee_no, schedule_id, date, status } = req.query;
  let sql = `
    SELECT r.*, s.capacity, s.route_id,
           r.start_point, r.end_point
    FROM reservations r
    LEFT JOIN schedules s ON r.schedule_id = s.id
    WHERE 1=1
  `;
  const params = [];
  if (employee_id) {
    sql += ' AND r.employee_id = ?';
    params.push(employee_id);
  }
  if (employee_no) {
    sql += ' AND r.employee_no = ?';
    params.push(employee_no);
  }
  if (schedule_id) {
    sql += ' AND r.schedule_id = ?';
    params.push(schedule_id);
  }
  if (date) {
    sql += ' AND r.schedule_date = ?';
    params.push(date);
  }
  if (status !== undefined) {
    sql += ' AND r.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY r.schedule_date DESC, r.departure_time DESC, r.id DESC';
  const reservations = await all(sql, params);
  res.json({ code: 0, data: reservations });
});

router.get('/:id', async (req, res) => {
  const reservation = await get(`
    SELECT r.*, s.capacity, s.route_id,
           r.start_point, r.end_point
    FROM reservations r
    LEFT JOIN schedules s ON r.schedule_id = s.id
    WHERE r.id = ?
  `, [req.params.id]);
  if (!reservation) {
    return res.json({ code: 404, message: '预约不存在' });
  }
  res.json({ code: 0, data: reservation });
});

router.post('/', async (req, res) => {
  const { schedule_id, employee_id, employee_no } = req.body;
  if (!schedule_id || !employee_id) {
    return res.json({ code: 400, message: '参数不完整' });
  }

  const schedule = await get(`
    SELECT s.*, r.name as route_name, r.start_point, r.end_point
    FROM schedules s
    LEFT JOIN routes r ON s.route_id = r.id
    WHERE s.id = ?
  `, [schedule_id]);

  if (!schedule) {
    return res.json({ code: 404, message: '班次不存在' });
  }

  if (schedule.status !== 1) {
    return res.json({ code: 400, message: '该班次已停用' });
  }

  const now = dayjs();
  const departureTime = dayjs(`${schedule.schedule_date} ${schedule.departure_time}`);
  if (now.isAfter(departureTime)) {
    return res.json({ code: 400, message: '该班次已发车，无法预约' });
  }

  if (schedule.booked_count >= schedule.capacity) {
    return res.json({ code: 400, message: '该班次已满员，无法预约' });
  }

  const existingReservation = await get(`
    SELECT * FROM reservations
    WHERE employee_id = ? AND schedule_id = ? AND status = 1
  `, [employee_id, schedule_id]);

  if (existingReservation) {
    return res.json({ code: 400, message: '您已预约该班次，请勿重复预约' });
  }

  const employee = await get('SELECT * FROM employees WHERE id = ?', [employee_id]);
  if (!employee) {
    return res.json({ code: 404, message: '员工不存在' });
  }

  try {
    const result = await run(`
      INSERT INTO reservations (
        schedule_id, employee_id, employee_no, employee_name,
        route_name, schedule_date, departure_time,
        start_point, end_point, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      schedule_id, employee_id, employee.employee_no, employee.name,
      schedule.route_name, schedule.schedule_date, schedule.departure_time,
      schedule.start_point, schedule.end_point, 1
    ]);

    await run('UPDATE schedules SET booked_count = booked_count + 1 WHERE id = ?', [schedule_id]);

    res.json({
      code: 0,
      message: '预约成功',
      data: {
        id: result.lastID,
        remaining_seats: schedule.capacity - schedule.booked_count - 1
      }
    });
  } catch (err) {
    res.json({ code: 500, message: '预约失败：' + err.message });
  }
});

router.post('/cancel/:id', async (req, res) => {
  const reservation = await get(`
    SELECT r.*, s.capacity
    FROM reservations r
    LEFT JOIN schedules s ON r.schedule_id = s.id
    WHERE r.id = ?
  `, [req.params.id]);

  if (!reservation) {
    return res.json({ code: 404, message: '预约不存在' });
  }

  if (reservation.status !== 1) {
    return res.json({ code: 400, message: '该预约状态不可取消' });
  }

  const canCancel = await canCancelReservation(reservation.schedule_date, reservation.departure_time);
  if (!canCancel) {
    const cancelBeforeMinutes = await getCancelBeforeMinutes();
    return res.json({
      code: 400,
      message: `发车前${cancelBeforeMinutes}分钟内不可取消预约`
    });
  }

  try {
    const cancelTime = dayjs().format('YYYY-MM-DD HH:mm:ss');
    await run(`
      UPDATE reservations SET status = 0, cancel_time = ?
      WHERE id = ?
    `, [cancelTime, req.params.id]);

    await run('UPDATE schedules SET booked_count = booked_count - 1 WHERE id = ?', [reservation.schedule_id]);

    res.json({ code: 0, message: '取消成功' });
  } catch (err) {
    res.json({ code: 500, message: '取消失败：' + err.message });
  }
});

router.get('/employee/:employee_no/list', async (req, res) => {
  const { status, date_from, date_to } = req.query;
  let sql = `
    SELECT r.*, s.capacity, s.booked_count,
           r.start_point, r.end_point
    FROM reservations r
    LEFT JOIN schedules s ON r.schedule_id = s.id
    WHERE r.employee_no = ?
  `;
  const params = [req.params.employee_no];
  if (status !== undefined) {
    sql += ' AND r.status = ?';
    params.push(status);
  }
  if (date_from) {
    sql += ' AND r.schedule_date >= ?';
    params.push(date_from);
  }
  if (date_to) {
    sql += ' AND r.schedule_date <= ?';
    params.push(date_to);
  }
  sql += ' ORDER BY r.schedule_date DESC, r.departure_time DESC';
  const reservations = await all(sql, params);
  const reservationsWithRemaining = reservations.map(r => ({
    ...r,
    remaining_seats: r.capacity - r.booked_count
  }));
  res.json({ code: 0, data: reservationsWithRemaining });
});

router.get('/schedule/:schedule_id/passengers', async (req, res) => {
  const passengers = await all(`
    SELECT * FROM reservations
    WHERE schedule_id = ? AND status = 1
    ORDER BY id
  `, [req.params.schedule_id]);
  res.json({ code: 0, data: passengers });
});

router.post('/checkin/:id', async (req, res) => {
  const reservation = await get('SELECT * FROM reservations WHERE id = ?', [req.params.id]);
  if (!reservation) {
    return res.json({ code: 404, message: '预约不存在' });
  }
  if (reservation.status !== 1) {
    return res.json({ code: 400, message: '该预约已取消，无法核销' });
  }
  if (reservation.checked_in === 1) {
    return res.json({ code: 400, message: '已核销，请勿重复操作' });
  }
  const checkInTime = dayjs().format('YYYY-MM-DD HH:mm:ss');
  await run(`
    UPDATE reservations SET checked_in = 1, check_in_time = ?
    WHERE id = ?
  `, [checkInTime, req.params.id]);
  res.json({ code: 0, message: '核销成功' });
});

module.exports = router;
