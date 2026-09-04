const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const iconsDir = path.join(__dirname, '..', 'public', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// SVG definition for standard icon
const svgStandard = `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a" />
      <stop offset="50%" stop-color="#1e293b" />
      <stop offset="100%" stop-color="#090d16" />
    </linearGradient>
    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fef08a" />
      <stop offset="30%" stop-color="#f59e0b" />
      <stop offset="100%" stop-color="#d97706" />
    </linearGradient>
    <linearGradient id="sunGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#fde047" />
      <stop offset="100%" stop-color="#f59e0b" />
    </linearGradient>
    <linearGradient id="panelGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8" />
      <stop offset="100%" stop-color="#0284c7" />
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="12" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>

  <!-- Background rounded rectangle -->
  <rect width="512" height="512" rx="105" fill="url(#bgGrad)" />

  <!-- Outer subtle border -->
  <rect x="6" y="6" width="500" height="500" rx="99" fill="none" stroke="#f59e0b" stroke-opacity="0.25" stroke-width="4" />

  <!-- Sun Rays & Crest -->
  <g transform="translate(256, 175)">
    <!-- Sun disk -->
    <circle cx="0" cy="0" r="52" fill="url(#sunGrad)" filter="url(#glow)" />
    <!-- Rays -->
    <path d="M 0 -72 L 0 -84" stroke="#fde047" stroke-width="6" stroke-linecap="round" />
    <path d="M 50 -50 L 60 -60" stroke="#fde047" stroke-width="6" stroke-linecap="round" />
    <path d="M 72 0 L 84 0" stroke="#fde047" stroke-width="6" stroke-linecap="round" />
    <path d="M -50 -50 L -60 -60" stroke="#fde047" stroke-width="6" stroke-linecap="round" />
    <path d="M -72 0 L -84 0" stroke="#fde047" stroke-width="6" stroke-linecap="round" />
  </g>

  <!-- Solar Panel Array Perspective -->
  <g transform="translate(256, 260)">
    <!-- Panel Body Perspective Base -->
    <polygon points="-140,75 140,75 110,-35 -110,-35" fill="#0369a1" stroke="#f59e0b" stroke-width="5" stroke-linejoin="round" />
    
    <!-- Cell Grid Divisions -->
    <!-- Vertical lines -->
    <line x1="-55" y1="-35" x2="-70" y2="75" stroke="#38bdf8" stroke-width="2.5" />
    <line x1="0" y1="-35" x2="0" y2="75" stroke="#fbbf24" stroke-width="3" />
    <line x1="55" y1="-35" x2="70" y2="75" stroke="#38bdf8" stroke-width="2.5" />

    <!-- Horizontal lines -->
    <line x1="-118" y1="-3" x2="118" y2="-3" stroke="#38bdf8" stroke-width="2" />
    <line x1="-128" y1="35" x2="128" y2="35" stroke="#38bdf8" stroke-width="2.5" />

    <!-- Panel Stand / Base -->
    <polygon points="-30,76 30,76 40,95 -40,95" fill="#1e293b" stroke="#f59e0b" stroke-width="2" />
  </g>

  <!-- SUNGO ERP Text -->
  <text x="256" y="405" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="44" font-weight="900" letter-spacing="6" text-anchor="middle" fill="url(#goldGrad)">SUNGO</text>
  <text x="256" y="445" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="20" font-weight="800" letter-spacing="9" text-anchor="middle" fill="#94a3b8">ERP SOLAR</text>
</svg>
`;

// Maskable icon (safe area within 80% circle, background flat to edges)
const svgMaskable = `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGradM" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a" />
      <stop offset="50%" stop-color="#1e293b" />
      <stop offset="100%" stop-color="#090d16" />
    </linearGradient>
    <linearGradient id="goldGradM" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fef08a" />
      <stop offset="30%" stop-color="#f59e0b" />
      <stop offset="100%" stop-color="#d97706" />
    </linearGradient>
    <linearGradient id="sunGradM" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#fde047" />
      <stop offset="100%" stop-color="#f59e0b" />
    </linearGradient>
    <filter id="glowM" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="10" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>

  <!-- Full bleed Background for maskable -->
  <rect width="512" height="512" fill="url(#bgGradM)" />

  <g transform="scale(0.85) translate(45, 45)">
    <!-- Sun Rays & Crest -->
    <g transform="translate(256, 170)">
      <circle cx="0" cy="0" r="48" fill="url(#sunGradM)" filter="url(#glowM)" />
      <path d="M 0 -66 L 0 -78" stroke="#fde047" stroke-width="5" stroke-linecap="round" />
      <path d="M 46 -46 L 56 -56" stroke="#fde047" stroke-width="5" stroke-linecap="round" />
      <path d="M 66 0 L 78 0" stroke="#fde047" stroke-width="5" stroke-linecap="round" />
      <path d="M -46 -46 L -56 -56" stroke="#fde047" stroke-width="5" stroke-linecap="round" />
      <path d="M -66 0 L -78 0" stroke="#fde047" stroke-width="5" stroke-linecap="round" />
    </g>

    <!-- Solar Panel Array Perspective -->
    <g transform="translate(256, 250)">
      <polygon points="-125,68 125,68 98,-32 -98,-32" fill="#0369a1" stroke="#f59e0b" stroke-width="4.5" stroke-linejoin="round" />
      <line x1="-50" y1="-32" x2="-62" y2="68" stroke="#38bdf8" stroke-width="2" />
      <line x1="0" y1="-32" x2="0" y2="68" stroke="#fbbf24" stroke-width="2.5" />
      <line x1="50" y1="-32" x2="62" y2="68" stroke="#38bdf8" stroke-width="2" />
      <line x1="-105" y1="-3" x2="105" y2="-3" stroke="#38bdf8" stroke-width="2" />
      <line x1="-115" y1="32" x2="115" y2="32" stroke="#38bdf8" stroke-width="2" />
      <polygon points="-25,69 25,69 35,88 -35,88" fill="#1e293b" stroke="#f59e0b" stroke-width="2" />
    </g>

    <!-- SUNGO ERP Text -->
    <text x="256" y="390" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="40" font-weight="900" letter-spacing="5" text-anchor="middle" fill="url(#goldGradM)">SUNGO</text>
    <text x="256" y="425" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="18" font-weight="800" letter-spacing="8" text-anchor="middle" fill="#94a3b8">ERP SOLAR</text>
  </g>
</svg>
`;

async function buildIcons() {
  console.log('Generating PWA Icons...');
  
  // Save SVG
  fs.writeFileSync(path.join(iconsDir, 'icon.svg'), svgStandard.trim());

  // 512x512
  await sharp(Buffer.from(svgStandard))
    .resize(512, 512)
    .png()
    .toFile(path.join(iconsDir, 'icon-512.png'));
  console.log('✔ Generated icon-512.png');

  // 192x192
  await sharp(Buffer.from(svgStandard))
    .resize(192, 192)
    .png()
    .toFile(path.join(iconsDir, 'icon-192.png'));
  console.log('✔ Generated icon-192.png');

  // Apple touch icon 180x180
  await sharp(Buffer.from(svgStandard))
    .resize(180, 180)
    .png()
    .toFile(path.join(iconsDir, 'apple-touch-icon.png'));
  console.log('✔ Generated apple-touch-icon.png');

  // Maskable 512x512
  await sharp(Buffer.from(svgMaskable))
    .resize(512, 512)
    .png()
    .toFile(path.join(iconsDir, 'icon-maskable-512.png'));
  console.log('✔ Generated icon-maskable-512.png');

  console.log('All PWA icons generated successfully!');
}

buildIcons().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
