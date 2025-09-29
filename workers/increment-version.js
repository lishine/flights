const fs = require('fs')

const vPath = 'version.json'
let data = fs.readFileSync(vPath, 'utf8')
let json = JSON.parse(data)
// json.version += 1
fs.writeFileSync(vPath, JSON.stringify(json, null, 2))

const constantsPath = 'src/utils/constants.ts'
let lines = fs.readFileSync(constantsPath, 'utf8').split('\n')
let updated = false

for (let i = 0; i < lines.length; i++) {
	const line = lines[i].trim()
	if (line.includes('VERSION') && line.includes('=') && line.includes("'v")) {
		const match = line.match(/'v(\d+)'/)
		if (match) {
			const oldVersion = parseInt(match[1])
			lines[i] = lines[i].replace(`'v${oldVersion}'`, `'v${json.version}'`)
			updated = true
			break
		}
	}
}

if (!updated) {
	lines.push(`export const VERSION = 'v${json.version}';`)
}

fs.writeFileSync(constantsPath, lines.join('\n') + '\n')

console.log(`Version incremented to v${json.version}`)
