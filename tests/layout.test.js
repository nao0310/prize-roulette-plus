// 表示：PC（1920×1080、1366×768）、iPad、iPhone SE、iPhone 15（縦・横）で、はみ出し・重なり・横スクロールがないこと。
// 発表モード・受付モード・全画面の出入り。SHOT_DIR を付けるとスクリーンショットを保存する
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { devices } = require("playwright");
const h = require("./helpers");
const S = "prize-plus-v1";
test.after(h.teardown);

const dev = name => { const d = { ...devices[name] }; delete d.defaultBrowserType; return d; };
const TARGETS = [
  ["PC 1920x1080", { viewport: { width: 1920, height: 1080 } }],
  ["PC 1366x768", { viewport: { width: 1366, height: 768 } }],
  ["iPad", { device: dev("iPad (gen 7)") }],
  ["iPad 横", { device: dev("iPad (gen 7) landscape") }],
  ["iPhone SE", { device: dev("iPhone SE (3rd gen)") }],
  ["iPhone SE 横", { device: dev("iPhone SE (3rd gen) landscape") }],
  ["iPhone SE 初代", { device: dev("iPhone SE") }],
  ["iPhone 15", { device: dev("iPhone 15") }],
  ["iPhone 15 横", { device: dev("iPhone 15 landscape") }],
];
const LONG = "とても長い景品の名前がここに入ります（ギフトカード 10,000円分とお米 5kg のセット）";
const storage = {
  [S]: { prizes: Array.from({ length: 20 }, (_, i) => ({ rank: i + 1, name: i % 3 ? `景品${i + 1}` : LONG })), people: 120, order2: "bottom" },
  [S + "-members"]: { members: Object.fromEntries(Array.from({ length: 120 }, (_, i) => [i + 1, { name: i % 2 ? `参加者 ${i + 1}` : "とても長いニックネームの人です", kind: "name", at: 1700000000000 }])), file: "" },
  [S + "-settings"]: { eventName: "第10回 〇〇株式会社 新年パーティー 抽選会" },
};
const shot = async (page, name) => { if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, `${h.MODE}-${name}.png`) }); };

// 2つの要素が重なっているか
const overlaps = (page, a, b) => page.evaluate(([a, b]) => {
  const ea = document.querySelector(a), eb = document.querySelector(b);
  if (!ea || !eb || !ea.offsetParent || !eb.offsetParent) return false;
  const r1 = ea.getBoundingClientRect(), r2 = eb.getBoundingClientRect();
  return r1.left < r2.right - 1 && r2.left < r1.right - 1 && r1.top < r2.bottom - 1 && r2.top < r1.bottom - 1;
}, [a, b]);
// 要素が画面の中に入っているか（縦はスクロールで見られれば可）
const inView = (page, sel, vertical) => page.evaluate(([sel, vertical]) => {
  const el = document.querySelector(sel); const r = el.getBoundingClientRect();
  return r.left >= -1 && r.right <= innerWidth + 1 && (!vertical || (r.top >= -1 && r.bottom <= innerHeight + 1));
}, [sel, vertical]);
const desktopLike = page => page.evaluate(() => matchMedia("(min-width: 901px), (orientation: landscape) and (min-width: 480px) and (max-height: 600px)").matches);

for (const [label, opts] of TARGETS) {
  test(`表示：${label}`, async () => {
    const t = await h.open({ ...opts, storage, clock: true, reducedMotion: true });
    const fails = [];
    const check = async where => { const o = await h.overflowReport(t.page); if (o.length) fails.push(`${where}: ${o.join(" / ")}`); };
    for (const v of ["draw", "prizes", "reception", "members", "data"]) {
      await t.page.evaluate(v => location.hash = v, v); await t.page.clock.runFor(200);
      await check(v); await shot(t.page, `${label}-${v}`);
    }
    await t.page.evaluate(() => location.hash = "draw"); await t.page.clock.runFor(200);
    for (const [a, b] of [[".logo", ".tools"], [".logo", ".next-card"], [".next-card", ".tools"], [".tabs", "header"], ["#spinBtn", ".wheel-box"]])
      if (await overlaps(t.page, a, b)) fails.push(`重なり ${a} と ${b}`);
    if (await desktopLike(t.page)) {
      if (!await inView(t.page, "#spinBtn", true)) fails.push("SPINボタンが画面外");
      const scroll = await t.page.evaluate(() => document.scrollingElement.scrollHeight - innerHeight);
      if (scroll > 1) fails.push(`PC表示なのに縦スクロール ${scroll}px`);
    }
    // 当選画面：ボタンまで見られる
    await h.spinOnce(t.page); await t.page.clock.runFor(1500);
    await shot(t.page, `${label}-reveal`);
    await t.page.locator("#redoBtn").scrollIntoViewIfNeeded();
    if (!await inView(t.page, "#redoBtn", true)) fails.push("当選画面の回し直しボタンが見えない");
    if (!await inView(t.page, "#nextBtn", true) && !await t.page.locator("#nextBtn").evaluate(b => { b.scrollIntoView(); const r = b.getBoundingClientRect(); return r.bottom <= innerHeight; })) fails.push("当選画面の次へボタンが見えない");
    await check("reveal");
    // 光の放射は画面より大きい飾りなので、枠で切られていて（横にスクロールできず）よい
    const rv = await t.page.locator("#reveal").evaluate(r => ({ sw: r.scrollWidth, cw: r.clientWidth, ox: getComputedStyle(r).overflowX }));
    if (rv.sw > rv.cw + 1 && !["hidden", "clip"].includes(rv.ox)) fails.push(`当選画面が横にスクロールする ${rv.sw} > ${rv.cw}`);
    await h.closeReveal(t.page);
    // リザルト
    await t.page.evaluate(() => document.getElementById("resultBtn").click());
    await t.page.locator("#result").evaluate(e => { e.hidden = false; });
    await t.page.clock.runFor(800);
    await check("result"); await shot(t.page, `${label}-result`);
    await t.page.click("#closeResult");
    // 発表モード
    await t.page.click("#presentBtn"); await t.page.clock.runFor(300);
    assert.equal(await t.page.locator(".tabs").isHidden(), true);
    await check("present"); await shot(t.page, `${label}-present`);
    if (await overlaps(t.page, ".logo", ".tools") || await overlaps(t.page, ".next-card", ".tools")) fails.push("発表モードでヘッダーが重なる");
    await t.page.click("#presentExit"); await t.page.clock.runFor(300);
    assert.equal(await t.page.evaluate(() => document.body.classList.contains("present")), false);
    assert.equal(await t.page.locator("#resetBtn").isVisible(), true);
    // 受付モード
    await t.page.evaluate(() => location.hash = "reception"); await t.page.clock.runFor(200);
    await t.page.click("#kStart"); await t.page.clock.runFor(300);
    await check("kiosk"); await shot(t.page, `${label}-kiosk`);
    if (await overlaps(t.page, "#kStaff", "#kForm button[type=submit]") || await overlaps(t.page, "#kStaff", "#kName")) fails.push("スタッフボタンが受付の入力欄・ボタンに重なる");
    await t.page.fill("#kName", "とても長い名前の人のなまえです"); await t.page.click("#kForm button[type=submit]");
    await t.page.clock.runFor(800);
    await check("ticket"); await shot(t.page, `${label}-ticket`);
    assert.deepEqual(t.errors, []);
    assert.deepEqual(fails, []);
    await t.close();
  });
}

test("発表モード：全画面に入り、Escなどで全画面が解除されたら発表モードも終わる", async () => {
  const t = await h.open({ viewport: { width: 1366, height: 768 } });
  await t.page.click("#presentBtn");
  await t.page.waitForTimeout(300);
  const fs = await t.page.evaluate(() => !!document.fullscreenElement);
  assert.equal(await t.page.evaluate(() => document.body.classList.contains("present")), true);
  if (fs) {
    await t.page.evaluate(() => document.exitFullscreen());
    await t.page.waitForTimeout(300);
    assert.equal(await t.page.evaluate(() => document.body.classList.contains("present")), false);
  }
  // 全画面にできない環境でも発表モードの出入りができる
  await t.page.evaluate(() => { document.documentElement.requestFullscreen = () => Promise.reject(new Error("no")); });
  await t.page.click("#presentBtn"); await t.page.waitForTimeout(200);
  assert.equal(await t.page.locator("#presentExit").isVisible(), true);
  await t.page.click("#presentExit"); await t.page.waitForTimeout(200);
  assert.equal(await t.page.evaluate(() => document.body.classList.contains("present")), false);
  assert.deepEqual(t.errors, []);
  await t.close();
});
