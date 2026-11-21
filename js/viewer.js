// Visores 3D de la Patasola (Three.js + FBXLoader + OrbitControls).
// Cada elemento con [data-viewer] crea su propio visor con la configuración de data.js.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VIEWERS, TEXTURE_DIR, FPS, REFERENCE_PAIR } from './data.js';

// ---------- Carga compartida ----------
const manager = new THREE.LoadingManager();
// Si alguna textura apunta a la carpeta original de Maya, se redirige a la carpeta .fbm local.
manager.setURLModifier((url) => {
  if (/\.(jpe?g|png|tga)$/i.test(url) && !/^(blob|data):/.test(url)) {
    return TEXTURE_DIR + encodeURIComponent(decodeURIComponent(url.split(/[\\/]/).pop()));
  }
  return url;
});
const loader = new FBXLoader(manager);
const buffers = new Map(); // url -> Promise<ArrayBuffer>
const clipSources = new Map(); // url -> Promise<Group> (para leer animaciones)

function fetchBuffer(url, onProgress) {
  if (!buffers.has(url)) {
    const p = (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(encodeURI(url));
          if (!res.ok) throw new Error(res.status + ' ' + url);
          const total = +res.headers.get('Content-Length') || 0;
          if (!res.body || !total) return await res.arrayBuffer();
          const reader = res.body.getReader();
          const out = new Uint8Array(total);
          let got = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            out.set(value, got);
            got += value.length;
            onProgress?.(got / total);
          }
          return out.buffer;
        } catch (err) {
          if (attempt === 2) throw err;
        }
      }
    })();
    p.catch(() => buffers.delete(url));
    buffers.set(url, p);
  }
  return buffers.get(url);
}

const parseFBX = async (url, onProgress) => loader.parse(await fetchBuffer(url, onProgress), '');

function clipSource(url, onProgress) {
  if (!clipSources.has(url)) {
    const p = parseFBX(url, onProgress);
    p.catch(() => clipSources.delete(url));
    clipSources.set(url, p);
  }
  return clipSources.get(url);
}

const boneKey = (name) => (name.match(/Patasola_Proxy_\w+$/) || [null])[0];

// Desplazamiento de cadera entre proxy y modelo final, medido con el par Idle B / Ask for help.
let hipOffsetPromise = null;
function getHipOffset() {
  if (!hipOffsetPromise) {
    hipOffsetPromise = Promise.all([clipSource(REFERENCE_PAIR.proxy), clipSource(REFERENCE_PAIR.final)]).then(([p, f]) => {
      const hips = (g) => g.animations[0].tracks.find((t) => /Patasola_Proxy_Hips\.position$/.test(t.name));
      const a = hips(p), b = hips(f);
      const off = new THREE.Vector3();
      if (!a || !b) return off;
      const ia = a.createInterpolant(), ib = b.createInterpolant();
      const n = 5;
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        const pa = ia.evaluate(a.times[0] + (a.times.at(-1) - a.times[0]) * u);
        const pb = ib.evaluate(b.times[0] + (b.times.at(-1) - b.times[0]) * u);
        off.x += (pb[0] - pa[0]) / n;
        off.y += (pb[1] - pa[1]) / n;
        off.z += (pb[2] - pa[2]) / n;
      }
      return off;
    });
  }
  return hipOffsetPromise;
}

// Lleva un clip del proxy al modelo final: mismo esqueleto, solo cambia el namespace
// y la posición de la cadera.
function proxyToFinal(clip, dstRoot, hipOffset) {
  const dst = {};
  dstRoot.traverse((o) => { const k = boneKey(o.name); if (k && o.isBone) dst[k] = o; });
  const tracks = [];
  for (const t of clip.tracks) {
    const dot = t.name.lastIndexOf('.');
    const key = boneKey(t.name.slice(0, dot));
    const prop = t.name.slice(dot + 1);
    if (!key || !dst[key]) continue;
    if (prop === 'quaternion') {
      tracks.push(new THREE.QuaternionKeyframeTrack(dst[key].name + '.quaternion', t.times, t.values.slice()));
    } else if (prop === 'position' && key === 'Patasola_Proxy_Hips') {
      const v = new Float32Array(t.values.length);
      for (let i = 0; i < v.length; i += 3) {
        v[i] = t.values[i] + hipOffset.x;
        v[i + 1] = t.values[i + 1] + hipOffset.y;
        v[i + 2] = t.values[i + 2] + hipOffset.z;
      }
      tracks.push(new THREE.VectorKeyframeTrack(dst[key].name + '.position', t.times, v));
    }
  }
  return new THREE.AnimationClip(clip.name, -1, tracks);
}

// Los FBX traen el rango de frames de Maya: se desplaza para que cada clip empiece en 0.
function normalizeClip(clip, name) {
  let min = Infinity;
  for (const t of clip.tracks) if (t.times.length) min = Math.min(min, t.times[0]);
  const tracks = clip.tracks.map((t) => {
    const c = t.clone();
    for (let i = 0; i < c.times.length; i++) c.times[i] -= min;
    return c;
  });
  const out = new THREE.AnimationClip(name, -1, tracks);
  out.resetDuration();
  return out;
}

// ---------- Visor ----------
function createViewer(el, models) {
  const $ = (s) => el.querySelector(s);
  const canvasWrap = $('.viewer-canvas');
  const loading = $('.viewer-loading');
  const loadingText = $('.viewer-loading-text');
  const modelTabs = $('.viewer-models');
  const clipList = $('.viewer-clips');
  const infoText = $('.viewer-info');
  const playBtn = $('[data-action="play"]');
  const scrub = $('.viewer-scrub');
  const frameLabel = $('.viewer-frame');
  const speedSel = $('.viewer-speed');
  const opts = { distance: parseFloat(el.dataset.distance) || 3.4 };

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  canvasWrap.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 0.6;
  controls.maxDistance = 10;
  controls.maxPolarAngle = Math.PI * 0.55;

  // Suelo: un claro de bosque con la sombra del personaje
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(1.6, 64),
    new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.35 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.88, 0.92, 64),
    new THREE.MeshBasicMaterial({ color: 0xf2c95e, transparent: true, opacity: 0.55 })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.003;
  scene.add(ring);

  const lights = {
    estudio: makeLights([
      ['hemi', 0xfff4dc, 0x2b2118, 1.3],
      ['dir', 0xffffff, 2.2, [3, 5, 4], true],
      ['dir', 0xf2c95e, 0.9, [-4, 2, -3]],
    ]),
    noche: makeLights([
      ['hemi', 0x3a4a80, 0x0b0f1a, 0.55],
      ['dir', 0xc2552b, 2.6, [-2, 1.2, -3], true],
      ['dir', 0x9fb0ff, 0.9, [3, 4, 2]],
    ]),
    plana: makeLights([['amb', 0xffffff, 2.4]]),
  };
  function makeLights(defs) {
    const g = new THREE.Group();
    for (const [type, a, b, c, shadow] of defs) {
      let l;
      if (type === 'hemi') l = new THREE.HemisphereLight(a, b, c);
      else if (type === 'amb') l = new THREE.AmbientLight(a, b);
      else {
        l = new THREE.DirectionalLight(a, b);
        l.position.set(...c);
        if (shadow) {
          l.castShadow = true;
          l.shadow.mapSize.set(1024, 1024);
          Object.assign(l.shadow.camera, { left: -2, right: 2, top: 3, bottom: -1 });
          l.shadow.bias = -0.0005;
        }
      }
      g.add(l);
    }
    return g;
  }
  let lightMode = 'estudio';
  scene.add(lights[lightMode]);

  const state = { model: null, obj: null, mixer: null, action: null, skeleton: null, wire: false, playing: true, token: 0 };
  const bases = new Map();
  const clips = new Map();

  const setProgress = (name) => (f) => { loadingText.textContent = `Cargando ${name} · ${Math.round(f * 100)}%`; };

  async function getBase(model) {
    if (bases.has(model.id)) return bases.get(model.id);
    const obj = await parseFBX(model.base, setProgress('modelo'));
    obj.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.frustumCulled = false;
      for (const m of [].concat(o.material)) {
        if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
        if ('shininess' in m) m.shininess = Math.min(m.shininess ?? 10, 12);
      }
    });
    // Tamaño uniforme (~1.9 de alto), centrado y apoyado en el suelo.
    const wrapper = new THREE.Group();
    wrapper.add(obj);
    const box = new THREE.Box3().setFromObject(obj);
    obj.scale.multiplyScalar(1.9 / (box.max.y - box.min.y || 1));
    const box2 = new THREE.Box3().setFromObject(obj);
    const c = box2.getCenter(new THREE.Vector3());
    obj.position.set(obj.position.x - c.x, obj.position.y - box2.min.y, obj.position.z - c.z);
    const entry = { wrapper, obj, mixer: new THREE.AnimationMixer(obj), skeleton: new THREE.SkeletonHelper(obj) };
    entry.skeleton.visible = false;
    bases.set(model.id, entry);
    return entry;
  }

  async function getClip(model, def, base) {
    const key = model.id + ':' + def.id;
    if (clips.has(key)) return clips.get(key);
    const src = await clipSource(def.file, setProgress('animación'));
    if (!src.animations.length) throw new Error('Sin animación: ' + def.file);
    let clip = src.animations[0];
    if (def.fromProxy) clip = proxyToFinal(clip, base.obj, await getHipOffset());
    clip = normalizeClip(clip, def.name);
    clips.set(key, clip);
    return clip;
  }

  if (modelTabs) {
    for (const m of models) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab';
      b.textContent = m.name;
      b.addEventListener('click', () => selectModel(m));
      m._btn = b;
      modelTabs.appendChild(b);
    }
  }

  async function selectModel(model) {
    const token = ++state.token;
    models.forEach((m) => m._btn?.setAttribute('aria-pressed', String(m === model)));
    showLoading('Cargando modelo…');
    try {
      const base = await getBase(model);
      if (token !== state.token) return;
      if (state.wrapper) scene.remove(state.wrapper, state.skeleton);
      Object.assign(state, { model, wrapper: base.wrapper, obj: base.obj, mixer: base.mixer, skeleton: base.skeleton, action: null });
      state.skeleton.visible = !!$('[data-toggle="skeleton"]')?.checked;
      scene.add(base.wrapper, base.skeleton);
      applyWire();
      if (infoText) infoText.textContent = model.info || '';
      buildClipList(model);
      frameCamera();
      await selectClip(model, model.clips[0]);
    } catch (err) {
      console.error(err);
      showLoading('No se pudo cargar el modelo. Abre la página con un servidor local (node servidor.js).', true);
    }
  }

  function buildClipList(model) {
    if (!clipList) return;
    clipList.innerHTML = '';
    for (const c of model.clips) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'clip';
      b.textContent = c.name;
      b.addEventListener('click', () => selectClip(model, c));
      c._btns = (c._btns || new Map()).set(el, b);
      clipList.appendChild(b);
    }
  }

  async function selectClip(model, def) {
    const token = ++state.token;
    model.clips.forEach((c) => c._btns?.get(el)?.setAttribute('aria-pressed', String(c === def)));
    showLoading('Cargando animación…');
    try {
      const base = await getBase(model);
      const clip = await getClip(model, def, base);
      if (token !== state.token) return;
      const next = state.mixer.clipAction(clip);
      next.reset().setLoop(THREE.LoopRepeat, Infinity);
      if (state.action && state.action !== next) {
        next.play();
        state.action.crossFadeTo(next, 0.3, false);
      } else {
        state.mixer.stopAllAction();
        next.play();
      }
      next.paused = !state.playing;
      state.action = next;
      if (scrub) scrub.max = clip.duration;
      hideLoading();
    } catch (err) {
      console.error(err);
      showLoading('No se pudo cargar la animación.', true);
    }
  }

  function showLoading(text, isError = false) {
    loading.hidden = false;
    loading.classList.toggle('is-error', isError);
    loadingText.textContent = text;
  }
  const hideLoading = () => { loading.hidden = true; };

  function frameCamera() {
    controls.target.set(0, 0.95, 0);
    const d = opts.distance;
    camera.position.set(d * 0.55, 1.3, d);
    controls.update();
  }

  function applyWire() {
    state.obj?.traverse((o) => {
      if (o.isMesh) for (const m of [].concat(o.material)) m.wireframe = state.wire;
    });
  }

  playBtn?.addEventListener('click', () => {
    state.playing = !state.playing;
    if (state.action) state.action.paused = !state.playing;
    playBtn.textContent = state.playing ? 'Pausa' : 'Play';
  });
  scrub?.addEventListener('input', () => {
    if (!state.action) return;
    state.playing = false;
    state.action.paused = true;
    if (playBtn) playBtn.textContent = 'Play';
    state.action.time = parseFloat(scrub.value);
    state.mixer.update(0);
  });
  speedSel?.addEventListener('change', () => {
    for (const { mixer } of bases.values()) mixer.timeScale = parseFloat(speedSel.value);
  });
  $('[data-toggle="wire"]')?.addEventListener('change', (e) => { state.wire = e.target.checked; applyWire(); });
  $('[data-toggle="skeleton"]')?.addEventListener('change', (e) => { if (state.skeleton) state.skeleton.visible = e.target.checked; });
  $('.viewer-lights')?.addEventListener('change', (e) => {
    scene.remove(lights[lightMode]);
    lightMode = e.target.value;
    scene.add(lights[lightMode]);
    el.dataset.light = lightMode;
  });
  $('[data-action="reset"]')?.addEventListener('click', frameCamera);

  const clock = new THREE.Clock();
  function resize() {
    const w = canvasWrap.clientWidth, h = canvasWrap.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvasWrap);
  resize();

  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvasWrap);

  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    if (!visible) return;
    state.mixer?.update(dt);
    if (state.action) {
      const dur = state.action.getClip().duration;
      const t = state.action.time % dur;
      if (state.playing && scrub) scrub.value = t;
      if (frameLabel) frameLabel.textContent = `${Math.round(t * FPS) + 1} / ${Math.round(dur * FPS) + 1}`;
    }
    controls.update();
    renderer.render(scene, camera);
  });

  frameCamera();
  selectModel(models[0]);
  return { state };
}

// Cada visor arranca cuando se acerca a la pantalla.
document.querySelectorAll('[data-viewer]').forEach((el) => {
  const models = VIEWERS[el.dataset.viewer];
  if (!models) return;
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    el.__viewer = createViewer(el, models);
  }, { rootMargin: '400px' });
  io.observe(el);
});
