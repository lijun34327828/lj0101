const express = require('express');
const { run, get, all } = require('../db');

const router = express.Router();

router.get('/', async (req, res) => {
  const { factory_id, status } = req.query;
  let sql = `
    SELECT r.*, f.name as factory_name
    FROM routes r
    LEFT JOIN factories f ON r.factory_id = f.id
    WHERE 1=1
  `;
  const params = [];
  if (factory_id) {
    sql += ' AND r.factory_id = ?';
    params.push(factory_id);
  }
  if (status !== undefined) {
    sql += ' AND r.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY r.id DESC';
  const routes = await all(sql, params);
  res.json({ code: 0, data: routes });
});

router.get('/:id', async (req, res) => {
  const route = await get(`
    SELECT r.*, f.name as factory_name
    FROM routes r
    LEFT JOIN factories f ON r.factory_id = f.id
    WHERE r.id = ?
  `, [req.params.id]);
  if (!route) {
    return res.json({ code: 404, message: '线路不存在' });
  }
  res.json({ code: 0, data: route });
});

router.post('/', async (req, res) => {
  const { name, factory_id, start_point, end_point, departure_time, return_time, capacity } = req.body;
  if (!name || !factory_id || !start_point || !end_point || !departure_time) {
    return res.json({ code: 400, message: '参数不完整' });
  }
  const result = await run(`
    INSERT INTO routes (name, factory_id, start_point, end_point, departure_time, return_time, capacity)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [name, factory_id, start_point, end_point, departure_time, return_time || null, capacity || 45]);
  res.json({ code: 0, data: { id: result.lastID } });
});

router.put('/:id', async (req, res) => {
  const { name, factory_id, start_point, end_point, departure_time, return_time, capacity, status } = req.body;
  const result = await run(`
    UPDATE routes SET
      name = COALESCE(?, name),
      factory_id = COALESCE(?, factory_id),
      start_point = COALESCE(?, start_point),
      end_point = COALESCE(?, end_point),
      departure_time = COALESCE(?, departure_time),
      return_time = ?,
      capacity = COALESCE(?, capacity),
      status = COALESCE(?, status)
    WHERE id = ?
  `, [name, factory_id, start_point, end_point, departure_time, return_time, capacity, status, req.params.id]);
  if (result.changes === 0) {
    return res.json({ code: 404, message: '线路不存在' });
  }
  res.json({ code: 0, message: '更新成功' });
});

router.delete('/:id', async (req, res) => {
  const result = await run('DELETE FROM routes WHERE id = ?', [req.params.id]);
  if (result.changes === 0) {
    return res.json({ code: 404, message: '线路不存在' });
  }
  res.json({ code: 0, message: '删除成功' });
});

router.get('/factories/list', async (req, res) => {
  const factories = await all('SELECT * FROM factories ORDER BY id');
  res.json({ code: 0, data: factories });
});

router.get('/vehicles/list', async (req, res) => {
  const vehicles = await all('SELECT * FROM vehicles WHERE status = 1 ORDER BY id');
  res.json({ code: 0, data: vehicles });
});

module.exports = router;
