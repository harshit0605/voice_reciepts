// Draws the app icon: the in-app logo (white stacked layers on the brand teal).
// Run: node scripts/make-app-icons.mjs  (writes apps/mobile/assets/*.png)
import sharp from "sharp";
const teal = "#146D5A";
// Three stacked layers: a filled top sheet and two open chevrons beneath it.
const layers = (scale, dx = 0, dy = 0) => `
  <g transform="translate(${512 + dx} ${512 + dy}) scale(${scale})" fill="none" stroke="#fff" stroke-width="44" stroke-linejoin="round" stroke-linecap="round">
    <path d="M0 -250 L300 -95 L0 60 L-300 -95 Z" fill="#fff"/>
    <path d="M-300 20 L0 175 L300 20"/>
    <path d="M-300 135 L0 290 L300 135"/>
  </g>`;
const svg = (body, background) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">${background ?? ""}${body}</svg>`,
  );
await sharp(
  svg(layers(1, 0, -20), `<rect width="1024" height="1024" fill="${teal}"/>`),
)
  .png()
  .toFile("apps/mobile/assets/icon.png");
// Android crops adaptive icons to a circle or squircle: keep the mark inside the middle 66%.
await sharp(svg(layers(0.62, 0, -12)))
  .png()
  .toFile("apps/mobile/assets/adaptive-icon.png");
console.log("icons written");
