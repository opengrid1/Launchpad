/* Creator card shared by the token page and the takeover page: who runs a coin, when they last acted,
   creator tools (edit info, transfer, "still here"), accepting an offered role, and the community takeover
   (propose, outbid, cancel, execute). Uses CHAIN.equo (equo.js) and the core.js globals. */
window.SPC = (function () {
  const EQ = () => window.CHAIN && CHAIN.equo;
  const now = () => Math.floor(Date.now() / 1000);
  const lc = (a) => String(a || "").toLowerCase();
  const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a || "").trim());
  const dur = (s) => { s = Math.max(0, s); const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600); return d ? `${d}d${h ? " " + h + "h" : ""}` : h ? `${h}h` : `${Math.max(1, Math.floor(s / 60))}m`; };
  const date = (t) => new Date(t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const who = (a) => `<span class="w"><span class="av">${SP.avatar(a, 18)}</span><a href="/profile?a=${a}">${shortAddr(cs(a))}</a>${SP.W.connected && SP.W.address === lc(a) ? '<span class="tag mint">you</span>' : ""}</span>`;
  const stakePct = (st) => (Number(st) / 1e27 * 100).toFixed(st % (10n ** 25n) ? 2 : 0);

  /** status of a coin's creator and takeover, from chain */
  async function status(token) {
    const [i, t] = await Promise.all([EQ().creatorInfo(token), EQ().chainNow()]);
    const idleFor = t - i.activeAt, opensAt = i.activeAt + EQ().IDLE;
    let stage = "active";
    if (i.takeover) stage = t >= i.takeover.startedAt + EQ().DELAY ? (i.activeAt >= i.takeover.startedAt ? "blocked" : "ready") : "running";
    else if (t >= opensAt) stage = "open";
    return { ...i, idleFor, opensAt, stage, now: t };
  }

  async function run(btn, fn, ok, after) {
    if (!SP.W.connected) { SP.W.connect(); return; }
    if (!SP.W.chainOk) { SP.W.switchChain().catch(() => {}); return; }
    const t = btn.innerHTML; btn.disabled = true; btn.textContent = "Confirm in wallet…";
    try { await fn(); SP.toast(ok); if (after) after(); } catch (e) { SP.toast(SP.errMsg(e), "err"); } finally { btn.disabled = false; btn.innerHTML = t; }
  }

  function editDialog(x, done) {
    const ov = SP.dialog("Edit coin info", `<label class="lbl">Description</label><textarea class="inp" id="ce-desc" maxlength="280" style="min-height:90px">${esc(x.desc || "")}</textarea>
      <label class="lbl">Website</label><input class="inp" id="ce-web" value="${esc((x.links && x.links.web) || "")}" placeholder="yourweb.com">
      <label class="lbl">X</label><input class="inp" id="ce-x" value="${esc((x.links && x.links.x) || "")}" placeholder="x.com/you">
      <label class="lbl">Telegram</label><input class="inp" id="ce-tg" value="${esc((x.links && x.links.tg) || "")}" placeholder="t.me/you">
      <p class="hint">The logo stays as it is. Saved on chain; counts as creator activity.</p><button class="btn pri block" id="ce-save" style="margin-top:12px">Save</button>`);
    const link = (v) => { v = String(v || "").trim(); if (!v) return ""; if (!/^https?:\/\//i.test(v)) v = "https://" + v; return v.slice(0, 200); };
    ov.querySelector("#ce-save").onclick = (e) => {
      const meta = { description: ov.querySelector("#ce-desc").value.trim().slice(0, 280) };
      if (x.img) meta.image = x.img;
      const w = link(ov.querySelector("#ce-web").value), xx = link(ov.querySelector("#ce-x").value), tg = link(ov.querySelector("#ce-tg").value);
      if (w) meta.website = w; if (xx) meta.x = xx; if (tg) meta.telegram = tg;
      run(e.currentTarget, () => EQ().setMetadata(x.addr, JSON.stringify(meta)), "Coin info saved", () => { ov.remove(); done && done(); });
    };
  }

  function transferDialog(x, done) {
    const ov = SP.dialog("Transfer creator role", `<p class="hint" style="margin:0 0 10px">The new creator gets future creator fees and these tools. They must accept. Fees you are owed are paid to you when they do.</p>
      <label class="lbl">New creator wallet</label><input class="inp" id="ct-to" placeholder="0x…"><p class="err" id="ct-err"></p><button class="btn pri block" id="ct-go" style="margin-top:12px">Offer the role</button>`);
    ov.querySelector("#ct-go").onclick = (e) => {
      const to = ov.querySelector("#ct-to").value.trim();
      if (!isAddr(to)) { ov.querySelector("#ct-err").textContent = "Enter a wallet address"; return; }
      run(e.currentTarget, () => EQ().transferCreator(x.addr, to), "Offer sent. The new creator must accept.", () => { ov.remove(); done && done(); });
    };
  }

  async function proposeDialog(x, st, done) {
    const min = st.takeover ? BigInt(st.takeover.stake) + 10n ** 24n : EQ().STAKE;
    let bal = 0n; try { bal = await EQ().balanceOf(x.addr, SP.W.address); } catch {}
    const minWhole = Number(min / 10n ** 18n);
    const ov = SP.dialog(st.takeover ? "Outbid the takeover" : "Propose a takeover", `<p class="hint" style="margin:0 0 10px">${st.takeover ? "A bigger stake replaces the running proposal and restarts the 7-day clock. The earlier stake goes back to its owner." : "The creator has been idle for 30 days. Lock coins to propose a new creator. If the creator does nothing for 7 days, anyone can execute it."} Your stake always comes back.</p>
      <label class="lbl">New creator wallet</label><input class="inp" id="tp-to" value="${SP.W.address ? cs(SP.W.address) : ""}">
      <label class="lbl">Stake, $${esc(x.t)}</label><input class="inp num" id="tp-amt" type="number" min="${minWhole}" step="1" value="${minWhole}">
      <p class="hint">At least ${fmtAmt(minWhole)} (${stakePct(min)}% of supply). You hold ${fmtAmt(Number(bal) / 1e18)}.</p><p class="err" id="tp-err"></p>
      <button class="btn pri block" id="tp-go" style="margin-top:12px">${st.takeover ? "Outbid" : "Propose"}</button>`);
    ov.querySelector("#tp-go").onclick = (e) => {
      const to = ov.querySelector("#tp-to").value.trim(); const amt = Math.floor(parseFloat(ov.querySelector("#tp-amt").value) || 0);
      const stake = BigInt(amt) * 10n ** 18n, err = ov.querySelector("#tp-err");
      if (!isAddr(to)) { err.textContent = "Enter the new creator's wallet"; return; }
      if (stake < min) { err.textContent = `Stake at least ${fmtAmt(minWhole)}`; return; }
      if (stake > bal) { err.textContent = `You hold ${fmtAmt(Number(bal) / 1e18)}`; return; }
      run(e.currentTarget, () => EQ().proposeTakeover(x.addr, to, stake), "Takeover proposed", () => { ov.remove(); done && done(); });
    };
  }

  /** render the creator card for coin `x` into `el`; `refresh` re-renders after an action */
  async function render(el, x, refresh) {
    if (!EQ()) { el.innerHTML = '<div class="empty" style="padding:18px">Unavailable</div>'; return; }
    let st; try { st = await status(x.addr); } catch (e) { el.innerHTML = `<div class="empty" style="padding:18px">Could not load: ${esc(SP.errMsg(e))}</div>`; return; }
    const me = SP.W.connected ? SP.W.address : "", isCreator = me && me === st.creator, isPending = me && me === st.pending;
    const t = st.takeover, ttl = t ? t.startedAt + EQ().DELAY - st.now : 0;
    const rows = [`<div class="kv"><span>Creator</span><b>${who(st.creator)}</b></div>`, `<div class="kv"><span>Last active</span><b>${dur(st.idleFor)} ago</b></div>`];
    if (st.pending) rows.push(`<div class="kv"><span>Offered to</span><b>${who(st.pending)}</b></div>`);
    let tk = "";
    if (st.stage === "active") tk = `<p class="hint">Takeover opens ${date(st.opensAt)} if the creator stays idle.</p>`;
    else if (st.stage === "open") tk = `<div class="notice" style="margin-top:10px">${ic("users")}<span>Open for takeover: the creator has been idle for ${dur(st.idleFor)}.</span></div>`;
    else {
      tk = `<div class="kv"><span>Takeover by</span><b>${who(t.proposer)}</b></div><div class="kv"><span>New creator</span><b>${who(t.newCreator)}</b></div><div class="kv"><span>Stake</span><b>${fmtAmt(Number(t.stake) / 1e18)} <span class="muted">${stakePct(BigInt(t.stake))}%</span></b></div>`
        + `<div class="kv"><span>${st.stage === "running" ? "Executable in" : "Status"}</span><b>${st.stage === "running" ? dur(ttl) : st.stage === "ready" ? '<span class="up">Ready to execute</span>' : '<span class="dn">Blocked: the creator came back</span>'}</b></div>`;
    }
    const acts = [];
    if (isPending) acts.push(`<button class="btn pri block" data-c="accept">Accept the creator role</button>`);
    if (isCreator) {
      acts.push(`<div class="row" style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button class="btn" data-c="edit">${ic("info")}Edit info</button><button class="btn" data-c="transfer">${ic("swap")}Transfer</button></div>`);
      acts.push(`<button class="btn line block" data-c="poke">${ic("check")}I'm still here</button>`);
      if (st.pending) acts.push(`<button class="btn ghost block" data-c="untransfer">Cancel the offer</button>`);
      if (t) acts.push(`<button class="btn block" data-c="cancel" style="border-color:var(--dn);color:var(--dn)">Cancel the takeover</button>`);
    } else {
      if (st.stage === "open" || (st.stage === "running" && me !== t.proposer)) acts.push(`<button class="btn ${t ? "" : "pri"} block" data-c="propose">${t ? "Outbid with a bigger stake" : "Propose a takeover"}</button>`);
      if (st.stage === "ready") acts.push(`<button class="btn pri block" data-c="execute">Execute the takeover</button>`);
      if (t && me === t.proposer) acts.push(`<button class="btn ghost block" data-c="cancel">Withdraw my proposal</button>`);
    }
    el.innerHTML = rows.join("") + tk + (acts.length ? `<div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">${acts.join("")}</div>` : "")
      + (isCreator ? `<p class="hint" style="margin-top:10px">Any action here resets the 30-day takeover clock.</p>` : "");
    const R = () => (refresh ? refresh() : render(el, x, refresh));
    el.querySelectorAll("[data-c]").forEach((b) => (b.onclick = (e) => {
      const c = b.dataset.c, B = e.currentTarget;
      if (c === "edit") return editDialog(x, R);
      if (c === "transfer") return transferDialog(x, R);
      if (c === "propose") return proposeDialog(x, st, R);
      if (c === "accept") return run(B, () => EQ().acceptCreator(x.addr), "You are the creator now", R);
      if (c === "poke") return run(B, () => EQ().poke(x.addr), "Marked as active", R);
      if (c === "untransfer") return run(B, () => EQ().transferCreator(x.addr, ""), "Offer cancelled", R);
      if (c === "cancel") return run(B, () => EQ().cancelTakeover(x.addr), "Takeover cancelled", R);
      if (c === "execute") return run(B, () => EQ().executeTakeover(x.addr), "Takeover executed", R);
    }));
    return st;
  }

  return { status, render, dur, who };
})();
