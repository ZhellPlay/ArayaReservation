import {
    db, auth, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, limit, onSnapshot, serverTimestamp,
    GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, writeBatch
} from "./fb.js";
import {
    $, $$, esc, toast, modal, confirmBox, promptBox, setBusy, copyText, icon, rupiah, fmtNum, parseNum, normWA, randSecret, genKode, lookupId, normKode,
    witaDate, witaTime, witaDateTimeInput, fromDateTimeInput, addDays, fmtDate, fmtDT, tsMs, now, syncClock, STATUS, HOLDING, pill, effStatus, getEndMs,
    mergeSettings, roomCfg, calcPrice, fillTpl, waLink, bookingLink, siteLink, startBackground
} from "./lib.js";
import { applyTx } from "./avail.js";
import { renderSettings } from "./admin-settings.js";

const H = 3600000, root = $("#root");
export const S = { st: mergeSettings(null), qris: {}, bookings: [], byBid: new Map(), tab: "inbox", f: { lokasi: "ALL", status: "AKTIF", day: "ALL", sort: "baru", q: "" }, hist: 3, dirty: false, pendingTab: null };
let unsubB = null, firstSnap = true, scanStream = null, scanStarting = false, sweepTimer = null;

const bufMs = () => (S.st.bufferMin || 0) * 60000;
const eff = b => effStatus(b, S.st);
const GRACE = 10 * 60000;
const alive = bid => {
    const b = S.byBid.get(bid); if (!b) return false;
    return ["MENUNGGU_VERIFIKASI", "TERKONFIRMASI", "CHECKED_IN"].includes(b.status) || (b.status === "MENUNGGU_BAYAR" && (b.payDeadline || 0) + GRACE > now());
};
const rangeOf = b => ({ lokasi: b.lokasi, room: b.room, s: b.startMs, e: b.endMs, bid: b.bid });
const kindOf = (b, status = b.status) => status === "MENUNGGU_BAYAR" ? "hold" : b.tipe === "WALKIN" ? "walkin" : b.tipe === "BLOK" ? "block" : "booked";
const addOf = (b, status = b.status, deadline = b.payDeadline) => { const k = kindOf(b, status), a = { ...rangeOf(b), k }; if (k === "hold") a.until = (deadline || now()) + GRACE; return a; };
const refOf = b => doc(db, "bookings", b.id);
const rangeTxt = b => {
    if (b.status === "CHECKED_IN" && b.checkedInAt) return `${witaTime(b.checkedInAt)}–${witaTime(getEndMs(b))}`;
    return `${b.jamMulai}–${witaTime(b.endMs)}`;
};
const isOpen = s => ["PENDING", "MENUNGGU_BAYAR", "MENUNGGU_VERIFIKASI", "TERKONFIRMASI", "CHECKED_IN"].includes(s);

window.addEventListener("beforeunload", (e) => {
    if (S.dirty) { e.preventDefault(); e.returnValue = ""; }
});

function beep() {
    try {
        const c = new (window.AudioContext || window.webkitAudioContext)();
        const o1 = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain();
        o1.type = "triangle";
        o2.type = "sawtooth";
        o1.connect(g); o2.connect(g); g.connect(c.destination);
        o1.frequency.value = 880;
        o2.frequency.value = 1760;
        g.gain.setValueAtTime(0.6, c.currentTime);
        g.gain.exponentialRampToValueAtTime(0.01, c.currentTime + 0.8);
        o1.start(); o2.start();
        setTimeout(() => { o1.stop(); o2.stop(); c.close(); }, 800);
    } catch (e) { }
}

function showLogin(msg = "") {
    root.innerHTML = `<div class="panel login-box"><h3 style="justify-content:center">${icon("lock")} Khusus Admin</h3><p class="muted">${esc(msg) || "Masuk dengan akun Google admin."}</p>
    <button class="btn btn-save btn-block" id="loginBtn">${icon("login")} Masuk dengan Google</button></div>`;
    $("#loginBtn").onclick = async () => { try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch (e) { toast("Login dibatalkan / gagal: " + (e.code || e.message), "error"); } };
}

onAuthStateChanged(auth, async user => {
    if (!user) { stopApp(); return showLogin(); }
    try { await getDocs(query(collection(db, "bookings"), limit(1))); }
    catch (e) {
        if (e.code === "permission-denied") { await signOut(auth); return showLogin(`Akun ${user.email} bukan admin.`); }
        return showLogin("Gagal memeriksa akses: " + (e.code || e.message));
    }
    startApp(user);
});

function stopApp() { if (unsubB) unsubB(); unsubB = null; clearInterval(sweepTimer); sweepTimer = null; stopScan(); }

let bgStarted = false;

async function startApp(user) {
    stopApp();
    if (!bgStarted) { startBackground(); bgStarted = true; }
    syncClock();
    try { const s = await getDoc(doc(db, "config", "settings")); if (s.exists()) S.st = mergeSettings(s.data()); else S.needSeed = true; } catch (e) { }
    try { const s = await getDoc(doc(db, "config", "qris")); if (s.exists()) S.qris = s.data(); } catch (e) { }

    root.innerHTML = `<div class="admin-bar">
      <div class="admin-user">
        <span class="material-icons-round">account_circle</span>
        <span class="admin-email">${esc(user.email)}</span>
      </div>
      <div class="admin-actions">
        <button class="btn btn-save" id="addBtn">${icon("add", 16)} Walk-in</button>
        <button class="btn btn-ghost" id="outBtn">${icon("logout", 16)}</button>
      </div>
    </div>
      ${S.needSeed ? `<div class="banner warn">${icon("settings")}<span>Pengaturan belum disimpan. Buka tab <b>Pengaturan</b>, isi tarif &amp; QRIS, lalu Simpan.</span></div>` : ""}
      <div class="tabs" id="tabs"></div><div id="tools"></div><div id="body"></div>`;

    $("#outBtn").onclick = () => signOut(auth);
    $("#addBtn").onclick = () => manualModal();
    $("#body").addEventListener("click", onBodyClick);
    setTab(S.needSeed ? "settings" : "inbox");
    subscribe();
    sweepTimer = setInterval(() => { if (!document.hidden) { sweep(); if (["inbox", "list"].includes(S.tab)) renderBody(); } }, 60000);
}

function subscribe() {
    if (unsubB) unsubB(); firstSnap = true;
    unsubB = onSnapshot(query(collection(db, "bookings"), where("endMs", ">=", now() - S.hist * 86400000)), snap => {
        S.bookings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        S.byBid = new Map(S.bookings.map(b => [b.bid, b]));
        if (!firstSnap) snap.docChanges().forEach(c => { if (c.type === "added" && c.doc.data().status === "PENDING" && !c.doc.metadata.hasPendingWrites) { beep(); toast("Permintaan baru: " + c.doc.data().nama, "info"); } });
        firstSnap = false; renderTabs(); if (!["settings", "scan"].includes(S.tab)) renderBody(); else if (S.tab === "scan") renderScanList();
        setTimeout(sweep, 1500);
    }, e => toast("Gagal memuat data: " + (e.code || e.message), "error"));
}

const TABS = [["inbox", "inbox", "Perlu Tindakan"], ["list", "list_alt", "Semua Booking"], ["scan", "qr_code_scanner", "Check-in"], ["settings", "settings", "Pengaturan"]];
const inboxItems = () => S.bookings.filter(b => locOk(b) && ["PENDING", "MENUNGGU_VERIFIKASI"].includes(eff(b)));
const locOk = b => S.f.lokasi === "ALL" || b.lokasi === S.f.lokasi;

function renderTabs() {
    const n = inboxItems().length;
    $("#tabs").innerHTML = TABS.map(([k, ic, l]) => `<button class="tab ${S.tab === k ? "on" : ""}" data-tab="${k}">${icon(ic, 18)} ${l}${k === "inbox" && n ? `<span class="badge">${n}</span>` : ""}</button>`).join("");
    $$("[data-tab]").forEach(b => b.onclick = () => setTab(b.dataset.tab));
    document.title = (n ? `(${n}) ` : "") + "ARAYA Admin";
}

function setTab(t) {
    if (S.tab === "settings" && t !== "settings" && S.dirty) {
        S.pendingTab = t;
        const m = modal(`
            <div class="modal-icon" style="background:var(--warning-soft); color:var(--warning); border-color:var(--warning-border)"><span class="material-icons-round">warning</span></div>
            <h3>Perubahan Belum Disimpan</h3>
            <p>Kamu memiliki perubahan pengaturan yang belum disimpan. Apa yang ingin kamu lakukan?</p>
            <div class="modal-actions" style="flex-direction:column; gap:8px">
                <button class="btn btn-save" id="btnSave">Simpan Pengaturan</button>
                <button class="btn btn-ghost" id="btnDiscard">Tinggalkan tanpa simpan</button>
            </div>
        `, { sticky: true, wide: false });
        $("#btnDiscard", m.el).onclick = () => {
            S.dirty = false;
            S.pendingTab = null;
            m.close();
            setTab(t);
        };
        $("#btnSave", m.el).onclick = () => {
            m.close();
            document.getElementById("setSave")?.click();
        };
        return;
    }

    if (S.tab === "scan" && t !== "scan") stopScan();
    S.tab = t; renderTabs();
    const tools = $("#tools");

    let extra = "";
    if (t === "list") {
        const hasFilter = S.f.status !== "AKTIF" || S.f.day !== "ALL" || S.f.sort !== "baru" || S.f.lokasi !== "ALL";
        extra = `<input id="fQ" placeholder="Cari nama / WA / kode" value="${esc(S.f.q)}">
          <button class="btn btn-ghost ${hasFilter ? 'filter-active' : ''}" id="btnFilter" title="Filter & Urutkan">${icon("tune", 18)}</button>`;
    }

    tools.innerHTML = t === "settings" || t === "scan" ? "" : `<div class="filters">${extra}</div>`;

    $("#fQ")?.addEventListener("input", e => { S.f.q = e.target.value; renderBody(); });
    $("#btnFilter")?.addEventListener("click", filterModal);

    if (t === "settings") renderSettings($("#body"), S, { toast, reload: async () => { const s = await getDoc(doc(db, "config", "settings")); if (s.exists()) S.st = mergeSettings(s.data()); }, exportCsv, cleanup, switchTab: setTab, resetAllData });
    else if (t === "scan") renderScan(); else renderBody();
}

function filterModal() {
    const f = S.f;
    const m = modal(`<h3>${icon("tune")} Filter & Urutkan</h3>
        <div class="form-grid" style="grid-template-columns: 1fr; gap:16px; margin-top:20px;">
            <div class="form-group"><label>Cabang</label><select id="mfLokasi">
                <option value="ALL" ${f.lokasi === "ALL" ? "selected" : ""}>Semua Cabang</option>
                ${S.st.lokasi.map(l => `<option value="${esc(l)}" ${f.lokasi === l ? "selected" : ""}>${esc(l)}</option>`).join("")}
            </select></div>
            <div class="form-group"><label>Status</label><select id="mfStatus">${[["AKTIF", "Aktif"], ["SEMUA", "Semua status"], ...Object.entries(STATUS).map(([k, v]) => [k, v[0]])].map(([k, l]) => `<option value="${k}" ${f.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
            <div class="form-group"><label>Tanggal</label><select id="mfDay">${[["ALL", "Semua tanggal"], ["TODAY", "Hari ini"], ["TOM", "Besok"], ["WEEK", "7 hari ke depan"]].map(([k, l]) => `<option value="${k}" ${f.day === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
            <div class="form-group"><label>Urutkan</label><select id="mfSort">
                <option value="baru" ${f.sort === "baru" ? "selected" : ""}>Terbaru</option>
                <option value="lama" ${f.sort === "lama" ? "selected" : ""}>Terlama</option>
                <option value="main" ${f.sort === "main" ? "selected" : ""}>Waktu main</option>
            </select></div>
        </div>
        <div class="modal-actions" style="margin-top:24px">
            <button class="btn btn-ghost" id="mfReset">Reset</button>
            <button class="btn btn-save" id="mfApply">Terapkan</button>
        </div>`, { wide: false });
    $("#mfReset", m.el).onclick = () => {
        $("#mfLokasi", m.el).value = "ALL";
        $("#mfStatus", m.el).value = "AKTIF";
        $("#mfDay", m.el).value = "ALL";
        $("#mfSort", m.el).value = "baru";
    };
    $("#mfApply", m.el).onclick = () => {
        S.f.lokasi = $("#mfLokasi", m.el).value;
        S.f.status = $("#mfStatus", m.el).value;
        S.f.day = $("#mfDay", m.el).value;
        S.f.sort = $("#mfSort", m.el).value;
        m.close();
        setTab("list");
    };
}

function renderBody() {
    const el = $("#body"); if (!el) return;
    if (S.tab === "inbox") el.innerHTML = inboxHTML();
    else if (S.tab === "list") el.innerHTML = listHTML();
}

const locTag = l => `<span class="loc-tag loc-${Math.min(3, Math.max(0, S.st.lokasi.indexOf(l)))}">${esc(l)}</span>`;

function cardHTML(b, i = 0) {
    const st = eff(b), r = roomCfg(S.st, b.lokasi, b.room), extra = r ? Math.max(0, b.orang - r.baseCap) : 0;
    const hot = ["PENDING", "MENUNGGU_VERIFIKASI"].includes(st) ? " hot" : "";
    const tipe = b.tipe && b.tipe !== "ONLINE" ? ` · ${b.tipe}` : "";
    const clash = isOpen(b.status) && S.bookings.some(o => o.id !== b.id && o.lokasi === b.lokasi && o.room === b.room && ["TERKONFIRMASI", "CHECKED_IN", "MENUNGGU_VERIFIKASI"].includes(o.status) && ["TERKONFIRMASI", "CHECKED_IN", "MENUNGGU_VERIFIKASI"].includes(b.status) && b.startMs < o.endMs && b.endMs > o.startMs);
    let money = "";
    if (b.total) {
        let info = "";
        if (b.dpPaid) info = `<b class="okc">✔ Diterima ${rupiah(b.dpPaid)} (${b.dpPaidMethod || b.dpMethod || "CASH"})</b>`;
        else if (b.payAmount) {
            const typeStr = b.paymentType === "LUNAS" ? "Lunas" : b.paymentType === "DP_MANUAL" ? "DP Manual" : "DP";
            info = `(Klaim: ${typeStr} ${rupiah(b.payAmount)} via ${b.dpMethod || "QRIS"})`;
        }
        money = `<div class="detail-item price-tag">${icon("payments", 16)}<span class="val">Total ${rupiah(b.total)} · DP ${rupiah(b.dpDue)} ${info}</span></div>`;
    } else if (b.estTotal) money = `<div class="detail-item price-tag">${icon("payments", 16)}<span class="val">Estimasi ${rupiah(b.estTotal)}</span></div>`;
    const A = [], id = `data-id="${b.id}"`, bt = (act, cls, ic, txt) => `<button class="btn ${cls}" data-act="${act}" ${id}>${icon(ic, 15)}${txt}</button>`;
    if (st === "PENDING") A.push(bt("approve", "btn-ok", "check", "Setujui"), bt("reject", "btn-delete", "close", "Tolak"));
    if (st === "MENUNGGU_BAYAR") A.push(bt("remind", "btn-wa", "chat", "Ingatkan"), bt("cancel", "btn-delete", "block", "Batalkan"));
    if (st === "MENUNGGU_VERIFIKASI") A.push(bt("verify", "btn-ok", "fact_check", "Verifikasi"), bt("cancel", "btn-delete", "block", "Batalkan"));
    if (st === "TERKONFIRMASI") {
        A.push(bt("checkin", "btn-ok", "login", b.tipe === "BLOK" ? "Mulai" : "Check-in"));
    }
    if (st === "CHECKED_IN") A.push(bt("finish", "btn-warn", "stop_circle", b.tipe === "BLOK" ? "Buka kembali" : "Selesai"));
    A.push(bt("detail", "btn-ghost", "more_horiz", "Detail"));
    return `<div class="booking-card${hot}" style="animation-delay:${Math.min(i, 8) * .04}s"><div class="booking-card-header"><h3>${esc(b.nama || "-")}</h3>${pill(st)}</div>
      <div class="sub">${esc(b.kode || "")}${tipe} · masuk ${b.createdAt ? esc(fmtDT(tsMs(b.createdAt))) : "-"}</div>
      ${clash ? `<div class="banner warn" style="margin:8px 0">${icon("warning")}<span>BENTROK dengan booking lain di room ini!</span></div>` : ""}
      <div class="booking-details" style="margin-top:12px">
        <div class="detail-item">${icon("location_on", 16)}<span class="val">${locTag(b.lokasi)} ${esc(b.room)}</span></div>
        <div class="detail-item">${icon("event", 16)}<span class="val">${esc(fmtDate(b.tanggal, false))} · ${esc(rangeTxt(b))} (${b.durasi} jam)</span></div>
        <div class="detail-item">${icon("group", 16)}<span class="val">${b.orang} orang${extra ? ` (+${extra})` : ""}${b.mic ? `, ${b.mic} mic` : ""}</span></div>
        ${b.wa ? `<div class="detail-item">${icon("phone", 16)}<span class="val">${esc(b.wa)}</span></div>` : ""}${money}
        ${b.catatan ? `<div class="detail-item">${icon("notes", 16)}<span class="val">${esc(b.catatan)}</span></div>` : ""}
      </div><div class="divider"></div><div class="act">${A.join("")}</div></div>`;
}

const gridOf = (arr, empty) => arr.length ? `<div class="bk-grid">${arr.map(cardHTML).join("")}</div>` : `<div class="empty-state"><span class="material-icons-round">inbox</span><p>${empty}</p></div>`;

function inboxHTML() {
    const L = S.bookings.filter(locOk), by = f => L.filter(f).sort((a, b) => a.startMs - b.startMs);
    const sec = (title, ic, arr, empty) => `<div class="section-header"><div class="section-title">${icon(ic, 22)} ${title}</div><span class="count-badge">${arr.length}</span></div>${arr.length ? gridOf(arr) : `<p class="muted" style="margin:0 0 22px">${empty}</p>`}`;
    const t0 = now(), today = witaDate(t0);
    return sec("Permintaan baru", "mark_email_unread", by(b => eff(b) === "PENDING"), "Tidak ada permintaan baru.")
        + sec("Verifikasi pembayaran", "fact_check", by(b => b.status === "MENUNGGU_VERIFIKASI"), "Tidak ada pembayaran menunggu.")
        + sec("Menunggu bayar", "hourglass_top", by(b => eff(b) === "MENUNGGU_BAYAR"), "Tidak ada.")
        + sec("Datang hari ini", "today", by(b => b.status === "TERKONFIRMASI" && b.tanggal === today), "Belum ada yang terkonfirmasi hari ini.");
}

function listHTML() {
    const f = S.f, t = now(), today = witaDate(t), q = f.q.trim().toLowerCase();
    let arr = S.bookings.filter(locOk).filter(b => {
        const st = eff(b);
        if (f.status === "AKTIF" ? !isOpen(st) : f.status !== "SEMUA" && st !== f.status) return false;
        if (f.day === "TODAY" && b.tanggal !== today) return false;
        if (f.day === "TOM" && b.tanggal !== addDays(today, 1)) return false;
        if (f.day === "WEEK" && !(b.tanggal >= today && b.tanggal <= addDays(today, 7))) return false;
        if (q && !`${b.nama} ${b.wa} ${b.kode}`.toLowerCase().includes(q)) return false;
        return true;
    });
    if (f.sort === "main") arr = arr.sort((a, b) => a.startMs - b.startMs);
    else if (f.sort === "lama") arr = arr.sort((a, b) => tsMs(a.createdAt) - tsMs(b.createdAt));
    else arr = arr.sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));

    const info = `<div class="muted" style="margin-bottom:16px; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
        <span>${arr.length} booking</span>
        ${S.hist < 30 ? `<button class="btn btn-ghost btn-sm" data-act="hist" style="padding:4px 10px; min-height:0; height:auto; font-size:12px">Muat 30 hari</button>` : ""}
        ${q.length >= 3 ? `<button class="btn btn-ghost btn-sm" data-act="deepsearch" style="padding:4px 10px; min-height:0; height:auto; font-size:12px">Cari di riwayat</button>` : ""}
    </div>`;

    const showGroups = S.f.lokasi === "ALL" && S.st.lokasi.length > 1;
    if (!showGroups) return info + gridOf(arr, "Tidak ada booking yang cocok.");

    const groups = S.st.lokasi.map(l => {
        const items = arr.filter(b => b.lokasi === l);
        if (!items.length) return "";
        return `<div class="section-header" style="margin-top:24px"><div class="section-title">${icon("place", 22)} ${esc(l)}</div><span class="count-badge">${items.length}</span></div>${gridOf(items, "")}`;
    }).filter(Boolean).join("");

    return info + (groups || `<div class="empty-state"><span class="material-icons-round">inbox</span><p>Tidak ada booking yang cocok.</p></div>`);
}

async function run(fn, ok) {
    try { await fn(); if (ok) toast(ok, "success"); return true; }
    catch (e) {
        if (e.message === "SLOT_BENTROK") conflictModal(e.conflicts || []);
        else { console.error(e); toast("Gagal: " + (e.code || e.message), "error"); }
        return false;
    }
}

function conflictModal(cs) {
    const rows = cs.map(r => { const o = S.byBid.get(r.bid); return `<li>${esc(fmtDT(r.s))}–${esc(witaTime(r.e))} · ${esc(r.k)}${o ? " · " + esc(o.nama) : ""}</li>`; }).join("");
    modal(`<div class="modal-icon"><span class="material-icons-round">warning</span></div><h3>Slot sudah terisi</h3><p>Tidak bisa diproses karena bentrok dengan:</p><ul style="margin:8px 0 16px 18px; text-align:left; line-height:1.6;">${rows}</ul><div class="modal-actions"><button class="btn btn-ghost" data-close>Mengerti</button></div>`, { wide: false });
}

const changeStatus = (b, patch, { release = false, add = null } = {}) => {
    const data = { ...patch, upd: serverTimestamp() };
    if (release) data.slot = false;
    if (add) { data.slot = true; data.slotKind = add.k; }
    if (release || add) return applyTx({ remove: release ? [rangeOf(b)] : [], add, bufMs: bufMs(), alive, bookingRef: refOf(b), bookingData: data });
    return updateDoc(refOf(b), data);
};

const tplVars = (b, x = {}) => ({ nama: b.nama, lokasi: b.lokasi, room: b.room, tanggal: fmtDate(b.tanggal, false), jam: `${b.jamMulai}-${witaTime(b.endMs)}`, nominal: rupiah(b.payAmount || b.dpDue || 0), deadline: b.payDeadline ? fmtDT(b.payDeadline) + " WITA" : "", link: bookingLink(b.id), kode: b.kode, alasan: b.rejectReason || "", site: siteLink(), ...x });

function sendWA(b, key, x = {}) {
    if (!b.wa) return toast("Booking ini tidak punya nomor WA", "error");
    open(waLink(b.wa, fillTpl(S.st.templates[key], tplVars(b, x))), "_blank");
}

function waPrompt(b, key, title, x) {
    const m = modal(`<div class="modal-icon"><span class="material-icons-round">chat</span></div><h3>${esc(title)}</h3><p>Kirim kabar ke ${esc(b.nama)} lewat WhatsApp supaya halaman booking-nya dibuka.</p>
      <div class="modal-actions"><button class="btn btn-ghost" data-close>Nanti</button><button class="btn btn-wa" id="waGo">${icon("send", 16)} Kirim WA</button></div>`, { wide: false });
    $("#waGo", m.el).onclick = () => { sendWA({ ...b, ...(x || {}) }, key, x); m.close(); };
}

const A = {
    detail: b => detailModal(b), approve: b => approveModal(b), reject: b => rejectModal(b), verify: b => verifyModal(b), receive: b => receiveModal(b),
    remind: b => sendWA(b, "remind"),
    checkin: b => run(() => changeStatus(b, { status: "CHECKED_IN", checkedInAt: now() }), "Check-in tercatat"),
    finish: b => run(() => changeStatus(b, { status: "SELESAI", finishedAt: now() }, { release: true }), "Sesi selesai, room dibuka"),
    cancel: async b => { if (await confirmBox("Batalkan booking?", `Booking ${b.nama} dibatalkan dan slot dilepas.`, "Ya, batalkan", true)) run(() => changeStatus(b, { status: "DIBATALKAN", cancelBy: "ADMIN" }, { release: true }), "Dibatalkan"); },
    hist: () => { S.hist = 30; subscribe(); },
    deepsearch: () => deepSearch(S.f.q.trim())
};

function onBodyClick(e) {
    const t = e.target.closest("[data-act]"); if (!t) return;
    const act = t.dataset.act, b = S.bookings.find(x => x.id === t.dataset.id);
    if (["hist", "deepsearch"].includes(act)) return A[act](null, t);
    if (b && A[act]) A[act](b, t);
}

async function deepSearch(q) {
    const found = new Map();
    try {
        const kode = normKode(q), wa = normWA(q);
        if (kode) (await getDocs(query(collection(db, "bookings"), where("kode", "==", kode)))).forEach(d => found.set(d.id, { id: d.id, ...d.data() }));
        if (/^628\d+$/.test(wa)) (await getDocs(query(collection(db, "bookings"), where("wa", "==", wa)))).forEach(d => found.set(d.id, { id: d.id, ...d.data() }));
    } catch (e) { return toast("Pencarian gagal", "error"); }
    if (!found.size) return toast("Tidak ada. Cari pakai kode lengkap atau nomor WA lengkap.", "info");
    found.forEach((v, k) => { if (!S.bookings.find(x => x.id === k)) { S.bookings.push(v); S.byBid.set(v.bid, v); } });
    S.f.status = "SEMUA"; setTab("list");
}

function approveModal(b) {
    const r = roomCfg(S.st, b.lokasi, b.room) || { rate: 0, baseCap: 4, extraPrice: 0 }, p = calcPrice(S.st, r, b.durasi, b.orang, b.mic || 0);
    const clashes = S.bookings.filter(o => o.id !== b.id && o.lokasi === b.lokasi && o.room === b.room && b.startMs < o.endMs + bufMs() && b.endMs > o.startMs - bufMs());
    const hard = clashes.filter(o => ["MENUNGGU_VERIFIKASI", "TERKONFIRMASI", "CHECKED_IN"].includes(o.status) || (o.status === "MENUNGGU_BAYAR" && eff(o) !== "HANGUS"));
    const rivals = clashes.filter(o => eff(o) === "PENDING");
    const hold = S.st.holdMinutes || 30;
    const defDeadline = now() + hold * 60000;

    const m = modal(`<h3>${icon("check_circle")} Setujui booking</h3>
      <p><b>${esc(b.nama)}</b> · ${esc(b.lokasi)} ${esc(b.room)}<br>${esc(fmtDate(b.tanggal))}, ${esc(rangeTxt(b))}</p>
      ${hard.length ? `<div class="banner warn">${icon("warning")}<span>Bentrok dengan: ${hard.map(o => esc(o.nama) + " " + rangeTxt(o)).join(", ")}. Sistem akan menolak.</span></div>` : ""}
      ${rivals.length ? `<div class="banner warn">${icon("groups")}<span>Ada ${rivals.length} permintaan lain di jam ini: ${rivals.map(o => esc(o.nama) + " " + rangeTxt(o)).join(", ")}. Menyetujui satu akan menahan slot.</span></div>` : ""}
      <div class="form-grid">
        <div class="form-group"><label>Total (Otomatis)</label><input value="${rupiah(p.total)}" readonly style="opacity:0.7; cursor:not-allowed;"></div>
        <div class="form-group"><label>DP Minimal (${S.st.dpPercent}%)</label><input value="${rupiah(p.dp)}" readonly style="opacity:0.7; cursor:not-allowed;"></div>
        <div class="form-group full-width"><label>Batas bayar (WITA)</label><input type="datetime-local" id="aDead" value="${witaDateTimeInput(defDeadline)}" readonly style="opacity:0.7; cursor:not-allowed;"></div>
      </div>
      <label class="check" style="margin-top:8px"><input type="checkbox" id="aChk"><span>Saya sudah memastikan room <b>kosong</b> di jam ini (termasuk walk-in yang sedang main).</span></label>
      <div class="modal-actions" style="margin-top:20px"><button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-ok" id="aGo">${icon("check", 16)} Setujui</button></div>`);

    $("#aGo", m.el).onclick = async e => {
        const btn = e.currentTarget, deadline = fromDateTimeInput($("#aDead", m.el).value);
        if (!$("#aChk", m.el).checked) return toast("Centang dulu: pastikan room kosong", "error");
        if (!deadline || deadline <= now()) return toast("Batas bayar harus di masa depan", "error");
        setBusy(btn, true, "Memproses…");
        const add = addOf(b, "MENUNGGU_BAYAR", deadline);
        const patch = { status: "MENUNGGU_BAYAR", total: p.total, dpDue: p.dp, payDeadline: deadline, approvedAt: now(), payNote: "" };
        
        const ok = await run(() => changeStatus(b, patch, { add }), "Disetujui");
        if (ok) { m.close(); waPrompt({ ...b, ...patch }, "approve", "Kabari pelanggan"); } else setBusy(btn, false);
    };
}

function rejectModal(b) {
    const m = modal(`<h3>${icon("cancel")} Tolak booking</h3><p>${esc(b.nama)} · ${esc(rangeTxt(b))}</p>
      <div class="row-btns" style="margin:0 0 12px">${["Room sedang dipakai", "Jadwal tutup / libur", "Mohon pilih jam lain"].map(t => `<button class="btn btn-ghost btn-sm" data-r="${t}">${t}</button>`).join("")}</div>
      <textarea id="rReason" rows="3" placeholder="Alasan (dikirim ke pelanggan)"></textarea>
      <div class="modal-actions" style="margin-top:20px"><button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-delete" id="rGo">Tolak</button></div>`);
    $$("[data-r]", m.el).forEach(x => x.onclick = () => $("#rReason", m.el).value = x.dataset.r);
    $("#rGo", m.el).onclick = async () => {
        const reason = $("#rReason", m.el).value.trim() || "Jadwal tidak tersedia."; const patch = { status: "DITOLAK", rejectReason: reason };
        if (await run(() => changeStatus(b, patch, { release: !!b.slot }), "Ditolak")) { m.close(); waPrompt({ ...b, ...patch }, "reject", "Kabari pelanggan"); }
    };
}

async function verifyModal(b) {
    let img = ""; try { const p = await getDoc(doc(db, "proofs", b.id)); if (p.exists() && String(p.data().img).startsWith("data:image/")) img = p.data().img; } catch (e) { }
    
    const isCash = b.dpMethod === "CASH";
    const method = isCash ? "CASH" : "QRIS";
    const tipe = b.paymentType === "LUNAS" ? "Lunas" : b.paymentType === "DP_MANUAL" ? "DP Manual" : "DP";
    const nominal = b.payAmount || b.dpDue || 0;
    
    const receivedAmount = b.paymentType === "LUNAS" ? (b.total || nominal) : nominal;
    const receivedLabel = isCash ? (b.paymentType === "LUNAS" ? "Nominal yang harusnya diterima:" : "Nominal minimal yang harusnya diterima:") : "Cari di mutasi / notifikasi merchant QRIS:";
    const receivedNote = !isCash ? "Nominal harus PERSIS sama." : (b.paymentType === "LUNAS" ? "Pastikan sesuai." : "Pelanggan bisa membayar lebih dari nominal minimal ini.");
    
    const btnNoText = isCash ? "Belum diterima" : "Belum masuk";
    const btnOkText = isCash ? "Sudah diterima" : "Sudah masuk";

    const m = modal(`<h3>${icon("fact_check")} Verifikasi Pembayaran</h3>
      <div class="kv"><span>User Klaim Bayar</span><b>${tipe} - ${rupiah(nominal)}</b></div>
      <div class="kv"><span>Metode</span><b>${method}</b></div>
      <div class="banner ok" style="flex-direction:column;gap:4px; margin-top:12px;">
        <span>${receivedLabel}</span>
        <b style="font-size:24px;font-family:Orbitron">${rupiah(receivedAmount)}</b>
        <span class="muted">${receivedNote} Dilaporkan ${b.paidReportedAt ? esc(fmtDT(b.paidReportedAt)) : "-"}${b.sender ? " · pengirim: " + esc(b.sender) : ""}</span>
      </div>
      ${!isCash ? (img ? `
        <img class="proof-img" src="${img}" alt="bukti">
        <div class="row-btns" style="justify-content:center; margin-top:10px;">
            <a href="${img}" download="bukti-${b.kode}.jpg" class="btn btn-ghost" style="text-decoration:none;">
                ${icon("download", 16)} Unduh Foto
            </a>
        </div>
      ` : `<p class="muted center">Tidak ada screenshot terlampir. Cocokkan langsung di mutasi.</p>`) : `<p class="muted center">Pastikan uang CASH sudah diterima di kasir setidaknya sejumlah nominal di atas.</p>`}
      <div class="modal-actions"><button class="btn btn-ghost" data-close>Tutup</button><button class="btn btn-delete" id="vNo">${btnNoText}</button><button class="btn btn-ok" id="vOk">${icon("check", 16)} ${btnOkText}</button></div>`);
    
    $("#vOk", m.el).onclick = async () => {
        const patch = { status: "TERKONFIRMASI", dpPaid: nominal, dpPaidAt: now(), verifiedAt: now(), dpPaidMethod: method };
        if (await run(async () => { await changeStatus(b, patch, { add: addOf(b, "TERKONFIRMASI") }); try { await deleteDoc(doc(db, "proofs", b.id)); } catch (e) { } }, "Pembayaran dikonfirmasi")) { m.close(); waPrompt({ ...b, ...patch }, "confirmed", "Kabari pelanggan"); }
    };
    $("#vNo", m.el).onclick = async () => {
        const note = await promptBox("Catatan untuk pelanggan", "Pesan ini tampil di halaman pelanggan.", b.dpMethod === "CASH" ? "Pembayaran cash belum kami terima." : "Pembayaran belum kami temukan. Cek kembali nominal & coba lagi.", "Kembalikan"); if (note === null) return;
        const dl = now() + 15 * 60000, patch = { status: "MENUNGGU_BAYAR", payDeadline: dl, payNote: note };
        if (await run(async () => { await changeStatus(b, patch, { add: addOf(b, "MENUNGGU_BAYAR", dl) }); try { await deleteDoc(doc(db, "proofs", b.id)); } catch (e) { } }, "Dikembalikan ke menunggu bayar (+15 menit)")) m.close();
    };
}

function receiveModal(b) {
    const m = modal(`<h3>${icon("payments")} Verifikasi Pembayaran Cash</h3><p>${esc(b.nama)} · Total ${rupiah(b.total)} / DP Minimal ${rupiah(b.dpDue)}</p>
      <div class="form-grid">
        <div class="form-group"><label>Nominal diterima</label><input id="dNom" data-money inputmode="numeric" value="${fmtNum(b.dpDue)}"></div>
        <div class="form-group"><label>Metode</label><select id="dMet"><option value="CASH">CASH</option><option value="QRIS">QRIS / Transfer</option></select></div>
      </div>
      <div class="modal-actions"><button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-ok" id="dGo">Konfirmasi</button></div>`);
    $("#dGo", m.el).onclick = async () => {
        const nom = parseNum($("#dNom", m.el).value); if (!nom) return toast("Isi nominal", "error");
        const method = $("#dMet", m.el).value;
        
        let patch = { 
            dpPaid: nom, 
            dpPaidMethod: method, 
            dpPaidAt: now(), 
            verifiedAt: now(), 
            payAmount: nom, 
            paymentType: nom >= b.total ? "LUNAS" : (nom === b.dpDue ? "DP_MIN" : "DP_MANUAL"), 
            dpMethod: method 
        };
        
        if (method === "CASH") {
            patch.status = "CHECKED_IN";
            patch.checkedInAt = now();
        } else {
            patch.status = "MENUNGGU_BAYAR";
            patch.payDeadline = now() + 15 * 60000;
        }

        if (await run(async () => { 
            await changeStatus(b, patch, { add: addOf(b, patch.status, patch.payDeadline) }); 
            try { await deleteDoc(doc(db, "proofs", b.id)); } catch (e) { } 
        }, method === "CASH" ? "Cash diverifikasi, selamat bermain!" : "Berhasil ganti ke QRIS")) { 
            m.close(); 
        }
    };
}

function detailModal(b) {
    const st = eff(b), r = roomCfg(S.st, b.lokasi, b.room), extra = r ? Math.max(0, b.orang - r.baseCap) : 0;
    
    let actionHtml = "";
    if (st === "PENDING") {
        actionHtml = `<div class="row-btns">
            <button class="btn btn-ghost" id="dEdit">${icon("edit", 15)} Edit</button>
            ${b.wa ? `<button class="btn btn-wa" id="dWa">${icon("chat", 15)} WA</button>` : ""}
            <button class="btn btn-delete" id="dDel">${icon("delete", 15)} Hapus</button>
        </div>`;
    } else if (st === "MENUNGGU_BAYAR") {
        actionHtml = `<div class="row-btns">
            <button class="btn btn-ghost" id="dEdit">${icon("edit", 15)} Edit</button>
        </div>`;
    } else if (st === "MENUNGGU_VERIFIKASI") {
        actionHtml = `<div class="row-btns">
            <button class="btn btn-ghost" id="dEdit">${icon("edit", 15)} Edit</button>
            ${b.wa ? `<button class="btn btn-wa" id="dWa">${icon("chat", 15)} WA</button>` : ""}
            <button class="btn btn-delete" id="dDel">${icon("delete", 15)} Hapus</button>
        </div>`;
    } else if (st === "TERKONFIRMASI") {
        actionHtml = `<div class="row-btns">
            <button class="btn btn-ghost" id="dEdit">${icon("edit", 15)} Edit</button>
            ${b.wa ? `<button class="btn btn-wa" id="dWa">${icon("chat", 15)} WA</button>` : ""}
            <button class="btn btn-delete" id="dDel">${icon("delete", 15)} Hapus</button>
        </div>`;
    } else if (["SELESAI", "DITOLAK", "DIBATALKAN", "HANGUS"].includes(st)) {
        actionHtml = `<div class="row-btns" style="justify-content: center;">
            <button class="btn btn-delete" id="dDel">${icon("delete", 15)} Hapus</button>
        </div>`;
    }

    const method = b.dpMethod === "CASH" ? "CASH" : b.dpMethod === "QRIS" ? "QRIS" : "-";
    let payTypeStr = b.paymentType === "LUNAS" ? "Lunas" : b.paymentType === "DP_MANUAL" ? "DP Manual" : b.paymentType === "DP_MIN" ? "DP" : "-";
    
    let payInfo = "";
    if (b.payAmount) {
        payInfo = `<div class="kv"><span>User Klaim Bayar</span><b>${payTypeStr} ${rupiah(b.payAmount)} (${method})</b></div>`;
    }

    const m = modal(`<h3>${esc(b.nama)} ${pill(st)}</h3>
      <div class="kv"><span>Kode</span><b class="mono">${esc(b.kode)}</b></div><div class="kv"><span>Lokasi / Room</span><b>${esc(b.lokasi)} · ${esc(b.room)}</b></div>
      <div class="kv"><span>Waktu</span><b>${esc(fmtDate(b.tanggal))}<br>${esc(rangeTxt(b))} (${b.durasi} jam)</b></div>
      <div class="kv"><span>Orang / Mic</span><b>${b.orang}${extra ? ` (+${extra})` : ""} / ${b.mic || 0}</b></div><div class="kv"><span>WA</span><b>${esc(b.wa || "-")}</b></div>
      <div class="kv"><span>Metode</span><b>${method}</b></div>
      ${b.total ? `<div class="kv"><span>Total / DP</span><b>${rupiah(b.total)} / ${rupiah(b.dpDue)}</b></div>` : ""}
      ${payInfo}
      ${b.dpPaid ? `<div class="kv"><span>Dana Diterima</span><b class="okc">${rupiah(b.dpPaid)} (${esc(b.dpPaidMethod || method)})</b></div>` : ""}
      ${b.rejectReason ? `<div class="kv"><span>Alasan tolak</span><b class="center">${esc(b.rejectReason)}</b></div>` : ""}${b.catatan ? `<div class="kv"><span>Catatan</span><b>${esc(b.catatan)}</b></div>` : ""}
      ${actionHtml}
      <div class="modal-actions"><button class="btn btn-ghost" data-close>Tutup</button></div>`);

    $("#dApp", m.el)?.addEventListener("click", () => { m.close(); approveModal(b); });
    $("#dRej", m.el)?.addEventListener("click", () => { m.close(); rejectModal(b); });
    $("#dEdit", m.el)?.addEventListener("click", () => { m.close(); editModal(b); });
    $("#dLink", m.el)?.addEventListener("click", () => copyText(bookingLink(b.id)));
    $("#dWa", m.el)?.addEventListener("click", () => sendWA(b, st === "TERKONFIRMASI" ? "confirmed" : st === "MENUNGGU_BAYAR" ? "approve" : "confirmed"));
    $("#dVCash", m.el)?.addEventListener("click", () => { m.close(); receiveModal(b); });

    $("#dDel", m.el)?.addEventListener("click", async () => {
        if (!await confirmBox("Hapus permanen?", "Data booking ini dihapus dan tidak bisa dikembalikan.", "Ya, hapus", true)) return;
        m.close();
        run(async () => {
            if (b.slot) await applyTx({ remove: [rangeOf(b)], bufMs: bufMs(), alive });
            try { await deleteDoc(doc(db, "proofs", b.id)); } catch (e) { }
            try { if (b.kode && b.wa) await deleteDoc(doc(db, "lookups", await lookupId(b.kode, b.wa))); } catch (e) { }
            await deleteDoc(refOf(b));
        }, "Dihapus");
    });
}

function editModal(b) {
    const roomsOf = l => (S.st.rooms[l] || []).map(r => r.name);
    const m = modal(`<h3>${icon("edit")} Edit booking</h3><div class="form-grid">
      <div class="form-group full-width"><label>Nama</label><input id="eNama" value="${esc(b.nama)}"></div><div class="form-group full-width"><label>WhatsApp</label><input id="eWa" value="${esc(b.wa || "")}"></div>
      <div class="form-group"><label>Lokasi</label><select id="eLok">${S.st.lokasi.map(l => `<option ${l === b.lokasi ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
      <div class="form-group"><label>Room</label><select id="eRoom"></select></div>
      <div class="form-group"><label>Mulai (WITA)</label><input type="datetime-local" id="eDt" value="${witaDateTimeInput(b.startMs)}"></div>
      <div class="form-group"><label>Durasi (jam)</label><input type="number" step="0.5" min="0.5" id="eDur" value="${b.durasi}"></div>
      <div class="form-group"><label>Orang</label><input type="number" id="eOrg" value="${b.orang}"></div><div class="form-group"><label>Mic</label><input type="number" id="eMic" value="${b.mic || 0}"></div>
      <div class="form-group"><label>Total (Otomatis)</label><input id="eTot" readonly style="opacity:0.7; cursor:not-allowed;"></div><div class="form-group"><label>DP Minimal (Otomatis)</label><input id="eDp" readonly style="opacity:0.7; cursor:not-allowed;"></div>
      <div class="form-group full-width"><label>Catatan</label><textarea id="eCat" rows="2">${esc(b.catatan || "")}</textarea></div></div>
      ${isOpen(b.status) && b.slot ? `<p class="muted">Slot akan dipindahkan otomatis, dan dicek bentrok ulang.</p>` : ""}
      <div class="modal-actions"><button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-save" id="eGo" style="flex:0 0 auto;padding:12px 22px">Simpan</button></div>`);

    let m_tot = 0, m_dp = 0;
    const recalc = () => {
        const lok = $("#eLok", m.el).value, roomName = $("#eRoom", m.el).value;
        const dur = parseFloat($("#eDur", m.el).value) || 0;
        const org = parseInt($("#eOrg", m.el).value) || 1;
        const mic = parseInt($("#eMic", m.el).value) || 0;
        const r = roomCfg(S.st, lok, roomName);
        if (r && dur > 0) {
            const p = calcPrice(S.st, r, dur, org, mic);
            $("#eTot", m.el).value = rupiah(p.total);
            $("#eDp", m.el).value = rupiah(p.dp);
            m_tot = p.total; m_dp = p.dp;
        } else {
            $("#eTot", m.el).value = "-";
            $("#eDp", m.el).value = "-";
            m_tot = 0; m_dp = 0;
        }
    };

    const fill = () => {
        $("#eRoom", m.el).innerHTML = roomsOf($("#eLok", m.el).value).map(n => `<option ${n === b.room ? "selected" : ""}>${esc(n)}</option>`).join("");
        recalc();
    };
    fill();
    $("#eLok", m.el).onchange = fill;
    ["eRoom", "eDur", "eOrg", "eMic"].forEach(id => $("#" + id, m.el).addEventListener("input", recalc));

    $("#eGo", m.el).onclick = async () => {
        const s = fromDateTimeInput($("#eDt", m.el).value), dur = parseFloat($("#eDur", m.el).value);
        if (!s || !(dur > 0)) return toast("Waktu / durasi tidak valid", "error");
        const e = s + Math.round(dur * H), patch = {
            nama: $("#eNama", m.el).value.trim() || b.nama,
            wa: normWA($("#eWa", m.el).value),
            lokasi: $("#eLok", m.el).value,
            room: $("#eRoom", m.el).value,
            tanggal: witaDate(s),
            jamMulai: witaTime(s),
            durasi: dur,
            startMs: s,
            endMs: e,
            orang: parseInt($("#eOrg", m.el).value) || 1,
            mic: parseInt($("#eMic", m.el).value) || 0,
            catatan: $("#eCat", m.el).value.trim(),
            upd: serverTimestamp()
        };
        if (!b.tipe || b.tipe === "ONLINE") {
            if (b.status === "PENDING") patch.estTotal = m_tot;
            else {
                patch.total = m_tot;
                patch.dpDue = m_dp;
            }
        }
        const nb = { ...b, ...patch };
        const ok = await run(async () => {
            if (b.slot && isOpen(b.status)) await applyTx({ remove: [rangeOf(b)], add: addOf(nb), bufMs: bufMs(), alive, bookingRef: refOf(b), bookingData: patch });
            else await updateDoc(refOf(b), patch);
            if (patch.wa && patch.wa !== b.wa && b.kode) await setDoc(doc(db, "lookups", await lookupId(b.kode, patch.wa)), { s: b.id });
        }, "Perubahan disimpan");
        if (ok) m.close();
    };
}

function manualModal(pre = {}) {
    const tipe = pre.tipe || "WALKIN", lok = pre.lokasi || (S.f.lokasi !== "ALL" ? S.f.lokasi : S.st.lokasi[0]);
    const m = modal(`<h3>${icon("add_circle")} Tambah manual</h3><div class="form-grid">
      <div class="form-group full-width"><label>Jenis</label><select id="mTipe"><option value="WALKIN" ${tipe === "WALKIN" ? "selected" : ""}>Walk-in (mulai sekarang)</option><option value="MANUAL" ${tipe === "MANUAL" ? "selected" : ""}>Booking manual (telepon / WA)</option><option value="BLOK" ${tipe === "BLOK" ? "selected" : ""}>Blokir room (maintenance / acara)</option></select></div>
      <div class="form-group"><label>Lokasi</label><select id="mLok">${S.st.lokasi.map(l => `<option ${l === lok ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div><div class="form-group"><label>Room</label><select id="mRoom"></select></div>
      <div class="form-group"><label>Mulai (WITA)</label><input type="datetime-local" id="mDt" value="${witaDateTimeInput(now())}"></div><div class="form-group"><label>Durasi (jam)</label><input type="number" step="0.5" min="0.5" id="mDur" value="1"></div>
      <div class="form-group full-width"><label id="mNamaL">Nama</label><input id="mNama" placeholder="Nama / label"></div>
      <div class="form-group" data-m="u"><label>WhatsApp</label><input id="mWa" inputmode="tel"></div><div class="form-group" data-m="u"><label>Orang</label><input type="number" id="mOrg" value="2" min="1"></div>
      <div class="form-group" data-m="u"><label>Total (opsional)</label><input id="mTot" data-money inputmode="numeric"></div><div class="form-group" data-m="u"><label>DP diterima</label><input id="mDp" data-money inputmode="numeric" placeholder="0"></div></div>
      <label class="check" style="margin-top:12px"><input type="checkbox" id="mForce"><span>Paksa walau bentrok <small class="muted">(kenyataan di lapangan menang; booking yang bentrok akan ditandai)</small></span></label>
      <div class="modal-actions" style="margin-top:20px"><button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-save" id="mGo" style="flex:0 0 auto;padding:12px 22px">Simpan</button></div>`);
    const fill = () => { $("#mRoom", m.el).innerHTML = (S.st.rooms[$("#mLok", m.el).value] || []).map(r => `<option ${r.name === pre.room ? "selected" : ""}>${esc(r.name)}</option>`).join(""); };
    const sync = () => { const t = $("#mTipe", m.el).value; $$("[data-m=u]", m.el).forEach(x => x.style.display = t === "BLOK" ? "none" : ""); $("#mNamaL", m.el).textContent = t === "BLOK" ? "Alasan blokir" : "Nama"; if (t === "WALKIN") $("#mDt", m.el).value = witaDateTimeInput(now()); };
    fill(); sync(); $("#mLok", m.el).onchange = fill; $("#mTipe", m.el).onchange = sync;
    $("#mGo", m.el).onclick = async e => {
        const btn = e.currentTarget, t = $("#mTipe", m.el).value, lokasi = $("#mLok", m.el).value, room = $("#mRoom", m.el).value, s = fromDateTimeInput($("#mDt", m.el).value), dur = parseFloat($("#mDur", m.el).value);
        if (!room || !s || !(dur > 0)) return toast("Lengkapi room, waktu, dan durasi", "error");
        const nama = $("#mNama", m.el).value.trim() || (t === "WALKIN" ? "Walk-in" : t === "BLOK" ? "Ditutup" : ""); if (!nama) return toast("Isi nama", "error");
        const secret = randSecret(16), kode = genKode(), bid = randSecret(8), en = s + Math.round(dur * H), wa = normWA($("#mWa", m.el).value), dp = parseNum($("#mDp", m.el).value), total = parseNum($("#mTot", m.el).value);
        const status = t === "MANUAL" ? "TERKONFIRMASI" : "CHECKED_IN";
        const data = { bid, kode, nama, wa: t === "BLOK" ? "" : wa, lokasi, room, tanggal: witaDate(s), jamMulai: witaTime(s), durasi: dur, startMs: s, endMs: en, orang: t === "BLOK" ? 0 : parseInt($("#mOrg", m.el).value) || 1, mic: 0, status, tipe: t, createdAt: serverTimestamp(), upd: serverTimestamp(), slot: true };
        if (total) data.total = total; 
        if (dp) { 
            data.dpPaid = dp; 
            data.dpPaidMethod = "CASH"; 
            data.dpPaidAt = now(); 
            data.payAmount = dp;
            data.paymentType = dp >= (total || 0) ? "LUNAS" : "DP_MANUAL";
            data.dpMethod = "CASH";
        }
        const add = { lokasi, room, s, e: en, bid, k: t === "WALKIN" ? "walkin" : t === "BLOK" ? "block" : "booked" }; data.slotKind = add.k;
        setBusy(btn, true, "Menyimpan…");
        const ok = await run(async () => {
            await applyTx({ add, bufMs: bufMs(), alive, bookingRef: doc(db, "bookings", secret), bookingData: data, bookingCreate: true, force: $("#mForce", m.el).checked });
            if (wa && t !== "BLOK") await setDoc(doc(db, "lookups", await lookupId(kode, wa)), { s: secret });
        }, "Tersimpan");
        if (ok) m.close(); else setBusy(btn, false);
    };
}

let sweeping = false;
async function sweep() {
    if (sweeping || document.hidden || !S.bookings.length) return; sweeping = true;
    try {
        const t = now();
        for (const b of S.bookings) {
            const expected = eff(b, S.st, t);
            if (expected !== b.status) {
                if (expected === "HANGUS" || expected === "SELESAI") {
                    await changeStatus(b, { status: expected }, { release: !!b.slot });
                    toast(`Status ${b.nama} otomatis menjadi ${STATUS[expected][0]}`, "info");
                }
            } else if (!HOLDING.includes(b.status) && b.slot === true) {
                await changeStatus(b, {}, { release: true });
            } else if (b.status === "MENUNGGU_VERIFIKASI" && b.slotKind !== "booked") {
                try { await changeStatus(b, {}, { add: addOf(b, "MENUNGGU_VERIFIKASI") }); } catch (e) { if (e.message === "SLOT_BENTROK") toast(`Pembayaran ${b.nama} masuk tapi slot sudah terisi booking lain! Cek manual.`, "error"); }
            }
        }
    } catch (e) { console.warn("sweep", e); } finally { sweeping = false; }
}

function renderScan() {
    $("#body").innerHTML = `<div class="panel">
        <h3>${icon("qr_code_scanner")} Scan QR pelanggan</h3>
        <button class="btn btn-save btn-block" id="scanToggle" type="button" style="margin-top: var(--space-md);"></button>
        <div class="scan-wrap" id="scanWrap" hidden><video id="scanVid" playsinline muted></video></div>
        <div class="divider-text"><span>Atau Cari Manual</span></div>
        <div class="form-group" style="margin: 0;"><input id="scanQ" placeholder="Nama / WA / kode booking"></div>
    </div>
    <div id="scanRes"></div>
    <div class="section-header"><div class="section-title">${icon("today", 22)} Terkonfirmasi hari ini</div></div>
    <div id="scanList"></div>`;
    setScanUi(false);
    $("#scanToggle").onclick = () => scanStream || scanStarting ? stopScan() : startScan();
    $("#scanQ").addEventListener("input", e => renderScanList(e.target.value));
    renderScanList();
}

function renderScanList(q = ($("#scanQ")?.value || "")) {
    const el = $("#scanList"); if (!el) return; q = q.trim().toLowerCase();
    const today = witaDate(now());
    const arr = S.bookings.filter(b => (q ? `${b.nama} ${b.wa} ${b.kode}`.toLowerCase().includes(q) && isOpen(b.status) : b.tanggal === today && ["TERKONFIRMASI", "CHECKED_IN"].includes(b.status))).sort((a, b) => a.startMs - b.startMs);
    el.innerHTML = gridOf(arr, q ? "Tidak ditemukan di data yang dimuat." : "Belum ada.");
}

function setScanUi(on) {
    const b = $("#scanToggle"); if (!b) return;
    b.innerHTML = on ? `${icon("videocam_off", 16)} Tutup kamera` : `${icon("photo_camera", 16)} Buka kamera`;
    b.classList.toggle("btn-delete", on);
    b.classList.toggle("btn-save", !on);
}

async function startScan() {
    scanStarting = true;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!scanStarting) { stream.getTracks().forEach(t => t.stop()); return; }
        scanStream = stream;
        const v = $("#scanVid"); v.srcObject = scanStream; await v.play(); $("#scanWrap").hidden = false; setScanUi(true);
        const c = document.createElement("canvas"), cx = c.getContext("2d", { willReadFrequently: true });
        const tick = () => {
            if (!scanStream) return;
            if (v.readyState === v.HAVE_ENOUGH_DATA) {
                c.width = v.videoWidth; c.height = v.videoHeight; cx.drawImage(v, 0, 0);
                const code = window.jsQR(cx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
                const k = code && normKode((code.data.match(/ARY-?[A-Z0-9]{6}/i) || [""])[0]);
                if (k) { navigator.vibrate?.(80); stopScan(); return showScanResult(k); }
            }
            setTimeout(() => requestAnimationFrame(tick), 120);
        };
        tick();
    } catch (e) { toast("Kamera tidak bisa dibuka. Izinkan akses kamera atau pakai pencarian manual.", "error"); }
    finally { scanStarting = false; }
}

function stopScan() {
    scanStarting = false;
    if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
    const w = $("#scanWrap"); if (w) w.hidden = true;
    setScanUi(false);
}

async function showScanResult(kode) {
    let b = S.bookings.find(x => x.kode === kode);
    if (!b) { try { const s = await getDocs(query(collection(db, "bookings"), where("kode", "==", kode))); s.forEach(d => b = { id: d.id, ...d.data() }); if (b) { S.bookings.push(b); S.byBid.set(b.bid, b); } } catch (e) { } }
    const el = $("#scanRes");
    if (!b) { el.innerHTML = `<div class="banner warn">${icon("search_off")}<span>Kode ${esc(kode)} tidak ditemukan.</span></div>`; return; }
    const st = eff(b), early = now() < b.startMs - 30 * 60000, late = now() > b.endMs;
    const ok = st === "TERKONFIRMASI" && !late;
    const cashVerify = st === "MENUNGGU_BAYAR" && b.dpMethod === "CASH" && !late;
    
    el.innerHTML = `<div class="panel ${ok ? "ok" : "bad"}"><h3>${icon(ok ? "verified" : "report")} ${esc(b.nama)} ${pill(st)}</h3>
      <div class="kv"><span>Room</span><b>${esc(b.lokasi)} · ${esc(b.room)}</b></div><div class="kv"><span>Jadwal</span><b>${esc(fmtDate(b.tanggal, false))} ${esc(rangeTxt(b))}</b></div>
      <div class="kv"><span>DP</span><b class="${b.dpPaid ? "okc" : ""}">${b.dpPaid ? "✔ " + rupiah(b.dpPaid) : "BELUM DITERIMA"}</b></div>
      ${early ? `<div class="banner warn">${icon("schedule")}<span>Masih terlalu awal dari jadwal.</span></div>` : ""}${late ? `<div class="banner warn">${icon("schedule")}<span>Jadwal sesi sudah lewat.</span></div>` : ""}
      <div class="row-btns">
        ${ok ? `<button class="btn btn-ok" data-act="checkin" data-id="${b.id}">${icon("login", 16)} Check-in</button>` : ""}
        ${cashVerify ? `<button class="btn btn-ok" data-act="receive" data-id="${b.id}">${icon("payments", 16)} Verifikasi Cash</button>` : ""}
        <button class="btn btn-ghost" data-act="detail" data-id="${b.id}">Detail</button><button class="btn btn-ghost" id="scanAgain">${icon("qr_code_scanner", 16)} Scan lagi</button>
      </div></div>`;
    el.onclick = e => { if (e.target.closest("#scanAgain")) { el.innerHTML = ""; startScan(); } };
}

async function exportCsv() {
    const rows = [["kode", "nama", "wa", "lokasi", "room", "tanggal", "jam", "durasi", "orang", "mic", "status", "tipe", "total", "dp", "dp_diterima"]];
    S.bookings.forEach(b => rows.push([b.kode, b.nama, b.wa, b.lokasi, b.room, b.tanggal, b.jamMulai, b.durasi, b.orang, b.mic, b.status, b.tipe || "ONLINE", b.total || "", b.dpDue || "", b.dpPaid || ""]));
    const csv = rows.map(r => r.map(x => `"${String(x ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv" })); a.download = `araya-booking-${witaDate(now())}.csv`; a.click();
}

async function cleanup(days = 30) {
    if (!await confirmBox("Bersihkan data lama?", `Booking selesai/ditolak/batal/hangus yang lebih dari ${days} hari akan dihapus permanen. Ekspor CSV dulu kalau perlu.`, "Hapus", true)) return;
    const cut = now() - days * 86400000; let n = 0;
    try {
        const s = await getDocs(query(collection(db, "bookings"), where("endMs", "<", cut)));
        for (const d of s.docs) {
            const b = d.data(); if (isOpen(b.status) && b.status !== "PENDING") continue;
            try { await deleteDoc(doc(db, "proofs", d.id)); } catch (e) { }
            try { if (b.kode && b.wa) await deleteDoc(doc(db, "lookups", await lookupId(b.kode, b.wa))); } catch (e) { }
            await deleteDoc(d.ref); n++;
        }
        const cutDate = witaDate(cut), av = await getDocs(collection(db, "availability"));
        const oldAv = av.docs.filter(d => d.id.split("__").pop() < cutDate);
        for (let i = 0; i < oldAv.length; i += 500) {
            const batch = writeBatch(db);
            oldAv.slice(i, i + 500).forEach(d => batch.delete(d.ref));
            await batch.commit();
        }
        toast(`${n} booking dan ${oldAv.length} data jadwal lama dihapus`, "success");
    } catch (e) { toast("Gagal membersihkan: " + (e.code || e.message), "error"); }
}

async function resetAllData() {
    const ok = await confirmBox("RESET TOTAL DATABASE", "Apakah Anda yakin? Tindakan ini akan menghapus SEMUA data (booking, room, pengaturan, QRIS) secara permanen dan mengembalikan aplikasi ke kondisi awal seperti baru. Tindakan ini tidak dapat dibatalkan.", "Ya, Reset Semua", true);
    if (!ok) return;

    const m = modal(`<h3>Menghapus Data...</h3><p>Mohon tunggu, sedang menghapus semua data dari database.</p><progress style="width:100%"></progress>`, { sticky: true, wide: false });

    try {
        const cols = ["bookings", "availability", "proofs", "lookups"];
        for (const c of cols) {
            const snap = await getDocs(collection(db, c));
            if (!snap.empty) {
                const docs = snap.docs;
                for (let i = 0; i < docs.length; i += 500) {
                    const batch = writeBatch(db);
                    docs.slice(i, i + 500).forEach(d => batch.delete(d.ref));
                    await batch.commit();
                }
            }
        }

        try { await deleteDoc(doc(db, "config", "settings")); } catch(e) {}
        try { await deleteDoc(doc(db, "config", "qris")); } catch(e) {}

        localStorage.removeItem("araya_mine");
        localStorage.removeItem("araya_sub");
        sessionStorage.clear();

        toast("Database berhasil di-reset. Memuat ulang...", "success");
        setTimeout(() => location.reload(), 1500);
    } catch (err) {
        m.close();
        toast("Gagal reset database: " + (err.message || err.code), "error");
    }
}