// 表示の総点検（通常のテストでは見つけにくい問題を探す）
//   node tests/audit.js            結果を表示（問題があれば終了コード 1）
//   SHOT_DIR=dir node tests/audit.js   スクリーンショットも保存する
//
// 通常のテスト（tests/*.test.js）で見つけにくかった理由と、ここでの対策：
//  1. テスト用のブラウザはスクロールバーを隠す（幅0）→ 実際のブラウザと同じくスクロールバーを出して確かめる
//  2. 画面の大きさを「画面の解像度」で試していた → 実際にページが使える大きさ
//     （アドレスバー・タブの分を引いた大きさ、Windows の表示スケール 125%・150%）でも試す
//  3. ページ全体のスクロールだけを見ていた → 中のスクロール枠（受付・景品一覧・当選画面など）もすべて見る
//  4. 一瞬の状態だけを見ていた → しばらく時間をおいて、スクロールの量が変わらないか（バーが出たり消えたり）も見る
//  5. ボタンが画面に「ある」かだけを見ていた → ほかの要素に隠れて押せなくなっていないかも見る
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium, devices } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const S = "prize-plus-v1";
const SHOT_DIR = process.env.SHOT_DIR;
const dev = name => { const d = { ...devices[name] }; delete d.defaultBrowserType; return d; };

// 実際にページが使える大きさ（ブラウザのアドレスバーやタブ、OS の表示スケールの分を引いたもの）
const TARGETS = [
  ["PC 1920×1080 全画面", { viewport: { width: 1920, height: 1080 } }],
  ["PC 1920×1080 ブラウザ内", { viewport: { width: 1920, height: 969 } }],
  ["PC 1920×1080 125% ブラウザ内", { viewport: { width: 1536, height: 730 } }],
  ["PC 1920×1080 150% 全画面", { viewport: { width: 1280, height: 720 } }],
  ["PC 1920×1080 150% ブラウザ内", { viewport: { width: 1280, height: 585 } }],
  ["PC 1366×768 全画面", { viewport: { width: 1366, height: 768 } }],
  ["PC 1366×768 ブラウザ内", { viewport: { width: 1366, height: 657 } }],
  ["Mac 1440×900 ブラウザ内", { viewport: { width: 1440, height: 789 } }],
  ["PC 1024×768", { viewport: { width: 1024, height: 768 } }],
  ["iPad 縦", { device: dev("iPad (gen 7)") }],
  ["iPad 横", { device: dev("iPad (gen 7) landscape") }],
  ["iPhone SE", { device: dev("iPhone SE (3rd gen)") }],
  ["iPhone SE 横", { device: dev("iPhone SE (3rd gen) landscape") }],
  ["iPhone 15", { device: dev("iPhone 15") }],
  ["iPhone 15 横", { device: dev("iPhone 15 landscape") }],
];

const LONG = "とても長い景品の名前がここに入ります（ギフトカード 10,000円分とお米 5kg のセット）";
const prizes = n => Array.from({ length: n }, (_, i) => ({ rank: i + 1, name: i % 3 ? `景品${i + 1}` : LONG }));
const members = n => ({ members: Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, { name: i % 2 ? `参加者 ${i + 1}` : "とても長いニックネームの人です", kind: "name", at: 1700000000000 }])), file: "" });
const settings = { eventName: "第10回 〇〇株式会社 新年パーティー 抽選会" };
const BASE = { [S]: { prizes: prizes(20), people: 120, order2: "bottom" }, [S + "-members"]: members(120), [S + "-settings"]: settings };
// 当選が途中まで決まっている状態（下位から 15件）
const partial = () => { const wins = {}, drawOrder = []; for (let i = 19; i >= 5; i--) { wins[i] = 120 - i; drawOrder.push(i); } return { ...BASE, [S]: { ...BASE[S], wins, drawOrder } }; };

// 点検する状態：[名前, 保存データ, 開く画面, 準備の操作, この状態で縦スクロールしないはずか（PC）。null は設定などの縦に長い画面（スクロールしてよい）]
const STATES = [
  ["抽選", BASE, "draw", null, true],
  ["抽選（途中）", partial(), "draw", null, true],
  ["当選画面", { ...BASE, [S]: { prizes: prizes(3), order2: "top", wins: {}, pendingSpin: { i: 0, n: 2 } }, [S + "-members"]: members(3) }, "draw", async p => { await p.waitForSelector("#reveal:not([hidden])"); }, false],
  ["結果", partial(), "draw", async p => { await p.evaluate(() => { document.getElementById("resultBtn").click(); document.getElementById("result").hidden = false; }); }, false],
  ["リセットの確認", partial(), "draw", async p => { await p.click("#resetBtn"); }, true],
  ["発表モード", partial(), "draw", async p => { await p.click("#presentBtn"); }, true],
  ["景品", BASE, "prizes", null, null],
  ["受付（管理）", BASE, "reception", null, null],
  ["受付モード", BASE, "reception", async p => { await p.click("#kStart"); }, true],
  ["受付モード：エラー", BASE, "reception", async p => { await p.click("#kStart"); await p.click("#kForm button[type=submit]"); }, true],
  ["受付モード：同じ名前", BASE, "reception", async p => { await p.click("#kStart"); await p.fill("#kName", "参加者 2"); await p.click("#kForm button[type=submit]"); }, true],
  ["受付モード：番号", BASE, "reception", async p => { await p.click("#kStart"); await p.fill("#kName", "とても長い名前の人のなまえです"); await p.click("#kForm button[type=submit]"); }, true],
  ["受付モード：終了", { ...BASE, [S + "-settings"]: { ...settings, open: false } }, "reception", async p => { await p.click("#kStart"); }, true],
  ["名簿", BASE, "members", null, null],
  ["データ", BASE, "data", null, null],
];

// ページの中で調べる
function inspect(expectFit) {
  const out = [];
  const W = innerWidth, H = innerHeight;
  const desktop = matchMedia("(min-width: 901px), (orientation: landscape) and (min-width: 480px) and (max-height: 600px)").matches;
  const visible = el => { if (el.closest("[hidden]") || el.closest("details:not([open]) > :not(summary)")) return false; const cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden") return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const name = el => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).join(".") : ""}`;
  const se = document.scrollingElement;
  // 1. ページ全体：横スクロールはしない。PC の配置では縦もしない
  if (se.scrollWidth > se.clientWidth + 1) out.push(`横スクロール：ページが ${se.scrollWidth - se.clientWidth}px 横に動く`);
  if (desktop && se.scrollHeight > se.clientHeight + 1) out.push(`縦スクロール：PC の配置なのにページ全体が ${se.scrollHeight - se.clientHeight}px 縦に動く`);
  // 2. 中のスクロール枠：縦スクロールの量。収まるはずの状態でスクロールする枠、わずか（60px以下）だけスクロールする枠を報告
  const scrollers = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    const oy = ["auto", "scroll"].includes(cs.overflowY), ox = ["auto", "scroll"].includes(cs.overflowX);
    const dy = el.scrollHeight - el.clientHeight, dx = el.scrollWidth - el.clientWidth;
    if (ox && dx > 1 && !el.matches(".table-wrap, .tabs")) out.push(`横スクロール：${name(el)} が ${dx}px 横に動く`);
    if (!oy || dy <= 1) continue;
    scrollers.push([name(el), dy]);
    if (el.matches(".prize-list")) continue;   // 景品の一覧は件数が多いとスクロールする作り
    if (expectFit && desktop) out.push(`縦スクロール：${name(el)} が ${dy}px 縦に動く（画面に収まるはずの状態）`);
    else if (expectFit !== null && dy <= 60) out.push(`わずかな縦スクロール：${name(el)} が ${dy}px だけ縦に動く（余白だけでスクロールしていないか）`);
  }
  // 3. 横のはみ出し：画面の右端・左端より外に出る要素（飾りは除く）
  for (const el of document.querySelectorAll("body *")) {
    if (el.id === "confetti" || el.matches(".rays") || el.closest(".table-wrap, .tabs") && el.tagName !== "DIV" || !visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > document.documentElement.clientWidth + 1 || r.left < -1) { out.push(`はみ出し：${name(el)} [${Math.round(r.left)}〜${Math.round(r.right)}] 画面の幅 ${document.documentElement.clientWidth}`); break; }
  }
  // 4. 押せるもの：スクロールして画面に出したとき、ほかの要素に隠れていないか
  // 確認・当選画面・結果が開いているときは、いちばん上に開いているものの中だけを見る（後ろのボタンは隠れていてよい）
  const layers = ["#redoConfirm", "#confirm", "#result", "#reveal"].map(s => document.querySelector(s)).filter(el => el && visible(el));
  const scope = layers[0] || document.body;
  const ctrls = [...scope.querySelectorAll("button, input:not([type=file]), select, textarea, a[href], summary")].filter(visible).filter(el => !el.disabled);
  for (const el of ctrls) {
    el.scrollIntoView({ block: "center", inline: "center" });
    const r = el.getBoundingClientRect();
    const target = el.matches(".seg input") ? el.parentElement : el;   // 見た目は隣の span
    if (r.bottom < 0 || r.top > H || r.right < 0 || r.left > W) { out.push(`押せない：${name(el)} がスクロールしても画面に出ない`); continue; }
    const pts = [[(r.left + r.right) / 2, (r.top + r.bottom) / 2]];
    for (const [x, y] of pts) {
      const hit = document.elementFromPoint(Math.min(W - 1, Math.max(0, x)), Math.min(H - 1, Math.max(0, y)));
      if (hit && !target.contains(hit) && !hit.contains(target) && !(el.labels && [...el.labels].some(l => l.contains(hit))))
        out.push(`隠れている：${name(el)}「${(el.textContent || el.value || el.placeholder || "").trim().slice(0, 16)}」の上に ${name(hit)} が重なる`);
    }
  }
  document.querySelectorAll("*").forEach(el => { if (el.scrollTop) el.scrollTop = 0; });
  scrollTo(0, 0);
  // 5. 文字の切れ：はみ出しを隠す設定の要素で、中身が切れているもの
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el) || !el.textContent.trim() || el.children.length > 3) continue;
    const cs = getComputedStyle(el);
    if (!["hidden", "clip"].includes(cs.overflowX) && !["hidden", "clip"].includes(cs.overflowY)) continue;
    if (el.matches(".sr, .reveal, .tabs, .table-wrap, .page, #page-reception, body, html")) continue;
    if (el.scrollWidth > el.clientWidth + 2) out.push(`文字の切れ：${name(el)}「${el.textContent.trim().slice(0, 16)}」が横に ${el.scrollWidth - el.clientWidth}px 切れている`);
  }
  return { out, scrollers };
}

// しばらくおいて、スクロールできる量が変わらないか（スクロールバーが出たり消えたりしないか）
async function stable(page) {
  const sample = () => page.evaluate(() => [...document.querySelectorAll("*")].filter(el => el.scrollHeight > el.clientHeight + 1 && ["auto", "scroll"].includes(getComputedStyle(el).overflowY)).map(el => `${el.id || el.className}:${el.scrollHeight - el.clientHeight}`).concat(`doc:${document.scrollingElement.scrollHeight - innerHeight}`).sort().join(" "));
  const seen = new Set();
  for (let k = 0; k < 8; k++) { seen.add(await sample()); await page.waitForTimeout(250); }
  return seen.size > 1 ? [`不安定：スクロールできる量が時間とともに変わる（${[...seen].join(" → ")}）`] : [];
}

async function main() {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const f = path.join(ROOT, p === "/" ? "index.html" : p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  // スクロールバーを、実際のブラウザ（Windows など）と同じように出す
  const browser = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] });
  const report = [];
  for (const [label, opts] of TARGETS) {
    for (const [sname, storage, view, act, expectFit] of STATES) {
      const ctx = await browser.newContext({ ...(opts.device || {}), ...(opts.viewport ? { viewport: opts.viewport } : {}) });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", e => errors.push(String(e)));
      await page.goto(url + "#" + view);
      await page.evaluate(st => { localStorage.clear(); sessionStorage.clear(); for (const [k, v] of Object.entries(st)) localStorage.setItem(k, JSON.stringify(v)); }, storage);
      await page.reload();
      await page.waitForFunction(() => document.body.className.includes("view-"));
      try { if (act) await act(page); } catch (e) { report.push(`${label} / ${sname}：準備の操作に失敗 ${String(e).split("\n")[0]}`); await ctx.close(); continue; }
      await page.waitForTimeout(1600);   // 演出が落ち着くまで
      const unstable = await stable(page);
      const { out } = await page.evaluate(inspect, expectFit);
      if (SHOT_DIR) { fs.mkdirSync(SHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(SHOT_DIR, `${label}-${sname}.png`.replace(/[\/\s]/g, "_")) }); }
      for (const m of [...unstable, ...out, ...errors.map(e => "エラー：" + e)]) report.push(`${label} / ${sname}：${m}`);
      await ctx.close();
    }
  }
  await browser.close(); server.close();
  const uniq = [...new Set(report)];
  console.log(uniq.length ? uniq.join("\n") : "問題は見つかりませんでした");
  console.log(`\n点検：${TARGETS.length}種類の画面 × ${STATES.length}の状態、見つかった問題 ${uniq.length}件`);
  process.exitCode = uniq.length ? 1 : 0;
}
main();
