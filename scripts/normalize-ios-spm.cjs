// Capacitor emits Windows separators into Swift strings when synced on
// Windows. Keep the generated local package paths usable by Xcode on macOS.
const fs = require('node:fs')
const path = require('node:path')
const file = path.join(__dirname, '../ios/App/CapApp-SPM/Package.swift')
const source = fs.readFileSync(file, 'utf8')
fs.writeFileSync(file, source.replace(/path: "([^"]+)"/g, (_, value) => `path: "${value.replaceAll('\\', '/')}"`))
