import {
  LAYER_COUNT,
  construct,
  decode,
  getPalette,
  getGridSizes,
} from "./codec.js";
import drawRoundedSegment from "./drawRoundedSegment.js";
import PRNG from "./prng.js";

// export const DEFAULT_BACKGROUND = "#e9e2d4"; // Lr=0.9, C=0.02, H=85deg
export const DEFAULT_LINE_WIDTH_FACTOR = 0.005;
export const DEFAULT_MARGIN_FACTOR = 0.1;

const lerp = (min, max, t) => min * (1 - t) + max * t;

// export const DEFAULT_BACKGROUND = getBackground();
const GRID_SIZES = getGridSizes();

function toSeed(encoding) {
  // skip first two bytes when calculating a seed
  const bytes = encoding.slice(2);
  let hex = "";
  for (let byte of bytes) {
    // Ensure each element is a valid byte
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error("each element in the array must be a byte (0-255)");
    }
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export function createRenderer(opts = {}) {
  const {
    encoding,
    width,
    height,
    hatch = true,
    hatchContours = true,
    roundSegments = 16,
    colorSpace = "srgb",
  } = opts;

  if (!encoding) throw new Error("must specify encoding");
  if (!width || !height) throw new Error("must specify width and height");

  const { layers, frame } = decode(encoding);
  const random = PRNG(toSeed(encoding));

  const palette = opts.palette ?? getPalette(colorSpace);

  const jitter = 1;
  const gauss = 0.0001;
  const minDim = Math.min(width, height);
  const gaussDim = minDim * gauss;

  const lineWidth = opts.lineWidth ?? DEFAULT_LINE_WIDTH_FACTOR * minDim;
  const margin = opts.margin ?? DEFAULT_MARGIN_FACTOR * minDim;
  const background = opts.background ?? palette[0];

  const lineJoin = hatch ? "round" : "miter";
  const lineCap = "round";

  const layerHorizontals = [];
  for (let i = 0; i < LAYER_COUNT; i++) {
    layerHorizontals.push(random.boolean());
  }

  if (opts.setup) {
    opts.setup({
      background,
      margin,
      lineCap,
      lineWidth,
      lineJoin,
      width,
      height,
      encoding,
    });
  }

  if (layers.length !== LAYER_COUNT) throw new Error("expected 5 layers");

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const horizontal = layerHorizontals[i];
    if (opts.layer) opts.layer(layer, horizontal);

    const dimensions = layer.dimensions ?? [0, 0];
    const colors = layer.colors ?? [1, 0];
    const columns = GRID_SIZES[dimensions[0]];
    const rows = GRID_SIZES[dimensions[1]];

    const hidden =
      layer.visible === false || (colors[0] === 0 && colors[1] === 0);
    if (!hidden) {
      const horizontal = layerHorizontals[i];

      // Each layer is shifted by some translation
      // To mimic the screen print process
      const [layerX, layerY] = random.insideCircle(
        random.gaussian(0, gaussDim * 10 * jitter)
      );

      // In addition, each color in the layer is also shifted when being applied
      const colorOffsetMap = Array(2)
        .fill()
        .map(() => {
          return random.insideCircle(
            random.gaussian(0, gaussDim * 10 * jitter)
          );
        });

      let cellWidth = (width - margin * 2) / columns;
      let cellHeight = (height - margin * 2) / rows;

      construct({ layer, frame }, (x, y, id, bit) => {
        const cw = cellWidth;
        const ch = cellHeight;
        let px = margin + x * cw;
        let py = margin + y * ch;

        // id should never be 0 as it infers "no color / skip" (transparent)
        // anything else is indexed into the palette though
        const color = palette[Math.max(1, Math.min(palette.length - 1, id))];

        if (opts.cell) {
          opts.cell(px, py, cw, ch, color);
        }

        if (hatch) {
          // "Bit On" == Use Foreground (color at index 0)
          const mapIndex = bit ? 0 : 1;

          const offset = colorOffsetMap[mapIndex];
          px += layerX + offset[0];
          py += layerY + offset[1];

          // mutliple shapes in this group - each line stroke
          createHighResShapeList(
            random,
            px,
            py,
            cw,
            ch,
            gaussDim,
            jitter,
            color,
            horizontal,
            lineWidth,
            hatchContours,
            roundSegments,
            opts.fill,
            opts.segment
          );
        } else {
          // a single shape in this group - just the rectangle path
          const path = toRoundedVerts(px, py, cw, ch);
          if (opts.fill) {
            opts.fill(path, color, 1);
          }
        }
      });
    }
  }
}

function createHighResShapeList(
  random,
  px,
  py,
  cellWidth,
  cellHeight,
  gaussDim,
  jitter,
  color,
  horizontal,
  lineWidth,
  hatchContours,
  roundSegments,
  fill,
  segment
) {
  const pw = cellWidth;
  const ph = cellHeight;

  let curLineWidth = random.gaussian(lineWidth, gaussDim * jitter);

  const curAxis = horizontal ? ph : pw;
  const lineCount = Math.max(1, Math.ceil(curAxis / curLineWidth));
  const fixedLineWidth = curAxis / lineCount;
  curLineWidth = Math.max(
    fixedLineWidth / 8,
    fixedLineWidth + random.gaussian(0, 2 * gaussDim * jitter)
  );

  const lineOffset = (1 * curLineWidth) / 2;
  const lineStart = (0 * curLineWidth) / 2;

  for (let i = 0; i < lineCount; i++) {
    let kx1, ky1, kx2, ky2;
    let t = lineCount <= 1 ? 0.5 : i / (lineCount - 1);
    let lace = random.gaussian(0, gaussDim * jitter);
    if (horizontal) {
      kx1 = px + lace;
      ky1 = lineStart + lerp(py + lineOffset, py + ph - lineOffset, t);
      kx2 = kx1 + pw;
      ky2 = ky1;
    } else {
      kx1 = lineStart + lerp(px + lineOffset, px + pw - lineOffset, t);
      ky1 = py + lace;
      kx2 = kx1;
      ky2 = ky1 + ph;
    }

    const alpha = Math.max(0.9, Math.min(1, random.gaussian(1, 0.1 * jitter)));

    const ac = random.insideCircle(random.gaussian(0, gaussDim * jitter));
    const bc = random.insideCircle(random.gaussian(0, gaussDim * jitter));
    const a = [kx1 + ac[0], ky1 + ac[1]];
    const b = [kx2 + bc[0], ky2 + bc[1]];

    const ellipsoid = Math.max(
      0.0,
      Math.min(0.5, random.gaussian(0.25, (0.25 / 2) * jitter))
    );

    if (hatchContours && roundSegments > 0) {
      const path = drawRoundedSegment(
        a,
        b,
        curLineWidth,
        roundSegments,
        ellipsoid
      );

      fill(path, color, alpha);
    } else {
      segment(a, b, color, alpha, curLineWidth);
    }
  }
}

function toRoundedVerts(x, y, cols, rows) {
  return [
    [x, y],
    [x + cols, y],
    [x + cols, y + rows],
    [x, y + rows],
  ].map((vertex) => vertex.map((n) => Math.round(n)));
}

export function renderToCanvas(opts = {}) {
  const { context, width, height } = opts;
  if (!context) throw new Error("must specify { context } to render to");
  createRenderer({
    ...opts,
    width,
    height,
    setup: ({ background, lineJoin, lineWidth, lineCap }) => {
      context.lineJoin = lineJoin;
      context.lineWidth = lineWidth;
      context.lineCap = lineCap;
      context.globalAlpha = 1;
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
    },
    fill: (path, color, alpha) => {
      context.fillStyle = color;
      context.globalAlpha = alpha;
      context.beginPath();
      path.forEach((p) => context.lineTo(p[0], p[1]));
      context.closePath();
      context.fill();
    },
    // cell: (x, y, w, h, color) => {
    //   context.strokeStyle = color;
    //   context.lineWidth = Math.min(width, height) * 0.001;
    //   context.strokeRect(x, y, w, h);
    // },
    segment: (a, b, color, alpha, lineWidth) => {
      context.strokeStyle = color;
      context.globalAlpha = alpha;
      context.lineWidth = lineWidth;
      context.beginPath();
      context.moveTo(a[0], a[1]);
      context.lineTo(b[0], b[1]);
      context.stroke();
    },
  });
}

function toAttrList(args) {
  return args
    .filter(Boolean)
    .map((a) => `${a[0]}=${JSON.stringify(String(a[1]))}`)
    .join(" ");
}

export function renderToSVG(opts = {}) {
  const { width, height } = opts;

  const units = "px";

  const attribs = [];
  const shapes = [];
  const layers = [];
  let layerShapes;

  createRenderer({
    ...opts,
    width,
    height,
    setup: ({ background, lineJoin, lineWidth, lineCap }) => {
      attribs.push(
        ["stroke-linejoin", lineJoin],
        ["stroke-linecap", lineCap],
        ["stroke-width", `${lineWidth}${units}`]
      );
      const rectAttribs = toAttrList([
        ["x", 0],
        ["y", 0],
        ["width", width],
        ["height", height],
        ["fill", background],
      ]);
      shapes.push(`<rect ${rectAttribs} />`);
    },
    layer: () => {
      layerShapes = [];
      layers.push(layerShapes);
    },
    fill: (path, color, alpha) => {
      const d = pathToSVGPath(path, true);
      const shape = `<path ${toAttrList([
        ["d", d],
        ["fill", color],
        ["opacity", alpha],
      ])} />`;
      layerShapes.push(shape);
    },
    segment: (a, b, color, alpha, lineWidth) => {
      const path = pathToSVGPath([a, b], false);
      const shape = `<path ${toAttrList([
        ["d", path],
        ["stroke", color],
        ["opacity", alpha],
        ["stroke-width", `${lineWidth}${units}`],
      ])} />`;
      layerShapes.push(shape);
    },
  });

  const viewWidth = width;
  const viewHeight = height;

  return [
    '<?xml version="1.0" standalone="no"?>',
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" ',
    '    "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">',
    '<svg width="' + width + units + '" height="' + height + units + '"',
    '    xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 ' +
      viewWidth +
      " " +
      viewHeight +
      '">',
    "  <g " + toAttrList(attribs) + ">",
    toShapes(shapes, 4),
    layers
      .map((shapes) => {
        return ["    <g>", toShapes(shapes, 6), "    </g>"].join("\n");
      })
      .join("\n"),
    "  </g>",
    "</svg>",
  ].join("\n");

  function toShapes(shapes, spaces = 0) {
    return shapes
      .map((s) => `${Array(spaces).fill(" ").join("")}${s}`)
      .join("\n");
  }
}

function pathToSVGPath(path, closed = false) {
  let commands = [];
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const type = i === 0 ? "M" : "L";
    commands.push(`${type}${p[0]} ${p[1]}`);
  }
  if (closed) commands.join("Z");
  return commands.join(" ");
}