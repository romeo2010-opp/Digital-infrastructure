import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import dotenv from "dotenv"
import { pool } from "../src/config/db.js"

dotenv.config()
const command = process.argv[2] || "validate"
const allowed = new Set(["reset", "seed", "recalculate", "validate", "publish", "generate", "archive", "simulate"])
if (!allowed.has(command)) throw new Error(`Unknown demo command: ${command}. Use reset, seed, recalculate, validate, publish, generate, archive, or simulate.`)
if (process.env.NODE_ENV === "production" && process.env.ENABLE_DEMO_DATA_TOOLS !== "true") {
  throw new Error("Greenfield demo controls are disabled in production. Set ENABLE_DEMO_DATA_TOOLS=true for a controlled development run.")
}

const run = (script) => execFileSync(process.execPath, [fileURLToPath(new URL(`./${script}`, import.meta.url))], { stdio: "inherit", env: process.env })
if (["reset", "seed", "generate"].includes(command)) {
  // The seed is intentionally idempotent: it resets only GFA before rebuilding
  // the complete deterministic dataset.
  if (command === "reset") execFileSync(process.execPath, [fileURLToPath(new URL("./seed-greenfield-demo.mjs", import.meta.url)), "--reset-only"], { stdio: "inherit", env: process.env })
  else run("seed-greenfield-demo.mjs")
} else if (command === "recalculate") run("recalculate-greenfield-demo.mjs")
else if (command === "validate") run("validate-greenfield-demo.mjs")
else if (command === "simulate") {
  console.log(JSON.stringify({ ok: true, demo: "Greenfield Academy", simulations: ["new learner", "transfer", "repeat", "withdrawal", "exam absent", "incomplete evidence", "improving trend", "declining trend", "high performer", "academic intervention"] }, null, 2))
} else {
  const connection = await pool.getConnection()
  try {
    const [[school]] = await connection.query("SELECT id FROM schools WHERE code='GFA' LIMIT 1")
    if (!school) throw new Error("GFA is not seeded. Run the seed command first.")
    if (command === "publish") {
      await connection.query(`UPDATE timetables t JOIN timetable_versions v ON v.timetable_id=t.id AND v.status='PUBLISHED' SET t.status='PUBLISHED',t.current_published_version_id=v.id WHERE t.school_id=? AND t.term_id=(SELECT id FROM terms WHERE school_id=? AND name='Term 2' ORDER BY id DESC LIMIT 1)`, [school.id, school.id])
      console.log(JSON.stringify({ ok: true, action: "publish", school_id: school.id }))
    } else if (command === "archive") {
      await connection.query(`UPDATE timetable_versions v JOIN timetables t ON t.id=v.timetable_id SET v.status='ARCHIVED' WHERE t.school_id=? AND t.term_id=(SELECT id FROM terms WHERE school_id=? AND name='Term 1' ORDER BY id DESC LIMIT 1)`, [school.id, school.id])
      await connection.query(`UPDATE timetables t SET t.status='ARCHIVED' WHERE t.school_id=? AND t.term_id=(SELECT id FROM terms WHERE school_id=? AND name='Term 1' ORDER BY id DESC LIMIT 1)`, [school.id, school.id])
      console.log(JSON.stringify({ ok: true, action: "archive", school_id: school.id }))
    }
  } finally {
    connection.release()
    await pool.end()
  }
}
