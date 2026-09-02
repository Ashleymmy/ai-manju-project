import { useEffect, useRef } from "react";

/**
 * 节点生成中的像素微光罩层（移植自 PixelCard 的像素动画）：
 * - 去掉鼠标/焦点交互，pointer-events 全关；
 * - 全流程循环：散开（中心向外点亮）→ 微光呼吸保持 → 消散 → 重新散开；
 * - prefers-reduced-motion 时静态画一帧，不启动循环。
 */

class Pixel {
  private ctx: CanvasRenderingContext2D;
  private x: number;
  private y: number;
  private color: string;
  private speed: number;
  size = 0;
  private sizeStep: number;
  private minSize = 0.5;
  private maxSizeInteger = 2;
  private maxSize: number;
  private delay: number;
  private counter = 0;
  private counterStep: number;
  isShimmer = false;
  isIdle = false;
  private isReverse = false;

  constructor(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, x: number, y: number, color: string, speed: number, delay: number) {
    this.ctx = context;
    this.x = x;
    this.y = y;
    this.color = color;
    this.speed = this.random(0.1, 0.9) * speed;
    this.sizeStep = Math.random() * 0.4;
    this.maxSize = this.random(this.minSize, this.maxSizeInteger);
    this.delay = delay;
    this.counterStep = Math.random() * 4 + (canvas.width + canvas.height) * 0.01;
  }

  private random(min: number, max: number) {
    return Math.random() * (max - min) + min;
  }

  private draw() {
    const centerOffset = this.maxSizeInteger * 0.5 - this.size * 0.5;
    this.ctx.fillStyle = this.color;
    this.ctx.fillRect(this.x + centerOffset, this.y + centerOffset, this.size, this.size);
  }

  appear() {
    this.isIdle = false;
    if (this.counter <= this.delay) {
      this.counter += this.counterStep;
      return;
    }
    if (this.size >= this.maxSize) this.isShimmer = true;
    if (this.isShimmer) {
      if (this.size >= this.maxSize) this.isReverse = true;
      else if (this.size <= this.minSize) this.isReverse = false;
      this.size += this.isReverse ? -this.speed : this.speed;
    } else {
      this.size += this.sizeStep;
    }
    this.draw();
  }

  disappear() {
    this.isShimmer = false;
    this.counter = 0;
    if (this.size <= 0) {
      this.isIdle = true;
      return;
    }
    this.size -= 0.1;
    this.draw();
  }

  /** 一轮结束后重置，准备下一次散开 */
  reset() {
    this.size = 0;
    this.counter = 0;
    this.isShimmer = false;
    this.isIdle = false;
    this.isReverse = false;
  }
}

type Phase = "appear" | "hold" | "disappear";

type Props = {
  gap?: number;
  speed?: number;
  colors?: string;
  /** 微光呼吸保持时长（ms），随后进入消散 */
  holdMs?: number;
};

export default function PixelLoadingOverlay({ gap = 5, speed = 35, colors = "#ececec,#d2d2d2,#a3a3a3", holdMs = 900 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pixelsRef = useRef<Pixel[]>([]);
  const animationRef = useRef(0);
  const timePreviousRef = useRef(0);
  const phaseRef = useRef<Phase>("appear");
  const holdUntilRef = useRef(0);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const initPixels = () => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas) return;
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = width;
      canvas.height = height;

      const colorList = colors.split(",");
      const step = Math.max(2, Math.floor(gap));
      const pixels: Pixel[] = [];
      for (let x = 0; x < width; x += step) {
        for (let y = 0; y < height; y += step) {
          const color = colorList[Math.floor(Math.random() * colorList.length)];
          const dx = x - width / 2;
          const dy = y - height / 2;
          const delay = reducedMotion ? 0 : Math.sqrt(dx * dx + dy * dy);
          const effectiveSpeed = reducedMotion ? 0 : Math.min(1, Math.max(0, speed)) / 100 * 3.5;
          pixels.push(new Pixel(canvas, ctx, x, y, color, effectiveSpeed, delay));
        }
      }
      pixelsRef.current = pixels;
      phaseRef.current = "appear";
    };

    const animate = () => {
      animationRef.current = requestAnimationFrame(animate);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const now = performance.now();
      const timePassed = now - timePreviousRef.current;
      const frame = 1000 / 60;
      if (timePassed < frame) return;
      timePreviousRef.current = now - (timePassed % frame);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const pixels = pixelsRef.current;

      if (phaseRef.current === "appear") {
        let allShimmering = pixels.length > 0;
        for (const pixel of pixels) {
          pixel.appear();
          if (!pixel.isShimmer) allShimmering = false;
        }
        if (allShimmering) {
          phaseRef.current = "hold";
          holdUntilRef.current = now + holdMs;
        }
      } else if (phaseRef.current === "hold") {
        for (const pixel of pixels) pixel.appear(); // 全部已点亮，appear 即 shimmer 保持
        if (now >= holdUntilRef.current) phaseRef.current = "disappear";
      } else {
        let allIdle = true;
        for (const pixel of pixels) {
          pixel.disappear();
          if (!pixel.isIdle) allIdle = false;
        }
        if (allIdle) {
          for (const pixel of pixels) pixel.reset();
          phaseRef.current = "appear"; // 重新散开，全流程循环
        }
      }
    };

    initPixels();
    const observer = new ResizeObserver(initPixels);
    if (containerRef.current) observer.observe(containerRef.current);

    if (reducedMotion) {
      // 静态一帧：直接画满 shimmer 中态
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) {
        for (const pixel of pixelsRef.current) {
          for (let i = 0; i < 400; i++) pixel.appear();
        }
      }
    } else {
      timePreviousRef.current = performance.now();
      animationRef.current = requestAnimationFrame(animate);
    }

    return () => {
      observer.disconnect();
      cancelAnimationFrame(animationRef.current);
    };
  }, [gap, speed, colors, holdMs]);

  return (
    <div ref={containerRef} className="pixel-loading-overlay" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
