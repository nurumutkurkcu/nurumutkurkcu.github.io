// Nur Umut Kürkü Temizlik ve Hijyen - Frontend (Firebase Auth + Firestore, saf statik site)
(function(){
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  const EMAIL_DOMAIN = '@nurumut.local'; // Firebase Auth e-posta ister; kullanıcı adını buna çeviriyoruz
  const state = { view: 'dashboard', urunler: [], isletmeler: [], username: null };

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
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
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

  // ================= FIRESTORE VERİ KATMANI =================
  const col = {
    urunler: db.collection('urunler'),
    isletmeler: db.collection('isletmeler'),
    siparisler: db.collection('siparisler'),
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

  async function fsDeleteSiparis(siparis) {
    return db.runTransaction(async (tx) => {
      const urunSnaps = [];
      for (const k of siparis.kalemler) {
        if (!k.urunId) continue;
        const ref = col.urunler.doc(k.urunId);
        const snap = await tx.get(ref);
        urunSnaps.push({ ref, snap, kalem: k });
      }
      tx.delete(col.siparisler.doc(siparis.id));
      for (const u of urunSnaps) {
        if (!u.snap.exists) continue;
        const d = u.snap.data();
        if (d.stokTakibi && d.stokAdedi != null) {
          const geriAlinan = round2(d.stokAdedi + (siparis.tur === 'alis' ? -u.kalem.adet : u.kalem.adet));
          tx.update(u.ref, { stokAdedi: geriAlinan });
        }
      }
    });
  }

  async function fsAddUser(username, password) {
    const email = username.trim().toLowerCase() + EMAIL_DOMAIN;
    await secondaryAuth.createUserWithEmailAndPassword(email, password);
    await secondaryAuth.signOut();
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
    return {
      toplamAlacak: round2(toplamAlacak), toplamBorc: round2(toplamBorc),
      isletmeSayisi: isletmelerSnap.size, urunSayisi: urunler.length,
      sonSiparisler, kritikStoklar,
      alacaklarim: isletmeBakiyeleri.filter(i => i.bakiye > 0),
      borclarim: isletmeBakiyeleri.filter(i => i.bakiye < 0)
    };
  }

  async function fsGetFirma() {
    const snap = await col.meta.doc('firma').get();
    return snap.exists ? snap.data() : { ad: 'Nur Umut Kürkü Temizlik ve Hijyen' };
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

    page.drawText(pdfTr(firma.ad || 'Nur Umut Kuku Temizlik ve Hijyen'), { x: marginX, y, size: 16, font: fontBold, color: koyu });
    y -= 18;
    if (firma.telefon) { page.drawText(pdfTr(firma.telefon), { x: marginX, y, size: 9, font, color: gri }); y -= 12; }
    if (firma.adres) { page.drawText(pdfTr(firma.adres), { x: marginX, y, size: 9, font, color: gri }); y -= 12; }

    const baslikY = height - 60;
    page.drawText(siparis.tur === 'alis' ? pdfTr('ALIS IRSALIYESI') : pdfTr('SATIS IRSALIYESI'), { x: width - 230, y: baslikY, size: 13, font: fontBold, color: koyu });
    page.drawText(`No: ${siparis.siraNo}`, { x: width - 230, y: baslikY - 16, size: 10, font, color: gri });
    page.drawText(`Tarih: ${siparis.tarih}`, { x: width - 230, y: baslikY - 30, size: 10, font, color: gri });

    y -= 20;
    page.drawLine({ start: { x: marginX, y }, end: { x: width - marginX, y }, thickness: 1, color: rgb(0.85, 0.85, 0.85) });
    y -= 20;
    page.drawText(pdfTr('Isletme:'), { x: marginX, y, size: 10, font: fontBold, color: koyu });
    page.drawText(pdfTr(siparis.isletmeAdi || ''), { x: marginX + 55, y, size: 10, font, color: rgb(0, 0, 0) });
    y -= 25;

    const cols = [
      { label: 'Urun', x: marginX }, { label: 'Adet', x: marginX + 220 },
      { label: 'Birim Fiyat', x: marginX + 280 }, { label: 'KDV%', x: marginX + 370 }, { label: 'Tutar', x: marginX + 420 }
    ];
    page.drawRectangle({ x: marginX, y: y - 4, width: width - 2 * marginX, height: 20, color: rgb(0.93, 0.96, 0.95) });
    for (const c of cols) page.drawText(pdfTr(c.label), { x: c.x + 4, y, size: 9, font: fontBold, color: koyu });
    y -= 24;

    for (const k of siparis.kalemler) {
      if (y < 100) { page.drawText('...', { x: marginX, y, size: 9, font }); break; }
      page.drawText(pdfTr(k.urunAdi).slice(0, 40), { x: cols[0].x + 4, y, size: 9, font, color: rgb(0, 0, 0) });
      page.drawText(String(k.adet), { x: cols[1].x + 4, y, size: 9, font });
      page.drawText(k.birimFiyat.toFixed(2), { x: cols[2].x + 4, y, size: 9, font });
      page.drawText(String(k.kdvOrani), { x: cols[3].x + 4, y, size: 9, font });
      page.drawText(k.tutar.toFixed(2), { x: cols[4].x + 4, y, size: 9, font });
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
    if (siparis.notlar) { y -= 26; page.drawText(pdfTr('Not: ') + pdfTr(siparis.notlar), { x: marginX, y, size: 9, font, color: gri }); }

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
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => setView(item.dataset.view));
  });
  function setView(view) {
    state.view = view;
    document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.view === view));
    render();
  }

  async function refreshLookups() {
    state.urunler = await fsGetUrunler();
    state.isletmeler = await fsGetIsletmeler();
  }

  const main = document.getElementById('mainContent');

  async function render() {
    if (state.view === 'dashboard') return renderDashboard();
    if (state.view === 'siparis') return renderSiparisOlustur();
    if (state.view === 'siparisler') return renderSiparisler();
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
          <h3 style="font-size:15px; margin-bottom:12px; color:var(--teal-700);">Kimden Alacağım</h3>
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
          <h3 style="font-size:15px; margin-bottom:12px;">Son Siparişler</h3>
          ${d.sonSiparisler.length ? `<table><thead><tr><th>Tarih</th><th>İşletme</th><th>Tür</th><th class="text-right">Tutar</th></tr></thead><tbody>
            ${d.sonSiparisler.map(s => `<tr><td>${s.tarih}</td><td>${esc(s.isletmeAdi)}</td><td><span class="badge badge-${s.tur}">${s.tur === 'satis' ? 'Satış' : 'Alış'}</span></td><td class="text-right mono">${money(s.toplamTutar)}</td></tr>`).join('')}
          </tbody></table>` : `<div class="empty-state">Henüz sipariş yok.</div>`}
        </div>
        <div class="card">
          <h3 style="font-size:15px; margin-bottom:12px;">Kritik Stoklar</h3>
          ${d.kritikStoklar.length ? `<table><thead><tr><th>Ürün</th><th class="text-right">Mevcut</th><th class="text-right">Kritik Seviye</th></tr></thead><tbody>
            ${d.kritikStoklar.map(u => `<tr><td>${esc(u.ad)}</td><td class="text-right mono">${u.stokAdedi}</td><td class="text-right mono">${u.kritikStok}</td></tr>`).join('')}
          </tbody></table>` : `<div class="empty-state">Kritik seviyede ürün yok.</div>`}
        </div>
      </div>`;
  }

  // ================= SİPARİŞ OLUŞTUR =================
  function renderSiparisOlustur() {
    main.innerHTML = `
      <div class="page-header"><div><h1>Sipariş Oluştur</h1><div class="sub">Merkezi giriş ekranı — buradaki veriler cari ve stoğa otomatik işlenir</div></div></div>
      <div class="card">
        <div class="grid grid-2">
          <div class="field">
            <label>İşletme</label>
            <input type="text" id="sipIsletme" list="isletmeListesi" placeholder="Mevcut işletmeyi seç ya da yeni ad yaz" autocomplete="off">
            <datalist id="isletmeListesi">
              ${state.isletmeler.map(i => `<option value="${esc(i.ad)}">`).join('')}
            </datalist>
          </div>
          <div class="field">
            <label>Sipariş türü</label>
            <select id="sipTur">
              <option value="satis">Satış (ben veriyorum)</option>
              <option value="alis">Alış (ben alıyorum)</option>
            </select>
          </div>
        </div>
        <div class="field" style="max-width:220px;">
          <label>Tarih</label>
          <input type="date" id="sipTarih" value="${todayISO()}">
        </div>

        <h3 style="font-size:14px; margin:18px 0 10px;">Kalemler</h3>
        <datalist id="urunListesi">
          ${state.urunler.map(u => `<option value="${esc(u.ad)}">`).join('')}
        </datalist>
        <div id="kalemList"></div>
        <button id="kalemEkleBtn" type="button" class="btn btn-ghost btn-sm">+ Kalem ekle</button>

        <div class="grid grid-2 mt-4">
          <div class="field">
            <label>İrsaliye toplam tutarını biliyorsan buraya yaz (opsiyonel)</label>
            <input type="number" step="0.01" id="sipManuelToplam" placeholder="Boş bırakırsan kalemlerden hesaplanır">
          </div>
          <div class="field">
            <label>Ödeme türü</label>
            <select id="sipOdemeTuru">
              <option>Nakit</option>
              <option>Havale/EFT</option>
              <option>Kredi Kartı</option>
              <option selected>Vadeli/Açık Hesap</option>
              <option value="diger">Diğer (yaz)</option>
            </select>
            <input type="text" id="sipOdemeDiger" placeholder="Ödeme türünü yaz" class="hidden mt-4">
          </div>
        </div>
        <div class="grid grid-2">
          <div class="field">
            <label>Ödenen tutar</label>
            <input type="number" step="0.01" id="sipOdenen" value="0">
          </div>
          <div class="field">
            <label>Not</label>
            <input type="text" id="sipNot" placeholder="Opsiyonel">
          </div>
        </div>

        <div style="display:flex; align-items:center; gap:16px;">
          <div class="mono" style="font-size:18px;">Toplam: <span id="sipToplamGoster">0,00 TL</span></div>
          <div class="spacer"></div>
          <button id="sipKaydetBtn" class="btn btn-amber">Siparişi Kaydet</button>
        </div>
      </div>`;

    let kalemSayac = 0;
    const kalemList = document.getElementById('kalemList');

    function kalemSatiriEkle() {
      kalemSayac++;
      const rid = 'k' + kalemSayac;
      const row = document.createElement('div');
      row.className = 'line-item-row';
      row.id = rid;
      row.innerHTML = `
        <input class="k-urun-ad" type="text" list="urunListesi" placeholder="Ürün adı (seç ya da yaz)" autocomplete="off">
        <input class="k-adet" type="number" step="0.01" placeholder="Adet" value="1">
        <input class="k-kdv" type="number" placeholder="KDV%" value="20">
        <input class="k-fiyat" type="number" step="0.01" placeholder="Birim fiyat">
        <button type="button" class="icon-btn" title="Kaldır">✕</button>
      `;
      kalemList.appendChild(row);

      const adInput = row.querySelector('.k-urun-ad');
      const fiyatInput = row.querySelector('.k-fiyat');
      const kdvInput = row.querySelector('.k-kdv');
      adInput.addEventListener('input', () => {
        const eslesen = state.urunler.find(u => u.ad.toLowerCase() === adInput.value.trim().toLowerCase());
        if (eslesen) {
          fiyatInput.value = eslesen.satisFiyati;
          kdvInput.value = eslesen.kdvOrani;
          toplamGuncelle();
        }
      });
      row.querySelectorAll('input').forEach(inp => inp.addEventListener('input', toplamGuncelle));
      row.querySelector('.icon-btn').addEventListener('click', () => { row.remove(); toplamGuncelle(); });
      toplamGuncelle();
    }
    document.getElementById('kalemEkleBtn').addEventListener('click', kalemSatiriEkle);
    kalemSatiriEkle();

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
        const adet = Number(row.querySelector('.k-adet').value) || 0;
        const fiyat = Number(row.querySelector('.k-fiyat').value) || 0;
        const kdv = Number(row.querySelector('.k-kdv').value) || 0;
        if (!ad || adet <= 0) return;
        satirlar.push({ ad, adet, fiyat, kdv });
      });
      if (satirlar.length === 0) return toast('En az bir geçerli kalem ekleyin', true);

      btn.disabled = true;
      try {
        // İşletme: varsa kullan, yoksa otomatik oluştur
        let isletme = state.isletmeler.find(i => i.ad.toLowerCase() === isletmeAdiGirilen.toLowerCase());
        if (!isletme) {
          isletme = await fsAddIsletme({ ad: isletmeAdiGirilen, telefon: '', adres: '', vergiNo: '', notlar: '' });
          state.isletmeler.push(isletme);
          toast('Yeni işletme kaydedildi: ' + isletme.ad);
        }

        // Kalemler: eşleşen ürünü kullan, yoksa otomatik ürün olarak kaydet
        const kalemler = [];
        for (const satir of satirlar) {
          let urun = state.urunler.find(u => u.ad.toLowerCase() === satir.ad.toLowerCase());
          if (!urun) {
            urun = await fsAddUrun({
              ad: satir.ad, kategori: '', birim: 'adet',
              satisFiyati: satir.fiyat, kdvOrani: satir.kdv,
              stokTakibi: false, stokAdedi: null, kritikStok: null
            });
            state.urunler.push(urun);
            toast('Yeni ürün kaydedildi: ' + urun.ad);
          }
          kalemler.push({
            urunId: urun.id, urunAdi: satir.ad, adet: satir.adet,
            birimFiyat: satir.fiyat, kdvOrani: satir.kdv, tutar: round2(satir.adet * satir.fiyat)
          });
        }

        let odemeTuru = document.getElementById('sipOdemeTuru').value;
        if (odemeTuru === 'diger') odemeTuru = document.getElementById('sipOdemeDiger').value.trim() || 'Diğer';

        const manuelToplam = document.getElementById('sipManuelToplam').value;
        const hesaplananToplam = round2(kalemler.reduce((t, k) => t + k.tutar, 0));
        const payload = {
          isletmeId: isletme.id,
          tur: document.getElementById('sipTur').value === 'alis' ? 'alis' : 'satis',
          tarih: document.getElementById('sipTarih').value || todayISO(),
          kalemler,
          toplamTutar: manuelToplam !== '' ? round2(Number(manuelToplam)) : hesaplananToplam,
          odemeTuru,
          odenenTutar: round2(Number(document.getElementById('sipOdenen').value) || 0),
          notlar: document.getElementById('sipNot').value,
          olusturanKullanici: state.username || ''
        };
        const sip = await fsAddSiparis(payload);
        toast('Sipariş kaydedildi (No: ' + sip.siraNo + ')');
        await refreshLookups();
        setView('siparisler');
      } catch (err) {
        toast(err.message, true);
      } finally {
        btn.disabled = false;
      }
    });
  }

  // ================= SİPARİŞLER =================
  async function renderSiparisler() {
    main.innerHTML = `
      <div class="page-header"><div><h1>Siparişler</h1><div class="sub">Oluşturduğun tüm siparişler — yazdır, indir veya sil</div></div></div>
      <div class="toolbar">
        <input type="text" id="sipArama" placeholder="İşletme adı veya sipariş no ile ara">
        <select id="sipTurFiltre">
          <option value="">Tüm türler</option>
          <option value="satis">Satış</option>
          <option value="alis">Alış</option>
        </select>
      </div>
      <div id="siparisListesi">Yükleniyor…</div>`;

    let tumu;
    try { tumu = await fsGetAllSiparisler(); } catch (err) { return toast(err.message, true); }
    tumu.sort((a, b) => (a.tarih < b.tarih ? 1 : (a.tarih > b.tarih ? -1 : (b.siraNo || 0) - (a.siraNo || 0))));

    function ciz(liste) {
      const host = document.getElementById('siparisListesi');
      if (!liste.length) { host.innerHTML = `<div class="empty-state">Kayıtlı sipariş yok.</div>`; return; }
      host.innerHTML = liste.map(s => `
        <div class="order-card">
          <div class="oc-main">
            <div class="oc-isletme">${esc(s.isletmeAdi)} <span class="badge badge-${s.tur}">${s.tur === 'satis' ? 'Satış' : 'Alış'}</span></div>
            <div class="oc-meta">#${s.siraNo} · ${s.tarih} · ${esc(s.olusturanKullanici || 'bilinmiyor')} tarafından oluşturuldu · ${s.kalemler.length} kalem ürün</div>
          </div>
          <div class="oc-tutar mono">${money(s.toplamTutar)}</div>
          <div class="oc-actions">
            <button class="btn btn-ghost btn-sm" data-pdf="${s.id}">Yazdır / İndir</button>
            <button class="btn btn-danger btn-sm" data-sil="${s.id}">Sil</button>
          </div>
        </div>`).join('');

      host.querySelectorAll('button[data-pdf]').forEach(btn => btn.addEventListener('click', async () => {
        const s = liste.find(x => x.id === btn.dataset.pdf);
        try { await irsaliyePdfOlusturVeAc(s); } catch (err) { toast('PDF oluşturulamadı: ' + err.message, true); }
      }));
      host.querySelectorAll('button[data-sil]').forEach(btn => btn.addEventListener('click', async () => {
        const ok = await confirmDialog('Bu siparişi silmek istediğine emin misin? Bu işlem geri alınamaz ve stok/cari üzerindeki etkisi geri alınır.');
        if (!ok) return;
        const s = liste.find(x => x.id === btn.dataset.sil);
        try {
          await fsDeleteSiparis(s);
          toast('Sipariş silindi');
          renderSiparisler();
        } catch (err) { toast(err.message, true); }
      }));
    }
    ciz(tumu);

    function filtrele() {
      const q = document.getElementById('sipArama').value.trim().toLowerCase();
      const tur = document.getElementById('sipTurFiltre').value;
      let liste = tumu;
      if (tur) liste = liste.filter(s => s.tur === tur);
      if (q) liste = liste.filter(s => (s.isletmeAdi || '').toLowerCase().includes(q) || String(s.siraNo).includes(q));
      ciz(liste);
    }
    document.getElementById('sipArama').addEventListener('input', filtrele);
    document.getElementById('sipTurFiltre').addEventListener('change', filtrele);
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
          <td class="text-right"><button class="btn btn-danger btn-sm" data-sil="${i.id}">Sil</button></td>
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

  async function isletmeDetay(id) {
    const d = await fsGetIsletmeDetay(id);
    const box = document.getElementById('islDetay');
    box.classList.remove('hidden');
    box.innerHTML = `
      <h3 style="font-size:16px;">${esc(d.ad)}</h3>
      <p class="sub" style="color:var(--ink-soft); font-size:13px; margin:4px 0 16px;">
        ${d.telefon ? esc(d.telefon) + ' · ' : ''}${d.adres ? esc(d.adres) : ''}
        ${!d.telefon && !d.adres ? 'İletişim bilgisi eklenmemiş' : ''}
      </p>
      <div class="mono" style="font-size:16px; margin-bottom:16px;">
        Bakiye: ${d.bakiye > 0 ? 'Alacaklıyım — ' : d.bakiye < 0 ? 'Borçluyum — ' : 'Kapalı — '}${money(Math.abs(d.bakiye))}
      </div>
      ${d.siparisler.length ? `<table><thead><tr><th>Tarih</th><th>Sipariş No</th><th>Tür</th><th class="text-right">Toplam</th><th class="text-right">Kalan</th><th></th></tr></thead><tbody>
        ${d.siparisler.map(s => `<tr>
          <td>${s.tarih}</td><td>#${s.siraNo}</td>
          <td><span class="badge badge-${s.tur}">${s.tur === 'satis' ? 'Satış' : 'Alış'}</span></td>
          <td class="text-right mono">${money(s.toplamTutar)}</td>
          <td class="text-right mono">${money(s.toplamTutar - (s.odenenTutar||0))}</td>
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
        <td class="text-right"><button class="btn btn-danger btn-sm" data-sil="${u.id}">Sil</button></td>
      </tr>`).join('') : `<tr><td colspan="7"><div class="empty-state">Henüz ürün eklenmedi.</div></td></tr>`;

    tbody.querySelectorAll('button[data-sil]').forEach(btn => btn.addEventListener('click', async () => {
      const u = urunler.find(x => x.id === btn.dataset.sil);
      const ok = await confirmDialog(`"${u.ad}" ürününü silmek istediğine emin misin?`);
      if (!ok) return;
      try { await fsDeleteUrun(btn.dataset.sil); toast('Ürün silindi'); renderUrunler(); }
      catch (err) { toast(err.message, true); }
    }));

    document.getElementById('yeniUrunBtn').addEventListener('click', () => {
      const box = document.getElementById('urunForm');
      box.classList.remove('hidden');
      box.innerHTML = `
        <h3 style="font-size:15px; margin-bottom:14px;">Yeni Ürün</h3>
        <div class="grid grid-2">
          <div class="field"><label>Ürün adı</label><input id="uAd" type="text"></div>
          <div class="field"><label>Kategori</label><input id="uKategori" type="text"></div>
          <div class="field"><label>Birim</label><input id="uBirim" type="text" value="adet"></div>
          <div class="field"><label>Satış fiyatı (KDV dahil)</label><input id="uFiyat" type="number" step="0.01"></div>
          <div class="field"><label>KDV oranı % (ilk giriş, bir daha sorulmaz)</label><input id="uKdv" type="number" value="20"></div>
          <div class="field"><label><input id="uStokTakibi" type="checkbox" style="width:auto; margin-right:6px;">Stok takibi yapılsın</label></div>
        </div>
        <div id="uStokAlanlari" class="grid grid-2 hidden">
          <div class="field"><label>Başlangıç stok adedi</label><input id="uStokAdedi" type="number"></div>
          <div class="field"><label>Kritik stok seviyesi</label><input id="uKritikStok" type="number"></div>
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
          await fsAddUrun(payload);
          toast('Ürün eklendi');
          renderUrunler();
        } catch (err) { toast(err.message, true); }
      });
    });
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
  function renderAyarlar() {
    main.innerHTML = `
      <div class="page-header"><div><h1>Ayarlar</h1><div class="sub">Sisteme yeni kullanıcı ekle</div></div></div>
      <div class="card" style="max-width:420px;">
        <h3 style="font-size:15px; margin-bottom:14px;">Yeni Kullanıcı Ekle</h3>
        <div class="field">
          <label>Kullanıcı adı</label>
          <input type="text" id="ayarKullaniciAdi" placeholder="örn. Ayşe" autocomplete="off">
        </div>
        <div class="field">
          <label>Şifre</label>
          <input type="password" id="ayarSifre" placeholder="En az 6 karakter">
        </div>
        <button id="ayarEkleBtn" class="btn btn-primary">Kullanıcı Ekle</button>
        <p class="sub" style="color:var(--ink-soft); font-size:12px; margin-top:14px;">
          Yeni kullanıcı, kendi kullanıcı adı ve şifresiyle giriş yapabilir. Kullanıcıları
          silmek veya listelemek için Firebase Console → Authentication → Users
          sayfasını kullanman gerekiyor (bu ekrandan yönetilemiyor).
        </p>
      </div>`;

    document.getElementById('ayarEkleBtn').addEventListener('click', async () => {
      const uname = document.getElementById('ayarKullaniciAdi').value.trim();
      const pass = document.getElementById('ayarSifre').value;
      if (!uname || !pass) return toast('Kullanıcı adı ve şifre gerekli', true);
      try {
        await fsAddUser(uname, pass);
        toast('Kullanıcı eklendi: ' + uname);
        document.getElementById('ayarKullaniciAdi').value = '';
        document.getElementById('ayarSifre').value = '';
      } catch (err) {
        toast(friendlyAuthError(err), true);
      }
    });
  }

})();
