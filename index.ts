import "dotenv/config";
import express from "express";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

// データベース接続の設定（Pool を作って adapter に渡す）
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter, log: ["query"] });

const app = express();
const PORT = process.env.PORT || 8888;

// テンプレートエンジン（EJS）の設定
app.set("view engine", "ejs");
app.set("views", "./views");

// フォームから送信されたデータを受け取るための設定
app.use(express.urlencoded({ extended: true }));

// 一覧表示（トップページ）
app.get("/", async (req, res) => {
  const users = await prisma.user.findMany();
  res.render("index", { users });
});

// ユーザー追加
app.post("/users", async (req, res) => {
  const name = req.body.name;
  if (name) {
    const newUser = await prisma.user.create({ data: { name } });
    console.log("ユーザーを追加したぞ:", newUser);
  }
  res.redirect("/");
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
