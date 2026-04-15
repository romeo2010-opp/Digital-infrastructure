import { prisma } from "../db/prisma.js"
import { resolveStationOrThrow } from "../modules/common/db.js"
import { runNozzleIntegrityCheck } from "../modules/pumps/pumps.service.js"

function parseArgs(argv) {
  const args = { stationPublicId: null, stationId: null }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === "--stationPublicId" && argv[index + 1]) {
      args.stationPublicId = String(argv[index + 1]).trim()
      index += 1
      continue
    }
    if (token === "--stationId" && argv[index + 1]) {
      const maybe = Number(argv[index + 1])
      args.stationId = Number.isFinite(maybe) && maybe > 0 ? maybe : null
      index += 1
    }
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  let stationId = args.stationId

  if (!stationId && args.stationPublicId) {
    const station = await resolveStationOrThrow(args.stationPublicId)
    stationId = Number(station.id)
  }

  const result = await runNozzleIntegrityCheck(stationId || null)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

main()
  .catch((error) => {
    process.stderr.write(`${error?.message || "Nozzle integrity check failed"}\n`)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {})
  })
