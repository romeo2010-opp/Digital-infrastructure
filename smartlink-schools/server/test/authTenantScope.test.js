import test from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { readFile } from "node:fs/promises"
import { rateLimitLogin, resetLoginRateLimitForTests } from "../src/middleware/loginRateLimit.js"

function response() {
  const res = new EventEmitter()
  res.statusCode = 401
  res.headers = {}
  res.setHeader = (name, value) => { res.headers[name] = value }
  return res
}

test("student login is scoped by an explicit unique school code", async () => {
  const [controller, client, routes] = await Promise.all([
    readFile(new URL("../src/controllers/authController.js", import.meta.url), "utf8"),
    readFile(new URL("../../client/src/app/components/LoginScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/auth.routes.js", import.meta.url), "utf8"),
  ])
  const start = controller.indexOf("async function loginStudent")
  const end = controller.indexOf("function dateOnly", start)
  const login = controller.slice(start, end)
  assert.match(login, /school_code \|\| req\.body\.schoolCode/)
  assert.match(login, /JOIN schools school ON school\.id=s\.school_id AND school\.status='active'/)
  assert.match(login, /LOWER\(school\.code\)=LOWER\(\?\)/)
  assert.match(login, /LOWER\(school\.school_prefix\)=LOWER\(\?\)/)
  assert.doesNotMatch(login, /WHERE s\.status = 'active'\s+AND \(s\.student_id/)
  assert.match(client, /School Code/)
  assert.match(client, /school_code: schoolCode\.trim\(\)/)
  assert.match(routes, /router\.post\("\/login", rateLimitLogin, asyncHandler\(login\)\)/)
})

test("login throttling blocks repeated failures and clears after success", () => {
  resetLoginRateLimitForTests()
  const req = { ip: "127.0.0.8", body: { email: "teacher@example.test" } }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    let error = null
    rateLimitLogin(req, response(), (value) => { error = value || null })
    assert.equal(error, null)
  }
  const blockedResponse = response()
  let blocked = null
  rateLimitLogin(req, blockedResponse, (error) => { blocked = error })
  assert.equal(blocked?.status, 429)
  assert.equal(blocked?.code, "LOGIN_RATE_LIMITED")
  assert.ok(Number(blockedResponse.headers["Retry-After"]) > 0)

  resetLoginRateLimitForTests()
  const successResponse = response()
  let firstError = null
  rateLimitLogin(req, successResponse, (error) => { firstError = error || null })
  assert.equal(firstError, null)
  successResponse.statusCode = 200
  successResponse.emit("finish")
  for (let attempt = 0; attempt < 10; attempt += 1) rateLimitLogin(req, response(), () => {})
  let afterReset = null
  rateLimitLogin(req, response(), (error) => { afterReset = error })
  assert.equal(afterReset?.status, 429)
})
