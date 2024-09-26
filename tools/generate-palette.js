import * as Color from "@texel/color";

const K1 = 0.206;
const K2 = 0.03;
const K3 = (1.0 + K1) / (1.0 + K2);

const LToLr = (x) =>
  0.5 *
  (K3 * x - K1 + Math.sqrt((K3 * x - K1) * (K3 * x - K1) + 4 * K2 * K3 * x));

const LrToL = (x) => (x ** 2 + K1 * x) / (K3 * (x + K2));

const DECIMAL_PLACES = 10; // for Display P3 gamuts
const maxChroma = 0.225; // max chroma for all colors across all spaces

const primariesLHData = [
  ["black", [0, 0, 0]],
  ["white", [1, 0, 0]],
  ["gray", [0.65, 0, 0]],
  ["red", [0.5, 30]], // red
  ["orange", [0.68, 55]], // orange
  ["brown", [0.465, 60]], // brown
  ["yellow", [0.85, 95]], // yellow
  ["green", [0.55, 145]], // green
  ["teal", [0.7, 175]], // teal, 0.7 or 0.55 L
  ["dark blue", [0.3, 220]],
  ["light blue", [0.55, 255]], // light blue
  ["indigo", [0.4, 270]], // indigo
  ["purple", [0.4, 310]], // purple
  ["light pink", [0.85, 325]], // light pink
  ["hot pink", [0.75, 345]], // hot pink
];

// Supported: srgb, display-p3, rec2020, a98-rgb
const colorSpace = "srgb";

const gamut = Color.listColorGamuts().find((n) => n.space.id === colorSpace);
console.error("Color Space:", gamut.space.id);

const colors = primariesLHData.map(([name, coords]) => {
  const [Lr, H, C = maxChroma] = coords;

  // Convert OKLr to OKL
  // We use a different lightness estimate for these colors
  // that is more suited for a fixed range with a known whitepoint
  // this is also the lightness estimate used by OKHSL and is closer to CIELAB

  // Gamut map with a constant L
  // This is equivalent to fully saturating the coordinate
  // by projecting it along chroma axis until it either hits the target C value,
  // or the boundary of the target gamut, whichever comes first

  return toColorData(name, Lr, C, H);
});

function toColorData(name, Lr, C, H) {
  const oklch = [LrToL(Lr), C, H];
  return {
    name,
    oklrch: [Lr, C, H],
    "display-p3": RGBToString(
      Color.gamutMapOKLCH(
        oklch,
        Color.DisplayP3Gamut,
        Color.DisplayP3,
        undefined,
        Color.MapToL
      ),
      Color.DisplayP3
    ),
    srgb: RGBToString(
      Color.gamutMapOKLCH(
        oklch,
        Color.sRGBGamut,
        Color.sRGB,
        undefined,
        Color.MapToL
      ),
      Color.sRGB
    ),
  };
}

colors.unshift(toColorData("background", 0.9, 0.02, 85));

const palette = colors;

console.log(`/**
 * Auto-generated palette data, from 16 OKLrCH primaries. Generated by tools/generate-palette.js.
 **/`);
console.log(`export default ${JSON.stringify(palette, null, 2)}`);

function roundN(value, digits) {
  var tenToN = 10 ** digits;
  return Math.round(value * tenToN) / tenToN;
}

function RGBToString(rgb, space) {
  return space.id === "srgb"
    ? Color.RGBToHex(rgb)
    : Color.serialize(
        rgb.map((n) => roundN(n, DECIMAL_PLACES)),
        space
      );
}
