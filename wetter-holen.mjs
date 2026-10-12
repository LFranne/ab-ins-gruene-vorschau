// Holt das aktuelle Wetter für Bad Wildbad (Open-Meteo, ohne Schlüssel) und schreibt es als kleine JSON-Datei.
// Aufruf:  node scripts/wetter-holen.mjs [ZIELDATEI]      (Standard: public/wetter.json)
// Die Seite liest diese Datei von der eigenen Adresse; Besucher rufen Open-Meteo nie selbst auf.
// Schlägt der Abruf fehl, bleibt die alte Datei unverändert (die Seite ignoriert Daten, die älter als 3 Stunden sind).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const ziel = process.argv[2] || 'public/wetter.json';
const adresse =
  'https://api.open-meteo.com/v1/forecast?latitude=48.75&longitude=8.55&current=temperature_2m,weather_code,is_day&timezone=Europe%2FBerlin';

// WMO-Wettercodes -> Kategorie der Seite
function kategorie(code) {
  if (code <= 1) return 'klar';
  if (code === 2) return 'leicht';
  if (code === 3) return 'bedeckt';
  if (code === 45 || code === 48) return 'nebel';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'schnee';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return 'regen';
  return 'bedeckt';
}

try {
  const antwort = await fetch(adresse, { headers: { 'user-agent': 'ab-ins-gruene-webseite' } });
  if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`);
  const d = (await antwort.json()).current;
  const daten = {
    zeit: new Date().toISOString(),
    temp: Math.round(d.temperature_2m),
    code: d.weather_code,
    kategorie: kategorie(d.weather_code),
    tag: d.is_day === 1,
  };
  mkdirSync(dirname(ziel), { recursive: true });
  writeFileSync(ziel, JSON.stringify(daten) + '\n');
  console.log(`${ziel}: ${daten.temp} °, ${daten.kategorie} (Code ${daten.code})`);
} catch (fehler) {
  console.error(`Wetter nicht geholt: ${fehler.message}. Alte Datei bleibt.`);
  process.exitCode = 0;
}
