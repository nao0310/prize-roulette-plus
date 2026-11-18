// 漢字が中国語のフォント（字の形が日本語と違う）ではなく、日本語のフォントで表示されること
// 端末に日本語と中国語の両方のフォントがあると、フォントの指定が sans-serif などだけでは中国語のフォントが選ばれることがある。
// ブラウザが実際に描画に使ったフォントを、要素ごとに調べる（Chrome の開発者向けの機能 CDP を使う）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
test.after(h.teardown);

const CHINESE = /WenQuanYi|CJK (SC|TC|HK)|Sans (SC|TC|HK)|YaHei|JhengHei|SimSun|SimHei|NSimSun|PingFang|Heiti|STHeiti|Songti|Droid Sans Fallback|AR PL|UKai|UMing/i;
const JA = /[぀-ヿ一-鿿]/;

// 日本語の文字を含む要素ごとに、描画に使われたフォントの名前を集める
async function fontsUsed(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: false });
  const used = {};
  const walk = async n => {
    if (n.nodeType === 1 && (n.children || []).some(c => c.nodeType === 3 && JA.test(c.nodeValue))) {
      try {
        const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId: n.nodeId });
        const label = n.localName + (n.attributes && n.attributes.includes("id") ? "#" + n.attributes[n.attributes.indexOf("id") + 1] : "");
        for (const f of fonts) (used[f.familyName] = used[f.familyName] || new Set()).add(label);
      } catch (e) {}   // 表示されていない要素はフォントがない
    }
    for (const c of n.children || []) await walk(c);
  };
  await walk(root);
  await cdp.detach();
  return used;
}

test("画面の文字：漢字・かなが中国語のフォントで表示されない（各画面・受付モード）", async () => {
  const t = await h.open({ viewport: { width: 1366, height: 768 }, storage: { "prize-plus-v1-settings": { eventName: "第10回 骨董と海の抽選会" } } });
  const bad = [];
  const check = async where => {
    for (const [font, els] of Object.entries(await fontsUsed(t.page)))
      if (CHINESE.test(font)) bad.push(`${where}：${font}（${[...els].slice(0, 4).join(" ")}）`);
  };
  for (const v of ["draw", "prizes", "reception", "members", "data"]) {
    await t.page.evaluate(v => location.hash = v, v); await t.page.waitForTimeout(150);
    await check(v);
  }
  await t.page.evaluate(() => location.hash = "reception"); await t.page.waitForTimeout(150);
  await t.page.click("#kStart"); await t.page.waitForTimeout(200);
  await t.page.fill("#kName", "直子"); await t.page.click("#kForm button[type=submit]"); await t.page.waitForTimeout(300);
  await check("受付モード");
  assert.deepEqual(bad, []);
  // file:// では、開発者向けの機能（CDP）につなぐとブラウザが manifest を読みにいき、拒否されたというログが出る（テストの道具によるもので、ふだんは出ない）
  assert.deepEqual(t.errors.filter(e => !/manifest\.webmanifest/.test(e)), []);
  await t.close();
});

test("ルーレットの中の文字（つぎは・○位）：日本語のフォントで描く", async () => {
  const t = await h.open({ viewport: { width: 1366, height: 768 } });
  // ルーレットと同じフォントの指定で描いた字が、中国語のフォントで描いた字と同じ形にならないこと
  const r = await t.page.evaluate(() => {
    const jp = getComputedStyle(document.documentElement).getPropertyValue("--font-jp").trim().replace(/\s+/g, " ");
    const draw = font => { const c = document.createElement("canvas"); c.width = 420; c.height = 100; const x = c.getContext("2d"); if ("lang" in x) x.lang = "ja"; x.font = font; x.fillText("直骨海角つぎは位", 5, 70); return x.getImageData(0, 0, 420, 100).data.join(","); };
    const zh = draw('800 60px "WenQuanYi Zen Hei"');
    const zhAvailable = zh !== draw("800 60px NoSuchFont-xyz");   // 中国語のフォントがない環境では比べられない
    return { jp: !!jp, zhAvailable, same: draw(`800 60px "M PLUS Rounded 1c", ${jp}, sans-serif`) === zh };
  });
  assert.ok(r.jp, "--font-jp（日本語のフォントの並び）がない");
  if (r.zhAvailable) assert.equal(r.same, false, "ルーレットの文字が中国語のフォントで描かれている");
  assert.deepEqual(t.errors, []);
  await t.close();
});
