// Generates Enercore's bundled meeting backgrounds: original, illustrated,
// softly blurred office scenes (no people, no logos, no licensed photos).
// Run once when changing them: node scripts/generate-meeting-backgrounds.mjs
// Output (committed): public/meetings/backgrounds/<id>.jpg (1280×720) and
// <id>-thumb.jpg (192×108).
import { chromium } from "@playwright/test";

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (list) => list[Math.floor(rand() * list.length)];
const W = 1280, H = 720;
const wrap = (defs, body, blur) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>${defs}<filter id="dof" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="${blur}"/></filter></defs>
<g filter="url(#dof)">${body}</g></svg>`;

function modernOffice() {
  let panes = "";
  for (let i = 0; i < 6; i++) panes += `<rect x="${120 + i * 175}" y="70" width="160" height="420" fill="url(#sky)"/>`;
  let towers = "";
  for (let i = 0; i < 14; i++) { const h = 80 + rand() * 180; towers += `<rect x="${110 + i * 78}" y="${490 - h}" width="${50 + rand() * 30}" height="${h}" fill="#b9c6cf" opacity="${0.35 + rand() * 0.3}"/>`; }
  return wrap(`<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dfe9f1"/><stop offset="1" stop-color="#f4f6f7"/></linearGradient>
  <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9c2b8"/><stop offset="1" stop-color="#a99f93"/></linearGradient>`,
  `<rect width="${W}" height="${H}" fill="#eceae6"/>${panes}${towers}
  <rect x="100" y="60" width="1080" height="440" fill="none" stroke="#5b6166" stroke-width="10"/>
  ${[1,2,3,4,5].map((i) => `<rect x="${108 + i * 175}" y="60" width="12" height="440" fill="#5b6166"/>`).join("")}
  <rect y="500" width="${W}" height="220" fill="url(#floor)"/>
  <rect x="0" y="490" width="${W}" height="14" fill="#8d8479"/>
  <ellipse cx="1120" cy="560" rx="70" ry="120" fill="#5f7d5a"/><ellipse cx="1080" cy="520" rx="50" ry="90" fill="#6f8f68"/><rect x="1085" y="600" width="70" height="90" rx="8" fill="#e8e3dc"/>
  <rect x="160" y="560" width="420" height="22" rx="6" fill="#6b5a4a"/><rect x="190" y="582" width="16" height="120" fill="#4d4038"/><rect x="530" y="582" width="16" height="120" fill="#4d4038"/>`, 7);
}

function conferenceRoom() {
  let slats = "";
  for (let i = 0; i < 40; i++) slats += `<rect x="${i * 32}" y="0" width="22" height="470" fill="${pick(["#8a6a4f", "#94735a", "#7f614a"])}"/>`;
  let lights = "";
  for (let i = 0; i < 3; i++) lights += `<line x1="${340 + i * 300}" y1="0" x2="${340 + i * 300}" y2="150" stroke="#2f3438" stroke-width="3"/><ellipse cx="${340 + i * 300}" cy="165" rx="70" ry="18" fill="#2f3438"/><ellipse cx="${340 + i * 300}" cy="180" rx="90" ry="30" fill="#fff4d6" opacity="0.55"/>`;
  return wrap(`<linearGradient id="fl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b4046"/><stop offset="1" stop-color="#23272b"/></linearGradient>`,
  `<rect width="${W}" height="${H}" fill="#6e5440"/>${slats}${lights}
  <rect y="470" width="${W}" height="250" fill="url(#fl)"/>
  <rect x="220" y="470" width="840" height="60" rx="30" fill="#1d2023"/><rect x="200" y="455" width="880" height="30" rx="15" fill="#2c3136"/>
  ${[0,1,2,3,4,5].map((i) => `<rect x="${250 + i * 140}" y="395" width="70" height="75" rx="14" fill="#15181b"/>`).join("")}
  <rect x="520" y="190" width="240" height="140" rx="6" fill="#1a1d20"/><rect x="530" y="200" width="220" height="120" fill="#2a3b4a"/>`, 8);
}

function minimalOffice() {
  return wrap(`<linearGradient id="wall" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3efe8"/><stop offset="1" stop-color="#e2dbd0"/></linearGradient>
  <radialGradient id="light" cx="0.25" cy="0.2" r="0.8"><stop offset="0" stop-color="#ffffff" stop-opacity="0.7"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>`,
  `<rect width="${W}" height="${H}" fill="url(#wall)"/><rect width="${W}" height="${H}" fill="url(#light)"/>
  <rect y="600" width="${W}" height="120" fill="#cfc5b8"/>
  <rect x="760" y="250" width="380" height="12" fill="#b8a48d"/>
  <rect x="790" y="190" width="40" height="60" fill="#8fa3a8"/><rect x="845" y="170" width="28" height="80" fill="#d9cbb8"/><circle cx="930" cy="220" r="30" fill="#c9b79f"/><rect x="990" y="205" width="90" height="45" rx="4" fill="#e9e3da" stroke="#b8a48d" stroke-width="3"/>
  <rect x="140" y="140" width="300" height="200" fill="#e8e1d6" stroke="#cbbfae" stroke-width="10"/><path d="M160 320 L260 220 L330 290 L380 250 L420 320 Z" fill="#b9c4c1"/>
  <ellipse cx="1150" cy="520" rx="60" ry="110" fill="#7b9471"/><rect x="1110" y="560" width="80" height="80" rx="10" fill="#f6f2ec" stroke="#d8cfc2" stroke-width="3"/>`, 6);
}

function neutralWorkspace() {
  let bokeh = "";
  for (let i = 0; i < 38; i++) bokeh += `<circle cx="${rand() * W}" cy="${rand() * 520}" r="${20 + rand() * 70}" fill="${pick(["#ffffff", "#f2e6d4", "#e1e8ee"])}" opacity="${0.15 + rand() * 0.35}"/>`;
  return wrap(`<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d8d3cb"/><stop offset="0.6" stop-color="#bfb9b0"/><stop offset="1" stop-color="#a39c92"/></linearGradient>`,
  `<rect width="${W}" height="${H}" fill="url(#bg)"/>${bokeh}
  <rect y="560" width="${W}" height="160" fill="#8f877d"/><rect x="0" y="548" width="${W}" height="16" fill="#7a7268"/>
  <rect x="120" y="470" width="220" height="80" rx="6" fill="#5e5850" opacity="0.7"/><rect x="940" y="430" width="160" height="120" rx="8" fill="#6c665d" opacity="0.6"/>`, 12);
}

function executiveLibrary() {
  const colours = ["#5b3a2e", "#7a5a3c", "#2f4a5a", "#6b6b4a", "#8a3f35", "#3e5a47", "#b39b72", "#4a3f5e", "#9c8a6a"];
  let shelves = "";
  for (let row = 0; row < 4; row++) {
    const y = 60 + row * 150;
    shelves += `<rect x="60" y="${y + 120}" width="1160" height="16" fill="#3a2a20"/>`;
    let x = 80;
    while (x < 1190) {
      const w = 14 + rand() * 20, h = 70 + rand() * 45;
      if (rand() < 0.08) { x += 30; continue; }
      shelves += `<rect x="${x}" y="${y + 120 - h}" width="${w}" height="${h}" fill="${pick(colours)}"/>`;
      x += w + 2;
    }
  }
  return wrap(``, `<rect width="${W}" height="${H}" fill="#4a362a"/>${shelves}
  <rect x="40" y="0" width="30" height="${H}" fill="#2e2119"/><rect x="1210" y="0" width="30" height="${H}" fill="#2e2119"/>
  <radialGradient id="glow" cx="0.5" cy="0.3" r="0.7"><stop offset="0" stop-color="#ffd9a0" stop-opacity="0.25"/><stop offset="1" stop-color="#000" stop-opacity="0.25"/></radialGradient>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>`, 7);
}

const scenes = { "modern-office": modernOffice, "conference-room": conferenceRoom, "minimal-office": minimalOffice, "neutral-workspace": neutralWorkspace, "executive-library": executiveLibrary };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
for (const [id, draw] of Object.entries(scenes)) {
  const svg = draw(); // once, so the thumbnail matches the image
  await page.setContent(`<html><body style="margin:0;overflow:hidden">${svg}</body></html>`);
  await page.screenshot({ path: `public/meetings/backgrounds/${id}.jpg`, type: "jpeg", quality: 80 });
  await page.setViewportSize({ width: 192, height: 108 });
  await page.setContent(`<html><body style="margin:0;overflow:hidden"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}" style="width:192px;height:108px;display:block"></body></html>`);
  await page.screenshot({ path: `public/meetings/backgrounds/${id}-thumb.jpg`, type: "jpeg", quality: 78 });
  await page.setViewportSize({ width: W, height: H });
}
await browser.close();
console.log("generated", Object.keys(scenes).length, "backgrounds");
