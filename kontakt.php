<?php
// Kontaktformular: nimmt Name, E-Mail und Nachricht entgegen und schickt sie als Mail an willkommen@ab-ins-gruene.net.
// Nichts wird gespeichert (nur eine Zählerdatei mit Uhrzeiten, ohne Namen, Adressen oder IPs), kein Dritter ist beteiligt.
// Aufruf: POST von der Seite /kontakt/ (fetch). Antwort immer JSON: {"ok":true} oder {"ok":false,"fehler":"daten|zeit|limit|sonst"}.
// Schutz: verstecktes Feld „website“, Mindestdauer, Längengrenzen, E-Mail-Prüfung, Zeilenumbrüche in Kopfzeilen entfernt,
// höchstens 20 Mails pro Stunde. Läuft das Skript nicht, bleiben E-Mail, WhatsApp und Telefon auf der Seite.

const EMPFAENGER = 'willkommen@ab-ins-gruene.net';
const ABSENDER = 'willkommen@ab-ins-gruene.net';
const ERLAUBTE_HERKUNFT = ['ab-ins-gruene.net', 'www.ab-ins-gruene.net'];
const MIN_DAUER_MS = 3000;
const MAX_PRO_STUNDE = 20;

ini_set('display_errors', '0'); // Warnungen dürfen die JSON-Antwort nie verfälschen
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function antwort($ok, $fehler = null, $status = 200) {
    http_response_code($status);
    echo json_encode($ok ? ['ok' => true] : ['ok' => false, 'fehler' => $fehler]);
    exit;
}

// Liest ein Formularfeld als Text (Listen und fehlende Felder werden zu einem leeren Text).
function feld($schluessel) {
    $w = $_POST[$schluessel] ?? '';
    return is_string($w) ? $w : '';
}

// Entfernt Steuerzeichen und Zeilenumbrüche (gegen Einschleusen von Kopfzeilen). Ungültige Zeichen ergeben einen leeren Text.
function einzeilig($s) {
    $r = preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $s);
    return trim($r === null ? '' : $r);
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    antwort(false, 'sonst', 405);
}

// Anfragen von anderen Seiten ablehnen (Origin ist bei fetch vom eigenen Browser immer gesetzt).
$herkunft = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($herkunft !== '') {
    $host = parse_url($herkunft, PHP_URL_HOST);
    if (!in_array($host, ERLAUBTE_HERKUNFT, true)) {
        antwort(false, 'sonst', 403);
    }
}

// Honigtopf: Menschen sehen das Feld nicht. Bots füllen es; wir tun so, als wäre alles gut, und senden nichts.
if (trim(feld('website')) !== '') {
    antwort(true);
}

$name = einzeilig(feld('name'));
$mail = einzeilig(feld('mail'));
$text = str_replace(["\r\n", "\r", "\0"], ["\n", "\n", ''], trim(feld('text')));
$ds = feld('ds') === '1';
$dauer = (int) feld('dauer');

$nameLaenge = mb_strlen($name, 'UTF-8');
$textLaenge = mb_strlen($text, 'UTF-8');
if ($nameLaenge < 2 || $nameLaenge > 100 || $textLaenge < 5 || $textLaenge > 5000 || strlen($mail) > 200 || !filter_var($mail, FILTER_VALIDATE_EMAIL) || !$ds) {
    antwort(false, 'daten', 400);
}

if ($dauer < MIN_DAUER_MS) {
    antwort(false, 'zeit', 429);
}

// Obergrenze pro Stunde über eine kleine Zählerdatei .htkontakt-zaehler (nur Unix-Zeiten, Apache sperrt Namen mit .ht von außen). Lässt sich die Datei nicht anlegen, wird nicht begrenzt.
$zaehler = __DIR__ . '/.htkontakt-zaehler';
$jetzt = time();
$fh = @fopen($zaehler, 'c+');
if ($fh && flock($fh, LOCK_EX)) {
    $zeiten = array_filter(array_map('intval', explode("\n", (string) stream_get_contents($fh))), function ($t) use ($jetzt) {
        return $t > $jetzt - 3600;
    });
    if (count($zeiten) >= MAX_PRO_STUNDE) {
        flock($fh, LOCK_UN);
        fclose($fh);
        antwort(false, 'limit', 429);
    }
    $zeiten[] = $jetzt;
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, implode("\n", $zeiten));
    flock($fh, LOCK_UN);
}
if ($fh) {
    fclose($fh);
}

date_default_timezone_set('Europe/Berlin');
$betreff = mb_encode_mimeheader('Anfrage über ab-ins-gruene.net von ' . $name, 'UTF-8', 'B', "\r\n");
$koerper = "Neue Nachricht über das Kontaktformular auf ab-ins-gruene.net\r\n\r\n"
    . "Name: {$name}\r\n"
    . "E-Mail: {$mail}\r\n"
    . 'Gesendet: ' . date('d.m.Y H:i') . " Uhr\r\n\r\n"
    . "Nachricht:\r\n" . str_replace("\n", "\r\n", $text) . "\r\n";
$kopf = [
    'From: ' . ABSENDER,
    'Reply-To: ' . $mail,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    'X-Mailer: kontakt.php',
];

$gesendet = @mail(EMPFAENGER, $betreff, $koerper, implode("\r\n", $kopf), '-f' . ABSENDER);
antwort($gesendet, 'sonst', $gesendet ? 200 : 500);
