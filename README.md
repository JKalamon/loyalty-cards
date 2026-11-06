# Karty — portfel kart lojalnościowych

Minimalistyczna aplikacja PWA do trzymania kart lojalnościowych polskich sklepów
w jednym miejscu. Działa offline, instaluje się na ekranie głównym, a dane są
trzymane **tylko lokalnie** w przeglądarce (localStorage) — nic nie jest wysyłane
na żaden serwer.

### ▶️ Aplikacja na żywo
**https://jkalamon.github.io/loyalty-cards/**

Na telefonie: otwórz link → *Dodaj do ekranu głównego* (Safari) / *Zainstaluj aplikację* (Chrome).

## Funkcje
- 🧱 Siatka kart w dwóch kolumnach; **dotknij i przytrzymaj**, aby zmienić kolejność.
- ➕ **Przesuń w prawo**, aby dodać kartę. 36 polskich marek z oficjalnymi logo
  (Biedronka, Lidl, Żabka, Rossmann, Kaufland, Orlen, bp, Action, Amic, Decathlon,
  Circle K, IKEA, Auchan, CCC, 4F, Adidas, Carrefour, Deichmann, Diagnostyka, Hebe,
  H&M, House, Jula, KiK, Lewiatan, Leroy Merlin, MediaMarkt, MOL, Modivo, Moya, OBI,
  Pepco, Polo Market, Shell, Selgros, Tesco) oraz dowolna **„Inna karta"**.
- 🔢 Kody kreskowe (EAN-13/8, UPC, Code 128/39, ITF), **kody QR**,
  **PDF417** (karty Biedronki) oraz **„tylko tekst"** (np. kod do bramy bez kodu).
- 📷 Skanowanie numeru aparatem.
- 🟢 **Żabka (Żappka)** — dynamiczny kod co 30 s (TOTP), identyczny z oryginalną
  aplikacją. Wymaga jednorazowego podania `ployId` + `loyalSecret`
  (zob. [`tools/zappka-login.mjs`](tools/zappka-login.mjs)).
- 🔴 **Orlen Vitay** — QR w formacie `TRANSID 0 / VITAY <numer>`, jak w aplikacji Vitay.
- 💾 Eksport/import kopii zapasowej (JSON).
- 📴 Pełne działanie offline (service worker), ekran pozostaje włączony przy podglądzie karty.

## Żabka — jak zdobyć sekret
Aplikacja nie loguje się do Żabki (przeglądarka nie może wołać jej API).
Skrypt [`tools/zappka-login.mjs`](tools/zappka-login.mjs) odwzorowuje logowanie
z [Zappka3DS](https://github.com/TehFridge/Zappka3DS) i zwraca gotowy JSON do wklejenia:

```sh
ZAPPKA_GOOGLE_KEY=AIza...   bun tools/zappka-login.mjs
# lub: node tools/zappka-login.mjs
```

Klucz `AIza…` (Firebase) wyciągasz raz z APK Żappki — instrukcja jest wypisywana
przez skrypt, gdy zmiennej brakuje.

## Uruchomienie lokalnie
Statyczne pliki, bez kroku budowania:

```sh
bunx serve .      # albo: python3 -m http.server
```

WebCrypto (kody Żabki), aparat i service worker wymagają `https://` lub `localhost`.

## Technologia
Czysty HTML/CSS/JS. Biblioteki w `vendor/` (offline): `qrcode-generator`,
`JsBarcode`, `html5-qrcode`, `SortableJS`. Wdrożenie: GitHub Actions → GitHub Pages
(workflow `.github/workflows/deploy.yml` sprawdza składnię, zasoby i wektory TOTP
RFC 6238, po czym publikuje stronę).

> Logotypy marek należą do ich właścicieli; użyte do osobistego portfela kart.
