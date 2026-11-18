// 受付：番号の振り方、最初の番号・最大人数・満員、名前の種類、同じ名前の確認、受付モード、スタッフボタン、受付終了
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const S = "prize-plus-v1";
test.after(h.teardown);

async function register(page, name, kind = "name") {
  await page.check(`input[name="kKind"][value="${kind}"]`, { force: true });
  if (kind !== "none") await page.fill("#kName", name);
  await page.click("#kForm button[type=submit]");
}
const ticket = async page => (await page.locator("#kTicket").isVisible()) ? +(await page.textContent("#kNum")) : null;
const next = page => h.kioskNext(page);

test("来た順：最初の番号から順に。最大人数で満員になる", async () => {
  const t = await h.open({ hash: "reception", storage: { [S + "-settings"]: { numbering: "seq", start: 101, capacity: 3 } } });
  const nums = [];
  for (const n of ["A", "B", "C"]) { await register(t.page, n); nums.push(await ticket(t.page)); await next(t.page); }
  assert.deepEqual(nums, [101, 102, 103]);
  assert.equal(await t.page.textContent("#kNextNum"), "満員");
  await register(t.page, "D");
  assert.equal(await ticket(t.page), null);
  assert.match(await t.page.textContent("#kErr"), /スタッフにお声がけ/);
  assert.equal(Object.keys((await h.stored(t.page, S + "-members")).members).length, 3);
  await t.close();
});

test("ランダム：範囲内の空いている番号から重複なく", async () => {
  const t = await h.open({ hash: "reception", storage: { [S + "-settings"]: { numbering: "random", start: 5, capacity: 8 } } });
  const nums = [];
  for (let k = 0; k < 8; k++) { await register(t.page, "", "none"); nums.push(await ticket(t.page)); await next(t.page); }
  assert.deepEqual(nums.slice().sort((a, b) => a - b), [5, 6, 7, 8, 9, 10, 11, 12]);
  await register(t.page, "", "none");
  assert.equal(await ticket(t.page), null);
  await t.close();
});

test("設定画面で最初の番号・最大人数を変えると範囲が変わる（上限500）", async () => {
  const t = await h.open({ hash: "members" });
  await t.page.fill("#setStart", "490"); await t.page.press("#setStart", "Tab");
  await t.page.fill("#setCap", "100"); await t.page.press("#setCap", "Tab");
  assert.match(await t.page.textContent("#setRange"), /490〜500番/);
  const st = await h.stored(t.page, S + "-settings");
  assert.deepEqual([st.start, st.capacity], [490, 11]);
  await t.close();
});

test("名前／ニックネーム／入力しない が名簿に記録される", async () => {
  const t = await h.open({ hash: "reception" });
  await register(t.page, "山田 太郎", "name"); assert.equal(await t.page.textContent("#kWho"), "山田 太郎 さん"); await next(t.page);
  await register(t.page, "たろう", "nick"); await next(t.page);
  await register(t.page, "", "none"); assert.match(await t.page.textContent("#kWho"), /名前なし/); await next(t.page);
  const m = (await h.stored(t.page, S + "-members")).members;
  assert.deepEqual(Object.values(m).map(v => [v.kind, v.name]), [["name", "山田 太郎"], ["nick", "たろう"], ["none", ""]]);
  // 名前が空のときは受付しない
  await t.page.fill("#kName", "   "); await t.page.click("#kForm button[type=submit]");
  assert.equal(await t.page.locator("#kErr").isVisible(), true);
  await t.close();
});

test("同じ名前の確認：ほかの人の番号を見せない", async () => {
  const t = await h.open({ hash: "reception", storage: { [S + "-settings"]: { numbering: "seq", start: 37, capacity: 50 } } });
  await register(t.page, "山田"); const first = await ticket(t.page); await next(t.page);
  assert.equal(first, 37);
  await register(t.page, "山田");
  assert.equal(await t.page.locator("#kDup").isVisible(), true);
  const visible = await t.page.locator(".kiosk-main").innerText();   // 来場者に見える部分（スタッフ用の欄は受付モードでは隠れる）
  assert.ok(!visible.includes("37"), "確認画面に先の人の番号が出ている: " + visible);
  await t.page.click("#kDupNo");
  assert.equal(await t.page.inputValue("#kName"), "山田");
  await t.page.click("#kForm button[type=submit]");
  await t.page.click("#kDupYes");
  assert.equal(await ticket(t.page), 38);
  await t.close();
});

test("受付モード：タブが消え、ほかの画面に移れない。スタッフボタンは2秒長押しで終了", async () => {
  const t = await h.open({ hash: "reception" });
  await t.page.click("#kStart");
  assert.equal(await t.page.evaluate(() => document.body.classList.contains("kiosk")), true);
  assert.equal(await t.page.locator(".tabs").isHidden(), true);
  await t.page.evaluate(() => location.hash = "members");
  await t.page.waitForTimeout(100);
  assert.equal(await t.page.evaluate(() => location.hash), "#reception");
  assert.equal(await t.page.locator("#page-members").isHidden(), true);
  const staff = t.page.locator("#kStaff");
  const box = await staff.boundingBox();
  await t.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await t.page.mouse.down(); await t.page.waitForTimeout(1000); await t.page.mouse.up();
  await t.page.waitForTimeout(1500);
  assert.equal(await t.page.evaluate(() => document.body.classList.contains("kiosk")), true, "1秒で終わってしまった");
  await t.page.mouse.down(); await t.page.waitForTimeout(2300); await t.page.mouse.up();
  assert.equal(await t.page.evaluate(() => document.body.classList.contains("kiosk")), false);
  assert.equal(await t.page.locator(".tabs").isVisible(), true);
  await t.close();
});

test("受付モード：スタッフボタンはキーボードでも長押しで終了できる", async () => {
  const t = await h.open({ hash: "reception" });
  await t.page.click("#kStart");
  await t.page.focus("#kStaff");
  await t.page.keyboard.down("Enter"); await t.page.waitForTimeout(2300); await t.page.keyboard.up("Enter");
  assert.equal(await t.page.evaluate(() => document.body.classList.contains("kiosk")), false);
  await t.close();
});

test("受付終了：受付画面に「受付は終了しました」と出て、受付できない", async () => {
  const t = await h.open({ hash: "members" });
  await t.page.uncheck("#setOpen");
  await t.page.evaluate(() => location.hash = "reception");
  assert.equal(await t.page.locator("#kClosed").isVisible(), true);
  assert.equal(await t.page.locator("#kForm").isHidden(), true);
  await t.page.evaluate(() => location.hash = "members");
  await t.page.check("#setOpen");
  await t.page.evaluate(() => location.hash = "reception");
  assert.equal(await t.page.locator("#kForm").isVisible(), true);
  await t.close();
});

test("番号の表示は設定した秒数で次の人の入力画面に戻る", async () => {
  const t = await h.open({ hash: "reception", clock: true, storage: { [S + "-settings"]: { resetSec: 5 } } });
  await register(t.page, "A");
  assert.match(await t.page.textContent("#kNext"), /あと5秒/);
  await t.page.clock.runFor(4500);
  assert.equal(await t.page.locator("#kTicket").isVisible(), true);
  await t.page.clock.runFor(1000);
  assert.equal(await t.page.locator("#kForm").isVisible(), true);
  await t.close();
});

test("「番号をもらう」の二重クリック・Enter連打でも、番号の画面がすぐ消えず、二重に受付しない", async () => {
  const t = await h.open({ hash: "reception" });
  await t.page.fill("#kName", "A");
  await t.page.dblclick("#kForm button[type=submit]");
  assert.equal(await ticket(t.page), 1, "番号の画面がすぐ消えた");
  await next(t.page);
  await t.page.fill("#kName", "B");
  await t.page.press("#kName", "Enter"); await t.page.keyboard.press("Enter");
  assert.equal(await ticket(t.page), 2, "番号の画面がすぐ消えた");
  assert.equal(Object.keys((await h.stored(t.page, S + "-members")).members).length, 2);
  await t.close();
});
