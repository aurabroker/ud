/**
 * test-sms-oferta.mjs — SMS „wysłaliśmy Ci ofertę" (decyzja z 12.10.2026).
 * Uruchom: node scripts/test-sms-oferta.mjs
 *
 * Sprawdza treść (jedna część SMS-a, bez linku, bez kodu) i numer odbiorcy,
 * a w źródle sendOfferToClient — że SMS idzie dopiero PO wysłanym e-mailu
 * i nie decyduje o statusie oferty.
 */
import { readFileSync } from 'node:fs';
import { SMS_OFERTA, jednaCzesc, numerDoSms } from '../src/lib/server/smsOferta.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(56)} = ${JSON.stringify(actual)}${ok ? '' : `  (oczekiwano ${JSON.stringify(expected)})`}`);
}

console.log('Treść');
check('jedna część SMS-a (GSM, ≤ 160 znaków)', jednaCzesc(SMS_OFERTA), true);
check('mówi, że oferta poszła mailem', /wyslalismy do Ciebie oferte/.test(SMS_OFERTA) && /maila/.test(SMS_OFERTA), true);
check('bez linku', /https?:|www\.|\/offer\//i.test(SMS_OFERTA), false);
// Telefony robią odnośnik z gołej domeny („UtrataDochodu.pl") — tego też nie.
check('bez gołej domeny', /\b[\w-]+\.(pl|com|eu|net|org)\b/i.test(SMS_OFERTA), false);
check('bez kodu / PESEL-u / PIN-u', /kod|pesel|pin|haslo/i.test(SMS_OFERTA), false);
check('polskie znaki rozbiłyby SMS na dwie części', jednaCzesc('Właśnie wysłaliśmy do Ciebie ofertę. Sprawdź maila (także folder Spam). Pytania: 504 400 901 — UtrataDochodu.pl'), false);

console.log('Numer');
check('9 cyfr', numerDoSms('504400901'), '48504400901');
check('ze spacjami i +48', numerDoSms('+48 504 400 901'), '48504400901');
check('z 0048', numerDoSms('0048504400901'), '48504400901');
check('48 bez plusa', numerDoSms('48504400901'), '48504400901');
check('z myślnikami', numerDoSms('504-400-901'), '48504400901');
check('pusty', numerDoSms(''), null);
check('null', numerDoSms(null), null);
check('za krótki', numerDoSms('50440090'), null);
check('za długi bez 48', numerDoSms('5044009011'), null);
check('zagraniczny (+49)', numerDoSms('+49 1512 3456789'), null);
check('zaczyna się od zera', numerDoSms('004400901'), null);

console.log('sendOfferToClient');
const zrodlo = readFileSync(new URL('../src/lib/server/offers.js', import.meta.url), 'utf8');
const start = zrodlo.indexOf('export async function sendOfferToClient');
const koniec = zrodlo.indexOf('\nexport ', start + 10);
const f = zrodlo.slice(start, koniec);
const iMail = f.indexOf('await sendEmail(');
const iSms = f.indexOf('await sendSms(');
const iStatus = f.indexOf("status: 'sent'");
check('SMS jest wysyłany', iSms > 0, true);
check('SMS po e-mailu', iSms > iMail, true);
check('SMS po ustawieniu statusu „Wysłana" (nie decyduje o nim)', iSms > iStatus, true);
check('SMS tylko przy wysłanym e-mailu', /if \(email\.sent\)[\s\S]*await sendSms\(/.test(f.slice(iStatus)), true);
check('SMS z treścią SMS_OFERTA, nie z kodem', /sendSms\(numer, SMS_OFERTA\)/.test(f), true);
// Zły numer przy ofercie nie może zasłonić dobrego numeru z kartoteki klienta.
check('numer z kartoteki, gdy przy ofercie zły', /numerDoSms\(offer\.client_phone\)\s*\?\?\s*numerDoSms\(klient\?\.phone\)/.test(f), true);
check('próba SMS-a trafia do ud_send_log', /logSend\('sms'/.test(f), true);
check('wyjątek SMS-a nie wywraca wysyłki', /sendSms\(numer, SMS_OFERTA\)\s*\.catch\(/.test(f), true);

if (failures) {
  console.log(`\n✗ ${failures} błędów`);
  process.exit(1);
}
console.log('\n✓ wszystko zgodne');
