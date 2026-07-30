# Nur Umut Kürkü Temizlik ve Hijyen — Sipariş / Cari / Stok Sistemi
### (Firebase + GitHub Pages sürümü — sunucu kurulumu gerektirmez)

Bu sürüm tamamen statik dosyalardan oluşur (HTML/CSS/JS) ve verileri
doğrudan tarayıcıdan **Firebase Firestore**'a kaydeder. Yani Render, Railway
gibi ayrı bir sunucuya hiç ihtiyaç yok — sadece GitHub Pages ile yayınlanır.
Firebase'in ücretsiz (Spark) planı kredi kartı istemez ve bu ölçekte bir iş
için yeterlidir.

---

## 1) Firebase projesi oluştur

1. console.firebase.google.com adresine git, Google hesabınla giriş yap.
2. **Proje ekle** → proje adı: `nur-umut` (istediğin isim) → devam et →
   Google Analytics'i istersen kapatabilirsin → **Proje oluştur**.

### a) Authentication (giriş sistemi) aç
1. Sol menüden **Build → Authentication** → **Get started**.
2. **Sign-in method** sekmesinde **E-posta/Şifre**'yi seç, etkinleştir, kaydet.
3. **Users** sekmesine geç → **Add user**.
4. E-posta olarak: `umut@nurumut.local` yaz (bu gerçek bir e-posta değil,
   sadece kullanıcı adını sisteme tanıtmak için kullanılıyor).
5. Şifre olarak kendi belirlediğin şifreyi yaz → **Add user**.
   (Giriş ekranında kullanıcı adı kısmına sadece `Umut` yazman yeterli,
   sistem otomatik olarak bu e-postaya çeviriyor.)

### b) Firestore (veritabanı) aç
1. Sol menüden **Build → Firestore Database** → **Create database**.
2. Konum olarak sana yakın bir bölge seç → **production mode** ile devam et.
3. Veritabanı açıldıktan sonra **Rules** sekmesine gir, bu depodaki
   `firestore.rules` dosyasının içeriğini kopyalayıp yapıştır → **Publish**.

### c) Web uygulaması bağlantı bilgilerini al
1. Sol üstteki dişli çark → **Project settings**.
2. Aşağı in, **"Your apps"** bölümünde **</>** (Web) simgesine tıkla.
3. Bir takma ad ver (örn. "nur-umut-web") → **Register app**.
4. Karşına çıkan `firebaseConfig` bilgilerini kopyala — `index.html`
   dosyasını bir metin düzenleyiciyle aç, en üstteki
   ```js
   const firebaseConfig = {
     apiKey: "BURAYA_YAZ",
     ...
   };
   ```
   kısmını, Firebase'den kopyaladığın gerçek değerlerle değiştir. Kaydet.

---

## 2) GitHub'a yükle ve Pages ile yayınla

1. github.com'da **New repository** → örn. `nur-umut-sistem` → **Public**
   seçebilirsin (içinde artık şifre/anahtar yok, `firebaseConfig` herkese
   görünse de güvenlik Firestore Rules ile sağlanıyor) → **Create repository**.
2. Repo sayfasında **"uploading an existing file"** linkine tıkla.
3. Bu zip'i açtığın klasördeki **tüm dosyaları** (index.html, manifest.json,
   sw.js, firestore.rules, css/, js/, icons/) sürükle-bırak ile yükle →
   **Commit changes**.
4. Repo üstündeki **Settings** sekmesine gir → sol menüden **Pages**.
5. **Source** olarak **Deploy from a branch** → Branch: **main**, klasör: **/(root)** → **Save**.
6. 1-2 dakika sonra sayfanın üstünde yeşil bir kutuda site adresin görünür:
   `https://KULLANICI_ADIN.github.io/nur-umut-sistem/`

Bu adres artık canlı sitendir — hem bilgisayardan hem telefondan aynı
adresle girip aynı verileri görürsün.

---

## 3) Telefona/bilgisayara "uygulama" olarak kurma
- **Android (Chrome):** siteyi aç → sağ üst ⋮ → "Uygulamayı yükle"
- **iPhone (Safari):** siteyi aç → Paylaş ikonu → "Ana Ekrana Ekle"
- **Bilgisayar (Chrome/Edge):** adres çubuğunun sağındaki kurulum ikonu

---

## Yapı
```
index.html          -> tüm arayüz + Firebase bağlantı ayarları (en üstte)
css/style.css        -> görünüm
js/app.js            -> tüm iş mantığı (giriş, sipariş, cari, stok, PDF)
firestore.rules      -> Firebase Console'a yapıştırılacak güvenlik kuralı
manifest.json, sw.js, icons/ -> telefona/bilgisayara "uygulama" olarak kurulabilmesi için
```

## Önemli notlar
- Bu sistemde artık `server.js`, `db.js`, Render, Supabase **yok** — hepsinin
  yerini Firebase aldı, daha basit.
- İrsaliye/fatura PDF'i artık tarayıcıda, anlık olarak oluşturuluyor (yeni
  sekmede açılır).
- Birden fazla kullanıcı eklemek istersen: Firebase Authentication → Users →
  Add user ile aynı şekilde ekleyebilirsin (örn. `ayse@nurumut.local`).
