// scripts/check-syntax.js
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'

const ROOT_DIR = path.resolve('./src')

function getAllJsFiles(dir) {
    let results = []
    const list = fs.readdirSync(dir)
    for (const file of list) {
        if (file === 'node_modules' || file.startsWith('.')) continue
        const fullPath = path.join(dir, file)
        const stat = fs.statSync(fullPath)
        if (stat.isDirectory()) {
            results = results.concat(getAllJsFiles(fullPath))
        } else if (file.endsWith('.js')) {
            results.push(fullPath)
        }
    }
    return results
}

const jsFiles = getAllJsFiles(ROOT_DIR)
console.log(`Checking syntax for ${jsFiles.length} JavaScript files in src/...`)

let hasError = false
for (const file of jsFiles) {
    try {
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
    } catch (err) {
        console.error(`❌ Syntax error in ${file}:`)
        console.error(err.stderr?.toString() || err.message)
        hasError = true
    }
}

if (hasError) {
    console.error(`\n❌ Syntax check failed!`)
    process.exit(1)
} else {
    console.log(`✅ All ${jsFiles.length} JS files passed syntax validation!`)
    process.exit(0)
}
