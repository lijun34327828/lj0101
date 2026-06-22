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
  console.log('🌐 候补排队功能 综合测试');
  console.log('='.repeat(70));
  console.log('');

  const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');

  console.log('📌 准备工作：获取测试班次和员工');
  console.log('');

  let testSchedule = null;
  let testScheduleId = null;
  let employees = [];

  await test('获取明日班次列表', async () => {
    const res = await api(`/schedules?date=${tomorrow}`);
    assert(res.code === 0, '获取班次列表应该成功');
    assert(res.data && res.data.length > 0, '应该有班次数据');
    
    testSchedule = res.data.find(s => s.capacity > 0 && s.status === 1);
    assert(testSchedule, '应该找到可用班次');
    testScheduleId = testSchedule.id;
    console.log(`     测试班次: ${testSchedule.route_name} (ID: ${testScheduleId}, 容量: ${testSchedule.capacity}, 日期: ${testSchedule.schedule_date})`);
  });

  await test('将班次容量修改为17（留3个员工作为候补）', async () => {
    const res = await api(`/schedules/${testScheduleId}`, {
      method: 'PUT',
      body: { capacity: 17 }
    });
    assert(res.code === 0, '修改班次容量应该成功');
    testSchedule.capacity = 17;
    console.log(`     班次容量已修改为 17`);
  });

  await test('获取员工列表', async () => {
    const res = await api('/employees');
    assert(res.code === 0, '获取员工列表应该成功');
    assert(res.data && res.data.length > 5, '应该有足够的员工数据');
    employees = res.data;
    console.log(`     获取到 ${employees.length} 名员工`);
  });

  console.log('');
  console.log('📌 第一组：填满班次测试');
  console.log('');

  const capacity = testSchedule.capacity;
  const reservationIds = [];

  for (let i = 0; i < capacity; i++) {
    const emp = employees[i];
    await test(`员工${i + 1}(${emp.name})预约班次`, async () => {
      const res = await api('/reservations', {
        method: 'POST',
        body: {
          schedule_id: testScheduleId,
          employee_id: emp.id,
          employee_no: emp.employee_no
        }
      });
      assert(res.code === 0, `预约应该成功，实际: ${res.message}`);
      assert(res.data && res.data.id, '应该返回预约ID');
      reservationIds.push(res.data.id);
    });
  }

  let bookedCountAfterFull = 0;
  await test('验证班次已填满，booked_count等于capacity', async () => {
    const res = await api(`/schedules/${testScheduleId}`);
    assert(res.code === 0, '获取班次详情应该成功');
    bookedCountAfterFull = res.data.booked_count;
    assert(bookedCountAfterFull === capacity, 
      `booked_count应该等于capacity(${capacity})，实际: ${bookedCountAfterFull}`);
    assert(res.data.remaining_seats === 0, 
      `剩余座位应该为0，实际: ${res.data.remaining_seats}`);
    console.log(`     booked_count: ${bookedCountAfterFull}, capacity: ${capacity}`);
  });

  console.log('');
  console.log('📌 第二组：满员时加入候补测试');
  console.log('');

  const waitlistEmp1 = employees[capacity];
  const waitlistEmp2 = employees[capacity + 1];
  const waitlistEmp3 = employees[capacity + 2];
  let waitlistId1 = null;
  let waitlistId2 = null;
  let waitlistId3 = null;

  await test(`员工${capacity + 1}(${waitlistEmp1.name})预约已满班次，应加入候补第1位`, async () => {
    const res = await api('/reservations', {
      method: 'POST',
      body: {
        schedule_id: testScheduleId,
        employee_id: waitlistEmp1.id,
        employee_no: waitlistEmp1.employee_no
      }
    });
    assert(res.code === 0, '应该成功返回，而非失败');
    assert(res.data && res.data.waitlist === true, '应该返回候补标识');
    assert(res.data.position === 1, `应该排在第1位，实际: ${res.data.position}`);
    waitlistId1 = res.data.waitlist_id;
    console.log(`     返回消息: ${res.message}`);
    console.log(`     候补ID: ${waitlistId1}, 位次: ${res.data.position}`);
  });

  await test(`员工${capacity + 2}(${waitlistEmp2.name})预约，应加入候补第2位`, async () => {
    const res = await api('/reservations', {
      method: 'POST',
      body: {
        schedule_id: testScheduleId,
        employee_id: waitlistEmp2.id,
        employee_no: waitlistEmp2.employee_no
      }
    });
    assert(res.code === 0, '应该成功返回');
    assert(res.data && res.data.waitlist === true, '应该返回候补标识');
    assert(res.data.position === 2, `应该排在第2位，实际: ${res.data.position}`);
    waitlistId2 = res.data.waitlist_id;
    console.log(`     候补ID: ${waitlistId2}, 位次: ${res.data.position}`);
  });

  await test(`员工${capacity + 3}(${waitlistEmp3.name})预约，应加入候补第3位`, async () => {
    const res = await api('/reservations', {
      method: 'POST',
      body: {
        schedule_id: testScheduleId,
        employee_id: waitlistEmp3.id,
        employee_no: waitlistEmp3.employee_no
      }
    });
    assert(res.code === 0, '应该成功返回');
    assert(res.data && res.data.waitlist === true, '应该返回候补标识');
    assert(res.data.position === 3, `应该排在第3位，实际: ${res.data.position}`);
    waitlistId3 = res.data.waitlist_id;
    console.log(`     候补ID: ${waitlistId3}, 位次: ${res.data.position}`);
  });

  await test('验证班次候补人数为3', async () => {
    const res = await api(`/schedules/${testScheduleId}`);
    assert(res.code === 0, '获取班次详情应该成功');
    assert(res.data.waitlist_count === 3, 
      `候补人数应该为3，实际: ${res.data.waitlist_count}`);
    console.log(`     候补人数: ${res.data.waitlist_count}`);
  });

  await test('验证重复加入候补被拦截', async () => {
    const res = await api('/reservations', {
      method: 'POST',
      body: {
        schedule_id: testScheduleId,
        employee_id: waitlistEmp1.id,
        employee_no: waitlistEmp1.employee_no
      }
    });
    assert(res.code === 400, '重复加入候补应该返回400');
    assert(res.message.includes('已在该班次候补队列中'), 
      `应该提示已在候补队列中，实际: ${res.message}`);
    console.log(`     拦截消息: ${res.message}`);
  });

  await test('验证同一员工不能同时有正式预约和候补', async () => {
    const empWithReservation = employees[0];
    const res = await api('/reservations', {
      method: 'POST',
      body: {
        schedule_id: testScheduleId,
        employee_id: empWithReservation.id,
        employee_no: empWithReservation.employee_no
      }
    });
    assert(res.code === 400, '已有正式预约的员工不能加入候补');
    assert(res.message.includes('已预约该班次'), 
      `应该提示已预约，实际: ${res.message}`);
    console.log(`     拦截消息: ${res.message}`);
  });

  console.log('');
  console.log('📌 第三组：我的预约列表显示测试');
  console.log('');

  await test('候补中员工的预约列表应显示"候补中第X位"', async () => {
    const res = await api(`/reservations/employee/${waitlistEmp1.employee_no}/list`);
    assert(res.code === 0, '获取我的预约列表应该成功');
    
    const waitlistItem = res.data.find(item => 
      item.type === 'waitlist' && item.schedule_id === testScheduleId
    );
    assert(waitlistItem, '应该找到候补记录');
    assert(waitlistItem.status_text === '候补中第1位', 
      `状态文本应该是"候补中第1位"，实际: ${waitlistItem.status_text}`);
    assert(waitlistItem.position === 1, 
      `position应该是1，实际: ${waitlistItem.position}`);
    console.log(`     状态文本: ${waitlistItem.status_text}`);
  });

  await test('有正式预约的员工列表应显示"已预约"', async () => {
    const emp = employees[0];
    const res = await api(`/reservations/employee/${emp.employee_no}/list`);
    assert(res.code === 0, '获取我的预约列表应该成功');
    
    const reservationItem = res.data.find(item => 
      item.type === 'reservation' && item.schedule_id === testScheduleId
    );
    assert(reservationItem, '应该找到预约记录');
    assert(reservationItem.status_text === '已预约', 
      `状态文本应该是"已预约"，实际: ${reservationItem.status_text}`);
    console.log(`     状态文本: ${reservationItem.status_text}`);
  });

  console.log('');
  console.log('📌 第四组：取消正式预约，自动转正候补队首测试');
  console.log('');

  const empToCancel = employees[0];
  const reservationToCancel = reservationIds[0];
  let bookedCountBeforeCancel = 0;

  await test('获取取消前的booked_count', async () => {
    const res = await api(`/schedules/${testScheduleId}`);
    bookedCountBeforeCancel = res.data.booked_count;
    console.log(`     取消前 booked_count: ${bookedCountBeforeCancel}`);
  });

  await test(`取消员工1的预约，候补队首自动转正`, async () => {
    const res = await api(`/reservations/cancel/${reservationToCancel}`, {
      method: 'POST'
    });
    assert(res.code === 0, '取消应该成功');
    assert(res.message.includes('候补队列第一位已自动转正'), 
      `应该提示候补已转正，实际: ${res.message}`);
    assert(res.data && res.data.promoted_employee === waitlistEmp1.name,
      `转正的应该是候补第1位员工${waitlistEmp1.name}，实际: ${res.data?.promoted_employee}`);
    console.log(`     返回消息: ${res.message}`);
    console.log(`     转正员工: ${res.data.promoted_employee}`);
  });

  await test('验证booked_count保持不变', async () => {
    const res = await api(`/schedules/${testScheduleId}`);
    const bookedCountAfter = res.data.booked_count;
    assert(bookedCountAfter === bookedCountBeforeCancel, 
      `booked_count应该保持${bookedCountBeforeCancel}不变，实际: ${bookedCountAfter}`);
    assert(bookedCountAfter <= testSchedule.capacity,
      `booked_count不应该超过capacity(${testSchedule.capacity})，实际: ${bookedCountAfter}`);
    console.log(`     取消后 booked_count: ${bookedCountAfter} (保持不变)`);
  });

  await test('验证候补队首状态变为"已转正"，新预约状态为"已预约"', async () => {
    const res = await api(`/reservations/employee/${waitlistEmp1.employee_no}/list`);
    assert(res.code === 0, '获取列表应该成功');
    
    const promotedWaitlist = res.data.find(item => 
      item.type === 'waitlist' && item.schedule_id === testScheduleId && item.status === 2
    );
    assert(promotedWaitlist, '应该找到已转正的候补记录');
    assert(promotedWaitlist.status_text === '已转正',
      `状态文本应该是"已转正"，实际: ${promotedWaitlist.status_text}`);
    
    const newReservation = res.data.find(item => 
      item.type === 'reservation' && item.schedule_id === testScheduleId && item.status === 1
    );
    assert(newReservation, '应该找到新的正式预约记录');
    assert(newReservation.status_text === '已预约',
      `状态文本应该是"已预约"，实际: ${newReservation.status_text}`);
    assert(newReservation.from_waitlist === 1,
      `from_waitlist应该是1，实际: ${newReservation.from_waitlist}`);
    console.log(`     候补记录状态: ${promotedWaitlist.status_text}`);
    console.log(`     新预约状态: ${newReservation.status_text} (from_waitlist: ${newReservation.from_waitlist})`);
  });

  await test('验证候补人数减少为2，原第2位变为第1位', async () => {
    const res = await api(`/schedules/${testScheduleId}`);
    assert(res.data.waitlist_count === 2, 
      `候补人数应该为2，实际: ${res.data.waitlist_count}`);
    
    const emp2Res = await api(`/reservations/employee/${waitlistEmp2.employee_no}/list`);
    const waitlistItem = emp2Res.data.find(item => 
      item.type === 'waitlist' && item.schedule_id === testScheduleId && item.status === 1
    );
    assert(waitlistItem.position === 1, 
      `原第2位现在应该是第1位，实际: ${waitlistItem.position}`);
    assert(waitlistItem.status_text === '候补中第1位',
      `状态文本应该是"候补中第1位"，实际: ${waitlistItem.status_text}`);
    console.log(`     候补人数: ${res.data.waitlist_count}`);
    console.log(`     原第2位(${waitlistEmp2.name})现在位次: ${waitlistItem.position}`);
  });

  await test('验证原第3位变为第2位', async () => {
    const emp3Res = await api(`/reservations/employee/${waitlistEmp3.employee_no}/list`);
    const waitlistItem = emp3Res.data.find(item => 
      item.type === 'waitlist' && item.schedule_id === testScheduleId && item.status === 1
    );
    assert(waitlistItem.position === 2, 
      `原第3位现在应该是第2位，实际: ${waitlistItem.position}`);
    assert(waitlistItem.status_text === '候补中第2位',
      `状态文本应该是"候补中第2位"，实际: ${waitlistItem.status_text}`);
    console.log(`     原第3位(${waitlistEmp3.name})现在位次: ${waitlistItem.position}`);
  });

  console.log('');
  console.log('📌 第五组：候补主动取消，位次前移测试');
  console.log('');

  await test('当前候补第1位主动取消候补', async () => {
    const res = await api(`/reservations/waitlist/cancel/${waitlistId2}`, {
      method: 'POST'
    });
    assert(res.code === 0, '取消候补应该成功');
    console.log(`     返回消息: ${res.message}`);
  });

  await test('验证取消候补后状态变为"已取消候补"', async () => {
    const emp2Res = await api(`/reservations/employee/${waitlistEmp2.employee_no}/list`);
    const waitlistItem = emp2Res.data.find(item => 
      item.type === 'waitlist' && item.schedule_id === testScheduleId && item.id === waitlistId2
    );
    assert(waitlistItem.status === 0, 
      `状态应该是0（已取消），实际: ${waitlistItem.status}`);
    assert(waitlistItem.status_text === '已取消候补',
      `状态文本应该是"已取消候补"，实际: ${waitlistItem.status_text}`);
    console.log(`     状态: ${waitlistItem.status_text}`);
  });

  await test('验证候补人数减少为1，原第3位变为第1位', async () => {
    const res = await api(`/schedules/${testScheduleId}`);
    assert(res.data.waitlist_count === 1, 
      `候补人数应该为1，实际: ${res.data.waitlist_count}`);
    
    const emp3Res = await api(`/reservations/employee/${waitlistEmp3.employee_no}/list`);
    const waitlistItem = emp3Res.data.find(item => 
      item.type === 'waitlist' && item.schedule_id === testScheduleId && item.status === 1
    );
    assert(waitlistItem.position === 1, 
      `原第3位现在应该是第1位，实际: ${waitlistItem.position}`);
    assert(waitlistItem.status_text === '候补中第1位',
      `状态文本应该是"候补中第1位"，实际: ${waitlistItem.status_text}`);
    console.log(`     候补人数: ${res.data.waitlist_count}`);
    console.log(`     ${waitlistEmp3.name}现在位次: ${waitlistItem.position}`);
  });

  console.log('');
  console.log('📌 第六组：行政端乘车名单与候补人数测试');
  console.log('');

  await test('行政端乘车名单只列正式预约，包含候补人数', async () => {
    const res = await api(`/reservations/schedule/${testScheduleId}/passengers`);
    assert(res.code === 0, '获取乘车名单应该成功');
    assert(Array.isArray(res.data), 'data应该是数组');
    assert(res.data.length === capacity, 
      `应该有${capacity}名正式乘客，实际: ${res.data.length}`);
    assert(res.waitlist_count === 1, 
      `候补人数应该为1，实际: ${res.waitlist_count}`);
    
    const allStatus1 = res.data.every(p => p.status === 1);
    assert(allStatus1, '所有乘客状态都应该是1（已预约）');
    
    console.log(`     正式乘客数: ${res.data.length}`);
    console.log(`     候补人数: ${res.waitlist_count}`);
  });

  console.log('');
  console.log('📌 第七组：台账与上座率统计测试（只统计正式预约）');
  console.log('');

  await test('生成当日台账', async () => {
    const res = await api('/admin/ledgers/generate', {
      method: 'POST',
      body: { date: tomorrow }
    });
    assert(res.code === 0, '生成台账应该成功');
    console.log(`     返回消息: ${res.message}`);
  });

  await test('验证台账只统计正式预约，不含候补', async () => {
    const res = await api(`/admin/ledgers?date_from=${tomorrow}&date_to=${tomorrow}`);
    assert(res.code === 0, '获取台账应该成功');
    
    const ledger = res.data.find(l => l.schedule_id === testScheduleId);
    assert(ledger, '应该找到该班次的台账记录');
    assert(ledger.reservation_count === capacity, 
      `台账预约人数应该为${capacity}（只统计正式预约），实际: ${ledger.reservation_count}`);
    
    const expectedOccupancy = Math.round((capacity / testSchedule.capacity) * 10000) / 100;
    assert(Math.abs(ledger.occupancy_rate - expectedOccupancy) < 0.01, 
      `上座率应该为${expectedOccupancy}%，实际: ${ledger.occupancy_rate}%`);
    
    console.log(`     台账预约人数: ${ledger.reservation_count}`);
    console.log(`     台账上座率: ${ledger.occupancy_rate}%`);
    console.log(`     （候补人数1未计入统计）`);
  });

  await test('验证当日统计汇总', async () => {
    const res = await api(`/admin/statistics/summary?date=${tomorrow}`);
    assert(res.code === 0, '获取统计应该成功');
    console.log(`     总班次: ${res.data.summary.total_schedules}`);
    console.log(`     总载客量: ${res.data.summary.total_capacity}`);
    console.log(`     总预约数: ${res.data.summary.total_reservations}`);
    console.log(`     平均上座率: ${res.data.summary.avg_occupancy_rate}%`);
  });

  console.log('');
  console.log('📌 第八组：候补队列接口测试');
  console.log('');

  await test('获取班次候补队列，显示正确位次', async () => {
    const res = await api(`/reservations/waitlist/schedule/${testScheduleId}`);
    assert(res.code === 0, '获取候补队列应该成功');
    assert(res.count === 1, `候补人数应该为1，实际: ${res.count}`);
    assert(res.data.length === 1, `队列长度应该为1，实际: ${res.data.length}`);
    assert(res.data[0].position === 1, 
      `位次应该为1，实际: ${res.data[0].position}`);
    assert(res.data[0].employee_id === waitlistEmp3.id,
      `应该是员工${waitlistEmp3.name}，实际: ${res.data[0].employee_name}`);
    console.log(`     队列人数: ${res.count}`);
    console.log(`     第1位: ${res.data[0].employee_name} (position: ${res.data[0].position})`);
  });

  console.log('');
  console.log('='.repeat(70));
  console.log(`📊 测试完成: ${passed} 通过, ${failed} 失败`);
  console.log('='.repeat(70));

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(console.error);
