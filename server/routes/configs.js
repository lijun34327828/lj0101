const express = require('express');
const { run, get, all } = require('../db');

const router = express.Router();

router.get('/', async (req, res) => {
  const configs = await all('SELECT * FROM system_configs ORDER BY id');
  res.json({ code: 0, data: configs });
});

router.get('/:key', async (req, res) => {
  const config = await get('SELECT * FROM system_configs WHERE config_key = ?', [req.params.key]);
  if (!config) {
    return res.json({ code: 404, message: '配置不存在' });
  }
  res.json({ code: 0, data: config });
});

router.put('/:key', async (req, res) => {
  const { config_value, description } = req.body;
  const result = await run(`
    UPDATE system_configs SET
      config_value = COALESCE(?, config_value),
      description = COALESCE(?, description),
      updated_at = datetime('now', 'localtime')
    WHERE config_key = ?
  `, [config_value, description, req.params.key]);
  if (result.changes === 0) {
    return res.json({ code: 404, message: '配置不存在' });
  }
  res.json({ code: 0, message: '更新成功' });
});

module.exports = router;
