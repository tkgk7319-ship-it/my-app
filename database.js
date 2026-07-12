const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/receipt_manager';

// On Render, SSL is required for external PostgreSQL.
// We enable rejectUnauthorized: false when DATABASE_URL is defined.
const isProduction = !!process.env.DATABASE_URL;
const pool = new Pool({
  connectionString: connectionString,
  ssl: isProduction ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

// Helper to convert SQLite style '?' placeholders to PostgreSQL style '$1, $2...'
function convertPlaceholders(sql) {
  let index = 1;
  return sql.replace(/\?/g, () => `$${index++}`);
}

// Promise wrappers to mimic SQLite API signatures for compatibility
const run = async (sql, params = []) => {
  const processedSql = convertPlaceholders(sql);
  const res = await pool.query(processedSql, params);
  const id = res.rows && res.rows[0] && res.rows[0].id ? res.rows[0].id : null;
  return { id, changes: res.rowCount };
};

const all = async (sql, params = []) => {
  const processedSql = convertPlaceholders(sql);
  const res = await pool.query(processedSql, params);
  return res.rows;
};

const get = async (sql, params = []) => {
  const processedSql = convertPlaceholders(sql);
  const res = await pool.query(processedSql, params);
  return res.rows[0] || null;
};

// Database Initialization
async function initDatabase() {
  // Create Tags Table
  await run(`
    CREATE TABLE IF NOT EXISTS tags (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      color VARCHAR(50) NOT NULL
    )
  `);

  // Create Expenses Table
  await run(`
    CREATE TABLE IF NOT EXISTS expenses (
      id SERIAL PRIMARY KEY,
      date VARCHAR(10) NOT NULL, -- YYYY-MM-DD
      total_amount INTEGER NOT NULL DEFAULT 0,
      memo TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create Expense Items Table
  await run(`
    CREATE TABLE IF NOT EXISTS expense_items (
      id SERIAL PRIMARY KEY,
      expense_id INTEGER NOT NULL,
      name VARCHAR(255) NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0,
      unit_price INTEGER NOT NULL DEFAULT 0,
      quantity INTEGER NOT NULL DEFAULT 1,
      tag_id INTEGER,
      is_selected INTEGER NOT NULL DEFAULT 1, -- 0 = false, 1 = true
      FOREIGN KEY (expense_id) REFERENCES expenses (id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE SET NULL
    )
  `);

  // Check columns for migration (using information_schema.columns)
  const columnsRes = await pool.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'expense_items'
  `);
  const columns = columnsRes.rows.map(row => row.column_name.toLowerCase());
  const hasUnitPrice = columns.includes('unit_price');
  const hasQuantity = columns.includes('quantity');

  if (!hasUnitPrice) {
    await run('ALTER TABLE expense_items ADD COLUMN unit_price INTEGER DEFAULT 0');
    console.log('Database migrated: added unit_price to expense_items');
  }
  if (!hasQuantity) {
    await run('ALTER TABLE expense_items ADD COLUMN quantity INTEGER DEFAULT 1');
    console.log('Database migrated: added quantity to expense_items');
  }

  // Insert default tags if none exist
  const defaultTags = [
    { name: '食費', color: '#ff6b6b' },
    { name: '日用品', color: '#ff9233' },
    { name: '交際費', color: '#4dabf7' },
    { name: '交通費', color: '#2b8a3e' },
    { name: '衣服・美容', color: '#f783ac' },
    { name: '住居・光熱費', color: '#ffd43b' },
    { name: 'その他', color: '#868e96' }
  ];

  const existingTags = await all('SELECT COUNT(*) as count FROM tags');
  const tagCount = parseInt(existingTags[0].count, 10);

  if (tagCount === 0) {
    for (const tag of defaultTags) {
      try {
        await run('INSERT INTO tags (name, color) VALUES (?, ?)', [tag.name, tag.color]);
      } catch (err) {
        console.error('Error inserting default tag:', err.message);
      }
    }
    console.log('Inserted default tags into the database.');
  }
}

module.exports = {
  initDatabase,
  run,
  all,
  get,
  pool
};
