#!/usr/bin/env bun
// Port logowania Zappka3DS → wyciąga ployId + loyalSecret dla WŁASNEGO konta.
// Uruchom:  ZAPPKA_GOOGLE_KEY=AIza...  bun tools/zappka-login.mjs
//      lub: ZAPPKA_GOOGLE_KEY=AIza...  node tools/zappka-login.mjs
//
// Działa tylko dla Twojego numeru — kod SMS dostajesz na swój telefon.
// Odpowiada C-owym funkcjom: send_ver_code_preauth → send_verification_code
//                            → login_flow → SignIn → QrCode.

import { createInterface } from 'node:readline/promises';
import { stdin, stdout, env } from 'node:process';
import { randomUUID } from 'node:crypto';

// ── Klucz API Google/Firebase, który appka Żappki ma zaszyty w APK ──
// NIE ma go w repo Zappka3DS (README każe wyciągnąć samemu). Jak zdobyć — patrz niżej.
const GOOGLE_KEY = env.ZAPPKA_GOOGLE_KEY;
if (!GOOGLE_KEY) {
  console.error(`
Brak klucza. Ustaw zmienną ZAPPKA_GOOGLE_KEY = firebase'owy klucz API Żappki (zaczyna się od "AIza...").

Jak go zdobyć (statycznie z APK, bez omijania pinningu):
  1. Ściągnij APK Żappki (pl.zabka.apb2c) — np. przez APKPure / APKMirror albo
       adb shell pm path pl.zabka.apb2c   &&   adb pull <ścieżka>/base.apk
  2. Wyciągnij string klucza:
       unzip -o base.apk -d apk && grep -rhoE 'AIza[0-9A-Za-z_-]{35}' apk | sort -u
     (albo z res/values/strings.xml klucz "google_api_key" / "firebase...").
  3. ZAPPKA_GOOGLE_KEY=<ten AIza...> bun tools/zappka-login.mjs
`);
  process.exit(1);
}

const H_FIREBASE = {
  'Content-Type': 'application/json',
  'X-Android-Package': 'pl.zabka.apb2c',
  'X-Android-Cert': 'FAB089D9E5B41002F29848FC8034A391EE177077',
  'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 13; 22011119UY Build/TP1A.220624.014)',
};

async function post(url, body, headers) {
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}\n${text.slice(0, 400)}`);
  if (json?.errors) throw new Error(`GraphQL @ ${url}: ${JSON.stringify(json.errors).slice(0, 400)}`);
  if (json?.error) throw new Error(`API @ ${url}: ${JSON.stringify(json.error).slice(0, 400)}`);
  return json;
}

// 1. Anonimowe konto Firebase → token bearer do wysłania SMS (send_ver_code_preauth)
async function firebaseAnon() {
  const j = await post(
    `https://www.googleapis.com/identitytoolkit/v3/relyingparty/signupNewUser?key=${GOOGLE_KEY}`,
    { clientType: 'CLIENT_TYPE_ANDROID' },
    H_FIREBASE,
  );
  if (!j.idToken) throw new Error('Brak idToken z signupNewUser — zły klucz API?');
  return j.idToken;
}

// 2. Wyślij kod SMS (send_verification_code) — Authorization: <token> (bez "Bearer")
async function sendSms(anonToken, phone) {
  await post('https://super-account.spapp.zabka.pl/', {
    operationName: 'SendVerificationCode',
    query: 'mutation SendVerificationCode($input: SendVerificationCodeInput!) { sendVerificationCode(input: $input) { retryAfterSeconds } }',
    variables: { input: { phoneNumber: { countryCode: '48', nationalNumber: phone } } },
  }, { 'Content-Type': 'application/json', Authorization: anonToken });
}

// 3. Zaloguj kodem z SMS (login_flow: SignInWithPhone) → customToken
async function signInWithPhone(anonToken, phone, code) {
  const j = await post('https://super-account.spapp.zabka.pl/', {
    operationName: 'SignInWithPhone',
    query: 'mutation SignInWithPhone($input: SignInInput!) { signIn(input: $input) { customToken } }',
    variables: { input: { phoneNumber: { countryCode: '48', nationalNumber: phone }, verificationCode: code } },
  }, {
    'Content-Type': 'application/json',
    'User-Agent': 'okhttp/4.12.0',
    'X-Apollo-Operation-Id': 'a531998ec966db0951239efb91519560346cfecac77459fe3b85c5b786fa41de',
    'X-Apollo-Operation-Name': 'SignInWithPhone',
    Accept: 'application/json',
    Authorization: `Bearer ${anonToken}`,
  });
  const t = j?.data?.signIn?.customToken;
  if (!t) throw new Error('Brak customToken — zły kod SMS?');
  return t;
}

// 4. Wymień customToken na prawdziwy idToken (verifyCustomToken)
async function verifyCustomToken(customToken) {
  const j = await post(
    `https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyCustomToken?key=${GOOGLE_KEY}`,
    { token: customToken, returnSecureToken: true },
    H_FIREBASE,
  );
  if (!j.idToken) throw new Error('Brak idToken z verifyCustomToken');
  return { idToken: j.idToken, refreshToken: j.refreshToken };
}

const SPAPP = (idToken, body) => post('https://api.spapp.zabka.pl/', body, {
  'Content-Type': 'application/json',
  accept: 'application/json',
  'user-agent': 'Zappka/40038 (Horizon; ctr/citrus; 56c41945-ba88-4543-a525-4e8f7d4a5812) REL/32',
  Authorization: `Bearer ${idToken}`,
});

// 5. Zainicjuj sesję (SignIn) i pobierz sekret (QrCode)
async function fetchQr(idToken) {
  await SPAPP(idToken, {
    operationName: 'SignIn',
    query: 'mutation SignIn($signInInput: SignInInput!) { signIn(signInInput: $signInInput) { profile { __typename ...UserProfileParts } } }  fragment UserProfileParts on UserProfile { email gender }',
    variables: { signInInput: { sessionId: randomUUID() } },
  }).catch(() => {}); // nie blokujące
  const j = await SPAPP(idToken, {
    operationName: 'QrCode',
    query: 'query QrCode { qrCode { loyalSecret paySecret ployId } }',
    variables: {},
  });
  const qr = j?.data?.qrCode;
  if (!qr?.ployId || !qr?.loyalSecret) throw new Error('Brak qrCode w odpowiedzi: ' + JSON.stringify(j).slice(0, 300));
  return qr;
}

async function main() {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    let phone = (await rl.question('Numer telefonu (9 cyfr, bez +48): ')).replace(/\D/g, '');
    if (phone.startsWith('48') && phone.length === 11) phone = phone.slice(2);
    if (phone.length !== 9) throw new Error('Numer musi mieć 9 cyfr.');

    process.stdout.write('→ tworzę sesję anonimową… ');
    const anon = await firebaseAnon();
    console.log('ok');

    process.stdout.write('→ wysyłam SMS z kodem… ');
    await sendSms(anon, phone);
    console.log('ok (sprawdź telefon)');

    const code = (await rl.question('Kod z SMS: ')).replace(/\D/g, '');

    process.stdout.write('→ loguję… ');
    const customToken = await signInWithPhone(anon, phone, code);
    const { idToken } = await verifyCustomToken(customToken);
    console.log('ok');

    process.stdout.write('→ pobieram sekret… ');
    const qr = await fetchQr(idToken);
    console.log('ok\n');

    const out = { user_id: qr.ployId, hex_secret: qr.loyalSecret };
    console.log('═══ WKLEJ TO W APLIKACJĘ (pole „…lub wklej JSON z Zappka3DS") ═══\n');
    console.log(JSON.stringify(out));
    console.log('\nployId:      ', qr.ployId);
    console.log('loyalSecret: ', qr.loyalSecret);
    if (qr.paySecret) console.log('paySecret:   ', qr.paySecret, '(do płatności — nie potrzebne do karty lojalnościowej)');
  } finally {
    rl.close();
  }
}

main().catch(e => { console.error('\n✗ ' + e.message); process.exit(1); });
