import { db, doc, setDoc } from "./fb.js";
import { $, $$, esc, parseNum, normWA, icon, compressImage, qrSvg, toast, rupiah, DEFAULT_SETTINGS } from "./lib.js";
import { validateQris, decodeQrFromFile, makeDynamic } from "./qris.js";

const roomRow = r => `<tr data-row>
  <td><input data-f="name" value="${esc(r.name)}" style="min-width:110px"></td>
  <td><input data-f="rate" inputmode="numeric" value="${r.rate || ""}" placeholder="0" style="width:90px"></td>
  <td><input data-f="baseCap" inputmode="numeric" value="${r.baseCap ?? 4}" style="width:60px"></td>
  <td><input data-f="maxCap" inputmode="numeric" value="${r.maxCap || ""}" placeholder="∞" style="width:60px"></td>
  <td><input data-f="extraPrice" inputmode="numeric" value="${r.extraPrice || ""}" placeholder="0" style="width:90px"></td>
  <td><input type="checkbox" data-f="active" ${r.active === false ? "" : "checked"}></td>
  <td><button class="btn btn-ghost btn-sm" data-delrow type="button">${icon("delete", 14)}</button></td>
</tr>`;

const lokBlock = (l, rms) => `<div class="lok-block" data-loksec="${esc(l)}">
    <div class="lok-title">${icon("store", 20)} ${esc(l)}</div>
    <h4 class="subsec-title">Room &amp; Tarif</h4>
    <div class="scroll-x"><table class="tbl" data-lok="${esc(l)}">
        <thead><tr><th>Room</th><th>Tarif/jam</th><th>Kapasitas</th><th>Maks</th><th>+Orang/jam</th><th>Aktif</th><th></th></tr></thead>
        <tbody>${rms.map(roomRow).join("")}</tbody>
    </table></div>
    <button class="btn btn-ghost btn-sm" data-addroom="${esc(l)}" type="button" style="margin-top:12px">${icon("add", 14)} Tambah room</button>
    
    <h4 class="subsec-title" style="margin-top:24px">QRIS ${esc(l)}</h4>
    <p class="muted">Upload QRIS merchant cabang ini. Tersimpan otomatis.</p>
    <div class="muted" data-qinfo="${esc(l)}" style="margin-top:8px"></div>
    <div data-qprev="${esc(l)}"></div>
    <input type="file" accept="image/*" data-qfile="${esc(l)}" style="margin-top:8px">
    <div class="row-btns"><button class="btn btn-delete btn-sm" data-qdel="${esc(l)}" type="button">${icon("delete", 14)} Hapus QRIS</button></div>
    
    <div class="row-btns" style="margin-top:16px;border-top:1px dashed var(--border-subtle);padding-top:16px">
        <button class="btn btn-delete btn-sm" data-removelok="${esc(l)}" type="button">${icon("delete_forever", 14)} Hapus cabang "${esc(l)}"</button>
    </div>
</div>`;

const TPL_NAMES = {
    approve: "Persetujuan (QRIS)",
    approveCash: "Persetujuan (Tunai)",
    reject: "Penolakan",
    remind: "Pengingat Pembayaran",
    confirmed: "Konfirmasi Pembayaran"
};

export function renderSettings(el, S, H) {
    const st = S.st;
    let hol = [...(st.holidays || [])];
    const num = (id, v, label, hint = "") => `<div class="form-group"><label>${label}</label><input id="${id}" inputmode="decimal" value="${v ?? ""}">${hint ? `<small class="hint" style="margin-top:4px">${hint}</small>` : ""}</div>`;

    el.innerHTML = `
    <div class="form-card"><details open class="set-sec"><summary>${icon("tune")} Umum &amp; Kebijakan</summary><div class="form-grid">
      ${num("sDp", st.dpPercent, "DP default (%)")}${num("sHold", st.holdMinutes, "Batas bayar (menit)", "Setelah disetujui, slot ditahan sampai batas ini.")}
      ${num("sBuf", st.bufferMin, "Jeda antar sesi (menit)")}${num("sGrace", st.noShowGraceMin, "Toleransi telat (menit)")}
      ${num("sTtl", st.pendingTtlHours, "Permintaan kedaluwarsa (jam)")}${num("sLead", st.minLeadMin, "Minimal booking sebelum main (menit)")}
      ${num("sMaxD", st.maxDurasi, "Durasi maksimal (jam)")}${num("sMic", st.micPrice, "Harga mic tambahan (Rp)")}
      <div class="form-group full-width"><label class="check"><input type="checkbox" id="sPerHour" ${st.addonPerHour ? "checked" : ""}><span>Biaya orang tambahan &amp; mic dihitung <b>per jam</b> (tidak dicentang = sekali bayar)</span></label></div>
      <div class="form-group full-width"><label>WhatsApp admin</label><input id="sWa" inputmode="tel" value="${esc(st.adminWA || "")}" placeholder="08xxxxxxxxxx"></div>
      <div class="form-group full-width"><label>Kebijakan (tampil di halaman booking)</label><textarea id="sPolicy" rows="2">${esc(st.policy || "")}</textarea></div></div></details></div>

    <div class="form-card"><details open class="set-sec"><summary>${icon("store")} Cabang (Lokasi)</summary>
      <p class="muted" style="margin-bottom:16px">Default 1 cabang dengan 1 room. Tambah atau hapus sesuai kebutuhan. Minimal 1 cabang dan 1 room per cabang.</p>
      <div id="lokList">${st.lokasi.map(l => lokBlock(l, st.rooms[l] || [])).join("")}</div>
      <div class="add-lok">
        <input id="lokNew" placeholder="Nama cabang baru (mis. GAMBUT)">
        <button class="btn btn-ghost" id="lokAdd" type="button">${icon("add", 16)} Tambah</button>
      </div>
    </details></div>

    <div class="form-card"><details class="set-sec"><summary>${icon("event_busy")} Hari Libur / Tutup</summary>
      <p class="muted" style="margin-bottom:16px">Tanggal tutup tidak bisa dipilih pelanggan.</p>
      <div id="holList"></div>
      <div class="form-grid" style="margin-top:16px"><div class="form-group"><label>Tanggal</label><input type="date" id="hDate"></div>
      <div class="form-group"><label>Lokasi</label><select id="hLok"><option value="ALL">Semua lokasi</option>${st.lokasi.map(l => `<option>${esc(l)}</option>`).join("")}</select></div>
      <div class="form-group full-width"><label>Alasan</label><input id="hWhy" placeholder="mis. HUT Araya"></div></div>
      <button class="btn btn-ghost" id="hAdd" type="button" style="margin-top:12px">${icon("add", 16)} Tambah libur</button></details></div>

    <div class="form-card"><details class="set-sec"><summary>${icon("template_add")} Template Pesan WhatsApp</summary>
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

    <button class="btn btn-save btn-block" id="setSave">${icon("save")} Simpan Pengaturan</button>

    <div class="form-card"><details class="set-sec"><summary>${icon("build")} Perawatan Data</summary>
      <p class="muted" style="margin-bottom:16px">Ekspor dulu, lalu bersihkan booking lama (&gt; 30 hari) untuk menghemat kuota Firebase.</p>
      <div class="row-btns"><button class="btn btn-ghost" id="mExp">${icon("download", 16)} Ekspor CSV</button><button class="btn btn-delete" id="mClean">${icon("delete_sweep", 16)} Bersihkan data lama</button></div></details></div>`;

    const drawQ = () => $$("[data-loksec]", el).forEach(sec => {
        const l = sec.dataset.loksec, q = S.qris[l];
        const infoEl = $(`[data-qinfo="${CSS.escape(l)}"]`, sec);
        const prevEl = $(`[data-qprev="${CSS.escape(l)}"]`, sec);
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
        $$("[data-hdel]", el).forEach(b => b.onclick = () => { hol.splice(+b.dataset.hdel, 1); drawHol(); });
    };

    drawQ(); drawHol();

    el.onclick = e => {
        const delrow = e.target.closest("[data-delrow]");
        if (delrow) { delrow.closest("tr").remove(); return; }
        const addroom = e.target.closest("[data-addroom]");
        if (addroom) {
            const tbl = $(`table[data-lok="${CSS.escape(addroom.dataset.addroom)}"] tbody`, el);
            if (tbl) tbl.insertAdjacentHTML("beforeend", roomRow({ name: "", rate: 0, baseCap: 4, maxCap: 10, extraPrice: 0, active: true }));
            return;
        }
        const removelok = e.target.closest("[data-removelok]");
        if (removelok) {
            const l = removelok.dataset.removelok;
            if ($$("[data-loksec]", el).length <= 1) return toast("Minimal 1 cabang", "error");
            if (!confirm(`Hapus cabang "${l}"?`)) return;
            removelok.closest("[data-loksec]").remove();
            return;
        }
        const qdel = e.target.closest("[data-qdel]");
        if (qdel) {
            (async () => {
                const l = qdel.dataset.qdel;
                if (!S.qris[l] || !confirm("Hapus QRIS " + l + "?")) return;
                delete S.qris[l];
                try { await setDoc(doc(db, "config", "qris"), S.qris); drawQ(); }
                catch (err) { toast("Gagal hapus: " + (err.code || err.message), "error"); }
            })();
            return;
        }
        const hdel = e.target.closest("[data-hdel]");
        if (hdel) { hol.splice(+hdel.dataset.hdel, 1); drawHol(); }
    };

    el.onchange = async e => {
        const inp = e.target.closest("[data-qfile]");
        if (!inp) return;
        const f = inp.files[0]; if (!f) return;
        const l = inp.dataset.qfile;
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
        if ($$(`[data-loksec="${CSS.escape(name)}"]`, el).length) return toast("Cabang sudah ada", "error");
        $("#lokList", el).insertAdjacentHTML("beforeend", lokBlock(name, [{ name: "Room 1", rate: 0, baseCap: 4, maxCap: 10, extraPrice: 0, active: true }]));
        $("#lokNew", el).value = "";
        drawQ();
        toast("Cabang ditambahkan. Jangan lupa Simpan.", "info");
    };

    $("#hAdd", el).onclick = () => {
        const date = $("#hDate", el).value; if (!date) return toast("Pilih tanggal", "error");
        hol.push({ date, lokasi: $("#hLok", el).value, alasan: $("#hWhy", el).value.trim() });
        $("#hWhy", el).value = ""; drawHol(); toast("Libur ditambahkan. Jangan lupa Simpan.", "info");
    };

    $("#mExp", el).onclick = H.exportCsv;
    $("#mClean", el).onclick = () => H.cleanup(30);

    $("#setSave", el).onclick = async e => {
        const g = id => parseFloat(String($("#" + id, el).value).replace(",", ".")) || 0;
        const nextLokasi = [], nextRooms = {};
        for (const sec of $$("[data-loksec]", el)) {
            const l = sec.dataset.loksec;
            nextLokasi.push(l);
            const rows = $$(`table[data-lok="${CSS.escape(l)}"] tr[data-row]`, el), names = new Set();
            nextRooms[l] = [];
            for (const tr of rows) {
                const f = n => $(`[data-f=${n}]`, tr), name = f("name").value.trim();
                if (!name) return toast(`Nama room di ${l} tidak boleh kosong`, "error");
                if (names.has(name)) return toast(`Nama room ganda di ${l}: ${name}`, "error");
                names.add(name);
                nextRooms[l].push({ name, rate: parseNum(f("rate").value), baseCap: parseInt(f("baseCap").value) || 1, maxCap: parseInt(f("maxCap").value) || 0, extraPrice: parseNum(f("extraPrice").value), active: f("active").checked });
            }
            if (!nextRooms[l].length) return toast(`Cabang ${l} minimal punya 1 room`, "error");
        }
        if (!nextLokasi.length) return toast("Minimal 1 cabang", "error");
        const next = {
            ...st, dpPercent: g("sDp"), holdMinutes: g("sHold"), bufferMin: g("sBuf"), noShowGraceMin: g("sGrace"),
            pendingTtlHours: g("sTtl"), minLeadMin: g("sLead"), maxDurasi: g("sMaxD") || 12,
            micPrice: parseNum($("#sMic", el).value), addonPerHour: $("#sPerHour", el).checked,
            adminWA: $("#sWa", el).value.trim() ? normWA($("#sWa", el).value) : "", policy: $("#sPolicy", el).value.trim(),
            holidays: hol, lokasi: nextLokasi, rooms: nextRooms, templates: {}
        };
        if (next.dpPercent < 1 || next.dpPercent > 100) return toast("DP harus 1–100%", "error");
        $$("[data-tpl]", el).forEach(t => next.templates[t.dataset.tpl] = t.value);
        e.currentTarget.disabled = true;
        try {
            await setDoc(doc(db, "config", "settings"), next);
            Object.assign(S.st, next);
            S.needSeed = false;
            const removedLok = st.lokasi.filter(l => !nextLokasi.includes(l));
            if (removedLok.some(l => S.qris[l])) {
                removedLok.forEach(l => { if (S.qris[l]) delete S.qris[l]; });
                await setDoc(doc(db, "config", "qris"), S.qris);
            }
            toast("Pengaturan tersimpan", "success");
        } catch (err) { toast("Gagal menyimpan: " + (err.code || err.message), "error"); }
        e.currentTarget.disabled = false;
    };
}