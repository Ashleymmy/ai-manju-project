"use client";

export type ImageCropRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type ImageAngleTransform = {
    horizontalAngle: number;
    pitchAngle: number;
    cameraDistance: number;
    wideAngle: boolean;
    lensPreset?: ImageAngleLensPreset;
    viewPreset?: ImageAngleViewPreset;
};

export type ImageCropResizeHandle = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";

const MIN_IMAGE_CROP_SIZE = 0.06;

export function moveImageCropRect(crop: ImageCropRect, dx: number, dy: number): ImageCropRect {
    return {
        ...crop,
        x: clampImageCropValue(crop.x + dx, 0, 1 - crop.width),
        y: clampImageCropValue(crop.y + dy, 0, 1 - crop.height),
    };
}

export function resizeImageCropRect(
    crop: ImageCropRect,
    dx: number,
    dy: number,
    handle: ImageCropResizeHandle,
    locked: boolean,
    box: Pick<DOMRect, "width" | "height">,
): ImageCropRect {
    let next = { ...crop };
    if (handle.includes("e")) next.width = crop.width + dx;
    if (handle.includes("s")) next.height = crop.height + dy;
    if (handle.includes("w")) {
        next.x = crop.x + dx;
        next.width = crop.width - dx;
    }
    if (handle.includes("n")) {
        next.y = crop.y + dy;
        next.height = crop.height - dy;
    }
    if (locked) {
        const size = Math.max(next.width * box.width, next.height * box.height);
        next.width = size / box.width;
        next.height = size / box.height;
        if (handle.includes("w")) next.x = crop.x + crop.width - next.width;
        if (handle.includes("n")) next.y = crop.y + crop.height - next.height;
    }
    next.width = clampImageCropValue(next.width, MIN_IMAGE_CROP_SIZE, 1);
    next.height = clampImageCropValue(next.height, MIN_IMAGE_CROP_SIZE, 1);
    next.x = clampImageCropValue(next.x, 0, 1 - next.width);
    next.y = clampImageCropValue(next.y, 0, 1 - next.height);
    return next;
}

export type ImageUpscaleAlgorithm = "nearest" | "bilinear" | "high";
export type ImageFlipDirection = "horizontal" | "vertical";
export type ImageAngleLensPreset = "wide" | "standard" | "telephoto";
export type ImageAngleViewPreset = "front" | "front-left" | "front-right" | "side-left" | "side-right" | "back" | "top" | "low";

export const MAX_UPSCALE_LONG_EDGE = 4096;

export type ImageUpscaleParams = {
    targetLongEdge: number;
    algorithm: ImageUpscaleAlgorithm;
};

export type ImageSplitParams = {
    rows: number;
    columns: number;
};

export type ImageSplitPiece = {
    row: number;
    column: number;
    dataUrl: string;
};

export type StoryboardLayout = "grid-2x2" | "grid-3x3" | "strip-horizontal" | "strip-vertical";

export type StoryboardFrame = {
    dataUrl: string;
    title?: string;
    note?: string;
};

export type OutpaintMargins = {
    top: number;
    right: number;
    bottom: number;
    left: number;
};

export async function cropDataUrl(dataUrl: string, crop?: ImageCropRect) {
    const image = await loadImage(dataUrl);
    if (crop) {
        return drawCrop(image, Math.floor(crop.x * image.width), Math.floor(crop.y * image.height), Math.ceil(crop.width * image.width), Math.ceil(crop.height * image.height));
    }
    const size = Math.min(image.width, image.height);
    const sx = Math.max(0, Math.floor((image.width - size) / 2));
    const sy = Math.max(0, Math.floor((image.height - size) / 2));
    return drawCrop(image, sx, sy, size, size);
}

export async function splitDataUrl(dataUrl: string, params: ImageSplitParams): Promise<ImageSplitPiece[]> {
    const image = await loadImage(dataUrl);
    const rows = Math.max(1, Math.floor(params.rows));
    const columns = Math.max(1, Math.floor(params.columns));
    const pieces: ImageSplitPiece[] = [];

    for (let row = 0; row < rows; row += 1) {
        const sy = Math.floor((row * image.height) / rows);
        const sh = Math.floor(((row + 1) * image.height) / rows) - sy;
        for (let column = 0; column < columns; column += 1) {
            const sx = Math.floor((column * image.width) / columns);
            const sw = Math.floor(((column + 1) * image.width) / columns) - sx;
            pieces.push({ row, column, dataUrl: drawCrop(image, sx, sy, sw, sh) });
        }
    }

    return pieces;
}

function clampImageCropValue(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

export async function flipDataUrl(dataUrl: string, direction: ImageFlipDirection) {
    const image = await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, image.width);
    canvas.height = Math.max(1, image.height);
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;
    context.save();
    if (direction === "horizontal") {
        context.translate(canvas.width, 0);
        context.scale(-1, 1);
    } else {
        context.translate(0, canvas.height);
        context.scale(1, -1);
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    context.restore();
    return canvas.toDataURL("image/png");
}

export async function createOutpaintSourceDataUrl(dataUrl: string, margins: OutpaintMargins) {
    const image = await loadImage(dataUrl);
    const left = Math.max(0, Math.round(margins.left * image.width));
    const right = Math.max(0, Math.round(margins.right * image.width));
    const top = Math.max(0, Math.round(margins.top * image.height));
    const bottom = Math.max(0, Math.round(margins.bottom * image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, image.width + left + right);
    canvas.height = Math.max(1, image.height + top + bottom);
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, left, top, image.width, image.height);
    return canvas.toDataURL("image/png");
}

export async function createOutpaintMaskDataUrl(dataUrl: string, margins: OutpaintMargins) {
    const image = await loadImage(dataUrl);
    const left = Math.max(0, Math.round(margins.left * image.width));
    const right = Math.max(0, Math.round(margins.right * image.width));
    const top = Math.max(0, Math.round(margins.top * image.height));
    const bottom = Math.max(0, Math.round(margins.bottom * image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, image.width + left + right);
    canvas.height = Math.max(1, image.height + top + bottom);
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(255,255,255,1)";
    context.fillRect(left, top, image.width, image.height);
    return canvas.toDataURL("image/png");
}

export async function composeStoryboardDataUrl(frames: StoryboardFrame[], layout: StoryboardLayout) {
    const loaded = await Promise.all(frames.map(async (frame) => ({ ...frame, image: await loadImage(frame.dataUrl) })));
    const capped = loaded.slice(0, layout === "grid-3x3" ? 9 : layout === "grid-2x2" ? 4 : 6);
    if (!capped.length) throw new Error("No frames to export");

    const template = storyboardTemplate(layout, capped.length);
    const cellWidth = template.cellWidth;
    const cellHeight = template.cellHeight;
    const captionHeight = template.captionHeight;
    const padding = 32;
    const gap = 18;
    const canvas = document.createElement("canvas");
    canvas.width = padding * 2 + template.columns * cellWidth + (template.columns - 1) * gap;
    canvas.height = padding * 2 + template.rows * (cellHeight + captionHeight) + (template.rows - 1) * gap;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is not available");

    context.fillStyle = "#111318";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.font = "600 24px sans-serif";
    context.textBaseline = "top";

    capped.forEach((frame, index) => {
        const column = index % template.columns;
        const row = Math.floor(index / template.columns);
        const x = padding + column * (cellWidth + gap);
        const y = padding + row * (cellHeight + captionHeight + gap);
        drawContainedImage(context, frame.image, x, y, cellWidth, cellHeight);
        context.strokeStyle = "rgba(255,255,255,0.18)";
        context.lineWidth = 2;
        context.strokeRect(x, y, cellWidth, cellHeight);
        context.fillStyle = "rgba(255,255,255,0.92)";
        context.font = "700 22px sans-serif";
        context.fillText(frame.title || `Shot ${index + 1}`, x, y + cellHeight + 12, cellWidth);
        context.fillStyle = "rgba(255,255,255,0.66)";
        context.font = "400 16px sans-serif";
        wrapCanvasText(context, frame.note || "", x, y + cellHeight + 42, cellWidth, 21, 2);
    });

    return canvas.toDataURL("image/png");
}

export async function transformAngleDataUrl(dataUrl: string, params: ImageAngleTransform) {
    const image = await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    const padding = Math.round(Math.max(image.width, image.height) * 0.18);
    canvas.width = image.width + padding * 2;
    canvas.height = image.height + padding * 2;
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;
    context.clearRect(0, 0, canvas.width, canvas.height);

    const horizontal = params.horizontalAngle / 180;
    const pitch = params.pitchAngle / 90;
    const distanceScale = 1.12 - params.cameraDistance * 0.035;
    const lens = params.lensPreset || (params.wideAngle ? "wide" : "standard");
    const wideScale = lens === "wide" ? 0.86 : lens === "telephoto" ? 1.08 : 1;
    const scale = Math.max(0.64, Math.min(1.1, distanceScale * wideScale));
    const width = image.width * scale * (1 - Math.abs(horizontal) * 0.28);
    const height = image.height * scale * (1 - Math.abs(pitch) * 0.18);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const skewX = horizontal * image.width * 0.18;
    const skewY = pitch * image.height * 0.12;
    const x = cx - width / 2 + horizontal * padding * 0.5;
    const y = cy - height / 2 + pitch * padding * 0.45;

    context.save();
    context.setTransform(1, pitch * 0.08, horizontal * -0.1, 1, 0, 0);
    context.drawImage(image, x + skewX, y + skewY, width, height);
    context.restore();

    if (params.wideAngle) {
        const gradient = context.createRadialGradient(cx, cy, Math.min(canvas.width, canvas.height) * 0.2, cx, cy, Math.max(canvas.width, canvas.height) * 0.62);
        gradient.addColorStop(0, "rgba(255,255,255,0)");
        gradient.addColorStop(1, "rgba(0,0,0,0.18)");
        context.fillStyle = gradient;
        context.fillRect(0, 0, canvas.width, canvas.height);
    }

    return canvas.toDataURL("image/png");
}

export async function upscaleDataUrl(dataUrl: string, params: ImageUpscaleParams) {
    const image = await loadImage(dataUrl);
    const { width, height } = resolveUpscaleSize(image.width, image.height, params.targetLongEdge);
    return params.algorithm === "high" ? drawStepUpscale(image, width, height) : drawResize(image, image.width, image.height, width, height, params.algorithm);
}

export type ImageCompressionFormat = "image/jpeg" | "image/webp";

export type ImageCompressionParams = {
    format: ImageCompressionFormat;
    quality: number;
    maxDimension: number;
    targetBytes?: number;
};

export type ImageCompressionResult = {
    dataUrl: string;
    width: number;
    height: number;
    bytes: number;
    sourceBytes: number;
    quality: number;
    format: ImageCompressionFormat;
};

const MIN_COMPRESSION_QUALITY = 0.3;
const MIN_COMPRESSION_LONG_EDGE = 512;
const MAX_COMPRESSION_PASSES = 5;

export async function compressDataUrl(dataUrl: string, params: ImageCompressionParams): Promise<ImageCompressionResult> {
    const image = await loadImage(dataUrl);
    const sourceWidth = Math.max(1, image.naturalWidth || image.width);
    const sourceHeight = Math.max(1, image.naturalHeight || image.height);
    const sourceLongEdge = Math.max(sourceWidth, sourceHeight);
    const maxDimension = Math.max(MIN_COMPRESSION_LONG_EDGE, Math.round(params.maxDimension || sourceLongEdge));
    const initialScale = Math.min(1, maxDimension / sourceLongEdge);
    let width = Math.max(1, Math.round(sourceWidth * initialScale));
    let height = Math.max(1, Math.round(sourceHeight * initialScale));
    const requestedQuality = clampCompressionQuality(params.quality);
    const targetBytes = Math.max(0, Math.round(params.targetBytes || 0));
    let quality = requestedQuality;
    let dataUrlResult = encodeCompressedImage(image, width, height, params.format, quality);
    let bytes = dataUrlByteSize(dataUrlResult);

    for (let pass = 0; targetBytes > 0 && bytes > targetBytes && pass < MAX_COMPRESSION_PASSES; pass += 1) {
        let low = MIN_COMPRESSION_QUALITY;
        let high = quality;
        let best = { dataUrl: dataUrlResult, bytes, quality };
        for (let iteration = 0; iteration < 7; iteration += 1) {
            const candidateQuality = (low + high) / 2;
            const candidateDataUrl = encodeCompressedImage(image, width, height, params.format, candidateQuality);
            const candidateBytes = dataUrlByteSize(candidateDataUrl);
            if (candidateBytes <= targetBytes) {
                best = { dataUrl: candidateDataUrl, bytes: candidateBytes, quality: candidateQuality };
                low = candidateQuality;
            } else {
                if (candidateBytes < best.bytes) best = { dataUrl: candidateDataUrl, bytes: candidateBytes, quality: candidateQuality };
                high = candidateQuality;
            }
        }
        dataUrlResult = best.dataUrl;
        bytes = best.bytes;
        quality = best.quality;
        if (bytes <= targetBytes || Math.max(width, height) <= MIN_COMPRESSION_LONG_EDGE) break;
        const shrink = Math.max(0.65, Math.min(0.9, Math.sqrt(targetBytes / Math.max(1, bytes))));
        width = Math.max(1, Math.round(width * shrink));
        height = Math.max(1, Math.round(height * shrink));
        quality = requestedQuality;
        dataUrlResult = encodeCompressedImage(image, width, height, params.format, quality);
        bytes = dataUrlByteSize(dataUrlResult);
    }

    return {
        dataUrl: dataUrlResult,
        width,
        height,
        bytes,
        sourceBytes: dataUrlByteSize(dataUrl),
        quality,
        format: params.format,
    };
}

function encodeCompressedImage(image: HTMLImageElement, width: number, height: number, format: ImageCompressionFormat, quality: number) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is not available");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    if (format === "image/jpeg") {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
    }
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL(format, clampCompressionQuality(quality));
}

function clampCompressionQuality(value: number) {
    return Math.max(MIN_COMPRESSION_QUALITY, Math.min(0.95, Number.isFinite(value) ? value : 0.82));
}

function dataUrlByteSize(dataUrl: string) {
    const base64 = dataUrl.split(",", 2)[1] || "";
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}
function storyboardTemplate(layout: StoryboardLayout, count: number) {
    if (layout === "grid-3x3") return { columns: 3, rows: 3, cellWidth: 360, cellHeight: 260, captionHeight: 78 };
    if (layout === "grid-2x2") return { columns: 2, rows: 2, cellWidth: 480, cellHeight: 330, captionHeight: 78 };
    if (layout === "strip-vertical") return { columns: 1, rows: count, cellWidth: 540, cellHeight: 300, captionHeight: 82 };
    return { columns: count, rows: 1, cellWidth: 360, cellHeight: 240, captionHeight: 82 };
}

function drawContainedImage(context: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) {
    context.fillStyle = "#050609";
    context.fillRect(x, y, width, height);
    const scale = Math.min(width / Math.max(1, image.width), height / Math.max(1, image.height));
    const targetWidth = image.width * scale;
    const targetHeight = image.height * scale;
    context.drawImage(image, x + (width - targetWidth) / 2, y + (height - targetHeight) / 2, targetWidth, targetHeight);
}

function wrapCanvasText(context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines: number) {
    const words = text.trim().split(/\s+/).filter(Boolean);
    let line = "";
    let lines = 0;
    for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (context.measureText(next).width > maxWidth && line) {
            context.fillText(line, x, y + lines * lineHeight, maxWidth);
            lines += 1;
            line = word;
            if (lines >= maxLines) return;
        } else {
            line = next;
        }
    }
    if (line && lines < maxLines) context.fillText(line, x, y + lines * lineHeight, maxWidth);
}

export async function conformDataUrlToSize(dataUrl: string, size?: string) {
    const target = parseTargetSize(size);
    if (!target) return dataUrl;
    try {
        const image = await loadImage(dataUrl);
        if (image.width === target.width && image.height === target.height) return dataUrl;
        const imageRatio = image.width / Math.max(1, image.height);
        const targetRatio = target.width / Math.max(1, target.height);
        let sx = 0;
        let sy = 0;
        let sw = image.width;
        let sh = image.height;
        if (imageRatio > targetRatio) {
            sw = Math.max(1, Math.round(image.height * targetRatio));
            sx = Math.max(0, Math.floor((image.width - sw) / 2));
        } else if (imageRatio < targetRatio) {
            sh = Math.max(1, Math.round(image.width / targetRatio));
            sy = Math.max(0, Math.floor((image.height - sh) / 2));
        }
        return drawCropResize(image, sx, sy, sw, sh, target.width, target.height);
    } catch {
        return dataUrl;
    }
}

export function resolveUpscaleSize(width: number, height: number, targetLongEdge: number) {
    const sourceWidth = Number.isFinite(width) && width > 0 ? width : 1;
    const sourceHeight = Number.isFinite(height) && height > 0 ? height : 1;
    const longEdge = Math.max(sourceWidth, sourceHeight);
    const requestedLongEdge = Number.isFinite(targetLongEdge) && targetLongEdge > 0
        ? Math.round(targetLongEdge)
        : longEdge;
    const target = Math.min(MAX_UPSCALE_LONG_EDGE, Math.max(1, requestedLongEdge));
    const scale = target / longEdge;
    return {
        width: Math.max(1, Math.round(sourceWidth * scale)),
        height: Math.max(1, Math.round(sourceHeight * scale)),
    };
}

function drawCrop(image: HTMLImageElement, sx: number, sy: number, sw: number, sh: number) {
    return drawCropResize(image, sx, sy, sw, sh, Math.max(1, sw), Math.max(1, sh));
}

function drawCropResize(image: HTMLImageElement, sx: number, sy: number, sw: number, sh: number, width: number, height: number) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    const context = canvas.getContext("2d");
    if (!context) return image.src;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
}

function drawStepUpscale(image: HTMLImageElement, width: number, height: number) {
    let source: CanvasImageSource = image;
    let sourceWidth = image.width;
    let sourceHeight = image.height;

    while (sourceWidth * 2 < width && sourceHeight * 2 < height) {
        const nextWidth = sourceWidth * 2;
        const nextHeight = sourceHeight * 2;
        const next = drawResizeCanvas(source, sourceWidth, sourceHeight, nextWidth, nextHeight, "high");
        source = next;
        sourceWidth = nextWidth;
        sourceHeight = nextHeight;
    }

    return drawResize(source, sourceWidth, sourceHeight, width, height, "high");
}

function drawResize(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, width: number, height: number, algorithm: ImageUpscaleAlgorithm) {
    return drawResizeCanvas(source, sourceWidth, sourceHeight, width, height, algorithm).toDataURL("image/png");
}

function drawResizeCanvas(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, width: number, height: number, algorithm: ImageUpscaleAlgorithm) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return canvas;
    context.imageSmoothingEnabled = algorithm !== "nearest";
    context.imageSmoothingQuality = algorithm === "bilinear" ? "medium" : "high";
    context.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
    return canvas;
}

function loadImage(dataUrl: string) {
    return new Promise<HTMLImageElement>((resolve) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.src = dataUrl;
    });
}

function parseTargetSize(size?: string) {
    const value = size?.trim();
    if (!value || value.toLowerCase() === "auto") return null;
    const dimensions = value.match(/^(\d+)x(\d+)$/);
    if (dimensions) return { width: Number(dimensions[1]), height: Number(dimensions[2]) };
    const ratio = value.match(/^(\d+):(\d+)$/);
    if (!ratio) return null;
    const widthRatio = Number(ratio[1]);
    const heightRatio = Number(ratio[2]);
    if (!Number.isFinite(widthRatio) || !Number.isFinite(heightRatio) || widthRatio <= 0 || heightRatio <= 0) return null;
    const shortSide = 1024;
    const longSide = Math.round((shortSide * Math.max(widthRatio, heightRatio)) / Math.min(widthRatio, heightRatio) / 16) * 16;
    return widthRatio >= heightRatio ? { width: longSide, height: shortSide } : { width: shortSide, height: longSide };
}
