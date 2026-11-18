// ファイル：Excel / CSV の読み込み（UTF-8、Shift_JIS、BOM、見出しなし、空行、壊れたファイル）、
// CSV書き出し（数式インジェクション対策）、バックアップと復元（壊れたJSON、別バージョン）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const h = require("./helpers");
const S = "prize-plus-v1";
const FX = path.join(__dirname, "fixtures");
test.after(h.teardown);
const names = page => page.$$eval("#prizeEdit input", a => a.map(x => x.value));
const csvFile = (name, text) => ({ name, mimeType: "text/csv", buffer: Buffer.from(text) });
async function loadPrizes(page, file) { await page.setInputFiles("#fileInput", typeof file === "string" ? path.join(FX, file) : file); await page.waitForFunction(() => document.getElementById("loadMsg").textContent); }
async function loadRoster(page, file) { await page.setInputFiles("#rosterInput", typeof file === "string" ? path.join(FX, file) : file); await page.waitForTimeout(200); }
// ページの中の SheetJS で Excel ファイルを作る
const makeBook = (page, aoa, bookType = "xlsx") => page.evaluate(([aoa, bookType]) => {
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Sheet1");
  return XLSX.write(wb, { type: "base64", bookType });
}, [aoa, bookType]).then(b64 => ({ name: "book." + bookType, mimeType: "application/octet-stream", buffer: Buffer.from(b64, "base64") }));
async function downloadText(page, sel) {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click(sel)]);
  return { name: dl.suggestedFilename(), text: fs.readFileSync(await dl.path(), "utf8") };
}

test("景品CSV：UTF-8・BOMあり・Shift_JIS・空行あり、どれも同じに読める", async () => {
  const t = await h.open({ hash: "prizes" });
  for (const f of ["prizes-utf8.csv", "prizes-utf8-bom.csv", "prizes-sjis.csv"]) {
    await t.page.evaluate(() => { document.getElementById("loadMsg").textContent = ""; });
    await loadPrizes(t.page, f);
    assert.deepEqual(await names(t.page), ["テーマパーク ペアチケット", "ワイヤレスイヤホン", "お米 5kg"], f);
  }
  await t.close();
});

test("景品CSV：見出しなし（A列=順位, B列=景品名）は順位で並べる", async () => {
  const t = await h.open({ hash: "prizes" });
  await loadPrizes(t.page, "prizes-noheader.csv");
  assert.deepEqual(await names(t.page), ["ギフトカード", "タオル", "お菓子"]);
  await t.close();
});

test("景品CSV：見出しが「景品」だけ（順位の列なし）のときは、行の順のまま読む", async () => {
  const t = await h.open({ hash: "prizes" });
  await loadPrizes(t.page, csvFile("p.csv", "景品\nお米 5kg\nタオル\nギフトカード 3000円\n"));
  assert.deepEqual(await names(t.page), ["お米 5kg", "タオル", "ギフトカード 3000円"]);
  await t.close();
});

test("景品CSV：日付や数字に見える景品名もそのまま読む", async () => {
  const t = await h.open({ hash: "prizes" });
  await loadPrizes(t.page, csvFile("p.csv", "順位,景品名\n1,3/4\n2,TRUE\n3,0012\n4,1e3\n5,\"1,000円\"\n"));
  assert.deepEqual(await names(t.page), ["3/4", "TRUE", "0012", "1e3", "1,000円"]);
  await t.close();
});

test("景品Excel：.xlsx と .xls、サンプルファイル", async () => {
  const t = await h.open({ hash: "prizes" });
  for (const type of ["xlsx", "biff8"]) {
    const f = await makeBook(t.page, [["順位", "景品名"], [2, "二等"], [1, "一等"], [], [3, "三等"]], type);
    if (type === "biff8") f.name = "book.xls";
    await loadPrizes(t.page, f);
    assert.deepEqual(await names(t.page), ["一等", "二等", "三等"], type);
  }
  await t.page.setInputFiles("#fileInput", path.join(h.ROOT, "sample-prizes.xlsx"));
  await t.page.waitForTimeout(300);
  assert.match(await t.page.textContent("#loadMsg"), /件の景品を読み込みました/);
  await t.close();
});

test("壊れたファイル・空のファイル：エラーを出し、今の景品は変わらない", async () => {
  const t = await h.open({ hash: "prizes", storage: { [S]: { prizes: h.makePrizes(3) } } });
  for (const f of ["truncated.xlsx", "image-renamed.xlsx", "empty.csv"]) {
    await t.page.evaluate(() => { document.getElementById("loadMsg").textContent = ""; });
    await loadPrizes(t.page, f);
    assert.equal(await t.page.locator("#loadMsg.error").count(), 1, f + ": " + await t.page.textContent("#loadMsg"));
    assert.deepEqual(await names(t.page), ["景品1", "景品2", "景品3"], f);
  }
  assert.deepEqual(t.errors, []);
  await t.close();
});

test("名簿CSV：UTF-8・Shift_JIS・BOM・見出しなし・サンプル", async () => {
  const t = await h.open({ hash: "members" });
  for (const f of ["roster-utf8.csv", "roster-sjis.csv", "roster-bom.csv"]) {
    await loadRoster(t.page, f);
    const m = (await h.stored(t.page, S + "-members")).members;
    assert.deepEqual(Object.keys(m), ["1", "2", "3", "5"], f);
    assert.deepEqual([m[1].name, m[1].kind, m[2].kind, m[3].kind], ["山田 太郎", "name", "nick", "none"], f);
  }
  await loadRoster(t.page, "roster-noheader.csv");
  assert.deepEqual(Object.keys((await h.stored(t.page, S + "-members")).members), ["10", "12"]);
  await t.page.setInputFiles("#rosterInput", path.join(h.ROOT, "sample-roster.csv"));
  await t.page.waitForTimeout(300);
  assert.ok(Object.keys((await h.stored(t.page, S + "-members")).members).length > 0);
  await loadRoster(t.page, "truncated.xlsx");
  assert.equal(await t.page.locator("#rosterMsg.error").count(), 1);
  assert.deepEqual(t.errors, []);
  await t.close();
});

test("CSV書き出し：数式に見える値の先頭に ' を付ける。書き出したCSVを読み込み直せる", async () => {
  const evil = ["=1+1", "+SUM(A1)", "-2+3", "@cmd", "\tTAB", "普通の\"名前\",カンマ"];
  const members = Object.fromEntries(evil.map((n, i) => [i + 1, { name: n, kind: "name", at: 0 }]));
  const t = await h.open({ hash: "data", storage: { [S]: { prizes: evil.map((name, i) => ({ rank: i + 1, name })) }, [S + "-members"]: { members, file: "" } } });
  for (const sel of ["#expPrizes", "#expMembers"]) {
    const { name, text } = await downloadText(t.page, sel);
    assert.ok(text.startsWith("﻿"), "BOMがない");
    assert.match(name, /\.csv$/);
    for (const line of text.slice(1).split("\r\n").slice(1).filter(Boolean)) {
      for (const cell of line.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map(c => c.replace(/,$/, "").replace(/^"|"$/g, "")))
        assert.ok(!/^[=+\-@\t\r]/.test(cell), `${sel}: 危ないセル ${JSON.stringify(cell)}`);
    }
    assert.ok(text.includes(`"普通の""名前"",カンマ"`));
  }
  // 景品CSVを読み込み直す
  await t.page.evaluate(() => location.hash = "prizes");
  const { text } = await downloadText(t.page, "#prizeExport");
  await loadPrizes(t.page, { name: "re.csv", mimeType: "text/csv", buffer: Buffer.from(text) });
  assert.equal((await names(t.page)).length, evil.length);
  await t.close();
});

test("抽選結果のCSV：抽選した順と外した番号", async () => {
  const t = await h.open({ clock: true, reducedMotion: true, storage: { [S]: { prizes: h.makePrizes(2), people: 10 } } });
  const n1 = await h.spinOnce(t.page);
  await t.page.click("#redoBtn"); await t.page.click("#doRedo");
  for (let k = 0; k < 10 && await t.page.locator("#reveal").isHidden(); k++) await t.page.clock.runFor(1000);
  await h.closeReveal(t.page);
  await t.page.evaluate(() => location.hash = "data");
  const { text } = await downloadText(t.page, "#expResults");
  const lines = text.slice(1).trim().split("\r\n");
  assert.equal(lines[0], "抽選した順,順位,景品名,当選番号,名前");
  assert.match(lines[1], /^1,2,景品2,\d+,/);
  assert.equal(lines[2], `,,（当選者がいなくて外した番号）,${n1},`);
  await t.close();
});

test("バックアップと復元：書き出したものを別の端末（新しいブラウザ）に戻せる", async () => {
  const t = await h.open({ clock: true, reducedMotion: true, storage: { [S]: { prizes: h.makePrizes(3), people: 10 }, [S + "-members"]: h.makeMembers({ 4: "山田" }), [S + "-settings"]: { eventName: "テスト会", numbering: "random" } } });
  await h.spinOnce(t.page); await h.closeReveal(t.page);
  await t.page.evaluate(() => location.hash = "data");
  const { name, text } = await downloadText(t.page, "#expBackup");
  assert.match(name, /^テスト会_景品ルーレット_バックアップ_\d{4}-\d\d-\d\d\.json$/);
  const before = await h.stored(t.page);
  await t.close();

  const t2 = await h.open({ hash: "data" });
  await t2.page.setInputFiles("#backupInput", { name, mimeType: "application/json", buffer: Buffer.from(text) });
  await t2.page.waitForSelector("#restoreRow:not([hidden])");
  assert.match(await t2.page.textContent("#backupMsg"), /景品3件・名簿1人/);
  await Promise.all([t2.page.waitForEvent("load"), t2.page.click("#restoreYes")]);
  await t2.page.waitForFunction(() => document.body.className.includes("view-"));
  assert.equal(await t2.page.evaluate(() => location.hash), "#draw");
  const after = await h.stored(t2.page);
  assert.deepEqual(after.wins, before.wins);
  assert.equal((await h.stored(t2.page, S + "-settings")).eventName, "テスト会");
  assert.deepEqual(t2.errors, []);
  await t2.close();
});

test("バックアップ：壊れたJSON・ほかのアプリのJSONは戻さない。「やめる」で何も変わらない", async () => {
  const t = await h.open({ hash: "data", storage: { [S]: { prizes: h.makePrizes(2) } } });
  for (const body of ["{not json", JSON.stringify({ app: "other", state: { prizes: [] } }), JSON.stringify([1, 2]), "null"]) {
    await t.page.setInputFiles("#backupInput", { name: "b.json", mimeType: "application/json", buffer: Buffer.from(body) });
    await t.page.waitForTimeout(150);
    assert.equal(await t.page.locator("#backupMsg.error").count(), 1, body);
    assert.equal(await t.page.locator("#restoreRow").isHidden(), true);
  }
  await t.page.setInputFiles("#backupInput", { name: "b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ app: "prize-roulette-plus", version: 1, state: { prizes: [{ rank: 1, name: "X" }] } })) });
  await t.page.waitForSelector("#restoreRow:not([hidden])");
  await t.page.click("#restoreNo");
  assert.equal((await h.stored(t.page)).prizes.length, 2);
  await t.close();
});

test("バックアップ：別バージョン・おかしな値が入っていても、戻したあと正常に動く", async () => {
  const odd = {
    app: "prize-roulette-plus", version: 99, futureField: { x: 1 },
    state: { prizes: [{ rank: 1, name: "一等" }, null, "文字だけ", { rank: "<b>2</b>", name: 42 }, { name: "名前だけ" }], wins: { 0: "3", 1: 999, 9: 2, x: 1 }, drawOrder: [0, 0, 9, "a"], absent: ["5", -1, 2.5], order2: "top", people: "50" },
    members: { members: { 3: { name: "<i>x</i>", kind: "weird" }, 999: { name: "範囲外" }, abc: {} }, file: 7 },
    settings: { eventName: 123, numbering: "zzz", start: "abc", capacity: -5, open: "yes", showNames: "false", resetSec: "abc" }
  };
  const t = await h.open({ hash: "data" });
  await t.page.setInputFiles("#backupInput", { name: "b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(odd)) });
  await t.page.waitForSelector("#restoreRow:not([hidden])");
  await Promise.all([t.page.waitForEvent("load"), t.page.click("#restoreYes")]);
  await t.page.waitForFunction(() => document.body.className.includes("view-"), null, { timeout: 5000 });
  assert.deepEqual(t.errors, []);
  // 景品は文字の景品名として読み、順位は並び順
  await t.page.evaluate(() => location.hash = "prizes");
  const ns = await names(t.page);
  assert.ok(ns.every(n => typeof n === "string" && n.length > 0 && n !== "undefined" && n !== "null"), JSON.stringify(ns));
  // 書き出し・受付・抽選が動く
  await t.page.evaluate(() => location.hash = "data");
  await downloadText(t.page, "#expResults");
  await downloadText(t.page, "#expMembers");
  await t.page.evaluate(() => location.hash = "reception");
  await t.page.fill("#kName", "A"); await t.page.click("#kForm button[type=submit]");
  assert.match(await t.page.textContent("#kNext"), /あと\d+秒/);
  assert.deepEqual(t.errors, []);
  await t.close();
});
