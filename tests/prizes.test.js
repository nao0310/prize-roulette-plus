// 景品の編集：入力、並べ替え、追加、まとめて追加、削除、すべて消す、抽選中の制限
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const S = "prize-plus-v1";
test.after(h.teardown);
const names = page => page.$$eval("#prizeEdit input", a => a.map(x => x.value));

test("景品名の修正（空にはできない）", async () => {
  const t = await h.open({ hash: "prizes", storage: { [S]: { prizes: h.makePrizes(3) } } });
  const inp = t.page.locator('#prizeEdit input[data-i="1"]');
  await inp.fill("  新しい   景品 "); await inp.press("Enter");
  assert.equal((await h.stored(t.page)).prizes[1].name, "新しい 景品");
  await inp.fill(""); await inp.press("Enter");
  assert.equal(await inp.inputValue(), "新しい 景品");
  assert.match(await t.page.textContent("#loadMsg"), /空にはできません/);
  await t.close();
});

test("▲▼で入れ替え、順位は並び順になる", async () => {
  const t = await h.open({ hash: "prizes", storage: { [S]: { prizes: h.makePrizes(3) } } });
  await t.page.click('button[data-act="down"][data-i="0"]');
  assert.deepEqual(await names(t.page), ["景品2", "景品1", "景品3"]);
  await t.page.click('button[data-act="up"][data-i="2"]');
  assert.deepEqual(await names(t.page), ["景品2", "景品3", "景品1"]);
  assert.deepEqual((await h.stored(t.page)).prizes.map(p => p.rank), [1, 2, 3]);
  assert.equal(await t.page.locator('button[data-act="up"][data-i="0"]').isDisabled(), true);
  assert.equal(await t.page.locator('button[data-act="down"][data-i="2"]').isDisabled(), true);
  await t.close();
});

test("追加（1位に／最下位に）とまとめて追加", async () => {
  const t = await h.open({ hash: "prizes", storage: { [S]: { prizes: h.makePrizes(2) } } });
  await t.page.fill("#prizeAddName", "最下位"); await t.page.click("#prizeAddBtn");
  await t.page.fill("#prizeAddName", "トップ"); await t.page.selectOption("#prizeAddPos", "top"); await t.page.click("#prizeAddBtn");
  assert.deepEqual(await names(t.page), ["トップ", "景品1", "景品2", "最下位"]);
  await t.page.click(".bulk summary");
  await t.page.fill("#prizeBulk", "A\n\n  B  \r\nC");
  await t.page.click("#prizeBulkBtn");
  assert.deepEqual((await names(t.page)).slice(4), ["A", "B", "C"]);
  assert.match(await t.page.textContent("#loadMsg"), /3件を追加/);
  await t.page.fill("#prizeAddName", "   "); await t.page.click("#prizeAddBtn");
  assert.equal((await names(t.page)).length, 7);
  await t.close();
});

test("まとめて追加は500件まで", async () => {
  const t = await h.open({ hash: "prizes", storage: { [S]: { prizes: h.makePrizes(498) } } });
  await t.page.click(".bulk summary");
  await t.page.fill("#prizeBulk", "A\nB\nC\nD");
  await t.page.click("#prizeBulkBtn");
  assert.equal(await t.page.textContent("#prizeCount"), "500件");
  assert.match(await t.page.textContent("#loadMsg"), /2件は追加していません/);
  await t.close();
});

test("削除は2回押しで", async () => {
  const t = await h.open({ hash: "prizes", storage: { [S]: { prizes: h.makePrizes(3) } } });
  await t.page.click('button[data-act="del"][data-i="1"]');
  assert.equal((await names(t.page)).length, 3);
  await t.page.click('button[data-act="del"][data-i="1"]');
  assert.deepEqual(await names(t.page), ["景品1", "景品3"]);
  await t.close();
});

test("すべて消す：ボタンの表示が元に戻り、再読み込みしても空のまま", async () => {
  const t = await h.open({ hash: "prizes", storage: { [S]: { prizes: h.makePrizes(3) } } });
  await t.page.click("#prizeClear"); await t.page.click("#prizeClear");
  assert.equal(await t.page.textContent("#prizeCount"), "0件");
  assert.equal(await t.page.textContent("#prizeClear"), "すべて消す");
  await t.page.reload(); await t.page.waitForFunction(() => document.body.className.includes("view-"));
  assert.equal(await t.page.textContent("#prizeCount"), "0件", "再読み込みでダミーの景品が戻った");
  await t.page.evaluate(() => location.hash = "draw");
  assert.equal(await t.page.textContent("#spinBtn"), "景品を登録してください");
  await t.close();
});

test("ダミーに戻す・順番の切り替え", async () => {
  const t = await h.open({ hash: "prizes", storage: { [S]: { prizes: h.makePrizes(2), isDummy: false } } });
  await t.page.click("#dummyBtn");
  assert.equal(await t.page.textContent("#prizeCount"), "20件");
  await t.page.click("#orderBtn");
  assert.equal(await t.page.textContent("#orderBtn"), "順番：1位から");
  assert.equal((await h.stored(t.page)).order2, "top");
  await t.close();
});

test("抽選の途中：並べ替え・追加・削除はできず、景品名の修正はできる", async () => {
  const t = await h.open({ clock: true, reducedMotion: true, storage: { [S]: { prizes: h.makePrizes(3), people: 10 } } });
  await h.spinOnce(t.page); await h.closeReveal(t.page);
  await t.page.evaluate(() => location.hash = "prizes");
  assert.equal(await t.page.locator("#prizeLock").isVisible(), true);
  for (const sel of ["#prizeAddBtn", "#prizeBulkBtn", "#prizeClear", "#loadBtn", "#orderBtn", "#dummyBtn", 'button[data-act="up"][data-i="1"]', 'button[data-act="del"][data-i="0"]'])
    assert.equal(await t.page.locator(sel).isDisabled(), true, sel);
  await t.page.locator("#prizeAddForm").evaluate(f => { document.getElementById("prizeAddName").value = "X"; f.requestSubmit(); });
  assert.equal((await h.stored(t.page)).prizes.length, 3);
  const inp = t.page.locator('#prizeEdit input[data-i="2"]');
  await inp.fill("変更後"); await inp.press("Enter");
  assert.equal((await h.stored(t.page)).prizes[2].name, "変更後");
  await t.page.evaluate(() => location.hash = "draw");
  assert.equal((await h.listState(t.page)).length, 3);
  await t.close();
});
