/**
 * analityka.ts — identyfikatory tagów i zasady ich uruchamiania.
 *
 * Wartości są publiczne (widać je w kodzie każdej strony), więc nie są
 * sekretem — trzymamy je tutaj, żeby dało się je podmienić przez zmienną
 * środowiskową bez edycji kodu, a jednocześnie żeby build bez `.env`
 * dawał działający serwis.
 *
 * Uwaga na dwie właściwości GA4 w starym serwisie: `G-MGB0RBTCC9` startowała
 * bezwarunkowo z index.html, a `G-D9XHPWP5DE` była podpięta pod baner zgód
 * w cookie-consent.js. Zostawiamy tę pierwszą, bo to ona zbierała dane i to
 * ona jest skonfigurowana razem z Google Ads. Druga jest do zamknięcia —
 * inaczej historia ruchu rozjeżdża się na dwie niepełne właściwości.
 */
export const TAGI = {
  ga4: import.meta.env.PUBLIC_GA4_ID ?? 'G-MGB0RBTCC9',
  ads: import.meta.env.PUBLIC_ADS_ID ?? 'AW-18020137303',
  pixel: import.meta.env.PUBLIC_META_PIXEL_ID ?? '4299065913693248',

  /**
   * Ścieżki, na których Pixel nie startuje nawet przy zgodzie na marketing.
   *
   * Regulamin Meta zabrania przesyłania danych wrażliwych, a przy ankiecie
   * medycznej sygnałem jest już sam adres odwiedzanej strony: „ten użytkownik
   * wypełnia wniosek o ubezpieczenie zdrowotne". Google Ads i GA4 zostają,
   * bo bez nich nie da się zmierzyć konwersji — ale bez remarketingu.
   */
  bezPixela: ['/wniosek/', '/podziekowanie/'],

  /**
   * Etykieta konwersji Google Ads dla złożonego wniosku — przeniesiona
   * z thankyou.html. Zdarzenie wysyła UDCookies.konwersja(), więc leci
   * wyłącznie wtedy, gdy użytkownik wpuścił cookies marketingowe.
   */
  konwersjaWniosek: import.meta.env.PUBLIC_ADS_KONWERSJA ?? '_uZeCOTG_KwcENfy1ZBD',
} as const;
