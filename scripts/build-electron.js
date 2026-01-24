const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const electronDir = path.join(__dirname, '..', 'electron')
const outDir = path.join(__dirname, '..', 'dist-electron')

// Ensure output directory exists
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true })
}

// Compile TypeScript
console.log('Compiling Electron TypeScript...')
execSync(`npx tsc -p "${electronDir}/tsconfig.json"`, {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
})

console.log('Electron build complete!')
