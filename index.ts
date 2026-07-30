import "dotenv/config";
import express from "express";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";
import multer from "multer";
import cors from "cors";
import path from "path";
import fs from "fs";
import { createWorker } from "tesseract.js";

// データベース接続の設定
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter, log: ["query"] });

// 認証ユーティリティ
const crypto = require('crypto');
function hashPassword(password: string) {
  return crypto.createHash('sha256').update(password).digest('hex');
}
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// 認証ミドルウェア
async function requireAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const user = await prisma.user.findUnique({ where: { token } });
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

const app = express();
const PORT = process.env.PORT || 8888;

// ミドルウェア
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// EJS の設定
app.set("view engine", "ejs");
app.set("views", "./views");

// --- トップページを家計簿アプリに差し替え ---
app.use(express.static("public"));

// アップロード先ディレクトリの確保
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

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
  limits: { fileSize: 5 * 1024 * 1024 }
});

// デフォルトタグの初期化
async function initDefaultTags() {
  try {
    const count = await prisma.tag.count();
    if (count === 0) {
      const defaultTags = [
        { name: '食費', color: '#ff6b6b' },
        { name: '日用品', color: '#ff9233' },
        { name: '交際費', color: '#4dabf7' },
        { name: '交通費', color: '#2b8a3e' },
        { name: '衣服・美容', color: '#f783ac' },
        { name: '住居・光熱費', color: '#ffd43b' },
        { name: 'その他', color: '#868e96' }
      ];
      await prisma.tag.createMany({ data: defaultTags, skipDuplicates: true });
      console.log("Default tags initialized.");
    }
  } catch (err) {
    console.error("Failed to initialize tags. Make sure DB is migrated:", err);
  }
}
initDefaultTags();

// --- OCR Parsing Helper Functions ---
function predictTag(itemName: string) {
  const foodKeywords = ['パン', '牛乳', '肉', '魚', '野菜', '弁当', '惣菜', 'サラダ', '茶', 'コーヒー', '水', 'チョコ', '菓子', '麺', '米', 'パスタ', 'マヨネーズ', '醤油', 'しょうゆ', '調味料', 'フード', '酒', 'ビール', 'ドリンク', '納豆', '卵', 'たまご', '豆腐', 'ソーセージ', 'ハム', 'ヨーグルト', 'チーズ'];
  const dailyKeywords = ['洗剤', 'シャンプー', 'リンス', 'ソープ', 'ティッシュ', 'ペーパー', 'タオル', 'ゴミ袋', 'スポンジ', '歯磨き', 'ブラシ', '洗顔', 'シート', 'クリーナー', 'ラップ', 'アルミホイル', '柔軟剤', 'マスク', 'ウェットティッシュ'];
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

function parseOcrText(text: string) {
  const lines = text.split('\n');
  const items: any[] = [];
  const excludeKeywords = ['合計', '小計', '小 計', '合 計', '消費税', '税', 'お釣', 'おつり', 'お預かり', 'お預り', '預かり', '預り', '釣', 'クレジット', '現金', '点', '割引', '値引', '対象', 'TAX', 'TOTAL', 'SUBTOTAL', 'CHANGE', 'CASH', '還元'];

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    let cleanLine = line.replace(/[\*＊\-\+\s\\|:#＃_]+$/, '').trim();
    if (!cleanLine) continue;

    let preparedLine = cleanLine.replace(/\b\d+%\s*/g, ' ');
    preparedLine = preparedLine.replace(/\b\d{2,4}[\-ー]\d{2,4}[\-ー]\d{3,4}\b/g, ' ');
    preparedLine = preparedLine.replace(/\b\d{3}[\-ー]\d{4}\b/g, ' ');
    preparedLine = preparedLine.replace(/\b\d{4}[/\-年\s]\d{1,2}[/\-月\s]\d{1,2}日?\b/g, ' ').replace(/\b\d{1,2}[/\-月\s]\d{1,2}日?\b/g, ' ');
    preparedLine = preparedLine.replace(/([lItf\|\[\(\x2f\s字補門ト])\s*[.,:：\s]\s*(\d{3})\b/g, ' 1$2').replace(/([lItf\|\[\(\x2f字補門ト])\s*(\d{3})\b/g, '1$2');
    preparedLine = preparedLine.replace(/(\d{1,3})[.,:：\s]+(\d{3})\b/g, '$1$2');

    const numberRegex = /(\d+)/g;
    const matches = [...preparedLine.matchAll(numberRegex)];
    if (matches.length === 0) continue;

    const allNumbers = matches.map(m => {
      const val = parseInt(m[1], 10);
      return { val, index: m.index as number, text: m[0] };
    }).filter(n => n.val > 0 && n.val < 1000000);

    if (allNumbers.length === 0) continue;

    const numbers = allNumbers.slice(-3);
    let unitPrice = 0;
    let quantity = 1;
    let amount = 0;
    let priceIndex = -1;

    if (numbers.length === 1) {
      unitPrice = numbers[0].val;
      quantity = 1;
      amount = numbers[0].val;
      priceIndex = numbers[0].index;
    } else if (numbers.length === 2) {
      const num1 = numbers[0].val;
      const num2 = numbers[1].val;
      if (num2 < 20 && num1 > 10) {
        unitPrice = num1; quantity = num2; amount = num1 * num2;
      } else if (num1 < 20 && num2 > 10) {
        unitPrice = num2; quantity = num1; amount = num1 * num2;
      } else {
        if (num1 > 100 && num2 > 100 && num1 % 1000 === num2) {
          unitPrice = num1; quantity = 1; amount = num1;
        } else {
          unitPrice = num1; amount = num2;
          if (num2 % num1 === 0 && (num2 / num1) < 20) {
            quantity = num2 / num1;
          } else {
            quantity = 1;
          }
        }
      }
      priceIndex = numbers[0].index;
    } else {
      const val1 = numbers[0].val;
      const val2 = numbers[1].val;
      const val3 = numbers[2].val;
      if (Math.abs(val1 * val2 - val3) < 5 || (val1 * val2) % 1000 === val3 % 1000) {
        unitPrice = val1; quantity = val2; amount = val1 * val2;
      } else {
        if (val2 < 20) {
          quantity = val2; amount = val3; unitPrice = Math.round(amount / quantity);
        } else {
          unitPrice = val2; amount = val3; quantity = 1;
        }
      }
      priceIndex = numbers[0].index;
    }

    let name = preparedLine.substring(0, priceIndex).trim();
    name = name.replace(/[\s\b]+[a-zA-Z]{1,2}$/g, '').trim();
    name = name.replace(/[wWmMyYvV\x2f\\_]+$/g, '').trim();
    name = name.replace(/^[\*＊\-\+\s|│┃:：・.．,，_\[\]\(\)\{\}「」`’'”]+/g, '').trim(); 
    name = name.replace(/[\*＊\-\+\s|│┃:：・.．,，\\￥¥/_\[\]\(\)\{\}「」`’'”]+$/g, '').trim(); 

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

// Auth API
app.post('/api/auth/register', async (req: any, res: any) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  try {
    const hashedPassword = hashPassword(password);
    const token = generateToken();
    const user = await prisma.user.create({
      data: { username, password: hashedPassword, token }
    });
    res.json({ success: true, token: user.token, username: user.username });
  } catch (err: any) {
    if (err.code === 'P2002') return res.status(400).json({ error: 'Username already taken' });
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req: any, res: any) => {
  const { username, password } = req.body;
  try {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || user.password !== hashPassword(password)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const token = generateToken();
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { token }
    });
    res.json({ success: true, token: updatedUser.token, username: updatedUser.username });
  } catch (err: any) {
    res.status(500).json({ error: 'Login failed' });
  }
});

app.delete('/api/auth/me', requireAuth, async (req: any, res: any) => {
  try {
    // req.user.id is validated by requireAuth
    await prisma.user.delete({ where: { id: req.user.id } });
    res.json({ success: true, message: 'Account deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: 'Account deletion failed' });
  }
});

// Tags API
app.get('/api/tags', requireAuth, async (req: any, res: any) => {
  try {
    const tags = await prisma.tag.findMany({ 
      where: { OR: [{ userId: null }, { userId: req.user.id }] },
      orderBy: { id: 'asc' } 
    });
    res.json(tags);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve tags: ' + err.message });
  }
});

app.post('/api/tags', requireAuth, async (req: any, res: any) => {
  const { name, color } = req.body;
  if (!name || !color) return res.status(400).json({ error: 'Name and color are required.' });
  try {
    const tag = await prisma.tag.create({ data: { name, color, userId: req.user.id } });
    res.json({ success: true, tag });
  } catch (err: any) {
    if (err.code === 'P2002') return res.status(400).json({ error: 'Tag name already exists.' });
    res.status(500).json({ error: 'Failed to create tag: ' + err.message });
  }
});

app.put('/api/tags/:id', requireAuth, async (req: any, res: any) => {
  const { id } = req.params;
  const { name, color } = req.body;
  if (!name || !color) return res.status(400).json({ error: 'Name and color are required.' });
  try {
    const existing = await prisma.tag.findUnique({ where: { id: parseInt(id, 10) } });
    if (!existing || existing.userId !== req.user.id) {
      return res.status(403).json({ error: 'Cannot update global tags or tags you do not own.' });
    }
    const tag = await prisma.tag.update({
      where: { id: parseInt(id, 10) },
      data: { name, color }
    });
    res.json({ success: true, tag });
  } catch (err: any) {
    if (err.code === 'P2002') return res.status(400).json({ error: 'Tag name already exists.' });
    res.status(500).json({ error: 'Failed to update tag: ' + err.message });
  }
});

app.delete('/api/tags/:id', requireAuth, async (req: any, res: any) => {
  const { id } = req.params;
  try {
    const existing = await prisma.tag.findUnique({ where: { id: parseInt(id, 10) } });
    if (!existing || existing.userId !== req.user.id) {
      return res.status(403).json({ error: 'Cannot delete global tags or tags you do not own.' });
    }
    await prisma.tag.delete({ where: { id: parseInt(id, 10) } });
    res.json({ success: true, message: 'Tag deleted successfully.' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete tag: ' + err.message });
  }
});

// Upload and OCR
app.post('/api/upload', requireAuth, upload.single('receipt'), async (req: any, res: any) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Please upload a receipt image.' });
  }
  const imagePath = req.file.path;
  let worker: any = null;

  try {
    worker = await createWorker('jpn');
    const { data: { text } } = await worker.recognize(imagePath);
    const parsedItems = parseOcrText(text);

    const tags = await prisma.tag.findMany({
      where: { OR: [{ userId: null }, { userId: req.user.id }] }
    });
    const tagMap: Record<string, number> = {};
    tags.forEach((t: any) => { tagMap[t.name] = t.id; });
    const otherTag = tags.find((t: any) => t.name === 'その他');
    const otherTagId = otherTag ? otherTag.id : null;

    const itemsWithIds = parsedItems.map(item => ({
      ...item,
      tag_id: tagMap[item.suggested_tag] || otherTagId
    }));

    fs.unlink(imagePath, () => {});

    res.json({ success: true, raw_text: text, items: itemsWithIds });
  } catch (err: any) {
    if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
    res.status(500).json({ error: 'OCR engine error: ' + err.message });
  } finally {
    if (worker) await worker.terminate();
  }
});

// Save Expense
app.post('/api/expenses', requireAuth, async (req: any, res: any) => {
  const { date, memo, items } = req.body;
  if (!date) return res.status(400).json({ error: 'Date is required.' });
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'At least one item is required.' });
  }

  try {
    const totalAmount = items
      .filter((item: any) => item.is_selected === 1)
      .reduce((sum: number, item: any) => sum + parseInt(item.amount, 10), 0);

    // Process inline tag creation
    for (const item of items) {
      if (item.tag_id === 'new' && item.new_tag_name) {
        let existingTag = await prisma.tag.findFirst({
          where: { name: item.new_tag_name, OR: [{ userId: null }, { userId: req.user.id }] }
        });
        if (!existingTag) {
          existingTag = await prisma.tag.create({
            data: { name: item.new_tag_name, color: item.new_tag_color || '#868e96', userId: req.user.id }
          });
        }
        item.tag_id = existingTag.id;
      }
    }

    const expense = await prisma.expense.create({
      data: {
        userId: req.user.id,
        date,
        totalAmount,
        memo: memo || '',
        items: {
          create: items.map((item: any) => ({
            name: item.name,
            amount: parseInt(item.amount, 10),
            unitPrice: parseInt(item.unit_price || 0, 10),
            quantity: parseInt(item.quantity || 1, 10),
            tagId: parseInt(item.tag_id, 10) || null,
            isSelected: item.is_selected
          }))
        }
      }
    });

    res.json({ success: true, expense_id: expense.id, total_amount: totalAmount, message: 'Expense saved successfully.' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to save expense: ' + err.message });
  }
});

// Get Top Items Analysis
app.get('/api/analysis/top-items', requireAuth, async (req: any, res: any) => {
  const { start_date, end_date } = req.query;
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'Both start_date and end_date are required.' });
  }

  try {
    const items = await prisma.expenseItem.findMany({
      where: {
        isSelected: 1,
        expense: {
          userId: req.user.id,
          date: { gte: String(start_date), lte: String(end_date) }
        }
      },
      include: { tag: true }
    });

    const grouped: Record<string, { name: string, total_amount: number, quantity: number, tag_name: string, tag_color: string }> = {};

    items.forEach((item: any) => {
      const name = item.name.trim();
      if (!name) return;
      
      if (!grouped[name]) {
        grouped[name] = {
          name: name,
          total_amount: 0,
          quantity: 0,
          tag_name: item.tag?.name || '未分類',
          tag_color: item.tag?.color || '#868e96'
        };
      }
      grouped[name].total_amount += item.amount;
      grouped[name].quantity += (item.quantity || 1);
    });

    const sorted = Object.values(grouped).sort((a, b) => {
      if (b.quantity === a.quantity) {
        return b.total_amount - a.total_amount;
      }
      return b.quantity - a.quantity;
    }).slice(0, 20);

    res.json({ success: true, top_items: sorted });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to analyze top items: ' + err.message });
  }
});

// Get Expenses
app.get('/api/expenses', requireAuth, async (req: any, res: any) => {
  const { start_date, end_date } = req.query;
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'Both start_date and end_date are required.' });
  }

  try {
    const expenses = await prisma.expense.findMany({
      where: { userId: req.user.id, date: { gte: String(start_date), lte: String(end_date) } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: { items: { include: { tag: true } } }
    });

    const mappedExpenses = expenses.map((e: any) => ({
      ...e,
      total_amount: e.totalAmount,
      created_at: e.createdAt,
      items: e.items.map((item: any) => ({
        ...item,
        unit_price: item.unitPrice,
        tag_id: item.tagId,
        is_selected: item.isSelected,
        tag_name: item.tag?.name || '未設定',
        tag_color: item.tag?.color || '#868e96'
      }))
    }));

    const totalSpent = mappedExpenses.reduce((sum: number, e: any) => sum + e.total_amount, 0);

    const dailyMap: Record<string, number> = {};
    mappedExpenses.forEach((e: any) => {
      dailyMap[e.date] = (dailyMap[e.date] || 0) + e.total_amount;
    });
    const dailyExpenses = Object.keys(dailyMap).map(date => ({
      date, amount: dailyMap[date]
    })).sort((a, b) => b.date.localeCompare(a.date));

    const tagMap: Record<string, { amount: number, color: string }> = {};
    mappedExpenses.forEach((e: any) => {
      e.items.forEach((item: any) => {
        if (item.is_selected === 1) {
          const tagName = item.tag_name;
          const tagColor = item.tag_color;
          if (!tagMap[tagName]) tagMap[tagName] = { amount: 0, color: tagColor };
          tagMap[tagName].amount += item.amount;
        }
      });
    });

    const categoryBreakdown = Object.keys(tagMap).map(name => ({
      name, amount: tagMap[name].amount, color: tagMap[name].color
    })).sort((a, b) => b.amount - a.amount);

    res.json({
      expenses: mappedExpenses,
      total_spent: totalSpent,
      daily: dailyExpenses,
      categories: categoryBreakdown
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve expenses: ' + err.message });
  }
});

// Delete Expense
app.delete('/api/expenses/:id', requireAuth, async (req: any, res: any) => {
  const { id } = req.params;
  try {
    const expense = await prisma.expense.findUnique({ where: { id: parseInt(id, 10) } });
    if (!expense || expense.userId !== req.user.id) {
      return res.status(403).json({ error: 'Cannot delete expenses you do not own.' });
    }
    await prisma.expense.delete({ where: { id: parseInt(id, 10) } });
    res.json({ success: true, message: 'Expense deleted successfully.' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete expense: ' + err.message });
  }
});

// --- Existing Old App Endpoints ---
// Users page moved to /users-list to allow root / to serve static files (public/index.html)
app.get("/users-list", async (req: any, res: any) => {
  try {
    const users = await prisma.user.findMany();
    res.render("index", { users });
  } catch (err) {
    res.render("index", { users: [] });
  }
});

app.post("/users", async (req: any, res: any) => {
  const name = req.body.name;
  const age = req.body.age ? Number(req.body.age) : null;
  if (name) {
    try {
      await prisma.user.create({ data: { name, age } });
    } catch (err) {
      console.error(err);
    }
  }
  res.redirect("/users-list");
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
