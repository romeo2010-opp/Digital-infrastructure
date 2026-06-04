import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import express from "express"
import { createUploadFileServer, resolveSafeUploadPath } from "../files/uploadFileServer.js"

async function withUploadServer(callback) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mera-upload-server-"))
  const app = express()
  app.use("/uploads/mera", createUploadFileServer({ rootDir, cacheMaxAge: "0" }))
  app.use((_req, res) => res.status(404).json({ ok: false }))

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener))
  })

  try {
    const { port } = server.address()
    await callback({ rootDir, baseUrl: `http://127.0.0.1:${port}` })
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    await fs.rm(rootDir, { recursive: true, force: true })
  }
}

test("upload file server serves arbitrary uploaded file extensions", async () => {
  await withUploadServer(async ({ rootDir, baseUrl }) => {
    await fs.writeFile(path.join(rootDir, "evidence.custom-format"), "MERA file payload")
    await fs.writeFile(path.join(rootDir, "extensionless"), "extensionless payload")

    const response = await fetch(`${baseUrl}/uploads/mera/evidence.custom-format`)
    const extensionlessResponse = await fetch(`${baseUrl}/uploads/mera/extensionless`)

    assert.equal(response.status, 200)
    assert.equal(await response.text(), "MERA file payload")
    assert.match(response.headers.get("content-disposition") || "", /inline/)
    assert.equal(response.headers.get("cross-origin-resource-policy"), "cross-origin")
    assert.equal(response.headers.get("x-frame-options"), null)
    assert.equal(extensionlessResponse.status, 200)
    assert.equal(await extensionlessResponse.text(), "extensionless payload")
  })
})

test("upload file server rejects path traversal", () => {
  const rootDir = path.join(os.tmpdir(), "mera-upload-root")

  assert.equal(resolveSafeUploadPath(rootDir, "../secret.txt"), null)
  assert.equal(resolveSafeUploadPath(rootDir, "nested/../../secret.txt"), null)
  assert.equal(resolveSafeUploadPath(rootDir, "nested\\..\\secret.txt"), null)
})
