const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'data', 'experience.json');
const targetDir = path.join(root, 'public', 'data');
const target = path.join(targetDir, 'experience.json');

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);

console.log(`Copied ${path.relative(root, source)} -> ${path.relative(root, target)}`);
