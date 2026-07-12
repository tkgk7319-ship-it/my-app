import "dotenv/config";
import express from "express";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

// データベース接続の設定（Prisma 7 のアダプターを使う方法じゃ）
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
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
    // データベースにユーザーを保存するぞ
    const newUser = await prisma.user.create({ data: { name } });
    console.log("ユーザーを追加したぞ:", newUser);
  }
  res.redirect("/");
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
