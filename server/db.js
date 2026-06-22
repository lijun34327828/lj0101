const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');

const dataDir = path.join(__dirname, '..', 'data');
const dbFile = path.join(dataDir, 'db.json');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let db = {
  factories: [],
  routes: [],
  vehicles: [],
  schedules: [],
  employees: [],
  reservations: [],
  waitlist: [],
  daily_ledgers: [],
  capacity_alerts: [],
  system_configs: [],
  _counters: {
    factories: 0,
    routes: 0,
    vehicles: 0,
    schedules: 0,
    employees: 0,
    reservations: 0,
    waitlist: 0,
    daily_ledgers: 0,
    capacity_alerts: 0,
    system_configs: 0
  }
};

function saveDb() {
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2), 'utf8');
}

function loadDb() {
  if (fs.existsSync(dbFile)) {
    try {
      const data = fs.readFileSync(dbFile, 'utf8');
      db = JSON.parse(data);
      return true;
    } catch (e) {
      console.error('加载数据库文件失败，重新初始化:', e.message);
    }
  }
  return false;
}

function getNextId(table) {
  db._counters[table] = (db._counters[table] || 0) + 1;
  return db._counters[table];
}

function nowStr() {
  return dayjs().format('YYYY-MM-DD HH:mm:ss');
}

function initDatabase() {
  const loaded = loadDb();
  if (loaded && db.factories.length > 0) {
    console.log('数据库加载完成');
    return;
  }

  console.log('初始化数据库...');

  db.system_configs = [
    { id: getNextId('system_configs'), config_key: 'cancel_before_minutes', config_value: '30', description: '发车前多少分钟关闭取消入口', updated_at: nowStr() },
    { id: getNextId('system_configs'), config_key: 'occupancy_threshold', config_value: '60', description: '上座率告警阈值(%)', updated_at: nowStr() },
    { id: getNextId('system_configs'), config_key: 'alert_days', config_value: '7', description: '连续多少天低于阈值触发告警', updated_at: nowStr() }
  ];

  db.factories = [
    { id: getNextId('factories'), name: '总部厂区', address: '北京市朝阳区科技园区A座', created_at: nowStr() },
    { id: getNextId('factories'), name: '开发厂区', address: '北京市海淀区软件园B区', created_at: nowStr() },
    { id: getNextId('factories'), name: '生产厂区', address: '北京市亦庄经济开发区C路', created_at: nowStr() }
  ];

  for (let i = 1; i <= 20; i++) {
    const factoryId = i <= 10 ? 1 : (i <= 15 ? 2 : 3);
    db.employees.push({
      id: getNextId('employees'),
      employee_no: `EMP${String(i).padStart(4, '0')}`,
      name: `员工${i}`,
      department: `部门${Math.ceil(i / 5)}`,
      phone: `138${String(10000000 + i).slice(-8)}`,
      factory_id: factoryId,
      created_at: nowStr()
    });
  }

  db.vehicles = [
    { id: getNextId('vehicles'), plate_number: '京A12345', capacity: 45, driver_name: '张师傅', driver_phone: '13900001111', status: 1, created_at: nowStr() },
    { id: getNextId('vehicles'), plate_number: '京A67890', capacity: 35, driver_name: '李师傅', driver_phone: '13900002222', status: 1, created_at: nowStr() },
    { id: getNextId('vehicles'), plate_number: '京B11111', capacity: 50, driver_name: '王师傅', driver_phone: '13900003333', status: 1, created_at: nowStr() },
    { id: getNextId('vehicles'), plate_number: '京B22222', capacity: 40, driver_name: '赵师傅', driver_phone: '13900004444', status: 1, created_at: nowStr() }
  ];

  const routes = [
    ['总部1号线', 1, '东直门地铁站', '总部厂区', '07:30', '18:00', 45],
    ['总部2号线', 1, '西二旗地铁站', '总部厂区', '07:45', '18:00', 45],
    ['开发1号线', 2, '中关村地铁站', '开发厂区', '08:00', '18:30', 35],
    ['开发2号线', 2, '上地地铁站', '开发厂区', '07:50', '18:30', 35],
    ['生产1号线', 3, '宋家庄地铁站', '生产厂区', '07:00', '17:30', 50],
    ['生产2号线', 3, '荣昌东街地铁站', '生产厂区', '07:15', '17:30', 40],
  ];
  routes.forEach(r => {
    db.routes.push({
      id: getNextId('routes'),
      name: r[0],
      factory_id: r[1],
      start_point: r[2],
      end_point: r[3],
      departure_time: r[4],
      return_time: r[5],
      capacity: r[6],
      status: 1,
      created_at: nowStr()
    });
  });

  const routeVehicles = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 4 };
  for (let dayOffset = -3; dayOffset <= 7; dayOffset++) {
    const date = dayjs().add(dayOffset, 'day').format('YYYY-MM-DD');
    for (const [routeId, vehicleId] of Object.entries(routeVehicles)) {
      const route = db.routes.find(r => r.id === parseInt(routeId));
      if (route) {
        db.schedules.push({
          id: getNextId('schedules'),
          route_id: route.id,
          vehicle_id: vehicleId,
          schedule_date: date,
          departure_time: route.departure_time,
          capacity: route.capacity,
          booked_count: 0,
          status: 1,
          created_at: nowStr()
        });
        if (route.return_time && dayOffset >= 0) {
          db.schedules.push({
            id: getNextId('schedules'),
            route_id: route.id,
            vehicle_id: vehicleId,
            schedule_date: date,
            departure_time: route.return_time,
            capacity: route.capacity,
            booked_count: 0,
            status: 1,
            created_at: nowStr()
          });
        }
      }
    }
  }

  saveDb();
  console.log('数据库初始化完成');
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    try {
      sql = normalizeSql(sql);
      
      if (sql.toUpperCase().startsWith('INSERT')) {
        const tableMatch = sql.match(/INTO\s+(\w+)/i);
        const table = tableMatch ? tableMatch[1] : null;
        
        const colsMatch = sql.match(/\(([^)]+)\)\s*VALUES/i);
        const columns = colsMatch ? colsMatch[1].split(',').map(s => s.trim()) : [];
        
        const valuesPart = sql.match(/VALUES\s*\((.+)\)/i);
        if (!table || !valuesPart) {
          throw new Error('SQL解析失败');
        }

        if (sql.toUpperCase().includes('OR IGNORE')) {
          const existing = checkUnique(table, columns, params);
          if (existing) {
            resolve({ lastID: null, changes: 0 });
            return;
          }
        }

        const newRecord = { id: getNextId(table) };
        columns.forEach((col, i) => {
          if (col === 'created_at') {
            newRecord[col] = nowStr();
          } else {
            newRecord[col] = params[i] !== undefined ? params[i] : null;
          }
        });

        if (!newRecord.created_at) {
          newRecord.created_at = nowStr();
        }

        db[table].push(newRecord);
        saveDb();
        resolve({ lastID: newRecord.id, changes: 1 });
        return;
      }

      if (sql.toUpperCase().startsWith('UPDATE')) {
        const tableMatch = sql.match(/UPDATE\s+(\w+)/i);
        const table = tableMatch ? tableMatch[1] : null;
        
        const setMatchWithWhere = sql.match(/SET\s+(.+?)\s+WHERE/i);
        const setMatchNoWhere = sql.match(/SET\s+(.+?)\s*$/i);
        const setMatch = setMatchWithWhere || setMatchNoWhere;
        const whereMatch = sql.match(/WHERE\s+(.+)$/i);
        
        if (!table || !setMatch) {
          throw new Error('SQL解析失败');
        }

        const setClause = setMatch[1];
        const setParamCount = (setClause.match(/\?/g) || []).length;
        const whereParams = params.slice(setParamCount);

        let count = 0;
        const records = findRecords(table, whereMatch ? whereMatch[1] : null, whereParams);
        
        records.forEach(record => {
          applySet(record, setClause, params);
          if (table === 'system_configs') {
            record.updated_at = nowStr();
          }
          count++;
        });

        saveDb();
        resolve({ changes: count });
        return;
      }

      if (sql.toUpperCase().startsWith('DELETE')) {
        const tableMatch = sql.match(/FROM\s+(\w+)/i);
        const table = tableMatch ? tableMatch[1] : null;
        const whereMatch = sql.match(/WHERE\s+(.+)$/i);

        if (!table) {
          throw new Error('SQL解析失败');
        }

        const beforeLen = db[table].length;
        const records = findRecords(table, whereMatch ? whereMatch[1] : null, params);
        const idsToDelete = new Set(records.map(r => r.id));
        db[table] = db[table].filter(r => !idsToDelete.has(r.id));
        
        saveDb();
        resolve({ changes: beforeLen - db[table].length });
        return;
      }

      if (sql.toUpperCase().startsWith('BEGIN') || sql.toUpperCase().startsWith('COMMIT') || sql.toUpperCase().startsWith('ROLLBACK')) {
        resolve();
        return;
      }

      reject(new Error('不支持的SQL语句: ' + sql.substring(0, 50)));
    } catch (err) {
      reject(err);
    }
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    try {
      const result = parseSelect(sql, params);
      resolve(result[0] || undefined);
    } catch (err) {
      reject(err);
    }
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    try {
      const result = parseSelect(sql, params);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

function exec(sql) {
  return new Promise((resolve, reject) => {
    resolve();
  });
}

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function parseSelect(sql, params) {
  sql = normalizeSql(sql);
  const fromMatch = sql.match(/FROM\s+(\w+)/i);
  const table = fromMatch ? fromMatch[1] : null;
  if (!table) throw new Error('找不到表名');

  let records = [...db[table]];

  const joinRegex = /LEFT\s+JOIN\s+(\w+)\s+(?:AS\s+)?(\w+)?\s*ON\s+(.+?)(?=\s+(?:LEFT|WHERE|ORDER|GROUP|HAVING)|$)/gi;
  let match;
  const joins = [];
  while ((match = joinRegex.exec(sql)) !== null) {
    joins.push({
      table: match[1],
      alias: match[2] || match[1],
      on: match[3].trim()
    });
  }

  const mainTableFields = new Set(Object.keys(records[0] || {}));
  joins.forEach(join => {
    const joinTable = db[join.table];
    const joinAlias = join.alias || join.table;
    records = records.map(record => {
      const [leftField, rightField] = join.on.split('=').map(s => s.trim().split('.').pop());
      const joinedRecord = joinTable.find(jr => jr[rightField] == record[leftField]);
      if (!joinedRecord) return record;
      const newFields = {};
      Object.keys(joinedRecord).forEach(key => {
        newFields[`${joinAlias}_${key}`] = joinedRecord[key];
        if (!mainTableFields.has(key)) {
          newFields[key] = joinedRecord[key];
        }
      });
      return { ...record, ...newFields };
    });
  });

  const whereMatch = sql.match(/WHERE\s+(.+?)(?=\s+(?:ORDER|GROUP|HAVING)|$)/i);
  if (whereMatch) {
    records = filterRecords(records, whereMatch[1], params);
  }

  const groupMatch = sql.match(/GROUP\s+BY\s+(.+?)(?=\s+(?:ORDER|HAVING)|$)/i);
  const selectMatch = sql.match(/SELECT\s+(.+?)\s+FROM/i);
  const hasAggregate = selectMatch && /(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(selectMatch[1]);
  
  if (groupMatch) {
    records = groupRecords(records, groupMatch[1], sql);
  } else if (hasAggregate) {
    records = groupRecords(records, null, sql);
  }

  const havingMatch = sql.match(/HAVING\s+(.+?)(?=\s+ORDER|$)/i);
  if (havingMatch) {
    records = filterRecords(records, havingMatch[1], params);
  }

  const orderMatch = sql.match(/ORDER\s+BY\s+(.+?)(?=\s+LIMIT|$)/i);
  if (orderMatch) {
    records = sortRecords(records, orderMatch[1]);
  }

  if (selectMatch && selectMatch[1].trim() !== '*') {
    records = selectFields(records, selectMatch[1]);
  }

  const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
  const offsetMatch = sql.match(/OFFSET\s+(\d+)/i);
  if (limitMatch) {
    const limit = parseInt(limitMatch[1]);
    const offset = offsetMatch ? parseInt(offsetMatch[1]) : 0;
    records = records.slice(offset, offset + limit);
  }

  return records;
}

function getFieldValue(record, expr) {
  if (expr && expr.includes && expr.includes('.')) {
    const parts = expr.split('.');
    const tableAlias = parts[0];
    const fieldName = parts[1];
    const prefixedKey = `${tableAlias}_${fieldName}`;
    if (record[prefixedKey] !== undefined) {
      return record[prefixedKey];
    }
    return record[fieldName];
  }
  return record[expr];
}

function parseLiteralValue(value) {
  if (/^-?\d+\.?\d*$/.test(value)) {
    return parseFloat(value);
  } else if (/^'.*'$/.test(value)) {
    return value.slice(1, -1);
  } else if (value.toUpperCase() === 'NULL') {
    return null;
  } else if (value.toUpperCase() === 'TRUE') {
    return true;
  } else if (value.toUpperCase() === 'FALSE') {
    return false;
  }
  return value;
}

function filterRecords(records, whereClause, params) {
  const conditions = parseWhereClause(whereClause);

  return records.filter(record => {
    let paramIndex = 0;
    return conditions.every(cond => {
      if (cond.op === 'AND' || cond.op === 'OR') return true;
      
      let value;
      if (cond.isLiteral) {
        value = cond.value;
      } else {
        value = params[paramIndex++];
      }
      
      let recordValue;
      if (cond.leftIsLiteral) {
        recordValue = cond.leftValue;
      } else {
        recordValue = getFieldValue(record, cond.field);
      }

      switch (cond.op) {
        case '=':
          return recordValue == value;
        case '!=':
        case '<>':
          return recordValue != value;
        case '>':
          return recordValue > value;
        case '<':
          return recordValue < value;
        case '>=':
          return recordValue >= value;
        case '<=':
          return recordValue <= value;
        case 'LIKE':
          if (value === null || recordValue === null) return false;
          const pattern = (typeof value === 'string' ? value : String(value)).replace(/%/g, '.*').replace(/_/g, '.');
          return new RegExp('^' + pattern + '$', 'i').test(String(recordValue));
        default:
          return true;
      }
    });
  });
}

function parseWhereClause(clause) {
  const conditions = [];
  const parts = clause.split(/\s+AND\s+/i);
  
  parts.forEach(part => {
    part = part.trim();
    const paramMatch = part.match(/([\w.]+)\s*(=|!=|<>|>=|<=|>|<|LIKE)\s*\?/i);
    if (paramMatch) {
      conditions.push({
        field: paramMatch[1],
        op: paramMatch[2].toUpperCase(),
        isLiteral: false,
        leftIsLiteral: isLiteralValue(paramMatch[1])
      });
    } else {
      const literalMatch = part.match(/([\w.]+|'.*?')\s*(=|!=|<>|>=|<=|>|<|LIKE)\s*(-?\d+\.?\d*|'.*?'|NULL|TRUE|FALSE)/i);
      if (literalMatch) {
        const leftRaw = literalMatch[1];
        const rightRaw = literalMatch[3];
        const leftIsLiteral = isLiteralValue(leftRaw);
        conditions.push({
          field: leftIsLiteral ? null : leftRaw,
          op: literalMatch[2].toUpperCase(),
          isLiteral: true,
          value: parseLiteralValue(rightRaw),
          leftIsLiteral: leftIsLiteral,
          leftValue: leftIsLiteral ? parseLiteralValue(leftRaw) : null
        });
      }
    }
  });

  return conditions;
}

function isLiteralValue(raw) {
  if (!raw) return false;
  if (/^-?\d+\.?\d*$/.test(raw)) return true;
  if (/^'.*'$/.test(raw)) return true;
  const up = raw.toUpperCase();
  if (up === 'NULL' || up === 'TRUE' || up === 'FALSE') return true;
  return false;
}

function groupRecords(records, groupBy, sql) {
  const groups = {};

  if (groupBy) {
    const groupFieldExprs = groupBy.split(',').map(s => s.trim());
    records.forEach(record => {
      const key = groupFieldExprs.map(expr => getFieldValue(record, expr)).join('|');
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(record);
    });
  } else {
    groups['__all__'] = records;
  }

  const aggMatch = sql.match(/SELECT\s+(.+?)\s+FROM/i);
  const aggFields = aggMatch ? aggMatch[1].split(',').map(s => s.trim()) : [];

  return Object.values(groups).map(group => {
    const result = { ...group[0] };

    aggFields.forEach(field => {
      const f = field.trim();
      const countMatch = f.match(/COUNT\s*\(\s*\*\s*\)\s*(?:AS\s+(\w+))?/i);
      const sumMatch = f.match(/SUM\s*\(\s*([\w.]+)\s*\)\s*(?:AS\s+(\w+))?/i);
      const avgMatch = f.match(/AVG\s*\(\s*([\w.]+)\s*\)\s*(?:AS\s+(\w+))?/i);

      if (countMatch) {
        const alias = countMatch[1] || 'count';
        result[alias] = group.length;
      } else if (sumMatch) {
        const fieldExpr = sumMatch[1];
        const alias = sumMatch[2] || `sum_${fieldExpr.split('.').pop()}`;
        result[alias] = group.reduce((sum, r) => sum + (parseFloat(getFieldValue(r, fieldExpr)) || 0), 0);
      } else if (avgMatch) {
        const fieldExpr = avgMatch[1];
        const alias = avgMatch[2] || `avg_${fieldExpr.split('.').pop()}`;
        const sum = group.reduce((s, r) => s + (parseFloat(getFieldValue(r, fieldExpr)) || 0), 0);
        result[alias] = group.length > 0 ? sum / group.length : 0;
      }
    });

    return result;
  });
}

function sortRecords(records, orderClause) {
  const orders = orderClause.split(',').map(s => {
    const parts = s.trim().split(/\s+/);
    return { fieldExpr: parts[0], dir: (parts[1] || 'ASC').toUpperCase() };
  });

  return [...records].sort((a, b) => {
    for (const order of orders) {
      const aVal = getFieldValue(a, order.fieldExpr);
      const bVal = getFieldValue(b, order.fieldExpr);
      if (aVal < bVal) return order.dir === 'ASC' ? -1 : 1;
      if (aVal > bVal) return order.dir === 'ASC' ? 1 : -1;
    }
    return 0;
  });
}

function selectFields(records, selectClause) {
  const fields = selectClause.split(',').map(s => {
    s = s.trim();
    const aliasMatch = s.match(/(.+?)\s+AS\s+(\w+)/i);
    if (aliasMatch) {
      return { expr: aliasMatch[1].trim(), alias: aliasMatch[2] };
    }
    return { expr: s, alias: s.split('.').pop() };
  });

  return records.map(record => {
    const result = {};
    fields.forEach(field => {
      if (field.expr === '*' || field.expr.endsWith('.*')) {
        Object.assign(result, record);
      } else if (field.expr.includes('(')) {
        if (record[field.alias] !== undefined) {
          result[field.alias] = record[field.alias];
        }
      } else {
        result[field.alias] = getFieldValue(record, field.expr);
      }
    });
    return result;
  });
}

function findRecords(table, whereClause, params) {
  if (!whereClause || whereClause.trim() === '') {
    return db[table];
  }

  const conditions = parseWhereClause(whereClause);

  return db[table].filter(record => {
    let paramIndex = 0;
    return conditions.every(cond => {
      let value;
      if (cond.isLiteral) {
        value = cond.value;
      } else {
        value = params[paramIndex++];
      }
      
      let recordValue;
      if (cond.leftIsLiteral) {
        recordValue = cond.leftValue;
      } else {
        recordValue = getFieldValue(record, cond.field);
      }

      switch (cond.op) {
        case '=':
          return recordValue == value;
        case '!=':
        case '<>':
          return recordValue != value;
        case '>':
          return recordValue > value;
        case '<':
          return recordValue < value;
        case '>=':
          return recordValue >= value;
        case '<=':
          return recordValue <= value;
        case 'LIKE':
          if (value === null || recordValue === null) return false;
          const pattern = value.replace(/%/g, '.*').replace(/_/g, '.');
          return new RegExp('^' + pattern + '$', 'i').test(String(recordValue));
        default:
          return true;
      }
    });
  });
}

function splitSetClause(setClause) {
  const parts = [];
  let depth = 0;
  let inString = false;
  let current = '';

  for (let i = 0; i < setClause.length; i++) {
    const ch = setClause[i];
    if (ch === "'") {
      inString = !inString;
      current += ch;
    } else if (!inString && ch === '(') {
      depth++;
      current += ch;
    } else if (!inString && ch === ')') {
      depth--;
      current += ch;
    } else if (!inString && depth === 0 && ch === ',') {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

function applySet(record, setClause, params) {
  const sets = splitSetClause(setClause);
  let paramIndex = 0;

  sets.forEach(set => {
    set = set.trim();
    const match = set.match(/(\w+)\s*=\s*(.+)/i);
    if (match) {
      const field = match[1];
      let value = match[2].trim();
      let skip = false;

      if (value === '?') {
        value = params[paramIndex++];
        if (value === undefined || value === null) {
          skip = true;
        }
      } else if (value.toUpperCase().startsWith('COALESCE')) {
        const coalesceMatch = value.match(/COALESCE\s*\(\s*\?\s*,\s*(\w+)\s*\)/i);
        if (coalesceMatch) {
          const paramVal = params[paramIndex++];
          if (paramVal !== undefined && paramVal !== null) {
            value = paramVal;
          } else {
            skip = true;
          }
        }
      } else if (/^DATETIME\s*\(/i.test(value)) {
        value = nowStr();
      } else {
        const incMatch = value.match(/^(\w+)\s*([+-])\s*(\d+)$/i);
        if (incMatch) {
          const srcField = incMatch[1];
          const op = incMatch[2];
          const num = parseInt(incMatch[3]);
          if (record[srcField] !== undefined) {
            const current = parseFloat(record[srcField]) || 0;
            value = op === '+' ? current + num : current - num;
          }
        } else {
          if (/^-?\d+\.?\d*$/.test(value)) {
            value = parseFloat(value);
          } else if (/^'.*'$/.test(value)) {
            value = value.slice(1, -1);
          }
        }
      }

      if (!skip) {
        record[field] = value;
      }
    }
  });
}

function checkUnique(table, columns, params) {
  const uniqueFields = {
    factories: ['name'],
    routes: null,
    vehicles: ['plate_number'],
    schedules: ['route_id', 'schedule_date', 'departure_time'],
    employees: ['employee_no'],
    reservations: null,
    waitlist: null,
    daily_ledgers: ['ledger_date', 'schedule_id'],
    capacity_alerts: null,
    system_configs: ['config_key']
  };

  const uniqueKeys = uniqueFields[table];
  if (!uniqueKeys) return null;

  return db[table].find(record => {
    return uniqueKeys.every((key, i) => {
      const colIndex = columns.indexOf(key);
      return colIndex >= 0 && record[key] == params[colIndex];
    });
  });
}

initDatabase();

module.exports = { db, run, get, all, exec, splitSetClause };
