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

float particleLayer(vec2 uv, float scale, float speed, float size, float density, float shift) {
  vec2 grid = uv * scale - vec2(u_time * speed, u_time * speed * 0.62);
  vec2 cell = floor(grid);
  vec2 local = fract(grid);
  float glow = 0.0;

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 neighbor = vec2(float(x), float(y));
      vec2 seedCell = cell + neighbor + shift;
      float seed = hash12(seedCell);
      vec2 point = neighbor + hash22(seedCell + 11.7);
      float visible = step(seed, density);
      float dist = length(local - point);
      float core = smoothstep(size, 0.0, dist);
      float halo = smoothstep(size * 4.0, 0.0, dist) * 0.18;
      glow += (core + halo) * visible * (0.72 + seed * 0.34);
    }
  }

  return glow;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 p = uv * 2.0 - 1.0;
  p.x *= u_resolution.x / u_resolution.y;
  vec2 parallax = (u_pointer - 0.5) * 0.007 * (1.0 - u_mobile);
  p += parallax;

  float leftGlow = 1.0 - smoothstep(-0.85, 0.88, uv.x);
  float breath = 0.72 + 0.18 * sin(u_time * 0.36);
  float ribbonA = wave(p, 0.10, 3.8 - u_mobile * 0.6, 0.4);
  float ribbonB = wave(vec2(p.x * 0.72, p.y + 0.18), -0.08, 4.6 - u_mobile * 0.5, 1.8);
  float ribbon = smoothstep(0.50, 0.95, ribbonA * 0.54 + ribbonB * 0.46);
  float ripple = smoothstep(0.82, 0.2, length(p - vec2(-0.62, 0.05)));
  float bridge = exp(-abs(p.y - (0.08 * sin(p.x * 2.0 + u_time * 0.12))) * 10.0) * smoothstep(-0.2, 0.58, p.x) * smoothstep(1.05, 0.2, p.x);
  float titleZone = smoothstep(0.45, 0.08, uv.x) * smoothstep(0.44, 0.70, uv.y) * smoothstep(0.98, 0.78, uv.y);
  float cardZone = smoothstep(0.58, 0.05, uv.x) * smoothstep(0.12, 0.36, uv.y) * smoothstep(0.86, 0.46, uv.y);
  float formQuiet = smoothstep(0.52, 0.78, uv.x) * smoothstep(0.12, 0.42, uv.y) * smoothstep(0.92, 0.62, uv.y);
  float particleMask = (0.22 + leftGlow * 0.42 + titleZone * 0.44 + cardZone * 0.68) * (1.0 - formQuiet * 0.74);
  particleMask *= 1.0 - u_mobile * 0.62;

  float farParticles = particleLayer(uv + parallax * 0.22, 38.0 - u_mobile * 14.0, 0.010, 0.038, 0.50, 2.1);
  float midParticles = particleLayer(uv + parallax * 0.46, 25.0 - u_mobile * 8.0, 0.017, 0.052, 0.34, 8.4);
  float nearParticles = particleLayer(uv + parallax * 0.72, 13.0, 0.025, 0.075, 0.16, 15.8) * (1.0 - u_mobile);

  vec3 base = vec3(0.018, 0.016, 0.024);
  vec3 purple = vec3(0.24, 0.05, 0.42);
  vec3 magenta = vec3(0.95, 0.05, 0.38);
  vec3 pink = vec3(1.0, 0.28, 0.68);

  vec3 color = base;
  color += purple * (0.22 + leftGlow * 0.24 * breath);
  color += magenta * ribbon * (0.12 + leftGlow * 0.18);
  color += pink * ripple * 0.07 * breath;
  color += magenta * bridge * 0.035;
  color += vec3(0.66, 0.56, 0.88) * farParticles * particleMask * 0.14;
  color += vec3(1.0, 0.32, 0.72) * midParticles * particleMask * 0.20;
  color += vec3(1.0, 0.78, 0.94) * nearParticles * particleMask * 0.13;
  color *= 1.0 - smoothstep(0.5, 1.18, length(p)) * 0.58;

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
    const buffer = targetGl.createBuffer();
    let animationFrame = 0;
    let startedAt = performance.now();
    let pointerX = 0.5;
    let pointerY = 0.5;
    let targetPointerX = 0.5;
    let targetPointerY = 0.5;

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
      targetGl.uniform2f(resolutionLocation, targetCanvas.width, targetCanvas.height);
      targetGl.uniform1f(timeLocation, (now - startedAt) / 1000);
      targetGl.uniform1f(mobileLocation, isMobile ? 1 : 0);
      targetGl.uniform2f(pointerLocation, pointerX, pointerY);
      targetGl.drawArrays(targetGl.TRIANGLES, 0, 6);
      animationFrame = window.requestAnimationFrame(render);
    }

    function handlePointerMove(event: PointerEvent) {
      if (window.innerWidth < 768) return;
      targetPointerX = event.clientX / Math.max(window.innerWidth, 1);
      targetPointerY = 1 - event.clientY / Math.max(window.innerHeight, 1);
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

    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", handlePointerMove);
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
