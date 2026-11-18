// 公平性：当選処理を数千回くり返し、番号の出方に偏りがないかをカイ二乗検定で確かめる
// 画面の演出は「動きを減らす」設定と時計の早送りで飛ばす。回数は FAIR_ROUNDS で変えられる（既定 1000回×3本）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const S = "prize-plus-v1";
test.after(h.teardown);

const ROUNDS = +(process.env.FAIR_ROUNDS || 1000);
const PEOPLE = 10, PRIZES = 3;
const CHI2_CRIT_DF9 = 27.877;   // 自由度9・有意水準0.1%

// ページの中で抽選をくり返す。演出の時間は performance.now をずらして飛ばす（抽選の計算そのものは変えない）
// 毎回、針の先（真上）のマスの色が当選番号の色（2色のどちらか＋光らせる白）と合うかも確かめる
function runRounds({ rounds, people, prizes, pointerChecks }) {
  const COLORS = [["#ff4d6d", "#e0304f"], ["#ff8a3d", "#ec6c1b"], ["#ffd23f", "#f0b417"], ["#a8e04a", "#86c22a"], ["#2fd27a", "#1fae62"],
    ["#2fd6c8", "#16b3a6"], ["#3fa7ff", "#1f84e0"], ["#8a86ff", "#6763ec"], ["#b56bff", "#9447e8"], ["#ff6bd0", "#e548b2"]];
  const hex = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
  const group = n => Math.min(9, Math.floor((n - 1) / Math.ceil(people / 10)));
  function pointerGroup() {
    const c = document.getElementById("wheel"), x = c.getContext("2d");
    const S = c.width, R = S / 2 - S * 0.06;
    const d4 = x.getImageData(Math.round(S / 2), Math.round(S / 2 - R * 0.65), 1, 1).data;
    if (d4[3] === 0) return null;   // 大きさが変わって描き直す前の1フレーム（まだ何も描かれていない）
    const px = Array.from(d4).slice(0, 3);
    const dists = COLORS.map(cols => {
      let d = Infinity;
      for (const col of cols) for (let a = 0; a <= 0.75; a += 0.01) d = Math.min(d, Math.hypot(...hex(col).map((v, i) => v + (255 - v) * a - px[i])));
      return d;
    });
    return dists.indexOf(Math.min(...dists));
  }
  const origNow = performance.now.bind(performance);
  performance.now = () => origNow() - 1e7;
  const $ = id => document.getElementById(id);
  const tick = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  return (async () => {
    const counts = Array.from({ length: prizes }, () => Array(people + 1).fill(0));
    let checked = 0, ok = 0, dupInRound = 0, outOfRange = 0;
    for (let r = 0; r < rounds; r++) {
      const seen = new Set();
      for (let k = 0; k < prizes; k++) {
        $("spinBtn").click();
        while ($("reveal").hidden) await tick();
        const num = +$("bigNum").textContent;
        if (!(num >= 1 && num <= people)) outOfRange++;
        if (seen.has(num)) dupInRound++;
        seen.add(num); counts[k][num]++;
        if (checked < pointerChecks) {
          let g = null;
          for (let w = 0; w < 10 && g === null; w++) { await tick(); g = pointerGroup(); }
          checked++; if (g === group(num)) ok++;
        }
        document.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape", bubbles: true }));
      }
      $("result").hidden = true; $("resetBtn").click(); $("doReset").click();
    }
    return { counts, checked, ok, dupInRound, outOfRange };
  })();
}

test(`当選番号の偏り（${ROUNDS}回 × ${PRIZES}本、${PEOPLE}人）`, { timeout: 30 * 60 * 1000 }, async () => {
  const t = await h.open({ reducedMotion: true, viewport: { width: 1366, height: 768 }, storage: { [S]: { prizes: h.makePrizes(PRIZES), people: PEOPLE, order2: "top" }, [S + "-sound"]: "off" } });
  const res = await t.page.evaluate(runRounds, { rounds: ROUNDS, people: PEOPLE, prizes: PRIZES, pointerChecks: 300 });
  assert.equal(res.outOfRange, 0);
  assert.equal(res.dupInRound, 0, "同じ回で同じ番号が2回当たった");
  const expected = ROUNDS / PEOPLE;
  res.counts.forEach((c, k) => {
    const chi2 = c.slice(1).reduce((a, o) => a + (o - expected) ** 2 / expected, 0);
    console.log(`  ${k + 1}本目: ${c.slice(1).join(" ")}  χ²=${chi2.toFixed(2)}`);
    assert.ok(chi2 < CHI2_CRIT_DF9, `${k + 1}本目の出方に偏り χ²=${chi2}`);
  });
  console.log(`  針の下の色が当選番号と一致: ${res.ok}/${res.checked}`);
  assert.equal(res.ok, res.checked);
  assert.deepEqual(t.errors, []);
  await t.close();
});

test("乱数は crypto.getRandomValues を使い、Math.random を抽選に使わない", async () => {
  const t = await h.open({ clock: true, reducedMotion: true, storage: { [S]: { prizes: h.makePrizes(2), people: 10 } } });
  await t.page.evaluate(() => {
    window.__cryptoCalls = 0;
    const orig = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = a => { window.__cryptoCalls++; return orig(a); };
    Math.random = () => { throw new Error("Math.random が呼ばれた"); };
  });
  const sound = await t.page.textContent("#soundBtn");
  if (sound.includes("音あり")) await t.page.click("#soundBtn");   // 残響の作成（音のみ）で Math.random を使うので、音を切って確かめる
  await h.spinOnce(t.page);
  assert.ok(await t.page.evaluate(() => window.__cryptoCalls) > 0);
  assert.deepEqual(t.errors, []);
  await t.close();
});
