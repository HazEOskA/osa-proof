// OSA Knowledge World as a 3D solar system.
// Sun = Team Graph (source of truth). Each orbit = one node type. Each planet = one real osa-proof entity.
// Relations are drawn only on selection / causal path, so the scene stays readable.
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { Graph, GNode, NodeType } from "../lib/graph";
import { typeColor } from "../lib/graph";
import { tok } from "../lib/tok";
import { useOsa } from "../ctx";
import GraphCanvas from "./GraphCanvas";

interface Props {
  graph: Graph; selectedId?: string | null; onSelect?: (id: string | null) => void;
  highlight?: { nodes: Set<string>; edges: Set<string> } | null; hiddenTypes?: Set<string>;
  query?: string; interactive?: boolean; ambient?: boolean; className?: string; focusId?: string | null;
  sunLabel?: boolean;
}
export interface SolarApi { zoom: (f: number) => void; fit: () => void }

const ORDER: NodeType[] = ["AGENT", "MISSION", "EVIDENCE", "PROOF", "WORKSPACE", "POLICY", "SERVICE", "REPOSITORY", "CODE", "KNOWLEDGE", "MODEL", "TOOL", "MEMORY", "CLOUD", "USER"];
const LABEL_ALWAYS = new Set<NodeType>(["AGENT", "PROOF", "REPOSITORY"]);

const toColor = (s: string) => { const m = s.match(/[\d.]+/g) ?? ["127", "142", "166"]; return new THREE.Color().setRGB(+m[0] / 255, +m[1] / 255, +m[2] / 255, THREE.SRGBColorSpace); };

function glowTexture(stops: [number, string][]): THREE.CanvasTexture {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const g = c.getContext("2d")!; const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function ringTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d")!;
  g.strokeStyle = "white"; g.lineWidth = 10; g.beginPath(); g.arc(128, 128, 100, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 3; g.globalAlpha = 0.5; g.beginPath(); g.arc(128, 128, 120, 0, Math.PI * 2); g.stroke();
  return new THREE.CanvasTexture(c);
}

const SUN_VERT = `varying vec3 vPos; varying vec3 vNormal; varying vec3 vView;
void main(){ vPos = position; vNormal = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vView = -mv.xyz; gl_Position = projectionMatrix * mv; }`;
const SUN_FRAG = `uniform float uTime; uniform vec3 uHot; uniform vec3 uDeep; uniform vec3 uRim;
varying vec3 vPos; varying vec3 vNormal; varying vec3 vView;
float hash(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
 return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float v=0.0; float a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }
void main(){
  vec3 p = normalize(vPos);
  float n = fbm(p*2.6 + vec3(uTime*0.12, -uTime*0.07, uTime*0.05));
  float n2 = fbm(p*7.0 - vec3(uTime*0.25));
  float f = n*0.62 + n2*0.38;
  vec3 col = mix(uDeep, uHot, smoothstep(0.28, 0.72, f));
  col = mix(col, vec3(1.0), pow(smoothstep(0.45, 0.95, f), 2.0)*0.85);
  float rim = pow(1.0 - max(dot(normalize(vNormal), normalize(vView)), 0.0), 2.2);
  col += uRim * rim * 1.6;
  gl_FragColor = vec4(col * 1.35, 1.0);
}`;

interface Planet { node: GNode; obj: THREE.Object3D; mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; glow: THREE.Sprite; extra?: THREE.Mesh; R: number; phase: number; omega: number; world: THREE.Vector3; label?: HTMLDivElement; ring: number }

function webglOk() { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; } }

export default function SolarWorld(props: Props) {
  const { graph, interactive = true, ambient = false, className } = props;
  const { theme } = useOsa();
  const wrap = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const live = useRef(props); live.current = props;
  const api = useRef<{ dirty: () => void; select: (id: string | null) => void; zoom: (f: number) => void; fit: () => void } | null>(null);
  const [fallback] = useState(() => typeof window !== "undefined" && !webglOk());

  useEffect(() => {
    if (fallback) return;
    const el = wrap.current!, ov = overlay.current!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" }); } catch { return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.NoToneMapping;
    el.prepend(renderer.domElement);
    Object.assign(renderer.domElement.style, { position: "absolute", inset: "0", width: "100%", height: "100%", display: "block", touchAction: interactive ? "none" : "auto" });

    const scene = new THREE.Scene();
    scene.background = toColor(tok("void"));
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enabled = interactive; controls.enableDamping = true; controls.dampingFactor = 0.07;
    controls.minDistance = 5; controls.maxDistance = 220; controls.rotateSpeed = 0.6; controls.zoomSpeed = 0.8;
    controls.autoRotate = !reduce; controls.autoRotateSpeed = ambient ? 0.35 : 0.12;

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), ambient ? 0.95 : 0.8, 0.45, 0.62);
    composer.addPass(bloom); composer.addPass(new OutputPass());

    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const hot = toColor(tok("hero")), brand = toColor(tok("brand")), steel = toColor(tok("cyan"));
    const sunLight = new THREE.PointLight(hot.clone().lerp(new THREE.Color(1, 1, 1), 0.4), 2.4, 0, 0);
    scene.add(sunLight);

    // Stars
    const starGeo = new THREE.BufferGeometry(); const N = 2600; const sp = new Float32Array(N * 3); const sc = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = 260 + Math.random() * 400, s = Math.sqrt(1 - u * u);
      sp.set([Math.cos(th) * s * r, u * r, Math.sin(th) * s * r], i * 3);
      const c = Math.random() < 0.15 ? steel : new THREE.Color(1, 1, 1); const b = 0.2 + Math.random() * 0.4;
      sc.set([c.r * b, c.g * b, c.b * b], i * 3);
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3)); starGeo.setAttribute("color", new THREE.BufferAttribute(sc, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 1.3, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false }));
    scene.add(stars);

    // Sun = Team Graph node
    const sunNode = graph.byId.get("team") ?? graph.nodes.find((n) => n.type === "WORKSPACE") ?? graph.nodes[0];
    const SUN_R = 2.6;
    const sunMat = new THREE.ShaderMaterial({ vertexShader: SUN_VERT, fragmentShader: SUN_FRAG, uniforms: { uTime: { value: 0 }, uHot: { value: hot }, uDeep: { value: brand.clone().multiplyScalar(0.55) }, uRim: { value: hot.clone().lerp(brand, 0.35) } } });
    const sun = new THREE.Mesh(new THREE.SphereGeometry(SUN_R, 96, 96), sunMat); sun.userData.id = sunNode.id; scene.add(sun);
    const hs = `#${hot.getHexString()}`, bs = `#${brand.getHexString()}`;
    const corona = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture([[0, hs + "cc"], [0.2, hs + "66"], [0.45, bs + "22"], [1, bs + "00"]]), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    corona.scale.setScalar(SUN_R * 5.2); scene.add(corona);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture([[0, bs + "1c"], [0.5, bs + "08"], [1, bs + "00"]]), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    halo.scale.setScalar(SUN_R * 12); scene.add(halo);

    // Orbits + planets
    const types = ORDER.filter((t) => t !== undefined && graph.nodes.some((n) => n.type === t && n.id !== sunNode.id));
    const planets: Planet[] = []; const pivots: THREE.Group[] = []; const orbitLines: THREE.Line[] = [];
    const ringR = (i: number) => 6 + i * 3.3;
    const dotTex = glowTexture([[0, "#ffffffff"], [0.25, "#ffffffaa"], [1, "#ffffff00"]]);
    const orbitLabels: { el: HTMLDivElement; pivot: THREE.Group; R: number; a: number }[] = [];
    types.forEach((t, i) => {
      const R = ringR(i); const pivot = new THREE.Group();
      pivot.rotation.x = (i % 2 ? 1 : -1) * (0.04 + 0.022 * i); pivot.rotation.z = (i % 3 - 1) * 0.05;
      scene.add(pivot); pivots.push(pivot);
      const pts = new THREE.EllipseCurve(0, 0, R, R, 0, Math.PI * 2).getPoints(160).map((p) => new THREE.Vector3(p.x, 0, p.y));
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: toColor(tok("line2")), transparent: true, opacity: 0.38 }));
      line.userData.type = t; pivot.add(line); orbitLines.push(line);
      const members = graph.nodes.filter((n) => n.type === t && n.id !== sunNode.id);
      members.forEach((n, j) => {
        const color = toColor(typeColor(n));
        const size = 0.42 + n.r * 0.075;
        const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.22, roughness: 0.45, metalness: 0.15, transparent: true });
        const geo = n.type === "PROOF" || n.type === "EVIDENCE" ? new THREE.OctahedronGeometry(size * 1.15, 0) : n.type === "AGENT" ? new THREE.IcosahedronGeometry(size * 1.1, 0) : n.type === "CODE" || n.type === "POLICY" || n.type === "SERVICE" || n.type === "REPOSITORY" ? new THREE.BoxGeometry(size * 1.4, size * 1.4, size * 1.4) : new THREE.SphereGeometry(size, 32, 32);
        const mesh = new THREE.Mesh(geo, mat); mesh.userData.id = n.id;
        const obj = new THREE.Object3D(); obj.add(mesh); pivot.add(obj);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.22, depthWrite: false }));
        glow.scale.setScalar(size * 4); obj.add(glow);
        let extra: THREE.Mesh | undefined;
        if (n.type === "PROOF") {
          extra = new THREE.Mesh(new THREE.RingGeometry(size * 1.9, size * 2.8, 64), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
          extra.rotation.x = Math.PI / 2.4; obj.add(extra);
        }
        const phase = (j / members.length) * Math.PI * 2 + i * 0.9;
        const omega = 0.32 * Math.pow(6 / R, 1.5);
        planets.push({ node: n, obj, mesh, mat, glow, extra, R, phase, omega, world: new THREE.Vector3(), ring: i });
      });
      if (interactive) { const d = document.createElement("div"); d.className = "solar-orbit-label"; d.textContent = `${t} · ${members.length}`; ov.appendChild(d); orbitLabels.push({ el: d, pivot, R, a: Math.PI * 0.62 + i * 0.29 }); }
    });
    const outerR = ringR(Math.max(0, types.length - 1));
    const byId = new Map(planets.map((p) => [p.node.id, p]));
    const posOf = (id: string, out: THREE.Vector3) => { if (id === sunNode.id) return out.set(0, 0, 0); const p = byId.get(id); return p ? out.copy(p.world) : null; };

    // Labels
    if (interactive) for (const p of planets) { const d = document.createElement("div"); d.className = "solar-label"; d.textContent = p.node.label; ov.appendChild(d); p.label = d; }
    const sunLabel = document.createElement("div"); sunLabel.className = "solar-label solar-label--sun"; sunLabel.textContent = `TEAM GRAPH · ${sunNode.label}`;
    if (interactive || props.sunLabel) ov.appendChild(sunLabel);

    // Relation lines + trace particles
    const maxE = graph.edges.length + 4;
    const lineGeo = new THREE.BufferGeometry(); const lp = new Float32Array(maxE * 6); lineGeo.setAttribute("position", new THREE.BufferAttribute(lp, 3));
    const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: steel, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })); lines.frustumCulled = false; scene.add(lines);
    const partGeo = new THREE.BufferGeometry(); const pp = new Float32Array(maxE * 2 * 3); partGeo.setAttribute("position", new THREE.BufferAttribute(pp, 3));
    const parts = new THREE.Points(partGeo, new THREE.PointsMaterial({ map: dotTex, color: hot, size: 1.1, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); parts.frustumCulled = false; scene.add(parts);

    // Selection marker
    const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture(), color: steel, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); marker.visible = false; scene.add(marker);

    // Camera choreography
    let W = 1, H = 1;
    const homeOffset = new THREE.Vector3();
    const computeHome = () => {
      const fov = (camera.fov * Math.PI) / 180, aspect = W / H;
      const need = (outerR + 3) / (Math.tan(fov / 2) * Math.min(aspect, 1.15));
      const dir = ambient ? new THREE.Vector3(0.15, 0.42, 1) : new THREE.Vector3(0, 1.05, 1);
      homeOffset.copy(dir.normalize().multiplyScalar(need * (ambient ? 0.92 : 1.02)));
    };
    const goal = new THREE.Vector3(); const desired = new THREE.Vector3(); let flying = true; let tracking: string | null = null;
    const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

    const resize = () => {
      const r = el.getBoundingClientRect(); W = Math.max(1, r.width); H = Math.max(1, r.height);
      renderer.setSize(W, H, false); composer.setSize(W, H); bloom.resolution.set(W, H);
      camera.aspect = W / H; camera.updateProjectionMatrix(); computeHome();
      if (!tracking) desired.copy(homeOffset);
    };
    resize();
    camera.position.copy(homeOffset).multiplyScalar(2.8).add(new THREE.Vector3(0, 8, 0)); controls.target.set(0, 0, 0);
    desired.copy(homeOffset);
    const ro = new ResizeObserver(resize); ro.observe(el);
    controls.addEventListener("start", () => { flying = false; controls.autoRotate = false; });

    // State
    let dirty = true;
    const apply = () => {
      const pr = live.current; const hidden = pr.hiddenTypes ?? new Set<string>(); const q = pr.query?.trim().toLowerCase();
      const hl = pr.highlight && pr.highlight.nodes.size ? pr.highlight : null; const sel = pr.selectedId ?? null;
      const neigh = new Set<string>(); if (sel) { neigh.add(sel); for (const e of graph.edges) { if (e.from === sel) neigh.add(e.to); if (e.to === sel) neigh.add(e.from); } }
      for (const l of orbitLines) l.visible = !hidden.has(l.userData.type);
      for (const o of orbitLabels) o.el.style.display = "";
      for (const p of planets) {
        const vis = !hidden.has(p.node.type); p.obj.visible = vis;
        const match = !q || `${p.node.label} ${p.node.sub ?? ""} ${p.node.type} ${p.node.id}`.toLowerCase().includes(q);
        const dim = (hl && !hl.nodes.has(p.node.id)) || !match || (!hl && !!sel && !neigh.has(p.node.id));
        p.mat.opacity = dim ? 0.13 : 1; p.mat.emissiveIntensity = dim ? 0.03 : p.node.id === sel ? 0.8 : 0.22;
        (p.glow.material as THREE.SpriteMaterial).opacity = dim ? 0.02 : p.node.id === sel ? 0.55 : 0.22;
        if (p.extra) (p.extra.material as THREE.MeshBasicMaterial).opacity = dim ? 0.06 : 0.55;
        p.mesh.userData.pickable = vis;
        p.obj.userData.dim = dim; p.obj.userData.match = !!q && match; p.obj.userData.hl = !!hl?.nodes.has(p.node.id); p.obj.userData.sel = p.node.id === sel;
      }
      dirty = false;
    };
    const select = (id: string | null) => {
      if (id && (byId.has(id) || id === sunNode.id)) {
        tracking = id; flying = true; controls.autoRotate = false;
        const cur = tmp.copy(camera.position).sub(controls.target);
        desired.copy(cur.normalize().multiplyScalar(id === sunNode.id ? 20 : 14));
      } else { tracking = null; flying = true; desired.copy(homeOffset); }
    };
    api.current = {
      dirty: () => { dirty = true; }, select,
      zoom: (f) => { flying = false; const off = tmp.copy(camera.position).sub(controls.target).multiplyScalar(f); if (off.length() > controls.minDistance && off.length() < controls.maxDistance) camera.position.copy(controls.target).add(off); },
      fit: () => { tracking = null; flying = true; desired.copy(homeOffset); live.current.onSelect?.(null); },
    };

    // Picking
    const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2(); let down: { x: number; y: number } | null = null; let hover: string | null = null; let hoverDirty = false; const mouse = { x: 0, y: 0 };
    const pickables = () => [sun, ...planets.filter((p) => p.obj.visible).map((p) => p.mesh)];
    const pick = (x: number, y: number): string | null => {
      const r = renderer.domElement.getBoundingClientRect(); ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera); const hit = ray.intersectObjects(pickables(), false)[0];
      if (hit) return hit.object.userData.id as string;
      // generous screen-space fallback for small planets / touch
      let best: string | null = null; let bd = 22;
      for (const p of planets) { if (!p.obj.visible) continue; tmp2.copy(p.world).project(camera); if (tmp2.z > 1) continue; const px = ((tmp2.x + 1) / 2) * r.width + r.left, py = ((1 - tmp2.y) / 2) * r.height + r.top; const d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = p.node.id; } }
      return best;
    };
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => { if (!down) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6; down = null; if (moved) return; live.current.onSelect?.(pick(e.clientX, e.clientY)); };
    const onMove = (e: PointerEvent) => { mouse.x = e.clientX; mouse.y = e.clientY; hoverDirty = true; };
    if (interactive) { renderer.domElement.addEventListener("pointerdown", onDown); renderer.domElement.addEventListener("pointerup", onUp); renderer.domElement.addEventListener("pointermove", onMove); }

    // Loop
    const clock = new THREE.Clock(); let t = 0; let raf = 0; const speed = reduce ? 0 : 1;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(clock.getDelta(), 0.05); t += dt * speed; const real = clock.elapsedTime;
      if (dirty) apply();
      sunMat.uniforms.uTime.value = real; sun.rotation.y += dt * 0.05 * speed;
      const pulse = 1 + Math.sin(real * 1.3) * 0.035 * speed; corona.scale.setScalar(SUN_R * 5.2 * pulse); halo.scale.setScalar(SUN_R * 12 * (2 - pulse));
      stars.rotation.y += dt * 0.004 * speed;
      for (const p of planets) {
        const a = p.phase + t * p.omega; p.obj.position.set(Math.cos(a) * p.R, 0, Math.sin(a) * p.R);
        p.mesh.rotation.y += dt * 0.6 * speed; p.mesh.rotation.x += dt * 0.2 * speed;
      }
      scene.updateMatrixWorld();
      for (const p of planets) p.obj.getWorldPosition(p.world);

      if (interactive && hoverDirty) { hoverDirty = false; const h = pick(mouse.x, mouse.y); if (h !== hover) { hover = h; renderer.domElement.style.cursor = h ? "pointer" : "grab"; } }

      // relations
      const pr = live.current; const hl = pr.highlight && pr.highlight.nodes.size ? pr.highlight : null; const sel = pr.selectedId ?? null; const focus = sel ?? hover;
      let n = 0, m = 0; const A = new THREE.Vector3(), B = new THREE.Vector3();
      for (const e of graph.edges) {
        const active = hl ? hl.edges.has(e.id) : focus ? e.from === focus || e.to === focus : false; if (!active) continue;
        if (!posOf(e.from, A) || !posOf(e.to, B)) continue;
        const pa = byId.get(e.from), pb = byId.get(e.to); if ((pa && !pa.obj.visible) || (pb && !pb.obj.visible)) continue;
        lp.set([A.x, A.y, A.z, B.x, B.y, B.z], n * 6); n++;
        if (hl || sel) for (let k = 0; k < 2; k++) { const f = (real * 0.45 + k * 0.5 + (n * 0.137)) % 1; pp.set([A.x + (B.x - A.x) * f, A.y + (B.y - A.y) * f, A.z + (B.z - A.z) * f], m * 3); m++; }
      }
      lineGeo.setDrawRange(0, n * 2); lineGeo.attributes.position.needsUpdate = true;
      partGeo.setDrawRange(0, m); partGeo.attributes.position.needsUpdate = true;

      // selection marker + camera tracking
      if (sel && posOf(sel, A)) {
        const s = sel === sunNode.id ? SUN_R * 3.2 : (byId.get(sel)!.mesh.geometry.boundingSphere?.radius ?? 0.6) * 4.2;
        marker.visible = true; marker.position.copy(A); marker.scale.setScalar(s * (1 + Math.sin(real * 3) * 0.06));
      } else marker.visible = false;
      goal.set(0, 0, 0); if (tracking && posOf(tracking, A)) goal.copy(A);
      const prevT = tmp.copy(controls.target); controls.target.lerp(goal, tracking ? 0.12 : flying ? 0.06 : 0);
      camera.position.add(tmp2.copy(controls.target).sub(prevT));
      if (flying) { const off = tmp2.copy(camera.position).sub(controls.target); off.lerp(desired, 0.055); camera.position.copy(controls.target).add(off); if (off.distanceTo(desired) < 0.05) flying = false; }
      controls.update();
      composer.render();

      // labels, placed by priority with overlap avoidance
      if (interactive) {
        const cand: { el: HTMLDivElement; v: THREE.Vector3; pr: number }[] = [];
        for (const p of planets) {
          const u = p.obj.userData; const show = p.obj.visible && !u.dim && (u.sel || u.hl || u.match || hover === p.node.id || LABEL_ALWAYS.has(p.node.type));
          p.label!.classList.toggle("is-sel", !!u.sel);
          if (show) cand.push({ el: p.label!, v: p.world, pr: u.sel ? 0 : hover === p.node.id ? 1 : u.hl || u.match ? 2 : 4 }); else p.label!.style.opacity = "0";
        }
        cand.push({ el: sunLabel, v: new THREE.Vector3(0, -SUN_R * 1.25, 0), pr: 3 });
        if (!live.current.highlight?.nodes.size) for (const o of orbitLabels) cand.push({ el: o.el, v: o.pivot.localToWorld(new THREE.Vector3(Math.cos(o.a) * o.R, 0, -Math.sin(o.a) * o.R)), pr: 5 });
        else for (const o of orbitLabels) o.el.style.opacity = "0";
        cand.sort((x, y) => x.pr - y.pr);
        const boxes: [number, number, number, number][] = [];
        tmp2.set(0, 0, 0).project(camera); const sx = ((tmp2.x + 1) / 2) * W, sy = ((1 - tmp2.y) / 2) * H;
        for (const c of cand) {
          tmp2.copy(c.v).project(camera);
          if (tmp2.z > 1 || Math.abs(tmp2.x) > 1.1 || Math.abs(tmp2.y) > 1.1) { c.el.style.opacity = "0"; continue; }
          const x = ((tmp2.x + 1) / 2) * W, y = ((1 - tmp2.y) / 2) * H + 10;
          const w = (c.el.textContent?.length ?? 4) * 6.8 + 6, h = 15; const b: [number, number, number, number] = [x - w / 2, y, x + w / 2, y + h];
          const hit = boxes.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]);
          const nearSun = c.pr >= 4 && Math.hypot(x - sx, y - sy) < 42;
          if (hit || nearSun) { c.el.style.opacity = "0"; continue; }
          boxes.push(b); c.el.style.opacity = "1"; c.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, 0)`;
        }
      } else if (props.sunLabel) place2(sunLabel);
    };
    const place2 = (d: HTMLDivElement) => { tmp2.set(0, -SUN_R * 1.3, 0).project(camera); d.style.transform = `translate(${((tmp2.x + 1) / 2) * W}px, ${((1 - tmp2.y) / 2) * H}px) translate(-50%, 10px)`; };
    loop();

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); api.current = null;
      renderer.domElement.removeEventListener("pointerdown", onDown); renderer.domElement.removeEventListener("pointerup", onUp); renderer.domElement.removeEventListener("pointermove", onMove);
      scene.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); const mat = m.material as THREE.Material | THREE.Material[] | undefined; (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => { (x as THREE.SpriteMaterial).map?.dispose(); x.dispose(); }); });
      composer.dispose(); renderer.dispose(); renderer.domElement.remove(); ov.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, theme, interactive, ambient, fallback]);

  useEffect(() => { api.current?.dirty(); }, [props.selectedId, props.highlight, props.hiddenTypes, props.query]);
  useEffect(() => { api.current?.select(props.selectedId ?? null); }, [props.selectedId]);
  useEffect(() => { if (props.focusId) props.onSelect?.(props.focusId); /* eslint-disable-next-line */ }, [props.focusId]);

  if (fallback) return <GraphCanvas graph={graph} selectedId={props.selectedId} onSelect={props.onSelect} highlight={props.highlight} hiddenTypes={props.hiddenTypes} query={props.query} interactive={interactive} ambient={ambient} labels={ambient ? "none" : "auto"} className={className} />;
  return (
    <div ref={wrap} className={`overflow-hidden ${className ?? "relative"}`} style={{ cursor: interactive ? "grab" : "default" }}>
      <div ref={overlay} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden />
      {interactive && (
        <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
          {([["+", () => api.current?.zoom(0.72), "Zoom in"], ["−", () => api.current?.zoom(1.38), "Zoom out"], ["⤢", () => api.current?.fit(), "Reset view"]] as const).map(([tx, fn, label]) => (
            <button key={label} type="button" aria-label={label} onClick={fn} className="focus-ring glass grid h-9 w-9 place-items-center rounded-md text-dim hover:text-fg">{tx}</button>
          ))}
        </div>
      )}
    </div>
  );
}
