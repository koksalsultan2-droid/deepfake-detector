# Deepfake / AI İçerik Tespit Servisi — Başlangıç Seti

Bu klasörde İKİ backend seçeneği var:

- **`server.js`** — Hive AI (ücretli, istek başına ödeme) kullanır. Daha
  yüksek doğruluk ama bütçe gerektirir (bkz. önceki maliyet tablosu).
- **`server-opensource.js`** — Hugging Face'teki ÜCRETSİZ açık kaynak
  modelleri kullanır. 10-20$/ay bütçeye uygun olan budur. Aylık maliyetin
  sadece sunucuyu (VPS/Railway) çalıştırmak, istek başına ödeme yok.

**Küçük bütçeyle başlıyorsan `server-opensource.js`'i kullan.** Onu
çalıştırmak için `package.json`'daki `"start"` komutunu
`"node server-opensource.js"` olarak değiştir.

`server-opensource.js` için ekstra gereksinim: sunucunda **ffmpeg** kurulu
olmalı (video işleme için):
```bash
# Ubuntu/Debian
sudo apt install ffmpeg
# macOS
brew install ffmpeg
```

## Kurulum

1. Node.js yüklü olduğundan emin ol (v18+).
2. Bu klasörde:
   ```bash
   npm install
   ```
3. **Ücretsiz seçenek (önerilen, düşük bütçe için):** [huggingface.co](https://huggingface.co)
   üzerinden ücretsiz hesap aç → Settings → Access Tokens → yeni token
   oluştur. Kredi kartı gerekmez.
   **Ücretli seçenek:** [Hive AI](https://thehive.ai) üzerinden hesap açıp
   API anahtarı al (kullanım bazlı ücretlendirme — önceki mesajdaki
   maliyet tablosuna bak).
4. `.env` dosyası oluştur (kullandığın backend'e göre):
   ```
   # server-opensource.js kullanıyorsan:
   HF_TOKEN=senin_huggingface_tokenin

   # server.js (Hive) kullanıyorsan:
   HIVE_API_KEY=senin_hive_api_anahtarin
   ```
5. Çalıştır:
   ```bash
   node -r dotenv/config server.js
   ```
   (`dotenv` paketini de `npm install dotenv` ile ekle, ya da anahtarı
   doğrudan ortam değişkeni olarak export et.)
6. Tarayıcıda `http://localhost:3000` adresini aç.

## Deploy (canlıya alma)

Bu bir Node.js backend'i olduğu için statik bir sayfa gibi "yayınlanamaz" —
gerçek bir sunucuda çalışması gerekir. En kolay seçenekler:

- **Railway** veya **Render**: GitHub reponu bağla, `HIVE_API_KEY`'i ortam
  değişkeni olarak ekle, otomatik deploy eder.
- **Bir VPS** (DigitalOcean, Hetzner vb.): `pm2` ile arka planda çalıştır.

## Şu an eksik olanlar / senin tamamlaman gerekenler

- **Ses-özel deepfake tespiti**: Hive'ın bu endpoint'i temelde görüntü/video
  odaklı. Saf ses dosyaları (sadece .mp3/.wav gibi) için Resemble AI Detect
  ya da Pindrop gibi ayrı bir sağlayıcı eklemen gerekebilir — `server.js`
  içindeki `callHiveWithUrl` fonksiyonunun yanına benzer bir
  `callAudioProvider` fonksiyonu eklemen yeterli.
- **Video link indirme**: Kullanıcı bir YouTube/TikTok linki yapıştırırsa,
  o linki indirip Hive'a göndermen gerekir (örn. `yt-dlp` ile). Şu anki kod
  sadece doğrudan medya URL'lerini (örn. `.mp4` linkini) veya dosya
  yüklemeyi destekliyor.
- **`summarizeHiveResponse` fonksiyonu**: Hive hesabına ilk gerçek isteği
  attığında dönen ham JSON'u `console.log` ile incele, alan adları
  (`class` isimleri) hesabına göre değişebilir — fonksiyonu ona göre
  güncelle.
- **Rate limit ayarları**: Şu an IP başına günde 10 analiz olarak
  ayarlanmış. Bütçene göre bu sayıyı düşür/yükselt.
- **Sonuçları saklama**: Şu an hiçbir sonuç kaydedilmiyor — istersen
  kullanıcı onayıyla bir veritabanına kaydedip zamanla kendi eğitim
  veri setini biriktirebilirsin (bir önceki mesajda konuştuğumuz gibi).

## Maliyet hatırlatması

Üyeliksiz + limitsiz bıraktığında API faturası hızla artabilir. Rate
limit'i mutlaka production'a almadan önce sıkılaştır, ve Hive
dashboard'unda bir harcama uyarısı/limiti kur.
