import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { inspectPdfStructure, pdfPagesFromText } from "../src/services/assessmentImportService.js"

const here=path.dirname(fileURLToPath(import.meta.url))

test("PDF inspection recognises a complete, unencrypted multi-page document",()=>{
  const pdf=Buffer.from("%PDF-1.7\n1 0 obj << /Type /Pages /Count 14 >> endobj\nstartxref\n42\n%%EOF\ntrailing-bytes")
  assert.deepEqual(inspectPdfStructure(pdf),{
    validHeader:true,
    hasEof:true,
    encrypted:false,
    pageCount:14,
  })
})

test("PDF inspection distinguishes incomplete and encrypted uploads",()=>{
  assert.equal(inspectPdfStructure(Buffer.from("not a pdf")).validHeader,false)
  const protectedPdf=inspectPdfStructure(Buffer.from("%PDF-1.7\n/Encrypt 2 0 R\n"))
  assert.equal(protectedPdf.hasEof,false)
  assert.equal(protectedPdf.encrypted,true)
})

test("visual analysis gets placeholders for every PDF page when embedded text is unavailable",()=>{
  const pages=pdfPagesFromText("Page one text\fPage two text\f",4)
  assert.equal(pages.length,4)
  assert.equal(pages[0].text_content,"Page one text")
  assert.equal(pages[1].text_content,"Page two text")
  assert.equal(pages[2].text_content,"")
  assert.equal(pages[3].page_number,4)
})

test("Railway deploy installs the Poppler PDF command-line utilities",async()=>{
  const config=JSON.parse(await fs.readFile(path.resolve(here,"../railpack.json"),"utf8"))
  assert.equal(config.provider,"node")
  assert.ok(config.deploy?.aptPackages?.includes("poppler-utils"))
})
