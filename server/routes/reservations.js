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

async function canJoinWaitlist(scheduleDate, departureTime) {
  return await canCancelReservation(scheduleDate, departureTime);
}

async function getWaitlistPosition(scheduleId, waitlistId) {
  const waitlist = await all(`
    SELECT id FROM waitlist
    WHERE schedule_id = ? AND status = 1
    ORDER BY id ASC
  `, [scheduleId]);
  
  const index = waitlist.findIndex(w => w.id === waitlistId);
  return index >= 0 ? index + 1 : null;
}

async function getWaitlistCount(scheduleId) {
  const result = await get(`
    SELECT COUNT(*) as count FROM waitlist
    WHERE schedule_id = ? AND status = 1
  `, [scheduleId]);
  return result ? result.count : 0;
}

async function promoteNextWaitlist(scheduleId) {
  const schedule = await get(`
    SELECT s.*, r.name as route_name, r.start_point, r.end_point
    FROM schedules s
    LEFT JOIN routes r ON s.route_id = r.id
    WHERE s.id = ?
  `, [scheduleId]);

  if (!schedule) {
    return null;
  }

  const canPromote = await canJoinWaitlist(schedule.schedule_date, schedule.departure_time);
  if (!canPromote) {
    return null;
  }

  const firstWaitlist = await get(`
    SELECT w.* FROM waitlist w
    WHERE w.schedule_id = ? AND w.status = 1
    ORDER BY w.id ASC
    LIMIT 1
  `, [scheduleId]);

  if (!firstWaitlist) {
    return null;
  }

  if (schedule.booked_count >= schedule.capacity) {
    return null;
  }

  await run(`
    INSERT INTO reservations (
      schedule_id, employee_id, employee_no, employee_name,
      route_name, schedule_date, departure_time,
      start_point, end_point, status, from_waitlist
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    scheduleId, firstWaitlist.employee_id, firstWaitlist.employee_no, firstWaitlist.employee_name,
    schedule.route_name, schedule.schedule_date, schedule.departure_time,
    schedule.start_point, schedule.end_point, 1, 1
  ]);

  await run('UPDATE schedules SET booked_count = booked_count + 1 WHERE id = ?', [scheduleId]);

  await run('UPDATE waitlist SET status = 2, promoted_at = ? WHERE id = ?', 
    [dayjs().format('YYYY-MM-DD HH:mm:ss'), firstWaitlist.id]);

  return firstWaitlist;
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

  const employee = await get('SELECT * FROM employees WHERE id = ?', [employee_id]);
  if (!employee) {
    return res.json({ code: 404, message: '员工不存在' });
  }

  const existingReservation = await get(`
    SELECT * FROM reservations
    WHERE employee_id = ? AND schedule_id = ? AND status = 1
  `, [employee_id, schedule_id]);

  if (existingReservation) {
    return res.json({ code: 400, message: '您已预约该班次，请勿重复预约' });
  }

  const existingWaitlist = await get(`
    SELECT * FROM waitlist
    WHERE employee_id = ? AND schedule_id = ? AND status = 1
  `, [employee_id, schedule_id]);

  if (existingWaitlist) {
    const position = await getWaitlistPosition(schedule_id, existingWaitlist.id);
    return res.json({ 
      code: 400, 
      message: `您已在该班次候补队列中，当前排在第${position}位`,
      data: { waitlist_id: existingWaitlist.id, position }
    });
  }

  if (schedule.booked_count >= schedule.capacity) {
    const canJoin = await canJoinWaitlist(schedule.schedule_date, schedule.departure_time);
    if (!canJoin) {
      const cancelBeforeMinutes = await getCancelBeforeMinutes();
      return res.json({ 
        code: 400, 
        message: `该班次已满员，且发车前${cancelBeforeMinutes}分钟内无法加入候补` 
      });
    }

    try {
      const result = await run(`
        INSERT INTO waitlist (
          schedule_id, employee_id, employee_no, employee_name,
          route_name, schedule_date, departure_time,
          start_point, end_point, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        schedule_id, employee_id, employee.employee_no, employee.name,
        schedule.route_name, schedule.schedule_date, schedule.departure_time,
        schedule.start_point, schedule.end_point, 1
      ]);

      const position = await getWaitlistPosition(schedule_id, result.lastID);

      res.json({
        code: 0,
        message: `该班次已满员，已加入候补队列，当前排在第${position}位`,
        data: {
          waitlist: true,
          waitlist_id: result.lastID,
          position: position
        }
      });
      return;
    } catch (err) {
      res.json({ code: 500, message: '加入候补失败：' + err.message });
      return;
    }
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

    const promoted = await promoteNextWaitlist(reservation.schedule_id);

    if (promoted) {
      res.json({ 
        code: 0, 
        message: '取消成功，候补队列第一位已自动转正',
        data: {
          promoted_employee: promoted.employee_name,
          promoted_employee_no: promoted.employee_no
        }
      });
    } else {
      res.json({ code: 0, message: '取消成功' });
    }
  } catch (err) {
    res.json({ code: 500, message: '取消失败：' + err.message });
  }
});

router.post('/waitlist/cancel/:id', async (req, res) => {
  const waitlist = await get('SELECT * FROM waitlist WHERE id = ?', [req.params.id]);

  if (!waitlist) {
    return res.json({ code: 404, message: '候补记录不存在' });
  }

  if (waitlist.status !== 1) {
    return res.json({ code: 400, message: '该候补状态不可取消' });
  }

  const canCancel = await canCancelReservation(waitlist.schedule_date, waitlist.departure_time);
  if (!canCancel) {
    const cancelBeforeMinutes = await getCancelBeforeMinutes();
    return res.json({
      code: 400,
      message: `发车前${cancelBeforeMinutes}分钟内不可取消候补`
    });
  }

  try {
    const cancelTime = dayjs().format('YYYY-MM-DD HH:mm:ss');
    await run(`
      UPDATE waitlist SET status = 0, cancel_time = ?
      WHERE id = ?
    `, [cancelTime, req.params.id]);

    res.json({ code: 0, message: '候补取消成功' });
  } catch (err) {
    res.json({ code: 500, message: '取消候补失败：' + err.message });
  }
});

router.get('/waitlist/schedule/:schedule_id', async (req, res) => {
  const waitlist = await all(`
    SELECT * FROM waitlist
    WHERE schedule_id = ? AND status = 1
    ORDER BY id ASC
  `, [req.params.schedule_id]);

  const waitlistWithPosition = waitlist.map((w, index) => ({
    ...w,
    position: index + 1
  }));

  res.json({ 
    code: 0, 
    data: waitlistWithPosition,
    count: waitlistWithPosition.length
  });
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

  let waitlistSql = `
    SELECT w.*, s.capacity, s.booked_count
    FROM waitlist w
    LEFT JOIN schedules s ON w.schedule_id = s.id
    WHERE w.employee_no = ?
  `;
  const waitlistParams = [req.params.employee_no];
  if (date_from) {
    waitlistSql += ' AND w.schedule_date >= ?';
    waitlistParams.push(date_from);
  }
  if (date_to) {
    waitlistSql += ' AND w.schedule_date <= ?';
    waitlistParams.push(date_to);
  }
  waitlistSql += ' ORDER BY w.schedule_date DESC, w.departure_time DESC';
  const waitlistItems = await all(waitlistSql, waitlistParams);

  for (const w of waitlistItems) {
    const pos = await getWaitlistPosition(w.schedule_id, w.id);
    w.position = pos;
  }

  const allItems = [];

  for (const r of reservations) {
    let statusText = '';
    if (r.status === 1) {
      statusText = '已预约';
    } else if (r.status === 0) {
      statusText = '已取消';
    }
    allItems.push({
      ...r,
      type: 'reservation',
      status_text: statusText,
      remaining_seats: r.capacity - r.booked_count
    });
  }

  for (const w of waitlistItems) {
    let statusText = '';
    if (w.status === 1) {
      statusText = `候补中第${w.position}位`;
    } else if (w.status === 0) {
      statusText = '已取消候补';
    } else if (w.status === 2) {
      statusText = '已转正';
    }
    allItems.push({
      ...w,
      type: 'waitlist',
      status_text: statusText,
      waitlist_id: w.id,
      remaining_seats: w.capacity - w.booked_count
    });
  }

  allItems.sort((a, b) => {
    if (a.schedule_date !== b.schedule_date) {
      return a.schedule_date > b.schedule_date ? -1 : 1;
    }
    if (a.departure_time !== b.departure_time) {
      return a.departure_time > b.departure_time ? -1 : 1;
    }
    if (a.type !== b.type) {
      return a.type === 'reservation' ? -1 : 1;
    }
    return 0;
  });

  res.json({ code: 0, data: allItems });
});

router.get('/schedule/:schedule_id/passengers', async (req, res) => {
  const passengers = await all(`
    SELECT * FROM reservations
    WHERE schedule_id = ? AND status = 1
    ORDER BY id
  `, [req.params.schedule_id]);
  
  const waitlistCount = await getWaitlistCount(req.params.schedule_id);
  
  res.json({ 
    code: 0, 
    data: passengers,
    waitlist_count: waitlistCount
  });
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
