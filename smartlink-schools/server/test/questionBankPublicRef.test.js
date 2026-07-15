import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function questionBankInserts(source) {
  return [...source.matchAll(/INSERT INTO question_bank\s*\(([^)]+)\)/g)].map((match) => match[1])
}

test('every application question-bank insert supplies a public reference', () => {
  const files = [
    path.join(root, 'src/controllers/questionsController.js'),
    path.join(root, 'src/services/assessmentImportService.js'),
  ]
  const inserts = files.flatMap((file) => questionBankInserts(fs.readFileSync(file, 'utf8')))

  assert.ok(inserts.length >= 4, 'expected all question-bank write paths to be covered')
  for (const columns of inserts) {
    assert.match(columns, /\bpublic_ref\b/, `missing public_ref in question_bank insert: ${columns}`)
  }
})

test('question-bank inserts generate references inside the database transaction', () => {
  const source = [
    fs.readFileSync(path.join(root, 'src/controllers/questionsController.js'), 'utf8'),
    fs.readFileSync(path.join(root, 'src/services/assessmentImportService.js'), 'utf8'),
  ].join('\n')

  const inserts = [...source.matchAll(/INSERT INTO question_bank\s*\([^)]+\)\s*VALUES\s*\(([^;`]+)/g)].map((match) => match[1])
  assert.ok(inserts.length >= 4)
  for (const values of inserts) assert.match(values, /^UUID\(\),/)
})

test('question-bank public references have a database-side safety default', () => {
  const migration = fs.readFileSync(path.join(root, 'database/063_question_bank_public_ref_default.sql'), 'utf8')
  assert.match(migration, /MODIFY COLUMN public_ref CHAR\(36\) NOT NULL DEFAULT \(UUID\(\)\)/)
})
