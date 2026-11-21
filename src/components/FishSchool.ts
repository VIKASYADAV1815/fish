import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/*
  Koi school — top-down view with 10-joint spine physics + distinct vertical (up/down) depth layers.
  - Each fish swims at its own vertical 3D depth layer (Y coordinate) separated
    by more than the fish's full 3D body height, so two fish NEVER intersect meshes:
    one cleanly passes OVER (up) while the other passes UNDER (down).
  - Subtle vertical rise/dive movement + depth-based scale & underwater shading
    give a clear 3D up/down depth feel from the top shot.
*/

export const FISH_COUNT = 5;

const SPINE_JOINTS = 10;
const MODEL_URL = "/koi_fish.glb";
const X_NOSE = -3.1348; // nose x in mesh_0 after baking frame 22
const X_TAIL = 3.1730; // tail tip x in mesh_0 after baking frame 22
const MODEL_LENGTH = X_TAIL - X_NOSE; // 6.3078 model units
const FISH_LENGTH = 0.40; // on-screen koi length (world units, screen height = 2)
const SEP_RADIUS = 0.54; // comfortable personal space between fish

// movement (world units / second)
const CRUISE_MIN = 0.09; // calm roaming speed when idle
const CRUISE_MAX = 0.12;
const FOLLOW_SPEED = 0.56; // energetic, responsive swimming toward the moving cursor
const ORBIT_SPEED = 0.22; // lively cruising speed near the cursor
const MAX_CURVATURE = 5.4; // rad per world unit (agile, responsive koi turns)

type SpineUniforms = {
  uSpine: { value: THREE.Vector2[] };
  uPitch: { value: number };
  uDepthFactor: { value: number }; // 0 = near surface (up), 1 = deep (down)
};

type Fish = {
  group: THREE.Group;
  spineUniforms: SpineUniforms[];
  trail: { x: number; y: number }[]; // 10 follow-the-leader backbone joints in world (x, y)
  theta: number; // head facing angle (radians, 0 = right, counter-clockwise)
  curvature: number; // current path curvature (rad / world unit)
  speed: number;
  cruise: number;
  interest: number; // 0 roaming .. 1 following cursor
  wanderX: number; // calm waypoint when roaming
  wanderY: number;
  wanderTimer: number;
  orbitAngle: number; // personal angle around cursor
  orbitRadius: number; // personal distance from cursor
  depthIndex: number; // 0 (top/up) .. 4 (bottom/down)
  baseY: number; // distinct vertical 3D depth so meshes never intersect
  currentY: number; // current vertical 3D height (with gentle up/down diving)
  pitch: number; // vertical nose pitch when rising or diving
  scale: number;
  swim: number; // tail-beat phase
  wakeT: number;
};

export type PointerWorld = { active: boolean; x: number; y: number };
export type Wake = { x: number; y: number; s: number };

const wrapAngle = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Bakes morph target frame 22 (the 100% straight, centered symmetric pose) into
 * the mesh's base POSITION attribute and removes morph targets.
 */
function bakeSymmetricStraightPose(root: THREE.Object3D) {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;

    const geom = mesh.geometry.clone();
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const morphPos = geom.morphAttributes?.position;

    if (pos && morphPos && morphPos[22]) {
      const m22 = morphPos[22];
      for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(
          i,
          pos.getX(i) + m22.getX(i),
          pos.getY(i) + m22.getY(i),
          pos.getZ(i) + m22.getZ(i)
        );
      }
      pos.needsUpdate = true;
    }

    geom.morphAttributes = {};
    mesh.geometry = geom;
    mesh.morphTargetInfluences = undefined;
    mesh.morphTargetDictionary = undefined;
    mesh.frustumCulled = false;
  });

  root.traverse((node) => {
    if (node !== root) {
      node.position.set(0, 0, 0);
    }
  });
}

/**
 * Skins the straight koi mesh onto the 10 world-space spine joints uSpine[0..9],
 * applies vertical rise/dive pitch along the spine, and shades deeper fish with
 * a subtle underwater depth tint so up/down layering reads clearly.
 */
function attachSpineShader(mat: THREE.Material, initialDepth: number): SpineUniforms {
  const pts = Array.from({ length: SPINE_JOINTS }, (_, k) => {
    const restX = X_NOSE + (k / (SPINE_JOINTS - 1)) * MODEL_LENGTH;
    return new THREE.Vector2(restX, 0);
  });
  const uniforms: SpineUniforms = {
    uSpine: { value: pts },
    uPitch: { value: 0 },
    uDepthFactor: { value: initialDepth },
  };

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSpine = uniforms.uSpine;
    shader.uniforms.uPitch = uniforms.uPitch;
    shader.uniforms.uDepthFactor = uniforms.uDepthFactor;

    shader.vertexShader =
      `
      uniform vec2 uSpine[${SPINE_JOINTS}];
      uniform float uPitch;
      ` +
      shader.vertexShader
        .replace(
          "#include <beginnormal_vertex>",
          `
          #include <beginnormal_vertex>
          float spNormN = clamp((position.x - (${X_NOSE.toFixed(4)})) / ${MODEL_LENGTH.toFixed(4)}, 0.0, 1.0) * float(${SPINE_JOINTS - 1});
          int spIdxN = int(min(floor(spNormN), float(${SPINE_JOINTS - 2})));
          float spFracN = spNormN - float(spIdxN);
          vec2 spT0N = uSpine[min(spIdxN + 1, ${SPINE_JOINTS - 1})] - uSpine[max(spIdxN - 1, 0)];
          vec2 spT1N = uSpine[min(spIdxN + 2, ${SPINE_JOINTS - 1})] - uSpine[spIdxN];
          vec2 spTanN = normalize(mix(normalize(spT0N + vec2(1e-5, 0.0)), normalize(spT1N + vec2(1e-5, 0.0)), spFracN));
          vec2 spNorN = vec2(-spTanN.y, spTanN.x);
          objectNormal.xz = spTanN * objectNormal.x + spNorN * objectNormal.z;
          `
        )
        .replace(
          "#include <morphtarget_vertex>",
          `
          #include <morphtarget_vertex>
          float spUnit = clamp((transformed.x - (${X_NOSE.toFixed(4)})) / ${MODEL_LENGTH.toFixed(4)}, 0.0, 1.0);
          float spNorm = spUnit * float(${SPINE_JOINTS - 1});
          int spIdx = int(min(floor(spNorm), float(${SPINE_JOINTS - 2})));
          float spFrac = spNorm - float(spIdx);

          vec2 spPos = mix(uSpine[spIdx], uSpine[spIdx + 1], spFrac);
          vec2 spT0 = uSpine[min(spIdx + 1, ${SPINE_JOINTS - 1})] - uSpine[max(spIdx - 1, 0)];
          vec2 spT1 = uSpine[min(spIdx + 2, ${SPINE_JOINTS - 1})] - uSpine[spIdx];
          vec2 spTan = normalize(mix(normalize(spT0 + vec2(1e-5, 0.0)), normalize(spT1 + vec2(1e-5, 0.0)), spFrac));
          vec2 spNor = vec2(-spTan.y, spTan.x);

          transformed.xz = spPos + spNor * transformed.z;
          // vertical up/down pitch tilt along the body (nose tilts up when rising, down when diving)
          transformed.y += (0.5 - spUnit) * uPitch;
          `
        );

    shader.fragmentShader =
      `
      uniform float uDepthFactor;
      ` +
      shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        `
        #include <dithering_fragment>
        // Deeper fish get a soft, natural water-depth veil so upper fish clearly read as above them
        vec3 deepVeil = vec3(0.88, 0.91, 0.87);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, deepVeil, uDepthFactor * 0.28);
        gl_FragColor.rgb *= (1.0 - uDepthFactor * 0.10);
        `
      );
  };
  mat.needsUpdate = true;
  return uniforms;
}

export default class FishSchool {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
  private fishes: Fish[] = [];
  private wakes: Wake[] = [];
  private aspect = 1;
  private time = 0;
  private disposed = false;

  constructor() {
    // top-down camera: looks along -Y, screen-up = world -Z
    this.camera.position.set(0, 10, 0);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.75));
    const sun = new THREE.DirectionalLight(0xfff6e8, 2.2);
    sun.position.set(-0.35, 1, -0.5);
    this.scene.add(sun);

    this.load();
  }

  setAspect(aspect: number) {
    this.aspect = aspect;
    this.camera.left = -aspect;
    this.camera.right = aspect;
    this.camera.top = 1;
    this.camera.bottom = -1;
    this.camera.updateProjectionMatrix();
  }

  /** 1.0 on desktop/landscape; scales down smoothly on narrow portrait mobile screens */
  private getResponsiveScale(): number {
    return this.aspect >= 1.05 ? 1.0 : Math.max(0.54, Math.min(1.0, this.aspect * 1.05));
  }

  private pickWaypoint(i: number): { x: number; y: number } {
    const rScale = this.getResponsiveScale();
    const mx = Math.max(0.2, this.aspect - 0.28 * rScale);
    const my = 0.68;
    const angle = Math.random() * Math.PI * 2;
    const rx = (0.35 + Math.random() * 0.65) * mx;
    const ry = (0.35 + Math.random() * 0.65) * my;
    return {
      x: Math.cos(angle + i * 1.2) * rx,
      y: Math.sin(angle + i * 1.2) * ry,
    };
  }

  private load() {
    new GLTFLoader().load(
      MODEL_URL,
      (gltf) => {
        if (this.disposed) return;

        bakeSymmetricStraightPose(gltf.scene);

        const radii = [0.24, 0.33, 0.28, 0.37, 0.30];
        const ys = [0.42, -0.44, 0.14, -0.22, 0.54];

        for (let i = 0; i < FISH_COUNT; i++) {
          const inner = gltf.scene.clone(true);
          inner.position.set(0, 0, 0);

          // 0 = shallowest (up near surface), 1 = deepest (down near bottom)
          const depthNorm = i / Math.max(1, FISH_COUNT - 1);

          const spineUniforms: SpineUniforms[] = [];
          inner.traverse((node) => {
            const mesh = node as THREE.Mesh;
            if (mesh.isMesh && mesh.material) {
              mesh.frustumCulled = false;
              if (Array.isArray(mesh.material)) {
                mesh.material = mesh.material.map((m) => {
                  const cloned = m.clone();
                  spineUniforms.push(attachSpineShader(cloned, depthNorm));
                  return cloned;
                });
              } else {
                const cloned = mesh.material.clone();
                spineUniforms.push(attachSpineShader(cloned, depthNorm));
                mesh.material = cloned;
              }
            }
          });

          const group = new THREE.Group();
          group.add(inner);

          const rScale = this.getResponsiveScale();
          // Upper fish appear slightly larger (closer to top camera); deeper fish slightly smaller
          const depthScale = 1.04 - depthNorm * 0.16;
          const scale = depthScale * (FISH_LENGTH / MODEL_LENGTH) * rScale;

          // Distinct vertical 3D depth levels: each level is separated by 0.42 world units
          // (more than 2x the fish's full 0.18 vertical 3D thickness -> zero mesh intersection ever!)
          const baseY = (2 - i) * 0.42;

          group.position.set(0, baseY, 0);
          group.rotation.set(0, 0, 0);
          group.scale.setScalar(scale);

          const slot = (i + 0.5) / FISH_COUNT;
          const theta = (i / FISH_COUNT) * Math.PI * 2 + 0.35;
          const cruise = CRUISE_MIN + (i / FISH_COUNT) * (CRUISE_MAX - CRUISE_MIN);
          const headX = (slot * 2 - 1) * this.aspect * 0.65;
          const headY = ys[i % ys.length];

          const segWorldLen = (MODEL_LENGTH * scale) / (SPINE_JOINTS - 1);
          const trail = Array.from({ length: SPINE_JOINTS }, (_, k) => ({
            x: headX - Math.cos(theta) * k * segWorldLen,
            y: headY - Math.sin(theta) * k * segWorldLen,
          }));

          const wp = this.pickWaypoint(i);

          this.fishes.push({
            group,
            spineUniforms,
            trail,
            theta,
            curvature: 0,
            speed: cruise,
            cruise,
            interest: 0,
            wanderX: wp.x,
            wanderY: wp.y,
            wanderTimer: 4 + i * 1.1,
            orbitAngle: (i / FISH_COUNT) * Math.PI * 2,
            orbitRadius: radii[i % radii.length],
            depthIndex: i,
            baseY,
            currentY: baseY,
            pitch: 0,
            scale,
            swim: i * 1.5,
            wakeT: Math.random() * 0.18,
          });
          this.scene.add(group);
        }
      },
      undefined,
      (err) => console.error("Koi model load error:", err)
    );
  }

  /** a click / ripple at (x, y): fish smoothly curve toward it */
  attract(x: number, y: number) {
    const rScale = this.getResponsiveScale();
    const padX = 0.24 * rScale;
    const safeX = clamp(x, -this.aspect + padX, this.aspect - padX);
    const safeY = clamp(y, -0.74, 0.74);
    for (const f of this.fishes) {
      f.wanderX = safeX;
      f.wanderY = safeY;
      f.wanderTimer = 5.0;
    }
  }

  /** very subtle wakes the fish leave in the water */
  takeWakes(): Wake[] {
    const w = this.wakes;
    this.wakes = [];
    return w;
  }

  update(dtRaw: number, pointer: PointerWorld) {
    const dt = Math.min(dtRaw, 0.04);
    this.time += dt;
    const t = this.time;
    const aspect = this.aspect;

    const rScale = this.getResponsiveScale();
    const maxX = Math.max(0.18, aspect - 0.20 * rScale);
    const maxY = 0.80;
    const effSepRadius = SEP_RADIUS * rScale;

    for (let i = 0; i < this.fishes.length; i++) {
      const f = this.fishes[i];
      const head = f.trail[0];

      // ---- 1) determine target destination (calm waypoint vs cursor hover ring) ----
      if (pointer.active) {
        f.interest += (1 - f.interest) * (1 - Math.exp(-dt * 12.0));
      } else {
        f.interest *= Math.exp(-dt * 1.5);
      }
      const interest = clamp(f.interest, 0, 1);

      f.wanderTimer -= dt;
      const distWp = Math.hypot(f.wanderX - head.x, f.wanderY - head.y);
      if (distWp < 0.32 || f.wanderTimer <= 0) {
        const wp = this.pickWaypoint(i);
        f.wanderX = wp.x;
        f.wanderY = wp.y;
        f.wanderTimer = 5.5 + Math.random() * 3.5;
      }

      const cursorPad = 0.12 * rScale;
      const cursorX = clamp(pointer.x, -maxX + cursorPad, maxX - cursorPad);
      const cursorY = clamp(pointer.y, -maxY + 0.14, maxY - 0.14);
      const distToCursor = Math.hypot(cursorX - head.x, cursorY - head.y);
      const effOrbitRadius = f.orbitRadius * rScale;

      const nearCursor = 1 - smoothstep(effOrbitRadius * 0.5, effOrbitRadius * 2.2, distToCursor);
      f.orbitAngle = wrapAngle(f.orbitAngle + dt * (0.14 + 0.42 * nearCursor));

      const hoverGoalX = clamp(cursorX + Math.cos(f.orbitAngle) * effOrbitRadius, -maxX, maxX);
      const hoverGoalY = clamp(cursorY + Math.sin(f.orbitAngle) * effOrbitRadius, -maxY, maxY);

      const goalX = f.wanderX * (1 - interest) + hoverGoalX * interest;
      const goalY = f.wanderY * (1 - interest) + hoverGoalY * interest;

      // ---- 2) smooth 2D steering + vertical up/down depth separation when passing another fish ----
      const toGoalX = goalX - head.x;
      const toGoalY = goalY - head.y;
      const distGoal = Math.hypot(toGoalX, toGoalY);
      let dirX = distGoal > 1e-4 ? toGoalX / distGoal : Math.cos(f.theta);
      let dirY = distGoal > 1e-4 ? toGoalY / distGoal : Math.sin(f.theta);

      if (interest > 0.1) {
        const tangX = -Math.sin(f.orbitAngle);
        const tangY = Math.cos(f.orbitAngle);
        dirX += tangX * nearCursor * 0.75 * interest;
        dirY += tangY * nearCursor * 0.75 * interest;
      }

      const headCos = Math.cos(f.theta);
      const headSin = Math.sin(f.theta);
      let speedEase = 1.0;
      let verticalPassOffset = 0; // rises up (+Y) if upper fish, dives down (-Y) if lower fish

      for (let j = 0; j < this.fishes.length; j++) {
        if (j === i) continue;
        const g = this.fishes[j];
        // check against neighbor's spine points (head, mid, tail)
        for (const pt of [g.trail[0], g.trail[3], g.trail[6], g.trail[9]]) {
          const rx = head.x - pt.x;
          const ry = head.y - pt.y;
          const d = Math.hypot(rx, ry);
          if (d < effSepRadius && d > 1e-4) {
            const w = smoothstep(effSepRadius, 0.12 * rScale, d);
            dirX += (rx / d) * (1.35 * w);
            dirY += (ry / d) * (1.35 * w);

            // when crossing paths in 2D, upper fish rises higher and deeper fish dives deeper
            const upDownSign = f.depthIndex < g.depthIndex ? 1 : -1;
            verticalPassOffset += upDownSign * w * 0.12;

            const ahead = (-rx * headCos + -ry * headSin) / d;
            if (ahead > 0.25) {
              speedEase = Math.min(speedEase, 1 - w * smoothstep(0.25, 0.9, ahead) * 0.35);
            }
          }
        }
      }

      // smooth vertical up/down swimming (base depth + gentle breathing wave + pass-over/under dive)
      const gentleBob = Math.sin(t * 0.8 + i * 1.4) * 0.04;
      const targetY = f.baseY + gentleBob + clamp(verticalPassOffset, -0.18, 0.18);
      const prevY = f.currentY;
      f.currentY += (targetY - f.currentY) * (1 - Math.exp(-dt * 4.5));
      const verticalVel = (f.currentY - prevY) / Math.max(dt, 1e-4);
      const targetPitch = clamp(verticalVel * 2.2, -0.55, 0.55);
      f.pitch += (targetPitch - f.pitch) * (1 - Math.exp(-dt * 6.0));
      f.group.position.y = f.currentY;

      // map current vertical depth to [0..1] for subtle depth shading and scale
      const liveDepthNorm = clamp((0.9 - f.currentY) / 1.8, 0, 1);
      const liveScale = (1.05 - liveDepthNorm * 0.17) * (FISH_LENGTH / MODEL_LENGTH) * rScale;
      f.scale = liveScale;
      f.group.scale.setScalar(liveScale);

      // soft border cushion so fish curve gracefully inward before reaching the screen edge
      const margin = 0.34 * rScale;
      if (Math.abs(head.x) > maxX - margin) {
        const w = smoothstep(maxX - margin, maxX, Math.abs(head.x));
        dirX += -Math.sign(head.x) * (2.6 * w);
      }
      if (Math.abs(head.y) > maxY - margin) {
        const w = smoothstep(maxY - margin, maxY, Math.abs(head.y));
        dirY += -Math.sign(head.y) * (2.6 * w);
      }

      // ---- 3) curvature-driven steering (Euler spiral with agile turn response on hover) ----
      const desiredTheta = Math.hypot(dirX, dirY) > 1e-4 ? Math.atan2(dirY, dirX) : f.theta;
      const angleError = wrapAngle(desiredTheta - f.theta);

      const targetCurvature = clamp(angleError * 4.2, -MAX_CURVATURE, MAX_CURVATURE);
      f.curvature += (targetCurvature - f.curvature) * (1 - Math.exp(-dt * 10.0));

      // ---- 4) speed with responsive burst toward the moving cursor ----
      const farFactor = smoothstep(0.05, 0.48, distGoal);
      const activeSpeed = ORBIT_SPEED + (FOLLOW_SPEED - ORBIT_SPEED) * farFactor;
      const baseTargetSpeed = (f.cruise + (activeSpeed - f.cruise) * interest) * speedEase;

      const strokePulse = 1 + 0.06 * Math.sin(f.swim * 2.0);
      const desiredSpeed = baseTargetSpeed * strokePulse;
      const accelRate = desiredSpeed > f.speed ? 7.5 : 3.5;
      f.speed += (desiredSpeed - f.speed) * (1 - Math.exp(-dt * accelRate));

      const stepDist = f.speed * dt;
      const turnStepDist = Math.max(f.speed, interest * 0.44) * dt;
      f.theta = wrapAngle(f.theta + f.curvature * turnStepDist);

      head.x = clamp(head.x + Math.cos(f.theta) * stepDist, -maxX, maxX);
      head.y = clamp(head.y + Math.sin(f.theta) * stepDist, -maxY, maxY);

      // ---- 5) follow-the-leader spine chain (joints 1..9 thread through the head's path) ----
      const segLen = (MODEL_LENGTH * f.scale) / (SPINE_JOINTS - 1);
      for (let k = 1; k < SPINE_JOINTS; k++) {
        const prev = f.trail[k - 1];
        const curr = f.trail[k];
        const dx = curr.x - prev.x;
        const dy = curr.y - prev.y;
        const d = Math.hypot(dx, dy) || 1e-5;
        curr.x = prev.x + (dx / d) * segLen;
        curr.y = prev.y + (dy / d) * segLen;
      }

      // ---- 6) compute rendered spine joints (backbone trail + speed-matched sinusoidal tail wave) ----
      const speedNorm = clamp((f.speed - CRUISE_MIN) / (FOLLOW_SPEED - CRUISE_MIN), 0, 1);
      const wagFreq = 2.4 + f.speed * 19.0;
      f.swim += dt * wagFreq;
      const wagWorldAmp = (0.016 + speedNorm * 0.022) * (f.scale / (FISH_LENGTH / MODEL_LENGTH));

      for (let k = 0; k < SPINE_JOINTS; k++) {
        const prev = f.trail[Math.max(0, k - 1)];
        const next = f.trail[Math.min(SPINE_JOINTS - 1, k + 1)];
        const tx = prev.x - next.x;
        const ty = prev.y - next.y;
        const tl = Math.hypot(tx, ty) || 1e-5;
        const nx = -ty / tl;
        const ny = tx / tl;

        const sNorm = k / (SPINE_JOINTS - 1);
        const wave = Math.pow(sNorm, 2.1) * wagWorldAmp * Math.sin(f.swim - sNorm * 4.0);

        const rx = f.trail[k].x + nx * wave;
        const ry = f.trail[k].y + ny * wave;

        const xm = -rx / f.scale;
        const zm = ry / f.scale;
        for (const u of f.spineUniforms) {
          u.uSpine.value[k].set(xm, zm);
        }
      }

      for (const u of f.spineUniforms) {
        u.uPitch.value = f.pitch;
        u.uDepthFactor.value = liveDepthNorm;
      }

      // whisper-light water wake near the head (stronger when fish is higher near the surface)
      f.wakeT -= dt;
      if (f.wakeT <= 0) {
        f.wakeT = 0.22;
        const surfaceWakeScale = 1.15 - liveDepthNorm * 0.55;
        this.wakes.push({
          x: head.x,
          y: head.y,
          s: (0.0016 + Math.min(f.speed, 0.25) * 0.004) * surfaceWakeScale,
        });
      }
    }
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget) {
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(null);
  }

  dispose() {
    this.disposed = true;
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[];
        (Array.isArray(mat) ? mat : [mat]).forEach((m) => m?.dispose());
      }
    });
  }
}
