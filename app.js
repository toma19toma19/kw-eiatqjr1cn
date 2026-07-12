/* 銘柄ウォッチ フロントエンド
 * 方針:すべての数値にラベルを付け、「なぜ候補か」「何が起きたら売りか」を文章で示す。
 * - 表示は site/data/*.json(日次バッチが生成)
 * - 操作(選択/削除/テーマ登録)はタップ時点で受付表示、一覧反映は次回バッチ(§8-2)
 * - 仮想買値はタップ時点の表示価格を送る(§6-2)
 */
"use strict";

const cfg = {
  get token() { return localStorage.getItem("gh_token") || ""; },
  set token(v) { localStorage.setItem("gh_token", v); },
  get repo() { return localStorage.getItem("gh_repo") || ""; },
  set repo(v) { localStorage.setItem("gh_repo", v); },
};

const pending = {
  load() { return JSON.parse(localStorage.getItem("pending_ops") || "[]"); },
  add(op) {
    const l = this.load(); l.push({ ...op, at: Date.now() });
    localStorage.setItem("pending_ops", JSON.stringify(l.slice(-50)));
  },
  has(pred) { return this.load().some(pred); },
};

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 3500);
}

async function loadJSON(name) {
  try {
    const r = await fetch(`data/${name}?t=${Date.now()}`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function sendOp(title, payload) {
  if (!cfg.token || !cfg.repo) {
    openSettings();
    toast("初回のみ接続設定が必要です");
    return false;
  }
  const r = await fetch(`https://api.github.com/repos/${cfg.repo}/issues`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${cfg.token}`,
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title, body: JSON.stringify(payload), labels: ["op"] }),
  });
  if (!r.ok) { toast("送信に失敗しました。設定を確認してください"); return false; }
  pending.add(payload);
  return true;
}

// ---- 操作 ----
async function selectStock(code, name, module, price, theme) {
  const payload = { action: "select", code, name, module, theme: theme || null,
                    price, ts: new Date().toISOString() };
  if (await sendOp(`select ${code}`, payload)) {
    toast(`${name} を仮想買付リストに受け付けました(次回更新で反映)`);
    render();
  }
}

async function deletePosition(id, name) {
  if (!confirm(`${name} の追跡をやめますか?(記録は残ります)`)) return;
  if (await sendOp(`delete ${id}`, { action: "delete", id })) {
    toast("削除を受け付けました(次回更新で反映)");
  }
}

async function registerTheme(name, memo) {
  if (await sendOp(`theme ${name}`, { action: "theme", name, memo })) {
    toast(`テーマ「${name}」を受け付けました(次回更新で候補が出ます)`);
  }
}

// ---- 表示ヘルパ ----
const esc = s => String(s ?? "").replace(/[&<>"]/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = v => v == null ? "-" : (v * 100).toFixed(1) + "%";
const spct = v => v == null ? "-" : (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%";
const yen = v => v == null ? "-" : Number(v).toLocaleString("ja-JP",
  { maximumFractionDigits: 1 }) + "円";
const chartLink = code =>
  `<a class="link" href="https://finance.yahoo.co.jp/quote/${code}.T" target="_blank" rel="noopener">チャートを見る↗</a>`;

/** ラベル付きの数値(カード右上用) */
const kv = (label, valueHtml) =>
  `<div class="kv"><span class="k">${label}</span><span class="v">${valueHtml}</span></div>`;

function selBtn(code, name, module, price, theme) {
  const isPending = pending.has(o => o.action === "select" && o.code === code &&
    Date.now() - o.at < 86400000);
  if (isPending) return `<button class="select-btn" disabled>受付済み</button>`;
  const args = [code, name, module, price, theme || ""].map(x => JSON.stringify(x)).join(",");
  return `<button class="select-btn" onclick='selectStock(${args})'>この価格で仮想買付</button>`;
}

// ---- 長期保有タブ ----
// AI織り込み度分析の3分類(§3-3):並び順はバッチ側で反映済み
const AI_BADGE = {
  undervalued: ["ai-under", "AI分析:悲観が過剰(真の割安候補)"],
  uncertain: ["ai-uncertain", "AI分析:判定困難"],
  pending: ["ai-pending", "AI分析待ち(次回更新までに分析されます)"],
  trap: ["ai-trap", "AI分析:悲観が妥当(罠の疑い)"],
};

function aiBlock(r) {
  const ai = r.ai || { verdict: "pending" };
  const [cls, label] = AI_BADGE[ai.verdict] || AI_BADGE.pending;
  let html = `<div class="ai-verdict ${cls}"><b>${label}</b>
    ${ai.summary ? `<p>${esc(ai.summary)}</p>` : ""}</div>`;
  if (ai.pessimism || ai.validity || ai.policy_evidence || (ai.catalysts || []).length) {
    const policy = (ai.progressive || ai.doe)
      ? `宣言あり(${[ai.progressive ? "累進配当" : null, ai.doe ? "DOE" : null]
          .filter(Boolean).join("・")})`
      : "宣言は確認できず";
    html += `<details><summary>AI分析の詳細${ai.analyzed_on ? `(${esc(ai.analyzed_on)}時点)` : ""}</summary>
      <dl class="ai-detail">
        ${ai.pessimism ? `<dt>市場が織り込んでいる悲観の中身(なぜ安く放置されているか)</dt><dd>${esc(ai.pessimism)}</dd>` : ""}
        ${ai.validity ? `<dt>悲観は妥当か(利益の持続性・事業の将来性)</dt><dd>${esc(ai.validity)}</dd>` : ""}
        <dt>減配しにくい配当方針</dt><dd>${policy}${ai.policy_evidence ? `:${esc(ai.policy_evidence)}` : ""}</dd>
        ${(ai.catalysts || []).length ? `<dt>株価が見直されるきっかけ(確認できたもの)</dt>
          <dd><ul>${ai.catalysts.map(c => `<li>・${esc(c)}</li>`).join("")}</ul></dd>` : ""}
      </dl>
      <p class="note">この分析は判断材料です。買うか否かの最終判断はご自身で行ってください。</p>
    </details>`;
  }
  return html;
}

function renderLong(d) {
  document.getElementById("longThreshold").textContent =
    d?.threshold_yield ? pct(d.threshold_yield) : "-";
  const el = document.getElementById("longList");
  if (!d?.passed?.length) {
    el.innerHTML = `<p class="empty">現在、粗選別を通過した銘柄はありません</p>`; return;
  }
  el.innerHTML = d.passed.map(r => `
    <div class="card">
      <div class="head">
        <div><span class="name">${esc(r.name)}</span><span class="code">${esc(r.code)}</span>
          ${r.stock_type_bonus ? '<span class="badge">収益安定業種</span>' : ""}</div>
        ${kv("現在値", yen(r.price))}
      </div>
      ${aiBlock(r)}
      <p class="why">${esc(r.summary || "")}</p>
      <ul class="criteria">
        ${(r.criteria || []).map(c => `
          <li><span class="ok">✓</span> ${esc(c.label)}
            <b>${esc(c.value)}</b><span class="rule">(基準:${esc(c.rule)})</span></li>`).join("")}
      </ul>
      ${r.score != null && r.score_breakdown ? `
      <details><summary>スコア内訳 合計${r.score}点(上位30銘柄をAI分析の対象に選定)</summary>
        <ul class="criteria">
          <li>配当利回り(高いほど加点) <b>${r.score_breakdown.yield}</b>/40点</li>
          <li>自己資本比率(高いほど加点) <b>${r.score_breakdown.equity}</b>/30点</li>
          <li>割安度:PBR(低いほど加点) <b>${r.score_breakdown.pbr}</b>/15点</li>
          <li>割安度:PER(低いほど加点) <b>${r.score_breakdown.per}</b>/15点</li>
        </ul>
      </details>` : ""}
      <div class="row">${selBtn(r.code, r.name, "long", r.price)}${chartLink(r.code)}</div>
    </div>`).join("");
  document.getElementById("longInsufficient").innerHTML =
    (d.insufficient || []).map(r =>
      `<div class="card slim"><span class="name">${esc(r.name)}</span><span class="code">${esc(r.code)}</span>
       <span class="badge warn">判定材料が不足(上場間もない等)</span></div>`).join("") ||
    `<p class="empty">なし</p>`;
}

// ---- 短期売買タブ ----
function renderShort(d) {
  const k = document.getElementById("kessanList");
  if (!d?.kessan?.length) {
    k.innerHTML = `<p class="empty">現在、決算プレイの条件を満たす銘柄はありません</p>`;
  } else {
    k.innerHTML = d.kessan.map(r => `
      <div class="card">
        <div class="head">
          <div><span class="name">${esc(r.name)}</span><span class="code">${esc(r.code)}</span>
            <span class="badge">決算発表 ${esc(r.announce_date)}${
              r.days_to_announce != null ? `(あと${r.days_to_announce}日)` : ""}</span></div>
          ${kv("現在値", yen(r.price))}
        </div>
        <p class="why">${esc(r.summary || "")}</p>
        <ul class="criteria">
          <li><span class="ok">✓</span> 通期予想に対する進捗
            <b>${pct(r.progress)}</b><span class="rule">(基準:${pct(r.threshold_a)}以上)</span></li>
          <li><span class="ok">✓</span> 例年の同時期との比較
            <b>${r.prior_avg != null ? pct(r.prior_avg) + " → 今期" + pct(r.progress) : "-"}</b>
            <span class="rule">(基準:例年平均+10pt以上)</span></li>
        </ul>
        <p class="note">買った場合の売りルール:+20%利確 / −8%損切り / 決算発表の3営業日後に自動クローズ</p>
        <div class="row">${selBtn(r.code, r.name, "kessan", r.price)}${chartLink(r.code)}</div>
      </div>`).join("");
  }
  const tl = document.getElementById("themeList");
  const themes = d?.themes || {};
  const names = Object.keys(themes);
  if (!names.length) {
    tl.innerHTML = `<p class="empty">テーマ未登録です。上のフォームから登録すると、翌営業日に関連銘柄が「まだ買われていない順」で並びます</p>`;
    return;
  }
  tl.innerHTML = names.map(t => `
    <h2>テーマ「${esc(t)}」:まだ買われていない順 上位${themes[t].length}銘柄</h2>
    ${themes[t].map((r, i) => `
      <div class="card">
        <div class="head">
          <div><span class="rank">${i + 1}位</span> <span class="name">${esc(r.name)}</span><span class="code">${esc(r.code)}</span>
            ${r.hot_flag ? '<span class="badge hot">初動終了の疑い</span>' : ""}</div>
          ${kv("現在値", yen(r.price))}
        </div>
        <ul class="points">${(r.points || []).map(p => {
          const warn = p.startsWith("注意") || p.includes("不足") || p.includes("未確認");
          return `<li class="${warn ? "warn" : ""}">${warn ? "△" : "○"} ${esc(p)}</li>`;
        }).join("")}</ul>
        <p class="note">テーマとの関連:${esc(r.reason)}</p>
        <details><summary>スコア内訳 合計${r.score}点</summary>
          <ul class="criteria">
            <li>未物色度(まだ買われていないか) <b>${r.breakdown.untouched}</b>/40点</li>
            <li>財務健全性 <b>${r.breakdown.financial}</b>/20点</li>
            <li>業績の勢い <b>${r.breakdown.funda}</b>/20点</li>
            <li>流動性(売買のしやすさ) <b>${r.breakdown.liquidity}</b>/10点</li>
            <li>テーマ純度(本業への比重) <b>${r.breakdown.purity}</b>/10点</li>
          </ul>
        </details>
        <p class="note">買った場合の売りルール:+20%利確 / −8%損切り / 60営業日で自動クローズ</p>
        <div class="row">${selBtn(r.code, r.name, "theme", r.price, t)}${chartLink(r.code)}</div>
      </div>`).join("")}`).join("");
}

// ---- 仮想保有タブ ----
function exitBox(p) {
  const e = p.exit || {};
  if (p.status === "closed") {
    return `<div class="exitbox closed">
      ${esc(p.close_date)} に <b>${esc(p.close_reason)}</b> で自動クローズ済み
      (確定損益 <b class="${(p.return ?? 0) >= 0 ? "pos" : "neg"}">${spct(p.return)}</b>)
    </div>`;
  }
  if (e.type === "long") {
    const trig = e.triggered || [];
    return `<div class="exitbox">
      <div class="exit-title">売り条件(ご自身で判断する3つだけ)</div>
      <ul>${(e.conditions || []).map(c => `<li>・${esc(c)}</li>`).join("")}</ul>
      ${trig.length
        ? trig.map(a => `<div class="alert-line">⚠ 該当あり:${esc(a)}</div>`).join("")
        : `<div class="okline">現在:該当なし → 配当を受け取りながら保有継続でOK</div>`}
    </div>`;
  }
  const lines = [];
  if (e.profit_price != null) {
    lines.push(`・利確ライン <b>${yen(e.profit_price)}</b>` +
      (e.profit_gap != null ? `(現在値からあと${spct(e.profit_gap)})` : ""));
  }
  if (e.loss_price != null) {
    lines.push(`・損切りライン <b>${yen(e.loss_price)}</b>` +
      (e.loss_gap != null ? `(現在値から${spct(e.loss_gap)})` : ""));
  }
  if (e.deadline_text) {
    lines.push(`・期限 ${esc(e.deadline_text)}`);
  } else if (e.days_left != null) {
    lines.push(`・期限 あと<b>${e.days_left}営業日</b>(${e.days_used}/${e.days_max}日経過)で自動クローズ`);
  }
  return `<div class="exitbox">
    <div class="exit-title">売りライン(終値が到達したら自動クローズ+お知らせ)</div>
    <ul>${lines.map(l => `<li>${l}</li>`).join("")}</ul>
  </div>`;
}

function renderHoldings(d) {
  const n = document.getElementById("notifications");
  n.innerHTML = (d?.notifications?.length)
    ? d.notifications.map(x => `<div class="notif ${x.type}">
        <div class="d">${esc(x.date)}${x.type === "record" ? " 売買判断のお知らせ" : " 注意情報"}</div>
        ${esc(x.message)}</div>`).join("")
    : `<p class="empty">お知らせはありません</p>`;

  const el = document.getElementById("holdingsList");
  const ps = d?.positions || [];
  if (!ps.length) {
    el.innerHTML = `<p class="empty">仮想保有はありません。候補タブで「この価格で仮想買付」を押すとここに追加されます</p>`;
    return;
  }
  // メインラベルは保有目的(長期保有/短期売買)のみ。テーマ名はサブラベルで補足
  const purpose = m => m === "long" ? "長期保有" : "短期売買";
  el.innerHTML = ps.map(p => `
    <div class="card${p.status === "closed" ? " done" : ""}">
      <div class="head">
        <div><span class="name">${esc(p.name)}</span><span class="code">${esc(p.code)}</span>
          <span class="badge ${p.module === "long" ? "purpose-long" : "purpose-short"}">${purpose(p.module)}</span>
          ${p.theme ? `<span class="badge sub">テーマ:${esc(p.theme)}</span>` : ""}</div>
        ${kv("損益", `<span class="${(p.return ?? 0) >= 0 ? "pos" : "neg"}">${spct(p.return)}</span>`)}
      </div>
      <div class="metrics">
        <span>仮想買値 <b>${yen(p.entry_price)}</b>(${esc(p.entry_date)}に選択)</span>
        <span>現在値 <b>${yen(p.current_price)}</b></span>
      </div>
      ${exitBox(p)}
      ${(p.alerts || []).map(a => `<div class="alert-line">⚠ ${esc(a)}</div>`).join("")}
      <div class="row">
        ${p.status === "open"
          ? `<button class="del-btn" onclick='deletePosition(${JSON.stringify(p.id)},${JSON.stringify(p.name)})'>追跡をやめる</button>`
          : ""}
        ${chartLink(p.code)}
      </div>
    </div>`).join("");
}

// ---- 初期化 ----
async function render() {
  const [meta, long_, short_, hold] = await Promise.all([
    loadJSON("meta.json"), loadJSON("long.json"),
    loadJSON("short.json"), loadJSON("holdings.json")]);
  document.getElementById("updated").textContent =
    meta?.updated ? `更新 ${meta.updated}` : "";
  renderLong(long_); renderShort(short_); renderHoldings(hold);
}

document.getElementById("tabs").addEventListener("click", e => {
  const btn = e.target.closest(".tab"); if (!btn) return;
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b === btn));
  document.querySelectorAll(".tab-pane").forEach(p =>
    p.classList.toggle("active", p.id === `tab-${btn.dataset.tab}`));
});

document.getElementById("themeForm").addEventListener("submit", e => {
  e.preventDefault();
  const name = document.getElementById("themeName").value.trim();
  const memo = document.getElementById("themeMemo").value.trim();
  if (name) registerTheme(name, memo);
  e.target.reset();
});

function openSettings() {
  document.getElementById("cfgToken").value = cfg.token;
  document.getElementById("cfgRepo").value = cfg.repo;
  document.getElementById("settingsModal").classList.remove("hidden");
}
document.getElementById("settingsBtn").onclick = openSettings;
document.getElementById("closeSettings").onclick = () =>
  document.getElementById("settingsModal").classList.add("hidden");
document.getElementById("saveSettings").onclick = () => {
  cfg.token = document.getElementById("cfgToken").value.trim();
  cfg.repo = document.getElementById("cfgRepo").value.trim();
  document.getElementById("settingsModal").classList.add("hidden");
  toast("設定を保存しました");
};

render();
