import { decode, encodingToHex, hexToEncoding } from "../src/codec.js";
import {
  createRandomEncoding,
  createRandomCleanEncoding,
  createRandomVisibleEncoding,
} from "../src/util.js";
import PRNG, { randomSeed } from "../src/prng.js";
import {
  createRenderer,
  DEFAULT_BACKGROUND,
  renderToCanvas,
} from "../src/render.js";

const prng = PRNG("" || randomSeed());
console.log(prng.getSeed());
const SIZE = 128;
document.body.style.cssText = `
  width: 100%;
  height: 100%;
  grid-template-columns: repeat(auto-fit, minmax(${SIZE}px, 1fr));
  grid-gap: 5px;
  padding: 0px;
  box-sizing: border-box;
  display: grid;
`;

const queue = [];

for (let i = 0; i < 10; i++) {
  const encoding = createRandomCleanEncoding(prng);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", {
    colorSpace: "display-p3",
  });
  const width = SIZE * 3;
  const height = SIZE * 3;
  const container = document.createElement("div");
  container.style.cssText = `
    width: 100%;
    height: 100%;
    display: flex;
    aspect-ratio: 1;
    justify-content: center;
    align-items: center;
  `;
  canvas.width = width;
  canvas.height = height;

  canvas.onclick = () => {
    const stats = renderStats({
      encoding,
    });
    console.log(encodingToHex(encoding), stats);
  };

  queue.push(() => {
    renderToCanvas({
      hatch: true,
      width,
      height,
      encoding,
      context,
    });
  });

  canvas.style.cssText = `
    aspect-ratio: 1;
    width: ${SIZE}px;
    height: ${SIZE}px;
    box-shadow: none;
  `;
  container.appendChild(canvas);
  document.body.appendChild(container);
}

(async () => {
  for (let fn of queue) {
    fn();
    await new Promise((r) => setTimeout(r, 5));
  }
})();
