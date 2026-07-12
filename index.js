import http from "node:http";

// ポート番号の設定。Renderでは環境変数 PORT が使われるので、それがあれば使い、なければ 8888 を使う
const PORT = process.env.PORT || 8888;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // ブラウザで日本語が文字化けしないように設定
  res.setHeader("Content-Type", "text/plain; charset=utf-8");

  if (url.pathname === "/") {
    // トップページにアクセスしたとき
    res.writeHead(200);
    res.end("こんにちは！");
  } else if (url.pathname === "/ask") {
    // /ask?q=質問内容 という形式でアクセスしたとき
    const q = url.searchParams.get("q") ?? "質問がありません";
    res.writeHead(200);
    res.end(`あなたの質問は '${q}' ですな。`);
  } else {
    // それ以外のページ
    res.writeHead(404);
    res.end("ページが見つかりませんぞ。");
  }
});

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
