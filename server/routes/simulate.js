const express = require('express');
const dayjs = require('dayjs');
const { run, get, all, db } = require('../db');

const router = express.Router();

router.post('/full-capacity', async (req, res) => {
  const { schedule_id } = req.body;
  if (!schedule_id) {
    return res.json({ code: 400, message: '请提供班次ID' });
  }

  const schedule = await get(`
    SELECT s.*, r.name as route_name
    FROM schedules s
    LEFT JOIN routes r ON s.route_id = r.id
    WHERE s.id = ?
  `, [schedule_id]);

  if (!schedule) {
    return res.json({ code: 404, message: '班次不存在' });
  }

  const remaining = schedule.capacity - schedule.booked_count;
  if (remaining <= 0) {
    return res.json({ code: 0, message: '该班次已满员', data: { filled: 0, was_full: true } });
  }

  try {
    let filled = 0;
    for (let i = 0; i < remaining; i++) {
      const testEmpNo = `SIM${String(i + 1).padStart(4, '0')}`;
      await run(`
        INSERT INTO reservations (
          schedule_id, employee_id, employee_no, employee_name,
          route_name, schedule_date, departure_time,
          start_point, end_point, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        schedule_id, 9999 + i, testEmpNo, `模拟用户${i + 1}`,
        schedule.route_name, schedule.schedule_date, schedule.departure_time,
        '模拟起点', '模拟终点', 1
      ]);
      filled++;
    }

    await run('UPDATE schedules SET booked_count = ? WHERE id = ?', [schedule.capacity, schedule_id]);

    res.json({
      code: 0,
      message: `已填充${remaining}个模拟预约，班次现已满员`,
      data: { filled: remaining, was_full: false }
    });
  } catch (err) {
    res.json({ code: 500, message: '模拟失败：' + err.message });
  }
});

router.post('/near-departure-cancel', async (req, res) => {
  const { schedule_id, minutes_before = 10 } = req.body;
  if (!schedule_id) {
    return res.json({ code: 400, message: '请提供班次ID' });
  }

  const schedule = await get(`
    SELECT s.*, r.name as route_name
    FROM schedules s
    LEFT JOIN routes r ON s.route_id = r.id
    WHERE s.id = ?
  `, [schedule_id]);

  if (!schedule) {
    return res.json({ code: 404, message: '班次不存在' });
  }

  const config = await get("SELECT config_value FROM system_configs WHERE config_key = 'cancel_before_minutes'");
  const cancelBefore = config ? parseInt(config.config_value) : 30;

  const reservation = await get(`
    SELECT * FROM reservations
    WHERE schedule_id = ? AND status = 1 AND employee_no LIKE ?
    ORDER BY id LIMIT 1
  `, [schedule_id, 'SIM%']);

  if (!reservation) {
    return res.json({ code: 400, message: '该班次没有可测试的模拟预约' });
  }

  const canCancel = minutes_before > cancelBefore;

  res.json({
    code: 0,
    message: canCancel ? '当前时间可以取消' : '已进入禁止取消时段，无法取消',
    data: {
      schedule_id,
      minutes_before_departure: minutes_before,
      cancel_limit_minutes: cancelBefore,
      can_cancel: canCancel,
      test_reservation_id: reservation.id
    }
  });
});

router.post('/reset-test-data', async (req, res) => {
  const { schedule_id } = req.body;

  let deletedCount = 0;

  if (schedule_id) {
    const reservations = await all(`
      SELECT id FROM reservations WHERE schedule_id = ? AND employee_no LIKE ?
    `, [schedule_id, 'SIM%']);

    for (const r of reservations) {
      await run('DELETE FROM reservations WHERE id = ?', [r.id]);
      deletedCount++;
    }

    const remainingReservations = await all(`
      SELECT id FROM reservations WHERE schedule_id = ? AND status = 1
    `, [schedule_id]);

    await run('UPDATE schedules SET booked_count = ? WHERE id = ?', [remainingReservations.length, schedule_id]);
  } else {
    const simReservations = await all('SELECT id FROM reservations WHERE employee_no LIKE ?', ['SIM%']);
    for (const r of simReservations) {
      await run('DELETE FROM reservations WHERE id = ?', [r.id]);
      deletedCount++;
    }

    const allSchedules = await all('SELECT id FROM schedules');
    for (const s of allSchedules) {
      const activeReservations = await all(
        'SELECT id FROM reservations WHERE schedule_id = ? AND status = 1',
        [s.id]
      );
      await run('UPDATE schedules SET booked_count = ? WHERE id = ?', [activeReservations.length, s.id]);
    }
  }

  res.json({
    code: 0,
    message: `已清除${deletedCount}条模拟数据`,
    data: { deleted_count: deletedCount }
  });
});

router.post('/generate-history-ledgers', async (req, res) => {
  const { days = 30 } = req.body;

  let generatedCount = 0;
  for (let i = 1; i <= days; i++) {
    const date = dayjs().subtract(i, 'day').format('YYYY-MM-DD');
    const schedules = await all(`
      SELECT s.*, r.name as route_name, r.factory_id, f.name as factory_name
      FROM schedules s
      LEFT JOIN routes r ON s.route_id = r.id
      LEFT JOIN factories f ON r.factory_id = f.id
      WHERE s.schedule_date = ?
    `, [date]);

    if (schedules.length > 0) {
      for (const schedule of schedules) {
        const randomRate = 0.3 + Math.random() * 0.6;
        const reservationCount = Math.floor(schedule.capacity * randomRate);
        const checkInCount = Math.floor(reservationCount * (0.8 + Math.random() * 0.2));
        const occupancyRate = Math.round(randomRate * 10000) / 100;

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
            schedule.vehicle_id, schedule.capacity,
            reservationCount, checkInCount, occupancyRate, existing.id
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
            reservationCount, checkInCount, occupancyRate
          ]);
        }
        generatedCount++;
      }
    }
  }

  res.json({
    code: 0,
    message: `已生成${generatedCount}条历史台账记录`,
    data: { count: generatedCount }
  });
});

module.exports = router;
