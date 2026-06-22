const express = require('express');
const { run, get, all } = require('../db');

const router = express.Router();

router.get('/', async (req, res) => {
  const { factory_id, department, keyword } = req.query;
  let sql = `
    SELECT e.*, f.name as factory_name
    FROM employees e
    LEFT JOIN factories f ON e.factory_id = f.id
    WHERE 1=1
  `;
  const params = [];
  if (factory_id) {
    sql += ' AND e.factory_id = ?';
    params.push(factory_id);
  }
  if (department) {
    sql += ' AND e.department = ?';
    params.push(department);
  }
  if (keyword) {
    sql += ' AND (e.name LIKE ? OR e.employee_no LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  sql += ' ORDER BY e.id DESC';
  const employees = await all(sql, params);
  res.json({ code: 0, data: employees });
});

router.get('/:id', async (req, res) => {
  const employee = await get(`
    SELECT e.*, f.name as factory_name
    FROM employees e
    LEFT JOIN factories f ON e.factory_id = f.id
    WHERE e.id = ?
  `, [req.params.id]);
  if (!employee) {
    return res.json({ code: 404, message: '员工不存在' });
  }
  res.json({ code: 0, data: employee });
});

router.get('/no/:employee_no', async (req, res) => {
  const employee = await get(`
    SELECT e.*, f.name as factory_name
    FROM employees e
    LEFT JOIN factories f ON e.factory_id = f.id
    WHERE e.employee_no = ?
  `, [req.params.employee_no]);
  if (!employee) {
    return res.json({ code: 404, message: '员工不存在' });
  }
  res.json({ code: 0, data: employee });
});

router.post('/', async (req, res) => {
  const { employee_no, name, department, phone, factory_id } = req.body;
  if (!employee_no || !name) {
    return res.json({ code: 400, message: '参数不完整' });
  }
  const result = await run(`
    INSERT INTO employees (employee_no, name, department, phone, factory_id)
    VALUES (?, ?, ?, ?, ?)
  `, [employee_no, name, department || null, phone || null, factory_id || null]);
  res.json({ code: 0, data: { id: result.lastID } });
});

router.put('/:id', async (req, res) => {
  const { name, department, phone, factory_id } = req.body;
  const result = await run(`
    UPDATE employees SET
      name = COALESCE(?, name),
      department = COALESCE(?, department),
      phone = COALESCE(?, phone),
      factory_id = COALESCE(?, factory_id)
    WHERE id = ?
  `, [name, department, phone, factory_id, req.params.id]);
  if (result.changes === 0) {
    return res.json({ code: 404, message: '员工不存在' });
  }
  res.json({ code: 0, message: '更新成功' });
});

router.delete('/:id', async (req, res) => {
  const result = await run('DELETE FROM employees WHERE id = ?', [req.params.id]);
  if (result.changes === 0) {
    return res.json({ code: 404, message: '员工不存在' });
  }
  res.json({ code: 0, message: '删除成功' });
});

module.exports = router;
