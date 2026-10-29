// Testseite für Hase A: Kamera, Boden, Bedienung. Der Hase selbst steckt in hase.js.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HaseA } from './hase.js';
import { PosenHase } from './posenhase.js';

// Standard ist das sitzende Meshy-Modell (Plan 014); ?modell=stehend lädt den aufrecht stehenden Hasen (Plan 017),
// ?modell=runde1 den ersten eigenen Hasen.
const MODELLWAHL = 'posen';
const MODELL = { runde1: '../models/Hase_A.glb', stehend: '../models/Hase_A_stehend.glb', p03: '../models/Hase_A_p03.glb', spiel: '../models/Hase_A_spiel.glb', posen: ['models/Hase_A_posen.glb', 'models/Hase_A_zwischen.glb'] }[MODELLWAHL] ?? '../models/Hase_A_meshy.glb';
const GROESSE = { stehend: 1.5, p03: 1.5, posen: 1.5, spiel: 1.1 }[MODELLWAHL] ?? 1;   // der stehende Hase ist etwa 1,5-mal so hoch
const ZIEL = new THREE.Vector3(0, 0.19 * GROESSE, 0);
const ANSICHTEN = {
  vorne: [0, 0.24 * GROESSE, 1.3 * GROESSE],
  seite: [-1.3 * GROESSE, 0.24 * GROESSE, 0],
  hinten: [0, 0.24 * GROESSE, -1.3 * GROESSE],
  schraeg: [0.68 * GROESSE, 0.4 * GROESSE, 1.05 * GROESSE],
};
const NAMEN = { atmen: 'Atmen', blinzeln: 'Blinzeln', ohren: 'Ohren', kopf: 'Kopf', schnuppern: 'Schnuppern', umsehen: 'Umsehen', aufmerken: 'Aufmerken', gewicht: 'Gewicht', hoppeln: 'Hoppeln' };
const ruhigeBewegung = matchMedia('(prefers-reduced-motion: reduce)').matches;

const leinwand = document.getElementById('leinwand');
const renderer = new THREE.WebGLRenderer({ canvas: leinwand, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);

const szene = new THREE.Scene();
const kamera = new THREE.PerspectiveCamera(30, 1, 0.02, 20);
const steuerung = new OrbitControls(kamera, leinwand);
steuerung.target.copy(ZIEL);
steuerung.enableDamping = true;
steuerung.minDistance = 0.32;
steuerung.maxDistance = 3;
steuerung.maxPolarAngle = THREE.MathUtils.degToRad(92);
steuerung.autoRotateSpeed = 0.8;

function ansicht(name) {
  kamera.position.set(...ANSICHTEN[name]);
  steuerung.target.copy(ZIEL);
  steuerung.update();
}
ansicht('schraeg');

// Boden: weiche Lasur in Grasgrau mit Kontaktschatten unter dem Hasen
const boden = new THREE.Mesh(
  new THREE.PlaneGeometry(1.1, 1.1),
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float rausch(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + 1.0), f.x), f.y); }
      float fbm(vec2 p) { return rausch(p) * 0.55 + rausch(p * 2.1) * 0.28 + rausch(p * 4.3) * 0.17; }
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float n = fbm(p * 3.0 + 4.0);
        float r = length(p * vec2(1.0, 1.15)) + (n - 0.5) * 0.4;
        float wasch = smoothstep(0.95, 0.3, r);
        float rand = smoothstep(0.5, 0.9, r) * wasch;
        float kontakt = smoothstep(0.36, 0.02, length((p - vec2(0.0, -0.02)) * vec2(1.45, 1.15)) + (n - 0.5) * 0.08);
        vec3 farbe = mix(vec3(0.56, 0.59, 0.46), vec3(0.42, 0.39, 0.43), kontakt);
        farbe *= 1.0 - 0.3 * rand;
        float a = max(wasch * 0.5, kontakt * 0.62);
        gl_FragColor = vec4(farbe, a);
        #include <colorspace_fragment>
      }`,
  }),
);
boden.rotation.x = -Math.PI / 2;
boden.renderOrder = -1;
szene.add(boden);

const el = (id) => document.getElementById(id);
const lade = el('lade');
const status = el('status');
let hase = null;
let groesseMB = null;

function statusZeigen() {
  if (!hase) return;
  const laufend = hase.laufendeAnimationen().map((n) => NAMEN[n] ?? n);
  let text;
  if (hase.pausiert) text = 'Pausiert – die Kamera lässt sich weiter drehen.';
  else if (hase.aktiverModus === 'ruhe') text = 'Der Hase sitzt still (Ruhepose).';
  else if (hase.aktiverModus === 'lebendig') text = `Lebendig – gerade: ${laufend.join(', ') || 'Atmen'}`;
  else text = `Läuft: ${laufend.join(', ') || NAMEN[hase.aktiverModus]}`;
  if (status.textContent !== text) status.textContent = text;
}

function wahlGruppe(container, attribut, beiWahl) {
  container.addEventListener('click', (e) => {
    const knopf = e.target.closest(`button[${attribut}]`);
    if (!knopf) return;
    for (const b of container.querySelectorAll('button')) b.setAttribute('aria-checked', String(b === knopf));
    beiWahl(knopf.getAttribute(attribut));
  });
}

function modusSetzen(name) {
  if (!hase) return;
  hase.modus(name);
  for (const b of el('animationen').querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.modus === name));
  statusZeigen();
}

wahlGruppe(el('animationen'), 'data-modus', modusSetzen);
wahlGruppe(el('darstellung'), 'data-art', (art) => hase?.darstellung(art));
el('ansichten').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-ansicht]');
  if (b) ansicht(b.dataset.ansicht);
});
el('pause').addEventListener('click', () => {
  if (!hase) return;
  hase.pause(!hase.pausiert);
  el('pause').setAttribute('aria-pressed', String(hase.pausiert));
  el('pause').textContent = hase.pausiert ? 'Weiter' : 'Pause';
  statusZeigen();
});
el('kreisen').addEventListener('change', (e) => (steuerung.autoRotate = e.target.checked));
el('boden').addEventListener('change', (e) => (boden.visible = e.target.checked));
el('kontur').addEventListener('change', (e) => hase?.kontur(e.target.checked));

function groesseAnpassen() {
  const { clientWidth: b, clientHeight: h } = leinwand;
  if (leinwand.width !== Math.round(b * renderer.getPixelRatio()) || leinwand.height !== Math.round(h * renderer.getPixelRatio())) {
    renderer.setSize(b, h, false);
    kamera.aspect = b / h;
    kamera.updateProjectionMatrix();
  }
}

const uhr = new THREE.Timer();
uhr.connect(document);
let bilder = 0;
let statusZeit = 0;
renderer.setAnimationLoop((zeit) => {
  uhr.update(zeit);
  const dt = Math.min(uhr.getDelta(), 0.1);
  groesseAnpassen();
  steuerung.update(dt);
  if (hase) hase.aktualisieren(dt, kamera);
  renderer.render(szene, kamera);
  bilder++;
  statusZeit += dt;
  if (statusZeit > 0.4) {
    statusZeit = 0;
    statusZeigen();
  }
});

try {
  hase = await (MODELLWAHL === 'posen' ? PosenHase : HaseA).laden(MODELL, {
    fortschritt: (e) => {
      if (e.total) {
        groesseMB = e.total / 1e6;
        lade.textContent = `Hase A wird geladen … ${Math.round((e.loaded / e.total) * 100)} %`;
      }
    },
  });
  szene.add(hase.objekt);
  lade.hidden = true;
  const s = hase.statistik;
  el('daten').textContent = `Modell: ${s.dreiecke.toLocaleString('de-DE')} Dreiecke · ${s.knochen} Knochen · ${s.animationen.length} Animationen`
    + (groesseMB ? ` · ${groesseMB.toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB` : '');
  modusSetzen(ruhigeBewegung ? 'ruhe' : 'lebendig');
  document.documentElement.dataset.bereit = '1';
} catch (fehler) {
  console.error(fehler);
  lade.classList.add('fehler');
  lade.textContent = location.protocol === 'file:'
    ? 'Die Seite muss über einen kleinen Webserver laufen. Bitte „start-viewer.bat“ im Ordner hase-a-3d doppelklicken.'
    : `Das Modell konnte nicht geladen werden (${fehler.message}).`;
  document.documentElement.dataset.bereit = 'fehler';
}

// Kleine Prüfschnittstelle für automatische Tests (web/test/pruefen.mjs)
window.__hase = {
  modus: modusSetzen,
  ansicht,
  pause: (an) => hase?.pause(an),
  darstellung: (art) => hase?.darstellung(art),
  kontur: (an) => hase?.kontur(an),
  laufend: () => hase?.laufendeAnimationen() ?? [],
  statistik: () => hase?.statistik,
  bilder: () => bilder,
  hase: () => hase,
  lage: () => (hase ? [hase.objekt.position.x, hase.objekt.position.z, hase.objekt.rotation.y] : null),
  kamera: () => ({ abstand: kamera.position.distanceTo(steuerung.target), lage: kamera.position.toArray() }),
  knochen: (name) => {
    const k = hase?.objekt.getObjectByName(name);
    return k ? [...k.quaternion.toArray(), ...k.scale.toArray(), ...k.position.toArray()] : null;
  },
};
