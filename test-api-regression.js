const dayjs = require('dayjs');

const API_BASE = 'http://localhost:8911/api';

async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return await res.json();
}

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
  console.log('🌐 API 级别 - 取消预约与配置更新 回归测试');
  console.log('='.repeat(70));
  console.log('');

  console.log('📌 第一组：配置更新与回读验证');
  console.log('');

  await test('更新配置前先确认初始值', async () => {
    const res = await api('/configs/cancel_before_minutes');
    assert(res.code === 0, '获取配置应该成功');
    const val = parseInt(res.data.config_value);
    assert(!isNaN(val), `配置值应该是数字，实际是: ${res.data.config_value}`);
    console.log(`     当前值: ${res.data.config_value}`);
  });

  await test('通过 API 更新配置（COALESCE方式）', async () => {
    const res = await api('/configs/cancel_before_minutes', {
      method: 'PUT',
      body: { config_value: '45', description: '测试描述-API更新' }
    });
    assert(res.code === 0, `更新配置应该成功，实际: ${res.message}`);
    console.log(`     更新响应: ${res.message}`);
  });

  await test('更新后回读配置值是正确数字', async () => {
    const res = await api('/configs/cancel_before_minutes');
    assert(res.code === 0, '获取配置应该成功');
    
    const val = parseInt(res.data.config_value);
    assert(!isNaN(val), `配置值应该是数字，实际是: ${res.data.config_value}`);
    assert(val === 45, `配置值应该是45，实际是: ${val}`);
    
    assert(res.data.description === '测试描述-API更新', 
      `description应该是'测试描述-API更新'，实际是: ${res.data.description}`);
    
    assert(!String(res.data.config_value).includes('COALESCE'), 
      'config_value不应该包含COALESCE');
    assert(!String(res.data.description).includes('COALESCE'), 
      'description不应该包含COALESCE');
    
    console.log(`     config_value: ${res.data.config_value} ✓`);
    console.log(`     description: ${res.data.description} ✓`);
  });

  await test('只更新config_value，description保持不变', async () => {
    const before = await api('/configs/cancel_before_minutes');
    
    const res = await api('/configs/cancel_before_minutes', {
      method: 'PUT',
      body: { config_value: '60' }
    });
    assert(res.code === 0, '更新应该成功');
    
    const after = await api('/configs/cancel_before_minutes');
    assert(parseInt(after.data.config_value) === 60, 
      `config_value应该是60，实际是: ${after.data.config_value}`);
    assert(after.data.description === before.data.description, 
      `description应该保持不变，实际是: ${after.data.description}`);
    
    console.log(`     config_value: ${after.data.config_value} (已更新)`);
    console.log(`     description: ${after.data.description} (保持不变)`);
  });

  console.log('');
  console.log('📌 第二组：获取员工和班次信息');
  console.log('');

  let employeeId = null;
  let employeeNo = null;
  let farScheduleId = null;
  let nearScheduleId = null;

  await test('获取员工信息', async () => {
    const res = await api('/employees');
    assert(res.code === 0 && res.data.length > 0, '获取员工列表应该成功');
    const emp = res.data[0];
    employeeId = emp.id;
    employeeNo = emp.employee_no;
    console.log(`     员工: ${emp.name} (${emp.employee_no}), ID: ${emp.id}`);
  });

  await test('找到7天后的班次（可取消）', async () => {
    const futureDate = dayjs().add(7, 'day').format('YYYY-MM-DD');
    const res = await api(`/schedules?date=${futureDate}`);
    assert(res.code === 0 && res.data.length > 0, '获取班次应该成功');
    const schedule = res.data.find(s => s.status === 1 && s.remaining_seats > 0);
    assert(schedule, '应该找到可用班次');
    farScheduleId = schedule.id;
    console.log(`     班次ID: ${schedule.id}, 时间: ${schedule.schedule_date} ${schedule.departure_time}`);
  });

  console.log('');
  console.log('📌 第三组：远期预约 - 应该可以成功取消');
  console.log('');

  let farReservationId = null;

  await test('创建远期预约', async () => {
    const res = await api('/reservations', {
      method: 'POST',
      body: {
        schedule_id: farScheduleId,
        employee_id: employeeId,
        employee_no: employeeNo
      }
    });
    assert(res.code === 0, `预约应该成功，实际: ${res.message}`);
    farReservationId = res.data.id;
    console.log(`     预约ID: ${farReservationId}`);
  });

  await test('远期预约取消成功', async () => {
    const res = await api(`/reservations/cancel/${farReservationId}`, {
      method: 'POST'
    });
    assert(res.code === 0, `取消应该成功，实际: ${res.message}`);
    
    const detail = await api(`/reservations/${farReservationId}`);
    assert(detail.data.status === 0, '预约状态应该是已取消');
    
    console.log(`     取消结果: ${res.message}`);
  });

  console.log('');
  console.log('📌 第四组：临近发车预约 - 应该被拦截且提示真实数字');
  console.log('');

  let nearReservationId = null;

  await test('将取消限制设为30分钟', async () => {
    const res = await api('/configs/cancel_before_minutes', {
      method: 'PUT',
      body: { config_value: '30' }
    });
    assert(res.code === 0, '设置配置应该成功');
    
    const config = await api('/configs/cancel_before_minutes');
    const val = parseInt(config.data.config_value);
    assert(val === 30, `配置值应该是30，实际是: ${val}`);
    console.log(`     cancel_before_minutes = ${config.data.config_value}`);
  });

  await test('创建一个5分钟后发车的班次（用于测试不可取消）', async () => {
    const nearDate = dayjs().add(5, 'minute').format('YYYY-MM-DD');
    const nearTime = dayjs().add(5, 'minute').format('HH:mm');
    
    const schedulesBefore = await api(`/schedules?date=${nearDate}`);
    const existing = schedulesBefore.data.find(s => s.departure_time === nearTime);
    
    if (existing) {
      nearScheduleId = existing.id;
      console.log(`     找到已有班次: ${existing.id}`);
    } else {
      console.log('     （跳过：无法直接通过API创建班次，用模拟接口测试取消判断逻辑）');
    }
  });

  await test('验证取消限制分钟数是真实数字（不是NaN）', async () => {
    const config = await api('/configs/cancel_before_minutes');
    const val = parseInt(config.data.config_value);
    
    assert(!isNaN(val), `配置值不应该是NaN，实际是: ${config.data.config_value}`);
    assert(typeof val === 'number' && val > 0, '配置值应该是正整数');
    assert(val === 30, `配置值应该是30，实际是: ${val}`);
    assert(!String(config.data.config_value).includes('COALESCE'), 
      '配置值不应该包含COALESCE');
    
    console.log(`     取消限制分钟数: ${val} (真实数字，不是NaN)`);
    console.log(`     提示消息模板: 发车前${val}分钟内不可取消预约`);
  });

  await test('把取消限制设很大，验证取消被拦截且提示真实数字', async () => {
    const bigLimit = 999999;
    await api('/configs/cancel_before_minutes', {
      method: 'PUT',
      body: { config_value: String(bigLimit) }
    });
    
    const config = await api('/configs/cancel_before_minutes');
    const limitVal = parseInt(config.data.config_value);
    assert(limitVal === bigLimit, `限制应该是${bigLimit}，实际是: ${limitVal}`);
    assert(!isNaN(limitVal), '限制值不应该是NaN');
    
    const newReservation = await api('/reservations', {
      method: 'POST',
      body: {
        schedule_id: farScheduleId,
        employee_id: employeeId,
        employee_no: employeeNo
      }
    });
    assert(newReservation.code === 0, `创建新预约应该成功，实际: ${newReservation.message}`);
    
    const res = await api(`/reservations/cancel/${newReservation.data.id}`, {
      method: 'POST'
    });
    
    assert(res.code !== 0, '取消应该失败（因为限制很大）');
    assert(res.message.includes('分钟'), '错误信息应该包含分钟数');
    assert(!res.message.includes('NaN'), '错误信息不应该包含NaN');
    assert(!res.message.includes('COALESCE'), '错误信息不应该包含COALESCE');
    
    const match = res.message.match(/(\d+)分钟/);
    assert(match, '应该能从错误信息中提取到分钟数字');
    const minutesInMessage = parseInt(match[1]);
    assert(minutesInMessage === bigLimit, 
      `提示的分钟数应该是${bigLimit}，实际是: ${minutesInMessage}`);
    
    console.log(`     限制分钟数: ${bigLimit}`);
    console.log(`     取消结果: ${res.message}`);
    console.log(`     提取到的分钟数: ${minutesInMessage} (真实数字，不是NaN)`);
  });

  await test('把取消限制恢复为30，验证远期预约可以取消', async () => {
    await api('/configs/cancel_before_minutes', {
      method: 'PUT',
      body: { config_value: '30' }
    });
    
    const config = await api('/configs/cancel_before_minutes');
    const limitVal = parseInt(config.data.config_value);
    assert(limitVal === 30, `限制应该是30，实际是: ${limitVal}`);
    
    const employees = await api('/employees');
    const emp2 = employees.data[1];
    
    const newReservation = await api('/reservations', {
      method: 'POST',
      body: {
        schedule_id: farScheduleId,
        employee_id: emp2.id,
        employee_no: emp2.employee_no
      }
    });
    assert(newReservation.code === 0, `创建新预约应该成功，实际: ${newReservation.message}`);
    
    const cancelRes = await api(`/reservations/cancel/${newReservation.data.id}`, {
      method: 'POST'
    });
    assert(cancelRes.code === 0, `30分钟限制下，远期预约应该可以取消，实际: ${cancelRes.message}`);
    
    console.log(`     限制分钟数: 30`);
    console.log(`     取消结果: ${cancelRes.message}`);
  });

  console.log('');
  console.log('📌 第五组：一次更新多个字段互不污染验证');
  console.log('');

  await test('同时更新config_value和description', async () => {
    const res = await api('/configs/occupancy_threshold', {
      method: 'PUT',
      body: { config_value: '75', description: '新的上座率阈值' }
    });
    assert(res.code === 0, '更新应该成功');
    
    const config = await api('/configs/occupancy_threshold');
    assert(parseInt(config.data.config_value) === 75, 
      `config_value应该是75，实际是: ${config.data.config_value}`);
    assert(config.data.description === '新的上座率阈值', 
      `description应该是'新的上座率阈值'，实际是: ${config.data.description}`);
    assert(!String(config.data.config_value).includes('COALESCE'), 
      'config_value不应该包含COALESCE');
    assert(!String(config.data.description).includes('COALESCE'), 
      'description不应该包含COALESCE');
    
    console.log(`     config_value: ${config.data.config_value} ✓`);
    console.log(`     description: ${config.data.description} ✓`);
  });

  await test('只更新description，config_value保持不变', async () => {
    const before = await api('/configs/occupancy_threshold');
    
    const res = await api('/configs/occupancy_threshold', {
      method: 'PUT',
      body: { description: '只改描述不改值' }
    });
    assert(res.code === 0, '更新应该成功');
    
    const after = await api('/configs/occupancy_threshold');
    assert(after.data.description === '只改描述不改值', 
      `description应该是'只改描述不改值'，实际是: ${after.data.description}`);
    assert(parseInt(after.data.config_value) === parseInt(before.data.config_value), 
      `config_value应该保持不变，实际是: ${after.data.config_value}`);
    
    console.log(`     config_value: ${after.data.config_value} (保持不变) ✓`);
    console.log(`     description: ${after.data.description} (已更新) ✓`);
  });

  console.log('');
  console.log('='.repeat(70));
  console.log(`📊 测试结果: 通过 ${passed} / ${passed + failed}`);
  console.log('='.repeat(70));

  if (failed > 0) {
    console.log('');
    console.log('❌ 有测试失败！');
    process.exit(1);
  } else {
    console.log('');
    console.log('🎉 所有API级别回归测试通过！');
  }
}

runTests().catch(err => {
  console.error('测试运行出错:', err);
  process.exit(1);
});
