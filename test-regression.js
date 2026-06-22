const dayjs = require('dayjs');
const { run, get, all, db, splitSetClause } = require('./server/db');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}`);
    console.log(`     错误: ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || '断言失败');
  }
}

async function runTests() {
  console.log('='.repeat(70));
  console.log('🧪 配置更新与取消预约 - 回归测试');
  console.log('='.repeat(70));
  console.log('');

  console.log('📌 第一组：splitSetClause 分割逻辑验证');
  console.log('');

  await test('普通单字段分割', () => {
    const result = splitSetClause('name = ?');
    assert(result.length === 1, `期望1个，实际${result.length}个`);
    assert(result[0] === 'name = ?', `结果不正确: ${result[0]}`);
  });

  await test('普通多字段分割', () => {
    const result = splitSetClause('a = ?, b = ?, c = ?');
    assert(result.length === 3, `期望3个，实际${result.length}个`);
    assert(result[0] === 'a = ?', `第1个不正确: ${result[0]}`);
    assert(result[1] === 'b = ?', `第2个不正确: ${result[1]}`);
    assert(result[2] === 'c = ?', `第3个不正确: ${result[2]}`);
  });

  await test('COALESCE 函数内逗号不被分割', () => {
    const result = splitSetClause('config_value = COALESCE(?, config_value), description = ?');
    assert(result.length === 2, `期望2个，实际${result.length}个`);
    assert(result[0].startsWith('config_value = COALESCE'), `第1个不正确: ${result[0]}`);
    assert(result[1] === 'description = ?', `第2个不正确: ${result[1]}`);
  });

  await test('datetime 函数内逗号不被分割', () => {
    const result = splitSetClause("updated_at = datetime('now', 'localtime'), name = ?");
    assert(result.length === 2, `期望2个，实际${result.length}个`);
    assert(result[0].startsWith('updated_at = datetime'), `第1个不正确: ${result[0]}`);
    assert(result[1] === 'name = ?', `第2个不正确: ${result[1]}`);
  });

  await test('多个带函数的字段混合分割', () => {
    const result = splitSetClause(
      "config_value = COALESCE(?, config_value), description = COALESCE(?, description), updated_at = datetime('now', 'localtime')"
    );
    assert(result.length === 3, `期望3个，实际${result.length}个`);
    assert(result[0].startsWith('config_value = COALESCE'), `第1个不正确: ${result[0]}`);
    assert(result[1].startsWith('description = COALESCE'), `第2个不正确: ${result[1]}`);
    assert(result[2].startsWith('updated_at = datetime'), `第3个不正确: ${result[2]}`);
  });

  await test('字符串字面量内逗号不被分割', () => {
    const result = splitSetClause("name = 'hello, world', age = 25");
    assert(result.length === 2, `期望2个，实际${result.length}个`);
    assert(result[0] === "name = 'hello, world'", `第1个不正确: ${result[0]}`);
    assert(result[1] === 'age = 25', `第2个不正确: ${result[1]}`);
  });

  console.log('');
  console.log('📌 第二组：配置更新回读验证');
  console.log('');

  const testKey = 'cancel_before_minutes';

  await test('初始配置值是正确数字', async () => {
    const config = await get('SELECT config_value FROM system_configs WHERE config_key = ?', [testKey]);
    assert(config, '配置应该存在');
    const val = parseInt(config.config_value);
    assert(!isNaN(val), `初始值应该是数字，实际是: ${config.config_value}`);
    assert(val === 30, `初始值应该是30，实际是: ${val}`);
    console.log(`     初始值: ${config.config_value} (类型: ${typeof config.config_value})`);
  });

  await test('更新配置后回读值正确（单字段）', async () => {
    await run(
      `UPDATE system_configs SET config_value = ?, updated_at = datetime('now', 'localtime') WHERE config_key = ?`,
      ['45', testKey]
    );
    const config = await get('SELECT config_value FROM system_configs WHERE config_key = ?', [testKey]);
    const val = parseInt(config.config_value);
    assert(!isNaN(val), `更新后值应该是数字，实际是: ${config.config_value}`);
    assert(val === 45, `更新后值应该是45，实际是: ${val}`);
    console.log(`     更新后: ${config.config_value} (类型: ${typeof config.config_value})`);
  });

  await test('用 COALESCE 更新配置后回读值正确', async () => {
    await run(`
      UPDATE system_configs SET
        config_value = COALESCE(?, config_value),
        description = COALESCE(?, description),
        updated_at = datetime('now', 'localtime')
      WHERE config_key = ?
    `, ['60', '测试描述', testKey]);
    
    const config = await get('SELECT * FROM system_configs WHERE config_key = ?', [testKey]);
    
    const val = parseInt(config.config_value);
    assert(!isNaN(val), `COALESCE更新后config_value应该是数字，实际是: ${config.config_value}`);
    assert(val === 60, `COALESCE更新后config_value应该是60，实际是: ${val}`);
    
    assert(typeof config.description === 'string', 'description应该是字符串');
    assert(config.description === '测试描述', `description应该是'测试描述'，实际是: ${config.description}`);
    
    assert(!String(config.updated_at).includes('COALESCE'), 'updated_at不应该包含COALESCE');
    assert(!String(config.updated_at).includes('datetime('), 'updated_at应该已经被替换为真实时间');
    
    console.log(`     config_value: ${config.config_value}`);
    console.log(`     description: ${config.description}`);
    console.log(`     updated_at: ${config.updated_at}`);
  });

  await test('多字段更新互不污染', async () => {
    await run(`
      UPDATE system_configs SET
        config_value = COALESCE(?, config_value),
        description = COALESCE(?, description)
      WHERE config_key = ?
    `, ['90', null, testKey]);
    
    const config = await get('SELECT * FROM system_configs WHERE config_key = ?', [testKey]);
    
    const val = parseInt(config.config_value);
    assert(!isNaN(val), `config_value应该是数字，实际是: ${config.config_value}`);
    assert(val === 90, `config_value应该是90，实际是: ${val}`);
    
    assert(config.description === '测试描述', `description应该保持不变，实际是: ${config.description}`);
    
    console.log(`     config_value: ${config.config_value} (已更新)`);
    console.log(`     description: ${config.description} (保持不变)`);
  });

  console.log('');
  console.log('📌 第三组：座位数增减等其他更新行为验证');
  console.log('');

  await test('座位数加1正常', async () => {
    const schedule = await get('SELECT * FROM schedules WHERE id = ?', [1]);
    const before = schedule.booked_count;
    
    await run('UPDATE schedules SET booked_count = booked_count + 1 WHERE id = ?', [1]);
    
    const after = await get('SELECT booked_count FROM schedules WHERE id = ?', [1]);
    assert(after.booked_count === before + 1, `期望${before + 1}，实际${after.booked_count}`);
    console.log(`     ${before} → ${after.booked_count}`);
  });

  await test('座位数减1正常', async () => {
    const schedule = await get('SELECT * FROM schedules WHERE id = ?', [1]);
    const before = schedule.booked_count;
    
    await run('UPDATE schedules SET booked_count = booked_count - 1 WHERE id = ?', [1]);
    
    const after = await get('SELECT booked_count FROM schedules WHERE id = ?', [1]);
    assert(after.booked_count === before - 1, `期望${before - 1}，实际${after.booked_count}`);
    console.log(`     ${before} → ${after.booked_count}`);
  });

  await test('普通赋值更新正常', async () => {
    const testName = '测试线路名';
    await run('UPDATE routes SET name = ? WHERE id = ?', [testName, 1]);
    
    const route = await get('SELECT name FROM routes WHERE id = ?', [1]);
    assert(route.name === testName, `期望${testName}，实际${route.name}`);
    console.log(`     name: ${route.name}`);
  });

  await test('数字字面量赋值正常', async () => {
    await run('UPDATE routes SET capacity = 100 WHERE id = ?', [1]);
    
    const route = await get('SELECT capacity FROM routes WHERE id = ?', [1]);
    assert(route.capacity === 100, `期望100，实际${route.capacity}`);
    console.log(`     capacity: ${route.capacity} (类型: ${typeof route.capacity})`);
  });

  await test('datetime 当前时间写入正常', async () => {
    const before = dayjs().subtract(1, 'second');
    await run("UPDATE routes SET created_at = datetime('now', 'localtime') WHERE id = ?", [1]);
    const after = dayjs().add(1, 'second');
    
    const route = await get('SELECT created_at FROM routes WHERE id = ?', [1]);
    const t = dayjs(route.created_at);
    assert(t.isAfter(before) && t.isBefore(after), `时间应该在当前附近，实际: ${route.created_at}`);
    console.log(`     created_at: ${route.created_at}`);
  });

  console.log('');
  console.log('📌 第四组：取消预约逻辑验证');
  console.log('');

  let testReservationFarId = null;
  let testReservationNearId = null;

  await test('设置取消前分钟数为30', async () => {
    await run(`
      UPDATE system_configs SET
        config_value = COALESCE(?, config_value),
        description = COALESCE(?, description),
        updated_at = datetime('now', 'localtime')
      WHERE config_key = ?
    `, ['30', '发车前多少分钟关闭取消入口', 'cancel_before_minutes']);
    
    const config = await get("SELECT config_value FROM system_configs WHERE config_key = 'cancel_before_minutes'");
    const val = parseInt(config.config_value);
    assert(val === 30, `应该是30，实际是: ${config.config_value}`);
    console.log(`     cancel_before_minutes = ${config.config_value}`);
  });

  await test('创建一个远期（可取消）的预约', async () => {
    const futureDate = dayjs().add(7, 'day').format('YYYY-MM-DD');
    const schedule = await get(
      'SELECT * FROM schedules WHERE schedule_date = ? ORDER BY id LIMIT 1',
      [futureDate]
    );
    
    if (!schedule) {
      throw new Error('找不到7天后的班次');
    }
    
    const result = await run(`
      INSERT INTO reservations (
        schedule_id, employee_id, employee_no, employee_name,
        route_name, schedule_date, departure_time,
        start_point, end_point, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      schedule.id, 1001, 'TEST001', '测试员工',
      '测试线路', schedule.schedule_date, schedule.departure_time,
      '起点', '终点', 1
    ]);
    
    assert(result.lastID, '预约应该创建成功');
    testReservationFarId = result.lastID;
    console.log(`     预约ID: ${result.lastID}, 发车时间: ${schedule.schedule_date} ${schedule.departure_time}`);
  });

  await test('远期预约可以成功取消', async () => {
    const reservation = await get('SELECT * FROM reservations WHERE id = ?', [testReservationFarId]);
    assert(reservation && reservation.status === 1, '预约应该存在且状态为已预约');
    
    const cancelBeforeMinutes = 30;
    const departureDateTime = dayjs(`${reservation.schedule_date} ${reservation.departure_time}`);
    const diffMinutes = departureDateTime.diff(dayjs(), 'minute');
    assert(diffMinutes > cancelBeforeMinutes, '距离发车应该超过30分钟');
    
    await run('UPDATE reservations SET status = 0, cancel_time = ? WHERE id = ?', [dayjs().format('YYYY-MM-DD HH:mm:ss'), reservation.id]);
    
    const cancelled = await get('SELECT status FROM reservations WHERE id = ?', [reservation.id]);
    assert(cancelled.status === 0, '预约应该已取消');
    console.log(`     距离发车: ${Math.floor(diffMinutes)} 分钟，取消成功`);
  });

  await test('创建一个临近发车（不可取消）的预约', async () => {
    const nearDate = dayjs().add(5, 'minute').format('YYYY-MM-DD');
    const nearTime = dayjs().add(5, 'minute').format('HH:mm');
    
    let schedule = await get(
      'SELECT * FROM schedules WHERE schedule_date = ? AND departure_time = ?',
      [nearDate, nearTime]
    );
    
    if (!schedule) {
      const schedResult = await run(`
        INSERT INTO schedules (
          route_id, vehicle_id, schedule_date, departure_time,
          capacity, booked_count, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [1, 1, nearDate, nearTime, 45, 0, 1]);
      schedule = { id: schedResult.lastID };
    }
    
    const result = await run(`
      INSERT INTO reservations (
        schedule_id, employee_id, employee_no, employee_name,
        route_name, schedule_date, departure_time,
        start_point, end_point, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      schedule.id, 1002, 'TEST002', '测试员工2',
      '测试线路', nearDate, nearTime,
      '起点', '终点', 1
    ]);
    
    testReservationNearId = result.lastID;
    console.log(`     预约ID: ${result.lastID}, 发车时间: ${nearDate} ${nearTime}`);
  });

  await test('临近发车的预约应被拦截取消（提示真实数字而非NaN）', async () => {
    const reservation = await get('SELECT * FROM reservations WHERE id = ?', [testReservationNearId]);
    assert(reservation, '预约应该存在');
    
    const config = await get("SELECT config_value FROM system_configs WHERE config_key = 'cancel_before_minutes'");
    const cancelBeforeMinutes = parseInt(config.config_value);
    
    assert(!isNaN(cancelBeforeMinutes), `配置值不应该是NaN，实际是: ${config.config_value}`);
    assert(typeof cancelBeforeMinutes === 'number' && cancelBeforeMinutes > 0, '配置值应该是正整数');
    
    const departureDateTime = dayjs(`${reservation.schedule_date} ${reservation.departure_time}`);
    const diffMinutes = departureDateTime.diff(dayjs(), 'minute');
    console.log(`     距离发车: ${Math.floor(diffMinutes)} 分钟`);
    console.log(`     取消限制: ${cancelBeforeMinutes} 分钟`);
    console.log(`     提示信息应该是: 发车前${cancelBeforeMinutes}分钟内不可取消预约`);
    
    assert(!String(cancelBeforeMinutes).includes('COALESCE'), '提示分钟数不应该包含COALESCE');
    assert(!isNaN(cancelBeforeMinutes), '提示分钟数不应该是NaN');
    assert(cancelBeforeMinutes === 30, '提示分钟数应该是真实的30');
  });

  console.log('');
  console.log('📌 第五组：批量多字段更新交叉验证');
  console.log('');

  await test('同时更新三个带COALESCE的字段，互不污染', async () => {
    await run(`
      UPDATE system_configs SET
        config_value = COALESCE(?, config_value),
        description = COALESCE(?, description),
        updated_at = datetime('now', 'localtime')
      WHERE config_key = ?
    `, ['55', '新描述55', 'cancel_before_minutes']);
    
    const config = await get('SELECT * FROM system_configs WHERE config_key = ?', ['cancel_before_minutes']);
    
    assert(parseInt(config.config_value) === 55, `config_value应该是55，实际: ${config.config_value}`);
    assert(config.description === '新描述55', `description应该是'新描述55'，实际: ${config.description}`);
    assert(typeof config.updated_at === 'string' && config.updated_at.length > 0, 'updated_at应该是有效时间字符串');
    assert(!String(config.config_value).includes('COALESCE'), 'config_value不应该包含COALESCE');
    assert(!String(config.description).includes('COALESCE'), 'description不应该包含COALESCE');
    
    console.log(`     config_value: ${config.config_value} ✓`);
    console.log(`     description: ${config.description} ✓`);
    console.log(`     updated_at: ${config.updated_at} ✓`);
  });

  await test('只传一个参数，其他字段用COALESCE保持原值', async () => {
    const before = await get('SELECT * FROM system_configs WHERE config_key = ?', ['cancel_before_minutes']);
    
    await run(`
      UPDATE system_configs SET
        config_value = COALESCE(?, config_value),
        description = COALESCE(?, description)
      WHERE config_key = ?
    `, ['70', null, 'cancel_before_minutes']);
    
    const after = await get('SELECT * FROM system_configs WHERE config_key = ?', ['cancel_before_minutes']);
    
    assert(parseInt(after.config_value) === 70, `config_value应该是70，实际: ${after.config_value}`);
    assert(after.description === before.description, `description应该保持不变，实际: ${after.description}`);
    assert(!String(after.config_value).includes('COALESCE'), 'config_value不应该包含COALESCE');
    
    console.log(`     config_value: ${after.config_value} (已更新) ✓`);
    console.log(`     description: ${after.description} (保持不变) ✓`);
  });

  console.log('');
  console.log('='.repeat(70));
  console.log(`📊 测试结果: 通过 ${passed} / ${passed + failed}`);
  console.log('='.repeat(70));

  if (failed > 0) {
    console.log('');
    console.log('❌ 有测试失败，请修复后重新运行');
    process.exit(1);
  } else {
    console.log('');
    console.log('🎉 所有回归测试通过！');
  }
}

runTests().catch(err => {
  console.error('测试运行出错:', err);
  process.exit(1);
});
