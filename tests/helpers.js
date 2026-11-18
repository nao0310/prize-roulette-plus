// テスト共通の道具：ローカルサーバー / file:// の切り替え、ページを開く、エラーと通信の記録
// 使い方：MODE=http か MODE=file を付けて `node --test tests/` （tests/run.sh で両方を実行）
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const MODE = process.env.MODE === "file" ? "file" : "http";
const TYPES = { ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".xlsx": "application/octet-stream", ".csv": "text/csv" };

let server = null, baseUrl = null, browser = null;

async function startServer() {
  if (MODE === "file") return "file://" + ROOT + "/index.html";
  server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const f = path.join(ROOT, p === "/" ? "index.html" : p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${server.address().port}/index.html`;
}

async function setup() {
  if (!browser) { baseUrl = await startServer(); browser = await chromium.launch({ env: { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" } }); }   // ロケールがないと日本語のファイル名が「download」になる
  return { browser, baseUrl };
}
async function teardown() {
  if (browser) await browser.close();
  if (server) await new Promise(r => server.close(r));
  browser = null; server = null;
}

// 1つのテスト用にページを開く。storage に入れた値は読み込み前に localStorage に入る
// opts: { viewport, storage: {key: value(string|object)}, reducedMotion, clock, hash, device, noStorage }
async function open(opts = {}) {
  await setup();
  const ctxOpts = { ...(opts.device || {}), acceptDownloads: true };
  if (opts.viewport) ctxOpts.viewport = opts.viewport;
  if (opts.reducedMotion) ctxOpts.reducedMotion = "reduce";
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  const errors = [], external = [], consoleMsgs = [];
  page.on("pageerror", e => errors.push(String(e && e.stack || e)));
  page.on("console", m => { consoleMsgs.push(`${m.type()}: ${m.text()}`); if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("request", r => {
    const u = r.url();
    const local = u.startsWith("data:") || u.startsWith("blob:") || u.startsWith("file://") || (baseUrl.startsWith("http") && u.startsWith(new URL(baseUrl).origin));
    if (!local) external.push(u);
  });
  if (opts.storage || opts.noStorage) {
    await page.addInitScript(([st, noStorage]) => {
      if (noStorage) {
        Object.defineProperty(window, "localStorage", { get() { throw new DOMException("denied", "SecurityError"); } });
        return;
      }
      // 再読み込みでは入れ直さない（目印を sessionStorage に置くと、file:// でまれに入れ直してしまうため localStorage に置く）
      if (localStorage.getItem("__test_seeded")) return;
      localStorage.setItem("__test_seeded", "1");
      for (const [k, v] of Object.entries(st || {})) localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
    }, [opts.storage || null, !!opts.noStorage]);
  }
  if (opts.clock) await page.clock.install();
  await page.goto(baseUrl + (opts.hash ? "#" + opts.hash : ""));
  try { await page.waitForFunction(() => document.querySelector("#spinBtn") && document.body.className.includes("view-"), null, { timeout: opts.initTimeout || 10000 }); } catch (e) { if (!opts.allowInitFail) throw e; }
  return { page, context, errors, external, consoleMsgs, close: () => context.close() };
}

// 抽選を1回分すすめる（clock を入れたページ用）。当選番号を返す
async function spinOnce(page) {
  await page.evaluate(() => document.getElementById("spinBtn").click());
  for (let k = 0; k < 40 && await page.locator("#reveal").isHidden(); k++) await page.clock.runFor(1000);
  const num = +(await page.locator("#bigNum").textContent());
  return num;
}
async function closeReveal(page) {
  await page.keyboard.press("Escape");
  await page.clock.runFor(300);
}
// ストレージの中身（JSON）
const stored = (page, key = "prize-plus-v1") => page.evaluate(k => JSON.parse(localStorage.getItem(k) || "null"), key);

// 横スクロール・はみ出しのチェック：見えている要素で、画面の右端より外に出ているもの
async function overflowReport(page) {
  return page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const out = [];
    if (document.documentElement.scrollWidth > W + 1) out.push(`page scrollWidth ${document.documentElement.scrollWidth} > ${W}`);
    for (const el of document.querySelectorAll("body *")) {
      if (el.closest(".table-wrap") && el.tagName !== "DIV") continue;   // 表は横スクロールの枠の中
      if (el.closest(".tabs") && el.classList.contains("tab")) continue;  // タブは横スクロールの枠の中
      if (el.id === "confetti" || el.classList.contains("rays") || el.closest("[hidden]")) continue;   // 光の放射は飾り（枠の外は切る前提）
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.right > W + 1 || r.left < -1) out.push(`${el.tagName}#${el.id}.${el.className} [${Math.round(r.left)},${Math.round(r.right)}] W=${W}`);
    }
    return out.slice(0, 15);
  });
}

module.exports = { MODE, ROOT, setup, teardown, open, spinOnce, closeReveal, stored, overflowReport };

// 景品 n 件の保存データ
const makePrizes = n => Array.from({ length: n }, (_, i) => ({ rank: i + 1, name: `景品${i + 1}` }));
// 名簿の保存データ：{番号: 名前}
const makeMembers = obj => ({ members: Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { name: v, kind: v ? "name" : "none", at: 1700000000000 }])), file: "" });
// 抽選画面の一覧：[{rank, num}]
const listState = page => page.$$eval("#prizeList .prow", rows => rows.map(r => ({ rank: parseInt(r.querySelector(".rk").textContent, 10), num: r.querySelector(".ball-sm") ? +r.querySelector(".ball-sm").textContent : null, who: (r.querySelector(".who") || {}).textContent || "" })));
module.exports.makePrizes = makePrizes;
module.exports.makeMembers = makeMembers;
module.exports.listState = listState;
