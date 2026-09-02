/**
 * MetaBallOrb — 圆形悬浮球用的金属球（metaballs）动画。
 * 移植自 MetaBalls 背景动画（原实现依赖 ogl），这里用原生 WebGL2 重写，
 * 保留同款顶点/片元着色器与球体运动/鼠标跟随逻辑，不新增任何依赖。
 */
import { useEffect, useRef } from "react";

function parseHexColor(hex: string): [number, number, number] {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16) / 255;
  const g = parseInt(c.substring(2, 4), 16) / 255;
  const b = parseInt(c.substring(4, 6), 16) / 255;
  return [r, g, b];
}

function fract(x: number) {
  return x - Math.floor(x);
}

function hash31(p: number): [number, number, number] {
  const r: [number, number, number] = [fract(p * 0.1031), fract(p * 0.103), fract(p * 0.0973)];
  const dotVal = r[0] * (r[1] + 33.33) + r[1] * (r[2] + 33.33) + r[2] * (r[0] + 33.33);
  return [fract(r[0] + dotVal), fract(r[1] + dotVal), fract(r[2] + dotVal)];
}

function hash33(v: [number, number, number]): [number, number, number] {
  const p: [number, number, number] = [fract(v[0] * 0.1031), fract(v[1] * 0.103), fract(v[2] * 0.0973)];
  const dotVal = p[0] * (p[1] + 33.33) + p[1] * (p[0] + 33.33) + p[2] * (p[2] + 33.33);
  const q: [number, number, number] = [fract(p[0] + dotVal), fract(p[1] + dotVal), fract(p[2] + dotVal)];
  return [
    fract((q[0] + q[1]) * q[2]),
    fract((q[0] + q[0]) * q[1]),
    fract((q[1] + q[0]) * q[0]),
  ];
}

const MAX_BALLS = 50;

const vertexShaderSource = `#version 300 es
precision highp float;
layout(location = 0) in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragmentShaderSource = `#version 300 es
precision highp float;
uniform vec3 iResolution;
uniform float iTime;
uniform vec3 iMouse;
uniform vec3 iColor;
uniform vec3 iCursorColor;
uniform float iAnimationSize;
uniform int iBallCount;
uniform float iCursorBallSize;
uniform vec3 iMetaBalls[${MAX_BALLS}];
uniform float iClumpFactor;
uniform bool enableTransparency;
out vec4 outColor;
const float PI = 3.14159265359;

float getMetaBallValue(vec2 c, float r, vec2 p) {
  vec2 d = p - c;
  float dist2 = dot(d, d);
  return (r * r) / dist2;
}

void main() {
  vec2 fc = gl_FragCoord.xy;
  float scale = iAnimationSize / iResolution.y;
  vec2 coord = (fc - iResolution.xy * 0.5) * scale;
  vec2 mouseW = (iMouse.xy - iResolution.xy * 0.5) * scale;
  float m1 = 0.0;
  for (int i = 0; i < ${MAX_BALLS}; i++) {
    if (i >= iBallCount) break;
    m1 += getMetaBallValue(iMetaBalls[i].xy, iMetaBalls[i].z, coord);
  }
  float m2 = getMetaBallValue(mouseW, iCursorBallSize, coord);
  float total = m1 + m2;
  float f = smoothstep(-1.0, 1.0, (total - 1.3) / min(1.0, fwidth(total)));
  vec3 cFinal = vec3(0.0);
  if (total > 0.0) {
    float alpha1 = m1 / total;
    float alpha2 = m2 / total;
    cFinal = iColor * alpha1 + iCursorColor * alpha2;
  }
  outColor = vec4(cFinal * f, enableTransparency ? f : 1.0);
}
`;

export type MetaBallOrbProps = {
  className?: string;
  /** 环境球颜色（默认纯白，适配黑底） */
  color?: string;
  /** 跟随球颜色 */
  cursorBallColor?: string;
  speed?: number;
  enableMouseInteraction?: boolean;
  hoverSmoothness?: number;
  /** 动画空间尺寸：越小球体在容器里显得越大 */
  animationSize?: number;
  ballCount?: number;
  /** 聚集因子：< 1 让球群更向中心收拢 */
  clumpFactor?: number;
  cursorBallSize?: number;
  enableTransparency?: boolean;
};

export default function MetaBallOrb({
  className = "",
  color = "#ffffff",
  cursorBallColor = "#ffffff",
  speed = 0.35,
  enableMouseInteraction = true,
  hoverSmoothness = 0.06,
  animationSize = 20,
  ballCount = 10,
  clumpFactor = 0.62,
  cursorBallSize = 2.4,
  enableTransparency = true,
}: MetaBallOrbProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: false });
    if (!gl) return; // 无 WebGL2 环境时退化为纯按钮底色
    container.appendChild(canvas);
    gl.clearColor(0, 0, 0, enableTransparency ? 0 : 1);

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.warn("MetaBallOrb shader error:", gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, vertexShaderSource);
    const fs = compile(gl.FRAGMENT_SHADER, fragmentShaderSource);
    const program = gl.createProgram();
    if (!vs || !fs || !program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn("MetaBallOrb link error:", gl.getProgramInfoLog(program));
      return;
    }
    gl.useProgram(program);

    // 全屏三角（等价 ogl Triangle）
    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const loc = (name: string) => gl.getUniformLocation(program, name);
    const uResolution = loc("iResolution");
    const uTime = loc("iTime");
    const uMouse = loc("iMouse");
    const uMetaBalls = loc("iMetaBalls[0]") ?? loc("iMetaBalls");
    const [r1, g1, b1] = parseHexColor(color);
    const [r2, g2, b2] = parseHexColor(cursorBallColor);
    gl.uniform3f(loc("iColor"), r1, g1, b1);
    gl.uniform3f(loc("iCursorColor"), r2, g2, b2);
    gl.uniform1f(loc("iAnimationSize"), animationSize);
    gl.uniform1i(loc("iBallCount"), Math.min(ballCount, MAX_BALLS));
    gl.uniform1f(loc("iCursorBallSize"), cursorBallSize);
    gl.uniform1f(loc("iClumpFactor"), clumpFactor);
    gl.uniform1i(loc("enableTransparency"), enableTransparency ? 1 : 0);

    const metaBalls = new Float32Array(MAX_BALLS * 3);
    const effectiveBallCount = Math.min(ballCount, MAX_BALLS);
    const ballParams: Array<{ st: number; dtFactor: number; baseScale: number; toggle: number; radius: number }> = [];
    for (let i = 0; i < effectiveBallCount; i++) {
      const idx = i + 1;
      const h1 = hash31(idx);
      const st = h1[0] * (2 * Math.PI);
      const dtFactor = 0.1 * Math.PI + h1[1] * (0.4 * Math.PI - 0.1 * Math.PI);
      const baseScale = 5.0 + h1[1] * (10.0 - 5.0);
      const h2 = hash33(h1);
      const toggle = Math.floor(h2[0] * 2.0);
      const radius = 0.5 + h2[2] * (2.0 - 0.5);
      ballParams.push({ st, dtFactor, baseScale, toggle, radius });
    }

    const mouseBallPos = { x: 0, y: 0 };
    let pointerInside = false;
    let pointerX = 0;
    let pointerY = 0;

    const resize = () => {
      const width = container.clientWidth || 1;
      const height = container.clientHeight || 1;
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      gl.viewport(0, 0, width, height);
      gl.uniform3f(uResolution, width, height, 0);
    };
    window.addEventListener("resize", resize);
    resize();

    const onPointerMove = (event: PointerEvent) => {
      if (!enableMouseInteraction) return;
      const rect = container.getBoundingClientRect();
      pointerX = ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width;
      pointerY = (1 - (event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height;
    };
    const onPointerEnter = () => {
      if (enableMouseInteraction) pointerInside = true;
    };
    const onPointerLeave = () => {
      if (enableMouseInteraction) pointerInside = false;
    };
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerenter", onPointerEnter);
    container.addEventListener("pointerleave", onPointerLeave);

    const startTime = performance.now();
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let animationFrameId = 0;

    const drawFrame = (elapsed: number) => {
      gl.uniform1f(uTime, elapsed);
      for (let i = 0; i < effectiveBallCount; i++) {
        const p = ballParams[i];
        const dt = elapsed * speed * p.dtFactor;
        const th = p.st + dt;
        const x = Math.cos(th);
        const y = Math.sin(th + dt * p.toggle);
        metaBalls[i * 3] = x * p.baseScale * clumpFactor;
        metaBalls[i * 3 + 1] = y * p.baseScale * clumpFactor;
        metaBalls[i * 3 + 2] = p.radius;
      }
      gl.uniform3fv(uMetaBalls, metaBalls);

      let targetX: number;
      let targetY: number;
      if (pointerInside) {
        targetX = pointerX;
        targetY = pointerY;
      } else {
        const cx = canvas.width * 0.5;
        const cy = canvas.height * 0.5;
        const rx = canvas.width * 0.15;
        const ry = canvas.height * 0.15;
        targetX = cx + Math.cos(elapsed * speed) * rx;
        targetY = cy + Math.sin(elapsed * speed) * ry;
      }
      mouseBallPos.x += (targetX - mouseBallPos.x) * hoverSmoothness;
      mouseBallPos.y += (targetY - mouseBallPos.y) * hoverSmoothness;
      gl.uniform3f(uMouse, mouseBallPos.x, mouseBallPos.y, 0);

      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const update = (t: number) => {
      animationFrameId = requestAnimationFrame(update);
      drawFrame((t - startTime) * 0.001);
    };
    if (reducedMotion) {
      drawFrame(0); // 减弱动态偏好：只渲一帧静态画面
    } else {
      animationFrameId = requestAnimationFrame(update);
    }

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", resize);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerenter", onPointerEnter);
      container.removeEventListener("pointerleave", onPointerLeave);
      if (canvas.parentElement === container) container.removeChild(canvas);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(vbo);
      gl.deleteVertexArray(vao);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [
    color,
    cursorBallColor,
    speed,
    enableMouseInteraction,
    hoverSmoothness,
    animationSize,
    ballCount,
    clumpFactor,
    cursorBallSize,
    enableTransparency,
  ]);

  return <div ref={containerRef} className={`metaball-orb ${className}`} aria-hidden="true" />;
}
