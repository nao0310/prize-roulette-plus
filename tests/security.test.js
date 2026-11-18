// セキュリティ：名前・景品名などにタグや記号を入れても実行されない／外部へのリクエストが0件／CSP
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const h = require("./helpers");
const S = "prize-plus-v1";
test.after(h.teardown);

const PAYLOADS = [
  `<script>window.__xss=1</script>`,
  `<img src=x onerror="window.__xss=2">`,
  `"><svg onload="window.__xss=3">`,
  `' onmouseover='window.__xss=4' x='`,
  `&amp; & "引用" 'quote' <b>太字</b>`,
];

test("景品名・名前・イベント名にタグや記号を入れても実行されず、文字のまま表示される", async () => {
  const t = await h.open({ clock: true, reducedMotion: true, hash: "prizes", storage: { [S]: { prizes: [{ rank: 1, name: "x" }] }, [S + "-settings"]: { numbering: "seq" } } });
  // 景品名を画面から入力
  await t.page.click(".bulk summary");
  await t.page.fill("#prizeBulk", PAYLOADS.map(p => p.slice(0, 60)).join("\n"));
  await t.page.click("#prizeBulkBtn");
  for (let i = 0; i < PAYLOADS.length; i++) {   // 1位から景品名を入れ替える
    const inp = t.page.locator(`#prizeEdit input[data-i="${i}"]`);
    await inp.fill(PAYLOADS[i].slice(0, 60)); await inp.press("Enter");
  }
  // 受付で名前を入力（20文字まで）
  await t.page.evaluate(() => location.hash = "reception");
  for (const p of PAYLOADS) {
    await t.page.fill("#kName", p); await t.page.click("#kForm button[type=submit]");
    if (await t.page.locator("#kDup").isVisible()) await t.page.click("#kDupYes");
    await t.page.clock.runFor(1100); await t.page.click("#kNext");   // 時計を止めているので、1秒進めてから押す
  }
  // イベント名
  await t.page.evaluate(() => location.hash = "members");
  await t.page.fill("#setEvent", PAYLOADS[1]); await t.page.press("#setEvent", "Tab");
  // すべての画面を表示し、全部抽選してリザルトまで
  for (const v of ["prizes", "reception", "members", "data", "draw"]) { await t.page.evaluate(v => location.hash = v, v); await t.page.clock.runFor(100); }
  await t.page.evaluate(() => location.hash = "draw");
  await t.page.locator("#prizeList").hover();
  for (let k = 0; k < 6 && await t.page.locator("#spinBtn").isEnabled(); k++) {
    await h.spinOnce(t.page);
    await t.page.locator("#reveal").hover();
    await h.closeReveal(t.page);
  }
  await t.page.locator("#result").evaluate(e => { e.hidden = true; });
  await t.page.click("#resultBtn");
  await t.page.locator("#result").hover();
  await t.page.clock.runFor(500);
  assert.equal(await t.page.evaluate(() => window.__xss), undefined);
  // 表示は文字のまま
  const resultText = await t.page.locator("#result").innerText();
  assert.ok(resultText.includes("<script>window.__xss=1</script>"), resultText.slice(0, 300));
  assert.ok(resultText.includes(`&amp; & "引用" 'quote' <b>太字</b>`));
  assert.equal(await t.page.locator("#result script, #result img, #result svg, #result b, #prizeList img, #memBody img").count(), 0);
  await t.page.evaluate(() => location.hash = "members");
  const vals = await t.page.$$eval("#memBody input[data-n]", a => a.map(x => x.value));
  assert.ok(vals.includes(PAYLOADS[1].slice(0, 20)));
  assert.equal(await t.page.evaluate(() => window.__xss), undefined);
  assert.deepEqual(t.errors, []);
  await t.close();
});

test("細工したバックアップ・保存データ（順位などにタグ）を読み込んでもスクリプトが動かない", async () => {
  const bad = '<img src=x onerror="window.__xss=9">';
  const state = { prizes: [{ rank: bad, name: "a" }, { rank: bad, name: "b" }], wins: { 1: 5 }, drawOrder: [1], people: 10, order2: "top" };
  const t = await h.open({ clock: true, reducedMotion: true, storage: { [S]: state, [S + "-members"]: { members: { 5: { name: bad, kind: "name" } } } } });
  for (const v of ["prizes", "reception", "members", "data", "draw"]) { await t.page.evaluate(v => location.hash = v, v); await t.page.clock.runFor(100); }
  assert.equal(await t.page.evaluate(() => window.__xss), undefined, "読み込んだだけで実行された");
  for (let k = 0; k < 2 && await t.page.locator("#spinBtn").isEnabled(); k++) { await h.spinOnce(t.page); await h.closeReveal(t.page); }
  await t.page.locator("#result").evaluate(e => { e.hidden = true; });
  if (await t.page.locator("#resultBtn").isVisible()) await t.page.click("#resultBtn");
  await t.page.clock.runFor(500);
  assert.equal(await t.page.evaluate(() => window.__xss), undefined, "抽選・結果の表示で実行された");
  assert.equal(await t.page.locator("body img").count(), 0);
  await t.close();
});

test("外部へのリクエストは0件（全画面の操作と、読み込み・書き出しを通して）", async () => {
  const t = await h.open({ reducedMotion: true, storage: { [S]: { prizes: h.makePrizes(3), people: 10 } } });
  for (const v of ["prizes", "reception", "members", "data", "draw"]) { await t.page.evaluate(v => location.hash = v, v); await t.page.waitForTimeout(100); }
  await t.page.evaluate(() => location.hash = "prizes");
  await t.page.setInputFiles("#fileInput", path.join(h.ROOT, "sample-prizes.xlsx"));
  await t.page.evaluate(() => location.hash = "members");
  await t.page.setInputFiles("#rosterInput", path.join(h.ROOT, "sample-roster.csv"));
  await t.page.evaluate(() => location.hash = "data");
  await Promise.all([t.page.waitForEvent("download"), t.page.click("#expBackup")]);
  await t.page.evaluate(() => location.hash = "draw");
  await t.page.click("#spinBtn");
  await t.page.locator("#reveal").waitFor({ state: "visible" });
  // ページの中から通信しようとしても、CSP で止まる
  const blocked = await t.page.evaluate(async () => {
    const r = { violations: [] };
    document.addEventListener("securitypolicyviolation", e => r.violations.push(e.violatedDirective));
    try { await fetch("https://example.com/"); r.fetch = "sent"; } catch (e) { r.fetch = "blocked"; }
    try { const ws = new WebSocket("wss://example.com/"); r.ws = "created"; ws.close(); } catch (e) { r.ws = "blocked"; }
    try { navigator.sendBeacon("https://example.com/", "x"); } catch (e) {}
    await new Promise(res => setTimeout(res, 300));
    return r;
  });
  assert.equal(blocked.fetch, "blocked");
  assert.ok(blocked.violations.filter(v => v.startsWith("connect-src")).length >= 2, JSON.stringify(blocked));
  assert.deepEqual(t.external.filter(u => !u.startsWith("wss://example.com")), [], "外部へのリクエスト");
  await t.close();
});

test("index.html：CSP を維持し、外部のスクリプト・スタイル・フォントを読み込まない", () => {
  const html = fs.readFileSync(path.join(h.ROOT, "index.html"), "utf8");
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(csp, "CSP がない");
  for (const d of ["default-src 'none'", "connect-src 'none'", "form-action 'none'", "base-uri 'none'"]) assert.ok(csp[1].includes(d), d);
  assert.ok(!/<script[^>]+src=/i.test(html), "外部スクリプト");
  assert.ok(!/<link[^>]+href="https?:/i.test(html), "外部リンク");
  assert.ok(!/url\(\s*["']?https?:/i.test(html), "外部のフォント・画像");
});
