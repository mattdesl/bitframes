import ECAIterator, { PatternFillMode, StandardRules } from "./eca.js";
import {
  binaryStringToByteLE,
  byteToBinaryStringLE,
  packBitsLE,
  packNibblesLE,
  unpackBitsLE,
  unpackNibblesLE,
} from "./bits.js";

import COLOR_DATA from "./palette.js";

export const LAYER_COUNT = 5;

const GRID_SIZES = factorsOf(768, 16);

// const GLOBAL_PALETTE = [];
// for (let i = 0; i < 15; i++) {
//   GLOBAL_PALETTE.push(INIT_PALETTE[i % INIT_PALETTE.length]);
// }

// "#e9e3d5",
// export function colorOf(colorID) {
//   return colorID <= 0
//     ? null
//     : GLOBAL_PALETTE[(colorID - 1) % GLOBAL_PALETTE.length];
// }

// export function getPalette() {
//   // Colors are encoded as index=(encodedValue-1)
//   // Where an index of 0x00 means "hidden" or "transparent"
//   return INIT_PALETTE.palette.slice();
// }

// export function getBackground() {
//   return INIT_PALETTE.background;
// }

export { PatternFillMode, StandardRules };

export const FlipMode = {
  NONE: 0x00,
  HORIZONTAL: 0x01,
  VERTICAL: 0x02,
  BOTH: 0x03,
};

export const SkipMode = {
  BINARY: 0x00,
  COLUMNS: 0x01,
  SCALED_COLUMNS: 0x02,
  EQUAL: 0x03,
};

export function getPalette(colorSpace = "srgb") {
  return COLOR_DATA.map((n) => n[colorSpace]);
}

export function getColorData() {
  return COLOR_DATA.slice();
}

export function getGridSizes() {
  return GRID_SIZES.slice();
}

export function shortHex(hex) {
  return hex.slice(0, 4) + "..." + hex.slice(-4);
}

export function encodingToHex(bytes) {
  if (bytes.length !== 32) throw new Error("must be a 32 byte array");
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

export function hexToEncoding(hexString) {
  if (hexString.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hexString)) {
    throw new Error("must be a valid hexadecimal string of even length.");
  }
  const len = hexString.length / 2;
  if (len !== 32) throw new Error("encoding is not 32 bytes");
  const bytes = new Uint8Array(len);
  for (let i = 0, j = 0; i < hexString.length; i += 2, j++) {
    bytes[j] = parseInt(hexString.substr(i, 2), 16); // Parse each hex pair into a byte
  }
  return bytes;
}

export function factorsOf(num, len) {
  let factors = [];
  // Iterate through possible divisors
  for (let i = 1; i <= num / 2; i++) {
    if (num % i === 0) {
      factors.push(i);
      if (factors.length >= len) break;
    }
  }
  return factors;
}

export function constructCells(opts = {}) {
  const cells = [];
  construct(opts, (x, y, id) => cells.push([x, y, id]));
  return cells;
}

export function construct(opts = {}, cb = () => {}) {
  const { layer = {}, frame = 0, maxCells = Infinity } = opts;
  if (layer.visible === false) return;

  const [colorA, colorB] = layer.colors ?? [1, 0];

  // layer is empty, we can skip it
  if (colorA === 0 && colorB === 0) return;

  const flip = layer.flip ?? 0x00;
  const patternScale = layer.scale ?? 1;
  const dimensions = layer.dimensions ?? [0, 0];

  const [cols, rows] = dimensions.map((i) => GRID_SIZES[i]);

  const patternColumns = patternScale === 0 ? 8 : cols * patternScale;
  const cellSkip = GRID_SIZES[layer.skip ?? 0];

  let skipThreshold = 8;
  if (layer.skipMode == SkipMode.COLUMNS) skipThreshold = cols;
  else if (layer.skipMode == SkipMode.SCALED_COLUMNS)
    skipThreshold = patternColumns;
  else if (layer.skipMode == SkipMode.EQUAL) skipThreshold = cellSkip;

  const cellIterator = ECAIterator(
    typeof layer.pattern === "string"
      ? layer.pattern
      : byteToBinaryStringLE(layer.pattern),
    layer.rule,
    patternColumns,
    layer.wrap,
    layer.fill
  );

  let cellCount = 0;
  for (let i = 0, pointer = 0; i < cols * rows; ) {
    let x = Math.floor(i % cols);
    let y = Math.floor(i / cols);

    const isBitOn = cellIterator();

    let increment = 1;
    pointer++;
    if (pointer >= skipThreshold) {
      // reached end of pattern, see if we should skip ahead
      pointer = 0;
      increment = cellSkip;
    }
    const curColor = isBitOn ? colorA : colorB;
    if (curColor > 0) {
      if (flip === FlipMode.HORIZONTAL) {
        x = cols - x - 1;
      } else if (flip === FlipMode.VERTICAL) {
        y = rows - y - 1;
      } else if (flip === FlipMode.BOTH) {
        x = cols - x - 1;
        y = rows - y - 1;
      }

      let outIdx = x + y * cols;
      outIdx += frame;
      outIdx = outIdx % (cols * rows);

      x = Math.floor(outIdx % cols);
      y = Math.floor(outIdx / cols);

      cb(x, y, curColor, isBitOn);
      cellCount++;
      if (cellCount >= maxCells) {
        break;
      }
    }
    i += increment;
  }
}

export function encode(doc = {}) {
  const bytes = new Uint8Array(32);

  const layers = doc.layers || [];

  // Frame, i.e. how far to offset all the cells
  bytes[1] = Math.max(doc.frame || 0x00, 0) & 0xff;

  let offset = 2;
  for (let layer of layers) {
    // Flags
    bytes[offset++] = packBitsLE([
      [layer.visible ? 0x01 : 0x00, 1], // 1 bit
      [layer.skipMode, 2], // 2 bits
      [layer.fill, 2], // 2 bits
      [layer.flip, 2], // 2 bits
      [layer.wrap ? 0x01 : 0x00, 1], // 1 bit
    ]);
    // Colors
    bytes[offset++] = packNibblesLE(layer.colors);
    // Columns, Rows
    bytes[offset++] = packNibblesLE(layer.dimensions);
    // Pattern
    bytes[offset++] =
      typeof layer.pattern === "string"
        ? binaryStringToByteLE(layer.pattern)
        : layer.pattern;
    // ECA Rule
    bytes[offset++] = layer.rule;
    // ECA Scale and Skip Factors
    bytes[offset++] = packNibblesLE([layer.scale, layer.skip]);
  }
  return bytes;
}

export function decode(bytes) {
  if (bytes.length < 32) throw new Error("expected 32 byte array");
  if (bytes[0] !== 0) throw new Error("Expected version 0 for first byte");

  const layers = [];
  const doc = {
    layers,
    frame: bytes[1],
  };

  // start reading the layers
  let offset = 2;
  let i = 0;
  while (offset < bytes.length) {
    i++;
    const flags = unpackBitsLE(bytes[offset++], [
      ["visible", 1],
      ["skipMode", 2],
      ["fill", 2],
      ["flip", 2],
      ["wrap", 1],
    ]);

    const colorByte = bytes[offset++];

    let colors = unpackNibblesLE(colorByte);

    const dimensions = unpackNibblesLE(bytes[offset++]);
    const pattern = byteToBinaryStringLE(bytes[offset++]);
    const rule = bytes[offset++];
    const scaleAndSkip = unpackNibblesLE(bytes[offset++]);

    // Construct layer object from unpacked data
    const layer = {
      visible: flags.visible === 0x01,
      colors,
      dimensions,
      pattern,
      rule,
      scale: scaleAndSkip[0],
      skip: scaleAndSkip[1],
      skipMode: flags.skipMode,
      fill: flags.fill,
      flip: flags.flip,
      wrap: flags.wrap === 0x01,
    };

    layers.push(layer);
  }
  return doc;
}