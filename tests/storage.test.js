// 保存領域：localStorage が空・壊れている・使えないとき／タブの連打・二重クリック／コンソールのエラー／音のオン・オフ
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const S = "prize-plus-v1";
test.after(h.teardown);

async function smoke(t) {
  for (const v of ["prizes", "reception", "members", "data", "draw"]) { await t.page.evaluate(v => location.hash = v, v); await t.page.clock.runFor(60); }
  const n = await h.spinOnce(t.page);
  assert.ok(n >= 1);
  await h.closeReveal(t.page);
}

test("localStorage が空：ダミーの景品20件・参加100人で始まる", async () => {
  const t = await h.open({ clock: true, reducedMotion: true });
  assert.equal(await t.page.inputValue("#peopleInput"), "100");
  assert.equal((await h.listState(t.page)).length, 20);
  await smoke(t);
  assert.deepEqual(t.errors, []);
  await t.close();
});

for (const [label, storage] of [
  ["JSONが壊れている", { [S]: "{oops", [S + "-members"]: "[[[", [S + "-settings"]: "nul", [S + "-sound"]: "???" }],
  ["型が違う（配列・数字・null）", { [S]: [1, 2], [S + "-members"]: 5, [S + "-settings"]: [] }],
  ["景品の中身がおかしい", { [S]: { prizes: [null, 1, "文字", { name: "" }, { rank: 3 }, { rank: 1, name: "正常" }], wins: { 0: "x", 5: 2.5 }, absent: "x", drawOrder: "y", people: 1e9 } }],
  ["名簿の中身がおかしい", { [S + "-members"]: { members: { 0: { name: "0番" }, 501: { name: "範囲外" }, "1.5": { name: "小数" }, 2: null, 3: "文字", 4: { name: { a: 1 }, kind: 5, at: "x" } }, file: null } }],
  ["設定の型が違う", { [S + "-settings"]: { eventName: 123, numbering: 5, start: "abc", capacity: "x", open: "no", showNames: 0, resetSec: "abc" } }],
]) {
  test(`localStorage の${label}：エラーにならず、全画面・抽選・書き出し・受付が動く`, async () => {
    const t = await h.open({ clock: true, reducedMotion: true, storage, initTimeout: 5000 });
    await smoke(t);
    await t.page.evaluate(() => location.hash = "data");
    for (const sel of ["#expResults", "#expPrizes", "#expMembers", "#expBackup"]) await Promise.all([t.page.waitForEvent("download"), t.page.click(sel)]);
    await t.page.evaluate(() => location.hash = "reception");
    await t.page.fill("#kName", "テスト"); await t.page.click("#kForm button[type=submit]");
    if (await t.page.locator("#kDup").isVisible()) await t.page.click("#kDupYes");
    assert.match(await t.page.textContent("#kNext"), /あと(5|10|15|30)秒/);
    await t.page.evaluate(() => location.hash = "prizes");
    const ns = await t.page.$$eval("#prizeEdit input", a => a.map(x => x.value));
    assert.ok(ns.every(n => n && n !== "undefined" && n !== "null" && n !== "[object Object]"), JSON.stringify(ns));
    assert.deepEqual(t.errors, []);
    await t.close();
  });
}

test("localStorage が使えない：保存されないだけで、全画面・抽選・受付が動く", async () => {
  const t = await h.open({ clock: true, reducedMotion: true, noStorage: true });
  await smoke(t);
  await t.page.evaluate(() => location.hash = "reception");
  await t.page.fill("#kName", "テスト"); await t.page.click("#kForm button[type=submit]");
  assert.equal(await t.page.locator("#kTicket").isVisible(), true);
  await t.page.evaluate(() => location.hash = "data");
  await t.page.click("#wipeAll"); await Promise.all([t.page.waitForEvent("load"), t.page.click("#wipeAll")]);
  assert.deepEqual(t.errors, []);
  await t.close();
});

test("「すべて消す」で4つの保存場所がすべて消える", async () => {
  const t = await h.open({ hash: "data", storage: { [S]: { prizes: h.makePrizes(2) }, [S + "-members"]: h.makeMembers({ 1: "A" }), [S + "-settings"]: { eventName: "x" }, [S + "-sound"]: "off" } });
  await t.page.click("#wipeAll");
  assert.match(await t.page.textContent("#wipeAll"), /本当に/);
  await Promise.all([t.page.waitForEvent("load"), t.page.click("#wipeAll")]);
  await t.page.waitForFunction(() => document.body.className.includes("view-"));
  const keys = await t.page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("prize-plus-v1")));
  // 読み込み直後に保存されるもの以外は残らない
  assert.ok(!keys.includes(S + "-members") && !keys.includes(S + "-settings") && !keys.includes(S + "-sound"), keys.join());
  await t.close();
});

test("タブの連打・回転中のタブ操作：画面が崩れず、回転中は抽選画面から動かない", async () => {
  const t = await h.open({ clock: true, storage: { [S]: { prizes: h.makePrizes(3), people: 10 } } });
  for (let k = 0; k < 30; k++) await t.page.click(`.tab[data-view="${["prizes", "reception", "members", "data", "draw"][k % 5]}"]`);
  await t.page.dblclick('.tab[data-view="members"]');
  await t.page.waitForFunction(() => location.hash === "#members" && document.body.classList.contains("view-members"));   // hashchange は少し遅れて届く
  assert.equal(await t.page.locator("#page-members").isVisible(), true);
  assert.equal(await t.page.locator(".wrap > .stage").isHidden(), true);
  await t.page.click('.tab[data-view="draw"]');
  await t.page.click("#spinBtn");
  await t.page.clock.runFor(500);
  await t.page.evaluate(() => { location.hash = "prizes"; });
  await t.page.clock.runFor(100);
  assert.equal(await t.page.evaluate(() => location.hash), "#draw");
  assert.equal(await t.page.locator("#page-prizes").isHidden(), true);
  for (let k = 0; k < 20 && await t.page.locator("#reveal").isHidden(); k++) await t.page.clock.runFor(1000);
  assert.equal(await t.page.locator("#reveal").isVisible(), true);
  // 当選画面を開いたままほかの画面へ → 当選画面は閉じる
  await t.page.evaluate(() => { location.hash = "members"; });
  await t.page.clock.runFor(100);
  assert.equal(await t.page.locator("#reveal").isHidden(), true);
  assert.deepEqual(t.errors, []);
  await t.close();
});

test("ボタンの二重クリック：リセット確認・回し直し確認・次を回す", async () => {
  const t = await h.open({ clock: true, reducedMotion: true, storage: { [S]: { prizes: h.makePrizes(3), people: 10 } } });
  await h.spinOnce(t.page);
  await t.page.dblclick("#nextBtn");
  for (let k = 0; k < 5 && await t.page.locator("#reveal").isHidden(); k++) await t.page.clock.runFor(1000);
  assert.equal(Object.keys((await h.stored(t.page)).wins).length, 2);
  await h.closeReveal(t.page);
  await t.page.click("#resetBtn"); await t.page.dblclick("#doReset");
  assert.deepEqual((await h.stored(t.page)).wins, {});
  assert.deepEqual(t.errors, []);
  await t.close();
});

test("音のオン・オフが保存される", async () => {
  const t = await h.open({});
  assert.equal(await t.page.textContent("#soundBtn"), "🔊 音あり");
  await t.page.click("#soundBtn");
  assert.equal(await t.page.textContent("#soundBtn"), "🔇 音なし");
  assert.equal(await t.page.evaluate(() => localStorage.getItem("prize-plus-v1-sound")), "off");
  await t.page.reload(); await t.page.waitForFunction(() => document.body.className.includes("view-"));
  assert.equal(await t.page.textContent("#soundBtn"), "🔇 音なし");
  await t.page.click("#soundBtn");
  assert.equal(await t.page.textContent("#soundBtn"), "🔊 音あり");
  assert.deepEqual(t.errors, []);
  await t.close();
});

test("音ありで抽選・受付をしてもエラーにならない", async () => {
  const t = await h.open({ storage: { [S]: { prizes: h.makePrizes(1), people: 3 } } });
  await t.page.click("#spinBtn");
  await t.page.locator("#reveal").waitFor({ state: "visible", timeout: 20000 });
  await t.page.evaluate(() => location.hash = "reception");
  await t.page.fill("#kName", "A"); await t.page.click("#kForm button[type=submit]");
  await t.page.waitForTimeout(300);
  assert.deepEqual(t.errors, []);
  await t.close();
});
