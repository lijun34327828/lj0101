const { get, all, db } = require('./server/db');

async function test() {
  console.log('=== 测试0: 多行SQL正则匹配 ===');
  const multiLineSql = `
    SELECT s.*, r.name as route_name
    FROM schedules s
    LEFT JOIN routes r ON s.route_id = r.id
    WHERE s.id = ?
  `;
  console.log('SQL长度:', multiLineSql.length);
  const whereMatch = multiLineSql.match(/WHERE\s+(.+?)(?=\s+(?:ORDER|GROUP|HAVING)|$)/i);
  console.log('whereMatch (无s标志):', whereMatch ? '匹配到: ' + whereMatch[1] : '未匹配');
  
  const whereMatch2 = multiLineSql.match(/WHERE\s+(.+?)(?=\s+(?:ORDER|GROUP|HAVING)|$)/is);
  console.log('whereMatch (有s标志):', whereMatch2 ? '匹配到: ' + whereMatch2[1] : '未匹配');
  
  console.log('\n=== 测试1: 简单WHERE查询 ===');
  const r1 = await get('SELECT * FROM schedules WHERE id = ?', [31]);
  console.log('ID=31的班次:', r1 ? JSON.stringify({
    id: r1.id,
    date: r1.schedule_date,
    time: r1.departure_time
  }) : 'undefined');

  console.log('\n=== 测试2: 日期条件查询 ===');
  const r2 = await all('SELECT id, schedule_date, departure_time FROM schedules WHERE schedule_date = ? ORDER BY id LIMIT 3', ['2026-06-23']);
  console.log('6月23日的班次:', JSON.stringify(r2, null, 2));

  console.log('\n=== 测试3: 带JOIN的查询 ===');
  const r3 = await get(`
    SELECT s.*, r.name as route_name
    FROM schedules s
    LEFT JOIN routes r ON s.route_id = r.id
    WHERE s.id = ?
  `, [31]);
  console.log('带JOIN的查询:', r3 ? JSON.stringify({
    id: r3.id,
    route_name: r3.route_name,
    date: r3.schedule_date
  }) : 'undefined');

  console.log('\n=== 测试4: ORDER BY + LIMIT ===');
  const r4 = await all('SELECT id FROM schedules ORDER BY id LIMIT 5');
  console.log('按ID排序的前5条:', r4.map(r => r.id));
}

test().catch(console.error);
