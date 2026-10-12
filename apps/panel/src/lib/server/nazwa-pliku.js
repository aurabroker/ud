/** Nazwa wgrywanego pliku z nagłówka x-nazwa-pliku (zakodowana encodeURIComponent). */
export function nazwaZNaglowka(request) {
  const surowa = request.headers.get('x-nazwa-pliku') || '';
  try {
    return decodeURIComponent(surowa);
  } catch {
    return surowa;
  }
}
