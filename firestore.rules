// Firebase Console → Firestore Database → Rules sekmesine yapıştır.
// Sadece sisteme giriş yapmış (Authentication'dan doğrulanmış) kullanıcılar
// okuma/yazma yapabilir — dışarıdan hiç kimse verilerine erişemez.

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
