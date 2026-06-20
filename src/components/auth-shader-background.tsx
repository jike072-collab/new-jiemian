"use client";

import { useEffect, useRef } from "react";

const vertexShaderSource = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const fragmentShaderSource = `
precision mediump float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_mobile;
uniform vec2 u_pointer;
uniform float u_pointer_active;

float wave(vec2 p, float speed, float scale, float shift) {
  return sin((p.x * scale + p.y * (scale * 0.68) + u_time * speed + shift));
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float particleLayer(vec2 uv, float scale, float speed, float size, float density, float shift, float pulseStrength, float pointerPush) {
  vec2 drift = vec2(u_time * speed, u_time * speed * 0.62);
  vec2 grid = uv * scale - drift;
  vec2 cell = floor(grid);
  vec2 local = fract(grid);
  float glow = 0.0;

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 neighbor = vec2(float(x), float(y));
      vec2 seedCell = cell + neighbor + shift;
      float seed = hash12(seedCell);
      vec2 point = neighbor + hash22(seedCell + 11.7);
      vec2 worldPoint = (cell + point + drift) / scale;
      vec2 pointerVector = worldPoint - u_pointer;
      float pointerDist = length(pointerVector);
      vec2 pointerDir = pointerVector / max(pointerDist, 0.035);
      float pointerWake = smoothstep(0.24, 0.0, pointerDist) * u_pointer_active * (1.0 - u_mobile);
      point += vec2(
        sin(u_time * (0.35 + seed * 0.22) + seed * 6.2831),
        cos(u_time * (0.28 + seed * 0.2) + seed * 5.1)
      ) * 0.08 * pulseStrength;
      point += pointerDir * pointerWake * pointerPush;
      point += vec2(
        sin(u_time * (3.1 + seed * 1.1) + seed * 8.2),
        cos(u_time * (2.7 + seed * 0.9) + seed * 5.7)
      ) * pointerWake * pointerPush * 0.42;
      float visible = step(seed, density);
      float dist = length(local - point);
      float core = smoothstep(size, 0.0, dist);
      float halo = smoothstep(size * 5.4, 0.0, dist) * 0.24;
      float pulse = 0.72 + pulseStrength * 0.28 * sin(u_time * (0.78 + seed * 0.72) + seed * 6.2831);
      glow += (core + halo) * visible * (0.82 + seed * 0.42) * pulse * (1.0 + pointerWake * 0.32);
    }
  }

  return glow;
}

float flowBand(vec2 uv, float base, float lift, float amp, float freq, float phase, float thickness) {
  float x = uv.x;
  float y = base + lift * x + amp * sin(x * freq + phase + u_time * 0.18);
  y += 0.018 * sin(x * freq * 0.52 + phase * 1.8 - u_time * 0.12);
  float dist = abs(uv.y - y);
  float range = smoothstep(-0.04, 0.08, x) * (1.0 - smoothstep(0.9, 1.02, x));
  range *= smoothstep(0.02, 0.12, uv.y) * (1.0 - smoothstep(0.62, 0.78, uv.y));
  return smoothstep(thickness, 0.0, dist) * range;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 p = uv * 2.0 - 1.0;
  p.x *= u_resolution.x / u_resolution.y;
  vec2 pointerDelta = (u_pointer - 0.5) * (1.0 - u_mobile);
  vec2 parallax = pointerDelta * 0.015;
  p += parallax;

  float leftGlow = 1.0 - smoothstep(-0.78, 0.54, uv.x);
  float breath = 0.76 + 0.26 * sin(u_time * 0.42);
  float cornerBreath = 0.72 + 0.22 * sin(u_time * 0.28 + 1.4);
  float ribbonA = smoothstep(0.70, 0.96, wave(p, 0.10, 4.2 - u_mobile * 0.6, 0.4));
  float ribbonB = smoothstep(0.72, 0.97, wave(vec2(p.x * 0.82, p.y + 0.18), -0.08, 5.1 - u_mobile * 0.5, 1.8));
  float ribbonC = smoothstep(0.74, 0.98, wave(vec2(p.x * 0.68, p.y - 0.2), 0.07, 6.2 - u_mobile * 0.7, 4.2));
  float ribbon = max(max(ribbonA * 0.62, ribbonB * 0.5), ribbonC * 0.42);
  float ripple = smoothstep(0.54, 0.16, length(p - vec2(-0.62, 0.05)));
  float bridge = exp(-abs(p.y - (0.08 * sin(p.x * 2.0 + u_time * 0.12))) * 10.0) * smoothstep(-0.2, 0.58, p.x) * smoothstep(1.05, 0.2, p.x);
  float titleZone = smoothstep(0.45, 0.08, uv.x) * smoothstep(0.44, 0.70, uv.y) * smoothstep(0.98, 0.78, uv.y);
  float cardZone = smoothstep(0.58, 0.05, uv.x) * smoothstep(0.12, 0.36, uv.y) * smoothstep(0.86, 0.46, uv.y);
  float bridgeZone = smoothstep(0.38, 0.62, uv.x) * smoothstep(0.25, 0.56, uv.y) * smoothstep(0.80, 0.58, uv.y);
  float formQuiet = smoothstep(0.50, 0.74, uv.x) * smoothstep(0.10, 0.36, uv.y) * smoothstep(0.92, 0.66, uv.y);
  float particleMask = (0.34 + leftGlow * 0.62 + titleZone * 0.68 + cardZone * 0.9 + bridgeZone * 0.28) * (1.0 - formQuiet * 0.66);
  particleMask *= 1.0 - u_mobile * 0.48;
  float cornerTl = smoothstep(0.62, 0.0, length(uv - vec2(0.02, 0.98)));
  float cornerBl = smoothstep(0.70, 0.0, length(uv - vec2(0.02, 0.04)));
  float cornerTr = smoothstep(0.68, 0.0, length(uv - vec2(0.96, 0.92)));
  float cornerBr = smoothstep(0.74, 0.0, length(uv - vec2(0.94, 0.06))) * (1.0 - formQuiet * 0.65);
  float beamField = uv.x * 1.16 + uv.y * 0.52 + 0.018 * sin(u_time * 0.16 + uv.y * 4.0);
  float beamArea = smoothstep(0.74, 0.08, uv.x) * smoothstep(0.04, 0.18, uv.y) * smoothstep(1.02, 0.72, uv.y);
  float beamA = smoothstep(0.036, 0.0, abs(beamField - 0.44));
  float beamB = smoothstep(0.044, 0.0, abs(beamField - 0.68));
  float beamC = smoothstep(0.034, 0.0, abs(beamField - 0.94));
  float beamGlow = smoothstep(0.12, 0.0, abs(beamField - 0.68)) * 0.25;
  float beams = (beamA * 0.85 + beamB + beamC * 0.62 + beamGlow) * beamArea * (1.0 - u_mobile * 0.36);
  float flowA = flowBand(uv, 0.045, 0.34, 0.038, 8.0, 0.3, 0.007);
  float flowB = flowBand(uv, 0.085, 0.28, 0.035, 9.2, 2.1, 0.005);
  float flowC = flowBand(uv, 0.13, 0.2, 0.03, 7.6, 4.2, 0.006);
  float flowD = flowBand(uv, 0.02, 0.4, 0.026, 10.8, 1.5, 0.004);
  float flowGlow = flowBand(uv, 0.075, 0.3, 0.052, 7.2, 0.8, 0.035);
  float floorReflection = smoothstep(0.35, 0.02, uv.y) * smoothstep(0.0, 0.5, uv.x) * (1.0 - smoothstep(0.62, 1.0, uv.x));

  float farParticles = particleLayer(uv + pointerDelta * 0.006, 52.0 - u_mobile * 18.0, 0.016, 0.064, 0.78, 2.1, 0.42, 0.11);
  float midParticles = particleLayer(uv + pointerDelta * 0.014, 35.0 - u_mobile * 10.0, 0.034, 0.088, 0.58, 8.4, 1.0, 0.16);
  float nearParticles = particleLayer(uv + pointerDelta * 0.022, 16.0, 0.048, 0.13, 0.24, 15.8, 0.82, 0.22) * (1.0 - u_mobile);

  vec3 base = vec3(0.018, 0.016, 0.024);
  vec3 purple = vec3(0.24, 0.05, 0.42);
  vec3 magenta = vec3(0.95, 0.05, 0.38);
  vec3 pink = vec3(1.0, 0.28, 0.68);

  vec3 color = base;
  color += purple * (0.08 + leftGlow * 0.018 * breath);
  color += magenta * ribbon * (0.28 + leftGlow * 0.24);
  color += pink * ripple * 0.026 * breath;
  color += magenta * bridge * 0.035;
  color += vec3(1.0, 0.17, 0.56) * beams * 0.2 * breath;
  color += vec3(0.45, 0.18, 0.88) * beams * 0.12;
  color += vec3(1.0, 0.18, 0.54) * (flowA * 0.36 + flowD * 0.26);
  color += vec3(0.9, 0.16, 0.78) * (flowB * 0.28 + flowGlow * 0.08);
  color += vec3(0.55, 0.22, 1.0) * flowC * 0.24;
  color += vec3(1.0, 0.12, 0.46) * floorReflection * 0.05;
  color += magenta * cornerTl * 0.04 * cornerBreath;
  color += vec3(0.45, 0.12, 0.78) * cornerBl * 0.07 * cornerBreath;
  color += vec3(0.36, 0.12, 0.58) * cornerTr * 0.04 * cornerBreath;
  color += vec3(0.28, 0.06, 0.24) * cornerBr * 0.04 * cornerBreath;
  color += vec3(0.62, 0.48, 0.92) * farParticles * particleMask * 0.28;
  color += vec3(1.0, 0.23, 0.58) * midParticles * particleMask * 0.46;
  color += vec3(0.93, 0.87, 1.0) * midParticles * particleMask * 0.13;
  color += vec3(1.0, 0.78, 0.94) * nearParticles * particleMask * 0.28;
  color *= 1.0 - smoothstep(0.5, 1.18, length(p)) * 0.44;

  gl_FragColor = vec4(color, 1.0);
}
`;

function createShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export default function AuthShaderBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fallbackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const activateFallback = () => {
      fallbackRef.current?.setAttribute("data-active", "true");
    };

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) {
      activateFallback();
      return;
    }

    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      powerPreference: "low-power",
      stencil: false,
    });

    if (!gl) {
      activateFallback();
      return;
    }

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    if (!vertexShader || !fragmentShader) {
      activateFallback();
      return;
    }

    const program = gl.createProgram();
    if (!program) {
      activateFallback();
      return;
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      activateFallback();
      return;
    }
    const targetCanvas = canvas;
    const targetGl = gl;

    const positionLocation = targetGl.getAttribLocation(program, "a_position");
    const resolutionLocation = targetGl.getUniformLocation(program, "u_resolution");
    const timeLocation = targetGl.getUniformLocation(program, "u_time");
    const mobileLocation = targetGl.getUniformLocation(program, "u_mobile");
    const pointerLocation = targetGl.getUniformLocation(program, "u_pointer");
    const pointerActiveLocation = targetGl.getUniformLocation(program, "u_pointer_active");
    const buffer = targetGl.createBuffer();
    let animationFrame = 0;
    let startedAt = performance.now();
    let pointerX = 0.5;
    let pointerY = 0.5;
    let targetPointerX = 0.5;
    let targetPointerY = 0.5;
    let pointerActive = 0;
    let targetPointerActive = 0;

    targetGl.bindBuffer(targetGl.ARRAY_BUFFER, buffer);
    targetGl.bufferData(
      targetGl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      targetGl.STATIC_DRAW,
    );

    function resize() {
      const isMobile = window.innerWidth < 768;
      const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1 : 1.5);
      const width = Math.max(1, Math.floor(targetCanvas.clientWidth * dpr));
      const height = Math.max(1, Math.floor(targetCanvas.clientHeight * dpr));
      if (targetCanvas.width !== width || targetCanvas.height !== height) {
        targetCanvas.width = width;
        targetCanvas.height = height;
      }
      targetGl.viewport(0, 0, targetCanvas.width, targetCanvas.height);
    }

    function render(now: number) {
      resize();
      targetGl.useProgram(program);
      targetGl.enableVertexAttribArray(positionLocation);
      targetGl.bindBuffer(targetGl.ARRAY_BUFFER, buffer);
      targetGl.vertexAttribPointer(positionLocation, 2, targetGl.FLOAT, false, 0, 0);
      const isMobile = window.innerWidth < 768;
      const smoothing = isMobile ? 0.08 : 0.035;
      pointerX += ((isMobile ? 0.5 : targetPointerX) - pointerX) * smoothing;
      pointerY += ((isMobile ? 0.5 : targetPointerY) - pointerY) * smoothing;
      pointerActive += ((isMobile ? 0 : targetPointerActive) - pointerActive) * 0.04;
      targetGl.uniform2f(resolutionLocation, targetCanvas.width, targetCanvas.height);
      targetGl.uniform1f(timeLocation, (now - startedAt) / 1000);
      targetGl.uniform1f(mobileLocation, isMobile ? 1 : 0);
      targetGl.uniform2f(pointerLocation, pointerX, pointerY);
      targetGl.uniform1f(pointerActiveLocation, pointerActive);
      targetGl.drawArrays(targetGl.TRIANGLES, 0, 6);
      animationFrame = window.requestAnimationFrame(render);
    }

    function handlePointerMove(event: PointerEvent) {
      if (window.innerWidth < 768) return;
      targetPointerX = event.clientX / Math.max(window.innerWidth, 1);
      targetPointerY = 1 - event.clientY / Math.max(window.innerHeight, 1);
      targetPointerActive = 1;
    }

    function handlePointerLeave() {
      targetPointerActive = 0;
      targetPointerX = 0.5;
      targetPointerY = 0.5;
    }

    function handleVisibility() {
      if (document.hidden) {
        window.cancelAnimationFrame(animationFrame);
      } else {
        startedAt = performance.now();
        animationFrame = window.requestAnimationFrame(render);
      }
    }

    animationFrame = window.requestAnimationFrame(render);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerleave", handlePointerLeave);
    window.addEventListener("blur", handlePointerLeave);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerleave", handlePointerLeave);
      window.removeEventListener("blur", handlePointerLeave);
      targetGl.deleteBuffer(buffer);
      targetGl.deleteProgram(program);
      targetGl.deleteShader(vertexShader);
      targetGl.deleteShader(fragmentShader);
    };
  }, []);

  return (
    <div className="auth-shader" aria-hidden="true">
      <div ref={fallbackRef} className="auth-shader__fallback" data-active="false" />
      <canvas ref={canvasRef} className="auth-shader__canvas" />
    </div>
  );
}
