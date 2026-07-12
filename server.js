const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { createWorker } = require('tesseract.js');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure upload directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Multer Config for receipt image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|webp/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only images (jpeg, jpg, png, webp) are allowed.'));
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Initialize database
db.initDatabase()
  .then(() => console.log('Database initialized successfully.'))
  .catch(err => console.error('Database initialization failed:', err));

// --- OCR Parsing Helper Functions ---

function predictTag(itemName) {
  const foodKeywords = ['パン', '牛乳', '肉', '魚', '野菜', '弁当', '惣菜', 'サラダ', '茶', 'コーヒー', '水', 'チョコ', '菓子', '麺', '米', 'パスタ', 'マヨネーズ', '醤油', 'しょうゆ', '調味料', 'フード', '酒', 'ビール', 'ドリンク', '惣菜', '納豆', '卵', 'たまご', '豆腐', '肉', 'ソーセージ', 'ハム', 'ヨーグルト', 'チーズ'];
  const dailyKeywords = ['洗剤', 'シャンプー', 'リンス', 'ソープ', 'ティッシュ', 'ペーパー', 'タオル', 'ゴミ袋', 'スポンジ', '歯磨き', 'ブラシ', '洗顔', 'シート', 'クリーナー', 'ラップ', 'アルミホイル', '洗剤', '柔軟剤', 'マスク', 'ウェットティッシュ'];
  const fashionKeywords = ['服', 'シャツ', 'パンツ', '靴下', 'ソックス', 'コスメ', '美容', '髪', 'カット', 'リップ', 'ファンデ', 'ネイル', 'メイク', '化粧', '化粧水', 'クリーム'];
  const transportKeywords = ['切符', '乗車券', 'タクシー', 'ガソリン', '定期', 'バス', '電車', '駐車場', '高速道路', 'IC', 'Suica', 'Pasmo', 'チャージ'];
  const utilityKeywords = ['電気', 'ガス', '水道', '家賃', 'ネット', '通信', '光熱費', '携帯', 'スマホ', 'Wi-Fi', 'プロバイダ'];

  const nameUpper = itemName.toUpperCase();
  if (foodKeywords.some(kw => nameUpper.includes(kw))) return '食費';
  if (dailyKeywords.some(kw => nameUpper.includes(kw))) return '日用品';
  if (fashionKeywords.some(kw => nameUpper.includes(kw))) return '衣服・美容';
  if (transportKeywords.some(kw => nameUpper.includes(kw))) return '交通費';
  if (utilityKeywords.some(kw => nameUpper.includes(kw))) return '住居・光熱費';
  return 'その他';
}

function parseOcrText(text) {
  const lines = text.split('\n');
  const items = [];
  
  // Keywords to flag items for exclusion by default (usually totals, taxes, deposits, or changes)
  const excludeKeywords = ['合計', '小計', '小 計', '合 計', '消費税', '税', 'お釣', 'おつり', 'お預かり', 'お預り', '預かり', '預り', '釣', 'クレジット', '現金', '点', '割引', '値引', '対象', 'TAX', 'TOTAL', 'SUBTOTAL', 'CHANGE', 'CASH', '還元'];

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    // 1. Clean trailing noise
    let cleanLine = line.replace(/[\*＊\-\+\s\\|:#＃_]+$/, '').trim();
    if (!cleanLine) continue;

    // 2. Preprocessing: Remove typical OCR noises to avoid parsing them as prices/quantities
    
    // Remove percentages (e.g. "8%", "10%")
    let preparedLine = cleanLine.replace(/\b\d+%\s*/g, ' ');

    // Remove phone numbers (e.g. 045-577-0597)
    preparedLine = preparedLine.replace(/\b\d{2,4}[\-ー]\d{2,4}[\-ー]\d{3,4}\b/g, ' ');
    
    // Remove zip codes (e.g. 〒220-0012)
    preparedLine = preparedLine.replace(/\b\d{3}[\-ー]\d{4}\b/g, ' ');

    // Remove dates (both English format and Japanese format with spaces/symbols)
    preparedLine = preparedLine
      .replace(/\b\d{4}[/\-年\s]\d{1,2}[/\-月\s]\d{1,2}日?\b/g, ' ')
      .replace(/\b\d{1,2}[/\-月\s]\d{1,2}日?\b/g, ' ');

    // Correct common OCR misrecognitions for the thousandth digit "1" before a 3-digit number
    // e.g. "l,480" -> "1,480", "字,580" -> "1,580", "補,480" -> "1,480"
    // Converts l, I, i, t, f, |, [, (, /, 字, 補, 門, ト to '1' when preceding a 3-digit number boundary.
    preparedLine = preparedLine
      .replace(/([lItf\|\[\(\x2f\s字補門ト])\s*[.,:：\s]\s*(\d{3})\b/g, ' 1$2')
      .replace(/([lItf\|\[\(\x2f字補門ト])\s*(\d{3})\b/g, '1$2');

    // Merge thousands separators that OCR misrecognized as dots, colons, or spaces
    // e.g. "1.480" -> "1480", "1:580" -> "1580", "1 580" -> "1580"
    // Also merges standard comma separation "1,480" -> "1480"
    preparedLine = preparedLine.replace(/(\d{1,3})[.,:：\s]+(\d{3})\b/g, '$1$2');

    // 3. Extract numbers
    const numberRegex = /(\d+)/g;
    const matches = [...preparedLine.matchAll(numberRegex)];
    if (matches.length === 0) continue;

    // Convert matches to integer list
    const allNumbers = matches.map(m => {
      const val = parseInt(m[1], 10);
      return { val, index: m.index, text: m[0] };
    }).filter(n => n.val > 0 && n.val < 1000000); // Filter out zero or overly large numbers

    if (allNumbers.length === 0) continue;

    // VERY IMPORTANT: Only take the rightmost (last) 3 numbers.
    // This ignores dates, slip numbers, or other noise that appears at the left of the line.
    const numbers = allNumbers.slice(-3);

    let unitPrice = 0;
    let quantity = 1;
    let amount = 0;
    let priceIndex = -1;

    // 4. Classify numbers into UnitPrice, Quantity, and Subtotal
    if (numbers.length === 1) {
      unitPrice = numbers[0].val;
      quantity = 1;
      amount = numbers[0].val;
      priceIndex = numbers[0].index;
    } else if (numbers.length === 2) {
      const num1 = numbers[0].val;
      const num2 = numbers[1].val;

      if (num2 < 20 && num1 > 10) {
        // e.g. "150 2" -> 150 yen * 2
        unitPrice = num1;
        quantity = num2;
        amount = num1 * num2;
      } else if (num1 < 20 && num2 > 10) {
        // e.g. "2 150" -> 2 * 150 yen
        unitPrice = num2;
        quantity = num1;
        amount = num1 * num2;
      } else {
        // e.g. "1480 480" (where the thousandth digit was lost in subtotal)
        if (num1 > 100 && num2 > 100 && num1 % 1000 === num2) {
          unitPrice = num1;
          quantity = 1;
          amount = num1;
        } else {
          unitPrice = num1;
          amount = num2;
          if (num2 % num1 === 0 && (num2 / num1) < 20) {
            quantity = num2 / num1;
          } else {
            quantity = 1;
          }
        }
      }
      priceIndex = numbers[0].index; // Cut item name before the first number
    } else {
      // 3 or more numbers (e.g. "1480 1 480" where thousandth digit was lost)
      const val1 = numbers[0].val; // Unit Price
      const val2 = numbers[1].val; // Quantity
      const val3 = numbers[2].val; // Subtotal
      
      // If the math matches OR the lower 3 digits match (indicating a lost thousandth digit)
      if (Math.abs(val1 * val2 - val3) < 5 || (val1 * val2) % 1000 === val3 % 1000) {
        unitPrice = val1;
        quantity = val2;
        amount = val1 * val2; // Reconstruct the correct amount
      } else {
        if (val2 < 20) {
          quantity = val2;
          amount = val3;
          unitPrice = Math.round(amount / quantity);
        } else {
          unitPrice = val2;
          amount = val3;
          quantity = 1;
        }
      }
      priceIndex = numbers[0].index;
    }

    // 5. Extract item name (everything to the left of the prices in the prepared line)
    let name = preparedLine.substring(0, priceIndex).trim();
    
    // Remove misread currency character noise (like W, M, Y, V, etc.) from the end of the item name
    name = name.replace(/[\s\b]+[a-zA-Z]{1,2}$/g, '').trim(); // Remove space + 1-2 alphabet chars at the end
    name = name.replace(/[wWmMyYvV\x2f\\_]+$/g, '').trim();    // Strip typical currency-misread letters directly from end
    
    // Clean up formatting/noise symbols from the item name edges
    name = name.replace(/^[\*＊\-\+\s|│┃:：・.．,，_\[\]\(\)\{\}「」`’'”]+/g, '').trim(); 
    name = name.replace(/[\*＊\-\+\s|│┃:：・.．,，\\￥¥/_\[\]\(\)\{\}「」`’'”]+$/g, '').trim(); 

    // Allow 1+ character names (e.g., Single letter codes or 1-kanji items like '葱')
    if (name && name.length >= 1) {
      const shouldExclude = excludeKeywords.some(keyword => 
        name.toUpperCase().includes(keyword.toUpperCase()) || 
        cleanLine.toUpperCase().includes(keyword.toUpperCase())
      );
      
      items.push({
        name: name,
        amount: amount,
        unit_price: unitPrice,
        quantity: quantity,
        is_selected: shouldExclude ? 0 : 1,
        suggested_tag: predictTag(name)
      });
    }
  }

  return items;
}

// --- API Endpoints ---

// 1. Get available tags
app.get('/api/tags', async (req, res) => {
  try {
    const tags = await db.all('SELECT * FROM tags ORDER BY id');
    res.json(tags);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve tags: ' + err.message });
  }
});

// 2. Upload receipt and run OCR
app.post('/api/upload', upload.single('receipt'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Please upload a receipt image.' });
  }

  const imagePath = req.file.path;
  let worker = null;

  try {
    console.log(`Starting OCR on file: ${imagePath}`);
    worker = await createWorker('jpn+eng');
    
    const { data: { text } } = await worker.recognize(imagePath);
    console.log('OCR completed raw text preview:\n', text.substring(0, 300) + '...');
    
    // Parse the raw text
    const parsedItems = parseOcrText(text);

    // Retrieve all tags to map the suggested tags to tag IDs
    const tags = await db.all('SELECT * FROM tags');
    const tagMap = {};
    tags.forEach(t => {
      tagMap[t.name] = t.id;
    });
    
    // Map suggested tags to tag IDs, fallback to "その他"
    const otherTag = tags.find(t => t.name === 'その他');
    const otherTagId = otherTag ? otherTag.id : null;

    const itemsWithIds = parsedItems.map(item => ({
      name: item.name,
      amount: item.amount,
      unit_price: item.unit_price,
      quantity: item.quantity,
      is_selected: item.is_selected,
      tag_id: tagMap[item.suggested_tag] || otherTagId
    }));

    // Cleanup local uploaded file after OCR
    fs.unlink(imagePath, (err) => {
      if (err) console.error('Failed to delete temporary file:', err);
    });

    res.json({
      success: true,
      raw_text: text,
      items: itemsWithIds
    });

  } catch (err) {
    console.error('OCR processing error:', err);
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }
    res.status(500).json({ error: 'OCR engine error: ' + err.message });
  } finally {
    if (worker) {
      await worker.terminate();
    }
  }
});

// 3. Save receipt / expense
app.post('/api/expenses', async (req, res) => {
  const { date, memo, items } = req.body;

  if (!date) {
    return res.status(400).json({ error: 'Date is required.' });
  }
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'At least one item is required.' });
  }

  try {
    // Calculate total amount from selected items
    const totalAmount = items
      .filter(item => item.is_selected === 1)
      .reduce((sum, item) => sum + parseInt(item.amount, 10), 0);

    // Insert expense
    const expenseResult = await db.run(
      'INSERT INTO expenses (date, total_amount, memo) VALUES (?, ?, ?) RETURNING id',
      [date, totalAmount, memo || '']
    );
    const expenseId = expenseResult.id;

    // Insert items (including unit_price and quantity)
    for (const item of items) {
      await db.run(
        'INSERT INTO expense_items (expense_id, name, amount, unit_price, quantity, tag_id, is_selected) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          expenseId, 
          item.name, 
          parseInt(item.amount, 10), 
          parseInt(item.unit_price || 0, 10),
          parseInt(item.quantity || 1, 10),
          item.tag_id || null, 
          item.is_selected
        ]
      );
    }

    res.json({
      success: true,
      expense_id: expenseId,
      total_amount: totalAmount,
      message: 'Expense saved successfully.'
    });

  } catch (err) {
    res.status(500).json({ error: 'Failed to save expense: ' + err.message });
  }
});

// 4. Retrieve expenses for a specific period
app.get('/api/expenses', async (req, res) => {
  const { start_date, end_date } = req.query;

  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'Both start_date and end_date (YYYY-MM-DD) are required.' });
  }

  try {
    // Fetch all expenses in the date range
    const expenses = await db.all(
      `SELECT * FROM expenses 
       WHERE date >= ? AND date <= ? 
       ORDER BY date DESC, created_at DESC`,
      [start_date, end_date]
    );

    // Fetch all individual items for these expenses
    const expenseIds = expenses.map(e => e.id);
    let items = [];
    
    if (expenseIds.length > 0) {
      const placeholders = expenseIds.map(() => '?').join(',');
      items = await db.all(
        `SELECT ei.*, t.name as tag_name, t.color as tag_color 
         FROM expense_items ei
         LEFT JOIN tags t ON ei.tag_id = t.id
         WHERE ei.expense_id IN (${placeholders})`,
        expenseIds
      );
    }

    // Map items to their parent expenses
    const expensesWithItems = expenses.map(e => {
      const eItems = items.filter(item => item.expense_id === e.id);
      return {
        ...e,
        items: eItems
      };
    });

    // Calculate aggregated metrics
    // 1. Total spent in period
    const totalSpent = expenses.reduce((sum, e) => sum + e.total_amount, 0);

    // 2. Daily aggregate
    const dailyMap = {};
    expenses.forEach(e => {
      dailyMap[e.date] = (dailyMap[e.date] || 0) + e.total_amount;
    });
    const dailyExpenses = Object.keys(dailyMap).map(date => ({
      date,
      amount: dailyMap[date]
    })).sort((a, b) => b.date.localeCompare(a.date));

    // 3. Tag (Category) aggregate for selected items
    const tagMap = {};
    items.forEach(item => {
      if (item.is_selected === 1) {
        const tagName = item.tag_name || '未設定';
        const tagColor = item.tag_color || '#868e96';
        if (!tagMap[tagName]) {
          tagMap[tagName] = { amount: 0, color: tagColor };
        }
        tagMap[tagName].amount += item.amount;
      }
    });
    
    const categoryBreakdown = Object.keys(tagMap).map(name => ({
      name,
      amount: tagMap[name].amount,
      color: tagMap[name].color
    })).sort((a, b) => b.amount - a.amount);

    res.json({
      expenses: expensesWithItems,
      total_spent: totalSpent,
      daily: dailyExpenses,
      categories: categoryBreakdown
    });

  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve expenses: ' + err.message });
  }
});

// 5. Delete an expense
app.delete('/api/expenses/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await db.run('DELETE FROM expenses WHERE id = ?', [id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Expense record not found.' });
    }
    res.json({ success: true, message: 'Expense deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete expense: ' + err.message });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Something went wrong on the server!' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
