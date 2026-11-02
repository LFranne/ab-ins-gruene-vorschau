<?php
// Holt das Wetter für Bad Wildbad von Open-Meteo und schreibt wetter.json neben dieses Skript.
// Aufruf: Cronjob im ALL-INKL-KAS (stündlich) ruft https://ab-ins-gruene.net/wetter.php auf.
// Holt erst nach 30 Minuten neu. Schlägt der Abruf fehl, bleibt die alte Datei (die Seite ignoriert Daten über 3 Stunden).
// Besucher rufen Open-Meteo nie selbst auf; die Seite liest nur wetter.json.

header('Content-Type: text/plain; charset=utf-8');
$ziel = __DIR__ . '/wetter.json';

if (is_file($ziel) && time() - filemtime($ziel) < 1800) {
    echo "aktuell\n";
    exit;
}

// Der Wettercode zählt nur die Gesamtbedeckung: dünne hohe Schleierwolken ergäben „bedeckt“ bei Sonnenschein.
// Bei Codes bis 3 rechnen wir deshalb nach Höhe gewichtet: tief voll, mittel 0,8, hoch 0,2.
function kategorie($code, $d = []) {
    if ($code <= 3 && isset($d['cloud_cover_low'], $d['cloud_cover_mid'], $d['cloud_cover_high'])) {
        $w = $d['cloud_cover_low'] + 0.8 * $d['cloud_cover_mid'] + 0.2 * $d['cloud_cover_high'];
        return $w < 30 ? 'klar' : ($w < 65 ? 'leicht' : 'bedeckt');
    }
    if ($code <= 1) return 'klar';
    if ($code === 2) return 'leicht';
    if ($code === 3) return 'bedeckt';
    if ($code === 45 || $code === 48) return 'nebel';
    if (($code >= 71 && $code <= 77) || $code === 85 || $code === 86) return 'schnee';
    if (($code >= 51 && $code <= 67) || ($code >= 80 && $code <= 82) || $code >= 95) return 'regen';
    return 'bedeckt';
}

$adresse = 'https://api.open-meteo.com/v1/forecast?latitude=48.75&longitude=8.55&current=temperature_2m,weather_code,is_day,cloud_cover_low,cloud_cover_mid,cloud_cover_high&timezone=Europe%2FBerlin';
$kontext = stream_context_create(['http' => ['timeout' => 10, 'header' => "User-Agent: ab-ins-gruene-webseite\r\n"]]);
$roh = @file_get_contents($adresse, false, $kontext);
$d = $roh ? (json_decode($roh, true)['current'] ?? null) : null;

if (!$d || !isset($d['temperature_2m'], $d['weather_code'])) {
    echo "Wetter nicht geholt, alte Datei bleibt\n";
    exit;
}

$code = (int) $d['weather_code'];
$daten = [
    'zeit' => gmdate('Y-m-d\TH:i:s.000\Z'),
    'temp' => (int) round($d['temperature_2m']),
    'code' => $code,
    'kategorie' => kategorie($code, $d),
    'tag' => ($d['is_day'] ?? 0) === 1,
];
file_put_contents($ziel, json_encode($daten) . "\n", LOCK_EX);
echo "ok: {$daten['temp']} Grad, {$daten['kategorie']}\n";
