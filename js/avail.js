import { db, doc, getDoc, runTransaction, serverTimestamp } from "./fb.js";
import { witaDate, now } from "./lib.js";

const DAY = 86400000;
export const slug = s => String(s).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toUpperCase();
export const availId = (lok, room, date) => `${slug(lok)}__${slug(room)}__${date}`;
export function datesTouched(s, e, buf = 0) {
    const out = [], last = witaDate(e + buf);
    let t = Date.parse(witaDate(s - buf) + "T00:00:00+08:00");
    for (let i = 0; i < 6; i++) { const d = witaDate(t); out.push(d); if (d >= last) break; t += DAY; }
    return out;
}
export const overlaps = (s, e, r, buf = 0) => s < r.e + buf && e > r.s - buf;
export const occupied = (r, t = now(), alive) => r.k !== "hold" || (r.until || 0) > t || (alive ? !!alive(r.bid) : false);

const cache = new Map();
export async function fetchDay(lok, room, date, fresh = false) {
    const id = availId(lok, room, date), c = cache.get(id);
    if (!fresh && c && Date.now() - c.t < 20000) return c.v;
    let v = [];
    try { const s = await getDoc(doc(db, "availability", id)); v = s.exists() ? (s.data().ranges || []) : []; } catch (e) { console.warn(e); }
    cache.set(id, { t: Date.now(), v }); return v;
}
export async function rangesForDay(lok, room, date, fresh) {
    const [a, b] = await Promise.all([fetchDay(lok, room, date, fresh), fetchDay(lok, room, witaDate(Date.parse(date + "T12:00:00+08:00") + DAY), fresh)]);
    return [...a, ...b];
}
export function conflictsIn(ranges, s, e, bufMs, t = now(), alive, ignoreBid) {
    return ranges.filter(r => r.bid !== ignoreBid && overlaps(s, e, r, bufMs) && occupied(r, t, alive));
}
export async function checkFree(lok, room, s, e, bufMs, fresh) {
    const dates = datesTouched(s, e, bufMs); let all = [];
    for (const d of dates) all = all.concat(await fetchDay(lok, room, d, fresh));
    return conflictsIn(all, s, e, bufMs).length === 0;
}

export async function applyTx({ remove = [], add = null, bufMs = 0, alive, bookingRef = null, bookingData = null, bookingCreate = false, force = false }) {
    const refs = new Map();
    const need = (lok, room, s, e, buf) => datesTouched(s, e, buf).forEach(d => refs.set(availId(lok, room, d), { lok, room, date: d }));
    remove.forEach(r => need(r.lokasi, r.room, r.s, r.e, 0));
    if (add) need(add.lokasi, add.room, add.s, add.e, bufMs);
    const removeBids = new Set(remove.map(r => r.bid)); if (add) removeBids.add(add.bid);
    const t = now();
    return runTransaction(db, async tx => {
        const data = new Map();
        for (const [id] of refs) { const s = await tx.get(doc(db, "availability", id)); data.set(id, s.exists() ? (s.data().ranges || []) : []); }
        if (add && !force) {
            for (const [, ranges] of data) {
                const c = conflictsIn(ranges, add.s, add.e, bufMs, t, alive, add.bid);
                if (c.length) { const err = new Error("SLOT_BENTROK"); err.conflicts = c; throw err; }
            }
        }
        const addDates = add ? new Set(datesTouched(add.s, add.e, 0)) : new Set();
        for (const [id, ranges] of data) {
            const info = refs.get(id);
            let next = ranges.filter(r => !removeBids.has(r.bid) && occupied(r, t, alive));
            if (add && addDates.has(info.date)) { const n = { s: add.s, e: add.e, k: add.k, bid: add.bid }; if (add.until) n.until = add.until; next.push(n); }
            tx.set(doc(db, "availability", id), { ranges: next, upd: serverTimestamp() });
        }
        if (bookingRef && bookingData) { if (bookingCreate) tx.set(bookingRef, bookingData); else tx.update(bookingRef, bookingData); }
    });
}
export const clearCache = () => cache.clear();
