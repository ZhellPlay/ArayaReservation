// QRIS: baca QRIS statis, ubah jadi dinamis (nominal terkunci), hitung CRC16
export function crc16(str) {
    let crc = 0xFFFF;
    for (let i = 0; i < str.length; i++) {
        crc ^= str.charCodeAt(i) << 8;
        for (let j = 0; j < 8; j++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
    return crc.toString(16).toUpperCase().padStart(4, "0");
}
export function parseTLV(s) {
    const out = []; let i = 0;
    while (i + 4 <= s.length) {
        const tag = s.substr(i, 2), len = parseInt(s.substr(i + 2, 2), 10);
        if (isNaN(len) || i + 4 + len > s.length) throw new Error("Format QRIS tidak valid");
        out.push([tag, s.substr(i + 4, len)]); i += 4 + len;
    }
    return out;
}
const build = list => list.map(([t, v]) => t + String(v.length).padStart(2, "0") + v).join("");
export function validateQris(p) {
    p = String(p || "").trim();
    if (!p.startsWith("000201")) throw new Error("Bukan QRIS (harus diawali 000201)");
    if (p.slice(-8, -4) !== "6304" || crc16(p.slice(0, -4)) !== p.slice(-4).toUpperCase()) throw new Error("Checksum QRIS tidak cocok, foto kurang jelas?");
    const tags = Object.fromEntries(parseTLV(p));
    return { merchant: tags["59"] || "", city: tags["60"] || "", isDynamic: tags["01"] === "12" };
}
// QRIS statis -> dinamis dengan nominal. Dipasang di aplikasi e-wallet, nominal ikut terkunci.
export function makeDynamic(staticPayload, amount) {
    amount = Math.round(Number(amount));
    if (!(amount > 0)) throw new Error("Nominal tidak valid");
    let list = parseTLV(staticPayload.trim()).filter(([t]) => t !== "63" && t !== "54");
    list = list.map(([t, v]) => t === "01" ? [t, "12"] : [t, v]);
    const idx = list.findIndex(([t]) => t === "58");
    const item = ["54", String(amount)];
    if (idx >= 0) list.splice(idx, 0, item); else list.push(item);
    const body = build(list) + "6304";
    return body + crc16(body);
}
// baca QR dari file foto (butuh jsQR global)
export async function decodeQrFromFile(file) {
    const bmp = await createImageBitmap(file);
    for (const maxSide of [1200, 800, 1600, 500]) {
        const sc = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
        const c = document.createElement("canvas"); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
        const cx = c.getContext("2d", { willReadFrequently: true }); cx.drawImage(bmp, 0, 0, c.width, c.height);
        const d = cx.getImageData(0, 0, c.width, c.height);
        const r = window.jsQR(d.data, d.width, d.height, { inversionAttempts: "attemptBoth" });
        if (r && r.data) return r.data;
    }
    throw new Error("QR tidak terbaca. Pakai foto/screenshot QRIS yang lurus dan terang.");
}
