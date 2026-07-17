import test from "node:test"
import assert from "node:assert/strict"
import fs from "fs"
import fsp from "fs/promises"
import os from "os"
import path from "path"
import { execFile, spawnSync } from "child_process"
import { promisify } from "util"
import PDFDocument from "pdfkit"
import { cropPdfVisualRegions, extractEmbeddedPdfImages, imageDetailsFromBytes, parsePdfImageList, replaceOperationalImageWarnings } from "../src/services/pdfImageExtractionService.js"

const run = promisify(execFile)
const commandExists = (command) => spawnSync(process.platform === "win32" ? "where.exe" : "which", [command], { stdio: "ignore" }).status === 0
const imageCommand = process.platform === "win32" ? "magick" : "convert"
const pdfToolchainAvailable = commandExists("pdfimages") && commandExists("pdftoppm") && commandExists(imageCommand)
const pdfToolchainTest = pdfToolchainAvailable ? test : test.skip

async function fixtureFolder() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "smartlink-pdf-images-"))
}

async function makeImage(filePath, color, width = 240, height = 160) {
  await run(imageCommand, ["-size", `${width}x${height}`, `xc:${color}`, "-fill", "black", "-draw", `line 10,10 ${width - 10},${height - 10}`, filePath])
}

async function makePdf(filePath, draw) {
  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0 })
    const stream = fs.createWriteStream(filePath)
    stream.on("finish", resolve)
    stream.on("error", reject)
    doc.pipe(stream)
    draw(doc)
    doc.end()
  })
}

test("parses Poppler embedded-image metadata", () => {
  const rows = parsePdfImageList("   4     2 image     408   276  rgb     3   8  jpeg   yes       34  0   220   220 28.4K 8.6%")
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0], { page_number: 4, embedded_number: 2, embedded_type: "image", width: 408, height: 276, encoding: "jpeg", interpolation: "yes", object_id: 34 })
})

test("reads cropped PNG metadata without requiring ImageMagick",()=>{
  const bytes=Buffer.alloc(24)
  Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(bytes)
  bytes.writeUInt32BE(1280,16)
  bytes.writeUInt32BE(720,20)
  assert.deepEqual(imageDetailsFromBytes(bytes,"question-crop.png"),{format:"PNG",width:1280,height:720,mime_type:"image/png"})
})

test("uses trusted Poppler dimensions for less common embedded image formats",()=>{
  assert.deepEqual(imageDetailsFromBytes(Buffer.from([0x49,0x49,0x2a,0]),"embedded-0.tif",{width:640,height:480}),{format:"TIFF",width:640,height:480,mime_type:"image/tiff"})
})

test("a successful retry clears stale dependency warnings without hiding review findings",()=>{
  const existing=[
    "Embedded image 0 on page 1 could not be validated.",
    "A visual for question 4. a. (i) on page 3 could not be cropped: spawn identify ENOENT",
    "Question 7 has no confidently matched marking-scheme answer.",
  ]
  assert.deepEqual(replaceOperationalImageWarnings(existing,[]),["Question 7 has no confidently matched marking-scheme answer."])
})

pdfToolchainTest("extracts original embedded images with dimensions, MIME type and checksum", async (t) => {
  const folder = await fixtureFolder(); t.after(() => fsp.rm(folder, { recursive: true, force: true }))
  const first = path.join(folder, "first.png"), second = path.join(folder, "second.jpg"), pdf = path.join(folder, "images.pdf"), output = path.join(folder, "output")
  await makeImage(first, "white")
  await makeImage(second, "lightblue")
  await makePdf(pdf, (doc) => { doc.image(first, 40, 80, { width: 240 }); doc.addPage(); doc.image(second, 40, 80, { width: 240 }) })
  const result = await extractEmbeddedPdfImages({ pdfPath: pdf, outputDir: output, documentType: "student_paper", pageCount: 2, pageTextByNumber: new Map([[1, "cover"], [2, "Question 1. Study the picture."]]) })
  assert.equal(result.assets.length, 2)
  assert.ok(result.assets.every((asset) => asset.extraction_method === "embedded" && asset.checksum?.length === 64))
  assert.ok(result.assets.some((asset) => asset.mime_type === "image/jpeg"))
})

pdfToolchainTest("crops a vector diagram at print resolution and keeps question association", async (t) => {
  const folder = await fixtureFolder(); t.after(() => fsp.rm(folder, { recursive: true, force: true }))
  const pdf = path.join(folder, "vector.pdf")
  await makePdf(pdf, (doc) => { doc.fontSize(16).text("1. Study the diagram.", 50, 80); doc.circle(260, 300, 90).stroke(); doc.moveTo(170, 300).lineTo(350, 300).stroke(); doc.text("A", 250, 285) })
  const result = await cropPdfVisualRegions({ pdfPath: pdf, outputDir: folder, documentType: "student_paper", pageCount: 1, pageTextByNumber: new Map([[1, "1. Study the geometric diagram below carefully and identify every labelled component shown in the figure."]]), questions: [{ tempQuestionId: "q1", questionNumber: "1.", pageStart: 1, assets: [{ assetKey: "diagram-1", assetType: "geometric_figure", pageNumber: 1, bboxNormalized: { x: .25, y: .22, width: .45, height: .35 }, confidence: .94 }] }] })
  assert.equal(result.assets.length, 1)
  assert.equal(result.assets[0].extraction_method, "vector_crop")
  assert.equal(result.assets[0].suggested_question_number, "1.")
  assert.equal(result.assets[0].requires_review, false)
  assert.ok(result.assets[0].width > 500)
})

pdfToolchainTest("marks low-confidence visual association for review", async (t) => {
  const folder = await fixtureFolder(); t.after(() => fsp.rm(folder, { recursive: true, force: true }))
  const pdf = path.join(folder, "uncertain.pdf")
  await makePdf(pdf, (doc) => { doc.rect(100, 200, 250, 180).stroke() })
  const result = await cropPdfVisualRegions({ pdfPath: pdf, outputDir: folder, pageCount: 1, pageTextByNumber: new Map([[1, "Question 2"]]), questions: [{ tempQuestionId: "q2", questionNumber: "2", pageStart: 1, assets: [{ assetType: "diagram", pageNumber: 1, bboxNormalized: { x: .15, y: .2, width: .5, height: .3 }, confidence: .52 }] }] })
  assert.equal(result.assets[0].requires_review, true)
  assert.equal(result.assets[0].assignment_status, "suggested")
})

pdfToolchainTest("does not save a full-page scan as an extracted question image", async (t) => {
  const folder = await fixtureFolder(); t.after(() => fsp.rm(folder, { recursive: true, force: true }))
  const scan = path.join(folder, "scan.jpg"), pdf = path.join(folder, "scan.pdf"), output = path.join(folder, "output")
  await makeImage(scan, "white", 1200, 1600)
  await makePdf(pdf, (doc) => doc.image(scan, 0, 0, { width: 595, height: 842 }))
  const result = await extractEmbeddedPdfImages({ pdfPath: pdf, outputDir: output, documentType: "student_paper", pageCount: 1, pageTextByNumber: new Map([[1, ""]]) })
  assert.deepEqual(result.scan_pages, [1])
  assert.equal(result.assets.length, 0)
})

pdfToolchainTest("PDF with no images completes with an empty image list", async (t) => {
  const folder = await fixtureFolder(); t.after(() => fsp.rm(folder, { recursive: true, force: true }))
  const pdf = path.join(folder, "text.pdf"), output = path.join(folder, "output")
  await makePdf(pdf, (doc) => doc.fontSize(14).text("1. Explain photosynthesis.", 50, 80))
  const result = await extractEmbeddedPdfImages({ pdfPath: pdf, outputDir: output, documentType: "student_paper", pageCount: 1, pageTextByNumber: new Map([[1, "1. Explain photosynthesis."]]) })
  assert.equal(result.images_found, 0)
  assert.deepEqual(result.assets, [])
})

pdfToolchainTest("corrupt PDF reports extraction failure without producing assets", async (t) => {
  const folder = await fixtureFolder(); t.after(() => fsp.rm(folder, { recursive: true, force: true }))
  const pdf = path.join(folder, "corrupt.pdf"), output = path.join(folder, "output")
  await fsp.writeFile(pdf, "not a pdf")
  await assert.rejects(() => extractEmbeddedPdfImages({ pdfPath: pdf, outputDir: output, documentType: "student_paper", pageCount: 1 }), /Command failed|Syntax Error|May not be a PDF/i)
})
