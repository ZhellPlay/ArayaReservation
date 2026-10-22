import { db, doc, setDoc } from "./fb.js";
import { $, $$, esc, fmtNum, parseNum, normWA, icon, compressImage, qrSvg, toast, DEFAULT_SETTINGS, modal, confirmBox, now } from "./lib.js";
import { validateQris, decodeQrFromFile, makeDynamic } from "./qris.js";

const roomRow = r => `<tr data-row data-orig="${esc(r.name)}">
  <td><input data-f="name" value="${esc(r.name)}" maxlength="30" style="min-width:110px"></td>
  <td><input data-f="rate" data-money inputmode="numeric" value="${fmtNum(r.rate)}" placeholder="0" style="width:105px"></td>
  <td><input data-f="minDurasi" inputmode="numeric" value="${r.minDurasi || 1}" style="width:60px"></td>
  <td><input data-f="baseCap" inputmode="numeric" value="${r.baseCap ?? 4}" style="width:60px"></td>
  <td><input data-f="maxCap" inputmode="numeric" value="${r.maxCap || ""}" placeholder="∞" style="width:60px"></td>
  <td><input data-f="extraPrice" data-money inputmode="numeric" value="${fmtNum(r.extraPrice)}" placeholder="0" style="width:105px"></td>
  <td><input type="checkbox" data-f="active" ${r.active === false ? "" : "checked"}></td>
  <td><button class="btn btn-ghost btn-sm" data-delrow type="button">${icon("delete", 14)}</button></td>
</tr>`;

const lokBlock = (l, rms) => `<div class="lok-block" data-loksec="${esc(l)}">
    <input class="lok-name" data-lokname value="${esc(l)}" maxlength="30" placeholder="Nama cabang" aria-label="Nama cabang">
    <h4 class="subsec-title">Room &amp; Tarif</h4>
    <div class="scroll-x"><table class="tbl" data-lok="${esc(l)}">
        <thead><tr><th>Room</th><th>Tarif/jam</th><th>Min jam</th><th>Kapasitas</th><th>Maks</th><th>+Orang</th><th>Aktif</th><th></th></tr></thead>
        <tbody>${rms.map(roomRow).join("")}</tbody>
    </table></div>
    <button class="btn btn-ghost btn-sm" data-addroom="${esc(l)}" type="button" style="margin-top:12px">${icon("add", 14)} Tambah room</button>

    <h4 class="subsec-title" style="margin-top:24px">QRIS</h4>
    <p class="muted">Upload QRIS merchant cabang ini. Tersimpan otomatis.</p>
    <div class="muted" data-qinfo="${esc(l)}" style="margin-top:8px"></div>
    <div data-qprev="${esc(l)}"></div>
    <input type="file" accept="image/*" data-qfile="${esc(l)}" style="margin-top:8px">
    <div data-qact="${esc(l)}"></div>

    <div class="row-btns" style="margin-top:16px;border-top:1px dashed var(--border-subtle);padding-top:16px">
        <button class="btn btn-delete btn-sm" data-removelok="${esc(l)}" type="button">${icon("delete_forever", 14)} Hapus cabang ini</button>
    </div>
</div>`;

const TPL_NAMES = {
    approve: "Persetujuan (QRIS)",
    approveCash: "Persetujuan (Cash)",
    reject: "Penolakan",
    remind: "Pengingat Pembayaran",
    confirmed: "Konfirmasi Pembayaran"
};

function getDiff(oldSt, nextSt, renames = {}, roomRenames = {}) {
    const diffs = [];
    if (oldSt.dpPercent !== nextSt.dpPercent) diffs.push(`DP default: ${oldSt.dpPercent}% → ${nextSt.dpPercent}%`);
    if (oldSt.holdMinutes !== nextSt.holdMinutes) diffs.push(`Batas bayar: ${oldSt.holdMinutes} mnt → ${nextSt.holdMinutes} mnt`);
    if (oldSt.bufferMin !== nextSt.bufferMin) diffs.push(`Jeda antar sesi: ${oldSt.bufferMin} mnt → ${nextSt.bufferMin} mnt`);
    if (oldSt.noShowGraceMin !== nextSt.noShowGraceMin) diffs.push(`Toleransi telat: ${oldSt.noShowGraceMin} mnt → ${nextSt.noShowGraceMin} mnt`);
    if (oldSt.pendingTtlHours !== nextSt.pendingTtlHours) diffs.push(`Kedaluwarsa: ${oldSt.pendingTtlHours} jam → ${nextSt.pendingTtlHours} jam`);
    if (oldSt.minLeadMin !== nextSt.minLeadMin) diffs.push(`Minimal booking: ${oldSt.minLeadMin} mnt → ${nextSt.minLeadMin} mnt`);
    if (oldSt.maxDurasi !== nextSt.maxDurasi) diffs.push(`Durasi maksimal: ${oldSt.maxDurasi} jam → ${nextSt.maxDurasi} jam`);
    if (oldSt.micPrice !== nextSt.micPrice) diffs.push(`Harga mic: Rp ${oldSt.micPrice} → Rp ${nextSt.micPrice}`);
    if (oldSt.addonPerHour !== nextSt.addonPerHour) diffs.push(`Orang tambahan dihitung per jam: ${oldSt.addonPerHour ? "Ya" : "Tidak"} → ${nextSt.addonPerHour ? "Ya" : "Tidak"}`);
    if (!!oldSt.micPerHour !== !!nextSt.micPerHour) diffs.push(`Mic dihitung per jam: ${oldSt.micPerHour ? "Ya" : "Tidak"} → ${nextSt.micPerHour ? "Ya" : "Tidak"}`);
    if (oldSt.adminWA !== nextSt.adminWA) diffs.push(`WA Admin diperbarui`);
    if (oldSt.policy !== nextSt.policy) diffs.push(`Teks Kebijakan diperbarui`);

    const back = Object.fromEntries(Object.entries(renames).map(([a, b]) => [b, a]));
    const addedLok = nextSt.lokasi.filter(l => !oldSt.lokasi.includes(l) && !back[l]);
    const removedLok = oldSt.lokasi.filter(l => !nextSt.lokasi.includes(l) && renames[l] === undefined);
    Object.entries(renames).forEach(([a, b]) => diffs.push(`Ganti nama cabang: ${a} → ${b}`));
    addedLok.forEach(l => diffs.push(`Menambah cabang: ${l}`));
    removedLok.forEach(l => diffs.push(`Menghapus cabang: ${l}`));

    nextSt.lokasi.forEach(l => {
        const ol = back[l] ?? l;
        if (!oldSt.lokasi.includes(ol)) return;
        const oldRooms = oldSt.rooms[ol] || [];
        const newRooms = nextSt.rooms[l] || [];
        const ren = roomRenames[l] || {};
        const renBack = Object.fromEntries(Object.entries(ren).map(([a, b]) => [b, a]));

        Object.entries(ren).forEach(([a, b]) => diffs.push(`Cabang ${l}: ganti nama room ${a} → ${b}`));
        const addedR = newRooms.filter(r => !oldRooms.find(o => o.name === (renBack[r.name] ?? r.name)));
        const removedR = oldRooms.filter(o => ren[o.name] === undefined && !newRooms.find(n => n.name === o.name));
        addedR.forEach(r => diffs.push(`Cabang ${l}: tambah room ${r.name}`));
        removedR.forEach(r => diffs.push(`Cabang ${l}: hapus room ${r.name}`));

        newRooms.forEach(r => {
            const o = oldRooms.find(x => x.name === (renBack[r.name] ?? r.name));
            if (o) {
                if (o.rate !== r.rate) diffs.push(`${l} - ${r.name}: tarif berubah`);
                if ((o.minDurasi || 1) !== r.minDurasi) diffs.push(`${l} - ${r.name}: minimal jam ${o.minDurasi || 1} → ${r.minDurasi}`);
                if (o.baseCap !== r.baseCap) diffs.push(`${l} - ${r.name}: kapasitas berubah`);
                if (o.maxCap !== r.maxCap) diffs.push(`${l} - ${r.name}: maksimal orang berubah`);
                if (o.extraPrice !== r.extraPrice) diffs.push(`${l} - ${r.name}: biaya +Orang berubah`);
                if (o.active !== r.active) diffs.push(`${l} - ${r.name}: status aktif berubah`);
            }
        });
    });

    const h1 = JSON.stringify(oldSt.holidays || []), h2 = JSON.stringify(nextSt.holidays || []);
    if (h1 !== h2) diffs.push(`Daftar hari libur berubah`);

    const tplChanged = Object.keys(nextSt.templates).some(k => oldSt.templates[k] !== nextSt.templates[k]);
    if (tplChanged) diffs.push(`Template pesan WhatsApp diperbarui`);

    return diffs;
}

export function renderSettings(el, S, H) {
    const st = S.st;
    let hol = [...(st.holidays || [])];
    S.dirty = false;

    const num = (id, v, label, hint = "", money = false) => `<div class="form-group"><label>${label}</label><input id="${id}" ${money ? `data-money inputmode="numeric"` : `inputmode="decimal"`} value="${money ? fmtNum(v) : v ?? ""}">${hint ? `<small class="hint" style="margin-top:4px">${hint}</small>` : ""}</div>`;

    el.innerHTML = `
    <div class="form-card"><details class="set-sec"><summary>${icon("tune")} <span style="flex:1;text-align:left">Umum &amp; Kebijakan</span></summary><div class="form-grid">
      ${num("sDp", st.dpPercent, "DP default (%)")}${num("sHold", st.holdMinutes, "Batas bayar (menit)", "Setelah disetujui, slot ditahan sampai batas ini.")}
      ${num("sBuf", st.bufferMin, "Jeda antar sesi (menit)")}${num("sGrace", st.noShowGraceMin, "Toleransi telat (menit)")}
      ${num("sTtl", st.pendingTtlHours, "Permintaan kedaluwarsa (jam)")}${num("sLead", st.minLeadMin, "Minimal booking sebelum main (menit)")}
      ${num("sMaxD", st.maxDurasi, "Durasi maksimal (jam)")}${num("sMic", st.micPrice, "Harga mic tambahan (Rp)", "", true)}
      <div class="form-group full-width"><label class="check"><input type="checkbox" id="sPerHour" ${st.addonPerHour ? "checked" : ""}><span>Biaya orang tambahan dihitung <b>per jam</b> (tidak dicentang = sekali bayar)</span></label></div>
      <div class="form-group full-width"><label class="check"><input type="checkbox" id="sMicPerHour" ${st.micPerHour ? "checked" : ""}><span>Biaya mic dihitung <b>per jam</b> (tidak dicentang = sekali bayar)</span></label></div>
      <div class="form-group full-width"><label>WhatsApp admin</label><input id="sWa" inputmode="tel" value="${esc(st.adminWA || "")}" placeholder="08xxxxxxxxxx"></div>
      <div class="form-group full-width"><label>Kebijakan (tampil di halaman booking)</label><textarea id="sPolicy" rows="2">${esc(st.policy || "")}</textarea></div></div></details></div>

    <div class="form-card"><details class="set-sec"><summary>${icon("store")} <span style="flex:1;text-align:left">Cabang (Lokasi)</span></summary>
      <p class="muted" style="margin-bottom:16px">Default 1 cabang dengan 1 room. Tambah atau hapus sesuai kebutuhan. Minimal 1 cabang dan 1 room per cabang.</p>
      <div id="lokList">${st.lokasi.map(l => lokBlock(l, st.rooms[l] || [])).join("")}</div>
      <div class="add-lok">
        <input id="lokNew" maxlength="30" placeholder="Nama cabang baru (mis. GAMBUT)">
        <button class="btn btn-ghost" id="lokAdd" type="button">${icon("add", 16)} Tambah</button>
      </div>
    </details></div>

    <div class="form-card"><details class="set-sec"><summary>${icon("event_busy")} <span style="flex:1;text-align:left">Hari Libur / Tutup</span></summary>
      <p class="muted" style="margin-bottom:16px">Tanggal tutup tidak bisa dipilih pelanggan.</p>
      <div id="holList"></div>
      <div class="form-grid" style="margin-top:16px"><div class="form-group"><label>Tanggal</label><input type="date" id="hDate"></div>
      <div class="form-group"><label>Lokasi</label><select id="hLok"><option value="ALL">Semua lokasi</option>${st.lokasi.map(l => `<option>${esc(l)}</option>`).join("")}</select></div>
      <div class="form-group full-width"><label>Alasan</label><input id="hWhy" placeholder="mis. HUT Araya"></div></div>
      <button class="btn btn-ghost" id="hAdd" type="button" style="margin-top:12px">${icon("add", 16)} Tambah libur</button></details></div>

    <div class="form-card"><details class="set-sec"><summary>${icon("sms")} <span style="flex:1;text-align:left">Template Pesan WhatsApp</span></summary>
      <div class="est" style="margin-bottom:20px; border-color:var(--border-medium)">
        <b>Variabel yang tersedia:</b><br>
        <span class="muted" style="line-height:1.8; word-break:break-word; display:inline-block; margin-top:6px">{nama} · {lokasi} · {room} · {tanggal} · {jam} · {nominal} · {deadline} · {link} · {kode} · {alasan} · {site}</span>
      </div>
      <div class="form-grid" style="grid-template-columns: 1fr; gap:20px;">
        ${Object.keys(DEFAULT_SETTINGS.templates).map(k => `
          <div class="form-group">
            <label style="color:var(--accent-1); font-size:12px; letter-spacing:1px">${TPL_NAMES[k] || k}</label>
            <textarea data-tpl="${k}" rows="5" style="font-size:14px; line-height:1.6; resize:vertical;">${esc(st.templates[k])}</textarea>
          </div>`).join("")}
      </div></details></div>

    <button class="btn btn-save btn-block" id="setSave" style="margin-top: 0; margin-bottom: var(--space-xl);">${icon("save")} Simpan Pengaturan</button>

    <div class="form-card"><details class="set-sec"><summary>${icon("build")} <span style="flex:1;text-align:left">Perawatan Data</span></summary>
      <p class="muted" style="margin-bottom:16px">Ekspor dulu, lalu bersihkan booking lama (&gt; 30 hari) untuk menghemat kuota Firebase.</p>
      <div class="row-btns"><button class="btn btn-ghost" id="mExp">${icon("download", 16)} Ekspor CSV</button><button class="btn btn-delete" id="mClean">${icon("delete_sweep", 16)} Bersihkan data lama</button></div>

      <div style="margin-top:24px; border-top:1px dashed var(--danger-border); padding-top:24px;">
        <p class="muted" style="margin-bottom:12px; color:var(--danger)"><b>Zona Berbahaya:</b> Menghapus semua data secara permanen.</p>
        <button class="btn btn-delete" id="mResetAll" style="width:100%">${icon("dangerous", 16)} Reset Total Database</button>
      </div>
    </details></div>`;

    el.oninput = e => { if (S.tab === "settings" && !e.target.matches("[data-qfile]")) S.dirty = true; };

    const drawQ = () => $$("[data-loksec]", el).forEach(sec => {
        const l = sec.dataset.loksec, q = S.qris[l];
        const infoEl = $(`[data-qinfo="${CSS.escape(l)}"]`, sec);
        const prevEl = $(`[data-qprev="${CSS.escape(l)}"]`, sec);
        const actEl = $(`[data-qact="${CSS.escape(l)}"]`, sec);
        if (actEl) actEl.innerHTML = q ? `<div class="row-btns"><button class="btn btn-delete btn-sm" data-qdel="${esc(l)}" type="button">${icon("delete", 14)} Hapus QRIS</button></div>` : "";
        if (infoEl) infoEl.textContent = q ? `Tersimpan: ${q.merchant || "(tanpa nama)"}` : "Belum ada QRIS";
        if (prevEl) prevEl.innerHTML = q ? (() => {
            try { return `<div class="qris-prev">${qrSvg(makeDynamic(q.payload, 1000))}</div><small class="hint" style="display:block; margin-top:6px">Contoh QR Rp 1.000 (hanya tes, jangan dibayar)</small>`; }
            catch (e) { return ""; }
        })() : "";
    });

    const drawHol = () => {
        $("#holList", el).innerHTML = hol.length
            ? hol.sort((a, b) => a.date.localeCompare(b.date)).map((h, i) => `<div class="kv"><span>${esc(h.date)} · ${esc(h.lokasi === "ALL" ? "Semua" : h.lokasi)}</span><b>${esc(h.alasan || "-")} <button class="btn btn-ghost btn-sm" data-hdel="${i}" type="button" style="padding:4px; min-height:24px;">${icon("close", 14)}</button></b></div>`).join("")
            : `<p class="muted">Belum ada hari libur.</p>`;
        $$("[data-hdel]", el).forEach(b => b.onclick = () => { hol.splice(+b.dataset.hdel, 1); drawHol(); S.dirty = true; });
    };

    drawQ(); drawHol();

    el.onclick = async e => {
        const delrow = e.target.closest("[data-delrow]");
        if (delrow) { delrow.closest("tr").remove(); S.dirty = true; return; }
        const addroom = e.target.closest("[data-addroom]");
        if (addroom) {
            const tbl = $(`table[data-lok="${CSS.escape(addroom.dataset.addroom)}"] tbody`, el);
            if (tbl) tbl.insertAdjacentHTML("beforeend", roomRow({ name: "", rate: 0, minDurasi: 1, baseCap: 4, maxCap: 10, extraPrice: 0, active: true }));
            S.dirty = true;
            return;
        }
        const removelok = e.target.closest("[data-removelok]");
        if (removelok) {
            const l = removelok.dataset.removelok;
            if ($$("[data-loksec]", el).length <= 1) return toast("Minimal 1 cabang", "error");
            const cur = $("[data-lokname]", removelok.closest("[data-loksec]")).value.trim() || l;
            if (!await confirmBox("Hapus cabang", `Cabang "${cur}" dan semua room-nya akan dihapus setelah Anda menekan Simpan.`, "Hapus", true)) return;
            removelok.closest("[data-loksec]").remove();
            S.dirty = true;
            return;
        }
        const qdel = e.target.closest("[data-qdel]");
        if (qdel) {
            (async () => {
                const l = qdel.dataset.qdel;
                if (!S.qris[l]) return;
                const cur = $("[data-lokname]", qdel.closest("[data-loksec]")).value.trim() || l;
                if (!await confirmBox("Hapus QRIS", `QRIS cabang ${cur} akan dihapus.`, "Hapus", true)) return;
                delete S.qris[l];
                try { await setDoc(doc(db, "config", "qris"), S.qris); drawQ(); }
                catch (err) { toast("Gagal hapus: " + (err.code || err.message), "error"); }
            })();
            return;
        }
        const hdel = e.target.closest("[data-hdel]");
        if (hdel) { hol.splice(+hdel.dataset.hdel, 1); drawHol(); S.dirty = true; }
    };

    el.onchange = async e => {
        const inp = e.target.closest("[data-qfile]");
        if (!inp) return;
        const f = inp.files[0]; if (!f) return;
        const l = inp.dataset.qfile;
        if (S.qris[l]) {
            if (!await confirmBox("Ganti QRIS?", "Foto QRIS lama akan diganti dengan yang baru. Lanjutkan?", "Ya, Ganti")) {
                inp.value = "";
                return;
            }
        }
        try {
            const payload = (await decodeQrFromFile(f)).trim(), info = validateQris(payload);
            S.qris[l] = { payload, merchant: info.merchant, image: await compressImage(f, 700, 0.7) };
            await setDoc(doc(db, "config", "qris"), S.qris);
            drawQ();
            toast(`QRIS ${l} tersimpan: ${info.merchant}`, "success");
        } catch (err) { toast(err.message || "Gagal membaca QRIS", "error"); }
        inp.value = "";
    };

    $("#lokAdd", el).onclick = () => {
        const name = $("#lokNew", el).value.trim();
        if (!name) return toast("Isi nama cabang", "error");
        if (name.length > 30) return toast("Nama cabang maksimal 30 karakter", "error");
        if ($$(`[data-loksec="${CSS.escape(name)}"]`, el).length) return toast("Cabang sudah ada", "error");
        $("#lokList", el).insertAdjacentHTML("beforeend", lokBlock(name, [{ name: "Room 1", rate: 0, minDurasi: 1, baseCap: 4, maxCap: 10, extraPrice: 0, active: true }]));
        $("#lokNew", el).value = "";
        drawQ();
        S.dirty = true;
        toast("Cabang ditambahkan. Jangan lupa Simpan.", "info");
    };

    $("#hAdd", el).onclick = () => {
        const date = $("#hDate", el).value; if (!date) return toast("Pilih tanggal", "error");
        hol.push({ date, lokasi: $("#hLok", el).value, alasan: $("#hWhy", el).value.trim() });
        $("#hWhy", el).value = ""; drawHol(); S.dirty = true; toast("Libur ditambahkan. Jangan lupa Simpan.", "info");
    };

    $("#mExp", el).onclick = H.exportCsv;
    $("#mClean", el).onclick = () => H.cleanup(30);
    $("#mResetAll", el).onclick = H.resetAllData;

    $("#setSave", el).onclick = async () => {
        const saveBtn = $("#setSave", el);
        const g = id => parseFloat(String($("#" + id, el).value).replace(",", ".")) || 0;
        const maxD = Math.min(24, Math.max(1, g("sMaxD") || 12));
        const nextLokasi = [], nextRooms = {}, origKeys = [], moves = {}, renames = {}, roomRenames = {}, roomMoves = {};
        for (const sec of $$("[data-loksec]", el)) {
            const orig = sec.dataset.loksec, l = $("[data-lokname]", sec).value.trim();
            if (!l) return toast("Nama cabang tidak boleh kosong", "error");
            if (l.length > 30) return toast("Nama cabang maksimal 30 karakter", "error");
            if (nextLokasi.includes(l)) return toast(`Nama cabang ganda: ${l}`, "error");
            nextLokasi.push(l);
            origKeys.push(orig);
            if (orig !== l) { moves[orig] = l; if (st.lokasi.includes(orig)) renames[orig] = l; }
            const rows = $$(`table[data-lok="${CSS.escape(orig)}"] tr[data-row]`, el), names = new Set();
            nextRooms[l] = [];
            for (const tr of rows) {
                const f = n => $(`[data-f=${n}]`, tr), name = f("name").value.trim();
                if (!name) return toast(`Nama room di ${l} tidak boleh kosong`, "error");
                if (name.length > 30) return toast(`Nama room "${name}" maksimal 30 karakter`, "error");
                if (names.has(name)) return toast(`Nama room ganda di ${l}: ${name}`, "error");
                names.add(name);
                const from = tr.dataset.orig;
                if (from && from !== name && (st.rooms[orig] || []).some(r => r.name === from)) {
                    (roomRenames[l] ??= {})[from] = name;
                    (roomMoves[orig] ??= {})[from] = name;
                }
                const minDurasi = Math.max(1, parseInt(f("minDurasi").value) || 1);
                if (minDurasi > maxD) return toast(`Minimal jam ${name} (${minDurasi}) melebihi durasi maksimal (${maxD} jam)`, "error");
                nextRooms[l].push({ name, rate: parseNum(f("rate").value), minDurasi, baseCap: parseInt(f("baseCap").value) || 1, maxCap: parseInt(f("maxCap").value) || 0, extraPrice: parseNum(f("extraPrice").value), active: f("active").checked });
            }
            if (!nextRooms[l].length) return toast(`Cabang ${l} minimal punya 1 room`, "error");
        }
        if (!nextLokasi.length) return toast("Minimal 1 cabang", "error");
        const orphan = S.bookings.find(b => ["PENDING", "MENUNGGU_BAYAR", "MENUNGGU_VERIFIKASI", "TERKONFIRMASI", "CHECKED_IN"].includes(b.status) && b.endMs > now()
            && (!origKeys.includes(b.lokasi) || renames[b.lokasi] !== undefined || roomMoves[b.lokasi]?.[b.room] !== undefined
                || !(nextRooms[b.lokasi] || []).some(r => r.name === b.room)));
        if (orphan) return toast(`Masih ada booking aktif di ${orphan.lokasi} · ${orphan.room}. Cabang atau room itu tidak bisa dihapus atau diganti nama sebelum bookingnya selesai.`, "error");
        const next = {
            ...st, dpPercent: g("sDp"), holdMinutes: g("sHold"), bufferMin: g("sBuf"), noShowGraceMin: g("sGrace"),
            pendingTtlHours: g("sTtl"), minLeadMin: g("sLead"), maxDurasi: maxD,
            micPrice: parseNum($("#sMic", el).value), addonPerHour: $("#sPerHour", el).checked, micPerHour: $("#sMicPerHour", el).checked,
            adminWA: $("#sWa", el).value.trim() ? normWA($("#sWa", el).value) : "", policy: $("#sPolicy", el).value.trim(),
            holidays: hol.map(h => moves[h.lokasi] ? { ...h, lokasi: moves[h.lokasi] } : h), lokasi: nextLokasi, rooms: nextRooms, templates: {}
        };
        if (next.dpPercent < 1 || next.dpPercent > 100) return toast("DP harus 1–100%", "error");
        $$("[data-tpl]", el).forEach(t => next.templates[t.dataset.tpl] = t.value);

        const diffs = getDiff(st, next, renames, roomRenames);
        if (!diffs.length) {
            S.dirty = false;
            toast("Tidak ada perubahan", "info");
            if (S.pendingTab && H.switchTab) {
                const t = S.pendingTab;
                S.pendingTab = null;
                H.switchTab(t);
            }
            return;
        }

        const m = modal(`
            <h3>${icon("save")} Simpan Perubahan?</h3>
            <p>Berikut adalah perubahan yang akan disimpan:</p>
            <div style="max-height: 30vh; overflow-y: auto; margin-bottom: 20px; background: rgba(0,0,0,0.2); padding: 12px; border-radius: 8px; border: 1px solid var(--border-subtle);">
                <ul style="list-style-position: inside; text-align: center; color: var(--text-secondary); font-size: 14px; line-height: 1.8; padding: 0; margin: 0;">
                    ${diffs.map(d => `<li>${esc(d)}</li>`).join("")}
                </ul>
            </div>
            <div class="modal-actions">
                <button class="btn btn-ghost" data-close>Batal</button>
                <button class="btn btn-save" id="confirmSave">Simpan</button>
            </div>
        `, { wide: false });

        $("#confirmSave", m.el).onclick = async () => {
            m.close();
            S.dirty = false;
            saveBtn.disabled = true;
            try {
                await setDoc(doc(db, "config", "settings"), next);
                Object.assign(S.st, next);
                S.needSeed = false;

                const nq = {};
                Object.keys(S.qris).forEach(k => { if (origKeys.includes(k)) nq[moves[k] ?? k] = S.qris[k]; });
                if (JSON.stringify(nq) !== JSON.stringify(S.qris)) {
                    await setDoc(doc(db, "config", "qris"), nq);
                    S.qris = nq;
                }
                S.f.lokasi = renames[S.f.lokasi] ?? (nextLokasi.includes(S.f.lokasi) ? S.f.lokasi : "ALL");
                toast("Pengaturan tersimpan", "success");

                if (S.pendingTab && H.switchTab) {
                    const t = S.pendingTab;
                    S.pendingTab = null;
                    H.switchTab(t);
                } else {
                    const open = $$("details.set-sec", el).map(d => d.open);
                    renderSettings(el, S, H);
                    $$("details.set-sec", el).forEach((d, i) => { d.open = !!open[i]; });
                }
            } catch (err) {
                S.dirty = true;
                toast("Gagal menyimpan: " + (err.code || err.message), "error");
            }
            saveBtn.disabled = false;
        };
    };
}