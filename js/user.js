import { db, doc, getDoc, onSnapshot, writeBatch, serverTimestamp } from "./fb.js";
import {
    $, $$, esc, toast, confirmBox, setBusy, copyText, icon, rupiah, fmtNum, parseNum, normWA, validWA, randSecret, genKode, normKode, lookupId,
    toMs, witaDate, witaTime, fmtDate, fmtDT, fmtCountdown, now, syncClock, pill, effStatus, mergeSettings, roomCfg, getEndMs,
    isHoliday, calcPrice, waLink, bookingLink, qrSvg, compressImage, downloadQrPng, startBackground
} from "./lib.js";
import { rangesForDay, conflictsIn, checkFree } from "./avail.js";
import { makeDynamic } from "./qris.js";

const H = 3600000, view = $("#view");
let ST = mergeSettings(null), QRC = {}, unsub = null, ticker = null, lastStatus = null;

const mine = () => { try { return JSON.parse(localStorage.getItem("araya_mine") || "[]"); } catch (e) { return []; } };
const setMine = a => { try { localStorage.setItem("araya_mine", JSON.stringify(a.slice(0, 30))); } catch (e) { } };
const remember = it => setMine([{ ...mine().find(x => x.s === it.s), ...it }, ...mine().filter(x => x.s !== it.s)]);
const patchMine = (s, patch) => setMine(mine().map(x => x.s === s ? { ...x, ...patch } : x));
const TERMINAL = ["SELESAI", "DITOLAK", "HANGUS", "DIBATALKAN"];
const forget = s => setMine(mine().filter(x => x.s !== s));
const recentSubmits = () => { try { return JSON.parse(localStorage.getItem("araya_sub") || "[]").filter(t => Date.now() - t < H); } catch (e) { return []; } };

function beepUser() {
    try {
        const c = new (window.AudioContext || window.webkitAudioContext)();
        const o = c.createOscillator(), g = c.createGain();
        o.type = "triangle";
        o.connect(g); g.connect(c.destination);
        o.frequency.value = 1046.50;
        g.gain.setValueAtTime(0.6, c.currentTime);
        g.gain.exponentialRampToValueAtTime(0.01, c.currentTime + 0.6);
        o.start(); setTimeout(() => { o.stop(); c.close(); }, 600);
    } catch (e) { }
}

function route() {
    if (unsub) { unsub(); unsub = null; } clearInterval(ticker);
    const h = location.hash || "#/", m = h.match(/^#\/b\/([a-z2-7]{20,40})$/);
    scrollTo(0, 0);
    if (m) return viewDetail(m[1]);
    if (h === "#/new") return viewForm();
    if (h === "#/find") return viewFind();
    return viewHome();
}
addEventListener("hashchange", route);

async function viewHome() {
    const list = mine();
    view.innerHTML = `
    <div class="panel steps-intro">
        <div class="step-i"><b>1</b><span>Ajukan jadwal</span></div>
        <div class="step-i"><b>2</b><span>Tunggu konfirmasi admin</span></div>
        <div class="step-i"><b>3</b><span>Bayar DP</span></div>
        <div class="step-i"><b>4</b><span>Datang &amp; main</span></div>
    </div>
    <a class="btn btn-save btn-block" href="#/new">${icon("add_circle")} Booking Baru</a>
    <div class="section-header" style="margin-top:34px"><div class="section-title">${icon("confirmation_number", 22)} Booking Saya</div><span class="count-badge">${list.length}</span></div>
    <div class="booking-grid" id="myList">${list.length ? "" : `<div class="empty-state"><span class="material-icons-round">event_busy</span><p>Belum ada booking di perangkat ini</p></div>`}</div>
    <div class="row-btns" style="margin-top:32px; justify-content: center;">
        <a class="btn btn-ghost" href="#/find">${icon("search")} Cari Booking (Link Hilang)</a>
    </div>`;
    const box = $("#myList");
    list.forEach((it, i) => {
        const card = document.createElement("div"); card.className = "booking-card"; card.style.animationDelay = i * .05 + "s";
        card.innerHTML = cardInner(it, it.st || null); box.appendChild(card);
        card.addEventListener("click", async e => {
            const f = e.target.closest("[data-forget]");
            if (f) {
                if (!await confirmBox("Hapus dari perangkat?", "Data booking ini akan dihapus dari daftar di HP ini. Booking di server admin tidak terhapus.", "Ya, Hapus")) return;
                forget(it.s); card.remove(); return;
            }
            location.hash = "#/b/" + it.s;
        });
        if (TERMINAL.includes(it.st)) return;
        getDoc(doc(db, "bookings", it.s)).then(s => {
            if (!s.exists()) { card.innerHTML = cardInner(it, "HILANG"); return; }
            const d = s.data();
            patchMine(it.s, { st: d.status });
            card.innerHTML = cardInner({ ...it, ...d, s: it.s }, effStatus(d, ST));
        }).catch(() => { });
    });
}

function cardInner(b, st) {
    const isTerminal = TERMINAL.includes(st);
    return `<div class="booking-card-header"><h3>${esc(b.kode || "")}</h3>${st === "HILANG" ? `<span class="pill" style="--c:#9ca3af">Tidak ditemukan</span>` : st ? pill(st) : `<span class="pill" style="--c:#9ca3af">Memuat…</span>`}</div>
    <div class="booking-details">
      <div class="detail-item">${icon("location_on", 16)}<span class="val">${esc(b.lokasi)} - ${esc(b.room)}</span></div>
      <div class="detail-item">${icon("event", 16)}<span class="val">${esc(b.tanggal ? fmtDate(b.tanggal, false) : "")} · ${esc(b.jamMulai || b.jam || "")}</span></div>
    </div>
    <div class="divider"></div>
    <div class="action-buttons" style="justify-content: space-between; align-items: center;">
        <span class="btn btn-ghost btn-sm" style="pointer-events:none">${icon("visibility", 14)} Lihat Detail</span>
        ${isTerminal ? `<button class="btn btn-delete btn-sm" data-forget>${icon("delete", 14)} Hapus</button>` : ""}
    </div>`;
}

function viewFind() {
    view.innerHTML = `<div class="form-card"><div class="form-title">${icon("search")}<span>Cari Booking</span></div>
    <p class="muted" style="margin:14px 0">Masukkan kode booking (contoh: ARY-7K3QXD) dan nomor WhatsApp yang dipakai saat booking.</p>
    <div class="form-grid" style="margin-top:6px">
      <div class="form-group full-width"><label>Kode Booking</label><input id="q-kode" placeholder="ARY-XXXXXX" autocapitalize="characters" maxlength="12"></div>
      <div class="form-group full-width"><label>WhatsApp</label><input id="q-wa" inputmode="tel" placeholder="08xxxxxxxxxx"></div>
    </div>
    <div class="form-actions"><button class="btn btn-save" id="q-go">${icon("search")} Cari</button></div>
    <div class="row-btns" style="margin-top:16px"><a href="#/" class="btn btn-ghost btn-block">${icon("arrow_back")} Kembali</a></div>
    </div>`;
    $("#q-go").onclick = async e => {
        const btn = e.currentTarget, kode = normKode($("#q-kode").value), wa = normWA($("#q-wa").value);
        if (!kode || !validWA(wa)) return toast("Cek lagi kode dan nomor WA-nya", "error");
        setBusy(btn, true, "Mencari…");
        try {
            const s = await getDoc(doc(db, "lookups", await lookupId(kode, wa)));
            if (!s.exists()) throw 0;
            const sec = s.data().s; const b = await getDoc(doc(db, "bookings", sec)); if (!b.exists()) throw 0;
            const d = b.data(); remember({ s: sec, kode: d.kode, nama: d.nama, lokasi: d.lokasi, room: d.room, tanggal: d.tanggal, jam: d.jamMulai, st: d.status, at: Date.now() });
            location.hash = "#/b/" + sec;
        } catch (err) { toast("Tidak ditemukan. Pastikan kode dan nomor WA sama dengan saat booking.", "error"); setBusy(btn, false); }
    };
}

let slotToken = 0;

function viewForm() {
    const today = witaDate(now());
    const retryStr = sessionStorage.getItem("araya_retry");
    const retry = retryStr ? JSON.parse(retryStr) : null;
    sessionStorage.removeItem("araya_retry");

    view.innerHTML = `<div class="form-card"><div class="form-title">${icon("edit_note")}<span>${retry ? "Sesuaikan Booking" : "Ajukan Booking"}</span></div>
    <div class="form-grid" style="margin-top:20px">
      <div class="form-group full-width"><label>Nama</label><input id="f-nama" maxlength="60" placeholder="Nama pemesan" autocomplete="name"></div>
      <div class="form-group full-width"><label>WhatsApp</label><input id="f-wa" inputmode="tel" placeholder="08xxxxxxxxxx" autocomplete="tel">
        <small class="hint">Untuk kabar konfirmasi, dan untuk mencari booking kalau link hilang.</small></div>
      <div class="form-group full-width"><label>Lokasi</label><select id="f-lokasi"><option value="">Pilih Lokasi</option>${ST.lokasi.map(l => `<option>${esc(l)}</option>`).join("")}</select></div>
      <div class="form-group full-width"><label>Room</label><select id="f-room"><option value="">Pilih lokasi dulu</option></select><small class="hint" id="f-roomhint"></small></div>
      <div class="form-group"><label>Tanggal</label><input type="date" id="f-tanggal" min="${today}"></div>
      <div class="form-group"><label>Durasi (Jam)</label>${stepper("durasi", 1, ST.maxDurasi, 1)}</div>
      <div class="form-group"><label>Jumlah Orang</label>${stepper("orang", 1, 50, 2)}</div>
      <div class="form-group"><label>Tambahan Mic</label>${stepper("mic", 0, 20, 0)}</div>
      <div class="form-group full-width"><small class="hint" id="f-orangHint"></small></div>
      <div class="form-group full-width"><label>Jam Mulai <span class="muted" id="f-jamLabel"></span></label><div id="f-slots" class="chip-grid"><p class="hint">Pilih lokasi, room, dan tanggal dulu.</p></div></div>
      <div class="form-group full-width"><label>Catatan</label><textarea id="f-catatan" rows="2" maxlength="300" placeholder="Opsional" style="resize:vertical"></textarea></div>
      <div class="form-group full-width"><div class="est" id="f-est"></div></div>
    </div>
    <div class="form-actions"><button class="btn btn-save" type="button" id="f-submit">${icon("send")} Ajukan Booking</button></div>
    <p class="muted center" style="margin-top:14px">Mengajukan ≠ dapat slot. Slot dikunci setelah admin menyetujui.</p>
    <div class="row-btns" style="margin-top:16px"><a href="#/" class="btn btn-ghost btn-block">${icon("arrow_back")} Kembali</a></div>
    </div>`;

    let jam = null;
    const rd = () => ({
        nama: $("#f-nama").value.trim(), wa: $("#f-wa").value, lokasi: $("#f-lokasi").value, room: $("#f-room").value, tanggal: $("#f-tanggal").value,
        durasi: parseInt($("#f-durasi").value) || 0, orang: parseInt($("#f-orang").value) || 0, mic: parseInt($("#f-mic").value) || 0, catatan: $("#f-catatan").value.trim(), jam
    });
    const fillRooms = () => {
        const l = $("#f-lokasi").value, rs = (ST.rooms[l] || []).filter(r => r.active !== false);
        $("#f-room").innerHTML = l ? `<option value="">Pilih Room</option>` + rs.map(r => `<option>${esc(r.name)}</option>`).join("") : `<option value="">Pilih lokasi dulu</option>`;
    };
    const info = () => {
        const oi = $("#f-orang"), cap = roomCfg(ST, $("#f-lokasi").value, $("#f-room").value);
        oi.max = (cap && cap.maxCap) || 50;
        if (+oi.value > +oi.max) oi.value = oi.max;
        const di = $("#f-durasi"), minD = (cap && cap.minDurasi) || 1;
        di.min = minD;
        if (+di.value < minD) { di.value = minD; jam = null; }
        const v = rd(), r = roomCfg(ST, v.lokasi, v.room);
        $("#f-roomhint").textContent = r ? `Kapasitas ${r.baseCap} orang${r.maxCap ? `, maksimal ${r.maxCap}` : ""}.${minD > 1 ? ` Minimal sewa ${minD} jam.` : ""} Lebih dari kapasitas dikenakan biaya tambahan per orang.` : "";
        const oh = $("#f-orangHint");
        if (r) {
            const x = Math.max(0, v.orang - r.baseCap);
            oh.textContent = r.maxCap && v.orang > r.maxCap ? `Maksimal ${r.maxCap} orang untuk room ini.` : x > 0 ? `${v.orang} orang → ${x} orang tambahan${r.extraPrice ? ` (+${rupiah(r.extraPrice)}${ST.addonPerHour ? "/jam" : ""} per orang)` : ""}.` : `${v.orang} orang masih dalam kapasitas, tanpa biaya tambahan.`;
        } else oh.textContent = "";
        const est = $("#f-est");
        if (!r) { est.innerHTML = ""; return; }
        const p = calcPrice(ST, r, v.durasi, v.orang, v.mic);
        est.innerHTML = r.rate ? `
          <div class="kv"><span>Room ${v.durasi} jam</span><b>${rupiah(p.base)}</b></div>
          ${p.extraN ? `<div class="kv"><span>${p.extraN} orang tambahan${ST.addonPerHour ? ` × ${v.durasi} jam` : ""}</span><b>${rupiah(p.extra)}</b></div>` : ""}
          ${v.mic ? `<div class="kv"><span>${v.mic} mic${ST.micPerHour ? ` × ${v.durasi} jam` : ""}</span><b>${rupiah(p.micT)}</b></div>` : ""}
          <div class="kv"><span>Estimasi total</span><b>${rupiah(p.total)}</b></div>
          <div class="kv highlight"><span>Minimal DP (${ST.dpPercent}%)</span><b>${rupiah(p.dp)}</b></div>
          <small class="hint">Angka final dikonfirmasi admin.</small>` : `<small class="hint">Tarif akan dikonfirmasi admin saat booking disetujui.</small>`;
    };
    const slots = async () => {
        const v = rd(), box = $("#f-slots"), my = ++slotToken;
        if (!v.lokasi || !v.room || !v.tanggal || !v.durasi) { box.innerHTML = `<p class="hint">Pilih lokasi, room, dan tanggal dulu.</p>`; return; }
        const hol = isHoliday(ST, v.lokasi, v.tanggal);
        if (hol) { 
            jam = null; 
            box.innerHTML = `<div class="banner warn">${icon("event_busy")}<span>Kami tutup di tanggal tersebut karena ${hol.alasan ? esc(hol.alasan) : "ada acara"}. Mohon pilih tanggal lain.</span></div>`; 
            return; 
        }
        box.innerHTML = `<p class="hint">Memuat jam tersedia…</p>`;
        const ranges = await rangesForDay(v.lokasi, v.room, v.tanggal);
        if (my !== slotToken) return;
        const t = now(), buf = ST.bufferMin * 60000; let html = "", n = 0;
        for (let i = 0; i < 48; i++) {
            const tm = String(Math.floor(i / 2)).padStart(2, "0") + ":" + (i % 2 ? "30" : "00"), s = toMs(v.tanggal, tm), e = s + v.durasi * H;
            const bad = s < t + ST.minLeadMin * 60000 || conflictsIn(ranges, s, e, buf, t).length > 0 || !!isHoliday(ST, v.lokasi, witaDate(e - 1));
            if (!bad) n++;
            html += `<button type="button" class="chip${bad ? " off" : ""}${!bad && jam === tm ? " on" : ""}" data-t="${tm}" ${bad ? "disabled" : ""}>${tm}</button>`;
        }
        box.innerHTML = html;
        if (jam && !box.querySelector(`.chip.on`)) jam = null;
        $("#f-jamLabel").textContent = n ? "" : "— tidak ada jam kosong, coba tanggal/durasi lain";
    };
    const all = () => { info(); slots(); };
    $("#f-lokasi").onchange = () => { fillRooms(); jam = null; all(); };
    ["f-room", "f-tanggal"].forEach(id => $("#" + id).addEventListener("change", () => { jam = null; all(); }));
    $$(".stepper", view).forEach(st => {
        const inp = $("input", st), clamp = v => Math.min(+inp.max, Math.max(+inp.min, v));
        $$(".stepper-btn", st).forEach(b => b.onclick = () => { inp.value = clamp((parseInt(inp.value) || +inp.min) + (+b.dataset.d)); if (inp.id === "f-durasi") jam = null; inp.id === "f-durasi" ? all() : info(); });
        inp.onchange = () => { inp.value = clamp(parseInt(inp.value) || +inp.min); if (inp.id === "f-durasi") { jam = null; all(); } else info(); };
    });
    $("#f-slots").addEventListener("click", e => { const c = e.target.closest(".chip"); if (!c || c.disabled) return; jam = c.dataset.t; $$(".chip", $("#f-slots")).forEach(x => x.classList.toggle("on", x === c)); });

    info();

    if (retry) {
        $("#f-nama").value = retry.nama;
        $("#f-wa").value = retry.wa;
        $("#f-lokasi").value = retry.lokasi;
        fillRooms();
        $("#f-room").value = retry.room;
        $("#f-tanggal").value = retry.tanggal;
        $("#f-durasi").value = retry.durasi;
        $("#f-orang").value = retry.orang;
        $("#f-mic").value = retry.mic;
        $("#f-catatan").value = retry.catatan;
        all();
    }

    $("#f-submit").onclick = async e => {
        const btn = e.currentTarget, v = rd(), r = roomCfg(ST, v.lokasi, v.room);
        if (!v.nama) return toast("Isi nama dulu", "error");
        if (!validWA(v.wa)) return toast("Nomor WhatsApp tidak valid (contoh 08123456789)", "error");
        if (!r || !v.tanggal || !v.jam || !v.durasi) return toast("Lengkapi lokasi, room, tanggal, durasi, dan jam mulai", "error");
        if (r.maxCap && v.orang > r.maxCap) return toast(`Maksimal ${r.maxCap} orang untuk ${r.name}`, "error");
        if (v.durasi < (r.minDurasi || 1)) return toast(`Minimal sewa ${r.name} adalah ${r.minDurasi} jam`, "error");
        if (recentSubmits().length >= 5) return toast("Terlalu banyak pengajuan dalam 1 jam. Coba lagi nanti atau hubungi admin.", "error");
        const s = toMs(v.tanggal, v.jam), e2 = s + v.durasi * H;
        if (s < now() + ST.minLeadMin * 60000) return toast("Jam itu sudah terlewat, pilih jam lain", "error");
        setBusy(btn, true, "Mengirim…");
        try {
            if (!(await checkFree(v.lokasi, v.room, s, e2, ST.bufferMin * 60000, true))) { toast("Jam itu baru saja terisi. Pilih jam lain.", "error"); setBusy(btn, false); jam = null; slots(); return; }
            const secret = randSecret(16), kode = genKode(), wa = normWA(v.wa), p = calcPrice(ST, r, v.durasi, v.orang, v.mic);
            const data = { bid: randSecret(8), kode, nama: v.nama, wa, lokasi: v.lokasi, room: v.room, tanggal: v.tanggal, jamMulai: v.jam, durasi: v.durasi, startMs: s, endMs: e2, orang: v.orang, mic: v.mic, estTotal: p.total, status: "PENDING", tipe: "ONLINE", createdAt: serverTimestamp() };
            if (v.catatan) data.catatan = v.catatan;
            const batch = writeBatch(db);
            batch.set(doc(db, "bookings", secret), data);
            batch.set(doc(db, "lookups", await lookupId(kode, wa)), { s: secret });
            await batch.commit();
            remember({ s: secret, kode, nama: v.nama, lokasi: v.lokasi, room: v.room, tanggal: v.tanggal, jam: v.jam, st: "PENDING", at: Date.now() });
            try { localStorage.setItem("araya_sub", JSON.stringify([...recentSubmits(), Date.now()])); } catch (x) { }
            sessionStorage.setItem("araya_new", secret);
            location.hash = "#/b/" + secret;
        } catch (err) {
            console.error(err); toast(err.code === "permission-denied" ? "Data ditolak sistem. Cek isian lalu coba lagi." : "Gagal mengirim. Cek koneksi lalu coba lagi.", "error"); setBusy(btn, false);
        }
    };
}

function stepper(id, mn, mx, val) {
    return `<div class="stepper"><button class="stepper-btn" type="button" data-d="-1">−</button><input type="number" id="f-${id}" min="${mn}" max="${mx}" value="${val}" inputmode="numeric"><button class="stepper-btn" type="button" data-d="1">+</button></div>`;
}

function viewDetail(secret) {
    view.innerHTML = `<div class="panel center muted">Memuat booking…</div>`;
    let last = null, fresh = sessionStorage.getItem("araya_new") === secret;
    const ui = { proof: null, sender: "", payMethod: null, payType: "DP_MIN", manualAmount: 0, qrGenerated: false, qrAmount: 0 };
    lastStatus = null;
    const draw = () => { if (last) renderDetail(secret, last, fresh, ui, draw); };

    unsub = onSnapshot(doc(db, "bookings", secret), s => {
        if (!s.exists()) { view.innerHTML = `<div class="panel center"><span class="material-icons-round big">link_off</span><h3>Booking tidak ditemukan</h3><p class="muted">Link salah, atau booking sudah dihapus admin.</p><p><a class="btn btn-ghost" href="#/find">Cari pakai kode</a> <a class="btn btn-ghost" href="#/">Beranda</a></p></div>`; forget(secret); return; }
        const d = s.data();

        if (lastStatus && lastStatus !== d.status && ["MENUNGGU_BAYAR", "TERKONFIRMASI", "DITOLAK", "MENUNGGU_VERIFIKASI"].includes(d.status)) {
            beepUser();
        }
        if (lastStatus && lastStatus !== "MENUNGGU_BAYAR" && d.status === "MENUNGGU_BAYAR") {
            ui.payMethod = null;
            ui.payType = "DP_MIN";
            ui.manualAmount = 0;
            ui.qrGenerated = false;
            ui.qrAmount = 0;
        }
        lastStatus = d.status;

        last = d; remember({ s: secret, kode: last.kode, nama: last.nama, lokasi: last.lokasi, room: last.room, tanggal: last.tanggal, jam: last.jamMulai, st: last.status, at: Date.now() });
        draw();
    }, err => { view.innerHTML = `<div class="panel center"><h3>Gagal memuat</h3><p class="muted">Cek koneksi internet kamu lalu muat ulang.</p></div>`; });

    ticker = setInterval(() => {
        if (!last) return; let expire = false;
        $$("[data-cd]").forEach(el => { const left = +el.dataset.cd - now(); el.textContent = fmtCountdown(left); if (left <= 0) expire = true; });
        if (expire) draw();
    }, 1000);
}

function renderDetail(secret, b, fresh, ui, draw) {
    const eff = effStatus(b, ST), link = bookingLink(secret), r = roomCfg(ST, b.lokasi, b.room);
    const extra = r ? Math.max(0, b.orang - r.baseCap) : 0;
    const stage = { PENDING: 0, MENUNGGU_BAYAR: 1, MENUNGGU_VERIFIKASI: 2, TERKONFIRMASI: 3, CHECKED_IN: 3, SELESAI: 3 }[eff];
    const names = ["Diajukan", "Disetujui", "Dibayar", "Siap main"];
    const stepsHtml = stage === undefined ? "" : `<div class="steps">${names.map((n, i) => `<div class="step ${i < stage ? "done" : i === stage ? "now" : ""}"><i></i><span>${n}</span></div>`).join("")}</div>`;
    
    // --- LOGIKA DINAMIS PESAN WA ADMIN ---
    const isEarlyStage = ["PENDING", "MENUNGGU_BAYAR"].includes(eff);
    const waText = isEarlyStage 
        ? `Halo admin, saya *${b.nama}* (Kode: *${b.kode}*). Mohon konfirmasi booking saya untuk tanggal ${fmtDate(b.tanggal, false)} jam ${b.jamMulai}. Terima kasih.`
        : `Halo admin, saya *${b.nama}* (Kode: *${b.kode}*). Saya ingin mengubah jadwal / bertanya mengenai booking saya untuk tanggal ${fmtDate(b.tanggal, false)} jam ${b.jamMulai}. Terima kasih.`;
    const adminWA = ST.adminWA ? waLink(ST.adminWA, waText) : "";

    let body = "";

    if (fresh) body += `<div class="banner ok">${icon("check_circle")}<div><b>Permintaan terkirim!</b><br>Simpan link halaman ini. Kamu juga bisa kembali kapan saja pakai <b>kode ${esc(b.kode)}</b> + nomor WA.</div></div>`;

    if (eff === "PENDING") body += `<div class="panel"><h3>${icon("hourglass_top")} Menunggu konfirmasi admin</h3><p class="muted center">Slot belum terkunci. Admin akan mengecek kondisi room, lalu kamu akan dikabari lewat WhatsApp. Halaman ini otomatis berubah saat ada kabar.</p></div>`;

    if (eff === "MENUNGGU_BAYAR") {
        const d = b.dpDue || Math.round((b.total || 0) * (ST.dpPercent || 50) / 100);
        const total = b.total || 0;
        const finalAmount = ui.payType === "LUNAS" ? total : ui.payType === "DP_MANUAL" ? ui.qrAmount : d;

        body += `<div class="panel pay"><h3>${icon("payments")} Pilih Metode Pembayaran</h3>
          <div class="countdown" data-cd="${b.payDeadline}">${fmtCountdown(b.payDeadline - now())}</div><p class="muted center">Batas bayar: ${esc(fmtDT(b.payDeadline))} WITA</p>`;

        if (!ui.payMethod) {
            body += `<div class="form-grid" style="margin-top:16px; gap: 12px;">
                <button class="btn btn-save" type="button" id="pickQris" style="flex-direction:column; padding:14px 10px; height:auto; border-radius: 0; clip-path: polygon(16px 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%, 0 16px); box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3); background: linear-gradient(135deg, #8b5cf6, #ec4899); background-size: 200% auto; animation: shimmer 3s linear infinite;">
                    ${icon("qr_code_2", 28)}<br><b style="font-size:15px; margin-top:4px;">QRIS</b>
                </button>
                <button class="btn btn-save" type="button" id="pickCash" style="flex-direction:column; padding:14px 10px; height:auto; border-radius: 0; clip-path: polygon(16px 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%, 0 16px); background: linear-gradient(135deg, #10b981, #3b82f6); background-size: 200% auto; animation: shimmer 3s linear infinite;">
                    ${icon("payments", 28)}<br><b style="font-size:15px; margin-top:4px;">CASH</b>
                </button>
            </div>`;
        } else if (ui.payMethod === "QRIS") {
            body += `<div class="kv total"><span>Total Tagihan</span><b>${rupiah(total)}</b></div>
            <div class="row-btns" style="margin-top:16px; margin-bottom:8px; gap:8px; justify-content:center;">
                <button class="btn btn-sm ${ui.payType === 'DP_MIN' ? 'btn-save' : 'btn-ghost'}" type="button" data-pt="DP_MIN">DP</button>
                <button class="btn btn-sm ${ui.payType === 'DP_MANUAL' ? 'btn-save' : 'btn-ghost'}" type="button" data-pt="DP_MANUAL">DP Manual</button>
                <button class="btn btn-sm ${ui.payType === 'LUNAS' ? 'btn-save' : 'btn-ghost'}" type="button" data-pt="LUNAS">Lunas</button>
            </div>
            <p class="muted center" style="margin-bottom:16px; font-size:12px">Minimal DP: ${rupiah(d)} (${ST.dpPercent}%)</p>
            ${ui.payType === 'DP_MANUAL' ? `
                <div class="form-group" style="margin-bottom:8px;">
                    <label>Nominal DP (Rp)</label>
                    <input id="manualDp" data-money inputmode="numeric" value="${ui.manualAmount ? fmtNum(ui.manualAmount) : ''}" placeholder="Minimal ${rupiah(d)}">
                    <small class="hint" id="dpWarn" style="color:var(--danger); display:${(ui.manualAmount > 0 && ui.manualAmount < d) || ui.manualAmount > total ? 'block' : 'none'}; margin-top:4px;">
                        ${ui.manualAmount > 0 && ui.manualAmount < d ? `Minimal DP adalah ${rupiah(d)}` : ui.manualAmount > total ? `Maksimal adalah ${rupiah(total)} (Lunas)` : ''}
                    </small>
                </div>
                <button class="btn btn-ghost btn-block" type="button" id="btnGenQr" style="margin-bottom:16px;">${icon("qr_code_2")} Tampilkan QRIS</button>
            ` : ''}
            `;

            if (ui.payType === 'DP_MANUAL') {
                if (!ui.qrGenerated) {
                    body += `<div class="banner warn" style="justify-content:center;">${icon("info")}<span>Masukkan nominal, lalu klik "Tampilkan QRIS".</span></div>`;
                } else if (ui.qrAmount !== ui.manualAmount) {
                    body += `<div class="banner warn" style="justify-content:center; flex-direction:column;">
                                ${icon("warning")}<span>Nominal berubah. QR di bawah ini masih menggunakan nominal <b>${rupiah(ui.qrAmount)}</b>. Klik tombol di atas untuk memperbarui.</span>
                            </div>`;
                }
            }

            const displayAmount = ui.payType === 'DP_MANUAL' ? ui.qrAmount : finalAmount;
            const isQrValid = displayAmount >= d && displayAmount <= total;

            const manualQrReady = ui.payType !== "DP_MANUAL" || (ui.qrGenerated && ui.qrAmount === ui.manualAmount && isQrValid);
            if (!manualQrReady) {
                if (ui.qrGenerated && ui.qrAmount !== ui.manualAmount) {
                    body += `<div class="banner warn" style="justify-content:center;">${icon("warning")}<span>Nominal berubah. Tampilkan QRIS lagi untuk membuat QR dengan nominal terbaru.</span></div>`;
                }
            } else {
                const q = QRC[b.lokasi] || QRC.DEFAULT; let qr = "", errMsg = "";
                if (!q || !q.payload) {
                    errMsg = "Admin belum mengunggah QRIS untuk cabang ini.";
                } else if (!isQrValid) {
                    errMsg = "Nominal tidak valid.";
                } else {
                    try { qr = qrSvg(makeDynamic(q.payload, displayAmount)); } 
                    catch (e) { 
                        console.error("QRIS Error:", e);
                        errMsg = "Format QRIS error, hubungi admin."; 
                    }
                }
                
                body += qr ? `<div id="qrResultBox">
                  <div class="pay-amount"><small>Nominal Tagihan</small><div class="nominal" id="nominal">${rupiah(displayAmount)}</div></div>
                  <div class="qr-box" id="payQrBox">${qr}</div>
                  <div class="row-btns" style="justify-content:center">
                    <button class="btn btn-ghost" type="button" id="dlQr">${icon("download", 16)} Unduh QR</button>
                  </div>
                  <p class="center muted">${esc(q.merchant || "ARAYA GAMESTATION")}</p>
                </div>
                <div id="qrWarnBox" class="banner warn" style="display:none; justify-content:center; flex-direction:column;"></div>` 
                : `<div class="banner warn">${icon("info")}<span>${errMsg || "QRIS belum tersedia."}</span></div>`;
                
                body += `<div class="proof"><label>Bukti pembayaran <small class="muted">(Wajib berupa screenshot)</small></label><input type="file" id="proofFile" accept="image/*"><img id="proofPrev" class="proof-prev" ${ui.proof ? "" : "hidden"} src="${ui.proof || ""}">
                <label>Nama pengirim / e-wallet <small class="muted">(opsional)</small></label><input id="sender" maxlength="40" placeholder="Nama di e-wallet / rekening" value="${ui.sender || ""}">
                <button class="btn btn-save btn-block" type="button" id="paidBtn">${icon("task_alt")} Saya Sudah Bayar</button>
                <small class="muted">Tekan hanya setelah transfer berhasil. Admin akan mencocokkan dengan mutasi QRIS.</small></div>`;
            }
            body += `<button class="btn btn-ghost btn-sm" type="button" id="backMethod" style="margin-top:12px;">Ganti Metode</button>`;
        } else if (ui.payMethod === "CASH") {
            body += `<div class="kv total"><span>Total Tagihan</span><b>${rupiah(total)}</b></div>
            <p class="muted center" style="margin-top:12px">Silakan pilih Anda mau bayar DP atau Lunas di kasir. Admin akan mengonfirmasi nominal yang Anda bayarkan.</p>
            <div class="row-btns" style="margin-top:16px; margin-bottom:8px; gap:8px; justify-content:center;">
                <button class="btn btn-sm ${ui.payType === 'DP_MIN' ? 'btn-save' : 'btn-ghost'}" type="button" data-pt="DP_MIN">DP</button>
                <button class="btn btn-sm ${ui.payType === 'LUNAS' ? 'btn-save' : 'btn-ghost'}" type="button" data-pt="LUNAS">Lunas</button>
            </div>
            <p class="muted center" style="margin-bottom:16px; font-size:12px">Minimal DP: ${rupiah(d)} (${ST.dpPercent}%)</p>
            <div class="pay-amount"><small>Nominal Tagihan</small><div class="nominal">${rupiah(finalAmount)}</div></div>
            <button class="btn btn-save btn-block" type="button" id="paidCashBtn">${icon("storefront")} Konfirmasi Bayar Cash</button>
            <button class="btn btn-ghost btn-sm" type="button" id="backMethod" style="margin-top:12px;">Ganti Metode</button>`;
        }
        body += `</div>`;
    }

    if (eff === "HANGUS" && b.status === "MENUNGGU_BAYAR") body += `<div class="panel"><h3>${icon("timer_off")} Waktu pembayaran habis</h3><p class="muted center">Slot dilepas. Kalau kamu <b>sudah terlanjur transfer</b>, segera hubungi admin dengan kode ${esc(b.kode)}.</p></div>`;
    else if (eff === "HANGUS") body += `<div class="panel"><h3>${icon("timer_off")} Permintaan hangus</h3><p class="muted center">Admin belum sempat memproses atau kamu melewati batas waktu. Kamu bisa mengajukan lagi.</p><a class="btn btn-save btn-block" href="#/new">${icon("add_circle", 16)} Booking Lagi</a></div>`;
    
    // --- STATUS MENUNGGU VERIFIKASI (DIBEDAKAN QRIS & CASH) ---
    if (eff === "MENUNGGU_VERIFIKASI") {
        const isCash = b.dpMethod === "CASH";
        body += `<div class="panel">
            <h3>${icon("fact_check")} ${isCash ? "Konfirmasi Pembayaran CASH" : "Pembayaran sedang diverifikasi"}</h3>
            <p class="muted center">${isCash 
                ? "Anda memilih metode pembayaran CASH. Jika ingin mengubah hari/tanggal atau ada kendala, silakan hubungi WA Admin di bawah."
                : "Terima kasih! Admin sedang mencocokkan bukti pembayaranmu. Jika ingin mengubah hari/tanggal, silakan hubungi WA Admin di bawah."
            }</p>
        </div>`;
    }
    
    if (eff === "TERKONFIRMASI" || eff === "CHECKED_IN") {
        body += `<div class="panel ok"><h3>${icon(eff === "CHECKED_IN" ? "sports_esports" : "verified")} ${eff === "CHECKED_IN" ? "Selamat bermain!" : "Booking terkonfirmasi"}</h3>`;
        if (eff === "TERKONFIRMASI") {
            if (b.dpMethod === "CASH" && !b.dpPaid) {
                body += `<div class="banner warn" style="margin-bottom: 12px;">${icon("info")}<span>Silakan bayar DP Cash (${rupiah(b.dpDue)}) atau Lunas (${rupiah(b.total)}) di kasir. Tunjukkan QR di bawah ini.</span></div>`;
            }
            body += `<p class="muted center">Tunjukkan QR ini ke admin saat datang. Datang paling lambat ${ST.noShowGraceMin} menit setelah jam mulai.</p><div class="qr-box">${qrSvg(b.kode)}</div><div class="big-code">${esc(b.kode)}</div>`;
        } else {
            const endT = getEndMs(b);
            body += `<p class="muted center">Sesi berjalan sampai ${esc(witaTime(endT))}.</p>`;
            body += `<div class="countdown" data-cd="${endT}">${fmtCountdown(endT - now())}</div>`;
        }
        body += `</div>`;
    }
    
    if (eff === "SELESAI") body += `<div class="panel center"><h3>${icon("celebration")} Terima kasih sudah main!</h3><p class="muted">Sampai ketemu lagi di ARAYA GAMESTATION.</p><a class="btn btn-save btn-block" href="#/new">${icon("add_circle", 16)} Booking Lagi</a></div>`;
    if (eff === "DITOLAK") {
        body += `<div class="panel bad"><h3>${icon("cancel")} Belum bisa diproses</h3><p class="center">${esc(b.rejectReason || "Jadwal tidak tersedia.")}</p>
        <button class="btn btn-save btn-block" type="button" id="retryBtn">${icon("refresh")} Sesuaikan & Ajukan Ulang</button></div>`;
    }
    if (eff === "DIBATALKAN") body += `<div class="panel"><h3>${icon("block")} Booking dibatalkan</h3></div>`;
    if (b.payNote && eff === "MENUNGGU_BAYAR") body += `<div class="banner warn">${icon("report")}<span>Catatan admin: ${esc(b.payNote)}</span></div>`;

    const method = b.dpMethod === "CASH" ? "CASH" : b.dpMethod === "QRIS" ? "QRIS" : "-";
    const money = b.total ? `<div class="kv"><span>Total</span><b>${rupiah(b.total)}</b></div><div class="kv"><span>Metode</span><b>${method}</b></div>${b.dpPaid ? `<div class="kv"><span>${b.dpPaid >= (b.total || 0) ? 'Lunas' : 'DP diterima'}</span><b class="okc">${rupiah(b.dpPaid)}</b></div>` : ""}` : b.estTotal ? `<div class="kv"><span>Estimasi total</span><b>${rupiah(b.estTotal)}</b></div>` : "";
    const canCancel = ["PENDING", "MENUNGGU_BAYAR"].includes(eff);

    view.innerHTML = `<div class="detail-head"><a href="#/" class="btn btn-ghost btn-sm">${icon("arrow_back", 16)} Beranda</a>${pill(eff)}</div>
    ${stepsHtml}${body}
    <div class="panel"><h3>${icon("receipt_long")} Detail</h3>
      <div class="kv"><span>Kode booking</span><b class="mono">${esc(b.kode)}</b></div>
      <div class="kv"><span>Lokasi / Room</span><b>${esc(b.lokasi)} · ${esc(b.room)}</b></div>
      <div class="kv"><span>Tanggal</span><b>${esc(fmtDate(b.tanggal))}</b></div>
      <div class="kv"><span>Jam</span><b>${esc(b.jamMulai)} – ${esc(witaTime(b.endMs))} (${b.durasi} jam)</b></div>
      <div class="kv"><span>Orang</span><b>${b.orang}${extra ? ` (+${extra} tambahan)` : ""}</b></div>${b.mic ? `<div class="kv"><span>Mic tambahan</span><b>${b.mic}</b></div>` : ""}
      <div class="kv"><span>Atas nama</span><b>${esc(b.nama)}</b></div>${b.catatan ? `<div class="kv"><span>Catatan</span><b>${esc(b.catatan)}</b></div>` : ""}${money}</div>
    <div class="panel"><h3>${icon("bookmark")} Akses Booking &amp; Bantuan</h3><p class="muted">Simpan link ini agar kamu bisa mengecek status booking kapan saja. Jika link hilang atau butuh bantuan, silakan hubungi admin via WhatsApp untuk mempercepat konfirmasi.</p>
      <div class="row-btns" style="justify-content: center; gap: 12px;">
        <button class="btn btn-ghost" type="button" id="copyLink">${icon("link", 16)} Salin Link</button>
        ${adminWA ? `<a class="btn btn-wa" target="_blank" rel="noopener" href="${adminWA}">${icon("support_agent", 16)} WA Admin</a>` : ""}
      </div>
    </div>
    ${canCancel ? `<button class="btn btn-delete btn-block" type="button" id="cancelBtn">${icon("close", 16)} Batalkan booking</button>` : ""}
    <p class="muted center" style="margin-top:14px">${esc(ST.policy)}</p>`;

    if (fresh) sessionStorage.removeItem("araya_new");

    $("#retryBtn")?.addEventListener("click", () => {
        sessionStorage.setItem("araya_retry", JSON.stringify({
            nama: b.nama, wa: b.wa, lokasi: b.lokasi, room: b.room, tanggal: b.tanggal,
            durasi: b.durasi, orang: b.orang, mic: b.mic || 0, catatan: b.catatan || ""
        }));
        location.hash = "#/new";
    });

    $("#copyLink")?.addEventListener("click", () => copyText(link));
    $("#dlQr")?.addEventListener("click", async () => {
        const svg = document.querySelector("#payQrBox svg");
        if (!svg) return;
        try { await downloadQrPng(svg, `qris-${b.kode || "araya"}.png`); toast("QR tersimpan. Buka galeri untuk scan di e-wallet.", "success"); }
        catch (e) { toast("Gagal mengunduh QR", "error"); }
    });
    $("#cancelBtn")?.addEventListener("click", async () => {
        const msg = b.status === "MENUNGGU_BAYAR" ? "Jika sudah transfer, hubungi admin dulu sebelum membatalkan." : "Permintaan booking ini akan dibatalkan.";
        if (!await confirmBox("Batalkan booking?", msg, "Ya, batalkan", true)) return;
        try { await writeUser(secret, { status: "DIBATALKAN", cancelBy: "USER" }); toast("Booking dibatalkan", "success"); } catch (e) { toast("Gagal membatalkan", "error"); }
    });

    if (eff === "MENUNGGU_BAYAR") {
        const d = b.dpDue || Math.round((b.total || 0) * (ST.dpPercent || 50) / 100);
        const total = b.total || 0;

        $("#pickQris")?.addEventListener("click", () => { ui.payMethod = "QRIS"; draw(); });
        $("#pickCash")?.addEventListener("click", () => { ui.payMethod = "CASH"; draw(); });
        $("#backMethod")?.addEventListener("click", () => { ui.payMethod = null; ui.payType = "DP_MIN"; ui.qrGenerated = false; draw(); });

        $$("[data-pt]").forEach(btn => btn.addEventListener("click", () => {
            ui.payType = btn.dataset.pt;
            if (ui.payType !== "DP_MANUAL") ui.qrGenerated = true;
            else ui.qrGenerated = false;
            draw();
        }));

        $("#manualDp")?.addEventListener("input", e => {
            ui.manualAmount = parseNum(e.target.value);
            const warn = $("#dpWarn");
            if (warn) {
                if (ui.manualAmount > 0 && ui.manualAmount < d) {
                    warn.textContent = `Minimal DP adalah ${rupiah(d)}`;
                    warn.style.display = 'block';
                } else if (ui.manualAmount > total) {
                    warn.textContent = `Maksimal adalah ${rupiah(total)} (Lunas)`;
                    warn.style.display = 'block';
                } else {
                    warn.style.display = 'none';
                }
            }

            if (ui.qrGenerated && ui.qrAmount !== ui.manualAmount) {
                const resBox = $("#qrResultBox");
                if (resBox) resBox.style.display = "none";
                let warnBox = $("#qrWarnBox");
                if (warnBox) {
                    warnBox.style.display = "flex";
                    warnBox.innerHTML = `${icon("warning")}<span>Nominal berubah. QR sebelumnya menggunakan nominal <b>${rupiah(ui.qrAmount)}</b>. Klik "Tampilkan QRIS" lagi untuk memperbarui.</span>`;
                }
            } else if (ui.qrGenerated && ui.qrAmount === ui.manualAmount) {
                const resBox = $("#qrResultBox");
                if (resBox) resBox.style.display = "block";
                let warnBox = $("#qrWarnBox");
                if (warnBox) warnBox.style.display = "none";
            }
        });

        $("#btnGenQr")?.addEventListener("click", event => {
            event.preventDefault();
            const input = $("#manualDp");
            if (!input) {
                toast("Kolom nominal DP tidak ditemukan. Muat ulang halaman.", "error");
                return;
            }

            const val = parseNum(input.value);
            ui.manualAmount = val;

            if (val < d) {
                toast(`Minimal DP adalah ${rupiah(d)}`, "error");
                input.focus();
                return;
            }
            if (val > total) {
                toast(`Maksimal adalah ${rupiah(total)}`, "error");
                input.focus();
                return;
            }

            ui.qrGenerated = true;
            ui.qrAmount = val;
            try {
                draw();
                const qrBox = document.querySelector("#payQrBox");
                if (qrBox) {
                    setTimeout(() => qrBox.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
                }
            } catch (error) {
                ui.qrGenerated = false;
                console.error("Gagal menampilkan QRIS:", error);
                toast("QRIS gagal dibuat. Periksa QRIS merchant atau coba muat ulang halaman.", "error");
                draw();
            }
        });

        $("#proofFile")?.addEventListener("change", async e => {
            const f = e.target.files[0]; if (!f) return;
            if (ui.proof) {
                if (!await confirmBox("Ganti Bukti?", "Bukti pembayaran sebelumnya akan diganti. Lanjutkan?", "Ya, Ganti")) {
                    e.target.value = "";
                    return;
                }
            }
            try { ui.proof = await compressImage(f); const im = $("#proofPrev"); im.src = ui.proof; im.hidden = false; } catch (x) { toast("Gambar tidak bisa dibaca", "error"); }
        });
        $("#sender")?.addEventListener("input", e => { ui.sender = e.target.value; });

        $("#paidBtn")?.addEventListener("click", async e => {
            const btn = e.currentTarget;
            const amtToPay = ui.payType === 'DP_MANUAL' ? ui.qrAmount : (ui.payType === 'LUNAS' ? total : d);
            if (ui.payType === "DP_MANUAL" && (!ui.qrGenerated || ui.qrAmount !== ui.manualAmount || !document.querySelector("#payQrBox svg"))) {
                return toast("Tampilkan QRIS untuk nominal terbaru sebelum mengirim pembayaran.", "error");
            }
            if (!Number.isFinite(amtToPay) || amtToPay < d || amtToPay > total) return toast(`Nominal harus antara ${rupiah(d)} dan ${rupiah(total)}`, "error");
            if (!document.querySelector("#payQrBox svg")) return toast("QRIS belum berhasil dibuat. Periksa QRIS merchant atau hubungi admin.", "error");
            if (!ui.proof) return toast("Wajib melampirkan bukti pembayaran (screenshot)!", "error");
            if (!await confirmBox("Kirim konfirmasi bayar?", "Pastikan transfer telah berhasil. Harap unggah bukti transfer ASLI (bukan editan/AI). Pemalsuan bukti dapat dikenakan sanksi hukum.", "Kirim")) return;
            setBusy(btn, true, "Mengirim…");
            try {
                const batch = writeBatch(db);
                batch.update(doc(db, "bookings", secret), { 
                    status: "MENUNGGU_VERIFIKASI", 
                    paidReportedAt: now(), 
                    sender: (ui.sender || "").slice(0, 40), 
                    dpMethod: "QRIS",
                    paymentType: ui.payType,
                    payAmount: amtToPay,
                    upd: serverTimestamp() 
                });
                batch.set(doc(db, "proofs", secret), { img: ui.proof, at: now() });
                await batch.commit(); toast("Terkirim! Admin akan memverifikasi bukti pembayaranmu.", "success");
            } catch (x) { console.error(x); toast("Gagal mengirim. Mungkin batas waktu sudah lewat, hubungi admin.", "error"); setBusy(btn, false); }
        });

        $("#paidCashBtn")?.addEventListener("click", async e => {
            const btn = e.currentTarget;
            const amtToPay = ui.payType === 'LUNAS' ? total : d;
            if (!await confirmBox("Konfirmasi Metode Cash?", "Sistem akan mencatat bahwa Anda memilih pembayaran CASH. Pastikan Anda membayar di kasir sebelum jam mulai bermain.", "Ya, Konfirmasi")) return;
            setBusy(btn, true, "Memproses…");
            try {
                const batch = writeBatch(db);
                batch.update(doc(db, "bookings", secret), {
                    status: "MENUNGGU_VERIFIKASI",
                    dpMethod: "CASH",
                    paymentType: ui.payType,
                    payAmount: amtToPay,
                    paidReportedAt: now(),
                    upd: serverTimestamp()
                });
                await batch.commit();
                toast("Terkonfirmasi! Metode pembayaran CASH telah dipilih.", "success");
            } catch (x) { console.error(x); toast("Gagal mengirim.", "error"); setBusy(btn, false); }
        });
    }
}

const writeUser = (secret, patch) => { const b = writeBatch(db); b.update(doc(db, "bookings", secret), { ...patch, upd: serverTimestamp() }); return b.commit(); };

(async function init() {
    startBackground();
    syncClock();
    try { const s = await getDoc(doc(db, "config", "settings")); if (s.exists()) ST = mergeSettings(s.data()); } catch (e) { console.warn("settings default", e); }
    try { const s = await getDoc(doc(db, "config", "qris")); if (s.exists()) QRC = s.data(); } catch (e) { }
    route();
})();