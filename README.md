# Nur Umut Kürkçü Temizlik ve Hijyen — Sipariş / Cari / Stok Sistemi
### (Firebase + GitHub Pages sürümü)

Bu paketteki tüm dosyalar **tek bir klasörde, alt klasör olmadan** —
GitHub'a yüklerken klasör oluşturmana hiç gerek yok, sadece dosyaları
doğrudan sürükle-bırak yeterli.

## Kurulum
Firebase (Authentication + Firestore) tarafı zaten kurulu ve `index.html`
içine bağlanmış durumda. Sadece bu dosyaları GitHub reposuna (mevcut
`nurumutkurkcu.github.io` reposuna) yükleyip üzerine yazman yeterli:

1. github.com/nurumutkurkcu/nurumutkurkcu.github.io reposunu aç.
2. **Add file → Upload files**.
3. Bu klasördeki **tüm dosyaları** (index.html, style.css, app.js,
   manifest.json, sw.js, firestore.rules, README.md, icon-192.png,
   icon-512.png, icon-512-maskable.png, apple-touch-icon.png) seçip
   yükleme alanına sürükle. Aynı isimli dosyaların üzerine yazılacağını
   söyleyen bir uyarı çıkarsa onaylayabilirsin — bu istediğimiz şey.
4. **Commit changes**.
5. 1-2 dakika bekle, siteni yenile (Ctrl+F5 ile önbelleği de temizleyerek
   yenilemen daha sağlıklı olur).

## Yapı
```
index.html                -> tüm arayüz + Firebase bağlantı ayarları
style.css                  -> görünüm
app.js                      -> tüm iş mantığı (giriş, sipariş, cari, stok, PDF)
firestore.rules            -> Firebase Console → Firestore → Rules'a yapıştırılır
manifest.json, sw.js, icon-*.png -> telefona/bilgisayara "uygulama" olarak kurulabilmesi için
```

## Telefona/bilgisayara "uygulama" olarak kurma
- **Android (Chrome):** siteyi aç → sağ üst ⋮ → "Uygulamayı yükle"
- **iPhone (Safari):** siteyi aç → Paylaş ikonu → "Ana Ekrana Ekle"
- **Bilgisayar (Chrome/Edge):** adres çubuğunun sağındaki kurulum ikonu

## Bu sürümde eklenenler
- **Sipariş Oluştur:** İşletme ve ürün alanları artık tek kutu — listeden seç
  ya da yeni bir ad yaz, otomatik kaydedilir (işletme → İşletmeler'e, ürün →
  Ürünler'e düşer).
- **Siparişler sayfası:** Tüm siparişlerin listesi, arama/filtre, her biri için
  Yazdır/İndir ve Sil.
- **Silme:** Ürün, işletme ve sipariş için silme butonları — hepsi onay ister.
- **Stok:** Artık tüm ürünler görünür, istediğin ürün için stok takibini
  buradan açabilirsin.
- **Panel:** "Kimden alacağım / Kime borçluyum" dökümü eklendi.
- **Ayarlar:** Yeni kullanıcı ekleme ekranı (kullanıcı adı + şifre).

Bu değişiklikler sadece `index.html`, `app.js`, `style.css` ve `sw.js`
dosyalarında — GitHub'a yüklerken bu 4 dosyanın üzerine yazman yeterli,
diğerlerine (manifest.json, icon'lar, firestore.rules) dokunmana gerek yok.

## Bu sürümde eklenenler (2. güncelleme)
- **Birim yönetimi:** Sipariş kalemlerinde artık birim seçilebiliyor (koli,
  galon, paket, bidon + istediğin yenisini yazınca otomatik kaydediliyor).
- **Siparişler sayfası artık akordeon:** Satıra tıklayınca detaylar
  (kalemler, ödeme, teslimat) aşağı açılıyor. CSV olarak dışa aktarma eklendi.
- **Yaklaşık Dağıt:** Toplam tutarı bildiğin ama kalem bazında tam fiyatı
  bilmediğin siparişlerde, kalemleri "Yklş" işaretleyip tahmini fiyat
  gir — sistem adet ve birim fiyatı, toplamı hiç aşmayacak şekilde
  otomatik hesaplar.
- **Teslimat durumu:** Her siparişte "Teslim edildi / Bekliyor" durumu,
  Panel'de "Teslimat Bekleyen Siparişler" listesi.
- **Ürün ve İşletme düzenleme:** Artık kayıtlı ürün/işletme bilgilerini
  (fiyat, telefon, adres vb.) sonradan değiştirebiliyorsun.
- **Ayarlar genişledi:** Firma bilgileri, birim listesi ve ödeme türü
  listesi buradan yönetiliyor.

## Bu sürümde eklenenler (3. güncelleme)
- **Firma adı düzeltildi:** "Nur Umut Kürkçü Temizlik ve Hijyen" (hem sitede
  hem irsaliye/teklif PDF'lerinde). Not: Ayarlar'dan daha önce firma bilgisi
  kaydettiysen, oradaki adı da elle güncellemen gerekir.
- **Kalem tablosuna sütun başlıkları ve satır bazlı tutar** eklendi —
  artık hangi kutunun ne olduğu ve her kalemin anlık tutarı görünüyor.
- **Tüm tarihler artık GG.AA.YYYY formatında** gösteriliyor (Panel, Siparişler,
  İşletme detayı, PDF).
- **Teslimat ve ödeme durumu artık zarif, renkli pill-butonlar:** kırmızı
  (Bekliyor / Ödenmedi) — yeşil (Teslim Edildi / Ödendi). Teslimat pill'ine
  tıklayarak durumu değiştirebilirsin.
- **Yeni: Teklif Hazırla sayfası** — işletme adı ve ürünleri (tahmini birim
  fiyatlarıyla) gir, 3 farklı bütçe tutarı yaz, "3 Teklifi Hesapla" — sistem
  her bütçe için adet/fiyatı otomatik hesaplar (yaklaşık dağıtım mantığıyla,
  bütçeyi hiç aşmadan). Tek PDF'te (3 sayfa) indir/yazdır.
