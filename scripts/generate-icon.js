const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const size = 1024;

// Create an SVG icon - a modern app icon with "eS" monogram on a gradient background
const svg = `
<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0064d2;stop-opacity:1" />
      <stop offset="50%" style="stop-color:#4a90d9;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#86b7fe;stop-opacity:1" />
    </linearGradient>
    <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%">
      <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#000" flood-opacity="0.15"/>
    </filter>
  </defs>

  <!-- Rounded square background -->
  <rect x="40" y="40" width="944" height="944" rx="200" ry="200" fill="url(#bg)" filter="url(#shadow)"/>

  <!-- Inner subtle border -->
  <rect x="60" y="60" width="904" height="904" rx="185" ry="185" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="4"/>

  <!-- Shopping bag shape -->
  <path d="M 340 380 Q 340 340 380 340 L 644 340 Q 684 340 684 380 L 684 720 Q 684 760 644 760 L 380 760 Q 340 760 340 720 Z"
        fill="rgba(255,255,255,0.95)" rx="20"/>

  <!-- Bag handle -->
  <path d="M 430 340 Q 430 260 512 260 Q 594 260 594 340"
        fill="none" stroke="rgba(255,255,255,0.95)" stroke-width="32" stroke-linecap="round"/>

  <!-- Dollar sign on bag -->
  <text x="512" y="600" font-family="Arial, Helvetica, sans-serif" font-size="280" font-weight="bold"
        fill="#0064d2" text-anchor="middle" dominant-baseline="central">$</text>
</svg>`;

const publicDir = path.join(__dirname, '..', 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

sharp(Buffer.from(svg))
  .resize(1024, 1024)
  .png()
  .toFile(path.join(publicDir, 'icon.png'))
  .then(() => {
    console.log('Icon generated at public/icon.png (1024x1024)');
  })
  .catch(err => {
    console.error('Error generating icon:', err);
    process.exit(1);
  });
