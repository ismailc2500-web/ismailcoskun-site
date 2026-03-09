# ismailcoskun.com

Bu proje, `ismailcoskun.com` için hazırlanmış deploy-ready bir Next.js sitesidir.

## Ne yapıyor?

- Kişisel akademik site ve blog olarak çalışır.
- Yayımlanmış yazıları ana sayfada gösterir.
- Vercel cron her gün çalışır.
- Sistem 4 gün dolmuşsa otomatik yeni bir taslak üretir.
- Taslağı e-posta ile `mucahitismailcoskun@gmail.com` adresine gönderir.
- Yazı yalnızca senin onayından sonra yayımlanır.

## Gerekli servisler

1. **Vercel** — hosting ve cron
2. **Vercel Blob** — yazıları saklamak için
3. **OpenAI API** — otomatik blog taslağı üretmek için
4. **Resend** — sana inceleme e-postası göndermek için
5. **Domain registrar** — `ismailcoskun.com` alan adını satın almak için

## 5 dakikada yayına alma

1. Bu klasörü GitHub'a yükle.
2. Vercel'de **Add New Project** ile GitHub reposunu içe aktar.
3. Vercel proje ayarlarında şu environment variable'ları ekle:
   - `OPENAI_API_KEY`
   - `BLOB_READ_WRITE_TOKEN`
   - `RESEND_API_KEY`
   - `FROM_EMAIL`
   - `OWNER_EMAIL`
   - `OWNER_NAME`
   - `SITE_URL`
   - `REVIEW_TOKEN`
   - `CRON_SECRET`
4. Vercel Storage bölümünden bir **Blob** oluştur.
5. Vercel üzerinde domain bölümüne `ismailcoskun.com` ekle.
6. Domain sağlayıcında Vercel'in verdiği DNS kayıtlarını gir.
7. Resend'de gönderen domainini doğrula.

## İlk test

Deploy sonrası cron endpointini bir kez elle test et.

```bash
curl -X GET "https://ismailcoskun.com/api/cron/generate" \
  -H "Authorization: Bearer SENIN_CRON_SECRET_DEGERIN"
```

Başarılı olursa yeni bir taslak oluşur ve e-posta gelir.

## Notlar

- Vercel Hobby planında cron günde bir kez çalışabilir; bu yüzden proje her gün tetiklenir ama yazı üretimini içeride 4 günlük mantıkla kontrol eder.
- Yazılar Vercel Blob üzerinde JSON olarak tutulur.
- Onay ekranı e-postadaki güvenli link üzerinden açılır.
