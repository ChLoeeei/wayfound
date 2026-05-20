import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

/** Trigger a browser download for a given URL or blob URL. */
function triggerDownload(filename: string, url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/** Sanitise a title into a safe filename stem. */
export function safeFilename(title: string): string {
  return (title || 'wayfound')
    .replace(/[\s/\\?%*:|"<>]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'wayfound';
}

// html2canvas 1.x can't parse oklab()/oklch() (used by Tailwind v4).
// Modern Chrome's getComputedStyle may return those formats directly.
// We convert every color through a 2D canvas fillStyle, which the browser
// resolves to standard rgb() regardless of input color space.
const COLOR_PROPS = [
  'color',
  'background-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'text-decoration-color',
  'caret-color',
] as const;

let _colorCanvas: HTMLCanvasElement | null = null;
let _colorCtx: CanvasRenderingContext2D | null = null;

function toRgb(value: string): string {
  if (!value) return value;
  if (!_colorCanvas) {
    _colorCanvas = document.createElement('canvas');
    _colorCanvas.width = 1;
    _colorCanvas.height = 1;
    _colorCtx = _colorCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (!_colorCtx) return value;
  _colorCtx.clearRect(0, 0, 1, 1);
  _colorCtx.fillStyle = value;
  _colorCtx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = _colorCtx.getImageData(0, 0, 1, 1).data;
  return a === 255 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
}

function patchColors(root: HTMLElement): () => void {
  const backup: Array<{ el: HTMLElement; prop: string; prev: string; wasPriority: string }> = [];
  const elements = [root, ...root.querySelectorAll<HTMLElement>('*')];

  for (const el of elements) {
    const computed = getComputedStyle(el);
    for (const prop of COLOR_PROPS) {
      const raw = computed.getPropertyValue(prop);
      if (!raw) continue;
      const safe = toRgb(raw);
      backup.push({
        el,
        prop,
        prev: el.style.getPropertyValue(prop),
        wasPriority: el.style.getPropertyPriority(prop),
      });
      el.style.setProperty(prop, safe, 'important');
    }
  }

  return () => {
    for (const { el, prop, prev, wasPriority } of backup) {
      if (prev) {
        el.style.setProperty(prop, prev, wasPriority);
      } else {
        el.style.removeProperty(prop);
      }
    }
  };
}

async function captureCanvas(node: HTMLElement): Promise<HTMLCanvasElement> {
  const bgColor = getComputedStyle(document.body).backgroundColor || '#F5F2ED';
  const restore = patchColors(node);
  try {
    return await html2canvas(node, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: bgColor,
      ignoreElements: el => el.tagName === 'IFRAME' || el.tagName === 'CANVAS',
      scrollX: 0,
      scrollY: 0,
      width: node.scrollWidth,
      height: node.scrollHeight,
    });
  } finally {
    restore();
  }
}

/** Export the given DOM node as a PNG. Returns the dataURL. */
export async function exportNodeAsPng(node: HTMLElement): Promise<string> {
  const canvas = await captureCanvas(node);
  return canvas.toDataURL('image/png');
}

/** Export node as PNG and trigger download. */
export async function downloadAsPng(node: HTMLElement, title: string) {
  const dataUrl = await exportNodeAsPng(node);
  triggerDownload(`${safeFilename(title)}.png`, dataUrl);
}

/**
 * Export node as PDF: render to PNG via html2canvas, slice into A4 pages.
 * A4 portrait: 210 x 297 mm.
 */
export async function downloadAsPdf(node: HTMLElement, title: string) {
  const srcCanvas = await captureCanvas(node);

  const imgW = srcCanvas.width;
  const imgH = srcCanvas.height;

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  const scale = pageW / imgW;
  const scaledH = imgH * scale;

  if (scaledH <= pageH) {
    pdf.addImage(srcCanvas.toDataURL('image/png'), 'PNG', 0, 0, pageW, scaledH);
  } else {
    // Slice the canvas page-by-page to avoid huge single data URLs
    const pageHeightInPx = pageH / scale;
    let yOffset = 0;
    let first = true;

    while (yOffset < imgH) {
      const sliceH = Math.min(pageHeightInPx, imgH - yOffset);
      const slice = document.createElement('canvas');
      slice.width = imgW;
      slice.height = sliceH;
      const ctx = slice.getContext('2d');
      if (!ctx) break;
      ctx.drawImage(srcCanvas, 0, yOffset, imgW, sliceH, 0, 0, imgW, sliceH);
      if (!first) pdf.addPage();
      pdf.addImage(slice.toDataURL('image/png'), 'PNG', 0, 0, pageW, sliceH * scale);
      first = false;
      yOffset += sliceH;
    }
  }

  pdf.save(`${safeFilename(title)}.pdf`);
}
