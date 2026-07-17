import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  adaptiveDrillLength,
  difficultyMatchScore,
  questionWasSeen,
  selectQuestions,
  targetBucketCounts,
  topicPriority,
} from '../src/services/drills/dailyDrillGenerator.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function question(id, overrides = {}) {
  return {
    id,
    bucket: 'recently_taught',
    topic_id: 10 + id,
    question_type: 'short_answer',
    question_score: 70,
    rotation_key: id * 100,
    attempt_count: 0,
    last_attempted_at: null,
    ...overrides,
  }
}

test('drill length follows the distinct eligible bank without duplicating questions', () => {
  assert.equal(adaptiveDrillLength([question(1)], 5), 1)
  assert.equal(adaptiveDrillLength([question(1), question(2), question(3)], 5), 3)
  assert.equal(adaptiveDrillLength([question(1), question(1, { bucket: 'weak_topic' }), question(2)], 5), 2)
  assert.equal(adaptiveDrillLength(Array.from({ length: 8 }, (_, index) => question(index + 1)), 5), 5)
  assert.equal(adaptiveDrillLength([
    question(1, { attempt_count: 1, last_attempted_at: '2026-07-01' }),
    question(2, { attempt_count: 1, last_attempted_at: '2026-07-02' }),
  ], 5), 1)
  assert.equal(adaptiveDrillLength([
    question(1),
    question(2, { attempt_count: 1, last_attempted_at: '2026-07-02' }),
    question(3, { attempt_count: 1, last_attempted_at: '2026-07-03' }),
  ], 5), 2)
})

test('unseen questions are consumed before any previously assigned question resurfaces', () => {
  const pool = [
    question(1, { attempt_count: 4, last_attempted_at: '2026-07-01', question_score: 100 }),
    question(2, { question_score: 20 }),
    question(3, { question_score: 10 }),
  ]
  const selected = selectQuestions(pool, { recently_taught: 2 }, {
    targetCount: 2,
    studentId: 44,
    scheduledDate: '2026-07-15',
  })
  assert.deepEqual(new Set(selected.map((row) => row.id)), new Set([2, 3]))
})

test('an exhausted bank resurfaces least-recently-seen questions one by one', () => {
  const pool = [
    question(1, { attempt_count: 2, last_attempted_at: '2026-07-14' }),
    question(2, { bucket: 'spaced_review', attempt_count: 2, last_attempted_at: '2026-06-20' }),
    question(3, { bucket: 'weak_topic', attempt_count: 1, last_attempted_at: '2026-07-01' }),
  ]
  const targetCount = adaptiveDrillLength(pool, 5)
  const selected = selectQuestions(pool, { recently_taught: 2 }, {
    targetCount,
    studentId: 44,
    scheduledDate: '2026-07-15',
  })
  assert.equal(targetCount, 1)
  assert.deepEqual(selected.map((row) => row.id), [2])
})

test('a partial cycle uses the final unseen item and only enough old items to fill the drill', () => {
  const pool = [
    question(1),
    question(2, { attempt_count: 1, last_attempted_at: '2026-05-01' }),
    question(3, { attempt_count: 1, last_attempted_at: '2026-06-01' }),
    question(4, { attempt_count: 1, last_attempted_at: '2026-07-01' }),
  ]
  const targetCount = adaptiveDrillLength(pool, 5)
  const selected = selectQuestions(pool, { recently_taught: 3 }, {
    targetCount,
    studentId: 44,
    scheduledDate: '2026-07-15',
  })
  assert.equal(targetCount, 2)
  assert.deepEqual(new Set(selected.map((row) => row.id)), new Set([1, 2]))
  assert.equal(selected.filter(questionWasSeen).length, 1)
})

test('the same bank is presented in varying pedagogical bucket patterns across days', () => {
  const pool = [
    question(1, { bucket: 'recently_taught' }),
    question(2, { bucket: 'weak_topic' }),
    question(3, { bucket: 'spaced_review' }),
  ]
  const orders = new Set()
  for (let day = 15; day <= 25; day += 1) {
    const selected = selectQuestions(pool, { recently_taught: 1, weak_topic: 1, spaced_review: 1 }, {
      targetCount: 3,
      studentId: 44,
      scheduledDate: `2026-07-${day}`,
    })
    orders.add(selected.map((row) => row.bucket).join(','))
  }
  assert.ok(orders.size >= 2)
})

test('candidate allocations include a real exam slot and always match the adaptive length', () => {
  const standard = targetBucketCounts(3, false, false)
  assert.equal(Object.values(standard).reduce((sum, value) => sum + value, 0), 3)
  const candidate = targetBucketCounts(10, true, false)
  assert.equal(candidate.exam_challenge, 1)
  assert.equal(Object.values(candidate).reduce((sum, value) => sum + value, 0), 10)
})

test('difficulty and topic weakness are calibrated to lesson coverage and evidence volume', () => {
  assert.equal(difficultyMatchScore('hard', 90, 'introduced'), 0)
  assert.equal(difficultyMatchScore('easy', 90, 'introduced'), 100)
  const lowConfidence = topicPriority({ mastery_score: 0, attempts: 1, bucket: 'weak_topic' }, '2026-07-15', 0)
  const established = topicPriority({ mastery_score: 0, attempts: 5, bucket: 'weak_topic' }, '2026-07-15', 0)
  assert.ok(lowConfidence.components.weakness_score < established.components.weakness_score)
  assert.equal(lowConfidence.components.evidence_confidence, 25)
  assert.equal(established.components.evidence_confidence, 100)
})

test('generation contract keeps one stable daily session and honours configured subject modes', () => {
  const source = fs.readFileSync(path.join(root, 'src/services/drills/dailyDrillGenerator.js'), 'utf8')
  assert.match(source, /Today's Daily Drill is already prepared and will remain stable/)
  assert.match(source, /subjectMode === "fixed_rotation"/)
  assert.match(source, /subjectMode === "timetable"/)
  assert.match(source, /question_usage\.last_attempted_at IS NULL DESC/)
  assert.match(source, /GENERATOR_VERSION = "bank-rotation-v2"/)
})
