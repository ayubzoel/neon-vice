# TUNING v6.3 — kabur ★2 6 dtk + indikator TERLIHAT (di atas 6686263)

Satu ronde tuning kecil menindaklanjuti retest independen (★2 jalan kaki
1/3 lolos). Dua perubahan saja, diuji lokal dengan input sungguhan
(Playwright headless Chromium vs dev server `node serve.ts --port 8112`,
SwiftShader 2–3 FPS, rasio game-time/wall ~0,2–0,25; semua durasi
GAME-TIME via `stats().gameTime`). 0 console/page error, 0 request
eksternal di semua skrip (`tune.js`, `tune2.js`, `tune3.js`).

## Perubahan

1. `game/src/config.js` — `escapeSeconds[2]` 8 → 6 dtk (1★/3★/4★/5★
   tetap 5/12/16/20). Fallback table yang sama di `combat.js`
   `escapeNeeded()` diselaraskan (8 → 6).
2. `game/src/combat.js` `escapeInfo()` — field baru
   `spotted: wanted > 0 && policeCanSee`.
3. `game/src/ui.js` — string baru `spotted`: `SPOTTED!` (EN) /
   `TERLIHAT!` (ID); `setEscape()` memakai slot HUD yang sama:
   - wanted > 0 + dilihat → label merah `SPOTTED!`/`TERLIHAT!`, bar
     disembunyikan; - wanted > 0 + tidak dilihat → `KABUR...`/`ESCAPING...`
     + meter seperti sebelumnya (hijau); - wanted 0 → label hilang.
   Tidak diubah: LOS logic, throttle, maintainForce/spawn, kecepatan /
   lethality polisi, durasi lain, reset penuh ke 0, taman, pin peta,
   mundur, flyover.

## Hasil uji

| Butir | Hasil |
|---|---|
| A. ★2 jalan kaki (3 run, kebijakan retester) | **1/3** — run 2 LOLOS 12,8 dtk (maxProg 1, 0 reset); run 1 gagal maxProg 0 (tidak pernah sembunyi); run 3 gagal maxProg 0,786, 2 reset. Bukti LOS di run 2+3 (escaping, nearest 16,8 m / 33,4 m, LOS false). `needed=6` terkonfirmasi di semua run. |
| B1. ★1 jalan kaki (strategi retester: lari menjauhi polisi) | **0/2** — maxProg 0,12 lalu 0,743 (retry). Lihat catatan di bawah — BUKAN regresi mekanik. |
| B1-diagnostik. ★1 jalan kaki (kebijakan cari-cover, `tune3.js`) | **LOLOS 9,05 dtk** (maxProg 0,98, 1 reset, needed 5). Mekanik ★1 sehat; dua kegagalan B1 adalah strategi "lari menjauh" tanpa cari-cover yang mentok di fasad gedung. |
| B2. ★3 mengemudi (lurus z=120) | **LOLOS 17,2 dtk** (maxProg 0,992, maxNearest 192,6 m, needed 12). |
| B3. Reset timer | **LOLOS (aktif, `tune2.js` B3b)** — progress 0,158 → terlihat lagi → 0, wanted tetap 2. Desain pasif tune.js B3 gagal 2× BUKAN karena game: dengan timer 6 dtk, berdiri diam menunggu polisi membelok tidak sempat (attempt 1 malah kabur duluan). |
| D. Indikator HUD | **LOLOS semua assert DOM + cek visual**: SPOTTED! merah (rgb 239,68,68), bar tersembunyi; TERLIHAT! merah; ESCAPING... 16% hijau (rgb 74,222,128), bar 16% = progres; KABUR... 16% hijau; label hilang saat wanted 0 (EN+ID). Screenshot: `hud-spotted-en.png`, `hud-spotted-id.png`, `hud-escaping-en.png`, `hud-escaping-id.png`. |

## Penilaian jujur

- Timer ★2 6 dtk mempercepat run yang berhasil (12,8 dtk vs 25,95 dtk
  di retest) dan run gagal mencapai progres lebih dalam (0,786 vs
  0,192/0,56), tapi pass rate sampel kecil ini tetap 1/3 — n=3 terlalu
  kecil untuk mengklaim perbaikan pass rate. Run 1 (maxProg 0) adalah
  outlier harness: pemain tidak pernah menemukan penutup sama sekali.
- Indikator TERLIHAT/KABUR terbukti bekerja dan terbaca di screenshot
  (dicek visual 2 dari 4 file). Ini bagian yang paling pasti membantu
  pemain HP: sekarang jelas kapan cover bekerja dan kapan tidak.
- Observasi (bukan cacat tune ini): toast "You escaped!" dari escape
  sebelumnya masih bisa terlihat ~3,5 dtk saat wanted baru dimulai
  (terlihat di `hud-spotted-en.png` bersamaan dengan 2 bintang +
  SPOTTED!) — perilaku toast yang sudah ada, bukan dari perubahan ini.
- Catatan harness: fase D tune.js (screenshot ESCAPING) gagal 2× karena
  tidak ada deteksi nyangkut — diperbaiki di tune2.js (kebijakan run A
  lengkap) dan kedua screenshot tertangkap di attempt 0.

## File bukti (semua di tests/evidence-v6/v63-tune/)

- `tune.js`, `tune.json` — run utama A–D
- `tune2.js`, `tune2.json` — suplemen: screenshot ESCAPING EN+ID,
  reset aktif, retry B1
- `tune3.js`, `tune3.json` — diagnostik ★1 cari-cover
- `a-run1/2/3-end.png`, `b1-after.png`, `b1-retry-after.png`,
  `b1-cover-after.png`, `b2-after.png`
- `hud-spotted-en.png`, `hud-spotted-id.png`, `hud-escaping-en.png`,
  `hud-escaping-id.png`
