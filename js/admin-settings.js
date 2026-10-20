import { db, doc, setDoc } from "./fb.js";
import { $, $$, esc, parseNum, normWA, icon, compressImage, qrSvg, toast, rupiah, DEFAULT_SETTINGS } from "./lib.js";
import { validateQris, decodeQrFromFile, makeDynamic } from "./qris.js";

const roomRow = r => `<tr data-row><td><input data-f="name" value="${esc(r.name)}" style="min-width:110px"></td>
  <td><input data-f="rate" inputmode="numeric" value="${r.rate || ""}" placeholder="0" style="width:90px"></td>
  <td><input data-f="baseCap" inputmode="numeric" value="${r.baseCap ?? 4}" style="width:60px"></td>
  <td><input data-f="maxCap" inputmode="numeric" value="${r.maxCap || ""}" placeholder="∞" style="width:60px"></td>
  <td><input data-f="extraPrice" inputmode="numeric" value="${r.extraPrice || ""}" placeholder="0" style="width:90px"></td>
  <td><input type="checkbox" data-f="active" ${r.active === false ? "" : "checked"} style="width:20px"></td>
  <td><button class="btn btn-ghost btn-sm" data-delrow type="button">${icon("delete", 14)}</button></td></tr>`;

export function renderSettings(el, S, H) {
    const st = S.st; let hol = [...(st.holidays || [])];
    const num = (id, v, label, hint = "") => `<div class="form-group"><label>${label}</label><input id="${id}" inputmode="decimal" value="${v ?? ""}">${hint ? `<small class="hint">${hint}</small>` : ""}</div>`;
    const scopes = ["DEFAULT", ...st.lokasi];
    el.innerHTML = `
    <div class="form-card"><details open class="set-sec"><summary>${icon("tune")} Umum &amp; Kebijakan</summary><div class="form-grid">
      ${num("sDp", st.dpPercent, "DP default (%)")}${num("sHold", st.holdMinutes, "Batas bayar (menit)", "Setelah disetujui, slot ditahan sampai batas ini.")}
      ${num("sBuf", st.bufferMin, "Jeda antar sesi (menit)")}${num("sGrace", st.noShowGraceMin, "Toleransi telat (menit)")}
      ${num("sTtl", st.pendingTtlHours, "Permintaan kedaluwarsa (jam)")}${num("sLead", st.minLeadMin, "Minimal booking sebelum main (menit)")}
      ${num("sMaxD", st.maxDurasi, "Durasi maksimal (jam)")}${num("sMic", st.micPrice, "Harga mic tambahan (Rp)")}
      <div class="form-group full-width"><label class="check"><input type="checkbox" id="sPerHour" ${st.addonPerHour ? "checked" : ""}><span>Biaya orang tambahan &amp; mic dihitung <b>per jam</b> (tidak dicentang = sekali bayar)</span></label></div>
      <div class="form-group full-width"><label>WhatsApp admin (untuk tombol "Hubungi admin" di sisi pelanggan)</label><input id="sWa" inputmode="tel" value="${esc(st.adminWA || "")}" placeholder="08xxxxxxxxxx"></div>
      <div class="form-group full-width"><label>Kebijakan (tampil di halaman booking)</label><textarea id="sPolicy" rows="2">${esc(st.policy || "")}</textarea></div></div></details></div>

    <div class="form-card"><details open class="set-sec"><summary>${icon("meeting_room")} Room &amp; Tarif</summary>
      <p class="muted">Tarif per jam. Kapasitas dasar = jumlah orang yang sudah termasuk tarif. Lebih dari itu dihitung "orang tambahan". Mengganti nama room tidak mengubah booking lama.</p>
      ${st.lokasi.map(l => `<h3 style="margin-top:14px">${esc(l)}</h3><div class="scroll-x"><table class="tbl" data-lok="${esc(l)}"><thead><tr><th>Room</th><th>Tarif/jam</th><th>Kapasitas</th><th>Maks</th><th>+Orang/jam</th><th>Aktif</th><th></th></tr></thead><tbody>${(st.rooms[l] || []).map(roomRow).join("")}</tbody></table></div><button class="btn btn-ghost btn-sm" data-addroom="${esc(l)}" type="button">${icon("add", 14)} Tambah room</button>`).join("")}
    </details></div>

    <div class="form-card"><details class="set-sec"><summary>${icon("event_busy")} Hari Libur / Tutup</summary>
      <p class="muted">Tanggal tutup tidak bisa dipilih pelanggan. Untuk menutup satu room di jam tertentu, pakai "Blokir" di tab Room Hari Ini.</p>
      <div id="holList"></div>
      <div class="form-grid" style="margin-top:10px"><div class="form-group"><label>Tanggal</label><input type="date" id="hDate"></div>
      <div class="form-group"><label>Lokasi</label><select id="hLok"><option value="ALL">Semua lokasi</option>${st.lokasi.map(l => `<option>${esc(l)}</option>`).join("")}</select></div>
      <div class="form-group full-width"><label>Alasan</label><input id="hWhy" placeholder="mis. HUT Araya"></div></div>
      <button class="btn btn-ghost" id="hAdd" type="button">${icon("add", 16)} Tambah libur</button></details></div>

    <div class="form-card"><details class="set-sec"><summary>${icon("template_add")} Template Pesan WhatsApp</summary>
      <p class="muted">Placeholder: {nama} {lokasi} {room} {tanggal} {jam} {nominal} {deadline} {link} {kode} {alasan} {site}</p>
      ${Object.keys(DEFAULT_SETTINGS.templates).map(k => `<div class="form-group" style="margin-bottom:10px"><label>${k}</label><textarea data-tpl="${k}" rows="4">${esc(st.templates[k])}</textarea></div>`).join("")}</details></div>

    <button class="btn btn-save btn-block" id="setSave">${icon("save")} Simpan Pengaturan</button>

    <div class="form-card" style="margin-top:22px"><details open class="set-sec"><summary>${icon("qr_code_2")} QRIS</summary>
      <p class="muted">Upload foto/screenshot QRIS merchant kamu (yang statis). Sistem membaca isinya, lalu membuat QR dengan nominal terkunci untuk setiap pelanggan. Tersimpan otomatis saat upload. "DEFAULT" dipakai bila lokasi tidak punya QRIS sendiri.</p>
      ${scopes.map(k => `<div class="panel" data-q="${esc(k)}"><b>${k === "DEFAULT" ? "DEFAULT (semua lokasi)" : esc(k)}</b><div class="muted" data-qinfo></div><div data-qprev></div>
        <input type="file" accept="image/*" data-qfile style="margin-top:8px"><div class="row-btns"><button class="btn btn-delete btn-sm" data-qdel type="button">Hapus</button></div></div>`).join("")}</details></div>

    <div class="form-card"><details class="set-sec"><summary>${icon("build")} Perawatan Data</summary>
      <p class="muted">Kuota gratis Firebase terbatas. Ekspor dulu, lalu bersihkan booking lama (&gt; 90 hari).</p>
      <div class="row-btns"><button class="btn btn-ghost" id="mExp">${icon("download", 16)} Ekspor CSV</button><button class="btn btn-delete" id="mClean">${icon("delete_sweep", 16)} Bersihkan data lama</button></div></details></div>`;

    /* room rows */
    el.onclick = e => {
        const d = e.target.closest("[data-delrow]"); if (d) d.closest("tr").remove();
        const a = e.target.closest("[data-addroom]"); if (a) $(`table[data-lok="${CSS.escape(a.dataset.addroom)}"] tbody`, el).insertAdjacentHTML("beforeend", roomRow({ name: "", rate: 0, baseCap: 4, maxCap: 10, extraPrice: 0, active: true }));
    };
    /* libur */
    const drawHol = () => {
        $("#holList", el).innerHTML = hol.length ? hol.sort((a, b) => a.date.localeCompare(b.date)).map((h, i) => `<div class="kv"><span>${esc(h.date)} · ${esc(h.lokasi === "ALL" ? "Semua" : h.lokasi)}</span><b>${esc(h.alasan || "-")} <button class="btn btn-ghost btn-sm" data-hdel="${i}" type="button">${icon("close", 12)}</button></b></div>`).join("") : `<p class="muted">Belum ada hari libur.</p>`;
        $$("[data-hdel]", el).forEach(b => b.onclick = () => { hol.splice(+b.dataset.hdel, 1); drawHol(); });
    };
    drawHol();
    $("#hAdd", el).onclick = () => { const date = $("#hDate", el).value; if (!date) return toast("Pilih tanggal", "error"); hol.push({ date, lokasi: $("#hLok", el).value, alasan: $("#hWhy", el).value.trim() }); $("#hWhy", el).value = ""; drawHol(); toast("Libur ditambahkan. Jangan lupa tekan Simpan.", "info"); };

    /* QRIS */
    const drawQ = () => $$("[data-q]", el).forEach(box => {
        const k = box.dataset.q, q = S.qris[k];
        $("[data-qinfo]", box).textContent = q ? `Tersimpan: ${q.merchant || "(tanpa nama)"}` : "Belum ada";
        $("[data-qprev]", box).innerHTML = q ? (() => { try { return `<div class="qris-prev">${qrSvg(makeDynamic(q.payload, 1000), 3)}</div><small class="hint">Contoh QR nominal ${rupiah(1000)} (hanya tes, jangan dibayar)</small>`; } catch (e) { return ""; } })() : "";
    });
    drawQ();
    $$("[data-qfile]", el).forEach(inp => inp.onchange = async () => {
        const f = inp.files[0]; if (!f) return; const k = inp.closest("[data-q]").dataset.q;
        try {
            const payload = (await decodeQrFromFile(f)).trim(), info = validateQris(payload);
            S.qris[k] = { payload, merchant: info.merchant, image: await compressImage(f, 700, 0.7) };
            await setDoc(doc(db, "config", "qris"), S.qris); drawQ(); toast(`QRIS ${k} tersimpan: ${info.merchant}`, "success");
        } catch (e) { toast(e.message || "Gagal membaca QRIS", "error"); }
        inp.value = "";
    });
    $$("[data-qdel]", el).forEach(b => b.onclick = async () => { const k = b.closest("[data-q]").dataset.q; if (!S.qris[k] || !confirm("Hapus QRIS " + k + "?")) return; delete S.qris[k]; await setDoc(doc(db, "config", "qris"), S.qris); drawQ(); });

    $("#mExp", el).onclick = H.exportCsv; $("#mClean", el).onclick = () => H.cleanup(90);

    /* simpan */
    $("#setSave", el).onclick = async e => {
        const g = id => parseFloat(String($("#" + id, el).value).replace(",", ".")) || 0;
        const next = { ...st, dpPercent: g("sDp"), holdMinutes: g("sHold"), bufferMin: g("sBuf"), noShowGraceMin: g("sGrace"), pendingTtlHours: g("sTtl"), minLeadMin: g("sLead"), maxDurasi: g("sMaxD") || 12, micPrice: parseNum($("#sMic", el).value), addonPerHour: $("#sPerHour", el).checked, adminWA: $("#sWa", el).value.trim() ? normWA($("#sWa", el).value) : "", policy: $("#sPolicy", el).value.trim(), holidays: hol, rooms: {}, templates: {} };
        if (next.dpPercent < 1 || next.dpPercent > 100) return toast("DP harus 1–100%", "error");
        for (const l of st.lokasi) {
            const rows = $$(`table[data-lok="${CSS.escape(l)}"] tr[data-row]`, el), names = new Set(); next.rooms[l] = [];
            for (const tr of rows) {
                const f = n => $(`[data-f=${n}]`, tr), name = f("name").value.trim();
                if (!name) return toast("Nama room tidak boleh kosong", "error");
                if (names.has(name)) return toast(`Nama room ganda: ${name}`, "error"); names.add(name);
                next.rooms[l].push({ name, rate: parseNum(f("rate").value), baseCap: parseInt(f("baseCap").value) || 1, maxCap: parseInt(f("maxCap").value) || 0, extraPrice: parseNum(f("extraPrice").value), active: f("active").checked });
            }
        }
        $$("[data-tpl]", el).forEach(t => next.templates[t.dataset.tpl] = t.value);
        e.currentTarget.disabled = true;
        try { await setDoc(doc(db, "config", "settings"), next); Object.assign(S.st, next); S.needSeed = false; toast("Pengaturan tersimpan", "success"); }
        catch (err) { toast("Gagal menyimpan: " + (err.code || err.message), "error"); }
        e.currentTarget.disabled = false;
    };
}
