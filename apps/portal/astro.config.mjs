// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import svelte from '@astrojs/svelte';
import sitemap from '@astrojs/sitemap';
import { EnumChangefreq } from 'sitemap';
import tailwind from '@tailwindcss/vite';
import { przekierowania } from '@ud/zawody';
import { writeFileSync, appendFileSync, existsSync, readdirSync, lstatSync, realpathSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SITE = 'https://utratadochodu.pl';

export default defineConfig({
  site: SITE,

  /**
   * Statyczny build. Portal nie ma niczego, co musi liczyć się na serwerze:
   * 228 podstron zawodów, strona główna, blog i dokumenty renderują się raz,
   * a formularz i kalkulator to wyspy Svelte działające w przeglądarce.
   * Statyk oznacza też, że robot dostaje gotowy HTML bez czekania na JS —
   * to jest warunek wstępny czytelności strony dla modeli językowych.
   */
  output: 'static',

  /** Adresy z ukośnikiem na końcu — tak jak dziś, żeby nie tracić linków. */
  trailingSlash: 'always',
  build: { format: 'directory' },

  integrations: [
    svelte(),
    /**
     * Dopisuje do _redirects trwałe przekierowania z adresów, które zmieniły
     * się względem starego serwisu. 301 zachowuje pozycję podstrony; 404 ją kasuje.
     */
    {
      name: 'ud:przekierowania',
      hooks: {
        'astro:build:done': ({ dir, logger }) => {
          const reguly = przekierowania();
          if (reguly.length === 0) return;
          const plik = new URL('_redirects', dir);
          const tresc = reguly.map((r) => `${r.z} ${r.na} 301`).join('\n') + '\n';
          if (existsSync(plik)) appendFileSync(plik, tresc, 'utf8');
          else writeFileSync(plik, tresc, 'utf8');
          logger.info(`dopisano ${reguly.length} przekierowań 301 do _redirects`);
        },
      },
    },
    /**
     * Mówi w logu builda, które ustawienia wzięliśmy z panelu, a które
     * z wartości wbudowanych.
     *
     * Wcześniej brak klucza Turnstile przerywał build. To było o jeden krok
     * za daleko: te wartości nie są sekretami i mają sensowne wartości
     * domyślne w lib/uslugi.ts, więc ich brak nie psuje już wysyłki.
     * Zostaje sama informacja — żeby po zmianie klucza w panelu dało się
     * sprawdzić w logu, czy build ją zobaczył.
     */
    {
      name: 'ud:konfiguracja',
      hooks: {
        'astro:config:done': ({ logger }) => {
          /**
           * Astro bierze zmienne z DWÓCH źródeł: środowiska procesu i pliku
           * .env. Sprawdzanie samego process.env dawało log twierdzący, że nic
           * nie jest ustawione, podczas gdy .env podawał wartości — czyli
           * dokładnie mylną podpowiedź przy szukaniu takiej usterki.
           */
          const zPliku = new Set();
          try {
            const plik = readFileSync(new URL('.env', import.meta.url), 'utf8');
            for (const linia of plik.split('\n')) {
              const nazwa = linia.match(/^\s*([A-Z0-9_]+)\s*=\s*\S/)?.[1];
              if (nazwa) zPliku.add(nazwa);
            }
          } catch { /* brak .env to normalna sytuacja */ }

          const ustawione = ['PUBLIC_SUPABASE_URL', 'PUBLIC_TURNSTILE_SITE_KEY',
                             'PUBLIC_GA4_ID', 'PUBLIC_ADS_ID', 'PUBLIC_META_PIXEL_ID']
            .filter((k) => process.env[k] || zPliku.has(k));
          logger.info(
            ustawione.length > 0
              ? `ustawienia z konfiguracji: ${ustawione.join(', ')}`
              : 'brak zmiennych PUBLIC_* — build użyje wartości wbudowanych z lib/uslugi.ts',
          );
        },
      },
    },

    /**
     * Cloudflare Pages odrzuca katalog wyjściowy zawierający dowiązania, które
     * wychodzą poza ten katalog — komunikatem „build output directory contains
     * links to files that can't be accessed". Jest on na tyle ogólny, że można
     * przy nim stracić godzinę, więc sprawdzamy to na miejscu i mówimy wprost,
     * który plik zawinił.
     */
    {
      name: 'ud:bez-dowiazan',
      hooks: {
        'astro:build:done': ({ dir, logger }) => {
          const katalog = resolve(dir.pathname);
          /** @type {string[]} */
          const winne = [];

          /** @param {string} sciezka */
          const obejdz = (sciezka) => {
            for (const wpis of readdirSync(sciezka, { withFileTypes: true })) {
              const pelna = join(sciezka, wpis.name);
              if (wpis.isSymbolicLink()) {
                let cel;
                try {
                  cel = realpathSync(pelna);
                } catch {
                  winne.push(`${relative(katalog, pelna)} → zepsute dowiązanie`);
                  continue;
                }
                if (relative(katalog, cel).startsWith('..')) {
                  winne.push(`${relative(katalog, pelna)} → ${cel} (poza katalogiem)`);
                }
                continue;
              }
              if (wpis.isDirectory()) obejdz(pelna);
            }
          };

          obejdz(katalog);

          if (winne.length > 0) {
            throw new Error(
              `Katalog wyjściowy zawiera dowiązania, których Cloudflare Pages nie przyjmie:\n  ${winne.join('\n  ')}`,
            );
          }
          logger.info('katalog wyjściowy bez dowiązań');
        },
      },
    },
    sitemap({
      i18n: undefined,
      /** Wykluczamy adresy techniczne — nie ma po co ich zgłaszać. */
      filter: (page) => !page.includes('/podziekowanie/'),
      serialize(item) {
        // Priorytet mówi robotowi, co przeindeksować najpierw, gdy nie ma czasu
        // na wszystko. Strony prawne są na końcu tej kolejki celowo.
        if (item.url === `${SITE}/`) return { ...item, priority: 1.0, changefreq: EnumChangefreq.WEEKLY };
        if (/\/(regulamin|polityka-|klauzula-informacyjna)/.test(item.url)) {
          return { ...item, priority: 0.2, changefreq: EnumChangefreq.YEARLY };
        }
        // Baza wiedzy dostaje nowe wpisy — warto zaglądać częściej.
        if (item.url.includes('/blog/')) {
          return { ...item, priority: 0.6, changefreq: EnumChangefreq.WEEKLY };
        }
        if (/\/(dokumenty|opinie|kontakt|pracuj-z-nami)/.test(item.url)) {
          return { ...item, priority: 0.4, changefreq: EnumChangefreq.MONTHLY };
        }
        return { ...item, priority: 0.8, changefreq: EnumChangefreq.MONTHLY };
      },
    }),
  ],

  /**
   * Fonty serwujemy z własnej domeny. Astro pobiera pliki w buildzie, generuje
   * @font-face z metrykami zastępczymi i wstawia preload — dzięki temu nie ma
   * skoku układu przy zamianie fontu (CLS) ani rundy do fonts.gstatic.com
   * w ścieżce krytycznej (LCP).
   *
   * subsets zawiera latin-ext, bo bez niego polskie znaki diakrytyczne lecą
   * na font systemowy i tekst przeskakuje w trakcie wczytywania.
   */
  fonts: [
    {
      provider: fontProviders.google(),
      name: 'Newsreader',
      cssVariable: '--font-naglowek',
      weights: [400, 500],
      styles: ['normal'],
      subsets: ['latin', 'latin-ext'],
      fallbacks: ['Georgia', 'Times New Roman', 'serif'],
    },
    {
      provider: fontProviders.google(),
      name: 'Public Sans',
      cssVariable: '--font-tekst',
      weights: [400, 500, 600, 700],
      styles: ['normal'],
      subsets: ['latin', 'latin-ext'],
      fallbacks: ['ui-sans-serif', 'system-ui', 'sans-serif'],
    },
    {
      provider: fontProviders.google(),
      name: 'IBM Plex Mono',
      cssVariable: '--font-mono',
      weights: [400, 500, 600],
      styles: ['normal'],
      subsets: ['latin', 'latin-ext'],
      fallbacks: ['ui-monospace', 'monospace'],
    },
  ],

  vite: {
    plugins: [tailwind()],
  },

  image: {
    /** Zdjęcia zawodów są lokalne; sharp przelicza je w buildzie do AVIF/WebP. */
    responsiveStyles: true,
  },
});
