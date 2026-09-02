import type {
  CanvasAnnotationPoint,
  CanvasImageAnnotation,
} from "../domain/annotation";

export async function exportCanvasAnnotations(
  dataUrl: string,
  marks: readonly CanvasImageAnnotation[],
) {
  const image = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, image.naturalWidth || image.width);
  canvas.height = Math.max(1, image.naturalHeight || image.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法合成标注图片");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  marks.forEach((mark) => drawCanvasAnnotation(context, mark));
  return canvas.toDataURL("image/png");
}

function drawCanvasAnnotation(
  context: CanvasRenderingContext2D,
  mark: CanvasImageAnnotation,
) {
  context.save();
  context.strokeStyle = mark.color;
  context.fillStyle = mark.color;
  context.lineWidth = mark.strokeWidth;
  context.lineCap = "round";
  context.lineJoin = "round";
  if (mark.type === "rect") {
    context.strokeRect(
      mark.start.x,
      mark.start.y,
      mark.end.x - mark.start.x,
      mark.end.y - mark.start.y,
    );
  } else if (mark.type === "ellipse") {
    const centerX = (mark.start.x + mark.end.x) / 2;
    const centerY = (mark.start.y + mark.end.y) / 2;
    context.beginPath();
    context.ellipse(
      centerX,
      centerY,
      Math.abs(mark.end.x - mark.start.x) / 2,
      Math.abs(mark.end.y - mark.start.y) / 2,
      0,
      0,
      Math.PI * 2,
    );
    context.stroke();
  } else if (mark.type === "arrow") {
    drawArrow(context, mark.start, mark.end, mark.strokeWidth);
  } else if (mark.type === "brush") {
    context.beginPath();
    mark.points.forEach((point, index) => index
      ? context.lineTo(point.x, point.y)
      : context.moveTo(point.x, point.y));
    context.stroke();
  } else if (mark.type === "text") {
    context.font = `600 ${mark.fontSize}px sans-serif`;
    context.textBaseline = "alphabetic";
    context.fillText(mark.text, mark.x, mark.y);
  }
  context.restore();
}

function drawArrow(
  context: CanvasRenderingContext2D,
  start: CanvasAnnotationPoint,
  end: CanvasAnnotationPoint,
  strokeWidth: number,
) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const head = Math.max(12, strokeWidth * 3.2);
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(
    end.x - head * Math.cos(angle - Math.PI / 6),
    end.y - head * Math.sin(angle - Math.PI / 6),
  );
  context.lineTo(
    end.x - head * Math.cos(angle + Math.PI / 6),
    end.y - head * Math.sin(angle + Math.PI / 6),
  );
  context.closePath();
  context.fill();
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("标注原图读取失败"));
    image.src = source;
  });
}
