// Hase A als Posenfolge (Plan 018, Weg B): mehrere starre Posenmodelle (pose_01 ... ), die nacheinander
// sichtbar werden und kurz überblendet sind. Gleiche Schnittstelle wie HaseA (hase.js), damit der Viewer
// beide gleich behandeln kann.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { aquarellMaterial } from './hase.js';

// Ein Hoppser: Zeit in Sekunden -> Pose (Nummer ab 1). Die Posen sind auf gleiche Größe und Bodenlage gebracht.
// Ruhepose: normales Sitzen mit allen Pfoten am Boden (Meshy t02); pose 1 hat die Vorderpfoten angehoben
const RUHE = 18;
// weg = Lage des Schwerpunkts nach vorn in Metern. Aus dem Bodenkontakt der Posen abgelesen: beim Ducken und Abstoßen
// bleiben die Hinterfüße am Platz (der Körper schiebt sich vor), in der Luft geht es weiter, nach der Landung ruht er.
const FOLGE = [
  { t: 0.00, pose: RUHE, weg: 0 },   // sitzt
  { t: 0.30, pose: 13, weg: 0 },     // sammelt sich (Meshy t06)
  { t: 0.42, pose: 12, weg: 0 },     // duckt sich tief (Meshy t05)
  { t: 0.52, pose: 14, weg: 0.15 },  // Abstoß, Vorderläufe vor (Meshy t07)
  { t: 0.60, pose: 3, weg: 0.17 },   // Abstoß
  { t: 0.68, pose: 7, weg: 0.24 },   // Zwischenpose aus dem Skelett
  { t: 0.76, pose: 4, weg: 0.32 },   // gestreckt
  { t: 0.84, pose: 8, weg: 0.38 },
  { t: 0.92, pose: 5, weg: 0.44 },   // Flug
  { t: 1.00, pose: 9, weg: 0.49 },
  { t: 1.08, pose: 6, weg: 0.53 },   // Landung
  { t: 1.16, pose: 16, weg: 0.56 },  // Hinterläufe schwingen vor, flach (Meshy t14)
  { t: 1.24, pose: 17, weg: 0.60 },  // Hinterläufe unter dem Körper (Meshy t15)
  { t: 1.34, pose: 15, weg: 0.62 },  // landet gesammelt (Meshy t12)
  { t: 1.46, pose: 2, weg: 0.62 },   // gefedert
  { t: 1.78, pose: RUHE, weg: 0.62 },// wieder aufgerichtet
];
const DAUER = 2.1;
// Standard: harter Wechsel (Überblenden wirkte verschleiert); ?blende=0.04 schaltet eine kurze Überblendung zu
const UEBERBLENDEN = Number(new URLSearchParams(location.search).get('blende') ?? 0);

const glatt = (x) => x * x * (3 - 2 * x);

export class PosenHase {
  static async laden(url, optionen = {}) {
    // url: ein GLB oder eine Liste; die Netze weiterer GLBs kommen zur ersten Szene dazu
    const urls = [].concat(url);
    const lader = new GLTFLoader();
    const gltf = await lader.loadAsync(urls[0], optionen.fortschritt);
    for (const weitere of urls.slice(1)) {
      const g = await lader.loadAsync(weitere);
      for (const kind of [...g.scene.children]) gltf.scene.add(kind);
    }
    return new PosenHase(gltf);
  }

  constructor(gltf) {
    this.objekt = gltf.scene;
    this.objekt.name = 'HaseA';
    this.aktionen = new Map([['hoppeln', null]]);
    this.pausiert = false;
    this.aktiverModus = 'ruhe';
    this.yawZiel = 0;
    this.zeit = null;      // Zeit im laufenden Hoppser, sonst null
    this.warte = 0;
    this.uhr = 0;
    this.konturAn = false;
    this.start = new THREE.Vector3();

    this.uniforms = {
      lichtRichtung: { value: new THREE.Vector3(-0.4, 0.75, 0.55).normalize() },
      schattenFarbe: { value: new THREE.Color(0.56, 0.5, 0.64) },
      randFarbe: { value: new THREE.Color(0.6, 0.52, 0.47) },
      darstellung: { value: 0 },
      papierKorn: { value: 0.06 },
      konturFarbe: { value: new THREE.Color(0.2, 0.15, 0.12) },
      konturBreite: { value: 0.0016 },
    };

    this.posen = [];
    const netze = [];
    this.objekt.traverse((o) => { if (o.isMesh) netze.push(o); });
    netze.sort((a, b) => a.name.localeCompare(b.name));
    let dreiecke = 0;
    for (const netz of netze) {
      netz.frustumCulled = false;
      const karte = netz.material.map;
      netz.material = aquarellMaterial(karte, this.uniforms);
      netz.material.transparent = true;   // nur sichtbar, wenn deckkraft < 1; sonst voll deckend
      const kontur = new THREE.Mesh(netz.geometry, aquarellMaterial(karte, this.uniforms, true));
      kontur.frustumCulled = false;
      kontur.visible = false;
      netz.add(kontur);
      this.posen.push({ nr: Number(netz.name.replace(/\D/g, '')), netz, kontur, heben: netz.userData.heben ?? 0 });
      dreiecke += (netz.geometry.index ? netz.geometry.index.count : netz.geometry.attributes.position.count) / 3;
    }
    this.posenNr = new Map(this.posen.map((p) => [p.nr, p]));
    this.statistik = { dreiecke, knochen: 0, animationen: ['hoppeln'] };
    this.#zeigen(RUHE, null, 0);
  }

  // Pose a voll sichtbar; b blendet mit Anteil x darüber
  #zeigen(a, b, x) {
    this.posen.forEach((p) => {
      const nr = p.nr;
      const sichtbar = nr === a || nr === b;
      p.netz.visible = sichtbar;
      p.kontur.visible = sichtbar && this.konturAn;
      p.netz.material.uniforms.deckkraft.value = nr === b && b !== a ? x : 1;
      p.netz.material.depthTest = !(nr === b && b !== a);
      p.netz.renderOrder = nr === b && b !== a ? 2 : 0;
    });
  }

  // Zustand zur Zeit t im Hoppser: Posen, Überblendung, Höhe, Weg
  #stelle(t) {
    let i = FOLGE.length - 1;
    while (i > 0 && FOLGE[i].t > t) i--;
    const aktuell = FOLGE[i], naechste = FOLGE[i + 1];
    let a = aktuell.pose, b = null, x = 0;
    if (naechste && naechste.t - t < UEBERBLENDEN) { b = naechste.pose; x = glatt(1 - (naechste.t - t) / UEBERBLENDEN); }
    this.#zeigen(a, b, x);
    // Höhe sanft zwischen den Posen
    const h = (nr) => this.posenNr.get(nr)?.heben ?? 0;
    const ha = h(aktuell.pose), hb = naechste ? h(naechste.pose) : ha;
    const f = naechste ? glatt(THREE.MathUtils.clamp((t - aktuell.t) / (naechste.t - aktuell.t), 0, 1)) : 0;
    this.objekt.children.forEach((c) => (c.position.y = ha + (hb - ha) * f));
    // Weg ist je Pose festgelegt (Füße bleiben beim Abstoß am Platz), Richtung = Ziel der Drehung
    this.objekt.position.x = this.start.x + Math.sin(this.yawZiel) * aktuell.weg;
    this.objekt.position.z = this.start.z + Math.cos(this.yawZiel) * aktuell.weg;
  }

  hoppser() {
    if (this.zeit !== null) return;
    const p = this.objekt.position;
    const weit = Math.hypot(p.x, p.z) > 0.35;   // Hoppser sind 62 cm lang
    this.yawZiel = weit ? Math.atan2(-p.x, -p.z) : this.objekt.rotation.y + (Math.random() - 0.5) * 0.9;
    this.zeit = 0;
    this.start = p.clone();
  }

  modus(name) {
    this.aktiverModus = name;
    this.zeit = null;
    this.warte = 0.4;
    this.objekt.position.set(0, 0, 0);
    this.objekt.rotation.y = this.yawZiel = 0;
    this.objekt.children.forEach((c) => (c.position.y = 0));
    this.#zeigen(RUHE, null, 0);
  }

  pause(an) { this.pausiert = an; }
  darstellung(art) { this.uniforms.darstellung.value = { aquarell: 0, farben: 1, form: 2 }[art] ?? 0; }
  kontur(an) { this.konturAn = an; for (const p of this.posen) p.kontur.visible = an && p.netz.visible; }

  aktualisieren(dt, kamera) {
    if (kamera) this.uniforms.lichtRichtung.value.set(-0.45, 0.7, 0.55).normalize().applyQuaternion(kamera.quaternion);
    if (this.pausiert) return;
    this.uhr += dt;
    const o = this.objekt;
    let d = this.yawZiel - o.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    o.rotation.y += d * Math.min(1, dt * 5);
    if (this.zeit === null) {
      if (this.aktiverModus === 'hoppeln' || this.aktiverModus === 'lebendig') {
        this.warte -= dt;
        if (this.warte <= 0) { this.hoppser(); this.warte = 1.0 + Math.random() * 1.6; }
      }
      // im Sitzen ganz leicht atmen
      const atem = 1 + 0.004 * Math.sin(this.uhr * 2.2);
      this.posenNr.get(RUHE).netz.scale.set(1, atem, 1);
      return;
    }
    this.zeit += dt;
    this.#stelle(Math.min(this.zeit, DAUER));
    if (this.zeit >= DAUER) { this.zeit = null; this.#zeigen(RUHE, null, 0); }
  }

  laufendeAnimationen() { return this.zeit !== null ? ['hoppeln'] : []; }
}
