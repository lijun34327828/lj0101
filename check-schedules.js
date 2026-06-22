const { all } = require('./server/db');

async function check() {
  const schedules = await all(`
    SELECT s.schedule_date, s.departure_time, s.capacity, s.booked_count, 
           (s.capacity - s.booked_count) as remaining,
           r.name as route_name, s.status
    FROM schedules s
    LEFT JOIN routes r ON s.route_id = r.id
    ORDER BY s.schedule_date, s.departure_time
  `);
  
  console.log('现有班次概览:');
  console.log('='.repeat(80));
  
  const dateGroups = {};
  schedules.forEach(s => {
    if (!dateGroups[s.schedule_date]) dateGroups[s.schedule_date] = [];
    dateGroups[s.schedule_date].push(s);
  });
  
  const dates = Object.keys(dateGroups).sort();
  dates.forEach(date => {
    const daySchedules = dateGroups[date];
    const total = daySchedules.length;
    const available = daySchedules.filter(s => s.remaining > 0 && s.status === 1).length;
    console.log(`${date}: 共${total}班, 可预约${available}班`);
  });
  
  console.log('');
  console.log('未来可用班次详情:');
  console.log('='.repeat(80));
  
  const today = new Date().toISOString().split('T')[0];
  const futureDates = dates.filter(d => d >= today);
  futureDates.forEach(date => {
    const daySchedules = dateGroups[date];
    daySchedules.forEach(s => {
      const status = s.status === 1 ? '正常' : '停用';
      const seatStatus = s.remaining <= 0 ? '已满' : `剩${s.remaining}座`;
      console.log(`${date} ${s.departure_time} ${s.route_name} - ${seatStatus} (${status})`);
    });
  });
}

check().catch(console.error);
