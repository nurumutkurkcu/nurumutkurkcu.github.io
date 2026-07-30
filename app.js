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
    return 'Giriş yapılamadı: ' + (err && err.message ? err.message : 'bilinmeyen hata');
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
    const snap = await col.urunler.where('stokTakibi', '==', true).get();
    return snap.docs.map(d => {
      const u = d.data();
      return {
        id: d.id, ad: u.ad, birim: u.birim, stokAdedi: u.stokAdedi, kritikStok: u.kritikStok,
        kritikMi: u.stokAdedi != null && u.kritikStok != null && u.stokAdedi <= u.kritikStok
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

  async function fsGetDashboard() {
    const [isletmelerSnap, siparisler, urunler] = await Promise.all([
      col.isletmeler.get(), fsGetAllSiparisler(), fsGetUrunler()
    ]);
    let toplamAlacak = 0, toplamBorc = 0;
    for (const d of isletmelerSnap.docs) {
      const b = isletmeBakiyeHesapla(siparisler, d.id);
      if (b > 0) toplamAlacak += b; else toplamBorc += -b;
    }
    const sonSiparisler = [...siparisler].sort((a, b) => (a.tarih < b.tarih ? 1 : -1)).slice(0, 8);
    const kritikStoklar = urunler.filter(u => u.stokTakibi && u.stokAdedi != null && u.kritikStok != null && u.stokAdedi <= u.kritikStok);
    return {
      toplamAlacak: round2(toplamAlacak), toplamBorc: round2(toplamBorc),
      isletmeSayisi: isletmelerSnap.size, urunSayisi: urunler.length,
      sonSiparisler, kritikStoklar
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
    if (state.view === 'isletmeler') return renderIsletmeler();
    if (state.view === 'urunler') return renderUrunler();
    if (state.view === 'stok') return renderStok();
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
            <select id="sipIsletme">
              <option value="">— seçiniz —</option>
              ${state.isletmeler.map(i => `<option value="${i.id}">${esc(i.ad)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Yeni işletme ekle</label>
            <input type="text" id="yeniIsletmeAd" placeholder="İşletme adı yazıp Enter'a bas">
          </div>
        </div>
        <div class="grid grid-2">
          <div class="field">
            <label>Sipariş türü</label>
            <select id="sipTur">
              <option value="satis">Satış (ben veriyorum)</option>
              <option value="alis">Alış (ben alıyorum)</option>
            </select>
          </div>
          <div class="field">
            <label>Tarih</label>
            <input type="date" id="sipTarih" value="${todayISO()}">
          </div>
        </div>

        <h3 style="font-size:14px; margin:18px 0 10px;">Kalemler</h3>
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
        <select class="k-urun">
          <option value="">— ürün seç veya elle yaz —</option>
          ${state.urunler.map(u => `<option value="${u.id}" data-fiyat="${u.satisFiyati}" data-kdv="${u.kdvOrani}" data-birim="${esc(u.birim)}">${esc(u.ad)}</option>`).join('')}
        </select>
        <input class="k-ad-manuel hidden" type="text" placeholder="Ürün adı">
        <input class="k-adet" type="number" step="0.01" placeholder="Adet" value="1">
        <input class="k-kdv" type="number" placeholder="KDV%" value="20">
        <input class="k-fiyat" type="number" step="0.01" placeholder="Birim fiyat">
        <button type="button" class="icon-btn" title="Kaldır">✕</button>
      `;
      kalemList.appendChild(row);

      const sel = row.querySelector('.k-urun');
      const manuelAd = row.querySelector('.k-ad-manuel');
      const fiyatInput = row.querySelector('.k-fiyat');
      const kdvInput = row.querySelector('.k-kdv');
      sel.addEventListener('change', () => {
        if (sel.value === '') { manuelAd.classList.remove('hidden'); return; }
        manuelAd.classList.add('hidden');
        const opt = sel.selectedOptions[0];
        fiyatInput.value = opt.dataset.fiyat;
        kdvInput.value = opt.dataset.kdv;
        toplamGuncelle();
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

    document.getElementById('yeniIsletmeAd').addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const ad = e.target.value.trim();
      if (!ad) return;
      try {
        const isl = await fsAddIsletme({ ad, telefon: '', adres: '', vergiNo: '', notlar: '' });
        state.isletmeler.push(isl);
        const sel = document.getElementById('sipIsletme');
        const opt = document.createElement('option');
        opt.value = isl.id; opt.textContent = isl.ad; opt.selected = true;
        sel.appendChild(opt);
        e.target.value = '';
        toast('İşletme eklendi: ' + isl.ad);
      } catch (err) { toast(err.message, true); }
    });

    document.getElementById('sipKaydetBtn').addEventListener('click', async () => {
      const isletmeId = document.getElementById('sipIsletme').value;
      if (!isletmeId) return toast('Lütfen işletme seçin', true);
      const kalemler = [];
      kalemList.querySelectorAll('.line-item-row').forEach(row => {
        const sel = row.querySelector('.k-urun');
        const manuelAd = row.querySelector('.k-ad-manuel').value.trim();
        const urunId = sel.value || null;
        const urunAdi = urunId ? sel.selectedOptions[0].textContent : manuelAd;
        const adet = Number(row.querySelector('.k-adet').value) || 0;
        const fiyat = Number(row.querySelector('.k-fiyat').value) || 0;
        const kdv = Number(row.querySelector('.k-kdv').value) || 0;
        if (!urunAdi || adet <= 0) return;
        kalemler.push({ urunId, urunAdi, adet, birimFiyat: fiyat, kdvOrani: kdv, tutar: round2(adet * fiyat) });
      });
      if (kalemler.length === 0) return toast('En az bir geçerli kalem ekleyin', true);

      let odemeTuru = document.getElementById('sipOdemeTuru').value;
      if (odemeTuru === 'diger') odemeTuru = document.getElementById('sipOdemeDiger').value.trim() || 'Diğer';

      const manuelToplam = document.getElementById('sipManuelToplam').value;
      const hesaplananToplam = round2(kalemler.reduce((t, k) => t + k.tutar, 0));
      const payload = {
        isletmeId,
        tur: document.getElementById('sipTur').value === 'alis' ? 'alis' : 'satis',
        tarih: document.getElementById('sipTarih').value || todayISO(),
        kalemler,
        toplamTutar: manuelToplam !== '' ? round2(Number(manuelToplam)) : hesaplananToplam,
        odemeTuru,
        odenenTutar: round2(Number(document.getElementById('sipOdenen').value) || 0),
        notlar: document.getElementById('sipNot').value
      };
      try {
        const sip = await fsAddSiparis(payload);
        toast('Sipariş kaydedildi (No: ' + sip.siraNo + ')');
        await refreshLookups();
        setView('dashboard');
      } catch (err) { toast(err.message, true); }
    });
  }

  // ================= İŞLETMELER =================
  async function renderIsletmeler() {
    main.innerHTML = `
      <div class="page-header"><div><h1>İşletmeler</h1><div class="sub">Ürün verdiğin / aldığın işletmeler ve cari bakiyeleri</div></div>
        <button id="yeniIsletmeBtn" class="btn btn-amber">+ Yeni İşletme</button></div>
      <div class="card"><table><thead><tr><th>İşletme</th><th>Telefon</th><th class="text-right">Bakiye</th></tr></thead>
      <tbody id="islTbody"></tbody></table></div>
      <div id="islDetay" class="card mt-4 hidden"></div>`;

    const isletmeler = await fsGetIsletmeler();
    state.isletmeler = isletmeler;
    const tbody = document.getElementById('islTbody');
    if (isletmeler.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3"><div class="empty-state">Henüz işletme kaydı yok.</div></td></tr>`;
    } else {
      tbody.innerHTML = isletmeler.map(i => `
        <tr class="clickable" data-id="${i.id}">
          <td>${esc(i.ad)}</td>
          <td>${esc(i.telefon || '—')}</td>
          <td class="text-right mono" style="color:${i.bakiye > 0 ? 'var(--teal-700)' : i.bakiye < 0 ? 'var(--danger)' : 'inherit'}">${i.bakiye > 0 ? 'Alacaklıyım ' : i.bakiye < 0 ? 'Borçluyum ' : ''}${money(Math.abs(i.bakiye))}</td>
        </tr>`).join('');
      tbody.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => isletmeDetay(tr.dataset.id)));
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
      <div class="card"><table><thead><tr><th>Ürün</th><th>Kategori</th><th>Birim</th><th class="text-right">Satış Fiyatı (KDV Dahil)</th><th class="text-right">KDV %</th><th>Stok Takibi</th></tr></thead>
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
      </tr>`).join('') : `<tr><td colspan="6"><div class="empty-state">Henüz ürün eklenmedi.</div></td></tr>`;

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
      <div class="page-header"><div><h1>Stok</h1><div class="sub">Sadece stok takibi açık ürünler listelenir — veri girmediğin ürünler burada görünmez</div></div></div>
      <div class="card"><table><thead><tr><th>Ürün</th><th class="text-right">Mevcut</th><th class="text-right">Kritik Seviye</th><th>Durum</th><th></th></tr></thead>
      <tbody id="stokTbody"></tbody></table></div>`;

    const stok = await fsGetStok();
    const tbody = document.getElementById('stokTbody');
    tbody.innerHTML = stok.length ? stok.map(u => `
      <tr>
        <td>${esc(u.ad)}</td>
        <td class="text-right mono">${u.stokAdedi != null ? u.stokAdedi : '—'}</td>
        <td class="text-right mono">${u.kritikStok != null ? u.kritikStok : '—'}</td>
        <td>${u.kritikMi ? '<span class="badge badge-kritik">Kritik</span>' : '<span class="badge badge-ok">Yeterli</span>'}</td>
        <td><button class="btn btn-ghost btn-sm" data-id="${u.id}" data-cur="${u.stokAdedi ?? ''}">Güncelle</button></td>
      </tr>`).join('') : `<tr><td colspan="5"><div class="empty-state">Stok takibi açık ürün yok. Ürün eklerken "stok takibi" seçeneğini işaretleyebilirsin.</div></td></tr>`;

    tbody.querySelectorAll('button[data-id]').forEach(btn => btn.addEventListener('click', async () => {
      const yeni = prompt('Yeni stok adedi:', btn.dataset.cur);
      if (yeni === null) return;
      try {
        await fsUpdateStok(btn.dataset.id, { stokAdedi: Number(yeni) });
        toast('Stok güncellendi');
        renderStok();
      } catch (err) { toast(err.message, true); }
    }));
  }

})();
