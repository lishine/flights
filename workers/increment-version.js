const fs = require('fs');

const vPath = 'version.json';
let data = fs.readFileSync(vPath, 'utf8');
let json = JSON.parse(data);
json.version += 1;
fs.writeFileSync(vPath, JSON.stringify(json, null, 2));

const constantsPath = 'src/utils/constants.ts';
let content = fs.readFileSync(constantsPath, 'utf8');

// Replace or add VERSION line
if (content.includes('VERSION')) {
	content = content.replace(/export const VERSION = 'v\d+';/, `export const VERSION = 'v${json.version}';`);
} else {
	content += `\nexport const VERSION = 'v${json.version}';`;
}
fs.writeFileSync(constantsPath, content);

console.log(`Version incremented to v${json.version}`);
