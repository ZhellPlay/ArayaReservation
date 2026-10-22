export const TZ = "+08:00";
const H = 3600000;

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

let clockOffset = 0;
export const now = () => Date.now() + clockOffset;
export async function syncClock() {
    try {
        const t0 = Date.now();
        const r = await fetch(location.pathname + "?_=" + t0, { method: "HEAD", cache: "no-store" });
        const d = r.headers.get("date");
        if (d) { const srv = Date.parse(d); const t1 = Date.now(); clockOffset = srv - (t0 + t1) / 2; if (Math.abs(clockOffset) < 1500) clockOffset = 0; }
    } catch (e) { }
}

export const toMs = (date, time) => Date.parse(`${date}T${time}:00${TZ}`);
export const witaDate = ms => new Date(ms + 8 * H).toISOString().slice(0, 10);
export const witaTime = ms => new Date(ms + 8 * H).toISOString().slice(11, 16);
export const witaDateTimeInput = ms => witaDate(ms) + "T" + witaTime(ms);
export const fromDateTimeInput = v => Date.parse(v + ":00" + TZ);
export const addDays = (date, n) => witaDate(Date.parse(date + "T12:00:00" + TZ) + n * 24 * H);

export function fmtDate(date, long = true) {
    const d = new Date(date + "T12:00:00Z");
    return new Intl.DateTimeFormat("id-ID", { weekday: long ? "long" : "short", day: "numeric", month: long ? "long" : "short", year: "numeric", timeZone: "UTC" }).format(d);
}
export const fmtDT = ms => `${fmtDate(witaDate(ms), false)} ${witaTime(ms)}`;
export const tsMs = t => (t && typeof t.toMillis === "function") ? t.toMillis() : (typeof t === "number" ? t : 0);

export function fmtCountdown(ms) {
    if (ms <= 0) return "00:00";
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
    const p = n => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${p(m)}:${p(ss)}`;
}

export const rupiah = n => "Rp " + new Intl.NumberFormat("id-ID").format(Math.round(n || 0));
export const fmtNum = n => n ? new Intl.NumberFormat("id-ID").format(Math.round(n)) : "";
export const parseNum = s => parseInt(String(s ?? "").replace(/\D/g, ""), 10) || 0;

export function normWA(s) {
    let d = String(s || "").replace(/\D/g, "");
    if (d.startsWith("0")) d = "62" + d.slice(1);
    else if (d.startsWith("8")) d = "62" + d;
    return d;
}
export const validWA = s => /^628\d{7,12}$/.test(normWA(s));
export const waLink = (num, text) => `https://wa.me/${normWA(num)}${text ? "?text=" + encodeURIComponent(text) : ""}`;

const B32 = "abcdefghijklmnopqrstuvwxyz234567";
export function randSecret(bytes = 16) {
    const a = crypto.getRandomValues(new Uint8Array(bytes)); let bits = 0, v = 0, out = "";
    for (const x of a) { v = (v << 8) | x; bits += 8; while (bits >= 5) { out += B32[(v >>> (bits - 5)) & 31]; bits -= 5; } }
    if (bits > 0) out += B32[(v << (5 - bits)) & 31];
    return out;
}

const KA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function genKode() { const a = crypto.getRandomValues(new Uint8Array(6)); return "ARY-" + [...a].map(x => KA[x % KA.length]).join(""); }
export const normKode = s => { s = String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); if (s.startsWith("ARY")) s = s.slice(3); return s.length === 6 ? "ARY-" + s : ""; };

export async function sha256(str) {
    const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}
export const lookupId = (kode, wa) => sha256(`${normKode(kode)}|${normWA(wa)}`);

export const STATUS = {
    PENDING: ["Menunggu Konfirmasi", "#f59e0b"],
    MENUNGGU_BAYAR: ["Menunggu Pembayaran", "#3b82f6"],
    MENUNGGU_VERIFIKASI: ["Verifikasi Pembayaran", "#a78bfa"],
    TERKONFIRMASI: ["Terkonfirmasi", "#10b981"],
    CHECKED_IN: ["Sedang Bermain", "#22d3ee"],
    SELESAI: ["Selesai", "#9ca3af"],
    DITOLAK: ["Ditolak", "#ef4444"],
    HANGUS: ["Hangus", "#6b7280"],
    DIBATALKAN: ["Dibatalkan", "#9ca3af"]
};
export const HOLDING = ["MENUNGGU_BAYAR", "MENUNGGU_VERIFIKASI", "TERKONFIRMASI", "CHECKED_IN"];
export const pill = st => `<span class="pill" style="--c:${(STATUS[st] || ["", "#999"])[1]}">${esc((STATUS[st] || [st])[0])}</span>`;

export const getEndMs = b => (b.checkedInAt || b.startMs) + b.durasi * H;

export function effStatus(b, st, t = now()) {
    if (b.status === "PENDING") {
        const ttl = (st.pendingTtlHours || 24) * H;
        if (t > (b.endMs || 0) || (tsMs(b.createdAt) && t > tsMs(b.createdAt) + ttl)) return "HANGUS";
    }
    if (b.status === "MENUNGGU_BAYAR" && b.payDeadline && t > b.payDeadline) return "HANGUS";
    
    if (b.status === "TERKONFIRMASI" && t > b.startMs + (st.noShowGraceMin || 15) * 60000) return "HANGUS";
    
    if (b.status === "CHECKED_IN" && t > getEndMs(b)) return "SELESAI";
    
    return b.status;
}

const mkRooms = () => [{ name: "Room 1", rate: 0, baseCap: 4, maxCap: 10, extraPrice: 0, active: true }];
const DEF_LOK = "CABANG 1";

export const DEFAULT_SETTINGS = {
    lokasi: [DEF_LOK],
    rooms: { [DEF_LOK]: mkRooms() },
    micPrice: 0, addonPerHour: false, micPerHour: false,
    dpPercent: 50, holdMinutes: 30, bufferMin: 0, noShowGraceMin: 15, pendingTtlHours: 24, minLeadMin: 30, maxDurasi: 12,
    adminWA: "", holidays: [], policy: "DP hangus jika batal setelah pembayaran atau tidak datang.",
    templates: {
        approve: "Halo {nama} 👋\nBooking kamu di ARAYA GAMESTATION {lokasi} ({room}) pada {tanggal}, jam {jam} sudah DISETUJUI ✅\n\nSilakan bayar DP {nominal} sebelum {deadline}, lalu upload bukti di link ini:\n{link}\n\nKode booking: {kode}",
        approveCash: "Halo {nama} 👋\nBooking kamu di ARAYA GAMESTATION {lokasi} ({room}) pada {tanggal}, jam {jam} sudah DISETUJUI ✅\n\nSilakan bayar DP Cash atau Lunas langsung di kasir sebelum {deadline}.\nDetail booking: {link}\n\nKode booking: {kode}",
        reject: "Halo {nama}, mohon maaf booking kamu ({room}, {tanggal} {jam}) belum bisa kami proses.\nAlasan: {alasan}\nKamu bisa booking ulang di jam lain: {site}",
        remind: "Halo {nama}, pengingat: DP {nominal} untuk booking {room} ({tanggal} {jam}) belum kami terima. Batas bayar {deadline}.\n{link}",
        confirmed: "Halo {nama}, pembayaran DP sudah kami terima ✅\nSampai jumpa {tanggal} jam {jam} di {lokasi} ({room}). Tunjukkan QR di link ini saat datang:\n{link}\nKode: {kode}"
    }
};

export function mergeSettings(s) {
    const d = DEFAULT_SETTINGS; s = s || {};
    return { ...d, ...s, templates: { ...d.templates, ...(s.templates || {}) }, rooms: s.rooms || d.rooms, lokasi: s.lokasi || d.lokasi, holidays: s.holidays || [] };
}

export const roomCfg = (st, lokasi, room) => (st.rooms[lokasi] || []).find(r => r.name === room);
export const isHoliday = (st, lokasi, date) => (st.holidays || []).find(h => h.date === date && (h.lokasi === "ALL" || h.lokasi === lokasi));

export function calcPrice(st, room, durasi, orang, mic) {
    if (!room) return { base: 0, extraN: 0, extra: 0, micT: 0, total: 0, dp: 0 };
    const mult = st.addonPerHour ? durasi : 1;
    const extraN = Math.max(0, orang - (room.baseCap || 0));
    const base = (room.rate || 0) * durasi, extra = extraN * (room.extraPrice || 0) * mult, micT = (mic || 0) * (st.micPrice || 0) * (st.micPerHour ? durasi : 1);
    const total = base + extra + micT;
    const dp = total > 0 ? Math.round(total * (st.dpPercent || 50) / 100) : 0;
    return { base, extraN, extra, micT, total, dp };
}

export const fillTpl = (tpl, v) => String(tpl || "").replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");
export const siteLink = () => location.origin + location.pathname.replace(/[^/]*$/, "");
export const bookingLink = secret => siteLink() + "index.html#/b/" + secret;

export function toast(message, type = "info") {
    let box = $("#toasts");
    if (!box) { box = document.createElement("div"); box.id = "toasts"; box.className = "toast-stack"; document.body.appendChild(box); }
    const t = document.createElement("div"); t.className = "toast " + type;
    const icons = { success: "check_circle", error: "error", info: "info" };
    t.innerHTML = `<span class="material-icons-round" style="font-size:18px">${icons[type] || "info"}</span><span>${esc(message)}</span>`;
    box.appendChild(t);
    if (type === "error") { const fc = $(".form-card"); if (fc) { fc.classList.remove("shake"); void fc.offsetWidth; fc.classList.add("shake"); } }
    setTimeout(() => { t.style.opacity = "0"; t.style.transform = "translateX(120%)"; setTimeout(() => t.remove(), 300); }, 4200);
}

export function modal(html, { sticky = false, wide = true } = {}) {
    const ov = document.createElement("div"); ov.className = "modal-overlay";
    ov.innerHTML = `<div class="modal-card ${wide ? 'wide' : ''}">${html}</div>`;
    document.body.appendChild(ov); requestAnimationFrame(() => ov.classList.add("active"));
    const close = () => { ov.classList.remove("active"); setTimeout(() => ov.remove(), 250); };
    if (!sticky) ov.addEventListener("mousedown", e => { if (e.target === ov) close(); });
    $$("[data-close]", ov).forEach(b => b.addEventListener("click", close));
    return { el: ov.firstElementChild, close };
}

export function confirmBox(title, msg, ok = "Ya", danger = false) {
    return new Promise(res => {
        const m = modal(`<div class="modal-icon"><span class="material-icons-round">${danger ? "warning" : "help"}</span></div><h3>${esc(title)}</h3><p>${esc(msg)}</p>
        <div class="modal-actions"><button class="btn btn-ghost" data-close>Batal</button><button class="btn ${danger ? "btn-delete" : "btn-save"}" id="cbOk" style="flex:0 0 auto;padding:12px 22px">${esc(ok)}</button></div>`, { sticky: true, wide: false });
        $$("[data-close]", m.el).forEach(b => b.addEventListener("click", () => res(false)));
        $("#cbOk", m.el).addEventListener("click", () => { m.close(); res(true); });
    });
}

export function promptBox(title, msg, value = "", ok = "Kirim") {
    return new Promise(res => {
        const m = modal(`<div class="modal-icon"><span class="material-icons-round">edit_note</span></div><h3>${esc(title)}</h3><p>${esc(msg)}</p>
        <div class="form-group"><textarea id="pbIn" rows="3" maxlength="200">${esc(value)}</textarea></div>
        <div class="modal-actions"><button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-save" id="pbOk" style="flex:0 0 auto;padding:12px 22px">${esc(ok)}</button></div>`, { sticky: true, wide: false });
        const inp = $("#pbIn", m.el); inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length);
        $$("[data-close]", m.el).forEach(b => b.addEventListener("click", () => res(null)));
        $("#pbOk", m.el).addEventListener("click", () => { const v = inp.value.trim(); m.close(); res(v); });
    });
}

export function setBusy(btn, on, text) {
    if (on) { btn.dataset.o = btn.innerHTML; btn.disabled = true; btn.classList.add("btn-loading"); if (text) btn.textContent = text; }
    else { btn.disabled = false; btn.classList.remove("btn-loading"); if (btn.dataset.o) btn.innerHTML = btn.dataset.o; }
}

export async function copyText(t) { try { await navigator.clipboard.writeText(t); toast("Disalin", "success"); } catch (e) { copyBox(t); } }

function copyBox(t) {
    const m = modal(`<div class="modal-icon"><span class="material-icons-round">content_copy</span></div><h3>Salin manual</h3><p>Salin otomatis diblokir browser. Tekan lama teks di bawah lalu pilih salin.</p>
    <div class="form-group"><input id="cpIn" readonly value="${esc(t)}"></div>
    <div class="modal-actions"><button class="btn btn-ghost" data-close>Tutup</button></div>`, { wide: false });
    const inp = $("#cpIn", m.el); inp.focus(); inp.select();
}

export const icon = (n, size = 18) => `<span class="material-icons-round" style="font-size:${size}px">${n}</span>`;

export function qrSvg(text) {
    const q = window.qrcode(0, "M"); q.addData(text); q.make();
    const n = q.getModuleCount(), m = 2; let p = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) p += `M${c + m},${r + m}h1v1h-1z`;
    const t = n + m * 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${t} ${t}" shape-rendering="crispEdges"><rect width="${t}" height="${t}" fill="#fff"/><path d="${p}" fill="#000"/></svg>`;
}

export async function downloadQrPng(svgEl, filename) {
    const svgStr = new XMLSerializer().serializeToString(svgEl);
    const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    try {
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
        const size = 800;
        const canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);
        const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
        const dlUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = dlUrl;
        a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(dlUrl), 1000);
    } finally { URL.revokeObjectURL(url); }
}

export async function compressImage(file, maxSide = 1000, quality = 0.6) {
    const bmp = await createImageBitmap(file);
    const sc = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", quality);
}

export function startBackground() {
    const cv = document.getElementById("bgCanvas"); if (!cv) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cx = cv.getContext("2d"); let W, H2, mx = -9999, my = -9999;
    const resize = () => { W = cv.width = innerWidth; H2 = cv.height = innerHeight; };
    addEventListener("resize", resize); resize();
    addEventListener("mousemove", e => { mx = e.clientX; my = e.clientY; });
    const sy = ["\u25B3", "\u25CB", "\u2715", "\u25A1"], co = ["#8b5cf6", "#ec4899", "#3b82f6", "#10b981"], N = innerWidth < 600 ? 16 : 30;
    const ps = Array.from({ length: N }, (_, i) => ({ x: Math.random() * W, y: Math.random() * H2, vx: (Math.random() - .5) * .5, vy: (Math.random() - .5) * .5, size: Math.random() * 24 + 16, alpha: Math.random() * .25 + .2, rot: Math.random() * 6.28, rs: (Math.random() - .5) * .012, sym: sy[i % 4], color: co[i % 4] }));
    (function draw() {
        cx.clearRect(0, 0, W, H2);
        let g = cx.createRadialGradient(W * .25, H2 * .2, 0, W * .25, H2 * .2, W * .7); g.addColorStop(0, "rgba(139,92,246,0.07)"); g.addColorStop(1, "transparent"); cx.fillStyle = g; cx.fillRect(0, 0, W, H2);
        g = cx.createRadialGradient(W * .75, H2 * .8, 0, W * .75, H2 * .8, W * .6); g.addColorStop(0, "rgba(236,72,153,0.06)"); g.addColorStop(1, "transparent"); cx.fillStyle = g; cx.fillRect(0, 0, W, H2);
        for (const p of ps) {
            const dx = mx - p.x, dy = my - p.y, inf = Math.max(0, 1 - Math.hypot(dx, dy) / 220);
            p.x += p.vx - dx * inf * .009; p.y += p.vy - dy * inf * .009; p.rot += p.rs;
            if (p.x < -50) p.x = W + 50; if (p.x > W + 50) p.x = -50; if (p.y < -50) p.y = H2 + 50; if (p.y > H2 + 50) p.y = -50;
            cx.save(); cx.translate(p.x, p.y); cx.rotate(p.rot); cx.globalAlpha = Math.min(1, p.alpha + inf * .4); cx.shadowColor = p.color; cx.shadowBlur = inf > .02 ? 18 + inf * 40 : 8;
            cx.font = "bold " + p.size * (1 + inf * .6) + "px Arial,sans-serif"; cx.textAlign = "center"; cx.textBaseline = "middle"; cx.fillStyle = p.color; cx.fillText(p.sym, 0, 0); cx.restore();
        }
        requestAnimationFrame(draw);
    })();
}

function formatMoneyInput(el) {
    const caret = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, caret).replace(/\D/g, "").length;
    const digits = el.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    const out = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    if (out === el.value) return;
    el.value = out;
    let pos = 0, seen = 0;
    while (pos < out.length && seen < before) { if (/\d/.test(out[pos])) seen++; pos++; }
    el.setSelectionRange(pos, pos);
}

document.addEventListener("input", e => {
    if (e.target.matches?.("input[data-money]")) formatMoneyInput(e.target);
});