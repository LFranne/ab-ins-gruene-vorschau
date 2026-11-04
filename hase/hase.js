// Hase A als wiederverwendbarer Baustein: lädt das GLB, setzt das Aquarell-Material
// und steuert die Animationen. Der Viewer (main.js) und später die Webseite nutzen
// nur diese Schnittstelle:
//
//   const hase = await HaseA.laden(url);
//   szene.add(hase.objekt);
//   hase.modus('lebendig');          // oder 'atmen', 'blinzeln', 'ohren', 'kopf', 'schnuppern', 'ruhe'
//   hase.pause(true|false);
//   hase.aktualisieren(dt, kamera);  // einmal je Bild
//
// Alle bisherigen Animationen sind "Überlagerungen": sie bewegen nur einzelne Knochen
// und werden additiv übereinandergelegt. Spätere Ganzkörper-Animationen (hoppeln,
// hinsetzen ...) laufen als Basis darunter, siehe README.md.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const UEBERLAGERUNGEN = ['atmen', 'blinzeln', 'ohren', 'kopf', 'schnuppern', 'umsehen', 'aufmerken', 'gewicht', 'hoppeln'];

const VERTEX = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
uniform float konturBreite;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec2 vUv;
void main() {
  #include <skinbase_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec3 nW = normalize(mat3(modelMatrix) * objectNormal);
  vec4 wPos = modelMatrix * vec4(transformed, 1.0);
  // Kontur: Rückseiten leicht nach außen schieben, Breite wächst mit dem Abstand (wirkt gleich dick)
  wPos.xyz += nW * konturBreite * length(cameraPosition - wPos.xyz);
  vPosW = wPos.xyz;
  vNormalW = nW;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wPos;
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform vec3 lichtRichtung;
uniform vec3 schattenFarbe;
uniform vec3 randFarbe;
uniform float darstellung;   // 0 Aquarell, 1 nur Farben, 2 Form (Ton)
uniform float papierKorn;
uniform float istKontur;
uniform float deckkraft;   // 1 = voll sichtbar; nur die Überblendung der Posenfolge nutzt weniger
uniform vec3 konturFarbe;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rausch(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + 1.0), f.x), f.y);
}

void main() {
  if (istKontur > 0.5) {
    if (rausch(vUv * 160.0) < 0.28) discard;   // Kontur bricht ab und zu ab wie ein Pinselstrich
    gl_FragColor = vec4(konturFarbe, 1.0);
    #include <colorspace_fragment>
    return;
  }
  vec3 albedo = texture2D(map, vUv).rgb;
  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;   // Meshy-Netz hat vereinzelt nach innen zeigende Flächen
  vec3 V = normalize(cameraPosition - vPosW);
  float ndl = dot(N, lichtRichtung);
  float hell = dot(albedo, vec3(0.299, 0.587, 0.114));
  vec3 farbe;
  if (darstellung > 1.5) {
    vec3 ton = vec3(0.50, 0.38, 0.28);
    farbe = ton * (0.30 + 0.70 * max(ndl, 0.0)) + ton * 0.25 * (N.y * 0.5 + 0.5);
  } else if (darstellung > 0.5) {
    farbe = albedo;
  } else {
    // Schattengrenze wird von den Fellstrichen gebrochen, statt glatt zu verlaufen
    float kante = ndl + (hell - 0.3) * 0.45 + (rausch(vUv * 90.0) - 0.5) * 0.14;
    float licht = smoothstep(-0.14, 0.26, kante);
    farbe = mix(albedo * schattenFarbe, albedo, licht);
    farbe *= 1.0 - 0.08 * (1.0 - abs(licht * 2.0 - 1.0));      // Pigment sammelt sich an der Kante
    farbe *= mix(0.93, 1.04, N.y * 0.5 + 0.5);                  // Himmelslicht von oben
    float rand = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.2);    // Lasur trocknet am Rand dunkler
    farbe = mix(farbe, farbe * randFarbe, rand * 0.8);
  }
  // Papierkorn, fest im Bild und sehr dezent
  float korn = rausch(gl_FragCoord.xy * 0.45) * 0.6 + rausch(gl_FragCoord.xy * 1.7) * 0.4;
  farbe *= 1.0 - papierKorn * (korn - 0.5);
  gl_FragColor = vec4(farbe, deckkraft);
  #include <colorspace_fragment>
}`;

export function aquarellMaterial(map, gemeinsam, kontur = false) {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: kontur ? THREE.BackSide : THREE.DoubleSide,
    uniforms: {
      ...gemeinsam,
      map: { value: map },
      konturBreite: kontur ? gemeinsam.konturBreite : { value: 0 },
      istKontur: { value: kontur ? 1 : 0 },
      deckkraft: { value: 1 },
    },
  });
}

// Spuren, die sich nie ändern, stören beim Überlagern und werden entfernt
function ruhendeSpurenEntfernen(clip) {
  clip.tracks = clip.tracks.filter((spur) => {
    const n = spur.getValueSize();
    const v = spur.values;
    for (let i = n; i < v.length; i++) if (Math.abs(v[i] - v[i % n]) > 1e-5) return true;
    return false;
  });
  return clip;
}

// Hoppser: Sekunden im 40-Bilder-Takt (30 Bilder/s), Weg in Metern
const HOPP = { start: 8 / 30, ende: 24 / 30, dauer: 40 / 30, weg: 0.11 };
// Stehender Hase (80 Bilder): Abdruck bei Bild 20, Landung bei Bild 38
const HOPP_STEHEND = { start: 20 / 30, ende: 38 / 30, dauer: 80 / 30, weg: 0.15 };
// Spielefigur (Plan 019, 45 Bilder, Clip dauert 1,5 s): Abstoß bei Bild 12, Landung bei Bild 29
const HOPP_SPIEL = { start: 12 / 30, ende: 29 / 30, dauer: 45 / 30, weg: 0.42 };
const hoppParameter = (clip) => (clip.duration > 2 ? HOPP_STEHEND : clip.duration > 1.3 ? HOPP_SPIEL : HOPP);

const zufall = (a, b) => a + Math.random() * (b - a);

// "Lebendig": Atmen läuft immer, alles andere in unregelmäßigen Abständen
class Verhalten {
  constructor(hase) {
    this.hase = hase;
    this.uhren = {};
  }
  start() {
    const h = this.hase;
    h.schleife('atmen');
    this.uhren = { blinzeln: zufall(0.8, 3), ohren: zufall(0.5, 2), kopf: zufall(2.5, 5), schnuppern: zufall(6, 10), umsehen: zufall(9, 14), aufmerken: zufall(14, 22), gewicht: zufall(5, 9), hoppeln: zufall(16, 26) };
  }
  aktualisieren(dt) {
    const h = this.hase;
    for (const name of Object.keys(this.uhren)) {
      this.uhren[name] -= dt;
      if (this.uhren[name] > 0) continue;
      const laeuft = (n) => h.aktionen.get(n)?.isRunning();
      if (name === 'blinzeln') {
        h.einmal('blinzeln');
        // manchmal ein doppeltes Blinzeln
        this.uhren.blinzeln = Math.random() < 0.2 ? 0.9 : zufall(2.2, 7);
      } else if (name === 'ohren') {
        if (!laeuft('ohren')) h.einmal('ohren', zufall(0.8, 1.15));
        this.uhren.ohren = zufall(4, 8);
      } else if (name === 'kopf') {
        if (!laeuft('schnuppern')) h.einmal('kopf', zufall(0.85, 1.1));
        this.uhren.kopf = zufall(6, 11);
      } else if (name === 'schnuppern') {
        if (!laeuft('kopf')) h.einmal('schnuppern');
        this.uhren.schnuppern = zufall(8, 14);
      } else if (name === 'umsehen') {
        if (!laeuft('kopf') && !laeuft('schnuppern') && !laeuft('aufmerken')) h.einmal('umsehen', zufall(0.9, 1.1));
        this.uhren.umsehen = zufall(14, 24);
      } else if (name === 'aufmerken') {
        if (!laeuft('umsehen') && !laeuft('kopf') && !laeuft('schnuppern')) h.einmal('aufmerken');
        this.uhren.aufmerken = zufall(18, 30);
      } else if (name === 'hoppeln') {
        const frei = !['hoppeln', 'umsehen', 'aufmerken', 'kopf', 'schnuppern', 'ohren'].some(laeuft);
        if (frei) h.hoppser();
        this.uhren.hoppeln = zufall(18, 32);
      } else if (name === 'gewicht') {
        if (!laeuft('gewicht')) h.einmal('gewicht', zufall(0.9, 1.2));
        this.uhren.gewicht = zufall(10, 18);
      }
    }
  }
}

export class HaseA {
  static async laden(url, optionen = {}) {
    const gltf = await new GLTFLoader().loadAsync(url, optionen.fortschritt);
    return new HaseA(gltf);
  }

  constructor(gltf) {
    this.objekt = gltf.scene;
    this.objekt.name = 'HaseA';
    this.mixer = new THREE.AnimationMixer(this.objekt);
    this.aktionen = new Map();
    this.pausiert = false;
    this.aktiverModus = 'ruhe';
    this.verhalten = new Verhalten(this);
    this.einzelUhr = null;
    this.hopp = null;        // laufender Hoppser (Wurzelbewegung)
    this.hoppelUhr = null;
    this.yawZiel = 0;

    this.uniforms = {
      lichtRichtung: { value: new THREE.Vector3(-0.4, 0.75, 0.55).normalize() },
      schattenFarbe: { value: new THREE.Color(0.56, 0.5, 0.64) },
      randFarbe: { value: new THREE.Color(0.6, 0.52, 0.47) },
      darstellung: { value: 0 },
      papierKorn: { value: 0.06 },
      konturFarbe: { value: new THREE.Color(0.2, 0.15, 0.12) },
      konturBreite: { value: 0.0016 },
    };

    this.netze = [];
    this.konturen = [];
    this.objekt.traverse((o) => {
      if (o.isSkinnedMesh) this.netze.push(o);
      if (o.isBone) o.userData.ruhe = o.quaternion.clone();
    });
    for (const netz of this.netze) {
      netz.frustumCulled = false;
      netz.material = aquarellMaterial(netz.material.map, this.uniforms);
      const kontur = new THREE.SkinnedMesh(netz.geometry, aquarellMaterial(netz.material.uniforms.map.value, this.uniforms, true));
      kontur.bind(netz.skeleton, netz.bindMatrix);
      kontur.frustumCulled = false;
      kontur.position.copy(netz.position);
      kontur.quaternion.copy(netz.quaternion);
      kontur.scale.copy(netz.scale);
      kontur.visible = false;
      netz.parent.add(kontur);
      this.konturen.push(kontur);
    }

    for (const clip of gltf.animations) {
      ruhendeSpurenEntfernen(clip);
      THREE.AnimationUtils.makeClipAdditive(clip);
      this.aktionen.set(clip.name, this.mixer.clipAction(clip));
    }
    this.statistik = this.#statistik();
  }

  #statistik() {
    let dreiecke = 0;
    for (const n of this.netze) dreiecke += (n.geometry.index ? n.geometry.index.count : n.geometry.attributes.position.count) / 3;
    return { dreiecke, knochen: this.netze[0]?.skeleton.bones.length ?? 0, animationen: [...this.aktionen.keys()] };
  }

  schleife(name, tempo = 1) {
    const a = this.aktionen.get(name);
    if (!a) return;
    a.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveTimeScale(tempo).setEffectiveWeight(1).play();
  }

  einmal(name, tempo = 1) {
    const a = this.aktionen.get(name);
    if (!a) return;
    a.reset().setLoop(THREE.LoopOnce, 1).setEffectiveTimeScale(tempo).setEffectiveWeight(1);
    a.clampWhenFinished = false;
    a.play();
  }

  // Ein Hoppser: Die Animation bewegt nur Haltung und Höhe, die Figur schiebt dieser Code nach vorn.
  // Entfernt sie sich zu weit von der Mitte, dreht sie sich vorher zurück.
  hoppser() {
    const a = this.aktionen.get('hoppeln');
    if (!a || this.hopp) return;
    const p = this.objekt.position;
    const weit = Math.hypot(p.x, p.z) > (a.getClip().duration > 2 ? 0.28 : a.getClip().duration > 1.3 ? 0.35 : 0.22);
    this.yawZiel = weit ? Math.atan2(-p.x, -p.z) : this.objekt.rotation.y + (Math.random() - 0.5) * 0.9;
    this.einmal('hoppeln');
    const par = hoppParameter(a.getClip());
    this.hopp = { t: 0, gesamt: par.weg, getan: 0, par };
  }

  modus(name) {
    this.mixer.stopAllAction();
    this.aktiverModus = name;
    this.einzelUhr = null;
    this.hoppelUhr = null;
    this.hopp = null;
    this.objekt.position.x = this.objekt.position.z = 0;   // Wechsel des Modus: zurück in die Mitte
    this.objekt.rotation.y = this.yawZiel = 0;
    if (name === 'lebendig') this.verhalten.start();
    else if (name === 'hoppeln') this.hoppelUhr = 0.4;
    else if (name === 'blinzeln') this.einzelUhr = 0.3;   // Blinzeln allein: alle 2,4 s
    else if (this.aktionen.has(name)) this.schleife(name);
  }

  pause(an) {
    this.pausiert = an;
  }

  darstellung(art) {
    this.uniforms.darstellung.value = { aquarell: 0, farben: 1, form: 2 }[art] ?? 0;
  }

  kontur(an) {
    for (const k of this.konturen) k.visible = an;
  }

  // Licht kommt immer von links oben aus Sicht der Kamera: die Malweise bleibt beim Drehen gleich
  aktualisieren(dt, kamera) {
    if (kamera) this.uniforms.lichtRichtung.value.set(-0.45, 0.7, 0.55).normalize().applyQuaternion(kamera.quaternion);
    if (this.pausiert) return;
    if (this.aktiverModus === 'lebendig') this.verhalten.aktualisieren(dt);
    if (this.einzelUhr !== null) {
      this.einzelUhr -= dt;
      if (this.einzelUhr <= 0) {
        this.einmal('blinzeln');
        this.einzelUhr = 2.4;
      }
    }
    if (this.hoppelUhr !== null && !this.hopp) {
      this.hoppelUhr -= dt;
      if (this.hoppelUhr <= 0) {
        this.hoppser();
        this.hoppelUhr = 2.2 + Math.random() * 2.2;
      }
    }
    this.#wurzel(dt);
    this.mixer.update(dt);
  }

  #wurzel(dt) {
    // Drehen immer sanft zum Ziel (kürzester Weg)
    const o = this.objekt;
    let d = this.yawZiel - o.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    o.rotation.y += d * Math.min(1, dt * 5);
    if (!this.hopp) return;
    const h = this.hopp;
    h.t += dt;
    // Vorwärtsweg nur zwischen Abdruck und Landung, weich ein- und ausgeblendet
    const x = THREE.MathUtils.clamp((h.t - h.par.start) / (h.par.ende - h.par.start), 0, 1);
    const soll = h.gesamt * (x * x * (3 - 2 * x));
    const schritt = soll - h.getan;
    h.getan = soll;
    o.position.x += Math.sin(o.rotation.y) * schritt;
    o.position.z += Math.cos(o.rotation.y) * schritt;
    if (h.t > h.par.dauer) this.hopp = null;
  }

  laufendeAnimationen() {
    return [...this.aktionen].filter(([, a]) => a.isRunning()).map(([n]) => n);
  }
}
