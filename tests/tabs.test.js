// 同じ端末の2つのタブ（受付用と抽選用など）：互いの変更を上書きせず、すぐ反映される
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const S = "prize-plus-v1";
test.after(h.teardown);

async function secondTab(t, hash) {
  const p = await t.context.newPage();
  p.on("pageerror", e => t.errors.push(String(e)));
  await p.goto(t.page.url().replace(/#.*$/, "") + "#" + hash);
  await p.waitForFunction(() => document.body.className.includes("view-"));
  return p;
}

test("抽選タブの当選と、受付タブの受付が、互いに消えない", async () => {
  const t = await h.open({ reducedMotion: true, storage: { [S]: { prizes: h.makePrizes(3), people: 10 }, [S + "-members"]: h.makeMembers({ 1: "A", 2: "B", 3: "C" }) } });
  const rec = await secondTab(t, "reception");
  await t.page.click("#spinBtn"); await t.page.locator("#reveal").waitFor({ state: "visible", timeout: 20000 });
  const won = +(await t.page.textContent("#bigNum"));
  await rec.waitForTimeout(200);
  await rec.fill("#kName", "D"); await rec.click("#kForm button[type=submit]");
  assert.equal(await rec.textContent("#kNum"), "4");
  await t.page.waitForTimeout(200);
  assert.deepEqual(Object.values((await h.stored(t.page)).wins), [won], "受付で当選記録が消えた");
  // 抽選タブにも4番がすぐ反映され、名前を直しても4番は消えない
  await t.page.keyboard.press("Escape");
  await t.page.evaluate(() => location.hash = "members"); await t.page.waitForTimeout(100);
  assert.equal(await t.page.locator('#memBody input[data-n="4"]').inputValue(), "D");
  await t.page.fill('#memBody input[data-n="1"]', "A2"); await t.page.press('#memBody input[data-n="1"]', "Enter");
  assert.deepEqual(Object.keys((await h.stored(t.page, S + "-members")).members), ["1", "2", "3", "4"]);
  await rec.waitForTimeout(200);
  // 受付タブも最新（4人・抽選の途中）
  assert.equal(await rec.locator("#kCount").evaluate(e => e.textContent), "4");
  assert.deepEqual(t.errors, []);
  await t.close();
});

test("回転中にほかのタブで受付しても、止まったあと両方が残り、新しい人は次から対象になる", async () => {
  const t = await h.open({ storage: { [S]: { prizes: h.makePrizes(2), order2: "top" }, [S + "-members"]: h.makeMembers({ 1: "A" }) } });
  const rec = await secondTab(t, "reception");
  await t.page.click("#spinBtn");
  await t.page.waitForTimeout(500);
  await rec.fill("#kName", "B"); await rec.click("#kForm button[type=submit]");
  await t.page.locator("#reveal").waitFor({ state: "visible", timeout: 30000 });
  await t.page.waitForTimeout(300);
  assert.deepEqual(Object.keys((await h.stored(t.page, S + "-members")).members), ["1", "2"]);
  assert.deepEqual(Object.values((await h.stored(t.page)).wins), [1]);
  assert.match(await t.page.textContent("#nextBtn"), /2位/);
  assert.deepEqual(t.errors, []);
  await t.close();
});

test("ほかのタブで景品を変えると、すぐ反映される", async () => {
  const t = await h.open({ storage: { [S]: { prizes: h.makePrizes(2) } } });
  const ed = await secondTab(t, "prizes");
  await ed.fill("#prizeAddName", "新しい景品"); await ed.click("#prizeAddBtn");
  await t.page.waitForTimeout(200);
  assert.equal((await h.listState(t.page)).length, 3);
  assert.deepEqual(t.errors, []);
  await t.close();
});
