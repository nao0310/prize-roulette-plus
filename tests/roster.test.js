// 名簿：名簿の番号だけで抽選、抜け番号、途中参加、当選者の削除防止、名前の表示オン／オフ
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const S = "prize-plus-v1";
test.after(h.teardown);

test("名簿の番号（抜け番号あり）だけで抽選する", async () => {
  const roster = { 3: "A", 7: "B", 12: "", 40: "D" };
  const t = await h.open({ clock: true, reducedMotion: true, storage: { [S]: { prizes: h.makePrizes(6), people: 100 }, [S + "-members"]: h.makeMembers(roster) } });
  assert.match(await t.page.textContent("#listSub"), /名簿の4人/);
  assert.equal(await t.page.locator(".people-row").isHidden(), true);
  const got = [];
  while (await t.page.locator("#spinBtn").isEnabled()) { got.push(await h.spinOnce(t.page)); await h.closeReveal(t.page); await t.page.locator("#result").evaluate(e => { e.hidden = true; }); }
  assert.deepEqual(got.slice().sort((a, b) => a - b), [3, 7, 12, 40]);
  assert.deepEqual((await h.listState(t.page)).map(r => r.rank), [1, 2, 3, 4]);
  await t.close();
});

test("途中参加：抽選の途中で追加した人も次から対象になる", async () => {
  const t = await h.open({ clock: true, reducedMotion: true, storage: { [S]: { prizes: h.makePrizes(2), order2: "top" }, [S + "-members"]: h.makeMembers({ 1: "A" }) } });
  assert.equal(await h.spinOnce(t.page), 1); await h.closeReveal(t.page);
  assert.equal(await t.page.textContent("#spinBtn"), "抽選終了");
  await t.page.evaluate(() => location.hash = "members");
  await t.page.fill("#memAddName", "途中さん"); await t.page.click("#memAddForm button[type=submit]");
  assert.match(await t.page.textContent("#memAddMsg"), /2番で追加/);
  await t.page.evaluate(() => location.hash = "draw");
  assert.equal(await h.spinOnce(t.page), 2);
  assert.equal(await t.page.textContent("#revealWho"), "途中さんさん");
  await t.close();
});

test("当選者は名簿から削除できない（ボタンが押せない）", async () => {
  const t = await h.open({ clock: true, reducedMotion: true, storage: { [S]: { prizes: h.makePrizes(1) }, [S + "-members"]: h.makeMembers({ 1: "A", 2: "B" }) } });
  const n = await h.spinOnce(t.page); await h.closeReveal(t.page);
  await t.page.evaluate(() => location.hash = "members");
  const del = t.page.locator(`button[data-del="${n}"]`);
  assert.equal(await del.isDisabled(), true);
  await del.evaluate(b => { b.disabled = false; b.click(); b.click(); });   // 無理に押しても消えない
  assert.ok((await h.stored(t.page, S + "-members")).members[n]);
  const other = n === 1 ? 2 : 1;
  await t.page.click(`button[data-del="${other}"]`); await t.page.click(`button[data-del="${other}"]`);
  assert.equal((await h.stored(t.page, S + "-members")).members[other], undefined);
  await t.close();
});

test("景品が人数以上のときは、抽選の途中で名簿の人を消せない（1位まで抽選できる）", async () => {
  // 景品5件・名簿4人 → 上位4件を抽選。下位から2本引いたあと、まだ当たっていない人を消そうとする
  const t = await h.open({ clock: true, reducedMotion: true, storage: { [S]: { prizes: h.makePrizes(5) }, [S + "-members"]: h.makeMembers({ 1: "A", 2: "B", 3: "C", 4: "D" }) } });
  const won = [];
  for (let k = 0; k < 2; k++) { won.push(await h.spinOnce(t.page)); await h.closeReveal(t.page); }
  const loser = [1, 2, 3, 4].find(n => !won.includes(n));
  await t.page.evaluate(() => location.hash = "members");
  await t.page.click(`button[data-del="${loser}"]`); await t.page.click(`button[data-del="${loser}"]`);
  assert.match(await t.page.textContent("#rosterMsg"), /抽選の途中は削除できません/);
  assert.ok((await h.stored(t.page, S + "-members")).members[loser]);
  await t.page.evaluate(() => location.hash = "draw");
  while (await t.page.locator("#spinBtn").isEnabled()) { won.push(await h.spinOnce(t.page)); await h.closeReveal(t.page); await t.page.locator("#result").evaluate(e => { e.hidden = true; }); }
  assert.deepEqual(won.slice().sort(), [1, 2, 3, 4]);
  assert.deepEqual((await h.listState(t.page)).map(r => r.rank), [1, 2, 3, 4]);
  assert.equal(await t.page.locator("#resultBtn").isVisible(), true);
  await t.close();
});

test("人数に余裕があるときや、外した番号の人は、抽選の途中でも消せる。決まった当選者は一覧から消えない", async () => {
  const t = await h.open({ clock: true, reducedMotion: true, storage: { [S]: { prizes: h.makePrizes(2), order2: "top" }, [S + "-members"]: h.makeMembers({ 1: "A", 2: "B", 3: "C", 4: "D" }) } });
  const n1 = await h.spinOnce(t.page);
  await t.page.click("#redoBtn"); await t.page.click("#doRedo");   // n1 を外した番号にする
  for (let k = 0; k < 10 && await t.page.locator("#reveal").isHidden(); k++) await t.page.clock.runFor(1000);
  const n2 = +(await t.page.textContent("#bigNum")); await h.closeReveal(t.page);
  await t.page.evaluate(() => location.hash = "members");
  await t.page.click(`button[data-del="${n1}"]`); await t.page.click(`button[data-del="${n1}"]`);
  assert.equal((await h.stored(t.page, S + "-members")).members[n1], undefined);
  const free = [1, 2, 3, 4].find(n => n !== n1 && n !== n2);
  await t.page.click(`button[data-del="${free}"]`); await t.page.click(`button[data-del="${free}"]`);
  assert.equal((await h.stored(t.page, S + "-members")).members[free], undefined);
  await t.page.evaluate(() => location.hash = "draw");
  assert.equal((await h.listState(t.page)).find(r => r.rank === 1).num, n2);
  await t.close();
});

test("名前の表示オン／オフ：当選画面・一覧・結果", async () => {
  const t = await h.open({ clock: true, reducedMotion: true, storage: { [S]: { prizes: h.makePrizes(2), order2: "top" }, [S + "-members"]: h.makeMembers({ 1: "山田", 2: "佐藤" }) } });
  await h.spinOnce(t.page);
  assert.match(await t.page.textContent("#revealWho"), /(山田|佐藤)さん/);
  await h.closeReveal(t.page);
  assert.match((await h.listState(t.page))[0].who, /さん/);
  await t.page.evaluate(() => location.hash = "members");
  await t.page.uncheck("#setShow");
  await t.page.evaluate(() => location.hash = "draw");
  assert.equal((await h.listState(t.page))[0].who, "");
  await h.spinOnce(t.page);
  assert.equal(await t.page.locator("#revealWho").isHidden(), true);
  await h.closeReveal(t.page);
  await t.page.click("#resultBtn");
  assert.equal(await t.page.locator("#result .who").count(), 0);
  // 名簿画面（スタッフ用）には名前が出る
  await t.page.evaluate(() => location.hash = "members");
  assert.equal(await t.page.locator('#memBody input[data-n="1"]').inputValue(), "山田");
  await t.close();
});

test("名簿の名前・種別の修正と検索", async () => {
  const t = await h.open({ hash: "members", storage: { [S + "-members"]: h.makeMembers({ 1: "山田", 2: "佐藤", 15: "鈴木" }) } });
  await t.page.fill('#memBody input[data-n="2"]', "佐藤 次郎"); await t.page.press('#memBody input[data-n="2"]', "Enter");
  assert.equal((await h.stored(t.page, S + "-members")).members[2].name, "佐藤 次郎");
  await t.page.selectOption('#memBody select[data-n="1"]', "none");
  const m1 = (await h.stored(t.page, S + "-members")).members[1];
  assert.deepEqual([m1.kind, m1.name], ["none", ""]);
  await t.page.fill("#memSearch", "15");
  assert.equal(await t.page.locator("#memBody tr").count(), 1);
  await t.page.fill("#memSearch", "佐藤");
  assert.equal(await t.page.locator("#memBody tr").count(), 1);
  await t.close();
});

test("手で追加：番号の指定・重複・範囲外・抽選で使った番号", async () => {
  const t = await h.open({ clock: true, reducedMotion: true, storage: { [S]: { prizes: h.makePrizes(1) }, [S + "-members"]: h.makeMembers({ 1: "A" }) } });
  await h.spinOnce(t.page); await h.closeReveal(t.page);   // 1番が当選
  await t.page.evaluate(() => location.hash = "members");
  const add = async (name, num) => { await t.page.fill("#memAddName", name); await t.page.fill("#memAddNum", String(num)); await t.page.click("#memAddForm button[type=submit]"); return t.page.textContent("#memAddMsg"); };
  assert.match(await add("B", 1), /すでに使われています/);
  // 範囲外はブラウザの入力チェックで送信されない
  for (const bad of [0, 501]) { await add("B", bad); assert.equal(await t.page.locator("#memAddNum").evaluate(e => e.validity.valid), false); }
  assert.equal(Object.keys((await h.stored(t.page, S + "-members")).members).length, 1);
  assert.match(await add("B", 77), /77番で追加/);
  await t.page.selectOption("#memAddKind", "none");
  assert.equal(await t.page.locator("#memAddName").isDisabled(), true);
  await t.page.click("#memAddForm button[type=submit]");
  assert.match(await t.page.textContent("#memAddMsg"), /番で追加/);
  await t.close();
});

test("名簿を全部消す：2回押しで消え、抽選の途中は消せない", async () => {
  const t = await h.open({ hash: "members", storage: { [S + "-members"]: h.makeMembers({ 1: "A", 2: "B" }) } });
  await t.page.click("#rosterClear");
  assert.match(await t.page.textContent("#rosterClear"), /本当に/);
  await t.page.click("#rosterClear");
  assert.equal(await h.stored(t.page, S + "-members"), null);
  assert.match(await t.page.textContent("#listSub"), /1〜\d+番で抽選/);
  await t.close();
});

test("名簿なし（1〜参加人数）で抽選している途中は、受付・手での追加を止め、抽選の対象が変わらない", async () => {
  const t = await h.open({ clock: true, reducedMotion: true, storage: { [S]: { prizes: h.makePrizes(5), people: 50 } } });
  await h.spinOnce(t.page); await h.closeReveal(t.page);
  await t.page.evaluate(() => location.hash = "reception");
  assert.match(await t.page.textContent("#kMode"), /受付停止中/);
  await t.page.fill("#kName", "A"); await t.page.click("#kForm button[type=submit]");
  assert.equal(await t.page.locator("#kTicket").isHidden(), true);
  assert.match(await t.page.textContent("#kErr"), /抽選中のため/);
  await t.page.evaluate(() => location.hash = "members");
  await t.page.fill("#memAddName", "B"); await t.page.click("#memAddForm button[type=submit]");
  assert.match(await t.page.textContent("#memAddMsg"), /リセットしてから/);
  assert.equal(await h.stored(t.page, S + "-members"), null);
  await t.page.evaluate(() => location.hash = "draw");
  assert.match(await t.page.textContent("#listSub"), /1〜50番で抽選/);
  // リセットすれば受付できる
  await t.page.click("#resetBtn"); await t.page.click("#doReset");
  await t.page.evaluate(() => location.hash = "reception");
  await t.page.fill("#kName", "A"); await t.page.click("#kForm button[type=submit]");
  assert.equal(await t.page.locator("#kTicket").isVisible(), true);
  await t.close();
});

test("下位から抽選中に参加者が増えて景品が増えたら、次の景品が変わったことを表示する", async () => {
  const t = await h.open({ clock: true, reducedMotion: true, storage: { [S]: { prizes: h.makePrizes(5) }, [S + "-members"]: h.makeMembers({ 1: "A", 2: "B", 3: "C" }) } });
  await h.spinOnce(t.page); await h.closeReveal(t.page);
  assert.equal(await t.page.locator("#joinMsg").isHidden(), true);
  await t.page.evaluate(() => location.hash = "members");
  await t.page.fill("#memAddName", "D"); await t.page.click("#memAddForm button[type=submit]");
  await t.page.evaluate(() => location.hash = "draw"); await t.page.clock.runFor(100);
  assert.equal(await t.page.textContent("#joinMsg"), "参加者が増えたので、4位も抽選します（次は4位）");
  assert.equal(await t.page.locator("#joinMsg").isVisible(), true);
  await h.spinOnce(t.page);
  assert.equal(parseInt(await t.page.textContent("#revealRank"), 10), 4);
  await h.closeReveal(t.page);
  assert.equal(await t.page.locator("#joinMsg").isHidden(), true);
  await t.close();
});

test("1位から抽選しているときや、抽選の前に増えたときは表示しない", async () => {
  const t = await h.open({ clock: true, reducedMotion: true, storage: { [S]: { prizes: h.makePrizes(5), order2: "top" }, [S + "-members"]: h.makeMembers({ 1: "A", 2: "B", 3: "C" }) } });
  await t.page.evaluate(() => location.hash = "members");
  await t.page.fill("#memAddName", "D"); await t.page.click("#memAddForm button[type=submit]");
  await t.page.evaluate(() => location.hash = "draw");
  await h.spinOnce(t.page); await h.closeReveal(t.page);
  await t.page.evaluate(() => location.hash = "members");
  await t.page.fill("#memAddName", "E"); await t.page.click("#memAddForm button[type=submit]");
  await t.page.evaluate(() => location.hash = "draw"); await t.page.clock.runFor(100);
  assert.equal(await t.page.locator("#joinMsg").isHidden(), true);
  await t.close();
});
