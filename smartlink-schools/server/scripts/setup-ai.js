#!/usr/bin/env node
import dotenv from "dotenv"

dotenv.config()

const provider = String(process.env.AI_PROVIDER || "gemini").toLowerCase()
const model = process.env.AI_MODEL || "gemini-2.5-flash"
const configured = Boolean(process.env.GEMINI_API_KEY)

function log(message) {
  console.log(`[smartlink-ai] ${message}`)
}

log(`AI_PROVIDER=${provider}`)
log(`AI_MODEL=${model}`)

if (provider !== "gemini") {
  log("Only Gemini is enabled for this pilot. Set AI_PROVIDER=gemini.")
  process.exitCode = 1
} else if (!configured) {
  log("GEMINI_API_KEY is not configured yet.")
  log("The app will still run; upload, review, and manual approval features remain available.")
} else {
  log("Gemini API key is present in the server environment.")
  log("Start the API and use POST /api/ai/test to verify the key with Gemini.")
}
