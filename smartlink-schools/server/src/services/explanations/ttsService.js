import { AI_LIMIT_MESSAGE, assertSchoolAiAllowed, logAiUsage } from "../ai/aiClient.js"
import { GEMINI_NOT_CONFIGURED_MESSAGE } from "../ai/providers/geminiProvider.js"
import { gradeToneGuide } from "./gradeTone.js"

const sampleRate = 24000
const channels = 1
const bitsPerSample = 16

function boolFromEnv(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase())
}

function intFromEnv(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function cleanSpeechText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 1200)
}

function addNaturalPauses(text) {
  const sentences = cleanSpeechText(text).match(/[^.!?]+[.!?]+|[^.!?]+$/g) || []
  return sentences.map((sentence) => sentence.trim()).filter(Boolean).join(" [short pause] ")
}

function pcmToWavBuffer(pcm) {
  const dataSize = pcm.length
  const header = Buffer.alloc(44)
  const byteRate = sampleRate * channels * (bitsPerSample / 8)
  const blockAlign = channels * (bitsPerSample / 8)
  header.write("RIFF", 0)
  header.writeUInt32LE(36 + dataSize, 4)
  header.write("WAVE", 8)
  header.write("fmt ", 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write("data", 36)
  header.writeUInt32LE(dataSize, 40)
  return Buffer.concat([header, pcm])
}

function geminiTtsModels() {
  return [
    process.env.GEMINI_TTS_MODEL,
    "gemini-3.1-flash-tts-preview",
    "gemini-2.5-flash-preview-tts",
  ].filter(Boolean)
}

function firstInlineAudio(payload = {}) {
  for (const candidate of payload.candidates || []) {
    for (const part of candidate?.content?.parts || []) {
      const inlineData = part.inlineData || part.inline_data
      if (inlineData?.data) return inlineData.data
    }
  }
  return ""
}

function usageFromGemini(payload = {}) {
  const usage = payload.usageMetadata || {}
  return {
    inputTokens: usage.promptTokenCount ?? null,
    outputTokens: usage.candidatesTokenCount ?? usage.outputTokenCount ?? null,
  }
}

async function requestGeminiTts({ text, model, voiceName, apiKey, timeoutMs, gradeName = "" }) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const toneGuide = gradeToneGuide(gradeName)
    const prompt = `Read this as a warm, patient teacher speaking to one learner beside them.
Grade/form: ${gradeName || "not specified"}
Grade-aware delivery: ${toneGuide}
Use a relaxed, human cadence with small natural breaths before new thoughts.
Keep sentence endings clean and short; do not drag or extend the final vowel sound.
Use gentle micro-pauses between ideas instead of a presenter or announcement rhythm.
Do not sing, over-enunciate, whisper, or add extra words.
Keep the pace calm, conversational, and lightly expressive.

Transcript:
${addNaturalPauses(text)}`

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }],
        }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName,
              },
            },
          },
        },
      }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(payload?.error?.message || `Gemini TTS failed (${response.status})`)
    }
    const audioBase64 = firstInlineAudio(payload)
    if (!audioBase64) throw new Error("Gemini TTS returned no audio")
    return {
      audioBase64,
      usage: usageFromGemini(payload),
    }
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`Gemini TTS timed out after ${timeoutMs}ms`)
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export async function synthesizeExplanationSpeech({ text, schoolId = null, userId = null, gradeName = "" }) {
  if (!boolFromEnv(process.env.GEMINI_TTS_ENABLED, true)) {
    return { ok: false, unavailable: true, message: "Neural text to speech is disabled." }
  }
  const cleanText = cleanSpeechText(text)
  if (!cleanText) return { ok: false, message: "Text is required." }
  const apiKey = process.env.GEMINI_API_KEY || ""
  if (!apiKey) return { ok: false, unavailable: true, message: GEMINI_NOT_CONFIGURED_MESSAGE }

  const limit = await assertSchoolAiAllowed(schoolId)
  if (!limit.allowed) return { ok: false, blocked: true, message: limit.message || AI_LIMIT_MESSAGE }

  const timeoutMs = intFromEnv(process.env.GEMINI_TTS_TIMEOUT_MS, 45000)
  const voiceName = process.env.GEMINI_TTS_VOICE || "Aoede"
  let lastError = null
  for (const model of geminiTtsModels()) {
    try {
      const result = await requestGeminiTts({ text: cleanText, model, voiceName, apiKey, timeoutMs, gradeName })
      await logAiUsage({
        schoolId,
        userId,
        featureName: "explanation_tts",
        model,
        usage: result.usage,
      })
      const wav = pcmToWavBuffer(Buffer.from(result.audioBase64, "base64"))
      return {
        ok: true,
        provider: "gemini",
        model,
        voice: voiceName,
        mime_type: "audio/wav",
        audio_base64: wav.toString("base64"),
      }
    } catch (error) {
      lastError = error
    }
  }
  await logAiUsage({
    schoolId,
    userId,
    featureName: "explanation_tts",
    model: geminiTtsModels()[0],
    usage: {},
  })
  return {
    ok: false,
    message: lastError?.message || "Neural text to speech was unavailable.",
  }
}
