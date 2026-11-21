"use client";

import React, { useRef, useEffect } from "react";
import * as THREE from "three";
import FishSchool from "./FishSchool";

/*
  Layers (top to bottom):
    1. water surface  - GPU wave-equation height field -> gentle refraction, soft relief, glints
    2. koi            - swim under the surface (refracted by the same ripples, stay on screen)
    3. pond bed image - the stones at the very bottom (refracted the most)

  The water is calm until touched:
    - cursor movement  -> soft, localized ripples + fish gently glide closer
    - click            -> gentle splash ring (+ attracts the koi)
    - scroll           -> soft swell across the pond
    - koi swimming     -> subtle, smooth wakes
*/

const SIM_WIDTH = 512; // simulation grid width (height follows screen aspect)
const STEPS_PER_FRAME = 3; // wave propagation speed
const DAMPING = 0.988; // how long ripples live (keeps ripples gentle and localized)
const DROP_RADIUS = 0.022; // smooth cursor touch size (relative to screen height)
const MAX_IMPULSES = 12; // point drops per frame (clicks, scroll, fish wakes)

const quadVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// ---- Wave equation step -----------------------------------------------------
const simFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uPrev;
  uniform vec2 uTexel;
  uniform vec2 uMouse;
  uniform vec2 uMousePrev;
  uniform float uForce;
  uniform float uAspect;
  uniform float uDamping;
  uniform float uRadius;
  uniform vec4 uImpulses[${MAX_IMPULSES}]; // x, y, radius, strength
  uniform float uImpulseCount;
  varying vec2 vUv;

  // distance from point p to segment a-b (in aspect corrected space)
  float segDist(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
    return length(pa - ba * h);
  }

  // smooth zero-net-volume wavelet -> clean, natural rings
  float drop(float dist, float radius) {
    float x = dist / radius;
    return (1.0 - 0.5 * x * x) * exp(-0.5 * x * x);
  }

  void main() {
    vec2 uv = vUv;
    vec2 info = texture2D(uPrev, uv).rg; // r = height, g = velocity

    float l = texture2D(uPrev, uv - vec2(uTexel.x, 0.0)).r;
    float r = texture2D(uPrev, uv + vec2(uTexel.x, 0.0)).r;
    float d = texture2D(uPrev, uv - vec2(0.0, uTexel.y)).r;
    float u = texture2D(uPrev, uv + vec2(0.0, uTexel.y)).r;
    float average = (l + r + d + u) * 0.25;

    // stable wave propagation
    info.g += (average - info.r) * 1.0;
    info.g *= uDamping;
    info.r += info.g;

    // hard safety limits
    info.g = clamp(info.g, -0.2, 0.2);
    info.r = clamp(info.r, -0.45, 0.45);

    // soak waves at the screen edges so they don't bounce back
    vec2 e = min(uv, 1.0 - uv);
    float edge = min(e.x, e.y);
    info.g *= mix(0.92, 1.0, smoothstep(0.0, 0.04, edge));

    // cursor gently pushes the water along its path
    if (uForce > 0.0) {
      vec2 p = vec2(uv.x * uAspect, uv.y);
      vec2 a = vec2(uMousePrev.x * uAspect, uMousePrev.y);
      vec2 b = vec2(uMouse.x * uAspect, uMouse.y);
      info.r += drop(segDist(p, a, b), uRadius) * uForce;
    }

    // point drops: clicks, scroll, fish wakes
    for (int i = 0; i < ${MAX_IMPULSES}; i++) {
      if (float(i) >= uImpulseCount) break;
      vec4 imp = uImpulses[i];
      vec2 dd = vec2((uv.x - imp.x) * uAspect, uv.y - imp.y);
      info.r += drop(length(dd), imp.z) * imp.w;
    }

    gl_FragColor = vec4(info, 0.0, 1.0);
  }
`;

// ---- Final water look -------------------------------------------------------
const waterFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uHeight;
  uniform sampler2D uFish; // premultiplied koi layer (linear colour)
  uniform vec2 uTexel;
  varying vec2 vUv;

  vec4 fishAt(vec2 uv) {
    return texture2D(uFish, clamp(uv, 0.001, 0.999));
  }

  void main() {
    vec2 uv = vUv;

    // 9-tap smoothed height & gradient for silky ripples
    float h  = texture2D(uHeight, uv).r;
    float hl = texture2D(uHeight, uv - vec2(uTexel.x, 0.0)).r;
    float hr = texture2D(uHeight, uv + vec2(uTexel.x, 0.0)).r;
    float hd = texture2D(uHeight, uv - vec2(0.0, uTexel.y)).r;
    float hu = texture2D(uHeight, uv + vec2(0.0, uTexel.y)).r;

    // surface slope -> normal
    vec2 grad = vec2(hr - hl, hu - hd) * 0.5;
    vec3 normal = normalize(vec3(-grad * 32.0, 1.0));
    vec2 offset = grad * 4.2;

    // LAYER 3 (bottom): solid #F9FAF4 floor color
    vec3 color = vec3(0.9765, 0.9804, 0.9569);

    // water ripple relief & shadows on the #F9FAF4 floor BELOW the fish
    float relief = dot(grad, vec2(-0.6, 0.8)) * 52.0;
    float curvature = (hl + hr + hd + hu) * 0.25 - h;
    float waveShade = relief + curvature * 12.0;
    vec3 shadowTint = vec3(0.84, 0.87, 0.83);
    color = mix(color, color * shadowTint, clamp(-waveShade, 0.0, 0.58));
    color = mix(color, vec3(1.0, 1.0, 0.995), clamp(waveShade, 0.0, 0.55) * 0.85);

    // soft shadow of the koi on the bottom floor (sun from the upper left)
    vec2 fishUv = uv + offset * 0.12;
    vec2 shadowUv = fishUv + vec2(0.012, -0.019);
    float s = 0.004;
    float shadow = fishAt(shadowUv).a * 0.4
                 + fishAt(shadowUv + vec2( s, 0.0)).a * 0.15
                 + fishAt(shadowUv + vec2(-s, 0.0)).a * 0.15
                 + fishAt(shadowUv + vec2(0.0,  s)).a * 0.15
                 + fishAt(shadowUv + vec2(0.0, -s)).a * 0.15;
    color *= 1.0 - shadow * 0.18;

    // LAYER 2 (brought up near the top surface): crisp, clean koi never hidden by ripples
    vec4 fish = fishAt(fishUv);
    if (fish.a > 0.002) {
      vec3 f = clamp(fish.rgb / fish.a, 0.0, 1.0);
      f = pow(f, vec3(1.0 / 2.2));                          // linear -> sRGB
      f = mix(f, vec3(0.90, 0.95, 0.98), 0.04);             // whisper-thin surface water sheen
      color = mix(color, f, fish.a);
    }

    // LAYER 1 (topmost): delicate sun glint on the water surface
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    vec3 sunDir = normalize(vec3(-0.35, 0.5, 0.8));
    vec3 halfVec = normalize(sunDir + viewDir);
    float spec = pow(max(dot(normal, halfVec), 0.0), 150.0);
    color += vec3(1.0, 0.98, 0.94) * spec * 0.25;

    // faint sky reflection where the surface is tilted (fresnel)
    float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
    color += vec3(0.80, 0.92, 1.0) * fresnel * 0.14;

    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`;

type Impulse = { x: number; y: number; r: number; s: number };

export default function PondWater() {
  const containerRef = useRef<HTMLDivElement>(null);

  // pointer state shared with the render loop
  const pointer = useRef({
    x: 0.5,
    y: 0.5,
    px: 0.5,
    py: 0.5,
    moved: false,
    active: false,
    lastMove: 0,
    lastWheel: 0,
  });
  const impulses = useRef<Impulse[]>([]); // pending point drops (uv space)
  const clicks = useRef<{ x: number; y: number }[]>([]); // pending click positions (uv space)
  const container_aspect = useRef(1); // width / height of the pond

  const toUv = (e: React.PointerEvent | React.WheelEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: 1.0 - (e.clientY - rect.top) / rect.height,
    };
  };

  const updatePointerUv = (x: number, y: number) => {
    const p = pointer.current;
    const now = performance.now();

    // if cursor was idle / just entered, start the segment at the current spot
    if (!p.active || now - p.lastMove > 140) {
      p.px = x;
      p.py = y;
    }
    p.x = x;
    p.y = y;
    p.moved = true;
    p.active = true;
    p.lastMove = now;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const { x, y } = toUv(e);
    updatePointerUv(x, y);
  };

  const handlePointerLeave = () => {
    pointer.current.active = false;
  };

  // click / tap: gentle splash ring + draws the koi closer
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const { x, y } = toUv(e);
    const p = pointer.current;
    p.x = p.px = x;
    p.y = p.py = y;
    p.active = true;
    p.lastMove = performance.now();

    const q = impulses.current;
    q.push({ x, y, r: 0.026, s: 0.075 });
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 0.024 + Math.random() * 0.04;
      q.push({
        x: x + (Math.cos(a) * d) / (container_aspect.current || 1),
        y: y + Math.sin(a) * d,
        r: 0.012,
        s: 0.02 + Math.random() * 0.02,
      });
    }
    clicks.current.push({ x, y });
  };

  // scroll: soft waves roll across the pond
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const p = pointer.current;
    const now = performance.now();
    if (now - p.lastWheel < 110) return;
    p.lastWheel = now;

    const m = Math.min(Math.abs(e.deltaY) / 100, 2.0);
    const count = 2 + Math.round(m);
    const dir = e.deltaY > 0 ? 1 : -1;
    const q = impulses.current;
    for (let i = 0; i < count; i++) {
      q.push({
        x: 0.04 + Math.random() * 0.92,
        y: clamp01(0.5 - dir * 0.18 + (Math.random() - 0.5) * 0.7),
        r: 0.024 + Math.random() * 0.014,
        s: 0.008 + m * 0.008,
      });
    }
    if (q.length > 40) q.splice(0, q.length - 40);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let width = container.clientWidth || window.innerWidth;
    let height = container.clientHeight || window.innerHeight;
    container_aspect.current = width / height;

    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    container.appendChild(renderer.domElement);

    const camera = new THREE.Camera();
    const quad = new THREE.PlaneGeometry(2, 2);

    // ---- koi layer ----
    const school = new FishSchool();
    let fishRT: THREE.WebGLRenderTarget;

    // ---- simulation targets (ping-pong) ----
    let rtA: THREE.WebGLRenderTarget;
    let rtB: THREE.WebGLRenderTarget;
    let simW = SIM_WIDTH;
    let simH = Math.round(SIM_WIDTH * (height / width));

    // full float = no precision noise; fall back to half float if the GPU
    // can't linearly filter full float textures
    const useFloat =
      renderer.extensions.has("EXT_color_buffer_float") &&
      renderer.extensions.has("OES_texture_float_linear");

    const makeTarget = (w: number, h: number) =>
      new THREE.WebGLRenderTarget(w, h, {
        type: useFloat ? THREE.FloatType : THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        depthBuffer: false,
        stencilBuffer: false,
      });

    const buildTargets = () => {
      rtA?.dispose();
      rtB?.dispose();
      fishRT?.dispose();
      simW = SIM_WIDTH;
      simH = Math.max(64, Math.round(SIM_WIDTH * (height / width)));
      rtA = makeTarget(simW, simH);
      rtB = makeTarget(simW, simH);
      // clear to still water
      renderer.setClearColor(0x000000, 1);
      [rtA, rtB].forEach((rt) => {
        renderer.setRenderTarget(rt);
        renderer.clear();
      });
      renderer.setRenderTarget(null);

      // koi layer (anti-aliased, capped resolution)
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      fishRT = new THREE.WebGLRenderTarget(
        Math.round(width * dpr),
        Math.round(height * dpr),
        {
          samples: 4,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          depthBuffer: true,
          stencilBuffer: false,
        }
      );
      school.setAspect(width / height);
    };
    buildTargets();

    // ---- materials ----
    const impulseVecs = Array.from({ length: MAX_IMPULSES }, () => new THREE.Vector4());

    const simMaterial = new THREE.ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: simFragment,
      uniforms: {
        uPrev: { value: null },
        uTexel: { value: new THREE.Vector2(1 / simW, 1 / simH) },
        uMouse: { value: new THREE.Vector2(0.5, 0.5) },
        uMousePrev: { value: new THREE.Vector2(0.5, 0.5) },
        uForce: { value: 0 },
        uAspect: { value: width / height },
        uDamping: { value: DAMPING },
        uRadius: { value: DROP_RADIUS },
        uImpulses: { value: impulseVecs },
        uImpulseCount: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });

    const waterMaterial = new THREE.ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: waterFragment,
      uniforms: {
        uHeight: { value: null },
        uFish: { value: null },
        uTexel: { value: new THREE.Vector2(1 / simW, 1 / simH) },
      },
      depthTest: false,
      depthWrite: false,
    });

    const simScene = new THREE.Scene();
    simScene.add(new THREE.Mesh(quad, simMaterial));
    const waterScene = new THREE.Scene();
    waterScene.add(new THREE.Mesh(quad, waterMaterial));

    // ---- window-level pointer tracking so UI overlays don't block water/fish interaction ----
    const onWinMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const x = (e.clientX - rect.left) / rect.width;
      const y = 1.0 - (e.clientY - rect.top) / rect.height;
      updatePointerUv(x, y);
    };
    window.addEventListener("pointermove", onWinMove, { passive: true });

    // ---- resize ----
    const observer = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      width = w;
      height = h;
      container_aspect.current = w / h;
      renderer.setSize(w, h);
      buildTargets();
      simMaterial.uniforms.uTexel.value.set(1 / simW, 1 / simH);
      waterMaterial.uniforms.uTexel.value.set(1 / simW, 1 / simH);
      simMaterial.uniforms.uAspect.value = w / h;
    });
    observer.observe(container);

    // ---- loop ----
    let reqId = 0;
    let lastNow = performance.now();
    const loop = (now: number) => {
      const dt = (now - lastNow) / 1000;
      lastNow = now;
      const p = pointer.current;
      const aspect = width / height;

      // clicks gently attract the koi toward the splash
      for (const c of clicks.current) school.attract((c.x * 2 - 1) * aspect, c.y * 2 - 1);
      clicks.current.length = 0;

      // koi: swim lazily, gently come closer to the hovered cursor
      school.update(dt, {
        active: p.active,
        x: (p.x * 2 - 1) * aspect,
        y: p.y * 2 - 1,
      });
      school.render(renderer, fishRT);

      // koi leave soft, smooth wakes in the water
      for (const w of school.takeWakes()) {
        impulses.current.push({
          x: (w.x / aspect + 1) / 2,
          y: (w.y + 1) / 2,
          r: 0.02,
          s: w.s,
        });
      }

      // cursor ripple proportional to full-frame pointer displacement
      let force = 0;
      if (p.moved) {
        const dx = (p.x - p.px) * aspect;
        const dy = p.y - p.py;
        const speed = Math.sqrt(dx * dx + dy * dy);
        if (speed > 0.0002) {
          force = Math.min(speed * 10.0, 1.0) * 0.085 + 0.014;
        }
        simMaterial.uniforms.uMouse.value.set(p.x, p.y);
        simMaterial.uniforms.uMousePrev.value.set(p.px, p.py);
        p.px = p.x;
        p.py = p.y;
        p.moved = false;
      }

      // hand the pending point drops to the simulation
      const pending = impulses.current.splice(0, MAX_IMPULSES);
      pending.forEach((imp, i) => impulseVecs[i].set(imp.x, imp.y, imp.r, imp.s));
      simMaterial.uniforms.uImpulseCount.value = pending.length;

      for (let i = 0; i < STEPS_PER_FRAME; i++) {
        simMaterial.uniforms.uPrev.value = rtA.texture;
        // cursor + drops are applied once per frame (first step only)
        simMaterial.uniforms.uForce.value = i === 0 ? force : 0;
        if (i === 1) simMaterial.uniforms.uImpulseCount.value = 0;
        renderer.setRenderTarget(rtB);
        renderer.render(simScene, camera);
        const t = rtA;
        rtA = rtB;
        rtB = t;
      }

      renderer.setRenderTarget(null);
      waterMaterial.uniforms.uHeight.value = rtA.texture;
      waterMaterial.uniforms.uFish.value = fishRT.texture;
      renderer.render(waterScene, camera);

      reqId = requestAnimationFrame(loop);
    };
    reqId = requestAnimationFrame(loop);

    return () => {
      disposed = true;
      window.removeEventListener("pointermove", onWinMove);
      cancelAnimationFrame(reqId);
      observer.disconnect();
      school.dispose();
      rtA.dispose();
      rtB.dispose();
      fishRT.dispose();
      quad.dispose();
      simMaterial.dispose();
      waterMaterial.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      onPointerEnter={handlePointerMove}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onPointerDown={handlePointerDown}
      onWheel={handleWheel}
      className="absolute inset-0 w-full h-full overflow-hidden touch-none"
    />
  );
}

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}
