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

test("回転中にほかのタブ（抽選画面・受付モード）を再読み込みしても、そのタブでは当選画面を出さず、回したタブで出す", async () => {
  const t = await h.open({ storage: { [S]: { prizes: h.makePrizes(3) }, [S + "-members"]: h.makeMembers({ 1: "A", 2: "B", 3: "C" }) } });
  const d2 = await secondTab(t, "draw");
  const rec = await secondTab(t, "reception");
  await rec.click("#kStart");
  await t.page.click("#spinBtn"); await t.page.waitForTimeout(600);
  await d2.reload(); await rec.reload();
  await d2.waitForFunction(() => document.body.className.includes("view-")); await rec.waitForFunction(() => document.body.className.includes("view-"));
  await d2.waitForTimeout(300);
  assert.equal(await d2.locator("#reveal").isHidden(), true, "もう1つの抽選タブで先に結果が出た");
  assert.equal(await rec.locator("#reveal").isHidden(), true, "受付のタブで結果が出た");
  assert.equal(await rec.evaluate(() => document.body.classList.contains("kiosk")), true);
  const st = await h.stored(t.page);
  assert.deepEqual(st.wins, {}, "ほかのタブが当選を書き込んだ");
  assert.ok(st.pendingSpin, "回し始めの記録が消えた");
  // 回している間、もう1つの抽選タブでは回せない
  assert.equal(await d2.locator("#spinBtn").isDisabled(), true);
  assert.equal(await d2.textContent("#spinBtn"), "ほかのタブで抽選中");
  await t.page.locator("#reveal").waitFor({ state: "visible", timeout: 30000 });
  const won = +(await t.page.textContent("#bigNum"));
  await d2.waitForTimeout(300);
  assert.deepEqual(Object.values((await h.stored(t.page)).wins), [won]);
  assert.equal(await d2.locator("#spinBtn").isEnabled(), true);
  assert.match(await d2.textContent("#spinBtn"), /2位を抽選/);
  assert.equal(await rec.locator("#reveal").isHidden(), true);
  assert.deepEqual(t.errors, []);
  await t.close();
});

test("名簿なしで1本目を回している間は、ほかのタブで受付できない", async () => {
  const t = await h.open({ storage: { [S]: { prizes: h.makePrizes(3), people: 10 } } });
  const rec = await secondTab(t, "reception");
  await t.page.click("#spinBtn"); await t.page.waitForTimeout(500);
  await rec.fill("#kName", "X"); await rec.click("#kForm button[type=submit]");
  assert.equal(await rec.locator("#kTicket").isHidden(), true);
  assert.match(await rec.textContent("#kErr"), /抽選中のため/);
  await t.page.locator("#reveal").waitFor({ state: "visible", timeout: 30000 });
  await t.page.waitForTimeout(200);
  assert.equal(await h.stored(t.page, S + "-members"), null);
  assert.match(await t.page.textContent("#listSub"), /1〜10番で抽選/);
  assert.deepEqual(t.errors, []);
  await t.close();
});

test("回転中は、ほかのタブで景品・名簿・リセット・すべて消すを変えられず、景品名の修正は止まったあとも残る", async () => {
  const t = await h.open({ storage: { [S]: { prizes: h.makePrizes(3) }, [S + "-members"]: h.makeMembers({ 1: "A", 2: "B", 3: "C", 4: "D", 5: "E" }) } });
  const ed = await secondTab(t, "prizes");
  const dr = await secondTab(t, "draw");
  await t.page.click("#spinBtn"); await t.page.waitForTimeout(600);
  assert.equal(await ed.locator("#prizeAddBtn").isDisabled(), true);
  assert.equal(await ed.locator("#orderBtn").isDisabled(), true);
  assert.equal(await ed.locator("#prizeLock").isVisible(), true);
  await ed.fill('#prizeEdit input[data-i="0"]', "改名した景品"); await ed.press('#prizeEdit input[data-i="0"]', "Enter");
  await dr.click("#resetBtn");
  assert.equal(await dr.locator("#confirm").isHidden(), true, "リセットの確認が出た");
  await ed.evaluate(() => location.hash = "members"); await ed.waitForTimeout(100);
  await ed.click('#memBody button[data-del="5"]');
  assert.match(await ed.textContent("#rosterMsg"), /回っている間は削除できません/);
  await ed.evaluate(() => location.hash = "data"); await ed.waitForTimeout(100);
  await ed.click("#wipeAll"); await ed.click("#wipeAll"); await ed.waitForTimeout(200);
  assert.ok(await h.stored(ed), "すべて消すが実行された");
  await t.page.locator("#reveal").waitFor({ state: "visible", timeout: 30000 });
  await t.page.waitForTimeout(300);
  const st = await h.stored(t.page);
  assert.equal(st.prizes[0].name, "改名した景品", "回転中にほかのタブで直した景品名が消えた");
  assert.equal(Object.keys(st.wins).length, 1);
  assert.equal(st.pendingSpin, null);
  assert.equal(Object.keys((await h.stored(t.page, S + "-members")).members).length, 5);
  assert.equal(await dr.locator("#spinBtn").isEnabled(), true);
  assert.deepEqual(t.errors, []);
  await t.close();
});

test("回していたタブが閉じられたときは、30秒たつとほかの抽選タブで当選画面を出す（受付モードのタブでは出さない）", async () => {
  const t = await h.open({ storage: { [S]: { prizes: h.makePrizes(3), people: 10, wins: {}, pendingSpin: { i: 2, n: 4, at: Date.now() - 26000 } } } });
  assert.equal(await t.page.locator("#reveal").isHidden(), true);
  assert.equal(await t.page.textContent("#spinBtn"), "ほかのタブで抽選中");
  const rec = await secondTab(t, "reception");
  await rec.click("#kStart");
  await t.page.locator("#reveal").waitFor({ state: "visible", timeout: 10000 });
  assert.equal(+(await t.page.textContent("#bigNum")), 4);
  assert.match(await t.page.textContent("#revealCount"), /再読み込み/);
  const st = await h.stored(t.page);
  assert.deepEqual(st.wins, { 2: 4 });
  assert.equal(st.pendingSpin, null);
  await rec.waitForTimeout(300);
  assert.equal(await rec.locator("#reveal").isHidden(), true);
  assert.deepEqual(t.errors, []);
  await t.close();
});

test("ほかのタブで参加者が増えたら当選画面の「次の○位」を最新にし、リセット・回し直しをしたら当選画面を閉じる", async () => {
  const t = await h.open({ reducedMotion: true, storage: { [S]: { prizes: h.makePrizes(5) }, [S + "-members"]: h.makeMembers({ 1: "A", 2: "B", 3: "C" }) } });
  const d2 = await secondTab(t, "members");
  await t.page.click("#spinBtn"); await t.page.locator("#reveal").waitFor({ state: "visible", timeout: 20000 });
  assert.match(await t.page.textContent("#nextBtn"), /2位/);
  await d2.fill("#memAddName", "D"); await d2.click("#memAddForm button[type=submit]");
  await t.page.waitForTimeout(200);
  assert.equal(await t.page.locator("#reveal").isVisible(), true);
  assert.match(await t.page.textContent("#nextBtn"), /4位/);
  assert.match(await t.page.textContent("#revealCount"), /1 \/ 4/);
  // ほかのタブでリセット → 当選画面を閉じる
  await d2.evaluate(() => location.hash = "draw"); await d2.waitForTimeout(100);
  await d2.click("#resetBtn"); await d2.click("#doReset");
  await t.page.waitForTimeout(200);
  assert.equal(await t.page.locator("#reveal").isHidden(), true);
  assert.match(await t.page.textContent("#spinBtn"), /4位を抽選/);
  // もう一度回し、ほかのタブで回し直す → 当選画面を閉じる
  await t.page.click("#spinBtn"); await t.page.locator("#reveal").waitFor({ state: "visible", timeout: 20000 });
  await d2.waitForTimeout(200);
  await d2.click("#prizeList .redo-target"); await d2.click("#doRedo");
  await t.page.waitForTimeout(200);
  assert.equal(await t.page.locator("#reveal").isHidden(), true);
  await d2.locator("#reveal").waitFor({ state: "visible", timeout: 20000 });
  await t.page.waitForTimeout(200);
  assert.equal((await h.stored(t.page)).absent.length, 1);
  assert.deepEqual(t.errors, []);
  await t.close();
});
