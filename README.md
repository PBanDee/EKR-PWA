# EKR – offline PWA prototípus

Az alkalmazás GitHub Pages projekt-alútvonalon is működik:
<https://pbandee.github.io/EKR-PWA/>

## Közzététel

A GitHub repository **Settings → Pages** beállításánál válaszd ki a közzétételi ágat és annak gyökérkönyvtárát (`/`). Az alkalmazás minden statikus fájlt relatív útvonalon tölt be; a manifest `start_url` és `scope` értéke, illetve a Service Worker hatóköre ezért az `/EKR-PWA/` útvonalon is helyes.

## Helyi kipróbálás

Nyisd meg a repository gyökérkönyvtárát egy helyi HTTP fejlesztői szerverrel, majd böngészőben annak címét. A Service Worker csak HTTPS-en vagy a `localhost` biztonságos fejlesztői környezetben működik; a fájlkezelőből megnyitott `index.html` nem alkalmas offline PWA-tesztelésre.

1. Nyisd meg egyszer online az alkalmazást, és várd meg az offline gyorsítótár telepítését.
2. Hozz létre egy munkát, majd tölts ki legalább egy űrlapmezőt. Az adatok automatikusan az eszköz IndexedDB-adatbázisába mentődnek.
3. Kapcsold ki a hálózatot, töltsd újra az alkalmazást, és ellenőrizd a helyi munka elérhetőségét.

## Prototípus korlátai

- A munkák és a dinamikus, `templates.json` fájlból betöltött dokumentuműrlap helyben működik. Képek hozzáadhatók a galériából vagy a kamerából; az előnézet, a kategória, a képaláírás és a Blob helyben tárolódik. A korlát képenként 15 MB, munkánként összesen 50 MB.
- Aláírás érintéssel, tollal vagy egérrel rajzolható. Az aláíró neve, választható szerepe, a helyi rögzítés időpontja és a kép Blobként, helyben tárolódik. A kézi aláírás nem tanúsítványalapú digitális aláírás.
- A véglegesített munkák UUID-alapú bejegyzéssel a külön IndexedDB queue-ba kerülnek. A „Szinkronizálás most · MOCK” gombbal kipróbálható a folyamat; a „Mock hibát szimulálok” jelölőnégyzet ellenőrzi a hibakezelést és az újrapróbálkozást.
- A mock átvételi azonosítót adhat, de nem küld adatot hálózaton: a munka `pending_upload` állapotban marad, és soha nem jelenik meg feltöltöttként. Sikertelen próbálkozásnál az adat helyben megmarad; az automatikus újrapróbálkozás exponenciális késleltetésű, a kézi indítás ezt megkerüli. Online állapot visszatérésekor az esedékes queue automatikusan újraindul.
- Az adatbázis 1-es verziójáról 2-esre migrálódik a tartós feltöltési queue hozzáadásához. A kivitelezések és Blobként tárolt képek/aláírások megmaradnak.
- Az adatok az adott böngészőben és eszközön maradnak. Kizárólag szintetikus tesztadatokat használj.
- Az alkalmazáshéj gyorsítótár-verziója a `sw.js` fájlban található. Statikus fájlok frissítésekor növeld az `ekr-pwa-shell-v8` verzióját; az aktiválás a korábbi, ehhez az alkalmazáshoz tartozó cache-t törli, az IndexedDB-adatokat nem.
- A GitHub Pages HTTPS-kiszolgálásáról és a telepítési állapotról a repository **Actions** lapján ellenőrizd a közzétételt.

Éles használat előtt szükséges az Android-tableten történő tesztelés; iPad/iPhone használat előtt külön iPadOS/Safari teszt szükséges.
