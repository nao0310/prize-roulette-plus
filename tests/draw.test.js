// 抽選：順番、回し直し、リザルト、リセット、再読み込み、人数と景品数の組み合わせ
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const S = "prize-plus-v1";
test.after(h.teardown);

async function drawAll(page, max = 600) {
  const got = [];
  for (let k = 0; k < max; k++) {
    const disabled = await page.locator("#spinBtn").isDisabled();
    if (disabled) break;
    got.push({ num: await h.spinOnce(page), rank: parseInt(await page.textContent("#revealRank"), 10) });
    await h.closeReveal(page);
    await page.locator("#result").evaluate(el => { el.hidden = true; });
  }
  return got;
}

test("下位から：最下位から順に1位まで、番号は重複しない", async () => {
  const t = await h.open({ clock: true, reducedMotion: true, storage: { [S]: { prizes: h.makePrizes(5), people: 10 } } });
  const got = await drawAll(t.page);
  assert.deepEqual(got.map(g => g.rank), [5, 4, 3, 2, 1]);
  assert.equal(new Set(got.map(g => g.num)).size, 5);
  got.forEach(g => assert.ok(g.num >= 1 && g.num <= 10));
  assert.equal(await t.page.textContent("#spinBtn"), "抽選終了");
  assert.equal(await t.page.locator("#resultBtn").isVisible(), true);
  assert.deepEqual(t.errors, []);
  await t.close();
});

test("1位から：1位から順に", async () => {
  const t = await h.open({ clock: true, reducedMotion: true, storage: { [S]: { prizes: h.makePrizes(4), people: 10, order2: "top" } } });
  assert.deepEqual((await drawAll(t.page)).map(g => g.rank), [1, 2, 3, 4]);
  await t.close();
});

test("最後の景品のあとリザルトが出て、全景品と当選番号が並ぶ", async () => {
  const t = await h.open({ clock: true, reducedMotion: true, storage: { [S]: { prizes: h.makePrizes(5), people: 10 } } });
  const nums = [];
  for (let k = 0; k < 5; k++) { nums.push(await h.spinOnce(t.page)); if (k < 4) await h.closeReveal(t.page); }
  await t.page.click("#nextBtn");   // 「結果発表へ」
  await t.page.clock.runFor(500);
  assert.equal(await t.page.locator("#result").isVisible(), true);
  const shown = await t.page.$$eval("#result .rcard .ball-sm", a => a.map(x => +x.textContent));
  assert.deepEqual(shown.sort(), nums.slice().sort());
  await t.page.click("#closeResult");
  assert.equal(await t.page.locator("#result").isHidden(), true);
  await t.close();
});

test("回し直し：外した番号は二度と出ず、同じ順位をもう一度抽選する", async () => {
  const t = await h.open({ clock: true, reducedMotion: true, storage: { [S]: { prizes: h.makePrizes(3), people: 4, order2: "top" } } });
  const first = await h.spinOnce(t.page);
  await t.page.click("#redoBtn");
  assert.match(await t.page.textContent("#redoText"), new RegExp(`${first}番`));
  await t.page.click("#doRedo");
  for (let k = 0; k < 10 && await t.page.locator("#reveal").isHidden(); k++) await t.page.clock.runFor(1000);
  const second = +(await t.page.textContent("#bigNum"));
  assert.equal(parseInt(await t.page.textContent("#revealRank"), 10), 1);
  assert.notEqual(second, first);
  await h.closeReveal(t.page);
  const rest = [await h.spinOnce(t.page)]; await h.closeReveal(t.page);
  rest.push(await h.spinOnce(t.page)); await h.closeReveal(t.page);
  assert.ok(!rest.includes(first) && !rest.includes(second));
  const st = await h.stored(t.page);
  assert.deepEqual(st.absent, [first]);
  assert.equal(await t.page.textContent("#spinBtn"), "抽選終了");
  await t.close();
});

test("リセット：当選番号と外した番号が消え、景品は残る", async () => {
  const t = await h.open({ clock: true, reducedMotion: true, storage: { [S]: { prizes: h.makePrizes(3), people: 10 } } });
  await h.spinOnce(t.page); await h.closeReveal(t.page);
  await t.page.click("#resetBtn"); await t.page.click("#doReset");
  const st = await h.stored(t.page);
  assert.deepEqual(st.wins, {}); assert.deepEqual(st.absent, []); assert.equal(st.prizes.length, 3);
  assert.equal((await h.listState(t.page)).filter(r => r.num).length, 0);
  await t.close();
});

test("回転中に再読み込み：回し始めたときに決まっていた番号で当選画面が出て、引き直しにならない", async () => {
  const t = await h.open({ clock: true, storage: { [S]: { prizes: h.makePrizes(3), people: 10 } } });
  await t.page.click("#spinBtn");
  await t.page.clock.runFor(2000);
  const decided = (await h.stored(t.page)).pendingSpin;
  assert.ok(decided && decided.n >= 1 && decided.n <= 10, "回し始めた時点で当選が保存されていない");
  await t.page.reload();
  await t.page.waitForFunction(() => document.body.className.includes("view-"));
  assert.equal(await t.page.locator("#reveal").isVisible(), true);
  assert.equal(+(await t.page.textContent("#bigNum")), decided.n);
  assert.match(await t.page.textContent("#revealCount"), /再読み込み/);
  const st = await h.stored(t.page);
  assert.deepEqual(st.wins, { 2: decided.n });
  assert.equal(st.pendingSpin, null);
  // もう一度読み込んでも当選画面は出ない（記録は残る）
  await t.page.reload();
  await t.page.waitForFunction(() => document.body.className.includes("view-"));
  assert.equal(await t.page.locator("#reveal").isHidden(), true);
  assert.equal((await h.listState(t.page)).find(r => r.rank === 3).num, decided.n);
  assert.deepEqual(t.errors, []);
  await t.close();
});

test("止まったあと（当選画面）は、回し始めの記録が消えている", async () => {
  const t = await h.open({ clock: true, reducedMotion: true, storage: { [S]: { prizes: h.makePrizes(2), people: 10 } } });
  await h.spinOnce(t.page);
  assert.equal((await h.stored(t.page)).pendingSpin, null);
  await t.close();
});

test("当選画面で再読み込み：当選は残り、その番号は二度と出ない", async () => {
  // 初期化スクリプトで保存データを入れると、file:// の再読み込みで入れ直しが起きることがあるため、ここでは画面から入れる
  const t = await h.open({ clock: true, reducedMotion: true });
  await t.page.evaluate(d => localStorage.setItem("prize-plus-v1", JSON.stringify(d)), { prizes: h.makePrizes(2), people: 2 });
  await t.page.reload(); await t.page.waitForFunction(() => document.body.className.includes("view-"));
  const n1 = await h.spinOnce(t.page);
  await t.page.reload();
  await t.page.waitForFunction(() => document.body.className.includes("view-"));
  assert.equal((await h.listState(t.page)).find(r => r.rank === 2).num, n1);
  const n2 = await h.spinOnce(t.page);
  assert.notEqual(n1, n2);
  await t.close();
});

test("景品が人数より多い：上位から人数分だけ抽選し、注意を表示", async () => {
  const t = await h.open({ clock: true, reducedMotion: true, storage: { [S]: { prizes: h.makePrizes(5), people: 3 } } });
  assert.match(await t.page.textContent("#peopleNote"), /上位3件だけ/);
  const got = await drawAll(t.page);
  assert.deepEqual(got.map(g => g.rank), [3, 2, 1]);
  assert.deepEqual(got.map(g => g.num).sort(), [1, 2, 3]);
  await t.close();
});

test("景品が人数より少ない：景品の数だけ抽選して終了", async () => {
  const t = await h.open({ clock: true, reducedMotion: true, storage: { [S]: { prizes: h.makePrizes(2), people: 50 } } });
  const got = await drawAll(t.page);
  assert.equal(got.length, 2);
  await t.close();
});

test("参加人数2人：2人とも当選して終了", async () => {
  const t = await h.open({ clock: true, reducedMotion: true, storage: { [S]: { prizes: h.makePrizes(3), people: 2 } } });
  const got = await drawAll(t.page);
  assert.deepEqual(got.map(g => g.num).sort(), [1, 2]);
  await t.close();
});

test("参加人数500人：入力の上限と抽選", async () => {
  const t = await h.open({ clock: true, reducedMotion: true, storage: { [S]: { prizes: h.makePrizes(20), people: 100 } } });
  await t.page.fill("#peopleInput", "9999"); await t.page.press("#peopleInput", "Enter");
  assert.equal(await t.page.inputValue("#peopleInput"), "500");
  await t.page.fill("#peopleInput", "1"); await t.page.press("#peopleInput", "Enter");
  assert.equal(await t.page.inputValue("#peopleInput"), "2");
  await t.page.fill("#peopleInput", "500"); await t.page.press("#peopleInput", "Enter");
  const got = await drawAll(t.page);
  assert.equal(got.length, 20);
  assert.equal(new Set(got.map(g => g.num)).size, 20);
  got.forEach(g => assert.ok(g.num >= 1 && g.num <= 500));
  assert.deepEqual(t.errors, []);
  await t.close();
});

test("SPINの二重クリック・連打でも1回だけ抽選する", async () => {
  const t = await h.open({ clock: true, reducedMotion: true, storage: { [S]: { prizes: h.makePrizes(3), people: 10 } } });
  await t.page.evaluate(() => { const b = document.getElementById("spinBtn"); b.click(); b.click(); document.getElementById("wheel").click(); });
  await t.page.keyboard.press("Space");
  for (let k = 0; k < 5; k++) await t.page.clock.runFor(1000);
  const st = await h.stored(t.page);
  assert.equal(Object.keys(st.wins).length, 1);
  await t.close();
});

test("抽選の途中は参加人数・順番・景品の読み込みを変えられない", async () => {
  const t = await h.open({ clock: true, reducedMotion: true, storage: { [S]: { prizes: h.makePrizes(3), people: 10 } } });
  await h.spinOnce(t.page); await h.closeReveal(t.page);
  assert.equal(await t.page.locator("#peopleInput").isDisabled(), true);
  await t.page.evaluate(() => location.hash = "prizes");
  assert.equal(await t.page.locator("#orderBtn").isDisabled(), true);
  assert.equal(await t.page.locator("#loadBtn").isDisabled(), true);
  await t.close();
});
