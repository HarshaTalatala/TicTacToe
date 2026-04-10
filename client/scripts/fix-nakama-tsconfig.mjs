import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const target = 'node_modules/tsconfig.base.json'

const content = {
  compilerOptions: {
    target: 'es2020',
    module: 'esnext',
    moduleResolution: 'bundler',
    skipLibCheck: true,
  },
}

if (!existsSync(target)) {
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, JSON.stringify(content, null, 2) + '\n', 'utf8')
  console.log('Created', target)
}
