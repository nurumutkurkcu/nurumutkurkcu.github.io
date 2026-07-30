# Nur Umut Kürkü Temizlik ve Hijyen — Sipariş / Cari / Stok Sistemi
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
