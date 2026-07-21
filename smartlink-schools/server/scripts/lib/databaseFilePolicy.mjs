const seedOnlyFileNames = new Set([
  "009_greenhill_cambridge_primary.sql",
  "020_reign_internation_academy.sql",
  "021_ria_friday_half_day_schedule.sql",
  "052_romeo_jfk_international_academy_demo.sql",
])

export const TENANT_SEED_ONLY_FILES = Object.freeze([...seedOnlyFileNames])

export const DAILY_DRILL_SCHEMA_MIGRATIONS = Object.freeze([
  "007_daily_drills_syllabus_intelligence.sql",
  "008_gemini_ai_pilot.sql",
  "010_manual_syllabus_entries.sql",
  "011_manual_syllabus_drafts.sql",
  "012_ai_tts_usage.sql",
  "013_drill_ai_feedback.sql",
  "014_teacher_lesson_logs_drill_engine.sql",
  "015_drill_scoring_interventions.sql",
])

export function databaseFileName(value) {
  return String(value || "").replaceAll("\\", "/").split("/").pop().toLowerCase()
}

export function isSeedOnlyDatabaseFile(value) {
  const name = databaseFileName(value)
  return seedOnlyFileNames.has(name) || name === "seed.sql" || /^seed-.*\.sql$/i.test(name)
}

export function isNumberedMigrationFile(value) {
  return /^\d{3}_.*\.sql$/i.test(databaseFileName(value))
}

export function isSchemaMigrationFile(value) {
  return isNumberedMigrationFile(value) && !isSeedOnlyDatabaseFile(value)
}

export function isSchemaContractDefinitionFile(value) {
  const name = databaseFileName(value)
  return name === "schema.sql" || /^apply-.*\.mjs$/i.test(name) || isSchemaMigrationFile(name)
}

export function validateDatabaseFileSelection(files, options = {}) {
  const seedOnly = Boolean(options.seedOnly)
  const selected = [...(files || [])]
  for (const file of selected) {
    const name = databaseFileName(file)
    const isSeed = isSeedOnlyDatabaseFile(name)
    if (!seedOnly && isSeed) {
      const error = new Error(`${name} is a tenant/demo seed and cannot run through the schema migration path. Use the explicit --seed-only command.`)
      error.code = "SEED_FILE_REQUIRES_OPT_IN"
      throw error
    }
    if (!seedOnly && name !== "schema.sql" && !isSchemaMigrationFile(name)) {
      const error = new Error(`${name} is not a registered schema migration. Use schema.sql or a numbered migration; database dumps and ad-hoc SQL are rejected.`)
      error.code = "UNREGISTERED_SCHEMA_FILE"
      throw error
    }
    if (seedOnly && !isSeed) {
      const error = new Error(`${name} is not registered as a seed-only database file and cannot run in --seed-only mode.`)
      error.code = "SCHEMA_FILE_IN_SEED_MODE"
      throw error
    }
  }
  return selected
}
