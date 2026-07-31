// Nur Umut Kürkçü Temizlik ve Hijyen - Frontend (Firebase Auth + Firestore, saf statik site)
(function(){
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  const EMAIL_DOMAIN = '@nurumut.local';
  const VARSAYILAN_BIRIMLER = ['adet','koli','galon','paket','bidon'];
  const VARSAYILAN_ODEME_TURLERI = ['Nakit','Havale/EFT','Kredi Kartı','Vadeli/Açık Hesap'];
  const state = { view: 'dashboard', urunler: [], isletmeler: [], birimler: [], odemeTurleri: [], username: null, editingSiparis: null };

  // ---------- Yardımcılar ----------
  function toast(msg, isError) {
    const host = document.getElementById('toastHost');
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' error' : '');
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }
  function money(n) {
    return (Number(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' TL';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function todayISO(){ return new Date().toISOString().slice(0,10); }
  function formatTarih(iso) {
    if (!iso) return '';
    const parts = String(iso).slice(0, 10).split('-');
    if (parts.length !== 3) return iso;
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
  }
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function floor2(n) { return Math.floor(n * 100) / 100; }
  function ceil2(n) { return Math.ceil(n * 100) / 100; }
  function hesaplaDagitim(agirlikliKalemler, hedefToplam) {
    // agirlikliKalemler: [{ad, birim, yaklasikFiyat}] -> [{ad, birim, adet, birimFiyat, tutar}]
    // Sonuç toplamı hedefToplam'ı asla aşmaz (gerekirse birkaç TL altında kalır).
    const toplamAgirlik = agirlikliKalemler.reduce((t, k) => t + (k.yaklasikFiyat || 0), 0);
    if (toplamAgirlik <= 0) return null;
    let dagitilan = 0;
    return agirlikliKalemler.map((k, idx) => {
      let pay = round2(hedefToplam * (k.yaklasikFiyat / toplamAgirlik));
      if (idx === agirlikliKalemler.length - 1) pay = round2(hedefToplam - dagitilan);
      let adet = Math.max(1, Math.round(pay / k.yaklasikFiyat));
      let birimFiyat = floor2(pay / adet);
      if (birimFiyat <= 0) { adet = 1; birimFiyat = floor2(pay); }
      const tutar = round2(adet * birimFiyat);
      dagitilan = round2(dagitilan + tutar);
      return { ad: k.ad, birim: k.birim, adet, birimFiyat, tutar };
    });
  }
  function friendlyAuthError(err) {
    const c = err && err.code;
    if (c === 'auth/wrong-password' || c === 'auth/user-not-found' || c === 'auth/invalid-credential' || c === 'auth/invalid-login-credentials') {
      return 'Kullanıcı adı veya şifre hatalı';
    }
    if (c === 'auth/email-already-in-use') return 'Bu kullanıcı adı zaten kayıtlı';
    if (c === 'auth/weak-password') return 'Şifre en az 6 karakter olmalı';
    return 'İşlem yapılamadı: ' + (err && err.message ? err.message : 'bilinmeyen hata');
  }
  function confirmDialog(message) {
    return new Promise((resolve) => {
      const host = document.createElement('div');
      host.className = 'confirm-backdrop';
      host.innerHTML = `<div class="confirm-box"><p>${esc(message)}</p><div class="row">
        <button class="btn btn-ghost btn-block" id="confirmNo">Vazgeç</button>
        <button class="btn btn-danger btn-block" id="confirmYes">Evet, sil</button>
      </div></div>`;
      document.body.appendChild(host);
      host.querySelector('#confirmNo').addEventListener('click', () => { host.remove(); resolve(false); });
      host.querySelector('#confirmYes').addEventListener('click', () => { host.remove(); resolve(true); });
      host.addEventListener('click', (e) => { if (e.target === host) { host.remove(); resolve(false); } });
    });
  }
  function downloadCsv(filename, rows) {
    const csv = rows.map(r => r.map(c => {
      const v = String(c == null ? '' : c).replace(/"/g, '""');
      return /[",;\n]/.test(v) ? `"${v}"` : v;
    }).join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  }

  // ================= FIRESTORE VERİ KATMANI =================
  const col = {
    urunler: db.collection('urunler'),
    isletmeler: db.collection('isletmeler'),
    siparisler: db.collection('siparisler'),
    teklifler: db.collection('teklifler'),
    meta: db.collection('meta')
  };

  async function fsGetUrunler() {
    const snap = await col.urunler.orderBy('ad').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  async function fsAddUrun(payload) {
    const data = { ...payload, olusturmaTarihi: new Date().toISOString() };
    const ref = await col.urunler.add(data);
    return { id: ref.id, ...data };
  }
  async function fsUpdateUrun(id, payload) {
    await col.urunler.doc(id).update(payload);
  }
  async function fsDeleteUrun(id) {
    await col.urunler.doc(id).delete();
  }

  async function fsGetAllSiparisler() {
    const snap = await col.siparisler.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  function isletmeBakiyeHesapla(siparisler, isletmeId) {
    let bakiye = 0;
    for (const s of siparisler) {
      if (s.isletmeId !== isletmeId) continue;
      const kalan = round2(s.toplamTutar - (s.odenenTutar || 0));
      if (s.tur === 'satis') bakiye += kalan; else bakiye -= kalan;
    }
    return round2(bakiye);
  }
  async function fsGetIsletmeler() {
    const [isletmelerSnap, siparisler] = await Promise.all([col.isletmeler.orderBy('ad').get(), fsGetAllSiparisler()]);
    return isletmelerSnap.docs.map(d => {
      const i = { id: d.id, ...d.data() };
      return { ...i, bakiye: isletmeBakiyeHesapla(siparisler, i.id) };
    });
  }
  async function fsAddIsletme(payload) {
    const data = { ...payload, olusturmaTarihi: new Date().toISOString() };
    const ref = await col.isletmeler.add(data);
    return { id: ref.id, ...data };
  }
  async function fsUpdateIsletme(id, payload) {
    await col.isletmeler.doc(id).update(payload);
  }
  async function fsDeleteIsletme(id) {
    await col.isletmeler.doc(id).delete();
  }
  async function fsGetIsletmeDetay(id) {
    const [isletmeSnap, siparislerSnap] = await Promise.all([
      col.isletmeler.doc(id).get(),
      col.siparisler.where('isletmeId', '==', id).get()
    ]);
    if (!isletmeSnap.exists) throw new Error('İşletme bulunamadı');
    const isletme = { id: isletmeSnap.id, ...isletmeSnap.data() };
    const siparisler = siparislerSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.tarih < b.tarih ? 1 : -1));
    const bakiye = isletmeBakiyeHesapla(siparisler, id);
    return { ...isletme, bakiye, siparisler };
  }

  async function fsGetStok() {
    const snap = await col.urunler.orderBy('ad').get();
    return snap.docs.map(d => {
      const u = d.data();
      return {
        id: d.id, ad: u.ad, birim: u.birim, stokTakibi: !!u.stokTakibi,
        stokAdedi: u.stokAdedi, kritikStok: u.kritikStok,
        kritikMi: u.stokTakibi && u.stokAdedi != null && u.kritikStok != null && u.stokAdedi <= u.kritikStok
      };
    });
  }
  async function fsUpdateStok(id, payload) {
    await col.urunler.doc(id).update(payload);
  }

  async function fsAddSiparis(payload) {
    const isletmeRef = col.isletmeler.doc(payload.isletmeId);
    const sayacRef = col.meta.doc('sayaclar');
    const yeniSiparisRef = col.siparisler.doc();

    return db.runTransaction(async (tx) => {
      const isletmeSnap = await tx.get(isletmeRef);
      if (!isletmeSnap.exists) throw new Error('İşletme bulunamadı');
      const sayacSnap = await tx.get(sayacRef);
      const mevcutNo = (sayacSnap.exists && sayacSnap.data().deger) || 0;
      const yeniNo = mevcutNo + 1;

      const kalemUrunler = [];
      for (const k of payload.kalemler) {
        if (!k.urunId) continue;
        const ref = col.urunler.doc(k.urunId);
        const snap = await tx.get(ref);
        kalemUrunler.push({ ref, snap, kalem: k });
      }

      const siparis = {
        isletmeId: payload.isletmeId,
        isletmeAdi: isletmeSnap.data().ad,
        tur: payload.tur,
        tarih: payload.tarih,
        kalemler: payload.kalemler,
        toplamTutar: payload.toplamTutar,
        odemeTuru: payload.odemeTuru,
        odenenTutar: payload.odenenTutar,
        notlar: payload.notlar || '',
        olusturanKullanici: payload.olusturanKullanici || '',
        teslimEdildi: !!payload.teslimEdildi,
        siraNo: yeniNo,
        olusturmaTarihi: new Date().toISOString()
      };
      tx.set(yeniSiparisRef, siparis);
      tx.set(sayacRef, { deger: yeniNo }, { merge: true });

      for (const u of kalemUrunler) {
        if (!u.snap.exists) continue;
        const d = u.snap.data();
        if (d.stokTakibi && d.stokAdedi != null) {
          const yeniStok = round2(d.stokAdedi + (siparis.tur === 'alis' ? u.kalem.adet : -u.kalem.adet));
          tx.update(u.ref, { stokAdedi: yeniStok });
        }
      }
      return { id: yeniSiparisRef.id, ...siparis };
    });
  }

  async function fsUpdateSiparis(id, payload) {
    await col.siparisler.doc(id).update(payload);
  }

  async function fsOdemeEkle(id, ekTutar) {
    await col.siparisler.doc(id).update({
      odenenTutar: firebase.firestore.FieldValue.increment(round2(ekTutar))
    });
  }

  async function fsUpdateSiparisFull(eski, payload) {
    const siparisRef = col.siparisler.doc(eski.id);
    return db.runTransaction(async (tx) => {
      const refMap = new Map();
      async function girdiAl(urunId) {
        const ref = col.urunler.doc(urunId);
        if (!refMap.has(ref.path)) {
          const snap = await tx.get(ref);
          refMap.set(ref.path, {
            ref,
            stokTakibi: snap.exists ? !!snap.data().stokTakibi : false,
            stokAdedi: snap.exists ? snap.data().stokAdedi : null
          });
        }
        return refMap.get(ref.path);
      }
      for (const k of eski.kalemler) {
        if (!k.urunId) continue;
        const g = await girdiAl(k.urunId);
        if (g.stokTakibi && g.stokAdedi != null) {
          g.stokAdedi = round2(g.stokAdedi + (eski.tur === 'alis' ? -k.adet : k.adet));
        }
      }
      for (const k of payload.kalemler) {
        if (!k.urunId) continue;
        const g = await girdiAl(k.urunId);
        if (g.stokTakibi && g.stokAdedi != null) {
          g.stokAdedi = round2(g.stokAdedi + (payload.tur === 'alis' ? k.adet : -k.adet));
        }
      }
      const yeni = {
        isletmeId: payload.isletmeId, isletmeAdi: payload.isletmeAdi,
        tur: payload.tur, tarih: payload.tarih, kalemler: payload.kalemler,
        toplamTutar: payload.toplamTutar, odemeTuru: payload.odemeTuru,
        odenenTutar: payload.odenenTutar, notlar: payload.notlar || '',
        olusturanKullanici: eski.olusturanKullanici || payload.duzenleyen || '',
        teslimEdildi: !!payload.teslimEdildi,
        siraNo: eski.siraNo, olusturmaTarihi: eski.olusturmaTarihi,
        sonDuzenleyen: payload.duzenleyen || '', sonDuzenlemeTarihi: new Date().toISOString()
      };
      tx.set(siparisRef, yeni);
      for (const g of refMap.values()) {
        if (g.stokTakibi && g.stokAdedi != null) tx.update(g.ref, { stokAdedi: g.stokAdedi });
      }
      return { id: eski.id, ...yeni };
    });
  }

  async function fsDeleteSiparis(siparis) {
    return db.runTransaction(async (tx) => {
      const urunSnaps = [];
      for (const k of siparis.kalemler) {
        if (!k.urunId) continue;
        const ref = col.urunler.doc(k.urunId);
        const snap = await tx.get(ref);
        urunSnaps.push({ ref, snap, kalem: k });
      }
      const iptalRef = col.meta.doc('iptalEdilenSiparisler');
      const iptalSnap = await tx.get(iptalRef);
      tx.delete(col.siparisler.doc(siparis.id));
      for (const u of urunSnaps) {
        if (!u.snap.exists) continue;
        const d = u.snap.data();
        if (d.stokTakibi && d.stokAdedi != null) {
          const geriAlinan = round2(d.stokAdedi + (siparis.tur === 'alis' ? -u.kalem.adet : u.kalem.adet));
          tx.update(u.ref, { stokAdedi: geriAlinan });
        }
      }
      // Silinen sipariş numarasını kayıt altına al — bu numara bir daha asla
      // yeni bir siparişe verilmez (sayaç zaten hep ileri gider, geri sayılmaz).
      const mevcutKayit = iptalSnap.exists && Array.isArray(iptalSnap.data().liste) ? iptalSnap.data().liste : [];
      tx.set(iptalRef, { liste: [...mevcutKayit, { siraNo: siparis.siraNo, isletmeAdi: siparis.isletmeAdi, tutar: siparis.toplamTutar, silinmeTarihi: new Date().toISOString() }].slice(-200) });
    });
  }

  async function fsAddUser(username, password) {
    const email = username.trim().toLowerCase() + EMAIL_DOMAIN;
    await secondaryAuth.createUserWithEmailAndPassword(email, password);
    await secondaryAuth.signOut();
  }

  // ---- Ayarlanabilir listeler: birimler, ödeme türleri, firma ----
  async function fsGetBirimler() {
    const snap = await col.meta.doc('birimler').get();
    if (!snap.exists || !Array.isArray(snap.data().liste) || !snap.data().liste.length) return VARSAYILAN_BIRIMLER.slice();
    return snap.data().liste;
  }
  async function fsSetBirimler(liste) {
    await col.meta.doc('birimler').set({ liste }, { merge: true });
  }
  async function fsGetOdemeTurleri() {
    const snap = await col.meta.doc('odemeTurleri').get();
    if (!snap.exists || !Array.isArray(snap.data().liste) || !snap.data().liste.length) return VARSAYILAN_ODEME_TURLERI.slice();
    return snap.data().liste;
  }
  async function fsSetOdemeTurleri(liste) {
    await col.meta.doc('odemeTurleri').set({ liste }, { merge: true });
  }
  async function fsGetFirma() {
    const snap = await col.meta.doc('firma').get();
    return snap.exists ? snap.data() : { ad: 'Nur Umut Kürkçü Temizlik ve Hijyen', telefon: '', adres: '' };
  }
  async function fsSetFirma(payload) {
    await col.meta.doc('firma').set(payload, { merge: true });
  }

  // ---- Teklifler / Faturalar ----
  async function fsGetTeklifler() {
    const snap = await col.teklifler.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.tarih < b.tarih ? 1 : -1));
  }
  async function fsAddTeklif(payload) {
    const data = { ...payload, durum: 'taslak', olusturmaTarihi: new Date().toISOString() };
    const ref = await col.teklifler.add(data);
    return { id: ref.id, ...data };
  }
  async function fsUpdateTeklif(id, payload) {
    await col.teklifler.doc(id).update(payload);
  }
  async function fsDeleteTeklif(id) {
    await col.teklifler.doc(id).delete();
  }
  function kdvAyristir(toplamKdvDahil, kdvOrani) {
    const matrah = round2(toplamKdvDahil / (1 + (kdvOrani || 0) / 100));
    const kdv = round2(toplamKdvDahil - matrah);
    return { matrah, kdv };
  }

  async function fsGetDashboard() {
    const [isletmelerSnap, siparisler, urunler] = await Promise.all([
      col.isletmeler.get(), fsGetAllSiparisler(), fsGetUrunler()
    ]);
    let toplamAlacak = 0, toplamBorc = 0;
    const isletmeBakiyeleri = [];
    for (const d of isletmelerSnap.docs) {
      const b = isletmeBakiyeHesapla(siparisler, d.id);
      if (b > 0) toplamAlacak += b; else if (b < 0) toplamBorc += -b;
      if (b !== 0) isletmeBakiyeleri.push({ ad: d.data().ad, bakiye: b });
    }
    isletmeBakiyeleri.sort((a, b) => Math.abs(b.bakiye) - Math.abs(a.bakiye));
    const sonSiparisler = [...siparisler].sort((a, b) => (a.tarih < b.tarih ? 1 : -1)).slice(0, 8);
    const kritikStoklar = urunler.filter(u => u.stokTakibi && u.stokAdedi != null && u.kritikStok != null && u.stokAdedi <= u.kritikStok);
    const teslimatBekleyen = siparisler.filter(s => !s.teslimEdildi).sort((a, b) => (a.tarih < b.tarih ? 1 : -1));
    return {
      toplamAlacak: round2(toplamAlacak), toplamBorc: round2(toplamBorc),
      isletmeSayisi: isletmelerSnap.size, urunSayisi: urunler.length,
      sonSiparisler, kritikStoklar, teslimatBekleyen,
      alacaklarim: isletmeBakiyeleri.filter(i => i.bakiye > 0),
      borclarim: isletmeBakiyeleri.filter(i => i.bakiye < 0)
    };
  }

  // ---------- İrsaliye PDF (tarayıcıda, pdf-lib ile) ----------
  function pdfTr(text) {
    return String(text || '')
      .replace(/İ/g, 'I').replace(/ı/g, 'i').replace(/Ğ/g, 'G').replace(/ğ/g, 'g')
      .replace(/Ş/g, 'S').replace(/ş/g, 's').replace(/Ç/g, 'C').replace(/ç/g, 'c')
      .replace(/Ö/g, 'O').replace(/ö/g, 'o').replace(/Ü/g, 'U').replace(/ü/g, 'u');
  }
  async function irsaliyePdfOlusturVeAc(siparis) {
    const firma = await fsGetFirma();
    const { PDFDocument, rgb, StandardFonts } = PDFLib;
    const doc = await PDFDocument.create();
    const page = doc.addPage([595.28, 841.89]);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const { width, height } = page.getSize();
    const marginX = 50;
    let y = height - 60;
    const koyu = rgb(0.06, 0.32, 0.32);
    const gri = rgb(0.35, 0.35, 0.35);

    page.drawText(pdfTr(firma.ad || 'Nur Umut Kurkcu Temizlik ve Hijyen'), { x: marginX, y, size: 16, font: fontBold, color: koyu });
    y -= 18;
    if (firma.telefon) { page.drawText(pdfTr(firma.telefon), { x: marginX, y, size: 9, font, color: gri }); y -= 12; }
    if (firma.adres) { page.drawText(pdfTr(firma.adres), { x: marginX, y, size: 9, font, color: gri }); y -= 12; }

    const baslikY = height - 60;
    page.drawText(siparis.tur === 'alis' ? pdfTr('ALIS IRSALIYESI') : pdfTr('SATIS IRSALIYESI'), { x: width - 230, y: baslikY, size: 13, font: fontBold, color: koyu });
    page.drawText(`No: ${siparis.siraNo}`, { x: width - 230, y: baslikY - 16, size: 10, font, color: gri });
    page.drawText(`Tarih: ${formatTarih(siparis.tarih)}`, { x: width - 230, y: baslikY - 30, size: 10, font, color: gri });

    y -= 20;
    page.drawLine({ start: { x: marginX, y }, end: { x: width - marginX, y }, thickness: 1, color: rgb(0.85, 0.85, 0.85) });
    y -= 20;
    page.drawText(pdfTr('Isletme:'), { x: marginX, y, size: 10, font: fontBold, color: koyu });
    page.drawText(pdfTr(siparis.isletmeAdi || ''), { x: marginX + 55, y, size: 10, font, color: rgb(0, 0, 0) });
    y -= 25;

    const cols = [
      { label: 'Urun', x: marginX }, { label: 'Adet', x: marginX + 190 }, { label: 'Birim', x: marginX + 240 },
      { label: 'Birim Fiyat', x: marginX + 300 }, { label: 'KDV%', x: marginX + 390 }, { label: 'Tutar', x: marginX + 440 }
    ];
    page.drawRectangle({ x: marginX, y: y - 4, width: width - 2 * marginX, height: 20, color: rgb(0.93, 0.96, 0.95) });
    for (const c of cols) page.drawText(pdfTr(c.label), { x: c.x + 4, y, size: 9, font: fontBold, color: koyu });
    y -= 24;

    for (const k of siparis.kalemler) {
      if (y < 100) { page.drawText('...', { x: marginX, y, size: 9, font }); break; }
      page.drawText(pdfTr(k.urunAdi).slice(0, 32), { x: cols[0].x + 4, y, size: 9, font, color: rgb(0, 0, 0) });
      page.drawText(String(k.adet), { x: cols[1].x + 4, y, size: 9, font });
      page.drawText(pdfTr(k.birim || 'adet'), { x: cols[2].x + 4, y, size: 9, font });
      page.drawText(k.birimFiyat.toFixed(2), { x: cols[3].x + 4, y, size: 9, font });
      page.drawText(String(k.kdvOrani), { x: cols[4].x + 4, y, size: 9, font });
      page.drawText(k.tutar.toFixed(2), { x: cols[5].x + 4, y, size: 9, font });
      y -= 18;
    }
    y -= 10;
    page.drawLine({ start: { x: marginX, y }, end: { x: width - marginX, y }, thickness: 1, color: rgb(0.85, 0.85, 0.85) });
    y -= 24;
    page.drawText(pdfTr('Genel Toplam (KDV Dahil):'), { x: marginX + 260, y, size: 11, font: fontBold, color: koyu });
    page.drawText(`${siparis.toplamTutar.toFixed(2)} TL`, { x: marginX + 430, y, size: 11, font: fontBold, color: rgb(0, 0, 0) });
    y -= 18;
    page.drawText(pdfTr('Odeme Turu: ') + pdfTr(siparis.odemeTuru), { x: marginX + 260, y, size: 9, font, color: gri });
    y -= 14;
    const kalan = siparis.toplamTutar - (siparis.odenenTutar || 0);
    page.drawText(pdfTr('Odenen: ') + `${(siparis.odenenTutar || 0).toFixed(2)} TL   ` + pdfTr('Kalan: ') + `${kalan.toFixed(2)} TL`, { x: marginX + 260, y, size: 9, font, color: gri });
    y -= 14;
    page.drawText(pdfTr('Teslimat: ') + (siparis.teslimEdildi ? pdfTr('Teslim edildi') : pdfTr('Bekliyor')), { x: marginX + 260, y, size: 9, font, color: gri });
    if (siparis.notlar) { y -= 26; page.drawText(pdfTr('Not: ') + pdfTr(siparis.notlar), { x: marginX, y, size: 9, font, color: gri }); }

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    window.open(URL.createObjectURL(blob), '_blank');
  }

  async function teklifPdfOlusturVeAc(isletmeAdi, teklifler) {
    // teklifler: [{hedef, kalemler:[{ad,birim,adet,birimFiyat,tutar}], toplam}]
    const firma = await fsGetFirma();
    const { PDFDocument, rgb, StandardFonts } = PDFLib;
    const doc = await PDFDocument.create();
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const koyu = rgb(0.06, 0.32, 0.32);
    const gri = rgb(0.35, 0.35, 0.35);

    teklifler.forEach((teklif, teklifIdx) => {
      const page = doc.addPage([595.28, 841.89]);
      const { width, height } = page.getSize();
      const marginX = 50;
      let y = height - 60;

      page.drawText(pdfTr(firma.ad || 'Nur Umut Kurkcu Temizlik ve Hijyen'), { x: marginX, y, size: 16, font: fontBold, color: koyu });
      y -= 18;
      if (firma.telefon) { page.drawText(pdfTr(firma.telefon), { x: marginX, y, size: 9, font, color: gri }); y -= 12; }
      if (firma.adres) { page.drawText(pdfTr(firma.adres), { x: marginX, y, size: 9, font, color: gri }); y -= 12; }

      const baslikY = height - 60;
      page.drawText(pdfTr(`TEKLIF ${teklifIdx + 1}`), { x: width - 200, y: baslikY, size: 13, font: fontBold, color: koyu });
      page.drawText(`Tarih: ${formatTarih(todayISO())}`, { x: width - 200, y: baslikY - 16, size: 10, font, color: gri });

      y -= 20;
      page.drawLine({ start: { x: marginX, y }, end: { x: width - marginX, y }, thickness: 1, color: rgb(0.85, 0.85, 0.85) });
      y -= 20;
      page.drawText(pdfTr('Isletme:'), { x: marginX, y, size: 10, font: fontBold, color: koyu });
      page.drawText(pdfTr(isletmeAdi || 'Belirtilmedi'), { x: marginX + 60, y, size: 10, font, color: rgb(0, 0, 0) });
      y -= 25;

      const cols = [
        { label: 'Urun', x: marginX }, { label: 'Adet', x: marginX + 220 }, { label: 'Birim', x: marginX + 270 },
        { label: 'Birim Fiyat', x: marginX + 330 }, { label: 'Tutar', x: marginX + 430 }
      ];
      page.drawRectangle({ x: marginX, y: y - 4, width: width - 2 * marginX, height: 20, color: rgb(0.93, 0.96, 0.95) });
      for (const c of cols) page.drawText(pdfTr(c.label), { x: c.x + 4, y, size: 9, font: fontBold, color: koyu });
      y -= 24;

      for (const k of teklif.kalemler) {
        if (y < 100) { page.drawText('...', { x: marginX, y, size: 9, font }); break; }
        page.drawText(pdfTr(k.ad).slice(0, 36), { x: cols[0].x + 4, y, size: 9, font, color: rgb(0, 0, 0) });
        page.drawText(String(k.adet), { x: cols[1].x + 4, y, size: 9, font });
        page.drawText(pdfTr(k.birim || 'adet'), { x: cols[2].x + 4, y, size: 9, font });
        page.drawText(k.birimFiyat.toFixed(2), { x: cols[3].x + 4, y, size: 9, font });
        page.drawText(k.tutar.toFixed(2), { x: cols[4].x + 4, y, size: 9, font });
        y -= 18;
      }
      y -= 10;
      page.drawLine({ start: { x: marginX, y }, end: { x: width - marginX, y }, thickness: 1, color: rgb(0.85, 0.85, 0.85) });
      y -= 24;
      page.drawText(pdfTr('Teklif Toplami (KDV Dahil):'), { x: marginX + 260, y, size: 11, font: fontBold, color: koyu });
      page.drawText(`${teklif.toplam.toFixed(2)} TL`, { x: marginX + 430, y, size: 11, font: fontBold, color: rgb(0, 0, 0) });
      y -= 30;
      page.drawText(pdfTr('Bu bir tekliftir, kesin siparis degildir. Fiyatlar tahminidir.'), { x: marginX, y, size: 8, font, color: gri });
    });

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    window.open(URL.createObjectURL(blob), '_blank');
  }

  // ---------- Giriş / açılış ----------
  const landing = document.getElementById('landing');
  const loginModal = document.getElementById('loginModal');
  const appEl = document.getElementById('app');
  const loginTrigger = document.getElementById('loginTrigger');
  const closeModal = document.getElementById('closeModal');
  const loginForm = document.getElementById('loginForm');
  const loginError = document.getElementById('loginError');

  loginTrigger.addEventListener('click', () => { loginModal.classList.remove('hidden'); document.getElementById('username').focus(); });
  closeModal.addEventListener('click', () => loginModal.classList.add('hidden'));
  loginModal.addEventListener('click', (e) => { if (e.target === loginModal) loginModal.classList.add('hidden'); });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.classList.add('hidden');
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    try {
      await auth.signInWithEmailAndPassword(username.toLowerCase() + EMAIL_DOMAIN, password);
      loginModal.classList.add('hidden');
    } catch (err) {
      loginError.textContent = friendlyAuthError(err);
      loginError.classList.remove('hidden');
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', () => auth.signOut());

  auth.onAuthStateChanged(async (user) => {
    if (user) {
      state.username = user.email.split('@')[0];
      landing.classList.add('hidden');
      appEl.classList.remove('hidden');
      document.getElementById('sidebarUser').textContent = 'Giriş: ' + state.username.charAt(0).toUpperCase() + state.username.slice(1);
      await refreshLookups();
      setView('dashboard');
    } else {
      state.username = null;
      appEl.classList.add('hidden');
      landing.classList.remove('hidden');
    }
  });

  // ---------- Navigasyon ----------
  const sidebarEl = document.getElementById('sidebar');
  const sidebarBackdrop = document.getElementById('sidebarBackdrop');
  const hamburgerBtn = document.getElementById('hamburgerBtn');
  function sidebarKapat() { sidebarEl.classList.remove('open'); sidebarBackdrop.classList.remove('open'); }
  if (hamburgerBtn) hamburgerBtn.addEventListener('click', () => {
    sidebarEl.classList.toggle('open');
    sidebarBackdrop.classList.toggle('open');
  });
  if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', sidebarKapat);

  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      if (item.dataset.view === 'siparis') state.editingSiparis = null;
      setView(item.dataset.view); sidebarKapat();
    });
  });
  function setView(view) {
    state.view = view;
    document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.view === view));
    render();
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  async function refreshLookups() {
    const [urunler, isletmeler, birimler, odemeTurleri] = await Promise.all([
      fsGetUrunler(), fsGetIsletmeler(), fsGetBirimler(), fsGetOdemeTurleri()
    ]);
    state.urunler = urunler;
    state.isletmeler = isletmeler;
    state.birimler = birimler;
    state.odemeTurleri = odemeTurleri;
  }

  const main = document.getElementById('mainContent');

  async function render() {
    if (state.view === 'dashboard') return renderDashboard();
    if (state.view === 'siparis') return renderSiparisOlustur();
    if (state.view === 'siparisler') return renderSiparisler();
    if (state.view === 'teklif') return renderTeklif();
    if (state.view === 'faturalar') return renderFaturalar();
    if (state.view === 'isletmeler') return renderIsletmeler();
    if (state.view === 'urunler') return renderUrunler();
    if (state.view === 'stok') return renderStok();
    if (state.view === 'ayarlar') return renderAyarlar();
  }

  // ================= PANEL =================
  async function renderDashboard() {
    main.innerHTML = `<div class="page-header"><div><h1>Panel</h1><div class="sub">Genel durum özeti</div></div></div><div id="dashBody">Yükleniyor…</div>`;
    let d;
    try { d = await fsGetDashboard(); } catch (err) { return toast(err.message, true); }
    const body = document.getElementById('dashBody');
    body.innerHTML = `
      <div class="grid grid-4 mt-4">
        <div class="card stat-card positive"><div class="label">Toplam Alacağım</div><div class="value mono">${money(d.toplamAlacak)}</div></div>
        <div class="card stat-card negative"><div class="label">Toplam Borcum</div><div class="value mono">${money(d.toplamBorc)}</div></div>
        <div class="card stat-card"><div class="label">Kayıtlı İşletme</div><div class="value">${d.isletmeSayisi}</div></div>
        <div class="card stat-card"><div class="label">Kayıtlı Ürün</div><div class="value">${d.urunSayisi}</div></div>
      </div>
      <div class="grid grid-2 mt-4">
        <div class="card">
          <h3 style="font-size:15px; margin-bottom:12px; color:var(--teal-700);">Kimden Alacağım (ödeme almadığım işletmeler)</h3>
          ${d.alacaklarim.length ? `<table><tbody>
            ${d.alacaklarim.map(i => `<tr><td>${esc(i.ad)}</td><td class="text-right mono">${money(i.bakiye)}</td></tr>`).join('')}
          </tbody></table>` : `<div class="empty-state">Alacağın görünmüyor.</div>`}
        </div>
        <div class="card">
          <h3 style="font-size:15px; margin-bottom:12px; color:var(--danger);">Kime Borçluyum</h3>
          ${d.borclarim.length ? `<table><tbody>
            ${d.borclarim.map(i => `<tr><td>${esc(i.ad)}</td><td class="text-right mono">${money(Math.abs(i.bakiye))}</td></tr>`).join('')}
          </tbody></table>` : `<div class="empty-state">Borcun görünmüyor.</div>`}
        </div>
      </div>
      <div class="grid grid-2 mt-4">
        <div class="card">
          <h3 style="font-size:15px; margin-bottom:12px;">Teslimat Bekleyen Siparişler</h3>
          ${d.teslimatBekleyen.length ? `<table><thead><tr><th>Tarih</th><th>İşletme</th><th class="text-right">Tutar</th></tr></thead><tbody>
            ${d.teslimatBekleyen.map(s => `<tr><td>${formatTarih(s.tarih)}</td><td>${esc(s.isletmeAdi)}</td><td class="text-right mono">${money(s.toplamTutar)}</td></tr>`).join('')}
          </tbody></table>` : `<div class="empty-state">Bekleyen teslimat yok.</div>`}
        </div>
        <div class="card">
          <h3 style="font-size:15px; margin-bottom:12px;">Kritik Stoklar</h3>
          ${d.kritikStoklar.length ? `<table><thead><tr><th>Ürün</th><th class="text-right">Mevcut</th><th class="text-right">Kritik Seviye</th></tr></thead><tbody>
            ${d.kritikStoklar.map(u => `<tr><td>${esc(u.ad)}</td><td class="text-right mono">${u.stokAdedi}</td><td class="text-right mono">${u.kritikStok}</td></tr>`).join('')}
          </tbody></table>` : `<div class="empty-state">Kritik seviyede ürün yok.</div>`}
        </div>
      </div>
      <div class="card mt-4">
        <h3 style="font-size:15px; margin-bottom:12px;">Son Siparişler</h3>
        ${d.sonSiparisler.length ? `<table><thead><tr><th>Tarih</th><th>İşletme</th><th>Tür</th><th class="text-right">Tutar</th></tr></thead><tbody>
          ${d.sonSiparisler.map(s => `<tr><td>${formatTarih(s.tarih)}</td><td>${esc(s.isletmeAdi)}</td><td><span class="badge badge-${s.tur}">${s.tur === 'satis' ? 'Satış' : 'Alış'}</span></td><td class="text-right mono">${money(s.toplamTutar)}</td></tr>`).join('')}
        </tbody></table>` : `<div class="empty-state">Henüz sipariş yok.</div>`}
      </div>`;
  }

  // ================= SİPARİŞ OLUŞTUR =================
  function renderSiparisOlustur() {
    const editing = state.editingSiparis;
    main.innerHTML = `
      <div class="page-header"><div><h1>${editing ? 'Siparişi Düzenle' : 'Sipariş Oluştur'}</h1><div class="sub">${editing ? `#${editing.siraNo} numaralı sipariş düzenleniyor` : 'Merkezi giriş ekranı — buradaki veriler cari ve stoğa otomatik işlenir'}</div></div>
        ${editing ? '<button id="sipDuzenleIptalBtn" class="btn btn-ghost btn-sm">Düzenlemeyi bırak</button>' : ''}
      </div>
      <div class="card">
        <div class="grid grid-2">
          <div class="field">
            <label>İşletme</label>
            <input type="text" id="sipIsletme" list="isletmeListesi" placeholder="Mevcut işletmeyi seç ya da yeni ad yaz" autocomplete="off" value="${esc(editing ? editing.isletmeAdi : '')}">
            <datalist id="isletmeListesi">
              ${state.isletmeler.map(i => `<option value="${esc(i.ad)}">`).join('')}
            </datalist>
          </div>
          <div class="field">
            <label>Sipariş türü</label>
            <select id="sipTur">
              <option value="satis" ${editing && editing.tur === 'satis' ? 'selected' : ''}>Satış (ben veriyorum)</option>
              <option value="alis" ${editing && editing.tur === 'alis' ? 'selected' : ''}>Alış (ben alıyorum)</option>
            </select>
          </div>
        </div>
        <div class="grid grid-2">
          <div class="field" style="max-width:220px;">
            <label>Tarih</label>
            <input type="date" id="sipTarih" value="${editing ? editing.tarih : todayISO()}">
          </div>
          <div class="field">
            <label style="display:block;">Teslimat</label>
            <label style="font-weight:400; font-size:13.5px;"><input type="checkbox" id="sipTeslimEdildi" ${(!editing || editing.teslimEdildi) ? 'checked' : ''} style="width:auto; margin-right:6px;">Teslim edildi (işaretsiz bırakırsan "bekliyor" olarak kaydedilir)</label>
          </div>
        </div>

        <h3 style="font-size:14px; margin:18px 0 4px;">Kalemler</h3>
        <p class="sub" style="color:var(--ink-soft); font-size:12px; margin:0 0 10px;">
          Fiyatını tam bilmediğin kalemleri "Yklş" ile işaretle, tahmini fiyatını yaz, adedi boş bırak —
          aşağıdaki toplam tutara göre sistem adet ve birim fiyatı otomatik hesaplar.
        </p>
        <datalist id="urunListesi">
          ${state.urunler.map(u => `<option value="${esc(u.ad)}">`).join('')}
        </datalist>
        <datalist id="birimListesi">
          ${state.birimler.map(b => `<option value="${esc(b)}">`).join('')}
        </datalist>
        <datalist id="adetOneriListesi">
          ${[1,2,3,5,10,12,20,24,50,100].map(n => `<option value="${n}">`).join('')}
        </datalist>
        <div class="line-item-header">
          <span>Ürün Adı</span><span>Birim</span><span>Adet</span><span>KDV%</span><span>Birim Fiyat</span><span>Tutar</span><span>Yaklaşık</span><span></span>
        </div>
        <div id="kalemList"></div>
        <button id="kalemEkleBtn" type="button" class="btn btn-ghost btn-sm">+ Kalem ekle</button>

        <div class="grid grid-2 mt-4">
          <div class="field">
            <label>İrsaliye toplam tutarı (yaklaşık dağıtım için gerekli, yoksa kalemlerden hesaplanır)</label>
            <div style="display:flex; gap:8px;">
              <input type="number" step="0.01" id="sipManuelToplam" placeholder="örn. 500" style="flex:1;" value="${editing ? editing.toplamTutar : ''}">
              <button type="button" id="yaklasikDagitBtn" class="btn btn-ghost btn-sm" style="white-space:nowrap;">Yaklaşık Dağıt</button>
            </div>
          </div>
          <div class="field">
            <label>Ödeme türü</label>
            <select id="sipOdemeTuru">
              ${state.odemeTurleri.map(t => `<option ${editing && editing.odemeTuru === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
              <option value="diger" ${editing && !state.odemeTurleri.includes(editing.odemeTuru) ? 'selected' : ''}>Diğer (yaz)</option>
            </select>
            <input type="text" id="sipOdemeDiger" placeholder="Ödeme türünü yaz" class="hidden mt-4" value="${editing && !state.odemeTurleri.includes(editing.odemeTuru) ? esc(editing.odemeTuru) : ''}">
          </div>
        </div>
        <div class="grid grid-2">
          <div class="field">
            <label>Ödenen tutar</label>
            <input type="number" step="0.01" id="sipOdenen" value="${editing ? editing.odenenTutar : 0}">
          </div>
          <div class="field">
            <label>Not</label>
            <input type="text" id="sipNot" placeholder="Opsiyonel" value="${editing ? esc(editing.notlar || '') : ''}">
          </div>
        </div>

        <div style="display:flex; align-items:center; gap:16px;">
          <div class="mono" style="font-size:18px;">Toplam: <span id="sipToplamGoster">0,00 TL</span></div>
          <div class="spacer"></div>
          <button id="sipKaydetBtn" class="btn btn-amber">${editing ? 'Değişiklikleri Kaydet' : 'Siparişi Kaydet'}</button>
        </div>
      </div>
      <div id="sonSiparislerKutu" class="card mt-4"></div>`;

    let kalemSayac = 0;
    const kalemList = document.getElementById('kalemList');

    function kalemSatiriEkle(mevcut) {
      kalemSayac++;
      const rid = 'k' + kalemSayac;
      const row = document.createElement('div');
      row.className = 'line-item-row';
      row.id = rid;
      const ad = mevcut ? esc(mevcut.urunAdi) : '';
      const birim = mevcut ? esc(mevcut.birim || 'adet') : 'adet';
      const adet = mevcut ? mevcut.adet : 1;
      const kdv = mevcut ? mevcut.kdvOrani : 20;
      const fiyat = mevcut ? mevcut.birimFiyat : '';
      row.innerHTML = `
        <input class="k-urun-ad" type="text" list="urunListesi" placeholder="Ürün adı (seç ya da yaz)" autocomplete="off" value="${ad}">
        <input class="k-birim" type="text" list="birimListesi" placeholder="Birim" value="${birim}" autocomplete="off">
        <input class="k-adet" type="number" step="0.01" placeholder="Adet" value="${adet}" list="adetOneriListesi">
        <input class="k-kdv" type="number" placeholder="KDV%" value="${kdv}">
        <input class="k-fiyat" type="number" step="0.01" placeholder="Birim fiyat" value="${fiyat}">
        <div class="k-tutar">0,00 TL</div>
        <label class="k-yaklasik-label" title="Fiyat tahmini, adet otomatik hesaplansın"><input type="checkbox" class="k-yaklasik">Yklş</label>
        <button type="button" class="icon-btn" title="Kaldır">✕</button>
      `;
      kalemList.appendChild(row);

      const adInput = row.querySelector('.k-urun-ad');
      const fiyatInput = row.querySelector('.k-fiyat');
      const kdvInput = row.querySelector('.k-kdv');
      const birimInput = row.querySelector('.k-birim');
      const adetInput = row.querySelector('.k-adet');
      const tutarEl = row.querySelector('.k-tutar');
      const yaklasikCb = row.querySelector('.k-yaklasik');
      function satirTutarGuncelle() {
        const adet = Number(adetInput.value) || 0;
        const fiyat = Number(fiyatInput.value) || 0;
        tutarEl.textContent = money(adet * fiyat);
      }
      adInput.addEventListener('input', () => {
        const eslesen = state.urunler.find(u => u.ad.toLowerCase() === adInput.value.trim().toLowerCase());
        if (eslesen) {
          fiyatInput.value = eslesen.satisFiyati;
          kdvInput.value = eslesen.kdvOrani;
          if (eslesen.birim) birimInput.value = eslesen.birim;
          satirTutarGuncelle();
          toplamGuncelle();
        }
      });
      yaklasikCb.addEventListener('change', () => {
        adetInput.disabled = yaklasikCb.checked;
        adetInput.placeholder = yaklasikCb.checked ? 'Otomatik' : 'Adet';
        if (yaklasikCb.checked) adetInput.value = '';
        satirTutarGuncelle();
        toplamGuncelle();
      });
      row.querySelectorAll('input[type=number], input[type=text]').forEach(inp => inp.addEventListener('input', () => { satirTutarGuncelle(); toplamGuncelle(); }));
      row.querySelector('.icon-btn').addEventListener('click', () => { row.remove(); toplamGuncelle(); });
      satirTutarGuncelle();
      toplamGuncelle();
    }
    document.getElementById('kalemEkleBtn').addEventListener('click', () => kalemSatiriEkle());
    if (editing && editing.kalemler && editing.kalemler.length) {
      editing.kalemler.forEach(k => kalemSatiriEkle(k));
    } else {
      kalemSatiriEkle();
    }

    function toplananHesapla() {
      let toplam = 0;
      kalemList.querySelectorAll('.line-item-row').forEach(row => {
        const adet = Number(row.querySelector('.k-adet').value) || 0;
        const fiyat = Number(row.querySelector('.k-fiyat').value) || 0;
        toplam += adet * fiyat;
      });
      return toplam;
    }
    function toplamGuncelle() {
      const manuel = document.getElementById('sipManuelToplam').value;
      const toplam = manuel !== '' ? Number(manuel) : toplananHesapla();
      document.getElementById('sipToplamGoster').textContent = money(toplam);
    }
    document.getElementById('sipManuelToplam').addEventListener('input', toplamGuncelle);

    document.getElementById('yaklasikDagitBtn').addEventListener('click', () => {
      const manuel = Number(document.getElementById('sipManuelToplam').value);
      if (!manuel || manuel <= 0) return toast('Önce irsaliye toplam tutarını gir', true);
      const rows = [...kalemList.querySelectorAll('.line-item-row')];
      const yaklasikRows = rows.filter(r => r.querySelector('.k-yaklasik').checked);
      const sabitRows = rows.filter(r => !r.querySelector('.k-yaklasik').checked);
      if (!yaklasikRows.length) return toast('En az bir kalemi "Yklş" olarak işaretle ve tahmini fiyatını gir', true);

      let sabitToplam = 0;
      sabitRows.forEach(r => {
        const adet = Number(r.querySelector('.k-adet').value) || 0;
        const fiyat = Number(r.querySelector('.k-fiyat').value) || 0;
        sabitToplam += adet * fiyat;
      });
      const kalan = round2(manuel - sabitToplam);
      if (kalan <= 0) return toast('Sabit (yaklaşık işaretlenmemiş) kalemler toplamı zaten hedefi aşıyor', true);

      const agirlikToplam = yaklasikRows.reduce((t, r) => t + (Number(r.querySelector('.k-fiyat').value) || 0), 0);
      if (agirlikToplam <= 0) return toast('Yaklaşık işaretli kalemlere tahmini birim fiyat gir', true);

      let dagitilanToplam = 0;
      yaklasikRows.forEach((r, idx) => {
        const yaklasikFiyat = Number(r.querySelector('.k-fiyat').value) || 0;
        let pay = round2(kalan * (yaklasikFiyat / agirlikToplam));
        // son satırda yuvarlama farkını kapat (yine de hedefi aşmadan)
        if (idx === yaklasikRows.length - 1) pay = round2(kalan - dagitilanToplam);
        let adet = Math.max(1, Math.round(pay / yaklasikFiyat));
        let birimFiyat = floor2(pay / adet);
        if (birimFiyat <= 0) { adet = 1; birimFiyat = floor2(pay); }
        r.querySelector('.k-adet').value = adet;
        r.querySelector('.k-fiyat').value = birimFiyat;
        r.querySelector('.k-tutar').textContent = money(adet * birimFiyat);
        dagitilanToplam = round2(dagitilanToplam + adet * birimFiyat);
      });
      toplamGuncelle();
      toast('Yaklaşık kalemler dağıtıldı — istersen adet/fiyatı elle de düzeltebilirsin');
    });

    document.getElementById('sipOdemeTuru').addEventListener('change', (e) => {
      document.getElementById('sipOdemeDiger').classList.toggle('hidden', e.target.value !== 'diger');
    });

    document.getElementById('sipKaydetBtn').addEventListener('click', async () => {
      const btn = document.getElementById('sipKaydetBtn');
      const isletmeAdiGirilen = document.getElementById('sipIsletme').value.trim();
      if (!isletmeAdiGirilen) return toast('Lütfen işletme adı girin', true);

      const satirlar = [];
      kalemList.querySelectorAll('.line-item-row').forEach(row => {
        const ad = row.querySelector('.k-urun-ad').value.trim();
        const birim = row.querySelector('.k-birim').value.trim() || 'adet';
        const adet = Number(row.querySelector('.k-adet').value) || 0;
        const fiyat = Number(row.querySelector('.k-fiyat').value) || 0;
        const kdv = Number(row.querySelector('.k-kdv').value) || 0;
        if (!ad || adet <= 0) return;
        satirlar.push({ ad, birim, adet, fiyat, kdv });
      });
      if (satirlar.length === 0) return toast('En az bir geçerli kalem ekleyin (yaklaşık işaretliyse Yaklaşık Dağıt\'a basmayı unutma)', true);
      const eksikFiyat = satirlar.some(s => !s.fiyat || s.fiyat <= 0);
      if (eksikFiyat) return toast('Her kalem için birim fiyat girilmeli (bilmiyorsan "Yklş" işaretleyip Yaklaşık Dağıt kullan)', true);

      const onay = await confirmDialog(editing ? `#${editing.siraNo} numaralı siparişteki değişiklikleri kaydetmek istediğine emin misin?` : 'Bu siparişi kaydetmek istediğine emin misin?');
      if (!onay) return;

      btn.disabled = true;
      try {
        let isletme = state.isletmeler.find(i => i.ad.toLowerCase() === isletmeAdiGirilen.toLowerCase());
        if (!isletme) {
          isletme = await fsAddIsletme({ ad: isletmeAdiGirilen, telefon: '', adres: '', vergiNo: '', notlar: '' });
          state.isletmeler.push(isletme);
          toast('Yeni işletme kaydedildi: ' + isletme.ad);
        }

        const kalemler = [];
        const kullanilanBirimler = new Set();
        for (const satir of satirlar) {
          let urun = state.urunler.find(u => u.ad.toLowerCase() === satir.ad.toLowerCase());
          if (!urun) {
            urun = await fsAddUrun({
              ad: satir.ad, kategori: '', birim: satir.birim,
              satisFiyati: satir.fiyat, kdvOrani: satir.kdv,
              stokTakibi: false, stokAdedi: null, kritikStok: null
            });
            state.urunler.push(urun);
            toast('Yeni ürün kaydedildi: ' + urun.ad);
          }
          kalemler.push({
            urunId: urun.id, urunAdi: satir.ad, birim: satir.birim, adet: satir.adet,
            birimFiyat: satir.fiyat, kdvOrani: satir.kdv, tutar: round2(satir.adet * satir.fiyat)
          });
          kullanilanBirimler.add(satir.birim);
        }

        const yeniBirimler = [...kullanilanBirimler].filter(b => !state.birimler.includes(b));
        if (yeniBirimler.length) {
          const guncelListe = [...state.birimler, ...yeniBirimler];
          await fsSetBirimler(guncelListe);
          state.birimler = guncelListe;
        }

        let odemeTuru = document.getElementById('sipOdemeTuru').value;
        if (odemeTuru === 'diger') {
          odemeTuru = document.getElementById('sipOdemeDiger').value.trim() || 'Diğer';
          if (!state.odemeTurleri.includes(odemeTuru)) {
            const guncelListe = [...state.odemeTurleri, odemeTuru];
            await fsSetOdemeTurleri(guncelListe);
            state.odemeTurleri = guncelListe;
          }
        }

        const manuelToplam = document.getElementById('sipManuelToplam').value;
        const hesaplananToplam = round2(kalemler.reduce((t, k) => t + k.tutar, 0));
        const payload = {
          isletmeId: isletme.id,
          isletmeAdi: isletme.ad,
          tur: document.getElementById('sipTur').value === 'alis' ? 'alis' : 'satis',
          tarih: document.getElementById('sipTarih').value || todayISO(),
          kalemler,
          toplamTutar: manuelToplam !== '' ? round2(Number(manuelToplam)) : hesaplananToplam,
          odemeTuru,
          odenenTutar: round2(Number(document.getElementById('sipOdenen').value) || 0),
          notlar: document.getElementById('sipNot').value,
          olusturanKullanici: state.username || '',
          duzenleyen: state.username || '',
          teslimEdildi: document.getElementById('sipTeslimEdildi').checked
        };

        if (editing) {
          await fsUpdateSiparisFull(editing, payload);
          toast('Sipariş güncellendi (No: ' + editing.siraNo + ')');
          state.editingSiparis = null;
        } else {
          const sip = await fsAddSiparis(payload);
          toast('Sipariş kaydedildi (No: ' + sip.siraNo + ')');
        }
        await refreshLookups();
        setView('siparisler');
      } catch (err) {
        toast(err.message, true);
      } finally {
        btn.disabled = false;
      }
    });

    if (editing) {
      document.getElementById('sipDuzenleIptalBtn').addEventListener('click', () => {
        state.editingSiparis = null;
        renderSiparisOlustur();
      });
    }

    // Sayfanın altında son siparişleri göster
    (async () => {
      const kutu = document.getElementById('sonSiparislerKutu');
      try {
        const tumu = await fsGetAllSiparisler();
        tumu.sort((a, b) => (a.tarih < b.tarih ? 1 : (a.tarih > b.tarih ? -1 : (b.siraNo || 0) - (a.siraNo || 0))));
        const son = tumu.slice(0, 6);
        kutu.innerHTML = `<h3 style="font-size:14px; margin-bottom:10px;">Son Siparişler</h3>` + (son.length ? `
          <table><thead><tr><th>Tarih</th><th>İşletme</th><th>Tür</th><th class="text-right">Tutar</th><th></th></tr></thead><tbody>
          ${son.map(s => `<tr><td>${formatTarih(s.tarih)}</td><td>${esc(s.isletmeAdi)}</td><td><span class="badge badge-${s.tur}">${s.tur === 'satis' ? 'Satış' : 'Alış'}</span></td><td class="text-right mono">${money(s.toplamTutar)}</td><td class="text-right"><button class="btn btn-ghost btn-sm" data-goster="${s.id}">Görüntüle</button></td></tr>`).join('')}
          </tbody></table>` : `<div class="empty-state">Henüz sipariş yok.</div>`);
        kutu.querySelectorAll('button[data-goster]').forEach(b => b.addEventListener('click', () => setView('siparisler')));
      } catch (err) { /* sessiz geç */ }
    })();
  }

  // ================= SİPARİŞLER =================
  async function renderSiparisler() {
    main.innerHTML = `
      <div class="page-header"><div><h1>Siparişler</h1><div class="sub">Satıra tıkla, detaylar aşağı açılsın — yazdır, indir veya sil</div></div>
        <button id="csvIndirBtn" class="btn btn-ghost btn-sm">CSV İndir</button></div>
      <div class="toolbar">
        <input type="text" id="sipArama" placeholder="İşletme adı veya sipariş no ile ara">
        <select id="sipIsletmeFiltre">
          <option value="">Tüm işletmeler</option>
          ${state.isletmeler.map(i => `<option value="${esc(i.ad)}">${esc(i.ad)}</option>`).join('')}
        </select>
        <input type="month" id="sipAyFiltre">
        <select id="sipTurFiltre">
          <option value="">Tüm türler</option>
          <option value="satis">Satış</option>
          <option value="alis">Alış</option>
        </select>
        <select id="sipTeslimFiltre">
          <option value="">Tüm teslimatlar</option>
          <option value="evet">Teslim edildi</option>
          <option value="hayir">Bekliyor</option>
        </select>
      </div>
      <div id="isletmeOzetKutu"></div>
      <div id="siparisListesi">Yükleniyor…</div>`;

    let tumu;
    try { tumu = await fsGetAllSiparisler(); } catch (err) { return toast(err.message, true); }
    tumu.sort((a, b) => (a.tarih < b.tarih ? 1 : (a.tarih > b.tarih ? -1 : (b.siraNo || 0) - (a.siraNo || 0))));
    let aktifListe = tumu;

    function kalemSatirlariHtml(s) {
      return s.kalemler.map(k => `<tr>
        <td>${esc(k.urunAdi)}</td><td class="text-right mono">${k.adet}</td><td>${esc(k.birim || 'adet')}</td>
        <td class="text-right mono">${money(k.birimFiyat)}</td><td class="text-right mono">%${k.kdvOrani}</td>
        <td class="text-right mono">${money(k.tutar)}</td>
      </tr>`).join('');
    }

    function ciz(liste) {
      aktifListe = liste;
      const host = document.getElementById('siparisListesi');
      if (!liste.length) { host.innerHTML = `<div class="empty-state">Kayıtlı sipariş yok.</div>`; return; }
      const kalan = (s) => round2(s.toplamTutar - (s.odenenTutar || 0));
      host.innerHTML = liste.map(s => `
        <div class="order-card-wrap">
          <div class="order-card clickable" data-toggle="${s.id}">
            <div class="oc-main">
              <div class="oc-isletme">${esc(s.isletmeAdi)} <span class="badge badge-${s.tur}">${s.tur === 'satis' ? 'Satış' : 'Alış'}</span>
                <button type="button" class="badge status-pill ${s.teslimEdildi ? 'status-green' : 'status-red'}" data-teslimat-toggle="${s.id}" data-mevcut="${s.teslimEdildi ? '1':'0'}" title="Değiştirmek için tıkla">
                  ${s.teslimEdildi ? '✓ Teslim Edildi' : '⏳ Bekliyor'}
                </button>
                <span class="badge status-pill ${kalan(s) > 0 ? 'status-red' : 'status-green'}">${kalan(s) > 0 ? '✕ Ödenmedi' : '✓ Ödendi'}</span>
              </div>
              <div class="oc-meta">#${s.siraNo} · ${formatTarih(s.tarih)} · ${esc(s.olusturanKullanici || 'bilinmiyor')} tarafından oluşturuldu · ${s.kalemler.length} kalem ürün</div>
            </div>
            <div class="oc-tutar mono">${money(s.toplamTutar)}</div>
            <div class="oc-actions">
              <button class="btn btn-ghost btn-sm" data-duzenle="${s.id}">Düzenle</button>
              <button class="btn btn-ghost btn-sm" data-pdf="${s.id}">Yazdır / İndir</button>
              <button class="btn btn-danger btn-sm" data-sil="${s.id}">Sil</button>
            </div>
          </div>
          <div class="order-detail hidden" id="detay-${s.id}">
            <table><thead><tr><th>Ürün</th><th class="text-right">Adet</th><th>Birim</th><th class="text-right">Birim Fiyat</th><th class="text-right">KDV</th><th class="text-right">Tutar</th></tr></thead>
            <tbody>${kalemSatirlariHtml(s)}</tbody></table>
            <div class="mt-4">
              <div class="sub" style="font-size:12.5px;">Sipariş tarihi: <strong>${formatTarih(s.tarih)}</strong>${s.sonDuzenlemeTarihi ? ` · Son düzenleme: ${formatTarih(s.sonDuzenlemeTarihi)} (${esc(s.sonDuzenleyen||'')})` : ''}</div>
              <div class="sub" style="font-size:12.5px;">Ödeme türü: <strong>${esc(s.odemeTuru)}</strong></div>
              <div class="sub" style="font-size:12.5px;">Ödenen: <strong class="mono">${money(s.odenenTutar||0)}</strong> · Kalan: <strong class="mono">${money(kalan(s))}</strong></div>
              ${s.notlar ? `<div class="sub" style="font-size:12.5px;">Not: ${esc(s.notlar)}</div>` : ''}
            </div>
            ${kalan(s) > 0 ? `
            <div style="display:flex; gap:8px; align-items:center; margin-top:12px;">
              <input type="number" step="0.01" class="odeme-ekle-input" placeholder="Ödeme tutarı" style="max-width:160px; padding:8px 10px; border-radius:8px; border:1.5px solid var(--line);">
              <button class="btn btn-primary btn-sm" data-odeme-ekle="${s.id}" data-kalan="${kalan(s)}">Ödeme Ekle</button>
            </div>` : ''}
          </div>
        </div>`).join('');

      host.querySelectorAll('.order-card').forEach(card => card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const detay = document.getElementById('detay-' + card.dataset.toggle);
        detay.classList.toggle('hidden');
      }));
      host.querySelectorAll('button[data-pdf]').forEach(btn => btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const s = liste.find(x => x.id === btn.dataset.pdf);
        try { await irsaliyePdfOlusturVeAc(s); } catch (err) { toast('PDF oluşturulamadı: ' + err.message, true); }
      }));
      host.querySelectorAll('button[data-duzenle]').forEach(btn => btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const s = liste.find(x => x.id === btn.dataset.duzenle);
        state.editingSiparis = s;
        setView('siparis');
      }));
      host.querySelectorAll('button[data-odeme-ekle]').forEach(btn => btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const row = btn.closest('.order-detail');
        const input = row.querySelector('.odeme-ekle-input');
        const tutar = Number(input.value);
        if (!tutar || tutar <= 0) return toast('Geçerli bir ödeme tutarı gir', true);
        const kalanTutar = Number(btn.dataset.kalan);
        if (tutar > kalanTutar + 0.01) {
          const devam = await confirmDialog(`Girdiğin tutar (${money(tutar)}), kalan borçtan (${money(kalanTutar)}) fazla. Yine de eklensin mi?`);
          if (!devam) return;
        }
        try {
          await fsOdemeEkle(btn.dataset.odemeEkle, tutar);
          toast('Ödeme eklendi');
          renderSiparisler();
        } catch (err) { toast(err.message, true); }
      }));
      host.querySelectorAll('button[data-sil]').forEach(btn => btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await confirmDialog('Bu siparişi silmek istediğine emin misin? Bu işlem geri alınamaz ve stok/cari üzerindeki etkisi geri alınır.');
        if (!ok) return;
        const s = liste.find(x => x.id === btn.dataset.sil);
        try { await fsDeleteSiparis(s); toast('Sipariş silindi'); renderSiparisler(); }
        catch (err) { toast(err.message, true); }
      }));
      host.querySelectorAll('button[data-teslimat-toggle]').forEach(btn => btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const yeni = btn.dataset.mevcut !== '1';
        try { await fsUpdateSiparis(btn.dataset.teslimatToggle, { teslimEdildi: yeni }); toast('Teslimat durumu güncellendi'); renderSiparisler(); }
        catch (err) { toast(err.message, true); }
      }));
    }
    ciz(tumu);

    function isletmeOzetGoster(isletmeAdi) {
      const kutu = document.getElementById('isletmeOzetKutu');
      if (!isletmeAdi) { kutu.innerHTML = ''; return; }
      const isletmeSip = tumu.filter(s => s.isletmeAdi === isletmeAdi);
      let alacak = 0, borc = 0;
      isletmeSip.forEach(s => {
        const kalan = round2(s.toplamTutar - (s.odenenTutar || 0));
        if (s.tur === 'satis') alacak += kalan; else borc += kalan;
      });
      const net = round2(alacak - borc);
      kutu.innerHTML = `<div class="card mb-0" style="margin-bottom:16px;">
        <div style="font-weight:600; font-size:14px; margin-bottom:8px;">${esc(isletmeAdi)} — Genel Durum</div>
        <div class="grid grid-4">
          <div><div class="sub" style="font-size:11px;">TOPLAM SİPARİŞ</div><div class="mono" style="font-size:15px;">${isletmeSip.length}</div></div>
          <div><div class="sub" style="font-size:11px;">ALACAĞIM</div><div class="mono" style="font-size:15px; color:var(--teal-700);">${money(alacak)}</div></div>
          <div><div class="sub" style="font-size:11px;">BORCUM</div><div class="mono" style="font-size:15px; color:var(--danger);">${money(borc)}</div></div>
          <div><div class="sub" style="font-size:11px;">NET DURUM</div><div class="mono" style="font-size:15px; color:${net >= 0 ? 'var(--teal-700)' : 'var(--danger)'};">${net >= 0 ? 'Alacaklı: ' : 'Borçlu: '}${money(Math.abs(net))}</div></div>
        </div>
      </div>`;
    }

    function filtrele() {
      const q = document.getElementById('sipArama').value.trim().toLowerCase();
      const tur = document.getElementById('sipTurFiltre').value;
      const teslim = document.getElementById('sipTeslimFiltre').value;
      const isletmeSecili = document.getElementById('sipIsletmeFiltre').value;
      const ay = document.getElementById('sipAyFiltre').value;
      let liste = tumu;
      if (tur) liste = liste.filter(s => s.tur === tur);
      if (teslim === 'evet') liste = liste.filter(s => s.teslimEdildi);
      if (teslim === 'hayir') liste = liste.filter(s => !s.teslimEdildi);
      if (isletmeSecili) liste = liste.filter(s => s.isletmeAdi === isletmeSecili);
      if (ay) liste = liste.filter(s => String(s.tarih || '').slice(0, 7) === ay);
      if (q) liste = liste.filter(s => (s.isletmeAdi || '').toLowerCase().includes(q) || String(s.siraNo).includes(q));
      isletmeOzetGoster(isletmeSecili);
      ciz(liste);
    }
    document.getElementById('sipArama').addEventListener('input', filtrele);
    document.getElementById('sipTurFiltre').addEventListener('change', filtrele);
    document.getElementById('sipTeslimFiltre').addEventListener('change', filtrele);
    document.getElementById('sipIsletmeFiltre').addEventListener('change', filtrele);
    document.getElementById('sipAyFiltre').addEventListener('change', filtrele);

    document.getElementById('csvIndirBtn').addEventListener('click', () => {
      const rows = [['Sipariş No','Tarih','İşletme','Tür','Toplam','Ödenen','Kalan','Ödeme Türü','Teslimat','Oluşturan']];
      aktifListe.forEach(s => rows.push([
        s.siraNo, formatTarih(s.tarih), s.isletmeAdi, s.tur === 'satis' ? 'Satış' : 'Alış',
        s.toplamTutar, s.odenenTutar || 0, round2(s.toplamTutar - (s.odenenTutar||0)),
        s.odemeTuru, s.teslimEdildi ? 'Teslim edildi' : 'Bekliyor', s.olusturanKullanici || ''
      ]));
      downloadCsv('siparisler.csv', rows);
    });
  }

  // ================= İŞLETMELER =================
  async function renderIsletmeler() {
    main.innerHTML = `
      <div class="page-header"><div><h1>İşletmeler</h1><div class="sub">Ürün verdiğin / aldığın işletmeler ve cari bakiyeleri</div></div>
        <button id="yeniIsletmeBtn" class="btn btn-amber">+ Yeni İşletme</button></div>
      <div class="card"><table><thead><tr><th>İşletme</th><th>Telefon</th><th class="text-right">Bakiye</th><th></th></tr></thead>
      <tbody id="islTbody"></tbody></table></div>
      <div id="islDetay" class="card mt-4 hidden"></div>`;

    const isletmeler = await fsGetIsletmeler();
    state.isletmeler = isletmeler;
    const tbody = document.getElementById('islTbody');
    if (isletmeler.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state">Henüz işletme kaydı yok.</div></td></tr>`;
    } else {
      tbody.innerHTML = isletmeler.map(i => `
        <tr class="clickable" data-id="${i.id}">
          <td>${esc(i.ad)}</td>
          <td>${esc(i.telefon || '—')}</td>
          <td class="text-right mono" style="color:${i.bakiye > 0 ? 'var(--teal-700)' : i.bakiye < 0 ? 'var(--danger)' : 'inherit'}">${i.bakiye > 0 ? 'Alacaklıyım ' : i.bakiye < 0 ? 'Borçluyum ' : ''}${money(Math.abs(i.bakiye))}</td>
          <td class="text-right"><button class="btn btn-ghost btn-sm" data-duzenle="${i.id}">Düzenle</button> <button class="btn btn-danger btn-sm" data-sil="${i.id}">Sil</button></td>
        </tr>`).join('');
      tbody.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        isletmeDetay(tr.dataset.id);
      }));
      tbody.querySelectorAll('button[data-sil]').forEach(btn => btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const isl = isletmeler.find(x => x.id === btn.dataset.sil);
        const ok = await confirmDialog(`"${isl.ad}" işletmesini silmek istediğine emin misin? Geçmiş siparişleri etkilemez ama listeden kaybolur.`);
        if (!ok) return;
        try { await fsDeleteIsletme(btn.dataset.sil); toast('İşletme silindi'); renderIsletmeler(); }
        catch (err) { toast(err.message, true); }
      }));
      tbody.querySelectorAll('button[data-duzenle]').forEach(btn => btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isl = isletmeler.find(x => x.id === btn.dataset.duzenle);
        isletmeDuzenleForm(isl);
      }));
    }

    document.getElementById('yeniIsletmeBtn').addEventListener('click', async () => {
      const ad = prompt('İşletme adı:');
      if (!ad) return;
      try {
        await fsAddIsletme({ ad: ad.trim(), telefon: '', adres: '', vergiNo: '', notlar: '' });
        toast('İşletme eklendi');
        renderIsletmeler();
      } catch (err) { toast(err.message, true); }
    });
  }

  function isletmeDuzenleForm(isl) {
    const box = document.getElementById('islDetay');
    box.classList.remove('hidden');
    box.innerHTML = `
      <h3 style="font-size:16px; margin-bottom:14px;">${esc(isl.ad)} — Düzenle</h3>
      <div class="grid grid-2">
        <div class="field"><label>Telefon</label><input id="ideTelefon" type="text" value="${esc(isl.telefon || '')}"></div>
        <div class="field"><label>Vergi No</label><input id="ideVergiNo" type="text" value="${esc(isl.vergiNo || '')}"></div>
      </div>
      <div class="field"><label>Adres</label><input id="ideAdres" type="text" value="${esc(isl.adres || '')}"></div>
      <div class="field"><label>Not</label><input id="ideNotlar" type="text" value="${esc(isl.notlar || '')}"></div>
      <button id="ideKaydetBtn" class="btn btn-primary">Kaydet</button>`;
    document.getElementById('ideKaydetBtn').addEventListener('click', async () => {
      try {
        await fsUpdateIsletme(isl.id, {
          telefon: document.getElementById('ideTelefon').value.trim(),
          vergiNo: document.getElementById('ideVergiNo').value.trim(),
          adres: document.getElementById('ideAdres').value.trim(),
          notlar: document.getElementById('ideNotlar').value.trim()
        });
        toast('İşletme güncellendi');
        renderIsletmeler();
      } catch (err) { toast(err.message, true); }
    });
  }

  async function isletmeDetay(id) {
    const d = await fsGetIsletmeDetay(id);
    const box = document.getElementById('islDetay');
    box.classList.remove('hidden');
    const kalan = (s) => round2(s.toplamTutar - (s.odenenTutar || 0));
    box.innerHTML = `
      <h3 style="font-size:16px;">${esc(d.ad)}</h3>
      <p class="sub" style="color:var(--ink-soft); font-size:13px; margin:4px 0 16px;">
        ${d.telefon ? esc(d.telefon) + ' · ' : ''}${d.adres ? esc(d.adres) : ''}
        ${!d.telefon && !d.adres ? 'İletişim bilgisi eklenmemiş' : ''}
      </p>
      <div class="mono" style="font-size:16px; margin-bottom:16px;">
        Bakiye: ${d.bakiye > 0 ? 'Alacaklıyım — ' : d.bakiye < 0 ? 'Borçluyum — ' : 'Kapalı — '}${money(Math.abs(d.bakiye))}
      </div>
      ${d.siparisler.length ? `<table><thead><tr><th>Tarih</th><th>No</th><th>Tür</th><th>Teslimat</th><th>Ödeme</th><th class="text-right">Toplam</th><th class="text-right">Kalan</th><th></th></tr></thead><tbody>
        ${d.siparisler.map(s => `<tr>
          <td>${formatTarih(s.tarih)}</td><td>#${s.siraNo}</td>
          <td><span class="badge badge-${s.tur}">${s.tur === 'satis' ? 'Satış' : 'Alış'}</span></td>
          <td>${s.teslimEdildi ? '<span class="badge badge-ok">Teslim edildi</span>' : '<span class="badge badge-kritik">Bekliyor</span>'}</td>
          <td style="font-size:12px;">${esc(s.odemeTuru)}${kalan(s) > 0 ? ' · <span style="color:var(--danger)">ödenmedi</span>' : ' · <span style="color:var(--teal-700)">ödendi</span>'}</td>
          <td class="text-right mono">${money(s.toplamTutar)}</td>
          <td class="text-right mono">${money(kalan(s))}</td>
          <td class="text-right"><button class="btn btn-ghost btn-sm" data-irsaliye="${s.id}">İrsaliye</button></td>
        </tr>`).join('')}
      </tbody></table>` : `<div class="empty-state">Bu işletmeyle henüz işlem yok.</div>`}
    `;
    box.querySelectorAll('button[data-irsaliye]').forEach(btn => btn.addEventListener('click', async () => {
      const s = d.siparisler.find(x => x.id === btn.dataset.irsaliye);
      try { await irsaliyePdfOlusturVeAc(s); } catch (err) { toast('PDF oluşturulamadı: ' + err.message, true); }
    }));
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ================= ÜRÜNLER =================
  async function renderUrunler() {
    main.innerHTML = `
      <div class="page-header"><div><h1>Ürünler</h1><div class="sub">Ürün listesi — siparişte hem buradan seçilir hem yeni eklenir</div></div>
        <button id="yeniUrunBtn" class="btn btn-amber">+ Yeni Ürün</button></div>
      <div class="card"><table><thead><tr><th>Ürün</th><th>Kategori</th><th>Birim</th><th class="text-right">Satış Fiyatı (KDV Dahil)</th><th class="text-right">KDV %</th><th>Stok Takibi</th><th></th></tr></thead>
      <tbody id="urunTbody"></tbody></table></div>
      <div id="urunForm" class="card mt-4 hidden"></div>`;

    const urunler = await fsGetUrunler();
    state.urunler = urunler;
    const tbody = document.getElementById('urunTbody');
    tbody.innerHTML = urunler.length ? urunler.map(u => `
      <tr>
        <td>${esc(u.ad)}</td><td>${esc(u.kategori || '—')}</td><td>${esc(u.birim)}</td>
        <td class="text-right mono">${money(u.satisFiyati)}</td>
        <td class="text-right mono">%${u.kdvOrani}</td>
        <td>${u.stokTakibi ? '<span class="badge badge-ok">Açık</span>' : '—'}</td>
        <td class="text-right"><button class="btn btn-ghost btn-sm" data-duzenle="${u.id}">Düzenle</button> <button class="btn btn-danger btn-sm" data-sil="${u.id}">Sil</button></td>
      </tr>`).join('') : `<tr><td colspan="7"><div class="empty-state">Henüz ürün eklenmedi.</div></td></tr>`;

    tbody.querySelectorAll('button[data-sil]').forEach(btn => btn.addEventListener('click', async () => {
      const u = urunler.find(x => x.id === btn.dataset.sil);
      const ok = await confirmDialog(`"${u.ad}" ürününü silmek istediğine emin misin?`);
      if (!ok) return;
      try { await fsDeleteUrun(btn.dataset.sil); toast('Ürün silindi'); renderUrunler(); }
      catch (err) { toast(err.message, true); }
    }));
    tbody.querySelectorAll('button[data-duzenle]').forEach(btn => btn.addEventListener('click', () => {
      const u = urunler.find(x => x.id === btn.dataset.duzenle);
      urunFormAc(u);
    }));

    document.getElementById('yeniUrunBtn').addEventListener('click', () => urunFormAc(null));

    function urunFormAc(mevcutUrun) {
      const box = document.getElementById('urunForm');
      box.classList.remove('hidden');
      const u = mevcutUrun || { ad:'', kategori:'', birim:'adet', satisFiyati:'', kdvOrani:20, stokTakibi:false, stokAdedi:'', kritikStok:'' };
      box.innerHTML = `
        <h3 style="font-size:15px; margin-bottom:14px;">${mevcutUrun ? 'Ürünü Düzenle' : 'Yeni Ürün'}</h3>
        <div class="grid grid-2">
          <div class="field"><label>Ürün adı</label><input id="uAd" type="text" value="${esc(u.ad)}"></div>
          <div class="field"><label>Kategori</label><input id="uKategori" type="text" value="${esc(u.kategori)}"></div>
          <div class="field"><label>Birim</label><input id="uBirim" type="text" list="birimListesiUrun" value="${esc(u.birim)}"></div>
          <div class="field"><label>Satış fiyatı (KDV dahil)</label><input id="uFiyat" type="number" step="0.01" value="${u.satisFiyati}"></div>
          <div class="field"><label>KDV oranı %</label><input id="uKdv" type="number" value="${u.kdvOrani}"></div>
          <div class="field"><label><input id="uStokTakibi" type="checkbox" ${u.stokTakibi ? 'checked' : ''} style="width:auto; margin-right:6px;">Stok takibi yapılsın</label></div>
        </div>
        <datalist id="birimListesiUrun">${state.birimler.map(b => `<option value="${esc(b)}">`).join('')}</datalist>
        <div id="uStokAlanlari" class="grid grid-2 ${u.stokTakibi ? '' : 'hidden'}">
          <div class="field"><label>Stok adedi</label><input id="uStokAdedi" type="number" value="${u.stokAdedi ?? ''}"></div>
          <div class="field"><label>Kritik stok seviyesi</label><input id="uKritikStok" type="number" value="${u.kritikStok ?? ''}"></div>
        </div>
        <button id="uKaydetBtn" class="btn btn-primary">Kaydet</button>`;
      document.getElementById('uStokTakibi').addEventListener('change', (e) => {
        document.getElementById('uStokAlanlari').classList.toggle('hidden', !e.target.checked);
      });
      document.getElementById('uKaydetBtn').addEventListener('click', async () => {
        const stokAcik = document.getElementById('uStokTakibi').checked;
        const payload = {
          ad: document.getElementById('uAd').value.trim(),
          kategori: document.getElementById('uKategori').value.trim(),
          birim: document.getElementById('uBirim').value.trim() || 'adet',
          satisFiyati: Number(document.getElementById('uFiyat').value) || 0,
          kdvOrani: Number(document.getElementById('uKdv').value) || 0,
          stokTakibi: stokAcik,
          stokAdedi: stokAcik ? (Number(document.getElementById('uStokAdedi').value) || 0) : null,
          kritikStok: stokAcik ? (Number(document.getElementById('uKritikStok').value) || 0) : null
        };
        if (!payload.ad) return toast('Ürün adı zorunlu', true);
        try {
          if (mevcutUrun) { await fsUpdateUrun(mevcutUrun.id, payload); toast('Ürün güncellendi'); }
          else { await fsAddUrun(payload); toast('Ürün eklendi'); }
          renderUrunler();
        } catch (err) { toast(err.message, true); }
      });
    }
  }

  // ================= STOK =================
  async function renderStok() {
    main.innerHTML = `
      <div class="page-header"><div><h1>Stok</h1><div class="sub">Tüm ürünler burada — istediğin ürün için stok takibini açıp adet girebilirsin</div></div></div>
      <div class="card"><table><thead><tr><th>Ürün</th><th class="text-right">Mevcut</th><th class="text-right">Kritik Seviye</th><th>Durum</th><th></th></tr></thead>
      <tbody id="stokTbody"></tbody></table></div>`;

    const stok = await fsGetStok();
    const tbody = document.getElementById('stokTbody');
    tbody.innerHTML = stok.length ? stok.map(u => `
      <tr>
        <td>${esc(u.ad)}</td>
        <td class="text-right mono">${u.stokTakibi && u.stokAdedi != null ? u.stokAdedi : '—'}</td>
        <td class="text-right mono">${u.stokTakibi && u.kritikStok != null ? u.kritikStok : '—'}</td>
        <td>${!u.stokTakibi ? '<span class="badge">Takip kapalı</span>' : (u.kritikMi ? '<span class="badge badge-kritik">Kritik</span>' : '<span class="badge badge-ok">Yeterli</span>')}</td>
        <td>${u.stokTakibi
          ? `<button class="btn btn-ghost btn-sm" data-guncelle="${u.id}" data-cur="${u.stokAdedi ?? ''}">Güncelle</button>`
          : `<button class="btn btn-amber btn-sm" data-ac="${u.id}">Stok takibini aç</button>`}</td>
      </tr>`).join('') : `<tr><td colspan="5"><div class="empty-state">Henüz ürün eklenmedi.</div></td></tr>`;

    tbody.querySelectorAll('button[data-guncelle]').forEach(btn => btn.addEventListener('click', async () => {
      const yeni = prompt('Yeni stok adedi:', btn.dataset.cur);
      if (yeni === null) return;
      try {
        await fsUpdateStok(btn.dataset.guncelle, { stokAdedi: Number(yeni) });
        toast('Stok güncellendi');
        renderStok();
      } catch (err) { toast(err.message, true); }
    }));
    tbody.querySelectorAll('button[data-ac]').forEach(btn => btn.addEventListener('click', async () => {
      const adet = prompt('Başlangıç stok adedi:', '0');
      if (adet === null) return;
      const kritik = prompt('Kritik stok seviyesi (bu adedin altına inince uyarı gösterilsin):', '0');
      if (kritik === null) return;
      try {
        await fsUpdateStok(btn.dataset.ac, { stokTakibi: true, stokAdedi: Number(adet) || 0, kritikStok: Number(kritik) || 0 });
        toast('Stok takibi açıldı');
        renderStok();
      } catch (err) { toast(err.message, true); }
    }));
  }

  // ================= AYARLAR =================
  async function renderAyarlar() {
    main.innerHTML = `
      <div class="page-header"><div><h1>Ayarlar</h1><div class="sub">Firma bilgileri, birimler, ödeme türleri ve kullanıcılar</div></div></div>
      <div class="grid grid-2">
        <div class="card">
          <h3 style="font-size:15px; margin-bottom:14px;">Firma Bilgileri</h3>
          <div class="field"><label>Firma adı</label><input id="ayFirmaAd" type="text"></div>
          <div class="field"><label>Telefon</label><input id="ayFirmaTel" type="text"></div>
          <div class="field"><label>Adres</label><input id="ayFirmaAdres" type="text"></div>
          <button id="ayFirmaKaydetBtn" class="btn btn-primary btn-sm">Kaydet</button>
          <p class="sub" style="font-size:12px; color:var(--ink-soft); margin-top:10px;">Bu bilgiler irsaliye/fatura PDF'lerinin üst kısmında görünür.</p>
        </div>
        <div class="card">
          <h3 style="font-size:15px; margin-bottom:14px;">Yeni Kullanıcı Ekle</h3>
          <div class="field"><label>Kullanıcı adı</label><input type="text" id="ayarKullaniciAdi" placeholder="örn. Ayşe" autocomplete="off"></div>
          <div class="field"><label>Şifre</label><input type="password" id="ayarSifre" placeholder="En az 6 karakter"></div>
          <button id="ayarEkleBtn" class="btn btn-primary btn-sm">Kullanıcı Ekle</button>
          <p class="sub" style="font-size:12px; color:var(--ink-soft); margin-top:10px;">Kullanıcı silmek/listelemek için Firebase Console → Authentication → Users.</p>
        </div>
      </div>
      <div class="grid grid-2 mt-4">
        <div class="card">
          <h3 style="font-size:15px; margin-bottom:14px;">Birimler</h3>
          <div id="birimListesiKutu" class="mb-0"></div>
          <div style="display:flex; gap:8px; margin-top:10px;">
            <input type="text" id="yeniBirimInput" placeholder="örn. varil" style="flex:1; padding:8px 10px; border-radius:8px; border:1.5px solid var(--line);">
            <button id="yeniBirimEkleBtn" class="btn btn-ghost btn-sm">Ekle</button>
          </div>
        </div>
        <div class="card">
          <h3 style="font-size:15px; margin-bottom:14px;">Ödeme Türleri</h3>
          <div id="odemeListesiKutu" class="mb-0"></div>
          <div style="display:flex; gap:8px; margin-top:10px;">
            <input type="text" id="yeniOdemeInput" placeholder="örn. Çek" style="flex:1; padding:8px 10px; border-radius:8px; border:1.5px solid var(--line);">
            <button id="yeniOdemeEkleBtn" class="btn btn-ghost btn-sm">Ekle</button>
          </div>
        </div>
      </div>
      <div class="grid grid-2 mt-4">
        <div class="card">
          <h3 style="font-size:15px; margin-bottom:14px;">Hızlı Ürün Ekle</h3>
          <div class="field"><label>Ürün adı</label><input id="aySpUrunAd" type="text"></div>
          <div class="grid grid-2">
            <div class="field"><label>Birim</label><input id="aySpUrunBirim" type="text" list="birimListesiAyarlar" value="adet"></div>
            <div class="field"><label>Satış fiyatı (KDV dahil)</label><input id="aySpUrunFiyat" type="number" step="0.01"></div>
          </div>
          <div class="field"><label>KDV oranı %</label><input id="aySpUrunKdv" type="number" value="20"></div>
          <datalist id="birimListesiAyarlar">${state.birimler.map(b => `<option value="${esc(b)}">`).join('')}</datalist>
          <button id="aySpUrunEkleBtn" class="btn btn-primary btn-sm">Ürün Ekle</button>
        </div>
        <div class="card">
          <h3 style="font-size:15px; margin-bottom:14px;">Hızlı İşletme Ekle</h3>
          <div class="field"><label>İşletme adı</label><input id="aySpIsletmeAd" type="text"></div>
          <div class="grid grid-2">
            <div class="field"><label>Telefon</label><input id="aySpIsletmeTel" type="text"></div>
            <div class="field"><label>Vergi No</label><input id="aySpIsletmeVergi" type="text"></div>
          </div>
          <div class="field"><label>Adres</label><input id="aySpIsletmeAdres" type="text"></div>
          <button id="aySpIsletmeEkleBtn" class="btn btn-primary btn-sm">İşletme Ekle</button>
        </div>
      </div>`;

    const firma = await fsGetFirma();
    document.getElementById('ayFirmaAd').value = firma.ad || '';
    document.getElementById('ayFirmaTel').value = firma.telefon || '';
    document.getElementById('ayFirmaAdres').value = firma.adres || '';
    document.getElementById('ayFirmaKaydetBtn').addEventListener('click', async () => {
      try {
        await fsSetFirma({
          ad: document.getElementById('ayFirmaAd').value.trim(),
          telefon: document.getElementById('ayFirmaTel').value.trim(),
          adres: document.getElementById('ayFirmaAdres').value.trim()
        });
        toast('Firma bilgileri kaydedildi');
      } catch (err) { toast(err.message, true); }
    });

    document.getElementById('ayarEkleBtn').addEventListener('click', async () => {
      const uname = document.getElementById('ayarKullaniciAdi').value.trim();
      const pass = document.getElementById('ayarSifre').value;
      if (!uname || !pass) return toast('Kullanıcı adı ve şifre gerekli', true);
      try {
        await fsAddUser(uname, pass);
        toast('Kullanıcı eklendi: ' + uname);
        document.getElementById('ayarKullaniciAdi').value = '';
        document.getElementById('ayarSifre').value = '';
      } catch (err) { toast(friendlyAuthError(err), true); }
    });

    async function birimleriCiz() {
      const liste = await fsGetBirimler();
      state.birimler = liste;
      const kutu = document.getElementById('birimListesiKutu');
      kutu.innerHTML = liste.map(b => `<span class="badge badge-ok" style="margin:2px 4px 2px 0; display:inline-flex; align-items:center; gap:6px;">${esc(b)} <button data-birim-sil="${esc(b)}" style="border:none; background:none; cursor:pointer; color:var(--danger); font-weight:700;">×</button></span>`).join('') || '<span class="sub">Liste boş</span>';
      kutu.querySelectorAll('button[data-birim-sil]').forEach(btn => btn.addEventListener('click', async () => {
        const yeni = liste.filter(b => b !== btn.dataset.birimSil);
        try { await fsSetBirimler(yeni); toast('Birim kaldırıldı'); birimleriCiz(); } catch (err) { toast(err.message, true); }
      }));
    }
    async function odemeTurleriCiz() {
      const liste = await fsGetOdemeTurleri();
      state.odemeTurleri = liste;
      const kutu = document.getElementById('odemeListesiKutu');
      kutu.innerHTML = liste.map(t => `<span class="badge badge-ok" style="margin:2px 4px 2px 0; display:inline-flex; align-items:center; gap:6px;">${esc(t)} <button data-odeme-sil="${esc(t)}" style="border:none; background:none; cursor:pointer; color:var(--danger); font-weight:700;">×</button></span>`).join('') || '<span class="sub">Liste boş</span>';
      kutu.querySelectorAll('button[data-odeme-sil]').forEach(btn => btn.addEventListener('click', async () => {
        const yeni = liste.filter(t => t !== btn.dataset.odemeSil);
        try { await fsSetOdemeTurleri(yeni); toast('Ödeme türü kaldırıldı'); odemeTurleriCiz(); } catch (err) { toast(err.message, true); }
      }));
    }
    birimleriCiz();
    odemeTurleriCiz();

    document.getElementById('yeniBirimEkleBtn').addEventListener('click', async () => {
      const v = document.getElementById('yeniBirimInput').value.trim();
      if (!v) return;
      const liste = await fsGetBirimler();
      if (liste.includes(v)) return toast('Bu birim zaten var', true);
      try { await fsSetBirimler([...liste, v]); document.getElementById('yeniBirimInput').value=''; toast('Birim eklendi'); birimleriCiz(); }
      catch (err) { toast(err.message, true); }
    });
    document.getElementById('yeniOdemeEkleBtn').addEventListener('click', async () => {
      const v = document.getElementById('yeniOdemeInput').value.trim();
      if (!v) return;
      const liste = await fsGetOdemeTurleri();
      if (liste.includes(v)) return toast('Bu ödeme türü zaten var', true);
      try { await fsSetOdemeTurleri([...liste, v]); document.getElementById('yeniOdemeInput').value=''; toast('Ödeme türü eklendi'); odemeTurleriCiz(); }
      catch (err) { toast(err.message, true); }
    });

    document.getElementById('aySpUrunEkleBtn').addEventListener('click', async () => {
      const ad = document.getElementById('aySpUrunAd').value.trim();
      if (!ad) return toast('Ürün adı gerekli', true);
      try {
        await fsAddUrun({
          ad, kategori: '', birim: document.getElementById('aySpUrunBirim').value.trim() || 'adet',
          satisFiyati: Number(document.getElementById('aySpUrunFiyat').value) || 0,
          kdvOrani: Number(document.getElementById('aySpUrunKdv').value) || 0,
          stokTakibi: false, stokAdedi: null, kritikStok: null
        });
        toast('Ürün eklendi: ' + ad);
        document.getElementById('aySpUrunAd').value = '';
        document.getElementById('aySpUrunFiyat').value = '';
      } catch (err) { toast(err.message, true); }
    });

    document.getElementById('aySpIsletmeEkleBtn').addEventListener('click', async () => {
      const ad = document.getElementById('aySpIsletmeAd').value.trim();
      if (!ad) return toast('İşletme adı gerekli', true);
      try {
        await fsAddIsletme({
          ad, telefon: document.getElementById('aySpIsletmeTel').value.trim(),
          vergiNo: document.getElementById('aySpIsletmeVergi').value.trim(),
          adres: document.getElementById('aySpIsletmeAdres').value.trim(), notlar: ''
        });
        toast('İşletme eklendi: ' + ad);
        document.getElementById('aySpIsletmeAd').value = '';
        document.getElementById('aySpIsletmeTel').value = '';
        document.getElementById('aySpIsletmeVergi').value = '';
        document.getElementById('aySpIsletmeAdres').value = '';
      } catch (err) { toast(err.message, true); }
    });
  }

  // ================= TEKLİF HAZIRLA =================
  function renderTeklif() {
    main.innerHTML = `
      <div class="page-header"><div><h1>Teklif Hazırla</h1><div class="sub">1. teklif bizim teklifimizdir; 2. ve 3. teklif aynı miktarlarla, makul oranda daha yüksek fiyatla otomatik oluşur</div></div></div>
      <div class="card">
        <div class="grid grid-2">
          <div class="field">
            <label>İşletme adı</label>
            <input type="text" id="teklifIsletme" list="isletmeListesiTeklif" placeholder="Mevcut işletme ya da yeni ad yaz" autocomplete="off">
            <datalist id="isletmeListesiTeklif">${state.isletmeler.map(i => `<option value="${esc(i.ad)}">`).join('')}</datalist>
          </div>
          <div class="field" style="max-width:160px;">
            <label>KDV oranı %</label>
            <input type="number" id="teklifKdv" value="20">
          </div>
        </div>

        <h3 style="font-size:14px; margin:18px 0 4px;">Ürünler</h3>
        <p class="sub" style="color:var(--ink-soft); font-size:12px; margin:0 0 10px;">
          Her ürün için sadece tahmini birim maliyeti yeterli — miktar, aşağıdaki hedef tutara göre
          otomatik hesaplanır ve her üç teklifte de aynı kalır.
        </p>
        <div class="line-item-header" style="grid-template-columns:2fr 1fr 1fr auto;">
          <span>Ürün Adı</span><span>Birim</span><span>Yaklaşık Maliyet</span><span></span>
        </div>
        <datalist id="urunListesiTeklif">${state.urunler.map(u => `<option value="${esc(u.ad)}">`).join('')}</datalist>
        <datalist id="birimListesiTeklif">${state.birimler.map(b => `<option value="${esc(b)}">`).join('')}</datalist>
        <div id="teklifKalemList"></div>
        <button id="teklifKalemEkleBtn" type="button" class="btn btn-ghost btn-sm">+ Ürün ekle</button>

        <h3 style="font-size:14px; margin:18px 0 10px;">1. Teklif — İstenen (ya da en yakın) Toplam Tutar</h3>
        <div class="field" style="max-width:220px;">
          <input type="number" step="0.01" id="teklifHedef1" placeholder="örn. 500">
        </div>
        <p class="sub" style="color:var(--ink-soft); font-size:12px; margin:6px 0 14px;">
          2. teklif 1.'den ~%10, 3. teklif ~%20 daha yüksek olacak şekilde otomatik oluşturulur — aynı ürün miktarlarıyla.
        </p>
        <button id="teklifOlusturBtn" class="btn btn-amber">Teklifi Oluştur ve Kaydet</button>
        <button id="teklifTemizleBtn" type="button" class="btn btn-ghost hidden">Formu Temizle</button>
      </div>

      <div class="page-header mt-4"><div><h1 style="font-size:18px;">Kayıtlı Teklifler</h1></div></div>
      <div id="teklifListesi">Yükleniyor…</div>`;

    let sayac = 0;
    const list = document.getElementById('teklifKalemList');
    let duzenlenenTeklifId = null;

    function satirEkle(mevcut) {
      sayac++;
      const row = document.createElement('div');
      row.className = 'line-item-row';
      row.style.gridTemplateColumns = '2fr 1fr 1fr auto';
      row.innerHTML = `
        <input class="t-ad" type="text" list="urunListesiTeklif" placeholder="Ürün adı" autocomplete="off" value="${mevcut ? esc(mevcut.ad) : ''}">
        <input class="t-birim" type="text" list="birimListesiTeklif" placeholder="Birim" value="${mevcut ? esc(mevcut.birim) : 'adet'}" autocomplete="off">
        <input class="t-maliyet" type="number" step="0.01" placeholder="örn. 25" value="${mevcut ? mevcut.maliyet : ''}">
        <button type="button" class="icon-btn" title="Kaldır">✕</button>
      `;
      list.appendChild(row);
      row.querySelector('.t-ad').addEventListener('input', (e) => {
        const eslesen = state.urunler.find(u => u.ad.toLowerCase() === e.target.value.trim().toLowerCase());
        if (eslesen) {
          row.querySelector('.t-maliyet').value = eslesen.satisFiyati;
          if (eslesen.birim) row.querySelector('.t-birim').value = eslesen.birim;
        }
      });
      row.querySelector('.icon-btn').addEventListener('click', () => row.remove());
    }
    document.getElementById('teklifKalemEkleBtn').addEventListener('click', () => satirEkle());
    satirEkle();

    function formuTemizle() {
      duzenlenenTeklifId = null;
      document.getElementById('teklifIsletme').value = '';
      document.getElementById('teklifKdv').value = 20;
      document.getElementById('teklifHedef1').value = '';
      list.innerHTML = '';
      satirEkle();
      document.getElementById('teklifOlusturBtn').textContent = 'Teklifi Oluştur ve Kaydet';
      document.getElementById('teklifTemizleBtn').classList.add('hidden');
    }
    document.getElementById('teklifTemizleBtn').addEventListener('click', formuTemizle);

    function teklifHesapla(satirlar, hedef1, kdvOrani) {
      const dagitim1 = hesaplaDagitim(satirlar.map(s => ({ ad: s.ad, birim: s.birim, yaklasikFiyat: s.maliyet })), hedef1);
      if (!dagitim1) return null;
      const teklif1 = { kalemler: dagitim1, toplam: round2(dagitim1.reduce((t, k) => t + k.tutar, 0)) };
      const teklif2 = { kalemler: dagitim1.map(k => {
        const birimFiyat = ceil2(k.birimFiyat * 1.10);
        return { ad: k.ad, birim: k.birim, adet: k.adet, birimFiyat, tutar: round2(k.adet * birimFiyat) };
      })};
      teklif2.toplam = round2(teklif2.kalemler.reduce((t, k) => t + k.tutar, 0));
      const teklif3 = { kalemler: dagitim1.map(k => {
        const birimFiyat = ceil2(k.birimFiyat * 1.20);
        return { ad: k.ad, birim: k.birim, adet: k.adet, birimFiyat, tutar: round2(k.adet * birimFiyat) };
      })};
      teklif3.toplam = round2(teklif3.kalemler.reduce((t, k) => t + k.tutar, 0));
      return [teklif1, teklif2, teklif3];
    }

    document.getElementById('teklifOlusturBtn').addEventListener('click', async () => {
      const isletmeAdi = document.getElementById('teklifIsletme').value.trim();
      if (!isletmeAdi) return toast('İşletme adı gir', true);
      const kdvOrani = Number(document.getElementById('teklifKdv').value) || 0;
      const satirlar = [];
      list.querySelectorAll('.line-item-row').forEach(row => {
        const ad = row.querySelector('.t-ad').value.trim();
        const birim = row.querySelector('.t-birim').value.trim() || 'adet';
        const maliyet = Number(row.querySelector('.t-maliyet').value) || 0;
        if (ad && maliyet > 0) satirlar.push({ ad, birim, maliyet });
      });
      if (!satirlar.length) return toast('En az bir ürün ve yaklaşık maliyetini gir', true);
      const hedef1 = Number(document.getElementById('teklifHedef1').value) || 0;
      if (hedef1 <= 0) return toast('1. teklif için hedef toplam tutar gir', true);

      const teklifler3 = teklifHesapla(satirlar, hedef1, kdvOrani);
      if (!teklifler3) return toast('Dağıtım hesaplanamadı, maliyetleri kontrol et', true);

      const payload = { isletmeAdi, kdvOrani, hedefTutar: hedef1, kalemGirdileri: satirlar, teklifler: teklifler3, tarih: todayISO() };
      try {
        if (duzenlenenTeklifId) {
          await fsUpdateTeklif(duzenlenenTeklifId, payload);
          toast('Teklif güncellendi');
        } else {
          await fsAddTeklif(payload);
          toast('Teklif kaydedildi');
        }
        formuTemizle();
        teklifleriListele();
      } catch (err) { toast(err.message, true); }
    });

    function teklifiDuzenlemeyeYukle(t) {
      duzenlenenTeklifId = t.id;
      document.getElementById('teklifIsletme').value = t.isletmeAdi;
      document.getElementById('teklifKdv').value = t.kdvOrani;
      document.getElementById('teklifHedef1').value = t.hedefTutar;
      list.innerHTML = '';
      t.kalemGirdileri.forEach(k => satirEkle(k));
      document.getElementById('teklifOlusturBtn').textContent = 'Değişiklikleri Kaydet';
      document.getElementById('teklifTemizleBtn').classList.remove('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async function teklifleriListele() {
      const host = document.getElementById('teklifListesi');
      let teklifler;
      try { teklifler = await fsGetTeklifler(); } catch (err) { host.innerHTML = ''; return toast(err.message, true); }
      if (!teklifler.length) { host.innerHTML = `<div class="card"><div class="empty-state">Henüz teklif oluşturulmadı.</div></div>`; return; }

      host.innerHTML = teklifler.map(t => `
        <div class="card mt-4">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px;">
            <div>
              <div style="font-weight:600; font-size:14.5px; color:var(--teal-950);">${esc(t.isletmeAdi)}
                <span class="badge status-pill ${t.durum === 'faturaKesildi' ? 'status-green' : (t.durum === 'verildi' ? 'status-green' : 'status-red')}" data-verildi-toggle="${t.id}" data-mevcut="${t.durum === 'verildi' || t.durum === 'faturaKesildi' ? '1' : '0'}">
                  ${t.durum === 'verildi' || t.durum === 'faturaKesildi' ? '✓ Teklif Verildi' : '⏳ Teklif Verilmedi'}
                </span>
                ${t.durum === 'faturaKesildi' ? '<span class="badge status-pill status-green">🧾 Fatura Kesildi</span>' : ''}
              </div>
              <div class="sub" style="font-size:12px;">${formatTarih(t.tarih)} · KDV %${t.kdvOrani} · Hedef: ${money(t.hedefTutar)}</div>
            </div>
            <div class="oc-actions">
              <button class="btn btn-ghost btn-sm" data-duzenle-teklif="${t.id}">Düzenle</button>
              <button class="btn btn-ghost btn-sm" data-pdf-teklif="${t.id}">İndir/Yazdır</button>
              ${t.durum !== 'faturaKesildi' ? `<button class="btn btn-amber btn-sm" data-fatura-kes="${t.id}">Fatura Kesildi İşaretle</button>` : ''}
              <button class="btn btn-danger btn-sm" data-sil-teklif="${t.id}">Sil</button>
            </div>
          </div>
          <div class="grid" style="grid-template-columns:repeat(3,1fr); gap:12px; margin-top:14px;">
            ${t.teklifler.map((tk, i) => `
              <div style="border:1px solid var(--line); border-radius:10px; padding:10px 12px;">
                <div style="font-size:12px; font-weight:700; color:var(--teal-950); margin-bottom:4px;">Teklif ${i + 1}</div>
                <div class="mono" style="font-size:14px;">${money(tk.toplam)}</div>
              </div>`).join('')}
          </div>
        </div>`).join('');

      host.querySelectorAll('button[data-duzenle-teklif]').forEach(btn => btn.addEventListener('click', () => {
        const t = teklifler.find(x => x.id === btn.dataset.duzenleTeklif);
        teklifiDuzenlemeyeYukle(t);
      }));
      host.querySelectorAll('button[data-pdf-teklif]').forEach(btn => btn.addEventListener('click', async () => {
        const t = teklifler.find(x => x.id === btn.dataset.pdfTeklif);
        try { await teklifPdfOlusturVeAc(t.isletmeAdi, t.teklifler); } catch (err) { toast('PDF oluşturulamadı: ' + err.message, true); }
      }));
      host.querySelectorAll('button[data-sil-teklif]').forEach(btn => btn.addEventListener('click', async () => {
        const ok = await confirmDialog('Bu teklifi silmek istediğine emin misin?');
        if (!ok) return;
        try { await fsDeleteTeklif(btn.dataset.silTeklif); toast('Teklif silindi'); teklifleriListele(); }
        catch (err) { toast(err.message, true); }
      }));
      host.querySelectorAll('button[data-verildi-toggle]').forEach(btn => btn.addEventListener('click', async () => {
        const t = teklifler.find(x => x.id === btn.dataset.verildiToggle);
        if (t.durum === 'faturaKesildi') return toast('Fatura kesilmiş bir teklifin durumu değiştirilemez', true);
        const yeniDurum = btn.dataset.mevcut === '1' ? 'taslak' : 'verildi';
        try { await fsUpdateTeklif(t.id, { durum: yeniDurum }); toast('Durum güncellendi'); teklifleriListele(); }
        catch (err) { toast(err.message, true); }
      }));
      host.querySelectorAll('button[data-fatura-kes]').forEach(btn => btn.addEventListener('click', async () => {
        const t = teklifler.find(x => x.id === btn.dataset.faturaKes);
        const ok = await confirmDialog(`"${t.isletmeAdi}" için Teklif 1 tutarı (${money(t.teklifler[0].toplam)}) üzerinden fatura kesildi olarak işaretlensin mi? Bu, Fatura Kesilenler sayfasında (aylık KDV raporunda) görünecek.`);
        if (!ok) return;
        try {
          await fsUpdateTeklif(t.id, { durum: 'faturaKesildi', faturaTarihi: todayISO(), faturaTutari: t.teklifler[0].toplam });
          toast('Fatura kesildi olarak işaretlendi');
          teklifleriListele();
        } catch (err) { toast(err.message, true); }
      }));
    }
    teklifleriListele();
  }

  // ================= FATURA KESİLENLER =================
  async function renderFaturalar() {
    main.innerHTML = `
      <div class="page-header"><div><h1>Fatura Kesilenler</h1><div class="sub">Fatura kesilen teklifler ve aylık KDV özeti</div></div></div>
      <div class="toolbar">
        <input type="month" id="faturaAyFiltre">
        <button id="faturaAyTemizleBtn" class="btn btn-ghost btn-sm">Tüm Aylar</button>
      </div>
      <div id="faturaAylikOzet" class="card mb-0"></div>
      <div id="faturaListesi" class="mt-4">Yükleniyor…</div>`;

    let tumu;
    try {
      const teklifler = await fsGetTeklifler();
      tumu = teklifler.filter(t => t.durum === 'faturaKesildi');
    } catch (err) { return toast(err.message, true); }
    tumu.sort((a, b) => (a.faturaTarihi < b.faturaTarihi ? 1 : -1));

    function ayAnahtari(tarihISO) { return String(tarihISO || '').slice(0, 7); }

    function aylikOzetCiz() {
      const gruplar = {};
      tumu.forEach(t => {
        const ay = ayAnahtari(t.faturaTarihi);
        const tutar = t.faturaTutari != null ? t.faturaTutari : t.teklifler[0].toplam;
        const { kdv } = kdvAyristir(tutar, t.kdvOrani);
        if (!gruplar[ay]) gruplar[ay] = { tutar: 0, kdv: 0, adet: 0 };
        gruplar[ay].tutar = round2(gruplar[ay].tutar + tutar);
        gruplar[ay].kdv = round2(gruplar[ay].kdv + kdv);
        gruplar[ay].adet++;
      });
      const aylar = Object.keys(gruplar).sort().reverse();
      const kutu = document.getElementById('faturaAylikOzet');
      kutu.innerHTML = `<h3 style="font-size:14px; margin-bottom:10px;">Aylık Özet</h3>` + (aylar.length ? `
        <table><thead><tr><th>Ay</th><th class="text-right">Fatura Sayısı</th><th class="text-right">Toplam Tutar</th><th class="text-right">KDV Tutarı</th></tr></thead><tbody>
        ${aylar.map(ay => `<tr><td>${ayAdi(ay)}</td><td class="text-right mono">${gruplar[ay].adet}</td><td class="text-right mono">${money(gruplar[ay].tutar)}</td><td class="text-right mono">${money(gruplar[ay].kdv)}</td></tr>`).join('')}
        </tbody></table>` : `<div class="empty-state">Henüz fatura kesilmiş kayıt yok.</div>`);
    }

    function ayAdi(ayKey) {
      if (!ayKey) return '';
      const [yil, ay] = ayKey.split('-');
      const aylar = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
      return `${aylar[Number(ay) - 1]} ${yil}`;
    }

    function listeCiz(filtreAy) {
      const liste = filtreAy ? tumu.filter(t => ayAnahtari(t.faturaTarihi) === filtreAy) : tumu;
      const host = document.getElementById('faturaListesi');
      if (!liste.length) { host.innerHTML = `<div class="card"><div class="empty-state">Bu aralıkta fatura yok.</div></div>`; return; }
      let toplamGenel = 0, kdvGenel = 0;
      const satirlar = liste.map(t => {
        const tutar = t.faturaTutari != null ? t.faturaTutari : t.teklifler[0].toplam;
        const { matrah, kdv } = kdvAyristir(tutar, t.kdvOrani);
        toplamGenel = round2(toplamGenel + tutar);
        kdvGenel = round2(kdvGenel + kdv);
        return `<tr><td>${formatTarih(t.faturaTarihi)}</td><td>${esc(t.isletmeAdi)}</td><td class="text-right mono">%${t.kdvOrani}</td><td class="text-right mono">${money(matrah)}</td><td class="text-right mono">${money(kdv)}</td><td class="text-right mono">${money(tutar)}</td></tr>`;
      }).join('');
      host.innerHTML = `<div class="card">
        <table><thead><tr><th>Fatura Tarihi</th><th>İşletme</th><th class="text-right">KDV%</th><th class="text-right">Matrah</th><th class="text-right">KDV Tutarı</th><th class="text-right">Toplam</th></tr></thead>
        <tbody>${satirlar}</tbody>
        <tfoot><tr style="font-weight:700;"><td colspan="4" class="text-right">Seçili aralık toplamı:</td><td class="text-right mono">${money(kdvGenel)}</td><td class="text-right mono">${money(toplamGenel)}</td></tr></tfoot></table>
      </div>`;
    }

    aylikOzetCiz();
    listeCiz(null);

    document.getElementById('faturaAyFiltre').addEventListener('change', (e) => listeCiz(e.target.value || null));
    document.getElementById('faturaAyTemizleBtn').addEventListener('click', () => {
      document.getElementById('faturaAyFiltre').value = '';
      listeCiz(null);
    });
  }

})();
