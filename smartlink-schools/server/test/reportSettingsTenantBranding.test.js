import test from "node:test"
import assert from "node:assert/strict"
import {
  defaultReportPdfTemplate,
  normalizeReportPdfTemplateId,
  reportPdfTemplatesForSchool,
} from "../src/services/reportSettingsService.js"

test("tenant report settings never expose the Reign-specific artwork to another school", () => {
  const anotherSchool = { school_name: "Lighthouse Academy", school_code: "LHA" }
  assert.equal(defaultReportPdfTemplate(anotherSchool), "smartlink_word")
  assert.equal(normalizeReportPdfTemplateId("ria_exact", anotherSchool), "smartlink_word")
  assert.equal(reportPdfTemplatesForSchool(anotherSchool).some((template) => template.id === "ria_exact"), false)
})

test("the Reign tenant retains its explicitly branded report template", () => {
  const reign = { school_name: "Reign International Academy", school_code: "RIA" }
  assert.equal(defaultReportPdfTemplate(reign), "ria_exact")
  assert.equal(normalizeReportPdfTemplateId("ria_exact", reign), "ria_exact")
  assert.equal(reportPdfTemplatesForSchool(reign).some((template) => template.id === "ria_exact"), true)
})
